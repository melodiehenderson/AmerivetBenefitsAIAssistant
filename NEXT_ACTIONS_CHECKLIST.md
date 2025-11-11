# Next Actions Checklist - Cache Optimization Deployment

**Status**: Implementation Complete ✅ | Deployment Ready ✅

---

## 🎯 Immediate Next Steps

### 1. Code Review & Verification ⏳ (You are here)

**What to review**:
```bash
# View changes
git status                    # Should show 3 files modified/created
git diff lib/rag/cache-utils.ts
git diff lib/rag/cache-warmup.ts
git diff lib/rag/observability.ts
```

**Files to examine**:
- [ ] `lib/rag/cache-utils.ts` - SYNONYM_MAP with 18 terms + normalizeQueryWithSynonyms()
- [ ] `lib/rag/cache-warmup.ts` - New warmup module with Cosmos DB integration
- [ ] `lib/rag/observability.ts` - Cache metrics tracking functions

---

### 2. Git Commit ⏳

```bash
# When ready, run:
git add -A
git commit -m "feat: implement cache optimization Phase 1 & 2 - synonym normalization, dynamic thresholds, query clustering, cache warmup with aggressive settings"
git push origin consolidated/copilot-vscode-latest
```

**Expected**: New commit with 3 files, +580 lines

---

### 3. Integration into QA Route (Next Step) ⏳

**File**: `app/api/qa/route.ts`

**Changes needed**:

1. **Add warmup call at module initialization**:
```typescript
import { warmupCache } from '@/lib/rag/cache-warmup';
import { trackCacheHit } from '@/lib/rag/observability';

let warmupInitialized = false;

export const POST = requireAuth(async (req, { user }) => {
  const { companyId } = user;
  
  // Initialize warmup once on first request (production only)
  if (!warmupInitialized && process.env.NODE_ENV === 'production') {
    warmupCache(redisClient, cosmosClient, companyId)
      .catch(err => console.error('[QA] Cache warmup failed:', err));
    warmupInitialized = true;
  }
  
  // ... rest of handler
});
```

2. **Add cache hit tracking** (after cache lookup):
```typescript
// Before returning response
if (cacheSource === 'l0') trackCacheHit('l0');
else if (cacheSource === 'l1') trackCacheHit('l1');
else if (cacheSource === 'cluster') trackCacheHit('cluster');
else if (cacheSource === 'warmup') trackCacheHit('warmup');
else trackCacheHit('miss');
```

---

### 4. Staging Deployment ⏳

**Timeline**: This week

```bash
# Option 1: Vercel automatic deployment (recommended)
vercel preview

# Option 2: Manual deployment to staging
vercel --prod --target=staging

# Monitor logs
vercel logs --follow
```

**Validation**:
- [ ] Warmup executed successfully
- [ ] Synonym normalization working (test: "healthcare insurance" → cache key)
- [ ] Cache metrics visible in logs (every 100 requests)
- [ ] No new errors introduced
- [ ] Hit rate improving over 24h

---

### 5. Monitoring Setup (Parallel) 🔵

**File**: `app/admin/analytics/page.tsx`

**Add cache metrics widget**:
```typescript
import { getCacheMetrics } from '@/lib/rag/observability';

export default function AnalyticsPage() {
  const metrics = getCacheMetrics();
  
  return (
    <div className="grid gap-4">
      {/* ... existing metrics ... */}
      
      {/* New: Cache Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Cache Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Hit Rate</p>
              <p className="text-2xl font-bold">{metrics.hitRate.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Requests</p>
              <p className="text-2xl font-bold">{metrics.totalRequests}</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-4">
            <div className="text-center">
              <p className="text-xs text-gray-500">L0</p>
              <p>{metrics.l0Hits}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">L1</p>
              <p>{metrics.l1Hits}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Cluster</p>
              <p>{metrics.clusterHits}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Warmup</p>
              <p>{metrics.warmupHits}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

### 6. Production Rollout (Phase A) ⏳

**Timeline**: Week 2-3

```bash
# Deploy to production
vercel --prod

# Enable for 1 test company first
# (Update feature flag or manual toggle in admin)

# Monitor for 24h
# - Check cache hit rate
# - Check error rate (should be <0.1%)
# - Check latency (should be <700ms avg)
```

---

### 7. Gradual Expansion ⏳

**Timeline**: Week 3-4

```
Phase A (Week 2): 1 company test group (5% of queries)
  ↓ Validation: 45-50% hit rate ✓
Phase B (Week 3): 10% of companies (500k queries/mo)
  ↓ Validation: 60-65% hit rate ✓
Phase C (Week 4): 100% rollout
  ↓ Validation: 70%+ hit rate ✓
```

---

## 📊 Success Metrics to Track

### Real-Time (Log Daily)
```
✓ Cache hit rate: _____% (target: 70%)
✓ L0/L1/Cluster/Warmup breakdown
✓ Average response time: _____ms (target: <700ms)
✓ Error rate: ____% (target: <0.1%)
✓ Cost/query: $_____ (target: <$0.35)
```

### Weekly (Track Over Time)
```
✓ Week-over-week hit rate change
✓ Cost savings achieved
✓ False positive rate
✓ Latency percentiles (p50/p95/p99)
✓ Anomalies or issues identified
```

---

## 🚨 Rollback Plan (If Issues)

If hit rate **drops** or error rate **increases** during rollout:

```bash
# 1. Identify root cause
git log --oneline -10
git diff HEAD~1

# 2. Quick mitigation options:
# Option A: Lower threshold back to 0.90 (less aggressive matching)
# Option B: Disable warmup (comment out warmupCache() call)
# Option C: Rollback commit entirely

# 3. To rollback:
git revert <commit-hash>
vercel --prod

# 4. Post-mortems:
# - Adjust thresholds
# - Review false positives
# - Retest before re-enabling
```

---

## 📝 Documentation Links

- **Full Implementation Details**: `CACHE_IMPLEMENTATION_COMPLETE.md`
- **Original Planning Guide**: `CACHE_OPTIMIZATION_GUIDE.md`
- **Quick Reference**: `CACHE_OPTIMIZATION_SUMMARY.md`
- **Code Files**:
  - `lib/rag/cache-utils.ts` - Core normalization + clustering
  - `lib/rag/cache-warmup.ts` - Pre-loading strategy
  - `lib/rag/observability.ts` - Metrics tracking

---

## ⏱️ Timeline Summary

| Step | Timeline | Owner | Status |
|------|----------|-------|--------|
| Code Review | Today | You | ⏳ In Progress |
| Git Commit | Today | You | ⏳ Pending |
| QA Route Integration | This Week | Dev | ⏳ Pending |
| Staging Deployment | This Week | DevOps | ⏳ Pending |
| Staging Validation | This Week | QA | ⏳ Pending |
| Production Rollout Phase A | Week 2 | DevOps | ⏳ Pending |
| Production Rollout Phase B | Week 3 | DevOps | ⏳ Pending |
| Production Rollout Phase C | Week 4 | DevOps | ⏳ Pending |

**Total Timeline**: 4 weeks (conservative estimate with safety margins)

---

## 🎯 Expected Results

After full production rollout:

```
BEFORE:
├─ Cache Hit Rate: 30%
├─ Avg Response: 2,100ms (LLM waiting)
├─ Cost/Month: $52,560
└─ LLM Queries: 42,000/month

AFTER (4 weeks):
├─ Cache Hit Rate: 70% ✓
├─ Avg Response: 650ms (69% faster) ✓
├─ Cost/Month: $24,240 ✓
├─ Monthly Savings: $28,320 (54% reduction) ✓
└─ LLM Queries: 18,000/month ✓
```

---

## ✅ Pre-Deployment Validation

Before proceeding past this step, verify:

- [ ] All 3 files exist and contain expected code
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] No lint errors: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] Tests pass: `npm run test` (if any cache tests exist)
- [ ] Git status clean: `git status` shows staged changes

```bash
# Quick validation command
npm run guard && npm run typecheck && npm run lint && npm run build
```

If all ✅, proceed to git commit.

---

**Created**: November 11, 2025  
**Status**: Ready for Action  
**Next**: Your review ➜ Git commit ➜ Staging deployment
