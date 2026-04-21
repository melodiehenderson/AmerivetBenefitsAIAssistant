import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external services BEFORE importing the engine. The engine pulls in
// `runLlmPassthrough`, which in turn imports the Azure OpenAI client — we
// stub both so tests don't need real credentials or a live index.
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

describe('Step 6 Layer C: LLM passthrough wiring', () => {
  const originalFlag = process.env.QA_V2_LLM_PASSTHROUGH;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.QA_V2_LLM_PASSTHROUGH;
    } else {
      process.env.QA_V2_LLM_PASSTHROUGH = originalFlag;
    }
  });

  it('is OFF by default — no LLM call when the flag is unset, engine returns L1 fallback', async () => {
    delete process.env.QA_V2_LLM_PASSTHROUGH;

    // A query that the rule-based engine has no specific handler for —
    // without the flag it should emit the generic L1 fallback menu.
    const result = await runQaV2Engine({
      query: 'remind me who the carriers are on this package, in plain language please.',
      session: makeSession({ currentTopic: 'Medical' }),
    });

    expect(result.tier).toBe('L1');
    expect(vi.mocked(azureOpenAIService.generateChatCompletion)).not.toHaveBeenCalled();
  });

  it('when the flag is on and all L1 handlers miss, the engine defers to the LLM and returns its answer as L2', async () => {
    process.env.QA_V2_LLM_PASSTHROUGH = '1';

    vi.mocked(azureOpenAIService.generateChatCompletion).mockResolvedValueOnce({
      content: 'The medical carriers on your package are BCBSTX and, in CA/OR/WA, Kaiser.',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    const result = await runQaV2Engine({
      query: 'remind me who the carriers are on this package, in plain language please.',
      session: makeSession({ currentTopic: 'Medical' }),
    });

    expect(result.tier).toBe('L2');
    expect(result.answer).toContain('BCBSTX');
    expect((result.metadata as any)?.intercept).toBe('llm-passthrough-v2');
    expect(vi.mocked(azureOpenAIService.generateChatCompletion)).toHaveBeenCalledTimes(1);
  });

  it('when the LLM call fails, the engine falls through to the rule-based L1 fallback instead of throwing', async () => {
    process.env.QA_V2_LLM_PASSTHROUGH = '1';

    vi.mocked(azureOpenAIService.generateChatCompletion).mockRejectedValueOnce(
      new Error('LLM_TIMEOUT: OpenAI request exceeded 30 seconds'),
    );

    const result = await runQaV2Engine({
      query: 'remind me who the carriers are on this package, in plain language please.',
      session: makeSession({ currentTopic: 'Medical' }),
    });

    // Graceful degradation — the user gets the L1 menu, not a 500.
    expect(result.tier).toBe('L1');
    expect((result.metadata as any)?.intercept).toBe('fallback-v2');
  });

  it('when the flag is on but a rule-based L1 handler matches first, the engine uses L1 and never calls the LLM', async () => {
    process.env.QA_V2_LLM_PASSTHROUGH = '1';

    // Step 3: "what's BCBSTX?" is answered by the package-term registry at L1.
    // With the passthrough flag on, that L1 handler still wins — we only
    // defer to the LLM when every rule-based path has missed.
    const result = await runQaV2Engine({
      query: "what's BCBSTX?",
      session: makeSession({ currentTopic: 'Medical' }),
    });

    expect(result.tier).toBe('L1');
    expect(result.answer).toContain('Blue Cross Blue Shield of Texas');
    expect(vi.mocked(azureOpenAIService.generateChatCompletion)).not.toHaveBeenCalled();
  });
});
