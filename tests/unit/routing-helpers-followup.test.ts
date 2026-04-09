import { describe, expect, it } from 'vitest';

import {
  deriveConversationTopic,
  isLikelyFollowUpMessage,
  isSimpleAffirmation,
  isTopicContinuationMessage,
} from '../../lib/qa/routing-helpers';

describe('routing-helpers follow-up heuristics', () => {
  it('detects simple affirmations consistently', () => {
    expect(isSimpleAffirmation('yes')).toBe(true);
    expect(isSimpleAffirmation('go ahead')).toBe(true);
    expect(isSimpleAffirmation('tell me more')).toBe(false);
  });

  it('detects likely follow-up messages consistently', () => {
    expect(isLikelyFollowUpMessage('yes')).toBe(true);
    expect(isLikelyFollowUpMessage('what about that')).toBe(true);
    expect(isLikelyFollowUpMessage('compare')).toBe(true);
    expect(isLikelyFollowUpMessage('what medical plans are available in texas')).toBe(false);
  });

  it('detects topic continuation when no new category is named', () => {
    expect(isTopicContinuationMessage('I want to know the difference in the plans available', 'Medical')).toBe(true);
    expect(isTopicContinuationMessage('what options do I have?', 'Dental')).toBe(true);
    expect(isTopicContinuationMessage('tell me about dental', 'Medical')).toBe(false);
    expect(isTopicContinuationMessage('what options do I have?', undefined)).toBe(false);
  });

  it('derives topic from primary category first', () => {
    expect(
      deriveConversationTopic({
        benefitTypes: [],
        primaryCategory: 'Medical',
        existingTopic: 'Dental',
        normalizedMessage: 'compare',
      }),
    ).toBe('Medical');
  });

  it('falls back to existing topic for follow-up messages', () => {
    expect(
      deriveConversationTopic({
        benefitTypes: [],
        existingTopic: 'Vision',
        normalizedMessage: 'what about that',
      }),
    ).toBe('Vision');
  });
});
