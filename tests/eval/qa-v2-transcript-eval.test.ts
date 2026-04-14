import { describe, expect, it } from 'vitest';

import type { Session } from '@/lib/rag/session-store';
import { runQaV2Engine } from '@/lib/qa-v2/engine';
import { checkMustContain, checkMustNotContain } from './metrics';
import { qaV2TranscriptDataset } from './qa-v2-transcript-dataset';

function makeSession(initial: Record<string, unknown>): Session {
  return {
    step: 'active_chat',
    context: {},
    ...(initial as Partial<Session>),
  };
}

describe('qa-v2 transcript eval', () => {
  it('meets >= 90% transcript pass rate across current multi-turn v2 cases', async () => {
    let totalTurns = 0;
    let passedTurns = 0;
    const failed: Array<{ id: string; turn: number; missing: string[]; forbidden: string[] }> = [];

    for (const testCase of qaV2TranscriptDataset) {
      const session = makeSession(testCase.initialSession);

      for (const [index, turn] of testCase.turns.entries()) {
        totalTurns += 1;
        const result = await runQaV2Engine({ query: turn.user, session });
        const contain = checkMustContain(result.answer, turn.mustContain || []);
        const notContain = checkMustNotContain(result.answer, turn.mustNotContain || []);

        if (contain.pass && notContain.pass) {
          passedTurns += 1;
        } else {
          failed.push({
            id: testCase.id,
            turn: index + 1,
            missing: contain.failed,
            forbidden: notContain.failed,
          });
        }
      }
    }

    const passRate = totalTurns > 0 ? passedTurns / totalTurns : 0;

    console.info(
      `[QA-V2-TRANSCRIPT-EVAL] ${JSON.stringify({
        cases: qaV2TranscriptDataset.length,
        totalTurns,
        passedTurns,
        passRate: Number(passRate.toFixed(4)),
        failed,
      })}`,
    );

    expect(passRate).toBeGreaterThanOrEqual(0.9);
  });
});
