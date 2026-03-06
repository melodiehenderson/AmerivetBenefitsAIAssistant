# 🔍 CODE CHANGES QUICK REFERENCE
## Exact Line Numbers & Implementation Details

---

## ISSUE #1: Inconsistent Premium Figures
### Fix 1.1: Coverage Tier Normalization

**File**: [lib/rag/pricing-utils.ts](lib/rag/pricing-utils.ts#L25-L40)

| Function | Lines | Purpose |
|----------|-------|---------|
| `normalizeCoverageToken()` | 25-32 | Convert coverage strings to lowercase keys |
| `monthlyPremiumForPlan()` | 34-40 | Look up premium with normalized tier |

**Code**:
```typescript
// Line 28-32: Always return lowercase key
for (const k of Object.keys(COVERAGE_MULTIPLIERS)) {
  if (lower.includes(k)) return k; // Returns 'employee + child' (not 'Employee + Child')
}

// Line 35-39: Normalize before lookup
const tierKey = (coverageTier || 'employee only').toLowerCase();
const mult = COVERAGE_MULTIPLIERS[tierKey] ?? 1;
```

### Fix 1.2: Pricing Normalization

**File**: [lib/rag/pricing-utils.ts](lib/rag/pricing-utils.ts#L95-L130)

| Function | Lines | Purpose |
|----------|-------|---------|
| `normalizePricingInText()` | 95-130 | Standardize all price mentions |

**Applied In**: [app/api/qa/route.ts](app/api/qa/route.ts#L877)
```typescript
// Line 877: Post-LLM processing
answer = pricingUtils.normalizePricingInText(answer, session.payPeriods || 24);
```

### Fix 1.3: Per-Paycheck Intercept

**File**: [app/api/qa/route.ts](app/api/qa/route.ts#L654-L679)

| Step | Lines | What It Does |
|------|-------|-------------|
| Detect pattern | 654 | Regex: `/per pay(?:check\| period\| period)?/i` |
| Validate context | 666 | Check: medical category + state + age present |
| Calculate breakdown | 667-672 | Call `buildPerPaycheckBreakdown()` for all plans |
| Format response | 673 | Per-paycheck format with annualized totals |
| Cache & return | 674-679 | Save to session, return L1 response |

**Code**:
```typescript
const perPaycheckRequested = /per pay(?:check| period| period)?|per pay\b/i.test(query);
if (perPaycheckRequested && (category === 'MEDICAL' || routerResult.category === 'MEDICAL') && session.userState && session.userAge) {
  const coverageTier = extractCoverageFromQuery(query);
  const payPeriods = session.payPeriods || 24;
  const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);
  // ... format and return
}
```

---

## ISSUE #2: Wrong Benefit Category Returned
### Category Protection Flag

**File**: [app/api/qa/route.ts](app/api/qa/route.ts#L640)

```typescript
// Line 640: Detect explicit category request
const explicitCategoryRequested = !!explicitCategory;
```

**File**: [app/api/qa/route.ts](app/api/qa/route.ts#L725-L731)

```typescript
// Lines 725-731: Prevent category filter removal on expansion
if (category && explicitCategoryRequested) {
  console.log('[PIPELINE] Explicit category requested; skipping expansion to avoid cross-category leakage');
  const alt = `I searched our documents for ${category} plans but couldn't find confident pricing...`;
  session.lastBotMessage = alt;
  await updateSession(sessionId, session);
  return NextResponse.json({ 
    answer: alt, 
    tier: 'L1', 
    sessionContext: buildSessionContext(session), 
    metadata: { expanded: false, explicitCategoryRequested } 
  });
}
```

---

## ISSUE #3: Total Deduction Calculation Failure
### Fix 3.1: Decision Tracking Type

**File**: [lib/rag/session-store.ts](lib/rag/session-store.ts#L42)

```typescript
// Line 42: Session now tracks benefit selections
decisionsTracker?: Record<string, DecisionValue>;
```

### Fix 3.2: Total Deduction Calculator

**File**: [lib/rag/pricing-utils.ts](lib/rag/pricing-utils.ts#L74-L83)

```typescript
export function computeTotalMonthlyFromSelections(decisionsTracker: Record<string, any>, coverageTier: string = 'Employee Only') {
  if (!decisionsTracker) return 0;
  let total = 0;
  for (const [category, entry] of Object.entries(decisionsTracker)) {
    if (!entry || entry.status !== 'selected') continue;
    const planName = (entry.value || '').toString();
    const monthly = monthlyPremiumForPlan(planName, coverageTier);
    if (monthly) total += monthly;
  }
  return Math.round(total);
}
```

### Fix 3.3: Total Deduction Intercept

**File**: [app/api/qa/route.ts](app/api/qa/route.ts#L655)

```typescript
// Line 655: Detect total deduction request
const totalDeductionRequested = /enroll in all benefits|how much would be deducted per paycheck|total deduction per pay|total deducted per pay/i.test(query);
```

**File**: [app/api/qa/route.ts](app/api/qa/route.ts#L681-L689)

```typescript
// Lines 681-689: If user has selected benefits
if (totalDeductionRequested && session.decisionsTracker) {
  const coverageTier = extractCoverageFromQuery(query);
  const monthlyTotal = pricingUtils.computeTotalMonthlyFromSelections(session.decisionsTracker, coverageTier);
  const payPeriods = session.payPeriods || 24;
  const perPay = Math.round((monthlyTotal * 12) / payPeriods);
  const msg = `Based on your selected benefits, estimated deductions are $${perPay} per paycheck...`;
  session.lastBotMessage = msg;
  await updateSession(sessionId, session);
  return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'total-deduction' } });
}
```

---

## ISSUE #4 & #5: Enhancement Foundations
### Available Utilities for Future Extensions

**File**: [lib/rag/pricing-utils.ts](lib/rag/pricing-utils.ts#L1-150)

| Function | Lines | Can Be Extended For |
|----------|-------|-------------------|
| `buildPerPaycheckBreakdown()` | 57-65 | Cost modeling across plans |
| `monthlyPremiumForPlan()` | 34-40 | Per-plan cost calculations |
| `PLAN_META` | 17-21 | Deductible/OOP for cost estimation |
| `perPaycheckFromMonthly()` | 44-46 | Flexible paycheck division |

---

## ISSUE #6: Geographic Consistency
### State Consistency Enforcement

**File**: [lib/rag/pricing-utils.ts](lib/rag/pricing-utils.ts#L115-L132)

```typescript
export function ensureStateConsistency(answer: string, userStateCode: string | null): string {
  if (!userStateCode) return answer;
  const STATES = ['Alabama','Alaska',...'Wyoming'];
  const userStateName = STATES.find(s => s.toLowerCase().startsWith(userStateCode?.toLowerCase())) || null;
  let result = answer;
  for (const s of STATES) {
    if (userStateName && s.toLowerCase() === userStateName.toLowerCase()) continue;
    const re = new RegExp(`\\b${s}\\b`, 'gi');
    if (re.test(result)) {
      result = result.replace(re, userStateName || userStateCode);
    }
  }
  return result;
}
```

**Applied In**: [app/api/qa/route.ts](app/api/qa/route.ts#L882)

```typescript
// Line 882: Post-LLM processing
answer = pricingUtils.ensureStateConsistency(answer, session.userState || null);
```

---

## ISSUE #7: Orthodontics Consistency
### Current Validation Pipeline

**File**: [lib/rag/validation-pipeline.ts](lib/rag/validation-pipeline.ts)

Currently implements:
- Grounding score calculation (chunk similarity)
- Reasoning validation (query relevance)
- Output validation (placeholder for faithfulness)

### Enhancement Path

Future improvement point:
```typescript
// To add: Chunk-presence verification for major claims
function validateNonObviousClaims(answer: string, chunks: Chunk[]): string {
  // Check if answer mentions rare/specific benefits (orthodontics, etc)
  // Verify those benefits appear in retrieved chunks
  // If not found, either remove claim or downgrade confidence
}
```

---

## Type Safety Fixes
### Session Type Definitions

**File**: [lib/rag/session-store.ts](lib/rag/session-store.ts#L38-L42)

```typescript
// Lines 38-42: Proper null distinction
userAge?: number | null;           // Can be undefined OR explicitly null
userState?: string | null;         // Can be undefined OR explicitly null
payPeriods?: number;               // NEW: Stores biweekly (24) vs unique schedules
```

### Route Handler Type Fixes

**File**: [app/api/qa/route.ts](app/api/qa/route.ts#L666)

```typescript
// Line 666: MEDICAL enum value (not string 'Medical')
if (perPaycheckRequested && (category === 'MEDICAL' || routerResult.category === 'MEDICAL') && session.userState && session.userAge) {
```

**File**: [app/api/qa/route.ts](app/api/qa/route.ts#L703-L740)

```typescript
// Lines 703, 740: Null coalescing for proper type narrowing
userState: session.userState ?? null,
userAge: session.userAge ?? null,
```

---

## JSON Parsing Safety

**File**: [lib/rag/hybrid-retrieval.ts](lib/rag/hybrid-retrieval.ts#L902-L912)

```typescript
// Lines 902-912: Safe metadata parsing with error handling
function parseMetadata(metadataStr: string | undefined): Record<string, any> {
  if (!metadataStr) return {};
  try {
    return JSON.parse(metadataStr);
  } catch {
    return {};  // Graceful degradation on parse error
  }
}
```

**Applied In**:
- [Line 402](lib/rag/hybrid-retrieval.ts#L402): Vector search results
- [Line 514](lib/rag/hybrid-retrieval.ts#L514): BM25 search results
- [Line 417](lib/rag/hybrid-retrieval.ts#L417): Metadata spread in response

---

## JSX Syntax Fixes

**File**: [components/analytics/executive-dashboard.tsx](components/analytics/executive-dashboard.tsx#L411-L419)

```typescript
// Line 411: HTML entity escape
<span>Excellent (&gt;90%):</span>      // Was: Excellent (>90%)

// Line 419: HTML entity escape  
<span>Poor (&lt;70%):</span>           // Was: Poor (<70%)
```

---

## Summary of Code Locations

### Quick Navigation Table

| Issue | Primary File | Lines | Secondary File | Lines |
|-------|--------------|-------|----------------|-------|
| #1 | pricing-utils.ts | 25-130 | route.ts | 654-679 |
| #2 | route.ts | 640, 725-731 | - | - |
| #3 | pricing-utils.ts | 74-83 | route.ts | 655, 681-689 |
| #4 | pricing-utils.ts | 57-65 | - | - |
| #5 | pricing-utils.ts | 1-150 | - | - |
| #6 | pricing-utils.ts | 115-132 | route.ts | 882 |
| #7 | validation-pipeline.ts | All | - | - |

---

## Verification Commands

### Verify Changes Are In Place

```bash
# Check coverage tier normalization
grep -n "normalizeCoverageToken" lib/rag/pricing-utils.ts

# Check per-paycheck intercept
grep -n "perPaycheckRequested" app/api/qa/route.ts

# Check total deduction calculation
grep -n "computeTotalMonthlyFromSelections" lib/rag/pricing-utils.ts

# Check category protection
grep -n "explicitCategoryRequested" app/api/qa/route.ts

# Check state consistency
grep -n "ensureStateConsistency" app/api/qa/route.ts

# Check safe JSON parsing
grep -n "parseMetadata" lib/rag/hybrid-retrieval.ts

# Verify build passes
npm run build  # Should exit 0
```

---

## Testing Recommendations

### Manual Smoke Tests (Per Issue)

**Issue #1**: 
```
Query: "I'm single and healthy. What do you recommend?"
Expect: Consistent monthly pricing (e.g., "$87/month ($1,044 annually)")

Query: "How much per paycheck for Employee + Child?"
Expect: 4-plan breakdown with per-paycheck + monthly + annual
```

**Issue #2**:
```
Query: "How much per paycheck for Employee + Child under each plan?"
Expect: ONLY medical plans (no accident insurance)

Query: "What's the accident insurance cost?"
Expect: ONLY accident category results
```

**Issue #3**:
```
Query: "I want to enroll in HSA, Dental Plus, and Vision. How much per paycheck?"
Expect: Sum of all 3 premiums shown as per-paycheck
```

**Issue #6**:
```
Query: (As Texas user) "What's the coverage in my state?"
Expect: ONLY Texas mentioned (no cross-state references)
```

---

**Last Updated**: Feb 24, 2026
**Status**: Ready for Verification
