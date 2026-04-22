import { describe, expect, it } from 'vitest';
import { applyChildCoverageTierLock, applyNameCapture, ensureNameForDemographics, sanitizeSessionName, shouldPromptForName } from '@/lib/session-logic';
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

  it('accepts very short first-turn names like initials', () => {
    const session: Session = { step: 'start', context: {} };

    const result = applyNameCapture(session, 'AJ');

    expect(result.detectedName).toBe('AJ');
    expect(result.session.userName).toBe('AJ');
    expect(result.session.hasCollectedName).toBe(true);
  });

  it('accepts a single-letter first-turn name entry', () => {
    const session: Session = { step: 'start', context: {} };

    const result = applyNameCapture(session, 'Q');

    expect(result.detectedName).toBe('Q');
    expect(result.session.userName).toBe('Q');
  });

  it('does not capture welcome copy as the user name', () => {
    const session: Session = { step: 'start', context: {} };

    const result = applyNameCapture(session, 'Welcome');

    expect(result.detectedName).toBeNull();
    expect(result.session.userName).toBeUndefined();
    expect(result.session.hasCollectedName).toBeUndefined();
  });

  it('does not capture the internal welcome trigger token as a name', () => {
    const session: Session = { step: 'start', context: {} };

    const result = applyNameCapture(session, '__WELCOME__');

    expect(result.detectedName).toBeNull();
    expect(result.session.userName).toBeUndefined();
  });

  it('updates the stored name when the user explicitly corrects it later', () => {
    const session: Session = {
      step: 'active_chat',
      context: {},
      userName: 'AJ',
      hasCollectedName: true,
    };

    const result = applyNameCapture(session, 'actually, my name is Melodie');

    expect(result.detectedName).toBe('Melodie');
    expect(result.session.userName).toBe('Melodie');
  });

  it('self-heals a bad reserved stored name like WELCOME', () => {
    const session: Session = {
      step: 'awaiting_demographics',
      context: {},
      userName: 'WELCOME',
      hasCollectedName: true,
    };

    sanitizeSessionName(session);

    expect(session.userName).toBeUndefined();
    expect(session.hasCollectedName).toBe(false);
  });
});
