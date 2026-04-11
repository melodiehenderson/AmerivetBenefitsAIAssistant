# Next Thread Executive Summary

## What This Product Is

This is an AmeriVet-specific benefits assistant.

It is not a general chatbot.
It should feel like a helpful benefits counselor:

- informative, not pushy
- proactive about what the user should consider next
- willing to give an opinion when the user asks for one
- grounded in real AmeriVet plan details

## The Current Standard

The bar for the MVP is not "mostly works."

The bar is:

- a user can ask normal questions in normal language
- the assistant answers accurately and helpfully
- the assistant preserves context across follow-ups
- the assistant lets the user correct themselves naturally
- the assistant guides the user through the benefits package
- the interaction does not feel frustrating or brittle

## Architecture Direction

The agreed post-MVP direction is:

- canonical benefits engine + selective RAG

That means:

- deterministic/structured truth should own stable benefits facts
- retrieval should support document-bound questions
- generation should present and explain grounded facts
- semantic intent normalization is still the right long-term direction, but not the immediate blocker

## MVP Priority Bands

### Red: Must Fix

1. conversation continuity and follow-up reliability
2. plan-detail answer coverage from benefits-summary content
3. onboarding/profile correction handling
4. cross-surface truth consistency
5. graceful, specific fallbacks

### Yellow: Important Before Client Presentation

1. branding/logo polish or removal of broken branding
2. counselor-like response quality
3. proactive package guidance
4. recommendation quality when the user asks

### Green: Can Wait

1. full semantic intent-normalization rollout
2. full canonical benefits engine rollout
3. broader UI polish

## Biggest Problems Still Seen In Testing

### 1. Users cannot reliably correct prior inputs

Example:

- user enters the wrong state
- user says `actually im in GA`
- assistant does not cleanly update the stored state and continue with the corrected geography

This must be fixed.

### 2. Recommendation behavior is still weak

Example:

- user asks `how do i decide which one?`
- or `what's best for me?`
- assistant gives a generic summary or falls back instead of counseling

This must be fixed.

### 3. Topic pivots are still too brittle

Examples:

- `life`
- `vision`
- `yes - show me what i can get for vision`

These should route naturally without requiring overly specific phrasing.

### 4. Package guidance is better, but still too generic

Prompts like:

- `what else should i consider?`
- `what should i look at next?`

should feel like contextual guidance, not just a package list.

### 5. Some responses still sound like field dumps

Plan-detail answers are improving, but still often read more like raw summary extraction than counselor-style guidance.

## Recommended Next Work Order

### Phase 1

Fix profile/input correction and continuity:

- allow state correction
- update session state when corrected
- support short topic pivots and affirmative continuation phrasing

### Phase 2

Fix recommendation behavior:

- clear tradeoff explanation for `how do i decide?`
- recommendation when asked
- at most one focused clarifier if truly needed

### Phase 3

Improve package guidance:

- make next-step guidance topic-aware
- reference what was just discussed
- reduce generic list-style package answers

### Phase 4

Improve plan-detail usability:

- keep expanding benefits-summary answer coverage
- make answers more counselor-like
- keep missing-data responses graceful and specific

## What Not To Spend Time On First

- do not resume deep logo debugging unless explicitly requested
- do not start a major architecture rewrite before the red conversational issues are better
- do not chase one-off phrasings if a broader family can be fixed together

## Key Docs To Read First

1. `docs/mvp-functional-priorities.md`
2. `docs/next-thread-functional-handoff.md`
3. `docs/codex-dev-summary.md`

## Starter Prompt For The Next Thread

Use the docs above as source of truth.

The immediate goal is to improve MVP functionality, not branding. Focus on the red-tier issues first: state correction, follow-up continuity, recommendation behavior, topic pivots, and package-guidance quality. Do not start with logo work unless I explicitly ask. Please read the handoff docs, summarize the current priorities back to me, then begin with the highest-leverage fix.
