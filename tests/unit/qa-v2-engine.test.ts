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

  it('does not treat ordinary words like "in" or "me" as state codes in later turns', async () => {
    const session = makeSession({ step: 'active_chat', userName: 'Sarah', hasCollectedName: true, userAge: 45, userState: 'GA', dataConfirmed: true });

    const benefits = await runQaV2Engine({
      query: 'what are all the benefits i have access to?',
      session,
    });

    expect(benefits.answer).toContain('45 in GA');
    expect(benefits.answer).not.toContain('45 in ME');

    const stateMention = await runQaV2Engine({
      query: "i'm in GA",
      session,
    });

    expect(stateMention.answer).not.toContain('IN');
  });

  it('handles "yes, please compare" after a medical compare offer', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      lastBotMessage: 'If you want, I can compare the likely total annual cost for Standard HSA versus Enhanced HSA based on your expected usage.',
      messages: [
        { role: 'user', content: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?' },
        { role: 'assistant', content: 'If you want, I can compare the likely total annual cost for Standard HSA versus Enhanced HSA based on your expected usage.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'yes, please compare',
      session,
    });

    expect(result.answer).toContain('Projected Healthcare Costs for Employee + Family coverage');
  });

  it('explains orthodontia rider as a dental follow-up instead of falling back', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Dental',
      completedTopics: ['Dental'],
    });

    const result = await runQaV2Engine({
      query: "what's an orthodontia rider?",
      session,
    });

    expect(result.answer).toContain('orthodontia rider means');
    expect(result.answer).toContain('braces');
  });

  it('navigates focused decision-guidance follow-ups without falling back', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    });

    const first = await runQaV2Engine({
      query: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
      session,
    });

    expect(first.answer).toContain('protecting your family');
    expect(first.answer).toContain('life insurance next');

    const second = await runQaV2Engine({
      query: 'routine care',
      session,
    });

    expect(second.answer).toContain('If routine care is what matters most');
    expect(second.answer).not.toContain('Tell me which area you want to focus on next');
  });

  it('explains braces when it proactively offered that dental follow-up', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Dental',
      completedTopics: ['Dental'],
    });

    await runQaV2Engine({
      query: "what's an orthodontia rider?",
      session,
    });

    const braces = await runQaV2Engine({
      query: 'yes please - show me what that means for braces',
      session,
    });

    expect(braces.answer).toContain('For braces, the practical question');
    expect(braces.answer).toContain('orthodontia copay is $500');
  });

  it('parses "ok - i\'m 42 in OR" as Oregon, not Indiana', async () => {
    const session = makeSession({ step: 'start', userName: 'Rhonda', hasCollectedName: true });

    await runQaV2Engine({
      query: 'tell me about my medical options please',
      session,
    });

    const result = await runQaV2Engine({
      query: "ok - i'm 42 in OR",
      session,
    });

    expect(result.answer).toContain('42 in OR');
    expect(result.answer).not.toContain('42 in IN');
  });

  it('preserves cost-model intent when a state correction is included in the same message', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
    });

    const result = await runQaV2Engine({
      query: 'I actually live in OR. Help me calculate healthcare costs for next year. My household is family4+, usage level is high, and I prefer kaiser network. Please recommend plans and estimate costs.',
      session,
    });

    expect(result.answer).toContain('updated cost view');
    expect(result.answer).toContain('Projected Healthcare Costs for Employee + Family coverage in Oregon');
    expect(result.answer).not.toContain('updated medical view');
  });

  it('cashes the proactive HSA-versus-FSA follow-up instead of falling back', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
    });

    await runQaV2Engine({
      query: 'can you tell me about hsa/fsa?',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, tell me when an hsa is the better fit',
      session,
    });

    expect(result.answer).toContain('simplest way to think about HSA versus FSA fit');
    expect(result.answer).toContain('cannot make full HSA contributions');
  });

  it('cashes the proactive supplemental-worth-it follow-up instead of falling back', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    });

    await runQaV2Engine({
      query: 'what is accident/ad&d?',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, help me think through whether that is worth considering',
      session,
    });

    expect(result.answer).toContain('usually worth considering');
    expect(result.answer).toContain('another layer beyond the core medical plan');
  });
});
