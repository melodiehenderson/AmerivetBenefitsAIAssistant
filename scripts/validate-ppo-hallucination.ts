#!/usr/bin/env npx ts-node
/**
 * PPO Hallucination Validation Script
 * ====================================
 * Checks amerivet.ts catalog against route.ts outputs to identify
 * where a "PPO" medical plan hallucination could originate.
 *
 * Usage:  npx ts-node scripts/validate-ppo-hallucination.ts
 *
 * This script performs 5 checks:
 *   1. Catalog Integrity — No medical plan in amerivet.ts is named *PPO*
 *   2. System Prompt Audit — The system prompt does not imply a PPO medical plan
 *   3. Menu/UI Text Audit — ALL_BENEFITS_MENU doesn't list "PPO" as a plan type
 *   4. Alias Audit — pricing-utils.ts aliases don't silently map "ppo" to a real plan
 *   5. Carrier Lockdown — Carriers are strictly mapped (Allstate=Whole, Unum=Term, BCBSTX=Medical/Dental)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);
const ROOT = path.resolve(__dirname2, '..');
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

interface CheckResult {
  name: string;
  passed: boolean;
  details: string[];
  severity: 'error' | 'warning' | 'info';
}

const results: CheckResult[] = [];

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ============================================================================
// CHECK 1: CATALOG INTEGRITY — No medical plan should be named "PPO"
// ============================================================================
function checkCatalogIntegrity() {
  const src = readFile('lib/data/amerivet.ts');
  const details: string[] = [];
  let passed = true;

  // Extract all plan names from createPlan({ ... name: '...' })
  const planNameRegex = /name:\s*['"]([^'"]+)['"]/g;
  let match;
  const planNames: string[] = [];
  while ((match = planNameRegex.exec(src)) !== null) {
    planNames.push(match[1]);
  }

  // Extract all plan IDs
  const planIdRegex = /id:\s*['"]([^'"]+)['"]/g;
  const planIds: string[] = [];
  while ((match = planIdRegex.exec(src)) !== null) {
    planIds.push(match[1]);
  }

  // Check: Does any MEDICAL plan have "PPO" in its name?
  const medicalPlanSection = src.split('medicalPlans:')[1]?.split('dentalPlan:')[0] || '';
  const medPlanNameRegex = /name:\s*['"]([^'"]+)['"]/g;
  const medicalPlanNames: string[] = [];
  while ((match = medPlanNameRegex.exec(medicalPlanSection)) !== null) {
    medicalPlanNames.push(match[1]);
  }

  details.push(`Found ${planNames.length} total plans, ${medicalPlanNames.length} medical plans`);
  details.push(`Medical plans: ${medicalPlanNames.join(', ')}`);

  for (const name of medicalPlanNames) {
    if (/\bppo\b/i.test(name)) {
      passed = false;
      details.push(`${RED}FAIL: Medical plan "${name}" contains "PPO" in its name — this is a hallucination source!${RESET}`);
    }
  }

  // Check: Dental PPO is correctly labeled (this is the ONLY valid PPO plan)
  const dentalSection = src.split('dentalPlan:')[1]?.split('visionPlan:')[0] || '';
  if (/PPO/i.test(dentalSection)) {
    details.push(`${GREEN}OK: Dental plan correctly uses "PPO" (BCBSTX Dental PPO)${RESET}`);
  }

  // Check: Medical plan descriptions that mention "PPO" (network vs plan confusion)
  const descRegex = /description:\s*['"]([^'"]*ppo[^'"]*)['"]/gi;
  while ((match = descRegex.exec(medicalPlanSection)) !== null) {
    details.push(`${YELLOW}WARNING: Medical plan description mentions PPO: "${match[1]}"${RESET}`);
    details.push(`  → This is "PPO network" (correct), but may confuse LLM into thinking it's a PPO plan`);
  }

  // Check: Features mentioning PPO
  const featRegex = /['"]([^'"]*PPO[^'"]*)['"]/gi;
  while ((match = featRegex.exec(medicalPlanSection)) !== null) {
    if (!/description/i.test(src.slice(Math.max(0, match.index - 20), match.index))) {
      details.push(`${YELLOW}WARNING: Medical plan feature mentions PPO: "${match[1]}"${RESET}`);
    }
  }

  if (passed) {
    details.push(`${GREEN}PASS: No medical plan is named "PPO"${RESET}`);
  }

  results.push({ name: 'Catalog Integrity', passed, details, severity: passed ? 'info' : 'error' });
}

// ============================================================================
// CHECK 2: SYSTEM PROMPT AUDIT — Does buildSystemPrompt imply a PPO medical plan?
// ============================================================================
function checkSystemPrompt() {
  const src = readFile('app/api/qa/route.ts');
  const details: string[] = [];
  let passed = true;

  // Find the CARRIER LOCKDOWN section
  const carrierSection = src.match(/CARRIER LOCKDOWN[\s\S]*?(?=═{5,})/)?.[0] || '';

  // Check: Does the Medical line say "PPO" as if it's a plan type?
  const medicalLine = carrierSection.match(/Medical\s*:.*/)?.[0] || '';
  details.push(`Medical line in system prompt: "${medicalLine}"`);

  if (/\(PPO\b/.test(medicalLine) && !/PPO\s*\*?network/i.test(medicalLine)) {
    passed = false;
    details.push(`${RED}FAIL: Medical line implies "PPO" is a plan type, not a network${RESET}`);
  } else if (/PPO.*network/i.test(medicalLine)) {
    details.push(`${GREEN}OK: Medical line correctly identifies PPO as a network${RESET}`);
  }

  // Check: Does the prompt contain a PPO CLARIFICATION section?
  if (src.includes('PPO CLARIFICATION')) {
    details.push(`${GREEN}OK: PPO CLARIFICATION section present in system prompt${RESET}`);
  } else {
    passed = false;
    details.push(`${RED}FAIL: Missing PPO CLARIFICATION section — LLM has no guard against PPO hallucination${RESET}`);
  }

  // Check: Forbidden data section mentions "BCBSTX PPO"
  const forbiddenSection = src.match(/FORBIDDEN DATA[\s\S]*?(?=═{5,})/)?.[0] || '';
  if (/BCBSTX PPO/i.test(forbiddenSection)) {
    details.push(`${GREEN}OK: "BCBSTX PPO" explicitly listed in FORBIDDEN DATA${RESET}`);
  } else {
    details.push(`${YELLOW}WARNING: "BCBSTX PPO" not listed in FORBIDDEN DATA section${RESET}`);
  }

  results.push({ name: 'System Prompt Audit', passed, details, severity: passed ? 'info' : 'error' });
}

// ============================================================================
// CHECK 3: MENU/UI TEXT AUDIT — ALL_BENEFITS_MENU doesn't list PPO as a plan
// ============================================================================
function checkMenuText() {
  const src = readFile('app/api/qa/route.ts');
  const details: string[] = [];
  let passed = true;

  // Find ALL_BENEFITS_MENU
  const menuMatch = src.match(/ALL_BENEFITS_MENU\s*=\s*`([^`]*)`/s)?.[1] || '';
  details.push(`ALL_BENEFITS_MENU content: "${menuMatch.substring(0, 200)}..."`);

  // Check: does the Medical line in the menu list "PPO" as a standalone plan type?
  const medMenuLine = menuMatch.match(/Medical\s*\([^)]*\)/)?.[0] || '';
  if (/\(PPO,/i.test(medMenuLine)) {
    passed = false;
    details.push(`${RED}FAIL: Menu lists "PPO" as if it's a standalone medical plan type: "${medMenuLine}"${RESET}`);
  } else if (/Standard HSA|Enhanced HSA/i.test(medMenuLine)) {
    details.push(`${GREEN}OK: Menu correctly lists actual plan names (Standard HSA, Enhanced HSA)${RESET}`);
  }

  // Check: Does normalizeBenefitCategory map "ppo" to "Medical"? (This can cause false routing)
  const normFunc = src.match(/function normalizeBenefitCategory[\s\S]*?return keyword/)?.[0] || '';
  if (/ppo.*Medical/i.test(normFunc)) {
    details.push(`${YELLOW}WARNING: normalizeBenefitCategory maps "ppo" → "Medical" — may cause PPO-related queries to route to medical even though no PPO medical plan exists${RESET}`);
  }

  results.push({ name: 'Menu/UI Text Audit', passed, details, severity: passed ? 'info' : 'warning' });
}

// ============================================================================
// CHECK 4: ALIAS AUDIT — pricing-utils.ts PPO aliases
// ============================================================================
function checkPricingAliases() {
  const src = readFile('lib/rag/pricing-utils.ts');
  const details: string[] = [];
  let passed = true;

  // Find PLAN_ALIASES
  const aliasSection = src.match(/PLAN_ALIASES[\s\S]*?};/)?.[0] || '';

  // Extract all aliases that contain "ppo"
  const ppoAliases = aliasSection.match(/'[^']*ppo[^']*'\s*:\s*'[^']*'/gi) || [];
  details.push(`Found ${ppoAliases.length} PPO-related aliases in pricing-utils.ts:`);

  for (const alias of ppoAliases) {
    details.push(`  ${alias}`);
    // Check if alias maps "bcbstx ppo" or "ppo standard" to a real plan
    if (/bcbstx\s*ppo|ppo\s*standard/i.test(alias)) {
      details.push(`${YELLOW}  → WARNING: This silently converts a non-existent "BCBSTX PPO" to "${alias.split(':')[1]?.trim()}"${RESET}`);
      details.push(`    This means if any code asks for "BCBSTX PPO", it will silently return Standard HSA data`);
      details.push(`    instead of returning null/error — masking the hallucination.`);
    }
  }

  if (ppoAliases.length === 0) {
    details.push(`${GREEN}OK: No PPO aliases found — no silent plan mapping${RESET}`);
  } else {
    // Not a hard fail — the aliases exist as a safety net, but they can mask issues
    details.push(`${YELLOW}NOTE: PPO aliases exist as fallbacks. They prevent hard crashes but can mask hallucinations.${RESET}`);
  }

  results.push({ name: 'Pricing Alias Audit', passed, details, severity: 'warning' });
}

// ============================================================================
// CHECK 5: CARRIER INTEGRITY — Strict carrier-plan mapping
// ============================================================================
function checkCarrierIntegrity() {
  const src = readFile('lib/data/amerivet.ts');
  const details: string[] = [];
  let passed = true;

  // Expected: Allstate = Whole Life, UNUM = Basic Life + Voluntary Term Life, BCBSTX = Medical + Dental
  const carrierRules: Record<string, { allowed: string[]; planTypes: string[] }> = {
    'Allstate': { allowed: ['Whole Life', 'Critical Illness', 'Accident'], planTypes: ['voluntary'] },
    'Unum': { allowed: ['Basic Life', 'Voluntary Term Life', 'Disability'], planTypes: ['voluntary'] },
    'BCBSTX': { allowed: ['Standard HSA', 'Enhanced HSA', 'Dental PPO'], planTypes: ['medical', 'dental'] },
    'Kaiser': { allowed: ['Kaiser Standard HMO'], planTypes: ['medical'] },
    'VSP': { allowed: ['Vision Plus'], planTypes: ['vision'] },
  };

  // Parse all plans from catalog
  const planRegex = /createPlan\(\{[\s\S]*?name:\s*['"]([^'"]+)['"][\s\S]*?provider:\s*['"]([^'"]+)['"][\s\S]*?type:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = planRegex.exec(src)) !== null) {
    const [, planName, provider, planType] = match;
    details.push(`Plan: "${planName}" → Provider: ${provider}, Type: ${planType}`);

    const rule = carrierRules[provider];
    if (rule) {
      const nameOk = rule.allowed.some(a => planName.toLowerCase().includes(a.toLowerCase()));
      const typeOk = rule.planTypes.includes(planType);
      if (!nameOk && !typeOk) {
        passed = false;
        details.push(`${RED}  FAIL: ${provider} should only offer ${rule.allowed.join('/')} but has "${planName}" (${planType})${RESET}`);
      }
    }
  }

  // Check for any "PPO" medical plan
  const medPlanNames = src.match(/medicalPlans:[\s\S]*?dentalPlan:/)?.[0] || '';
  if (/name:\s*['"][^'"]*PPO[^'"]*['"]/i.test(medPlanNames)) {
    passed = false;
    details.push(`${RED}FAIL: A medical plan is named as a PPO plan — this is the hallucination source!${RESET}`);
  } else {
    details.push(`${GREEN}OK: No medical plan uses "PPO" in its name${RESET}`);
  }

  results.push({ name: 'Carrier Integrity', passed, details, severity: passed ? 'info' : 'error' });
}

// ============================================================================
// CHECK 6: ROUTE.TS INTERCEPT AUDIT — Does asksPPOPlan intercept exist?
// ============================================================================
function checkPPOIntercept() {
  const src = readFile('app/api/qa/route.ts');
  const details: string[] = [];
  let passed = true;

  // Check for PPO clarification intercept
  if (/asksPPOPlan/i.test(src)) {
    details.push(`${GREEN}OK: PPO plan clarification intercept exists${RESET}`);
  } else {
    passed = false;
    details.push(`${RED}FAIL: No PPO plan clarification intercept — user asking for "the PPO plan" will go to LLM and may hallucinate${RESET}`);
  }

  // Check for PPO hallucination post-processing guard
  if (/PPO_MEDICAL_HALLUCINATION|PPO.GUARD|ppo.*hallucination/i.test(src)) {
    details.push(`${GREEN}OK: PPO hallucination post-processing guard exists${RESET}`);
  } else {
    passed = false;
    details.push(`${RED}FAIL: No PPO hallucination post-processing guard — LLM can still output "BCBSTX PPO" unchecked${RESET}`);
  }

  // Check for carrier integrity post-processing
  if (/CARRIER.MISATTRIBUTION|carrier.*integrity/i.test(src)) {
    details.push(`${GREEN}OK: Carrier misattribution post-processing guard exists${RESET}`);
  } else {
    details.push(`${YELLOW}WARNING: No carrier misattribution post-processing — LLM may swap Allstate↔Unum${RESET}`);
  }

  // Check for no-pricing mode
  if (/noPricingMode|noPricing/i.test(src)) {
    details.push(`${GREEN}OK: No-pricing mode exists${RESET}`);
  } else {
    details.push(`${YELLOW}WARNING: No no-pricing mode — user cannot request "coverage only" responses${RESET}`);
  }

  results.push({ name: 'Route.ts Intercept Audit', passed, details, severity: passed ? 'info' : 'error' });
}

// ============================================================================
// TEXAS-SPECIFIC CHECK: What plans are available for TX?
// ============================================================================
function checkTexasPlans() {
  const src = readFile('lib/data/amerivet.ts');
  const details: string[] = [];
  let passed = true;

  // Texas is NOT in KAISER_STATES, so only nationwide plans are available
  details.push(`Texas (TX) plan availability check:`);
  details.push(`  Kaiser HMO: ${RED}NOT AVAILABLE${RESET} (CA/WA/OR only)`);

  // Check nationwide plans
  const nationwideMatch = src.match(/nationwide:\s*\[([^\]]+)\]/)?.[1] || '';
  const nationalPlanIds = nationwideMatch.match(/['"]([^'"]+)['"]/g)?.map(s => s.replace(/['"]/g, '')) || [];
  details.push(`  Nationwide plans available in TX: ${nationalPlanIds.join(', ')}`);

  // Verify: NO plan called "PPO" exists in the Texas lineup
  const hasPPOMedical = nationalPlanIds.some(id => /ppo/i.test(id) && !/dental/i.test(id));
  if (hasPPOMedical) {
    passed = false;
    details.push(`${RED}FAIL: A medical PPO plan ID exists in the nationwide list for Texas!${RESET}`);
  } else {
    details.push(`${GREEN}OK: No "PPO" medical plan in the Texas lineup. Available medical plans are HSA-based.${RESET}`);
  }

  details.push(`\n  CONCLUSION: For Texas users, the ONLY medical plans are:`);
  details.push(`    1. Standard HSA (BCBSTX) — HDHP with PPO *network*`);
  details.push(`    2. Enhanced HSA (BCBSTX) — HDHP with PPO *network*`);
  details.push(`  If the bot outputs "BCBSTX PPO" or "PPO plan" for Texas, it's a HALLUCINATION.`);

  results.push({ name: 'Texas Plan Audit', passed, details, severity: passed ? 'info' : 'error' });
}

// ============================================================================
// RUN ALL CHECKS
// ============================================================================
console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}  PPO HALLUCINATION VALIDATION REPORT${RESET}`);
console.log(`${BOLD}  Date: ${new Date().toISOString()}${RESET}`);
console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}\n`);

checkCatalogIntegrity();
checkSystemPrompt();
checkMenuText();
checkPricingAliases();
checkCarrierIntegrity();
checkPPOIntercept();
checkTexasPlans();

// ============================================================================
// REPORT
// ============================================================================
let totalPassed = 0;
let totalFailed = 0;

for (const r of results) {
  const icon = r.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(`${icon} ${BOLD}${r.name}${RESET}`);
  for (const d of r.details) {
    console.log(`  ${d}`);
  }
  console.log('');
  if (r.passed) totalPassed++;
  else totalFailed++;
}

console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
console.log(`  Results: ${GREEN}${totalPassed} passed${RESET}, ${totalFailed > 0 ? RED : GREEN}${totalFailed} failed${RESET}`);
console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}\n`);

if (totalFailed > 0) {
  console.log(`${RED}${BOLD}ACTION REQUIRED:${RESET} Fix the failing checks above to prevent PPO hallucinations.`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}ALL CHECKS PASSED${RESET} — PPO hallucination guards are in place.`);
  process.exit(0);
}
