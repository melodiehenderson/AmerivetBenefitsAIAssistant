/**
 * Post-Generation Response Verifier
 *
 * Treats the LLM as a non-trusted component. Every response passes through
 * this deterministic pipeline before reaching the user:
 *
 *   LLM Output
 *     │
 *     ├─ [1] REFUSAL TOKEN check  → portal redirect if [[INSUFFICIENT_DATA]]
 *     ├─ [2] RATE LABEL check     → every $NNN must have a frequency label
 *     ├─ [3] RATE ACCURACY check  → numbers must match amerivet.ts catalog
 *     ├─ [4] COMPARISON check     → compare intent requires ≥2 plans
 *     └─ [5] CATEGORY BLEED check → Medical answer must not cite Voluntary plans
 *
 * Returned `VerificationResult.action`:
 *   'pass'   → send to user as-is
 *   'retry'  → call LLM again with corrective prompt (max 1 re-try)
 *   'refuse' → show portal fallback button; do not send LLM content
 */

import { amerivetBenefits2024_2025, getAllPlans } from '@/lib/data/amerivet';
import type { IntentType } from '@/lib/rag/query-understanding';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export type VerificationAction = 'pass' | 'retry' | 'refuse';

export interface VerificationResult {
  action: VerificationAction;
  /** Human-readable reasons for non-pass decisions (empty on 'pass'). */
  reasons: string[];
  /**
   * Corrective instruction appended to the re-try prompt.
   * Only populated when action === 'retry'.
   */
  correctiveInstruction?: string;
}

/** Shape of context the verifier needs (subset of ChatContext). */
export interface VerifierContext {
  intent?: IntentType;
  category?: string;
  state?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Refusal token the LLM must emit when it cannot ground a claim. */
export const REFUSAL_TOKEN = '[[INSUFFICIENT_DATA]]';

/** Tolerance for rate matching (±$X). Accounts for rounding differences. */
const RATE_TOLERANCE = 2.0;

/**
 * Prohibited phrases that signal an uncertain or hallucinated response.
 * Matching any of these will trigger a retry.
 */
const PROHIBITED_PHRASES: RegExp[] = [
  /\bI('m| am) not sure\b/i,
  /\bI (don't|do not) (have|know)\b/i,
  /\bI (can't|cannot) (find|locate|confirm)\b/i,
  /\bI (think|believe|assume)\b/i,
  /\bI (searched|looked) but\b/i,
];

/**
 * Plans whose names appear in the catalog — used for category bleed detection.
 * Built once at module load from the immutable catalog.
 */
const PLAN_NAME_TO_TYPE: Map<string, string> = new Map(
  getAllPlans().map(p => [p.name.toLowerCase(), p.type])
);

// ============================================================================
// Check helpers
// ============================================================================

/** [1] Check for explicit refusal token. */
function checkRefusalToken(response: string): string | null {
  if (response.includes(REFUSAL_TOKEN)) {
    return `Response contains ${REFUSAL_TOKEN}`;
  }
  return null;
}

/** [1b] Check for prohibited uncertainty phrases. */
function checkProhibitedPhrases(response: string): string | null {
  for (const re of PROHIBITED_PHRASES) {
    if (re.test(response)) {
      return `Response contains prohibited phrase matching: ${re.source}`;
    }
  }
  return null;
}

/**
 * [2] RATE LABEL check.
 *
 * Every dollar amount in the response must be followed (within 25 chars) by
 * a period/frequency label. Unlabelled amounts indicate the LLM mixed periods.
 *
 * Pattern: "$NNN" NOT followed by /month|/mo|bi-weekly|/year|/paycheck|/wk
 */
function checkRateLabels(response: string): string | null {
  // Look for dollar amounts that lack a nearby period label
  const dollarRe = /\$[\d,]+\.?\d*/g;
  const LABEL_WINDOW = 25;
  const FREQ_RE = /(\/month|\/mo\b|bi-?weekly|per\s+(month|paycheck|year|pay\s+period|week)|annually|\/yr\b)/i;

  let match: RegExpExecArray | null;
  const unlabelled: string[] = [];

  while ((match = dollarRe.exec(response)) !== null) {
    const after = response.slice(match.index + match[0].length, match.index + match[0].length + LABEL_WINDOW);
    if (!FREQ_RE.test(after)) {
      unlabelled.push(match[0]);
    }
  }

  if (unlabelled.length > 0) {
    return `Rate label missing for: ${unlabelled.slice(0, 3).join(', ')} (must include /month or bi-weekly)`;
  }
  return null;
}

/**
 * [3] RATE ACCURACY check.
 *
 * Extract all dollar amounts followed by known labels from the response,
 * then compare against the amerivet.ts catalog. If a number appears in the
 * response but is not within ±RATE_TOLERANCE of any known plan rate, flag it.
 *
 * This makes hallucinating "$57/month" impossible when the catalog says "$86.84/month".
 */
function checkRateAccuracy(response: string): string | null {
  // Build flat list of all known rates from the catalog
  const allPlans = getAllPlans();
  const knownRates: number[] = [];
  for (const plan of allPlans) {
    knownRates.push(...Object.values(plan.tiers));
    if (plan.premiums?.employee?.monthly) knownRates.push(plan.premiums.employee.monthly);
    if (plan.premiums?.employee?.biweekly) knownRates.push(plan.premiums.employee.biweekly);
    if (plan.benefits?.deductible)    knownRates.push(plan.benefits.deductible);
    if (plan.benefits?.outOfPocketMax) knownRates.push(plan.benefits.outOfPocketMax);
  }
  // Add special account rates
  const { hsa, commuter } = amerivetBenefits2024_2025.specialCoverage;
  if (typeof hsa.employerContribution === 'number') {
    knownRates.push(hsa.employerContribution);
  } else {
    knownRates.push(...Object.values(hsa.employerContribution));
  }
  knownRates.push(commuter.monthlyBenefit);

  // Extract dollar amounts with a frequency label from response
  const labelledRe = /\$([\d,]+\.?\d*)\s*\/(month|mo\b|yr|year)|bi-?weekly[^$]*\$([\d,]+\.?\d*)/gi;
  const suspicious: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = labelledRe.exec(response)) !== null) {
    const rawVal = (m[1] || m[3] || '').replace(/,/g, '');
    const value = parseFloat(rawVal);
    if (isNaN(value) || value < 1) continue;

    // Check if this value is within tolerance of ANY known rate
    const matched = knownRates.some(r => Math.abs(r - value) <= RATE_TOLERANCE);
    if (!matched) {
      suspicious.push(`$${value}`);
    }
  }

  if (suspicious.length > 0) {
    return `Rate(s) not found in AmeriVet catalog: ${suspicious.slice(0, 3).join(', ')}. Possible hallucination.`;
  }
  return null;
}

/**
 * [4] COMPARISON check.
 *
 * If intent is 'compare', the response must mention ≥2 distinct plan names.
 * A single-plan answer to a compare question is incomplete.
 */
function checkComparisonCompleteness(response: string, intent?: IntentType): string | null {
  if (intent !== 'compare') return null;

  const lower = response.toLowerCase();
  const planNames = [
    'standard hsa', 'enhanced hsa', 'kaiser', 'hmo',
    'bcbstx', 'dental', 'vision', 'unum', 'vsp',
  ];
  const mentioned = planNames.filter(name => lower.includes(name));

  if (mentioned.length < 2) {
    return `Comparison intent detected but only ${mentioned.length} plan(s) mentioned. Must reference ≥2.`;
  }
  return null;
}

/**
 * [5] CATEGORY BLEED check.
 *
 * If the user asked about Medical, the response must not cite Voluntary plan names
 * as if they were Medical options.
 */
function checkCategoryBleed(response: string, category?: string): string | null {
  if (!category) return null;
  const requestedType = category.toLowerCase();
  if (!['medical', 'dental', 'vision'].includes(requestedType)) return null;

  const lower = response.toLowerCase();
  const bleeds: string[] = [];

  for (const [planName, planType] of PLAN_NAME_TO_TYPE.entries()) {
    if (planType !== requestedType && lower.includes(planName)) {
      bleeds.push(planName);
    }
  }

  if (bleeds.length > 0) {
    return `Category bleed: ${category} response references ${bleeds.join(', ')} (wrong type).`;
  }
  return null;
}

// ============================================================================
// Main Verifier
// ============================================================================

/**
 * Verify a generated LLM response against all deterministic gates.
 *
 * @param response  Raw LLM output
 * @param context   Request context (intent, category, state)
 * @returns         VerificationResult with action and reasons
 */
export function verifyResponse(
  response: string,
  context: VerifierContext = {}
): VerificationResult {
  const reasons: string[] = [];
  let mustRefuse = false;
  const correctiveParts: string[] = [];

  // --- Gate 1: Refusal token (hard refuse) ---
  const refusalIssue = checkRefusalToken(response);
  if (refusalIssue) {
    mustRefuse = true;
    reasons.push(refusalIssue);
  }

  // --- Gate 1b: Prohibited phrases (retry) ---
  const phraseIssue = checkProhibitedPhrases(response);
  if (phraseIssue) {
    reasons.push(phraseIssue);
    correctiveParts.push(
      'CORRECTION: Do not express uncertainty. If the context contains the answer, state it directly. ' +
      'If it does not, output [[INSUFFICIENT_DATA]] instead of guessing.'
    );
  }

  // --- Gate 2: Rate labels (retry) ---
  const labelIssue = checkRateLabels(response);
  if (labelIssue) {
    reasons.push(labelIssue);
    correctiveParts.push(
      'CORRECTION: Every dollar amount MUST include a period label, ' +
      'e.g. "$86.84/month ($40.08 bi-weekly)". Rewrite all rates with this format.'
    );
  }

  // --- Gate 3: Rate accuracy (retry) ---
  const accuracyIssue = checkRateAccuracy(response);
  if (accuracyIssue) {
    reasons.push(accuracyIssue);
    correctiveParts.push(
      'CORRECTION: The rates you quoted do not match the AmeriVet benefit catalog. ' +
      'Use ONLY the premiums, deductibles, and OOP maximums from the provided catalog context. ' +
      'Do not estimate or round.'
    );
  }

  // --- Gate 4: Comparison completeness (retry) ---
  const comparisonIssue = checkComparisonCompleteness(response, context.intent);
  if (comparisonIssue) {
    reasons.push(comparisonIssue);
    correctiveParts.push(
      'CORRECTION: The user asked for a comparison. ' +
      'Your answer must include a side-by-side breakdown of ALL eligible plans ' +
      '(deductible, OOP max, monthly premium, key features). Do not omit any.'
    );
  }

  // --- Gate 5: Category bleed (retry) ---
  const bleedIssue = checkCategoryBleed(response, context.category);
  if (bleedIssue) {
    reasons.push(bleedIssue);
    correctiveParts.push(
      `CORRECTION: The user asked about ${context.category}. ` +
      'Do not reference plans from other benefit categories in your answer.'
    );
  }

  // ---- Determine action ----
  if (mustRefuse) {
    logger.warn('[VERIFIER] REFUSE', { reasons });
    return { action: 'refuse', reasons };
  }

  if (reasons.length > 0) {
    const correctiveInstruction = correctiveParts.join('\n\n');
    logger.warn('[VERIFIER] RETRY', { reasons, correctiveInstruction });
    return { action: 'retry', reasons, correctiveInstruction };
  }

  logger.debug('[VERIFIER] PASS');
  return { action: 'pass', reasons: [] };
}

// ============================================================================
// Portal Fallback Message
// ============================================================================

/** Standard message shown to the user when the verifier triggers a 'refuse'. */
export const PORTAL_FALLBACK_MESSAGE =
  "I couldn't verify that in the official AmeriVet benefits documents. " +
  "If you'd like, reply with the specific benefit, plan name, or state you're asking about and I'll try again. " +
  "For accurate, plan-specific details, please visit your [benefits enrollment portal]({{PORTAL_URL}}) or speak with your HR team.";

export function buildPortalFallback(portalUrl?: string): string {
  const url = portalUrl || process.env.ENROLLMENT_PORTAL_URL || process.env.NEXT_PUBLIC_ENROLLMENT_URL || '#';
  const hrPhone = process.env.HR_PHONE_NUMBER || process.env.HR_PHONE || undefined;
  return buildClarifyThenPortalFallback(url, hrPhone);
}
import { buildClarifyThenPortalFallback } from '@/lib/qa/support-response-builders';
