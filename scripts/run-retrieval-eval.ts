import { readFileSync } from 'fs';
import { resolve } from 'path';
import { hybridRetrieve } from '../lib/rag/hybrid-retrieval';
import type { RetrievalContext } from '../types/rag';
import {
  computePhraseMRR,
  computePhraseRecallAtK,
  summarizeRepeatedRuns,
  type RetrievalEvalCase,
} from '../tests/eval/retrieval-metrics';

function loadDataset(): RetrievalEvalCase[] {
  const raw = readFileSync(
    resolve(process.cwd(), 'tests/eval/retrieval-dataset.jsonl'),
    'utf8',
  );

  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RetrievalEvalCase);
}

async function main() {
  const dataset = loadDataset();
  const defaultCompanyId = (process.env.RETRIEVAL_EVAL_COMPANY_ID || '').trim();

  if (!defaultCompanyId) {
    throw new Error('RETRIEVAL_EVAL_COMPANY_ID is required to run retrieval evaluation.');
  }

  const cases = [];

  for (const testCase of dataset) {
    const companyId = testCase.companyId || defaultCompanyId;
    const topK = testCase.topK || 5;
    const runs = testCase.runs || 3;
    const recallValues: number[] = [];
    const mrrValues: number[] = [];
    const runSummaries = [];

    for (let run = 0; run < runs; run += 1) {
      const context: RetrievalContext = {
        companyId,
        ...(testCase.state ? { state: testCase.state } : {}),
        ...(testCase.dept ? { dept: testCase.dept } : {}),
      };

      const result = await hybridRetrieve(testCase.query, context, {
        finalTopK: topK,
      });

      const recallAtK = computePhraseRecallAtK(testCase.expectedPhrases, result.chunks, topK);
      const mrr = computePhraseMRR(testCase.expectedPhrases, result.chunks);

      recallValues.push(recallAtK);
      mrrValues.push(mrr);
      runSummaries.push({
        run: run + 1,
        retrievedChunkIds: result.chunks.slice(0, topK).map((chunk) => chunk.id),
        retrievedDocIds: result.chunks.slice(0, topK).map((chunk) => chunk.docId),
        recallAtK: Number(recallAtK.toFixed(4)),
        mrr: Number(mrr.toFixed(4)),
      });
    }

    cases.push({
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      expectedPhrases: testCase.expectedPhrases,
      topK,
      runs,
      recallAtK: summarizeRepeatedRuns(recallValues),
      mrr: summarizeRepeatedRuns(mrrValues),
      stableAcrossRuns:
        summarizeRepeatedRuns(recallValues).stable &&
        summarizeRepeatedRuns(mrrValues).stable,
      runsDetail: runSummaries,
    });
  }

  const avgRecall =
    cases.reduce((sum, item) => sum + item.recallAtK.avg, 0) / Math.max(cases.length, 1);
  const avgMRR =
    cases.reduce((sum, item) => sum + item.mrr.avg, 0) / Math.max(cases.length, 1);
  const stableCases = cases.filter((item) => item.stableAcrossRuns).length;

  const summary = {
    totalCases: cases.length,
    stableCases,
    stableRate: Number((stableCases / Math.max(cases.length, 1)).toFixed(4)),
    avgRecallAtK: Number(avgRecall.toFixed(4)),
    avgMRR: Number(avgMRR.toFixed(4)),
    cases,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[retrieval-eval] Failed:', error);
  process.exit(1);
});
