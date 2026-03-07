/**
 * STRESS-TEST SUITE — All 35 Fixes
 *
 * Covers every critical behavioral guarantee added across rounds 1–8:
 *   - Carrier misattribution guards (Unum/Allstate)
 *   - Kaiser geography (CA/OR/WA only)
 *   - noPricingMode enforcement
 *   - Rightway / DHMO / PPO hallucination guards
 *   - HSA + spouse FSA IRS compliance triggers
 *   - STD leave-pay vs medical cost separation
 *   - regionAvailability / getPlansByRegion with 2-letter state codes
 *   - stripPricingDetails completeness
 */

import { describe, it, expect } from 'vitest';
import { stripPricingDetails } from '../../app/api/qa/route';
import { getPlansByRegion } from '../../lib/data/amerivet';
import {
  compareMaternityCosts,
  estimateCostProjection,
} from '../../lib/rag/pricing-utils';

// ─────────────────────────────────────────────────────────────────────────────
// CARRIER MISATTRIBUTION — post-processing regex rules
// Mirrors CARRIER_MISATTRIBUTION_RULES in qa/route.ts and L3_CARRIER_RULES in chat/route.ts
// ─────────────────────────────────────────────────────────────────────────────

const CARRIER_RULES: Array<{ pattern: RegExp; fix: string }> = [
  { pattern: /allstate\s+(?:voluntary\s+)?term\s+life/gi,                   fix: 'Unum Voluntary Term Life' },
  { pattern: /unum\s+whole\s+life/gi,                                        fix: 'Allstate Whole Life' },
  { pattern: /unum\s+(?:voluntary\s+)?accident(?:\s+insurance)?/gi,          fix: 'Allstate Accident Insurance' },
  { pattern: /unum\s+critical\s+illness/gi,                                  fix: 'Allstate Critical Illness' },
];

function applyCarrierRules(text: string): string {
  let out = text;
  for (const rule of CARRIER_RULES) {
    if (rule.fix) out = out.replace(rule.pattern, rule.fix);
  }
  return out;
}

describe('Carrier misattribution — Fix 27/28/31', () => {
  it('corrects "Allstate Voluntary Term Life" → Unum', () => {
    const fixed = applyCarrierRules('Your Allstate Voluntary Term Life benefit is $50,000.');
    expect(fixed).toContain('Unum Voluntary Term Life');
    expect(fixed).not.toMatch(/allstate.*term\s+life/i);
  });

  it('corrects "Allstate term life" (no "voluntary") → Unum', () => {
    const fixed = applyCarrierRules('Allstate term life covers $100k.');
    expect(fixed).toContain('Unum Voluntary Term Life');
  });

  it('corrects "Unum Whole Life" → Allstate Whole Life', () => {
    const fixed = applyCarrierRules('Unum Whole Life is a permanent insurance product.');
    expect(fixed).toContain('Allstate Whole Life');
    expect(fixed).not.toMatch(/unum\s+whole\s+life/i);
  });

  it('corrects "Unum Accident Insurance" → Allstate Accident Insurance (Fix 28/31)', () => {
    const fixed = applyCarrierRules('Unum Accident Insurance pays a lump sum benefit.');
    expect(fixed).toContain('Allstate Accident Insurance');
    expect(fixed).not.toMatch(/unum\s+accident/i);
  });

  it('corrects "Unum Voluntary Accident" → Allstate Accident Insurance (Fix 28/31)', () => {
    const fixed = applyCarrierRules('You can enroll in Unum Voluntary Accident insurance.');
    expect(fixed).toContain('Allstate Accident Insurance');
  });

  it('corrects "Unum Critical Illness" → Allstate Critical Illness (Fix 28/31)', () => {
    const fixed = applyCarrierRules('Unum Critical Illness pays upon diagnosis.');
    expect(fixed).toContain('Allstate Critical Illness');
    expect(fixed).not.toMatch(/unum\s+critical/i);
  });

  it('leaves correct assignments untouched', () => {
    const text = 'Unum Basic Life provides $25,000 employer-paid coverage. Allstate Whole Life is voluntary.';
    expect(applyCarrierRules(text)).toBe(text);
  });

  it('leaves Unum STD/LTD/Basic Life untouched', () => {
    const text = 'Unum Short-Term Disability pays 60%. Unum Long-Term Disability begins at week 13. Unum Basic Life is employer-paid.';
    expect(applyCarrierRules(text)).toBe(text);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KAISER GEOGRAPHY — getPlansByRegion with 2-letter state codes (Fix 30)
// ─────────────────────────────────────────────────────────────────────────────

describe('Kaiser geography — Fix 30 (regionalAvailability + state-code expansion)', () => {
  it('CA user gets Kaiser', () => {
    const plans = getPlansByRegion('CA');
    expect(plans.some(p => p.provider.toLowerCase().includes('kaiser'))).toBe(true);
  });

  it('WA user gets Kaiser', () => {
    const plans = getPlansByRegion('WA');
    expect(plans.some(p => p.provider.toLowerCase().includes('kaiser'))).toBe(true);
  });

  it('OR user gets Kaiser', () => {
    const plans = getPlansByRegion('OR');
    expect(plans.some(p => p.provider.toLowerCase().includes('kaiser'))).toBe(true);
  });

  it('TX user does NOT get Kaiser', () => {
    const plans = getPlansByRegion('TX');
    expect(plans.some(p => p.provider.toLowerCase().includes('kaiser'))).toBe(false);
  });

  it('FL user does NOT get Kaiser', () => {
    const plans = getPlansByRegion('FL');
    expect(plans.some(p => p.provider.toLowerCase().includes('kaiser'))).toBe(false);
  });

  it('OH user does NOT get Kaiser', () => {
    const plans = getPlansByRegion('OH');
    expect(plans.some(p => p.provider.toLowerCase().includes('kaiser'))).toBe(false);
  });

  it('all states get BCBSTX medical plans (nationwide)', () => {
    for (const state of ['TX', 'FL', 'NY', 'CA', 'WA', 'OR', 'GA', 'IL']) {
      const plans = getPlansByRegion(state);
      expect(plans.some(p => p.provider.toLowerCase().includes('bcbstx') && p.type === 'medical')).toBe(true);
    }
  });

  it('full state name "Washington" also returns Kaiser', () => {
    const plans = getPlansByRegion('Washington');
    expect(plans.some(p => p.provider.toLowerCase().includes('kaiser'))).toBe(true);
  });

  it('full state name "Oregon" also returns Kaiser', () => {
    const plans = getPlansByRegion('Oregon');
    expect(plans.some(p => p.provider.toLowerCase().includes('kaiser'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kaiser in compareMaternityCosts (Fix 30 downstream)
// ─────────────────────────────────────────────────────────────────────────────

describe('compareMaternityCosts Kaiser inclusion — Fix 30', () => {
  it('WA user: Kaiser included in maternity comparison', () => {
    const result = compareMaternityCosts('Employee Only', 'WA');
    expect(result.toLowerCase()).toMatch(/kaiser/);
  });

  it('OR user: Kaiser included in maternity comparison', () => {
    const result = compareMaternityCosts('Employee Only', 'OR');
    expect(result.toLowerCase()).toMatch(/kaiser/);
  });

  it('CA user: Kaiser included in maternity comparison', () => {
    const result = compareMaternityCosts('Employee Only', 'CA');
    expect(result.toLowerCase()).toMatch(/kaiser/);
  });

  it('TX user: Kaiser plan data excluded from maternity comparison', () => {
    const result = compareMaternityCosts('Employee Only', 'TX');
    // The footer always mentions "kaiser only in certain regions" as context;
    // verify the Kaiser *plan row* is absent (plan name: "Kaiser Standard HMO")
    expect(result).not.toMatch(/Kaiser Standard HMO/);
  });

  it('FL user: Kaiser plan data excluded from maternity comparison', () => {
    const result = compareMaternityCosts('Employee Only', 'FL');
    expect(result).not.toMatch(/Kaiser Standard HMO/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kaiser in estimateCostProjection (Fix 30 downstream)
// ─────────────────────────────────────────────────────────────────────────────

describe('estimateCostProjection Kaiser inclusion — Fix 30', () => {
  it('WA user: Kaiser included in cost projection', () => {
    const result = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'moderate', state: 'WA' });
    expect(result.toLowerCase()).toMatch(/kaiser/);
  });

  it('OR user: Kaiser included in cost projection', () => {
    const result = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'moderate', state: 'OR' });
    expect(result.toLowerCase()).toMatch(/kaiser/);
  });

  it('CA user: Kaiser included in cost projection', () => {
    const result = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'moderate', state: 'CA' });
    expect(result.toLowerCase()).toMatch(/kaiser/);
  });

  it('TX user: Kaiser excluded from cost projection', () => {
    const result = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'moderate', state: 'TX' });
    expect(result.toLowerCase()).not.toMatch(/kaiser/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// noPricingMode — stripPricingDetails completeness
// ─────────────────────────────────────────────────────────────────────────────

describe('stripPricingDetails — noPricingMode enforcement', () => {
  const dollarCases = [
    '$142.17/month',
    '$65.31 bi-weekly',
    '$1,500 deductible',
    '$4,300/year HSA limit',
    '$8,550 family HSA',
    'employer contributes $500/year',
    'Total: $386.12',
    'premium of $268.45',
  ];

  dollarCases.forEach(amount => {
    it(`strips dollar amount: "${amount}"`, () => {
      const result = stripPricingDetails(`Coverage overview: ${amount} for Employee Only.`);
      expect(result).not.toMatch(/\$[\d,]+/);
    });
  });

  it('strips monthly premium lines', () => {
    const input = 'Kaiser Standard HMO\n- Monthly Premium: $142.17\n- Deductible: $1,000\n- Network: Kaiser integrated';
    const result = stripPricingDetails(input);
    expect(result).not.toMatch(/\$142/);
    expect(result).toContain('Kaiser Standard HMO');
    expect(result).toContain('Network: Kaiser integrated');
  });

  it('strips per-paycheck amount', () => {
    const input = 'Your per-paycheck cost would be $65.62 for Standard HSA.';
    const result = stripPricingDetails(input);
    expect(result).not.toMatch(/\$65/);
  });

  it('preserves plan names, features, network info on dollar-free lines', () => {
    // Each line must be dollar-free for stripPricingDetails to keep it;
    // mixing $ and non-$ data on the same line causes the whole line to be dropped.
    const input = 'Standard HSA (BCBSTX)\nIn-network specialist visits covered at 90% after deductible.\nUses nationwide PPO network.';
    const result = stripPricingDetails(input);
    expect(result).toContain('Standard HSA');
    expect(result).toContain('BCBSTX');
    expect(result).toContain('nationwide PPO network');
  });

  it('preserves STD 60% replacement rate (not a dollar amount)', () => {
    const input = 'UNUM STD pays 60% of your pre-disability base salary.';
    const result = stripPricingDetails(input);
    expect(result).toContain('60%');
    expect(result).toContain('base salary');
  });

  it('HSA employer contribution stripped when pricing suppressed', () => {
    const input = 'AmeriVet contributes $500/year to your HSA. The IRS limit is $4,300 for self-only in 2025.';
    const result = stripPricingDetails(input);
    expect(result).not.toMatch(/\$500/);
    expect(result).not.toMatch(/\$4,300/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RIGHTWAY / DHMO / PPO hallucination guards
// ─────────────────────────────────────────────────────────────────────────────

describe('Banned-term guards — Rightway, DHMO, (305) number', () => {
  const RIGHTWAY_RE = /rightway|right\s*way/i;
  const DHMO_RE = /\bDHMO\b/gi;
  const BANNED_PHONE_RE = /\(?\s*305\s*\)?\s*[-.]?\s*851\s*[-.]?\s*7310/g;

  it('Rightway regex fires on "Rightway"', () => {
    expect(RIGHTWAY_RE.test('Visit Rightway for support.')).toBe(true);
  });

  it('Rightway regex fires on "Right Way"', () => {
    expect(RIGHTWAY_RE.test('Call Right Way at 1-800-...')).toBe(true);
  });

  it('Rightway regex does NOT fire on "right" alone', () => {
    expect(RIGHTWAY_RE.test('Choose the right plan for you.')).toBe(false);
  });

  it('DHMO regex fires and replacement is BCBSTX Dental PPO', () => {
    const text = 'AmeriVet offers a DHMO dental option.';
    const fixed = text.replace(DHMO_RE, 'BCBSTX Dental PPO');
    expect(fixed).toContain('BCBSTX Dental PPO');
    expect(fixed).not.toMatch(/\bDHMO\b/);
  });

  it('Banned phone fires on (305) 851-7310', () => {
    expect(BANNED_PHONE_RE.test('Call (305) 851-7310 for help.')).toBe(true);
  });

  it('Banned phone fires on 305-851-7310', () => {
    BANNED_PHONE_RE.lastIndex = 0;
    expect(BANNED_PHONE_RE.test('Dial 305-851-7310.')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HSA + Spouse FSA IRS compliance trigger
// ─────────────────────────────────────────────────────────────────────────────

function triggersHsaSpouseFsa(q: string): boolean {
  const lq = q.toLowerCase();
  return (
    /\bhsa\b/i.test(lq) &&
    /\bspouse\b/i.test(lq) &&
    /\b(general\s*[- ]?purpose\s*fsa|health\s*(?:care)?\s*fsa|medical\s*fsa|fsa)\b/i.test(lq)
  );
}

describe('HSA + spouse FSA conflict trigger', () => {
  it('fires when spouse has general-purpose FSA (explicit)', () => {
    expect(triggersHsaSpouseFsa("My spouse has a general-purpose FSA. Can I still contribute to HSA?")).toBe(true);
  });

  it('fires when spouse has healthcare FSA (implicit)', () => {
    expect(triggersHsaSpouseFsa("I want to open an HSA but my spouse is enrolled in FSA")).toBe(true);
  });

  it('fires when spouse has health care FSA', () => {
    expect(triggersHsaSpouseFsa("My spouse has a health care FSA, does that affect my HSA?")).toBe(true);
  });

  it('does NOT fire when no spouse mentioned', () => {
    expect(triggersHsaSpouseFsa("I have an HSA and also an FSA through work")).toBe(false);
  });

  it('does NOT fire for HSA question without FSA', () => {
    expect(triggersHsaSpouseFsa("How much can I contribute to my HSA this year?")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STD leave-pay vs medical cost separation
// ─────────────────────────────────────────────────────────────────────────────

function triggersStdLeavePayTimeline(q: string): boolean {
  const lq = q.toLowerCase();
  return (
    (
      /\b(maternity(?:\s+leave)?|parental\s+leave|fmla|leave\s+of\s+absence)\b/i.test(lq) &&
      /\b(pay(?:check)?|paid|income|salary|money|how\s+much|week\s*\d*|6th\s+week|sixth\s+week|std|short\s*[- ]?term\s+disability|60%)\b/i.test(lq)
    ) || (
      /\b(std|short\s*[- ]?term\s+disability)\b/i.test(lq) &&
      /\b(maternity|leave|pay(?:check)?|paid|salary|60%|sixty\s*percent|week\s*\d+|6th\s+week|sixth\s+week|get\s+paid|income)\b/i.test(lq)
    )
  );
}

describe('STD leave-pay intercept trigger', () => {
  const shouldFire = [
    'How much will I get paid on maternity leave?',
    'What does STD pay during maternity leave?',
    "I'm on FMLA, how much will I receive?",
    'Will I get a paycheck during parental leave?',
    'How much income will I get on leave of absence?',
    'My short-term disability — how much do I get paid during maternity?',
    'Sixth week of maternity, how much do I get from STD?',
    'STD pays 60% of salary — how does that work during leave?',
  ];

  shouldFire.forEach(q => {
    it(`fires for: "${q}"`, () => {
      expect(triggersStdLeavePayTimeline(q)).toBe(true);
    });
  });

  const shouldNotFire = [
    'What is the deductible for the Standard HSA plan?',
    'Compare maternity costs across medical plans',
    'Does Kaiser cover prenatal visits?',
    'What is my out-of-pocket max for delivery?',
  ];

  shouldNotFire.forEach(q => {
    it(`does NOT fire for: "${q}"`, () => {
      expect(triggersStdLeavePayTimeline(q)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Allstate term-life misattribution trigger (classic carrier swap)
// ─────────────────────────────────────────────────────────────────────────────

describe('Allstate term-life misattribution guard', () => {
  it('corrects "Allstate term life" to Unum in response text', () => {
    const bad = 'You can enroll in Allstate term life up to 5x salary.';
    const fixed = applyCarrierRules(bad);
    expect(fixed).toContain('Unum Voluntary Term Life');
    expect(fixed).not.toMatch(/allstate.*term\s*life/i);
  });

  it('leaves "Allstate Whole Life" untouched', () => {
    const text = 'Allstate Whole Life is a permanent benefit.';
    expect(applyCarrierRules(text)).toBe(text);
  });

  it('leaves "Allstate Accident Insurance" untouched', () => {
    const text = 'Allstate Accident Insurance pays cash for covered accidents.';
    expect(applyCarrierRules(text)).toBe(text);
  });

  it('leaves "Allstate Critical Illness" untouched', () => {
    const text = 'Allstate Critical Illness pays a lump sum upon diagnosis.';
    expect(applyCarrierRules(text)).toBe(text);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// compareMaternityCosts output structure
// ─────────────────────────────────────────────────────────────────────────────

describe('compareMaternityCosts output quality', () => {
  it('returns a non-empty string', () => {
    const result = compareMaternityCosts('Employee Only', 'TX');
    expect(result.length).toBeGreaterThan(100);
  });

  it('mentions deductible and out-of-pocket', () => {
    const result = compareMaternityCosts('Employee + Spouse', 'TX');
    expect(result.toLowerCase()).toMatch(/deductible/);
    expect(result.toLowerCase()).toMatch(/out-of-pocket/);
  });

  it('includes enrollment portal CTA', () => {
    const result = compareMaternityCosts('Employee Only');
    expect(result).toMatch(/workday|enrollment/i);
  });

  it('WA result contains Kaiser name', () => {
    const result = compareMaternityCosts('Employee Only', 'WA');
    expect(result).toMatch(/Kaiser/i);
  });

  it('TX result contains only BCBSTX plans (no Kaiser plan row)', () => {
    const result = compareMaternityCosts('Employee Only', 'TX');
    expect(result).toMatch(/BCBSTX|Standard HSA|Enhanced HSA/i);
    // Footer always says "kaiser only in certain regions" — check plan row is absent
    expect(result).not.toMatch(/Kaiser Standard HMO/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// estimateCostProjection output structure
// ─────────────────────────────────────────────────────────────────────────────

describe('estimateCostProjection output quality', () => {
  it('returns structured cost projection for TX (no Kaiser)', () => {
    const result = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'moderate', state: 'TX' });
    expect(result).toMatch(/Standard HSA|Enhanced HSA/i);
    expect(result.toLowerCase()).not.toMatch(/kaiser/);
  });

  it('returns structured cost projection for WA (with Kaiser)', () => {
    const result = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'high', state: 'WA' });
    expect(result).toMatch(/Kaiser/i);
  });

  it('low usage vs high usage produces different projected totals', () => {
    const low = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'low', state: 'TX' });
    const high = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'high', state: 'TX' });
    expect(low).not.toEqual(high);
  });

  it('includes disclaimer about estimates', () => {
    const result = estimateCostProjection({ coverageTier: 'Employee Only', usage: 'moderate', state: 'TX' });
    expect(result.toLowerCase()).toMatch(/estimate|rough/i);
  });
});
