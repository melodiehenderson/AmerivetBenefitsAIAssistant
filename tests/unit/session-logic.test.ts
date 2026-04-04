import { describe, expect, it } from 'vitest';
import { applyChildCoverageTierLock, ensureNameForDemographics, shouldPromptForName } from '@/lib/session-logic';
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

  it('locks to Employee + Child(ren) when kids are detected', () => {
    const session: Session = { step: 'start', context: {} };
    const query = 'Show me costs for me and my kids';

    const result = applyChildCoverageTierLock(session, query);

    expect(result.locked).toBe(true);
    expect(result.session.coverageTierLock).toBe('Employee + Child(ren)');
  });

  it('does not override a family lock when spouse and kids are mentioned', () => {
    const session: Session = { step: 'start', context: {}, coverageTierLock: 'Employee + Family' };
    const query = 'What about coverage for my spouse and kids?';

    const result = applyChildCoverageTierLock(session, query);

    expect(result.locked).toBe(false);
    expect(result.session.coverageTierLock).toBe('Employee + Family');
  });

  it('does not set child lock when employee-only is explicit', () => {
    const session: Session = { step: 'start', context: {} };
    const query = 'Actually, just show me employee only rates for now';

    const result = applyChildCoverageTierLock(session, query);

    expect(result.locked).toBe(false);
    expect(result.session.coverageTierLock).toBeUndefined();
  });

  it('keeps an existing child lock for unrelated follow-ups', () => {
    const session: Session = { step: 'start', context: {}, coverageTierLock: 'Employee + Child(ren)' };
    const query = 'Which plan has a lower deductible?';

    const result = applyChildCoverageTierLock(session, query);

    expect(result.locked).toBe(false);
    expect(result.session.coverageTierLock).toBe('Employee + Child(ren)');
  });
});
