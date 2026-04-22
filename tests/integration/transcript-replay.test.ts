/**
 * Transcript-replay regression tests (Phase 6).
 *
 * Each test encodes a specific failure that was caught in a real test conversation
 * (Tammy or Maria transcripts) and fixed during the LLM-first pivot. They run
 * entirely against the deterministic engine — no LLM calls, no Azure, no Redis.
 *
 * If any of these fail after a refactor, a regression has occurred.
 */

import { describe, it, expect } from 'vitest';
import { tryDeterministicIntent } from '@/lib/qa-v2/deterministic-intents';
import type { Session } from '@/lib/rag/session-store';

const PORTAL = 'https://wd5.myworkday.com/amerivet/login.html';
const PHONE  = '888-217-4728';

/** Minimal valid session. Override only the fields each test cares about. */
function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test',
    turn: 3,
    hasCollectedName: true,
    disclaimerShown: true,
    userName: 'Maria',
    userAge: 42,
    userState: 'TX',
    currentTopic: 'Medical',
    completedTopics: ['Medical'],
    lastBotMessage: '',
    messages: [],
    ...overrides,
  } as unknown as Session;
}

function ctx(query: string, sess: Session, detectedTopic: string | null = null) {
  return { query, session: sess, detectedTopic, enrollmentPortalUrl: PORTAL, hrPhone: PHONE };
}

// ─── REGRESSION 1: Double-dental bug ────────────────────────────────────────
// Tammy transcript: "yep" after dental overview showed dental AGAIN instead of
// moving to vision. Fixed by topic-tracking guard in detectNudgedTopic.

describe('Regression: double-dental bug', () => {
  it('"yep" after dental nudge routes to Vision, not Dental again', () => {
    const sess = session({
      currentTopic: 'Dental',
      completedTopics: ['Medical', 'Dental'],
      lastBotMessage: "Great choice! Shall we move on to vision next?",
    });
    const result = tryDeterministicIntent(ctx('yep', sess));
    expect(result).not.toBeNull();
    expect(result!.metadata.intercept).toBe('affirmation-topic-nudge-v2');
    expect(result!.topic).toBe('Vision');
  });

  it('"yes" when Dental is still current topic but Vision is next returns Vision', () => {
    const sess = session({
      currentTopic: 'Dental',
      completedTopics: ['Medical', 'Dental'],
      lastBotMessage: "Let's dive into Vision. Ready?",
    });
    const result = tryDeterministicIntent(ctx('yes', sess));
    expect(result?.topic).toBe('Vision');
  });

  it('does not re-show Dental if Dental is in completedTopics', () => {
    const sess = session({
      currentTopic: 'Dental',
      completedTopics: ['Medical', 'Dental'],
      lastBotMessage: "Ready to move on to vision?",
    });
    const result = tryDeterministicIntent(ctx('sure', sess));
    // If it fires, must NOT be Dental
    if (result?.metadata?.intercept === 'affirmation-topic-nudge-v2') {
      expect(result.topic).not.toBe('Dental');
    }
  });
});

// ─── REGRESSION 2: Life Insurance skipping Basic Life ───────────────────────
// Tammy transcript: life insurance overview jumped straight to voluntary term
// life without mentioning the employer-paid Basic Life ($0, auto-enrolled).

describe('Regression: life insurance must lead with Basic Life', () => {
  it('affirmation → Life Insurance overview contains Basic Life and $0 cost', () => {
    const sess = session({
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      lastBotMessage: "That covers vision — life insurance is next. Want me to walk you through it?",
    });
    const result = tryDeterministicIntent(ctx('ok', sess));
    expect(result).not.toBeNull();
    expect(result!.topic).toBe('Life Insurance');
    const answer = result!.answer.toLowerCase();
    // Must mention employer-paid basic life before optional additions
    expect(answer).toMatch(/basic\s*life/i);
    expect(answer).toMatch(/\$0|\$0\/month|no\s+cost|employer.?paid|at\s+no\s+cost/i);
  });

  it('"let\'s go" also routes to Life Insurance when nudged', () => {
    const sess = session({
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      lastBotMessage: "Vision is settled. Let's move on to Life Insurance next.",
    });
    const result = tryDeterministicIntent(ctx("let's go", sess));
    expect(result?.topic).toBe('Life Insurance');
  });
});

// ─── REGRESSION 3: Affirmation guard — no false positives ───────────────────
// The affirmation handler must NOT fire when the query has substantive content
// or when there is no nudge in the last bot message.

describe('Affirmation guard: no false positives', () => {
  it('substantive query ("tell me about dental") does not fire affirmation path', () => {
    const sess = session({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage: "Shall we move on to dental?",
    });
    const result = tryDeterministicIntent(ctx('tell me about dental', sess));
    // May still return something (topic-overview), but NOT via affirmation intercept
    expect(result?.metadata?.intercept).not.toBe('affirmation-topic-nudge-v2');
  });

  it('"sure - hsa/fsa" is NOT treated as a short affirmation', () => {
    const sess = session({
      currentTopic: 'Critical Illness',
      completedTopics: ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness'],
      lastBotMessage: "Next up is Accident/AD&D. Would you like to go over that?",
    });
    const result = tryDeterministicIntent(ctx('sure - hsa/fsa', sess));
    expect(result?.metadata?.intercept).not.toBe('affirmation-topic-nudge-v2');
  });

  it('empty lastBotMessage prevents affirmation routing', () => {
    const sess = session({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage: '',
    });
    const result = tryDeterministicIntent(ctx('yes', sess));
    expect(result?.metadata?.intercept).not.toBe('affirmation-topic-nudge-v2');
  });

  it('lastBotMessage that only mentions topic in passing (not a nudge) does not fire', () => {
    // "Your BCBSTX Dental PPO plan" mentions dental but is not a nudge
    const sess = session({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage: 'Your medical plan uses the BCBSTX Dental PPO network for out-of-area claims.',
    });
    const result = tryDeterministicIntent(ctx('yes', sess));
    expect(result?.metadata?.intercept).not.toBe('affirmation-topic-nudge-v2');
  });

  it('"no thanks. what\'s after that?" is NOT an affirmation', () => {
    const sess = session({
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Dental', 'Vision', 'Life Insurance'],
      lastBotMessage: "Would you like to walk through Disability Insurance?",
    });
    const result = tryDeterministicIntent(ctx("no thanks. what's after that?", sess));
    expect(result?.metadata?.intercept).not.toBe('affirmation-topic-nudge-v2');
  });
});

// ─── REGRESSION 4: Canonical topic order ────────────────────────────────────
// The nudge must always follow Medical → Dental → Vision → Life Insurance →
// Disability → Critical Illness → Accident/AD&D → HSA/FSA order.

describe('Canonical topic order', () => {
  it('after Medical, next is Dental (not Vision or anything else)', () => {
    const sess = session({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage: "Medical is done — shall we move on to dental?",
    });
    const result = tryDeterministicIntent(ctx('yes', sess));
    expect(result?.topic).toBe('Dental');
  });

  it('after Medical+Dental+Vision, next is Life Insurance', () => {
    const sess = session({
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      lastBotMessage: "Vision covered! Life Insurance is next — want me to walk you through it?",
    });
    const result = tryDeterministicIntent(ctx('proceed', sess));
    expect(result?.topic).toBe('Life Insurance');
  });

  it('after Medical through Critical Illness, next is Accident/AD&D', () => {
    const sess = session({
      currentTopic: 'Critical Illness',
      completedTopics: ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness'],
      lastBotMessage: "Next up is Accident/AD&D — ready?",
    });
    const result = tryDeterministicIntent(ctx('ready', sess));
    expect(result?.topic).toBe('Accident/AD&D');
  });
});

// ─── REGRESSION 5: Compliance facts ─────────────────────────────────────────
// These must always return deterministic answers, never go to the LLM.

describe('Compliance facts: Kaiser state availability', () => {
  it('"which states have kaiser" returns compliance fact', () => {
    const result = tryDeterministicIntent(ctx('which states have kaiser?', session()));
    expect(result).not.toBeNull();
    expect(result!.metadata.intercept).toBe('compliance-fact-v2');
    expect(result!.metadata.fact).toBe('kaiser-state-availability');
    // Must name the allowed states
    const answer = result!.answer;
    expect(answer).toMatch(/california|CA/i);
    expect(answer).toMatch(/oregon|OR/i);
    expect(answer).toMatch(/washington|WA/i);
  });

  it('"is kaiser available in TX" states not available', () => {
    const result = tryDeterministicIntent(ctx('is kaiser available in TX?', session()));
    expect(result).not.toBeNull();
    // Answer should indicate TX is not a Kaiser state
    expect(result!.answer.toLowerCase()).toMatch(/not\s+available|not\s+offered|must\s+choose|bcbstx/i);
  });
});

describe('Compliance facts: Basic Life cost', () => {
  it('"how much does basic life cost" returns $0', () => {
    const result = tryDeterministicIntent(ctx('how much does basic life cost?', session()));
    expect(result).not.toBeNull();
    expect(result!.metadata.intercept).toBe('compliance-fact-v2');
    expect(result!.metadata.fact).toBe('basic-life-cost');
    expect(result!.answer).toMatch(/\$0|\$0\/month|employer.?paid/i);
  });

  it('"is basic life free" returns employer-paid answer', () => {
    const result = tryDeterministicIntent(ctx('is basic life free?', session()));
    expect(result?.metadata?.fact).toBe('basic-life-cost');
  });
});

describe('Compliance facts: HSA employer contribution', () => {
  it('"how much does amerivet contribute to hsa" returns contribution amount', () => {
    const result = tryDeterministicIntent(ctx('how much does amerivet contribute to the hsa?', session()));
    expect(result).not.toBeNull();
    expect(result!.metadata.intercept).toBe('compliance-fact-v2');
    expect(result!.metadata.fact).toBe('hsa-employer-contribution');
    // Must contain a dollar figure
    expect(result!.answer).toMatch(/\$\d+/);
  });
});

// ─── REGRESSION 6: Short affirmation vocabulary ─────────────────────────────
// All of these must be recognized as affirmations when following a valid nudge.

describe('Short affirmation vocabulary', () => {
  const nudgeSession = () => session({
    currentTopic: 'Medical',
    completedTopics: ['Medical'],
    lastBotMessage: "Shall we move on to dental?",
  });

  const AFFIRMATIONS = [
    'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay',
    'go ahead', 'sounds good', 'absolutely', 'definitely',
    'please', 'great', 'alright', 'of course', 'perfect',
    'ready', 'go for it', 'continue', 'next', 'move on', 'proceed',
  ];

  for (const word of AFFIRMATIONS) {
    it(`"${word}" fires affirmation routing`, () => {
      const result = tryDeterministicIntent(ctx(word, nudgeSession()));
      expect(result?.metadata?.intercept).toBe('affirmation-topic-nudge-v2');
      expect(result?.topic).toBe('Dental');
    });
  }
});
