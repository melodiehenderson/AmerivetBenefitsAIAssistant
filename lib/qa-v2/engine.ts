import { STATE_ABBREV_TO_NAME } from '@/lib/data/amerivet';
import type { Session } from '@/lib/rag/session-store';
import pricingUtils from '@/lib/rag/pricing-utils';
import { buildCategoryExplorationResponse } from '@/lib/qa/category-response-builders';
import { buildRecommendationOverview, getCoverageTierForQuery, isKaiserEligibleState } from '@/lib/qa/medical-helpers';
import {
  detectExplicitStateCorrection,
  isOtherChoicesMessage,
  isPackageGuidanceMessage,
  isSimpleAffirmation,
  normalizeBenefitCategory,
  shouldUseCategoryExplorationIntercept,
  stripAffirmationLeadIn,
} from '@/lib/qa/routing-helpers';

const ENROLLMENT_PORTAL_URL = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.html';
const HR_PHONE = process.env.HR_PHONE_NUMBER || '888-217-4728';

const TOPIC_ORDER = ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA'] as const;

const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBREV_TO_NAME).map(([code, name]) => [name.toLowerCase(), code]),
);

type EngineResult = {
  answer: string;
  metadata?: Record<string, unknown>;
};

function buildSessionContext(session: Session) {
  return {
    userName: session.userName || null,
    userAge: session.userAge || null,
    userState: session.userState || null,
    hasCollectedName: session.hasCollectedName || false,
    disclaimerShown: session.disclaimerShown || false,
    currentTopic: session.currentTopic || null,
    completedTopics: session.completedTopics || [],
    askedForDemographics: session.askedForDemographics || false,
    selectedPlan: session.selectedPlan || null,
    noPricingMode: session.noPricingMode || false,
    coverageTierLock: session.coverageTierLock || null,
    dataConfirmed: session.dataConfirmed || false,
  };
}

function incrementTurn(session: Session) {
  session.turn = (session.turn || 0) + 1;
}

function markTopicCompleted(session: Session, topic?: string | null) {
  if (!topic) return;
  if (!session.completedTopics) session.completedTopics = [];
  if (!session.completedTopics.includes(topic)) {
    session.completedTopics.push(topic);
  }
}

function setTopic(session: Session, topic?: string | null) {
  if (!topic) return;
  session.currentTopic = topic;
  markTopicCompleted(session, topic);
}

function buildAllBenefitsMenu(): string {
  return [
    'Here are the benefits available to you as an AmeriVet employee:',
    '',
    '- Medical (Standard HSA, Enhanced HSA, and Kaiser Standard HMO where available)',
    '- Dental (BCBSTX Dental PPO)',
    '- Vision (VSP Vision Plus)',
    '- Life Insurance (Unum Basic Life, Unum Voluntary Term, Allstate Whole Life)',
    '- Disability (Short-Term and Long-Term through Unum)',
    '- Critical Illness (Allstate)',
    '- Accident/AD&D (Allstate)',
    '- HSA/FSA Accounts',
  ].join('\n');
}

function buildPackageGuidance(session: Session, topic?: string | null): string {
  const completed = new Set(session.completedTopics || []);
  switch (topic) {
    case 'Medical':
      return 'From here, the most useful next step is usually dental/vision if you want to round out routine care coverage, or life/disability if you are thinking about income and family protection.';
    case 'Dental':
      return completed.has('Vision')
        ? 'Since you have already looked at vision too, the next most useful area is usually life, disability, or supplemental protection.'
        : 'Since dental is usually a yes/no decision rather than a plan comparison, the next useful step is vision, or we can move on to life, disability, or supplemental protection.';
    case 'Vision':
      return completed.has('Dental')
        ? 'Since you have already looked at dental too, the next most useful area is usually life, disability, or supplemental protection.'
        : 'Since vision is usually a yes/no decision rather than a plan comparison, the next useful step is dental, or we can move on to life, disability, or supplemental protection.';
    case 'Life Insurance':
      return 'The next related areas are disability for income protection, then accident or critical illness for cash-support protection.';
    case 'Disability':
      return 'The next useful companion benefit is usually life insurance, then accident or critical illness depending on how much extra protection you want.';
    default:
      return 'If you want, I can help you think through what to consider next based on whether you are optimizing for healthcare costs, family protection, or optional supplemental coverage.';
  }
}

function benefitTopicFromQuery(query: string): string | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (/\b(medical|health|hsa\s+plan|kaiser|hmo|ppo|standard\s+hsa|enhanced\s+hsa)\b/i.test(lower)) return 'Medical';
  if (/\bdental\b/i.test(lower)) return 'Dental';
  if (/\b(vision|eye|glasses|contacts|lasik)\b/i.test(lower)) return 'Vision';
  if (/\b(life(?:\s+insurance)?|term\s+life|whole\s+life|basic\s+life)\b/i.test(lower)) return 'Life Insurance';
  if (/\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower)) return 'Disability';
  if (/\bcritical(?:\s+illness)?\b/i.test(lower)) return 'Critical Illness';
  if (/\b(accident|ad&d|ad\/d)\b/i.test(lower)) return 'Accident/AD&D';
  if (/\b(hsa(?:\s*\/\s*fsa)?|fsa)\b/i.test(lower)) return 'HSA/FSA';
  if (/\b(all\s+benefits|benefits\s+overview|what\s+are\s+all\s+the\s+benefits|what\s+benefits\s+do\s+i\s+have)\b/i.test(lower)) return 'Benefits Overview';
  return null;
}

function extractAge(message: string): number | null {
  const match = message.match(/\b(1[8-9]|[2-9][0-9])\b/);
  return match ? Number(match[1]) : null;
}

function extractState(message: string): string | null {
  const lower = message.toLowerCase();

  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE).sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(lower)) return code;
  }

  const ageThenState = message.match(/\b(1[8-9]|[2-9][0-9])\b[\s,/-]+(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i);
  if (ageThenState) return ageThenState[2].toUpperCase();

  const locationCueMatch = message.match(/\b(?:in|from|live in|located in|state is|i'm in|i am in)\s+(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i);
  if (locationCueMatch) return locationCueMatch[1].toUpperCase();

  return null;
}

function applyDemographics(session: Session, query: string) {
  const age = extractAge(query);
  const state = extractState(query);

  if (age) session.userAge = age;
  if (state) session.userState = state;

  if (session.userAge || session.userState) {
    session.askedForDemographics = true;
  }

  return { age, state };
}

function hasDemographics(session: Session) {
  return Boolean(session.userAge && session.userState);
}

function missingDemographicsMessage(session: Session, topic?: string | null): string {
  if (!session.userAge && !session.userState) {
    return topic
      ? `I can help with ${topic.toLowerCase()}, but I need your age and state first so I can keep the guidance accurate. Please reply like "35, FL".`
      : `Before we look at plans, I need your age and state so I can keep the guidance accurate. Please reply like "35, FL".`;
  }
  if (!session.userAge) {
    return `I have your state as ${session.userState}. I just need your age to keep the plan guidance accurate.`;
  }
  return `I have your age as ${session.userAge}. I just need your state so I can keep plan availability and pricing accurate.`;
}

function normalizeNetworkPreference(query: string): string | undefined {
  if (/\bkaiser\b/i.test(query)) return 'kaiser';
  if (/\b(hmo)\b/i.test(query)) return 'hmo';
  if (/\b(ppo|hsa)\b/i.test(query)) return 'ppo';
  return undefined;
}

function isCostModelRequest(query: string): boolean {
  return /\b(calculate|estimate|project(?:ed)?|model)\b.*\b(cost|costs|expense|expenses)\b|\bhealthcare\s+costs?\b|\busage\s+level\s+is\b|\b(low|moderate|high)\s+usage\b/i.test(query.toLowerCase());
}

function usageLevelFromQuery(query: string): 'low' | 'moderate' | 'high' {
  const lower = query.toLowerCase();
  if (/\bhigh\s+usage\b|\bhigh\s+utilization\b|\bfrequent\b|\bongoing\b/i.test(lower)) return 'high';
  if (/\blow\s+usage\b|\bgenerally\s+healthy\b|\bhealthy\b|\blow\s+bills\b|\blow\s+medical\s+use\b/i.test(lower)) return 'low';
  return 'moderate';
}

function usageLevelFromSession(session: Session): 'low' | 'moderate' | 'high' {
  const userMessages = (session.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join(' ');
  return usageLevelFromQuery(userMessages);
}

function buildBenefitsOverviewReply(session: Session): string {
  const intro = hasDemographics(session)
    ? `Perfect! ${session.userAge} in ${session.userState}.`
    : 'Here is the AmeriVet benefits lineup:';
  return `${intro}\n\n${buildAllBenefitsMenu()}\n\nWhat would you like to explore first?`;
}

function buildTopicReply(session: Session, topic: string, query: string): string {
  if (topic === 'Benefits Overview') {
    return buildBenefitsOverviewReply(session);
  }

  if (topic === 'Medical') {
    if (isCostModelRequest(query)) {
      const coverageTier = getCoverageTierForQuery(query, session);
      return pricingUtils.estimateCostProjection({
        coverageTier,
        usage: usageLevelFromQuery(query),
        network: normalizeNetworkPreference(query),
        state: session.userState || undefined,
        age: session.userAge || undefined,
      });
    }

    const recommendation = buildRecommendationOverview(query, session);
    if (recommendation) return recommendation;
  }

  const categoryResponse = buildCategoryExplorationResponse({
    queryLower: query.toLowerCase(),
    session,
    coverageTier: getCoverageTierForQuery(query, session),
    enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
    hrPhone: HR_PHONE,
  });

  if (categoryResponse) return categoryResponse;

  return `I can help with ${topic.toLowerCase()}, but I want to keep it grounded in the AmeriVet benefits package. Please ask that one a little more specifically and I’ll answer directly.`;
}

function buildContinuationReply(session: Session, query: string): string | null {
  const lower = query.toLowerCase();

  if (!session.currentTopic) return null;

  if (isPackageGuidanceMessage(lower)) {
    return buildPackageGuidance(session, session.currentTopic);
  }

  if (isOtherChoicesMessage(lower)) {
    return buildPackageGuidance(session, session.currentTopic);
  }

  const pivotTopic = benefitTopicFromQuery(query);
  if (pivotTopic && pivotTopic !== 'Benefits Overview' && pivotTopic !== session.currentTopic) {
    setTopic(session, pivotTopic);
    return buildTopicReply(session, pivotTopic, query);
  }

  if (session.currentTopic === 'Medical') {
    if (
      (isSimpleAffirmation(query) || /\b(compare|yes)\b/i.test(lower)) &&
      /\blikely\s+total\s+annual\s+cost\b|\bcompare\b.*\bstandard\s+hsa\b.*\benhanced\s+hsa\b/i.test(session.lastBotMessage || '')
    ) {
      return pricingUtils.estimateCostProjection({
        coverageTier: session.coverageTierLock || 'Employee Only',
        usage: usageLevelFromSession(session),
        state: session.userState || undefined,
        age: session.userAge || undefined,
      });
    }
    if (/\b(low|moderate|high)\s+usage\b|\bgenerally\s+healthy\b|\blow\s+bills\b/i.test(lower)) {
      const recommendation = buildRecommendationOverview(query, session);
      if (recommendation) return recommendation;
    }
    if (isCostModelRequest(query)) {
      return buildTopicReply(session, 'Medical', query);
    }
  }

  if (isSimpleAffirmation(query)) {
    return buildPackageGuidance(session, session.currentTopic);
  }

  if (session.currentTopic === 'Dental' && /\borthodontia\s+rider\b|\brider\b/i.test(lower)) {
    return `An orthodontia rider means the dental plan includes an added orthodontic benefit instead of excluding braces and related treatment entirely. In practical terms, it is the part of the dental coverage that makes orthodontia available under the plan's rules.\n\nFor AmeriVet's dental plan, that means orthodontic coverage is included rather than being a separate standalone dental plan. If you want, I can explain what that means for braces and out-of-pocket costs next.`;
  }

  return null;
}

function buildStateCorrectionReply(session: Session, query: string): string | null {
  const correction = detectExplicitStateCorrection(query, session.userState);
  if (!correction) return null;

  session.userState = correction.state;

  if (!session.currentTopic) {
    return `Thanks for the correction — I’ve updated your state to ${correction.state}.`;
  }

  if (session.currentTopic === 'Medical') {
    return `Thanks for the correction — in ${correction.state}, here’s the updated medical view:\n\n${buildTopicReply(session, 'Medical', 'medical options')}`;
  }

  return `Thanks for the correction — I’ve updated your state to ${correction.state}. That does not materially change the ${session.currentTopic.toLowerCase()} options I just showed, but I’ll use ${correction.state} for any state-specific guidance going forward.`;
}

export async function runQaV2Engine(params: {
  query: string;
  session: Session;
}): Promise<{ answer: string; tier: 'L1'; sessionContext: ReturnType<typeof buildSessionContext>; metadata?: Record<string, unknown> }> {
  const { query, session } = params;
  incrementTurn(session);

  if (!session.messages) session.messages = [];

  if (query === '__WELCOME__') {
    const answer = `Hi there! Welcome!\n\nI'm your AmeriVet Benefits Assistant. I'm here to help you compare plans, understand your options, and make confident benefit decisions.\n\nLet's get started — what's your name?`;
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'welcome-v2' } };
  }

  session.messages.push({ role: 'user', content: query });

  const stateCorrectionReply = buildStateCorrectionReply(session, query);
  if (stateCorrectionReply) {
    session.lastBotMessage = stateCorrectionReply;
    session.messages.push({ role: 'assistant', content: stateCorrectionReply });
    return { answer: stateCorrectionReply, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'state-correction-v2' } };
  }

  if (!session.userName && query.trim() && !extractAge(query) && !extractState(query) && !benefitTopicFromQuery(query)) {
    session.userName = query.trim().split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '') || 'there';
    session.hasCollectedName = true;
    const answer = `Thanks, ${session.userName}! To keep the guidance accurate, please share your age and state next. For example: "35, FL".`;
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'name-capture-v2' } };
  }

  const { age, state } = applyDemographics(session, query);
  const detectedTopic = benefitTopicFromQuery(query);

  if (age || state) {
    session.dataConfirmed = hasDemographics(session);
    if (hasDemographics(session) && !detectedTopic) {
      const answer = buildBenefitsOverviewReply(session);
      session.lastBotMessage = answer;
      session.messages.push({ role: 'assistant', content: answer });
      return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'demographics-complete-v2' } };
    }
  }

  if (!hasDemographics(session)) {
    const topic = detectedTopic;
    const answer = missingDemographicsMessage(session, topic);
    if (topic) session.currentTopic = topic;
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'demographic-gate-v2' } };
  }

  if (isCostModelRequest(query) && !detectedTopic) {
    setTopic(session, 'Medical');
    const answer = buildTopicReply(session, 'Medical', query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'cost-model-v2', topic: 'Medical' } };
  }

  const normalizedTopic = detectedTopic && detectedTopic !== 'Benefits Overview'
    ? normalizeBenefitCategory(detectedTopic)
    : detectedTopic;

  if (normalizedTopic) {
    if (normalizedTopic !== 'Benefits Overview') setTopic(session, normalizedTopic);
    const answer = buildTopicReply(session, normalizedTopic, query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'topic-reply-v2', topic: normalizedTopic } };
  }

  const continuationReply = buildContinuationReply(session, query);
  if (continuationReply) {
    session.lastBotMessage = continuationReply;
    session.messages.push({ role: 'assistant', content: continuationReply });
    return { answer: continuationReply, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'continuation-v2', topic: session.currentTopic || null } };
  }

  if (shouldUseCategoryExplorationIntercept(query, query.toLowerCase(), 'general')) {
    const topic = benefitTopicFromQuery(query);
    if (topic) {
      setTopic(session, topic);
      const answer = buildTopicReply(session, topic, query);
      session.lastBotMessage = answer;
      session.messages.push({ role: 'assistant', content: answer });
      return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'category-exploration-v2', topic } };
    }
  }

  const answer = `I want to keep this grounded in the AmeriVet benefits package. I can help with medical, dental, vision, life, disability, accident/AD&D, critical illness, or HSA/FSA. Tell me which area you want to focus on next and I’ll guide you through the options clearly.`;
  session.lastBotMessage = answer;
  session.messages.push({ role: 'assistant', content: answer });
  return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'fallback-v2' } };
}
