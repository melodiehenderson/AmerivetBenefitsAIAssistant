import { describe, expect, it } from 'vitest';

import type { Session } from '@/lib/rag/session-store';
import { buildCategoryExplorationResponse, buildCoverageTierOptionsResponse } from '@/lib/qa/category-response-builders';
import { buildRecommendationOverview } from '@/lib/qa/medical-helpers';

const baseSession = (overrides: Partial<Session> = {}): Session => ({
  step: 'active_chat',
  context: {},
  userName: 'Guest',
  hasCollectedName: true,
  userAge: 34,
  userState: 'TX',
  noPricingMode: false,
  ...overrides,
});

describe('category-response-builders', () => {
  it('returns a deterministic medical overview without Kaiser for non-eligible states', () => {
    const response = buildCategoryExplorationResponse({
      queryLower: 'tell me about medical',
      session: baseSession({ userState: 'TX' }),
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: 'https://example.com/workday',
      hrPhone: '888-217-4728',
    });

    expect(response).toContain('Medical plan options');
    expect(response).toContain('Standard HSA');
    expect(response).toContain('Enhanced HSA');
    expect(response).toContain('Kaiser Standard HMO is only available in CA, GA, WA, and OR.');
  });

  it('returns a deterministic benefits overview', () => {
    const response = buildCategoryExplorationResponse({
      queryLower: 'benefits overview',
      session: baseSession(),
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: 'https://example.com/workday',
      hrPhone: '888-217-4728',
    });

    expect(response).toContain('Medical');
    expect(response).toContain('Dental');
    expect(response).toContain('Vision');
  });

  it('returns a deterministic family coverage overview for spouse-plus-kids prompts', () => {
    const response = buildCategoryExplorationResponse({
      queryLower: 'i need to understand family coverage options. my spouse works part-time and we have two kids.',
      session: baseSession({ userState: 'WA' }),
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: 'https://example.com/workday',
      hrPhone: '888-217-4728',
    });

    expect(response).toContain('Employee + Family');
    expect(response).toContain('Medical options at that tier');
    expect(response).toContain('Dental');
    expect(response).toContain('Vision');
  });

  it('returns a deterministic recommendation overview for a healthy single user', () => {
    const response = buildRecommendationOverview('I am single and healthy. What do you recommend?', baseSession());

    expect(response).toContain('Recommendation for Employee Only coverage');
    expect(response).toContain('Standard HSA');
    expect(response).toContain('Want me to compare total annual costs');
  });

  it('treats an explicit dental follow-up as a topic shift to dental instead of lingering on medical', async () => {
    const { deriveConversationTopic } = await import('@/lib/qa/routing-helpers');

    expect(
      deriveConversationTopic({
        benefitTypes: ['Dental'],
        existingTopic: 'Medical',
        normalizedMessage: 'and for dental?',
      }),
    ).toBe('Dental');
  });

  it('returns a deterministic life-insurance overview with the correct UNUM and Allstate lineup', () => {
    const response = buildCategoryExplorationResponse({
      queryLower: 'tell me about life insurance',
      session: baseSession(),
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: 'https://example.com/workday',
      hrPhone: '888-217-4728',
    });

    expect(response).toContain('Basic Life & AD&D');
    expect(response).toContain('Voluntary Term Life');
    expect(response).toContain('Whole Life');
    expect(response).toContain('Unum');
    expect(response).toContain('Allstate');
  });

  it('returns a deterministic disability overview without fabricating detailed policy terms', () => {
    const response = buildCategoryExplorationResponse({
      queryLower: 'tell me about disability insurance',
      session: baseSession(),
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: 'https://example.com/workday',
      hrPhone: '888-217-4728',
    });

    expect(response).toContain('Short-Term and Long-Term Disability options are available');
    expect(response).toContain('Workday');
    expect(response).toContain('888-217-4728');
  });

  it('returns the four canonical medical coverage tiers', () => {
    const response = buildCoverageTierOptionsResponse(baseSession({ userState: 'WA' }), 'medical');

    expect(response).toContain('Employee Only');
    expect(response).toContain('Employee + Spouse');
    expect(response).toContain('Employee + Child(ren)');
    expect(response).toContain('Employee + Family');
  });
});
