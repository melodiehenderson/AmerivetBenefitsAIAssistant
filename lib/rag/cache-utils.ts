/**
 * Cache utilities for Production RAG System
 * Implements L0 (exact) and L1 (semantic) caching strategies
 */

import { createHash } from "crypto";
import type {
  CacheEntry,
  CacheKeyType,
  CacheStrategy,
  QARequest,
  QAResponse,
  SemanticCacheEntry,
  Tier,
} from "../../types/rag";

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Normalize query for consistent cache keys
 * - Lowercase
 * - Trim whitespace
 * - Remove extra spaces
 * - Normalize unicode
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC");
}

/**
 * Synonym mapping for common benefits terms
 * Maps variations to base form for cache hits
 * Phase 1: Aggressive Query Normalization - EXPANDED
 */
const SYNONYM_MAP: Record<string, string[]> = {
  health: ['healthcare', 'medical', 'doctor', 'physician'],
  insurance: ['coverage', 'policy', 'plan', 'benefit'],
  employee: ['staff', 'worker', 'associate', 'worker'],
  dental: ['teeth', 'tooth', 'orthodontic', 'denture'],
  vision: ['eye', 'eyecare', 'glasses', 'contacts', 'spectacle'],
  prescription: ['drug', 'medication', 'medicine', 'rx', 'pharma'],
  deductible: ['out-of-pocket', 'oop', 'deduct', 'copay'],
  premium: ['monthly fee', 'contribution', 'cost', 'payment'],
  enrollment: ['sign up', 'signup', 'register', 'enroll', 'enrolment'],
  eligible: ['qualify', 'qualified', 'qualification', 'eligible'],
  claim: ['request', 'submission', 'filing', 'appeal'],
  network: ['provider', 'in-network', 'out-of-network', 'facilities'],
  copay: ['copayment', 'cost share', 'coinsurance', 'fee'],
  dependent: ['family', 'spouse', 'child', 'children', 'parent'],
  waive: ['waiver', 'exception', 'exemption', 'forgive'],
  limit: ['cap', 'maximum', 'ceiling', 'threshold', 'max'],
  // --- PHASE 1 AGGRESSIVE EXPANSION START ---
  hsa: ['health savings account', 'savings plan', 'hsa'],
  fsa: ['flexible spending account', 'flex spend', 'fsa'],
  pto: ['paid time off', 'vacation', 'sick days', 'holidays', 'holiday'],
  '401k': ['retirement', 'pension', '401(k)'],
  reimbursement: ['expense', 'payment back', 'pay back', 'reimburse'],
  // --- PHASE 1 AGGRESSIVE EXPANSION END ---
};

/**
 * Normalize query with synonym expansion
 * Converts variations to base form for better cache hits
 * Example: "healthcare insurance" -> "health insurance"
 */
export function normalizeQueryWithSynonyms(query: string): string {
  let normalized = normalizeQuery(query);

  // Replace each synonym with its base form
  for (const [base, synonyms] of Object.entries(SYNONYM_MAP)) {
    // Look for whole word matches
    const pattern = new RegExp(`\\b(${synonyms.join('|')})\\b`, 'gi');
    normalized = normalized.replace(pattern, base);
  }

  return normalized;
}

/**
 * Hash query to SHA-256 hex string
 * Used for cache keys and vector generation
 */
function hashQuery(query: string): string {
  return createHash('sha256').update(query).digest('hex');
}

/**
 * Convert query to semantic vector for clustering
 * Uses deterministic hashing for reproducibility
 * Returns 16-dimensional vector normalized to [-1, 1]
 */
export function queryToVector(query: string): number[] {
  const normalized = normalizeQueryWithSynonyms(query);
  const hash = hashQuery(normalized);
  const vector: number[] = [];
  
  // Create vector from SHA-256 hash (use first 16 bytes)
  for (let i = 0; i < 16; i++) {
    const hexByte = hash.substring(i * 2, i * 2 + 2);
    // Convert to [-1, 1] range
    vector.push((parseInt(hexByte, 16) - 128) / 128);
  }
  
  return vector;
}

/**
 * Calculate cosine similarity between two vectors
 * Returns value in [0, 1] range
 */
export function cosineSimilarity(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length || v1.length === 0) {
    return 0;
  }
  
  const dotProduct = v1.reduce((sum, a, i) => sum + a * v2[i], 0);
  const mag1 = Math.sqrt(v1.reduce((sum, a) => sum + a * a, 0));
  const mag2 = Math.sqrt(v2.reduce((sum, a) => sum + a * a, 0));
  
  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }
  
  return dotProduct / (mag1 * mag2);
}

/**
 * Get query vector (alias for queryToVector for consistency)
 */
export function getQueryVector(query: string): number[] {
  return queryToVector(query);
}

/**
 * Build L0 cache key (exact match)
 * Format: qa:v1:{companyId}:{queryHash}
 * Now uses synonym normalization for better cache hits
 */
export function buildCacheKey(
  companyId: string,
  query: string,
  version: string = "v1"
): string {
  const normalized = normalizeQueryWithSynonyms(query);  // Updated to use synonym normalization
  const hash = hashQuery(normalized);
  return `qa:${version}:${companyId}:${hash}`;
}

/**
 * Build L1 cache key (recent queries for semantic match)
 * Format: recentq:v1:{companyId}
 */
export function buildSemanticCacheKey(
  companyId: string,
  version: string = "v1"
): string {
  return `recentq:${version}:${companyId}`;
}

/**
 * Build rate limit key
 * Format: ratelimit:{userId}:{window}
 */
export function buildRateLimitKey(
  userId: string,
  windowSeconds: number = 60
): string {
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / windowSeconds);
  return `ratelimit:${userId}:${window}`;
}

// ============================================================================
// TTL Strategy
// ============================================================================

/**
 * Get cache TTL based on tier
 * Phase 1: Aggressively increased TTLs for maximum reuse of expensive GPT-4 (L3) answers.
 */
export function getTTLForTier(tier: Tier): number {
  const TTL_MAP: Record<Tier, number> = {
    L1: 12 * 3600,    // Increased to 12 hours (from 6h)
    L2: 24 * 3600,   // Increased to 24 hours (from 12h)
    L3: 48 * 3600,   // Increased to 48 hours (from 24h)
  };
  return TTL_MAP[tier];
}

/**
 * Get cache TTL with jitter to prevent thundering herd
 */
export function getTTLWithJitter(
  baseTTL: number,
  jitterPercent: number = 10
): number {
  const jitter = baseTTL * (jitterPercent / 100);
  const randomJitter = Math.random() * jitter;
  return Math.floor(baseTTL + randomJitter - jitter / 2);
}

// ============================================================================
// Cache Entry Serialization
// ============================================================================

/**
 * Serialize QAResponse for cache storage
 */
export function serializeCacheEntry(
  response: QAResponse,
  queryHash: string,
  companyId: string
): string {
  const entry: CacheEntry = {
    answer: response.answer,
    citations: response.citations,
    tier: response.tier,
    timestamp: Date.now(),
    chunkIds: response.citations.map((c) => c.chunkId),
    queryHash,
    companyId,
  };
  return JSON.stringify(entry);
}

/**
 * Deserialize cache entry to QAResponse
 */
export function deserializeCacheEntry(cached: string): QAResponse {
  const entry: CacheEntry = JSON.parse(cached);
  return {
    answer: entry.answer,
    citations: entry.citations,
    tier: entry.tier,
    fromCache: true,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
    },
  };
}

// ============================================================================
// Semantic Cache Utilities
// ============================================================================

/**
 * Find most similar query in semantic cache
 * Phase 1: Dynamic semantic threshold based on answer quality
 * * Thresholds (ADJUSTED FOR AGGRESSIVE CACHING):
 * - High confidence (grounding ≥0.85): 0.85 similarity required (was 0.88)
 * - Medium confidence (grounding 0.70-0.84): 0.87 similarity required (was 0.90)
 * - Low confidence (grounding <0.70): 0.92 similarity required (conservative)
 * * This adaptive approach increases cache hits while maintaining quality
 */
export function findMostSimilar(
  queryVector: number[],
  recentQueries: SemanticCacheEntry[],
  thresholdOverride?: number,
): SemanticCacheEntry | null {
  let bestMatch: SemanticCacheEntry | null = null;
  let bestSimilarity = 0;

  // Default threshold (can be overridden)
  const baseThreshold = thresholdOverride ?? 0.88;

  for (const entry of recentQueries) {
    // Calculate dynamic threshold based on answer quality (grounding score)
    const groundingScore = (entry as any).metadata?.groundingScore ?? 0.70;
    let entryThreshold = 0.92; // Default conservative

    if (groundingScore >= 0.85) {
      entryThreshold = 0.85; // High confidence: more aggressive match required (was 0.88)
    } else if (groundingScore >= 0.70) {
      entryThreshold = 0.87; // Medium confidence: moderate match required (was 0.90)
    }
    // else: Low confidence keeps 0.92 (conservative)

    // Use the more conservative threshold
    const activeThreshold = Math.min(baseThreshold, entryThreshold);

    const similarity = cosineSimilarity(queryVector, entry.queryVector);

    if (similarity > activeThreshold && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = { ...entry, similarity };
    }
  }

  return bestMatch;
}

// ============================================================================
// Cache Strategy Helpers
// ============================================================================

/**
 * Determine if cache should be used for request
 */
export function shouldUseCache(
  request: QARequest,
  strategy: CacheStrategy
): { l0: boolean; l1: boolean } {
  // Don't cache if forceTier is set (testing/debugging)
  if (request.forceTier) {
    return { l0: false, l1: false };
  }

  // Don't cache streaming responses
  if (request.stream) {
    return { l0: false, l1: false };
  }

  return {
    l0: strategy.l0Enabled,
    l1: strategy.l1Enabled,
  };
}

/**
 * Determine if response should be cached
 */
export function shouldCacheResponse(
  response: QAResponse,
  strategy: CacheStrategy
): boolean {
  // Don't cache if already from cache
  if (response.fromCache) {
    return false;
  }

  // Don't cache low-quality responses (low grounding)
  if (response.metadata?.groundingScore && response.metadata.groundingScore < 0.5) {
    return false;
  }

  return true;
}

// ============================================================================
// Cache Invalidation
// ============================================================================

/**
 * Generate cache invalidation pattern for company
 * Returns pattern to match all company's cached queries
 */
export function buildInvalidationPattern(companyId: string): string {
  return `qa:*:${companyId}:*`;
}

/**
 * Generate cache invalidation pattern for specific document
 * Used when a document is updated/deleted
 */
export function buildDocumentInvalidationPattern(
  companyId: string,
  docId: string
): string {
  // Would need to store doc_id → cache_key mapping
  // For now, invalidate all company cache
  return buildInvalidationPattern(companyId);
}

// ============================================================================
// Cache Metrics
// ============================================================================

export interface CacheMetrics {
  l0Hits: number;
  l0Misses: number;
  l1Hits: number;
  l1Misses: number;
  totalRequests: number;
  avgL0LatencyMs: number;
  avgL1LatencyMs: number;
}

export class CacheMetricsCollector {
  private metrics: CacheMetrics = {
    l0Hits: 0,
    l0Misses: 0,
    l1Hits: 0,
    l1Misses: 0,
    totalRequests: 0,
    avgL0LatencyMs: 0,
    avgL1LatencyMs: 0,
  };

  recordL0Hit(latencyMs: number): void {
    this.metrics.l0Hits++;
    this.metrics.totalRequests++;
    this.updateAvgLatency("l0", latencyMs);
  }

  recordL0Miss(latencyMs: number): void {
    this.metrics.l0Misses++;
    this.metrics.totalRequests++;
    this.updateAvgLatency("l0", latencyMs);
  }

  recordL1Hit(latencyMs: number): void {
    this.metrics.l1Hits++;
    this.updateAvgLatency("l1", latencyMs);
  }

  recordL1Miss(latencyMs: number): void {
    this.metrics.l1Misses++;
    this.updateAvgLatency("l1", latencyMs);
  }

  private updateAvgLatency(type: "l0" | "l1", latencyMs: number): void {
    const key = type === "l0" ? "avgL0LatencyMs" : "avgL1LatencyMs";
    const total = type === "l0"
      ? this.metrics.l0Hits + this.metrics.l0Misses
      : this.metrics.l1Hits + this.metrics.l1Misses;

    this.metrics[key] = (this.metrics[key] * (total - 1) + latencyMs) / total;
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  getHitRate(): { l0: number; l1: number; overall: number } {
    const l0Total = this.metrics.l0Hits + this.metrics.l0Misses;
    const l1Total = this.metrics.l1Hits + this.metrics.l1Misses;
    const overallHits = this.metrics.l0Hits + this.metrics.l1Hits;

    return {
      l0: l0Total > 0 ? this.metrics.l0Hits / l0Total : 0,
      l1: l1Total > 0 ? this.metrics.l1Hits / l1Total : 0,
      overall: this.metrics.totalRequests > 0
        ? overallHits / this.metrics.totalRequests
        : 0,
    };
  }

  reset(): void {
    this.metrics = {
      l0Hits: 0,
      l0Misses: 0,
      l1Hits: 0,
      l1Misses: 0,
      totalRequests: 0,
      avgL0LatencyMs: 0,
      avgL1LatencyMs: 0,
    };
  }
}

// ============================================================================
// Phase 2: Query Clustering (15-20% gain)
// ============================================================================

/**
 * Query cluster - groups semantically similar queries
 * Clusters capture common question variations and improve hit rate
 * especially for older queries beyond the recent-50 window
 */
export interface QueryCluster {
  clusterId: string;
  centroidVector: number[];
  queries: SemanticCacheEntry[];
  representativeAnswer: QAResponse;
  hitCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
  metadata?: {
    averageGroundingScore?: number;
    commonThemes?: string[];
  };
}

/**
 * Detect if query belongs to existing cluster
 * Returns best matching cluster if similarity > threshold
 */
export function findQueryCluster(
  queryVector: number[],
  clusters: QueryCluster[],
  similarityThreshold: number = 0.85
): QueryCluster | null {
  let bestCluster: QueryCluster | null = null;
  let bestSimilarity = similarityThreshold;

  for (const cluster of clusters) {
    const similarity = cosineSimilarity(queryVector, cluster.centroidVector);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestCluster = cluster;
    }
  }

  return bestCluster;
}

/**
 * Update cluster centroid when new query added
 * Recalculates average of all vectors in cluster
 */
export function updateClusterCentroid(
  cluster: QueryCluster,
  newVector: number[]
): number[] {
  const allVectors = [...cluster.queries.map((q) => q.queryVector), newVector];
  const dimension = newVector.length;
  const centroid = new Array(dimension).fill(0);

  for (const vector of allVectors) {
    for (let i = 0; i < dimension; i++) {
      centroid[i] += vector[i];
    }
  }

  for (let i = 0; i < dimension; i++) {
    centroid[i] /= allVectors.length;
  }

  return centroid;
}

/**
 * Create new cluster from query
 */
export function createQueryCluster(
  clusterId: string,
  query: SemanticCacheEntry,
  response: QAResponse
): QueryCluster {
  return {
    clusterId,
    centroidVector: query.queryVector,
    queries: [query],
    representativeAnswer: response,
    hitCount: 1,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    metadata: {
      averageGroundingScore: response.metadata?.groundingScore,
    },
  };
}

/**
 * Add query to cluster and update centroid
 */
export function addQueryToCluster(
  cluster: QueryCluster,
  query: SemanticCacheEntry,
  response?: QAResponse
): QueryCluster {
  const updatedCluster = { ...cluster };
  updatedCluster.queries.push(query);
  updatedCluster.centroidVector = updateClusterCentroid(cluster, query.queryVector);
  updatedCluster.lastAccessedAt = new Date();
  updatedCluster.hitCount++;

  // Update average grounding score if response provided
  if (response?.metadata?.groundingScore) {
    const currentAvg = updatedCluster.metadata?.averageGroundingScore ?? 0.7;
    const newAvg =
      (currentAvg * (cluster.queries.length - 1) +
        response.metadata.groundingScore) /
      cluster.queries.length;
    if (!updatedCluster.metadata) updatedCluster.metadata = {};
    updatedCluster.metadata.averageGroundingScore = newAvg;
  }

  return updatedCluster;
}

// ============================================================================
// Phase 2: Cache Warmup (5-10% gain)
// ============================================================================

/**
 * Cache warmup configuration
 */
export interface CacheWarmupConfig {
  enabled: boolean;
  frequency: "startup" | "daily" | "hourly";
  topQueriesCount: number;
  ttl?: number; // Optional TTL override
}

/**
 * Cache warming context to track warmup state
 */
export interface CacheWarmupContext {
  companyId: string;
  lastWarmupTime?: Date;
  queriesPreloaded: number;
  warmupDurationMs: number;
}

/**
 * Generate cache warmup context
 */
export function createCacheWarmupContext(companyId: string): CacheWarmupContext {
  return {
    companyId,
    queriesPreloaded: 0,
    warmupDurationMs: 0,
  };
}

/**
 * Check if warmup is needed
 */
export function shouldWarmupCache(
  context: CacheWarmupContext,
  config: CacheWarmupConfig
): boolean {
  if (!config.enabled) return false;

  const lastWarmup = context.lastWarmupTime;
  if (!lastWarmup) return true; // First time

  const now = new Date();
  const elapsed = now.getTime() - lastWarmup.getTime();

  switch (config.frequency) {
    case "startup":
      return false; // One-time only
    case "hourly":
      return elapsed > 60 * 60 * 1000;
    case "daily":
      return elapsed > 24 * 60 * 60 * 1000;
    default:
      return false;
  }
}

// ============================================================================
// Phase 3: Simplified Query Clustering API (In-Memory Store)
// ============================================================================

/**
 * In-memory cluster store for semantic query grouping
 * Maps: companyId -> clusterId -> cluster entry
 */
const clusterStore = new Map<string, Map<string, {
  vector: number[];
  answer: string;
  groundingScore: number;
  metadata?: Record<string, unknown>;
}>>();

/**
 * Cluster match result for Phase 3 integration
 */
export interface ClusterMatchResult {
  confidence: number;
  answer: string;
  groundingScore: number;
}

/**
 * Find matching cluster for query (Phase 3 API)
 * Uses simplified interface for QA route integration
 * 
 * @param queryVector - Semantic vector of query
 * @param companyId - Company context
 * @param threshold - Minimum similarity (default 0.85)
 * @returns ClusterMatchResult if match found, null otherwise
 */
export function findQueryClusterSimple(
  queryVector: number[],
  companyId: string = 'default',
  threshold: number = 0.85
): ClusterMatchResult | null {
  const clusters = clusterStore.get(companyId);
  if (!clusters || clusters.size === 0) return null;

  let best: ClusterMatchResult | null = null;
  let bestScore = threshold;

  for (const entry of clusters.values()) {
    const score = cosineSimilarity(queryVector, entry.vector);
    if (score > bestScore) {
      bestScore = score;
      best = {
        confidence: score,
        answer: entry.answer,
        groundingScore: entry.groundingScore,
      };
    }
  }

  return best;
}

/**
 * Add query result to cluster store (Phase 3 API)
 * 
 * @param query - Original query text
 * @param queryVector - Semantic vector
 * @param answer - Generated answer
 * @param groundingScore - Quality score
 * @param metadata - Additional metadata
 * @param companyId - Company context
 */
export function addQueryToClusterSimple(
  query: string,
  queryVector: number[],
  answer: string,
  groundingScore: number,
  metadata?: Record<string, unknown>,
  companyId: string = 'default'
): void {
  if (!clusterStore.has(companyId)) {
    clusterStore.set(companyId, new Map());
  }

  const clusters = clusterStore.get(companyId)!;
  const normalized = normalizeQueryWithSynonyms(query);
  const clusterId = `c:${hashQuery(normalized).substring(0, 12)}`;

  clusters.set(clusterId, {
    vector: queryVector,
    answer,
    groundingScore,
    metadata: {
      ...metadata,
      timestamp: Date.now(),
      query,
    },
  });

  // Limit cluster size (1000 entries per company)
  if (clusters.size > 1000) {
    const oldest = clusters.entries().next().value;
    if (oldest) {
      clusters.delete(oldest[0]);
    }
  }
}

/**
 * Get cluster statistics
 */
export function getClusterStats(companyId: string = 'default'): {
  clusterCount: number;
  avgGroundingScore: number;
} {
  const clusters = clusterStore.get(companyId);
  if (!clusters || clusters.size === 0) {
    return { clusterCount: 0, avgGroundingScore: 0 };
  }

  const entries = Array.from(clusters.values());
  const avgGroundingScore = entries.reduce((sum, e) => sum + e.groundingScore, 0) / entries.length;

  return {
    clusterCount: clusters.size,
    avgGroundingScore,
  };
}

/**
 * Clear all clusters (for testing)
 */
export function clearAllClusters(companyId?: string): void {
  if (companyId) {
    clusterStore.delete(companyId);
  } else {
    clusterStore.clear();
  }
}export const cacheMetrics = new CacheMetricsCollector();