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
});
