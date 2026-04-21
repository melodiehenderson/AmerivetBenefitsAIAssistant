# Handoff — AmeriVet Benefits Assistant, 2026-04-21

**To:** The next Claude thread picking this up
**From:** The thread that ran the Apr 21 regression pass and built Step 6 Layer C
**Status:** **Architecture pivot required.** Do not start coding before the user answers the decision points at the end of this doc.

---

## The product bar (read this first, it governs everything)

> A benefits-eligible employee has a real conversation with a knowledgeable counselor. The counselor answers directly, remembers what the employee said, commits to recommendations, turns on a dime when the employee pivots, and never deflects to a bullet-list menu. **The counselor is also proactive — after each decision, they surface the next decision the employee still needs to make, so nobody walks away from the conversation thinking they're done when they haven't yet chosen dental, life, disability, or HSA/FSA.**

Every phase below serves that definition. If you catch yourself doing something that doesn't, stop.

---

## What just happened (so you don't repeat it)

The previous work (myself, and Codex earlier) tried to make the conversation feel like a counselor by **adding more and more regex detectors** to `lib/qa-v2/engine.ts`. Each Apr 20 / Apr 21 regression we found got patched with another `isXxxQuestion` detector. Each new detector had anti-patterns to prevent it from hijacking other detectors. The engine is now ~5500 lines and the counselor feel is *worse* than it was a week ago, because 40-plus detectors are competing for the same queries.

Two live transcripts from today (Steve, Counselor) and one from an hour ago (LLMwork) all showed the same pattern: natural follow-ups get deflected to a "useful next step is usually one of these:" scaffold menu. Users rage-quit. The user described it as "markedly worse" and asked whether to start over.

**Lesson: regex routing on human conversation is a dead end once the detector count crosses about 20. Every new detector has a non-trivial chance of stealing a query from an existing one.**

The answer is not "more careful detectors." The answer is to **invert the engine architecture**: LLM is the default conversational path, deterministic code is a small allowlist for facts that MUST be exact.

---

## Current state of the repo

- **Branch:** `codex/phase3-counselor-quality`
- **Latest commit on that branch:** `2aedd3e` — diagnostic sentinel for Layer C
- **Test suite:** 1092/1092 passing on `29eef62` (last clean commit before the diagnostic commits)
- **Typecheck:** clean
- **Preview URL (always latest on this branch):** https://amerivet-benefits-ai-assistant-git-co-10d1cb-melodie-s-projects.vercel.app
- **Production:** untouched by this pivot; still running whatever was last promoted

### Recent commits (most recent first)
- `2aedd3e` — **diagnostic**, surfaces `[L2-DIAG]` in chat when Layer C returns null. Remove before any production work.
- `326ed29` — **diagnostic**, adds `[L2]` info logs. Remove with the above.
- `6bb6951` — empty commit to trigger redeploy after setting the env var.
- `29eef62` — Step 6 Layer C: LLM passthrough grounded in package catalog. **This is the last clean commit.**
- `75b057a` — Apr 21 Maggie end-to-end replay + just-commit routing fix
- `18cb65a` — Step 6 Layer A: dependent eligibility from package rule
- Earlier Apr 21 commits: Steps 1–5, 7, 8.

### What's deployed to the preview
- Commit `2aedd3e` (diagnostic build) is live on preview at the URL above.
- Env var `QA_V2_LLM_PASSTHROUGH=1` was set on Preview scope by the user (and possibly Production, unconfirmed).
- Azure OpenAI creds status on preview: **unconfirmed.** Layer C has been returning null on every request in testing, which means either the flag isn't binding, creds aren't set, or the Azure call is failing.

---

## What to do BEFORE touching any code

### 1. Create a safety branch at the current state

The user explicitly asked whether to cut a branch here. **Yes — this is standard practice and strongly recommended** before a major architecture pivot. Phase 1 below deletes ~3000 lines of engine code; if the new direction fails, you want a clean return point.

```bash
git checkout codex/phase3-counselor-quality
git pull
git checkout -b archive/pre-llm-first-pivot-2026-04-21
git push origin archive/pre-llm-first-pivot-2026-04-21
git checkout codex/phase3-counselor-quality   # back to working branch
```

Name it whatever the user prefers, but push to origin so it survives local disk loss.

### 2. Run Phase 0 before anything else

Layer C is **unverified**. It may not be running at all. The whole plan collapses if L2 is dead. Before Phase 1, confirm L2 works end-to-end:

- Visit the preview URL, go through intake (name, age, state).
- Send a query that previously hit the scaffold menu, e.g. "do I just automatically get the $25K basic life, or do I have to do something?"
- Read the response:
  - `[L2-DIAG] Passthrough flag is OFF on this build…` → env var not bound on this build. Check Vercel Settings → Environment Variables → `QA_V2_LLM_PASSTHROUGH=1` on Preview scope, then redeploy.
  - `[L2-DIAG] LLM call threw an error — …<message>` → Azure creds or endpoint wrong. Message tells you which. Likely vars: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, the deployment name — grep `lib/azure/openai` for the exact env var names the client reads.
  - Real counselor-style prose → Layer C works. Proceed to Phase 1.

Once confirmed, **revert the diagnostic commits** (`2aedd3e`, `326ed29`) so `runLlmPassthrough` returns null on failure like the original design. The sentinels are debug-only.

---

## The phased plan

### Phase 0 — Confirm Layer C is structurally viable
**Why:** Everything else depends on this.
**Work:** See "Run Phase 0 before anything else" above.
**Exit:** Preview returns real LLM prose on an L1 miss. Diagnostic commits reverted.
**Effort:** < 1 hour.

### Phase 1 — Invert the engine architecture
**Why:** Root fix. Replace "40 regex detectors → scaffold fallback" with "small deterministic allowlist → LLM default → single escalation line on failure."

**Work:**
1. New engine flow:
   ```
   applyDemographics(session, query)           // keep — mutates session state
   → deterministicIntent(query, session)       // NEW — small allowlist (8–12 intents)
   → if match: return deterministic answer
   → else: runLlmPassthrough(query, session)   // always runs on no-match
   → if L2 returns: return it
   → else: return counselorEscalation()        // one line, never a menu
   ```
2. Deterministic-intent allowlist — these only:
   - Greeting + intake (name, age, state) — existing intake logic
   - "Show me the benefits list" / "what are my options"
   - "Show me medical plans" / plans at a given tier
   - "Show me [dental | vision | life | disability | critical illness | accident | HSA/FSA]" — product overview cards
   - Single plan card by name ("tell me about Kaiser Standard HMO")
   - Pricing by (plan × tier)
   - Combo pricing ("medical + dental at Employee + Family")
   - Mixed-tier pricing ("medical family + vision employee-only")
   - "What's [BCBSTX | PPO | HMO | HSA | FSA]?" → term registry
   - Coverage tier inference + lock from household signals
   - Topic switch ("let's look at dental") → sets `currentTopic`, returns product card
3. **Delete everything else in the routing layer.** Every `isXxxQuestion` detector that exists to catch a conversational shape:
   - `isShortRecommendationAsk`, `isJustCommitRecommendationAsk`
   - `isDependentEligibilityQuestion`
   - `isOnlyOptionQuestion`, `isOnlyOptionQuestionForTopic`
   - The yes/no paraphrase detectors (Step 6)
   - Pivot-break logic, loop-escalation logic (Step 7)
   - `buildContextualFallback`, `buildTopicFallback`
   - All the "A useful next X step is usually one of these:" strings — **all gone**
4. **Keep** the answer-builder functions that produce deterministic cards (plan list, plan detail, premium calc, maternity cost comparison, term registry lookup, package data). These are correct.
5. **Proactive next-decision logic (this is the new product-bar requirement).** After every LLM response *and* every deterministic card, the engine appends (or the LLM is instructed to append) a short next-decision prompt grounded in `session.topicsCovered`. Examples:
   - Covered medical, not dental → "Dental is the next decision — want me to walk through it?"
   - Covered medical + dental + vision, not life → "Now that routine care is set, the biggest decision left is life or disability — which matters more for your household?"
   - All core covered, not HSA/FSA → "Last piece is the HSA/FSA question so your tax account matches your medical pick — ready?"
   This is partly a prompt-engineering job (Phase 4) and partly a session-state job (Phase 3). The deterministic cards get a deterministic next-decision line; the LLM gets explicit instructions in the system prompt to close every answer with a proactive next-step when appropriate.

**Exit:**
- `engine.ts` drops from ~5500 lines to ~800–1200.
- Running the Maggie, Steve, and Counselor transcripts produces a real conversation with no scaffold menus anywhere.
- Every assistant turn that completes a topic ends with a proactive next-decision suggestion (unless we're at the end of the package).

**Effort:** 1–2 days.

### Phase 2 — Deterministic floor: lock the must-be-exact facts
**Why:** The LLM must never hallucinate prices, plan names, carriers, or eligibility rules.

**Work:**
1. Audit `lib/data/amerivet-package`. Spot-check every plan, premium, deductible, OOP max, coinsurance, carrier. Fix anything stale. Freeze as single source of truth.
2. Expand the deterministic allowlist to cover compliance-sensitive asks:
   - Dependent child age cutoff (26)
   - Kaiser state restriction (CA, GA, WA, OR)
   - Spouse / domestic partner eligibility
   - Employer-paid confirmations (Basic Life $25K, employer HSA contribution by tier)
   - Open enrollment window, coverage effective date, new-hire 30-day rule
   - HSA/FSA IRS contribution limits for the current year
3. Tighten the LLM system prompt to forbid inventing numbers. Every dollar amount, plan name, carrier name must come verbatim from the catalog block. If not derivable, say so and escalate.
4. Post-generation guardrails: regex-scan LLM output for dollar amounts, plan names, carrier names; validate each against the catalog. If any mismatch, retry with a stricter prompt or fall back to escalation.

**Exit:** 100% catalog-exact pricing. Kaiser never offered out-of-state. 26-year-old dependent always a "no." Spot-check 50 LLM answers shows zero hallucinated facts.

**Effort:** 1 day.

### Phase 3 — Session memory as first-class model input
**Why:** "Remember, I told you I'm pregnant" must never happen again.

**Work:**
1. Expand the `Session` type:
   - Existing: name, age, state
   - `familyDetails`: hasSpouse, numChildren, childAges, pregnant, pregnancyDueDate
   - `usageSignals`: therapy, chronicRx, upcomingSurgery, ongoing conditions — record every time the user states a care pattern
   - `selectedPlans`: medical / dental / vision / life the user has committed to
   - `coverageTierLock`: resolved from household
   - `currentTopic`: active benefit family
   - `topicsCovered`: which benefits have been explained; drives the proactive next-decision logic from Phase 1
2. Demographic extractor upgrades: catch "I'm pregnant", "my wife is pregnant", "we're expecting", "daughter sees a therapist monthly", "husband has diabetes" → persist as `usageSignals` / `pregnant`. Runs every turn.
3. Render the session-state block into every LLM prompt:
   ```
   EMPLOYEE PROFILE
   Name: Maggie | Age: 29 | State: CA
   Household: spouse + 1 child
   Pregnancy: yes (noted turn 3)
   Usage signals: monthly therapy (daughter)
   Coverage tier: Employee + Family (locked turn 2)
   Selected: Kaiser Standard HMO (committed turn 7)
   Topics covered: medical (deep), dental (overview)
   Topics remaining: vision, life, disability, critical illness, HSA/FSA
   ```
4. Recent conversation window (last 6–10 turns) in the user prompt. Already wired in passthrough code — verify.

**Exit:** Test transcripts never re-ask a known fact. Assistant proactively weaves known facts into answers. Coverage tier never drifts once locked.

**Effort:** 1 day.

### Phase 4 — Language, policy, and tone layer
**Why:** Counselor feel is 30% architecture and 70% language.

**Work:**
1. Language scrub: **"AmeriVet HR" → "benefits counselor"** everywhere. The 888-217-4728 number is a contracted benefits-counselor call center, not AmeriVet HR. Style guide baked into the LLM system prompt: short paragraphs, lead with the answer, never "I'm an AI," never "consult HR" as the main answer, warm and decisive, names the user occasionally.
2. Escalation phrasing (one canonical line, used everywhere we can't answer): *"I want to make sure you get this right — a benefits counselor can walk you through this at 888-217-4728, or you can open enrollment materials in Workday."* No bullet lists.
3. Recommendation commit language: every recommendation includes (a) the pick, (b) one-sentence why tied to the user's specific facts, (c) the one tradeoff worth knowing.
4. **Proactive next-decision closing line.** System prompt instructs the LLM to close every topic-completing answer with a one-sentence suggestion of the next decision to make, informed by `topicsCovered` and `topicsRemaining`.
5. Clarifying-question budget: at most one per recommendation, only if the answer genuinely changes the pick. Default to committing with best-available info and noting the assumption.

**Exit:** Hand-rated 20-conversation sample scores ≥ 4/5 on counselor rubric (direct, warm, accurate, remembers, commits, proactive, no deflection).

**Effort:** 0.5 day (mostly prompt authoring).

### Phase 5 — Safety nets and production readiness
**Work:**
1. LLM call reliability: one retry on transient failure (network / 429 / 500), 20s per-request timeout, circuit breaker (if failure rate > threshold, temporarily route to escalation without attempting LLM).
2. Observability: structured logs per L2 call — `{ requestId, flag, retrievalChunks, latencyMs, tokenUsage, outcome }`. Dashboard: success rate, p50/p95/p99 latency, cost per conversation, escalation rate (target: near zero).
3. Cost controls: max tokens per response (600 is fine), per-session token budget with graceful truncation, daily/monthly spend alert.
4. Rollout plan: stay on preview until Phases 1–4 are complete and hand-test is clean; ramp production via feature flag (5% → monitor 48h → 100%).
5. Kill switch: `QA_V2_LLM_PASSTHROUGH=0` instantly reverts to deterministic-only mode, which remains functional (just less chatty).

**Exit:** L2 success rate > 98% on preview, p95 latency < 5s, zero scaffold emissions, kill switch tested.

**Effort:** 1 day.

### Phase 6 — Regression testing that actually captures counselor feel
**Why:** The current test suite passes 1092/1092 tests and the product still feels broken. The tests don't measure what matters.

**Work:**
1. End-to-end transcript replays as the primary regression gate. Pin Steve, Counselor, Maggie, and LLMwork transcripts as golden paths. New change → replay all → compare structural properties (not exact strings): did the assistant commit? did it scaffold? did it re-ask a known fact? did it hallucinate a plan name? did it suggest the next decision?
2. LLM-as-judge evaluation: stronger model scores each assistant turn 1–5 on the counselor rubric. Track mean score over time. Regressions show up as score drops.
3. Keep unit tests only for the deterministic floor: pricing calc, tier inference, term registry, demographic extractor, package catalog integrity. That's the suite that must never fail.
4. Delete regex-detector tests. When Phase 1 removes the detector, its test goes with it.

**Exit:** CI runs three golden transcripts + deterministic unit tests. A regression feels like a regression, not like a passing test suite hiding a broken product.

**Effort:** 1 day.

---

## Sequencing and estimates

| Phase | Description | Depends on | Effort |
|-------|-------------|------------|--------|
| 0 | Confirm L2 viable + revert diagnostics | — | < 1h |
| 1 | Invert architecture | Phase 0 | 1–2 days |
| 2 | Deterministic floor | Phase 1 | 1 day |
| 3 | Session memory | Phase 1 (can parallel with 2) | 1 day |
| 4 | Language + tone + proactive closing | Phase 1 (can parallel with 2, 3) | 0.5 day |
| 5 | Production readiness | Phases 1–4 | 1 day |
| 6 | Regression testing | Parallel from Phase 1 onward | 1 day |

**Total:** roughly 5–7 focused working days from Phase 0 to production rollout.

---

## Decision points the user needs to answer before Phase 1 starts

The previous thread listed these and the user explicitly wants to address them in the next thread. **Do not start coding until the user answers all four:**

1. **Architecture direction.** Do you agree with the LLM-first architecture — small deterministic allowlist, LLM default path, one-line escalation instead of the scaffold menu?
2. **Deletion scope.** Are you OK with deleting ~3000 lines of engine code and the associated tests in Phase 1? The tests that go with removed detectors will go too.
3. **Additional deterministic intents.** Is there anything beyond the allowlist (greeting/intake, benefits list, plan list at tier, product cards, pricing by tier, combo pricing, mixed-tier pricing, term registry, tier inference, topic switch) that MUST be rule-based for compliance, legal, or brand reasons? Flag now so Phase 1 gets it right the first time.
4. **Budget.** What's the ceiling for Azure OpenAI spend per session, per day, per month? Drives the caps in Phase 5.

---

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| LLM gives wrong numbers | Phase 2 post-generation catalog scan; retry or escalate on mismatch. |
| LLM cost explodes | Phase 5 budgets. Most traffic hits the deterministic allowlist anyway. |
| LLM latency too high | Phase 5 timeouts. Optionally streaming. 600 max-tokens stays modest. |
| Some conversational shape needs to be deterministic for compliance | Surface in Phase 2 audit, add to allowlist. |
| Rollback | Kill switch (Phase 5). Deterministic mode remains functional — limited but never wrong. |

---

## What this plan explicitly is NOT doing

- **No new regex detectors.** None. If you are tempted to add one, stop and ask whether the LLM could handle it instead.
- **No attempt to make the rule-based engine smarter at conversation.** That's the hill we were climbing and it's the wrong hill.
- **No rewrite of the data catalog** — it's correct.
- **No changes to intake flow** — it works.
- **No full rewrite from scratch** — throws away valid work.

---

## Key files and where to look

- `lib/qa-v2/engine.ts` — the huge file. Phase 1 shrinks this 70–80%.
- `lib/qa-v2/llm-passthrough.ts` — Layer C. This moves from fallback to default path in Phase 1. Diagnostic sentinels at the top of `runLlmPassthrough` come out in Phase 0.
- `lib/data/amerivet-package.ts` — the source-of-truth catalog. Audit in Phase 2.
- `lib/azure/openai.ts` — Azure OpenAI client. Check env var names here during Phase 0.
- `lib/rag/session-store.ts` — `Session` type. Expand in Phase 3.
- `lib/rag/hybrid-retrieval.ts` — retrieval augmentation. Passthrough already uses it best-effort.
- `tests/unit/qa-v2-transcript-replays.test.ts` — the replay suite. This is the pattern to expand in Phase 6.
- `tests/unit/qa-v2-llm-passthrough.test.ts` — Layer C wiring tests. Update when Phase 1 moves L2 to the default path.
- `docs/claude-code-handoff-2026-04-20.md` — the previous handoff. Useful context.

---

## Environment variables to know

- `QA_V2_LLM_PASSTHROUGH=1` — turns on Layer C. Set on Preview (confirmed by user); Production status unconfirmed.
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, Azure deployment name — needed for L2 to actually call. Exact names in `lib/azure/openai`. Status on preview: **unconfirmed.**
- No other flags needed for this plan.

---

## Useful commands

```bash
# Tests
npm test                            # full suite
npm test -- qa-v2-transcript        # replay suite only
npm run typecheck                   # ts check

# Git
git log --oneline -20               # recent history
git log --oneline lib/qa-v2/engine.ts   # engine evolution

# Dev
npm run dev                         # local dev server
```

---

## TL;DR for the next thread

1. Read the product bar (top of this doc).
2. Create the safety branch.
3. Ask the user to answer the four decision points.
4. Run Phase 0 to confirm Layer C works. Revert the diagnostic commits.
5. Execute Phases 1 → 6 in order, with 2, 3, 4 parallelizable after 1.
6. Do not add a new regex detector. If you think you need one, re-read this doc.

Good luck.
