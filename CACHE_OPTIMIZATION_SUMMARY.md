# Cache Optimization: Quick Reference

**Goal**: Increase cache hit rate from 30% → 70%  
**Savings**: +$14K/month on LLM costs  
**Timeline**: 2-3 weeks implementation + testing

---

## 🎯 5-Strategy Roadmap

### Strategy 1: Synonym Normalization (5-10% gain)
```
health insurance = healthcare insurance = medical coverage
↓
All hash to same cache key
```
**File**: `lib/rag/cache-utils.ts`  
**Implementation**: Add `normalizeQueryWithSynonyms()` with SYNONYM_MAP

---

### Strategy 2: Dynamic Semantic Threshold (10-15% gain)
```
OLD: 0.92 similarity required (too strict)
NEW: 0.88-0.92 based on answer quality
↓
More cache hits without compromising quality
```
**File**: `lib/rag/cache-utils.ts`  
**Implementation**: Update `findMostSimilar()` with groundingScore-based thresholds

---

### Strategy 3: Query Clustering (15-20% gain)
```
Similar questions grouped into clusters
Cluster centroid: average of all query vectors
↓
Find older similar questions, not just recent 50
```
**File**: `lib/rag/cache-utils.ts`  
**Implementation**: Add `QueryCluster` interface + cluster management

---

### Strategy 4: Cache Warmup (5-10% gain)
```
Pre-load top 50 frequently-asked questions at startup
↓
New sessions start with warm cache
```
**File**: Create `lib/rag/cache-warmup.ts`  
**Implementation**: Fetch top queries from Cosmos DB, cache at startup

---

### Strategy 5: Follow-up Detection (10-15% gain - optional)
```
"What is insurance?" → "Tell me more about dental"
↓
Link related queries, cache together
```
**File**: `lib/rag/cache-utils.ts`  
**Implementation**: Add session context + follow-up pattern detection

---

## 📊 Hit Rate Progression

| Phase | Strategy | Gain | Cumulative |
|-------|----------|------|-----------|
| Start | - | - | 30% |
| Phase 1 | Normalization + Threshold | +15% | 45% |
| Phase 2 | Clustering + Warmup | +25% | 70% |
| Optional | Follow-up Detection | +10% | 80% |

---

## 💰 Financial Impact

```
60,000 queries/month baseline

CURRENT (30% hit rate):
- Cached: 18,000 queries × $0.05 = $900
- LLM: 42,000 queries × $1.23 = $51,660
- Total: $52,560/month

TARGET (70% hit rate):
- Cached: 42,000 queries × $0.05 = $2,100
- LLM: 18,000 queries × $1.23 = $22,140
- Total: $24,240/month

SAVINGS: $28,320/month (54% reduction)
```

---

## ⚡ Implementation Priority

### Must-Have (Week 1)
- [ ] Synonym normalization
- [ ] Dynamic thresholds
- [ ] Basic testing

### Should-Have (Week 2)
- [ ] Query clustering
- [ ] Cache warmup
- [ ] Staging validation

### Nice-to-Have (Week 3+)
- [ ] Follow-up detection
- [ ] Fine-tuning
- [ ] Advanced monitoring

---

## 🔍 Key Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `lib/rag/cache-utils.ts` | +Functions: normalizeQueryWithSynonyms, dynamic thresholds, QueryCluster | +150 |
| `lib/rag/cache-warmup.ts` | NEW FILE: Warmup strategy | +100 |
| `lib/azure/redis.ts` | Update CACHE_CONFIG, increase TTLs | +5 |
| `lib/rag/observability.ts` | Add cache metrics tracking | +50 |

**Total New Code**: ~305 lines

---

## ✅ Validation Checklist

### Before Staging
- [ ] Synonym pairs tested (50+ examples)
- [ ] Semantic threshold tested (0.88 vs 0.92)
- [ ] Cluster detection verified
- [ ] False positive rate <2%
- [ ] Unit tests pass

### During Staging (3-5 days)
- [ ] Hit rate monitoring: target 60-65%
- [ ] No error increases
- [ ] Latency stable or improved
- [ ] Cost tracking shows savings

### Production Rollout (1 company first)
- [ ] Hit rate monitoring: target 65-70%
- [ ] Cost savings verified
- [ ] No user impact
- [ ] Gradual rollout to all companies

---

## 📈 Success Metrics

| Metric | Current | Target | Window |
|--------|---------|--------|--------|
| Cache Hit Rate | 30% | 70% | 2 weeks |
| Monthly Cost | $52.5K | $24.2K | After rollout |
| Average Latency | 2.1s | 1.8s | 2-3 weeks |
| Error Rate | 0.07% | <0.07% | Maintain |
| L0 Hits | 20% | 30% | Week 1 |
| L1 Hits | 10% | 25% | Week 2 |
| Cluster Hits | 0% | 12% | Week 2 |

---

## 🚀 Quick Start

### Day 1: Planning
- [ ] Read CACHE_OPTIMIZATION_GUIDE.md (full details)
- [ ] Review current cache-utils.ts implementation
- [ ] Set up branch: `feature/cache-optimization`

### Day 2-3: Phase 1
- [ ] Implement normalizeQueryWithSynonyms()
- [ ] Update buildCacheKey() 
- [ ] Lower threshold to 0.88
- [ ] Test with 50+ query pairs
- [ ] Commit: "feat: add synonym normalization and dynamic thresholds"

### Day 4-5: Phase 2
- [ ] Create QueryCluster interface
- [ ] Implement cluster management
- [ ] Create cache-warmup.ts
- [ ] Integrate warmup at startup
- [ ] Commit: "feat: add query clustering and cache warmup"

### Day 6: Testing
- [ ] Unit tests (cache-utils.test.ts)
- [ ] Integration tests (cache-warmup.test.ts)
- [ ] Staging deployment
- [ ] Monitor metrics

### Week 2: Rollout
- [ ] Production deployment (1 company)
- [ ] Monitor for 24 hours
- [ ] Gradual rollout
- [ ] Fine-tune thresholds

---

## 📚 Reference Docs

- **Full Implementation**: `CACHE_OPTIMIZATION_GUIDE.md`
- **Azure Monitoring**: `AZURE_MONITORING_IMPLEMENTATION.md`
- **Performance Report**: `LOAD_TEST_PERFORMANCE_REPORT.md`
- **Monitoring Dashboard**: Access via `/admin/analytics`

---

**Created**: November 11, 2025  
**Status**: Ready to implement  
**Owner**: Engineering Team
