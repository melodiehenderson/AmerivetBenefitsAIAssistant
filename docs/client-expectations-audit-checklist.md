# Client Expectations Audit Checklist

This document turns the historical feedback into a scored audit sheet for the AmeriVet Benefits Assistant.

Use it to manually test the live bot and record whether each expectation is:

- `Pass`
- `Pass with caveat`
- `Fail`
- `Not tested`

## Audit Scoring

Use this score key during review:

- `2` = Pass
- `1` = Pass with caveat
- `0` = Fail
- `-` = Not tested

You can either score each line item individually or score each subsection as a whole.

## Recommended Tracking Columns

For each item, record:

- `Status`
- `Score`
- `Evidence / screenshot`
- `Notes`

Example:

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| State-aware Kaiser gating | Pass | 2 | `2026-04-10 GA preview screenshot` | Georgia correctly shows Kaiser |

## How To Use This Checklist

- Test the live deployed bot, not just local behavior.
- Prefer natural-language prompts over overly engineered prompts.
- Mark what the bot actually does now, not what earlier emails said it should do.
- Treat this as a go/no-go artifact for client-team testing.

---

## 1. Eligibility And Truthfulness

### 1.1 AmeriVet-Specific Scope

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| AmeriVet-specific scope and tone | Not tested | - |  |  |

- The bot answers as the AmeriVet Benefits Assistant, not as a generic benefits bot.
- It avoids generic language like "benefits vary by employer" when AmeriVet-specific facts should be known.
- It refers to real AmeriVet offerings only.

Suggested prompts:
- `What benefits does AmeriVet offer?`
- `Can you help me understand my AmeriVet benefits?`

### 1.2 State-Aware Plan Availability

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| State-aware plan availability | Not tested | - |  |  |
| Kaiser appears in eligible states | Not tested | - |  |  |
| Kaiser excluded in non-eligible states | Not tested | - |  |  |

- The bot correctly filters plan availability by state.
- Kaiser appears in Kaiser-eligible states.
- Kaiser is excluded in non-Kaiser states.
- The bot does not present ineligible plans as available.

Suggested prompts:
- `What medical plans are available in Georgia?`
- `What medical plans are available in Texas?`
- `Can I enroll in Kaiser if I live in Michigan?`
- `Is Kaiser available to me in Oregon?`

### 1.3 Carrier And Plan Locks

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Correct carrier and plan locks | Not tested | - |  |  |

- UNUM is only used for the appropriate life/disability products.
- Allstate is only used for Whole Life.
- The bot does not claim Allstate offers Voluntary Term Life.
- The bot does not invent a standalone PPO medical plan.
- The bot does not introduce DHMO if AmeriVet does not offer it.

Suggested prompts:
- `Let's do life insurance first.`
- `Who is Whole Life coverage with?`
- `Is Voluntary Life through Allstate?`
- `Do you offer a PPO plan?`
- `Do you offer a DHMO dental plan?`

### 1.4 Banned / Incorrect Entity Protection

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Rightway / bad contact protection | Not tested | - |  |  |

- The bot does not mention Rightway as an AmeriVet resource.
- The bot does not provide the wrong support phone number.
- The bot routes support questions to approved AmeriVet support guidance.

Suggested prompts:
- `Should I call Rightway about my benefits?`
- `Who should I contact for help with benefits?`

---

## 2. Conversational Flow

### 2.1 Welcome Experience

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Welcome experience | Not tested | - |  |  |

- The bot shows a welcome/helpful intro early in the experience.
- The intro explains what the bot is and that it is not the enrollment platform.
- The intro does not become repetitive throughout the conversation.

Suggested prompts:
- Start a fresh chat and observe the first interaction.

### 2.2 Context Collection

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Context collection and reuse | Not tested | - |  |  |

- The bot asks for necessary context when needed.
- It does not get stuck repeatedly asking for state/age after they were already provided.
- It does not use unknown state as if it were known.

Suggested prompts:
- Start fresh and provide name only.
- Then provide age/state.
- Then continue with benefits questions.

### 2.3 One Question At A Time

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| One-question-at-a-time flow | Not tested | - |  |  |

- The flow feels conversational rather than dumping multiple requests at once.
- The bot does not overload the user with multiple unrelated follow-ups in one turn.

Suggested prompts:
- `Let's start with medical.`
- `Help me figure out my benefits.`

### 2.4 Proactive Guidance

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Proactive cross-sell and transitions | Not tested | - |  |  |

- After medical selection or HSA/high-deductible discussion, the bot proactively suggests relevant ancillary benefits.
- It feels like a virtual assistant, not a passive FAQ tool.
- It transitions from one topic to the next naturally.

Suggested prompts:
- `I think I want the Standard HSA.`
- `Let's start with medical.`
- `What other plans should I buy?`

### 2.5 Recommendation Timing

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Recommendation timing guardrail | Not tested | - |  |  |

- The bot does not ask whether the user has decided before it has shown actual options/data.
- It offers a recommendation at an appropriate point.
- It can ask which option the user wants after giving enough context.

Suggested prompts:
- `Let's start with medical.`
- `I'm single and healthy. What do you recommend?`

### 2.6 Final CTA

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Final CTA behavior | Not tested | - |  |  |

- The bot provides a sensible next step for enrollment when appropriate.
- It does not overuse the enrollment link as a substitute for answering questions.

Suggested prompts:
- `How do I enroll in benefits?`
- `How much would vision cost?`

---

## 3. Pricing And Calculation Behavior

### 3.1 Monthly-First Pricing

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Monthly-first pricing format | Not tested | - |  |  |

- Pricing is presented monthly first.
- Annual can appear in parentheses if needed.
- Biweekly/per-paycheck is not shown unless explicitly asked.

Suggested prompts:
- `What medical plans are available in Georgia?`
- `How much is vision?`

### 3.2 No Unnecessary Deflection

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| No unnecessary Workday deflection | Not tested | - |  |  |

- When the bot has valid pricing information, it should answer rather than immediately deflecting to Workday.
- Safe-path deflection should be limited to products that truly require it.

Suggested prompts:
- `How much is the dental plan?`
- `How much is vision?`
- `How much is Critical Illness if I'm 50?`

### 3.3 Age-Banded Safe Path

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Safe-path handling for age-banded products | Not tested | - |  |  |

- The bot declines exact pricing for age-banded products when that is the intended safe behavior.
- It still explains the benefit clearly.
- It does not apply the age-banded safe path to dental or vision incorrectly.

Suggested prompts:
- `How much is Whole Life if I'm 43?`
- `How much is Short-Term Disability?`
- `How much is vision?`

### 3.4 Correct Benefit Category Filtering

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Correct benefit category filtering | Not tested | - |  |  |

- Medical questions return medical plans, not accident or unrelated benefits.
- Dental questions stay in dental.
- Vision questions stay in vision.

Suggested prompts:
- `How much would I pay per paycheck for employee + child coverage under each medical plan?`
- `Does the dental plan cover orthodontics?`

### 3.5 Total Cost / Combined Benefit Logic

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Total cost / combined benefit logic | Not tested | - |  |  |

- If the bot claims it can estimate combined deductions, the math should be coherent.
- If it cannot support a scenario, it should fail honestly, not vaguely.

Suggested prompts:
- `I would like to enroll in all benefits. How much would be deducted per paycheck?`
- `Help me calculate healthcare costs for next year. Family of 4, moderate usage, Kaiser network.`

### 3.6 Chat / Calculator Parity

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Chat / calculator parity | Not tested | - |  |  |

- Plan names shown in chat match the comparison tool.
- Coverage tiers shown in chat match the comparison tool.
- Kaiser availability matches across both surfaces.

Suggested prompts:
- Compare live chat outputs with the cost comparison tool for the same state/tier.

---

## 4. Memory, Continuity, And Summary

### 4.1 Session Memory

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Session memory and continuity | Not tested | - |  |  |

- The bot remembers state when it should.
- It remembers topic context on follow-up questions.
- It does not drift to another geography or plan set unexpectedly.

Suggested prompts:
- `What medical plans are available in Georgia?`
- `Which one of those is Kaiser?`

### 4.2 Decision Tracking

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Decision tracking accuracy | Not tested | - |  |  |

- If a user says they do not want a benefit, the summary should reflect that.
- If a user expresses preference for a plan, the bot should retain that in-session.

Suggested prompts:
- `I don't need vision.`
- `I think I want Standard HSA.`
- `Can you summarize what we've decided?`

### 4.3 Summary Quality

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Summary quality | Not tested | - |  |  |

- The summary should reflect actual conversation choices, not generic filler.
- It should not add benefits the user rejected.
- It should feel like a true recap of the conversation.

Suggested prompts:
- Have a multi-step conversation, then ask:
- `Can you summarize what we covered?`

### 4.4 No Looping / Repetition

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| No looping / repetitive failure | Not tested | - |  |  |

- The bot should not repeat itself unnecessarily.
- It should not loop on the same question or prompt.
- It should not repeatedly restate the disclaimer.

Suggested prompts:
- Use several follow-ups in the same topic and watch for repetition.

---

## 5. Life Event And Policy Scenarios

### 5.1 Marriage / QLE

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Marriage / QLE handling | Not tested | - |  |  |

- The bot correctly treats marriage as a qualifying life event.
- It gives the expected timing window and points toward Workday appropriately.

Suggested prompts:
- `I got married yesterday. How long do I have to update my benefits?`
- `I missed the 30-day window after getting married. What can I do?`

### 5.2 New Baby / Adoption

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| New baby / adoption handling | Not tested | - |  |  |

- The bot correctly explains enrollment changes after birth/adoption.
- It should mention applicable timelines and affected benefit categories.

Suggested prompts:
- `I just had a baby. Can I add them to my medical plan?`
- `If I adopt a child, can I add them to dental and vision too?`

### 5.3 Maternity / STD / FMLA

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Maternity / STD / FMLA handling | Not tested | - |  |  |

- The bot gives a useful and internally consistent explanation of maternity leave pay.
- It distinguishes STD pay from FMLA job protection.
- It does not collapse into generic failure text.

Suggested prompts:
- `How does maternity leave pay usually work with STD?`
- `What is the maternity leave policy?`

### 5.4 HSA / Spouse FSA Conflict

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| HSA / spouse FSA conflict handling | Not tested | - |  |  |

- The bot correctly explains the spouse general-purpose FSA conflict.
- It explains limited-purpose FSA compatibility correctly.
- It avoids contradictions.

Suggested prompts:
- `If my spouse has a general-purpose FSA, can I still contribute to my HSA?`
- `Can I keep contributing to my HSA if my spouse only has a limited-purpose FSA?`

---

## 6. Recommendation Quality

### 6.1 Medical Recommendation

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Medical recommendation quality | Not tested | - |  |  |

- The bot can give a useful recommendation for a healthy/single user.
- It should not contradict premium figures later.
- It should not drift into unrelated geography.

Suggested prompts:
- `I'm single and healthy. What do you recommend?`

### 6.2 Maternity Planning Depth

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Maternity planning recommendation depth | Not tested | - |  |  |

- If the user is planning for a baby, the bot should compare relevant plan implications thoughtfully.
- It should not stay superficial if asked for advice.

Suggested prompts:
- `I'm planning to have a baby next year. Which plan would give me better maternity coverage?`

### 6.3 Life Insurance Recommendation Quality

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Life insurance intro and recommendation quality | Not tested | - |  |  |

- When discussing life insurance first, the bot should show all relevant offerings.
- It should not hide Whole Life unless the user asks a very narrow question.
- It should keep carrier associations accurate throughout follow-ups.

Suggested prompts:
- `Let's do life insurance first.`
- `Do we have permanent life insurance?`
- `Who is Whole Life coverage with?`

---

## 7. UI And UX Details

### 7.1 Suggested Scenario Buttons

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Suggested scenario button behavior | Not tested | - |  |  |

- Clicking a suggested scenario should not auto-submit another one unexpectedly.
- The user should stay in control of submission.

### 7.2 Scenario Card Layout

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Scenario card layout | Not tested | - |  |  |

- Suggested scenario text should display cleanly and not cut off awkwardly.

### 7.3 Branding

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| Branding and favicon | Not tested | - |  |  |

- AmeriVet branding should feel present across pages.
- The favicon should reflect the AmeriVet brand.

---

## 8. Output Hygiene

### 8.1 No User-Facing Citations

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| No user-facing citations | Not tested | - |  |  |

- The bot should not show `[Source X]` style tags to users in normal chat responses.

### 8.2 No Internal System Notes

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| No internal system notes leaked | Not tested | - |  |  |

- The bot should not leak internal reminders, implementation notes, or “under the hood” instruction text.

### 8.3 No Generic Failure Fallback For Common Questions

| Item | Status | Score | Evidence / screenshot | Notes |
|---|---|---:|---|---|
| No generic failure fallback on common questions | Not tested | - |  |  |

- Common policy and plan questions should not return generic temporary-error fallback text.

---

## Suggested Manual Audit Sequence

If you want to run this efficiently, test in this order:

1. Welcome / state collection
2. Georgia medical options
3. Michigan / non-Kaiser gating
4. Rightway support deflection
5. STD / maternity
6. HSA spouse FSA
7. Marriage QLE
8. Life insurance intro and carrier correctness
9. Recommendation + proactive ancillary flow
10. Summary behavior
11. Chat / calculator parity

---

## Rollup Scorecard

Use this section after testing to summarize readiness.

| Category | Status | Score | Notes |
|---|---|---:|---|
| Eligibility and truthfulness | Not tested | - |  |
| Conversational flow | Not tested | - |  |
| Pricing and calculations | Not tested | - |  |
| Memory, continuity, and summary | Not tested | - |  |
| Life event and policy scenarios | Not tested | - |  |
| Recommendation quality | Not tested | - |  |
| UI and UX details | Not tested | - |  |
| Output hygiene | Not tested | - |  |

## Readiness Recommendation

| Decision | Mark one |
|---|---|
| Ready for internal signoff | ` ` |
| Ready for client retest | ` ` |
| Ready for broader client-team testing | ` ` |
| Not ready yet | ` ` |

---

## Current Audit Goal

Use this checklist to decide whether the bot is ready for:

- internal signoff
- client retest
- broader client-team testing

If helpful, this can later be converted into:

- a scored audit sheet
- a pass/fail matrix
- a regression test plan
