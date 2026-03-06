import { describe, it, expect } from 'vitest';
import {
  extractSalaryFromMessage,
  buildCatalogNumberSet,
  auditDollarGrounding,
} from '../../app/api/qa/route';
import type { Chunk } from '../../types/rag';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal Chunk factory — only fields used by auditDollarGrounding
// ─────────────────────────────────────────────────────────────────────────────
function makeChunk(content: string): Chunk {
  return {
    id: 'c1',
    docId: 'd1',
    companyId: 'amerivet',
    sectionPath: 'Benefits > Medical',
    content,
    title: 'Test Doc',
    position: 0,
    windowStart: 0,
    windowEnd: 100,
    metadata: { tokenCount: 50 },
    createdAt: new Date(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. extractSalaryFromMessage
// ─────────────────────────────────────────────────────────────────────────────
describe('extractSalaryFromMessage', () => {
  describe('monthly patterns', () => {
    it('parses $5,000/month', () => {
      expect(extractSalaryFromMessage('My salary is $5,000/month')).toBe(5000);
    });

    it('parses $5k/month', () => {
      expect(extractSalaryFromMessage('I earn $5k/month')).toBe(5000);
    });

    it('parses 5000 per month (no $ sign)', () => {
      expect(extractSalaryFromMessage('I make 5000 per month')).toBe(5000);
    });

    it('parses "earn $4500 monthly"', () => {
      expect(extractSalaryFromMessage('I earn $4500 monthly')).toBe(4500);
    });

    it('parses $7k a month', () => {
      expect(extractSalaryFromMessage('paid $7k a month')).toBe(7000);
    });

    it('parses $3,500 / month (spaces around slash)', () => {
      expect(extractSalaryFromMessage('salary is $3,500 / month')).toBe(3500);
    });
  });

  describe('annual patterns (converted to monthly)', () => {
    it('parses $60,000/year → 5000/month', () => {
      expect(extractSalaryFromMessage('I make $60,000/year')).toBe(5000);
    });

    it('parses $60k/year → 5000/month', () => {
      expect(extractSalaryFromMessage('My salary is $60k/year')).toBe(5000);
    });

    it('parses $84,000 per year → 7000/month', () => {
      expect(extractSalaryFromMessage('I earn $84,000 per year')).toBe(7000);
    });

    it('parses $90k annually → 7500/month', () => {
      expect(extractSalaryFromMessage('paid $90k annually')).toBe(7500);
    });

    it('parses "$120k a year" → 10000/month', () => {
      expect(extractSalaryFromMessage('I make $120k a year')).toBe(10000);
    });
  });

  describe('out-of-range / invalid inputs', () => {
    it('returns null for monthly < $1,000 (implausibly low)', () => {
      expect(extractSalaryFromMessage('I earn $500/month')).toBeNull();
    });

    it('returns null for monthly > $50,000 (implausibly high)', () => {
      expect(extractSalaryFromMessage('I earn $60,000/month')).toBeNull();
    });

    it('returns null for annual < $12,000', () => {
      expect(extractSalaryFromMessage('I make $10,000/year')).toBeNull();
    });

    it('returns null for annual > $600,000', () => {
      expect(extractSalaryFromMessage('I earn $700,000/year')).toBeNull();
    });

    it('returns null when no salary pattern present', () => {
      expect(extractSalaryFromMessage('What are my dental benefits?')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractSalaryFromMessage('')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles salary embedded in longer sentence', () => {
      const result = extractSalaryFromMessage(
        'Hi, my name is Sarah and I earn $6,000 per month. Can you help me pick a plan?'
      );
      expect(result).toBe(6000);
    });

    it('is case-insensitive for keywords', () => {
      expect(extractSalaryFromMessage('I EARN $5,000 MONTHLY')).toBe(5000);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. buildCatalogNumberSet
// ─────────────────────────────────────────────────────────────────────────────
describe('buildCatalogNumberSet', () => {
  it('extracts a single dollar amount', () => {
    const set = buildCatalogNumberSet('Monthly premium: $86.84');
    expect(set.has('86.84')).toBe(true);
  });

  it('strips the dollar sign', () => {
    const set = buildCatalogNumberSet('Deductible: $3,500');
    expect(set.has('3500')).toBe(true);
    expect(set.has('$3500')).toBe(false);
  });

  it('strips commas from large numbers', () => {
    const set = buildCatalogNumberSet('OOP max: $6,500');
    expect(set.has('6500')).toBe(true);
  });

  it('strips trailing .00', () => {
    const set = buildCatalogNumberSet('HSA employer: $750.00/year');
    expect(set.has('750')).toBe(true);
  });

  it('strips trailing .0 as well', () => {
    const set = buildCatalogNumberSet('Copay: $30.0');
    expect(set.has('30')).toBe(true);
  });

  it('preserves non-round amounts (e.g. $86.84)', () => {
    const set = buildCatalogNumberSet('EE premium $86.84/mo');
    expect(set.has('86.84')).toBe(true);
  });

  it('handles multiple amounts in one string', () => {
    const catalog = 'Standard HSA: $86.84 EE, $210.52 +Spouse, deductible $3,500';
    const set = buildCatalogNumberSet(catalog);
    expect(set.has('86.84')).toBe(true);
    expect(set.has('210.52')).toBe(true);
    expect(set.has('3500')).toBe(true);
  });

  it('returns an empty Set when no dollar amounts present', () => {
    const set = buildCatalogNumberSet('No pricing listed here.');
    expect(set.size).toBe(0);
  });

  it('deduplicates repeated amounts', () => {
    const set = buildCatalogNumberSet('Premium $86.84 for EE, also $86.84 in deductible schedule');
    const count = [...set].filter(v => v === '86.84').length;
    expect(count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. auditDollarGrounding
// ─────────────────────────────────────────────────────────────────────────────
describe('auditDollarGrounding', () => {
  const catalogWithPremium = buildCatalogNumberSet('Standard HSA EE $86.84/mo. Dental $28.90/mo.');
  const chunkWithPremium = [makeChunk('Your Standard HSA monthly premium is $86.84.')];
  const emptyChunks: Chunk[] = [];

  describe('grounded amounts are kept unchanged', () => {
    it('keeps a catalog amount untouched', () => {
      const { answer, warnings } = auditDollarGrounding(
        'The Standard HSA EE premium is $86.84 per month.',
        catalogWithPremium,
        emptyChunks
      );
      expect(answer).toContain('$86.84');
      expect(warnings).toHaveLength(0);
    });

    it('keeps an amount that appears in chunk text (not catalog)', () => {
      const chunks = [makeChunk('Your deductible resets to $1,200 at mid-year.')];
      const catalogSmall = buildCatalogNumberSet('$50 copay');
      const { answer, warnings } = auditDollarGrounding(
        'The plan resets at $1,200 mid-year.',
        catalogSmall,
        chunks
      );
      expect(answer).toContain('$1,200');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('ungrounded amounts are replaced', () => {
    it('replaces a fabricated dollar amount', () => {
      const { answer, warnings } = auditDollarGrounding(
        'The plan premium is $9,999 per month.',
        catalogWithPremium, // $9,999 not in catalog
        emptyChunks
      );
      expect(answer).not.toContain('$9,999');
      expect(answer).toContain('(see enrollment portal for exact rate)');
      expect(warnings).toContain('$9,999');
    });

    it('records all unique ungrounded amounts as warnings', () => {
      const { warnings } = auditDollarGrounding(
        'The cost is $999 for option A and $1,337 for option B.',
        catalogWithPremium,
        emptyChunks
      );
      expect(warnings).toContain('$999');
      expect(warnings).toContain('$1,337');
    });

    it('keeps catalog amounts alongside ungrounded ones in same answer', () => {
      const { answer } = auditDollarGrounding(
        'Your dental is $28.90. The special add-on is $777.',
        catalogWithPremium,
        emptyChunks
      );
      expect(answer).toContain('$28.90');
      expect(answer).not.toContain('$777');
      expect(answer).toContain('(see enrollment portal for exact rate)');
    });
  });

  describe('math-sentence exemption', () => {
    it('does NOT flag amounts in a sentence containing ÷', () => {
      const { answer, warnings } = auditDollarGrounding(
        'Your STD weekly benefit: $5,000 ÷ 4.33 × 0.60 = $693.00.',
        catalogWithPremium,
        emptyChunks
      );
      // $5,000 and $693.00 are both ungrounded in catalog, but math sentence is exempt
      expect(warnings).toHaveLength(0);
      expect(answer).toContain('$5,000');
    });

    it('does NOT flag amounts in an STD benefit sentence', () => {
      const { answer, warnings } = auditDollarGrounding(
        'Your STD weekly benefit is $1,154.',
        catalogWithPremium,
        emptyChunks
      );
      expect(warnings).toHaveLength(0);
      expect(answer).toContain('$1,154');
    });

    it('does NOT flag 60% of salary sentences', () => {
      const { answer, warnings } = auditDollarGrounding(
        'STD pays 60% of your base salary, so your weekly amount is $1,380.',
        catalogWithPremium,
        emptyChunks
      );
      expect(warnings).toHaveLength(0);
      expect(answer).toContain('$1,380');
    });

    it('flags ungrounded amounts in non-math sentences (adjacent to math sentence)', () => {
      const multiSentence =
        'Your STD weekly benefit: $5,000 ÷ 4.33 × 0.60 = $693.00. ' +
        'Additionally the plan enhancement costs $4,567.';
      const { warnings } = auditDollarGrounding(multiSentence, catalogWithPremium, emptyChunks);
      // The first sentence is exempt; the second should be flagged.
      // The dollar regex (/\$[\d,]+\.?\d*/) captures the trailing sentence
      // period when the amount falls at end of sentence — expect '$4,567.'
      expect(warnings.some(w => w.startsWith('$4,567'))).toBe(true);
    });
  });

  describe('answer with no dollar amounts', () => {
    it('passes through unchanged with no warnings', () => {
      const original = 'The plan year runs January through December.';
      const { answer, warnings } = auditDollarGrounding(original, catalogWithPremium, emptyChunks);
      expect(answer).toBe(original);
      expect(warnings).toHaveLength(0);
    });
  });

  describe('chunk-text grounding', () => {
    it('trusts an amount found verbatim in chunk text', () => {
      const chunks = [makeChunk('The Enhanced HSA EE premium is $160.36 per month.')];
      const catalogNoEnhanced = buildCatalogNumberSet('$86.84 $28.90'); // 160.36 not in catalog
      const { answer, warnings } = auditDollarGrounding(
        'Your Enhanced HSA EE premium is $160.36.',
        catalogNoEnhanced,
        chunks
      );
      expect(answer).toContain('$160.36');
      expect(warnings).toHaveLength(0);
    });
  });
});
