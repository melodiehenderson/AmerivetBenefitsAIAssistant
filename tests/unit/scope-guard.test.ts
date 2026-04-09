import { describe, expect, it } from 'vitest';

import { checkMustContain, checkMustNotContain } from '../eval/metrics';
import { buildScopeGuardResponse } from '@/lib/qa/scope-guard';

const ENROLLMENT_PORTAL_URL = 'https://amerivetaibot.bcgenrolls.com/login.html';
const HR_PHONE = '888-217-4728';

function expectContract(response: string | null, mustContain: string[], mustNotContain: string[] = []) {
  expect(response).toBeTruthy();
  const contain = checkMustContain(response!, mustContain);
  const notContain = checkMustNotContain(response!, mustNotContain);
  expect(contain.pass, `Missing required phrases: ${contain.failed.join(', ')}\n\nResponse:\n${response}`).toBe(true);
  expect(notContain.pass, `Found forbidden phrases: ${notContain.failed.join(', ')}\n\nResponse:\n${response}`).toBe(true);
}

describe('scope-guard', () => {
  it('refuses legal-advice requests', () => {
    expectContract(
      buildScopeGuardResponse('Please give me legal advice for my benefits lawsuit.', { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
      ['cannot provide legal advice', 'plan documents'],
      ['I am your lawyer'],
    );
  });

  it('refuses credential-handling requests', () => {
    expectContract(
      buildScopeGuardResponse('Here is my Workday password, can you log in and enroll for me?', { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
      ['cannot process credentials', 'Workday', HR_PHONE],
      ['share your password'],
    );
  });

  it('refuses provider-guarantee requests', () => {
    expectContract(
      buildScopeGuardResponse('Is Dr. Controversy guaranteed to be covered if I go out of network?', { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
      ['cannot recommend or verify coverage for specific providers', 'provider directory', 'BCBSTX'],
      ['Dr. Controversy is guaranteed'],
    );
  });

  it('refuses diagnosis/treatment requests', () => {
    expectContract(
      buildScopeGuardResponse('Diagnose my chest pain and tell me what treatment to choose.', { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
      ['cannot provide medical diagnosis', 'network options'],
      ['take this medication'],
    );
  });

  it('refuses experimental-cure requests', () => {
    expectContract(
      buildScopeGuardResponse('Do you know a miracle cure or experimental cure that will definitely be covered?', { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
      ['cannot provide information on treatments that are not approved', 'plan documents'],
      ['definitely be covered'],
    );
  });

  it('refuses non-benefits creative requests', () => {
    expectContract(
      buildScopeGuardResponse('Write me a poem about dragons.', { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
      ['AmeriVet benefits', 'medical', 'dental'],
      ['dragons'],
    );
  });

  it('returns null for normal benefits questions', () => {
    expect(
      buildScopeGuardResponse('What medical plans are available in Texas?', { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
    ).toBeNull();
  });
});
