/**
 * Evaluation Metrics — Recall@K, MRR, and mustContain/mustNotContain assertions
 *
 * These are offline metrics that can be computed against the golden eval dataset
 * without requiring a live LLM call. They measure retrieval quality and answer
 * correctness against known ground truth.
 *
 * Usage:
 *   import { computeRecallAtK, computeMRR, runOfflineEvalSuite } from './metrics';
 *   const report = runOfflineEvalSuite(cases, retrievedChunksMap, responsesMap);
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EvalCase {
  id: string;
  question: string;
  state?: string | null;
  expectedAnswer?: string;
  expectedChunkIds?: string[];
  mustContain?: string[];
  mustNotContain?: string[];
  must_contain?: string[];
  must_not_contain?: string[];
}

export interface CaseResult {
  id: string;
  query: string;
  recallAt5: number;
  mrr: number;
  mustContainPass: boolean;
  mustNotContainPass: boolean;
  failedMustContain: string[];
  failedMustNotContain: string[];
}

export interface EvalReport {
  avgRecallAt5: number;
  avgMRR: number;
  mustContainPassRate: number;
  mustNotContainPassRate: number;
  totalCases: number;
  cases: CaseResult[];
}

// ─── Core Metrics ────────────────────────────────────────────────────────────

/**
 * Compute Recall@K: what fraction of expected chunks appear in the top-K retrieved?
 * Returns 1.0 if all expected chunks are found, 0.0 if none.
 * Returns 1.0 if expectedChunkIds is empty (no retrieval expectation).
 */
export function computeRecallAtK(
  expectedChunkIds: string[],
  retrievedChunks: Array<{ id: string }>,
  k: number
): number {
  if (expectedChunkIds.length === 0) return 1.0;
  const topK = retrievedChunks.slice(0, k).map(c => c.id);
  const hits = expectedChunkIds.filter(id => topK.includes(id)).length;
  return hits / expectedChunkIds.length;
}

/**
 * Compute Mean Reciprocal Rank: 1/(rank of first relevant result).
 * Returns 0 if no relevant result is found.
 * Returns 1.0 if expectedChunkIds is empty (no retrieval expectation).
 */
export function computeMRR(
  expectedChunkIds: string[],
  retrievedChunks: Array<{ id: string }>
): number {
  if (expectedChunkIds.length === 0) return 1.0;
  for (let i = 0; i < retrievedChunks.length; i++) {
    if (expectedChunkIds.includes(retrievedChunks[i].id)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// ─── Assertion Checks ────────────────────────────────────────────────────────

/**
 * Check mustContain assertions: every required phrase must appear in response.
 */
export function checkMustContain(
  response: string,
  phrases: string[]
): { pass: boolean; failed: string[] } {
  const failed = phrases.filter(
    phrase => !new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(response)
  );
  return { pass: failed.length === 0, failed };
}

/**
 * Check mustNotContain assertions: none of the forbidden phrases may appear.
 */
export function checkMustNotContain(
  response: string,
  phrases: string[]
): { pass: boolean; failed: string[] } {
  const failed = phrases.filter(
    phrase => new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(response)
  );
  return { pass: failed.length === 0, failed };
}

// ─── Offline Eval Suite ──────────────────────────────────────────────────────

/**
 * Run the full offline evaluation suite against pre-computed responses.
 *
 * @param cases - Array of eval cases from the golden dataset
 * @param responses - Map of case ID → actual response string
 * @param retrievedChunksMap - Map of case ID → array of retrieved chunk IDs
 */
export function runOfflineEvalSuite(
  cases: EvalCase[],
  responses: Map<string, string>,
  retrievedChunksMap: Map<string, Array<{ id: string }>>
): EvalReport {
  const results: CaseResult[] = cases.map(c => {
    const response = responses.get(c.id) ?? '';
    const retrieved = retrievedChunksMap.get(c.id) ?? [];

    const expectedChunkIds = c.expectedChunkIds ?? [];
    const mustContain = c.mustContain ?? c.must_contain ?? [];
    const mustNotContain = c.mustNotContain ?? c.must_not_contain ?? [];

    const recallAt5 = computeRecallAtK(expectedChunkIds, retrieved, 5);
    const mrr = computeMRR(expectedChunkIds, retrieved);
    const containCheck = checkMustContain(response, mustContain);
    const notContainCheck = checkMustNotContain(response, mustNotContain);

    return {
      id: c.id,
      query: c.question,
      recallAt5,
      mrr,
      mustContainPass: containCheck.pass,
      mustNotContainPass: notContainCheck.pass,
      failedMustContain: containCheck.failed,
      failedMustNotContain: notContainCheck.failed,
    };
  });

  const totalCases = results.length;

  return {
    avgRecallAt5: totalCases > 0
      ? results.reduce((s, r) => s + r.recallAt5, 0) / totalCases
      : 0,
    avgMRR: totalCases > 0
      ? results.reduce((s, r) => s + r.mrr, 0) / totalCases
      : 0,
    mustContainPassRate: totalCases > 0
      ? results.filter(r => r.mustContainPass).length / totalCases
      : 0,
    mustNotContainPassRate: totalCases > 0
      ? results.filter(r => r.mustNotContainPass).length / totalCases
      : 0,
    totalCases,
    cases: results,
  };
}
