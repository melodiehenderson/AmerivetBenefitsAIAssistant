import { describe, expect, it } from 'vitest';
import { ensureNameForDemographics, shouldPromptForName } from '@/lib/session-logic';
import type { Session } from '@/lib/rag/session-store';

describe('session-logic', () => {
  it('marks guest and skips name prompt when age/state are present', () => {
    const session: Session = {
      step: 'start',
      context: {},
      userAge: 30,
      userState: 'TX',
      hasCollectedName: false,
    };

    ensureNameForDemographics(session);

    expect(session.userName).toBe('Guest');
    expect(session.hasCollectedName).toBe(true);
    expect(shouldPromptForName(session)).toBe(false);
  });
});
