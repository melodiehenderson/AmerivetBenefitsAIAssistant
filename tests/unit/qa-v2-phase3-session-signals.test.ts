// Phase 3: Tests for usage-signal capture (pregnancy, surgery, salary)
// and their presence in the LLM session facts.

import { describe, expect, it } from 'vitest';
import type { Session } from '@/lib/rag/session-store';

// We test the engine's signal extraction by calling runQaV2Engine and
// inspecting the mutated session, which is the ground truth.
// LLM passthrough is not needed; signals are captured before the LLM path.

// Pull the private helpers out by exercising the engine end-to-end with the
// kill switch on (LLM disabled) — the session mutation happens regardless.
import { vi } from 'vitest';

vi.mock('@/lib/azure/openai', () => ({
  azureOpenAIService: { generateChatCompletion: vi.fn() },
}));
vi.mock('@/lib/rag/hybrid-retrieval', () => ({
  hybridRetrieve: vi.fn(async () => ({
    chunks: [], method: 'hybrid', totalResults: 0, latencyMs: 0,
    scores: { rrf: [] }, gatePass: false,
  })),
}));

import { runQaV2Engine } from '@/lib/qa-v2/engine';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    step: 'active_chat',
    context: {},
    userName: 'Heather',
    hasCollectedName: true,
    userAge: 51,
    userState: 'ID',
    dataConfirmed: true,
    ...overrides,
  };
}

async function runWithKillSwitch(query: string, session: Session) {
  const original = process.env.QA_V2_LLM_PASSTHROUGH;
  process.env.QA_V2_LLM_PASSTHROUGH = '0';
  try {
    await runQaV2Engine({ query, session });
  } finally {
    if (original === undefined) delete process.env.QA_V2_LLM_PASSTHROUGH;
    else process.env.QA_V2_LLM_PASSTHROUGH = original;
  }
}

describe('Phase 3: usage signal capture', () => {
  describe('pregnancy detection', () => {
    it('captures pregnancy from "i will be having a baby this year"', async () => {
      const session = makeSession();
      await runWithKillSwitch("i'll be having a baby this year", session);
      expect(session.medicalNeeds).toContain('pregnancy/delivery');
      expect(session.lifeEvents).toContain('pregnancy');
    });

    it('captures pregnancy from "I\'m pregnant"', async () => {
      const session = makeSession();
      await runWithKillSwitch("I'm pregnant and want to know my options", session);
      expect(session.medicalNeeds).toContain('pregnancy/delivery');
    });

    it('captures pregnancy from "we\'re expecting"', async () => {
      const session = makeSession();
      await runWithKillSwitch("we're expecting a baby in March", session);
      expect(session.medicalNeeds).toContain('pregnancy/delivery');
    });

    it('captures from "maternity coverage"', async () => {
      const session = makeSession();
      await runWithKillSwitch('what about maternity coverage?', session);
      expect(session.medicalNeeds).toContain('pregnancy/delivery');
    });
  });

  describe('upcoming surgery detection', () => {
    it('captures surgery from "I need surgery"', async () => {
      const session = makeSession();
      await runWithKillSwitch('I need surgery later this year', session);
      expect(session.medicalNeeds).toContain('upcoming-surgery');
    });

    it('captures from "I\'m going to have a procedure"', async () => {
      const session = makeSession();
      await runWithKillSwitch("i'm going to have a procedure done in the fall", session);
      expect(session.medicalNeeds).toContain('upcoming-surgery');
    });

    it('captures from "knee surgery"', async () => {
      const session = makeSession();
      await runWithKillSwitch('my knee surgery is scheduled for next month', session);
      expect(session.medicalNeeds).toContain('upcoming-surgery');
    });

    it('does NOT capture surgery from unrelated mentions', async () => {
      const session = makeSession();
      await runWithKillSwitch('tell me about dental coverage', session);
      expect(session.medicalNeeds ?? []).not.toContain('upcoming-surgery');
    });
  });

  describe('salary capture', () => {
    it('captures salary from "my salary is $68,000"', async () => {
      const session = makeSession();
      await runWithKillSwitch('my salary is $68,000', session);
      expect(session.userSalary).toBe(68000);
    });

    it('captures salary from "I make $75000 a year"', async () => {
      const session = makeSession();
      await runWithKillSwitch('I make $75000 a year', session);
      expect(session.userSalary).toBe(75000);
    });

    it('captures salary from "i earn about $52,000"', async () => {
      const session = makeSession();
      await runWithKillSwitch('i earn about $52,000', session);
      expect(session.userSalary).toBe(52000);
    });

    it('does NOT capture salary from a generic number mention', async () => {
      const session = makeSession();
      await runWithKillSwitch('the deductible is $3500', session);
      expect(session.userSalary).toBeUndefined();
    });
  });

  describe('signals persist across subsequent turns', () => {
    it('pregnancy stays on session after topic changes', async () => {
      const session = makeSession();
      await runWithKillSwitch("i'll be having a baby this year — does that affect my plan?", session);
      expect(session.medicalNeeds).toContain('pregnancy/delivery');
      // Second turn with no pregnancy mention
      await runWithKillSwitch('tell me about dental', session);
      expect(session.medicalNeeds).toContain('pregnancy/delivery');
    });
  });
});
