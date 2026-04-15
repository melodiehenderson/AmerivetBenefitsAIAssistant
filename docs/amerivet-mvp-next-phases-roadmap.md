# AmeriVet MVP Next-Phases Roadmap

Date: 2026-04-14

## Product Positioning

The MVP is for AmeriVet.

That means the immediate goal is not "make the whole product fully multi-tenant now."
The immediate goal is:

- make the AmeriVet assistant trustworthy, counselor-like, and useful enough to replace document hunting for common questions
- make AmeriVet's benefits package easy to swap out for the next open-enrollment cycle without rewriting engine logic

Recommended architecture posture:

- single-employer MVP behavior
- swappable package-data layer
- full multi-employer generalization later

In other words:

- optimize the user experience for AmeriVet now
- avoid baking AmeriVet package facts deeper into the engine than they already are
- introduce package versioning and package resolution before more logic gets hardcoded

## Phase 0: Foundation

Status: complete

This phase established the current baseline:

- hardened QA V2 routing precedence
- reduced stale canonical-state overwrites
- added transcript-family regression protection
- passed deterministic, transcript, retrieval-live, and judge-live validation
- merged the baseline into `main`

Reference:
- `docs/qa-v2-mvp-baseline-merge-summary.md`

## Current Status Snapshot

The work has not progressed in a perfectly linear phase-by-phase order.

Current read:

- Phase 0 is complete and merged
- Phase 1 is complete and merged
- Phase 2 is partially complete: the AmeriVet package resolver/versioning seam exists in key QA/shared-helper paths, but full swap validation and remaining surface alignment still remain
- Phase 3 is partially complete: recommendation and counselor behavior improved materially during Phase 1, and the first employer-guidance rule now exists, but broader recommendation coverage is still ahead
- Phase 4 is partially complete: common plan-detail and practical-answer coverage is much stronger, but full document-replacing breadth is not done
- Phase 5 is partially complete: release-gate validation is already being used actively, but cross-surface parity work is not finished
- Phase 6 has not started in earnest

This is intentional enough to keep: we pulled forward the package seam, counselor improvements, and release-gate validation because they were directly helpful to the AmeriVet MVP rather than waiting for a perfectly sequential roadmap.

## Phase 1: Continuity And Correction

Status: complete

Goal:
- make ordinary conversation flow feel reliable and natural

Why this comes first:
- if a user cannot correct themselves or pivot naturally, the assistant will not feel safe or useful no matter how good the package data is

Scope:
- explicit profile/state corrections overwrite prior state cleanly
- short topic pivots work reliably: `life`, `vision`, `dental`, `disability`, `medical`
- affirmative continuation turns work inside active topics: `yes`, `yes show me vision`, `ok let's do life next`
- follow-up questions preserve topic and intent without unnecessary reset

Acceptance criteria:
- corrected state/profile inputs replace old values and affect subsequent answers
- short pivots stop falling into generic fallback
- follow-up continuity is stable across transcript replay families

Primary validation:
- QA V2 engine tests
- transcript replay tests
- transcript eval dataset

Completed during this phase:
- explicit name, age, state, household, and tier corrections
- short pivots and `next` phrasing continuity
- direct yes/no and follow-through continuity inside active topics
- therapy/specialist practical-question routing improvements
- employer-guidance seam introduction for targeted life-insurance recommendations
- first employer rule:
  - default split of `80% Voluntary Term Life / 20% Whole Life`

Deferred non-blocking sticky spots to revisit later:
- some broader life-decision turns still answer one level too generically before landing on the more specific split or decision framework
- some life follow-ups still lean toward pricing structure when a clearer decision framework would be more useful

These should be treated as targeted counselor-quality follow-up work, not as reasons to reopen broad Phase 1 continuity churn.

## Phase 2: AmeriVet Package Versioning And Swap Layer

Status: partially complete

Goal:
- make AmeriVet's package easy to swap for open enrollment without rewriting the engine

Why this comes second:
- this is the narrow architectural move that gives us long-term leverage without widening the MVP into full multi-tenant product work

Scope:
- introduce a package contract that the engine reads through, instead of importing AmeriVet-only constants directly
- support versioned package fixtures such as:
  - `amerivet-2024-2025`
  - `amerivet-2026-2027`
- move package-varying facts behind a resolver:
  - plan catalog
  - premiums
  - coverage tiers
  - regional availability
  - contributions
  - enrollment dates
  - support/contact metadata where appropriate
- reduce direct engine dependency on `lib/data/amerivet.ts`

Acceptance criteria:
- QA V2 can run against a resolved AmeriVet package version instead of one hardcoded package object
- a second AmeriVet package fixture can be introduced without rewriting routing logic
- swap-sensitive tests prove package data can change while engine behavior stays structurally correct

Primary validation:
- package fixture tests
- transcript replay tests against more than one AmeriVet package version where possible
- cross-surface spot checks for package parity

Already completed in this area:
- introduced an AmeriVet package resolver/versioning seam
- moved key shared pricing and QA helpers behind the active package path
- added swap-style tests to prove the seam is real

Still left:
- extend the seam more completely across remaining user-facing surfaces and supporting helpers
- add stronger open-enrollment swap simulation against more than one AmeriVet package fixture
- reduce remaining direct AmeriVet package reads where they still create replacement pain

## Phase 3: Recommendation And Counselor Quality

Status: partially complete

Goal:
- make the bot act like a practical benefits counselor when the user asks for help deciding

Scope:
- improve `how do I decide?`
- improve `what's best for me?`
- support package-level recommendation behavior
- support challenge/reconsideration flows:
  - `make the case for enhanced`
  - `is vision worth it?`
  - `should I buy more life or disability?`
- keep the one-clarifier rule when a recommendation truly needs one missing fact

Acceptance criteria:
- recommendation questions no longer collapse into generic summaries or support fallback
- answers are opinionated, grounded, and non-pushy
- recommendation behavior works on top of package facts, not one-off phrasing hacks

Primary validation:
- focused deterministic recommendation cases
- transcript replay families for decision flow
- LLM-as-judge cases for factual accuracy, completeness, and non-hallucination

Already completed in this area:
- package-level recommendation behavior is much stronger than the original baseline
- recommendation and reconsideration flows are materially better in medical, HSA/FSA, and life/disability paths
- employer guidance can now shape recommendation output through a dedicated seam

Still left:
- widen recommendation intent detection so more natural wording lands on the right counselor answer earlier
- add more employer-provided human guidance rules cleanly through the same layer
- keep improving decision-framework quality in life, disability, critical illness, dental, and vision worth-it conversations

## Phase 4: Document-Replacing Answer Coverage

Status: partially complete

Goal:
- make the assistant reliably answer the common benefits questions employees would otherwise look up manually

Scope:
- expand structured answer coverage for plan-detail and policy-detail questions
- keep stable package facts deterministic
- use selective retrieval for genuinely document-bound questions
- handle missing details gracefully without developer-sounding phrasing

Representative answer areas:
- carrier identification
- geography / availability
- plan comparisons
- pricing mode / premium framing
- STD / leave pay rules
- HSA / FSA rules
- dental / vision details
- banned entities / out-of-catalog guardrails

Acceptance criteria:
- common benefits-summary questions are answered directly and clearly
- the assistant stops sounding like a field dump for ordinary plan-detail answers
- document-bound answers stay grounded and do not hallucinate unsupported details

Primary validation:
- deterministic eval dataset
- retrieval-live checks
- LLM-as-judge semantic checks for cases that are not fully capturable by string matching

Already completed in this area:
- stronger direct handling for many common plan-detail and practical-question families
- better plan comparison, household-tier, HSA/FSA, and therapy/specialist answer coverage
- deterministic eval coverage is already above the original minimum target

Still left:
- broader policy/document-bound answer coverage
- more complete STD / leave pay and other document-heavy rule coverage
- continue replacing lookup-style responses with grounded, direct answers across more categories

## Phase 5: Cross-Surface Truth And Release Gates

Status: partially complete

Goal:
- ensure every user-facing surface agrees on package truth and that release decisions are driven by repeatable validation

Scope:
- align chat, calculator, compare flows, and other benefits surfaces to the same package source of truth
- remove remaining surface-level AmeriVet/package drift
- formalize release gates for MVP readiness

Acceptance criteria:
- no contradictions across chat and calculator for plan names, availability, pricing logic, or tier behavior
- release decisions are based on the full validation suite, not ad hoc screenshots

Primary validation:
- deterministic suite
- transcript suite
- retrieval-live suite
- LLM judge suite
- targeted cross-surface parity checks

Already completed in this area:
- deterministic, transcript, retrieval-live, and judge-live validation are active working gates
- release decisions are already being made against real validation runs, not screenshots alone

Still left:
- broader parity checks across chat, calculator, compare, and any remaining surfaces
- cleaner cross-surface package-truth enforcement
- a more explicit merge/release checklist tied to those gates

## Phase 6: Multi-Employer Expansion

Status: not started

Goal:
- generalize the package system from "AmeriVet versionable" to "employer-agnostic"

This is explicitly post-MVP.

Scope:
- generalize package resolver inputs beyond AmeriVet
- move employer-varying support metadata and policy configuration into company/package config
- support additional employer fixtures and package-specific eval runs

Acceptance criteria:
- a new employer package can be introduced without rewriting core QA V2 logic
- validation can run per employer/package cleanly

## Validation And Quality Gates

These are the working release criteria and should be treated as source-of-truth for readiness.

### 1. Deterministic Eval Dataset

Requirement:
- maintain a dataset of at least `100` test queries across major categories

Current file:
- `tests/eval/eval-dataset.jsonl`

Current state at time of writing:
- file currently contains `120` rows

Coverage should include:
- carrier identification
- geography
- pricing mode
- STD / leave pay
- HSA / FSA rules
- plan comparisons
- banned entities / out-of-catalog guards
- context-carryover sequences where deterministic checks are appropriate

Each case should continue using the existing:
- `mustContain`
- `mustNotContain`

### 2. Deterministic Acceptance Threshold

Target:
- pass at least `90-95%` of deterministic tests across multiple runs
- use temperature `<= 0.3` where model temperature applies

Expectation:
- once results are consistently at threshold, share summary output by category before asking for manual retest

### 3. Non-Deterministic / Semantic Checks

Use LLM-as-judge for responses not fully capturable with string assertions, especially:
- contextual follow-ups
- counseling quality
- recommendation completeness
- grounded but flexible explanatory answers

Current assets:
- `tests/eval/llm-judge.test.ts`
- `scripts/run-llm-judge-eval.mjs`

Passing threshold:
- average score `>= 4.0 / 5`
- measured across `3` judge calls per case

Judge dimensions:
- factual accuracy
- completeness
- absence of hallucination

### 4. Retrieval Layer Verification

Requirement:
- retrieval metrics must be deterministic and stable across repeated runs

Current assets:
- `scripts/run-retrieval-live-eval.mjs`

Core metrics:
- recall
- MRR
- repeated-run ranking stability

### 5. Reporting Sequence

Expected sequence:

1. run the full suite
2. verify thresholds are met reliably
3. share the summary report, including pass/fail counts by category
4. human manual retest happens after the automated gates are green
5. only then schedule the demo for Brandon's team

## Practical Recommendation

Recommended order from here:

1. Phase 1: Continuity And Correction
2. Phase 2: AmeriVet Package Versioning And Swap Layer
3. Phase 3: Recommendation And Counselor Quality
4. Phase 4: Document-Replacing Answer Coverage
5. Phase 5: Cross-Surface Truth And Release Gates
6. Phase 6: Multi-Employer Expansion

This keeps the MVP sharply focused on AmeriVet while still building the right seam for annual package swaps and future employer support.
