// Phase 2: Tests for compliance-sensitive deterministic handlers and the
// post-generation catalog validator.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/azure/openai', () => ({
  azureOpenAIService: {
    generateChatCompletion: vi.fn(),
  },
}));

vi.mock('@/lib/rag/hybrid-retrieval', () => ({
  hybridRetrieve: vi.fn(async () => ({
    chunks: [],
    method: 'hybrid',
    totalResults: 0,
    latencyMs: 0,
    scores: { rrf: [] },
    gatePass: false,
    gateFailReason: 'INSUFFICIENT_CHUNKS',
  })),
}));

import { runQaV2Engine } from '@/lib/qa-v2/engine';
import { validateLlmOutput } from '@/lib/qa-v2/post-gen-validator';
import type { Session } from '@/lib/rag/session-store';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    step: 'active_chat',
    context: {},
    userName: 'Maggie',
    hasCollectedName: true,
    userAge: 34,
    userState: 'CA',
    dataConfirmed: true,
    ...overrides,
  };
}

describe('Phase 2: compliance-sensitive deterministic handlers', () => {
  const originalFlag = process.env.QA_V2_LLM_PASSTHROUGH;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QA_V2_LLM_PASSTHROUGH = '0';
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.QA_V2_LLM_PASSTHROUGH;
    } else {
      process.env.QA_V2_LLM_PASSTHROUGH = originalFlag;
    }
  });

  describe('dependent age cutoff', () => {
    it('answers "what is the dependent age limit?" correctly', async () => {
      const result = await runQaV2Engine({
        query: 'what is the dependent age limit?',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('compliance-fact-v2');
      expect(result.answer).toMatch(/26/);
      // The answer may mention 27 in context of "not eligible" — that's fine
      expect(result.answer).not.toMatch(/27\s+is\s+eligible/i);
    });

    it('answers "can my 27-year-old be on my plan?" with a clear no', async () => {
      const result = await runQaV2Engine({
        query: 'can my 27-year-old be on my plan?',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('compliance-fact-v2');
      expect(result.answer).toMatch(/26/);
    });

    it('handles "aged off" phrasing', async () => {
      const result = await runQaV2Engine({
        query: 'my daughter is aging off — when does she lose coverage?',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('compliance-fact-v2');
      expect(result.answer).toMatch(/26/);
    });
  });

  describe('Kaiser state availability', () => {
    it('answers which states have Kaiser — content is correct regardless of intercept path', async () => {
      const result = await runQaV2Engine({
        query: 'which states have Kaiser?',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      // direct-support-v2 or compliance-fact-v2 — both are acceptable
      expect(['direct-support-v2', 'compliance-fact-v2']).toContain(
        (result.metadata as any)?.intercept,
      );
      // CA, GA, OR, WA must all appear in the answer
      expect(result.answer).toMatch(/california/i);
      expect(result.answer).toMatch(/georgia/i);
      expect(result.answer).toMatch(/oregon/i);
      expect(result.answer).toMatch(/washington/i);
    });

    it('tells a TX user Kaiser is not available in their state', async () => {
      const result = await runQaV2Engine({
        query: 'is Kaiser available in Texas?',
        session: makeSession({ userState: 'TX' }),
      });
      expect(result.tier).toBe('L1');
      expect(['direct-support-v2', 'compliance-fact-v2']).toContain(
        (result.metadata as any)?.intercept,
      );
      expect(result.answer).toMatch(/not available/i);
    });
  });

  describe('domestic partner eligibility', () => {
    it('confirms domestic partner is eligible', async () => {
      const result = await runQaV2Engine({
        query: 'can I add my domestic partner to my health insurance?',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('compliance-fact-v2');
      expect(result.answer).toMatch(/eligible/i);
    });
  });

  describe('Basic Life cost', () => {
    it('confirms Basic Life is employer-paid ($0)', async () => {
      const result = await runQaV2Engine({
        query: 'how much does basic life insurance cost me?',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('compliance-fact-v2');
      expect(result.answer).toMatch(/\$0/);
      expect(result.answer).toMatch(/employer[- ]paid/i);
    });
  });

  describe('HSA employer contribution', () => {
    it('returns tier-based HSA employer contribution amounts', async () => {
      const result = await runQaV2Engine({
        query: 'how much does AmeriVet contribute to my HSA?',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('compliance-fact-v2');
      // Should include at least one of the known tier amounts
      expect(result.answer).toMatch(/\$750|\$1,?000|\$1,?250/);
    });
  });

  describe('new-hire coverage start', () => {
    it('answers when coverage starts for a new employee', async () => {
      const result = await runQaV2Engine({
        query: 'when does my insurance coverage start as a new hire?',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('compliance-fact-v2');
      expect(result.answer).toMatch(/30\s+day/i);
      expect(result.answer).toMatch(/first of the month/i);
    });
  });
});

describe('Phase 2: post-generation catalog validator', () => {
  describe('validateLlmOutput', () => {
    it('passes for an answer containing only catalog amounts', () => {
      // $86.84 = Standard HSA employee-only premium
      const result = validateLlmOutput(
        'The Standard HSA plan costs $86.84/month for employee-only coverage.',
        'TX',
      );
      expect(result.valid).toBe(true);
    });

    it('flags a clearly hallucinated dollar amount', () => {
      const result = validateLlmOutput(
        'The Standard HSA plan costs $123.45/month — a great deal!',
        'TX',
      );
      expect(result.valid).toBe(false);
      expect((result as any).offenders).toContain('$123.45');
    });

    it('passes for a $25,000 Basic Life mention', () => {
      const result = validateLlmOutput(
        'Unum Basic Life provides a $25,000 death benefit at no cost to you.',
        'CA',
      );
      expect(result.valid).toBe(true);
    });

    it('flags a hallucinated carrier (Aetna)', () => {
      const result = validateLlmOutput(
        'You could also consider the Aetna PPO plan if you prefer a broader network.',
        'TX',
      );
      expect(result.valid).toBe(false);
      expect((result as any).offenders.some((o: string) => /aetna/i.test(o))).toBe(true);
    });

    it('flags Kaiser mentioned as an option for a non-Kaiser state', () => {
      const result = validateLlmOutput(
        'I recommend considering Kaiser — it has great low copays and would be a solid choice.',
        'TX',
      );
      expect(result.valid).toBe(false);
      expect((result as any).offenders.some((o: string) => /kaiser/i.test(o))).toBe(true);
    });

    it('does NOT flag Kaiser for a CA user', () => {
      const result = validateLlmOutput(
        'Kaiser Standard HMO is available to you and I recommend considering it.',
        'CA',
      );
      expect(result.valid).toBe(true);
    });

    it('passes for known HSA contribution amounts', () => {
      const result = validateLlmOutput(
        'AmeriVet contributes $750/year to your HSA for employee-only coverage, or $1,250 for family.',
        'TX',
      );
      expect(result.valid).toBe(true);
    });
  });
});
