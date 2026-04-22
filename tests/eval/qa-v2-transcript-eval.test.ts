/**
 * qa-v2 eval suite — two-tier design.
 *
 * TIER 1 (runs in CI, no LLM): feeds all 143 eval-dataset.jsonl cases through
 * tryDeterministicIntent.  Cases where the deterministic engine returns a
 * result are checked against mustContain / mustNotContain.  Cases where it
 * returns null are routed to the LLM in production — those are tagged
 * "live-eval" and skipped here. Acceptance target: ≥ 90 % of deterministic
 * cases pass.
 *
 * TIER 2 (runs manually with RUN_LIVE_EVAL=1): multi-turn context-carryover
 * and LLM-path cases from qa-v2-transcript-dataset.ts, run against the full
 * runQaV2Engine.  Requires live Azure credentials.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { tryDeterministicIntent } from '@/lib/qa-v2/deterministic-intents';
import { checkMustContain, checkMustNotContain } from './metrics';
import type { Session } from '@/lib/rag/session-store';

const PORTAL = process.env.ENROLLMENT_PORTAL_URL ?? 'https://wd5.myworkday.com/amerivet/login.html';
const PHONE  = process.env.HR_PHONE_NUMBER ?? '888-217-4728';

// ─── Dataset loading ──────────────────────────────────────────────────────────

interface EvalCase {
  id: string;
  category: string;
  question: string;
  state?: string | null;
  noPricingMode?: boolean;
  mustContain?: string[];
  mustNotContain?: string[];
  must_contain?: string[];
  must_not_contain?: string[];
  expectedAnswer?: string;
}

const dataset: EvalCase[] = readFileSync(
  resolve(__dirname, 'eval-dataset.jsonl'), 'utf-8',
)
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as EvalCase);

function allMustContain(c: EvalCase): string[] {
  return [...new Set([...(c.mustContain ?? []), ...(c.must_contain ?? [])])];
}
function allMustNotContain(c: EvalCase): string[] {
  return [...new Set([...(c.mustNotContain ?? []), ...(c.must_not_contain ?? [])])];
}

function makeSession(c: EvalCase): Session {
  return {
    id: 'eval',
    turn: 1,
    hasCollectedName: true,
    disclaimerShown: true,
    userState: c.state ?? null,
    noPricingMode: c.noPricingMode ?? false,
    currentTopic: null,
    completedTopics: [],
    lastBotMessage: '',
    messages: [],
  } as unknown as Session;
}

// ─── TIER 1 — Deterministic gate ─────────────────────────────────────────────

describe('Eval suite — Tier 1: deterministic gate (CI-safe, no LLM)', () => {
  const deterministicResults: Array<{
    id: string; category: string; routed: 'deterministic' | 'llm-path';
    pass?: boolean; failedContain?: string[]; failedNotContain?: string[];
  }> = [];

  // Run all cases through tryDeterministicIntent. Only assert on cases where
  // it returns a result — those are fully deterministic and must pass.
  for (const c of dataset) {
    const mustContain    = allMustContain(c);
    const mustNotContain = allMustNotContain(c);

    it(`${c.id} [${c.category}]`, () => {
      const session = makeSession(c);
      const result = tryDeterministicIntent({
        query: c.question,
        session,
        detectedTopic: null,
        enrollmentPortalUrl: PORTAL,
        hrPhone: PHONE,
      });

      if (result === null) {
        // LLM-path — record for summary, do not fail.
        deterministicResults.push({ id: c.id, category: c.category, routed: 'llm-path' });
        return;
      }

      const containCheck    = checkMustContain(result.answer, mustContain);
      const notContainCheck = checkMustNotContain(result.answer, mustNotContain);

      deterministicResults.push({
        id: c.id,
        category: c.category,
        routed: 'deterministic',
        pass: containCheck.pass && notContainCheck.pass,
        failedContain: containCheck.failed,
        failedNotContain: notContainCheck.failed,
      });

      if (!containCheck.pass) {
        expect.soft(containCheck.failed, `${c.id}: missing required phrases`).toEqual([]);
      }
      if (!notContainCheck.pass) {
        expect.soft(notContainCheck.failed, `${c.id}: forbidden phrases found`).toEqual([]);
      }
    });
  }

  // ── Summary assertion ────────────────────────────────────────────────────
  it('deterministic cases meet ≥ 90 % pass rate', () => {
    const deterministic = deterministicResults.filter((r) => r.routed === 'deterministic');
    const llmPath       = deterministicResults.filter((r) => r.routed === 'llm-path');
    const passed        = deterministic.filter((r) => r.pass);
    const failed        = deterministic.filter((r) => !r.pass);

    const passRate = deterministic.length > 0
      ? passed.length / deterministic.length
      : 1;

    console.log('\n══════════════════════════════════════════════════');
    console.log('  EVAL SUITE — TIER 1 SUMMARY');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Total cases in dataset : ${deterministicResults.length}`);
    console.log(`  Deterministic (tested) : ${deterministic.length}`);
    console.log(`  LLM-path (live only)   : ${llmPath.length}`);
    console.log(`  Passed                 : ${passed.length}`);
    console.log(`  Failed                 : ${failed.length}`);
    console.log(`  Pass rate              : ${(passRate * 100).toFixed(1)} %`);
    console.log(`  Target                 : ≥ 90.0 %`);
    console.log(`  Result                 : ${passRate >= 0.9 ? '✅ PASS' : '❌ FAIL'}`);

    if (failed.length > 0) {
      console.log('\n  Failed cases:');
      for (const r of failed) {
        console.log(`    ${r.id} [${r.category}]`);
        if (r.failedContain?.length)    console.log(`      missing   : ${r.failedContain.join(', ')}`);
        if (r.failedNotContain?.length) console.log(`      forbidden : ${r.failedNotContain.join(', ')}`);
      }
    }

    const byCategory: Record<string, { total: number; pass: number }> = {};
    for (const r of deterministic) {
      byCategory[r.category] ??= { total: 0, pass: 0 };
      byCategory[r.category].total++;
      if (r.pass) byCategory[r.category].pass++;
    }
    if (Object.keys(byCategory).length > 0) {
      console.log('\n  By category (deterministic only):');
      for (const [cat, s] of Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total)) {
        const pct = ((s.pass / s.total) * 100).toFixed(0);
        console.log(`    ${cat.padEnd(32)} ${s.pass}/${s.total}  (${pct} %)`);
      }
    }
    console.log('══════════════════════════════════════════════════\n');

    expect(
      passRate,
      `Deterministic pass rate ${(passRate * 100).toFixed(1)}% is below the 90% threshold.\nFailed: ${failed.map((r) => r.id).join(', ')}`,
    ).toBeGreaterThanOrEqual(0.9);
  });
});

// ─── TIER 2 — Live LLM eval (skipped unless RUN_LIVE_EVAL=1) ─────────────────

const LIVE = process.env.RUN_LIVE_EVAL === '1';

describe.skipIf(!LIVE)('Eval suite — Tier 2: live LLM path (requires Azure creds)', () => {
  it('multi-turn context-carryover cases pass structural assertions', async () => {
    const { runQaV2Engine } = await import('@/lib/qa-v2/engine');
    const { qaV2TranscriptDataset } = await import('./qa-v2-transcript-dataset');

    let totalTurns  = 0;
    let passedTurns = 0;
    const failures: string[] = [];

    for (const testCase of qaV2TranscriptDataset) {
      const session = {
        step: 'active_chat',
        context: {},
        ...testCase.initialSession,
      } as unknown as Session;

      for (const [i, turn] of testCase.turns.entries()) {
        totalTurns++;
        const result = await runQaV2Engine({ query: turn.user, session });
        const contain    = checkMustContain(result.answer, turn.mustContain    ?? []);
        const notContain = checkMustNotContain(result.answer, turn.mustNotContain ?? []);

        if (contain.pass && notContain.pass) {
          passedTurns++;
        } else {
          failures.push(
            `${testCase.id} turn ${i + 1}: ` +
            (contain.failed.length    ? `missing [${contain.failed.join(', ')}]` : '') +
            (notContain.failed.length ? ` forbidden [${notContain.failed.join(', ')}]` : ''),
          );
        }
      }
    }

    const passRate = totalTurns > 0 ? passedTurns / totalTurns : 1;
    console.log(`\nLive eval: ${passedTurns}/${totalTurns} turns passed (${(passRate * 100).toFixed(1)}%)`);
    if (failures.length) console.log('Failures:\n' + failures.map((f) => `  ${f}`).join('\n'));

    expect(passRate, 'Live eval pass rate below 90%').toBeGreaterThanOrEqual(0.9);
  });
});
