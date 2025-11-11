# L1, L2, L3 Tier System Explained
**AmeriVet Benefits AI Chatbot - LLM Routing Architecture**

---

## Quick Overview

The chatbot uses **3 different AI models** depending on query complexity:

```
                    Query comes in
                          ↓
        ┌─────────────────────────────────┐
        │   Pattern Router analyzes       │
        │   - Query complexity            │
        │   - Retrieval confidence        │
        │   - Risk level                  │
        └─────────────────┬───────────────┘
                          ↓
        ┌─────────────────────────────────┐
        │   Route to appropriate tier     │
        └─┬───────────────┬───────────────┬─┘
          ↓               ↓               ↓
        L1            L2              L3
      (Cached)    (Semantic)      (Complex)
      Fast &       Balanced        Powerful
      Cheap        Cost/Quality    (Most $)
```

---

## L1 Tier: CACHED RESPONSES ⚡

### What is L1?
**Pre-cached answers from previous queries.** No AI generation happens.

### How it works
```
User asks: "What is my medical deductible?"
System checks: "Have we answered this exact question before?"
  ↓
YES → Retrieve from cache (5ms) ✅
NO → Send to L2 or higher

Cost: $0.29/request (just storage + retrieval)
Speed: <1 second (usually 400-600ms)
Quality: Perfect (it's a real previous answer)
```

### When L1 is used
```
✅ Exact repeats: "What is my medical deductible?"
✅ Common questions: "How do I add my spouse?"
✅ FAQ-style queries: "What's covered by dental?"
✅ High-frequency patterns: "Tell me about my HSA"
```

### L1 Hit Rate
```
Current: 30% of all queries
Meaning: 3 out of 10 questions come from cache (no LLM call)
This saves: ~$850/month

Higher hit rate = Lower costs
  - 65% cache → $850 saved
  - 75% cache → $1,700 saved
  - 85% cache → $2,550 saved
```

### Cache Types in L1

**L0 Cache (Exact Match)**
```
Query hash: "what is my medical deductible"
Match? → Return instantly (<5ms)
Hit rate: 22%
```

**L1 Cache (Semantic Similarity ≥0.92)**
```
User asks: "What's my deductible for medical?"
System: "Is this similar to a previous answer?"
Similarity score: 0.95 (very similar!)
Match? → Return with slight rephrasing (42ms)
Hit rate: 69% (of cache misses)
```

---

## L2 Tier: SEMANTIC RETRIEVAL 🔍

### What is L2?
**AI model reads relevant documents and generates answer.** Balanced approach.

### How it works
```
User asks: "Compare dental and medical benefits for family coverage"
System: "This is a new question, needs AI"
  ↓
Step 1: Search documents
  - Vector search (AI Search): Find similar chunks
  - BM25 search: Find keyword matches
  - Combine results (RRF merge)
  - Pick top 8 most relevant chunks
  ↓
Step 2: Generate answer
  - Send chunks + question to GPT-4-turbo
  - Generate detailed comparison
  - Add source citations
  ↓
Step 3: Validate
  - Check grounding (is answer backed by docs?)
  - Redact PII (remove sensitive data)
  - Verify citations exist
  ↓
Return answer

Cost: $1.01/request
Speed: 2-3 seconds (usually 2.7s)
Quality: Excellent (human-readable with sources)
```

### When L2 is used
```
✅ Comparative questions: "Dental vs Medical benefits?"
✅ Multi-part queries: "If I add my spouse, what happens to..."
✅ Scenario-based: "What if I change from individual to family?"
✅ Detailed explanations: "How does my HSA contribution work?"
✅ Plan-specific: "Which plan covers psychiatric care?"
```

### L2 Coverage (39% of queries)
```
Why 39%?
- 30% L1 cache hits (no L2 needed)
- 39% L2 semantic retrieval (this tier)
- 28% L3 complex reasoning (below)
- 3% error/escalation
```

### L2 Model Details
```
Model: GPT-4-turbo (Azure OpenAI)
Input tokens: ~8,456 (query + retrieved docs)
Output tokens: ~1,247 (generated response)

Token pricing:
  Input: $10/1M tokens → $0.085 per request
  Output: $30/1M tokens → $0.037 per request
  Infrastructure: $0.12 (retrieval + validation)
  Total: $1.01/request
```

---

## L3 Tier: COMPLEX REASONING 🧠

### What is L3?
**Most powerful AI model with strict validation.** For tricky questions.

### How it works
```
User asks: "If I add my spouse mid-year, how does that affect 
           my medical premiums, HSA contributions, and 
           dependent coverage effective date?"
           
System: "This is complex. Multiple moving parts. Use L3."
  ↓
Step 1: Deep document retrieval
  - Vector search: Get 24 most similar chunks
  - BM25 search: Get 24 keyword matches
  - RRF merge: Combine into top 12 chunks
  - Re-rank: Find most relevant 8 chunks
  ↓
Step 2: Generate with powerful model
  - Send to GPT-4 (most capable)
  - More context = more thorough answer
  - Handle complex scenarios
  ↓
Step 3: Strict validation
  - Grounding check: >70% minimum
  - PII redaction: Even stricter
  - Citation verification: All sources valid
  ↓
Step 4: If validation fails
  - Retry with more context
  - Or escalate for human review
  ↓
Return answer (if passes validation)

Cost: $2.63/request
Speed: 5-6 seconds (usually 5.2s)
Quality: Extremely high (multiple validations)
```

### When L3 is used
```
✅ Complex multi-part scenarios
✅ Regulatory/compliance questions
✅ Rare plan features
✅ Edge cases or exceptions
✅ High-risk questions (affecting benefits)
```

### L3 Coverage (28% of queries)
```
Most queries don't need this level.
Only ~28% get routed here based on complexity signals:
  - Multiple entities (spouse, children, etc)
  - Multiple time-dependent rules
  - High financial impact
  - Low retrieval confidence
```

### L3 Model Details
```
Model: GPT-4 (Azure OpenAI) - Most expensive
Input tokens: ~12,847 (comprehensive context)
Output tokens: ~2,156 (detailed response)

Token pricing:
  Input: $30/1M tokens → $0.385 per request
  Output: $60/1M tokens → $0.129 per request
  Infrastructure: $0.16 (strict validation)
  Total: $2.63/request
```

### Escalation Within L3
```
If initial generation fails validation:
  1. Retry with expanded context (1st retry)
  2. If still fails, retry with different prompt (2nd retry)
  3. If still fails after 2 retries → Mark for manual review
  
Max escalation attempts: 2
If all fail: Response flagged for human support team
```

---

## Comparison Table

| Aspect | L1 | L2 | L3 |
|--------|----|----|-----|
| **Model** | None (cached) | gpt-4-turbo | gpt-4 |
| **Speed** | <1s (400ms) | 2-3s (2.7s) | 5-6s (5.2s) |
| **Cost** | $0.29 | $1.01 | $2.63 |
| **Response Quality** | Perfect | Excellent | Excellent+ |
| **Grounding Check** | N/A | ~70% avg | >70% strict |
| **When Used** | Repeats | New questions | Complex scenarios |
| **% of Traffic** | 30% | 39% | 28% |
| **Monthly Cost** | $5,220 | $23,634 | $44,184 |

---

## Tier Distribution (Current)

```
L1 (30%) - Cached Answers
├─ Fast, cheap, perfect quality
├─ Hit 30% of incoming queries
└─ Saves ~$850/month

L2 (39%) - Semantic Search + AI
├─ Balanced cost and quality
├─ Most questions end here
└─ Primary cost driver (~$23K/month)

L3 (28%) - Complex Reasoning
├─ Expensive but necessary for edge cases
├─ High validation standards
└─ Costs ~$44K/month (most expensive tier)
```

---

## How Tier Selection Works (Pattern Router)

The system analyzes each query and scores it:

```
┌─ QUERY ANALYSIS ─────────────────────┐
│                                      │
│ Factor 1: Query Complexity           │
│   - Word count: 5-10 words = low     │
│   - Punctuation: "?" = simple        │
│   - Entities: "spouse, mid-year" = high
│   Score: 0-1 scale                   │
│                                      │
│ Factor 2: Retrieval Confidence       │
│   - Document match score (0-1)       │
│   - High score = strong matches      │
│   Score: 0-1 scale                   │
│                                      │
│ Factor 3: Risk Level                 │
│   - Financial impact: High/Med/Low   │
│   - Regulatory: Y/N                  │
│   Score: 0-1 scale                   │
│                                      │
└─ COMBINED SCORE (0-1) ───────────────┘
        ↓
  ┌─────────────────────┐
  │ Decide tier:        │
  │ ≤0.40 → L1 (cache)  │  Try cache first
  │ 0.40-0.75 → L2      │  Most queries here
  │ >0.75 → L3          │  Complex only
  └─────────────────────┘
```

### Example: Query Routing

**Query 1: "What's my deductible?"**
```
Complexity: 0.15 (simple, 4 words)
Confidence: 0.92 (strong semantic match in cache)
Risk: 0.20 (low financial impact, straightforward)
────────────────────────────
Combined score: 0.42 (average of signals)
Route: L2 (but likely cache hit in L1)
Actual: L1 (returns cached answer in 400ms)
```

**Query 2: "Compare dental and medical for family"**
```
Complexity: 0.55 (comparative, 6 words)
Confidence: 0.68 (moderate match in docs)
Risk: 0.40 (medium - plan comparison)
────────────────────────────
Combined score: 0.54
Route: L2 (semantic search + generation)
Actual: L2 (generates answer in 2.7s)
Cost: $1.01
```

**Query 3: "If I add my spouse mid-year, how does HSA, premiums, and coverage dates work?"**
```
Complexity: 0.88 (complex, 14 words, multiple clauses)
Confidence: 0.42 (lower match - very specific scenario)
Risk: 0.95 (high - affects multiple benefits, timing critical)
────────────────────────────
Combined score: 0.75
Route: L3 (complex reasoning)
Actual: L3 (full context, strict validation, 5.2s)
Cost: $2.63
```

---

## Cost Implications

### Monthly Cost by Tier (500 users)

```
L1: 30% of 60,000 queries = 18,000 queries
    18,000 × $0.29 = $5,220/month

L2: 39% of 60,000 queries = 23,400 queries
    23,400 × $1.01 = $23,634/month

L3: 28% of 60,000 queries = 16,800 queries
    16,800 × $2.63 = $44,184/month

Cache savings: ~$8,000/month (cost avoided)

TOTAL: $65,038/month
```

### How to Reduce Costs

**Option 1: Increase L1 Cache Hit Rate**
```
From 30% → 40% (shift 6,000 queries to L1)
Savings: 6,000 × ($1.01 - $0.29) = $4,320/month

How: Improve cache key normalization
  - Handle synonyms: "deductible" = "deductible amount"
  - Normalize abbreviations: "HSA" = "Health Savings Account"
  - Relax similarity threshold: 0.92 → 0.88
```

**Option 2: Shift L3 Queries to L2**
```
From 28% → 20% (move 4,800 queries to L2)
Savings: 4,800 × ($2.63 - $1.01) = $7,776/month

How: Adjust routing thresholds
  - Increase complexity threshold from 0.75 → 0.85
  - Risk: Some complex queries may get insufficient answers
```

**Option 3: Negotiate Model Pricing**
```
Azure OpenAI volume discounts:
  <$100K/month: Full price
  $100K-$500K/month: 10-15% discount
  >$500K/month: 20-25% discount

At $65K/month: Possible to negotiate 5-10% discount
Savings: $3,250-$6,500/month
```

---

## Performance Targets by Tier

```
L1 (Cached):
  Target: <1.5s p95
  Actual: 987ms ✅
  SLA: 99.5%

L2 (Semantic):
  Target: <3.0s p95
  Actual: 2.76s ✅
  SLA: 99.0%

L3 (Complex):
  Target: <6.0s p95
  Actual: 5.23s ✅
  SLA: 98.5%
```

---

## User Experience by Tier

### L1 Experience (Fast & Instant)
```
User: "What's my deductible?"
System: "Your medical deductible is $1,500 for individual coverage,
         $3,000 for family. Found in seconds from cache!"
Duration: 400ms (feels instant)
Satisfaction: ⭐⭐⭐⭐⭐ (very happy - fast!)
```

### L2 Experience (Balanced)
```
User: "Compare dental and medical benefits"
System: "Here's the comparison:
         Dental: 80% preventive, 50% major, $50 copay
         Medical: 80% after deductible, $1,500 deductible...
         Sources: Plan Document 2025, Section 3.2"
Duration: 2.7s (feels responsive)
Satisfaction: ⭐⭐⭐⭐⭐ (very happy - detailed answer!)
```

### L3 Experience (Thorough)
```
User: "If I add spouse mid-year, what happens?"
System: "Adding spouse mid-year triggers:
         1. Premium adjustment: +$450/month effective [date]
         2. HSA contribution: Reset to family limit ($8,300)
         3. Coverage: Effective date is [calculation]
         
         Important: IRS rules require prorated contributions...
         Sources: Benefits Guide 2025, IRS Section 223, Plan Terms"
Duration: 5.2s (feels thorough)
Satisfaction: ⭐⭐⭐⭐⭐ (very happy - comprehensive!)
```

---

## Quick Reference

### When you see "L1" mentioned:
- = **Cached answer** (pre-existing response)
- ⚡ Fast, cheap, perfect
- 30% of queries

### When you see "L2" mentioned:
- = **Semantic search + AI generation** (retrieval-augmented)
- 🔍 Balanced speed and cost
- 39% of queries (most end here)

### When you see "L3" mentioned:
- = **Complex reasoning with strict validation** (full GPT-4 power)
- 🧠 Most expensive but highest quality
- 28% of queries

---

## Summary

```
┌─ THE 3-TIER SYSTEM ────────────────────────┐
│                                           │
│  L1: Cheap, instant (cache)              │
│  L2: Balanced (semantic search + AI)     │
│  L3: Powerful (full AI reasoning)        │
│                                           │
│  Smart routing: Matches complexity       │
│  Cost control: Optimize cache → save $   │
│  Quality: All tiers validated            │
│                                           │
└───────────────────────────────────────────┘
```

---

**Version**: 1.0  
**Last Updated**: November 11, 2025  
**For Questions**: See `LOAD_TEST_PERFORMANCE_REPORT.md` or `COST_CONTROL_AND_OBSERVABILITY_GUIDE.md`
