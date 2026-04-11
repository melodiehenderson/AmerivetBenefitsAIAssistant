import { describe, expect, it } from 'vitest';

import type { Session } from '@/lib/rag/session-store';
import { runQaV2Engine } from '@/lib/qa-v2/engine';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    step: 'start',
    context: {},
    ...overrides,
  };
}

describe('qa-v2 engine', () => {
  it('asks for age and state when a topic is requested before demographics are complete', async () => {
    const result = await runQaV2Engine({
      query: 'medical please',
      session: makeSession({ userName: 'Sarah', hasCollectedName: true }),
    });

    expect(result.answer).toContain('age and state');
  });

  it('routes explicit cost-model prompts into medical even without the word medical', async () => {
    const session = makeSession({ step: 'active_chat', userName: 'Sarah', hasCollectedName: true, userAge: 35, userState: 'FL', dataConfirmed: true });
    const result = await runQaV2Engine({
      query: 'Help me calculate healthcare costs for next year. My household is family4+, usage level is high, and I prefer kaiser network. Please recommend plans and estimate costs.',
      session,
    });

    expect(result.answer).toContain('Projected Healthcare Costs for Employee + Family coverage');
    expect(result.answer).toContain('not available');
  });

  it('explains hsa/fsa questions deterministically', async () => {
    const session = makeSession({ step: 'active_chat', userName: 'Sarah', hasCollectedName: true, userAge: 35, userState: 'FL', dataConfirmed: true });
    const result = await runQaV2Engine({
      query: 'can you tell me about hsa/fsa?',
      session,
    });

    expect(result.answer).toContain('Health Savings Account');
    expect(result.answer).toContain('Flexible Spending Account');
  });

  it('handles chatty life pivots and state corrections without dropping continuity', async () => {
    const session = makeSession({ step: 'active_chat', userName: 'Sarah', hasCollectedName: true, userAge: 35, userState: 'GA', dataConfirmed: true, currentTopic: 'Vision', completedTopics: ['Dental', 'Vision'] });
    const life = await runQaV2Engine({
      query: 'oh! okay - yeah - life insurance info',
      session,
    });

    expect(life.answer).toContain('Life insurance options');

    const correction = await runQaV2Engine({
      query: "actually, i'm in FL",
      session,
    });

    expect(correction.answer).toContain('updated your state to FL');
    expect(correction.answer).toContain('life insurance');
  });
});
