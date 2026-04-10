/**
 * Chain-of-Verification (CoV) Prompt Builder
 *
 * Forces the LLM to self-verify in a single call using a three-phase structure:
 *
 *   Phase 1 — DRAFT:   Answer the user's question using the retrieved context.
 *   Phase 2 — VERIFY:  For every number in the Draft, cite the exact source doc/paragraph.
 *                       If a source cannot be cited, mark the number as UNVERIFIED.
 *   Phase 3 — CORRECT: Rewrite the Draft removing or correcting all UNVERIFIED claims.
 *                       The Corrected answer is the ONLY text shown to the user.
 *
 * This prevents hallucinated rates, mixed plan details, and geographic drift in a
 * single LLM round-trip — no extra API calls.
 */

import { REFUSAL_TOKEN } from './response-verifier';

// ============================================================================
// N-Shot Grounding Examples
// ============================================================================

/**
 * Three before/after examples injected into the system prompt.
 * These calibrate the model toward citation-anchored answers and away from
 * confident guessing.
 */
const N_SHOT_EXAMPLES = `
=== GROUNDING EXAMPLES (follow this style) ===

❌ BAD (hallucinated, no source, wrong category):
"The PPO plan is best for you — it covers everything and costs about $200/month."

✅ GOOD (sourced, category-matched, labelled rate):
"According to the AmeriVet 2024–2025 Benefits Guide [Standard HSA plan], the BCBSTX Standard HSA
costs $86.84/month ($40.08 bi-weekly) for employee-only coverage. The deductible is $3,500
individual. If you anticipate low medical usage, this plan's lower premium saves money while the
HSA account offsets out-of-pocket costs."

---

❌ BAD (mixes annual and monthly, no label):
"Your family premium is $3,800 for the Enhanced HSA."

✅ GOOD (all rates labelled, correct period):
"The Enhanced HSA family tier costs $412.37/month ($190.48 bi-weekly), or $4,948.44 annually."

---

❌ BAD (uncertain phrasing, no grounding):
"I think the Kaiser HMO might be available in your area, but I'm not sure about the deductible."

✅ GOOD (geographic check, sourced):
"The Kaiser Standard HMO is available in California, Georgia, Oregon, and Washington [AmeriVet Regional Plan Guide].
Your state (TX) is not eligible for this plan. The BCBSTX plans are the applicable options."

=== END EXAMPLES ===
`.trim();

// ============================================================================
// CoV Prompt Constructor
// ============================================================================

/**
 * Build the Chain-of-Verification system prompt.
 *
 * @param userQuery    The user's original message
 * @param ragContext   The retrieved document chunks (pre-formatted string)
 * @param basePrompt   The base RAG/analyst system prompt (injected at top)
 * @returns            A complete system prompt with CoV instructions
 */
export function buildChainOfVerificationPrompt(
  userQuery: string,
  ragContext: string,
  basePrompt: string
): string {
  return [
    basePrompt,
    '',
    N_SHOT_EXAMPLES,
    '',
    '=== RETRIEVED CONTEXT (ground truth — treat as immutable) ===',
    ragContext,
    '=== END CONTEXT ===',
    '',
    '=== CHAIN-OF-VERIFICATION INSTRUCTIONS ===',
    'You MUST follow all three phases. Output ONLY Phase 3 (Corrected Answer) to the user.',
    '',
    'PHASE 1 — DRAFT:',
    `Answer this question using ONLY the Retrieved Context above: "${userQuery}"`,
    'Include all relevant plan names, premiums, deductibles, and OOP limits.',
    'Format every rate as "$X.XX/month ($Y.YY bi-weekly)".',
    '',
    'PHASE 2 — VERIFY (internal only, do not show to user):',
    'For each number or plan claim in your Draft, write: "Claim: [value] → Source: [exact doc snippet]".',
    `If you cannot find a supporting snippet, write: "Claim: [value] → Source: ${REFUSAL_TOKEN}"`,
    '',
    'PHASE 3 — CORRECTED ANSWER (this is the ONLY text you return to the user):',
    `- Remove or replace every claim whose source was ${REFUSAL_TOKEN}.`,
    '- If all supporting sources were verified, the Corrected Answer equals the Draft.',
    `- If every single claim was ${REFUSAL_TOKEN}, output only: ${REFUSAL_TOKEN}`,
    '=== END INSTRUCTIONS ===',
  ].join('\n');
}

// ============================================================================
// Corrective Re-try Prompt
// ============================================================================

/**
 * Build the re-try system prompt used when the verifier flags a 'retry'.
 *
 * Appended to the original system prompt on the second (and only) LLM call.
 *
 * @param originalResponse      The flawed first-pass LLM response
 * @param correctiveInstruction The specific correction instructions from the verifier
 */
export function buildCorrectiveRetryPrompt(
  originalResponse: string,
  correctiveInstruction: string
): string {
  return [
    '=== RESPONSE VERIFICATION FAILED — CORRECTION REQUIRED ===',
    '',
    'Your previous response was rejected by the verification system. Here is what was wrong:',
    '',
    correctiveInstruction,
    '',
    'PREVIOUS (REJECTED) RESPONSE:',
    '"""',
    originalResponse,
    '"""',
    '',
    'Generate a CORRECTED response that addresses all the issues above.',
    'Do NOT repeat the rejected content. Start fresh from the context.',
    '=== END CORRECTION INSTRUCTIONS ===',
  ].join('\n');
}
