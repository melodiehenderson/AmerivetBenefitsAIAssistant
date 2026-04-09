import type { Session } from '@/lib/rag/session-store';
import pricingUtils from '@/lib/rag/pricing-utils';
import { classifyQueryIntent } from '@/lib/rag/query-intent-classifier';
import { amerivetBenefits2024_2025 } from '@/lib/data/amerivet';
import { isKaiserEligibleState } from '@/lib/qa/medical-helpers';
import { stripPricingDetails } from '@/lib/rag/response-utils';

function buildTierPricingLines(tiers: { employeeOnly: number; employeeSpouse: number; employeeChildren: number; employeeFamily: number }) {
  return [
    `- Employee Only: $${pricingUtils.formatMoney(tiers.employeeOnly)}/month`,
    `- Employee + Spouse: $${pricingUtils.formatMoney(tiers.employeeSpouse)}/month`,
    `- Employee + Child(ren): $${pricingUtils.formatMoney(tiers.employeeChildren)}/month`,
    `- Employee + Family: $${pricingUtils.formatMoney(tiers.employeeFamily)}/month`,
  ].join('\n');
}

type CategoryResponseArgs = {
  queryLower: string;
  session: Session;
  coverageTier: string;
  enrollmentPortalUrl: string;
  hrPhone: string;
};

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
    msg += `\nWant to compare with vision coverage or switch coverage tiers?`;
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
    msg += `\nWant to compare with dental coverage or switch coverage tiers?`;
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
    return msg;
  };

  if (wantsDental && wantsVision) return finalize(`${buildDentalOverview()}\n\n---\n\n${buildVisionOverview()}`);
  if (wantsLife) return finalize(buildLifeOverview());

  if (wantsDisability || wantsCritical || wantsAccident || wantsSupplemental) {
    let msg = `I can help with these benefits, but detailed plan terms are in Workday.\n\n`;
    if (wantsDisability) msg += `- Disability: Short-Term and Long-Term Disability options are available.\n`;
    if (wantsCritical) msg += `- Critical Illness coverage is available as a supplemental benefit.\n`;
    if (wantsAccident) msg += `- Accident/AD&D coverage is available as a supplemental benefit.\n`;
    if (wantsSupplemental) msg += `- Supplemental benefits include options like critical illness and accident coverage.\n`;
    msg += `\nFor plan details, eligibility rules, and rates, please check Workday: ${enrollmentPortalUrl} or contact HR at ${hrPhone}.`;
    msg += `\n\nIf you want, tell me which benefit to focus on and I can summarize what I have available.`;
    return finalize(msg);
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
