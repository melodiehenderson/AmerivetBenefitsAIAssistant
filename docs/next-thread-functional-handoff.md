# Next Thread Functional Handoff

## Purpose

This document is a handoff for the next Codex thread.

Do not start with logo/branding work unless explicitly requested.
The immediate goal is to make the AmeriVet Benefits Assistant feel trustworthy, guided, and not frustrating in real conversations.

## Current Product Standard

The desired MVP behavior is:

- the assistant should answer normal benefits questions in normal language
- the assistant should preserve context across follow-ups
- the assistant should let the user correct prior inputs naturally
- the assistant should guide the user through the package without sounding pushy
- the assistant should give an opinion when asked
- the assistant should avoid generic HR/Workday fallback for questions it should handle

## Priority Bands

### Red: Must Fix

1. Conversation continuity and follow-up reliability
2. Plan-detail answer coverage from benefits-summary content
3. Input correction handling for onboarding/profile state
4. Cross-surface truth consistency
5. Helpful, specific fallbacks

### Yellow: Important Before Client Presentation

1. Branding/logo polish or removal of broken branding
2. Counselor-like tone and proactive next-step guidance
3. Recommendation quality when the user asks for an opinion

### Green: Can Wait

1. Full semantic intent-normalization rollout
2. Full canonical benefits engine rollout
3. Broader UI polish

## Specific Problems Seen In Latest Screenshot Batch

### 1. State correction is not handled

Observed pattern:

- user enters `72, LA`
- assistant anchors on Louisiana
- user says `actually im in GA`
- assistant does not cleanly update the stored state and continue from the corrected geography

Expected behavior:

- explicit corrections like `actually I'm in GA`, `I meant Georgia`, `sorry, Colorado not Kansas` should overwrite the stored state
- if that correction changes plan availability, pricing, or recommendations, the assistant should acknowledge the correction and continue with the updated facts

Why this matters:

- this is basic conversational trust
- users naturally correct themselves
- failure here makes the assistant feel brittle and unsafe

### 2. Recommendation flow is weak

Observed pattern:

- user asks `how do i decide which one?`
- assistant gives a generic summary
- user asks `what's best for me?`
- assistant falls back to generic contact-HR behavior instead of counseling

Expected behavior:

- when asked `how do i decide which one?`, the assistant should explain the tradeoff in plain English
- when asked `what's best for me?`, it should either:
  - give a recommendation based on known context, or
  - ask one focused clarifying question if one missing factor materially changes the answer

Why this matters:

- this is a central MVP promise
- the assistant should not be pushy, but it should have an opinion when asked

### 3. Guided transitions are still brittle

Observed pattern:

- after a dental answer, `yes - show me what i can get for vision` falls into a disappointing fallback
- `life` alone falls into fallback before a broader phrase like `show me life and disability options please` succeeds

Expected behavior:

- simple topic pivots like `life`, `vision`, `dental`, `disability`, `critical illness` should reliably route into the correct benefits area
- affirmative continuation phrases like `yes show me vision`, `ok let's do disability`, `show me life next` should preserve the implied topic

Why this matters:

- users do not naturally restate the full topic in polished phrasing every turn

### 4. Package guidance is improving but still too generic

Observed pattern:

- `what else should i consider?` and similar prompts now route better
- but the guidance often returns a generic package list instead of feeling like a counselor helping the user decide what comes next

Expected behavior:

- after medical, point to dental/vision or a recommendation decision
- after dental/vision, point to life/disability or supplemental options
- after supplemental topics, point to HSA/FSA or close-out recap
- guidance should reference what was just discussed, not only dump a static package list

### 5. Responses still read like field dumps

Observed pattern:

- plan detail answers often present as long lists
- they are factually better than before, but not yet user-friendly enough

Expected behavior:

- answer the question directly first
- explain the practical meaning second
- offer the next useful drill-down or comparison third

Example desired shape:

- `On the Enhanced HSA, specialist visits are a $40 copay. If you're expecting to use specialists regularly, that's one reason people sometimes prefer Enhanced over Standard. If you want, I can compare the two plans for likely specialist use.`

## Recommended Next Work Order

### Phase 1: Input correction and continuity

Implement first:

1. explicit state correction handling
2. broader short topic-pivot handling (`life`, `vision`, `dental`, `disability`, `medical`)
3. affirmative continuation handling (`yes show me vision`, `ok let's do life next`)

Acceptance criteria:

- corrected state updates session state
- subsequent answers use corrected state
- short benefit-topic pivots stop falling into fallback

### Phase 2: Recommendation behavior

Implement next:

1. recommendation gate for medical plan choice
2. one-clarifier rule when a recommendation truly needs more context
3. deterministic recommendation scaffolding for common known cases

Acceptance criteria:

- `what's best for me?` no longer falls into generic fallback
- `how do i decide which one?` produces a decision-oriented answer

### Phase 3: Package-guidance quality

Implement next:

1. topic-aware next-step prompts
2. guidance driven by current topic and completed topics
3. fewer generic package-list answers

Acceptance criteria:

- `what else should i consider?` feels like guidance, not a static list
- `what should i look at next?` references the current conversation context

### Phase 4: Plan-detail answer usability

Implement next:

1. improve response framing for plan-detail answers
2. continue expanding structured benefits-summary coverage
3. make missing-detail answers graceful and specific

Acceptance criteria:

- answers feel counselor-like, not like a raw summary dump
- missing details are handled without internal/developer-sounding phrasing

## What Not To Do First

- do not resume deep logo/branding debugging unless explicitly requested
- do not start a large architecture rewrite before fixing these conversational MVP issues
- do not solve isolated phrasings one by one if a broader intent family can be handled together

## Good Test Prompts For The Next Thread

### Input correction

- `72, LA`
- `actually im in GA`
- `medical please`

### Recommendation

- `medical please`
- `how do i decide which one?`
- `what's best for me?`

### Topic pivots

- `life`
- `show me life and disability options please`
- `vision`
- `yes - show me what i can get for vision`

### Package guidance

- `what else should i consider?`
- `what should i look at next?`
- `anything else i should know?`

## Bottom Line For The Next Thread

The next thread should optimize for one thing above all else:

make the assistant feel like a stable, helpful benefits counselor in normal conversation.

That means fixing state correction, follow-up continuity, recommendation behavior, and guidance quality before spending more time on presentation polish.
