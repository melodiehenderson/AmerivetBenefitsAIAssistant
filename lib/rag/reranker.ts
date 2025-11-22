import type { Chunk } from '../../types/rag';import type { Chunk } from '../../types/rag';import type { Chunk } from "../../types/rag";// PASTE THIS AS THE ENTIRE FILE: lib/rag/reranker.ts/**



export interface RerankerConfig {

  topK: number;

  maxTokens: number;export interface RerankerConfig {

  query?: string;

  mmrLambda?: number;  topK: number;

}

  maxTokens: number;export interface RerankerConfig { * Semantic Reranker Module

export interface RerankerResult {

  chunks: Chunk[];  query?: string;

  rerankedBy: 'relevance';

  originalCount: number;  mmrLambda?: number;  topK: number;

  finalCount: number;

  distinctDocIds: number;}

  totalTokens: number;

  droppedChunks: number;  maxTokens: number;import type { Chunk } from '../../types/rag'; * Purpose: select a coverage-oriented, low-redundancy set of chunks with strict doc diversity,

}

const DEFAULT_RERANKER_CONFIG: RerankerConfig = {

const DEFAULT_CONFIG: RerankerConfig = {

  topK: 8,  topK: 8,  enforceDistinctDocs?: boolean;

  maxTokens: 3000,

  mmrLambda: 0.7,  maxTokens: 3000,

};

  mmrLambda: 0.7,  maxPerDocPhase1?: number; * then pack to a token budget.

const estimateTokens = (s: string) => Math.floor((s?.length ?? 0) / 4);

};

const getDistinctDocCount = (chunks: Chunk[]): number => {

  const ids = new Set(chunks.map(c => c.docId ?? (c as any).doc_id ?? 'UNK'));  minDistinctDocs?: number;

  return ids.size;

};export interface RerankerResult {



export function rerankChunks(  chunks: Chunk[];  enforceDistinctFirst?: boolean;export interface RerankerConfig { */

  chunks: Chunk[],

  config: Partial<RerankerConfig> = {}  rerankedBy: 'relevance';

): RerankerResult {

  const cfg = { ...DEFAULT_CONFIG, ...config };  originalCount: number;  query?: string;



  if (!chunks?.length) {  finalCount: number;

    return {

      chunks: [],  distinctDocIds: number;  mmrLambda?: number;  topK: number;import type { Chunk } from '../../types/rag';

      rerankedBy: 'relevance',

      originalCount: 0,  totalTokens: number;

      finalCount: 0,

      distinctDocIds: 0,  droppedChunks: number;}

      totalTokens: 0,

      droppedChunks: 0,}

    };

  }  maxTokens: number;



  const packed = chunks.slice(0, cfg.topK);const estimateTokens = (s: string) => Math.floor((s?.length ?? 0) / 4);



  const totalTokens = packed.reduce(const distinctCount = (arr: { docId?: string; doc_id?: string }[]) =>const DEFAULT_RERANKER_CONFIG: RerankerConfig = {

    (acc, c) => acc + (c.metadata?.tokenCount ?? estimateTokens(c.content ?? '')),

    0  new Set(arr.map(c => (c.docId ?? (c as any).doc_id ?? 'UNK'))).size;

  );

  topK: 8,  enforceDistinctDocs?: boolean;export interface RerankerConfig {

  return {

    chunks: packed,function termCoverage(query: string, text: string): number {

    rerankedBy: 'relevance',

    originalCount: chunks.length,  if (!query) return 0;  maxTokens: 3000,

    finalCount: packed.length,

    distinctDocIds: getDistinctDocCount(packed),  const q = query.toLowerCase();

    totalTokens,

    droppedChunks: chunks.length - packed.length,  const t = (text || '').toLowerCase();  minDistinctDocs: 6,  maxPerDocPhase1?: number;  topK: number;

  };

}  const tok = (s: string) => s.split(/\W+/).filter(Boolean);



export function buildContextFromReranked(chunks: Chunk[], maxTokens = 3000): string {  const qToks = tok(q);  mmrLambda: 0.7,

  let context = '';

  let tokensUsed = 0;  const tSet = new Set(tok(t));

  let idx = 0;

  if (!qToks.length) return 0;};  minDistinctDocs?: number;  maxTokens: number;

  for (const chunk of chunks) {

    const tokens = chunk.metadata?.tokenCount ?? estimateTokens(chunk.content ?? '');  const freq: Record<string, number> = {};

    if (tokensUsed + tokens > maxTokens) break;

  for (const w of qToks) freq[w] = (freq[w] ?? 0) + 1;

    const title = chunk.title ?? '';

    const content = chunk.content ?? '';  const N = qToks.length;

    idx += 1;

    context += `\n[${idx}] ${title}\n${content}\n`;  let idfHit = 0, idfMax = 0;export interface RerankerResult {  enforceDistinctFirst?: boolean;  enforceDistinctDocs: boolean;

    tokensUsed += tokens;

  }  for (const w of qToks) {



  return context.trim();    const idf = Math.log(1 + N / (1 + freq[w]));  chunks: Chunk[];

}

    idfMax += idf;

export function calculateDiversity(chunks: Chunk[]): number {

  return chunks.length ? getDistinctDocCount(chunks) / chunks.length : 0;    if (tSet.has(w)) idfHit += idf;  rerankedBy: "relevance";  query?: string;  maxPerDocPhase1?: number;   // hard cap per doc in phase-1

}

  }

export function logRerankingDetails(): void {

  // Placeholder  return idfMax > 0 ? idfHit / idfMax : 0;  originalCount: number;

}

}

  finalCount: number;  mmrLambda?: number;  minDistinctDocs?: number;    // breadth target before fill

export function rerankChunks(

  chunks: Chunk[],  distinctDocIds: number;

  config: Partial<RerankerConfig> = {}

): RerankerResult {  totalTokens: number;}  enforceDistinctFirst?: boolean;

  const cfg: RerankerConfig = { ...DEFAULT_RERANKER_CONFIG, ...config };

  if (!chunks?.length) {  droppedChunks: number;

    return {

      chunks: [],}  query?: string;              // raw user query

      rerankedBy: 'relevance',

      originalCount: 0,

      finalCount: 0,

      distinctDocIds: 0,const norm = (v: number, lo: number, hi: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);const DEFAULT_RERANKER_CONFIG: RerankerConfig = {  mmrLambda?: number;          // 0..1, higher = more relevance, lower = more diversity

      totalTokens: 0,

      droppedChunks: 0,const estimateTokens = (s: string) => Math.floor((s?.length ?? 0) / 4);

    };

  }const distinctCount = (arr: { docId?: string; doc_id?: string }[]) =>  topK: 8,  minRelevanceScore?: number;  // optional floor (0..1 after normalization)



  const packed = chunks.slice(0, cfg.topK);  new Set(arr.map(c => (c.docId ?? (c as any).doc_id ?? "UNK"))).size;

  const msg = `[RERANKER] Packed: ${packed.length} chunks`;

  console.log(msg);  maxTokens: 3000,}



  const finalTokens = packed.reduce(function termCoverage(query: string, text: string): number {

    (acc, c) => acc + (c.metadata?.tokenCount ?? estimateTokens(c.content ?? '')),

    0  if (!query) return 0;  minDistinctDocs: 6,

  );

  const q = query.toLowerCase();

  const result: RerankerResult = {

    chunks: packed,  const t = (text || "").toLowerCase();  mmrLambda: 0.7,const DEFAULT_RERANKER_CONFIG: RerankerConfig = {

    rerankedBy: 'relevance',

    originalCount: chunks.length,

    finalCount: packed.length,

    distinctDocIds: distinctCount(packed),  const facetPhrases: Array<[RegExp, number]> = [};  topK: 8,

    totalTokens: finalTokens,

    droppedChunks: chunks.length - packed.length,    [/\bdental\b/g, 2.2],

  };

    [/\bcoverage\b/g, 2.0],  maxTokens: 3000,

  return result;

}    [/\bppo\b/g, 1.6],



export function buildContextFromReranked(chunks: Chunk[], maxTokens = 3000): string {    [/\bhmo\b/g, 1.4],export interface RerankerResult {  enforceDistinctDocs: true,

  let s = '', used = 0, i = 0;

  for (const c of chunks) {    [/\bdelta\s+dental\b/g, 1.8],

    const t = c.metadata?.tokenCount ?? estimateTokens(c.content ?? '');

    if (used + t > maxTokens) break;    [/\bannual\s+max(imum)?\b/g, 1.6],  chunks: Chunk[];  maxPerDocPhase1: 1,

    const idx = ++i;

    const title = c.title ?? '';    [/\bdeductible\b/g, 2.0],

    const content = c.content ?? '';

    s += `\n[${idx}] ${title}\n${content}\n`;    [/\bcopay\b/g, 1.8],  rerankedBy: 'relevance';  minDistinctDocs: 6,

    used += t;

  }    [/\bcoinsurance\b/g, 1.8],

  return s.trim();

}    [/\bwaiting\s+period\b/g, 1.6],  originalCount: number;  enforceDistinctFirst: true,



export function calculateDiversity(chunks: Chunk[]): number {    [/\bpreventive\b/g, 1.5],

  return chunks.length ? distinctCount(chunks) / chunks.length : 0;

}    [/\bbasic\b/g, 1.2],  finalCount: number;  mmrLambda: 0.7,



export function logRerankingDetails(_: Chunk[], __: RerankerResult): void {}    [/\bmajor\b/g, 1.2],


    [/\borth(o|odontic)\b/g, 1.6],  distinctDocIds: number;};

    [/\bnetwork\b/g, 1.4],

  ];  totalTokens: number;



  let facetScore = 0;  droppedChunks: number;export interface RerankerResult {

  for (const [re, weight] of facetPhrases) {

    if (re.test(t)) facetScore += weight;}  chunks: Chunk[];

  }

  const facetMax = facetPhrases.reduce((acc, [, w]) => acc + w, 0);  rerankedBy: 'relevance';

  const facetNorm = facetMax > 0 ? Math.min(1, facetScore / facetMax) : 0;

const norm = (v: number, lo: number, hi: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);  originalCount: number;

  const tok = (s: string) => s.split(/\W+/).filter(Boolean);

  const qToks = tok(q);const estimateTokens = (s: string) => Math.floor((s?.length ?? 0) / 4);  finalCount: number;

  const tSet = new Set(tok(t));

  if (!qToks.length) return facetNorm;const distinctCount = (arr: { docId?: string; doc_id?: string }[]) =>  distinctDocIds: number;



  const freq: Record<string, number> = {};  new Set(arr.map(c => (c.docId ?? (c as any).doc_id ?? 'UNK'))).size;  totalTokens: number;

  for (const w of qToks) freq[w] = (freq[w] ?? 0) + 1;

  droppedChunks: number;

  const N = qToks.length;

  let idfHit = 0, idfMax = 0;/** Coverage score: dental/benefits facets + IDF weighting + lexical overlap fallback. */}

  for (const w of qToks) {

    const idf = Math.log(1 + N / (1 + freq[w]));function termCoverage(query: string, text: string): number {

    idfMax += idf;

    if (tSet.has(w)) idfHit += idf;  if (!query) return 0;const norm = (v: number, lo: number, hi: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);

  }

  const idfNorm = idfMax > 0 ? idfHit / idfMax : 0;  const q = query.toLowerCase();const estimateTokens = (s: string) => Math.floor((s?.length ?? 0) / 4);



  return 0.6 * facetNorm + 0.4 * idfNorm;  const t = (text || '').toLowerCase();const distinctCount = (arr: { docId?: string; doc_id?: string }[]) =>

}

  new Set(arr.map(c => (c.docId ?? (c as any).doc_id ?? 'UNK'))).size;

function simOverlap(a: string, b: string): number {

  const A = new Set((a || "").toLowerCase().split(/\W+/).filter(Boolean));  const facetPhrases: Array<[RegExp, number]> = [

  const B = new Set((b || "").toLowerCase().split(/\W+/).filter(Boolean));

  if (!A.size || !B.size) return 0;    [/\bdental\b/g, 2.2],// Helper to check for dental-related terms

  let inter = 0;

  for (const w of A) if (B.has(w)) inter++;    [/\bcoverage\b/g, 2.0],const hasDental = (text: string) => /\bdental\b|\bdelta\b|\bortho/i.test(text);

  return inter / Math.max(1, Math.min(A.size, B.size));

}    [/\bppo\b/g, 1.6],



type Scored = Chunk & { _score: number; _cov: number; _bm: number; _ve: number };    [/\bhmo\b/g, 1.4],/** Coverage score: dental/benefits facets + IDF weighting + lexical overlap fallback. */



export function rerankChunks(    [/\bdelta\s+dental\b/g, 1.8],function termCoverage(query: string, text: string): number {

  chunks: Chunk[],

  config: Partial<RerankerConfig> = {}    [/\bannual\s+max(imum)?\b/g, 1.6],  if (!query) return 0;

): RerankerResult {

  const cfg: RerankerConfig = { ...DEFAULT_RERANKER_CONFIG, ...config };    [/\bdeductible\b/g, 2.0],  const q = query.toLowerCase();

  const qtext = (cfg.query || "").trim();

    [/\bcopay\b/g, 1.8],  const t = (text || '').toLowerCase();

  if (!chunks?.length) {

    return {    [/\bcoinsurance\b/g, 1.8],

      chunks: [],

      rerankedBy: "relevance",    [/\bwaiting\s+period\b/g, 1.6],  const facetPhrases: Array<[RegExp, number]> = [

      originalCount: 0,

      finalCount: 0,    [/\bpreventive\b/g, 1.5],    [/\bdental\b/g, 2.2],

      distinctDocIds: 0,

      totalTokens: 0,    [/\bbasic\b/g, 1.2],    [/\bcoverage\b/g, 2.0],

      droppedChunks: 0,

    };    [/\bmajor\b/g, 1.2],    [/\bppo\b/g, 1.6],

  }

    [/\borth(o|odontic)\b/g, 1.6],    [/\bhmo\b/g, 1.4],

  const bmVals = chunks.map(c => c.metadata?.bm25Score ?? 0);

  const veVals = chunks.map(c => c.metadata?.vectorScore ?? 0);    [/\bnetwork\b/g, 1.4],    [/\bdelta\s+dental\b/g, 1.8],

  const bmMin = Math.min(...bmVals), bmMax = Math.max(...bmVals);

  const veMin = Math.min(...veVals), veMax = Math.max(...veVals);  ] as any;    [/\bannual\s+max(imum)?\b/g, 1.6],



  const scored: Scored[] = chunks.map((c) => {    [/\bdeductible\b/g, 2.0],

    const body = `${c.title ?? ""} ${c.sectionPath ?? ""} ${c.content ?? ""}`;

    const coverage = termCoverage(qtext, body);  let facetScore = 0;    [/\bcopay\b/g, 1.8],

    const bm = norm(c.metadata?.bm25Score ?? 0, bmMin, bmMax);

    const ve = norm(c.metadata?.vectorScore ?? 0, veMin, veMax);  for (const [re, w] of facetPhrases) {    [/\bcoinsurance\b/g, 1.8],

    const relFlag = ((c.metadata?.rrfScore ?? 0) + (c.metadata?.relevanceScore ?? 0)) > 0 ? 0.05 : 0;

    const score = 0.35 * bm + 0.15 * ve + 0.50 * coverage + relFlag;    if ((re as RegExp).test(t)) facetScore += w as number;    [/\bwaiting\s+period\b/g, 1.6],

    return Object.assign({}, c, { _score: score, _cov: coverage, _bm: bm, _ve: ve });

  });  }    [/\bpreventive\b/g, 1.5],



  scored.sort((a, b) => b._score - a._score);  const facetMax = facetPhrases.reduce((acc, [, w]) => acc + (w as number), 0);    [/\bbasic\b/g, 1.2],



  const phase1: Scored[] = [];  const facetNorm = facetMax > 0 ? Math.min(1, facetScore / facetMax) : 0;    [/\bmajor\b/g, 1.2],

  const seen = new Set<string>();

  const minDocs = cfg.minDistinctDocs ?? 6;    [/\borth(o|odontic)\b/g, 1.6],

  

  for (const s of scored) {  const tok = (s: string) => s.split(/\W+/).filter(Boolean);    [/\bnetwork\b/g, 1.4],

    const d = s.docId ?? (s as any).doc_id ?? "UNK";

    if (seen.has(d)) continue;  const qToks = tok(q);  ];

    phase1.push(s);

    seen.add(d);  const tSet = new Set(tok(t));

    if (phase1.length >= minDocs) break;

  }  if (!qToks.length) return facetNorm;  let facetScore = 0;



  const remaining = scored.filter(s => !phase1.includes(s));  for (const [re, weight] of facetPhrases) {

  const selected: Scored[] = [...phase1];

  const lambda = cfg.mmrLambda ?? 0.7;  const freq: Record<string, number> = {};    if (re.test(t)) facetScore += weight;

  const contentOf = (c: Scored) => `${c.title ?? ""}\n${c.sectionPath ?? ""}\n${c.content ?? ""}`;

  for (const w of qToks) freq[w] = (freq[w] ?? 0) + 1;  }

  while (selected.length < cfg.topK && remaining.length) {

    let bestIdx = -1;  const facetMax = facetPhrases.length * 2.2;

    let bestScore = -Infinity;

  const N = qToks.length;  const facetNorm = facetMax > 0 ? Math.min(1, facetScore / facetMax) : 0;

    for (let i = 0; i < remaining.length; i++) {

      const c = remaining[i];  let idfHit = 0, idfMax = 0;

      const rel = c._score;

      let div = 0;  for (const w of qToks) {  const tok = (s: string) => s.split(/\W+/).filter(Boolean);

      for (const s of selected) div = Math.max(div, simOverlap(contentOf(c), contentOf(s)));

      const mmr = lambda * rel - (1 - lambda) * div;    const idf = Math.log(1 + N / (1 + freq[w]));  const qToks = tok(q);



      if (mmr > bestScore) {    idfMax += idf;  const tSet = new Set(tok(t));

        bestScore = mmr;

        bestIdx = i;    if (tSet.has(w)) idfHit += idf;  if (!qToks.length) return facetNorm;

      }

    }  }



    if (bestIdx === -1) break;  const idfNorm = idfMax > 0 ? idfHit / idfMax : 0;  const freq: Record<string, number> = {};

    const cand = remaining.splice(bestIdx, 1)[0];

    selected.push(cand);  for (const w of qToks) freq[w] = (freq[w] ?? 0) + 1;

  }

  return 0.6 * facetNorm + 0.4 * idfNorm;

  selected.sort((a, b) => b._cov - a._cov);

}  const N = qToks.length;

  const packed: Scored[] = [];

  let tokenSum = 0;  let idfHit = 0, idfMax = 0;

  const tokBudget = cfg.maxTokens;

/** Simple token-overlap similarity to curb redundancy in MMR. */  for (const w of qToks) {

  for (const s of selected) {

    const content = s.content ?? "";function simOverlap(a: string, b: string): number {    const idf = Math.log(1 + N / (1 + freq[w]));

    const t = s.metadata.tokenCount ?? estimateTokens(content);

    if (tokenSum + t > tokBudget) continue;  const A = new Set((a || '').toLowerCase().split(/\W+/).filter(Boolean));    idfMax += idf;

    packed.push(s);

    tokenSum += t;  const B = new Set((b || '').toLowerCase().split(/\W+/).filter(Boolean));    if (tSet.has(w)) idfHit += idf;

    if (packed.length >= cfg.topK) break;

  }  if (!A.size || !B.size) return 0;  }



  // Dynamic coverage-based filter  let inter = 0;  const idfNorm = idfMax > 0 ? idfHit / idfMax : 0;

  console.log(`[RERANKER][FILTER] Starting with ${packed.length} chunks`);

  const minCoverage = 0.1;  for (const w of A) if (B.has(w)) inter++;

  const filtered = packed.filter((c) => {

    const text = `${c.title ?? ""} ${c.content ?? ""}`;  return inter / Math.max(1, Math.min(A.size, B.size));  return 0.6 * facetNorm + 0.4 * idfNorm;

    const coverage = (c as any)._cov ?? termCoverage(qtext, text);

    const isRelevant = coverage >= minCoverage;}}

    const preview = text.substring(0, 80).replace(/\n/g, " ");

    console.log(`[RERANKER][FILTER] (cov=${coverage.toFixed(2)}) "${preview}..." → ${isRelevant ? "KEEP" : "DROP"}`);

    return isRelevant;

  });type Scored = Chunk & { _score: number; _cov: number; _bm: number; _ve: number };/** Simple token similarity to curb redundancy in MMR. */

  

  const finalChunks = filtered.length > 0 ? filtered : packed;function simOverlap(a: string, b: string): number {

  console.log(`[RERANKER][FILTER] Final: ${finalChunks.length} chunks`);

export function rerankChunks(  const A = new Set((a || '').toLowerCase().split(/\W+/).filter(Boolean));

  const finalTokens = finalChunks.reduce((acc, c) => acc + (c.metadata?.tokenCount ?? estimateTokens(c.content ?? "")), 0);

  chunks: Chunk[],  const B = new Set((b || '').toLowerCase().split(/\W+/).filter(Boolean));

  const result: RerankerResult = {

    chunks: finalChunks,  config: Partial<RerankerConfig> = {}  if (!A.size || !B.size) return 0;

    rerankedBy: "relevance",

    originalCount: chunks.length,): RerankerResult {  let inter = 0;

    finalCount: finalChunks.length,

    distinctDocIds: distinctCount(finalChunks),  const cfg: RerankerConfig = { ...DEFAULT_RERANKER_CONFIG, ...config };  for (const w of A) if (B.has(w)) inter++;

    totalTokens: finalTokens,

    droppedChunks: chunks.length - finalChunks.length,  const qtext = (cfg.query || '').trim();  return inter / Math.max(1, Math.min(A.size, B.size));

  };

}

  console.log(`[RERANKER] Result: ${result.finalCount} chunks, ${result.distinctDocIds} docs, ~${result.totalTokens} tokens`);

  if (!chunks?.length) {

  return result;

}    return {export function rerankChunks(



export function buildContextFromReranked(chunks: Chunk[], maxTokens = 3000): string {      chunks: [], rerankedBy: 'relevance', originalCount: 0, finalCount: 0,  chunks: Chunk[],

  let s = "", used = 0, i = 0;

  for (const c of chunks) {      distinctDocIds: 0, totalTokens: 0, droppedChunks: 0,  config: Partial<RerankerConfig> = {}

    const t = c.metadata?.tokenCount ?? estimateTokens(c.content ?? "");

    if (used + t > maxTokens) break;    };): RerankerResult {

    s += `\n[${++i}] ${c.title ?? ""}\n${c.content ?? ""}\n`;

    used += t;  }  const cfg: RerankerConfig = { ...DEFAULT_RERANKER_CONFIG, ...config };

  }

  console.log(`[RERANKER] Context built: ${chunks.length} chunks, ~${used} tokens`);

  return s.trim();

}  const bmVals = chunks.map(c => c.metadata?.bm25Score ?? 0);  if (!chunks?.length) {



export function calculateDiversity(chunks: Chunk[]): number {  const veVals = chunks.map(c => c.metadata?.vectorScore ?? 0);    return {

  return chunks.length ? distinctCount(chunks) / chunks.length : 0;

}  const bmMin = Math.min(...bmVals), bmMax = Math.max(...bmVals);      chunks: [],



export function logRerankingDetails(_: Chunk[], __: RerankerResult): void {  const veMin = Math.min(...veVals), veMax = Math.max(...veVals);      rerankedBy: 'relevance',

  // Stub for compatibility

}      originalCount: 0,


  const scored: Scored[] = chunks.map((c) => {      finalCount: 0,

    const body = `${c.title ?? ''} ${c.sectionPath ?? ''} ${c.content ?? ''}`;      distinctDocIds: 0,

    const coverage = termCoverage(qtext, body);      totalTokens: 0,

    const bm = norm(c.metadata?.bm25Score ?? 0, bmMin, bmMax);      droppedChunks: 0,

    const ve = norm(c.metadata?.vectorScore ?? 0, veMin, veMax);    };

    const relFlag = ((c.metadata?.rrfScore ?? 0) + (c.metadata?.relevanceScore ?? 0)) > 0 ? 0.05 : 0;  }

    const score = 0.35 * bm + 0.15 * ve + 0.50 * coverage + relFlag;

    return Object.assign({}, c, { _score: score, _cov: coverage, _bm: bm, _ve: ve });  const bmVals = chunks.map(c => c.metadata?.bm25Score ?? 0);

  });  const veVals = chunks.map(c => c.metadata?.vectorScore ?? 0);

  const bmMin = Math.min(...bmVals), bmMax = Math.max(...bmVals);

  scored.sort((a, b) => b._score - a._score);  const veMin = Math.min(...veVals), veMax = Math.max(...veVals);



  const phase1: Scored[] = [];  type Scored = Chunk & { _score: number; _cov: number; _bm: number; _ve: number };

  const seen = new Set<string>();  const scored: Scored[] = chunks.map((c) => {

  const minDocs = (cfg.minDistinctDocs ?? 6);    const body = `${c.title ?? ''} ${c.sectionPath ?? ''} ${c.content ?? ''}`;

  const remainingForPhase2: Scored[] = [];    const coverage = termCoverage(cfg.query || '', body);

      const bm = norm(c.metadata?.bm25Score ?? 0, bmMin, bmMax);

  for (const s of scored) {    const ve = norm(c.metadata?.vectorScore ?? 0, veMin, veMax);

    const d = (s.docId ?? (s as any).doc_id ?? 'UNK');    const relFlag = ((c.metadata?.rrfScore ?? 0) + (c.metadata?.relevanceScore ?? 0)) > 0 ? 0.05 : 0;

    if (seen.has(d)) {    const score = 0.35 * bm + 0.15 * ve + 0.50 * coverage + relFlag;

      remainingForPhase2.push(s);    return Object.assign({}, c, { _score: score, _cov: coverage, _bm: bm, _ve: ve });

      continue;  });

    }

    phase1.push(s);  scored.sort((a, b) => b._score - a._score);

    seen.add(d);

    if (phase1.length >= minDocs) break;  const phase1: Scored[] = [];

  }  const seen = new Set<string>();

  const phaseTarget = cfg.minDistinctDocs ?? 6;

  const phase1Ids = new Set(phase1.map(p => (p as any).id ?? p.chunk_id));  const pool = [...scored];

  for(const s of scored) {  while (phase1.length < phaseTarget && pool.length) {

    if (!phase1Ids.has((s as any).id ?? s.chunk_id) && !remainingForPhase2.some(p => ((p as any).id ?? p.chunk_id) === ((s as any).id ?? s.chunk_id))) {    const candidate = pool.shift()!;

      remainingForPhase2.push(s);    const doc = candidate.docId ?? (candidate as any).doc_id ?? 'UNK';

    }    if (seen.has(doc)) continue;

  }    phase1.push(candidate);

    seen.add(doc);

  const remaining = remainingForPhase2;  }

  const selected: Scored[] = [...phase1];

  const lambda = cfg.mmrLambda ?? 0.7;  const selected: Scored[] = [...phase1];

  const contentOf = (c: Scored) => `${c.title ?? ''}\n${c.sectionPath ?? ''}\n${c.content ?? ''}`;  const remaining = pool;

  const lambda = cfg.mmrLambda ?? 0.7;

  while (selected.length < cfg.topK && remaining.length) {  const contentOf = (c: Scored) => `${c.title ?? ''}\n${c.sectionPath ?? ''}\n${c.content ?? ''}`;

    let bestIdx = -1;  let tokenSum = selected.reduce((sum, s) => sum + (s.metadata?.tokenCount ?? estimateTokens(s.content ?? '')), 0);

    let bestScore = -Infinity;  const tokBudget = cfg.maxTokens;



    for (let i = 0; i < remaining.length; i++) {  while (selected.length < cfg.topK && remaining.length) {

      const c = remaining[i];    let bestIdx = -1;

      const rel = c._score;     let bestScore = -Infinity;

      let div = 0;

      for (const s of selected) div = Math.max(div, simOverlap(contentOf(c), contentOf(s)));    for (let i = 0; i < remaining.length; i++) {

      const mmr = lambda * rel - (1 - lambda) * div;      const cand = remaining[i];

      const rel = cand._score;

      if (mmr > bestScore) {      let div = 0;

        bestScore = mmr;      for (const prev of selected) {

        bestIdx = i;        div = Math.max(div, simOverlap(contentOf(cand), contentOf(prev)));

      }      }

    }      const mmr = lambda * rel - (1 - lambda) * div;

      if (mmr > bestScore) {

    if (bestIdx === -1) break;        bestScore = mmr;

    const cand = remaining.splice(bestIdx, 1)[0];        bestIdx = i;

    selected.push(cand);      }

  }    }



  selected.sort((a, b) => b._cov - a._cov);    const cand = remaining.splice(bestIdx, 1)[0];

    const tokens = cand.metadata?.tokenCount ?? estimateTokens(cand.content ?? '');

  const packed: Scored[] = [];    if (tokenSum + tokens > tokBudget) break;

  let tokenSum = 0;

  const tokBudget = cfg.maxTokens;    if (cfg.enforceDistinctDocs) {

        const doc = cand.docId ?? (cand as any).doc_id ?? 'UNK';

  for (const s of selected) {      const already = selected.find(s => (s.docId ?? (s as any).doc_id) === doc);

    const content = s.content ?? '';      if (already && distinctCount(selected) < phaseTarget) continue;

    const t = s.metadata.tokenCount ?? estimateTokens(content);    }

    if (tokenSum + t > tokBudget) continue;

    packed.push(s);    selected.push(cand);

    tokenSum += t;    tokenSum += tokens;

    if (packed.length >= cfg.topK) break;  }

  }

  selected.sort((a, b) => b._cov - a._cov);

  // +++ START: Hard Filter (DYNAMIC LOGIC) +++

  console.log(`[RERANKER][FILTER] Starting with ${packed.length} chunks`);  const packed: Scored[] = [];

  const minCoverage = 0.1; // Filter chunks with less than 10% query coverage  let usedTokens = 0;

  const filtered = packed.filter((c, idx) => {  for (const item of selected) {

    const text = `${c.title ?? ''} ${c.content ?? ''}`;    const tokens = item.metadata?.tokenCount ?? estimateTokens(item.content ?? '');

    const coverage = (c as any)._cov ?? termCoverage(qtext, text); // Use stored coverage    if (usedTokens + tokens > tokBudget) continue;

    const isRelevant = coverage >= minCoverage;    packed.push(item);

    const preview = text.substring(0, 80).replace(/\n/g, ' ');    usedTokens += tokens;

    console.log(`[RERANKER][FILTER] [${idx}] (cov=${coverage.toFixed(2)}) "${preview}..." → ${isRelevant ? '✅ KEEP' : '❌ DROP'}`);    if (packed.length >= cfg.topK) break;

    return isRelevant;  }

  });

  console.log(`[RERANKER][FILTER] After filter: ${filtered.length} chunks remain`);  // +++ START: Smart Query-Aware Filter +++

  const finalChunks = filtered.length > 0 ? filtered : packed; // Fallback to packed list if filter is too aggressive  // Only apply strict dental filtering if the query is about dental benefits

  console.log(`[RERANKER][FILTER] Final: using ${finalChunks.length} chunks (fallback=${filtered.length === 0})`);  const isDentalQuery = cfg.query ? /\bdental\b|\bdentist\b|\bortho\b|\bbraces\b/i.test(cfg.query) : false;

  // +++ END: Hard Filter +++  

  console.log(`[RERANKER][FILTER] Query-aware filter: isDentalQuery=${isDentalQuery} (query="${cfg.query}")`);

  const finalTokens = finalChunks.reduce((acc, c) => acc + (c.metadata?.tokenCount ?? estimateTokens(c.content ?? '')), 0);  console.log(`[RERANKER][FILTER] Starting with ${packed.length} chunks`);

  

  const result: RerankerResult = {  const filtered = isDentalQuery 

    chunks: finalChunks,    ? packed.filter((c, idx) => {

    rerankedBy: 'relevance',        const text = `${c.title ?? ''} ${c.content ?? ''}`;

    originalCount: chunks.length,        const isDental = hasDental(text); // Strict dental filter only for dental queries

    finalCount: finalChunks.length,        const preview = text.substring(0, 80).replace(/\n/g, ' ');

    distinctDocIds: distinctCount(finalChunks),        console.log(`[RERANKER][FILTER] [${idx}] "${preview}..." → ${isDental ? '✅ KEEP' : '❌ DROP'}`);

    totalTokens: finalTokens,        return isDental;

    droppedChunks: chunks.length - finalChunks.length,      })

  };    : packed; // No filtering for non-dental queries (accept all relevant chunks)

  

  console.log(`[RERANKER] Result: ${result.finalCount} chunks, ${result.distinctDocIds} docs, ~${result.totalTokens} tokens (dropped ${result.droppedChunks})`);  console.log(`[RERANKER][FILTER] After filter: ${filtered.length} chunks remain`);

  console.log('[RERANKER][DEBUG] ================================');  const finalChunks = filtered.length > 0 ? filtered : packed;

  console.log(`[RERANKER][DEBUG] Input: ${chunks.length} chunks`);  console.log(`[RERANKER][FILTER] Final: using ${finalChunks.length} chunks (fallback=${filtered.length === 0}, dentalFilter=${isDentalQuery})`);

  console.log(`[RERANKER][DEBUG] Output: ${result.finalCount} chunks from ${result.distinctDocIds} docs`);  // +++ END: Smart Query-Aware Filter +++

  console.log(`[RERANKER][DEBUG] Tokens: ~${result.totalTokens}`);

  result.chunks.forEach((c, i) => {  // Recalculate token count for the final set

    const score = ((c as any)._score ?? 0).toFixed(3);  const finalTokens = finalChunks.reduce((acc, c) => acc + (c.metadata?.tokenCount ?? estimateTokens(c.content ?? '')), 0);

    const tokens = c.metadata?.tokenCount ?? estimateTokens(c.content ?? '');

    console.log(`[RERANKER][DEBUG] [${i + 1}] docId=${(c as any).docId ?? (c as any).doc_id} score=${score} tokens=${tokens}`);  const result: RerankerResult = {

  });    chunks: finalChunks,

  console.log('[RERANKER][DEBUG] ================================');    rerankedBy: 'relevance',

    originalCount: chunks.length,

  return result;    finalCount: finalChunks.length,

}    distinctDocIds: distinctCount(finalChunks),

    totalTokens: finalTokens,

export function buildContextFromReranked(chunks: Chunk[], maxTokens = 3000): string {    droppedChunks: chunks.length - finalChunks.length,

  let s = '', used = 0, i = 0;  };

  for (const c of chunks) {

    const t = c.metadata?.tokenCount ?? estimateTokens(c.content ?? '');  console.log(`[RERANKER] Result: ${result.finalCount} chunks, ${result.distinctDocIds} docs, ~${result.totalTokens} tokens (dropped ${result.droppedChunks})`);

    if (used + t > maxTokens) break;  console.log('[RERANKER][DEBUG] ================================');

    s += `\n[${++i}] ${c.title ?? ''}\n${c.content ?? ''}\n`;  console.log(`[RERANKER][DEBUG] Input: ${chunks.length} chunks`);

    used += t;  console.log(`[RERANKER][DEBUG] Output: ${result.finalCount} chunks from ${result.distinctDocIds} docs`);

  }  console.log(`[RERANKER][DEBUG] Tokens: ~${result.totalTokens}`);

  console.log(`[RERANKER] Context built: ${chunks.length} chunks, ~${used} tokens`);  result.chunks.forEach((c, i) => {

  return s.trim();    const score = ((c as any)._score ?? 0).toFixed(3);

}    const tokens = c.metadata?.tokenCount ?? estimateTokens(c.content ?? '');

    console.log(`[RERANKER][DEBUG] [${i + 1}] docId=${(c as any).docId ?? (c as any).doc_id} score=${score} tokens=${tokens}`);

export function calculateDiversity(chunks: Chunk[]): number {  });

  return chunks.length ? distinctCount(chunks) / chunks.length : 0;  console.log('[RERANKER][DEBUG] ================================');

}

  return result;

export function logRerankingDetails(_: Chunk[], __: RerankerResult): void {}

  /* compatibility stub; detailed logging already emitted in rerankChunks */

}export function buildContextFromReranked(chunks: Chunk[], maxTokens = 3000): string {

  let context = '', used = 0;
  let index = 0;
  for (const chunk of chunks) {
    const tokens = chunk.metadata?.tokenCount ?? estimateTokens(chunk.content ?? '');
    if (used + tokens > maxTokens) break;
    context += `\n[${++index}] ${chunk.title ?? ''}\n${chunk.content ?? ''}\n`;
    used += tokens;
  }
  console.log(`[RERANKER] Context built: ${chunks.length} chunks, ~${used} tokens`);
  return context.trim();
}

export function calculateDiversity(chunks: Chunk[]): number {
  return chunks.length ? distinctCount(chunks) / chunks.length : 0;
}

export function logRerankingDetails(_: Chunk[], __: RerankerResult): void {
  /* compatibility stub; detailed logging already emitted in rerankChunks */
}
