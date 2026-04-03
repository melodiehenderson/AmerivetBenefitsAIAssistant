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
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  hallucinationDetected: boolean;
  mustContainPass: boolean;
  mustNotContainPass: boolean;
  failedMustContain: string[];
  failedMustNotContain: string[];
}

export interface EvalReport {
  avgRecallAt5: number;
  avgMRR: number;
  avgPrecision: number;
  avgRecall: number;
  avgF1: number;
  avgAccuracy: number;
  hallucinationRate: number;
  mustContainPassRate: number;
  mustNotContainPassRate: number;
  totalCases: number;
  cases: CaseResult[];
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);
}

/**
 * Token-overlap precision/recall/F1 between expected answer and actual response.
 */
export function computeTextF1(
  expectedAnswer: string,
  response: string
): { precision: number; recall: number; f1: number } {
  const expected = normalizeTokens(expectedAnswer);
  const predicted = normalizeTokens(response);

  if (expected.length === 0 || predicted.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const expectedSet = new Set(expected);
  const predictedSet = new Set(predicted);

  const overlap = [...predictedSet].filter(t => expectedSet.has(t)).length;
  const precision = overlap / Math.max(predictedSet.size, 1);
  const recall = overlap / Math.max(expectedSet.size, 1);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
  };
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
    const lexical = computeTextF1(c.expectedAnswer ?? '', response);
    const accuracy = containCheck.pass && notContainCheck.pass ? 1 : 0;
    const hallucinationDetected = !notContainCheck.pass;

    return {
      id: c.id,
      query: c.question,
      recallAt5,
      mrr,
      precision: lexical.precision,
      recall: lexical.recall,
      f1: lexical.f1,
      accuracy,
      hallucinationDetected,
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
    avgPrecision: totalCases > 0
      ? results.reduce((s, r) => s + r.precision, 0) / totalCases
      : 0,
    avgRecall: totalCases > 0
      ? results.reduce((s, r) => s + r.recall, 0) / totalCases
      : 0,
    avgF1: totalCases > 0
      ? results.reduce((s, r) => s + r.f1, 0) / totalCases
      : 0,
    avgAccuracy: totalCases > 0
      ? results.reduce((s, r) => s + r.accuracy, 0) / totalCases
      : 0,
    hallucinationRate: totalCases > 0
      ? results.filter(r => r.hallucinationDetected).length / totalCases
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
