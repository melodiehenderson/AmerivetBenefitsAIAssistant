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
          mustContain: ['If protecting your family is the top priority', 'life insurance next'],
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
          mustContain: ['HSA/FSA'],
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
          mustContain: ['protecting your family', 'life insurance next', 'disability'],
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
          mustContain: ['dental/vision', 'life/disability'],
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

  it('replays direct HSA/FSA recommendation questions as concrete guidance instead of stale scaffolding', async () => {
    await replayTranscript(
      [
        {
          user: 'can you tell me about hsa/fsa?',
          mustContain: ['Health Savings Account', 'Flexible Spending Account'],
        },
        {
          user: 'which would you recommend for me?',
          mustContain: ['simplest way to think about HSA versus FSA fit'],
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
});
