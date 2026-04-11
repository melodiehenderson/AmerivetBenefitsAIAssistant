# Codex Change Summary

## Name Capture / Welcome Flow Hardening
- Files: `lib/session-logic.ts`, `tests/unit/session-logic.test.ts`.
- Relaxed name capture so the assistant accepts very short names and initials like `Q` or `AJ` instead of treating them as a failed onboarding turn.
- Expanded explicit self-identification parsing so phrases like `actually, I'm Melodie` or `my name is Melodie` can overwrite the previously stored name cleanly.
- Added focused regression coverage for:
  - short-name capture
  - single-letter name capture
  - explicit rename / correction after a prior name was already stored
- Intent of this change: reduce the apparent “duplicate welcome” loop that was actually caused by the collector flow not accepting short first-turn name entries.
- Follow-up fix:
  - blocked internal trigger tokens like `__WELCOME__` from ever being treated as user names
  - added a self-heal pass that clears obviously bad reserved names like `WELCOME` if they were already persisted in an older session
  - updated the subdomain chat header to use a cropped mark-only view of the real AmeriVet logo asset so the narrow header slot no longer tries to squeeze the full wordmark

## Structured Plan-Summary Layer
- Files: `lib/data/amerivet-plan-summaries.ts` (new), `lib/qa/plan-detail-lookup.ts` (new), `app/api/qa/route.ts`, `tests/unit/plan-detail-lookup.test.ts` (new).
- Added the first structured medical plan-summary layer so QA can answer plan-detail questions from explicit fields instead of only one-off intercepts.
- The new summary objects are designed around the kinds of questions employees naturally ask from benefit summary pages: network, deductible, out-of-pocket max, primary care, specialist, urgent care, ER, in/out-of-network coinsurance, therapy, maternity, and prescription tiers.
- Added a generic medical plan-detail lookup helper that parses the user’s question for both the target plan and the requested field, then returns a deterministic answer when the field is modeled.
- Wired the QA route to use this lookup before broader continuation/fallback behavior, so prompts like `more info on standard`, `specialist copay on enhanced`, or `generic rx on standard` can resolve through one structured path.
- Current limitation: Rx tiers and some service-level fields are still intentionally marked as “not yet structured” where the repo does not yet contain trustworthy canonical values. This is deliberate groundwork for a full benefits-summary data ingest rather than another round of hardcoded one-offs.

## User-Facing Cleanup / Logo Correction
- Files: `components/amerivet-logo.tsx`, `app/subdomain/chat/page.tsx`, `lib/data/amerivet-plan-summaries.ts`, `lib/qa/plan-detail-lookup.ts`.
- Reverted the shared logo away from the made-up code-rendered approximation and back to the real AmeriVet image mark.
- Reduced the subdomain chat header logo footprint so it no longer clips adjacent text.
- Fixed the subdomain chat welcome flow so the auto-welcome only fires once and cannot duplicate itself during fast first-turn interactions.
- Rewrote internal-sounding fallback phrases like `not yet modeled` / `not yet structured in the plan-summary layer` into user-facing language that simply says the assistant does not want to guess when a detail is missing from the current summary.

## Table Formatting
- Files: `components/markdown.tsx`, `tests/components/markdown.test.tsx`, `vitest.config.ts`.
- Added proper markdown table rendering and a scrollable wrapper for wide benefit tables.
- Improved header/cell styling so comparison tables are readable.
- Fixed unordered list styling regression.
- Added a regression test and reduced noisy test output.

## Grounding / No-Guessing Safety
- Files: `lib/services/hybrid-llm-router.ts`, `lib/services/rag-chat-router.ts`, `lib/rag/response-verifier.ts`, `tests/unit/rag-chat-router.test.ts`.
- Tightened the RAG path so missing retrieval support now triggers a safe fallback instead of an ungrounded answer.
- Updated fallback copy to clarify first, then hand off to the portal / HR path.
- Routed the hybrid LLM path through the app's Azure-backed service path.
- Added regression coverage for the no-chunks case.

## Enrollment Link Fix
- Replaced `login.htmld` with `login.html` anywhere it appeared, including chat/QA/handoff paths.

## Hybrid Routing Consistency Cleanup
- Files: `app/api/chat/route.ts`, `lib/services/simple-chat-router.ts`, `lib/services/cache-router.ts`, `lib/data/amerivet.ts`.
- Added shared Kaiser eligibility source-of-truth via `KAISER_AVAILABLE_STATE_CODES`.
- Updated chat logic to use the shared rule instead of conflicting hard-coded state lists.
- Narrowed the `smart` freeform LLM route so it only runs while required slots are incomplete.
- Removed mutable singleton conversation state from `simple-chat-router` to reduce cross-user leakage risk.
- Updated stale `rag-fallback` comments to match the safer current behavior.

## QA Route Deduplication
- File: `app/api/qa/route.ts`.
- Standardized Kaiser eligibility checks with shared helpers.
- Unified PPO clarification wording into one reusable helper.
- Unified Kaiser-unavailable redirect / compare / pricing fallback wording.
- Centralized medical plan catalog filtering, coverage-tier inference, and pricing row retrieval.
- Reused shared medical fallback / recommendation helpers instead of repeating plan-filter logic in many branches.

## QA Route Modularization
- Files: `lib/qa/medical-helpers.ts` (new), `app/api/qa/route.ts`.
- Extracted shared medical helpers out of the oversized QA route.
- New module now owns Kaiser eligibility, PPO clarification fallback, Kaiser-unavailable fallback, coverage-tier inference, pricing row retrieval, medical fallback generation, and recommendation overview generation.
- QA route now imports those helpers instead of carrying that logic inline.

## Verification
- `npm run typecheck` passed after the helper extraction.

## Recommended Next Steps
1. Continue extracting medical intercept families out of `app/api/qa/route.ts` into dedicated modules.
2. Reduce overlapping intercepts that still answer similar medical questions in different branches.
3. Keep deterministic/simple-answer paths for cost control, but ensure plan-specific answers are grounded or gracefully clarified/handed off.
4. Verify deployment/config still matches the cleaned-up Azure/OpenAI and logging/storage paths.

## Bottom Line
The app already had a thoughtful hybrid architecture. The work so far keeps that cost-saving design, but makes it safer, more consistent, and easier to maintain.

## Additional Modularization Update
- Files: `lib/qa/medical-response-builders.ts` (new), `app/api/qa/route.ts`.
- Extracted the larger medical message builders out of the QA route, including:
  - two-plan comparison responses
  - direct plan-pricing responses
  - medical overview/comparison responses
  - all-benefits estimate responses
  - per-paycheck overview responses
- This leaves more of `app/api/qa/route.ts` focused on deciding *when* to answer, while the new module owns more of *how* those deterministic medical responses are assembled.
- `npm run typecheck` passed after this extraction as well.

## Post-Retrieval Fallback Modularization
- Files: `lib/qa/post-retrieval-fallbacks.ts` (new), `app/api/qa/route.ts`.
- Extracted shared post-retrieval helpers for:
  - gate-failure escalation copy
  - explicit-category help copy
  - zero-chunk fallback copy
  - validation-safe fallback copy
  - single-dental-plan fallback copy
  - recording assistant replies back into session/history
- Replaced a large amount of repeated post-retrieval branch code in the QA route with these shared helpers.
- This makes the gate/validation fallback cluster easier to review and lowers the chance of one fallback branch drifting from the others.
- `npm run typecheck` passed after this extraction as well.

## Category / Deterministic Response Modularization
- Files: `lib/qa/category-response-builders.ts` (new), `app/api/qa/route.ts`.
- Extracted the larger deterministic category overview builders out of the QA route, including:
  - category exploration / benefit overview responses
  - dental overview responses
  - vision overview responses
  - medical overview responses
  - life / supplemental overview responses
  - dental-vs-vision comparison responses
- This reduces the amount of long-form benefits copy embedded directly in the route and makes future copy or rules updates easier to review in one place.
- `npm run typecheck` passed after this extraction as well.

## Fallback Decision Routing Modularization

Files:
- `lib/qa/fallback-decision-router.ts` (new)
- `app/api/qa/route.ts`

What changed:
- Extracted the repeated fallback ordering logic for the QA pipeline into a dedicated routing helper.
- Added `resolvePipelineFirstFallback(...)` to centralize the shared decision order for summary, static FAQ, PPO clarification, recommendation, and medical deterministic fallbacks.
- Added `resolveValidationFallback(...)` to centralize the shared decision order for validation-time deterministic fallbacks such as dental-vs-vision comparison, single-dental fallback, category exploration, and recommendation fallback.
- Updated `app/api/qa/route.ts` to call these helpers instead of repeating the same fallback decision tree in multiple places.

Why:
- This reduces one of the main sources of brittleness in the QA route: multiple branches making nearly the same fallback choice in slightly different ways.
- Centralizing the ordering makes it much safer to adjust fallback precedence later without having to edit several distant blocks in the route file.
- It also makes the QA route easier to audit, because the code now separates “which fallback should win” from “how each fallback message is built.”

## Routing Helper Extraction

Files:
- `lib/qa/routing-helpers.ts` (new)
- `app/api/qa/route.ts`

What changed:
- Moved the QA route's shared routing-decision helpers into a dedicated module.
- Extracted summary detection/assembly, L1 static FAQ matching, benefit-category normalization, category-exploration gating, plan-pricing gating, and medical-comparison gating into `lib/qa/routing-helpers.ts`.
- Updated `app/api/qa/route.ts` to import and use those helpers instead of carrying the same routing rules inline.

Why:
- This takes another large chunk of routing policy out of the already-overloaded QA route and gives the routing rules a single home.
- It makes summary/FAQ/category/pricing decision logic easier to audit and safer to change later, especially when those same concepts appear across pre-RAG intercepts and post-retrieval fallback paths.
- It also shrinks the route's top-level helper section so future cleanup can focus on consolidating route stages rather than untangling embedded helper implementations.

## Memory Model Unification / Retention Update

Files:
- `lib/rag/session-store.ts`
- `lib/qa/post-retrieval-fallbacks.ts`
- `app/api/chat/route.ts`

What changed:
- Increased QA session in-memory fallback retention from 15 minutes to 90 minutes.
- Increased persistent QA session retention from 24 hours to 7 days.
- Expanded QA session transcript retention from the last 6 messages to the last 24 messages.
- Updated the chat route to pass the last 10 user/assistant messages from the stored conversation into the router context so the smart and RAG paths can use recent conversation history instead of an empty history array.

Why:
- This makes one benefits conversation feel much more continuous when a user steps away and comes back later the same day or later in the week.
- It reduces the mismatch between the QA route's richer session memory and the chat route's lighter conversation handling.
- It keeps prompt cost bounded by only injecting the recent window into routing/LLM calls, while still retaining a longer transcript in session state for continuity.

## Topic Continuity Unification

Files:
- `app/api/chat/route.ts`
- `lib/services/rag-chat-router.ts`
- `lib/services/smart-chat-router.ts`
- `lib/services/simple-chat-router.ts`

What changed:
- Added chat-route follow-up detection so short continuation messages can stay anchored to the previously active topic.
- Persisted `currentTopic` and `lastBotMessage` in the chat conversation metadata after assistant responses.
- Passed `currentTopic`, `lastBotMessage`, and recent conversation history through the router context so the smart, simple, and RAG chat paths all receive better continuity signals.
- Added current-topic hints to the smart and RAG router context builders so benefit follow-ups have a clearer conversational anchor.

Why:
- This reduces the split between the richer QA route continuity model and the lighter chat route continuity model.
- It improves follow-up handling for messages that do not restate the full benefit name on every turn.
- It makes the stored conversation history more actionable by feeding both the recent transcript and the active topic back into the response routers.

## Policy / Leave Intercept Modularization

Files:
- `lib/qa/policy-response-builders.ts` (new)
- `app/api/qa/route.ts`

What changed:
- Extracted the QA route's remaining policy-heavy special-response builders into a dedicated module.
- Moved these deterministic response builders out of `app/api/qa/route.ts`:
  - STD pre-existing-condition guidance
  - Allstate-vs-UNUM term-life correction
  - authority/conflicting-docs resolution guidance
  - QLE filing-order guidance
  - live-support handoff copy
  - accident plan naming clarification
  - STD/FMLA leave-pay timeline
  - parental-leave step-by-step guidance
- Updated the QA route to call those shared builders instead of embedding all of that long policy/leave copy inline.

Why:
- This reduces another major concentration of conversational brittleness inside the QA route.
- These policy/leave branches are some of the easiest places for wording drift or one-off edits to create inconsistent behavior over time.
- Moving them into one shared module makes future review safer and keeps the route file focused more on routing decisions than on long-form special-case copy.

Validation:
- `npm run typecheck` passed after this modularization pass.
- Added focused regression coverage in `tests/unit/policy-response-builders.test.ts` for the new shared builders.
- Fixed a stale import in `tests/unit/qa-policy-intercepts.test.ts` so the existing policy-intercept suite points at the current `detectIntentDomain` source.
- Verified the focused policy suite with:
  - `npx vitest run tests/unit/policy-response-builders.test.ts tests/unit/qa-policy-intercepts.test.ts`

## Chat / QA Support-Handoff Drift Reduction

Files:
- `lib/qa/support-response-builders.ts` (new)
- `lib/rag/response-verifier.ts`
- `app/api/chat/route.ts`
- `app/api/qa/route.ts`
- `tests/unit/support-response-builders.test.ts` (new)

What changed:
- Added a shared support-response builder module for:
  - clarify-first portal fallback copy
  - live-support handoff copy
- Updated the RAG verifier's portal fallback builder to use the shared clarify-first helper instead of maintaining its own phrasing.
- Updated the chat route's Rightway-strip fallback to use the shared live-support helper.
- Updated the QA route's last-resort broken-answer support fallback to use the same shared live-support helper.
- Standardized the banned-phone replacement in the chat route so it resolves to `AmeriVet HR/Benefits at <phone>` instead of the vaguer `your HR/Benefits team`.

Why:
- The app had multiple near-duplicate support / handoff messages across QA, chat, and verifier code paths.
- Centralizing these reduces one of the most visible forms of conversational drift: the bot sounding like a different assistant depending on which path answered.
- It also makes future wording changes much safer because one helper now controls the shared handoff language.

Validation:
- `npm run typecheck` passed after the drift-reduction pass.
- Added focused regression coverage in `tests/unit/support-response-builders.test.ts`.
- Verified the focused suite with:
  - `npx vitest run tests/unit/support-response-builders.test.ts tests/unit/policy-response-builders.test.ts tests/unit/qa-policy-intercepts.test.ts`

## Shared Follow-Up / Topic Heuristic Reduction

Files:
- `lib/qa/routing-helpers.ts`
- `app/api/chat/route.ts`
- `app/api/qa/route.ts`
- `tests/unit/routing-helpers-followup.test.ts` (new)

What changed:
- Centralized shared follow-up heuristics in `lib/qa/routing-helpers.ts`:
  - `isSimpleAffirmation(...)`
  - `isLikelyFollowUpMessage(...)`
  - `isTopicContinuationMessage(...)`
  - `deriveConversationTopic(...)`
- Updated the chat route to stop maintaining its own local copies of the follow-up/topic helpers and instead use the shared routing helpers.
- Updated the QA route continuation handler and yes/affirmation branch to use the same shared follow-up helpers.

Why:
- Chat and QA both had their own versions of the same “is this a follow-up?” logic, which is one of the clearest ways the two paths could drift over time.
- Centralizing the low-risk shared heuristics reduces the “two brains” problem without changing the higher-level routing order yet.
- This makes future behavior changes safer because follow-up recognition now has one source of truth.

Validation:
- `npm run typecheck` passed after the shared-heuristic refactor.
- Added focused regression coverage in `tests/unit/routing-helpers-followup.test.ts`.
- Verified the focused suite with:
  - `npx vitest run tests/unit/routing-helpers-followup.test.ts tests/unit/support-response-builders.test.ts tests/unit/policy-response-builders.test.ts tests/unit/qa-policy-intercepts.test.ts`

## Shared FAQ / PPO Deterministic Routing Alignment

Files:
- `lib/qa/routing-helpers.ts`
- `lib/qa/medical-helpers.ts`
- `app/api/chat/route.ts`
- `tests/unit/routing-helpers-deterministic.test.ts` (new)

What changed:
- Fixed the lingering Kaiser FAQ mismatch in the shared routing helpers so the static answer now correctly says Kaiser is available in `CA`, `GA`, `WA`, and `OR`.
- Added shared deterministic helper functions in `lib/qa/routing-helpers.ts` for:
  - standalone medical PPO request detection
  - Kaiser availability-question detection
  - state-aware Kaiser availability FAQ responses
- Added `buildPpoClarificationForState(...)` in `lib/qa/medical-helpers.ts` so both chat and QA can reuse the same PPO clarification wording without needing different helper shapes.
- Updated the chat route to use `checkL1FAQ(...)` for support / Rightway / Kaiser-availability style static answers instead of carrying a separate one-off support response path.
- Updated the chat route to short-circuit standalone medical PPO questions with the same shared PPO clarification used by the QA path.

Why:
- This closes one of the more important remaining drift gaps between `/api/chat` and `/api/qa`: static FAQ-style answers and PPO clarification were still being handled differently.
- It also fixes a real factual inconsistency in the shared FAQ layer that still omitted Georgia from the Kaiser-eligible states even though the rest of the app had already been corrected.
- The result is a more consistent deterministic-routing layer before either path falls through to routed/model behavior.

Validation:
- `npm run typecheck` passed after the deterministic-routing alignment pass.
- Added focused regression coverage in `tests/unit/routing-helpers-deterministic.test.ts`.
- Verified the focused suite with:
  - `npx vitest run tests/unit/routing-helpers-deterministic.test.ts tests/unit/routing-helpers-followup.test.ts tests/unit/support-response-builders.test.ts tests/unit/policy-response-builders.test.ts tests/unit/qa-policy-intercepts.test.ts`
- Current focused regression total for this slice: `100` passing tests across `5` files.

## Chat / QA Routing-Policy Alignment

Files:
- `lib/intent-digest.ts`
- `app/api/chat/route.ts`
- `lib/services/smart-chat-router.ts`
- `tests/unit/intent-digest.test.ts`

What changed:
- Added `determineChatRoutePolicy(...)` to `lib/intent-digest.ts` so the chat route can make routing decisions from the same policy-vs-pricing-vs-general intent model already used in the QA path.
- Updated the chat route to use that shared policy helper instead of deciding RAG vs smart mainly from slot-completeness alone.
- As a result, policy/procedure questions (QLE timing, filing order, eligibility-style questions) now prefer the RAG path even when age/state slots are incomplete, while incomplete non-policy questions can still use the smart collector-style route.
- Expanded the chat route's deterministic FAQ intercept so any shared L1 FAQ answer wins immediately instead of only a narrower support-only subset.
- Corrected the stale Kaiser state list inside the smart-router system prompt so it now includes Georgia and matches the shared catalog/routing rules.

Why:
- The biggest remaining drift between `/api/chat` and `/api/qa` was no longer just wording — it was the higher-level decision tree for when a question should be treated as deterministic/policy-oriented versus routed to smart or RAG behavior.
- The QA route already had a stronger notion of policy-domain handling; this pass moves the chat route closer to that same model.
- This reduces the risk that chat and QA give different behavior for the same procedural benefits question simply because one path had enough demographic slots and the other did not.

Validation:
- `npm run typecheck` passed after the routing-policy alignment pass.
- Extended `tests/unit/intent-digest.test.ts` with focused coverage for the new chat route policy helper.
- Verified the focused suite with:
  - `npx vitest run tests/unit/intent-digest.test.ts tests/unit/routing-helpers-deterministic.test.ts tests/unit/routing-helpers-followup.test.ts tests/unit/support-response-builders.test.ts tests/unit/policy-response-builders.test.ts tests/unit/qa-policy-intercepts.test.ts`
- Current focused regression total for this slice: `105` passing tests across `6` files.

## Chat Reuse of Shared Category / Recommendation Builders

Files:
- `app/api/chat/route.ts`
- `tests/unit/category-response-builders.test.ts` (new)

What changed:
- Added a lightweight metadata-to-session adapter in the chat route so it can reuse the QA-side deterministic builders without duplicating their logic again.
- Wired the chat route to use the shared deterministic category-exploration builder for broad category questions like medical / dental / vision / benefits overview after eligibility collection is complete.
- Wired the chat route to use the shared deterministic recommendation-overview builder for recommendation-style questions before falling through to model generation.
- Persisted `currentTopic` and `lastBotMessage` when those deterministic chat responses fire, so follow-up continuity stays aligned with the QA path.

Why:
- Before this pass, chat still relied more heavily on model generation for category-overview and recommendation flows that QA could already answer deterministically from shared canonical data.
- Reusing the shared builders reduces another layer of route drift and lowers the chance that `/api/chat` and `/api/qa` answer the same category or recommendation question in noticeably different ways.
- It also avoids creating another copy of the same response logic, which was the original brittleness problem in this repo.

Validation:
- `npm run typecheck` passed after the chat/QA shared-builder alignment pass.
- Added focused regression coverage in `tests/unit/category-response-builders.test.ts` for the shared deterministic category and recommendation builders now reused by chat.
- Verified the focused suite with:
  - `npx vitest run tests/unit/category-response-builders.test.ts tests/unit/intent-digest.test.ts tests/unit/routing-helpers-deterministic.test.ts tests/unit/routing-helpers-followup.test.ts tests/unit/support-response-builders.test.ts tests/unit/policy-response-builders.test.ts tests/unit/qa-policy-intercepts.test.ts`
- Current focused regression total for this slice: `108` passing tests across `7` files.

## Scenario Regression Coverage
- Added `tests/unit/conversation-scenarios.test.ts` to cover real user-style multi-turn and edge-case flows, including fake PPO/Rightway traps, Kaiser-by-state behavior, deterministic medical overviews, recommendation prompts, dental-vs-vision comparison, clarify-first handoff copy, leave-pay timeline guidance, and short follow-ups like `yes please` and `what's the difference?`.
- Tightened shared follow-up heuristics in `lib/qa/routing-helpers.ts` so both `isSimpleAffirmation(...)` and `isLikelyFollowUpMessage(...)` treat `yes please` as a continuation signal, not a reset.
- Expanded the same continuation heuristics to cover dataset-style prompts like `Any workaround?` and `What about the waiting period?`, and relaxed the short-follow-up cutoff so natural continuations are less likely to reset topic context.
- Focused regression bundle now protects the recent chat/QA cleanup against realistic conversation drift rather than only helper-level unit checks.

## Scope Guard + Broader Comparison Coverage
- Added `lib/qa/scope-guard.ts` to centralize deterministic refusals for out-of-scope or unsafe requests such as legal-advice asks, credential handling, diagnosis/treatment requests, provider-guarantee asks, unapproved-treatment prompts, and non-benefits creative requests.
- Wired the new scope guard into both `app/api/chat/route.ts` and `app/api/qa/route.ts` immediately after static FAQ handling so these requests are intercepted before deeper benefit logic or model routing runs.
- Added `tests/unit/scope-guard.test.ts` to verify those new deterministic refusals against dataset-style contract phrases.
- Added `tests/unit/medical-response-builders.test.ts` to bind more of the `plan_comparison` dataset to real shared builders, covering standard-vs-enhanced comparisons, pricing-hidden medical overviews, and direct deductible/comparison answers from `buildMedicalPlanFallback(...)`.
- Expanded `tests/unit/conversation-scenarios.test.ts` and the shared continuation heuristics to include additional dataset-style short follow-ups such as `Any workaround?` and `What about the waiting period?`.
- Focused regression bundle now covers `scope_guard` + broader `plan_comparison` + more `context_carryover` behavior with `132` passing tests across `10` files.


## Eval-Backed Regression Expansion

Files:
- `tests/unit/scope-guard.test.ts`
- `tests/unit/medical-response-builders.test.ts`
- `tests/unit/category-response-builders.test.ts`
- `lib/qa/scope-guard.ts`
- `app/api/chat/route.ts`
- `app/api/qa/route.ts`

What changed:
- Expanded banned-entity regression coverage to include experimental / miracle-cure requests against the shared scope guard.
- Expanded deterministic medical-plan regression coverage to include:
  - balanced Standard-vs-Enhanced HSA recommendation language
  - individual deductible-difference comparison coverage
  - dental-versus-vision annual-maximum behavior in the shared comparison table
- Added a focused context-carryover regression that verifies an explicit dental follow-up shifts the conversation topic away from medical instead of sticking on the prior topic.

Why:
- This pushes more of the eval-dataset behavior into real code-backed unit regressions instead of leaving those checks only in synthetic eval expectations.
- It gives better protection for exactly the high-risk user-facing behaviors we care about before live deployment testing is unblocked: banned entities, plan comparisons, and conversational carryover.


## Additional Eval-Backed Coverage Expansion

Files:
- `tests/unit/medical-response-builders.test.ts`
- `tests/unit/category-response-builders.test.ts`

What changed:
- Added a California three-plan medical comparison regression that verifies Standard HSA, Enhanced HSA, and Kaiser Standard HMO all appear together with their distinct out-of-pocket maximums.
- Added a recommendation regression for frequent-care users so the shared recommendation helper continues steering toward Enhanced HSA without slipping into absolute advice.
- Added deterministic category-overview regressions for life insurance and disability so the shared category builders keep the correct carrier lineup and safe summary posture.

Why:
- These additions convert more `plan_comparison` and adjacent deterministic eval behavior into real shared-helper regressions.
- They also strengthen coverage around core benefits-overview responses that users are likely to hit early in a conversation.


## QLE / Leave Carryover Coverage Expansion

Files:
- `tests/unit/policy-response-builders.test.ts`

What changed:
- Added explicit regressions for the shared QLE filing-order builder so marriage-first and birth/adoption follow-up sequencing stay intact.
- Added stronger parental-leave assertions so the shared leave builder keeps the STD duration, FMLA overlap, and job-protection guidance intact.

Why:
- These tests protect some of the highest-value conversation-carryover topics in the app: multi-event enrollment changes and leave-pay coordination.
- They also convert more policy-heavy behavior into deterministic regression coverage before live route testing is available.


## Step 1 Finish-Line Audit

Status:
- Step 1 is now in a reasonable "good enough for this project" state.
- The highest-risk drift and safety areas are covered by deterministic unit/regression tests.
- Remaining work should be treated as either optional polish or true live-route validation, not open-ended cleanup.

Eval dataset categories now meaningfully backed by deterministic code-level coverage:
- `banned_entities`
- `kaiser_geography`
- `rightway_guard`
- `plan_comparison`
- `std_leave_pay`
- `vision_dental`
- `qle_enrollment`
- meaningful portions of `context_carryover`
- meaningful portions of `carrier_attribution`
- meaningful portions of `no_pricing_mode`

Categories that are partially covered in deterministic tests but still benefit most from live route validation later:
- `context_carryover` beyond the shared helper cases already covered
- `carrier_attribution` when the answer depends on route-level intercept precedence
- `coverage_tier`
- `deductible_reset`
- `dhmo_guard`
- `hsa_fsa_irs`
- `grounding_hallucination`
- `source_citation`

Categories that should explicitly be considered live / integrated validation work rather than more step-1 cleanup:
- `llm_as_judge`
- retrieval stability / ranking checks
- end-to-end route precedence under real deployment state
- true multi-turn conversation behavior through the deployed app surface

Recommended boundary:
1. Treat step 1 as complete after this audit.
2. Do not keep adding cleanup work unless a newly discovered issue is clearly high risk.
3. Resume with deployment unblocking and live testing once the Vercel/GitHub setup is fixed.
