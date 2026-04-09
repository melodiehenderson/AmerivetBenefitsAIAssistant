import { describe, expect, it } from 'vitest';

import {
  buildKaiserAvailabilityFaqAnswer,
  checkL1FAQ,
  isKaiserAvailabilityQuestion,
  isStandaloneMedicalPpoRequest,
} from '../../lib/qa/routing-helpers';
import { buildPpoClarificationForState } from '../../lib/qa/medical-helpers';

describe('routing-helpers deterministic routing guards', () => {
  it('detects standalone medical PPO requests without catching dental PPO', () => {
    expect(isStandaloneMedicalPpoRequest('Do you offer a PPO medical plan?')).toBe(true);
    expect(isStandaloneMedicalPpoRequest('I want the PPO option')).toBe(true);
    expect(isStandaloneMedicalPpoRequest('What does the dental PPO cost?')).toBe(false);
  });

  it('detects Kaiser availability questions consistently', () => {
    expect(isKaiserAvailabilityQuestion('Which states offer Kaiser?')).toBe(true);
    expect(isKaiserAvailabilityQuestion('Where is Kaiser available?')).toBe(true);
    expect(isKaiserAvailabilityQuestion('Tell me more about Kaiser benefits')).toBe(false);
  });

  it('returns the Georgia-inclusive Kaiser FAQ answer', () => {
    const answer = checkL1FAQ('Which states offer Kaiser?', {
      enrollmentPortalUrl: 'https://example.com/workday',
      hrPhone: '888-217-4728',
    });

    expect(answer).toContain('Georgia (GA)');
    expect(answer).toContain('Washington (WA)');
    expect(answer).toContain('Oregon (OR)');
  });

  it('returns state-specific Kaiser availability guidance when a state is present', () => {
    expect(buildKaiserAvailabilityFaqAnswer('GA')).toContain('available in GA');
    expect(buildKaiserAvailabilityFaqAnswer('TX')).toContain('not available in TX');
  });

  it('shares the same PPO clarification wording for GA users', () => {
    const answer = buildPpoClarificationForState('GA');

    expect(answer).toContain('Kaiser Standard HMO in GA');
    expect(answer).toContain('does not offer a standalone PPO medical plan');
  });
});
