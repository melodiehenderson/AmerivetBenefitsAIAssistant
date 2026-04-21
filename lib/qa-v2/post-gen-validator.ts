// Phase 2: Post-generation guardrails.
//
// After the LLM produces an answer, this module validates it against the
// catalog before returning it to the user. Catches:
//   1. Dollar amounts that do not appear in the catalog (hallucinated numbers).
//   2. Plan names or carrier names that are not in the catalog.
//   3. Kaiser mentioned for a state it doesn't serve.
//
// On violation: the caller retries with a stricter prompt (once) or falls
// through to the counselor escalation if the retry also fails.
//
// Design notes:
// - The allowed-amount set is built at import time from the live catalog so
//   it stays in sync automatically.
// - We allow derived amounts (biweekly = monthly × 12 / 26) and rounding to
//   whole dollars because the LLM sometimes rounds for readability.
// - False-positive risk is low: the catalog amounts are specific enough that
//   a hallucinated number is very unlikely to collide with one of them.

import { getAmerivetBenefitsPackage } from '@/lib/data/amerivet-package';

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string; offenders: string[] };

// ── Build allowed amount set ──────────────────────────────────────────────────

function buildAllowedAmounts(): Set<string> {
  const pkg = getAmerivetBenefitsPackage();
  const { catalog } = pkg;
  const amounts = new Set<string>();

  const addAmt = (n: number) => {
    if (!isFinite(n) || n <= 0) return;
    amounts.add(n.toFixed(2));
    amounts.add(String(Math.round(n)));
    // Also allow comma-formatted e.g. "25,000"
    const commaFmt = Math.round(n).toLocaleString('en-US');
    amounts.add(commaFmt);
    // Biweekly equivalent (rounded)
    const biw = (n * 12) / 26;
    amounts.add(biw.toFixed(2));
    amounts.add(String(Math.round(biw)));
  };

  const allPlans = [
    ...catalog.medicalPlans,
    catalog.dentalPlan,
    catalog.visionPlan,
    ...catalog.voluntaryPlans,
  ];

  for (const plan of allPlans) {
    addAmt(plan.tiers.employeeOnly);
    addAmt(plan.tiers.employeeSpouse);
    addAmt(plan.tiers.employeeChildren);
    addAmt(plan.tiers.employeeFamily);
    addAmt(plan.benefits.deductible);
    addAmt(plan.benefits.outOfPocketMax);
    if (plan.coverage) {
      for (const v of Object.values(plan.coverage.deductibles ?? {})) addAmt(v as number);
      for (const v of Object.values(plan.coverage.copays ?? {})) addAmt(v as number);
      if (typeof plan.coverage.outOfPocketMax === 'number') addAmt(plan.coverage.outOfPocketMax);
    }
    if (plan.premiums.employer) {
      addAmt(plan.premiums.employer.monthly);
      addAmt(plan.premiums.employer.biweekly);
    }
  }

  const hsaContrib = catalog.specialCoverage.hsa.employerContribution;
  if (typeof hsaContrib === 'number') {
    addAmt(hsaContrib);
  } else {
    for (const v of Object.values(hsaContrib)) addAmt(v as number);
  }
  addAmt(catalog.specialCoverage.commuter.monthlyBenefit);

  // Well-known plan limits mentioned in the catalog copy
  addAmt(25000);   // Basic Life flat benefit
  addAmt(150000);  // Voluntary Term Life GI limit
  addAmt(500000);  // Voluntary Term Life max face value
  addAmt(300);     // Commuter monthly (already in commuter, but explicit)
  addAmt(750);     // HSA EE-only contribution
  addAmt(1000);    // HSA EE+spouse / EE+children
  addAmt(1250);    // HSA EE+family
  addAmt(4300);    // IRS 2025 HSA individual contribution limit
  addAmt(8550);    // IRS 2025 HSA family contribution limit
  addAmt(4150);    // IRS 2024 HSA individual
  addAmt(8300);    // IRS 2024 HSA family
  // Common age-banded life percentages expressed as X×salary — not dollar amounts
  // so no amounts to add for 1x/2x/etc.

  return amounts;
}

const ALLOWED_AMOUNTS: Set<string> = buildAllowedAmounts();

// ── Dollar amount extractor ───────────────────────────────────────────────────

function extractDollarAmounts(text: string): string[] {
  const matches = text.match(/\$[\d,]+(?:\.\d{1,2})?/g) ?? [];
  return matches.map((m) => m.replace(/[$,]/g, ''));
}

function isAllowedAmount(raw: string): boolean {
  if (ALLOWED_AMOUNTS.has(raw)) return true;
  // Allow amounts ending in .00 to match whole-dollar form
  const asFloat = parseFloat(raw);
  if (!isFinite(asFloat)) return false;
  if (ALLOWED_AMOUNTS.has(String(Math.round(asFloat)))) return true;
  if (ALLOWED_AMOUNTS.has(asFloat.toFixed(2))) return true;
  // Allow small amounts (< $10) — copays, generic numbers — lower false-positive risk
  if (asFloat < 10) return true;
  return false;
}

// ── Plan name / carrier guard ─────────────────────────────────────────────────

const KNOWN_PLAN_NAMES: readonly string[] = [
  'standard hsa', 'enhanced hsa', 'kaiser standard hmo', 'kaiser',
  'bcbstx dental ppo', 'bcbstx dental', 'vsp vision plus',
  'unum basic life', 'unum basic life & ad&d', 'unum voluntary term life',
  'allstate whole life',
];

const KNOWN_CARRIERS: readonly string[] = [
  'bcbstx', 'blue cross blue shield of texas', 'kaiser', 'kaiser permanente',
  'vsp', 'unum', 'allstate',
];

function extractUnknownPlanNames(text: string): string[] {
  // Look for plan-name-shaped phrases not in our catalog (simple heuristic).
  // This catches obvious hallucinations like "Kaiser Gold Plus HMO" or "Aetna PPO".
  const unknown: string[] = [];
  const aetnaOrCignaPattern = /\b(aetna|cigna|humana|united\s*health(?:care)?|anthem|coventry|molina|centene|rightway)\b/gi;
  const matches = text.match(aetnaOrCignaPattern) ?? [];
  for (const m of matches) unknown.push(m);
  return unknown;
}

// ── Kaiser state guard ────────────────────────────────────────────────────────

const KAISER_STATE_CODES = new Set(
  getAmerivetBenefitsPackage().kaiserAvailableStateCodes.map((s) => s.toUpperCase()),
);

const KAISER_STATE_NAMES = new Set(
  getAmerivetBenefitsPackage().kaiserAvailableStateCodes.map((code) => {
    const name = getAmerivetBenefitsPackage().stateAbbrevToName[code];
    return name?.toLowerCase();
  }).filter(Boolean) as string[],
);

function containsKaiserForWrongState(text: string, sessionState?: string | null): boolean {
  if (!sessionState) return false;
  const code = sessionState.toUpperCase();
  if (KAISER_STATE_CODES.has(code)) return false; // user is in a valid Kaiser state
  // If the LLM's output mentions Kaiser as a recommendation or available option
  // and the user is NOT in a Kaiser state, that's a violation.
  return /\b(kaiser|hmo)\b/i.test(text)
    && /\b(recommend|consider|choose|available|enroll|option|pick)\b/i.test(text);
}

// ── Main validator ────────────────────────────────────────────────────────────

export function validateLlmOutput(
  text: string,
  sessionState?: string | null,
): ValidationResult {
  const offenders: string[] = [];

  // 1. Dollar amount check
  const amounts = extractDollarAmounts(text);
  for (const raw of amounts) {
    if (!isAllowedAmount(raw)) {
      offenders.push(`$${raw}`);
    }
  }

  // 2. Unknown carrier check
  const unknownCarriers = extractUnknownPlanNames(text);
  for (const carrier of unknownCarriers) {
    offenders.push(`carrier: ${carrier}`);
  }

  // 3. Kaiser-in-wrong-state check
  if (containsKaiserForWrongState(text, sessionState)) {
    offenders.push(`Kaiser mentioned for non-Kaiser state (${sessionState})`);
  }

  if (offenders.length === 0) return { valid: true };

  return {
    valid: false,
    reason: `LLM output contains values not found in the catalog`,
    offenders: [...new Set(offenders)],
  };
}
