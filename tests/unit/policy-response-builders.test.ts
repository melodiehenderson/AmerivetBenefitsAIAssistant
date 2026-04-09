import { describe, expect, it } from 'vitest';

import {
  buildAccidentPlanNamesMessage,
  buildAllstateTermLifeCorrection,
  buildAuthorityResolutionMessage,
  buildLiveSupportMessage,
  buildParentalLeavePlan,
  buildQleFilingOrderMessage,
  buildStdLeavePayTimeline,
  buildStdPreexistingGuidance,
} from '../../lib/qa/policy-response-builders';
import type { Session } from '../../lib/rag/session-store';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    step: 'active_chat',
    context: {},
    ...overrides,
  };
}

describe('policy-response-builders', () => {
  it('buildStdPreexistingGuidance keeps the safe-unknown posture', () => {
    const response = buildStdPreexistingGuidance();

    expect(response).toContain('pre-existing condition');
    expect(response).toContain("can't safely approve or deny");
    expect(response).toContain('UNUM STD certificate/SPD');
  });

  it('buildAllstateTermLifeCorrection keeps the carrier correction and follow-up', () => {
    const response = buildAllstateTermLifeCorrection();

    expect(response).toContain('Term Life insurance is provided by UNUM');
    expect(response).toContain('Allstate covers only Whole Life');
    expect(response).toContain('Would you like to know the coverage multiples available');
  });

  it('buildAuthorityResolutionMessage preserves the tie-break order', () => {
    const response = buildAuthorityResolutionMessage();

    expect(response).toContain('Summary Plan Description (SPD)');
    expect(response).toContain('1) SPD / official plan document');
    expect(response).toContain('2) Carrier certificate of coverage');
    expect(response).toContain('3) Enrollment summaries/SBC or marketing summaries');
  });

  it('buildQleFilingOrderMessage includes location-change context when present', () => {
    const response = buildQleFilingOrderMessage(
      makeSession({
        lastDetectedLocationChange: { from: 'TX', to: 'WA', updatedAt: Date.now() },
      }),
    );

    expect(response).toContain('I updated your location to WA (from TX)');
    expect(response).toContain('File the marriage QLE first');
    expect(response).toContain('Workday');
  });

  it('buildQleFilingOrderMessage preserves marriage-first and birth/adoption follow-up order', () => {
    const response = buildQleFilingOrderMessage(makeSession());

    expect(response).toContain('File the marriage QLE first');
    expect(response).toContain('File the birth/adoption event after delivery/adoption date');
    expect(response).toContain('commonly 30 days');
  });

  it('buildLiveSupportMessage personalizes when a user name is known', () => {
    const response = buildLiveSupportMessage(
      makeSession({ userName: 'Melodie' }),
      '888-217-4728',
      'https://wd5.myworkday.com/amerivet/login.html',
    );

    expect(response).toContain("speak with someone directly, Melodie");
    expect(response).toContain('888-217-4728');
    expect(response).toContain('login.html');
  });

  it('buildAccidentPlanNamesMessage keeps both accident plan labels', () => {
    const response = buildAccidentPlanNamesMessage('888-217-4728');

    expect(response).toContain('Accident Plan 1');
    expect(response).toContain('Accident Plan 2');
    expect(response).toContain('888-217-4728');
  });

  it('buildStdLeavePayTimeline includes salary math when monthly pay is supplied', () => {
    const response = buildStdLeavePayTimeline('my salary is $5,000/month and I am on maternity leave');

    expect(response).toContain('UNUM STD pays $3000.00/month');
    expect(response).toContain('Weeks 3-6');
    expect(response).toContain('FMLA = job protection');
  });

  it('buildStdLeavePayTimeline asks for salary when math input is missing', () => {
    const response = buildStdLeavePayTimeline('how does maternity leave pay work');

    expect(response).toContain('Share your monthly salary if you want a precise dollar calculation');
  });

  it('buildParentalLeavePlan preserves the filing order and handoff channels', () => {
    const response = buildParentalLeavePlan(
      'https://wd5.myworkday.com/amerivet/login.html',
      '888-217-4728',
    );

    expect(response).toContain('Step 1 - Short-Term Disability (STD) via Unum');
    expect(response).toContain('Recommended filing order');
    expect(response).toContain('888-217-4728');
    expect(response).toContain('login.html');
  });

  it('buildParentalLeavePlan keeps the STD duration and FMLA overlap details', () => {
    const response = buildParentalLeavePlan(
      'https://wd5.myworkday.com/amerivet/login.html',
      '888-217-4728',
    );

    expect(response).toContain('Duration: up to 13 weeks');
    expect(response).toContain('up to 12 weeks of job-protected, unpaid leave');
    expect(response).toContain('Runs concurrently with STD');
  });
});
