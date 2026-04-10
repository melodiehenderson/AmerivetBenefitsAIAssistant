import type { Chunk } from '@/types/rag';

export type RetrievalEvalCase = {
  id: string;
  category: string;
  query: string;
  companyId?: string;
  state?: string | null;
  dept?: string | null;
  expectedPhrases: string[];
  topK?: number;
  runs?: number;
};

export function chunkToSearchableText(chunk: Chunk): string {
  return [
    chunk.title,
    chunk.sectionPath,
    chunk.content,
    JSON.stringify(chunk.metadata || {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function computePhraseRecallAtK(
  expectedPhrases: string[],
  chunks: Chunk[],
  k: number,
): number {
  if (expectedPhrases.length === 0) return 1;
  const topKText = chunks
    .slice(0, k)
    .map(chunkToSearchableText)
    .join('\n');

  const hits = expectedPhrases.filter((phrase) =>
    topKText.includes(phrase.toLowerCase())
  ).length;

  return hits / expectedPhrases.length;
}

export function computePhraseMRR(
  expectedPhrases: string[],
  chunks: Chunk[],
): number {
  if (expectedPhrases.length === 0) return 1;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkText = chunkToSearchableText(chunks[i]);
    if (expectedPhrases.some((phrase) => chunkText.includes(phrase.toLowerCase()))) {
      return 1 / (i + 1);
    }
  }

  return 0;
}

export function summarizeRepeatedRuns(values: number[]) {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, stable: true };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    avg: Number(avg.toFixed(4)),
    stable: min === max,
  };
}
