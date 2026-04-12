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

  it('answers "why?" after a medical recommendation with a practical rationale', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
      messages: [
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'why?',
      session,
    });

    expect(result.answer).toContain('The reason I leaned Standard HSA');
    expect(result.answer).toContain('keeps more of the savings in your paycheck');
  });

  it('answers "is it worth the extra premium?" after a medical recommendation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
      messages: [
        { role: 'user', content: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?' },
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'is enhanced worth the extra premium?',
      session,
    });

    expect(result.answer).toContain('Whether the richer medical option is worth the extra premium');
    expect(result.answer).toContain('If usage is low, I would usually keep the cheaper option');
  });

  it('answers "what would you do?" after a medical recommendation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
      messages: [
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'what would you do?',
      session,
    });

    expect(result.answer).toContain('My practical take is that I would usually land on **Standard HSA**');
  });

  it('answers family-specific medical follow-ups after a recommendation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      messages: [
        { role: 'user', content: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?' },
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
    });

    const result = await runQaV2Engine({
      query: 'what about for my kids?',
      session,
    });

    expect(result.answer).toContain('thinking specifically about your kids');
    expect(result.answer).toContain('If your kids are generally healthy');
  });

  it('answers spouse-specific medical follow-ups after a recommendation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      messages: [
        { role: 'user', content: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?' },
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
    });

    const result = await runQaV2Engine({
      query: 'what about for my spouse?',
      session,
    });

    expect(result.answer).toContain('thinking specifically about your spouse');
    expect(result.answer).toContain('If your spouse is generally healthy');
  });

  it('answers broader household wording like "the kids" after a medical recommendation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      messages: [
        { role: 'user', content: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?' },
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
    });

    const result = await runQaV2Engine({
      query: 'what if we mostly care about the kids?',
      session,
    });

    expect(result.answer).toContain('thinking specifically about your kids');
  });

  it('treats "kids then?" as a family-specific medical follow-up', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      messages: [
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
    });

    const result = await runQaV2Engine({
      query: 'kids then?',
      session,
    });

    expect(result.answer).toContain('thinking specifically about your kids');
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

  it('treats family-oriented follow-ups as decision narrowing after general benefit guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    });

    await runQaV2Engine({
      query: 'please help me think through which one of these benefits is worth considering for my situation.',
      session,
    });

    const result = await runQaV2Engine({
      query: 'what about for our family?',
      session,
    });

    expect(result.answer).toContain('If protecting your family is the top priority');
    expect(result.answer).toContain('life insurance next');
  });

  it('treats cost-oriented wording as healthcare-cost narrowing after general benefit guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    });

    await runQaV2Engine({
      query: 'please help me think through which one of these benefits is worth considering for my situation.',
      session,
    });

    const result = await runQaV2Engine({
      query: 'we mostly care about cost',
      session,
    });

    expect(result.answer).toContain('If keeping healthcare costs down is the priority');
    expect(result.answer).toContain('Focus on medical first');
  });

  it('treats "routine stuff" as routine-care narrowing after general benefit guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    });

    await runQaV2Engine({
      query: 'please help me think through which one of these benefits is worth considering for my situation.',
      session,
    });

    const result = await runQaV2Engine({
      query: 'routine stuff',
      session,
    });

    expect(result.answer).toContain('If routine care is what matters most');
    expect(result.answer).toContain('Look at dental next');
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

  it('handles an affirmative supplemental comparison follow-up organically', async () => {
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

    await runQaV2Engine({
      query: 'yes, help me think through whether that is worth considering',
      session,
    });

    const result = await runQaV2Engine({
      query: "yes, i'd like that",
      session,
    });

    expect(result.answer).toContain('plain-language difference between Accident/AD&D and Critical Illness');
    expect(result.answer).toContain('injury-related events');
  });

  it('handles an affirmative life-versus-disability follow-up after family-protection guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    });

    await runQaV2Engine({
      query: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
      session,
    });

    const result = await runQaV2Engine({
      query: "yes, i'd like that",
      session,
    });

    expect(result.answer).toContain('simplest way to separate life insurance from disability');
    expect(result.answer).toContain('if you die');
  });

  it('handles an affirmative dental-versus-vision follow-up after routine-care narrowing', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    });

    await runQaV2Engine({
      query: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
      session,
    });

    await runQaV2Engine({
      query: 'routine care',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('deciding between dental and vision as the next add-on');
    expect(result.answer).toContain('Choose dental first');
  });

  it('supports a bare "let’s do that" after dental suggests vision next', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
    });

    await runQaV2Engine({
      query: 'dental please',
      session,
    });

    const result = await runQaV2Engine({
      query: "ok let's do that",
      session,
    });

    expect(result.answer).toContain('Vision coverage: **VSP Vision Plus**');
  });

  it('supports a bare "do that" after healthcare-cost guidance offers the medical tradeoff', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'CA',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      messages: [
        { role: 'user', content: 'My household is family4+, usage level is high, and I prefer kaiser network.' },
      ],
    });

    await runQaV2Engine({
      query: 'healthcare costs',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('Projected Healthcare Costs for Employee + Family coverage');
  });

  it('handles "what would you do?" after accident-versus-critical comparison', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'Here is the plain-language difference between Accident/AD&D and Critical Illness:',
    });

    const result = await runQaV2Engine({
      query: 'which one would you pick?',
      session,
    });

    expect(result.answer).toContain('My practical take is that I would usually choose Accident/AD&D');
    expect(result.answer).toContain('Critical Illness first');
  });

  it('treats a bare affirmative after accident-versus-critical comparison as a request to narrow it down', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'Here is the plain-language difference between Accident/AD&D and Critical Illness:',
    });

    const result = await runQaV2Engine({
      query: "yes, i'd like that",
      session,
    });

    expect(result.answer).toContain('My practical take is that I would usually choose Accident/AD&D');
  });

  it('handles family-specific follow-ups after life-versus-disability comparison', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Here is the simplest way to separate life insurance from disability:',
    });

    const result = await runQaV2Engine({
      query: 'what about for my kids?',
      session,
    });

    expect(result.answer).toContain('thinking about your kids first');
    expect(result.answer).toContain('disability and life before I worry about smaller supplemental add-ons');
  });

  it('handles spouse-specific follow-ups after life-versus-disability comparison', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Here is the simplest way to separate life insurance from disability:',
    });

    const result = await runQaV2Engine({
      query: 'what about for my spouse?',
      session,
    });

    expect(result.answer).toContain('thinking about your spouse or partner first');
    expect(result.answer).toContain('if your spouse depends on your income');
  });

  it('answers "why not disability first?" after life-versus-disability comparison', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Here is the simplest way to separate life insurance from disability:',
    });

    const result = await runQaV2Engine({
      query: 'why not disability first?',
      session,
    });

    expect(result.answer).toContain('Disability often can come first');
    expect(result.answer).toContain('paycheck');
  });

  it('handles family-specific follow-ups after dental-versus-vision comparison', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Dental',
      lastBotMessage: 'If you are deciding between dental and vision as the next add-on, I would usually frame it this way:',
    });

    const result = await runQaV2Engine({
      query: 'what about for my kids?',
      session,
    });

    expect(result.answer).toContain('thinking about your kids specifically');
    expect(result.answer).toContain('dental usually becomes the first add-on');
  });

  it('treats "why would i pick that?" after dental-versus-vision comparison as a practical take request', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Dental',
      lastBotMessage: 'If you are deciding between dental and vision as the next add-on, I would usually frame it this way:',
    });

    const result = await runQaV2Engine({
      query: 'why would i pick that?',
      session,
    });

    expect(result.answer).toContain('My practical take is to choose dental first');
  });

  it('answers "why not vision first?" after dental-versus-vision comparison', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Dental',
      lastBotMessage: 'If you are deciding between dental and vision as the next add-on, I would usually frame it this way:',
    });

    const result = await runQaV2Engine({
      query: 'why not vision first?',
      session,
    });

    expect(result.answer).toContain('Vision can absolutely come first');
    expect(result.answer).toContain('vision use is already obvious');
  });

  it('treats "why that one over the other?" after a medical recommendation as a practical take request', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
      messages: [
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'why that one over the other?',
      session,
    });

    expect(result.answer).toContain('My practical take is that I would usually land on **Standard HSA**');
  });

  it('treats "the cheaper one?" after a medical recommendation as a lower-cost clarification', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
      messages: [
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'the cheaper one?',
      session,
    });

    expect(result.answer).toContain('cheaper option');
    expect(result.answer).toContain('**Standard HSA**');
  });

  it('treats "that one?" after a medical recommendation as a practical take request', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
      messages: [
        { role: 'assistant', content: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'that one?',
      session,
    });

    expect(result.answer).toContain('My practical take is that I would usually land on **Standard HSA**');
  });

  it('narrows accident-versus-critical comparison when the user says injury risk', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'Here is the plain-language difference between Accident/AD&D and Critical Illness:',
    });

    const result = await runQaV2Engine({
      query: 'more injury risk',
      session,
    });

    expect(result.answer).toContain('lean Accident/AD&D first');
    expect(result.answer).toContain('active');
  });

  it('narrows accident-versus-critical comparison when the user says diagnosis risk', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'Here is the plain-language difference between Accident/AD&D and Critical Illness:',
    });

    const result = await runQaV2Engine({
      query: 'more diagnosis risk',
      session,
    });

    expect(result.answer).toContain('lean Critical Illness first');
    expect(result.answer).toContain('serious diagnosis');
  });

  it('answers "why not critical illness first?" after accident-versus-critical comparison', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'Here is the plain-language difference between Accident/AD&D and Critical Illness:',
    });

    const result = await runQaV2Engine({
      query: 'why not critical illness first?',
      session,
    });

    expect(result.answer).toContain('Critical Illness can absolutely come first');
    expect(result.answer).toContain('diagnosis risk');
  });

  it('narrows HSA-versus-FSA fit when the user says long-term savings', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      pendingGuidancePrompt: 'hsa_vs_fsa',
      pendingGuidanceTopic: 'HSA/FSA',
    });

    const result = await runQaV2Engine({
      query: 'long-term savings',
      session,
    });

    expect(result.answer).toContain('HSA is usually the cleaner fit');
    expect(result.answer).toContain('roll over year to year');
  });

  it('narrows HSA-versus-FSA fit when the user says they will use it this year', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      pendingGuidancePrompt: 'hsa_vs_fsa',
      pendingGuidanceTopic: 'HSA/FSA',
    });

    const result = await runQaV2Engine({
      query: 'we would use it this year',
      session,
    });

    expect(result.answer).toContain('FSA is usually the cleaner fit');
    expect(result.answer).toContain('current plan year');
  });

  it('supports a follow-up fit answer after the full HSA-versus-FSA guidance has already been shown', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    });

    const result = await runQaV2Engine({
      query: 'use it this year',
      session,
    });

    expect(result.answer).toContain('FSA is usually the cleaner fit');
    expect(result.answer).toContain('current plan year');
  });

  it('compares dental versus vision in context instead of just pivoting to vision', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Dental',
    });

    const result = await runQaV2Engine({
      query: 'is that more important than vision?',
      session,
    });

    expect(result.answer).toContain('deciding between dental and vision as the next add-on');
    expect(result.answer).not.toContain('Vision coverage: **VSP Vision Plus**');
  });

  it('compares life versus disability in context instead of pivoting to disability', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    });

    const result = await runQaV2Engine({
      query: 'is that more important than disability?',
      session,
    });

    expect(result.answer).toContain('simplest way to separate life insurance from disability');
    expect(result.answer).not.toContain('Disability coverage');
  });

  it('treats "usage level is high" as high usage in cost modeling', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'CA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
    });

    const result = await runQaV2Engine({
      query: 'I actually live in CA. Help me calculate healthcare costs for next year. My household is family4+, usage level is high, and I prefer kaiser network. Please recommend plans and estimate costs.',
      session,
    });

    expect(result.answer).toContain('high usage');
  });

  it('uses a topic-aware fallback instead of a full generic menu when already in dental', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Dental',
    });

    const result = await runQaV2Engine({
      query: 'hmm maybe?',
      session,
    });

    expect(result.answer).toContain('We can stay with dental');
    expect(result.answer).not.toContain('medical, dental, vision, life, disability');
  });
});
