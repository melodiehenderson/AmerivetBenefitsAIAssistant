# Claude Code Handoff: AmeriVet Benefits Assistant

## What This App Is

This is an **AmeriVet-specific benefits assistant**.

It is **not** a general chatbot.

The MVP goal is an assistant that:

- answers normal benefits questions in normal language
- stays grounded in real AmeriVet plan/package details
- preserves context across follow-ups
- lets the user correct themselves naturally
- gives recommendations when asked
- feels like a helpful benefits counselor, not a document parser or menu system

The main product bar is:

- **trustworthy**
- **stable**
- **debuggable**
- **easy to update for AmeriVet open enrollment**

## Source-of-Truth Docs

Read these first:

1. `/Users/melodie/Documents/Amerivet Bot/AmerivetBenefitsAIAssistant/docs/mvp-functional-priorities.md`
2. `/Users/melodie/Documents/Amerivet Bot/AmerivetBenefitsAIAssistant/docs/next-thread-functional-handoff.md`
3. `/Users/melodie/Documents/Amerivet Bot/AmerivetBenefitsAIAssistant/docs/next-thread-executive-summary.md`
4. `/Users/melodie/Documents/Amerivet Bot/AmerivetBenefitsAIAssistant/docs/codex-dev-summary.md`
5. `/Users/melodie/Documents/Amerivet Bot/AmerivetBenefitsAIAssistant/docs/amerivet-mvp-next-phases-roadmap.md`

## Current Branch / State

- Current working branch: `codex/phase3-counselor-quality`
- There are local uncommitted Playwright/manual-review artifacts in the worktree. Treat them as review scaffolding unless you intentionally want to use them:
  - `playwright.manual.config.ts`
  - `tests/e2e/manual-phase3-review.spec.ts`
  - `test-results/...`

## Current Phase Plan

### Phase 0: Foundation

Status: **done and merged**

Delivered:

- routing/state hardening
- transcript-family regression coverage
- live validation baseline

### Phase 1: Continuity and correction

Status: **done and merged**

Delivered:

- explicit corrections
- better topic pivots
- stale-state cleanup
- yes/no followthrough improvements
- first employer-guidance seam

### Phase 2: AmeriVet package versioning / swap layer

Status: **partially done**

Delivered:

- real package resolver / versioning seam
- key shared helpers behind package-backed reads
- swap-style tests

Still left:

- broader surface alignment
- additional cleanup for open-enrollment swapability

### Phase 3: Recommendation and counselor quality

Status: **in progress, but currently paused for regression recovery**

Delivered:

- stronger medical/life/HSA-FSA recommendation behavior
- first employer rule:
  - `80% Voluntary Term Life / 20% Whole Life`
- broader recommendation-family coverage

Current rule:

- **Do not continue broad Phase 3 expansion until the current regressions are fixed.**

### Phase 4: Document-replacing answer coverage

Status: **partially underway**

Delivered:

- stronger common plan-detail answer coverage
- deterministic eval dataset far beyond original minimum

Still left:

- more direct answers for document-heavy rule/policy areas

### Phase 5: Cross-surface truth and release gates

Status: **partially underway**

Delivered:

- deterministic evals
- transcript replay coverage
- transcript eval coverage
- retrieval-live and judge-live checks

### Phase 6: Multi-employer expansion

Status: **not started in earnest**

Not an MVP priority yet.

## Important Strategic Direction

We intentionally did **not** stop and rebuild this around a simpler employer.

Instead, the current strategy is:

- keep AmeriVet as the main MVP target
- validate cleaner scenario families first
- gradually layer complexity back in
- build a package/guidance seam so future employer/package swaps are easier

Also important:

- do **not** chase diminishing-returns micro-phrasing
- do **not** keep expanding recommendation logic if core trust behaviors regress
- prioritize fresh direct intent, stable state, and clean scenario replacement over new “smarts”

## Current Regression Problem

The app is **cleaner than before**, but the latest screenshot-based review shows the regression is **not fixed yet**.

The main issue is:

> fresh direct asks and fresh scenario overrides still do not reliably beat stale subtopic continuation and stale state

This creates several visible failures.

## Latest Screenshot-Anchored Transcript (Apr 20, 2026)

This reconstruction is from the latest screenshot batch only.

1. User starts onboarding:
   - `Mark`
   - `42, CO`
2. Assistant shows benefits overview.
3. User: `medical`
4. Assistant shows medical plan options for `Employee Only`.
5. User: `what is a coverage tier?`
6. Assistant explains tiers and says likely tier is `Employee Only`.
7. User: `oh! okay, i have a wife and 1 kid.`
8. Assistant updates household to `Employee + Family`.
9. User: `compare the plans please`
10. Assistant gives plan tradeoff comparison.
11. User: `what does bcbstx stand for?`
12. Assistant correctly answers: `Blue Cross Blue Shield of Texas.`
13. User: `is kaiser available to me?`
14. Assistant incorrectly says Kaiser is unavailable in `ME`.
15. User: `i'm not in ME. i'm in CO`
16. Assistant incorrectly says it updated the state to `ME`.
17. User: `so i want to spend as little out of pocket as possible, and i am pregnant. my daughter sees a therapist 1x per month, and i have 3 regular prescriptions. which plan would you recommend?`
18. Assistant recommends `Enhanced HSA`, but the reasoning appears only partially integrated.
19. User: `what about maternity considerations?`
20. Assistant falls back to a generic medical-next-step menu.
21. User: `i'm pregnant - how much should i expect to spend on medical bills this year, and which plan is better for lower costs?`
22. Assistant asks a generic clarifier instead of using the already-known pregnancy scenario cleanly.
23. User: `so which one do you actually recommend for me?`
24. Assistant again falls back to a generic medical-next-step menu.
25. User: `ok. and how about for next year? next year i won't be pregnant, but my daughter will still see her therapist, and i'll still need my 3 prescriptions.`
26. Assistant gives a recommendation, but surrounding scenario handling still looks unstable.
27. User: `what are my other benefit options?`
28. Assistant gives a clean other-benefits list.
29. User: `actually, yeah - can you compare those costs for standard vs. enhanced?`
30. Assistant shows projected healthcare costs for `Employee + Family` in `Maine`.
31. User: `i keep telling you i'm in Colorado`
32. Assistant updates state to `CO`.
33. User: `let's look at dental`
34. Assistant pivots into dental cleanly.

## Regression Families Still Visible

### 1. State / geography drift

This is still the worst bug.

Visible symptoms:

- user is in `CO`
- assistant reasons as if user is in `ME`
- correction to `CO` is miswritten as `ME`
- later pricing/comparison still uses `Maine`

Interpretation:

- canonical state writes are still unsafe
- explicit correction handling is not beating stale/inferred geography

### 2. Household / coverage-tier drift

Visible symptoms:

- user says `wife and 1 kid`
- assistant correctly updates to `Employee + Family`
- later recommendation logic appears to drift away from that stable household scenario

Interpretation:

- household/tier state still is not held consistently enough across recommendation paths

### 3. Fresh direct recommendation asks still lose to generic continuation

Visible symptoms:

- `what about maternity considerations?`
- `so which one do you actually recommend for me?`

Both should have produced direct answers.
Instead, they fell into a generic medical-next-step menu.

Interpretation:

- the stale continuation/menu path is still outranking direct asks in some contexts

### 4. Multi-factor recommendation is still too weak

Visible symptoms:

The user gave a rich medical decision scenario:

- wants low out-of-pocket exposure
- currently pregnant
- daughter sees therapist monthly
- three regular prescriptions

The assistant should synthesize all of those and produce a stable recommendation.
Instead it appears to weight only part of the scenario cleanly.

Interpretation:

- integrated recommendation logic still is not robust enough for realistic family scenarios

### 5. Scenario override is still only partially working

Visible symptoms:

- `next year i won't be pregnant...`

This should replace the current maternity-heavy scenario.

Interpretation:

- the app is still too eager to continue the current scenario instead of replacing it when the user clearly changes assumptions

## What Looks Better In The Latest Run

Do not lose this signal:

- benefits overview rendering is cleaner
- `BCBSTX` definition worked
- dental pivot worked
- some comparison formatting is better
- household correction triggered at least once in the right direction

So this is **not** a total collapse.
It is a narrower but still serious regression set.

## Recommended Next Plan

### Immediate Rule

Do **not** keep doing broad Phase 3 expansion.

The next pass should be a **tight regression-recovery pass**.

### Recovery Plan

1. Reconstruct the latest screenshot transcript first before coding.
   - Stay anchored to this test only.
   - Do not mix in earlier manual tests from memory.

2. Add tests for the exact visible regression families first.
   Minimum new coverage:
   - state correction from stale wrong geography
   - household correction after coverage-tier explanation
   - direct recommendation ask from inside active medical scenario
   - scenario replacement:
     - `next year i won't be pregnant`
   - medical comparison/pricing path should not switch to `Maine` after user says `CO`

3. Re-audit the routing/intake contract with this ordering:
   - explicit correction / scenario override
   - fresh direct answer request
   - explicit topic pivot
   - continuation
   - fallback

4. Re-audit the canonical write paths for:
   - `userState`
   - `familyDetails`
   - `coverageTierLock`
   - `selectedPlan`
   - any geography-specific availability cache or derived state

5. Fix in this order:
   - state/geography correction bug
   - household/tier drift
   - direct recommendation/menu fallback precedence
   - multi-factor recommendation synthesis

6. Validate before any new feature work:
   - focused unit tests
   - transcript replay coverage
   - transcript eval coverage
   - deterministic/live validation
   - then a short human retest

## Practical Success Criteria

Do not call the regression pass complete until all of these are true:

- if the user says `CO`, the assistant does not answer as if they are in `ME`
- correcting state overwrites the prior geography immediately
- `wife and 1 kid` holds as the active household/tier context
- `which plan would you recommend?` gets a direct recommendation, not a generic menu
- `next year i won't be pregnant` replaces the maternity-heavy scenario
- pricing/comparison responses stay grounded in the corrected state and household

## Important Working Rules For Claude

1. Optimize for **correctness over preserving recent changes**.
2. Do **not** patch screenshot phrases one by one.
3. Fix decision order and state handling at the family level.
4. Use transcript replay tests and focused engine tests before asking for another manual retest.
5. When reviewing screenshots or manual tests, reconstruct the transcript first, then analyze it.
6. Avoid mixing current findings with older transcript memory.

## Recommended Next Ask To Claude Code

Suggested instruction:

> Read the handoff docs first, then use this handoff as the current working brief. Treat the current problem as a regression-recovery pass, not a new Phase 3 feature push. Start by writing tests for the visible Apr 20 screenshot regression families, then fix state/geography correction, household/tier drift, and fresh direct recommendation precedence in that order. Do not resume broad recommendation expansion until those regressions are clean.
