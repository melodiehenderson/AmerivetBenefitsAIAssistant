import type { Session } from '@/lib/rag/session-store';
import pricingUtils from '@/lib/rag/pricing-utils';
import { classifyQueryIntent } from '@/lib/rag/query-intent-classifier';
import { amerivetBenefits2024_2025 } from '@/lib/data/amerivet';
import { isKaiserEligibleState } from '@/lib/qa/medical-helpers';

function buildTierPricingLines(tiers: { employeeOnly: number; employeeSpouse: number; employeeChildren: number; employeeFamily: number }) {
  return [
    `- Employee Only: $${pricingUtils.formatMoney(tiers.employeeOnly)}/month`,
    `- Employee + Spouse: $${pricingUtils.formatMoney(tiers.employeeSpouse)}/month`,
    `- Employee + Child(ren): $${pricingUtils.formatMoney(tiers.employeeChildren)}/month`,
    `- Employee + Family: $${pricingUtils.formatMoney(tiers.employeeFamily)}/month`,
  ].join('\n');
}

function stripPricingDetails(text: string): string {
  return text
    .split('\n')
    .filter(line => !/\$\d|premium|per\s*pay(?:check|period)|\/month|\/year|annual\s+premium|cost\s+comparison|total\s+estimated\s+annual\s+cost/i.test(line))
    .join('\n')
    .replace(/\$[\d,]+\.?\d{0,2}(?:\/(?:month|year|mo|yr|paycheck|pay period|bi-?weekly?))?/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type CategoryResponseArgs = {
  queryLower: string;
  session: Session;
  coverageTier: string;
  enrollmentPortalUrl: string;
  hrPhone: string;
};

function buildPackageNextStepPrompt(topic: 'Dental' | 'Vision' | 'Life' | 'Disability' | 'Supplemental'): string {
  if (topic === 'Dental') {
    return 'If you want, I can show vision quickly too, switch dental coverage tiers, or move on to life, disability, or supplemental benefits next.';
  }

  if (topic === 'Vision') {
    return 'If you want, I can show dental quickly too, switch vision coverage tiers, or move on to life, disability, or supplemental benefits next.';
  }

  if (topic === 'Life') {
    return 'If you want, I can move on to disability, critical illness, or accident coverage next.';
  }

  if (topic === 'Disability') {
    return 'If you want, I can move on to life insurance, critical illness, or accident coverage next.';
  }

  return 'If you want, I can move on to life insurance, disability, or HSA/FSA guidance next.';
}

export function buildCoverageTierOptionsResponse(
  session: Session,
  benefit: 'medical' | 'dental' | 'vision' = 'medical',
): string {
  const tierLines = [
    '- Employee Only',
    '- Employee + Spouse',
    '- Employee + Child(ren)',
    '- Employee + Family',
  ].join('\n');

  if (benefit === 'medical') {
    let msg = `These are the available medical coverage tiers:\n\n${tierLines}\n\n`;
    msg += `If you tell me which tier you want, I can show the matching medical plans`;
    if (session.userState) {
      msg += ` in ${session.userState}`;
    }
    msg += `.`;
    return msg;
  }

  if (benefit === 'dental') {
    return `These are the available dental coverage tiers:\n\n${tierLines}\n\nTell me which tier you want and I’ll show the dental pricing/details for that level.`;
  }

  return `These are the available vision coverage tiers:\n\n${tierLines}\n\nTell me which tier you want and I’ll show the vision pricing/details for that level.`;
}

export function buildCategoryExplorationResponse({ queryLower, session, coverageTier, enrollmentPortalUrl, hrPhone }: CategoryResponseArgs): string | null {
  const noPricingMode = !!session.noPricingMode;
  const finalize = (response: string) => noPricingMode ? stripPricingDetails(response) : response;
  const catalog = amerivetBenefits2024_2025;

  if (/per[\s-]*pay(?:check|period)?|deduct(?:ion|ed)|enroll\s+in\s+all|total\s+cost|how\s+much\s+would|maternity|pregnan|orthodont|braces|qle|qualifying\s+life\s+event|how\s+many\s+days|deadline|window|fmla|short\s*[- ]?term\s+disability|pre-?existing|clause|dhmo/i.test(queryLower)) {
    return null;
  }

  const { intent: responseIntent } = classifyQueryIntent(queryLower, session.currentTopic);
  if (responseIntent === 'advisory' || responseIntent === 'comparison' || responseIntent === 'cost_lookup') {
    return null;
  }

  const wantsDental = /\b(dental|teeth|orthodont|braces)\b/i.test(queryLower);
  const wantsVision = /\b(vision|eye|glasses|contacts|lasik)\b/i.test(queryLower);
  const wantsMedical = /\b(medical|health)\b/i.test(queryLower);
  const wantsLife = /\b(life\s+insurance|term\s+life|whole\s+life|basic\s+life|voluntary\s+life)\b/i.test(queryLower);
  const wantsDisability = /\b(disability|std|ltd|short\s*-?term|long\s*-?term)\b/i.test(queryLower);
  const wantsCritical = /\bcritical\s*illness\b/i.test(queryLower);
  const wantsAccident = /\b(accident|ad&d)\b/i.test(queryLower);
  const wantsSupplemental = /\b(supplemental|voluntary)\b/i.test(queryLower);
  const wantsFamilyCoverage = /\b(family\s+coverage|family\s+plan|spouse|child|children|kid|kids|dependent)\b/i.test(queryLower);
  const wantsExplanation = /\b(what\s+is|what\s+does|what\s+can\s+you\s+tell\s+me|tell\s+me\s+about|explain|how\s+does|how\s+do|what\s+would)\b/i.test(queryLower);

  const buildDentalOverview = () => {
    const dental = catalog.dentalPlan;
    const coins = dental.coverage?.coinsurance ?? {};
    const toCoveredPercent = (coinsurance?: number) => {
      if (typeof coinsurance !== 'number') return null;
      const covered = Math.max(0, Math.min(1, 1 - coinsurance));
      return Math.round(covered * 100);
    };
    const deductible = dental.coverage?.deductibles?.individual ?? dental.benefits.deductible;
    const familyDeductible = dental.coverage?.deductibles?.family ?? dental.benefits.deductible * 3;
    const orthoCopay = dental.coverage?.copays?.orthodontia;
    const outOfPocketMax = dental.coverage?.outOfPocketMax ?? dental.benefits.outOfPocketMax;

    let msg = `Dental coverage: **${dental.name}** (${dental.provider}).\n\n`;
    if (dental.description) msg += `${dental.description}\n\n`;
    msg += `Coverage highlights:\n`;
    msg += `- Deductible: $${deductible} individual / $${familyDeductible} family\n`;
    const preventiveCovered = toCoveredPercent(coins.preventive);
    const basicCovered = toCoveredPercent(coins.basic);
    const majorCovered = toCoveredPercent(coins.major);
    if (preventiveCovered !== null) msg += `- Preventive: ${preventiveCovered}% covered\n`;
    if (basicCovered !== null) msg += `- Basic services: ${basicCovered}% covered\n`;
    if (majorCovered !== null) msg += `- Major services: ${majorCovered}% covered\n`;
    if (typeof orthoCopay === 'number') msg += `- Orthodontia copay: $${orthoCopay}\n`;
    if (typeof outOfPocketMax === 'number') msg += `- Out-of-pocket max: $${outOfPocketMax}\n`;
    if (dental.features?.length) msg += `\nKey features:\n${dental.features.map((feature) => `- ${feature}`).join('\n')}\n`;
    if (dental.limitations?.length) msg += `\nLimitations:\n${dental.limitations.map((item) => `- ${item}`).join('\n')}\n`;
    if (!noPricingMode) {
      msg += `\nMonthly premiums:\n${buildTierPricingLines(dental.tiers)}\n`;
    } else {
      msg += `\nPricing is currently hidden. Say "show pricing" to include premiums.\n`;
    }
    msg += `\n${buildPackageNextStepPrompt('Dental')}`;
    return msg;
  };

  const buildVisionOverview = () => {
    const vision = catalog.visionPlan;
    const copays = vision.coverage?.copays ?? {};
    let msg = `Vision coverage: **${vision.name}** (${vision.provider}).\n\n`;
    if (vision.description) msg += `${vision.description}\n\n`;
    msg += `Coverage highlights:\n`;
    if (typeof copays.exam === 'number') msg += `- Exam copay: $${copays.exam}\n`;
    if (typeof copays.lenses === 'number') msg += `- Lenses copay: $${copays.lenses}\n`;
    if (vision.features?.length) msg += `\nKey features:\n${vision.features.map((feature) => `- ${feature}`).join('\n')}\n`;
    if (vision.limitations?.length) msg += `\nLimitations:\n${vision.limitations.map((item) => `- ${item}`).join('\n')}\n`;
    if (!noPricingMode) {
      msg += `\nMonthly premiums:\n${buildTierPricingLines(vision.tiers)}\n`;
    } else {
      msg += `\nPricing is currently hidden. Say "show pricing" to include premiums.\n`;
    }
    msg += `\n${buildPackageNextStepPrompt('Vision')}`;
    return msg;
  };

  const buildMedicalOverview = () => {
    const coverageTierLabel = coverageTier || 'Employee Only';
    const payPeriods = session.payPeriods || 26;
    const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTierLabel, payPeriods);
    const medRows = rows.filter((row) => !/dental|vision/i.test(row.plan) && row.provider !== 'VSP');
    const filtered = session.userState && !isKaiserEligibleState(session.userState)
      ? medRows.filter((row) => !/kaiser/i.test(row.plan))
      : medRows;

    let msg = `Medical plan options (${coverageTierLabel}):\n\n`;
    if (!noPricingMode) {
      for (const row of filtered) {
        msg += `- ${row.plan} (${row.provider}): $${pricingUtils.formatMoney(row.perMonth)}/month ($${pricingUtils.formatMoney(row.annually)}/year)\n`;
      }
    } else {
      for (const row of filtered) {
        msg += `- ${row.plan} (${row.provider})\n`;
      }
      msg += `\nPricing is currently hidden. Say "show pricing" to include premiums.\n`;
    }
    if (filtered.length < medRows.length) {
      msg += `\nNote: Kaiser Standard HMO is only available in CA, GA, WA, and OR.\n`;
    }
    msg += `\nWant to compare plans or switch coverage tiers?`;
    return msg;
  };

  const buildFamilyCoverageOverview = () => {
    const inferredTier = /\bspouse\b/i.test(queryLower) && /\b(child|children|kid|kids)\b/i.test(queryLower)
      ? 'Employee + Family'
      : /\bspouse\b/i.test(queryLower)
        ? 'Employee + Spouse'
        : /\b(child|children|kid|kids|dependent)\b/i.test(queryLower)
          ? 'Employee + Child(ren)'
          : 'Employee + Family';

    const payPeriods = session.payPeriods || 26;
    const rows = pricingUtils.buildPerPaycheckBreakdown(inferredTier, payPeriods);
    const medicalRows = rows.filter((row) => !/dental|vision/i.test(row.plan) && row.provider !== 'VSP');
    const filteredMedical = session.userState && !isKaiserEligibleState(session.userState)
      ? medicalRows.filter((row) => !/kaiser/i.test(row.plan))
      : medicalRows;
    const dental = catalog.dentalPlan;
    const vision = catalog.visionPlan;

    let msg = `For a household like the one you described, the most likely coverage tier is **${inferredTier}**.\n\n`;
    msg += `Medical options at that tier:\n`;
    for (const row of filteredMedical) {
      if (noPricingMode) {
        msg += `- ${row.plan} (${row.provider})\n`;
      } else {
        msg += `- ${row.plan} (${row.provider}): $${pricingUtils.formatMoney(row.perMonth)}/month\n`;
      }
    }

    if (filteredMedical.length < medicalRows.length) {
      msg += `\nKaiser is only available in CA, GA, WA, and OR.\n`;
    }

    msg += `\nFamily-supporting benefits at the same tier:\n`;
    if (noPricingMode) {
      msg += `- Dental: ${dental.name}\n`;
      msg += `- Vision: ${vision.name}\n`;
    } else {
      msg += `- Dental (${dental.name}): $${pricingUtils.formatMoney(dental.tiers.employeeFamily)}/month\n`;
      msg += `- Vision (${vision.name}): $${pricingUtils.formatMoney(vision.tiers.employeeFamily)}/month\n`;
    }

    msg += `\nWant to focus on medical, compare coverage tiers, or look at dental/vision for the family tier?`;
    return msg;
  };

  const buildLifeOverview = () => {
    const lifePlans = catalog.voluntaryPlans.filter((plan) => plan.voluntaryType === 'life');
    const basic = lifePlans.find((plan) => /basic life/i.test(plan.name));
    const term = lifePlans.find((plan) => /term life/i.test(plan.name));
    const whole = lifePlans.find((plan) => /whole life/i.test(plan.name));

    let msg = `Life insurance options:\n\n`;
    if (basic) msg += `- **${basic.name}** (${basic.provider}) - ${basic.description}\n`;
    if (term) msg += `- **${term.name}** (${term.provider}) - ${term.description}\n`;
    if (whole) msg += `- **${whole.name}** (${whole.provider}) - ${whole.description}\n`;

    const featureLines = (plan?: typeof basic) => !plan?.features?.length ? '' : plan.features.map((feature) => `  - ${feature}`).join('\n');
    if (basic?.features?.length) msg += `\nBasic Life features:\n${featureLines(basic)}\n`;
    if (term?.features?.length) msg += `\nVoluntary Term Life features:\n${featureLines(term)}\n`;
    if (whole?.features?.length) msg += `\nWhole Life features:\n${featureLines(whole)}\n`;

    msg += `\nVoluntary life rates are age-banded. For your exact rate and coverage amount, check Workday: ${enrollmentPortalUrl}.`;
    msg += `\n\n${buildPackageNextStepPrompt('Life')}`;
    return msg;
  };

  if (wantsDental && wantsVision) return finalize(`${buildDentalOverview()}\n\n---\n\n${buildVisionOverview()}`);
  if (wantsLife) return finalize(buildLifeOverview());
  if (wantsFamilyCoverage && !wantsMedical && !wantsDental && !wantsVision && !wantsLife && !wantsDisability && !wantsCritical && !wantsAccident && !wantsSupplemental) {
    return finalize(buildFamilyCoverageOverview());
  }

  if (wantsDisability || wantsCritical || wantsAccident || wantsSupplemental) {
    let msg = '';

    if (wantsCritical) {
      msg += `Critical illness coverage is a supplemental benefit that can pay a lump-sum cash benefit if you are diagnosed with a covered serious condition, such as a heart attack, stroke, or certain cancers.\n\n`;
      msg += `What it is designed to do:\n`;
      msg += `- Help with non-medical costs like travel, childcare, or household bills\n`;
      msg += `- Give you extra cash on top of your medical plan if a major diagnosis happens\n`;
      msg += `- Reduce the financial shock of a big health event when you have a high deductible or limited emergency savings\n\n`;
      msg += `What it is not:\n`;
      msg += `- It does not replace your medical plan\n`;
      msg += `- It is not meant for routine care or everyday doctor visits\n`;
      msg += `- Benefit amounts, covered conditions, and exclusions depend on the actual policy details in Workday\n`;
    }

    if (wantsAccident) {
      if (msg) msg += `\n`;
      msg += `Accident/AD&D coverage is another supplemental option. It generally pays benefits after covered accidental injuries, and AD&D adds benefits for severe accidental loss of life or limb.\n\n`;
      msg += `People often look at it when:\n`;
      msg += `- They want extra protection beyond their medical plan\n`;
      msg += `- They have an active household or dependents\n`;
      msg += `- They want cash help after an accidental injury\n`;
    }

    if (wantsDisability) {
      if (msg) msg += `\n`;
      msg += `Disability coverage is meant to protect part of your income if you cannot work because of illness or injury.\n\n`;
      msg += `- Short-Term Disability helps with temporary time away from work\n`;
      msg += `- Long-Term Disability helps if the disability lasts longer\n`;
      msg += `- The specific waiting periods, percentages, and maximum benefits depend on the actual plan documents\n`;
    }

    if (wantsSupplemental && !wantsCritical && !wantsAccident && !wantsDisability) {
      msg += `Supplemental benefits are optional coverages that sit alongside your main medical plan. For AmeriVet, that generally includes benefits like critical illness and accident protection.\n\n`;
      msg += `They are typically meant to provide extra cash support when something significant happens, rather than replace your core medical coverage.\n`;
    }

    if (wantsExplanation || wantsCritical || wantsAccident || wantsDisability) {
      msg += `\nIf you want, I can also help you think through when one of these benefits is worth considering for your situation.`;
    }

    msg += `\n\nFor exact rates, covered conditions, waiting periods, and exclusions, please check Workday: ${enrollmentPortalUrl} or contact HR at ${hrPhone}.`;
    msg += `\n\n${buildPackageNextStepPrompt(wantsDisability ? 'Disability' : 'Supplemental')}`;
    return finalize(msg.trim());
  }

  if (wantsDental) return finalize(buildDentalOverview());
  if (wantsVision) return finalize(buildVisionOverview());
  if (wantsMedical) return finalize(buildMedicalOverview());

  if (/\b(benefits\s+overview|benefits|overview)\b/i.test(queryLower)) {
    const msg = `Here is a quick overview of your core benefit categories:\n\n` +
      `- Medical (BCBSTX Standard HSA, Enhanced HSA; Kaiser Standard HMO in CA/GA/WA/OR)\n` +
      `- Dental (BCBSTX Dental PPO)\n` +
      `- Vision (VSP Vision Plus)\n` +
      `- Life and voluntary coverage (Unum and Allstate options)\n\n` +
      `Which category would you like to explore first?`;
    return finalize(msg);
  }

  return null;
}

export function buildDentalVisionComparisonResponse(session: Session): string {
  const dental = amerivetBenefits2024_2025.dentalPlan;
  const vision = amerivetBenefits2024_2025.visionPlan;
  const dentalCoins = dental.coverage?.coinsurance ?? {};
  const toCoveredPercent = (coinsurance?: number) => {
    if (typeof coinsurance !== 'number') return null;
    const covered = Math.max(0, Math.min(1, 1 - coinsurance));
    return Math.round(covered * 100);
  };
  const dentalDeductible = dental.coverage?.deductibles?.individual ?? dental.benefits.deductible;
  const dentalFamilyDeductible = dental.coverage?.deductibles?.family ?? dental.benefits.deductible * 3;
  const dentalOrthoCopay = dental.coverage?.copays?.orthodontia;
  const dentalOopMax = dental.coverage?.outOfPocketMax ?? dental.benefits.outOfPocketMax;
  const visionCopays = vision.coverage?.copays ?? {};

  let msg = `Here is a side-by-side comparison of Dental vs Vision coverage:\n\n`;
  msg += `| | **${dental.name}** | **${vision.name}** |\n`;
  msg += `|---|---|---|\n`;
  msg += `| Carrier | ${dental.provider} | ${vision.provider} |\n`;
  msg += `| Deductible | $${dentalDeductible} individual / $${dentalFamilyDeductible} family | $0 |\n`;
  msg += `| Out-of-pocket max | ${typeof dentalOopMax === 'number' ? `$${dentalOopMax}` : 'Not specified'} | $0 |\n`;
  const preventiveCovered = toCoveredPercent(dentalCoins.preventive);
  const basicCovered = toCoveredPercent(dentalCoins.basic);
  const majorCovered = toCoveredPercent(dentalCoins.major);
  msg += `| Preventive | ${preventiveCovered !== null ? `${preventiveCovered}% covered` : 'Covered'} | N/A |\n`;
  msg += `| Basic services | ${basicCovered !== null ? `${basicCovered}% covered` : 'Covered'} | N/A |\n`;
  msg += `| Major services | ${majorCovered !== null ? `${majorCovered}% covered` : 'Covered'} | N/A |\n`;
  msg += `| Orthodontia | ${typeof dentalOrthoCopay === 'number' ? `$${dentalOrthoCopay} copay` : 'Available'} | Not applicable |\n`;
  msg += `| Exam copay | N/A | ${typeof visionCopays.exam === 'number' ? `$${visionCopays.exam}` : 'Included'} |\n`;
  msg += `| Lenses copay | N/A | ${typeof visionCopays.lenses === 'number' ? `$${visionCopays.lenses}` : 'Included'} |\n`;

  if (!session.noPricingMode) {
    msg += `\n**Monthly premiums:**\n`;
    msg += `- Dental (Employee Only): $${pricingUtils.formatMoney(dental.tiers.employeeOnly)}/month\n`;
    msg += `- Vision (Employee Only): $${pricingUtils.formatMoney(vision.tiers.employeeOnly)}/month\n`;
  } else {
    msg += `\nPricing is currently hidden. Say "show pricing" to include premiums.\n`;
  }

  msg += `\nWant the full pricing table for a specific coverage tier or more detail on one plan?`;
  return session.noPricingMode ? stripPricingDetails(msg) : msg;
}
