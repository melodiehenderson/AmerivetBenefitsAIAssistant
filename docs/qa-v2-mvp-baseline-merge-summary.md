# QA V2 MVP Baseline Merge Summary

Date: 2026-04-14
Current `main` anchor at time of note: `4874ead`
Primary feature branch merged: `codex/qa-v2-subdomain-rebuild`
Primary hardening commit on branch: `4cd36cb`
Follow-up build fix on branch: `ff7ee67`

## Outcome

The QA V2 routing/state hardening work was merged into `main` and should be treated as the current MVP baseline for the AmeriVet-specific benefits assistant.

This pass was intentionally focused on engine trustworthiness, stability, and debuggability. It was not a branding pass, copy-polish pass, or one-off screenshot patch pass.

## Foundation Decision

We explicitly compared the older safer baseline `2188dfc` against the later routing-contract pass `c7ccaed`.

Decision:
- Keep the later `c7ccaed` lineage as the working foundation.
- Do not roll back to `2188dfc`.

Why:
- `2188dfc` only appeared better on a narrower household/tier regression.
- `2188dfc` still underperformed on higher-value MVP behavior that the later line handled better.
- The right move was to preserve the later routing gains, then harden canonical state writes and undo the specific regressions on top of that line.

## What Changed

Core work centered in:
- `lib/qa-v2/engine.ts`
- `lib/qa/medical-helpers.ts`
- `tests/unit/qa-v2-engine.test.ts`
- `tests/unit/qa-v2-transcript-replays.test.ts`
- `tests/eval/qa-v2-transcript-dataset.ts`

### Canonical state hardening

Changed behavior included:
- stale `selectedPlan` memory no longer survives fresh reconsideration, switch, or challenge turns
- explicit `familyDetails` corrections now overwrite sticky spouse/child memory instead of only accumulating
- `coverageTierLock` refresh is gated to relevant medical/tier/pricing/household turns instead of being eagerly rewritten
- stale pending guidance fields are cleared more aggressively when fresh direct intent appears
- direct practical and policy asks now beat stale-topic continuation more reliably

Fields audited during this pass:
- `userState`
- `selectedPlan`
- `familyDetails`
- `lifeEvents`
- `coverageTierLock`
- `currentTopic`
- `pendingGuidancePrompt`
- `pendingGuidanceTopic`
- `pendingTopicSuggestion`

### Routing precedence implemented

The effective routing contract implemented in QA V2 is:

1. policy / support / Workday / HR
2. package-level recommendation
3. direct practical question
4. direct policy / QLE question
5. explicit topic pivot
6. stale-topic continuation
7. fallback

### Failure families specifically hardened

- medical compare vs stale HSA/FSA context
- pregnancy/maternity vs QLE timing
- selected-plan challenge vs stale plan lean
- household/tier changes vs stale pricing tier
- vision worth-it vs dental-vs-vision comparison trap
- life/disability/critical illness narrowing
- direct yes/no confirmations inside topics

## Tests And Validation

Regression protection was added at three levels:
- focused QA V2 engine tests
- transcript replay coverage
- eval transcript dataset coverage

Validated during the hardening pass:
- `npm run eval:qa-v2-transcripts`
- `npm run eval:validation`
- `npm run eval:validation-live`

Key results observed during the pass:
- transcript suite: `207/207` passed
- transcript eval: `252/252` turns passed across `82` cases
- retrieval-live: passed with `avgRecallAt5 = 1` and `avgMRR = 1`
- llm-judge-live: passed with `overallAverage = 4.8` against threshold `4`
- deterministic validation maintained `0` hallucination rate and `100` grounding proxy score

## Post-Merge Note

After opening the PR, Vercel surfaced a real TypeScript build failure in `lib/qa-v2/engine.ts` related to cost projection params under strict optional typing.

That was fixed in follow-up commit `ff7ee67` by:
- only including optional `state` and `age` params when present
- guaranteeing a concrete `coverageTier` fallback in the medical cost-model path

That fix was verified with:
- `npx tsc --noEmit`
- QA V2 engine + replay + transcript eval tests

The PR was then successfully deployed and merged.

## How To Work From Here

Treat merged `main` as the new MVP baseline.

Recommended working rule:
- only open new engine fixes from fresh transcript failures, live regressions, or real user-observed issues
- do not restart broad routing churn without new evidence
- do not solve future misses with copy-only tweaks when the issue is really routing or stale state

If another developer picks this up next, the safest continuation is:
- reproduce any new failure on current `main`
- classify whether it is a true regression, an old missed bug, or retrieval/env noise
- fix the state model or routing contract at the family level
- add transcript replay and focused engine coverage before requesting manual retest
