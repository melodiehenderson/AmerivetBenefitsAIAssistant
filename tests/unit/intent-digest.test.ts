import { describe, expect, it } from 'vitest';
import { determineChatRoutePolicy, digestIntent } from '@/lib/intent-digest';
import type { Session } from '@/lib/rag/session-store';

const baseSession = (): Session => ({
  step: 'active_chat',
  context: {},
  userName: 'Guest',
  hasCollectedName: true,
  userAge: 30,
  userState: 'TX',
  noPricingMode: false,
});

describe('intent-digest', () => {
  it('enforces PPO guardrail phrasing', () => {
    const result = digestIntent(
      'Do you offer a PPO plan?',
      baseSession(),
      'general',
      'general',
      false
    );

    expect(result.guardrail).toContain(
      'AmeriVet does not offer a standalone PPO plan; however, both the Standard and Enhanced HSA plans utilize the BCBSTX Nationwide PPO network.'
    );
  });

  it('adds pricing exclusion guardrail when requested', () => {
    const result = digestIntent(
      'Tell me about medical coverage',
      baseSession(),
      'general',
      'general',
      true
    );

    expect(result.guardrail).toContain(
      'PRICING EXCLUSION: Describe all coverage features, networks, and inclusions, but strictly omit all dollar amounts for premiums.'
    );
  });

  it('prefers RAG for policy questions even when slots are incomplete', () => {
    const policy = determineChatRoutePolicy({
      lowerQuery: 'how many days do i have to file a qualifying life event?',
      benefitTypes: [],
      mappedIntent: 'general',
      slotsComplete: false,
      useRagOverride: false,
      useSmartOverride: true,
    });

    expect(policy.intentDomain).toBe('policy');
    expect(policy.preferredLayer).toBe('retrieval');
    expect(policy.fallbackLayer).toBe('generation');
    expect(policy.deterministicFirst).toBe(false);
    expect(policy.requiresUserContext).toBe(false);
    expect(policy.shouldUseRag).toBe(true);
    expect(policy.shouldUseSmart).toBe(false);
  });

  it('keeps smart routing for incomplete non-policy queries', () => {
    const policy = determineChatRoutePolicy({
      lowerQuery: 'show me medical options',
      benefitTypes: ['medical'],
      mappedIntent: 'coverage',
      slotsComplete: false,
      useRagOverride: false,
      useSmartOverride: true,
    });

    expect(policy.intentDomain).toBe('general');
    expect(policy.preferredLayer).toBe('generation');
    expect(policy.fallbackLayer).toBe('deterministic');
    expect(policy.deterministicFirst).toBe(true);
    expect(policy.requiresUserContext).toBe(true);
    expect(policy.shouldUseRag).toBe(false);
    expect(policy.shouldUseSmart).toBe(true);
  });

  it('prefers RAG for slot-complete complex benefit questions', () => {
    const policy = determineChatRoutePolicy({
      lowerQuery: 'compare the medical plans for me',
      benefitTypes: ['medical'],
      mappedIntent: 'compare',
      slotsComplete: true,
      useRagOverride: false,
      useSmartOverride: true,
    });

    expect(policy.preferredLayer).toBe('retrieval');
    expect(policy.fallbackLayer).toBe('generation');
    expect(policy.shouldUseRag).toBe(true);
    expect(policy.shouldUseSmart).toBe(false);
  });

  it('defaults simple queries to deterministic-first handling', () => {
    const policy = determineChatRoutePolicy({
      lowerQuery: 'what is the hr phone number?',
      benefitTypes: [],
      mappedIntent: 'general',
      slotsComplete: false,
      useRagOverride: false,
      useSmartOverride: false,
    });

    expect(policy.intentDomain).toBe('general');
    expect(policy.preferredLayer).toBe('deterministic');
    expect(policy.fallbackLayer).toBe('generation');
    expect(policy.deterministicFirst).toBe(true);
    expect(policy.requiresUserContext).toBe(true);
    expect(policy.shouldUseRag).toBe(false);
    expect(policy.shouldUseSmart).toBe(false);
  });
});
