# Architecture Hardening Progress

This file tracks the major architecture and validation updates for the AmeriVet benefits assistant so engineering can follow the work without reconstructing it from chat history.

## Branch

- Active branch: `codex/eval-architecture-hardening`

## Goals

- Reduce source-of-truth drift across deterministic helpers, retrieval, and model generation
- Make yearly benefits-guide updates mostly a data and validation exercise
- Establish objective release gates before client testing

## Completed So Far

### 1. Evaluation Foundation Expanded

- Expanded `tests/eval/eval-dataset.jsonl` from the prior baseline to `121` cases across `17` categories
- Added stronger coverage for:
  - Kaiser geography and Georgia eligibility
  - Rightway banned-entity handling
  - STD and leave-pay edge cases
  - HSA/FSA conflict scenarios
  - QLE timelines
  - Context-carryover sequences
- Added optional metadata on newer cases to support future yearly rollovers:
  - `planYear`
  - `layer`
  - `sequenceId`
  - `turn`

### 2. Eval Reporting Improved

- Updated `tests/eval/eval-runner.test.ts` to emit a richer summary including:
  - `planYears`
  - `byCategory` pass rates
- This gives us a much clearer release-gate snapshot than a single aggregate number

### 3. Deterministic Eval Baseline Verified

- Offline eval runner is currently green
- Latest deterministic snapshot:
  - `116` deterministic cases evaluated
  - `avgAccuracy: 0.9483`
  - `hallucinationRate: 0`
  - deterministic category pass rates currently all `1.0` in the offline runner

### 4. Shared Route Policy Introduced

- Extended `lib/intent-digest.ts` so route policy now exposes:
  - `preferredLayer`
  - `fallbackLayer`
  - `deterministicFirst`
  - `requiresUserContext`
  - `rationale`
- `app/api/chat/route.ts` now logs selected route policy to make runtime decisions easier to audit

### 5. Retrieval Fail-Closed Improvement

- Removed the production behavior in `lib/rag/hybrid-retrieval.ts` that could silently fall back to a synthetic `128`-dimensional embedding when Azure embedding generation was unavailable
- Production retrieval now fails closed and returns safe fallback behavior instead of drifting into invalid vector execution
- Added targeted unit coverage for recoverable vector failures

### 6. Shared Facts Consolidation Started

- Added `lib/qa/facts.ts` as a central home for high-risk repeated benefit facts
- Moved shared Kaiser and Rightway wording into reusable constants/helpers
- Updated several helper and runtime files to consume the shared facts instead of re-stating them
- Corrected a remaining RAG prompt path that still listed Kaiser as available only in California, Oregon, and Washington

### 7. QA Route Policy Alignment Started

- Wired the early `qa` gate to use `determineChatRoutePolicy(...)` for policy-vs-context decisions instead of relying only on local branching
- Added route-policy logging in the `qa` path to make answer-layer decisions easier to inspect across both endpoints
- Replaced another `qa`-local Kaiser availability string with the shared facts helper

### 8. Carrier Lock Prompt Facts Consolidated

- Extended `lib/qa/facts.ts` to hold shared carrier-lock and banned-entity prompt facts
- Rewired these prompt surfaces to consume the shared block instead of maintaining their own parallel truth tables:
  - `app/api/chat/route.ts`
  - `lib/services/smart-chat-router.ts`
  - `lib/services/rag-chat-router.ts`
  - `lib/data/amerivet.ts`
- Updated the chain-of-verification example set to use Georgia-inclusive Kaiser geography

### 9. Retrieval Validation Harness Added

- Added `tests/eval/retrieval-dataset.jsonl` as a starter retrieval validation dataset
- Added `tests/eval/retrieval-metrics.ts` for phrase-based Recall@K and MRR measurement over retrieved chunks
- Added `scripts/run-retrieval-eval.ts` to run repeated retrieval checks against the live tenant corpus and summarize stability across runs
- Added unit coverage for retrieval metric helpers in `tests/unit/retrieval-metrics.test.ts`
- Added `tests/eval/retrieval-live.test.ts` and package script `npm run eval:retrieval` for repo-native execution through Vitest

Note:

- This harness is designed for the real tenant/company corpus and expects `RETRIEVAL_EVAL_COMPANY_ID`
- The retrieval dataset is intentionally starter-sized and will need phrase tuning after the first few live runs against production-like indexed documents
- Live command shape:
  - `RUN_RETRIEVAL_EVAL=1 RETRIEVAL_EVAL_COMPANY_ID=<company-id> npm run eval:retrieval`
- The live retrieval Vitest path now explicitly requires Azure Search and Azure OpenAI credentials, and bypasses the in-memory Vitest retrieval path only when `RUN_RETRIEVAL_EVAL=1`

## Current Verification Commands

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/eval/eval-runner.test.ts --reporter=verbose
```

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/unit/hybrid-retrieval.test.ts tests/unit/rag-chat-router.test.ts tests/unit/intent-digest.test.ts tests/eval/eval-runner.test.ts --reporter=dot
```

## Current Verification Status

- `149 passed`
- `5 todo`
- `0 failed`

## Latest Retrieval Finding

- Live Azure retrieval is now reaching the real `chunks_prod_v1` corpus for `company_id=amerivet`.
- Azure Search BM25 is returning relevant benefits chunks, including Workday enrollment content and QLE-related passages.
- The current live retrieval failure is not "missing data in the index."
- Root cause identified: when vector embeddings fail, the low-coverage expansion path in `lib/rag/hybrid-retrieval.ts` was replacing usable BM25-backed hybrid results with empty vector-only fallback results.
- Fix applied: fallback expansion now preserves prior non-empty hybrid results when vector-only recovery returns zero chunks.
- Environment issue found and corrected: `.env.local` was missing `AZURE_OPENAI_ENDPOINT`.
- Assumption used for repair: endpoint inferred from the Azure resource name as `https://amerivetopenai.openai.azure.com/`.
- Direct embedding verification now succeeds at `3072` dimensions.
- Updated live retrieval baseline after the fix:
  - `totalCases: 10`
  - `stableRate: 1.0`
  - `avgRecallAtK: 0.675`
  - `avgMRR: 0.825`

## Judge / Reporting Progress

- Added `npm run eval:judge` to run the semantic judge gate directly.
- Updated `tests/eval/llm-judge.test.ts` to emit a structured `[LLM-JUDGE-EVAL]` summary with per-case scores and overall average.
- Expanded retrieval dataset beyond the initial 10 cases with more corpus-aligned support/enrollment/STD coverage.
- Azure OpenAI chat deployment configured and verified with live completion calls.
- Judge harness fixes applied:
  - added `getOpenAIConfig` to test Azure config mocks
  - added `log` to the logger mock
  - restored a real `fetch` inside the judge test so the OpenAI SDK can call Azure
- Current live judge baseline:
  - `totalCases: 5`
  - `overallAverage: 4.8`
  - per-case averages: `5, 4, 5, 5, 5`

## Current Live Validation Snapshot

- Deterministic eval snapshot: `116` deterministic cases, `avgAccuracy: 0.9483`, `hallucinationRate: 0`
- Live retrieval eval: `18` cases, `stableRate: 1.0`, `avgRecallAtK: 0.7824`, `avgMRR: 0.8583`
- Live semantic judge eval: `5` cases, `overallAverage: 4.8`
- Combined readiness checkpoint written to `docs/readiness-summary.md`

## Deployment Note

- Build-critical Next metadata images were converted from Git LFS handling to normal Git blobs because Vercel preview builds were failing on `icon`, `openGraph`, and `twitter` image imports.

## Next Recommended Work

### Near-Term

- Centralize high-risk hard facts still duplicated across prompts and helper builders
- Push shared route policy deeper into the `qa` runtime path
- Add live retrieval validation tied to fixed test queries

### After That

- Introduce plan-year-aware structured fact configuration as the canonical deterministic source
- Narrow generation so it formats trusted facts instead of inventing them
- Add semantic judge reporting and live-suite category summaries

## Release-Gate Direction

The build should not be treated as client-test ready until all of the following are true:

- Deterministic suite remains stable at target thresholds
- Semantic judge suite reaches target score
- Retrieval metrics are stable across repeated runs
- Known drift cases remain closed across all answer paths
- Final summary report is reviewed and manually spot-checked
