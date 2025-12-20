/**
 * Hybrid Retrieval System
 * Bootstrap Step 4: Vector + BM25 search with RRF merge and re-ranking
 */

import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import type { Chunk, RetrievalContext, RetrievalResult, HybridSearchConfig } from "../../types/rag";
import { isVitest } from '@/lib/ai/runtime';

// ============================================================================
// In-Memory Test Index (for Vitest)
// ============================================================================

type MemoryChunk = { id: string; text: string; embedding?: number[]; docId: string; companyId: string };
let memoryIndex: MemoryChunk[] = [];

export function __test_only_resetMemoryIndex() { 
  memoryIndex = []; 
}

export function __test_only_addToMemoryIndex(chunks: MemoryChunk[]) { 
  memoryIndex.push(...chunks); 
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

// ============================================================================
// Azure Search Client (Lazy Initialization)
// ============================================================================

let searchClient: any | null = null;

function ensureSearchClient(): any | null {
  if (searchClient) return searchClient;

  const endpoint = process.env.AZURE_SEARCH_ENDPOINT?.trim();
  const apiKey = (process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY)?.trim();
  // Production index locked to chunks_prod_v1 (499 docs). Do NOT use chunks_prod_v2 (3 test docs).
  const indexName = (process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || "chunks_prod_v1").trim();

  // DIAGNOSTIC: Log which index we're actually using
  console.log(`[SEARCH] Initializing client with index: ${indexName} (env: ${process.env.AZURE_SEARCH_INDEX || 'NOT_SET'})`);
  console.log(`[SEARCH] Endpoint: ${endpoint?.substring(0, 40)}..., API Key: ${apiKey ? 'SET' : 'MISSING'}`);

  if ((!endpoint || !apiKey) && !isVitest) {
    throw new Error("Azure Search credentials not configured");
  }
  
  if (!endpoint || !apiKey) {
    return null; // Vitest path: use in-memory index
  }

  searchClient = new SearchClient(
    endpoint,
    indexName,
    new AzureKeyCredential(apiKey)
  );

  return searchClient;
}

function escapeODataValue(value: string): string {
  return value.replace(/'/g, "''");
}

type ODataFilterOptions = {
  includePlanYear?: boolean;
  includeDept?: boolean;
  includeState?: boolean;
  includeCategory?: boolean;
};

function tryExtractMissingFilterField(error: unknown): string | null {
  const message = String((error as any)?.message ?? error ?? "");
  const match = message.match(/Could not find a property named '([^']+)'/i);
  return match?.[1] ?? null;
}

function isLikelyODataFilterSchemaError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? "");
  return /Parameter name:\s*\$filter/i.test(message) || /Invalid expression/i.test(message);
}

function buildODataFilter(context: RetrievalContext, options: ODataFilterOptions = {}): string {
  const companyId = context.companyId?.trim();
  if (!companyId) {
    throw new Error("companyId is required for search filters");
  }

  const {
    includePlanYear = true,
    includeDept = true,
    includeState = false,
    includeCategory = false,
  } = options;

  const filters: string[] = [`company_id eq '${escapeODataValue(companyId)}'`];
  if (includePlanYear && typeof context.planYear !== "undefined") {
    filters.push(`benefit_year eq ${context.planYear}`);
  }
  if (includeDept && context.dept) {
    const dept = escapeODataValue(context.dept.trim());
    filters.push(`(dept eq '${dept}' or dept eq 'All')`);
  }
  // Optional filters (disabled by default because current index schema may not include these fields).
  if (includeState && (context as any).state) {
    const state = escapeODataValue(String((context as any).state).trim());
    filters.push(`(state eq '${state}' or state eq 'National')`);
  }
  if (includeCategory && (context as any).category) {
    const category = escapeODataValue(String((context as any).category).trim());
    filters.push(`category eq '${category}'`);
  }
  
  return filters.join(" and ");
}

async function searchWithFilterFallback(
  client: any,
  query: string,
  context: RetrievalContext,
  baseOptions: Record<string, any>,
  logPrefix: string
): Promise<any> {
  const fullFilter = buildODataFilter(context);
  try {
    return await client.search(query, { ...baseOptions, filter: fullFilter });
  } catch (error) {
    if (!isLikelyODataFilterSchemaError(error)) {
      throw error;
    }

    const missingField = tryExtractMissingFilterField(error);
    const minimalFilter = buildODataFilter(context, { includePlanYear: false, includeDept: false });

    console.warn(
      `${logPrefix} Filter schema mismatch${missingField ? ` (missing: ${missingField})` : ""}; retrying with minimal filter. Original filter: "${fullFilter}"`
    );

    return await client.search(query, { ...baseOptions, filter: minimalFilter });
  }
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embedding for query using Azure OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  // In tests, use a deterministic lightweight embedding
  if (isVitest) {
    const vec = new Array(128).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 128] += text.charCodeAt(i) / 255;
    }
    return vec;
  }

  // Use the real Azure OpenAI service when available; provide robust fallback
  try {
    const mod = await import('@/lib/azure/openai');
    const service: any = (mod as any).azureOpenAIService;
    if (service && typeof service.generateEmbedding === 'function') {
      return await service.generateEmbedding(text);
    }
    console.warn('[Embedding] azureOpenAIService.generateEmbedding not available; using fallback embedding');
  } catch (e) {
    console.warn('[Embedding] Azure OpenAI import failed; using fallback embedding', e);
  }

  // Fallback: deterministic 128-dim embedding
  const vec = new Array(128).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 128] += text.charCodeAt(i) / 255;
  }
  return vec;
}

// ============================================================================
// Vector Search
// ============================================================================

/**
 * Retrieve top-K chunks using vector similarity
 * Uses HNSW index with cosine distance
 */
export async function retrieveVectorTopK(
  query: string,
  context: RetrievalContext,
  k: number = 24
): Promise<Chunk[]> {
  const client = ensureSearchClient();
  const startTime = Date.now();

  // In-memory fallback for tests
  if (!client && isVitest) {
    const queryVector = await generateEmbedding(query);
    const filtered = memoryIndex.filter(c => c.companyId === context.companyId);
    const scored = filtered
      .map(c => ({ 
        chunk: c, 
        score: cosineSimilarity(queryVector, c.embedding || []) 
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    
    return scored.map(s => ({
      id: s.chunk.id,
      docId: s.chunk.docId,
      companyId: s.chunk.companyId,
      sectionPath: "",
      content: s.chunk.text,
      title: "",
      position: 0,
      windowStart: 0,
      windowEnd: s.chunk.text.length,
      metadata: { tokenCount: Math.ceil(s.chunk.text.length / 4), vectorScore: s.score },
      createdAt: new Date(),
    }));
  }

  if (!client) {
    throw new Error("Azure Search client not available");
  }

  try {
    // Generate query embedding
    const queryVector = await generateEmbedding(query);

    const searchOptions = {
      vectorSearchOptions: {
        queries: [{
          kind: "vector",
          vector: queryVector,
          fields: ["content_vector"],
          kNearestNeighborsCount: k,
        }],
      },
      top: k,
      select: [
        "chunk_id",
        "doc_id",
        "document_id",
        "company_id",
        "chunk_index",
        "content",
        "metadata",
      ],
      queryType: "simple",
    };

    console.log(`[SEARCH][VECTOR] Query: "${query.substring(0, 50)}...", K: ${k}`);

    const results = await searchWithFilterFallback(
      client,
      query,
      context,
      searchOptions,
      "[SEARCH][VECTOR]"
    );

    // Convert results to Chunk objects
    const chunks: Chunk[] = [];
    for await (const result of results.results) {
      const metadata = result.document.metadata ? JSON.parse(result.document.metadata) : {};
      const chunkId = result.document.chunk_id ?? result.document.id;
      chunks.push({
        id: chunkId,
        docId: result.document.doc_id || result.document.document_id,
        companyId: result.document.company_id,
        sectionPath: metadata.fileName || "",
        content: result.document.content,
        title: metadata.title || metadata.fileName || "",
        position: result.document.chunk_index || 0,
        windowStart: 0,
        windowEnd: result.document.content.length,
        metadata: {
          tokenCount: Math.ceil(result.document.content.length / 4),
          vectorScore: result.score,
          ...parseMetadata(result.document.metadata),
        },
        createdAt: new Date(),
        score: result.score, // Overall relevance score for confidence gate
      });
    }

    const latencyMs = Date.now() - startTime;
    console.log(`[SEARCH][VECTOR] ✅ ${chunks.length} results in ${latencyMs}ms`);
    
    if (chunks.length === 0) {
      console.warn(`[SEARCH][VECTOR] ⚠️ Zero results! companyId: "${context.companyId}", Query: "${query.substring(0, 80)}"`);
    }

    return chunks;
  } catch (error) {
    console.error("Vector search failed:", error);
    throw new Error(`Vector retrieval error: ${error}`);
  }
}

// ============================================================================
// BM25 Full-Text Search
// ============================================================================

/**
 * Retrieve top-K chunks using BM25 full-text search
 * Uses Azure Search built-in BM25 scoring
 */
export async function retrieveBM25TopK(
  query: string,
  context: RetrievalContext,
  k: number = 24
): Promise<Chunk[]> {
  const client = ensureSearchClient();
  const startTime = Date.now();

  // In-memory fallback for tests (simple keyword matching)
  if (!client && isVitest) {
    const filtered = memoryIndex.filter(c => c.companyId === context.companyId);
    const queryLower = query.toLowerCase();
    const scored = filtered
      .map(c => ({
        chunk: c,
        score: c.text.toLowerCase().split(queryLower).length - 1, // Count keyword occurrences
      }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    
    return scored.map(s => ({
      id: s.chunk.id,
      docId: s.chunk.docId,
      companyId: s.chunk.companyId,
      sectionPath: "",
      content: s.chunk.text,
      title: "",
      position: 0,
      windowStart: 0,
      windowEnd: s.chunk.text.length,
      metadata: { tokenCount: Math.ceil(s.chunk.text.length / 4), bm25Score: s.score },
      createdAt: new Date(),
      score: s.score, // Overall relevance score for confidence gate
    }));
  }

  if (!client) {
    throw new Error("Azure Search client not available");
  }

  try {
    const searchOptions = {
      searchMode: "any",
      queryType: "simple",
      top: k,
      select: [
        "chunk_id",
        "doc_id",
        "document_id",
        "company_id",
        "chunk_index",
        "content",
        "metadata",
      ],
    };

    const results = await searchWithFilterFallback(
      client,
      query,
      context,
      searchOptions,
      "[SEARCH][BM25]"
    );

    // Convert results to Chunk objects
    const chunks: Chunk[] = [];
    for await (const result of results.results) {
      const metadata = result.document.metadata ? JSON.parse(result.document.metadata) : {};
      const chunkId = result.document.chunk_id ?? result.document.id;
      chunks.push({
        id: chunkId,
        docId: result.document.doc_id || result.document.document_id,
        companyId: result.document.company_id,
        sectionPath: metadata.fileName || "",
        content: result.document.content,
        title: metadata.title || metadata.fileName || "",
        position: result.document.chunk_index || 0,
        windowStart: 0,
        windowEnd: result.document.content.length,
        metadata: {
          tokenCount: metadata.tokenCount || Math.ceil(result.document.content.length / 4),
          bm25Score: result.score,
          ...metadata,
        },
        createdAt: new Date(),
        score: result.score, // Overall relevance score for confidence gate
      });
    }

    // Hard filtering is done in Azure Search via filterString; we keep a guard slice here
    let filtered = chunks.slice(0, k);

    const latencyMs = Date.now() - startTime;
    console.log(`[SEARCH][BM25] ✅ ${filtered.length} results (${chunks.length} total before filter) in ${latencyMs}ms`);
    
    if (filtered.length === 0) {
      console.warn(`[SEARCH][BM25] ⚠️ Zero results! companyId: "${context.companyId}", Query: "${query.substring(0, 80)}"`);
    }

    return filtered;
  } catch (error) {
    console.error("[SEARCH][BM25] ❌ Search failed:", error);
    throw new Error(`BM25 retrieval error: ${error}`);
  }
}

// ============================================================================
// Reciprocal Rank Fusion (RRF)
// ============================================================================

/**
 * Merge multiple result sets using Reciprocal Rank Fusion
 * RRF formula: score(chunk) = Σ(1 / (k + rank))
 * where k is a constant (default 60) and rank is 0-indexed
 * 
 * IMPORTANT: Deduplicates first, then slices only once at the end
 */
export function rrfMerge(
  resultSets: Chunk[][],
  k: number = 60,
  topN: number = 12
): Chunk[] {
  const id = (c: Chunk) => c.id ?? `${c.docId}:${c.position ?? 0}`;
  const scores = new Map<string, { chunk: Chunk; score: number }>();

  // Calculate RRF scores for each chunk across all result sets (do NOT slice before merge)
  for (const results of resultSets) {
    results.forEach((chunk, rank) => {
      const key = id(chunk);
      const rrfScore = 1 / (k + rank + 1); // rank is 0-indexed
      const existing = scores.get(key);

      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(key, {
          chunk: {
            ...chunk,
            metadata: {
              ...chunk.metadata,
              rrfScore,
            },
          },
          score: rrfScore,
        });
      }
    });
  }

  // Deduplicate and sort by RRF score, then slice only once at end
  const merged = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ chunk, score }) => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        rrfScore: score,
        relevanceScore: score, // Use RRF as relevance
      },
      score: score, // Overall score for confidence gate
    }))
    .slice(0, topN);  // ONLY slice here, after merge and dedupe

  console.log(`[RRF] Merged ${Array.from(scores.values()).length} unique chunks → top ${merged.length}`);
  return merged;
}

// ============================================================================
// Re-ranking (Stub for Cross-Encoder)
// ============================================================================

/**
 * Re-rank chunks using cross-encoder model
 * TODO: Integrate with Azure ML cross-encoder or use Azure AI Search semantic ranking
 */
export async function rerankChunks(
  query: string,
  chunks: Chunk[],
  topN: number = 8
): Promise<Chunk[]> {
  // Improved stub: sort by relevance/rrf score before slicing so LLM sees highest-ranked chunks.
  console.warn("Using simple reranking - integrate cross-encoder or semantic ranker in production");
  const score = (c: Chunk) =>
    (c.metadata.rrfScore ?? 0) +
    (c.metadata.relevanceScore ?? 0) +
    (c.metadata.vectorScore ?? 0) +
    (c.metadata.bm25Score ?? 0);

  const sorted = [...chunks].sort((a, b) => score(b) - score(a));

  // Enforce distinct-doc preference: pick at most one per doc until we reach topN or run out
  const seenDocs = new Set<string>();
  const primary: Chunk[] = [];
  const leftovers: Chunk[] = [];

  for (const c of sorted) {
    if (!seenDocs.has(c.docId)) {
      primary.push(c);
      seenDocs.add(c.docId);
      if (primary.length === topN) break;
    } else {
      leftovers.push(c);
    }
  }

  // If we still don't have enough, fill from leftovers (allows duplicates only as needed)
  const filled = primary.length >= topN
    ? primary.slice(0, topN)
    : primary.concat(leftovers.slice(0, Math.max(0, topN - primary.length)));

  return filled;
}

// ============================================================================
// Hybrid Retrieval (Main Entry Point)
// ============================================================================

/**
 * Execute hybrid retrieval: vector + BM25 + RRF merge + re-rank
 * Returns top-K most relevant chunks for query
 */
export async function hybridRetrieve(
  query: string,
  context: RetrievalContext,
  config?: Partial<HybridSearchConfig>
): Promise<RetrievalResult> {
  const startTime = Date.now();

  // Default configuration - HYBRID SEARCH with both Vector + BM25
  const cfg: HybridSearchConfig = {
    vectorK: config?.vectorK ?? 96,          // Dense vector search (semantic understanding)
    bm25K: config?.bm25K ?? 24,              // ENABLED: Keyword search (exact matching) - 24 is standard
    rrfK: config?.rrfK ?? 60,
    finalTopK: config?.finalTopK ?? 16,      // Increased from 12 to 16 for more context
    rerankedTopK: config?.rerankedTopK ?? 12, // Increased from 8 to 12 for more grounding
    enableReranking: config?.enableReranking ?? false,
  };

  try {
    // Execute hybrid search (vector + BM25)
    const vectorResultsOrError = await Promise.resolve(
      retrieveVectorTopK(query, context, cfg.vectorK)
    );

    const vectorResults = await vectorResultsOrError;
    
    // Execute BM25 search if enabled
    const bm25Results = cfg.bm25K > 0
      ? await retrieveBM25TopK(query, context, cfg.bm25K)
      : [];

    console.log(`[RAG] v=${vectorResults.length} b=${bm25Results.length} (hybrid: vector + BM25)`);
    console.log(`[RAG][DEBUG] vectorResults IDs: ${vectorResults.map(chunk => chunk.id).join(', ')}`);

    // Merge using RRF (both vector and BM25 results)
    const merged = rrfMerge(
      [vectorResults, bm25Results].filter(r => r.length > 0),
      cfg.rrfK,
      cfg.finalTopK
    );

    console.log(`[RAG] merged=${merged.length} (after RRF dedupe)`);

    // Re-rank if enabled
    const final = cfg.enableReranking
      ? await rerankChunks(query, merged, cfg.rerankedTopK)
      : merged.slice(0, cfg.rerankedTopK);

    console.log(`[RAG] final=${final.length} (reranking=${cfg.enableReranking})`);

    const countDistinctDocs = (chunks: Chunk[]) => new Set(chunks.map((chunk) => chunk.docId)).size;
    const needsMoreCoverage = (chunks: Chunk[]) => {
      if (chunks.length < 8) return true;
      return countDistinctDocs(chunks) < 8;
    };

    const logCoverage = (label: string, chunks: Chunk[]) => {
      console.log(`[RAG][GUARD] ${label}: chunks=${chunks.length} docs=${countDistinctDocs(chunks)}`);
    };

  let guardedFinal = final;
  const distinctInitial = new Set(final.map(c => c.docId)).size;
  const expansionPhases: Array<{ phase: 'expand' | 'noYear' | 'bm25Wide'; chunks: number; distinctDocs: number }> = [];
  let expansionUsed = false;
  let droppedPlanYearFilter = false;
  let bm25WideSweep = false;
    if (needsMoreCoverage(guardedFinal)) {
      console.warn('[RAG][GUARD] Low coverage detected, expanding search…');
      logCoverage('initial coverage', guardedFinal);

      const expandK = Math.max(cfg.vectorK, 80);
      const expandResults = async (ctx: RetrievalContext, k: number) => {
        const vOrError = await Promise.resolve(retrieveVectorTopK(query, ctx, k));
        const v = await vOrError;
        const merged = rrfMerge([v], cfg.rrfK, Math.max(cfg.finalTopK, 24));
        return cfg.enableReranking
          ? await rerankChunks(query, merged, Math.max(cfg.rerankedTopK, 12))
          : merged.slice(0, Math.max(cfg.rerankedTopK, 12));
      };

  guardedFinal = await expandResults(context, expandK);
  expansionUsed = true;
  expansionPhases.push({ phase: 'expand', chunks: guardedFinal.length, distinctDocs: new Set(guardedFinal.map(c => c.docId)).size });
      logCoverage('expanded coverage', guardedFinal);

      if (needsMoreCoverage(guardedFinal) && typeof context.planYear !== 'undefined') {
        console.warn('[RAG][GUARD] Still low; retrying without planYear filter');
        const contextNoYear: RetrievalContext = { ...context };
        delete (contextNoYear as any).planYear;
        guardedFinal = await expandResults(contextNoYear, expandK);
        droppedPlanYearFilter = true;
        expansionPhases.push({ phase: 'noYear', chunks: guardedFinal.length, distinctDocs: new Set(guardedFinal.map(c => c.docId)).size });
        logCoverage('no-year coverage', guardedFinal);
      }

      if (needsMoreCoverage(guardedFinal)) {
        console.warn('[RAG][GUARD] Final fallback: Vector-only wide sweep');
        const contextNoYear: RetrievalContext = { ...context };
        delete (contextNoYear as any).planYear;
        const vWide = await retrieveVectorTopK(query, contextNoYear, 150);
        const mergedWide = rrfMerge([vWide], cfg.rrfK, 32);
        guardedFinal = mergedWide.slice(0, Math.max(8, cfg.rerankedTopK));
        bm25WideSweep = true;
        expansionPhases.push({ phase: 'bm25Wide', chunks: guardedFinal.length, distinctDocs: new Set(guardedFinal.map(c => c.docId)).size });
        logCoverage('vector-wide coverage', guardedFinal);
      }
    }

    const latencyMs = Date.now() - startTime;

    return {
      chunks: guardedFinal,
      method: "hybrid",
      totalResults: vectorResults.length + bm25Results.length,
      latencyMs,
      scores: {
        vector: vectorResults.map((c) => c.metadata.vectorScore ?? 0),
        bm25: bm25Results.map((c) => c.metadata.bm25Score ?? 0),
        rrf: (guardedFinal.length ? guardedFinal : final).map((c) => c.metadata.rrfScore ?? 0),
      },
      distinctDocCountInitial: distinctInitial,
      distinctDocCountFinal: new Set(guardedFinal.map(c => c.docId)).size,
      expansionUsed,
      droppedPlanYearFilter,
      bm25WideSweep,
      expansionPhases,
    };
  } catch (error) {
    console.error("Hybrid retrieval failed:", error);
    throw error;
  }
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build context window from retrieved chunks
 * Applies token budget and diversity constraints
 */
export function buildContext(
  chunks: Chunk[],
  maxTokens: number = 2000,
  diversityByDoc: boolean = true
): string {
  let context = "";
  let tokenCount = 0;
  const seenDocs = new Set<string>();

  for (const chunk of chunks) {
    // Diversity constraint: prefer chunks from different docs
    if (diversityByDoc && seenDocs.has(chunk.docId) && seenDocs.size < chunks.length / 2) {
      continue;
    }

    // Check token budget
    const chunkTokens = chunk.metadata.tokenCount || Math.ceil(chunk.content.length / 4);
    if (tokenCount + chunkTokens > maxTokens) {
      break;
    }

    // Add chunk to context
    context += `\n[Source: ${chunk.title} - ${chunk.sectionPath}]\n`;
    context += chunk.content;
    context += "\n";

    tokenCount += chunkTokens;
    seenDocs.add(chunk.docId);
  }

  console.log(`Context built: ${tokenCount} tokens from ${seenDocs.size} docs`);
  return context.trim();
}

/**
 * Calculate coverage: what % of query terms appear in top chunks
 */
export function calculateCoverage(query: string, chunks: Chunk[]): number {
  const queryTerms = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2)
  );

  if (queryTerms.size === 0) return 0;

  const allContent = chunks.map((c) => c.content.toLowerCase()).join(" ");
  let foundTerms = 0;

  for (const term of queryTerms) {
    if (allContent.includes(term)) {
      foundTerms++;
    }
  }

  return foundTerms / queryTerms.size;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse metadata JSON string from Azure Search
 */
function parseMetadata(metadataStr: string | undefined): Record<string, any> {
  if (!metadataStr) return {};
  try {
    return JSON.parse(metadataStr);
  } catch {
    return {};
  }
}

/**
 * Format retrieval result for logging
 */
export function formatRetrievalResult(result: RetrievalResult): string {
  return [
    `Method: ${result.method}`,
    `Chunks: ${result.chunks.length}`,
    `Latency: ${result.latencyMs}ms`,
    `Coverage: ${result.chunks.length > 0 ? "calculated separately" : "0%"}`,
  ].join(" | ");
}
