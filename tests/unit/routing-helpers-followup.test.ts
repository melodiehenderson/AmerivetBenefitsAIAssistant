import { describe, expect, it } from 'vitest';

import {
  deriveConversationTopic,
  isLikelyFollowUpMessage,
  isSimpleAffirmation,
  isTopicContinuationMessage,
  shouldUseCategoryExplorationIntercept,
} from '../../lib/qa/routing-helpers';

describe('routing-helpers follow-up heuristics', () => {
  it('detects simple affirmations consistently', () => {
    expect(isSimpleAffirmation('yes')).toBe(true);
    expect(isSimpleAffirmation('go ahead')).toBe(true);
    expect(isSimpleAffirmation('tell me more')).toBe(false);
  });

  it('detects likely follow-up messages consistently', () => {
    expect(isLikelyFollowUpMessage('yes')).toBe(true);
    expect(isLikelyFollowUpMessage('yes.')).toBe(true);
    expect(isLikelyFollowUpMessage('what about that')).toBe(true);
    expect(isLikelyFollowUpMessage('compare')).toBe(true);
    expect(isLikelyFollowUpMessage('what coverage tiers are available?')).toBe(true);
    expect(isLikelyFollowUpMessage("I'm in WA")).toBe(true);
    expect(isLikelyFollowUpMessage('my usage is moderate')).toBe(true);
    expect(isLikelyFollowUpMessage('what medical plans are available in texas')).toBe(false);
  });

  it('detects topic continuation when no new category is named', () => {
    expect(isTopicContinuationMessage('I want to know the difference in the plans available', 'Medical')).toBe(true);
    expect(isTopicContinuationMessage('what options do I have?', 'Dental')).toBe(true);
    expect(isTopicContinuationMessage('what coverage tiers are available?', 'Medical')).toBe(true);
    expect(isTopicContinuationMessage("I'm in WA", 'Medical')).toBe(true);
    expect(isTopicContinuationMessage('my usage is moderate', 'Medical')).toBe(true);
    expect(isTopicContinuationMessage('tell me about dental', 'Medical')).toBe(false);
    expect(isTopicContinuationMessage('what options do I have?', undefined)).toBe(false);
  });

  it('treats conversational category pivots like "let\'s look at medical" as category exploration', () => {
    expect(shouldUseCategoryExplorationIntercept("Let's look at medical", "let's look at medical", 'general')).toBe(true);
    expect(shouldUseCategoryExplorationIntercept("Okay, let's do vision", "okay, let's do vision", 'general')).toBe(true);
    expect(shouldUseCategoryExplorationIntercept('medical please', 'medical please', 'general')).toBe(true);
    expect(shouldUseCategoryExplorationIntercept("I'd like to see my medical options", "i'd like to see my medical options", 'general')).toBe(true);
    expect(shouldUseCategoryExplorationIntercept('Tell me about dental', 'tell me about dental', 'general')).toBe(true);
    expect(shouldUseCategoryExplorationIntercept('I need to understand family coverage options. My spouse works part-time and we have two kids.', 'i need to understand family coverage options. my spouse works part-time and we have two kids.', 'general')).toBe(true);
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
