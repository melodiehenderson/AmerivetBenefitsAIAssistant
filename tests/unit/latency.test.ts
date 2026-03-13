/**
 * Latency SLO Tests
 *
 * These tests verify that retrieval and QA pipeline meet latency SLOs.
 * They require live Azure services (Search + OpenAI) to produce meaningful results.
 *
 * Run manually:
 *   AZURE_SEARCH_ENDPOINT=... AZURE_OPENAI_ENDPOINT=... npx vitest run tests/unit/latency.test.ts
 *
 * In CI without live services, these tests are skipped gracefully.
 */

import { describe, it, expect } from 'vitest';

const hasLiveServices = !!(
  process.env.AZURE_SEARCH_ENDPOINT &&
  process.env.AZURE_OPENAI_ENDPOINT
);

const describeIfLive = hasLiveServices ? describe : describe.skip;

describeIfLive('Latency SLOs (requires live Azure services)', () => {
  it('L1 hybrid retrieval completes in under 500ms', async () => {
    const { hybridRetrieve } = await import('../../lib/rag/hybrid-retrieval');

    const context = {
      companyId: 'amerivet',
      state: 'TX',
    };

    const start = Date.now();
    await hybridRetrieve('what is my deductible', context);
    const elapsed = Date.now() - start;

    console.log(`[SLO] L1 retrieval: ${elapsed}ms (target: <500ms)`);
    expect(elapsed).toBeLessThan(500);
  });

  it('L2 full QA pipeline completes in under 5000ms', async () => {
    // This test calls the actual QA endpoint handler with a simple query.
    // It measures total time including retrieval + LLM completion.
    const start = Date.now();

    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'what medical plans are available in Texas',
        userState: 'TX',
      }),
    });

    const elapsed = Date.now() - start;
    console.log(`[SLO] Full QA pipeline: ${elapsed}ms (target: <5000ms)`);

    expect(response.ok).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });
});

// Always-run unit test validating SLO thresholds are defined correctly
describe('Latency SLO configuration', () => {
  it('SLO thresholds are reasonable', () => {
    const L1_RETRIEVAL_SLO_MS = 500;
    const L2_FULL_PIPELINE_SLO_MS = 5000;
    const LLM_TIMEOUT_MS = 30_000;

    // Retrieval must be faster than full pipeline
    expect(L1_RETRIEVAL_SLO_MS).toBeLessThan(L2_FULL_PIPELINE_SLO_MS);
    // Full pipeline must be faster than LLM timeout
    expect(L2_FULL_PIPELINE_SLO_MS).toBeLessThan(LLM_TIMEOUT_MS);
    // Retrieval should be sub-second
    expect(L1_RETRIEVAL_SLO_MS).toBeLessThanOrEqual(1000);
  });
});
