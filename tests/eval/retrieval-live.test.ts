import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import {
  computePhraseMRR,
  computePhraseRecallAtK,
  summarizeRepeatedRuns,
  type RetrievalEvalCase,
} from './retrieval-metrics';
import type { RetrievalContext } from '@/types/rag';

function loadDataset(): RetrievalEvalCase[] {
  const raw = readFileSync(resolve(__dirname, './retrieval-dataset.jsonl'), 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RetrievalEvalCase);
}

const dataset = loadDataset();
const companyId = (process.env.RETRIEVAL_EVAL_COMPANY_ID || '').trim();
const searchEndpoint = (process.env.AZURE_SEARCH_ENDPOINT || '').trim();
const searchApiKey = (process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY || '').trim();
const openAiEndpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').trim();
const openAiApiKey = (process.env.AZURE_OPENAI_API_KEY || '').trim();
const hasLiveRetrievalCreds =
  companyId.length > 0 &&
  searchEndpoint.length > 0 &&
  searchApiKey.length > 0 &&
  openAiEndpoint.length > 0 &&
  openAiApiKey.length > 0;
const shouldRun = process.env.RUN_RETRIEVAL_EVAL === '1' && hasLiveRetrievalCreds;

describe.skipIf(!shouldRun)('Retrieval live eval', () => {
  it('dataset includes at least 8 retrieval cases', () => {
    expect(dataset.length).toBeGreaterThanOrEqual(8);
  });

  it('reports repeated-run recall and MRR stability', async () => {
    const perCase = [];

    for (const testCase of dataset) {
      const topK = testCase.topK || 5;
      const runs = testCase.runs || 3;
      const recallValues: number[] = [];
      const mrrValues: number[] = [];

      for (let run = 0; run < runs; run += 1) {
        const context: RetrievalContext = {
          companyId: testCase.companyId || companyId,
          ...(testCase.state ? { state: testCase.state } : {}),
          ...(testCase.dept ? { dept: testCase.dept } : {}),
        };

        const result = await hybridRetrieve(testCase.query, context, {
          finalTopK: topK,
        });

        recallValues.push(computePhraseRecallAtK(testCase.expectedPhrases, result.chunks, topK));
        mrrValues.push(computePhraseMRR(testCase.expectedPhrases, result.chunks));
      }

      perCase.push({
        id: testCase.id,
        category: testCase.category,
        recallAtK: summarizeRepeatedRuns(recallValues),
        mrr: summarizeRepeatedRuns(mrrValues),
      });
    }

    const avgRecallAtK =
      perCase.reduce((sum, item) => sum + item.recallAtK.avg, 0) / Math.max(perCase.length, 1);
    const avgMRR =
      perCase.reduce((sum, item) => sum + item.mrr.avg, 0) / Math.max(perCase.length, 1);
    const stableCases = perCase.filter((item) => item.recallAtK.stable && item.mrr.stable).length;

    const summary = {
      totalCases: perCase.length,
      stableCases,
      stableRate: Number((stableCases / Math.max(perCase.length, 1)).toFixed(4)),
      avgRecallAtK: Number(avgRecallAtK.toFixed(4)),
      avgMRR: Number(avgMRR.toFixed(4)),
      perCase,
    };

    console.info(`[RETRIEVAL-EVAL] ${JSON.stringify(summary)}`);

    expect(summary.totalCases).toBeGreaterThan(0);
    expect(summary.avgRecallAtK).toBeGreaterThan(0);
  }, 120000);
});
