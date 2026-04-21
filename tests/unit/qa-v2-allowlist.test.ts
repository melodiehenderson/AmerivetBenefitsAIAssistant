import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 1 structural tests for the deterministic-intent allowlist. These
// verify the routing contract — not specific phrase content — so they
// stay green as the underlying answer-builders evolve.
//
// Allowlist scope (Phase 1):
//   1. Term registry lookup ("what's BCBSTX?", "define HMO")
//   2. Benefits overview lineup ("what are my options")
//   3. Plan detail by name (medical / routine / non-medical)
//   4. Topic switch / topic overview ("tell me about dental")
//
// Everything else routes to the LLM passthrough or the one-line
// counselor escalation (kill switch). See qa-v2-llm-passthrough.test.ts
// for passthrough-specific wiring tests.

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

import { azureOpenAIService } from '@/lib/azure/openai';
import { runQaV2Engine } from '@/lib/qa-v2/engine';
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

describe('qa-v2 deterministic allowlist (Phase 1)', () => {
  const originalFlag = process.env.QA_V2_LLM_PASSTHROUGH;

  beforeEach(() => {
    vi.clearAllMocks();
    // Force LLM kill switch on so a missed allowlist hits the one-line
    // escalation instead of consuming the mocked LLM — makes intent of
    // each test clearer.
    process.env.QA_V2_LLM_PASSTHROUGH = '0';
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.QA_V2_LLM_PASSTHROUGH;
    } else {
      process.env.QA_V2_LLM_PASSTHROUGH = originalFlag;
    }
  });

  describe('1. term registry', () => {
    it('resolves "what\'s BCBSTX?" via the term registry', async () => {
      const result = await runQaV2Engine({
        query: "what's BCBSTX?",
        session: makeSession({ currentTopic: 'Medical' }),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('term-registry-v2');
      expect(result.answer).toContain('Blue Cross Blue Shield of Texas');
    });

    it('resolves "what does HMO stand for?"', async () => {
      const result = await runQaV2Engine({
        query: 'what does HMO stand for?',
        session: makeSession({ currentTopic: 'Medical' }),
      });
      expect(result.tier).toBe('L1');
      // Either the term registry or the medical-plan-detail path can
      // answer HMO — both are deterministic. Assert it's not escalation.
      expect((result.metadata as any)?.intercept).not.toBe('counselor-escalation-v2');
    });
  });

  describe('2. benefits overview lineup', () => {
    it('resolves "show me all benefits"', async () => {
      const result = await runQaV2Engine({
        query: 'show me all benefits',
        session: makeSession(),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('benefits-overview-v2');
      expect(result.answer).toMatch(/medical/i);
      expect(result.answer).toMatch(/dental/i);
    });

    it('resolves "all my options"', async () => {
      const result = await runQaV2Engine({
        query: 'show me all my options',
        session: makeSession({ currentTopic: 'Medical' }),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('benefits-overview-v2');
    });
  });

  describe('3. plan detail by name', () => {
    it('resolves a medical plan detail ask', async () => {
      const result = await runQaV2Engine({
        query: 'tell me about Kaiser Standard HMO',
        session: makeSession({ currentTopic: 'Medical' }),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('medical-plan-detail-v2');
      expect(result.answer).toMatch(/kaiser/i);
    });

    it('resolves a dental detail ask when topic is active', async () => {
      const result = await runQaV2Engine({
        query: 'does the dental plan cover orthodontia?',
        session: makeSession({ currentTopic: 'Dental' }),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('routine-plan-detail-v2');
      expect(result.answer).toMatch(/orthodont/i);
    });

    it('resolves a non-medical (life) detail ask when topic is active', async () => {
      const result = await runQaV2Engine({
        query: 'how does voluntary term life work?',
        session: makeSession({ currentTopic: 'Life Insurance' }),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('non-medical-plan-detail-v2');
    });
  });

  describe('4. topic overview / switch', () => {
    it('resolves "tell me about dental" as a topic overview, sets currentTopic', async () => {
      const session = makeSession();
      const result = await runQaV2Engine({
        query: 'tell me about dental',
        session,
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('topic-overview-v2');
      expect(session.currentTopic).toBe('Dental');
    });
  });

  describe('5. off-allowlist queries route to LLM (or escalation when kill switch is on)', () => {
    it('a conversational follow-up emits the one-line counselor escalation, not a menu, when kill switch is on', async () => {
      const result = await runQaV2Engine({
        query: 'if I had to cut one thing to save money which would you drop first?',
        session: makeSession({ currentTopic: 'Medical' }),
      });
      expect(result.tier).toBe('L1');
      expect((result.metadata as any)?.intercept).toBe('counselor-escalation-v2');
      // Never a scaffold menu.
      expect(result.answer).not.toMatch(/useful next .* step is usually one of these/i);
      expect(result.answer).toMatch(/benefits counselor/i);
      expect(result.answer).toMatch(/888-217-4728/);
    });
  });
});
