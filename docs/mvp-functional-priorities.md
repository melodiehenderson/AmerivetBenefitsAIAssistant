# MVP Functional Priorities

## Goal

This document defines what matters most for making the AmeriVet Benefits Assistant an MVP we can be proud to show a client.

The standard is not "mostly works."
The standard is:

- employees can ask normal questions in normal language
- the assistant answers accurately and helpfully
- the assistant keeps the conversation moving without frustration
- the product feels trustworthy, guided, and AmeriVet-specific

## Red: Must Fix Before Pride

These are the functional issues that matter most.
If these are weak, the product will not feel MVP-ready even if the architecture is sound.

### 1. Follow-Up Reliability

The assistant must preserve topic and intent across ordinary follow-up questions.

Examples:

- "what about family coverage?"
- "does that change if I have 4 kids?"
- "what else?"
- "what else should I consider?"
- "what about critical illness then?"

Success means:

- no generic reset after normal follow-ups
- no unnecessary re-asking for known information
- no loss of the current topic unless the user clearly switches topics

### 2. Plan-Detail Answer Coverage

The assistant must answer normal benefit-summary questions without brittle one-off handling.

Examples:

- deductible / out-of-pocket max
- primary care / specialist / ER / urgent care
- in-network vs out-of-network cost sharing
- Rx tiers
- therapy coverage
- maternity coverage
- dental / vision specifics

Success means:

- common benefits-summary questions are answerable
- the assistant does not collapse into HR/Workday fallback for ordinary plan-detail questions
- missing data is handled with a specific and graceful answer, not a dead-end

### 3. Cross-Surface Truth Consistency

Chat, calculator, and other user-facing surfaces must agree on:

- plan names
- state availability
- pricing logic
- coverage tiers
- recommendation logic

Success means:

- no contradictions that erode trust

### 4. Onboarding / Memory Stability

The beginning of the conversation must feel stable and natural.

Success means:

- welcome only appears once
- names are captured cleanly
- corrections like "actually, I'm Melodie" work
- the assistant remembers age/state/context once provided

### 5. Safe but Helpful Fallbacks

When the assistant cannot answer a question confidently, it should still be useful.

Success means:

- specific explanation of what it can say
- useful next step
- no generic "contact HR" deflection for something the bot should handle

## Yellow: Important Before Client Presentation

These may not be the deepest architecture blockers, but they still matter a lot for client confidence.

### 1. Branding / Logo / Visual Trust

If the branding looks broken, missing, or sloppy, it will undermine confidence immediately.

This is not the top product-functionality risk, but it is still a client-facing quality bar.

### 2. Counselor-Like Response Quality

The assistant should sound like a benefits counselor, not a document parser or internal system.

Success means:

- plain English
- decision-relevant tradeoffs
- confidence without sounding pushy
- useful next-step prompts

### 3. Proactive Package Guidance

After answering one topic, the assistant should help the user think through what comes next.

Success means:

- natural transitions from medical into dental/vision, life, disability, and supplemental benefits
- guidance across the package instead of one isolated answer at a time

### 4. Recommendation Behavior

The assistant should not be pushy, but when asked for an opinion it should give one.

Success means:

- clear recommendation when asked
- one focused clarifier if needed
- no evasive hedging once enough context exists

## Green: Can Wait Until Post-MVP Hardening

These matter for long-term quality and maintainability, but they do not need to block pride in the MVP if the user experience is already strong.

### 1. Semantic Intent-Normalization Layer

This is the right long-term direction for robustness, but it does not need to be fully rolled out before MVP confidence if the worst conversational failures are stabilized.

### 2. Canonical Benefits Engine Rollout

This is the right post-MVP architecture target for maintainability, annual updates, and cross-surface truth.

### 3. Broader UI / Visual Polish

Nice to have, but secondary to trust, factual reliability, and conversational quality.

## Execution Order

Recommended order of work:

1. Follow-up reliability and conversation stability
2. Plan-summary detail coverage
3. Cross-surface truth consistency
4. Counselor-like response quality and package guidance
5. Branding cleanup for client presentation quality
6. Post-MVP semantic normalization and canonical data architecture

## MVP Standard

We should feel good showing this to a client when a real employee can:

- start a conversation naturally
- ask normal follow-up questions naturally
- get accurate answers about real benefit details
- ask for a recommendation and receive a useful opinion
- be guided through the broader benefits package
- finish the interaction without feeling frustrated
