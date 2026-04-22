// Phase 1+2 (LLM-first pivot): deterministic intent allowlist.
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
//   5. Compliance-sensitive facts (Phase 2): dependent age cutoff, Kaiser
//      state restriction, domestic partner eligibility, Basic Life cost,
//      HSA employer contribution, new-hire coverage start date.
//
// Pricing, combo pricing, recommendations, coverage-tier inference, and
// all conversational shapes go through the LLM passthrough — the
// catalog is in its system prompt and the BCG rules are ground-truth,
// so it answers from verified data. Post-generation guardrails (Phase 2)
// validate prices, plan names, and rule compliance on LLM output.

import type { Session } from '@/lib/rag/session-store';
import { buildMedicalPlanDetailAnswer } from '@/lib/qa/plan-detail-lookup';
import { buildRoutineBenefitDetailAnswer, isRoutineBenefitDetailQuestion } from '@/lib/qa/routine-benefit-detail-lookup';
import { buildNonMedicalDetailAnswer, isNonMedicalDetailQuestion } from '@/lib/qa/non-medical-detail-lookup';
import { matchShortDefinitionAsk, lookupPackageTerm } from '@/lib/qa/package-term-registry';
import { buildCategoryExplorationResponse } from '@/lib/qa/category-response-builders';
import { getCoverageTierForQuery } from '@/lib/qa/medical-helpers';
import { getAmerivetBenefitsPackage } from '@/lib/data/amerivet-package';

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

const CANONICAL_TOPIC_ORDER = [
  'Medical', 'Dental', 'Vision', 'Life Insurance',
  'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA',
] as const;

/**
 * True when the query is a short confirmation with no substantive content.
 * Used to detect "yes" / "sure" / "ok" responses to topic nudges.
 */
export function isShortAffirmation(query: string): boolean {
  const lower = query.trim().toLowerCase().replace(/[.!?]+$/, '').trim();
  return /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|sounds good|let'?s do it|let'?s go|absolutely|definitely|please|great|alright|of course|do it|yes please|sounds great|perfect|that works|i'?m ready|ready|go for it|go on|continue|next|move on|proceed)$/.test(lower);
}

/**
 * When the bot just nudged the employee toward the next topic and they
 * confirm with a short affirmation, return that topic so the caller can
 * route directly to its deterministic overview rather than the LLM.
 *
 * Guards:
 * - query must be a short affirmation
 * - session must already have a currentTopic (not still in onboarding)
 * - the next uncovered topic must differ from the current one
 * - the last bot message must mention that next topic (confirms nudge context)
 */
export function detectNudgedTopic(query: string, session: Session): string | null {
  if (!isShortAffirmation(query)) return null;
  if (!session.currentTopic) return null;

  const covered = new Set(session.completedTopics ?? []);
  const nextTopic = CANONICAL_TOPIC_ORDER.find((t) => !covered.has(t)) ?? null;
  if (!nextTopic || nextTopic === session.currentTopic) return null;

  const lastMsg = (session.lastBotMessage ?? '').toLowerCase();
  // Require nudge context — the last message must explicitly suggest moving to
  // this topic, not merely mention it in passing (e.g. "BCBSTX Dental PPO plan"
  // is not a nudge to Dental; "shall we move on to dental?" is).
  // [^.]{0,80} stops at sentence boundaries so incidental mentions across
  // sentences don't produce false positives.
  const escapedTopic = nextTopic.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nudgePattern = new RegExp(
    `(next\\s+(?:topic\\s+is|up\\s+is)?|move\\s+on\\s+to|ready\\s+for|walk\\s+you\\s+through|let'?s\\s+(?:do|look\\s+at|cover|explore|go\\s+over|dive\\s+into)|shall\\s+we(?:\\s+(?:do|cover|look\\s+at|move\\s+on))?)[^.]{0,80}${escapedTopic}` +
    `|${escapedTopic}[^.]{0,60}(?:is\\s+(?:the\\s+)?next|is\\s+up\\s+next|coming\\s+up|ready\\??)`,
    'i',
  );
  return nudgePattern.test(lastMsg) ? nextTopic : null;
}

/**
 * Try every deterministic intent in order. Returns the first match or
 * null. The engine hands a null result to `runLlmPassthrough`.
 */
export function tryDeterministicIntent(
  ctx: DeterministicIntentContext,
): DeterministicIntentResult | null {
  const { query, session, detectedTopic } = ctx;

  // 0. Affirmation-after-nudge: "yes/sure/ok" after the bot nudged toward
  //    the next topic → route directly to that topic's deterministic overview.
  //    The LLM path produces weaker, inconsistent overviews (wrong tier,
  //    missing employer-paid plans, etc.) — the deterministic handler is the
  //    right tool for structured topic introductions.
  const nudgedTopic = detectNudgedTopic(query, session);
  if (nudgedTopic) {
    const coverageTier = getCoverageTierForQuery(query, session);
    const answer = buildCategoryExplorationResponse({
      queryLower: nudgedTopic.toLowerCase(),
      session,
      coverageTier,
      enrollmentPortalUrl: ctx.enrollmentPortalUrl,
      hrPhone: ctx.hrPhone,
    });
    if (answer) {
      return {
        answer,
        topic: nudgedTopic,
        metadata: { intercept: 'affirmation-topic-nudge-v2', topic: nudgedTopic },
      };
    }
  }

  // 1. Term registry — "what's BCBSTX?", "what does HMO stand for?"
  const termDefinition = tryTermRegistry(query, session);
  if (termDefinition) return termDefinition;

  // 2. Compliance-sensitive facts (Phase 2) — must-be-exact eligibility and
  //    policy facts where LLM hallucination causes real harm. Runs before
  //    plan-detail paths so a "can my 27-year-old get coverage?" ask is never
  //    routed to a medical plan card.
  const complianceFact = tryComplianceFact(query, session);
  if (complianceFact) return complianceFact;

  // 3. Topic-anchored plan detail — if the user is already on a specific
  //    topic (Dental, Vision, Life, Disability, Critical, Accident) and
  //    asks a topic-shaped detail question, route to that topic's
  //    answer builder BEFORE the medical path. Prevents the medical
  //    handler from accidentally claiming cross-topic queries.
  const routinePlan = tryRoutinePlanDetail(query, session, detectedTopic);
  if (routinePlan) return routinePlan;

  const nonMedicalPlan = tryNonMedicalPlanDetail(query, session, detectedTopic);
  if (nonMedicalPlan) return nonMedicalPlan;

  // 4. Medical plan detail by name / medical term explanation. Only
  //    runs when the topic is Medical (detected or active) or no topic
  //    is anchored — otherwise a non-medical topic wins above.
  if (
    detectedTopic === 'Medical'
    || (!detectedTopic && (!session.currentTopic || session.currentTopic === 'Medical' || session.currentTopic === 'Benefits Overview'))
  ) {
    const medicalPlan = tryMedicalPlanDetail(query, session);
    if (medicalPlan) return medicalPlan;
  }

  // 5. Topic overview / switch ("tell me about dental").
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
  // Questions about disability/leave policy, HSA/FSA tax concepts, QLE enrollment, and provider
  // navigation should fall through to the LLM — they are not medical plan design questions.
  const lq = query.toLowerCase();
  if (
    /\b(paid\s+(during|while|on)\s+(?:\w+\s+)*leave|maternity\s+leave\s+(policy|pay(?:ment)?|benefit|income|salary)|income\s+(replacement|protection)|short.?term\s+disab|leave\s+policy|fmla)\b/i.test(lq)
    || /\b(tax\s+and\s+rollover|rollover\s+tradeoff|hsa\s+versus\s+fsa|use.it.or.lose.it)\b/i.test(lq)
    || /\bjust\s+had\s+a\s+(baby|newborn)\b/i.test(lq)
    || /\b(thinking\s+about\s+having|planning\s+to\s+have|planning\s+a\s+(baby|family|pregnancy))\b/i.test(lq)
    || /\bhow\s+do\s+i\s+(find|locate|search\s+for)\b.*\busing\b/i.test(lq)
  ) return null;
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

// ── Compliance-sensitive facts (Phase 2) ─────────────────────────────────────

/**
 * Handles eligibility and policy facts that must be exact:
 * - Dependent age cutoff (26)
 * - Kaiser state restriction
 * - Domestic partner eligibility
 * - Basic Life cost ($0 employer-paid)
 * - HSA employer contribution by tier
 * - New-hire 30-day coverage start rule
 *
 * Intentionally narrow patterns — only fires on clearly policy-shaped asks.
 * Conversational variants ("would Kaiser work for me in TX?") fall through to
 * the LLM, which has these facts in its system prompt.
 */
function tryComplianceFact(query: string, session: Session): DeterministicIntentResult | null {
  const lower = query.toLowerCase().trim();
  const pkg = getAmerivetBenefitsPackage();
  const catalog = pkg.catalog;

  // ── Dependent age cutoff ──────────────────────────────────────────────────
  if (
    /\b(dependent\s+age|age\s+(cutoff|limit|eligibility|requirement)|how\s+old\s+(can|must)\s+(my\s+)?(child|dependent|kid)|age\s+\d{2}\s+(covered|eligible)|26\s+year|turn(?:s|ed)?\s+2[567]|ag(?:e[ds]?|ing)\s+off)\b/i.test(lower)
    || /\b(can\s+(my|a)\s+\d{2}[- ]year[- ]old)\b/i.test(lower)
  ) {
    const cutoff = catalog.eligibility.dependents.children;
    return {
      answer: [
        `AmeriVet's dependent age cutoff is **26**.`,
        ``,
        `${cutoff}`,
        ``,
        `So a dependent who has already turned 27 is not eligible under the plan, regardless of whether they are a student or financially dependent.`,
        `If you're approaching that cutoff, it's worth flagging it during enrollment — a benefits counselor at 888-217-4728 can confirm the exact last-day-of-coverage date.`,
      ].join('\n'),
      metadata: { intercept: 'compliance-fact-v2', fact: 'dependent-age-cutoff' },
    };
  }

  // ── Kaiser state availability ─────────────────────────────────────────────
  // Pricing/premium questions about Kaiser fall through to the plan-detail handler.
  if (!/\b(premium|employee.only\s+premium|rate\s+in|price\s+in)\b/i.test(lower)
    && (/\b(kaiser\b.*\b(state|available|offer|enroll|access|in\s+[a-z]{2,})|which\s+states?\s+(have|offer)\s+kaiser|kaiser\s+hmo\s+(available|states?))\b/i.test(lower)
    || /\bkais(er)?\b.*\b(availab|state|where)\b/i.test(lower))
  ) {
    const stateCodes = pkg.kaiserAvailableStateCodes;
    const stateNames = stateCodes
      .map((code) => pkg.stateAbbrevToName[code] ?? code)
      .join(', ');

    // Check if user asked about a specific state
    const stateMatch = lower.match(/\bin\s+([a-z]{2,}(?:\s+[a-z]+)?)\b/i);
    const queriedState = stateMatch?.[1]?.trim();
    let stateAnswer = '';
    if (queriedState) {
      const upperCode = queriedState.toUpperCase();
      const nameMatch = Object.entries(pkg.stateAbbrevToName).find(
        ([, name]) => name.toLowerCase() === queriedState.toLowerCase(),
      );
      const code = nameMatch?.[0] ?? upperCode;
      const available = (stateCodes as readonly string[]).includes(code);
      stateAnswer = `\n\nFor **${nameMatch?.[1] ?? queriedState}** specifically: Kaiser is ${available ? 'available' : '**not available**'} there.`;
    }

    return {
      answer: [
        `Kaiser Standard HMO is only available in **${stateNames}**.`,
        ``,
        `Employees in all other states must choose between the BCBSTX Standard HSA or Enhanced HSA plans.${stateAnswer}`,
      ].join('\n'),
      metadata: { intercept: 'compliance-fact-v2', fact: 'kaiser-state-availability' },
    };
  }

  // ── Domestic partner eligibility ──────────────────────────────────────────
  if (/\b(domestic\s+partner|civil\s+union|unmarried\s+partner)\b/i.test(lower)
    && /\b(eligible|cover(?:ed|age)?|add|enroll|qualify|allowed?)\b/i.test(lower)
  ) {
    const dpEligible = catalog.eligibility.dependents.domesticPartner;
    return {
      answer: dpEligible
        ? [
            `Yes — domestic partners are eligible dependents under AmeriVet's benefits package.`,
            ``,
            `They're treated the same as spouses for enrollment purposes: you can add them to medical, dental, and vision coverage. Note that employer-paid premiums for domestic partner coverage may be treated as taxable income — a benefits counselor at 888-217-4728 can confirm the tax treatment for your situation.`,
          ].join('\n')
        : `Domestic partner coverage is not listed as an eligible benefit in the current AmeriVet package. Please confirm with a benefits counselor at 888-217-4728.`,
      metadata: { intercept: 'compliance-fact-v2', fact: 'domestic-partner-eligibility' },
    };
  }

  // ── Basic Life cost ───────────────────────────────────────────────────────
  if (
    /\b(basic\s+life|unum\s+(basic|life\s+&)|employer[\s-]paid\s+life)\b/i.test(lower)
    && /\b(cost|price|premium|how\s+much|free|pay(?:ing)?|charge|deducted?)\b/i.test(lower)
    && !/\b(recommend|should\s+i|more\s+than|voluntary\s+term|whole\s+life)\b/i.test(lower)
  ) {
    const basicLife = catalog.voluntaryPlans.find((p) => p.id === 'unum-basic-life');
    const benefit = basicLife?.benefits.description ?? '$25,000 employer-paid basic life and AD&D';
    return {
      answer: [
        `Basic Life & AD&D is **employer-paid** — your out-of-pocket cost is **$0/month**.`,
        ``,
        `${benefit}. All benefits-eligible employees are automatically enrolled; there's nothing to opt into.`,
        ``,
        `If you want coverage above that $25,000 floor, you can add Unum Voluntary Term Life on top, which is employee-paid at age-banded rates.`,
      ].join('\n'),
      metadata: { intercept: 'compliance-fact-v2', fact: 'basic-life-cost' },
    };
  }

  // ── HSA employer contribution ─────────────────────────────────────────────
  if (
    /\b(hsa|health\s+savings)\b/i.test(lower)
    && /\b(employer|company|amerivet|match|seed|fund(?:ing)?)\b/i.test(lower)
  ) {
    const hsaContrib = catalog.specialCoverage.hsa.employerContribution;
    let contribText: string;
    if (typeof hsaContrib === 'number') {
      contribText = `AmeriVet contributes **$${hsaContrib}/year** to your HSA (all coverage tiers).`;
    } else {
      const coverageTier = getCoverageTierForQuery(query, session);
      const tierKeyMap: Record<string, string> = {
        'Employee Only': 'employeeOnly',
        'Employee + Spouse': 'employeeSpouse',
        'Employee + Child(ren)': 'employeeChildren',
        'Employee + Family': 'employeeFamily',
      };
      const allTierLines = Object.entries(hsaContrib)
        .map(([tier, amt]) => `- ${tier}: **$${amt}/year**`)
        .join('\n');
      const matchedKey = tierKeyMap[coverageTier];
      const tierLabel = coverageTier;
      const tierAmt = matchedKey ? (hsaContrib as Record<string, number>)[tierLabel] : null;
      const yourTierLine = tierAmt
        ? `\n\nAt your current tier (**${tierLabel}**), AmeriVet contributes **$${tierAmt}/year**.`
        : '';
      contribText = `AmeriVet's HSA employer contribution by coverage tier:\n${allTierLines}${yourTierLine}`;
    }
    return {
      answer: [
        contribText,
        ``,
        `This contribution only applies if you enroll in an HSA-eligible plan (Standard HSA or Enhanced HSA). It goes directly into your HSA account at the start of coverage — it does not require a match from you.`,
      ].join('\n'),
      metadata: { intercept: 'compliance-fact-v2', fact: 'hsa-employer-contribution' },
    };
  }

  // ── New-hire coverage start ───────────────────────────────────────────────
  if (
    /\b(new\s+hire|new\s+employ(?:ee)?|just\s+(?:started|hired|joined)|when\s+(?:does|do|will|can)|how\s+(?:long|soon)|waiting\s+period|start\s+(?:date|of\s+coverage)|coverage\s+(start|begin|effective|kick\s+in))\b/i.test(lower)
    && /\b(cover(?:age|ed)?|insurance|benefits?|active|enroll(?:ment)?)\b/i.test(lower)
    && !/\b(dental|vision|major\s+services|married|marriage|divorced?|baby|newborn|birth|adoption|qualifying\s+life\s+event|qle|most\s+important|sign\s+up\s+for|recommend)\b/i.test(lower)
  ) {
    return {
      answer: [
        `Coverage starts on the **first of the month following 30 days of employment**.`,
        ``,
        `Example: if your start date is April 10, your 30-day mark is May 10, so coverage kicks in June 1.`,
        ``,
        `${catalog.eligibility.coverageEffective} You have 30 days from your hire date to make your elections in Workday — missing that window means waiting until the next Open Enrollment.`,
      ].join('\n'),
      metadata: { intercept: 'compliance-fact-v2', fact: 'new-hire-coverage-start' },
    };
  }

  return null;
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
