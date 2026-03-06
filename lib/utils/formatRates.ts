/**
 * Rate Normalization Utility
 *
 * Rule: The LLM extracts raw numbers; this module handles ALL math and formatting.
 * Never let the LLM do arithmetic on rates — it mixes annual/monthly/biweekly.
 */

export type RatePeriod = 'annual' | 'monthly' | 'biweekly' | 'weekly' | 'semimonthly';

const PAY_PERIODS: Record<RatePeriod, number> = {
  annual:      1,
  monthly:     12,
  semimonthly: 24,
  biweekly:    26,
  weekly:      52,
};

/**
 * Convert a raw rate from one period to another.
 *
 * @param raw     The raw numeric value (e.g. 3600)
 * @param from    The period the raw value represents (e.g. 'annual')
 * @param to      The target period (e.g. 'monthly')
 * @returns       The converted rate, rounded to 2 decimal places
 *
 * @example
 *   normalizeRate(3600, 'annual', 'monthly')   // → 300
 *   normalizeRate(300,  'monthly', 'biweekly') // → 138.46
 */
export function normalizeRate(raw: number, from: RatePeriod, to: RatePeriod): number {
  if (from === to) return raw;
  const annualValue = raw * PAY_PERIODS[from];   // convert to annual first
  const result      = annualValue / PAY_PERIODS[to];
  return Math.round(result * 100) / 100;
}

/**
 * Format a monthly rate as the canonical display string used throughout the app:
 *   "$X.XX/month ($Y.YY bi-weekly)"
 *
 * @param monthly  The monthly premium (already normalized)
 * @returns        Human-readable string with both monthly and bi-weekly amounts
 */
export function formatRateDisplay(monthly: number): string {
  const biweekly = normalizeRate(monthly, 'monthly', 'biweekly');
  return `$${monthly.toFixed(2)}/month ($${biweekly.toFixed(2)} bi-weekly)`;
}

/**
 * Parse and normalize a raw rate string from a document.
 *
 * Handles common patterns found in benefits PDFs:
 *   "$300/month"  → { value: 300, period: 'monthly' }
 *   "$3,600/year" → { value: 3600, period: 'annual' }
 *   "$138.46 per paycheck" → { value: 138.46, period: 'biweekly' }
 *
 * @param rateString  Raw string from a PDF/document
 * @returns           Parsed rate or null if pattern not recognized
 */
export function parseRateString(rateString: string): { value: number; period: RatePeriod } | null {
  const cleaned = rateString.replace(/,/g, '').trim();

  // Patterns ordered from most-specific to least-specific
  const patterns: Array<{ re: RegExp; period: RatePeriod }> = [
    { re: /\$?([\d.]+)\s*\/?\s*(per\s+)?(year|annual|yr)/i,       period: 'annual' },
    { re: /\$?([\d.]+)\s*\/?\s*(per\s+)?(month|mo)/i,             period: 'monthly' },
    { re: /\$?([\d.]+)\s*\/?\s*(per\s+)?(bi-?weekly|paycheck|pay period)/i, period: 'biweekly' },
    { re: /\$?([\d.]+)\s*\/?\s*(per\s+)?(semi-?monthly|twice.*month)/i, period: 'semimonthly' },
    { re: /\$?([\d.]+)\s*\/?\s*(per\s+)?week/i,                   period: 'weekly' },
  ];

  for (const { re, period } of patterns) {
    const m = cleaned.match(re);
    if (m) {
      const value = parseFloat(m[1]);
      if (!isNaN(value)) return { value, period };
    }
  }

  return null;
}

/**
 * Normalize a raw rate string to a monthly value.
 *
 * This is the main entry point for route handlers:
 *   normalizeToMonthly("$3,600/year")  // → 300
 *   normalizeToMonthly("$138.46/biweekly") // → 150.01
 *
 * Returns null if the string cannot be parsed.
 */
export function normalizeToMonthly(rateString: string): number | null {
  const parsed = parseRateString(rateString);
  if (!parsed) return null;
  return normalizeRate(parsed.value, parsed.period, 'monthly');
}

/**
 * Given a monthly premium, return a complete premium breakdown object.
 *
 * Useful for structured data responses where the UI may need all variants.
 */
export function buildPremiumBreakdown(monthly: number): {
  monthly:     number;
  annual:      number;
  biweekly:    number;
  semimonthly: number;
  displayString: string;
} {
  return {
    monthly,
    annual:      normalizeRate(monthly, 'monthly', 'annual'),
    biweekly:    normalizeRate(monthly, 'monthly', 'biweekly'),
    semimonthly: normalizeRate(monthly, 'monthly', 'semimonthly'),
    displayString: formatRateDisplay(monthly),
  };
}

/**
 * Replace all rate patterns in an LLM response with normalized equivalents.
 *
 * Use this as a post-processing pass on every LLM output to guarantee uniform
 * rate formatting before the response is returned to the user.
 *
 * @param text  Raw LLM response text
 * @returns     Text with all rates converted to "$X.XX/month ($Y.YY bi-weekly)" format
 */
export function normalizeRatesInText(text: string): string {
  // Pattern: any dollar amount followed by a period indicator
  const ratePattern = /\$[\d,]+\.?\d*\s*\/?\s*(per\s+)?(year|annual|yr|month|mo|bi-?weekly|paycheck|pay\s+period|semi-?monthly|week)/gi;

  return text.replace(ratePattern, (match) => {
    const parsed = parseRateString(match);
    if (!parsed) return match;                    // can't parse → leave as-is
    const monthly = normalizeRate(parsed.value, parsed.period, 'monthly');
    return formatRateDisplay(monthly);
  });
}
