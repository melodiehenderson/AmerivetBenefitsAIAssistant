// Phase 1 (LLM-first pivot): deterministic intent allowlist.
//
// Only the asks that MUST be exact or are high-frequency get their own
// deterministic handler. Everything else falls through to the LLM
// passthrough. Keep this list short. If you catch yourself adding a
// regex to match a conversational shape, stop — that is what the LLM
// is for.
//
// The allowlist here is intentionally narrow:
//   1. Term-registry lookup (what's BCBSTX / HMO / HSA / FSA ...)
//   2. Benefits overview lineup ("what are my options", "show me everything")
//   3. Single plan card by name (medical / dental / vision / life / ...)
//   4. Topic switch / topic overview ("tell me about dental")
//
// Pricing, combo pricing, recommendations, coverage-tier inference, and
// all conversational shapes go through the LLM passthrough — the
// catalog is in its system prompt and the BCG rules are ground-truth,
// so it answers from verified data. Post-generation guardrails (Phase 2)
// will validate prices, plan names, and rule compliance.

import type { Session } from '@/lib/rag/session-store';
import { buildMedicalPlanDetailAnswer } from '@/lib/qa/plan-detail-lookup';
import { buildRoutineBenefitDetailAnswer, isRoutineBenefitDetailQuestion } from '@/lib/qa/routine-benefit-detail-lookup';
import { buildNonMedicalDetailAnswer, isNonMedicalDetailQuestion } from '@/lib/qa/non-medical-detail-lookup';
import { matchShortDefinitionAsk, lookupPackageTerm } from '@/lib/qa/package-term-registry';
import { buildCategoryExplorationResponse } from '@/lib/qa/category-response-builders';
import { getCoverageTierForQuery } from '@/lib/qa/medical-helpers';

export type DeterministicIntentResult = {
  answer: string;
  topic?: string | null;
  metadata: Record<string, unknown>;
};

type DeterministicIntentContext = {
  query: string;
  session: Session;
  detectedTopic: string | null;
  enrollmentPortalUrl: string;
  hrPhone: string;
};

const SUPPLEMENTAL_TOPICS = ['Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D'] as const;

/**
 * Try every deterministic intent in order. Returns the first match or
 * null. The engine hands a null result to `runLlmPassthrough`.
 */
export function tryDeterministicIntent(
  ctx: DeterministicIntentContext,
): DeterministicIntentResult | null {
  const { query, session, detectedTopic } = ctx;

  // 1. Term registry — "what's BCBSTX?", "what does HMO stand for?"
  const termDefinition = tryTermRegistry(query, session);
  if (termDefinition) return termDefinition;

  // 2. Topic-anchored plan detail — if the user is already on a specific
  //    topic (Dental, Vision, Life, Disability, Critical, Accident) and
  //    asks a topic-shaped detail question, route to that topic's
  //    answer builder BEFORE the medical path. Prevents the medical
  //    handler from accidentally claiming cross-topic queries.
  const routinePlan = tryRoutinePlanDetail(query, session, detectedTopic);
  if (routinePlan) return routinePlan;

  const nonMedicalPlan = tryNonMedicalPlanDetail(query, session, detectedTopic);
  if (nonMedicalPlan) return nonMedicalPlan;

  // 3. Medical plan detail by name / medical term explanation. Only
  //    runs when the topic is Medical (detected or active) or no topic
  //    is anchored — otherwise a non-medical topic wins above.
  if (
    detectedTopic === 'Medical'
    || (!detectedTopic && (!session.currentTopic || session.currentTopic === 'Medical' || session.currentTopic === 'Benefits Overview'))
  ) {
    const medicalPlan = tryMedicalPlanDetail(query, session);
    if (medicalPlan) return medicalPlan;
  }

  // 4. Topic overview / switch ("tell me about dental").
  const topicOverview = tryTopicOverview(ctx);
  if (topicOverview) return topicOverview;

  return null;
}

function tryTermRegistry(query: string, session: Session): DeterministicIntentResult | null {
  const match = matchShortDefinitionAsk(query);
  if (!match) return null;
  const definition = lookupPackageTerm(match.alias, session.currentTopic ?? null);
  if (!definition) return null;
  return {
    answer: definition,
    metadata: { intercept: 'term-registry-v2', term: match.alias },
  };
}

function tryMedicalPlanDetail(query: string, session: Session): DeterministicIntentResult | null {
  const answer = buildMedicalPlanDetailAnswer(query, session);
  if (!answer) return null;
  return {
    answer,
    topic: 'Medical',
    metadata: { intercept: 'medical-plan-detail-v2', topic: 'Medical' },
  };
}

function tryRoutinePlanDetail(
  query: string,
  session: Session,
  detectedTopic: string | null,
): DeterministicIntentResult | null {
  const active = detectedTopic === 'Vision' || detectedTopic === 'Dental'
    ? detectedTopic
    : session.currentTopic === 'Vision' || session.currentTopic === 'Dental'
      ? session.currentTopic
      : null;
  if (!active) return null;
  if (!isRoutineBenefitDetailQuestion(query)) return null;
  const answer = buildRoutineBenefitDetailAnswer(active as 'Dental' | 'Vision', query, session);
  if (!answer) return null;
  return {
    answer,
    topic: active,
    metadata: { intercept: 'routine-plan-detail-v2', topic: active },
  };
}

function tryNonMedicalPlanDetail(
  query: string,
  session: Session,
  detectedTopic: string | null,
): DeterministicIntentResult | null {
  const topic = SUPPLEMENTAL_TOPICS.find((t) => t === detectedTopic)
    ?? SUPPLEMENTAL_TOPICS.find((t) => t === session.currentTopic)
    ?? null;
  if (!topic) return null;
  if (!isNonMedicalDetailQuestion(topic, query)) return null;
  const answer = buildNonMedicalDetailAnswer(topic, query, session);
  if (!answer) return null;
  return {
    answer,
    topic,
    metadata: { intercept: 'non-medical-plan-detail-v2', topic },
  };
}

function tryTopicOverview(ctx: DeterministicIntentContext): DeterministicIntentResult | null {
  const { query, session, detectedTopic, enrollmentPortalUrl, hrPhone } = ctx;
  if (!detectedTopic || detectedTopic === 'Benefits Overview') return null;
  if (!isTopicOverviewShape(query)) return null;
  const queryLower = query.toLowerCase();
  const coverageTier = getCoverageTierForQuery(query, session);
  const answer = buildCategoryExplorationResponse({
    queryLower,
    session,
    coverageTier,
    enrollmentPortalUrl,
    hrPhone,
  });
  if (!answer) return null;
  return {
    answer,
    topic: detectedTopic,
    metadata: { intercept: 'topic-overview-v2', topic: detectedTopic },
  };
}

/**
 * Heuristic for "user wants an overview of this topic, not a specific
 * detail ask." Intentionally narrow — if the user's phrasing is
 * ambiguous, we'd rather let the LLM handle it with full context than
 * guess.
 */
function isTopicOverviewShape(query: string): boolean {
  const lower = query.toLowerCase().trim();
  if (lower.length > 120) return false;
  if (/\b(tell me about|what about|explain|look at|walk me through|overview of|let'?s (look at|explore)|more on|learn about)\b/i.test(lower)) {
    return true;
  }
  // Bare topic word with question mark ("dental?", "vision?")
  if (/^(dental|vision|life( insurance)?|disability|critical illness|accident|ad&d|hsa|fsa|hsa\/fsa|medical)\s*\??$/i.test(lower)) {
    return true;
  }
  return false;
}
