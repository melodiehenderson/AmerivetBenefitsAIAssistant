import { describe, expect, it } from 'vitest';

import { checkMustContain, checkMustNotContain } from '../eval/metrics';
import {
  buildKaiserAvailabilityFaqAnswer,
  checkL1FAQ,
  detectExplicitStateCorrection,
  deriveConversationTopic,
  isLikelyFollowUpMessage,
  isOtherChoicesMessage,
  isPackageGuidanceMessage,
  isSimpleAffirmation,
  isStandaloneMedicalPpoRequest,
  stripAffirmationLeadIn,
  shouldUseCategoryExplorationIntercept,
  isTopicContinuationMessage,
} from '@/lib/qa/routing-helpers';
import {
  buildKaiserUnavailableFallback,
  buildPpoClarificationForState,
  buildRecommendationOverview,
} from '@/lib/qa/medical-helpers';
import { buildCategoryExplorationResponse, buildDentalVisionComparisonResponse } from '@/lib/qa/category-response-builders';
import { buildStdLeavePayTimeline } from '@/lib/qa/policy-response-builders';
import { buildClarifyThenPortalFallback } from '@/lib/qa/support-response-builders';
import type { Session } from '@/lib/rag/session-store';

const ENROLLMENT_PORTAL_URL = 'https://amerivetaibot.bcgenrolls.com/login.html';
const HR_PHONE = '888-217-4728';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    step: 'active_chat',
    context: {},
    ...overrides,
  };
}

function expectContractPhrases(response: string, mustContain: string[], mustNotContain: string[] = []) {
  const contain = checkMustContain(response, mustContain);
  const notContain = checkMustNotContain(response, mustNotContain);

  expect(
    contain.pass,
    `Missing required phrases: ${contain.failed.join(', ')}\n\nResponse:\n${response}`,
  ).toBe(true);
  expect(
    notContain.pass,
    `Found forbidden phrases: ${notContain.failed.join(', ')}\n\nResponse:\n${response}`,
  ).toBe(true);
}

describe('conversation scenario regressions', () => {
  it('refuses fake PPO/Rightway medical questions without inventing benefits', () => {
    const response = checkL1FAQ(
      'Does AmeriVet offer a gold PPO with Rightway support?',
      { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE },
    );

    expect(response).toBeTruthy();
    expectContractPhrases(response!, ['Rightway is not an AmeriVet benefits resource', HR_PHONE], [
      'gold PPO',
      'Rightway support is included',
    ]);
  });

  it('answers Kaiser availability consistently for Georgia and Texas', () => {
    const georgia = buildKaiserAvailabilityFaqAnswer('GA');
    const texas = buildKaiserAvailabilityFaqAnswer('TX');

    expectContractPhrases(georgia, ['Yes', 'GA', 'Kaiser HMO is available'], ['not available in GA']);
    expectContractPhrases(texas, ['not available in TX', 'Standard HSA', 'Enhanced HSA'], ['Yes — Kaiser HMO is available in TX']);
  });

  it('clarifies standalone PPO requests instead of pretending there is a traditional medical PPO', () => {
    expect(isStandaloneMedicalPpoRequest('Do you have a PPO plan in Georgia?')).toBe(true);

    const response = buildPpoClarificationForState('GA');
    expectContractPhrases(response, ['does not offer a standalone PPO medical plan', 'Kaiser Standard HMO', 'nationwide PPO network'], [
      'traditional PPO is available',
    ]);
  });

  it('gives a state-aware medical overview for Washington without dropping Kaiser', () => {
    const session = makeSession({ userState: 'WA' });
    const response = buildCategoryExplorationResponse({
      queryLower: 'what medical plan options do i have?',
      session,
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
      hrPhone: HR_PHONE,
    });

    expect(response).toBeTruthy();
    expectContractPhrases(response!, ['Standard HSA', 'Enhanced HSA', 'Kaiser Standard HMO'], [
      'Kaiser Standard HMO is only available in CA, GA, WA, and OR.',
    ]);
  });

  it('gives a state-aware medical overview for Texas and filters Kaiser out', () => {
    const session = makeSession({ userState: 'TX' });
    const response = buildCategoryExplorationResponse({
      queryLower: 'what medical plan options do i have?',
      session,
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
      hrPhone: HR_PHONE,
    });

    expect(response).toBeTruthy();
    expectContractPhrases(response!, ['Standard HSA', 'Enhanced HSA', 'Kaiser Standard HMO is only available in CA, GA, WA, and OR'], [
      '- Kaiser Standard HMO (Kaiser Permanente)',
    ]);
  });

  it('keeps recommendation flow deterministic for healthy single users', () => {
    const session = makeSession({ userState: 'TX' });
    const response = buildRecommendationOverview(
      'I am healthy, single, and want the best plan to save money',
      session,
    );

    expect(response).toBeTruthy();
    expectContractPhrases(response!, ['My recommendation: Standard HSA', 'single/only covering yourself', 'save money'], [
      'Kaiser Standard HMO is also an option.',
    ]);
  });

  it('asks one focused clarifier for plain-language medical recommendation requests when usage is unknown', () => {
    const response = buildRecommendationOverview(
      'what’s best for me?',
      makeSession({
        userState: 'TX',
        currentTopic: 'Medical',
        lastBotMessage: 'Medical plan options: Standard HSA and Enhanced HSA. Want help deciding?',
      }),
    );

    expectContractPhrases(response!, ['biggest factor is how much care you expect to use', 'low, moderate, or high'], [
      'contact HR',
    ]);
  });

  it('produces a stable dental-versus-vision comparison table', () => {
    const response = buildDentalVisionComparisonResponse(makeSession());

    expectContractPhrases(response, ['BCBSTX Dental PPO', 'VSP Vision Plus', '| Carrier |', '| Deductible |'], [
      'DHMO',
    ]);
  });

  it('uses clarify-first support fallback for unverifiable questions', () => {
    const response = buildClarifyThenPortalFallback(ENROLLMENT_PORTAL_URL, HR_PHONE);

    expectContractPhrases(response, [
      "official AmeriVet benefits",
      'reply with the specific benefit, plan name, or state',
      ENROLLMENT_PORTAL_URL,
      HR_PHONE,
    ]);
  });

  it('supports leave-pay timeline questions with waiting-period detail', () => {
    const response = buildStdLeavePayTimeline('what is maternity leave pay if i make $5000 / month');

    expectContractPhrases(response, ['Weeks 1-2', 'Weeks 3-6', '60% of your pre-disability base earnings', '$3000.00/month'], [
      'FMLA supplies pay on its own',
    ]);
  });

  it('treats "yes please" as a follow-up and preserves the current topic', () => {
    expect(isSimpleAffirmation('yes please')).toBe(true);
    expect(isLikelyFollowUpMessage('yes please')).toBe(true);
    expect(isTopicContinuationMessage('yes please', 'Medical')).toBe(true);
    expect(
      deriveConversationTopic({
        benefitTypes: [],
        existingTopic: 'Medical',
        normalizedMessage: 'yes please',
      }),
    ).toBe('Medical');
  });

  it('treats "what\'s the difference?" as a topic continuation instead of a reset', () => {
    expect(isLikelyFollowUpMessage("what's the difference?")).toBe(true);
    expect(isTopicContinuationMessage("what's the difference?", 'Medical')).toBe(true);
    expect(
      deriveConversationTopic({
        benefitTypes: [],
        existingTopic: 'Medical',
        normalizedMessage: "what's the difference?",
      }),
    ).toBe('Medical');
  });

  it('treats "Any workaround?" as an HSA/FSA continuation instead of a reset', () => {
    expect(isLikelyFollowUpMessage('Any workaround?')).toBe(true);
    expect(isTopicContinuationMessage('Any workaround?', 'HSA/FSA')).toBe(true);
    expect(
      deriveConversationTopic({
        benefitTypes: [],
        existingTopic: 'HSA/FSA',
        normalizedMessage: 'Any workaround?',
      }),
    ).toBe('HSA/FSA');
  });

  it('treats "What about the waiting period?" as a disability continuation instead of a reset', () => {
    expect(isLikelyFollowUpMessage('What about the waiting period?')).toBe(true);
    expect(isTopicContinuationMessage('What about the waiting period?', 'Disability')).toBe(true);
    expect(
      deriveConversationTopic({
        benefitTypes: [],
        existingTopic: 'Disability',
        normalizedMessage: 'What about the waiting period?',
      }),
    ).toBe('Disability');
  });

  it('treats package-guidance phrasing as a valid continuation instead of a reset', () => {
    expect(isPackageGuidanceMessage('what else should i consider?')).toBe(true);
    expect(isPackageGuidanceMessage('what other things in my benefits package should i think about?')).toBe(true);
    expect(isLikelyFollowUpMessage('what else should i consider?')).toBe(true);
    expect(isTopicContinuationMessage('what else should i consider?', 'Vision')).toBe(true);
    expect(
      deriveConversationTopic({
        benefitTypes: [],
        existingTopic: 'Vision',
        normalizedMessage: 'what else should i consider?',
      }),
    ).toBe('Vision');
  });

  it('treats broader "other choices" wording as follow-up exploration', () => {
    expect(isOtherChoicesMessage('are there any other plans?')).toBe(true);
    expect(isOtherChoicesMessage('do i have any other options?')).toBe(true);
    expect(isLikelyFollowUpMessage('are there any other plans?')).toBe(true);
    expect(isTopicContinuationMessage('are there any other plans?', 'Dental')).toBe(true);
  });

  it('detects explicit state corrections from natural phrasing', () => {
    expect(detectExplicitStateCorrection('actually im in GA', 'LA')).toEqual({ state: 'GA' });
    expect(detectExplicitStateCorrection('I meant Georgia', 'LA')).toEqual({ state: 'GA' });
    expect(detectExplicitStateCorrection('sorry, Colorado not Kansas', 'KS')).toEqual({ state: 'CO' });
  });

  it('treats affirmative topic pivots as category exploration instead of fallback', () => {
    expect(
      shouldUseCategoryExplorationIntercept(
        'yes - show me what i can get for vision',
        'yes - show me what i can get for vision',
        'lookup',
      ),
    ).toBe(true);

    expect(
      shouldUseCategoryExplorationIntercept(
        "ok let's do life next",
        "ok let's do life next",
        'lookup',
      ),
    ).toBe(true);
  });

  it('strips chatty lead-ins before routing a follow-up topic pivot', () => {
    expect(stripAffirmationLeadIn('oh! okay - yeah - life insurance info')).toBe('life insurance info');
    expect(
      shouldUseCategoryExplorationIntercept(
        'oh! okay - yeah - life insurance info',
        'oh! okay - yeah - life insurance info',
        'lookup',
      ),
    ).toBe(true);
  });

  it('redirects non-Kaiser states back to HSA comparison instead of forcing Kaiser', () => {
    const response = buildKaiserUnavailableFallback(makeSession({ userState: 'NY' }), 'redirect');

    expectContractPhrases(response, ['Kaiser is only available in California, Georgia, Washington, and Oregon', 'Enhanced HSA', 'side-by-side comparison'], [
      'Kaiser Standard HMO is available in NY',
    ]);
  });
});
