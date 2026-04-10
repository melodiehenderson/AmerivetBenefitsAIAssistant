import type { Session } from '@/lib/rag/session-store';
import pricingUtils from '@/lib/rag/pricing-utils';
import { amerivetBenefits2024_2025, KAISER_AVAILABLE_STATE_CODES, type BenefitPlan } from '@/lib/data/amerivet';
import {
  buildKaiserAvailabilityStatement,
  KAISER_ELIGIBILITY_SHORT,
  KAISER_STATES_PLAIN,
} from '@/lib/qa/facts';

const KAISER_STATES = new Set<string>(KAISER_AVAILABLE_STATE_CODES);

type KaiserUnavailableVariant = 'compare' | 'pricing' | 'redirect';

function inferCoverageTierFromQuery(query: string, session: Session): string {
  const low = query.toLowerCase();
  if (/\bchild\b|children|kid|dependent\s+child/i.test(low)) return 'Employee + Child(ren)';
  if (/employee\s*\+\s*family|family\s*(of|plan|coverage)|for\s*(my|the|our)\s*family/i.test(low)) return 'Employee + Family';
  if (/employee\s*\+\s*spouse|spouse|husband|wife|partner/i.test(low)) return 'Employee + Spouse';
  if (/employee\s*\+\s*child|child(?:ren)?\s*coverage|for\s*(my|the)\s*(kid|child|son|daughter)|dependent\s*child/i.test(low)) return 'Employee + Child(ren)';
  if (/employee\s*only|individual|single|just\s*me|only\s*me/i.test(low)) return 'Employee Only';
  return session.coverageTierLock || 'Employee Only';
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
    return `${buildKaiserAvailabilityStatement().replace(' through AmeriVet.', '.')} Since you're in ${stateLabel}, your medical plan options are **Standard HSA** and **Enhanced HSA**. Would you like pricing for those?`;
  }
  if (variant === 'redirect') {
    const nyNote = stateLabel === 'NY'
      ? `\n\nFor New York employees, the strongest alternative is **Enhanced HSA** on the BCBSTX nationwide PPO network if you want richer coverage.`
      : '';
    return `Kaiser is only available in ${KAISER_STATES_PLAIN}. In ${stateLabel}, your medical options are:\n\n- Standard HSA (BCBS of Texas) ΓÇö lower premium, higher deductible, full HSA contribution eligible\n- Enhanced HSA (BCBS of Texas) ΓÇö higher premium, lower deductible, better for anticipated medical use\n\nBoth use the nationwide BCBSTX PPO network.${nyNote} Would you like a side-by-side comparison?`;
  }
  return `${buildKaiserAvailabilityStatement().replace(' through AmeriVet.', '.')} Since you're in ${stateLabel}, your medical options are **Standard HSA** and **Enhanced HSA**. Would you like to compare those two instead?`;
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
  return { payPeriods, rows, baseRows, filtered };
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
      msg += `\nNote: Kaiser Standard HMO is only available in ${KAISER_ELIGIBILITY_SHORT}. Since you are in ${session.userState}, it may not be available.`;
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
  const recommendationSignal = /\b(recommendation|recommend|suggest|best\s+plan|best\s+option|which\s+plan|what\s+plan|what\s+do\s+you\s+recommend)\b/i.test(lower);
  const healthySignal = /\b(healthy|low\s+utilization|low\s+use|low\s+usage|rarely\s+(?:go|use))\b/i.test(lower);
  const singleSignal = /\b(single|individual|just\s+me|only\s+me|no\s+dependents|no\s+kids|no\s+children)\b/i.test(lower);
  const savingsSignal = /\b(save\s+money|low\s+cost|cheapest|lowest\s+premium|save\s+on\s+premiums|budget)\b/i.test(lower);

  if (!(recommendationSignal || healthySignal || savingsSignal)) return null;

  const coverageTier = inferCoverageTierFromQuery(query, session);
  const { filtered } = getFilteredMedicalPricingRows(session, coverageTier);

  const standard = filtered.find(r => /standard\s+hsa/i.test(r.plan));
  const enhanced = filtered.find(r => /enhanced\s+hsa/i.test(r.plan));
  const kaiser = filtered.find(r => /kaiser/i.test(r.plan));
  if (!standard && !enhanced && filtered.length === 0) return null;

  let msg = `Recommendation for ${coverageTier} coverage:\n\n`;
  if (!session.noPricingMode) {
    for (const r of filtered) {
      msg += `- ${r.plan}: $${pricingUtils.formatMoney(r.perMonth)}/month ($${pricingUtils.formatMoney(r.perPaycheck)} per paycheck)\n`;
    }
    msg += `\n`;
  }

  msg += `If you are healthy and want to keep premiums low, **Standard HSA** is usually the best fit because it has the lowest premium and is HSA-eligible. `;
  msg += `Both HSA plans use the BCBSTX nationwide PPO network. `;
  msg += `If you expect more medical use or want a lower deductible, **Enhanced HSA** offers richer coverage at a higher premium.`;

  if (kaiser && session.userState && isKaiserEligibleState(session.userState)) {
    msg += ` If you prefer an integrated HMO-style network and are in ${session.userState}, **Kaiser Standard HMO** is also an option.`;
  }

  msg += `\n\nHSA savings highlights:\n- Pre-tax paycheck contributions\n- Tax-free growth and withdrawals for eligible care\n- Funds roll over year to year\n`;
  if (singleSignal) {
    msg += `\nSince you mentioned being single/only covering yourself, the Standard HSA is typically the most cost-efficient starting point.`;
  }

  msg += `\n\nWant me to compare total annual costs if your usage is low, moderate, or high?`;
  return msg.trim();
}
