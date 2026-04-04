# Implementation Gap Verification Checklist
**Purpose:** Verify which claims from the Architecture Review are actually implemented vs. designed-only  
**Status:** 2 potential gaps identified via grep_search (semantic entailment + contextual fallbacks)

---

## Gap 1: Semantic Entailment in Reasoning Gate

**Claim (from ARCHITECT_ACTION_PLAN.md):** 
> "Semantic entailment check in Gate 2 (Reasoning): 60% token overlap threshold"

**Verification Steps:**

```bash
# Search 1: Look for entailmentSignal variable
grep -r "entailmentSignal" lib/ app/

# Search 2: Look for "token overlap" calculation
grep -r "tokenOverlap\|token.*overlap" lib/rag/

# Search 3: Look for semantic entailment in validation
grep -r "entail\|semantic.*signal" lib/rag/validation-pipeline.ts

# Search 4: Check validateReasoning function
grep -r "validateReasoning" lib/

# Expected: If implemented, should find 1+ matches in lib/rag/validation-pipeline.ts
# Actual: [GREP SEARCH RETURNED 0 MATCHES]

# Conclusion: ⚠️ LIKELY NOT IMPLEMENTED — May be designed but not coded
```

**If Gap Confirmed (Implementation Required):**

Location: `lib/rag/validation-pipeline.ts` → `validateReasoning()` function

Add logic before returning gate result:

```typescript
// Inside validateReasoning()
function computeTokenOverlap(text1: string, text2: string): number {
  const tokens1 = new Set(text1.toLowerCase().split(/\s+/));
  const tokens2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = [...tokens1].filter(t => tokens2.has(t));
  const union = new Set([...tokens1, ...tokens2]);
  return intersection.length / union.size;
}

const entailmentSignal = computeTokenOverlap(context, request);
if (entailmentSignal < 0.6) {
  return {
    passed: false,
    reason: 'Context does not entail request (semantic signal < 0.6)',
    signal: entailmentSignal,
  };
}

// Return passed result if signal >= 0.6
return { passed: true, signal: entailmentSignal };
```

**Effort:** 15 minutes (add token overlap utility + threshold check)

---

## Gap 2: Contextual Safe Fallbacks

**Claim (from ARCHITECT_ACTION_PLAN.md):**
> "6 distinct fallback strategies by failure reason: numerical-integrity, textual-hallucination, grounding-audit, generation-quality, pipeline-overall"

**Verification Steps:**

```bash
# Search 1: Look for buildContextualFallback factory
grep -r "buildContextualFallback" lib/ app/

# Search 2: Look for 6 fallback strategies
grep -r "numerical.*integrity\|textual.*hallucination" lib/rag/

# Search 3: Check app/api/qa/route.ts for fallback logic
grep -r "fallback\|FALLBACK" app/api/qa/route.ts

# Expected: Should find a factory function with 6 branches
# Actual: [GREP SEARCH RETURNED 0 MATCHES for buildContextualFallback]

# Conclusion: ⚠️ POSSIBLY NOT IMPLEMENTED
# Note: app/api/qa/route.ts DOES have safe fallback at lines ~2970-3000
# BUT it appears to be generic ("I want to give you a fully accurate answer...")
# NOT contextual (different message per failure reason)
```

**If Gap Confirmed (Implementation Required):**

Location: `lib/rag/utils/contextual-fallbacks.ts` (NEW FILE)

```typescript
export type ValidationFailureReason =
  | 'numerical-integrity'
  | 'textual-hallucination'
  | 'grounding-audit'
  | 'generation-quality'
  | 'pipeline-overall';

export function buildContextualFallback(
  failures: ValidationFailureReason[],
  context: {
    query: string;
    category: string;
    companyId: string;
  }
): string {
  const primaryFailure = failures[0];

  switch (primaryFailure) {
    case 'numerical-integrity':
      return (
        `I noticed the pricing/contribution calculations for "${context.category}" ` +
        `might not be 100% accurate. Please visit your benefits portal or contact HR ` +
        `to confirm the exact amounts. I want to ensure you have the precise numbers.`
      );

    case 'textual-hallucination':
      return (
        `I'm not confident enough in my answer about "${context.category}" to share it right now. ` +
        `To avoid giving you incorrect information, please speak with your HR team directly. ` +
        `They can provide verified details about your plan.`
      );

    case 'grounding-audit':
      return (
        `I couldn't fully verify my response against your benefits documents for "${context.category}". ` +
        `To be 100% certain, please check your official benefits guide or call your HR department.`
      );

    case 'generation-quality':
      return (
        `My answer quality score is lower than I'd like for this topic. ` +
        `For your confidence and peace of mind, please escalate to your HR team who can give you ` +
        `a comprehensive, verified answer about "${context.category}".`
      );

    case 'pipeline-overall':
      return (
        `I encountered a technical issue processing your question about "${context.category}". ` +
        `Please try again in a moment, or contact your HR department if this persists.`
      );

    default:
      return (
        `I want to give you an accurate answer, but I need to verify some details first. ` +
        `Please contact your HR team for immediate assistance.`
      );
  }
}
```

Then in `app/api/qa/route.ts` (around line 2970), replace generic fallback:

```typescript
// OLD:
const fallbackResponse = "I want to give you a fully accurate answer...";

// NEW:
import { buildContextualFallback } from '@/lib/rag/utils/contextual-fallbacks';

const fallbackResponse = buildContextualFallback(
  metadata.validationGate.failures as ValidationFailureReason[],
  {
    query: userQuery,
    category: detectedCategory,
    companyId: user.companyId,
  }
);
```

**Effort:** 30 minutes (create file + integrate into qa/route.ts)

---

## Gap 3-5: Currently Verified ✅

| Feature | Location | Status | Evidence |
|---------|----------|--------|----------|
| Hard Validation Gate | app/api/qa/route.ts ~2949 | ✅ IMPLEMENTED | 5-layer checks with validationGateFailures array |
| Session TTL (24h) | lib/rag/session-store.ts | ✅ IMPLEMENTED | ttl: 86400 on all upsertItem calls |
| Optimistic Concurrency | lib/rag/session-store.ts | ✅ IMPLEMENTED | accessCondition.IfMatch on _etag field |
| Catalog Versioning | lib/data/amerivet.ts | ✅ IMPLEMENTED | CATALOG_VERSION + CATALOG_HASH in responses |
| Intra-Session Consistency | (Not yet verified) | 🚧 PENDING | Needs grep for consistency-audit.ts |
| Credential-Aware Testing | tests/eval/eval-runner.test.ts | ✅ IMPLEMENTED | hasRealCredentials() + skipIfNoRealCreds |

---

## Recommended Action Order

### Priority 1 (This Week): Verify & Close Gaps [1h]

1. **Semantic Entailment** (15 min)
   - Read full lib/rag/validation-pipeline.ts
   - If missing: Add token overlap logic + <0.6 threshold check
   - Add test case for entailment signal < 0.6

2. **Contextual Fallbacks** (30 min)
   - Create lib/rag/utils/contextual-fallbacks.ts
   - Integrate into app/api/qa/route.ts
   - Update responses to surface failure reason to employee

### Priority 2 (This Week): Verify Additional Features [30 min]

3. **Intra-Session Consistency**
   - grep for consistency-audit.ts
   - If missing: Document pattern + mark for Q1 2025

4. **Architecture Decision Log** (60 min)
   - Create docs/ARCHITECTURE.md
   - Document 3 key decisions (hard gates, 6-layer design, stateful sessions)

### Priority 3 (Next Week): Dashboard Completion [4h]

5. **Quality Dashboard** (follow QUALITY_DASHBOARD_IMPLEMENTATION.md)
   - Complete chart components (recharts)
   - Wire Application Insights queries
   - Deploy to /admin/quality-dashboard

---

## Quick Verification Script

Save as `verify-implementations.sh`:

```bash
#!/bin/bash

echo "🔍 Verifying Architecture Review Implementations..."
echo ""

# Test 1: Semantic Entailment
echo "1️⃣  Semantic Entailment Check:"
if grep -q "entailmentSignal\|tokenOverlap" lib/rag/validation-pipeline.ts 2>/dev/null; then
  echo "   ✅ FOUND in validation-pipeline.ts"
else
  echo "   ❌ NOT FOUND — Gap confirmed"
fi

# Test 2: Contextual Fallbacks
echo "2️⃣  Contextual Safe Fallbacks:"
if grep -q "buildContextualFallback\|numerical.*integrity.*fallback" lib/rag/*.ts 2>/dev/null; then
  echo "   ✅ FOUND in lib/rag/"
else
  echo "   ❌ NOT FOUND — Gap confirmed"
fi

# Test 3: Hard Gate
echo "3️⃣  Hard Validation Gate:"
if grep -q "validationGateFailures" app/api/qa/route.ts 2>/dev/null; then
  echo "   ✅ FOUND in app/api/qa/route.ts"
else
  echo "   ❌ NOT FOUND — Gap confirmed"
fi

# Test 4: Session TTL
echo "4️⃣  Session TTL (24h):"
if grep -q "ttl.*86400\|ttl: 86400" lib/rag/session-store.ts 2>/dev/null; then
  echo "   ✅ FOUND in session-store.ts"
else
  echo "   ❌ NOT FOUND — Gap confirmed"
fi

# Test 5: Catalog Versioning
echo "5️⃣  Catalog Version Metadata:"
if grep -q "CATALOG_VERSION\|catalogHash" lib/data/amerivet.ts 2>/dev/null; then
  echo "   ✅ FOUND in amerivet.ts"
else
  echo "   ❌ NOT FOUND — Gap confirmed"
fi

echo ""
echo "✅ Verification complete. Run with: bash verify-implementations.sh"
```

Run: `bash verify-implementations.sh`

---

## Summary for Next Session

**Implementation Status:**
- ✅ 3/5 features verified in code (Hard Gate, Session TTL, Catalog Versioning)
- 🚧 2/5 features pending verification (Semantic Entailment, Contextual Fallbacks)
- ⏳ Dashboard: 80% complete (needs chart rendering + App Insights wiring)

**Next Actions (Prioritized):**
1. Run verification script to confirm gaps
2. If gaps exist: Implement semantic entailment (15 min) + contextual fallbacks (30 min)
3. Complete quality dashboard (4h)
4. Create ARCHITECTURE.md decision log (1h)

**Estimated Total Effort:** 6-7 hours to reach 100% Tier 5 completion
