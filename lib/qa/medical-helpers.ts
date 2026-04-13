import type { Session } from '@/lib/rag/session-store';
import pricingUtils from '@/lib/rag/pricing-utils';
import { amerivetBenefits2024_2025, KAISER_AVAILABLE_STATE_CODES, type BenefitPlan } from '@/lib/data/amerivet';

const KAISER_STATES = new Set<string>(KAISER_AVAILABLE_STATE_CODES);

type KaiserUnavailableVariant = 'compare' | 'pricing' | 'redirect';

function inferCoverageTierFromQuery(query: string, session: Session): string {
  const low = query.toLowerCase();
  if (/\bfamily\s*4\+|\bfamily4\+|\bspouse\b.*\b(child|children|kid|kids)\b|\b(child|children|kid|kids)\b.*\bspouse\b|\bmarried\b.*\b(child|children|kid|kids)\b|\b(child|children|kid|kids)\b.*\bmarried\b|\b(husband|wife|partner)\b.*\b(child|children|kid|kids)\b|\b(child|children|kid|kids)\b.*\b(husband|wife|partner)\b/i.test(low)) return 'Employee + Family';
  if (/employee\s*\+\s*family|family\s*(of|plan|coverage)|for\s*(my|the|our)\s*family/i.test(low)) return 'Employee + Family';
  if (/employee\s*\+\s*spouse|spouse|husband|wife|partner/i.test(low)) return 'Employee + Spouse';
  if (/employee\s*\+\s*child|child(?:ren)?\s*coverage|for\s*(my|the)\s*(kid|child|son|daughter)|dependent\s*child/i.test(low)) return 'Employee + Child(ren)';
  if (/employee\s*only|individual|single|just\s*me|only\s*me/i.test(low)) return 'Employee Only';
  return session.coverageTierLock || 'Employee Only';
}

function getUserConversationText(session: Session): string {
  return (session.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content.toLowerCase())
    .join('\n');
}

function sessionHasPregnancySignal(session: Session, query: string): boolean {
  const conversation = `${getUserConversationText(session)}\n${query.toLowerCase()}`;
  return /\b(pregnan|expecting|having\s+a\s+baby|maternity|prenatal|postnatal|delivery|birth)\b/i.test(conversation)
    || (session.lifeEvents || []).includes('pregnancy');
}

function sessionHasHouseholdSignal(session: Session, query: string): boolean {
  const conversation = `${getUserConversationText(session)}\n${query.toLowerCase()}`;
  return /\b(spouse|wife|husband|partner|kids?|children|family|household|dependents?)\b/i.test(conversation)
    || Boolean(session.familyDetails?.hasSpouse)
    || Boolean((session.familyDetails?.numChildren || 0) > 0)
    || /Employee \+ (Spouse|Child|Family)/i.test(session.coverageTierLock || '');
}

export function isKaiserEligibleState(state?: string | null): boolean {
  return !!state && KAISER_STATES.has(state.toUpperCase());
}

export function buildPpoClarificationForState(state?: string | null): string {
  if (state && isKaiserEligibleState(state)) {
    return `AmeriVet does not offer a standalone PPO medical plan. Your medical options are Standard HSA and Enhanced HSA (BCBSTX) plus Kaiser Standard HMO in ${state}. The HSA plans use a nationwide PPO network, but they are HDHP/HSA plans, not a traditional PPO.`;
  }
  const stateNote = state ? ` In ${state}, your medical options are Standard HSA and Enhanced HSA (BCBSTX).` : '';
  return `AmeriVet does not offer a standalone PPO medical plan.${stateNote} The HSA plans use a nationwide PPO network, but they are HDHP/HSA plans, not a traditional PPO.`;
}

export function buildPpoClarificationFallback(session: Pick<Session, 'userState'>): string {
  return buildPpoClarificationForState(session.userState);
}

export function buildKaiserUnavailableFallback(session: Session, variant: KaiserUnavailableVariant): string {
  const stateLabel = (session.userState || 'your state').toUpperCase();
  if (variant === 'pricing') {
    return `Kaiser Standard HMO is only available in California, Georgia, Washington, and Oregon. Since you're in ${stateLabel}, your medical plan options are **Standard HSA** and **Enhanced HSA**. Would you like pricing for those?`;
  }
  if (variant === 'redirect') {
    const nyNote = stateLabel === 'NY'
      ? `\n\nFor New York employees, the strongest alternative is **Enhanced HSA** on the BCBSTX nationwide PPO network if you want stronger cost protection.`
      : '';
    return `Kaiser is only available in California, Georgia, Washington, and Oregon. In ${stateLabel}, your medical options are:\n\n- Standard HSA (BCBS of Texas) ΓÇö lower premium, higher deductible, full HSA contribution eligible\n- Enhanced HSA (BCBS of Texas) ΓÇö higher premium, lower deductible, better for anticipated medical use\n\nBoth use the nationwide BCBSTX PPO network.${nyNote} Would you like a side-by-side comparison?`;
  }
  return `Kaiser Standard HMO is only available in California, Georgia, Washington, and Oregon. Since you're in ${stateLabel}, your medical options are **Standard HSA** and **Enhanced HSA**. Would you like to compare those two instead?`;
}

function getMedicalPlansCatalog() {
  const medicalPlans = amerivetBenefits2024_2025.medicalPlans;
  const findPlan = (name: string) => medicalPlans.find((p) => p.name.toLowerCase() === name.toLowerCase()) || null;
  return {
    standard: findPlan('Standard HSA'),
    enhanced: findPlan('Enhanced HSA'),
    kaiser: findPlan('Kaiser Standard HMO'),
  };
}

function getFilteredMedicalPricingRows(session: Session, coverageTier: string) {
  const payPeriods = session.payPeriods || 26;
  const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);
  const medRows = rows.filter(r => !/dental|vision/i.test(r.plan) && r.provider !== 'VSP');
  const filtered = session.userState && !isKaiserEligibleState(session.userState)
    ? medRows.filter(r => !/kaiser/i.test(r.plan))
    : medRows;
  return { payPeriods, rows, filtered };
}

export function getCoverageTierForQuery(query: string, session: Session): string {
  return inferCoverageTierFromQuery(query, session);
}

export function buildCrossBenefitDeductibleAnswer(query: string): string | null {
  const lower = query.toLowerCase();
  const asksWhetherCounts = /\b(count|apply|go toward|goes toward|toward|towards|rolled?\s+into)\b/i.test(lower);
  const mentionsMedicalAccumulator = /\bmedical\b.*\b(deductible|out[- ]of[- ]pocket|oop max)\b|\b(deductible|out[- ]of[- ]pocket|oop max)\b.*\bmedical\b/i.test(lower);
  const benefitLabel = /\bvision\b/i.test(lower) && !/\bdental\b/i.test(lower) ? 'Vision' : (/\bdental\b/i.test(lower) ? 'Dental' : null);

  if (!benefitLabel || !asksWhetherCounts || !mentionsMedicalAccumulator) {
    return null;
  }

  return `${benefitLabel} and medical coverage are generally separate benefit plans, so ${benefitLabel.toLowerCase()} out-of-pocket costs usually do not count toward your medical plan deductible or medical out-of-pocket maximum.\n\nThink of them as separate buckets:\n- Medical expenses apply to your medical deductible and medical out-of-pocket maximum\n- ${benefitLabel} expenses apply only to the ${benefitLabel.toLowerCase()} plan's own deductibles, copays, or annual limits\n\nIf you want, I can also explain how the ${benefitLabel.toLowerCase()} deductible and annual maximum work.`;
}

export function getAvailablePricingRows(
  session: Session,
  coverageTier: string,
  options?: { includeNonMedical?: boolean },
) {
  const payPeriods = session.payPeriods || 26;
  const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);
  const baseRows = options?.includeNonMedical ? rows : rows.filter(r => !/dental|vision/i.test(r.plan) && r.provider !== 'VSP');
  const filtered = session.userState && !isKaiserEligibleState(session.userState)
    ? baseRows.filter(r => !/kaiser/i.test(r.plan))
    : baseRows;
  return { payPeriods, rows, filtered };
}

export function buildMedicalPlanFallback(query: string, session: Session): string | null {
  const lower = query.toLowerCase();
  const wantsCompare = /compare|comparison|difference|vs\.?|versus|side\s*by\s*side|both\s+plans|two\s+plans/i.test(lower);
  const mentionsStandard = /standard\s*hsa/.test(lower);
  const mentionsEnhanced = /enhanced\s*hsa/.test(lower);
  const mentionsKaiser = /kaiser|hmo/.test(lower);
  const wantsDeductible = /deductible/i.test(lower);
  const wantsOop = /out\s*of\s*pocket|oop\s*max|max\s*(?:out\s*of\s*pocket|oop)/i.test(lower);
  const wantsCoinsurance = /coinsurance|co\s*insurance/i.test(lower);

  const { standard, enhanced, kaiser } = getMedicalPlansCatalog();

  const selected: BenefitPlan[] = [];
  if (mentionsStandard && standard) selected.push(standard);
  if (mentionsEnhanced && enhanced) selected.push(enhanced);
  if (mentionsKaiser && kaiser) selected.push(kaiser);

  if (wantsCompare || selected.length > 1) {
    const comparePlans = selected.length > 0 ? selected : [standard, enhanced].filter(Boolean) as BenefitPlan[];
    if (comparePlans.length === 0) return null;
    const coverageTier = inferCoverageTierFromQuery(query, session);
    const { rows } = getFilteredMedicalPricingRows(session, coverageTier);
    let msg = `Here is a side-by-side comparison for ${coverageTier} coverage:\n\n`;
    msg += `| Plan | Deductible | Out-of-pocket max | Coinsurance |`;
    if (!session.noPricingMode) msg += ` Monthly premium |`;
    msg += `\n|---|---|---|---|${session.noPricingMode ? '' : '---|'}\n`;

    for (const plan of comparePlans) {
      const premium = rows.find((r) => r.plan === plan.name)?.perMonth ?? null;
      const deductible = plan.coverage?.deductibles?.individual ?? plan.benefits.deductible;
      const oopMax = plan.coverage?.outOfPocketMax ?? plan.benefits.outOfPocketMax;
      const coins = plan.coverage?.coinsurance?.inNetwork ?? plan.benefits.coinsurance;
      msg += `| ${plan.name} | $${pricingUtils.formatMoney(deductible)} | $${pricingUtils.formatMoney(oopMax)} | ${Math.round(coins * 100)}% |`;
      if (!session.noPricingMode) msg += ` $${pricingUtils.formatMoney(premium || 0)} |`;
      msg += `\n`;
    }

    if (comparePlans.some((p) => /kaiser/i.test(p.name)) && session.userState && !isKaiserEligibleState(session.userState)) {
      msg += `\nNote: Kaiser Standard HMO is only available in CA, GA, WA, and OR. Since you are in ${session.userState}, it may not be available.`;
    }
    return msg.trim();
  }

  const target = mentionsEnhanced && enhanced
    ? enhanced
    : mentionsKaiser && kaiser
      ? kaiser
      : mentionsStandard && standard
        ? standard
        : null;

  if (!target || !(wantsDeductible || wantsOop || wantsCoinsurance)) return null;

  const deductible = target.coverage?.deductibles?.individual ?? target.benefits.deductible;
  const deductibleFamily = target.coverage?.deductibles?.family ?? null;
  const oopMax = target.coverage?.outOfPocketMax ?? target.benefits.outOfPocketMax;
  const coins = target.coverage?.coinsurance?.inNetwork ?? target.benefits.coinsurance;
  let msg = `${target.name} summary:\n`;
  msg += `- Deductible: $${pricingUtils.formatMoney(deductible)}${deductibleFamily ? ` individual / $${pricingUtils.formatMoney(deductibleFamily)} family` : ''}\n`;
  msg += `- Out-of-pocket max: $${pricingUtils.formatMoney(oopMax)}\n`;
  msg += `- Coinsurance: ${Math.round(coins * 100)}% (in-network)\n`;
  if (!session.noPricingMode) {
    const coverageTier = inferCoverageTierFromQuery(query, session);
    const { rows } = getFilteredMedicalPricingRows(session, coverageTier);
    const premium = rows.find((r) => r.plan === target.name)?.perMonth ?? null;
    if (premium !== null) msg += `- Monthly premium (${coverageTier}): $${pricingUtils.formatMoney(premium)}\n`;
  }
  return msg.trim();
}

export function buildRecommendationOverview(query: string, session: Session): string | null {
  const lower = query.toLowerCase();
  if (/\b(calculate|estimate|project(?:ed)?|model)\b.*\b(cost|costs|expense|expenses)\b|\bhealthcare\s+costs?\b.*\b(next\s+year|\d{4}|estimate|project)\b/.test(lower)) {
    return null;
  }
  const recommendationSignal = /\b(recommendation|recommend|suggest|best\s+plan|best\s+option|which\s+plan|what\s+plan|what\s+do\s+you\s+recommend|what[’']?s\s+best\s+for\s+me|how\s+do\s+i\s+decide(?:\s+which\s+one)?|help\s+me\s+choose|which\s+one\s+is\s+best)\b/i.test(lower);
  const healthySignal = /\b(healthy|low\s+utilization|low\s+use|low\s+usage|rarely\s+(?:go|use))\b/i.test(lower);
  const singleSignal = /\b(single|individual|just\s+me|only\s+me|no\s+dependents|no\s+kids|no\s+children)\b/i.test(lower);
  const savingsSignal = /\b(save\s+money|low\s+cost|cheapest|lowest\s+premium|save\s+on\s+premiums|budget)\b/i.test(lower);
  const lowestOutOfPocketSignal = /\b(lowest|least)\s+out[- ]of[- ]pocket|\blowest\s+oop|\bminimi[sz]e\s+out[- ]of[- ]pocket\b/i.test(lower);
  const higherUsageSignal = /\b(high\s+usage|high\s+utilization|frequent\s+(?:doctor|specialist|care|visits?)|regular\s+(?:care|visits?)|ongoing\s+care|chronic|ongoing\s+prescriptions?|a\s+lot\s+of\s+care|more\s+medical\s+use|heavy\s+usage)\b/i.test(lower);
  const moderateUsageSignal = /\b(moderate\s+usage|some\s+medical\s+use|occasional\s+(?:care|visits?)|a\s+few\s+visits?)\b/i.test(lower);
  const explicitNonMedicalCategory = /\b(dental|vision|life(?:\s+insurance)?|disability|critical(?:\s+illness)?|accident|hospital\s+indemnity|hsa\/fsa|fsa)\b/i.test(lower);
  const wantsMedicalRecommendation = /\b(medical|health|hsa|kaiser|ppo|hmo|standard\s+hsa|enhanced\s+hsa)\b/i.test(lower)
    || (session.currentTopic || '').toLowerCase().includes('medical')
    || /\b(standard\s+hsa|enhanced\s+hsa|kaiser\s+standard\s+hmo|medical\s+plan options|medical options|compare plans)\b/i.test(session.lastBotMessage || '')
    || (recommendationSignal && !explicitNonMedicalCategory);
  const mentionsIntegratedNetworkPreference = /\b(kaiser|integrated\s+network|hmo\s+style|one\s+system|one\s+network|coordinated\s+care)\b/i.test(lower);
  const coverageTier = inferCoverageTierFromQuery(query, session);
  const pregnancySignal = sessionHasPregnancySignal(session, query);
  const householdSignal = sessionHasHouseholdSignal(session, query);
  const selectedPlan = session.selectedPlan || '';

  if (!(recommendationSignal || healthySignal || savingsSignal || lowestOutOfPocketSignal || higherUsageSignal || moderateUsageSignal || pregnancySignal)) return null;
  if (!wantsMedicalRecommendation) return null;

  const { filtered } = getFilteredMedicalPricingRows(session, coverageTier);

  const standard = filtered.find(r => /standard\s+hsa/i.test(r.plan));
  const enhanced = filtered.find(r => /enhanced\s+hsa/i.test(r.plan));
  const kaiser = filtered.find(r => /kaiser/i.test(r.plan));
  if (!standard && !enhanced && filtered.length === 0) return null;

  const usageBand = lowestOutOfPocketSignal
    ? 'high'
    : higherUsageSignal
    ? 'high'
    : moderateUsageSignal
      ? 'moderate'
      : healthySignal || savingsSignal
        ? 'low'
        : null;

  const decidingBetweenShownPlans = /\b(which\s+one|which\s+plan|best\s+for\s+me|what[’']?s\s+best\s+for\s+me|how\s+do\s+i\s+decide|help\s+me\s+choose|what\s+do\s+you\s+recommend)\b/i.test(lower);

  if (decidingBetweenShownPlans && !usageBand && !singleSignal && !mentionsIntegratedNetworkPreference && !pregnancySignal && !selectedPlan) {
    let clarifier = `I can recommend one — the biggest factor is how much care you expect to use.\n\n`;
    clarifier += `If you expect low medical use, I usually lean **Standard HSA** for the lower premium. `;
    clarifier += `If you expect frequent visits, ongoing prescriptions, or want a lower deductible, I usually lean **Enhanced HSA**.`;
    if (kaiser && session.userState && isKaiserEligibleState(session.userState)) {
      clarifier += ` If you specifically want an integrated HMO-style network in ${session.userState}, **Kaiser Standard HMO** can also make sense.`;
    }
    clarifier += `\n\nQuick clarifier: would you say your expected usage is **low, moderate, or high**?`;
    return clarifier.trim();
  }

  let recommendationPlan = 'Standard HSA';
  let recommendationReason = `it keeps premiums lowest while still giving you full HSA eligibility`;

  if (
    selectedPlan
    && /Standard HSA|Enhanced HSA|Kaiser Standard HMO/i.test(selectedPlan)
    && !lowestOutOfPocketSignal
    && !(pregnancySignal && householdSignal)
  ) {
    recommendationPlan = selectedPlan;
    recommendationReason = `it matches the direction you are already leaning and keeps the recommendation consistent with the tradeoff we have been discussing`;
  } else if (pregnancySignal && householdSignal && kaiser && session.userState && isKaiserEligibleState(session.userState)) {
    recommendationPlan = 'Kaiser Standard HMO';
    recommendationReason = lowestOutOfPocketSignal
      ? `it is the strongest fit when you want the lowest likely maternity-related out-of-pocket exposure in an eligible Kaiser state`
      : `pregnancy usually makes lower deductible and out-of-pocket exposure matter more, and Kaiser is the strongest maternity-cost starting point in an eligible state`;
  } else if (pregnancySignal && householdSignal) {
    recommendationPlan = 'Enhanced HSA';
    recommendationReason = lowestOutOfPocketSignal
      ? `it is the stronger fit when you want lower maternity-related out-of-pocket exposure but Kaiser is not available`
      : `pregnancy usually makes lower deductible and out-of-pocket exposure matter more, so Enhanced HSA is usually the safer non-Kaiser option`;
  } else if (usageBand === 'high' || usageBand === 'moderate') {
    recommendationPlan = 'Enhanced HSA';
    recommendationReason = lowestOutOfPocketSignal
      ? `it is the better fit when your main goal is lower out-of-pocket exposure rather than the lowest premium`
      : `the lower deductible and stronger cost protection usually matter more once you expect regular care`;
  } else if (mentionsIntegratedNetworkPreference && kaiser && session.userState && isKaiserEligibleState(session.userState)) {
    recommendationPlan = 'Kaiser Standard HMO';
    recommendationReason = `it gives you the integrated HMO-style experience some people prefer when they want a tighter, coordinated network`;
  } else if (singleSignal || healthySignal || savingsSignal) {
    recommendationPlan = 'Standard HSA';
    recommendationReason = `it is usually the better fit when you want to keep monthly premium lower and do not expect much care`;
  }

  let msg = `Recommendation for ${coverageTier} coverage:\n\n`;
  if (!session.noPricingMode) {
    for (const r of filtered) {
      msg += `- ${r.plan}: $${pricingUtils.formatMoney(r.perMonth)}/month ($${pricingUtils.formatMoney(r.perPaycheck)} per paycheck)\n`;
    }
    msg += `\n`;
  }

  msg += `**My recommendation: ${recommendationPlan}.**\n\n`;
  msg += `**Why:** ${recommendationReason}.\n`;
  msg += `- Both HSA plans use the BCBSTX nationwide PPO network\n`;
  msg += `- **Standard HSA** is the lower-premium option\n`;
  msg += `- **Enhanced HSA** gives you a lower deductible and stronger cost protection if you expect more care\n`;

  if (kaiser && session.userState && isKaiserEligibleState(session.userState)) {
    msg += `- If you prefer an integrated HMO-style network and are in ${session.userState}, **Kaiser Standard HMO** is also an option\n`;
  }

  msg += `\n**HSA savings highlights:**\n- Pre-tax paycheck contributions\n- Tax-free growth and withdrawals for eligible care\n- Funds roll over year to year\n`;
  if (singleSignal) {
    msg += `\nSince you mentioned being single/only covering yourself, **Standard HSA** is typically the most cost-efficient starting point.`;
  }
  if (usageBand === 'high' || usageBand === 'moderate') {
    msg += `\nBecause you described more than minimal usage, **Enhanced HSA** is the one I would look at first.`;
  }
  if (lowestOutOfPocketSignal) {
    msg += recommendationPlan === 'Kaiser Standard HMO'
      ? `\nBecause you asked specifically about the lowest out-of-pocket exposure, **Kaiser Standard HMO** is the one I would look at first.`
      : `\nBecause you asked specifically about the lowest out-of-pocket exposure, **Enhanced HSA** is the one I would look at first.`;
  }
  if (pregnancySignal && householdSignal && !lowestOutOfPocketSignal) {
    msg += recommendationPlan === 'Kaiser Standard HMO'
      ? `\nBecause pregnancy is already part of the picture, I am treating maternity cost exposure as a main factor instead of defaulting to the cheapest premium.`
      : `\nBecause pregnancy is already part of the picture, I am treating maternity cost exposure as a main factor instead of defaulting to the cheapest premium.`;
  }

  msg += `\n\nIf you want, I can compare the likely total annual cost for **Standard HSA** versus **Enhanced HSA** based on your expected usage.`;
  return msg.trim();
}
