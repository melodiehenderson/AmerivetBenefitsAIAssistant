import { describe, expect, it } from 'vitest';

import { checkMustContain, checkMustNotContain } from '../eval/metrics';
import pricingUtils from '@/lib/rag/pricing-utils';
import {
  buildMedicalComparisonMessage,
  buildTwoPlanComparisonMessage,
} from '@/lib/qa/medical-response-builders';
import { buildDentalVisionComparisonResponse } from '@/lib/qa/category-response-builders';
import { buildCrossBenefitDeductibleAnswer, buildMedicalPlanFallback, buildRecommendationOverview } from '@/lib/qa/medical-helpers';
import type { Session } from '@/lib/rag/session-store';

function expectContract(response: string | null, mustContain: string[], mustNotContain: string[] = []) {
  expect(response).toBeTruthy();
  const contain = checkMustContain(response!, mustContain);
  const notContain = checkMustNotContain(response!, mustNotContain);
  expect(contain.pass, `Missing required phrases: ${contain.failed.join(', ')}\n\nResponse:\n${response}`).toBe(true);
  expect(notContain.pass, `Found forbidden phrases: ${notContain.failed.join(', ')}\n\nResponse:\n${response}`).toBe(true);
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    step: 'active_chat',
    context: {},
    ...overrides,
  };
}

describe('medical-response-builders', () => {
  it('builds a deterministic standard-versus-enhanced comparison for family coverage', () => {
    const rows = pricingUtils.buildPerPaycheckBreakdown('Employee + Family', 26)
      .filter((row) => row.plan === 'Standard HSA' || row.plan === 'Enhanced HSA');

    const response = buildTwoPlanComparisonMessage({
      coverageTier: 'Employee + Family',
      payPeriods: 26,
      row1: rows.find((row) => row.plan === 'Standard HSA')!,
      row2: rows.find((row) => row.plan === 'Enhanced HSA')!,
      noPricingMode: false,
    });

    expectContract(response, ['Standard HSA', 'Enhanced HSA', 'Monthly premium', 'Per paycheck (26/yr)', 'Premium difference'], []);
  });

  it('builds a visible named-plan comparison when one plan is Kaiser', () => {
    const rows = pricingUtils.buildPerPaycheckBreakdown('Employee Only', 26)
      .filter((row) => row.plan === 'Standard HSA' || row.plan === 'Kaiser Standard HMO');

    const response = buildTwoPlanComparisonMessage({
      coverageTier: 'Employee Only',
      payPeriods: 26,
      row1: rows.find((row) => row.plan === 'Standard HSA')!,
      row2: rows.find((row) => row.plan === 'Kaiser Standard HMO')!,
      noPricingMode: false,
    });

    expectContract(response, ['Standard HSA', 'Kaiser Standard HMO', 'Monthly premium', 'Per paycheck (26/yr)', 'integrated HMO-style network'], []);
  });

  it('builds a pricing-hidden medical overview with the Kaiser regional note', () => {
    const rows = pricingUtils.buildPerPaycheckBreakdown('Employee Only', 26)
      .filter((row) => row.plan === 'Standard HSA' || row.plan === 'Enhanced HSA');

    const response = buildMedicalComparisonMessage({
      coverageTier: 'Employee Only',
      filtered: rows,
      hasHiddenKaiser: true,
      noPricingMode: true,
    });

    expectContract(response, ['Standard HSA', 'Enhanced HSA', 'Kaiser Standard HMO is available only in California, Georgia, Washington, and Oregon'], ['$']);
  });

  it('answers enhanced HSA deductible questions from the shared medical fallback', () => {
    const response = buildMedicalPlanFallback(
      'what is the deductible for enhanced hsa?',
      makeSession({ userState: 'TX' }),
    );

    expectContract(response, ['Enhanced HSA summary', 'Deductible', 'Out-of-pocket max', 'Coinsurance'], []);
  });

  it('answers practical cross-benefit deductible questions without deflecting', () => {
    const response = buildCrossBenefitDeductibleAnswer(
      "Do dental out-of-pocket payments count toward my medical plan's deductible?",
    );

    expectContract(response, ['Dental and medical coverage are generally separate benefit plans', 'do not count toward your medical plan deductible', 'separate buckets'], ['contact the AmeriVet benefits team']);
  });

  it('answers compare-the-two-plans questions from the shared medical fallback', () => {
    const response = buildMedicalPlanFallback(
      'compare standard hsa versus enhanced hsa for my family in texas',
      makeSession({ userState: 'TX' }),
    );

    expectContract(response, ['side-by-side comparison', 'Standard HSA', 'Enhanced HSA', '| Plan |', '| Deductible |'], ['Kaiser Standard HMO']);
  });

  it('gives balanced recommendation guidance for standard versus enhanced HSA', () => {
    const response = buildRecommendationOverview(
      'Which plan do you recommend: Standard HSA or Enhanced HSA?',
      makeSession({ userState: 'TX' }),
    );

    expectContract(response, ['low, moderate, or high', 'Standard HSA', 'Enhanced HSA'], ['always better']);
  });

  it('answers deductible-difference questions for individual coverage from the shared medical fallback', () => {
    const response = buildMedicalPlanFallback(
      'What is the deductible difference between Standard HSA and Enhanced HSA for individual coverage?',
      makeSession({ userState: 'TX' }),
    );

    expectContract(response, ['Standard HSA', 'Enhanced HSA', '$3,500', '$2,500'], ['Kaiser deductible']);
  });

  it('keeps dental annual max distinct from vision allowances in comparison tables', () => {
    const response = buildDentalVisionComparisonResponse(makeSession());

    expectContract(response, ['BCBSTX Dental PPO', 'VSP Vision Plus', '$1500'], ['Vision annual max $1500']);
  });

  it('compares all California medical options including Kaiser for individual coverage', () => {
    const response = buildMedicalPlanFallback(
      'Compare Standard HSA, Enhanced HSA, and Kaiser HMO for individual coverage in California.',
      makeSession({ userState: 'CA' }),
    );

    expectContract(response, ['Standard HSA', 'Enhanced HSA', 'Kaiser Standard HMO', '$6,500', '$5,500', '$4,500'], []);
  });

  it('nudges frequent-care users toward evaluating Enhanced HSA first without making absolute claims', () => {
    const response = buildRecommendationOverview(
      'What do you recommend if I expect frequent doctor visits?',
      makeSession({ userState: 'TX' }),
    );

    expectContract(response, ['My recommendation: Enhanced HSA', 'lower deductible'], ['always choose']);
  });

  it('gives a direct recommendation when low-usage savings context is already known', () => {
    const response = buildRecommendationOverview(
      "What's best for me? I'm healthy and want to save money.",
      makeSession({ userState: 'TX', currentTopic: 'Medical' }),
    );

    expectContract(response, ['My recommendation: Standard HSA', 'save money', 'lower-premium option'], ['low, moderate, or high']);
  });

  it('uses the active medical topic to answer plain-language decision questions', () => {
    const response = buildRecommendationOverview(
      'How do I decide which one?',
      makeSession({
        userState: 'TX',
        currentTopic: 'Medical',
        lastBotMessage: 'Medical plan options: Standard HSA and Enhanced HSA.',
      }),
    );

    expectContract(response, ['biggest factor is how much care you expect to use', 'low, moderate, or high'], ['contact HR']);
  });

  it('infers employee plus family when the query mentions a spouse and kids', () => {
    const response = buildRecommendationOverview(
      'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
      makeSession({ userState: 'TX' }),
    );

    expectContract(response, ['Recommendation for Employee + Family coverage', 'My recommendation: Standard HSA'], ['Employee + Child(ren)']);
  });

  it('returns null for explicit cost-estimate requests so the cost-model intercept can answer them', () => {
    const response = buildRecommendationOverview(
      'Help me calculate healthcare costs for next year. My household is family4+, usage level is high, and I prefer kaiser network.',
      makeSession({ userState: 'FL' }),
    );

    expect(response).toBeNull();
  });
});
