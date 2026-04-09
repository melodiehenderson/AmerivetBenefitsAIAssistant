import type { Session } from '@/lib/rag/session-store';

export type RoutedFallback = {
  answer: string;
  intercept: string;
};

type PipelineFirstFallbackArgs = {
  query: string;
  session: Session;
  interceptSuffix?: string;
  summaryAnswer?: string | null;
  faqAnswer?: string | null;
  ppoAnswerFactory: () => string;
  recommendationAnswer?: string | null;
  medicalAnswer?: string | null;
};

export function resolvePipelineFirstFallback({
  query,
  interceptSuffix = '',
  summaryAnswer,
  faqAnswer,
  ppoAnswerFactory,
  recommendationAnswer,
  medicalAnswer,
}: PipelineFirstFallbackArgs): RoutedFallback | null {
  if (summaryAnswer) {
    return { answer: summaryAnswer, intercept: `summary${interceptSuffix}-fallback` };
  }

  if (faqAnswer) {
    return { answer: faqAnswer, intercept: `l1-static-faq${interceptSuffix}-fallback` };
  }

  if (/\bppo\b/i.test(query) && !/dental\s+ppo/i.test(query)) {
    return { answer: ppoAnswerFactory(), intercept: `ppo-clarification${interceptSuffix}-fallback` };
  }

  if (recommendationAnswer) {
    return { answer: recommendationAnswer, intercept: `recommendation${interceptSuffix}-fallback` };
  }

  if (medicalAnswer) {
    return { answer: medicalAnswer, intercept: `medical${interceptSuffix}-fallback` };
  }

  return null;
}

type ValidationFallbackArgs = {
  lowerQuery: string;
  interceptSuffix?: string;
  currentTopic: string | null | undefined;
  dentalVisionAnswer?: string | null;
  singleDentalAnswer?: string | null;
  categoryExplorationAnswer?: string | null;
  recommendationAnswer?: string | null;
};

export function resolveValidationFallback({
  lowerQuery,
  interceptSuffix = '',
  currentTopic,
  dentalVisionAnswer,
  singleDentalAnswer,
  categoryExplorationAnswer,
  recommendationAnswer,
}: ValidationFallbackArgs): RoutedFallback | null {
  const currentTopicLower = (currentTopic || '').toLowerCase();
  const compareDentalVisionRequested = /\bcompare\b/i.test(lowerQuery) && /\bvision\b/i.test(lowerQuery) && (/\bdental\b/i.test(lowerQuery) || currentTopicLower.includes('dental'));
  const compareDentalOnlyRequested = /\bcompare\b/i.test(lowerQuery) && /\bdental\b/i.test(lowerQuery) && !/\bvision\b/i.test(lowerQuery);

  if (compareDentalVisionRequested && dentalVisionAnswer) {
    return { answer: dentalVisionAnswer, intercept: `compare-dental-vision${interceptSuffix}-fallback` };
  }

  if (compareDentalOnlyRequested && singleDentalAnswer) {
    return { answer: singleDentalAnswer, intercept: `compare-dental-only${interceptSuffix}-fallback` };
  }

  if (categoryExplorationAnswer) {
    return { answer: categoryExplorationAnswer, intercept: `category-exploration${interceptSuffix}-fallback` };
  }

  if (recommendationAnswer) {
    return { answer: recommendationAnswer, intercept: `recommendation${interceptSuffix}-fallback` };
  }

  return null;
}
