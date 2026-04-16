import { describe, expect, it } from 'vitest';

import type { Session } from '@/lib/rag/session-store';
import { runQaV2Engine } from '@/lib/qa-v2/engine';

type ReplayTurn = {
  user: string;
  mustContain?: string[];
  mustNotContain?: string[];
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    step: 'active_chat',
    context: {},
    ...overrides,
  };
}

async function replayTranscript(turns: ReplayTurn[], session: Session) {
  const transcript: Array<{ user: string; answer: string }> = [];

  for (const turn of turns) {
    const result = await runQaV2Engine({ query: turn.user, session });
    transcript.push({ user: turn.user, answer: result.answer });

    for (const fragment of turn.mustContain || []) {
      expect(
        result.answer,
        `Expected reply to contain "${fragment}" for user turn "${turn.user}".\n\nActual reply:\n${result.answer}`,
      ).toContain(fragment);
    }

    for (const fragment of turn.mustNotContain || []) {
      expect(
        result.answer,
        `Expected reply to avoid "${fragment}" for user turn "${turn.user}".\n\nActual reply:\n${result.answer}`,
      ).not.toContain(fragment);
    }
  }

  return transcript;
}

describe('qa-v2 transcript replays', () => {
  it('replays a medical recommendation into compare flow without drifting tone or topic', async () => {
    await replayTranscript(
      [
        {
          user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
          mustContain: ['Recommendation for Employee + Family coverage', 'My recommendation: Standard HSA'],
        },
        {
          user: 'yes, please compare',
          mustContain: ['Projected Healthcare Costs for Employee + Family coverage'],
          mustNotContain: ['like a benefits counselor'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 45,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays package-level guidance and keeps it decision-oriented instead of reprinting the menu', async () => {
    await replayTranscript(
      [
        {
          user: 'please help me think through which one of these benefits is worth considering for my situation.',
          mustContain: ['what is actually worth attention first', 'Medical first', 'family income'],
          mustNotContain: ['Here are the benefits available to you as an AmeriVet employee', 'like a benefits counselor'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 45,
        userState: 'GA',
        dataConfirmed: true,
      }),
    );
  });

  it('replays family-oriented narrowing after general benefit guidance', async () => {
    await replayTranscript(
      [
        {
          user: 'please help me think through which one of these benefits is worth considering for my situation.',
          mustContain: ['what is actually worth attention first'],
        },
        {
          user: 'what about for our family?',
          mustContain: ['If protecting your family is the top priority', 'disability next', 'life insurance right after that'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays cost-oriented narrowing after general benefit guidance', async () => {
    await replayTranscript(
      [
        {
          user: 'please help me think through which one of these benefits is worth considering for my situation.',
          mustContain: ['what is actually worth attention first'],
        },
        {
          user: 'we mostly care about cost',
          mustContain: ['If keeping healthcare costs down is the priority', 'Focus on medical first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays routine-stuff shorthand into routine-care narrowing', async () => {
    await replayTranscript(
      [
        {
          user: 'please help me think through which one of these benefits is worth considering for my situation.',
          mustContain: ['what is actually worth attention first'],
        },
        {
          user: 'routine stuff',
          mustContain: ['If routine care is what matters most', 'Look at dental next'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays hsa and supplemental follow-ups as direct explanations', async () => {
    await replayTranscript(
      [
        {
          user: 'can you tell me about hsa/fsa?',
          mustContain: ['Health Savings Account', 'Flexible Spending Account'],
        },
        {
          user: 'what does hsa mean?',
          mustContain: ['HSA stands for **Health Savings Account**'],
          mustNotContain: ['HSA/FSA overview'],
        },
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 45,
        userState: 'GA',
        dataConfirmed: true,
      }),
    );
  });

  it('replays dental follow-ups through orthodontia and a vision pivot cleanly', async () => {
    await replayTranscript(
      [
        {
          user: 'dental please',
          mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
        },
        {
          user: "what's an orthodontia rider?",
          mustContain: ['orthodontia rider means', 'braces'],
          mustNotContain: ['like a benefits counselor'],
        },
        {
          user: 'yes - show me what i can get for vision',
          mustContain: ['Vision coverage: **VSP Vision Plus**'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 45,
        userState: 'GA',
        dataConfirmed: true,
      }),
    );
  });

  it('replays state-heavy turns without defaulting to ME or IN from ordinary words', async () => {
    const session = makeSession({
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
    });

    await replayTranscript(
      [
        {
          user: 'what are all the benefits i have access to?',
          mustContain: ['45 in GA'],
          mustNotContain: ['45 in ME', '45 in IN'],
        },
        {
          user: 'Help me calculate healthcare costs for next year. My household is family4+, usage level is high, and I prefer kaiser network. Please recommend plans and estimate costs.',
          mustContain: ['Employee + Family coverage', 'Georgia'],
          mustNotContain: ['Maine', 'Indiana'],
        },
        {
          user: "i'm in GA",
          mustNotContain: ['Perfect! 45 in IN', 'Perfect! 45 in ME'],
        },
      ],
      session,
    );
  });

  it('replays household medical follow-ups without losing direct intent or pregnancy context', async () => {
    await replayTranscript(
      [
        {
          user: 'medical please',
          mustContain: ['Medical plan options'],
        },
        {
          user: 'my wife is pregnant',
          mustContain: ['maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'what gives us the lowest out of pocket?',
          mustContain: ['Kaiser Standard HMO', 'lowest likely maternity-related out-of-pocket exposure', 'Enhanced HSA'],
          mustNotContain: ['Quick clarifier'],
        },
        {
          user: 'other than medical, what are the supplemental benefits?',
          mustContain: ['supplemental benefits are the optional add-ons', 'Life Insurance', 'Disability'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays chosen-plan continuity into direct supplemental counseling', async () => {
    await replayTranscript(
      [
        {
          user: "is critical illness worth it if i'm the sole breadwinner?",
          mustContain: ['critical illness', 'sole breadwinner', 'not yet'],
          mustNotContain: ['Recommendation for Employee + Family coverage'],
        },
        {
          user: "what's next?",
          mustContain: ['life insurance', 'bigger household-protection decision'],
          mustNotContain: ['optional supplemental coverage'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Family',
        selectedPlan: 'Standard HSA',
      }),
    );
  });

  it('replays package guidance from a settled medical choice into the matching tax-account next step', async () => {
    await replayTranscript(
      [
        {
          user: 'what else should i consider?',
          mustContain: ['Because you are leaning toward **Enhanced HSA**', 'HSA/FSA'],
          mustNotContain: ['dental/vision if you want to round out routine care coverage'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        completedTopics: ['Medical'],
        selectedPlan: 'Enhanced HSA',
      }),
    );
  });

  it('replays family medical guidance without skipping routine-care next steps', async () => {
    await replayTranscript(
      [
        {
          user: 'what else should i consider?',
          mustContain: ['split the next step after medical into two lanes', '**dental**', '**life insurance**', 'default nudge here is usually **dental first**'],
          mustNotContain: ['the next most useful step after medical is usually **life insurance**'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        completedTopics: ['Medical'],
        coverageTierLock: 'Employee + Child(ren)',
        familyDetails: { numChildren: 2 },
        lastBotMessage: 'Medical plan options (Employee + Child(ren)):',
      }),
    );
  });

  it('replays a bare "yes, do that" after family medical guidance into dental details', async () => {
    await replayTranscript(
      [
        {
          user: 'what else should i consider?',
          mustContain: ['split the next step after medical into two lanes', '**dental**', '**life insurance**', 'default nudge here is usually **dental first**'],
        },
        {
          user: 'yes, do that',
          mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
          mustNotContain: ['Life insurance options:'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        completedTopics: ['Medical'],
        coverageTierLock: 'Employee + Child(ren)',
        familyDetails: { numChildren: 2 },
        lastBotMessage: 'Medical plan options (Employee + Child(ren)):',
      }),
    );
  });

  it('replays package guidance from settled routine care into household-protection next steps', async () => {
    await replayTranscript(
      [
        {
          user: 'what should i look at next?',
          mustContain: ['routine care questions look more settled', 'life insurance', 'take you straight into **life insurance** next'],
          mustNotContain: ['dental is the natural companion', 'vision is the natural companion'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Vision',
        completedTopics: ['Medical', 'Dental', 'Vision'],
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        selectedPlan: 'Enhanced HSA',
      }),
    );
  });

  it('replays package guidance from family HSA/FSA follow-ups into protection instead of looping back to medical', async () => {
    await replayTranscript(
      [
        {
          user: "what's next?",
          mustContain: ['life insurance', 'household protection is usually the bigger remaining decision'],
          mustNotContain: ['Going back to your medical choice'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        completedTopics: ['Medical', 'HSA/FSA'],
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        selectedPlan: 'Standard HSA',
      }),
    );
  });

  it('replays a bare "yes, do that" after settled-medical package guidance into HSA/FSA overview', async () => {
    await replayTranscript(
      [
        {
          user: 'what else should i consider?',
          mustContain: ['Because you are leaning toward **Enhanced HSA**', 'HSA/FSA'],
        },
        {
          user: 'yes, do that',
          mustContain: ['HSA is usually the cleaner fit', 'tax account aligned'],
          mustNotContain: ['Because you are leaning toward **Enhanced HSA**'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        completedTopics: ['Medical'],
        selectedPlan: 'Enhanced HSA',
      }),
    );
  });

  it('replays a bare "yes, do that" after settled routine-care guidance into life insurance details', async () => {
    await replayTranscript(
      [
        {
          user: 'what should i look at next?',
          mustContain: ['routine care questions look more settled', 'life insurance'],
        },
        {
          user: 'yes, do that',
          mustContain: ['Life insurance options:', 'Unum Basic Life & AD&D'],
          mustNotContain: ['routine care questions look more settled'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Vision',
        completedTopics: ['Medical', 'Dental', 'Vision'],
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        selectedPlan: 'Enhanced HSA',
      }),
    );
  });

  it('replays a bare "yes, do that" after life package guidance into the life-versus-disability comparison', async () => {
    await replayTranscript(
      [
        {
          user: 'what else should i consider?',
          mustContain: ['most useful next comparison is usually **disability**'],
        },
        {
          user: 'yes, do that',
          mustContain: ['simplest way to separate life insurance from disability'],
          mustNotContain: ['Disability coverage is meant to protect part of your income'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        completedTopics: ['Medical', 'Life Insurance'],
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        selectedPlan: 'Enhanced HSA',
      }),
    );
  });

  it('replays a bare "yes, do that" after disability package guidance into the life-versus-disability comparison', async () => {
    await replayTranscript(
      [
        {
          user: 'what else should i consider?',
          mustContain: ['most useful companion benefit is usually **life insurance**'],
        },
        {
          user: 'yes, do that',
          mustContain: ['simplest way to separate life insurance from disability'],
          mustNotContain: ['Life insurance options:'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'Disability',
        completedTopics: ['Medical', 'Disability'],
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        selectedPlan: 'Enhanced HSA',
      }),
    );
  });

  it('replays direct HSA/FSA fit questions as grounded practical answers', async () => {
    await replayTranscript(
      [
        {
          user: 'tell me about hsa/fsa',
          mustContain: ['Health Savings Account', 'Flexible Spending Account'],
        },
        {
          user: 'which one is better if i want to spend the money this year?',
          mustContain: ['FSA is usually the cleaner fit'],
          mustNotContain: ['HSA/FSA overview'],
        },
        {
          user: 'what if we are leaning toward standard hsa?',
          mustContain: ['Standard HSA', 'HSA is usually the cleaner fit'],
          mustNotContain: ['HSA/FSA overview'],
        },
        {
          user: 'long-term savings',
          mustContain: ['HSA is usually the cleaner fit', 'compare **Standard HSA** versus **Enhanced HSA** next'],
          mustNotContain: ['We can stay with HSA/FSA'],
        },
        {
          user: 'yes, do that',
          mustContain: ['long-term HSA savings', 'Standard HSA', 'Enhanced HSA'],
          mustNotContain: ['We can stay with HSA/FSA'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 33,
        userState: 'GA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
      }),
    );
  });

  it('replays partial onboarding demographics with a plain state abbreviation and later correction', async () => {
    await replayTranscript(
      [
        {
          user: 'Matthew',
          mustContain: ['share your age and state next'],
        },
        {
          user: '39, CO',
          mustContain: ['Perfect! 39 in CO.'],
        },
        {
          user: "Actually, I'm in oregon",
          mustContain: ['updated your state to OR'],
          mustNotContain: ['updated your state to IN', 'updated your state to ME'],
        },
      ],
      makeSession(),
    );

    const partialSession = makeSession({
      userName: 'Matthew',
      hasCollectedName: true,
      userAge: 39,
      askedForDemographics: true,
    });

    await replayTranscript(
      [
        {
          user: 'Co',
          mustContain: ['Perfect! 39 in CO.'],
          mustNotContain: ['I just need your state'],
        },
        {
          user: 'Colorado',
          mustContain: ['I have you in CO'],
        },
        {
          user: 'Actually, I’m in oregon',
          mustContain: ['updated your state to OR'],
          mustNotContain: ['updated your state to IN', 'updated your state to ME'],
        },
      ],
      partialSession,
    );
  });

  it('replays an explicit name correction during onboarding and then continues into medical cleanly', async () => {
    const session = makeSession({ step: 'start' });

    await replayTranscript(
      [
        {
          user: 'Sarah',
          mustContain: ['share your age and state next'],
        },
        {
          user: "actually, i'm Melodie",
          mustContain: ['updated your name to Melodie', 'age and state'],
        },
        {
          user: '35, FL',
          mustContain: ['Perfect! 35 in FL.'],
        },
        {
          user: 'medical please',
          mustContain: ['Medical plan options'],
        },
      ],
      session,
    );

    expect(session.userName).toBe('Melodie');
    expect(session.currentTopic).toBe('Medical');
  });

  it('replays a no-topic state correction straight into the requested topic instead of stopping at the correction', async () => {
    const session = makeSession({
      userName: 'Guy',
      hasCollectedName: true,
      userAge: 43,
      userState: 'TX',
      dataConfirmed: true,
    });

    await replayTranscript(
      [
        {
          user: "actually, i'm in WA. medical please",
          mustContain: ['updated your state to WA', 'updated medical view', 'Medical plan options'],
        },
      ],
      session,
    );

    expect(session.userState).toBe('WA');
    expect(session.currentTopic).toBe('Medical');
  });

  it('replays decision guidance into focused follow-ups instead of generic fallback', async () => {
    await replayTranscript(
      [
        {
          user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
          mustContain: ['protecting your family', 'disability next', 'life insurance right after that'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
        {
          user: 'routine care',
          mustContain: ['If routine care is what matters most', 'dental next', 'vision after that'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays accident follow-ups without drifting into critical illness ownership', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'what is it not for?',
          mustContain: ['What Accident/AD&D is not'],
          mustNotContain: ['What critical illness is not'],
        },
      ],
      makeSession({
        userName: 'Mandy',
        hasCollectedName: true,
        userAge: 27,
        userState: 'CT',
        dataConfirmed: true,
        currentTopic: 'Critical Illness',
      }),
    );
  });

  it('replays critical illness add-on counseling without snapping back to medical recommendation', async () => {
    await replayTranscript(
      [
        {
          user: 'and should i add critical illness to that?',
          mustContain: ['critical illness', 'medical first'],
          mustNotContain: ['ask that one a little more specifically'],
        },
        {
          user: "based on my family size and overall health, and the fact that i'm choosing the standard plan, should i get critical illness insurance, especially considering i'm the sole bread-winner for my family?",
          mustContain: ['critical illness', 'sole breadwinner'],
          mustNotContain: ['Recommendation for Employee + Spouse coverage'],
        },
      ],
      makeSession({
        userName: 'Mandy',
        hasCollectedName: true,
        userAge: 27,
        userState: 'CT',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Spouse',
        messages: [
          { role: 'assistant', content: 'My recommendation: Standard HSA.' },
          { role: 'user', content: "based on my family size and overall health, and the fact that i'm choosing the standard plan" },
        ],
      }),
    );
  });

  it('replays medical detail questions as source-backed answers instead of contextual fallback', async () => {
    await replayTranscript(
      [
        {
          user: 'medical',
          mustContain: ['Medical plan options (Employee Only)'],
        },
        {
          user: "what's a coverage tier?",
          mustContain: ['A coverage tier is just the level of people you are enrolling', 'Employee + Family'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: "okay, let's compare the plan tradeoffs",
          mustContain: ['Here is the practical tradeoff across AmeriVet\'s medical options', 'Standard HSA', 'Enhanced HSA'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'what are the copays for the standard plan?',
          mustContain: ['Standard HSA', 'primary care'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays maternity follow-ups as medical detail answers instead of generic loops', async () => {
    await replayTranscript(
      [
        {
          user: 'my wife is pregnant',
          mustContain: ['Here is the maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'what coverage will we get for maternity coverage on the 2 different plans?',
          mustContain: ['Here is the maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'i want to know about maternity coverage',
          mustContain: ['Here is the maternity coverage comparison'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays practical medical-detail follow-ups from the source-backed summaries instead of looping', async () => {
    await replayTranscript(
      [
        {
          user: 'medical',
          mustContain: ['Medical plan options (Employee Only)'],
        },
        {
          user: "what's a coverage tier?",
          mustContain: ['A coverage tier is just the level of people you are enrolling'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: "okay, let's compare the plan tradeoffs",
          mustContain: ['Here is the practical tradeoff across AmeriVet\'s medical options'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'what are the copays for the standard plan?',
          mustContain: ['Standard HSA point-of-service cost sharing', 'Primary care'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'my wife is pregnant',
          mustContain: ['maternity', 'Standard HSA', 'Enhanced HSA'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'what about prescriptions on the standard plan?',
          mustContain: ['Standard HSA', 'do not want to guess'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'what is the in-network versus out-of-network difference on these plans?',
          mustContain: ['in-network', 'out-of-network'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'what does the standard plan cover?',
          mustContain: ['Standard HSA coverage snapshot', 'Source-backed plan features'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'what about virtual visits on the standard plan?',
          mustContain: ['Standard HSA', 'virtual visits'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays direct family medical recommendation questions as recommendations instead of stale medical scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: "which plan is best for my family if we're pretty healthy but we're also having a baby?",
          mustContain: ['My recommendation', 'Standard HSA'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Mandy',
        hasCollectedName: true,
        userAge: 27,
        userState: 'CT',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays direct supplemental overview questions from a stale routine-care topic without getting trapped there', async () => {
    await replayTranscript(
      [
        {
          user: 'what are the supplemental benefits? are they free?',
          mustContain: ["AmeriVet's supplemental benefits are the optional add-ons", 'Basic Life & AD&D is employer-paid', 'employee-paid'],
          mustNotContain: ['We can stay with vision'],
        },
        {
          user: 'no, tell me what the supplemental benefits are',
          mustContain: ['Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D'],
          mustNotContain: ['We can stay with vision'],
        },
      ],
      makeSession({
        userName: 'Thomas',
        hasCollectedName: true,
        userAge: 56,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'Vision',
      }),
    );
  });

  it('replays spouse life-coverage and FSA compatibility questions as direct answers instead of broad category cards', async () => {
    await replayTranscript(
      [
        {
          user: 'life insurance info',
          mustContain: ['Life insurance options'],
        },
        {
          user: 'would the life insurance also cover my wife?',
          mustContain: ['voluntary term life', 'spouse'],
          mustNotContain: ['Life insurance options:'],
        },
        {
          user: 'tell me about hsa/fsa',
          mustContain: ['HSA/FSA overview'],
        },
        {
          user: 'can i use fsa with kaiser?',
          mustContain: ['Kaiser Standard HMO', 'FSA is usually the more natural pre-tax account'],
          mustNotContain: ['HSA/FSA overview:'],
        },
      ],
      makeSession({
        userName: 'Thomas',
        hasCollectedName: true,
        userAge: 56,
        userState: 'CO',
        dataConfirmed: true,
      }),
    );
  });

  it('replays direct life-default and life-amount questions as counselor-style answers instead of broad category cards', async () => {
    await replayTranscript(
      [
        {
          user: 'life insurance info',
          mustContain: ['Life insurance options'],
        },
        {
          user: 'if i do nothing, what life insurance do i get?',
          mustContain: ['Basic Life & AD&D', '$25,000', 'employer-paid'],
          mustNotContain: ['Life insurance options:'],
        },
        {
          user: 'can you help me decide how much voluntary term life i should get?',
          mustContain: ['practical way I would decide how much life insurance to add', 'Voluntary Term Life', '$25,000'],
          mustNotContain: ['Life insurance options:'],
        },
        {
          user: 'are any of those life insurance plans something i just get without having to pay more?',
          mustContain: ['Basic Life & AD&D', '$25,000', 'employer-paid'],
          mustNotContain: ['Life insurance options:'],
        },
        {
          user: 'can you help me determine how much voluntary term life insurance i should get?',
          mustContain: ['practical way I would decide how much life insurance to add', 'Voluntary Term Life', '$25,000'],
          mustNotContain: ['Here is the practical takeaway on **Voluntary Term Life**', 'Life insurance options:'],
        },
      ],
      makeSession({
        userName: 'Thomas',
        hasCollectedName: true,
        userAge: 56,
        userState: 'CO',
        dataConfirmed: true,
        familyDetails: { hasSpouse: true, numChildren: 2 },
      }),
    );
  });

  it('replays hsa/fsa recommendation followups as direct advice instead of the generic next-question menu', async () => {
    await replayTranscript(
      [
        {
          user: 'tell me about hsa/fsa',
          mustContain: ['HSA/FSA overview:'],
        },
        {
          user: 'can i use fsa with a hsa plan though?',
          mustContain: ['current plan year', 'HSA-qualified medical plan'],
          mustNotContain: ['A useful next HSA/FSA question is usually one of these'],
        },
        {
          user: 'so what do you recommend to me?',
          mustContain: ['My practical take', 'HSA'],
          mustNotContain: ['A useful next HSA/FSA question is usually one of these'],
        },
      ],
      makeSession({
        userName: 'Thomas',
        hasCollectedName: true,
        userAge: 56,
        userState: 'CO',
        dataConfirmed: true,
      }),
    );
  });

  it('replays hsa/fsa move-back requests into medical options instead of staying trapped in tax-account scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: 'i just want to see the plans side by side',
          mustContain: ['Here is the practical tradeoff across AmeriVet\'s medical options', 'Standard HSA', 'Enhanced HSA'],
          mustNotContain: ['HSA/FSA overview'],
        },
        {
          user: "nope. i'm done with hsa/fsa. i want to go back to my medical plan options",
          mustContain: ['Medical plan options'],
          mustNotContain: ['HSA/FSA overview'],
        },
      ],
      makeSession({
        userName: 'Thomas',
        hasCollectedName: true,
        userAge: 56,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
      }),
    );
  });

  it('replays life overview and priority follow-ups without looping the same life scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: "what's available to me?",
          mustContain: ['Life insurance options:', 'Unum Basic Life & AD&D'],
          mustNotContain: ['We can stay with life insurance'],
        },
        {
          user: 'ok. which matters more first?',
          mustContain: ['simplest way to separate life insurance from disability'],
          mustNotContain: ['We can stay with life insurance'],
        },
      ],
      makeSession({
        userName: 'Thomas',
        hasCollectedName: true,
        userAge: 56,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
      }),
    );
  });

  it('replays stale-topic direct questions as concrete answers instead of vision scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: 'what life insurance benefits do i have?',
          mustContain: ['Life insurance options:', 'Unum Basic Life & AD&D'],
          mustNotContain: ['We can stay with vision'],
        },
        {
          user: 'which plan is best for my family?',
          mustContain: ['recommend'],
          mustNotContain: ['We can stay with vision'],
        },
      ],
      makeSession({
        userName: 'Thomas',
        hasCollectedName: true,
        userAge: 56,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'Vision',
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays bare pivots and "next" phrasing into the requested supplemental topic instead of stale-topic scaffolding', async () => {
    const session = makeSession({
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Dental', 'Vision'],
      lastBotMessage: 'Since you have already looked at dental too, the next most useful area is usually:\n\n- life, disability, or supplemental protection',
    });

    await replayTranscript(
      [
        {
          user: 'life',
          mustContain: ['Life insurance options:'],
          mustNotContain: ['We can stay with vision'],
        },
        {
          user: 'ok lets do disability next',
          mustContain: ['Disability coverage is meant to protect part of your income'],
          mustNotContain: ['We can stay with life insurance', 'Please ask that one a little more specifically'],
        },
      ],
      session,
    );
  });

  it('replays "life next please" as a direct supplemental pivot instead of asking for a more specific life question', async () => {
    await replayTranscript(
      [
        {
          user: 'life next please',
          mustContain: ['Life insurance options:'],
          mustNotContain: ['We can stay with vision', 'Please ask that one a little more specifically'],
        },
      ],
      makeSession({
        userName: 'Madeline',
        hasCollectedName: true,
        userAge: 29,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'Vision',
        completedTopics: ['Dental', 'Vision'],
        lastBotMessage: 'If routine care questions are settled, the next most useful area is usually life, disability, or supplemental benefits.',
      }),
    );
  });

  it('replays repeated supplemental worth-adding questions as practical guidance instead of looping', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'how do i know if i should get that?',
          mustContain: ['My practical take'],
          mustNotContain: ['We can stay with supplemental protection'],
        },
        {
          user: "yeah- how do i know if it's worth adding?",
          mustContain: ['My practical take'],
          mustNotContain: ['usually worth considering when one of these sounds true'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
      }),
    );
  });

  it('replays organic critical-illness recall after package guidance instead of falling back', async () => {
    await replayTranscript(
      [
        {
          user: 'medical',
          mustContain: ['Medical plan options (Employee Only)'],
        },
        {
          user: 'no, i’m done with medical. what else should i be thinking about?',
          mustContain: ['**Dental**', 'Life insurance'],
        },
        {
          user: "wasn't there one about illness?",
          mustContain: ['Critical illness coverage'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays organic worth-it follow-ups for vision and supplemental topics without looping to menus', async () => {
    await replayTranscript(
      [
        {
          user: 'vision please',
          mustContain: ['Vision coverage: **VSP Vision Plus**'],
        },
        {
          user: "how do i know if it's useful?",
          mustContain: ['Vision is usually worth adding', 'one vision plan'],
          mustNotContain: ['We can stay with vision'],
        },
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: "yeah- how do i know if it's worth adding?",
          mustContain: ['My practical take'],
          mustNotContain: ['We can stay with supplemental protection'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
      }),
    );
  });

  it('replays medical-to-critical-illness recommendation follow-through without snapping back to medical', async () => {
    await replayTranscript(
      [
        {
          user: 'medical',
          mustContain: ['Medical plan options (Employee Only)'],
        },
        {
          user: "i'm married and have 3 kids, thank you very much. let's compare the plan tradeoffs",
          mustContain: ['Employee + Family premium', 'Standard HSA', 'Enhanced HSA'],
        },
        {
          user: 'and should i add critical illness to that?',
          mustContain: ['critical illness'],
          mustNotContain: ['ask that one a little more specifically', 'Recommendation for Employee + Family coverage'],
        },
        {
          user: "based on my family size and overall health, and the fact that i'm choosing the standard plan, should i get critical illness insurance, especially considering i'm the sole bread-winner for my family?",
          mustContain: ['critical illness'],
          mustNotContain: ['Recommendation for Employee + Family coverage'],
        },
        {
          user: 'so... with my situation, what do you recommend?',
          mustContain: ['critical illness'],
          mustNotContain: ['Recommendation for Employee + Family coverage'],
        },
      ],
      makeSession({
        userName: 'Mandy',
        hasCollectedName: true,
        userAge: 27,
        userState: 'CT',
        dataConfirmed: true,
      }),
    );
  });

  it('replays routine-care comparison questions in context instead of hard-pivoting back into plan cards', async () => {
    await replayTranscript(
      [
        {
          user: 'dental please',
          mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
        },
        {
          user: 'okay, tell me about your vision options',
          mustContain: ['Vision coverage: **VSP Vision Plus**'],
        },
        {
          user: 'how can i tell which one matters more?',
          mustContain: ['deciding between dental and vision as the next add-on'],
          mustNotContain: ['Vision coverage: **VSP Vision Plus**'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
      }),
    );
  });

  it('replays organic routine-care decision questions as guidance instead of hard pivots to a plan card', async () => {
    await replayTranscript(
      [
        {
          user: 'dental please',
          mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
        },
        {
          user: 'okay, tell me about your vision options',
          mustContain: ['Vision coverage: **VSP Vision Plus**'],
        },
        {
          user: 'is that the only option?',
          mustContain: ['one vision plan', 'worth adding at all'],
          mustNotContain: ['We can stay with vision'],
        },
        {
          user: 'do you recommend getting dental?',
          mustContain: ['Dental is usually worth adding', 'whether to add it'],
          mustNotContain: ['Dental coverage: **BCBSTX Dental PPO**'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
        completedTopics: ['Dental', 'Vision'],
        currentTopic: 'Vision',
      }),
    );
  });

  it('replays supplemental worth-it follow-ups without repeating the same menu-like fallback', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'how do i know if i should get that?',
          mustContain: ['My practical take'],
          mustNotContain: ['We can stay with supplemental protection'],
        },
        {
          user: "yeah- how do i know if it's worth adding?",
          mustContain: ['My practical take'],
          mustNotContain: ['usually worth considering when one of these sounds true'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
        currentTopic: 'Accident/AD&D',
      }),
    );
  });

  it('replays overview-style "other coverage" questions as the AmeriVet benefits lineup instead of medical-only fallback', async () => {
    await replayTranscript(
      [
        {
          user: 'medical',
          mustContain: ['Medical plan options (Employee Only)'],
        },
        {
          user: 'what are the other types of coverage available?',
          mustContain: ['Here are the benefits available to you as an AmeriVet employee', 'Dental', 'Vision', 'Life Insurance'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Charlie',
        hasCollectedName: true,
        userAge: 49,
        userState: 'IA',
        dataConfirmed: true,
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays the docs-replacement medical detail chain without resetting the conversation', async () => {
    await replayTranscript(
      [
        {
          user: 'medical',
          mustContain: ['Medical plan options (Employee Only)'],
        },
        {
          user: "what's a coverage tier?",
          mustContain: ['A coverage tier is just the level of people you are enrolling', 'Employee Only'],
        },
        {
          user: "I'm married and have 3 kids, thank you very much. let's compare the plan tradeoffs",
          mustContain: ['practical tradeoff across AmeriVet', 'Employee + Family'],
        },
        {
          user: 'what are the copays for the standard plan?',
          mustContain: ['Standard HSA point-of-service cost sharing', 'Primary care', 'In-network coinsurance'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'i am pregnant',
          mustContain: ['maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
        },
        {
          user: 'what coverage will we get for maternity coverage on the 2 different plans?',
          mustContain: ['maternity coverage comparison', 'Recommendation'],
        },
        {
          user: 'what are the other types of coverage available?',
          mustContain: ['Here are the other benefit areas available to you as an AmeriVet employee'],
          mustNotContain: ['Perfect! 27 in CT.'],
        },
      ],
      makeSession({
        userName: 'Mandy',
        hasCollectedName: true,
        userAge: 27,
        userState: 'CT',
        dataConfirmed: true,
      }),
    );
  });

  it('replays life-detail and supplemental-followup questions as source-backed answers instead of drifting', async () => {
    await replayTranscript(
      [
        {
          user: 'life insurance info',
          mustContain: ['Life insurance options:', 'Unum Basic Life & AD&D'],
        },
        {
          user: 'what does portable mean here?',
          mustContain: ['Portable means', 'Voluntary Term Life'],
        },
        {
          user: 'what does guaranteed issue mean?',
          mustContain: ['Guaranteed issue means', '$150,000'],
        },
        {
          user: 'what does cash value mean?',
          mustContain: ['Cash value is the savings-like component', 'Whole Life'],
        },
        {
          user: 'how much life insurance can i get here?',
          mustContain: ['difference across AmeriVet', '1x to 5x annual salary'],
        },
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'what is it not for?',
          mustContain: ['What Accident/AD&D is not'],
          mustNotContain: ['What critical illness is not'],
        },
        {
          user: 'critical illness please',
          mustContain: ['Critical illness coverage is a supplemental benefit'],
        },
      ],
      makeSession({
        userName: 'Mandy',
        hasCollectedName: true,
        userAge: 27,
        userState: 'CT',
        dataConfirmed: true,
      }),
    );
  });

  it('replays the proactive orthodontia follow-up with an actual braces explanation', async () => {
    await replayTranscript(
      [
        {
          user: "what's an orthodontia rider?",
          mustContain: ['orthodontia rider means', 'braces'],
        },
        {
          user: 'yes please - show me what that means for braces',
          mustContain: ['For braces, the practical question', 'orthodontia copay is $500'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'Dental',
        completedTopics: ['Dental'],
      }),
    );
  });

  it('replays proactive HSA fit guidance instead of offering an empty follow-up', async () => {
    await replayTranscript(
      [
        {
          user: 'can you tell me about hsa/fsa?',
          mustContain: ['Health Savings Account', 'Flexible Spending Account'],
        },
        {
          user: 'yes, tell me when an hsa is the better fit',
          mustContain: ['simplest way to think about HSA versus FSA fit', 'cannot make full HSA contributions'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
      }),
    );
  });

  it('replays proactive supplemental-fit guidance instead of drifting to fallback', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'yes, help me think through whether that is worth considering',
          mustContain: ['usually worth considering', 'another layer beyond the core medical plan'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'Accident/AD&D',
      }),
    );
  });

  it('replays an organic "yes, I\'d like that" into supplemental comparison guidance', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'yes, help me think through whether that is worth considering',
          mustContain: ['usually worth considering'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['plain-language difference between Accident/AD&D and Critical Illness', 'injury-related events', 'serious diagnosis'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'Accident/AD&D',
      }),
    );
  });

  it('replays an organic "yes, I\'d like that" into life-versus-disability guidance', async () => {
    await replayTranscript(
      [
        {
          user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
          mustContain: ['protecting your family'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['simplest way to separate life insurance from disability', 'if you die'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays family-specific follow-ups without falling back to menus', async () => {
    await replayTranscript(
      [
        {
          user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
          mustContain: ['My recommendation: Standard HSA'],
        },
        {
          user: 'what about for my kids?',
          mustContain: ['thinking specifically about your kids', 'If your kids are generally healthy'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'OR',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays spouse-specific follow-ups without falling back to menus', async () => {
    await replayTranscript(
      [
        {
          user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
          mustContain: ['My recommendation: Standard HSA'],
        },
        {
          user: 'what about for my spouse?',
          mustContain: ['thinking specifically about your spouse', 'If your spouse is generally healthy'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'OR',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays short family shorthand like "kids then?" after a medical recommendation', async () => {
    await replayTranscript(
      [
        {
          user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
          mustContain: ['My recommendation: Standard HSA'],
        },
        {
          user: 'kids then?',
          mustContain: ['thinking specifically about your kids'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'OR',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays a bare affirmative after supplemental comparison into the practical narrowing', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'yes, help me think through whether that is worth considering',
          mustContain: ['usually worth considering'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['My practical take is that I would usually choose Accident/AD&D'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'Accident/AD&D',
      }),
    );
  });

  it('replays a plain yes after a direct disability recommendation into life-versus-disability guidance', async () => {
    await replayTranscript(
      [
        {
          user: 'should i get disability if my household depends on my paycheck?',
          mustContain: ['paycheck'],
        },
        {
          user: 'yes please',
          mustContain: ['simplest way to separate life insurance from disability', 'if you are alive but unable to work'],
          mustNotContain: ['Disability is usually worth considering if missing part of your paycheck'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'Disability',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
      }),
    );
  });

  it('replays "why would i pick that?" after routine-care comparison as a grounded practical take', async () => {
    await replayTranscript(
      [
        {
          user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
          mustContain: ['protecting your family'],
        },
        {
          user: 'routine care',
          mustContain: ['If routine care is what matters most'],
        },
        {
          user: 'yes, do that',
          mustContain: ['deciding between dental and vision as the next add-on'],
        },
        {
          user: 'why would i pick that?',
          mustContain: ['My practical take is to choose dental first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays in-topic benefit comparison language without pivoting away from the comparison', async () => {
    await replayTranscript(
      [
        {
          user: 'dental please',
          mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
        },
        {
          user: 'is that more important than vision?',
          mustContain: ['deciding between dental and vision as the next add-on'],
          mustNotContain: ['Vision coverage: **VSP Vision Plus**'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
      }),
    );
  });

  it('replays a short cheaper-option follow-up after a medical recommendation', async () => {
    await replayTranscript(
      [
        {
          user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
          mustContain: ['My recommendation: Standard HSA'],
        },
        {
          user: 'the cheaper one?',
          mustContain: ['cheaper option', '**Standard HSA**'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'OR',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays a short "that one?" follow-up after a medical recommendation', async () => {
    await replayTranscript(
      [
        {
          user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
          mustContain: ['My recommendation: Standard HSA'],
        },
        {
          user: 'that one?',
          mustContain: ['My practical take is that I would usually land on **Standard HSA**'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'OR',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
        currentTopic: 'Medical',
      }),
    );
  });

  it('replays risk-type shorthand after accident-versus-critical comparison', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'yes, help me think through whether that is worth considering',
          mustContain: ['usually worth considering'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
        },
        {
          user: 'more injury risk',
          mustContain: ['lean Accident/AD&D first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'Accident/AD&D',
      }),
    );
  });

  it('replays diagnosis-risk shorthand after accident-versus-critical comparison', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'yes, help me think through whether that is worth considering',
          mustContain: ['usually worth considering'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
        },
        {
          user: 'more diagnosis risk',
          mustContain: ['lean Critical Illness first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'Accident/AD&D',
      }),
    );
  });

  it('replays "why not critical illness first?" after accident-versus-critical comparison', async () => {
    await replayTranscript(
      [
        {
          user: 'what is accident/ad&d?',
          mustContain: ['Accident/AD&D coverage is another supplemental option'],
        },
        {
          user: 'yes, help me think through whether that is worth considering',
          mustContain: ['usually worth considering'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
        },
        {
          user: 'why not critical illness first?',
          mustContain: ['Critical Illness can absolutely come first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'Accident/AD&D',
      }),
    );
  });

  it('replays "why not disability first?" after family-protection comparison guidance', async () => {
    await replayTranscript(
      [
        {
          user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
          mustContain: ['protecting your family'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['simplest way to separate life insurance from disability'],
        },
        {
          user: 'why not disability first?',
          mustContain: ['Disability often can come first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays survivor-protection wording into life-first guidance after family-protection comparison guidance', async () => {
    await replayTranscript(
      [
        {
          user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
          mustContain: ['protecting your family'],
        },
        {
          user: "yes, i'd like that",
          mustContain: ['simplest way to separate life insurance from disability'],
        },
        {
          user: 'why not life first if my spouse and kids would need support if i die?',
          mustContain: ['Life absolutely can come first', 'support after my death'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays next-dollar wording into decisive life-versus-disability guidance', async () => {
    await replayTranscript(
      [
        {
          user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
          mustContain: ['protecting your family'],
        },
        {
          user: 'which protection gets the next dollar first: life insurance or disability?',
          mustContain: ['next dollar', 'disability first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
        {
          user: 'if my spouse and kids would need support if i die, which protection gets the next dollar first?',
          mustContain: ['next dollar', 'life insurance first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays "why not vision first?" after routine-care comparison guidance', async () => {
    await replayTranscript(
      [
        {
          user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
          mustContain: ['protecting your family'],
        },
        {
          user: 'routine care',
          mustContain: ['If routine care is what matters most'],
        },
        {
          user: 'yes, do that',
          mustContain: ['deciding between dental and vision as the next add-on'],
        },
        {
          user: 'why not vision first?',
          mustContain: ['Vision can absolutely come first'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        coverageTierLock: 'Employee + Family',
      }),
    );
  });

  it('replays a follow-up fit answer after the full HSA-versus-FSA guidance', async () => {
    await replayTranscript(
      [
        {
          user: 'can you tell me about hsa/fsa?',
          mustContain: ['Health Savings Account', 'Flexible Spending Account'],
        },
        {
          user: 'yes, tell me when an hsa is the better fit',
          mustContain: ['simplest way to think about HSA versus FSA fit'],
        },
        {
          user: 'use it this year',
          mustContain: ['FSA is usually the cleaner fit', 'current plan year'],
          mustNotContain: ['Tell me which area you want to focus on next'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 42,
        userState: 'FL',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
      }),
    );
  });

  it('replays pregnancy recommendation follow-through without falling back to stale medical scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: 'which medical plan should i pick for me and my pregnant wife?',
          mustContain: ['My recommendation: Kaiser Standard HMO'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: "so why didn't you recommend kaiser?",
          mustContain: ['Kaiser Standard HMO', 'lowest likely maternity-related out-of-pocket exposure'],
          mustNotContain: ['payroll'],
        },
        {
          user: 'what are my other benefit options?',
          mustContain: ['other benefit areas available to you', 'Life Insurance'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 34,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Spouse',
        lifeEvents: ['pregnancy'],
        familyDetails: { hasSpouse: true },
      }),
    );
  });

  it('replays supplemental and coverage-tier pivots from routine-care context', async () => {
    await replayTranscript(
      [
        {
          user: "no - i'm interested in the supplemental protection",
          mustContain: ["AmeriVet's supplemental benefits are the optional add-ons"],
          mustNotContain: ['We can stay with vision'],
        },
        {
          user: 'when i select my plan, do i pick employee + spouse or the family one right now if we are having a baby next february?',
          mustContain: ['Employee + Spouse', 'Employee + Family', 'qualifying life event'],
          mustNotContain: ['We can stay with vision'],
        },
      ],
      makeSession({
        userName: 'Sarah',
        hasCollectedName: true,
        userAge: 34,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Vision',
        lifeEvents: ['pregnancy'],
        familyDetails: { hasSpouse: true },
      }),
    );
  });

  it('replays vision-only, enrollment, and human-support asks without stale vision scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: "ok. i don't want dental. show me my vision options",
          mustContain: ['Vision coverage: **VSP Vision Plus**'],
          mustNotContain: ['Dental coverage: **BCBSTX Dental PPO**'],
        },
        {
          user: 'where do i enroll?',
          mustContain: ['Workday', '888-217-4728'],
          mustNotContain: ['We can stay with vision'],
        },
        {
          user: 'i need to talk to a real person',
          mustContain: ['888-217-4728', 'Workday'],
          mustNotContain: ['We can stay with vision'],
        },
      ],
      makeSession({
        userName: 'Madeline',
        hasCollectedName: true,
        userAge: 29,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'Dental',
      }),
    );
  });

  it('replays rx self-service and CI pricing follow-ups as direct grounded answers', async () => {
    await replayTranscript(
      [
        {
          user: 'where can i go to see the rx costs myself?',
          mustContain: ['Workday', 'prescription tiers or drug-pricing details', 'carrier formulary / drug-pricing tool', 'compare the medical options at a high level for someone who expects ongoing prescriptions'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Madeline',
        hasCollectedName: true,
        userAge: 29,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'Medical',
        lastBotMessage: 'Here is the prescription coverage comparison across the available medical plans:\n\n- Standard HSA: I do not have the prescription drug tier details in the current summary, so I do not want to guess.',
      }),
    );

    await replayTranscript(
      [
        {
          user: 'where can i go to see the rx costs myself?',
          mustContain: ['Workday', 'carrier formulary / drug-pricing tool'],
        },
        {
          user: 'yes, do that',
          mustContain: ['My recommendation:', 'ongoing prescriptions'],
          mustNotContain: ['Workday'],
        },
      ],
      makeSession({
        userName: 'Madeline',
        hasCollectedName: true,
        userAge: 29,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'Medical',
        lastBotMessage: 'Here is the prescription coverage comparison across the available medical plans:\n\n- Standard HSA: I do not have the prescription drug tier details in the current summary, so I do not want to guess.',
      }),
    );

    await replayTranscript(
      [
        {
          user: 'can you give me a ballpark idea of what the ci insurance would cost?',
          mustContain: ['do **not** have a grounded flat-rate premium', 'Workday'],
          mustNotContain: ['We can stay with supplemental protection'],
        },
        {
          user: 'yes, do that',
          mustContain: ['Critical illness is usually worth considering'],
          mustNotContain: ['do **not** have a grounded flat-rate premium'],
        },
      ],
      makeSession({
        userName: 'Madeline',
        hasCollectedName: true,
        userAge: 29,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'Critical Illness',
        lastBotMessage: 'Critical illness coverage is a supplemental benefit that can pay a lump-sum cash benefit if you are diagnosed with a covered serious condition.',
      }),
    );
  });

  it('replays direct HSA/FSA recommendation questions as concrete guidance instead of stale scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: 'can you tell me about hsa/fsa?',
          mustContain: ['Health Savings Account', 'Flexible Spending Account'],
        },
        {
          user: 'which would you recommend for me?',
          mustContain: ['My practical take', 'HSA'],
          mustNotContain: ['We can stay with HSA/FSA'],
        },
        {
          user: 'so when does hsa fit better?',
          mustContain: ['simplest way to think about HSA versus FSA fit'],
          mustNotContain: ['We can stay with HSA/FSA'],
        },
      ],
      makeSession({
        userName: 'Madeline',
        hasCollectedName: true,
        userAge: 29,
        userState: 'CO',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
      }),
    );
  });

  it('replays package recommendation, QLE timing, and premium replay questions as fresh high-priority answers', async () => {
    await replayTranscript(
      [
        {
          user: 'knowing what you know about me, which benefits would you recommend i get?',
          mustContain: ['Based on what you have told me, I would usually prioritize your benefits in this order', 'Medical first'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'after we have our baby, how long do we have to add her to our insurance?',
          mustContain: ['qualifying life event', 'Workday'],
          mustNotContain: ['maternity coverage comparison'],
        },
        {
          user: 'show me how much i have to pay each month on each plan',
          mustContain: ['Here are the monthly medical premiums for Employee + Family coverage in WA', 'Kaiser Standard HMO'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'yes, do that',
          mustContain: ['Deductible', 'Out-of-pocket max', 'Standard HSA'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Child(ren)',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lifeEvents: ['pregnancy'],
      }),
    );
  });

  it('replays broader package-priority wording from a life-and-hsa context into disability plus HSA/FSA guidance', async () => {
    await replayTranscript(
      [
        {
          user: 'what would you do if you were me with these benefits?',
          mustContain: ['Based on what you have told me', '**disability**', '**HSA/FSA**', '**Enhanced HSA**', '80% Voluntary Term Life / 20% Whole Life', 'Basic Life'],
          mustNotContain: ['We can stay with life insurance'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        completedTopics: ['Medical', 'Life Insurance'],
        selectedPlan: 'Enhanced HSA',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays a bare "yes, do that" after medical copay explanation into a grounded copay comparison', async () => {
    await replayTranscript(
      [
        {
          user: 'what is a copay?',
          mustContain: ['A copay is the flat dollar amount you pay', 'compare AmeriVet\'s medical plans specifically on copays next'],
          mustNotContain: ['We can stay with medical'],
        },
        {
          user: 'yes, do that',
          mustContain: ['copays and point-of-service cost sharing comparison', 'primary care', 'specialist'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee Only',
        lastBotMessage: 'Medical plan options (Employee Only):',
      }),
    );
  });

  it('replays a stale hsa/fsa detour back into medical compare and a fresh heavy-usage recommendation', async () => {
    await replayTranscript(
      [
        {
          user: 'no - go back to medical and compare the plans for my family',
          mustContain: ['Here is the practical tradeoff across AmeriVet\'s medical options', 'Standard HSA', 'Enhanced HSA'],
          mustNotContain: ['HSA/FSA overview', 'We can stay with medical'],
        },
        {
          user: 'which one is better if we expect a lot of care?',
          mustContain: ['My recommendation: Enhanced HSA', 'Because you described more than minimal usage'],
          mustNotContain: ['My recommendation: Standard HSA', 'We can stay with medical'],
        },
      ],
      makeSession({
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
      }),
    );
  });

  it('replays hsa/fsa rollover-rule follow-ups as direct account guidance instead of the generic topic scaffold', async () => {
    await replayTranscript(
      [
        {
          user: 'is there a limit to how much unused funds can roll forward?',
          mustContain: ['unused HSA money generally **rolls forward year to year**', 'IRS annual contribution limit', '$4,300'],
          mustNotContain: ['We can stay with HSA/FSA'],
        },
        {
          user: 'can you tell me what the tax and rollover tradeoff means in practice?',
          mustContain: ['tax and rollover tradeoff', 'Unused **HSA** money stays with you', 'stricter carryover or use-it-or-lose-it rules'],
          mustNotContain: ['We can stay with HSA/FSA'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        selectedPlan: 'Standard HSA',
        lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
      }),
    );
  });

  it('replays "how do i know when hsa fits better" as direct fit guidance instead of the generic topic scaffold', async () => {
    await replayTranscript(
      [
        {
          user: 'how do i know when hsa fits better?',
          mustContain: ['simplest way to think about HSA versus FSA fit'],
          mustNotContain: ['We can stay with HSA/FSA'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
      }),
    );
  });

  it('replays voluntary-term follow-ups without corrupting the user name', async () => {
    await replayTranscript(
      [
        {
          user: "i'm thinking about that voluntary term one. what else should i know?",
          mustContain: ['Voluntary Term Life'],
          mustNotContain: ['updated your name'],
        },
      ],
      makeSession({
        userName: 'Leo',
        hasCollectedName: true,
        userAge: 72,
        userState: 'MN',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D\n- Unum Voluntary Term Life\n- Allstate Whole Life',
      }),
    );
  });

  it('replays selected-plan reconsideration as a fresh medical recommendation instead of anchoring to the stale plan lean', async () => {
    await replayTranscript(
      [
        {
          user: 'i know i said standard before, but make the case for enhanced if we expect more specialist visits',
          mustContain: ['My recommendation: Enhanced HSA', 'specialist visits'],
          mustNotContain: ['My recommendation: Standard HSA', 'We can stay with medical'],
        },
        {
          user: 'should we switch from standard to enhanced if we expect a lot of care this year?',
          mustContain: ['My recommendation: Enhanced HSA', 'lower deductible and stronger cost protection'],
          mustNotContain: ['My recommendation: Standard HSA', 'We can stay with medical'],
        },
      ],
      makeSession({
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
      }),
    );
  });

  it('replays recommendation preference signals as direct counselor guidance instead of another usage clarifier', async () => {
    await replayTranscript(
      [
        {
          user: 'which plan do you recommend if i want more predictable costs and less deductible risk?',
          mustContain: ['My recommendation: Enhanced HSA', 'Because you said more predictable costs matter'],
          mustNotContain: ['Quick clarifier', 'would you say your expected usage is'],
        },
        {
          user: 'okay, but what if i can handle more risk to keep premiums lower?',
          mustContain: ['My recommendation: Standard HSA', 'Because you said you can tolerate more cost risk to keep premiums lower'],
          mustNotContain: ['Quick clarifier', 'My recommendation: Enhanced HSA'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee Only',
        lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
      }),
    );
  });

  it('replays household tier corrections by replacing stale family pricing state instead of stacking on top of it', async () => {
    await replayTranscript(
      [
        {
          user: 'actually compare the costs for employee + family since we have 2 kids',
          mustContain: ['Projected Healthcare Costs for Employee + Family coverage in Washington', 'Kaiser Standard HMO'],
          mustNotContain: ['Employee + Spouse coverage'],
        },
        {
          user: 'actually it is just me and the 2 kids now, so show me the employee + child pricing',
          mustContain: ['Here are the monthly medical premiums for Employee + Child(ren) coverage in WA', 'Standard HSA'],
          mustNotContain: ['Employee + Family coverage', 'Employee + Spouse coverage'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Spouse',
        familyDetails: { hasSpouse: true },
        lastBotMessage: 'Projected Healthcare Costs for Employee + Spouse coverage in Washington (moderate usage):',
      }),
    );
  });

  it('replays household-only medical corrections as a refreshed tiered medical view instead of generic scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: 'oh okay, no i have 2 kids',
          mustContain: ['updated the household to **Employee + Child(ren)** coverage', 'Medical plan options (Employee + Child(ren))'],
          mustNotContain: ['We can stay with medical'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee Only',
        lastBotMessage: 'A coverage tier is the level of people you are enrolling.',
      }),
    );
  });

  it('replays the screenshot-style family medical tier flow into routine-care-first package guidance', async () => {
    await replayTranscript(
      [
        {
          user: "what's a coverage tier?",
          mustContain: ['A coverage tier is just the level of people you are enrolling', 'Employee Only'],
        },
        {
          user: 'oh okay, no i have 2 kids',
          mustContain: ['updated the household to **Employee + Child(ren)** coverage', 'Medical plan options (Employee + Child(ren))'],
        },
        {
          user: 'okay can you show me the plans for my coverage tier',
          mustContain: ['Medical plan options (Employee + Child(ren))', 'Want to compare plans or switch coverage tiers?'],
        },
        {
          user: 'what else should i consider?',
          mustContain: ['split the next step after medical into two lanes', '**dental**', '**life insurance**', 'default nudge here is usually **dental first**', 'take you straight into **dental** next'],
          mustNotContain: ['the next most useful step after medical is usually **life insurance**'],
        },
      ],
      makeSession({
        userName: 'Susie',
        hasCollectedName: true,
        userAge: 23,
        userState: 'OR',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee Only',
        completedTopics: ['Medical'],
        lastBotMessage: 'Medical plan options (Employee Only):\n\nWant to compare plans or switch coverage tiers?',
      }),
    );
  });

  it('replays life-versus-disability and multi-supplement narrowing as comparison guidance instead of stale topic cards', async () => {
    await replayTranscript(
      [
        {
          user: 'life insurance info',
          mustContain: ['Life insurance options:'],
        },
        {
          user: 'so, if amerivet gives me $25 life insurance, if i spend on something additional, should it be more life insurance, or disability?',
          mustContain: ['choosing between more life insurance and disability', 'disability first'],
          mustNotContain: ['Life insurance options:'],
        },
        {
          user: "you're supposed to help me narrow down whether accident, critical illness, or disability is the most relevant next step for my situation.",
          mustContain: ['narrow down disability versus the smaller supplemental cash benefits', 'disability first'],
          mustNotContain: ['Critical illness coverage is a supplemental benefit'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { numChildren: 2 },
      }),
    );
  });

  it('replays plan-comparison requests out of hsa/fsa context back into medical instead of tax-account compatibility', async () => {
    await replayTranscript(
      [
        {
          user: 'yeah - compare the Standard HSA with the Kaiser plan',
          mustContain: ['Standard HSA', 'Kaiser Standard HMO'],
          mustNotContain: ['FSA is usually the more natural pre-tax account', 'HSA/FSA overview'],
        },
        {
          user: 'can you just show me the breakdown of each of those plans though?',
          mustContain: ['Standard HSA', 'Kaiser Standard HMO'],
          mustNotContain: ['A useful next HSA/FSA question is usually one of these'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
      }),
    );
  });

  it('replays whole-family pricing asks into medical premium rows instead of generic scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: 'actually i just want to see how much the premiums are for my whole family',
          mustContain: ['Here are the monthly medical premiums for Employee + Family coverage', 'Standard HSA'],
          mustNotContain: ['A useful next medical step is usually one of these'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
      }),
    );
  });

  it('replays negative life pivots into the next non-life guidance instead of life again', async () => {
    await replayTranscript(
      [
        {
          user: 'other than life insurance, what else should i consider next?',
          mustContain: ['disability'],
          mustNotContain: ['Life insurance options:'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        completedTopics: ['Medical', 'Life Insurance'],
        familyDetails: { hasSpouse: true, numChildren: 2 },
      }),
    );
  });

  it('replays broad next-step guidance after life into disability first and HSA/FSA second when an HSA medical path is already selected', async () => {
    await replayTranscript(
      [
        {
          user: 'what else should i be considering to my benefits?',
          mustContain: ['**disability**', '**HSA/FSA**', '**Enhanced HSA**'],
          mustNotContain: ['smaller add-on questions'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        completedTopics: ['Medical', 'Life Insurance'],
        familyDetails: { hasSpouse: true, numChildren: 2 },
        selectedPlan: 'Enhanced HSA',
      }),
    );
  });

  it('replays next-step guidance after life and disability into HSA/FSA when the protection choices are already covered', async () => {
    await replayTranscript(
      [
        {
          user: 'what should i look at next?',
          mustContain: ['**HSA/FSA**', '**Enhanced HSA**'],
          mustNotContain: ['smaller add-on questions'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        completedTopics: ['Medical', 'Life Insurance', 'Disability'],
        familyDetails: { hasSpouse: true, numChildren: 2 },
        selectedPlan: 'Enhanced HSA',
      }),
    );
  });

  it('replays employer-provided life split guidance instead of the generic life recommendation scaffold', async () => {
    await replayTranscript(
      [
        {
          user: 'what split do you recommend between whole life and voluntary term life?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
      }),
    );
  });

  it('replays prioritize-first life wording into the employer split guidance', async () => {
    await replayTranscript(
      [
        {
          user: 'which should i prioritize first: voluntary term life or whole life?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Voluntary Term Life', 'Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
      }),
    );
  });

  it('replays softer life-worth-it wording into the life sizing framework instead of the generic life-worth-it scaffold', async () => {
    await replayTranscript(
      [
        {
          user: 'is life insurance right for me?',
          mustContain: ['Basic Life', 'Voluntary Term Life', 'Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays broader family life-decision wording into the employer split guidance once life options are already active', async () => {
    await replayTranscript(
      [
        {
          user: 'which ones should i get?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Here is the practical difference across AmeriVet\'s life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays generic life choice wording into a sharper term-versus-whole framework before family split context exists', async () => {
    await replayTranscript(
      [
        {
          user: 'which of those should i get?',
          mustContain: ['Basic Life', 'Voluntary Term Life', 'Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
        {
          user: 'how much should i get?',
          mustContain: ['Basic Life', 'Voluntary Term Life', 'Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays broader life-amount wording into the employer split guidance once life options are already active', async () => {
    await replayTranscript(
      [
        {
          user: 'how much should i get?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays direct life recommendation asks into the employer split guidance after the included base life has already been explained', async () => {
    await replayTranscript(
      [
        {
          user: 'what do you recommend?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        lastBotMessage: 'If you do nothing, AmeriVet still gives you Basic Life & AD&D as the included base layer.',
      }),
    );
  });

  it('replays natural family wording into the employer split guidance when life insurance is already the active topic', async () => {
    await replayTranscript(
      [
        {
          user: 'ok, so i have a wife and 2 kids. so i want life insurance. i think i also want voluntary term - can you help me with that?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'My practical take: life insurance is usually worth tightening up if other people rely on your income and would need support if something happened to you.',
      }),
    );
  });

  it('replays short life-decision followups into the employer split guidance when earlier family-protection context already exists in the thread', async () => {
    await replayTranscript(
      [
        {
          user: 'which of those should i get?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Voluntary Term Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        messages: [
          { role: 'user', content: 'life insurance info' },
          { role: 'assistant', content: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value' },
          { role: 'user', content: 'how much protection is worth paying for if your family relies on your income?' },
          { role: 'assistant', content: 'If you are asking how I would structure extra life coverage once the included base benefit is not enough, AmeriVet\'s current employer guidance is **80% Voluntary Term Life / 20% Whole Life**.' },
        ],
        lastBotMessage: 'My practical take is that if people rely on your income, I would not leave life insurance as an afterthought.',
      }),
    );
  });

  it('replays life practical-take followthrough into the life-sizing path instead of generic guidance menus', async () => {
    await replayTranscript(
      [
        {
          user: 'yes please - help me think through that',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life', 'Whole Life'],
          mustNotContain: ['A useful next life-insurance step', 'A supplemental benefit is usually worth considering'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'My practical take is that if people rely on your income, I would not leave life insurance as an afterthought.',
      }),
    );
  });

  it('replays short amount followups into the employer split guidance when prior life recommendation context already established more-than-basic life needs', async () => {
    await replayTranscript(
      [
        {
          user: 'how much should i get?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        messages: [
          { role: 'user', content: 'i have a wife and 2 kids and want more than just the basic life coverage. what do you recommend?' },
          { role: 'assistant', content: 'If you are asking how I would structure extra life coverage once the included base benefit is not enough, AmeriVet\'s current employer guidance is **80% Voluntary Term Life / 20% Whole Life**.' },
        ],
        lastBotMessage: 'Here is the practical difference across AmeriVet\'s life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays vague active-topic followups into topic-aware next-step guidance instead of asking for more specificity', async () => {
    await replayTranscript(
      [
        {
          user: 'what else?',
          mustContain: ['most useful next comparison is usually **disability**'],
          mustNotContain: ['Please ask that one a little more specifically'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        lastBotMessage: 'Life insurance options:\n\n- **Unum Basic Life & AD&D**',
      }),
    );

    await replayTranscript(
      [
        {
          user: 'what else?',
          mustContain: ['most useful next step is usually **medical**'],
          mustNotContain: ['Please ask that one a little more specifically'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
      }),
    );
  });

  it('replays family-protection payoff wording into the employer split guidance after life guidance menus', async () => {
    await replayTranscript(
      [
        {
          user: 'how much protection is worth paying for if your family relies on your income?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'If you can only afford **one** extra paid life layer', 'Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'A useful next life-insurance step is usually one of these:\n\n- Whether life or disability matters more first\n- How much protection is worth paying for if your family relies on your income',
      }),
    );
  });

  it('replays direct extra-life recommendation asks into the employer split guidance without needing explicit term-versus-whole wording', async () => {
    await replayTranscript(
      [
        {
          user: 'i have a wife and 2 kids and want more than just the basic life coverage. what do you recommend?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
      }),
    );
  });

  it('replays a plain think-through affirmation into the life-sizing path after a direct life amount answer', async () => {
    await replayTranscript(
      [
        {
          user: 'yes please - help me think through that',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life', 'Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
        {
          user: 'how much protection is worth paying for if your family relies on your income?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
          mustNotContain: ['For life-insurance cost, the practical split is:'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        pendingGuidancePrompt: 'life_sizing',
        pendingGuidanceTopic: 'Life Insurance',
        lastBotMessage: 'The practical way I would decide how much life insurance to add is this:\n\n- treat **Basic Life** as the included starting point\n- use **Voluntary Term Life** as the first extra layer\n- use **Whole Life** only if you specifically want permanent coverage',
      }),
    );
  });

  it('replays softer recommendation wording into the employer split guidance after life options are active', async () => {
    await replayTranscript(
      [
        {
          user: 'how much would you recommend?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Here is the practical difference across AmeriVet\'s life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays a longer family life-decision thread into the same practical employer-guidance path', async () => {
    await replayTranscript(
      [
        {
          user: 'life insurance info',
          mustContain: ['Life insurance options:'],
        },
        {
          user: 'which ones should i get?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
        {
          user: 'how much should i get?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
        {
          user: 'how much protection is worth paying for if your family relies on your income?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Voluntary Term Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        familyDetails: { hasSpouse: true, numChildren: 2 },
      }),
    );
  });

  it('replays followup questions about when to move off the employer life split into a practical adjustment framework', async () => {
    await replayTranscript(
      [
        {
          user: 'what split do you recommend between whole life and voluntary term life?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life'],
        },
        {
          user: 'how do i know how much of each to get?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'more Unum Voluntary Term Life', 'more Allstate Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
        {
          user: 'when would i want more whole life?',
          mustContain: ['of the mix toward', 'Whole Life', 'cash-value'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
        {
          user: 'how should i split that?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'more Unum Voluntary Term Life', 'more Allstate Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
      }),
    );
  });

  it('replays broader both-or-one life wording into the employer split guidance when the user asks whether they need both term and whole life', async () => {
    await replayTranscript(
      [
        {
          user: 'do i need both voluntary term life and whole life?',
          mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life', 'Whole Life'],
          mustNotContain: ['life insurance is usually worth tightening up'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
      }),
    );
  });

  it('replays therapist-cost questions into grounded medical comparison instead of generic medical menus', async () => {
    await replayTranscript(
      [
        {
          user: 'i see a therapist 2x monthly, what will that cost?',
          mustContain: ['Therapy / specialist care', 'Standard HSA', 'Enhanced HSA', 'recurring part of your year'],
          mustNotContain: ['A useful next medical step is usually one of these'],
        },
        {
          user: 'is a therapist a specialist?',
          mustContain: ['Usually yes', 'specialist'],
          mustNotContain: ['A useful next medical step is usually one of these'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
      }),
    );
  });

  it('replays recurring-therapy recommendation asks into enhanced medical guidance without a generic clarifier', async () => {
    await replayTranscript(
      [
        {
          user: 'which plan do you recommend if i see a therapist twice a month?',
          mustContain: ['My recommendation: Enhanced HSA', 'more than minimal usage'],
          mustNotContain: ['Quick clarifier'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'Medical',
        lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
      }),
    );
  });

  it('replays recurring-therapy recommendation asks into enhanced medical guidance even from life context', async () => {
    await replayTranscript(
      [
        {
          user: 'which plan do you recommend if i see a therapist twice a month?',
          mustContain: ['My recommendation: Enhanced HSA', 'more than minimal usage'],
          mustNotContain: ['Life insurance options:'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays recurring-prescription recommendation asks into enhanced medical guidance without a generic clarifier', async () => {
    await replayTranscript(
      [
        {
          user: 'which plan do you recommend if my wife takes 2 prescriptions?',
          mustContain: ['My recommendation: Enhanced HSA', 'more than minimal usage'],
          mustNotContain: ['Quick clarifier'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Spouse',
        familyDetails: { hasSpouse: true, numChildren: 0 },
        lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
      }),
    );
  });

  it('replays recurring-care cost estimates back into medical even from hsa/fsa context', async () => {
    await replayTranscript(
      [
        {
          user: 'estimate likely costs if my wife sees a specialist every month',
          mustContain: ['Projected Healthcare Costs for Employee + Spouse coverage', 'Enhanced HSA'],
          mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        coverageTierLock: 'Employee + Spouse',
        familyDetails: { hasSpouse: true, numChildren: 0 },
        lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
      }),
    );
  });

  it('replays recurring-specialist recommendation asks into enhanced medical guidance without a generic clarifier', async () => {
    await replayTranscript(
      [
        {
          user: 'which plan do you recommend if i see a specialist every month?',
          mustContain: ['My recommendation: Enhanced HSA', 'more than minimal usage'],
          mustNotContain: ['Quick clarifier'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'Medical',
        lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
      }),
    );
  });

  it('replays child recurring-therapy recommendation asks into enhanced medical guidance with a household-specific rationale', async () => {
    await replayTranscript(
      [
        {
          user: 'which plan do you recommend if my daughter sees a therapist every week?',
          mustContain: ['My recommendation: Enhanced HSA', 'recurring care for a child'],
          mustNotContain: ['Quick clarifier'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
      }),
    );
  });

  it('replays natural spouse recurring-care recommendation wording into enhanced medical guidance even from hsa/fsa context', async () => {
    await replayTranscript(
      [
        {
          user: 'what should we pick if my wife sees a specialist every month?',
          mustContain: ['My recommendation: Enhanced HSA', "your spouse's recurring care"],
          mustNotContain: ['HSA/FSA overview', 'Quick clarifier'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        coverageTierLock: 'Employee + Spouse',
        familyDetails: { hasSpouse: true, numChildren: 0 },
        lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
      }),
    );
  });

  it('replays natural child recurring-care "makes the most sense" wording into enhanced medical guidance even from life context', async () => {
    await replayTranscript(
      [
        {
          user: 'which medical plan makes the most sense if my son does therapy every week?',
          mustContain: ['My recommendation: Enhanced HSA', 'recurring care for a child'],
          mustNotContain: ['Life insurance options:', 'Quick clarifier'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'TX',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays just-wanna-see-the-plans phrasing back into medical from stale hsa/fsa context', async () => {
    await replayTranscript(
      [
        {
          user: "i don't really care about hsa fsa stuff yet. i just wanna see the plans",
          mustContain: ['Standard HSA'],
          mustNotContain: ['HSA/FSA overview', 'FSA is usually the more natural pre-tax account'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        lastBotMessage: 'HSA/FSA overview:',
      }),
    );
  });

  it('replays just-plan-pricing pivots back into medical even from life-insurance context', async () => {
    await replayTranscript(
      [
        {
          user: 'what about just plan pricing?',
          mustContain: ['Standard HSA'],
          mustNotContain: ['Life insurance options:', 'Voluntary Term Life'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays just-plan-pricing pivots back into medical after rx self-service deferrals', async () => {
    await replayTranscript(
      [
        {
          user: 'what about just plan pricing?',
          mustContain: ['Standard HSA'],
          mustNotContain: ['Workday', 'ongoing prescriptions'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'For exact prescription tiers or drug-pricing details, I would use Workday as the starting point rather than guess from memory.\n\nIf you want, I can still compare the medical options at a high level for someone who expects ongoing prescriptions.',
      }),
    );
  });

  it('replays employee-plus-spouse premium asks back into medical from HSA/FSA context', async () => {
    await replayTranscript(
      [
        {
          user: 'show me the employee + spouse premiums',
          mustContain: ['Employee + Spouse coverage', 'Standard HSA'],
          mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        coverageTierLock: 'Employee + Spouse',
        familyDetails: { hasSpouse: true, numChildren: 0 },
        lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
      }),
    );
  });

  it('replays family-price asks back into medical from disability context', async () => {
    await replayTranscript(
      [
        {
          user: 'show me the family prices',
          mustContain: ['Employee + Family coverage', 'Standard HSA'],
          mustNotContain: ['Disability is really paycheck protection'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Disability',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Disability is really paycheck protection.',
      }),
    );
  });

  it('replays short "what will that cost" pricing wording back into medical when the prior bot message already established medical plan options', async () => {
    await replayTranscript(
      [
        {
          user: 'what will that cost?',
          mustContain: ['Employee + Family coverage', 'Standard HSA'],
          mustNotContain: ['A useful next medical step is usually one of these'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Medical',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Medical plan options (Employee + Family):\n\n- Standard HSA (BCBSTX): $321.45/month\n- Enhanced HSA (BCBSTX): $412.37/month\n\nWant to compare plans or switch coverage tiers?',
      }),
    );
  });

  it('replays short spouse-price wording back into medical from HSA/FSA when the prior bot message already established medical plan options', async () => {
    await replayTranscript(
      [
        {
          user: 'how much would that be for my spouse?',
          mustContain: ['Employee + Spouse coverage', 'Standard HSA'],
          mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        coverageTierLock: 'Employee + Spouse',
        familyDetails: { hasSpouse: true, numChildren: 0 },
        lastBotMessage: 'Medical plan options (Employee + Spouse):\n\n- Standard HSA (BCBSTX): $190.31/month\n- Enhanced HSA (BCBSTX): $275.10/month\n\nWant to compare plans or switch coverage tiers?',
      }),
    );
  });

  it('replays "those medical premiums again" wording back into medical from life context', async () => {
    await replayTranscript(
      [
        {
          user: 'what are those medical premiums again?',
          mustContain: ['Employee + Family coverage', 'Standard HSA'],
          mustNotContain: ['Life insurance options:', 'Voluntary Term Life'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        messages: [
          { role: 'assistant', content: 'Medical plan options (Employee + Family):\n\n- Standard HSA (BCBSTX): $321.45/month\n- Enhanced HSA (BCBSTX): $412.37/month\n\nWant to compare plans or switch coverage tiers?' },
          { role: 'user', content: 'can you tell me about life insurance?' },
        ],
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays short deictic plan-price wording back into medical from disability when recent assistant history already established medical pricing', async () => {
    await replayTranscript(
      [
        {
          user: 'can i just see those plan prices again?',
          mustContain: ['Employee + Family coverage', 'Standard HSA'],
          mustNotContain: ['Disability is really paycheck protection'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Disability',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        messages: [
          { role: 'assistant', content: 'Medical plan options (Employee + Family):\n\n- Standard HSA (BCBSTX): $321.45/month\n- Enhanced HSA (BCBSTX): $412.37/month\n\nWant to compare plans or switch coverage tiers?' },
          { role: 'user', content: 'what about disability?' },
        ],
        lastBotMessage: 'Disability is really paycheck protection.',
      }),
    );
  });

  it('replays short "show me those plans again" wording back into medical from HSA/FSA when the prior bot message already established medical plan options', async () => {
    await replayTranscript(
      [
        {
          user: 'show me those plans again',
          mustContain: ['Medical plan options (Employee + Spouse)', 'Standard HSA'],
          mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        coverageTierLock: 'Employee + Spouse',
        familyDetails: { hasSpouse: true, numChildren: 0 },
        lastBotMessage: 'Medical plan options (Employee + Spouse):\n\n- Standard HSA (BCBSTX): $190.31/month\n- Enhanced HSA (BCBSTX): $275.10/month\n\nWant to compare plans or switch coverage tiers?',
      }),
    );
  });

  it('replays short "show me that breakdown again" wording back into medical from disability when the prior bot message already established a medical tradeoff view', async () => {
    await replayTranscript(
      [
        {
          user: 'show me that breakdown again',
          mustContain: ["Here is the practical tradeoff across AmeriVet's medical options", 'Standard HSA'],
          mustNotContain: ['Disability is really paycheck protection'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Disability',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
      }),
    );
  });

  it('replays natural spouse-and-kids premium asks back into medical from HSA/FSA context', async () => {
    await replayTranscript(
      [
        {
          user: 'what would i pay to cover me, my wife, and my kids?',
          mustContain: ['Employee + Family coverage', 'Standard HSA'],
          mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        coverageTierLock: 'Employee Only',
        familyDetails: { hasSpouse: false, numChildren: 0 },
        lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
      }),
    );
  });

  it('replays medical-plan-prices-again wording back into medical from life context', async () => {
    await replayTranscript(
      [
        {
          user: 'what are the medical plan prices again?',
          mustContain: ['Employee + Family coverage', 'Standard HSA'],
          mustNotContain: ['Life insurance options:', 'Voluntary Term Life'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Life Insurance',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
      }),
    );
  });

  it('replays natural family-medical-plan cost wording back into medical from disability context', async () => {
    await replayTranscript(
      [
        {
          user: 'how much are the family medical plans?',
          mustContain: ['Employee + Family coverage', 'Standard HSA'],
          mustNotContain: ['Disability is really paycheck protection'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'Disability',
        coverageTierLock: 'Employee + Family',
        familyDetails: { hasSpouse: true, numChildren: 2 },
        lastBotMessage: 'Disability is really paycheck protection.',
      }),
    );
  });

  it('replays direct Standard-HSA-versus-Kaiser compares back into medical from HSA/FSA context', async () => {
    await replayTranscript(
      [
        {
          user: 'compare standard hsa with kaiser please',
          mustContain: ['Standard HSA', 'Kaiser Standard HMO'],
          mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
        },
      ],
      makeSession({
        userName: 'Ted',
        hasCollectedName: true,
        userAge: 28,
        userState: 'WA',
        dataConfirmed: true,
        currentTopic: 'HSA/FSA',
        coverageTierLock: 'Employee Only',
        lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
      }),
    );
  });
});
