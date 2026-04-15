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

  it('accepts a plain state abbreviation after age is already known during onboarding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Matthew',
      hasCollectedName: true,
      userAge: 39,
      askedForDemographics: true,
    });

    const result = await runQaV2Engine({
      query: 'Co',
      session,
    });

    expect(result.answer).toContain('Perfect! 39 in CO.');
    expect(result.answer).not.toContain('I just need your state');
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

  it('defines coverage tiers directly when asked inside medical', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: "what's a coverage tier?",
      session,
    });

    expect(result.answer).toContain('A coverage tier is just the level of people you are enrolling');
    expect(result.answer).toContain('Employee + Spouse');
  });

  it('answers medical tradeoff comparisons from structured source material', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: "okay, let's compare the plan tradeoffs",
      session,
    });

    expect(result.answer).toContain('Here is the practical tradeoff across AmeriVet\'s medical options');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('Enhanced HSA');
  });

  it('treats broad affirmations after medical tradeoff prompts as a real compare request', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'We can stay with medical. The most useful next step is usually one of these: compare the plan tradeoff, estimate likely costs, or talk through why one option fits better for your situation.',
    });

    const result = await runQaV2Engine({
      query: "great, let's do this",
      session,
    });

    expect(result.answer).toContain('Here is the practical tradeoff across AmeriVet');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers plan copay questions directly from the medical summaries', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: 'what are the copays for the standard plan?',
      session,
    });

    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('primary care');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('defines copay directly inside medical instead of looping to generic guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: "what's a copay?",
      session,
    });

    expect(result.answer).toContain('A copay is the flat dollar amount');
    expect(result.answer).toContain("AmeriVet's package");
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('defines deductible directly inside medical instead of looping to generic guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: "what's a deductible?",
      session,
    });

    expect(result.answer).toContain('A deductible is the amount you usually pay out of pocket');
    expect(result.answer).toContain("AmeriVet's medical plans");
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('defines coinsurance directly inside medical instead of looping to generic guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: "what's coinsurance?",
      session,
    });

    expect(result.answer).toContain('Coinsurance is the percentage');
    expect(result.answer).toContain("AmeriVet's package");
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('defines out-of-pocket max directly inside medical instead of looping to generic guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: "what's an out-of-pocket max?",
      session,
    });

    expect(result.answer).toContain('The out-of-pocket max is the ceiling');
    expect(result.answer).toContain("AmeriVet's package");
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('defines everyday medical literacy terms like primary care and specialist directly inside medical', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const primaryCare = await runQaV2Engine({
      query: 'what does primary care mean?',
      session,
    });
    expect(primaryCare.answer).toContain('Primary care usually means your everyday doctor visit layer');
    expect(primaryCare.answer).not.toContain('We can stay with medical');

    const specialist = await runQaV2Engine({
      query: 'what does specialist mean?',
      session,
    });
    expect(specialist.answer).toContain('A specialist visit means care from a doctor focused on a specific area');
    expect(specialist.answer).not.toContain('We can stay with medical');
  });

  it('answers therapist-specialist questions directly inside medical instead of drifting into scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: 'is a therapist a specialist?',
      session,
    });

    expect(result.answer).toContain('Usually yes');
    expect(result.answer).toContain('specialist');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers therapy-cost questions as grounded medical comparisons instead of generic menus', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
    });

    const result = await runQaV2Engine({
      query: 'i see a therapist 2x monthly, what will that cost?',
      session,
    });

    expect(result.answer).toContain('Therapy / specialist care');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('Enhanced HSA');
    expect(result.answer).toContain('Enhanced HSA');
    expect(result.answer).toContain('recurring part of your year');
    expect(result.answer).not.toContain('A useful next medical step is usually one of these');
  });

  it('defines urgent care, er, and prescription coverage terms directly inside medical', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const urgentCare = await runQaV2Engine({
      query: 'what does urgent care mean?',
      session,
    });
    expect(urgentCare.answer).toContain('Urgent care is the in-between level');
    expect(urgentCare.answer).not.toContain('We can stay with medical');

    const er = await runQaV2Engine({
      query: 'what is an er?',
      session,
    });
    expect(er.answer).toContain('Emergency room coverage matters for true emergencies');
    expect(er.answer).not.toContain('We can stay with medical');

    const rx = await runQaV2Engine({
      query: 'what does prescription coverage mean?',
      session,
    });
    expect(rx.answer).toContain('Prescription coverage is the part of the medical plan');
    expect(rx.answer).toContain('do not want to guess');
    expect(rx.answer).not.toContain('We can stay with medical');
  });

  it('answers maternity questions across plans from structured source material', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: 'what coverage will we get for maternity coverage on the 2 different plans?',
      session,
    });

    expect(result.answer).toContain('Here is the maternity coverage comparison');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('Enhanced HSA');
  });

  it('infers medical detail from maternity questions even when the user does not restate medical', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    });

    const result = await runQaV2Engine({
      query: 'my wife is pregnant',
      session,
    });

    expect(result.answer).toContain('Here is the maternity coverage comparison');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('Enhanced HSA');
  });

  it('answers practical single-plan cost questions from the medical summaries', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: 'what are my costs if i use the standard plan?',
      session,
    });

    expect(result.answer).toContain('Standard HSA practical cost summary');
    expect(result.answer).toContain('Deductible');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers prescription questions from the current medical summaries instead of falling back', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: 'what about prescriptions on the standard plan?',
      session,
    });

    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('do not want to guess');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers in-network versus out-of-network questions from the current medical summaries', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: 'what is the in-network versus out-of-network difference on these plans?',
      session,
    });

    expect(result.answer).toContain('in-network');
    expect(result.answer).toContain('out-of-network');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers direct family-plan recommendation questions instead of looping back to medical scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: "which plan is best for my family if we're pretty healthy but we're also having a baby?",
      session,
    });

    expect(result.answer).toContain('My recommendation');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers broad plan-coverage questions from structured AmeriVet source material', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
    });

    const result = await runQaV2Engine({
      query: 'what does the standard plan cover?',
      session,
    });

    expect(result.answer).toContain('Standard HSA coverage snapshot');
    expect(result.answer).toContain('Employee + Spouse premium');
    expect(result.answer).toContain('Source-backed plan features');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers virtual-visit questions from the structured medical source data', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: 'what about virtual visits on the standard plan?',
      session,
    });

    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('virtual visits');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers overview-style "other coverage" questions with the AmeriVet benefits menu', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    });

    const result = await runQaV2Engine({
      query: 'what are the other types of coverage available?',
      session,
    });

    expect(result.answer).toContain('Here are the other benefit areas available to you as an AmeriVet employee');
    expect(result.answer).toContain('Dental');
    expect(result.answer).toContain('Vision');
    expect(result.answer).not.toContain('Perfect!');
  });

  it('answers benefits-overview questions even mid-medical conversation instead of looping to medical fallback', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Projected Healthcare Costs for Employee + Spouse coverage in Iowa (low usage):',
    });

    const result = await runQaV2Engine({
      query: 'what are the other types of coverage available?',
      session,
    });

    expect(result.answer).toContain('Here are the other benefit areas available to you as an AmeriVet employee');
    expect(result.answer).toContain('Accident/AD&D');
    expect(result.answer).not.toContain('We can stay with medical');
    expect(result.answer).not.toContain('Perfect!');
  });

  it('gives direct precedence to an explicit supplemental recommendation question over stale medical context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'My recommendation: Standard HSA.',
      coverageTierLock: 'Employee + Family',
    });

    const result = await runQaV2Engine({
      query: "should i get disability if i'm the sole breadwinner?",
      session,
    });

    expect(result.answer).toContain('disability');
    expect(result.answer).toContain('paycheck');
    expect(result.answer).not.toContain('Recommendation for Employee + Family coverage');
  });

  it('answers lowest-out-of-pocket follow-ups directly from household medical context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      messages: [
        { role: 'user', content: 'my wife is pregnant' },
        { role: 'assistant', content: 'Here is the maternity coverage comparison across the available medical plans:' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'what gives us the lowest out of pocket?',
      session,
    });

    expect(result.answer).toContain('Kaiser Standard HMO');
    expect(result.answer).toContain('lowest likely maternity-related out-of-pocket exposure');
    expect(result.answer).toContain('Enhanced HSA');
    expect(result.answer).not.toContain('Quick clarifier');
  });

  it('keeps chosen-plan direction attached when advising on critical illness', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      selectedPlan: 'Standard HSA',
    });

    const result = await runQaV2Engine({
      query: "we'll probably go with standard hsa, but is critical illness worth it for my family?",
      session,
    });

    expect(result.answer).toContain('critical illness');
    expect(result.answer).toContain('not yet');
    expect(result.answer).not.toContain('ask that one a little more specifically');
  });

  it('answers HSA/FSA practical-fit questions directly instead of falling back to a broad overview', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
    });

    const result = await runQaV2Engine({
      query: 'which one is better if i want to spend the money this year?',
      session,
    });

    expect(result.answer).toContain('FSA is usually the cleaner fit');
    expect(result.answer).not.toContain('I can help with hsa/fsa');
  });

  it('uses a tighter move-on answer after supplemental topics instead of generic fallback guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
    });

    const result = await runQaV2Engine({
      query: "what's next?",
      session,
    });

    expect(result.answer).toContain('accident coverage');
    expect(result.answer).not.toContain('optional supplemental coverage');
  });

  it('uses package guidance to point a settled medical choice toward the matching tax-account decision', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      selectedPlan: 'Enhanced HSA',
    });

    const result = await runQaV2Engine({
      query: 'what else should i consider?',
      session,
    });

    expect(result.answer).toContain('Because you are leaning toward **Enhanced HSA**');
    expect(result.answer).toContain('HSA/FSA');
    expect(result.answer).not.toContain('dental/vision if you want to round out routine care coverage');
  });

  it('keeps routine-care next steps in play after family medical pricing instead of jumping straight to life insurance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Medical plan options (Employee + Child(ren)):',
    });

    const result = await runQaV2Engine({
      query: 'what else should i consider?',
      session,
    });

    expect(result.answer).toContain('split the next step after medical into two lanes');
    expect(result.answer).toContain('**dental**');
    expect(result.answer).toContain('**life insurance**');
    expect(result.answer).toContain('default nudge here is usually **dental first**');
    expect(result.answer).toContain('take you straight into **dental** next');
    expect(result.answer).not.toContain('the next most useful step after medical is usually **life insurance**');
  });

  it('uses package guidance to move routine-care-complete households toward protection benefits', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Enhanced HSA',
    });

    const result = await runQaV2Engine({
      query: 'what should i look at next?',
      session,
    });

    expect(result.answer).toContain('routine care questions look more settled');
    expect(result.answer).toContain('life insurance');
    expect(result.answer).toContain('take you straight into **life insurance** next');
    expect(result.answer).not.toContain('dental is the natural companion');
  });

  it('uses package guidance to move family HSA/FSA follow-ups toward protection instead of looping back to medical', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 35,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      completedTopics: ['Medical', 'HSA/FSA'],
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Standard HSA',
    });

    const result = await runQaV2Engine({
      query: "what's next?",
      session,
    });

    expect(result.answer).toContain('life insurance');
    expect(result.answer).toContain('household protection is usually the bigger remaining decision');
    expect(result.answer).not.toContain('Going back to your medical choice');
  });

  it('does not sound like re-onboarding when benefits-overview questions are asked after demographics are already known', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      lastBotMessage: 'Here is the maternity coverage comparison across the available medical plans:',
    });

    const result = await runQaV2Engine({
      query: 'what are the other types of coverage available?',
      session,
    });

    expect(result.answer).toContain('Here are the other benefit areas available to you as an AmeriVet employee');
    expect(result.answer).not.toContain('Perfect! 27 in CT.');
  });

  it('keeps benefits-overview questions contextual after a maternity answer instead of sounding like a reset', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Recommendation: If you are planning a pregnancy, consider plans with lower deductibles and out-of-pocket maximums, even if premiums are higher.',
    });

    const result = await runQaV2Engine({
      query: 'what are the other types of coverage available?',
      session,
    });

    expect(result.answer).toContain('Here are the other benefit areas available to you as an AmeriVet employee');
    expect(result.answer).not.toContain('Perfect! 27 in CT.');
  });

  it('answers coverage-tier questions directly even after a generic medical compare prompt', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Medical plan options (Employee Only):\n\nWant to compare plans or switch coverage tiers?',
    });

    const result = await runQaV2Engine({
      query: "what's a coverage tier?",
      session,
    });

    expect(result.answer).toContain('A coverage tier is just the level of people you are enrolling');
    expect(result.answer).toContain('Employee + Family');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers plan tradeoff prompts directly even after a generic medical compare prompt', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Medical plan options (Employee Only):\n\nWant to compare plans or switch coverage tiers?',
    });

    const result = await runQaV2Engine({
      query: "okay, let's compare the plan tradeoffs",
      session,
    });

    expect(result.answer).toContain('Here is the practical tradeoff across AmeriVet\'s medical options');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers vision usefulness questions directly instead of looping to generic fallback', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Vision',
    });

    const result = await runQaV2Engine({
      query: "how do i know if it's useful?",
      session,
    });

    expect(result.answer).toContain('Vision is usually worth adding');
    expect(result.answer).toContain('one vision plan');
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('answers "is that the only option?" inside vision with a direct decision answer', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Vision',
    });

    const result = await runQaV2Engine({
      query: 'okay, and is that the only option?',
      session,
    });

    expect(result.answer).toContain('AmeriVet currently offers one vision plan');
    expect(result.answer).toContain('whether it is worth adding at all');
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('answers "is that the only option?" inside dental with a direct decision answer', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Dental',
    });

    const result = await runQaV2Engine({
      query: 'is that the only option?',
      session,
    });

    expect(result.answer).toContain('there is one dental plan');
    expect(result.answer).toContain('whether to add it');
    expect(result.answer).not.toContain('We can stay with dental');
  });

  it('answers direct vision one-option questions even when the user asks cold instead of as a continuation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    });

    const result = await runQaV2Engine({
      query: 'is there only one vision plan available?',
      session,
    });

    expect(result.answer).toContain('one vision plan');
    expect(result.answer).toContain('worth adding at all');
    expect(result.answer).not.toContain('Vision is usually worth adding');
  });

  it('answers direct dental one-option questions even when the user asks cold instead of as a continuation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    });

    const result = await runQaV2Engine({
      query: 'is there only one dental option?',
      session,
    });

    expect(result.answer).toContain('one dental plan');
    expect(result.answer).toContain('whether to add it');
    expect(result.answer).not.toContain('Dental is usually worth adding');
  });

  it('answers dental braces details from structured source material', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Dental',
    });

    const result = await runQaV2Engine({
      query: 'what does the dental plan cover for braces?',
      session,
    });

    expect(result.answer).toContain('orthodontia is included');
    expect(result.answer).toContain('Orthodontia copay: $500');
    expect(result.answer).not.toContain('We can stay with dental');
  });

  it('answers dental waiting-period questions from structured source material', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Dental',
    });

    const result = await runQaV2Engine({
      query: 'what is the waiting period for major services?',
      session,
    });

    expect(result.answer).toContain('Waiting period for major services is 6 months');
    expect(result.answer).not.toContain('We can stay with dental');
  });

  it('answers vision frames and contacts questions from structured source material', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Vision',
    });

    const result = await runQaV2Engine({
      query: 'what does the vision plan cover for frames and contacts?',
      session,
    });

    expect(result.answer).toContain('practical vision perks');
    expect(result.answer).toContain('$200 frame allowance');
    expect(result.answer).toContain('Contact lens allowance');
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('explains preventive and basic/major dental service terms from the package context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Dental',
    });

    const preventive = await runQaV2Engine({
      query: 'what does preventive care mean?',
      session,
    });
    expect(preventive.answer).toContain("In AmeriVet's dental plan, preventive care");
    expect(preventive.answer).not.toContain('We can stay with dental');

    const services = await runQaV2Engine({
      query: 'what are major services?',
      session,
    });
    expect(services.answer).toContain('difference is basically about how simple versus expensive the procedure is');
    expect(services.answer).toContain('Major services');
    expect(services.answer).not.toContain('We can stay with dental');
  });

  it('explains frame allowance and lasik discount from the vision package context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Vision',
    });

    const allowance = await runQaV2Engine({
      query: 'what does frame allowance mean?',
      session,
    });
    expect(allowance.answer).toContain('The frame allowance is the amount the vision plan helps toward frames');
    expect(allowance.answer).toContain('$200 frame allowance');
    expect(allowance.answer).not.toContain('We can stay with vision');

    const lasik = await runQaV2Engine({
      query: 'what does lasik discount mean?',
      session,
    });
    expect(lasik.answer).toContain('The LASIK discount means');
    expect(lasik.answer).not.toContain('We can stay with vision');
  });

  it('answers supplemental worth-adding questions directly instead of looping to generic fallback', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    });

    const result = await runQaV2Engine({
      query: "yeah- how do i know if it's worth adding?",
      session,
    });

    expect(result.answer).toContain('My practical take');
    expect(result.answer).not.toContain('We can stay with supplemental protection');
  });

  it('answers repeated supplemental worth-adding questions with a practical take instead of repeating setup', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'Accident/AD&D is usually worth considering when one of these sounds true:',
    });

    const result = await runQaV2Engine({
      query: 'yeah- how do i know if it is worth adding?',
      session,
    });

    expect(result.answer).toContain('My practical take');
    expect(result.answer).not.toContain('usually worth considering when one of these sounds true');
  });

  it('answers accident versus critical illness compare follow-through after offering it', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      pendingGuidancePrompt: 'accident_vs_critical',
      pendingGuidanceTopic: 'Accident/AD&D',
      lastBotMessage: 'If you want, I can compare accident/AD&D versus critical illness in plain language so you can see which one is more relevant for your situation.',
    });

    const result = await runQaV2Engine({
      query: "yes, i'd like that",
      session,
    });

    expect(result.answer).toContain('plain-language difference between Accident/AD&D and Critical Illness');
    expect(result.answer).not.toContain('I want to keep this grounded');
  });

  it('keeps accident topic ownership for "what is it not for?" after accident/ad&d explanation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
      lastBotMessage: 'Accident/AD&D coverage is another supplemental option. It generally pays benefits after covered accidental injuries, and AD&D adds benefits for severe accidental loss of life or limb.',
    });

    const result = await runQaV2Engine({
      query: 'what is it not for?',
      session,
    });

    expect(result.answer).toContain('What Accident/AD&D is not');
    expect(result.answer).not.toContain('What critical illness is not');
  });

  it('answers direct critical-illness add-on questions from household context instead of asking for rephrasing', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      messages: [
        { role: 'assistant', content: 'My recommendation: Standard HSA.' },
        { role: 'user', content: 'based on my family size and overall health, and the fact that i’m choosing the standard plan' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'and should i add critical illness to that?',
      session,
    });

    expect(result.answer).toContain('critical illness');
    expect(result.answer).toContain('medical first');
    expect(result.answer).not.toContain('ask that one a little more specifically');
  });

  it('answers direct critical-illness yes-no recommendation questions without snapping back to medical recommendation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
      coverageTierLock: 'Employee + Spouse',
      messages: [
        { role: 'user', content: "based on my family size and overall health, and the fact that i'm choosing the standard plan, should i get critical illness insurance, especially considering i'm the sole bread-winner for my family?" },
      ],
    });

    const result = await runQaV2Engine({
      query: 'so should i get it?',
      session,
    });

    expect(result.answer).toContain('critical illness');
    expect(result.answer).not.toContain('Recommendation for Employee + Spouse coverage');
  });

  it('keeps critical-illness ownership for broad recommendation follow-ups after a medical-to-supplemental handoff', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      messages: [
        { role: 'assistant', content: 'My recommendation: Standard HSA.' },
        { role: 'user', content: "based on my family size and overall health, and the fact that i'm choosing the standard plan, should i get critical illness insurance, especially considering i'm the sole bread-winner for my family?" },
        { role: 'assistant', content: 'Critical illness is usually worth considering when you want extra cash support if a major diagnosis happens and you are worried about the non-medical financial ripple effects.' },
      ],
      lastBotMessage: 'Critical illness is usually worth considering when you want extra cash support if a major diagnosis happens and you are worried about the non-medical financial ripple effects.',
    });

    const result = await runQaV2Engine({
      query: 'so... with my situation, what do you recommend?',
      session,
    });

    expect(result.answer).toContain('critical illness');
    expect(result.answer).not.toContain('Recommendation for Employee + Spouse coverage');
    expect(result.answer).toMatch(/not yet|not make critical illness the first extra add-on|only after/i);
  });

  it('answers active-topic supplemental worth-it questions directly instead of falling back to generic supplemental scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'Accident/AD&D coverage is another supplemental option. It generally pays benefits after covered accidental injuries, and AD&D adds benefits for severe accidental loss of life or limb.',
    });

    const result = await runQaV2Engine({
      query: 'how do i know if i should get that?',
      session,
    });

    expect(result.answer).toContain('Accident/AD&D');
    expect(result.answer).not.toContain('We can stay with supplemental protection');
  });

  it('keeps critical-illness recommendation ownership for broader "what would you recommend?" follow-ups', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
      pendingGuidanceTopic: 'Critical Illness',
      coverageTierLock: 'Employee + Spouse',
      messages: [
        { role: 'assistant', content: 'Critical illness is usually worth considering when you want extra cash support if a major diagnosis happens and you are worried about the non-medical financial ripple effects.' },
      ],
    });

    const result = await runQaV2Engine({
      query: "so if i go with the standard plan, and am generally healthy, but my husband doesn't work (i'm the only income) what would you recommend?",
      session,
    });

    expect(result.answer).toContain('critical illness');
    expect(result.answer).not.toContain('Recommendation for Employee + Spouse coverage');
  });

  it('answers direct supplemental-overview questions even when the current topic is stale', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lastBotMessage: 'Vision coverage: VSP Vision Plus',
    });

    const result = await runQaV2Engine({
      query: 'what are the supplemental benefits? are they free?',
      session,
    });

    expect(result.answer).toContain("AmeriVet's supplemental benefits are the optional add-ons");
    expect(result.answer).toContain('Basic Life & AD&D is employer-paid');
    expect(result.answer).toContain('employee-paid');
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('answers spouse life-coverage questions directly instead of replaying the full life card', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    });

    const result = await runQaV2Engine({
      query: 'would the life insurance also cover my wife?',
      session,
    });

    expect(result.answer).toContain('voluntary term life');
    expect(result.answer).toContain('spouse');
    expect(result.answer).not.toContain('Life insurance options:');
  });

  it('answers default life-coverage questions directly instead of replaying the full life card', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    });

    const result = await runQaV2Engine({
      query: 'if i do nothing, what life insurance do i get?',
      session,
    });

    expect(result.answer).toContain('Basic Life & AD&D');
    expect(result.answer).toContain('$25,000');
    expect(result.answer).toContain('employer-paid');
    expect(result.answer).not.toContain('Life insurance options:');
  });

  it('answers how-much-life-to-get questions with a decision framework instead of a generic options card', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
    });

    const result = await runQaV2Engine({
      query: 'can you help me decide how much voluntary term life i should get?',
      session,
    });

    expect(result.answer).toContain('practical way I would decide how much life insurance to add');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).toContain('$25,000');
    expect(result.answer).not.toContain('Life insurance options:');
  });

  it('answers included-life questions phrased as "without paying more" directly instead of replaying the broad life card', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    });

    const result = await runQaV2Engine({
      query: 'are any of those life insurance plans something i just get without having to pay more?',
      session,
    });

    expect(result.answer).toContain('Basic Life & AD&D');
    expect(result.answer).toContain('employer-paid');
    expect(result.answer).toContain('$25,000');
    expect(result.answer).not.toContain('Life insurance options:');
  });

  it('answers determine-how-much voluntary-term questions with the life-amount framework instead of replaying the term explainer', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
    });

    const result = await runQaV2Engine({
      query: 'can you help me determine how much voluntary term life insurance i should get?',
      session,
    });

    expect(result.answer).toContain('practical way I would decide how much life insurance to add');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).toContain('$25,000');
    expect(result.answer).not.toContain('Here is the practical takeaway on **Voluntary Term Life**');
  });

  it('answers HSA/FSA compatibility questions directly for Kaiser instead of repeating the generic overview', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
    });

    const result = await runQaV2Engine({
      query: 'can i use fsa with kaiser?',
      session,
    });

    expect(result.answer).toContain('Kaiser Standard HMO');
    expect(result.answer).toContain('FSA is usually the more natural pre-tax account');
    expect(result.answer).not.toContain('HSA/FSA overview:');
  });

  it('answers "what do you recommend to me" in active hsa/fsa chat with a direct recommendation instead of the generic next-question menu', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'The practical answer is that FSA makes more sense when you want pre-tax help for expenses within the current plan year and you are not relying on HSA-qualified medical plan.',
    });

    const result = await runQaV2Engine({
      query: 'so what do you recommend to me?',
      session,
    });

    expect(result.answer).toContain('My practical take');
    expect(result.answer).toMatch(/HSA|FSA/);
    expect(result.answer).not.toContain('A useful next HSA/FSA question is usually one of these');
  });

  it('answers direct life-benefit inventory questions instead of stalling in stale topic scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lastBotMessage: 'We can stay with vision. The most useful next step is usually whether it is worth adding for your household.',
    });

    const result = await runQaV2Engine({
      query: 'what life insurance benefits do i have?',
      session,
    });

    expect(result.answer).toContain('Life insurance options:');
    expect(result.answer).toContain('Unum Basic Life & AD&D');
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('answers direct medical family recommendation questions even when the current topic is stale', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      coverageTierLock: 'Employee + Family',
      lastBotMessage: 'Vision coverage: VSP Vision Plus',
    });

    const result = await runQaV2Engine({
      query: 'which plan is best for my family?',
      session,
    });

    expect(result.answer).toMatch(/My recommendation|I can recommend one/i);
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('recovers critical illness from an organic illness reference after package guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'From here, the most useful next step is usually dental/vision if you want routine care coverage, or life/disability if family protection matters more, then accident or critical illness if you want extra cash support.',
    });

    const result = await runQaV2Engine({
      query: "wasn't there one about illness?",
      session,
    });

    expect(result.answer).toContain('Critical illness coverage');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('can answer supplemental worth-it follow-ups from the last assistant message even if topic state is stale', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      lastBotMessage: 'Accident/AD&D coverage is another supplemental option. If you want, I can also help you think through when one of these benefits is worth considering for your situation.',
    });

    const result = await runQaV2Engine({
      query: 'how do i know if i should get that?',
      session,
    });

    expect(result.answer).toContain('My practical take');
    expect(result.answer).not.toContain('We can stay with supplemental protection');
  });

  it('does not just repeat the same supplemental worth-it paragraph on a second follow-up', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'Accident/AD&D is usually worth considering when one of these sounds true:\n\n- You want extra cash support if an accidental injury happens, even with medical coverage in place',
    });

    const result = await runQaV2Engine({
      query: "yeah- how do i know if it's worth adding?",
      session,
    });

    expect(result.answer).toContain('My practical take');
    expect(result.answer).not.toContain('usually worth considering when one of these sounds true');
  });

  it('turns a repeated supplemental worth-it question into a practical take after the broader fit guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
      lastBotMessage: 'A supplemental benefit is usually worth considering when you already have your core medical decision in place and want an extra layer of cash-support protection.',
    });

    const result = await runQaV2Engine({
      query: "yeah- how do i know if it's worth adding?",
      session,
    });

    expect(result.answer).toContain('My practical take');
    expect(result.answer).not.toContain('A supplemental benefit is usually worth considering');
  });

  it('answers routine-care comparison prompts in context instead of hard-pivoting topics', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Dental', 'Vision'],
    });

    const result = await runQaV2Engine({
      query: 'how can i tell which one matters more?',
      session,
    });

    expect(result.answer).toContain('deciding between dental and vision as the next add-on');
    expect(result.answer).not.toContain('Vision coverage: **VSP Vision Plus**');
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

  it('updates an explicit name correction during onboarding without dropping the demographics prompt', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
    });

    const result = await runQaV2Engine({
      query: "actually, i'm Melodie",
      session,
    });

    expect(session.userName).toBe('Melodie');
    expect(result.answer).toContain('updated your name to Melodie');
    expect(result.answer).toContain('age and state');
  });

  it('does not treat life-insurance follow-up phrasing as a fake name correction', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Leo',
      hasCollectedName: true,
      userAge: 72,
      userState: 'MN',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D\n- Unum Voluntary Term Life\n- Allstate Whole Life',
    });

    const result = await runQaV2Engine({
      query: "i'm thinking about that voluntary term one. what else should i know?",
      session,
    });

    expect(session.userName).toBe('Leo');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).not.toContain('updated your name');
  });

  it('updates an explicit age correction without dropping the active topic', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Melodie',
      hasCollectedName: true,
      userAge: 41,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Dental',
    });

    const result = await runQaV2Engine({
      query: 'actually, i am 42',
      session,
    });

    expect(session.userAge).toBe(42);
    expect(result.answer).toContain('updated your age to 42');
    expect(result.answer).toContain('keep looking at dental');
  });

  it('does not treat bare ok as Oklahoma during active hsa/fsa chat', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 35,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    });

    const result = await runQaV2Engine({
      query: 'ok',
      session,
    });

    expect(session.userState).toBe('WA');
    expect(result.answer).not.toContain('updated your state to OK');
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it('refreshes medical options after a state correction instead of falling into a generic medical prompt', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Guy',
      hasCollectedName: true,
      userAge: 43,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Medical plan options (Employee Only):\n\n- Standard HSA\n- Enhanced HSA',
    });

    const result = await runQaV2Engine({
      query: "i'm actually in WA",
      session,
    });

    expect(result.answer).toContain('updated medical view');
    expect(result.answer).toContain('Medical plan options');
    expect(result.answer).not.toContain('Please ask that one a little more specifically');
  });

  it('keeps going with a requested topic when a state correction arrives before any active topic is set', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Guy',
      hasCollectedName: true,
      userAge: 43,
      userState: 'TX',
      dataConfirmed: true,
    });

    const result = await runQaV2Engine({
      query: "actually, i'm in WA. medical please",
      session,
    });

    expect(session.userState).toBe('WA');
    expect(session.currentTopic).toBe('Medical');
    expect(result.answer).toContain('updated your state to WA');
    expect(result.answer).toContain('updated medical view');
    expect(result.answer).toContain('Medical plan options');
  });

  it('shows the benefits lineup after a plain state change when no active topic is set', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Guy',
      hasCollectedName: true,
      userAge: 43,
      userState: 'TX',
      dataConfirmed: true,
    });

    const result = await runQaV2Engine({
      query: "i'm in WA",
      session,
    });

    expect(session.userState).toBe('WA');
    expect(result.answer).toContain('updated your state to WA');
    expect(result.answer).toContain('Here is the AmeriVet benefits lineup for 43 in WA');
    expect(result.answer).toContain('What would you like to explore first?');
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
    expect(result.answer).toContain('keep your own monthly premium lower');
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

    expect(result.answer).toContain('Whether the higher-cost medical option is worth the extra premium');
    expect(result.answer).toContain('If usage is low, I would usually keep the cheaper option');
  });

  it('treats a direct medical recommendation follow-up as higher priority than generic family follow-up scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 34,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      lastBotMessage: 'Recommendation for Employee + Spouse coverage:\n\nMy recommendation: Standard HSA.',
      lifeEvents: ['pregnancy'],
      familyDetails: { hasSpouse: true },
      messages: [
        { role: 'user', content: "my wife is pregnant and we're expecting a baby" },
        { role: 'assistant', content: 'Recommendation for Employee + Spouse coverage:\n\nMy recommendation: Standard HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'which one do you recommend for me and my wife if she is pregnant?',
      session,
    });

    expect(result.answer).toContain('My recommendation: Kaiser Standard HMO');
    expect(result.answer).not.toContain('If you are thinking specifically about your spouse');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers a why-not-kaiser follow-up with a direct pregnancy-aware correction', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 34,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      lastBotMessage: 'Recommendation for Employee + Spouse coverage:\n\nMy recommendation: Standard HSA.',
      lifeEvents: ['pregnancy'],
      familyDetails: { hasSpouse: true },
      messages: [
        { role: 'user', content: "my wife is pregnant and we're expecting a baby" },
        { role: 'assistant', content: 'Recommendation for Employee + Spouse coverage:\n\nMy recommendation: Standard HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: "so why didn't you recommend kaiser?",
      session,
    });

    expect(result.answer).toContain('Kaiser Standard HMO');
    expect(result.answer).toContain('lowest likely maternity-related out-of-pocket exposure');
    expect(result.answer).not.toContain('payroll');
  });

  it('answers medical coverage-tier timing directly even when the stale topic is disability', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 34,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      lastBotMessage: 'Disability coverage is meant to protect part of your income if you cannot work because of illness or injury.',
      familyDetails: { hasSpouse: true },
      lifeEvents: ['pregnancy'],
    });

    const result = await runQaV2Engine({
      query: 'when i select my plan, do i pick employee + spouse or the family one right now if we are having a baby next february?',
      session,
    });

    expect(result.answer).toContain('Employee + Spouse');
    expect(result.answer).toContain('Employee + Family');
    expect(result.answer).toContain('qualifying life event');
    expect(result.answer).not.toContain('Disability coverage is meant');
  });

  it('returns the other-benefits overview instead of stale medical scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 34,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
    });

    const result = await runQaV2Engine({
      query: 'what are my other benefit options?',
      session,
    });

    expect(result.answer).toContain('other benefit areas available to you');
    expect(result.answer).toContain('Life Insurance');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('pivots from vision to supplemental overview when the user asks for supplemental protection', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 34,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lastBotMessage: 'Vision coverage: **VSP Vision Plus**.',
    });

    const result = await runQaV2Engine({
      query: "no - i'm interested in the supplemental protection",
      session,
    });

    expect(result.answer).toContain("AmeriVet's supplemental benefits are the optional add-ons");
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('honors skipping dental and pivots directly into the vision plan', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 34,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Dental',
      lastBotMessage: 'Dental coverage: **BCBSTX Dental PPO**.',
    });

    const result = await runQaV2Engine({
      query: "i think i'll skip dental. what's the vision plan?",
      session,
    });

    expect(result.answer).toContain('Vision coverage: **VSP Vision Plus**');
    expect(result.answer).not.toContain('Dental coverage: **BCBSTX Dental PPO**');
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

  it('answers life-insurance portability and guaranteed-issue questions from AmeriVet source-backed details', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    });

    const portable = await runQaV2Engine({
      query: 'what does portable mean here?',
      session,
    });

    expect(portable.answer).toContain('Portable means');
    expect(portable.answer).toContain('Voluntary Term Life');
    expect(portable.answer).not.toContain('I can help with life insurance');

    const guaranteedIssue = await runQaV2Engine({
      query: 'what does guaranteed issue mean?',
      session,
    });

    expect(guaranteedIssue.answer).toContain('Guaranteed issue means');
    expect(guaranteedIssue.answer).toContain('$150,000');
    expect(guaranteedIssue.answer).not.toContain('I can help with life insurance');
  });

  it('answers whole-life cash-value questions directly from life-insurance context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    });

    const result = await runQaV2Engine({
      query: 'what does cash value mean?',
      session,
    });

    expect(result.answer).toContain('Cash value is the savings-like component');
    expect(result.answer).toContain('Whole Life');
    expect(result.answer).not.toContain('I can help with life insurance');
  });

  it('answers disability detail questions without falling back to generic guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Disability',
    });

    const comparison = await runQaV2Engine({
      query: 'what is the difference between short-term and long-term disability?',
      session,
    });

    expect(comparison.answer).toContain('Short-term disability and long-term disability are both income-protection benefits');
    expect(comparison.answer).not.toContain('We can stay with disability');

    const paycheck = await runQaV2Engine({
      query: 'how does disability protect my paycheck?',
      session,
    });

    expect(paycheck.answer).toContain('Disability is really paycheck protection');
    expect(paycheck.answer).not.toContain('We can stay with disability');

    const waitingPeriods = await runQaV2Engine({
      query: 'what are the disability waiting periods and maximum benefits?',
      session,
    });

    expect(waitingPeriods.answer).toContain('does not list the exact disability waiting periods');
    expect(waitingPeriods.answer).toContain('do not want to guess');
    expect(waitingPeriods.answer).not.toContain('We can stay with disability');
  });

  it('answers critical-illness and accident/ad&d detail questions directly', async () => {
    const criticalSession = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
    });

    const critical = await runQaV2Engine({
      query: 'what does lump sum mean here?',
      session: criticalSession,
    });

    expect(critical.answer).toContain('lump-sum style cash benefit');
    expect(critical.answer).not.toContain('We can stay with supplemental protection');

    const criticalLimits = await runQaV2Engine({
      query: 'what is it not for?',
      session: criticalSession,
    });

    expect(criticalLimits.answer).toContain('What critical illness is not');
    expect(criticalLimits.answer).toContain('not a replacement for your medical plan');
    expect(criticalLimits.answer).not.toContain('We can stay with supplemental protection');

    const accidentSession = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    });

    const accident = await runQaV2Engine({
      query: 'what does ad&d mean?',
      session: accidentSession,
    });

    expect(accident.answer).toContain('Accident coverage and AD&D travel together');
    expect(accident.answer).toContain('loss of life or limb');
    expect(accident.answer).not.toContain('We can stay with supplemental protection');

    const accidentLimits = await runQaV2Engine({
      query: 'what is it not for?',
      session: accidentSession,
    });

    expect(accidentLimits.answer).toContain('What Accident/AD&D is not');
    expect(accidentLimits.answer).toContain('not a replacement for your medical plan');
    expect(accidentLimits.answer).not.toContain('We can stay with supplemental protection');
  });

  it('answers life-insurance practical coverage amount questions from the source-backed summary', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    });

    const result = await runQaV2Engine({
      query: 'how much life insurance can i get here?',
      session,
    });

    expect(result.answer).toContain('difference across AmeriVet');
    expect(result.answer).toContain('Basic Life');
    expect(result.answer).toContain('1x to 5x annual salary');
    expect(result.answer).not.toContain('I can help with life insurance');
  });

  it('uses the employer guidance split when the user asks how to divide whole life and voluntary term life', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    });

    const result = await runQaV2Engine({
      query: 'what split do you recommend between whole life and voluntary term life?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('included base layer');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('uses the employer guidance split for broader family-protection life decisions after life options are already in play', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Here is the practical difference across AmeriVet\'s life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    });

    const result = await runQaV2Engine({
      query: 'which ones should i get?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('uses the employer guidance split when the user says they want more than the basic life coverage and asks for a recommendation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
    });

    const result = await runQaV2Engine({
      query: 'i have a wife and 2 kids and want more than just the basic life coverage. what do you recommend?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('Basic Life');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('uses the employer guidance split for broader life-amount questions once life options are already active', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    });

    const result = await runQaV2Engine({
      query: 'how much should i get?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('Basic Life');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('uses the employer guidance split for natural family wording inside an active life-insurance thread even without prior split scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'My practical take: life insurance is usually worth tightening up if other people rely on your income and would need support if something happened to you.',
    });

    const result = await runQaV2Engine({
      query: 'ok, so i have a wife and 2 kids. so i want life insurance. i think i also want voluntary term - can you help me with that?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('Basic Life');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('uses the employer guidance split for short life-decision followups after earlier family-protection context is already in the thread', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      messages: [
        { role: 'user', content: 'life insurance info' },
        { role: 'assistant', content: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value' },
        { role: 'user', content: 'how much protection is worth paying for if your family relies on your income?' },
        { role: 'assistant', content: 'If you are asking how I would structure extra life coverage once the included base benefit is not enough, AmeriVet\'s current employer guidance is **80% Voluntary Term Life / 20% Whole Life**.' },
      ],
      lastBotMessage: 'My practical take is that if people rely on your income, I would not leave life insurance as an afterthought.',
    });

    const result = await runQaV2Engine({
      query: 'which of those should i get?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('keeps life followthrough life-specific when the user asks to think it through after a life practical take', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'My practical take is that if people rely on your income, I would not leave life insurance as an afterthought.',
    });

    const result = await runQaV2Engine({
      query: 'yes please - help me think through that',
      session,
    });

    expect(result.answer).toContain('Life insurance is usually worth tightening up');
    expect(result.answer).toContain('Basic Life');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).toContain('Whole Life');
    expect(result.answer).toContain('life versus disability');
    expect(result.answer).not.toContain('A supplemental benefit is usually worth considering');
  });

  it('uses the employer guidance split for short amount followups after a prior life recommendation thread without needing family details on the current turn', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      messages: [
        { role: 'user', content: 'i have a wife and 2 kids and want more than just the basic life coverage. what do you recommend?' },
        { role: 'assistant', content: 'If you are asking how I would structure extra life coverage once the included base benefit is not enough, AmeriVet\'s current employer guidance is **80% Voluntary Term Life / 20% Whole Life**.' },
      ],
      lastBotMessage: 'Here is the practical difference across AmeriVet\'s life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    });

    const result = await runQaV2Engine({
      query: 'how much should i get?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('Basic Life');
    expect(result.answer).toContain('If you can only afford **one** extra paid life layer');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).toContain('Whole Life');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('uses the employer guidance split for softer recommendation wording like "how much would you recommend" once life options are active', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Here is the practical difference across AmeriVet\'s life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    });

    const result = await runQaV2Engine({
      query: 'how much would you recommend?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('Basic Life');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('uses the employer guidance split for family-protection payoff questions after life guidance menus', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'A useful next life-insurance step is usually one of these:\n\n- Whether life or disability matters more first\n- How much protection is worth paying for if your family relies on your income',
    });

    const result = await runQaV2Engine({
      query: 'How much protection is worth paying for if your family relies on your income?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('Basic Life');
    expect(result.answer).not.toContain('life insurance is usually worth tightening up');
  });

  it('answers how to move off the employer life split with a practical term-versus-whole adjustment framework', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'If you are asking how I would structure extra life coverage once the included base benefit is not enough, AmeriVet\'s current employer guidance is **80% Voluntary Term Life / 20% Whole Life**.',
    });

    const result = await runQaV2Engine({
      query: 'how do i know how much of each to get?',
      session,
    });

    expect(result.answer).toContain('80% Voluntary Term Life / 20% Whole Life');
    expect(result.answer).toContain('more Unum Voluntary Term Life');
    expect(result.answer).toContain('more Allstate Whole Life');
    expect(result.answer).toContain('Basic Life');
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

  it('makes package recommendations more situational when life coverage is already the active decision', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    });

    const result = await runQaV2Engine({
      query: 'knowing what you know about me, which benefits would you recommend i get?',
      session,
    });

    expect(result.answer).toContain('Based on what you have told me, I would usually prioritize your benefits in this order');
    expect(result.answer).toContain('keep **medical** as the anchor');
    expect(result.answer).toContain('Voluntary Term Life');
    expect(result.answer).toContain('Whole Life');
    expect(result.answer).toContain('disability');
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
    expect(first.answer).toContain('disability next');
    expect(first.answer).toContain('life insurance right after that');

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
    expect(result.answer).toContain('disability next');
    expect(result.answer).toContain('life insurance right after that');
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

  it('supports a bare "yes, do that" after package guidance points a settled medical choice toward HSA/FSA', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      selectedPlan: 'Enhanced HSA',
    });

    await runQaV2Engine({
      query: 'what else should i consider?',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('HSA is usually the cleaner fit');
    expect(result.answer).toContain('tax account aligned');
  });

  it('supports a bare "yes, do that" after family medical guidance nudges routine care first', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Medical plan options (Employee + Child(ren)):',
    });

    await runQaV2Engine({
      query: 'what else should i consider?',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('Dental coverage: **BCBSTX Dental PPO**');
    expect(result.answer).not.toContain('Life insurance options:');
  });

  it('supports a bare "yes, do that" after package guidance points settled routine care toward life insurance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Enhanced HSA',
    });

    await runQaV2Engine({
      query: 'what should i look at next?',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('Life insurance options:');
    expect(result.answer).toContain('Unum Basic Life & AD&D');
  });

  it('keeps HSA/FSA visible after life guidance when disability still comes first', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance'],
      selectedPlan: 'Enhanced HSA',
      familyDetails: { hasSpouse: true, numChildren: 2 },
    });

    const result = await runQaV2Engine({
      query: 'what else should i be considering to my benefits?',
      session,
    });

    expect(result.answer).toContain('**disability**');
    expect(result.answer).toContain('**HSA/FSA**');
    expect(result.answer).toContain('**Enhanced HSA**');
    expect(result.answer).not.toContain('smaller add-on questions');
  });

  it('moves from life into HSA/FSA once the main protection decisions are already covered', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance', 'Disability'],
      selectedPlan: 'Enhanced HSA',
      familyDetails: { hasSpouse: true, numChildren: 2 },
    });

    const result = await runQaV2Engine({
      query: 'what should i look at next?',
      session,
    });

    expect(result.answer).toContain('**HSA/FSA**');
    expect(result.answer).toContain('**Enhanced HSA**');
    expect(result.answer).not.toContain('smaller add-on questions');
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

  it('leans life first when a life-versus-disability question is framed around survivor protection', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    });

    const result = await runQaV2Engine({
      query: 'if my spouse and kids would need support if i die, should i do life insurance or disability first?',
      session,
    });

    expect(result.answer).toContain('life insurance first');
    expect(result.answer).toContain('survivor protection');
    expect(result.answer).not.toContain('disability first when the household depends on your paycheck');
  });

  it('answers "why not life first?" after life-versus-disability comparison when survivor protection is the concern', async () => {
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
      query: 'why not life first if my spouse and kids would need support if i die?',
      session,
    });

    expect(result.answer).toContain('Life absolutely can come first');
    expect(result.answer).toContain('support after my death');
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

  it('treats "is there only one vision plan available?" as an only-option question instead of reopening the full plan card', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lastBotMessage: 'Vision coverage: **VSP Vision Plus**.',
    });

    const result = await runQaV2Engine({
      query: 'is there only one vision plan available?',
      session,
    });

    expect(result.answer).toContain('AmeriVet currently offers one vision plan');
    expect(result.answer).not.toContain('Vision coverage: **VSP Vision Plus**');
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

  it('explains what richer means after a medical recommendation instead of falling back to a menu', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      lastBotMessage: 'Recommendation for Employee + Spouse coverage:\n\nMy recommendation: Enhanced HSA.',
      messages: [
        { role: 'assistant', content: 'Recommendation for Employee + Spouse coverage:\n\nMy recommendation: Enhanced HSA.' },
      ],
    });

    const result = await runQaV2Engine({
      query: 'what do you mean by richer?',
      session,
    });

    expect(result.answer).toContain('stronger cost protection');
    expect(result.answer).toContain('more expensive up front');
    expect(result.answer).not.toContain('We can stay with medical');
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
    expect(result.answer).toContain('compare **Standard HSA** versus **Enhanced HSA** next');
  });

  it('supports a bare "yes, do that" after long-term HSA fit guidance by pivoting into HSA-plan comparison', async () => {
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

    await runQaV2Engine({
      query: 'long-term savings',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('long-term HSA savings');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('Enhanced HSA');
    expect(result.answer).not.toContain('We can stay with HSA/FSA');
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

    expect(result.answer).toContain('A useful next dental step is usually one of these');
    expect(result.answer).not.toContain('medical, dental, vision, life, disability');
  });

  it('shows only vision when the user declines dental and asks for vision options', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Dental',
      lastBotMessage: 'Dental coverage: **BCBSTX Dental PPO**.',
    });

    const result = await runQaV2Engine({
      query: "ok. i don't want dental. show me my vision options",
      session,
    });

    expect(result.answer).toContain('Vision coverage: **VSP Vision Plus**');
    expect(result.answer).not.toContain('Dental coverage: **BCBSTX Dental PPO**');
  });

  it('answers where-to-enroll questions directly even from stale vision context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lastBotMessage: 'Vision coverage: **VSP Vision Plus**.',
    });

    const result = await runQaV2Engine({
      query: 'where do i enroll?',
      session,
    });

    expect(result.answer).toContain('Workday');
    expect(result.answer).toContain('888-217-4728');
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('answers rx self-service lookup follow-ups directly instead of replaying medical scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the prescription coverage comparison across the available medical plans:\n\n- Standard HSA: I do not have the prescription drug tier details in the current summary, so I do not want to guess.',
    });

    const result = await runQaV2Engine({
      query: 'where can i go to see the rx costs myself?',
      session,
    });

    expect(result.answer).toContain('Workday');
    expect(result.answer).toContain('prescription tiers or drug-pricing details');
    expect(result.answer).toContain('carrier formulary / drug-pricing tool');
    expect(result.answer).toContain('compare the medical options at a high level for someone who expects ongoing prescriptions');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('supports a bare "yes" after RX self-service guidance by pivoting back into a prescription-sensitive medical comparison', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the prescription coverage comparison across the available medical plans:\n\n- Standard HSA: I do not have the prescription drug tier details in the current summary, so I do not want to guess.',
    });

    await runQaV2Engine({
      query: 'where can i go to see the rx costs myself?',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('My recommendation:');
    expect(result.answer).toContain('ongoing prescriptions');
    expect(result.answer).not.toContain('Workday');
  });

  it('answers real-person support asks directly instead of looping on the active topic', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lastBotMessage: 'Vision coverage: **VSP Vision Plus**.',
    });

    const result = await runQaV2Engine({
      query: 'i need to talk to a real person',
      session,
    });

    expect(result.answer).toContain('888-217-4728');
    expect(result.answer).toContain('Workday');
    expect(result.answer).not.toContain('We can stay with vision');
  });

  it('answers direct HSA-or-FSA recommendation asks instead of falling back to a generic hsa/fsa scaffold', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    });

    const result = await runQaV2Engine({
      query: 'which would you recommend for me?',
      session,
    });

    expect(result.answer).toContain('My practical take');
    expect(result.answer).toMatch(/HSA|FSA/);
    expect(result.answer).not.toContain('We can stay with HSA/FSA');
  });

  it('answers when-hsa-fits-better questions directly', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    });

    const result = await runQaV2Engine({
      query: 'so when does hsa fit better?',
      session,
    });

    expect(result.answer).toContain('simplest way to think about HSA versus FSA fit');
    expect(result.answer).not.toContain('We can stay with HSA/FSA');
  });

  it('answers how-do-i-know-when-hsa-fits-better questions directly', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    });

    const result = await runQaV2Engine({
      query: 'how do i know when hsa fits better?',
      session,
    });

    expect(result.answer).toContain('simplest way to think about HSA versus FSA fit');
    expect(result.answer).not.toContain('We can stay with HSA/FSA');
  });

  it('answers HSA rollover-limit follow-ups directly instead of falling back to the generic hsa/fsa scaffold', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'If the goal is long-term rollover savings, HSA is usually the cleaner fit.',
    });

    const result = await runQaV2Engine({
      query: 'is there a limit to how much unused funds can roll forward?',
      session,
    });

    expect(result.answer).toContain('unused HSA money generally **rolls forward year to year**');
    expect(result.answer).toContain('IRS annual contribution limit');
    expect(result.answer).toContain('$4,300');
    expect(result.answer).toContain('HSA-versus-FSA');
    expect(result.answer).not.toContain('We can stay with HSA/FSA');
  });

  it('answers tax-and-rollover tradeoff follow-ups directly inside hsa/fsa context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      selectedPlan: 'Standard HSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    });

    const result = await runQaV2Engine({
      query: 'can you tell me what the tax and rollover tradeoff means in practice?',
      session,
    });

    expect(result.answer).toContain('tax and rollover tradeoff');
    expect(result.answer).toContain('Unused **HSA** money stays with you');
    expect(result.answer).toContain('stricter carryover or use-it-or-lose-it rules');
    expect(result.answer).toContain('long-term savings');
    expect(result.answer).not.toContain('We can stay with HSA/FSA');
  });

  it('answers deductible-and-out-of-pocket comparison questions directly', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: "Here is the practical tradeoff across AmeriVet's medical options:",
    });

    const result = await runQaV2Engine({
      query: 'which one has the lower deductible and out of pocket max?',
      session,
    });

    expect(result.answer).toContain('Enhanced HSA');
    expect(result.answer).toContain('lower deductible');
    expect(result.answer).toContain('lower out-of-pocket max');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers lowest-oop confirmation questions directly instead of falling back to a medical menu', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'Recommendation for Employee Only coverage:\n\n**My recommendation: Enhanced HSA.**',
    });

    const result = await runQaV2Engine({
      query: "so if i want lowest oop, should i go with enhanced because it's a lower out of pocket max?",
      session,
    });

    expect(result.answer).toContain('Yes');
    expect(result.answer).toContain('Enhanced HSA');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers disability cost questions directly instead of repeating a generic disability explainer', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Disability',
      lastBotMessage: 'Disability coverage is meant to protect part of your income if you cannot work because of illness or injury.',
    });

    const result = await runQaV2Engine({
      query: 'how much will disability cost?',
      session,
    });

    expect(result.answer).toContain('does **not** list the exact premium inline');
    expect(result.answer).toContain('Workday');
    expect(result.answer).not.toContain('We can stay with disability');
  });

  it('answers CI pricing questions directly even when the user uses the ci abbreviation', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
      lastBotMessage: 'Critical illness coverage is a supplemental benefit that can pay a lump-sum cash benefit if you are diagnosed with a covered serious condition.',
    });

    const result = await runQaV2Engine({
      query: 'can you give me a ballpark idea of what the ci insurance would cost?',
      session,
    });

    expect(result.answer).toContain('do **not** have a grounded flat-rate premium');
    expect(result.answer).toContain('Workday');
    expect(result.answer).not.toContain('We can stay with supplemental protection');
  });

  it('supports a bare "yes" after CI pricing deferral by moving into worth-it guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
      lastBotMessage: 'Critical illness coverage is a supplemental benefit that can pay a lump-sum cash benefit if you are diagnosed with a covered serious condition.',
    });

    await runQaV2Engine({
      query: 'can you give me a ballpark idea of what the ci insurance would cost?',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('Critical illness is usually worth considering');
    expect(result.answer).not.toContain('do **not** have a grounded flat-rate premium');
  });

  it('answers combined life-and-disability cost questions with a grounded pricing structure answer', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Life insurance options:\n\n- **Unum Basic Life & AD&D**',
    });

    const result = await runQaV2Engine({
      query: 'i want to get life insurance and disability. how much will it cost?',
      session,
    });

    expect(result.answer).toContain('Basic Life & AD&D');
    expect(result.answer).toContain('Disability');
    expect(result.answer).toContain('Workday');
    expect(result.answer).not.toContain('Please ask that one a little more specifically');
  });

  it('treats "let’s look at life" as a real topic pivot instead of asking for more specificity', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lastBotMessage: 'Vision coverage: **VSP Vision Plus**.',
    });

    const result = await runQaV2Engine({
      query: "sure. let's look at life",
      session,
    });

    expect(result.answer).toContain('Life insurance options:');
    expect(result.answer).not.toContain('Please ask that one a little more specifically');
  });

  it('uses a life-specific next comparison instead of asking for more specificity on vague active-topic followups', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Life insurance options:\n\n- **Unum Basic Life & AD&D**',
    });

    const result = await runQaV2Engine({
      query: 'what else?',
      session,
    });

    expect(result.answer).toContain('most useful next comparison is usually **disability**');
    expect(result.answer).not.toContain('Please ask that one a little more specifically');
  });

  it('uses an HSA/FSA-specific next step instead of asking for more specificity on vague active-topic followups', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    });

    const result = await runQaV2Engine({
      query: 'what else?',
      session,
    });

    expect(result.answer).toContain('most useful next step is usually **medical**');
    expect(result.answer).not.toContain('Please ask that one a little more specifically');
  });

  it('treats a bare "life" as a real topic pivot even from stale vision context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lastBotMessage: 'Vision coverage: **VSP Vision Plus**.',
    });

    const result = await runQaV2Engine({
      query: 'life',
      session,
    });

    expect(result.answer).toContain('Life insurance options:');
    expect(result.answer).not.toContain('We can stay with vision');
    expect(session.currentTopic).toBe('Life Insurance');
  });

  it('treats "show me life next" as a real topic pivot instead of stale-topic guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Dental', 'Vision'],
      lastBotMessage: 'Since you have already looked at dental too, the next most useful area is usually:\n\n- life, disability, or supplemental protection',
    });

    const result = await runQaV2Engine({
      query: 'show me life next',
      session,
    });

    expect(result.answer).toContain('Life insurance options:');
    expect(result.answer).not.toContain('Here are the benefits available to you as an AmeriVet employee');
    expect(session.currentTopic).toBe('Life Insurance');
  });

  it('treats a bare "disability" as a real topic pivot even from stale dental context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Dental',
      lastBotMessage: 'Dental coverage: **BCBSTX Dental PPO**.',
    });

    const result = await runQaV2Engine({
      query: 'disability',
      session,
    });

    expect(result.answer).toContain('Disability coverage is meant to protect part of your income');
    expect(result.answer).not.toContain('We can stay with dental');
    expect(session.currentTopic).toBe('Disability');
  });

  it('treats "ok lets do disability next" as a direct pivot after life guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance'],
      lastBotMessage: 'If you want to keep going after life insurance, the most useful next comparison is usually:\n\n- disability if you want income protection while you are alive',
    });

    const result = await runQaV2Engine({
      query: 'ok lets do disability next',
      session,
    });

    expect(result.answer).toContain('Disability coverage is meant to protect part of your income');
    expect(result.answer).not.toContain('Please ask that one a little more specifically');
    expect(session.currentTopic).toBe('Disability');
  });

  it('answers package-level recommendation questions directly even when medical is the stale active topic', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Recommendation for Employee + Child(ren) coverage:\n\nMy recommendation: Kaiser Standard HMO.',
    });

    const result = await runQaV2Engine({
      query: 'knowing what you know about me, which benefits would you recommend i get?',
      session,
    });

    expect(result.answer).toContain('Based on what you have told me, I would usually prioritize your benefits in this order');
    expect(result.answer).toContain('Medical first');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers baby-related QLE timing directly instead of replaying maternity plan detail', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lifeEvents: ['pregnancy'],
      lastBotMessage: 'Here is the maternity coverage comparison across the available medical plans:',
    });

    const result = await runQaV2Engine({
      query: 'after we have our baby, how long do we have to add her to our insurance?',
      session,
    });

    expect(result.answer).toContain('qualifying life event');
    expect(result.answer).toContain('Workday');
    expect(result.answer).not.toContain('Here is the maternity coverage comparison');
    expect(session.coverageTierLock).toBe('Employee + Family');
  });

  it('answers marriage-related QLE timing directly instead of falling back to medical scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Projected Healthcare Costs for Employee + Child(ren) coverage in Washington (moderate usage):',
    });

    const result = await runQaV2Engine({
      query: 'how long do we have to change plans after getting married?',
      session,
    });

    expect(result.answer).toContain('Marriage is a qualifying life event');
    expect(result.answer).toContain('Workday');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('replays monthly premium numbers directly when the user asks to see the numbers again', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Across all of the medical plans available in WA, Kaiser Standard HMO has the lowest deductible and the lowest out-of-pocket max overall.',
    });

    const result = await runQaV2Engine({
      query: 'show me how much i have to pay each month on each plan',
      session,
    });

    expect(result.answer).toContain('Here are the monthly medical premiums for Employee + Child(ren) coverage in WA');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('Kaiser Standard HMO');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('supports a bare "yes, do that" after monthly premium replay offers the deductible tradeoff next', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Across all of the medical plans available in WA, Kaiser Standard HMO has the lowest deductible and the lowest out-of-pocket max overall.',
    });

    await runQaV2Engine({
      query: 'show me how much i have to pay each month on each plan',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('Deductible');
    expect(result.answer).toContain('Out-of-pocket max');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('supports a bare "yes, do that" after a medical term explanation offers a copay comparison next', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'Medical plan options (Employee Only):',
    });

    await runQaV2Engine({
      query: 'what is a copay?',
      session,
    });

    const result = await runQaV2Engine({
      query: 'yes, do that',
      session,
    });

    expect(result.answer).toContain('copays and point-of-service cost sharing comparison');
    expect(result.answer).toContain('primary care');
    expect(result.answer).toContain('specialist');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('answers direct coverage-tier questions instead of replaying generic medical scaffolding', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
    });

    const result = await runQaV2Engine({
      query: 'what are the tiers?',
      session,
    });

    expect(result.answer).toContain('A coverage tier is the level of people you are enrolling');
    expect(result.answer).toContain('Employee + Child(ren)');
    expect(result.answer).not.toContain('We can stay with medical');
  });

  it('keeps employee-plus-children pricing separate from employee-plus-family pricing', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      familyDetails: { numChildren: 2 },
      coverageTierLock: 'Employee + Child(ren)',
      lastBotMessage: 'Projected Healthcare Costs for Employee + Family coverage in Washington (moderate usage):',
    });

    const result = await runQaV2Engine({
      query: 'estimate the costs for employee + 2 kids',
      session,
    });

    expect(result.answer).toContain('Projected Healthcare Costs for Employee + Child(ren) coverage');
    expect(result.answer).not.toContain('Projected Healthcare Costs for Employee + Family coverage');
  });

  it('narrows life-versus-disability directly when the user asks which extra protection matters more', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Disability coverage is meant to protect part of your income if you cannot work because of illness or injury.',
    });

    const result = await runQaV2Engine({
      query: 'so, if amerivet gives me $25 life insurance, if i spend on something additional, should it be more life insurance, or disability?',
      session,
    });

    expect(result.answer).toContain('choosing between more life insurance and disability');
    expect(result.answer).toContain('disability first');
    expect(result.answer).not.toContain('Life insurance options:');
  });

  it('narrows across accident, critical illness, and disability instead of defaulting to one stale supplemental topic', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- **Unum Basic Life & AD&D**',
    });

    const result = await runQaV2Engine({
      query: "you're supposed to help me narrow down whether accident, critical illness, or disability is the most relevant next step for my situation.",
      session,
    });

    expect(result.answer).toContain('narrow down disability versus the smaller supplemental cash benefits');
    expect(result.answer).toContain('disability first');
    expect(result.answer).not.toContain('Critical illness coverage is a supplemental benefit');
  });

  it('switches from stale hsa/fsa context back into medical compare and heavy-usage recommendation without keeping the old plan lean', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      selectedPlan: 'Standard HSA',
      pendingGuidancePrompt: 'hsa_vs_fsa',
      pendingGuidanceTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    });

    const compare = await runQaV2Engine({
      query: 'no - go back to medical and compare the plans for my family',
      session,
    });

    expect(compare.answer).toContain('Here is the practical tradeoff across AmeriVet\'s medical options');
    expect(session.currentTopic).toBe('Medical');
    expect(session.coverageTierLock).toBe('Employee + Family');
    expect(session.pendingGuidancePrompt).toBeUndefined();
    expect(session.pendingGuidanceTopic).toBeUndefined();

    const recommendation = await runQaV2Engine({
      query: 'which one is better if we expect a lot of care?',
      session,
    });

    expect(recommendation.answer).toContain('My recommendation: Enhanced HSA');
    expect(recommendation.answer).not.toContain('My recommendation: Standard HSA');
    expect(session.selectedPlan).toBeUndefined();
  });

  it('clears stale selected-plan memory when the user pressure-tests enhanced for heavier specialist use', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      selectedPlan: 'Standard HSA',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
    });

    const result = await runQaV2Engine({
      query: 'i know i said standard before, but make the case for enhanced if we expect more specialist visits',
      session,
    });

    expect(result.answer).toContain('My recommendation: Enhanced HSA');
    expect(result.answer).not.toContain('My recommendation: Standard HSA');
    expect(session.selectedPlan).toBeUndefined();
  });

  it('recommends enhanced when the user describes recurring therapy usage in plain language', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
    });

    const result = await runQaV2Engine({
      query: 'which plan do you recommend if i see a therapist twice a month?',
      session,
    });

    expect(result.answer).toContain('My recommendation: Enhanced HSA');
    expect(result.answer).toContain('more than minimal usage');
    expect(result.answer).not.toContain('Quick clarifier');
  });

  it('recommends enhanced when the user asks for more predictable costs instead of falling back to a clarifier', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
    });

    const result = await runQaV2Engine({
      query: 'which plan do you recommend if i want more predictable costs and less deductible risk?',
      session,
    });

    expect(result.answer).toContain('My recommendation: Enhanced HSA');
    expect(result.answer).toContain('Because you said more predictable costs matter');
    expect(result.answer).not.toContain('Quick clarifier');
  });

  it('recommends standard when the user says lower premiums matter more and they can tolerate more risk', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
    });

    const result = await runQaV2Engine({
      query: 'which plan do you recommend if i can handle more risk to keep premiums lower?',
      session,
    });

    expect(result.answer).toContain('My recommendation: Standard HSA');
    expect(result.answer).toContain('Because you said you can tolerate more cost risk to keep premiums lower');
    expect(result.answer).not.toContain('Quick clarifier');
  });

  it('overwrites spouse memory when the user corrects the household down to employee-plus-children pricing', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Projected Healthcare Costs for Employee + Family coverage in Washington (moderate usage):',
    });

    const result = await runQaV2Engine({
      query: 'actually it is just me and the 2 kids now, so show me the employee + child pricing',
      session,
    });

    expect(result.answer).toContain('Here are the monthly medical premiums for Employee + Child(ren) coverage');
    expect(session.coverageTierLock).toBe('Employee + Child(ren)');
    expect(session.familyDetails).toEqual({ hasSpouse: false, numChildren: 2 });
  });

  it('refreshes the medical view when the user corrects the household without asking a second medical question', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      familyDetails: {},
      lastBotMessage: 'A coverage tier is the level of people you are enrolling.',
    });

    const result = await runQaV2Engine({
      query: 'oh okay, no i have 2 kids',
      session,
    });

    expect(result.answer).toContain('updated the household to **Employee + Child(ren)** coverage');
    expect(result.answer).toContain('Medical plan options (Employee + Child(ren))');
    expect(result.answer).not.toContain('We can stay with medical');
    expect(session.coverageTierLock).toBe('Employee + Child(ren)');
    expect(session.familyDetails).toEqual({ numChildren: 2 });
  });

  it('routes compare-standard-hsa-versus-kaiser asks back into medical comparison even from active hsa/fsa context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:',
    });

    const result = await runQaV2Engine({
      query: 'yeah - compare the Standard HSA with the Kaiser plan',
      session,
    });

    expect(result.answer).toMatch(/Here is (?:the practical tradeoff across AmeriVet's medical options|a side-by-side comparison)/);
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).toContain('Kaiser Standard HMO');
    expect(result.answer).not.toContain('FSA is usually the more natural pre-tax account');
    expect(result.answer).not.toContain('HSA/FSA overview');
  });

  it('routes just-wanna-see-the-plans asks back into medical even when the user explicitly declines hsa/fsa talk', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:',
    });

    const result = await runQaV2Engine({
      query: "i don't really care about hsa fsa stuff yet. i just wanna see the plans",
      session,
    });

    expect(result.answer).toMatch(/(?:Here is the practical tradeoff across AmeriVet's medical options|Here is a side-by-side comparison|Here are the monthly medical premiums|Medical plan options)/);
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('HSA/FSA overview');
    expect(result.answer).not.toContain('FSA is usually the more natural pre-tax account');
  });

  it('treats just-plan-pricing asks as medical pivots even from life-insurance context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    });

    const result = await runQaV2Engine({
      query: 'what about just plan pricing?',
      session,
    });

    expect(result.answer).toMatch(/(?:Here are the monthly medical premiums|Medical plan options|Here is a side-by-side comparison|Here is the practical tradeoff across AmeriVet's medical options)/);
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('Life insurance options:');
    expect(result.answer).not.toContain('Voluntary Term Life');
  });

  it('lets plan-pricing pivots override rx self-service detours and return to core medical premiums', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'For exact prescription tiers or drug-pricing details, I would use Workday as the starting point rather than guess from memory.\n\nIf you want, I can still compare the medical options at a high level for someone who expects ongoing prescriptions.',
    });

    const result = await runQaV2Engine({
      query: 'what about just plan pricing?',
      session,
    });

    expect(result.answer).toMatch(/(?:Here are the monthly medical premiums|Medical plan options|Here is a side-by-side comparison|Here is the practical tradeoff across AmeriVet's medical options)/);
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('Workday');
    expect(result.answer).not.toContain('ongoing prescriptions');
  });

  it('treats employee-plus-spouse premium asks as medical pivots even from HSA/FSA context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      coverageTierLock: 'Employee + Spouse',
      familyDetails: { hasSpouse: true, numChildren: 0 },
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    });

    const result = await runQaV2Engine({
      query: 'show me the employee + spouse premiums',
      session,
    });

    expect(result.answer).toContain('Here are the monthly medical premiums for Employee + Spouse coverage');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('HSA/FSA overview');
    expect(result.answer).not.toContain('FSA is usually the cleaner fit');
  });

  it('treats family-price asks as medical pivots even from disability context', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Disability is really paycheck protection.',
    });

    const result = await runQaV2Engine({
      query: 'show me the family prices',
      session,
    });

    expect(result.answer).toContain('Here are the monthly medical premiums for Employee + Family coverage');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('Disability is really paycheck protection');
  });

  it('answers whole-family premium asks as medical pricing replays instead of generic guidance', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
    });

    const result = await runQaV2Engine({
      query: 'actually i just want to see how much the premiums are for my whole family',
      session,
    });

    expect(result.answer).toContain('Here are the monthly medical premiums for Employee + Family coverage');
    expect(result.answer).toContain('Standard HSA');
    expect(result.answer).not.toContain('A useful next medical step is usually one of these');
  });

  it('treats other-than-life followups as a move past life instead of replaying life options', async () => {
    const session = makeSession({
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance'],
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'A useful next life-insurance step is usually one of these:\n\n- Whether life or disability matters more first\n- How much protection is worth paying for if your family relies on your income',
    });

    const result = await runQaV2Engine({
      query: 'no - like other than life insurance',
      session,
    });

    expect(result.answer).toContain('disability');
    expect(result.answer).not.toContain('Life insurance options:');
  });
});
