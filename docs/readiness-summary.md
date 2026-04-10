# AmeriVet Assistant Readiness Summary

Last updated: 2026-04-10
Branch: `codex/eval-architecture-hardening`

## Purpose

This document is the current release-gate snapshot for deciding when the build is ready for client testing and demo review.

## Current Validation Results

### 1. Deterministic Eval Gate

Command:

```bash
npx vitest run tests/eval/eval-runner.test.ts --reporter=dot
```

Latest result:

- `totalCases: 116`
- `avgAccuracy: 0.9483`
- `avgPrecision: 0.8011`
- `avgRecall: 0.7054`
- `hallucinationRate: 0`
- `groundingProxyScore: 100`

Category snapshot:

- `banned_entities`: `9/9`
- `carrier_attribution`: `9/9`
- `context_carryover`: `24/24`
- `coverage_tier`: `3/3`
- `deductible_reset`: `3/3`
- `dhmo_guard`: `3/3`
- `grounding_hallucination`: `4/4`
- `hsa_fsa_irs`: `7/7`
- `kaiser_geography`: `11/11`
- `no_pricing_mode`: `6/6`
- `plan_comparison`: `13/13`
- `qle_enrollment`: `6/6`
- `rightway_guard`: `5/5`
- `source_citation`: `3/3`
- `std_leave_pay`: `7/7`
- `vision_dental`: `3/3`

Assessment:

- Threshold target: `90-95%+`
- Current result: `94.83%`
- Status: `Meets threshold`

Notes:

- This is still an offline deterministic runner, not a full live end-to-end user simulation.
- Dataset size exceeds the `100+` target.

### 2. Live Retrieval Gate

Command:

```bash
RUN_RETRIEVAL_EVAL=1 npm run eval:retrieval
```

Latest result:

- `totalCases: 18`
- `stableCases: 18`
- `stableRate: 1.0`
- `avgRecallAtK: 0.7824`
- `avgMRR: 0.8583`

Assessment:

- Threshold target: deterministic/stable recall and MRR across repeated runs
- Current result: stable across all cases
- Status: `Meets current stability threshold`

Notes:

- Retrieval is now hitting the real Azure corpus and the full hybrid path is functional.
- A meaningful production bug was fixed in `lib/rag/hybrid-retrieval.ts`: vector-only fallback expansion was previously wiping out usable BM25 results.
- Coverage is improved and now includes support/contact, QLE timing, coverage-effective-date, and life-termination wording from the real corpus.
- The live retrieval suite is still smaller than the deterministic suite and should continue to expand.

### 3. Semantic Judge Gate

Command:

```bash
RUN_LLM_JUDGE_EVAL=1 npm run eval:judge
```

Latest result:

- `totalCases: 5`
- `overallAverage: 4.8`

Per-case averages:

- `LLM-JUDGE-001`: `5.0`
- `LLM-JUDGE-002`: `4.0`
- `LLM-JUDGE-003`: `5.0`
- `LLM-JUDGE-004`: `5.0`
- `LLM-JUDGE-005`: `5.0`

Assessment:

- Threshold target: `>= 4.0`
- Current result: `4.8`
- Status: `Meets threshold`

Notes:

- Judge execution now uses the real Azure OpenAI chat deployment.
- Test-harness fixes were required so the judge test could use real Azure config and real fetch semantics.

## Release-Gate Status

### Gates Currently Met

- Deterministic dataset size is above `100` cases
- Deterministic accuracy is inside the target range
- Known high-risk categories are green in the deterministic suite
- Live retrieval stability is green
- Live semantic judge average is above threshold

### Gates Not Fully Closed Yet

- Live retrieval coverage is not yet as broad as the deterministic eval coverage
- We do not yet have one consolidated machine-readable report artifact covering all three gates
- Manual product-owner retest has not happened yet
- Client-demo readiness should still wait until a final review pass confirms no regressions in the live experience

## Practical Recommendation

Current status: `close to client-test ready, but not at the final handoff checkpoint yet`

Recommended next steps:

1. Expand live retrieval cases further into policy-heavy areas, especially leave, portability, COBRA, and support/contact scenarios that map directly to official source text.
2. Add a small script or report artifact that captures deterministic, retrieval, and judge summaries together in one run.
3. Perform your personal spot-check pass against the build using the known drift scenarios plus a few real-world employee questions.
4. If those pass, treat that as the point to schedule the Brandon-team demonstration.

## Reference Files

- [docs/architecture-hardening-progress.md](/Users/melodie/Documents/Amerivet%20Bot/AmerivetBenefitsAIAssistant/docs/architecture-hardening-progress.md)
- [tests/eval/eval-dataset.jsonl](/Users/melodie/Documents/Amerivet%20Bot/AmerivetBenefitsAIAssistant/tests/eval/eval-dataset.jsonl)
- [tests/eval/retrieval-dataset.jsonl](/Users/melodie/Documents/Amerivet%20Bot/AmerivetBenefitsAIAssistant/tests/eval/retrieval-dataset.jsonl)
- [tests/eval/eval-runner.test.ts](/Users/melodie/Documents/Amerivet%20Bot/AmerivetBenefitsAIAssistant/tests/eval/eval-runner.test.ts)
- [tests/eval/retrieval-live.test.ts](/Users/melodie/Documents/Amerivet%20Bot/AmerivetBenefitsAIAssistant/tests/eval/retrieval-live.test.ts)
- [tests/eval/llm-judge.test.ts](/Users/melodie/Documents/Amerivet%20Bot/AmerivetBenefitsAIAssistant/tests/eval/llm-judge.test.ts)
