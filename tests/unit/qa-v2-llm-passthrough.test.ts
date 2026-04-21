import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 1 pivot: LLM passthrough is the DEFAULT conversational path. The
// allowlist of deterministic intents runs first (term registry, plan
// detail by name, benefits overview, topic overview/switch); anything
// that isn't catalog-exact falls through to the LLM. Kill switch is
// `QA_V2_LLM_PASSTHROUGH=0`, which routes misses to the one-line
// counselor escalation instead.

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
    userAge: 29,
    userState: 'CA',
    dataConfirmed: true,
    ...overrides,
  };
}

describe('qa-v2 LLM passthrough wiring (Phase 1 default-on)', () => {
  const originalFlag = process.env.QA_V2_LLM_PASSTHROUGH;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QA_V2_LLM_PASSTHROUGH;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.QA_V2_LLM_PASSTHROUGH;
    } else {
      process.env.QA_V2_LLM_PASSTHROUGH = originalFlag;
    }
  });

  it('is ON by default — when all L1 allowlist handlers miss, the engine defers to the LLM and returns its answer as L2', async () => {
    vi.mocked(azureOpenAIService.generateChatCompletion).mockResolvedValueOnce({
      content: 'The medical carriers on your package are BCBSTX and, in CA/OR/WA, Kaiser.',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    } as any);

    const result = await runQaV2Engine({
      query: 'remind me who the carriers are on this package, in plain language please.',
      session: makeSession({ currentTopic: 'Medical' }),
    });

    expect(result.tier).toBe('L2');
    expect(result.answer).toContain('BCBSTX');
    expect((result.metadata as any)?.intercept).toBe('llm-passthrough-v2');
    expect(vi.mocked(azureOpenAIService.generateChatCompletion)).toHaveBeenCalledTimes(1);
  });

  it('kill switch QA_V2_LLM_PASSTHROUGH=0 routes misses to the one-line counselor escalation — never a menu', async () => {
    process.env.QA_V2_LLM_PASSTHROUGH = '0';

    const result = await runQaV2Engine({
      query: 'remind me who the carriers are on this package, in plain language please.',
      session: makeSession({ currentTopic: 'Medical' }),
    });

    expect(result.tier).toBe('L1');
    expect((result.metadata as any)?.intercept).toBe('counselor-escalation-v2');
    expect(result.answer).toMatch(/888-217-4728/);
    expect(result.answer).not.toMatch(/useful next .* step is usually one of these/i);
    expect(vi.mocked(azureOpenAIService.generateChatCompletion)).not.toHaveBeenCalled();
  });

  it('when the LLM call fails, the engine gracefully falls through to the one-line counselor escalation', async () => {
    vi.mocked(azureOpenAIService.generateChatCompletion).mockRejectedValueOnce(
      new Error('LLM_TIMEOUT: OpenAI request exceeded 30 seconds'),
    );

    const result = await runQaV2Engine({
      query: 'remind me who the carriers are on this package, in plain language please.',
      session: makeSession({ currentTopic: 'Medical' }),
    });

    expect(result.tier).toBe('L1');
    expect((result.metadata as any)?.intercept).toBe('counselor-escalation-v2');
    expect(result.answer).toMatch(/benefits counselor/i);
  });

  it('deterministic allowlist wins before the LLM — "what\'s BCBSTX?" resolves via the term registry without any LLM call', async () => {
    const result = await runQaV2Engine({
      query: "what's BCBSTX?",
      session: makeSession({ currentTopic: 'Medical' }),
    });

    expect(result.tier).toBe('L1');
    expect(result.answer).toContain('Blue Cross Blue Shield of Texas');
    expect(vi.mocked(azureOpenAIService.generateChatCompletion)).not.toHaveBeenCalled();
  });
});
