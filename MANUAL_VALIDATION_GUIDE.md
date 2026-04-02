# Manual Validation Guide: Contract-Based Tests

This guide provides the steps to manually validate the 53 "contract-based" test cases that require live LLM interaction.

**Instructions:**
1.  For each test case below, copy the specified **Query**.
2.  If a **State** is specified, ensure your user context or query reflects that location.
3.  Paste the query into the chatbot.
4.  Review the chatbot's response against the **Acceptance Criteria**.
5.  Mark the test as **Pass** or **Fail**.

---

## Category: std_leave_pay

### `STD-001` — STD intercept fires: explains 60% salary, 7-day waiting, week 1 unpaid
**Query:**
```
How much will I get paid during maternity leave?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `60%`, `short-term disability`, `week 1`, `waiting period`
*   **MUST NOT CONTAIN:** `$`
**Result:** [ ] Pass [ ] Fail

---

### `STD-002` — STD explained correctly as Unum, 60% base salary
**Query:**
```
What income replacement does STD provide during FMLA?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `60%`, `Unum`, `base salary`
*   **MUST NOT CONTAIN:** `Allstate STD`, `BCBSTX STD`
**Result:** [ ] Pass [ ] Fail

---

### `STD-003` — Week-6 question triggers STD intercept, correctly explains pay timeline
**Query:**
```
Will I get paid during parental leave at week 6?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `60%`, `STD`, `Unum`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `STD-004` — Policy answer includes FMLA 12-week protection; no pricing data mixed in
**Query:**
```
What is the maternity leave policy?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `FMLA`, `12 weeks`
*   **MUST NOT CONTAIN:** `$`, `per-paycheck`, `monthly premium`
**Result:** [ ] Pass [ ] Fail

---

### `STD-005` — Correctly differentiates the waiting period for accident versus illness for STD.
**Query:**
```
Is there a waiting period for STD for an accident?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `0 days for accident`, `7 days for illness`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

## Category: hsa_fsa_irs

### `HSA-001` — IRS dual-enrollment warning fires: spouse GP-FSA blocks HSA contributions
**Query:**
```
My spouse has a general-purpose FSA — can I still open an HSA?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `IRS`, `not eligible`, `general-purpose FSA`, `limited-purpose`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `HSA-002` — Same IRS block rule: health care FSA = GP-FSA, blocks HSA
**Query:**
```
Can I contribute to an HSA if my partner has a health care FSA at work?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `IRS`, `ineligible`, `limited-purpose`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `HSA-003` — 2025 IRS limits returned; no FSA conflict mentioned (no spouse FSA in question)
**Query:**
```
How much can I put in my HSA this year?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `IRS`, `2025`, `self-only`, `family`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `HSA-004` — Clear comparison: HSA rolls over, FSA is use-it-or-lose-it; no IRS conflict (standalone question)
**Query:**
```
What's the difference between HSA and FSA?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `HSA`, `FSA`, `roll over`, `use-it-or-lose-it`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `HSA-005` — Confirms the employer contribution to the HSA.
**Query:**
```
Does AmeriVet contribute to my HSA?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `AmeriVet contributes`, `$750`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

## Category: qle_enrollment

### `MARRIAGE-001` — Marriage QLE: 30-day window + Workday enrollment CTA
**Query:**
```
I got married last week. When do I have to update my benefits?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `30 days`, `qualifying life event`, `Workday`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `MARRIAGE-002` — Birth QLE: 30-day window to add dependent
**Query:**
```
I just had a baby. Can I add them to my medical plan?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `30 days`, `qualifying life event`, `newborn`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `MARRIAGE-003` — Loss-of-coverage QLE triggers 30-day enrollment window
**Query:**
```
My spouse lost their job. Can I add them to my health insurance now?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `30 days`, `qualifying life event`, `loss of coverage`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `MARRIAGE-004` — Correctly informs the user they must wait for open enrollment if they miss the QLE window.
**Query:**
```
I missed the 30-day window after getting married. What can I do?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `wait until the next open enrollment`
*   **MUST NOT CONTAIN:** `can still make changes`
**Result:** [ ] Pass [ ] Fail

---

## Category: deductible_reset

### `DEDUCTIBLE-001` — Marriage mid-year: prior single deductible does not automatically transfer to family plan
**Query:**
```
I got married in October. My new spouse had $2,000 in expenses this year. Does that count toward our deductible?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `deductible`, `resets`, `mid-year`, `new policy`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `DEDUCTIBLE-002` — Standard HSA family deductible stated; no Kaiser confusion for non-Kaiser states
**Query:**
```
What's the family deductible for Standard HSA?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Standard HSA`, `deductible`
*   **MUST NOT CONTAIN:** `Kaiser deductible`
**Result:** [ ] Pass [ ] Fail

---

### `DEDUCTIBLE-003` — Confirms that any coverage tier other than 'Employee Only' is subject to the family deductible.
**Query:**
```
Does the family deductible apply if it's just me and my child?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Employee + Child`, `family deductible`
*   **MUST NOT CONTAIN:** `Employee Only`
**Result:** [ ] Pass [ ] Fail

---

## Category: vision_dental

### `VISION-001` — Vision is VSP; no wrong carrier attribution
**Query:**
```
What vision plan does AmeriVet offer?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `VSP`, `vision`
*   **MUST NOT CONTAIN:** `BCBSTX vision`, `Kaiser vision`
**Result:** [ ] Pass [ ] Fail

---

### `VISION-002` — VSP provides LASIK discount program; stated accurately
**Query:**
```
Does my vision plan cover LASIK?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `VSP`, `LASIK`, `discount`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `VISION-003` — Correctly states the 12-month frequency for the frame allowance.
**Query:**
```
How often can I get new glasses?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `VSP`, `frame allowance`, `every 12 months`
*   **MUST NOT CONTAIN:** `every 24 months`
**Result:** [ ] Pass [ ] Fail

---

## Category: grounding_hallucination

### `GROUNDING-001` — If 401k data not in corpus, must not hallucinate match percentages; should redirect to HR
**Query:**
```
Tell me about the AmeriVet 401k match
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** 
*   **MUST NOT CONTAIN:** `100% match`, `unlimited`, `5% match`, `6% match`
**Result:** [ ] Pass [ ] Fail

---

### `GROUNDING-002` — Gym reimbursement details not in corpus; must not hallucinate figures
**Query:**
```
What is the AmeriVet gym reimbursement amount?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** 
*   **MUST NOT CONTAIN:** `$50/month`, `$100/month`, `$600/year`
**Result:** [ ] Pass [ ] Fail

---

### `GROUNDING-003` — AmeriVet offers HSA/HDHP plans, not traditional PPO tiers — must not hallucinate PPO plan names
**Query:**
```
Does AmeriVet have a PPO medical plan?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `HSA`, `HDHP`
*   **MUST NOT CONTAIN:** `Gold PPO`, `Silver PPO`, `Bronze PPO`, `BCBSTX PPO`
**Result:** [ ] Pass [ ] Fail

---

### `GROUNDING-004` — Does not hallucinate a pet insurance benefit if it's not in the provided documents.
**Query:**
```
Is there a pet insurance benefit?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `not part of the current AmeriVet benefits`
*   **MUST NOT CONTAIN:** `Nationwide`, `Figo`
**Result:** [ ] Pass [ ] Fail

---

## Category: source_citation

### `CITATION-001` — Correct Enhanced HSA deductible ($2,500) cited; not conflated with Standard HSA
**Query:**
```
What is the deductible for the Enhanced HSA plan?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Enhanced HSA`, `$2,500`, `deductible`
*   **MUST NOT CONTAIN:** `Standard HSA deductible`
**Result:** [ ] Pass [ ] Fail

---

### `CITATION-002` — Open enrollment window stated; Workday enrollment link provided
**Query:**
```
When is open enrollment?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `November`, `Workday`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `CITATION-003` — Provides the HR phone number without a document citation.
**Query:**
```
What is the number for HR?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `888-217-4728`
*   **MUST NOT CONTAIN:** `Source 1`
**Result:** [ ] Pass [ ] Fail

---

## Category: coverage_tier

### `TIER-001` — Employee-only tier pricing shown; not family or spouse tier
**Query:**
```
How much does medical cost for just me?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Employee Only`, `Standard HSA`, `Enhanced HSA`
*   **MUST NOT CONTAIN:** `Employee + Spouse`, `Family tier`
**Result:** [ ] Pass [ ] Fail

---

### `TIER-002` — Family tier returned for Standard HSA, not individual rate
**Query:**
```
What is the premium for employee plus family on the Standard HSA?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Employee + Family`, `Standard HSA`
*   **MUST NOT CONTAIN:** `Employee Only rate`, `individual rate`
**Result:** [ ] Pass [ ] Fail

---

### `TIER-003` — Provides the correct premium for the 'Employee + Spouse' tier on the Enhanced HSA plan.
**Query:**
```
What's the cost for the Enhanced HSA for me and my spouse?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Employee + Spouse`, `Enhanced HSA`, `$345.22`
*   **MUST NOT CONTAIN:** `Family`, `Employee Only`
**Result:** [ ] Pass [ ] Fail

---

## Category: plan_comparison

### `COMPARE-001` — Returns a comparison of Standard and Enhanced HSA plans with correct family deductibles for a non-Kaiser state.
**Query:**
```
Compare the Standard and Enhanced HSA plans for a family in Texas.
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Standard HSA`, `Enhanced HSA`, `$7,000`, `$5,000`
*   **MUST NOT CONTAIN:** `Kaiser`
**Result:** [ ] Pass [ ] Fail

---

### `COMPARE-002` — Correctly identifies the Enhanced HSA as having the lower out-of-pocket maximum.
**Query:**
```
Which medical plan has a lower out-of-pocket maximum?
```
**State:** `CA`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Enhanced HSA`, `$5,500`, `Standard HSA`, `$7,500`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `COMPARE-003` — Highlights the key coverage tiers of the single PPO dental plan offered.
**Query:**
```
What's the main difference in dental coverage?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `BCBSTX Dental PPO`, `preventive`, `basic`, `major`
*   **MUST NOT CONTAIN:** `DHMO`
**Result:** [ ] Pass [ ] Fail

---

### `COMPARE-004` — Correctly compares the annual maximums for dental (has one) and vision (does not have one).
**Query:**
```
Compare vision and dental annual maximums.
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Dental`, `$1,500`, `Vision`, `no annual maximum`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `COMPARE-005` — Provides a balanced comparison, explaining the trade-offs rather than declaring one plan superior.
**Query:**
```
Which is better, the Standard or Enhanced HSA?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `depends on your needs`, `lower premium`, `lower deductible`
*   **MUST NOT CONTAIN:** `Enhanced is always better`
**Result:** [ ] Pass [ ] Fail

---

## Category: banned_entities

### `BANNED-001` — Blocks query containing a banned or controversial provider name and provides a generic response.
**Query:**
```
Does my plan cover services from 'Controversial Clinic XYZ'?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `cannot recommend or verify coverage for specific providers`
*   **MUST NOT CONTAIN:** `Controversial Clinic XYZ`
**Result:** [ ] Pass [ ] Fail

---

### `BANNED-002` — Blocks query about a non-scientific or unapproved treatment.
**Query:**
```
Tell me about the 'Miracle Cure' treatment.
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `cannot provide information on treatments that are not approved`
*   **MUST NOT CONTAIN:** `Miracle Cure`
**Result:** [ ] Pass [ ] Fail

---

### `BANNED-003` — Politely declines an out-of-scope request.
**Query:**
```
Can you help me with my homework?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `cannot assist with requests outside of AmeriVet benefits`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

## Category: context_carryover

### `CONTEXT-001-A` — Initial query correctly lists all three medical plans available in California.
**Query:**
```
What are my medical options in California?
```
**State:** `CA`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Standard HSA`, `Enhanced HSA`, `Kaiser Standard HMO`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-001-B` — Follow-up query correctly identifies the Kaiser plan as having the lowest deductible based on the previous context.
**Query:** (as a follow-up to CONTEXT-001-A)
```
Which of those has the lowest deductible?
```
**State:** `CA`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Kaiser Standard HMO`, `$1,000`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-002-A` — Lists all available voluntary benefits.
**Query:**
```
Tell me about the voluntary benefits.
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Unum Voluntary Term Life`, `Allstate Whole Life`, `Allstate Accident Insurance`, `Allstate Critical Illness`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-002-B` — Follow-up correctly filters for and lists only the Allstate products from the previous context.
**Query:** (as a follow-up to CONTEXT-002-A)
```
Which of those are from Allstate?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Whole Life`, `Accident Insurance`, `Critical Illness`
*   **MUST NOT CONTAIN:** `Unum`
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-003-A` — Correctly states that basic life is employer-paid and provides the benefit amount.
**Query:**
```
How much is the basic life insurance?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `employer-paid`, `$25,000`, `Unum`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-003-B` — Understands the user wants to purchase additional life insurance and describes the voluntary term life product.
**Query:** (as a follow-up to CONTEXT-003-A)
```
Can I buy more?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Voluntary Term Life`, `Unum`, `5x your annual salary`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-004-A` — Provides an overview of both STD and LTD.
**Query:**
```
Tell me about disability insurance.
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `Short-Term Disability`, `Long-Term Disability`, `Unum`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-004-B` — Follow-up query correctly identifies the duration of STD from the previous context.
**Query:** (as a follow-up to CONTEXT-004-A)
```
How long does the short-term one last?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `13 weeks`
*   **MUST NOT CONTAIN:** `6 months`
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-005-A` — Identifies BCBSTX as the medical carrier for a Texas employee.
**Query:**
```
What's the provider for my medical plan?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `BCBSTX`
*   **MUST NOT CONTAIN:** `Kaiser`, `Unum`
**Result:** [ ] Pass [ ] Fail

---

### `CONTEXT-005-B` — Understands the implied question and correctly identifies BCBSTX as the dental carrier as well.
**Query:** (as a follow-up to CONTEXT-005-A)
```
And for dental?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `BCBSTX`
*   **MUST NOT CONTAIN:** `Kaiser`, `Unum`
**Result:** [ ] Pass [ ] Fail

---

## Category: llm_as_judge

### `LLM-JUDGE-001` — Provides a comprehensive, helpful, and accurate summary of benefits considerations for family planning.
**Query:**
```
I'm thinking about having a baby next year. What should I consider regarding my benefits?
```
**State:** `TX`
**Acceptance Criteria:**
*   **MUST CONTAIN:** `maternity`, `deductibles`, `short-term disability`, `qualifying life event`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `LLM-JUDGE-002` — Accurately explains coordination of benefits and the critical HSA/FSA conflict rule.
**Query:**
```
My spouse is starting a new job and will have their own insurance. How does that affect my benefits strategy?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `coordination of benefits`, `HSA eligibility`, `FSA`, `IRS rules`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `LLM-JUDGE-003` — Correctly explains COBRA for medical/dental/vision, portability for voluntary plans, and that the HSA is owned by the employee.
**Query:**
```
I'm leaving the company. What happens to my insurance?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `COBRA`, `portability`, `HSA`, `Allstate`, `Unum`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `LLM-JUDGE-004` — Provides a helpful, prioritized list for a new employee, emphasizing medical first.
**Query:**
```
I'm a new employee. What are the most important benefits I should sign up for right away?
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `medical`, `Disability`, `life insurance`
*   **MUST NOT CONTAIN:** 
**Result:** [ ] Pass [ ] Fail

---

### `LLM-JUDGE-005` — Provides a very simple, clear, and accurate analogy for the FSA rule.
**Query:**
```
Explain the 'use-it-or-lose-it' rule for me like I'm five.
```
**Acceptance Criteria:**
*   **MUST CONTAIN:** `piggy bank`, `disappears`, `doesn't roll over`
*   **MUST NOT CONTAIN:** `unreimbursed medical expenses`, `Internal Revenue Code`
**Result:** [ ] Pass [ ] Fail
