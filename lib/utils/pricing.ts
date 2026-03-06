/**
 * lib/utils/pricing.ts
 *
 * Calculation helpers — DO NOT let the AI do math.
 * All rate normalisation happens here before the LLM sees a single number.
 *
 * Rule: If the source catalog stores an ANNUAL rate, call annualToMonthly()
 * before embedding the value in any prompt or deterministic response.
 */

// Re-export low-level formatter so callers only need one import path.
export { formatMoney } from '@/lib/rag/pricing-utils';

// ─── Core normalisation helpers ───────────────────────────────────────────────

/**
 * Convert an annual premium to a monthly premium.
 * Rounds to 2 decimal places.
 *
 * @example annualToMonthly(1200) → 100.00
 */
export function annualToMonthly(annualRate: number): number {
  return Math.round((annualRate / 12) * 100) / 100;
}

/**
 * Convert a per-paycheck amount to monthly, given pay periods per year.
 * Default is 26 bi-weekly pay periods.
 *
 * @example paycheckToMonthly(46.15, 26) → 100.00
 */
export function paycheckToMonthly(perPaycheck: number, payPeriods: number = 26): number {
  return Math.round(((perPaycheck * payPeriods) / 12) * 100) / 100;
}

/**
 * Format a monthly dollar amount for display.
 * Always returns the canonical "$X.XX/month" string.
 *
 * @example formatMonthly(100) → "$100.00/month"
 */
export function formatMonthly(monthlyRate: number): string {
  return `$${monthlyRate.toFixed(2)}/month`;
}

/**
 * Normalise ANY rate to monthly and return a display string.
 * Accepts either an annual or per-paycheck source.
 *
 * @example normaliseToMonthly({ annual: 1200 }) → "$100.00/month"
 * @example normaliseToMonthly({ perPaycheck: 46.15, payPeriods: 26 }) → "$100.00/month"
 */
export function normaliseToMonthly(
  source:
    | { annual: number }
    | { perPaycheck: number; payPeriods?: number }
    | { monthly: number }
): string {
  if ('monthly' in source) {
    return formatMonthly(source.monthly);
  }
  if ('annual' in source) {
    return formatMonthly(annualToMonthly(source.annual));
  }
  const payPeriods = source.payPeriods ?? 26;
  return formatMonthly(paycheckToMonthly(source.perPaycheck, payPeriods));
}

// ─── STD / Short-Term Disability Benefit Calculator ──────────────────────────
// IRS + UNUM STD rules: benefit = base salary × coverage percentage.
// This is deterministic math — NEVER let the LLM calculate this.

export interface STDBenefitResult {
  monthlySalary: number;
  weeklySalary: number;
  weeklyBenefit: number;
  monthlyBenefit: number;
  percentage: number;
}

/**
 * Calculate Short-Term Disability benefit amounts.
 *
 * @param monthlySalary  Gross monthly salary in dollars
 * @param percentage     STD coverage percentage (default 0.60 = 60%)
 * @returns Breakdown of weekly/monthly salary and benefit amounts
 *
 * @example calculateSTDBenefit(5000)
 *   → { monthlySalary: 5000, weeklySalary: 1154.73, weeklyBenefit: 692.84,
 *       monthlyBenefit: 3000, percentage: 0.60 }
 */
export function calculateSTDBenefit(
  monthlySalary: number,
  percentage: number = 0.60,
): STDBenefitResult {
  const weeklySalary   = Math.round((monthlySalary / 4.33) * 100) / 100;
  const weeklyBenefit  = Math.round((weeklySalary * percentage) * 100) / 100;
  const monthlyBenefit = Math.round((monthlySalary * percentage) * 100) / 100;
  return { monthlySalary, weeklySalary, weeklyBenefit, monthlyBenefit, percentage };
}

/**
 * Format an STDBenefitResult into a human-readable string for deterministic responses.
 */
export function formatSTDBenefit(result: STDBenefitResult): string {
  const pct = Math.round(result.percentage * 100);
  return [
    `Monthly salary: $${result.monthlySalary.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Weekly salary: $${result.weeklySalary.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ($${result.monthlySalary.toLocaleString()} ÷ 4.33)`,
    `UNUM STD at ${pct}%: $${result.weeklyBenefit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/week — $${result.monthlyBenefit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/month`,
  ].join('\n');
}

// ─── City → State resolver (No-Loop Rule support) ────────────────────────────

const CITY_STATE_MAP: Record<string, string> = {
  'chicago': 'IL',
  'los angeles': 'CA', 'san francisco': 'CA', 'san diego': 'CA', 'sacramento': 'CA',
  'new york': 'NY', 'new york city': 'NY', 'nyc': 'NY', 'brooklyn': 'NY',
  'houston': 'TX', 'dallas': 'TX', 'austin': 'TX', 'san antonio': 'TX', 'fort worth': 'TX',
  'phoenix': 'AZ', 'tucson': 'AZ', 'scottsdale': 'AZ',
  'philadelphia': 'PA', 'pittsburgh': 'PA',
  'miami': 'FL', 'orlando': 'FL', 'tampa': 'FL', 'jacksonville': 'FL',
  'seattle': 'WA', 'tacoma': 'WA', 'spokane': 'WA',
  'portland': 'OR', 'eugene': 'OR',
  'denver': 'CO', 'boulder': 'CO', 'colorado springs': 'CO',
  'las vegas': 'NV', 'reno': 'NV',
  'minneapolis': 'MN', 'saint paul': 'MN',
  'atlanta': 'GA', 'savannah': 'GA',
  'boston': 'MA', 'worcester': 'MA',
  'detroit': 'MI', 'grand rapids': 'MI',
  'charlotte': 'NC', 'raleigh': 'NC', 'durham': 'NC',
  'nashville': 'TN', 'memphis': 'TN',
  'louisville': 'KY', 'lexington': 'KY',
  'columbus': 'OH', 'cleveland': 'OH', 'cincinnati': 'OH',
  'indianapolis': 'IN',
  'milwaukee': 'WI', 'madison': 'WI',
  'kansas city': 'MO', 'st. louis': 'MO',
  'omaha': 'NE', 'lincoln': 'NE',
  'albuquerque': 'NM', 'santa fe': 'NM',
  'salt lake city': 'UT',
  'richmond': 'VA', 'norfolk': 'VA',
  'baltimore': 'MD',
  'washington': 'DC', 'washington dc': 'DC',
};

/**
 * If {User_City} is provided but {User_State} is missing, resolve to State.
 * Returns { state, filled: true } on match, or { state: null, filled: false }.
 *
 * @example resolveStateFromCity('Chicago') → { state: 'IL', filled: true }
 */
export function resolveStateFromCity(
  city: string
): { state: string; filled: true } | { state: null; filled: false } {
  const normalised = city.trim().toLowerCase();
  const state = CITY_STATE_MAP[normalised];
  if (state) return { state, filled: true };
  return { state: null, filled: false };
}
