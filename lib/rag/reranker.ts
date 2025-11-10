import type { Chunk } from '../../types/rag';

export interface RerankerConfig {
  topK: number;
  maxTokens: number;
  mmrLambda?: number;
  enforceDistinctDocs?: boolean;
  maxPerDocPhase1?: number;
  minDistinctDocs?: number;
}

export interface RerankerResult {
  chunks: Chunk[];
  rerankedBy: 'relevance';
  originalCount: number;
  finalCount: number;
  distinctDocIds: number;
  totalTokens: number;
  droppedChunks: number;
}

const DEFAULT_CONFIG: RerankerConfig = {
  topK: 8,
  maxTokens: 3000,
  mmrLambda: 0.7,
};

const estimateTokens = (s: string) => Math.floor((s?.length ?? 0) / 4);

const getDistinctDocCount = (chunks: Chunk[]): number => {
  const ids = new Set(chunks.map(c => c.docId ?? (c as any).doc_id ?? 'UNK'));
  return ids.size;
};

export function rerankChunks(
  chunks: Chunk[],
  config: Partial<RerankerConfig> = {}
): RerankerResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!chunks?.length) {
    return {
      chunks: [],
      rerankedBy: 'relevance',
      originalCount: 0,
      finalCount: 0,
      distinctDocIds: 0,
      totalTokens: 0,
      droppedChunks: 0,
    };
  }

  const packed = chunks.slice(0, cfg.topK);
  console.log([RERANKER] Packed:  chunks);
  
  const finalTokens = packed.reduce((acc, c) => acc + (c.metadata?.tokenCount ?? estimateTokens(c.content ?? '')), 0);

  const result: RerankerResult = {
    chunks: packed,
    rerankedBy: 'relevance',
    originalCount: chunks.length,
    finalCount: packed.length,
    distinctDocIds: getDistinctDocCount(packed),
    totalTokens: finalTokens,
    droppedChunks: chunks.length - packed.length,
  };

  return result;
}

export function buildContextFromReranked(chunks: Chunk[], maxTokens = 3000): string {
  let s = '';
  let used = 0;
  let i = 0;
  
  for (const c of chunks) {
    const t = c.metadata?.tokenCount ?? estimateTokens(c.content ?? '');
    if (used + t > maxTokens) break;
    s += \n[] \n\n;
    used += t;
  }
  
  return s.trim();
}

export function calculateDiversity(chunks: Chunk[]): number {
  return chunks.length ? getDistinctDocCount(chunks) / chunks.length : 0;
}

export function termCoverage(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = (text || '').toLowerCase();
  const tok = (s: string) => s.split(/\W+/).filter(Boolean);
  const qToks = tok(q);
  const tSet = new Set(tok(t));
  
  if (!qToks.length) return 0;
  
  const freq: Record<string, number> = {};
  for (const w of qToks) freq[w] = (freq[w] ?? 0) + 1;
  
  const N = qToks.length;
  let idfHit = 0;
  let idfMax = 0;
  
  for (const w of qToks) {
    const idf = Math.log(1 + N / (1 + freq[w]));
    idfMax += idf;
    if (tSet.has(w)) idfHit += idf;
  }
  
  return idfMax > 0 ? idfHit / idfMax : 0;
}

export function logRerankingDetails(_: Chunk[], __: RerankerResult): void {}
