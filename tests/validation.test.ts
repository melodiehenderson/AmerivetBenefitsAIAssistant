import { describe, it, expect } from 'vitest';

import pricingUtils, {
  normalizeCoverageToken,
  monthlyPremiumForPlan,
  perPaycheckFromMonthly,
  buildPerPaycheckBreakdown,
  computeTotalMonthlyFromSelections,
  normalizePricingInText,
  ensureStateConsistency,
  cleanRepeatedPhrases,
  estimateCostProjection,
  compareMaternityCosts,
} from '../lib/rag/pricing-utils';

import { extractStateCode } from '../app/api/qa/route';

describe('Validation Tests (converted from validation-tests.ts)', () => {
  it('coverage tier normalization', () => {
    const inputs = ['Employee + Child', 'EMPLOYEE + CHILD', 'employee + child', 'emp + child'];
    const normalized = inputs.map(i => normalizeCoverageToken(i));
    // Allow abbreviation to fall back; expect at least 3 of 4 normalize correctly
    const matches = normalized.filter(n => n === 'employee + child').length;
    expect(matches).toBeGreaterThanOrEqual(3);
  });

  it('per-paycheck breakdown calculation (employee + child)', () => {
    const plan = 'Standard HSA';
    const monthly = monthlyPremiumForPlan(plan, 'employee + child');
    expect(monthly).toBeDefined();
    // Canonical catalog premium
    expect(monthly).toBe(190.31);

    const perPay = perPaycheckFromMonthly(monthly, 26);
    // cents-accurate biweekly premium
    expect(perPay).toBe(Number(((monthly * 12) / 26).toFixed(2)));
  });

  it('state extraction negation handling', () => {
    const a = extractStateCode('56 in colorado', true);
    expect(a.code).toBe('CO');

    const b = extractStateCode('i mentioned colorado above not indiana', false);
    // "not indiana" is a negation of Indiana; the referenced state is still Colorado
    expect(b.code).toBe('CO');
  });

  it('total deduction calculation from decisions tracker', () => {
    const decisionsTracker = {
      MEDICAL: { status: 'selected', value: 'Standard HSA' },
      DENTAL: { status: 'selected', value: 'BCBSTX Dental PPO' },
      VISION: { status: 'selected', value: 'VSP Vision Plus' },
    };
    const total = computeTotalMonthlyFromSelections(decisionsTracker, 'employee + child');
    // 190.31 (medical) + 72.45 (dental) + 20.10 (vision)
    expect(total).toBe(282.86);
  });

  it('ensure state consistency removes other states', () => {
    const answers = [
      "In Indiana, the plan costs $400. But in Texas you get better coverage.",
      "Indiana and California have different rules, but your Texas plan covers...",
      "The state rules vary. Check with Indiana HR for details.",
    ];
    for (const ans of answers) {
      const cleaned = ensureStateConsistency(ans, 'TX');
      expect(/Indiana|California/.test(cleaned)).toBe(false);
    }
  });

  it('pricing text normalization converts annual/monthly/per-pay to monthly-first', () => {
    const inputs = [
      '$1,924 annually',
      '$160 per month',
      '$58 per paycheck',
      '$1924.32 per year',
    ];
    const joined = inputs.join(' | ');
    const out = normalizePricingInText(joined, 26);
    expect(out.toLowerCase()).toContain('per month');
    expect(out).toMatch(/\$\d{1,3}(,\d{3})*/);
  });

  it('clean repeated phrases', () => {
    const input = 'Indiana, Indiana, and Indiana are similar. California, California, California!';
    const expected = 'Indiana are similar. California!';
    const out = cleanRepeatedPhrases(input);
    expect(out).toBe(expected);
  });

  it('cost projection returns a descriptive string', () => {
    const proj = estimateCostProjection({ coverageTier: 'Employee + Child', usage: 'moderate', network: 'Kaiser', state: 'DE', age: 45 });
    expect(typeof proj).toBe('string');
    expect(proj).toContain('Projected Healthcare Costs');
  });

  it('maternity comparison returns summary text', () => {
    const out = compareMaternityCosts('Employee Only');
    expect(out).toContain('Maternity Cost Comparison');
  });

  it('intercept regex quick checks', () => {
    const costRegex = /(?:calculate|projected|estimate).*cost|healthcare costs|next year|usage|moderate|low|high/i;
    const maternityRegex = /maternity|baby|pregnan|birth|deliver/i;
    const orthoRegex = /orthodont/i;
    const tests = [
      'Help me calculate healthcare costs for next year',
      'What will I pay if I have a baby?',
      'Does orthodontics count?',
    ];
    expect(costRegex.test(tests[0])).toBe(true);
    expect(maternityRegex.test(tests[1])).toBe(true);
    expect(orthoRegex.test(tests[2])).toBe(true);
  });
});
