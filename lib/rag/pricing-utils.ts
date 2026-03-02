// Pricing utilities for server-side deterministic calculations and normalization
const COVERAGE_MULTIPLIERS: Record<string, number> = {
  'employee only': 1,
  'employee + spouse': 1.8,
  'employee + child': 1.5,
  'employee + children': 1.5,
  'employee + family': 2.5,
};

// Base monthly premiums (employee only) - keep in sync with components/cost-calculator.tsx
const BASE_MONTHLY_PREMIUMS: Record<string, number> = {
  'HSA High Deductible': 250,
  'PPO Standard': 400,
  'PPO Premium': 500,
  'Kaiser HMO': 300,
};

const PLAN_META: Record<string, { deductible: number; outOfPocketMax: number }> = {
  'HSA High Deductible': { deductible: 3500, outOfPocketMax: 7000 },
  'PPO Standard': { deductible: 1000, outOfPocketMax: 5000 },
  'PPO Premium': { deductible: 500, outOfPocketMax: 3000 },
  'Kaiser HMO': { deductible: 0, outOfPocketMax: 3500 },
};

export function normalizeCoverageToken(token: string | null): string {
  if (!token) return 'Employee Only';
  const lower = token.toLowerCase();
  for (const k of Object.keys(COVERAGE_MULTIPLIERS)) {
    if (lower.includes(k)) return k; // Return the key as-is (lowercase)
  }
  return 'Employee Only';
}

export function monthlyPremiumForPlan(planName: string, coverageTier: string = 'Employee Only'): number | null {
  const base = BASE_MONTHLY_PREMIUMS[planName];
  if (typeof base === 'undefined') return null;
  // Normalize coverage tier to lowercase for lookup
  const tierKey = (coverageTier || 'employee only').toLowerCase();
  const mult = COVERAGE_MULTIPLIERS[tierKey] ?? 1;
  return Math.round(base * mult);
}

export function annualFromMonthly(monthly: number): number {
  return Math.round(monthly * 12);
}

export function perPaycheckFromMonthly(monthly: number, payPeriods: number = 24): number {
  const annual = monthly * 12;
  return Math.round(annual / payPeriods);
}

// Build a deterministic per-paycheck breakdown for all standard plans
export function buildPerPaycheckBreakdown(coverageTier: string, payPeriods: number = 24) {
  const rows: Array<{ plan: string; perPaycheck: number; perMonth: number; annually: number }> = [];
  for (const plan of Object.keys(BASE_MONTHLY_PREMIUMS)) {
    const perMonth = monthlyPremiumForPlan(plan, coverageTier) ?? 0;
    const annually = annualFromMonthly(perMonth);
    const perPay = perPaycheckFromMonthly(perMonth, payPeriods);
    rows.push({ plan, perPaycheck: perPay, perMonth, annually });
  }
  return rows;
}

// Given a decisionsTracker (category -> {status,value}), sum known monthly premiums
export function computeTotalMonthlyFromSelections(decisionsTracker: Record<string, any>, coverageTier: string = 'Employee Only') {
  if (!decisionsTracker) return 0;
  let total = 0;
  for (const [category, entry] of Object.entries(decisionsTracker)) {
    if (!entry || entry.status !== 'selected') continue;
    const planName = (entry.value || '').toString();
    const monthly = monthlyPremiumForPlan(planName, coverageTier);
    if (monthly) total += monthly;
  }
  return Math.round(total);
}

// Normalize pricing mentions in an LLM answer: ensure monthly-first and include annual
export function normalizePricingInText(text: string, payPeriods: number = 24): string {
  let result = text;
  // Find explicit annual-only mentions like "$1,924.32 annually" and convert
  const annualRegex = /\$([\d,]+(?:\.\d{1,2})?)\s*(?:per year|annually|\/year|per annum)/gi;
  result = result.replace(annualRegex, (m, g1) => {
    const annual = parseFloat(g1.replace(/,/g, ''));
    if (isNaN(annual)) return m;
    const monthly = Math.round(annual / 12);
    return `$${monthly} per month ($${annual.toLocaleString('en-US')}/year)`;
  });

  // Find per-month mentions with decimals and normalize to integer dollars and add annual
  const monthRegex = /\$([\d,]+(?:\.\d{1,2})?)\s*(?:per month|monthly|\/month)/gi;
  result = result.replace(monthRegex, (m, g1) => {
    const monthly = Math.round(parseFloat(g1.replace(/,/g, '')));
    const annual = Math.round(monthly * 12);
    return `$${monthly} per month ($${annual.toLocaleString('en-US')} annually)`;
  });

  // Normalize per-paycheck mentions to show per-paycheck + per-month + annual
  const ppRegex = /\$([\d,]+(?:\.\d{1,2})?)\s*(?:per pay(?:check|period)|per pay)/gi;
  result = result.replace(ppRegex, (m, g1) => {
    const perPay = Math.round(parseFloat(g1.replace(/,/g, '')));
    const annual = Math.round(perPay * payPeriods);
    const monthly = Math.round(annual / 12);
    return `$${perPay} per paycheck ($${monthly} per month / $${annual} annually)`;
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
      // Remove or replace the state mention to avoid confusion
      result = result.replace(re, userStateName || userStateCode);
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
  const { coverageTier, usage, network, state, age } = params;
  // Base premiums
  const rows = buildPerPaycheckBreakdown(coverageTier, 24);
  let msg = `Projected costs for ${coverageTier} coverage`;
  if (network) msg += ` on the ${network} network`;
  if (state) msg += ` (state: ${state})`;
  msg += ` with ${usage} usage:\n`;

  // Usage factors roughly correspond to % of deductible
  const usageFactor = usage === 'low' ? 0.25 : usage === 'high' ? 0.75 : 0.5;

  for (const r of rows) {
    const meta = PLAN_META[r.plan] || { deductible: 0, outOfPocketMax: 0 };
    const expectedOOP = Math.round(meta.deductible * usageFactor + (meta.outOfPocketMax - meta.deductible) * usageFactor * 0.2);
    msg += `- ${r.plan}: premium $${r.perMonth}/month, expected out-of-pocket ~$${expectedOOP} for ${usage} usage\n`;
  }

  msg += `\nThese are rough estimates. Actual costs depend on claims and network access.`;
  if (network && network.toLowerCase().includes('kaiser') && state && !['CA','OR','WA'].includes((state||'').toUpperCase())) {
    msg += `\nNote: Kaiser network is not available in ${state}, so those rows may not apply.`;
  }
  return msg;
}

// Compare maternity exposure across plans (assumes typical $10k maternity cost)
export function compareMaternityCosts(coverageTier: string): string {
  const typical = 10000;
  let msg = `Maternity cost comparison (${coverageTier}):\n\n`;
  msg += `**Assumptions:** Typical maternity care costs ~$10,000 (prenatal visits, delivery, postnatal care)\n\n`;
  
  for (const plan of Object.keys(PLAN_META)) {
    const meta = PLAN_META[plan];
    const afterDeductible = Math.max(0, typical - meta.deductible);
    // assume 20% coinsurance on amount above deductible
    const coinsurance = Math.round(afterDeductible * 0.2);
    const totalOOP = meta.deductible + coinsurance;
    
    // Cap at out-of-pocket max
    const cappedOOP = Math.min(totalOOP, meta.outOfPocketMax);
    
    // Get premium for this tier
    const monthlyPremium = monthlyPremiumForPlan(plan, coverageTier) || 0;
    const annualPremium = annualFromMonthly(monthlyPremium);
    
    msg += `**${plan}:**\n`;
    msg += `• Estimated out-of-pocket: **$${cappedOOP.toLocaleString()}**\n`;
    msg += `  - Deductible: $${meta.deductible.toLocaleString()}\n`;
    msg += `  - Coinsurance (20%): $${coinsurance.toLocaleString()}\n`;
    msg += `  - Out-of-pocket max: $${meta.outOfPocketMax.toLocaleString()}\n`;
    msg += `• Annual premium: **$${annualPremium.toLocaleString()}** ($${monthlyPremium}/month)\n`;
    msg += `• **Total estimated cost:** $${(cappedOOP + annualPremium).toLocaleString()}\n\n`;
  }
  
  msg += `**Key Considerations for Maternity:**\n`;
  msg += `• **PPO Premium** typically offers lowest out-of-pocket for high-usage scenarios\n`;
  msg += `• **HSA plans** let you use pre-tax dollars for qualified medical expenses\n`;
  msg += `• **Kaiser HMO** (if available) provides integrated prenatal/postnatal care\n`;
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
};
