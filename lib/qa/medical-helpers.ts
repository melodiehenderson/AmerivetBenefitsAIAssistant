import type { Session } from '@/lib/rag/session-store';
import pricingUtils from '@/lib/rag/pricing-utils';
import { amerivetBenefits2024_2025, KAISER_AVAILABLE_STATE_CODES, type BenefitPlan } from '@/lib/data/amerivet';

const KAISER_STATES = new Set<string>(KAISER_AVAILABLE_STATE_CODES);

type KaiserUnavailableVariant = 'compare' | 'pricing' | 'redirect';

const CHILD_NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

function mentionsSpouseLike(query: string): boolean {
  return /\b(spouse|wife|husband|partner|married|get(?:ting)? married|marriage|fianc(?:e|ee))\b/i.test(query);
}

function mentionsChildLike(query: string): boolean {
  return /\b(kids?|children|sons?|daughters?|child(?:ren)?|dependent\s*child|me\s*\+\s*\d+\s*kids?)\b/i.test(query)
    || /\b(single\s+(?:mom|dad))\b/i.test(query);
}

function extractChildCountFromQuery(query: string): number | null {
  const numericMatches = Array.from(query.matchAll(/\b(\d+)\s+(kids?|children|sons?|daughters?)\b/gi))
    .map((match) => Number(match[1]));
  const wordMatches = Array.from(query.matchAll(/\b(one|two|three|four|five|six)\s+(kids?|children|sons?|daughters?)\b/gi))
    .map((match) => CHILD_NUMBER_WORDS[match[1].toLowerCase()] || 0);
  const counts = [...numericMatches, ...wordMatches].filter((count) => Number.isFinite(count) && count > 0);

  if (counts.length > 0) {
    return Math.max(...counts);
  }

  if (/\b(single\s+(?:mom|dad)|my\s+kids|our\s+kids|for\s+my\s+kids|for\s+our\s+kids|employee\s*\+\s*children?)\b/i.test(query)) {
    return 1;
  }

  return null;
}

function inferCoverageTierFromSession(session: Session): string | null {
  const hasSpouse = Boolean(session.familyDetails?.hasSpouse)
    || (session.lifeEvents || []).includes('marriage');
  const numChildren = session.familyDetails?.numChildren || 0;

  if (hasSpouse && numChildren > 0) return 'Employee + Family';
  if (hasSpouse) return 'Employee + Spouse';
  if (numChildren > 0) return 'Employee + Child(ren)';
  return null;
}

function extractExplicitCoverageTierFromQuery(query: string): string | null {
  const low = query.toLowerCase();

  if (/\b(employee\s*\+\s*family|family\s+coverage|family\s+plan|family\s+pricing|whole\s+family|for\s+the\s+whole\s+family)\b/i.test(low)) {
    return 'Employee + Family';
  }

  if (/\b(employee\s*\+\s*spouse|spouse\s+coverage|spouse\s+pricing|just\s+me\s+and\s+(?:my\s+)?(?:spouse|partner|wife|husband)|me\s+and\s+my\s+(?:spouse|partner|wife|husband))\b/i.test(low)) {
    return 'Employee + Spouse';
  }

  if (/\b(employee\s*\+\s*child(?:ren)?|employee\s*\+\s*\d+\s*kids?|employee\s*\+\s*(?:one|two|three|four|five|six)\s+kids?|child(?:ren)?\s+coverage|child(?:ren)?\s+pricing|just\s+me\s+and\s+(?:the\s+)?(?:\d+|one|two|three|four|five|six)\s+(?:kids?|children)|just\s+me\s+and\s+my\s+kids|me\s+and\s+the\s+kids)\b/i.test(low)) {
    return 'Employee + Child(ren)';
  }

  if (/\b(employee\s*only|just\s*me|only\s*me|no\s+dependents?)\b/i.test(low)) {
    return 'Employee Only';
  }

  return null;
}

function inferCoverageTierFromQuery(query: string, session: Session): string {
  const low = query.toLowerCase();
  const explicitTier = extractExplicitCoverageTierFromQuery(low);
  const hasSpouseMention = mentionsSpouseLike(low);
  const explicitChildCount = extractChildCountFromQuery(low);
  const hasChildMention = explicitChildCount !== null || mentionsChildLike(low);
  const sessionTier = inferCoverageTierFromSession(session) || session.coverageTierLock || null;
  const hasGenericFamilyMention = /\bfamily\s*4\+|\bfamily4\+|\b(employee\s*\+\s*family|family\s*(?:of|plan|coverage)|for\s*(?:my|the|our)\s*family)\b/i.test(low);

  if (explicitTier) {
    return explicitTier;
  }

  if (hasSpouseMention && hasChildMention) {
    return 'Employee + Family';
  }

  if (/\b(employee\s*\+\s*spouse|spouse\s+coverage|for\s+my\s+spouse|for\s+our\s+spouse)\b/i.test(low) || hasSpouseMention) {
    return 'Employee + Spouse';
  }

  if (/\b(employee\s*\+\s*child(?:ren)?|employee\s*\+\s*\d+\s*kids?|child(?:ren)?\s*coverage|for\s*(?:my|the|our)\s*(?:kids?|child|son|daughter)|dependent\s*child|me\s*(?:and|plus|\+)\s*(?:my\s+)?kids?)\b/i.test(low) || hasChildMention) {
    return 'Employee + Child(ren)';
  }

  if (hasGenericFamilyMention) {
    if (sessionTier) {
      return sessionTier;
    }
    return 'Employee + Family';
  }

  if (/\b(employee\s*only|individual|just\s*me|only\s*me)\b/i.test(low)) {
    return 'Employee Only';
  }

  return sessionTier || 'Employee Only';
}

function getUserConversationText(session: Session): string {
  return (session.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content.toLowerCase())
    .join('\n');
}

export function sessionHasPregnancySignal(session: Session, query: string): boolean {
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

function shouldIgnoreSelectedPlanBias(query: string): boolean {
  return /\b(should\s+(?:we|i)\s+switch|switch\s+from\s+(?:the\s+)?(?:standard|enhanced|kaiser)|make\s+the\s+case\s+for\s+(?:the\s+)?(?:standard|enhanced|kaiser)|sell\s+me\s+on\s+(?:the\s+)?(?:standard|enhanced|kaiser)|talk\s+me\s+into\s+(?:the\s+)?(?:standard|enhanced|kaiser)|i\s+know\s+i\s+said\s+(?:standard|enhanced|kaiser)|instead\s+of\s+(?:standard|enhanced|kaiser)|rather\s+than\s+(?:standard|enhanced|kaiser)|don'?t\s+want\s+(?:standard|enhanced|kaiser)|do\s+not\s+want\s+(?:standard|enhanced|kaiser)|not\s+(?:standard|enhanced|kaiser)|which\s+(?:one|medical\s+plan|plan)\s+is\s+better|what\s+(?:medical\s+)?plan\s+is\s+better)\b/i.test(query)
    || (
      /\b(which\s+(?:one|medical\s+plan|plan)|what\s+(?:medical\s+)?plan)\b/i.test(query)
      && /\b(expect|care|specialist|prescription|usage|visit|visits)\b/i.test(query)
    );
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
  const recommendationSignal = /\b(recommendation|recommend|suggest|best\s+plan|best\s+option|which\s+plan|what\s+plan|what\s+do\s+you\s+recommend|what[’']?s\s+best\s+for\s+me|how\s+do\s+i\s+decide(?:\s+which\s+one)?|help\s+me\s+choose|which\s+one\s+is\s+best|which\s+one\s+is\s+better|make\s+the\s+case\s+for|sell\s+me\s+on|talk\s+me\s+into|should\s+(?:we|i)\s+switch|is\s+(?:enhanced|standard|kaiser)\s+worth)\b/i.test(lower);
  const healthySignal = /\b(healthy|low\s+utilization|low\s+use|low\s+usage|rarely\s+(?:go|use))\b/i.test(lower);
  const singleSignal = /\b(single|individual|just\s+me|only\s+me|no\s+dependents|no\s+kids|no\s+children)\b/i.test(lower);
  const savingsSignal = /\b(save\s+money|low\s+cost|cheapest|lowest\s+premium|save\s+on\s+premiums|budget)\b/i.test(lower);
  const lowestOutOfPocketSignal = /\b(lowest|least)\s+out[- ]of[- ]pocket|\blowest\s+oop|\bminimi[sz]e\s+out[- ]of[- ]pocket\b/i.test(lower);
  const higherUsageSignal = /\b(high\s+usage|high\s+utilization|frequent\s+(?:doctor|specialist|care|visits?)|regular\s+(?:care|visits?)|ongoing\s+care|chronic|ongoing\s+prescriptions?|a\s+lot\s+of\s+care|expect(?:ing)?\s+a\s+lot\s+of\s+care|more\s+medical\s+use|heavy\s+usage|more\s+(?:doctor|specialist)\s+visits?|specialist\s+visits?|more\s+care|more\s+medical\s+care)\b/i.test(lower);
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
  const ignoreSelectedPlan = shouldIgnoreSelectedPlanBias(query);
  const explicitPressureTestPlan = /\b(make\s+the\s+case\s+for|sell\s+me\s+on|talk\s+me\s+into)\s+(?:the\s+)?(standard|enhanced|kaiser)\b/i.exec(lower)?.[2] || null;

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

  if (explicitPressureTestPlan === 'enhanced') {
    recommendationPlan = 'Enhanced HSA';
    recommendationReason = higherUsageSignal || lowestOutOfPocketSignal
      ? `that is the stronger fit once you expect more specialist visits, recurring care, or lower out-of-pocket exposure to matter`
      : `that is the specific option you asked me to pressure-test, so I am answering the strongest case for Enhanced HSA instead of defaulting back to the old lean`;
  } else if (explicitPressureTestPlan === 'standard') {
    recommendationPlan = 'Standard HSA';
    recommendationReason = `that is the option you asked me to pressure-test, so the question becomes whether keeping premium lower matters more than stronger deductible protection`;
  } else if (explicitPressureTestPlan === 'kaiser') {
    recommendationPlan = 'Kaiser Standard HMO';
    recommendationReason = `that is the option you asked me to pressure-test, so the real question is whether the integrated Kaiser network is the main thing you want`;
  } else if (
    selectedPlan
    && /Standard HSA|Enhanced HSA|Kaiser Standard HMO/i.test(selectedPlan)
    && !ignoreSelectedPlan
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
