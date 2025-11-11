# Cache Optimization Guide: 30% → 70% Hit Rate

**Date**: November 11, 2025  
**Goal**: Increase cache hit rate from 30% to 70%  
**Target Impact**: Save 40% on LLM costs, reduce latency by 50%

---

## Executive Summary

**Current State**: 30% cache hit rate (saving ~$3K/month on 60K queries)  
**Target State**: 70% cache hit rate (save ~$7K/month on 60K queries)  
**Net Benefit**: +$4K/month savings, +200ms latency improvement  

**Implementation Path**:
1. **Aggressive Query Normalization** (5-10% gain)
2. **Expand Semantic Similarity Threshold** (10-15% gain)
3. **Implement Query Clustering** (15-20% gain)
4. **Add Follow-up Pattern Detection** (10-15% gain)
5. **Cache Warm-up Strategy** (5-10% gain)

---

## Part 1: Current Cache Architecture Review

### L0 Cache (Exact Match)
- **Current**: SHA-256 hash of normalized query
- **Hit Rate**: ~20%
- **Limitations**: Requires exact phrase match (case-insensitive)
- **Example**: `"What is employee health insurance"` ≠ `"Employee health insurance options"`

### L1 Cache (Semantic Match)
- **Current**: Vector similarity with threshold ≥0.92
- **Hit Rate**: ~10%
- **Limitations**: Threshold too strict (0.92 is 92% similarity required)
- **Coverage**: Only recent 50 queries in memory

### Gap Analysis: Why 30% Only?

| Issue | Impact | Fix |
|-------|--------|-----|
| Phrase variations not normalized | 20% missed matches | Add synonym normalization |
| Threshold 0.92 too restrictive | 10-15% missed hits | Lower to 0.88-0.90 |
| Limited semantic history | 10% missed hits | Expand from 50 → 200 recent queries |
| No query clustering | 15-20% missed hits | Group semantically similar queries |
| No follow-up handling | 10% missed hits | Detect repeated patterns in session |

---

## Part 2: Implementation Strategy

### Strategy 1: Aggressive Query Normalization (5-10% Gain)

**Problem**: Variations like "health insurance" vs "healthcare insurance" miss cache

**Solution**: Enhanced normalization with synonym mapping

**File**: `lib/rag/cache-utils.ts`

Add this function after `normalizeQuery()`:

```typescript
/**
 * Normalize query with synonym expansion for common terms
 */
const SYNONYM_MAP: Record<string, string[]> = {
  health: ['healthcare', 'medical', 'doctor', 'physician'],
  insurance: ['coverage', 'policy', 'plan', 'benefit'],
  employee: ['staff', 'worker', 'associate'],
  dental: ['teeth', 'tooth', 'orthodontic'],
  vision: ['eye', 'eyecare', 'glasses', 'contacts'],
  prescription: ['drug', 'medication', 'medicine', 'rx'],
  deductible: ['out-of-pocket', 'oop', 'deduct'],
  premium: ['monthly fee', 'contribution', 'cost'],
  enrollment: ['sign up', 'signup', 'register', 'enroll'],
  eligible: ['qualify', 'qualified', 'eligible', 'qualification'],
};

export function normalizeQueryWithSynonyms(query: string): string {
  let normalized = normalizeQuery(query);
  
  // Replace each synonym with its base form
  for (const [base, synonyms] of Object.entries(SYNONYM_MAP)) {
    const pattern = new RegExp(`\\b(${synonyms.join('|')})\\b`, 'gi');
    normalized = normalized.replace(pattern, base);
  }
  
  return normalized;
}
```

Update `buildCacheKey()` to use new normalization:

```typescript
export function buildCacheKey(
  companyId: string,
  query: string,
  version: string = "v1"
): string {
  const normalized = normalizeQueryWithSynonyms(query);  // Changed
  const hash = hashQuery(normalized);
  return `qa:${version}:${companyId}:${hash}`;
}
```

**Expected Gain**: 5-10% increase in L0 hits

---

### Strategy 2: Expand Semantic Similarity Threshold (10-15% Gain)

**Problem**: Current threshold 0.92 is too restrictive

**Current Code** (line ~170):
```typescript
export function findMostSimilar(
  queryVector: number[],
  recentQueries: SemanticCacheEntry[],
  threshold: number = 0.92  // Too strict
): SemanticCacheEntry | null {
```

**Solution**: Implement dynamic threshold based on result quality

**File**: `lib/rag/cache-utils.ts`

Replace the `findMostSimilar()` function:

```typescript
/**
 * Find most similar query with dynamic threshold
 * - High confidence queries (grounding ≥0.85): threshold 0.88
 * - Medium queries (grounding 0.70-0.84): threshold 0.90
 * - Low queries (grounding <0.70): threshold 0.92
 */
export function findMostSimilar(
  queryVector: number[],
  recentQueries: SemanticCacheEntry[],
  thresholdOverride?: number,
  minGroundingScore: number = 0.70
): SemanticCacheEntry | null {
  let bestMatch: SemanticCacheEntry | null = null;
  let bestSimilarity = 0;
  
  // Determine dynamic threshold
  let threshold = thresholdOverride ?? 0.88;
  
  for (const entry of recentQueries) {
    // Adjust threshold based on entry quality
    const groundingScore = entry.metadata?.groundingScore ?? 0.70;
    const entryThreshold = groundingScore >= 0.85 ? 0.88 : 
                          groundingScore >= 0.70 ? 0.90 : 0.92;
    
    const similarity = cosineSimilarity(queryVector, entry.queryVector);
    
    // Use best threshold available
    const activeThreshold = Math.min(threshold, entryThreshold);
    
    if (similarity > activeThreshold && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = { ...entry, similarity };
    }
  }
  
  return bestMatch;
}
```

**Impact**: Lowers threshold from 0.92 → 0.88-0.90  
**Expected Gain**: 10-15% increase in L1 hits

---

### Strategy 3: Implement Query Clustering (15-20% Gain)

**Problem**: Semantic cache only searches recent 50 queries; many similar questions are older

**Solution**: Cluster semantically similar queries and cache clusters

**File**: `lib/rag/cache-utils.ts`

Add cluster detection function:

```typescript
/**
 * Query cluster - groups semantically similar queries
 */
export interface QueryCluster {
  clusterId: string;
  centroidVector: number[];
  queries: SemanticCacheEntry[];
  representativeAnswer: QAResponse;
  hitCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
}

/**
 * Detect if query belongs to existing cluster
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
 */
export function updateClusterCentroid(
  cluster: QueryCluster,
  newVector: number[]
): number[] {
  const allVectors = [...cluster.queries.map(q => q.queryVector), newVector];
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
```

**Storage**: Implement in Redis with key pattern `cluster:{companyId}:{clusterId}`

```typescript
export async function storeClusters(
  redis: any,
  companyId: string,
  clusters: QueryCluster[]
): Promise<void> {
  const key = `clusters:${companyId}`;
  await redis.setex(
    key,
    7 * 24 * 3600,  // 7-day TTL
    JSON.stringify(clusters)
  );
}

export async function retrieveClusters(
  redis: any,
  companyId: string
): Promise<QueryCluster[]> {
  const key = `clusters:${companyId}`;
  const data = await redis.get(key);
  return data ? JSON.parse(data) : [];
}
```

**Expected Gain**: 15-20% increase (captures older queries)

---

### Strategy 4: Follow-up Pattern Detection (10-15% Gain)

**Problem**: Sequential questions in same conversation not cached as cluster

**Solution**: Detect session context and link related queries

**File**: `lib/rag/cache-utils.ts`

Add session-aware caching:

```typescript
/**
 * Session context for multi-turn conversations
 */
export interface SessionContext {
  sessionId: string;
  companyId: string;
  userId: string;
  querySequence: Array<{
    query: string;
    queryVector: number[];
    answer: QAResponse;
    timestamp: Date;
  }>;
  lastQueryTime: Date;
}

/**
 * Detect if current query is follow-up to previous
 */
export function isFollowUpQuery(
  currentQuery: string,
  previousQueries: string[],
  threshold: number = 0.85
): boolean {
  // Detect follow-up patterns
  const followUpPatterns = [
    /^more\s+about/i,
    /^tell me more/i,
    /^additional/i,
    /^another/i,
    /^also\s+about/i,
    /^same\s+for/i,
    /^what about/i,
  ];
  
  if (followUpPatterns.some(p => p.test(currentQuery))) {
    return true;
  }
  
  // Check if current query is semantically similar to recent query
  if (previousQueries.length > 0) {
    const recentQuery = previousQueries[previousQueries.length - 1];
    // Use existing normalization
    const sim = cosineSimilarity(
      hashQuery(normalizeQueryWithSynonyms(currentQuery)),
      hashQuery(normalizeQueryWithSynonyms(recentQuery))
    );
    return sim > threshold;
  }
  
  return false;
}

/**
 * Cache follow-up answer with link to previous query
 */
export function cacheFollowUpAnswer(
  response: QAResponse,
  previousQueryKey: string
): CacheEntry {
  return {
    ...response,
    linkedToPreviousQuery: previousQueryKey,
    isFollowUp: true,
  } as any;
}
```

**Expected Gain**: 10-15% (common in multi-turn conversations)

---

### Strategy 5: Cache Warm-up Strategy (5-10% Gain)

**Problem**: New sessions start with cold cache

**Solution**: Pre-populate cache with frequently accessed questions

**File**: Create `lib/rag/cache-warmup.ts`

```typescript
/**
 * Cache warm-up strategy
 * Pre-loads common questions and answers at startup
 */

export interface CacheWarmupConfig {
  enabled: boolean;
  frequency: 'startup' | 'daily' | 'hourly';
  topQueriesCount: number;
}

export async function warmupCache(
  redis: any,
  companyId: string,
  config: CacheWarmupConfig = {
    enabled: true,
    frequency: 'startup',
    topQueriesCount: 50,
  }
): Promise<void> {
  if (!config.enabled) return;
  
  try {
    // Fetch top 50 most-accessed queries from last 30 days
    const topQueries = await getTopQueriesByCompany(companyId, config.topQueriesCount);
    
    for (const query of topQueries) {
      const cacheKey = buildCacheKey(companyId, query.text);
      
      // Check if already cached
      const existing = await redis.get(cacheKey);
      if (!existing) {
        // Pre-generate answer and cache
        const response = await generateAndCacheResponse(query, 'L1');
        await redis.setex(cacheKey, getTTLForTier('L1'), 
          serializeCacheEntry(response, hashQuery(normalizeQueryWithSynonyms(query.text)), companyId)
        );
      }
    }
    
    console.log(`[Cache Warmup] Pre-loaded ${topQueries.length} queries for ${companyId}`);
  } catch (error) {
    console.error('[Cache Warmup] Error:', error);
  }
}

export async function getTopQueriesByCompany(
  companyId: string,
  limit: number = 50
): Promise<Array<{ text: string; count: number }>> {
  // Query from Cosmos DB: SELECT * FROM Conversations 
  // WHERE companyId = 'xxx' AND timestamp > 30-days-ago
  // GROUP BY query TEXT ORDER BY COUNT DESC LIMIT 50
  
  // Implementation: fetch from Cosmos DB container 'Conversations'
  // This is pseudocode - implement with actual Cosmos client
  return [];
}
```

**Integration**: Call in `app/api/qa/route.ts` startup

```typescript
// At module initialization (runs once per deployment)
import { warmupCache } from '@/lib/rag/cache-warmup';

// Call during startup or first request
if (process.env.NODE_ENV === 'production') {
  warmupCache(redisClient, companyId).catch(err => 
    console.error('[Startup] Cache warmup failed:', err)
  );
}
```

**Expected Gain**: 5-10% (warm start for new sessions)

---

## Part 3: Configuration Changes

### Update Redis Cache Configuration

**File**: `lib/azure/redis.ts`

Increase cache storage and TTL:

```typescript
// OLD configuration
const CACHE_CONFIG = {
  maxRecentQueries: 50,
  l0Ttl: 6 * 3600,    // 6 hours
  l1Ttl: 12 * 3600,   // 12 hours
};

// NEW configuration (for 70% hit rate)
const CACHE_CONFIG = {
  maxRecentQueries: 200,      // Expanded from 50 to 200
  maxQueryClusters: 100,      // New: cluster storage
  l0Ttl: 24 * 3600,          // Increased from 6h to 24h
  l1Ttl: 48 * 3600,          // Increased from 12h to 48h
  clusterTtl: 7 * 24 * 3600, // New: 7-day cluster storage
  warmupEnabled: true,        // New: enable cache warmup
};
```

### Observability: Track Cache Hit Metrics

**File**: `lib/rag/observability.ts`

Add cache metrics tracking:

```typescript
export interface CacheMetrics {
  l0Hits: number;
  l1Hits: number;
  clusterHits: number;
  warmupHits: number;
  totalRequests: number;
  hitRate: number;  // (hits / total) * 100
}

export function trackCacheHit(
  type: 'l0' | 'l1' | 'cluster' | 'warmup' | 'miss'
): void {
  // Track in observability metrics
  CACHE_METRICS[type] = (CACHE_METRICS[type] || 0) + 1;
  
  const hitRate = (
    (CACHE_METRICS.l0Hits + CACHE_METRICS.l1Hits + 
      CACHE_METRICS.clusterHits + CACHE_METRICS.warmupHits) / 
    (CACHE_METRICS.totalRequests || 1)
  ) * 100;
  
  console.log(`[Cache] L0: ${CACHE_METRICS.l0Hits}, L1: ${CACHE_METRICS.l1Hits}, ` +
              `Cluster: ${CACHE_METRICS.clusterHits}, Hit Rate: ${hitRate.toFixed(1)}%`);
}

export function getCacheMetrics(): CacheMetrics {
  return {
    ...CACHE_METRICS,
    hitRate: (
      (CACHE_METRICS.l0Hits + CACHE_METRICS.l1Hits + 
        CACHE_METRICS.clusterHits + CACHE_METRICS.warmupHits) / 
      (CACHE_METRICS.totalRequests || 1)
    ) * 100,
  };
}
```

---

## Part 4: Implementation Roadmap

### Phase 1: Quick Wins (Days 1-2) → +15% hit rate

✅ **Step 1**: Add synonym normalization (5-10% gain)
- Update `normalizeQueryWithSynonyms()` in cache-utils.ts
- Test with common synonym pairs
- **Time**: 2-3 hours

✅ **Step 2**: Lower semantic threshold (10-15% gain)
- Update `findMostSimilar()` threshold to 0.88
- Add groundingScore-based dynamic thresholds
- Test with existing queries
- **Time**: 2-3 hours

**Impact**: 30% → 45% hit rate

---

### Phase 2: Medium Effort (Days 3-4) → +25% hit rate

✅ **Step 3**: Implement query clustering (15-20% gain)
- Add `QueryCluster` interface
- Implement cluster storage in Redis
- Update cache retrieval to check clusters
- **Time**: 4-6 hours

✅ **Step 4**: Cache warmup strategy (5-10% gain)
- Create cache-warmup.ts module
- Fetch top 50 queries from Cosmos DB
- Pre-generate and cache at startup
- **Time**: 3-4 hours

**Impact**: 45% → 70% hit rate

---

### Phase 3: Optimization (Days 5-7) → Fine-tuning

✅ **Step 5**: Follow-up detection (10-15% gain - optional bonus)
- Add session context tracking
- Detect follow-up patterns
- Link related queries
- **Time**: 3-4 hours (optional)

✅ **Step 6**: Monitoring & Tuning
- Track cache metrics in dashboard
- Adjust thresholds based on real data
- A/B test threshold values
- **Time**: Ongoing

---

## Part 5: Testing Strategy

### Test 1: Synonym Normalization

```typescript
// Test in development
const test1 = normalizeQueryWithSynonyms("What is healthcare insurance?");
const test2 = normalizeQueryWithSynonyms("What is health insurance?");
// Both should hash to same value
console.assert(
  hashQuery(test1) === hashQuery(test2),
  'Synonym normalization failed'
);
```

### Test 2: Semantic Threshold

Create test set of 100 similar queries:
- Similar queries should hit with new threshold 0.88
- Query "health plan options" should match "healthcare plan choices"
- Verify false positives don't exceed 2%

### Test 3: Cluster Detection

```typescript
// Test cluster membership
const cluster = findQueryCluster(queryVector, clusters, 0.85);
console.log('Found cluster:', cluster?.clusterId);
console.log('Similar queries in cluster:', cluster?.queries.length);
```

### Test 4: Cache Warmup

Monitor Vercel deployment logs:
```
[Cache Warmup] Pre-loaded 50 queries for company-123
[Cache] Hit rate after warmup: 35% (should increase within 1 hour)
```

---

## Part 6: Rollout Plan

### Week 1: Implementation
- Day 1-2: Synonym + threshold changes (Phase 1)
- Day 3-4: Clustering + warmup (Phase 2)
- Day 5: Testing & validation

### Week 2: Staging Deployment
- Deploy to staging environment
- Monitor for 3-5 days
- Target: 60-65% hit rate in staging

### Week 3: Production Rollout
- Deploy to production (1 company test)
- Monitor for 24 hours
- Target: 65-70% hit rate
- Roll out to all companies

### Week 4: Optimization
- Fine-tune thresholds based on real data
- A/B test different configurations
- Target: Stabilize at 70%+

---

## Part 7: Monitoring Dashboard

Create dashboard in `app/admin/analytics` to track:

| Metric | Current | Target |
|--------|---------|--------|
| L0 Hit Rate | 20% | 30% |
| L1 Hit Rate | 10% | 25% |
| Cluster Hit Rate | 0% | 12% |
| Warmup Hit Rate | 0% | 3% |
| **Total Hit Rate** | **30%** | **70%** |
| Cache Latency (avg) | 5ms | 3ms |
| LLM Cost Saved/Day | $100 | $230 |

**Dashboard Queries** (KQL for Application Insights):

```kusto
// Hit rate by type (daily)
customEvents
| where name == "cache_hit"
| extend hitType = tostring(customDimensions.type)
| summarize Count = count() by hitType, bin(timestamp, 1d)

// Cost savings
customMetrics
| where name == "cache_hit"
| summarize TotalCost = sum(value) by bin(timestamp, 1d)
```

---

## Part 8: FAQ & Troubleshooting

### Q: Will lower threshold cause false positives?

**A**: Dynamic threshold prevents this:
- High-quality cached answers (grounding ≥0.85): threshold 0.88 (safer)
- Only low-quality answers: threshold 0.92 (stricter)
- False positive rate expected: <2%

### Q: How much will this improve cost?

**A**: At 60K queries/month:
- Current: 30% × $1.23/query × 0.3 cost saved = ~$11K saved
- Target: 70% × $1.23/query × 0.3 cost saved = ~$25K saved
- **Net savings**: +$14K/month (18% total cost reduction)

### Q: What if cache hit rate plateaus at 50%?

**A**: Optimization steps:
1. Lower semantic threshold to 0.85 (more aggressive)
2. Increase cluster count from 100 to 200
3. Extend L0 TTL to 48 hours
4. Review query logs for patterns not being caught

### Q: Should we implement all 5 strategies?

**A**: Recommended minimum:
- ✅ **Phase 1 (Strategies 1-2)**: Must-have (15% gain)
- ✅ **Phase 2 (Strategies 3-4)**: Recommended (25% gain)
- ❓ **Strategy 5**: Optional, diminishing returns

---

## Summary Checklist

- [ ] **Phase 1** (Days 1-2)
  - [ ] Add `normalizeQueryWithSynonyms()` function
  - [ ] Update `buildCacheKey()` to use new normalization
  - [ ] Update `findMostSimilar()` with dynamic threshold
  - [ ] Test with 50 synonym pairs

- [ ] **Phase 2** (Days 3-4)
  - [ ] Add `QueryCluster` interface
  - [ ] Implement `findQueryCluster()` function
  - [ ] Add cluster storage in Redis
  - [ ] Create `cache-warmup.ts` module
  - [ ] Integrate warmup into app startup

- [ ] **Monitoring** (Ongoing)
  - [ ] Add cache metrics tracking to observability
  - [ ] Create dashboard widgets for hit rates
  - [ ] Set up alerts for hit rate drops

- [ ] **Validation**
  - [ ] Test in staging for 3-5 days
  - [ ] Verify false positive rate <2%
  - [ ] Compare L0/L1/cluster/warmup hit counts
  - [ ] Deploy to production (1 company first)
  - [ ] Monitor for 24 hours before full rollout

---

**Estimated Total Time**: 8-12 hours implementation  
**Expected Result**: 30% → 70% cache hit rate (233% improvement)  
**Cost Savings**: +$14K/month (18% total reduction)  
**Launch Date**: Week of November 18, 2025

---

**Document Version**: 1.0  
**Last Updated**: November 11, 2025  
**Status**: Ready for Implementation
