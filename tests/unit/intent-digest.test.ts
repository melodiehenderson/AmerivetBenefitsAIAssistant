import { describe, expect, it } from 'vitest';
import { digestIntent } from '@/lib/intent-digest';
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
});
