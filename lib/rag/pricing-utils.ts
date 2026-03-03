// Pricing utilities for server-side deterministic calculations and normalization.
// IMPORTANT: Use the canonical AmeriVet plan catalog as the source of truth.
// This avoids drift between the chat, admin analytics, and the cost comparison tool.

import { amerivetBenefits2024_2025, type BenefitPlan, type BenefitTier } from '@/lib/data/amerivet';

const DEFAULT_PAY_PERIODS = 26; // biweekly

const moneyFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return moneyFmt.format(safe);
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function normalizePlanToken(input: string): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9+ ]/g, '')
    .trim();
}

const ALL_PLANS: BenefitPlan[] = [
  ...amerivetBenefits2024_2025.medicalPlans,
  amerivetBenefits2024_2025.dentalPlan,
  amerivetBenefits2024_2025.visionPlan,
  ...amerivetBenefits2024_2025.voluntaryPlans,
];

const PLAN_BY_ID = new Map<string, BenefitPlan>(ALL_PLANS.map((p) => [p.id, p]));
const PLAN_BY_NAME = new Map<string, BenefitPlan>(
  ALL_PLANS.map((p) => [normalizePlanToken(p.name), p])
);

// Common aliases seen in UI copy, legacy code, and admin analytics.
const PLAN_ALIASES: Record<string, string> = {
  // HDHP/HSA
  'hsa high deductible': 'standard hsa',
  'standard hsa': 'standard hsa',
  'bcbstx standard hsa': 'standard hsa',
  'enhanced hsa': 'enhanced hsa',
  'bcbstx enhanced hsa': 'enhanced hsa',
  // Kaiser
  'kaiser hmo': 'kaiser standard hmo',
  'kaiser standard': 'kaiser standard hmo',
  'kaiser standard hmo': 'kaiser standard hmo',
  // PPO naming varies across artifacts; map generic "ppo" to the catalog PPO when present.
  // (If your catalog adds multiple PPO variants later, update this mapping.)
  'bcbstx ppo': 'standard hsa', // fallback: avoid hard failure; better than returning null
  'ppo standard': 'standard hsa',
};

function resolvePlan(planNameOrId: string): BenefitPlan | null {
  if (!planNameOrId) return null;

  const trimmed = planNameOrId.trim();
  const byId = PLAN_BY_ID.get(trimmed);
  if (byId) return byId;

  const norm = normalizePlanToken(trimmed);
  const alias = PLAN_ALIASES[norm] ?? norm;
  const direct = PLAN_BY_NAME.get(alias);
  if (direct) return direct;

  // Last-chance fuzzy match: if token contains a known plan name, pick that plan.
  for (const [nameKey, plan] of PLAN_BY_NAME.entries()) {
    if (alias.includes(nameKey)) return plan;
  }
  return null;
}

function normalizeCoverageTierToBenefitTier(token: string | null): BenefitTier {
  const lower = normalizeWhitespace((token || 'employee only').toLowerCase());
  if (/(employee\s*only|individual|single|just me|employee-only)/i.test(lower)) return 'employeeOnly';
  if (/(employee\s*\+\s*spouse|employee\s*spouse|emp\s*\+\s*spouse)/i.test(lower)) return 'employeeSpouse';
  if (/(employee\s*\+\s*child|employee\s*\+\s*children|employee\s*children|child\(ren\)|emp\s*\+\s*child)/i.test(lower)) {
    return 'employeeChildren';
  }
  if (/(employee\s*\+\s*family|employee\s*family|family)/i.test(lower)) return 'employeeFamily';
  return 'employeeOnly';
}

export function normalizeCoverageToken(token: string | null): string {
  const tier = normalizeCoverageTierToBenefitTier(token);
  switch (tier) {
    case 'employeeSpouse':
      return 'employee + spouse';
    case 'employeeChildren':
      return 'employee + child';
    case 'employeeFamily':
      return 'employee + family';
    case 'employeeOnly':
    default:
      return 'employee only';
  }
}

export function monthlyPremiumForPlan(planName: string, coverageTier: string = 'Employee Only'): number | null {
  const plan = resolvePlan(planName);
  if (!plan) return null;
  const tier = normalizeCoverageTierToBenefitTier(coverageTier);
  const amount = plan.tiers?.[tier];
  if (typeof amount !== 'number') return null;
  return Number(amount.toFixed(2));
}

export function annualFromMonthly(monthly: number): number {
  return Number((monthly * 12).toFixed(2));
}

export function perPaycheckFromMonthly(monthly: number, payPeriods: number = 24): number {
  const pp = payPeriods || DEFAULT_PAY_PERIODS;
  const annual = monthly * 12;
  return Number((annual / pp).toFixed(2));
}

// Build a deterministic per-paycheck breakdown for all standard plans
export function buildPerPaycheckBreakdown(coverageTier: string, payPeriods: number = 24) {
  const pp = payPeriods || DEFAULT_PAY_PERIODS;
  const tier = normalizeCoverageTierToBenefitTier(coverageTier);
  const rows: Array<{ plan: string; perPaycheck: number; perMonth: number; annually: number; planId: string; provider: string }> = [];

  // Deterministic ordering: medical plans first, then dental/vision.
  const plans = [
    ...amerivetBenefits2024_2025.medicalPlans,
    amerivetBenefits2024_2025.dentalPlan,
    amerivetBenefits2024_2025.visionPlan,
  ];

  for (const p of plans) {
    const perMonth = typeof p.tiers?.[tier] === 'number' ? Number(p.tiers[tier].toFixed(2)) : 0;
    const annually = annualFromMonthly(perMonth);
    const perPay = perPaycheckFromMonthly(perMonth, pp);
    rows.push({ plan: p.name, planId: p.id, provider: p.provider, perPaycheck: perPay, perMonth, annually });
  }
  return rows;
}

// Given a decisionsTracker (category -> {status,value}), sum known monthly premiums
export function computeTotalMonthlyFromSelections(decisionsTracker: Record<string, any>, coverageTier: string = 'Employee Only') {
  if (!decisionsTracker) return 0;
  let total = 0;
  for (const [category, entry] of Object.entries(decisionsTracker)) {
    // Session can store either a plain string or a DecisionEntry-like object.
    const e: any = entry;
    const status = typeof e === 'string' ? 'selected' : e?.status;
    if (status !== 'selected') continue;

    const value = typeof e === 'string' ? e : (e?.value ?? '');
    const planName = (value || '').toString();
    const monthly = monthlyPremiumForPlan(planName, coverageTier);
    if (typeof monthly === 'number' && Number.isFinite(monthly)) total += monthly;
  }
  return Number(total.toFixed(2));
}

// Normalize pricing mentions in an LLM answer: ensure monthly-first and include annual
export function normalizePricingInText(text: string, payPeriods: number = 24): string {
  let result = text;

  const pp = payPeriods || DEFAULT_PAY_PERIODS;

  const parseMoney = (raw: string): number | null => {
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  // Annual-only mentions → monthly + annual
  const annualRegex = /\$([\d,]+(?:\.\d{1,2})?)\s*(?:per year|annually|\/year|\/yr|per annum)/gi;
  result = result.replace(annualRegex, (m, g1) => {
    const annual = parseMoney(g1);
    if (annual === null) return m;
    const monthly = Number((annual / 12).toFixed(2));
    return `$${formatMoney(monthly)} per month ($${formatMoney(annual)} annually)`;
  });

  // Per-month mentions → ensure 2-decimals + annual
  const monthRegex = /\$([\d,]+(?:\.\d{1,2})?)\s*(?:per month|monthly|\/month|\/mo)/gi;
  result = result.replace(monthRegex, (m, g1) => {
    const monthly = parseMoney(g1);
    if (monthly === null) return m;
    const annual = Number((monthly * 12).toFixed(2));
    return `$${formatMoney(monthly)} per month ($${formatMoney(annual)} annually)`;
  });

  // Per-paycheck mentions → per-paycheck + per-month + annual
  const ppRegex = /\$([\d,]+(?:\.\d{1,2})?)\s*(?:per pay(?:check|period)?|per pay)\b/gi;
  result = result.replace(ppRegex, (m, g1) => {
    const perPay = parseMoney(g1);
    if (perPay === null) return m;
    const annual = Number((perPay * pp).toFixed(2));
    const monthly = Number((annual / 12).toFixed(2));
    return `$${formatMoney(perPay)} per paycheck ($${formatMoney(monthly)} per month / $${formatMoney(annual)} annually)`;
  });

  return result;
}

// Ensure state consistency: if answer mentions a US state different from userState, remove
const STATE_CODE_TO_NAME: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',
  IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
  ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
  MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
  TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',
  WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

export function ensureStateConsistency(answer: string, userStateCode: string | null): string {
  if (!userStateCode) return answer;
  const STATES = Object.values(STATE_CODE_TO_NAME);
  const userStateName = STATE_CODE_TO_NAME[userStateCode.toUpperCase()] || null;
  let result = answer;
  for (const s of STATES) {
    if (userStateName && s.toLowerCase() === userStateName.toLowerCase()) continue;
    const re = new RegExp(`\\b${s}\\b`, 'gi');
    if (re.test(result)) {
      // Replace other state mentions with a neutral phrase to avoid wrong geo guidance.
      result = result.replace(re, userStateName ? userStateName : 'your state');
    }
  }
  return result;
}

// Remove repeated words/phrases that appear consecutively multiple times.
// E.g., "Indiana, Indiana, and Indiana" becomes "Indiana".
export function cleanRepeatedPhrases(text: string): string {
  // simple regex: capture a word followed by comma/and and the same word at least once
  return text.replace(/\b(\w+)\b(?:,?\s*(?:and\s*)?\1\b)+/gi, '$1');
}

// Estimate projected annual healthcare cost given usage assumptions.
export type UsageLevel = 'low' | 'moderate' | 'high';
export interface CostProjectionParams {
  coverageTier: string;
  usage: UsageLevel;
  network?: string; // e.g. 'Kaiser'
  state?: string;
  age?: number;
}

export function estimateCostProjection(params: CostProjectionParams): string {
  const { coverageTier, usage, network, state } = params;
  const tier = normalizeCoverageTierToBenefitTier(coverageTier);

  let msg = `Projected costs for ${coverageTier} coverage`;
  if (network) msg += ` (network preference: ${network})`;
  if (state) msg += ` (state: ${state})`;
  msg += ` with ${usage} usage:\n`;

  // Rough usage factors correspond to % of deductible and some portion beyond.
  const usageFactor = usage === 'low' ? 0.25 : usage === 'high' ? 0.75 : 0.5;

  const plans = amerivetBenefits2024_2025.medicalPlans.filter((p) => {
    if (!network) return true;
    const n = network.toLowerCase();
    if (n.includes('kaiser')) return p.provider.toLowerCase().includes('kaiser');
    if (n.includes('bcbs') || n.includes('bcbstx')) return p.provider.toLowerCase().includes('bcbstx');
    return true;
  });

  for (const p of plans) {
    // Regional availability gate (only show Kaiser if user is in a supported region)
    if (state && p.provider.toLowerCase().includes('kaiser')) {
      const allowed = p.regionalAvailability.some((r) => r.toLowerCase() === 'california' || r.toLowerCase() === state.toLowerCase());
      if (!allowed && !p.regionalAvailability.includes('nationwide')) {
        continue;
      }
    }

    const monthlyPremium = typeof p.tiers[tier] === 'number' ? Number(p.tiers[tier].toFixed(2)) : 0;
    const annualPremium = annualFromMonthly(monthlyPremium);

    const deductible = p.benefits?.deductible ?? 0;
    const oopMax = p.benefits?.outOfPocketMax ?? 0;
    const coinsurance = p.benefits?.coinsurance ?? 0.2;

    const expectedOOPRaw = deductible * usageFactor + Math.max(0, oopMax - deductible) * usageFactor * coinsurance * 0.5;
    const expectedOOP = Number(Math.min(expectedOOPRaw, oopMax || expectedOOPRaw).toFixed(0));

    msg += `- ${p.name}: $${formatMoney(monthlyPremium)}/month ($${formatMoney(annualPremium)}/year) + expected out-of-pocket ~$${expectedOOP.toLocaleString()}\n`;
  }

  msg += `\nThese are rough estimates. Actual costs depend on claims, copays, network use, and covered services.`;
  return msg;
}

// Compare maternity exposure across plans (assumes typical $10k maternity cost)
export function compareMaternityCosts(coverageTier: string): string {
  const typical = 10000;
  const tier = normalizeCoverageTierToBenefitTier(coverageTier);
  let msg = `Maternity cost comparison (${coverageTier}):\n\n`;
  msg += `**Assumptions:** Typical maternity care costs ~$10,000 (prenatal visits, delivery, postnatal care).\n\n`;

  for (const p of amerivetBenefits2024_2025.medicalPlans) {
    const deductible = p.benefits?.deductible ?? 0;
    const oopMax = p.benefits?.outOfPocketMax ?? 0;
    const coins = p.benefits?.coinsurance ?? 0.2;

    const afterDeductible = Math.max(0, typical - deductible);
    const coinsurance = Math.round(afterDeductible * coins);
    const totalOOP = deductible + coinsurance;
    const cappedOOP = oopMax > 0 ? Math.min(totalOOP, oopMax) : totalOOP;

    const monthlyPremium = typeof p.tiers[tier] === 'number' ? Number(p.tiers[tier].toFixed(2)) : 0;
    const annualPremium = annualFromMonthly(monthlyPremium);
    const total = cappedOOP + annualPremium;

    msg += `**${p.name}:**\n`;
    msg += `• Estimated out-of-pocket: **$${cappedOOP.toLocaleString()}** (deductible $${deductible.toLocaleString()}, coinsurance ${(coins * 100).toFixed(0)}%)\n`;
    if (oopMax) msg += `  - Out-of-pocket max: $${oopMax.toLocaleString()}\n`;
    msg += `• Annual premium: **$${formatMoney(annualPremium)}** ($${formatMoney(monthlyPremium)}/month)\n`;
    msg += `• **Total estimated annual cost:** $${formatMoney(total)}\n\n`;
  }
  
  msg += `**Key Considerations for Maternity:**\n`;
  msg += `• Lower deductibles and out-of-pocket maximums generally reduce exposure for delivery\n`;
  msg += `• HSA-eligible plans can be attractive if you want to pay expenses with pre-tax dollars\n`;
  msg += `• Network availability matters (e.g., Kaiser only in certain regions)\n`;
  msg += `• Prenatal visits, delivery, and postnatal care all count toward your deductible and OOP max\n\n`;
  
  msg += `**Recommendation:** If you're planning a pregnancy, consider plans with lower deductibles and out-of-pocket maximums, even if premiums are higher.\n\n`;
  msg += `Lower OOP numbers indicate better maternity cost protection. Remember premiums vary by coverage tier.\n\n`;
  
  const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.htmld';
  msg += `**Next Steps:** You can review detailed maternity coverage in your [benefits enrollment portal](${enrollmentUrl}).`;
  
  return msg;
}
export default {
  monthlyPremiumForPlan,
  annualFromMonthly,
  perPaycheckFromMonthly,
  buildPerPaycheckBreakdown,
  computeTotalMonthlyFromSelections,
  normalizePricingInText,
  ensureStateConsistency,
  cleanRepeatedPhrases,
  estimateCostProjection,
  compareMaternityCosts,
  formatMoney,
};
