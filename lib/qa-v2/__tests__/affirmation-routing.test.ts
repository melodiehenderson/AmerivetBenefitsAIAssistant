/**
 * Unit tests for the affirmation-routing guards in deterministic-intents.
 *
 * Covers isShortAffirmation and detectNudgedTopic, which together decide whether
 * a terse "yes/sure/ok" after a topic nudge should route directly to that topic's
 * deterministic overview instead of the LLM.
 */

import { describe, it, expect } from 'vitest';
import { isShortAffirmation, detectNudgedTopic } from '@/lib/qa-v2/deterministic-intents';
import type { Session } from '@/lib/rag/session-store';

// Minimal session factory — only the fields detectNudgedTopic reads.
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session',
    turn: 1,
    hasCollectedName: true,
    disclaimerShown: true,
    currentTopic: 'Medical',
    completedTopics: ['Medical'],
    lastBotMessage: '',
    ...overrides,
  } as unknown as Session;
}

// ─── isShortAffirmation ────────────────────────────────────────────────────

describe('isShortAffirmation', () => {
  const YES = [
    'yes', 'Yeah', 'yep', 'yup', 'sure', 'ok', 'okay',
    'go ahead', 'sounds good', "let's do it", "let's go",
    'absolutely', 'definitely', 'please', 'great', 'alright',
    'of course', 'do it', 'yes please', 'sounds great', 'perfect',
    'that works', "i'm ready", 'ready', 'go for it', 'go on',
    'continue', 'next', 'move on', 'proceed',
    // trailing punctuation stripped
    'yes!', 'sure.', 'ok?',
  ];

  const NO = [
    // topic keywords mixed in → NOT a short affirmation
    'sure - hsa/fsa',
    'yes tell me about dental',
    'ok what about premiums',
    // substantive questions
    'how much does dental cost',
    'show me vision options',
    // empty
    '',
    // multi-word but not in the list
    'i think so',
    'maybe yes',
  ];

  it.each(YES)('"%s" is a short affirmation', (q) => {
    expect(isShortAffirmation(q)).toBe(true);
  });

  it.each(NO)('"%s" is NOT a short affirmation', (q) => {
    expect(isShortAffirmation(q)).toBe(false);
  });
});

// ─── detectNudgedTopic ─────────────────────────────────────────────────────

describe('detectNudgedTopic — guard: not an affirmation', () => {
  it('returns null for a substantive query even with a nudge message', () => {
    const session = makeSession({
      lastBotMessage: "shall we move on to dental?",
    });
    expect(detectNudgedTopic('tell me about dental', session)).toBeNull();
  });
});

describe('detectNudgedTopic — guard: no currentTopic', () => {
  it('returns null when still in onboarding (no currentTopic)', () => {
    const session = makeSession({
      currentTopic: null,
      completedTopics: [],
      lastBotMessage: "shall we move on to dental?",
    });
    expect(detectNudgedTopic('yes', session)).toBeNull();
  });
});

describe('detectNudgedTopic — guard: all topics covered', () => {
  it('returns null when every canonical topic is already in completedTopics', () => {
    const session = makeSession({
      currentTopic: 'HSA/FSA',
      completedTopics: ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA'],
      lastBotMessage: "Great, you're all set!",
    });
    expect(detectNudgedTopic('yes', session)).toBeNull();
  });
});

describe('detectNudgedTopic — guard: nudge message required', () => {
  it('returns null when last message merely mentions topic in passing', () => {
    // "BCBSTX Dental PPO plan" mentions dental but is not a nudge
    const session = makeSession({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage: 'Your medical plan is through BCBSTX Dental PPO.',
    });
    expect(detectNudgedTopic('yes', session)).toBeNull();
  });

  it('returns null when last bot message is empty', () => {
    const session = makeSession({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage: '',
    });
    expect(detectNudgedTopic('yes', session)).toBeNull();
  });
});

describe('detectNudgedTopic — real conversation nudge patterns', () => {
  // Each case mirrors a nudge phrasing the LLM actually produced in testing.

  it('"shall we move on to dental?" → Dental', () => {
    const session = makeSession({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage: 'Great! Shall we move on to dental next?',
    });
    expect(detectNudgedTopic('yes', session)).toBe('Dental');
  });

  it('"next topic is Dental" → Dental', () => {
    const session = makeSession({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage: 'The next topic is Dental. Would you like to go over that now?',
    });
    expect(detectNudgedTopic('yep', session)).toBe('Dental');
  });

  it('"let\'s move on to vision" → Vision', () => {
    const session = makeSession({
      currentTopic: 'Dental',
      completedTopics: ['Medical', 'Dental'],
      lastBotMessage: "Perfect! Let's move on to Vision now.",
    });
    expect(detectNudgedTopic('sure', session)).toBe('Vision');
  });

  it('"walk you through Life Insurance" → Life Insurance', () => {
    const session = makeSession({
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      lastBotMessage: "Would you like me to walk you through Life Insurance next?",
    });
    expect(detectNudgedTopic('ok', session)).toBe('Life Insurance');
  });

  it('"life insurance is the next topic" → Life Insurance', () => {
    const session = makeSession({
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      lastBotMessage: 'Life Insurance is the next topic on our list.',
    });
    expect(detectNudgedTopic('sounds good', session)).toBe('Life Insurance');
  });

  it('"shall we cover Disability?" → Disability', () => {
    const session = makeSession({
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Dental', 'Vision', 'Life Insurance'],
      lastBotMessage: 'Shall we cover Disability Insurance next?',
    });
    expect(detectNudgedTopic('yes', session)).toBe('Disability');
  });

  it('"next up is HSA/FSA" → HSA/FSA', () => {
    const session = makeSession({
      currentTopic: 'Accident/AD&D',
      completedTopics: ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D'],
      lastBotMessage: 'Next up is HSA/FSA accounts — would you like to go over those?',
    });
    expect(detectNudgedTopic('go ahead', session)).toBe('HSA/FSA');
  });
});

describe('detectNudgedTopic — no false positive when next topic matches a cross-sentence mention', () => {
  it('period stops the [^.]* match so distant mentions do not qualify', () => {
    // "Dental" is mentioned only across a sentence boundary.
    // The nudge is actually toward Vision.
    const session = makeSession({
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      lastBotMessage:
        'Your dental plan is through BCBSTX. Shall we move on to Vision?',
    });
    // nextTopic is Dental (first uncovered after Medical)
    // The sentence before the period mentions "dental" but the nudge word is
    // in the second sentence (vision), so detectNudgedTopic should return null
    // because the nudge pattern for "Dental" doesn't fire.
    // (Vision would fire but only if Dental were already covered.)
    expect(detectNudgedTopic('sure', session)).toBeNull();
  });
});

describe('detectNudgedTopic — topic-skipping: "sure - hsa/fsa" is NOT an affirmation', () => {
  it('returns null for "sure - hsa/fsa" because it contains extra content', () => {
    const session = makeSession({
      currentTopic: 'Critical Illness',
      completedTopics: ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness'],
      lastBotMessage: 'Would you like to go over Accident/AD&D next?',
    });
    // The user typed "sure - hsa/fsa" — intent to skip to HSA, not just affirm.
    // isShortAffirmation returns false, so detectNudgedTopic should be null.
    expect(detectNudgedTopic('sure - hsa/fsa', session)).toBeNull();
  });
});
