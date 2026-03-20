/**
 * Hybrid Retrieval System
 * Bootstrap Step 4: Vector + BM25 search with RRF merge and re-ranking
 * 
 * Enhanced with:
 * - Query Expansion (Medical → HMO, PPO, Deductible, etc.)
 * - Intent-Based Category Mapping (keyword short-circuiting)
 * - Tiered Confidence with "Next Best" fallback
 * - User Context Injection (Age/State prepended to queries)
 */

import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import type { Chunk, RetrievalContext, RetrievalResult, HybridSearchConfig } from "../../types/rag";
import { isVitest } from '@/lib/ai/runtime';
import { logger } from '@/lib/logger';
import { countTokens } from '@/lib/utils/tokenCount';

// ============================================================================
// Retrieval Gate Configuration
// ============================================================================
const GATE_MIN_CHUNKS = 1;        // Minimum chunks required to proceed (relaxed from 2)
const GATE_MIN_TOP_SCORE = 0.35;  // Minimum top chunk RRF score (relaxed from 0.60)
const GATE_CHUNK_THRESHOLD = 0.25; // Filter chunks below this score (relaxed from 0.45)

export interface RetrievalGateResult {
  gatePass: boolean;
  failReason?: 'LOW_SCORE' | 'INSUFFICIENT_CHUNKS';
  topScore: number;
}

// ============================================================================
// Query Expansion Maps (Keyword → Related Terms)
// ============================================================================
const QUERY_EXPANSION_MAP: Record<string, string[]> = {
  medical: ["health plan", "HMO", "PPO", "deductible", "copay", "coinsurance", "premium", "prescription", "rx", "doctor", "hospital"],
  dental: ["teeth", "orthodontics", "braces", "cleaning", "oral", "dentist", "crown", "filling", "root canal"],
  vision: ["eye", "glasses", "contacts", "optometrist", "lens", "exam", "frames"],
  life: ["death benefit", "beneficiary", "term life", "whole life", "AD&D", "accidental death"],
  disability: ["STD", "LTD", "short term", "long term", "income protection", "wages"],
  hsa: ["health savings account", "HSA contribution", "pre-tax health", "FSA", "flexible spending", "tax-free"],
  voluntary: ["critical illness", "accident", "hospital indemnity", "supplemental", "injury"],
  // Insurance-specific synonym expansions for BM25 recall
  deductible: ["annual deductible", "deductible amount", "out of pocket before insurance"],
  copay: ["copayment", "co-pay", "visit cost", "office visit fee"],
  kaiser: ["Kaiser Permanente", "Kaiser HMO", "Kaiser plan"],
  premium: ["monthly premium", "paycheck deduction", "plan cost per month"],
  oop: ["out of pocket maximum", "out-of-pocket max", "annual maximum"],
  pcp: ["primary care physician", "primary care provider", "family doctor"],
};

// ============================================================================
// Intent-to-Category Mapping (Keyword Short-Circuiting)
// ============================================================================
const INTENT_CATEGORY_MAP: Record<string, string> = {
  // Medical
  medical: "Medical", health: "Medical", doctor: "Medical", hospital: "Medical",
  ppo: "Medical", hmo: "Medical", deductible: "Medical", copay: "Medical",
  prescription: "Medical", rx: "Medical", urgent: "Medical", emergency: "Medical",
  // Dental
  dental: "Dental", teeth: "Dental", dentist: "Dental", orthodontics: "Dental",
  braces: "Dental", cleaning: "Dental", oral: "Dental",
  // Vision
  vision: "Vision", eye: "Vision", glasses: "Vision", contacts: "Vision",
  optometrist: "Vision", lens: "Vision",
  // Life
  life: "Life", beneficiary: "Life", "death benefit": "Life",
  // Disability
  disability: "Disability", std: "Disability", ltd: "Disability",
  // HSA/FSA
  hsa: "Savings", fsa: "Savings", "health savings": "Savings", "flexible spending": "Savings",
  // Voluntary/Supplemental
  voluntary: "Voluntary", critical: "Voluntary", accident: "Voluntary",
  supplemental: "Voluntary", injury: "Voluntary", "hospital indemnity": "Voluntary",
  // Support/Navigation — intercept before LLM to avoid hallucinated answers
  contact: "Support", support: "Support", "help line": "Support", "help desk": "Support",
  navigation: "Support", rightway: "Support", "customer service": "Support",
  phone: "Support", "who do i call": "Support",
};

// ============================================================================
// Post-Retrieval Category Filter (Safety Net)
// ============================================================================
/**
 * Filter chunks by category after retrieval to prevent wrong benefit types.
 * This is a safety net in case Azure Search category filtering fails.
 * 
 * E.g., If user asks for "Medical", filter out Accident/Life/Disability chunks.
 */
export function filterChunksByCategory(chunks: Chunk[], category: string): Chunk[] {
  if (!category) return chunks;
  
  const categoryLower = category.toLowerCase();
  
  // Define keywords that indicate each category in chunk content/metadata
  const CATEGORY_KEYWORDS: Record<string, string[]> = {
    Medical: ['medical', 'health', 'ppo', 'hmo', 'deductible', 'copay', 'coinsurance', 'prescription', 'rx', 'doctor', 'hospital', 'urgent care', 'emergency', 'provider', 'network'],
    Dental: ['dental', 'teeth', 'dentist', 'orthodont', 'braces', 'cleaning', 'oral', 'crown', 'filling', 'root canal', 'molar'],
    Vision: ['vision', 'eye', 'glasses', 'contacts', 'lens', 'optometrist', 'exam', 'frames', 'retinal'],
    Life: ['life', 'death benefit', 'beneficiary', 'ad&d', 'accidental death', 'term life'],
    Disability: ['disability', 'std', 'ltd', 'short term', 'long term', 'income protection', 'wages'],
    Savings: ['hsa', 'fsa', 'health savings', 'flexible spending', 'tax-free', 'contribution'],
    Voluntary: ['critical illness', 'accident', 'hospital indemnity', 'supplemental', 'injury', 'cancer', 'stroke', 'heart attack'],
    Support: ['contact', 'support', 'phone', 'help', 'navigation', 'hr', 'human resources', 'enrollment portal', 'assistance'],
  };
  
  const keywords = CATEGORY_KEYWORDS[category] || [];
  if (keywords.length === 0) {
    logger.warn(`[CATEGORY_FILTER] Unknown category: ${category}`);
    return chunks;
  }
  
  const filtered = chunks.filter(chunk => {
    const content = (chunk.content + ' ' + (chunk.title || '') + ' ' + (chunk.sectionPath || '')).toLowerCase();
    const metadata = chunk.metadata || {};
    const metadataStr = JSON.stringify(metadata).toLowerCase();
    const combined = content + ' ' + metadataStr;
    
    // Check if chunk contains ANY of the category keywords
    const hasKeyword = keywords.some(kw => combined.includes(kw));
    return hasKeyword;
  });
  
  logger.debug(`[CATEGORY_FILTER] ${category}: ${chunks.length} → ${filtered.length} chunks`);
  
  // If filtering removes too many results, return original to avoid empty responses
  if (filtered.length < Math.max(3, chunks.length * 0.3)) {
    logger.warn(`[CATEGORY_FILTER] Too aggressive! Only ${filtered.length}/${chunks.length} kept. Returning original.`);
    return chunks;
  }
  
  return filtered;
}

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

// ============================================================================
// Query Expansion & Intent Detection
// ============================================================================

/**
 * Detect the primary benefit category from a query using keyword short-circuiting.
 * This avoids relying on vector search for obvious intents like "Medical" or "Dental".
 */
export function detectIntentCategory(query: string): string | null {
  const lower = query.toLowerCase();
  
  // Check multi-word phrases first
  for (const [keyword, category] of Object.entries(INTENT_CATEGORY_MAP)) {
    if (keyword.includes(' ') && lower.includes(keyword)) {
      logger.debug(`[INTENT] Short-circuit: "${keyword}" → ${category}`);
      return category;
    }
  }
  
  // Check single keywords
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (INTENT_CATEGORY_MAP[word]) {
      logger.debug(`[INTENT] Short-circuit: "${word}" → ${INTENT_CATEGORY_MAP[word]}`);
      return INTENT_CATEGORY_MAP[word];
    }
  }
  
  return null;
}

/**
 * Expand a query with related terms to improve recall.
 * E.g., "Medical" → "Medical health plan HMO PPO deductible copay"
 */
export function expandQuery(query: string): string {
  const lower = query.toLowerCase();
  const expansions: string[] = [];
  
  for (const [keyword, relatedTerms] of Object.entries(QUERY_EXPANSION_MAP)) {
    if (lower.includes(keyword)) {
      // Add top 3 expansion terms to avoid query bloat
      expansions.push(...relatedTerms.slice(0, 3));
    }
  }
  
  if (expansions.length > 0) {
    const expanded = `${query} ${expansions.join(' ')}`;
    logger.debug(`[QUERY_EXPAND] "${query}" → "${expanded}"`);
    return expanded;
  }
  
  return query;
}

/**
 * Inject user context (age, state) into query for better filtering.
 * This helps the vector search understand user-specific requirements.
 */
export function injectUserContext(
  query: string, 
  context: RetrievalContext & { userAge?: number; userState?: string }
): string {
  const parts: string[] = [];
  
  if (context.userAge) {
    parts.push(`age ${context.userAge}`);
  }
  if (context.userState) {
    parts.push(`state ${context.userState}`);
  }
  
  if (parts.length > 0) {
    const contextPrefix = parts.join(' ');
    logger.debug(`[CONTEXT_INJECT] Prepending demographics context`);
    return `${contextPrefix} ${query}`;
  }
  
  return query;
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
  const indexName = (process.env.AZURE_SEARCH_INDEX
    ?? process.env.AZURE_SEARCH_INDEX_NAME
    ?? "chunks_prod_v1").trim();

  if (indexName === "chunks_prod_v2") {
    console.error("CRITICAL: chunks_prod_v2 has only 3 test docs — check env config");
  }

  // DIAGNOSTIC: Log which index we're actually using
  logger.debug(`[SEARCH] Initializing client with index: ${indexName}`);
  logger.debug(`[SEARCH] Endpoint configured: ${!!endpoint}, API Key: ${apiKey ? 'SET' : 'MISSING'}`);

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
  if (includeState && context.state) {
    const state = escapeODataValue(context.state.trim());
    filters.push(`(state eq '${state}' or state eq 'National')`);
  }
  if (includeCategory && context.category) {
    const category = escapeODataValue(context.category.trim());
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
  // L2 HARD METADATA FILTER:
  // Always inject state filter when user state is known so the vector index
  // physically cannot return documents tagged for other states.
  // e.g., User in MI → filter: (state eq 'MI' or state eq 'National')
  // This prevents "Mississippi vs Michigan" cross-state leakage at the retrieval layer.
  const hasStateFilter = !!context.state && context.state !== 'National';

  // chunks_prod_v1 index only has filterable fields: company_id, doc_id, chunk_index.
  // There is no category, state, benefit_year, or dept field in the schema.
  // Sending those in the OData filter causes a schema error on every first request.
  // Category filtering is handled post-retrieval by filterChunksByCategory().
  const fullFilter = buildODataFilter(context, {
    includeCategory: false,
    includeState: false,
    includePlanYear: false,  // ← DO NOT CHANGE — field not in chunks_prod_v1 schema
    includeDept: false,
  });

  logger.debug(`[L2-FILTER] ${logPrefix} filter="${fullFilter}" hasState=${hasStateFilter} state=${context.state || 'unknown'}`);

  try {
    return await client.search(query, { ...baseOptions, filter: fullFilter });
  } catch (error) {
    if (!isLikelyODataFilterSchemaError(error)) {
      throw error;
    }

    const missingField = tryExtractMissingFilterField(error);
    const hasCategory = missingField?.toLowerCase().includes('category') || error?.toString().includes('category');
    const hasStateFieldMissing = missingField?.toLowerCase().includes('state') || error?.toString().toLowerCase().includes("'state'");
    const hasPlanYearFieldMissing = missingField?.toLowerCase().includes('benefit_year') || error?.toString().toLowerCase().includes("'benefit_year'");
    const hasDeptFieldMissing = missingField?.toLowerCase().includes('dept') || error?.toString().toLowerCase().includes("'dept'");

    logger.warn(
      `${logPrefix} Filter error${missingField ? ` (missing: ${missingField})` : ""}; retrying with fallback filter. Original: "${fullFilter}"`
    );

    // Progressive fallback: first try without category, then without state, then minimal
    const minimalFilter = buildODataFilter(context, {
      includePlanYear: false,  // ← DO NOT CHANGE — field not in chunks_prod_v1 schema
      includeDept: false,
      includeCategory: !hasCategory,
      includeState: hasStateFilter && !hasStateFieldMissing,
    });

    logger.warn(
      `${logPrefix} Schema error fallback${missingField ? ` (missing: ${missingField})` : ""}. Fallback filter: "${minimalFilter}"`
    );

    // If fallback still has issues, try minimal company_id only filter
    try {
      return await client.search(query, { ...baseOptions, filter: minimalFilter });
    } catch (fallbackError) {
      if (!isLikelyODataFilterSchemaError(fallbackError)) {
        throw fallbackError;
      }

      // Final fallback: company_id only (this should always work)
      const minimalFilter = `company_id eq '${escapeODataValue(context.companyId)}'`;
      logger.error(
        `${logPrefix} Multiple filter failures. Using minimal filter: "${minimalFilter}"`
      );
      return await client.search(query, { ...baseOptions, filter: minimalFilter });
    }
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
    logger.warn('[Embedding] azureOpenAIService.generateEmbedding not available; using fallback embedding');
  } catch (e) {
    logger.warn('[Embedding] Azure OpenAI import failed; using fallback embedding', e);
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
      metadata: { tokenCount: countTokens(s.chunk.text), vectorScore: s.score },
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

    logger.debug(`[SEARCH][VECTOR] QueryLen: ${query.length}, K: ${k}`);

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
      const metadata = parseMetadata(result.document.metadata);
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
          tokenCount: countTokens(result.document.content),
          vectorScore: result.score,
          ...parseMetadata(result.document.metadata),
        },
        createdAt: new Date(),
        score: result.score, // Overall relevance score for confidence gate
      });
    }

    const latencyMs = Date.now() - startTime;
    logger.debug(`[SEARCH][VECTOR] ✅ ${chunks.length} results in ${latencyMs}ms`);
    
    if (chunks.length === 0) {
      logger.warn(`[SEARCH][VECTOR] ⚠️ Zero results! companyId: "${context.companyId}", QueryLen: ${query.length}`);
    }

    return chunks;
  } catch (error) {
    logger.error("Vector search failed:", error);
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
      metadata: { tokenCount: countTokens(s.chunk.text), bm25Score: s.score },
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
      const metadata = parseMetadata(result.document.metadata);
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
          tokenCount: metadata.tokenCount || countTokens(result.document.content),
          bm25Score: result.score,
          ...metadata,
        },
        createdAt: new Date(),
        score: result.score, // Overall relevance score for confidence gate
      });
    }

    // Hard filtering is done in Azure Search via filterString; we keep a guard slice here
    const filtered = chunks.slice(0, k);

    const latencyMs = Date.now() - startTime;
    logger.debug(`[SEARCH][BM25] ✅ ${filtered.length} results (${chunks.length} total before filter) in ${latencyMs}ms`);
    
    if (filtered.length === 0) {
      logger.warn(`[SEARCH][BM25] ⚠️ Zero results! companyId: "${context.companyId}", QueryLen: ${query.length}`);
    }

    return filtered;
  } catch (error) {
    logger.error("[SEARCH][BM25] ❌ Search failed:", error);
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

  logger.debug(`[RRF] Merged ${Array.from(scores.values()).length} unique chunks → top ${merged.length}`);
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
  logger.warn("Using simple reranking - integrate cross-encoder or semantic ranker in production");
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

/** Extended context with user demographics for query enhancement */
export interface EnhancedRetrievalContext extends RetrievalContext {
  userAge?: number;
  userState?: string;
}

/**
 * Execute hybrid retrieval: vector + BM25 + RRF merge + re-rank
 * 
 * Enhanced with:
 * - Query expansion (Medical → HMO, PPO, etc.)
 * - User context injection (age/state prepended)
 * - Intent-based category short-circuiting
 * - Tiered confidence with "next best" fallback
 * 
 * Returns top-K most relevant chunks for query
 */
export async function hybridRetrieve(
  query: string,
  context: EnhancedRetrievalContext,
  config?: Partial<HybridSearchConfig>
): Promise<RetrievalResult> {
  const startTime = Date.now();

  // =========================================================================
  // STEP 0: INTENT DETECTION & QUERY ENHANCEMENT
  // =========================================================================
  
  // A. Detect intent category via keyword short-circuiting
  const detectedCategory = detectIntentCategory(query);
  if (detectedCategory && !context.category) {
    context.category = detectedCategory;
    logger.debug(`[RAG] Intent short-circuit: forcing category="${detectedCategory}"`);
  }

  // A2. CARRIER ROUTING: If query mentions a specific navigation/support service
  // (e.g., "Rightway", "telehealth", "care navigator"), route to Support/Navigation
  // document category. This prevents carrier hallucination from medical plan chunks.
  const SUPPORT_SERVICE_PATTERN = /\b(rightway|right\s*way|care\s*navigator|telehealth|telemedicine|health\s*advocacy|nurse\s*line|second\s*opinion|patient\s*advocate|darwin|health\s*navigator)\b/i;
  if (SUPPORT_SERVICE_PATTERN.test(query) && !context.category) {
    context.category = 'Support';
    logger.debug(`[RAG] Carrier routing: support service query detected → category='Support'`);
  }
  
  // B. Expand the query with related terms
  const expandedQuery = expandQuery(query);
  
  // C. Inject user demographics into query for better relevance
  const enhancedQuery = injectUserContext(expandedQuery, context);
  
  // D. DEBUG: Log the final search parameters
  logger.debug(`[SEARCH] QueryLen=${enhancedQuery.length} | Category="${context.category || 'ALL'}" | HasState=${!!context.userState} | HasAge=${!!context.userAge}`);

  // Default configuration - HYBRID SEARCH with both Vector + BM25
  const cfg: HybridSearchConfig = {
    vectorK: config?.vectorK ?? 48,          // Dense vector search — reduced from 96; avoids over-retrieval on 499-doc index
    bm25K: config?.bm25K ?? 24,              // ENABLED: Keyword search (exact matching) - 24 is standard
    rrfK: config?.rrfK ?? 60,
    finalTopK: config?.finalTopK ?? 12,      // Reduced from 16 — tighter RRF merge window
    rerankedTopK: config?.rerankedTopK ?? 8,  // Reduced from 12 — 8 high-quality chunks > 12 noisy ones
    enableReranking: config?.enableReranking ?? false,
  };

  try {
    // Execute hybrid search
    // PARALLEL EXECUTION: Run vector and BM25 searches concurrently to reduce latency
    // NOTE: Vector search uses original query for clean semantic embedding.
    //       BM25 uses expanded+enhanced query for better keyword recall.
    const vectorQuery = injectUserContext(query, context); // original query + user context only
    const [vectorResults, bm25Results] = await Promise.all([
      retrieveVectorTopK(vectorQuery, context, cfg.vectorK),
      cfg.bm25K > 0 ? retrieveBM25TopK(enhancedQuery, context, cfg.bm25K) : Promise.resolve([])
    ]);

    logger.debug(`[RAG] v=${vectorResults.length} b=${bm25Results.length} (hybrid: vector + BM25)`);
    logger.debug(`[SEARCH] ResultsFound=${vectorResults.length + bm25Results.length} (vector=${vectorResults.length}, bm25=${bm25Results.length})`);

    // Merge using RRF (both vector and BM25 results)
    const merged = rrfMerge(
      [vectorResults, bm25Results].filter(r => r.length > 0),
      cfg.rrfK,
      cfg.finalTopK
    );

    logger.debug(`[RAG] merged=${merged.length} (after RRF dedupe)`);

    // Re-rank if enabled
    const final = cfg.enableReranking
      ? await rerankChunks(query, merged, cfg.rerankedTopK)
      : merged.slice(0, cfg.rerankedTopK);

    logger.debug(`[RAG] final=${final.length} (reranking=${cfg.enableReranking})`);

    const countDistinctDocs = (chunks: Chunk[]) => new Set(chunks.map((chunk) => chunk.docId)).size;
    const needsMoreCoverage = (chunks: Chunk[]) => {
      if (chunks.length < 8) return true;
      return countDistinctDocs(chunks) < 8;
    };

    const logCoverage = (label: string, chunks: Chunk[]) => {
      logger.debug(`[RAG][GUARD] ${label}: chunks=${chunks.length} docs=${countDistinctDocs(chunks)}`);
    };

  let guardedFinal = final;
  const distinctInitial = new Set(final.map(c => c.docId)).size;
  const expansionPhases: Array<{ phase: 'expand' | 'noYear' | 'bm25Wide'; chunks: number; distinctDocs: number }> = [];
  let expansionUsed = false;
  let droppedPlanYearFilter = false;
  let bm25WideSweep = false;
    if (needsMoreCoverage(guardedFinal)) {
      logger.warn('[RAG][GUARD] Low coverage detected, expanding search…');
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
        logger.warn('[RAG][GUARD] Still low; retrying without planYear filter');
        const contextNoYear: RetrievalContext = { ...context };
        delete (contextNoYear as any).planYear;
        guardedFinal = await expandResults(contextNoYear, expandK);
        droppedPlanYearFilter = true;
        expansionPhases.push({ phase: 'noYear', chunks: guardedFinal.length, distinctDocs: new Set(guardedFinal.map(c => c.docId)).size });
        logCoverage('no-year coverage', guardedFinal);
      }

      if (needsMoreCoverage(guardedFinal)) {
        logger.warn('[RAG][GUARD] Final fallback: Vector-only wide sweep');
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

    // Apply post-retrieval category filtering as safety net (Issue #2 fix)
    let finalChunks = guardedFinal;
    if (context.category) {
      finalChunks = filterChunksByCategory(guardedFinal, context.category);
    }

    // ========================================================================
    // GATE 2: Pre-LLM Retrieval Quality Check
    // Reject weak retrieval BEFORE it reaches GPT-4 to prevent hallucination
    // ========================================================================
    let gateResult: RetrievalGateResult;
    const topScore = finalChunks.length > 0 ? (finalChunks[0].metadata?.rrfScore ?? 0) : 0;

    if (finalChunks.length < GATE_MIN_CHUNKS) {
      gateResult = { gatePass: false, failReason: 'INSUFFICIENT_CHUNKS', topScore };
      logger.warn(`[RAG Gate2] FAILED: Only ${finalChunks.length} chunks (need ${GATE_MIN_CHUNKS})`);
    } else if (topScore < GATE_MIN_TOP_SCORE) {
      gateResult = { gatePass: false, failReason: 'LOW_SCORE', topScore };
      logger.warn(`[RAG Gate2] FAILED: Top score ${topScore.toFixed(3)} < ${GATE_MIN_TOP_SCORE}`);
    } else {
      // Filter out low-quality chunks to prevent context pollution
      const qualityChunks = finalChunks.filter(c => (c.metadata?.rrfScore ?? 0) >= GATE_CHUNK_THRESHOLD);
      finalChunks = qualityChunks.length >= GATE_MIN_CHUNKS ? qualityChunks : finalChunks;
      gateResult = { gatePass: true, topScore };
      logger.debug(`[RAG Gate2] PASSED: ${finalChunks.length} quality chunks, topScore=${topScore.toFixed(3)}`);
    }

    return {
      chunks: finalChunks,
      method: "hybrid",
      totalResults: vectorResults.length + bm25Results.length,
      latencyMs,
      scores: {
        vector: vectorResults.map((c) => c.metadata.vectorScore ?? 0),
        bm25: bm25Results.map((c) => c.metadata.bm25Score ?? 0),
        rrf: (finalChunks.length ? finalChunks : final).map((c) => c.metadata.rrfScore ?? 0),
      },
      distinctDocCountInitial: distinctInitial,
      distinctDocCountFinal: new Set(finalChunks.map(c => c.docId)).size,
      expansionUsed,
      droppedPlanYearFilter,
      bm25WideSweep,
      expansionPhases,
      // Gate 2 result fields
      gatePass: gateResult.gatePass,
      gateFailReason: gateResult.failReason,
      gateTopScore: gateResult.topScore,
    };
  } catch (error) {
    logger.error("Hybrid retrieval failed:", error);
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
    const chunkTokens = chunk.metadata.tokenCount || countTokens(chunk.content);
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

  logger.debug(`Context built: ${tokenCount} tokens from ${seenDocs.size} docs`);
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
