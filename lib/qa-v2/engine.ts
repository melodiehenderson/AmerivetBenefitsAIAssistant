import { getAmerivetBenefitsPackage } from '@/lib/data/amerivet-package';
import type { Session } from '@/lib/rag/session-store';
import { extractName } from '@/lib/session-logic';
import pricingUtils from '@/lib/rag/pricing-utils';
import { buildCategoryExplorationResponse } from '@/lib/qa/category-response-builders';
import {
  buildMedicalPlanFallback,
  buildRecommendationOverview,
  getCoverageTierForQuery,
  isKaiserEligibleState,
} from '@/lib/qa/medical-helpers';
import { buildMedicalPlanDetailAnswer } from '@/lib/qa/plan-detail-lookup';
import { buildRoutineBenefitDetailAnswer, isRoutineBenefitDetailQuestion } from '@/lib/qa/routine-benefit-detail-lookup';
import { buildNonMedicalDetailAnswer, isNonMedicalDetailQuestion } from '@/lib/qa/non-medical-detail-lookup';
import {
  checkL1FAQ,
  detectExplicitStateCorrection,
  isOtherChoicesMessage,
  isPackageGuidanceMessage,
  isSimpleAffirmation,
  normalizeBenefitCategory,
  shouldUseCategoryExplorationIntercept,
  stripAffirmationLeadIn,
} from '@/lib/qa/routing-helpers';
import { buildLiveSupportMessage, buildQleFilingOrderMessage } from '@/lib/qa/policy-response-builders';

const ENROLLMENT_PORTAL_URL = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.html';
const HR_PHONE = process.env.HR_PHONE_NUMBER || '888-217-4728';
const ACTIVE_AMERIVET_PACKAGE = getAmerivetBenefitsPackage();

const TOPIC_ORDER = ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA'] as const;

const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(ACTIVE_AMERIVET_PACKAGE.stateAbbrevToName).map(([code, name]) => [name.toLowerCase(), code]),
);

type EngineResult = {
  answer: string;
  metadata?: Record<string, unknown>;
};

type BenefitPriorityFocus = 'healthcare_costs' | 'family_protection' | 'routine_care';
type SupplementalComparisonFocus = 'injury_risk' | 'diagnosis_risk';
type HsaFitFocus = 'long_term_savings' | 'near_term_expenses';

function isMedicalDetailQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(coverage\s+tier|coverage\s+tiers|copay|copays|coinsurance|deductible|out[- ]of[- ]pocket|oop\s*max|primary\s+care|pcp|specialist|urgent\s+care|emergency\s+room|er|network|in[- ]network|out[- ]of[- ]network|ppo|hmo|prescriptions?|drugs?|generic|brand|specialty|maternity|pregnan\w*|delivery|prenatal|postnatal|therapy|physical\s+therapy|virtual\s+visits?|telehealth(?:\s+visits?)?|telemedicine|tradeoffs?|differences?\s+between\s+the\s+plans|compare\s+the\s+plans|compare\s+the\s+plan\s+tradeoffs?)\b/i.test(lower)
    || (/\b(cost|costs|what\s+would\s+i\s+pay|what\s+are\s+my\s+costs|if\s+i\s+use)\b/i.test(lower) && /\b(standard|standard hsa|enhanced|enhanced hsa|kaiser|kaiser hmo)\b/i.test(lower));
}

function isMedicalAccumulatorComparisonQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return (
    /\b(deductible)\b/i.test(lower)
    && /\b(out[- ]of[- ]pocket|oop)\b/i.test(lower)
  ) || /\b(lowest\s+out[- ]of[- ]pocket|lowest\s+oop|lower\s+out[- ]of[- ]pocket|lower\s+oop)\b/i.test(lower);
}

function isAffirmativeCompareFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return isSimpleAffirmation(query)
    || /\b(compare|comparison|vs\.?|versus|which one|which matters more|do that|do this|do it|let'?s do that|let'?s do this|let'?s do it|i'?d like that|yes please|tell me more)\b/i.test(lower);
}

function buildSessionContext(session: Session) {
  return {
    userName: session.userName || null,
    userAge: session.userAge || null,
    userState: session.userState || null,
    hasCollectedName: session.hasCollectedName || false,
    disclaimerShown: session.disclaimerShown || false,
    currentTopic: session.currentTopic || null,
    completedTopics: session.completedTopics || [],
    pendingGuidancePrompt: session.pendingGuidancePrompt || null,
    pendingGuidanceTopic: session.pendingGuidanceTopic || null,
    pendingTopicSuggestion: session.pendingTopicSuggestion || null,
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

function refreshCoverageTierLock(session: Session, query: string) {
  if (!hasDemographics(session)) return;
  if (!shouldRefreshCoverageTierLock(query)) return;
  session.coverageTierLock = getCoverageTierForQuery(query, session);
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

function clearPendingGuidance(session: Session) {
  delete session.pendingGuidancePrompt;
  delete session.pendingGuidanceTopic;
  delete session.pendingTopicSuggestion;
}

function setPendingGuidance(
  session: Session,
  prompt: NonNullable<Session['pendingGuidancePrompt']>,
  topic?: string | null,
) {
  session.pendingGuidancePrompt = prompt;
  if (topic) {
    session.pendingGuidanceTopic = topic;
  } else {
    delete session.pendingGuidanceTopic;
  }
  delete session.pendingTopicSuggestion;
}

function setPendingTopicSuggestion(session: Session, topic: string) {
  session.pendingTopicSuggestion = topic;
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

function buildBenefitsLineupPrompt(session: Session): string {
  const intro = hasDemographics(session)
    ? `Here is the AmeriVet benefits lineup for ${session.userAge} in ${session.userState}:`
    : 'Here is the AmeriVet benefits lineup:';
  return `${intro}\n\n${buildAllBenefitsMenu()}\n\nWhat would you like to explore first?`;
}

function buildPackageGuidance(session: Session, topic?: string | null): string {
  const completed = new Set(session.completedTopics || []);
  switch (topic) {
    case 'Medical':
      return [
        `If you want to move on from medical, the most useful next step is usually one of these:`,
        ``,
        `- dental/vision if you want to round out routine care coverage`,
        `- life/disability if you are thinking more about income and family protection`,
      ].join('\n');
    case 'Dental':
      return completed.has('Vision')
        ? [
          `Since you have already looked at vision too, the next most useful area is usually:`,
          ``,
          `- life, disability, or supplemental protection`,
        ].join('\n')
        : [
          `Since dental is usually a yes/no decision rather than a plan comparison, the next useful step is usually:`,
          ``,
          `- Vision`,
          `- Life insurance`,
          `- Disability`,
          `- Supplemental protection`,
        ].join('\n');
    case 'Vision':
      return completed.has('Dental')
        ? [
          `Since you have already looked at dental too, the next most useful area is usually:`,
          ``,
          `- life, disability, or supplemental protection`,
        ].join('\n')
        : [
          `Since vision is usually a yes/no decision rather than a plan comparison, the next useful step is usually:`,
          ``,
          `- Dental`,
          `- Life insurance`,
          `- Disability`,
          `- Supplemental protection`,
        ].join('\n');
    case 'Life Insurance':
      return [
        `If you want to keep going after life insurance, the most useful next comparison is usually:`,
        ``,
        `- Disability for paycheck protection`,
        `- Critical illness or accident coverage for extra cash-support protection`,
      ].join('\n');
    case 'Disability':
      return [
        `If you want to keep going after disability, the most useful companion benefit is usually:`,
        ``,
        `- Life insurance`,
        `- Critical illness or accident coverage depending on how much extra protection you want`,
      ].join('\n');
    case 'Critical Illness':
      return [
        `If you want to keep going after critical illness, the next useful step is usually:`,
        ``,
        `- Accident/AD&D if you want to compare supplemental cash-protection options`,
        `- HSA/FSA if you want to tighten the tax side of your benefits package`,
      ].join('\n');
    case 'Accident/AD&D':
      return [
        `If you want to keep going after Accident/AD&D, the next useful step is usually:`,
        ``,
        `- Critical illness for a diagnosis-risk comparison`,
        `- HSA/FSA if you want to round out the tax side of the package`,
      ].join('\n');
    case 'HSA/FSA':
      return [
        `From here, the most useful next step is usually:`,
        ``,
        `- Going back to your medical choice so the tax account matches the plan you are leaning toward`,
        `- Wrapping up any remaining supplemental-protection questions`,
      ].join('\n');
    default:
      return [
        `If you want, I can help you think through what to consider next based on one of these priorities:`,
        ``,
        `- Healthcare costs`,
        `- Family protection`,
        `- Optional supplemental coverage`,
      ].join('\n');
  }
}

function isSupplementalOverviewQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(supplemental benefits?|supplemental coverage|supplemental protections?|supplemental options?|other than medical|besides medical|not medical|what else is available besides medical|what are the supplemental benefits|tell me what the supplemental benefits are|are they free)\b/i.test(lower);
}

function buildSupplementalBenefitsOverviewReply(): string {
  return [
    `AmeriVet's supplemental benefits are the optional add-ons beyond your core medical, dental, and vision coverage.`,
    ``,
    `The main supplemental areas are:`,
    `- Life Insurance: employer-paid basic life plus optional voluntary term and whole life`,
    `- Disability: short-term and long-term income protection`,
    `- Critical Illness: lump-sum style cash support after a covered serious diagnosis`,
    `- Accident/AD&D: cash support after covered accidental injuries, with extra accidental loss-of-life or limb protection`,
    ``,
    `They are not all free:`,
    `- Basic Life & AD&D is employer-paid`,
    `- The optional voluntary life, disability, critical illness, and accident add-ons are generally employee-paid`,
    ``,
    `So the practical decision is usually which optional protection is worth paying for after your core medical choice is settled.`,
  ].join('\n');
}

function isDirectMedicalRecommendationQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(which\s+plan\s+is\s+best|which\s+plan\s+is\s+better|best\s+(medical\s+)?plan|which\s+medical\s+plan|which\s+one\s+do\s+you\s+recommend|what\s+do\s+you\s+recommend\s+for\s+me|which\s+one\s+do\s+i\s+pick|which\s+one\s+should\s+i\s+pick|what\s+should\s+i\s+pick|which\s+option\s+should\s+i\s+pick|which\s+one\s+would\s+you\s+pick|which\s+plan\s+is\s+right\s+for\s+me|lowest\s+out[- ]of[- ]pocket|lowest\s+oop|lowest\s+bills|best\s+choice\s+for\s+my\s+family|plan\s+is\s+best\s+for\s+my\s+family|best\s+for\s+my\s+family|better\s+for\s+me|better\s+for\s+us|which\s+plan\s+will\s+give\s+us\s+the\s+lowest|let'?s\s+talk\s+(?:thru|through)\s+which\s+plan\s+is\s+best|talk\s+me\s+through\s+which\s+plan\s+is\s+best|should\s+(?:we|i)\s+switch\b|switch\s+from\s+(?:the\s+)?(?:standard|enhanced|kaiser)|make\s+the\s+case\s+for\s+(?:the\s+)?(?:standard|enhanced|kaiser)|sell\s+me\s+on\s+(?:the\s+)?(?:standard|enhanced|kaiser)|talk\s+me\s+into\s+(?:the\s+)?(?:standard|enhanced|kaiser)|i\s+know\s+i\s+said\s+(?:standard|enhanced|kaiser)|which\s+one\s+is\s+better\b[^.?!]{0,60}\b(expect|care|specialist|prescription|usage)|is\s+(?:enhanced|standard|kaiser)\s+worth\b)\b/i.test(lower);
}

function isMedicalRecommendationPreferenceFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(more\s+predictable\s+costs?|predictable\s+costs?|less\s+deductible\s+risk|lower\s+deductible\s+risk|stronger\s+deductible\s+protection|stronger\s+cost\s+protection|can\s+handle\s+more\s+risk|comfortable\s+with\s+more\s+risk|okay\s+with\s+more\s+risk|willing\s+to\s+take\s+more\s+risk|keep\s+premiums?\s+lower|lower\s+premiums?\s+matter\s+more|premium\s+first|budget\s+first)\b/i.test(lower);
}

function isSelectedPlanReconsideration(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(should\s+(?:we|i)\s+switch|switch\s+from\s+(?:the\s+)?(?:standard|enhanced|kaiser)|make\s+the\s+case\s+for\s+(?:the\s+)?(?:standard|enhanced|kaiser)|sell\s+me\s+on\s+(?:the\s+)?(?:standard|enhanced|kaiser)|talk\s+me\s+into\s+(?:the\s+)?(?:standard|enhanced|kaiser)|i\s+know\s+i\s+said\s+(?:standard|enhanced|kaiser)|instead\s+of\s+(?:standard|enhanced|kaiser)|rather\s+than\s+(?:standard|enhanced|kaiser)|which\s+(?:one|medical\s+plan|plan)\s+is\s+better|what\s+(?:medical\s+)?plan\s+is\s+better)\b/i.test(lower);
}

function shouldIgnoreSelectedPlanBias(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return isSelectedPlanReconsideration(query)
    || /\b(don'?t\s+want\s+(?:standard|enhanced|kaiser)|do\s+not\s+want\s+(?:standard|enhanced|kaiser)|not\s+(?:standard|enhanced|kaiser))\b/i.test(lower)
    || (
      /\b(which\s+(?:one|medical\s+plan|plan)|what\s+(?:medical\s+)?plan)\b/i.test(lower)
      && /\b(expect|care|specialist|prescription|usage|visit|visits)\b/i.test(lower)
    );
}

function isLifeFamilyCoverageQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(life(?:\s+insurance)?|term life|whole life|basic life).*\b(wife|husband|spouse|partner|kids|children|family|dependents?|cover|coverage|benefits?|qualify|portable|guaranteed issue|cash value|how much)\b|\b(wife|husband|spouse|partner|kids|children|family|dependents?|cover|coverage|benefits?|qualify|portable|guaranteed issue|cash value|how much)\b.*\b(life(?:\s+insurance)?|term life|whole life|basic life)\b/i.test(lower);
}

function isHsaFsaCompatibilityQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(fsa|hsa)\b.*\b(kaiser|hmo)\b|\b(kaiser|hmo)\b.*\b(fsa|hsa)\b|\bshould\s+i\s+use\s+an?\s+fsa\b|\bshould\s+i\s+use\s+fsa\b|\buse\s+an?\s+fsa\b|\buse\s+fsa\b|\bcan\s+i\s+(?:still\s+)?use\s+an?\s+hsa\b|\bcan\s+i\s+(?:still\s+)?use\s+hsa\b|\bcan(?:not|'t)\s+use\s+an?\s+hsa\b|\b(hsa|fsa)\b.*\b(pair\s+best\s+with|go\s+best\s+with|fit\s+best\s+with)\b|\b(pair\s+best\s+with|go\s+best\s+with|fit\s+best\s+with)\b.*\b(hsa|fsa)\b/i.test(lower);
}

function isDirectMedicalContinuationQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return isDirectMedicalRecommendationQuestion(query)
    || isMedicalRecommendationPreferenceFollowup(query)
    || isMedicalDetailQuestion(query)
    || /\b(which\s+plan\s+is\s+best\s+for\s+my\s+family|which\s+plan\s+is\s+best|which\s+plan\s+is\s+better|which\s+one\s+do\s+you\s+recommend|best\s+choice\s+for\s+my\s+family|what\s+plan\s+will\s+give\s+us\s+the\s+lowest|other\s+standard\s+plan|other\s+plan|plan\s+tradeoffs?|medical\s+options|medical\s+plan\s+options|show\s+me\s+(?:my\s+)?(?:medical\s+)?options|show\s+me\s+the\s+plans|plans\s+side\s+by\s+side|side\s+by\s+side|let'?s\s+talk\s+(?:thru|through)\s+which\s+plan|talk\s+(?:thru|through)\s+which\s+plan|talk\s+me\s+through\s+which\s+plan|talk\s+through\s+which\s+option\s+fits\s+better|which\s+option\s+fits\s+better|best\s+choice\s+for\s+my\s+family|best\s+for\s+my\s+family|better\s+for\s+me|better\s+for\s+us)\b/i.test(lower);
}

function isMedicalWorthPremiumQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\bworth the extra premium\b|\bworth paying more\b|\bworth the higher premium\b|\bwhy pay more\b/i.test(lower);
}

function normalizeContinuationQuery(query: string): string {
  const trimmed = query.trim();
  return stripAffirmationLeadIn(trimmed) || trimmed;
}

function isTopicOverviewQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(what'?s\s+available|what\s+is\s+available|what\s+are\s+my\s+options|what\s+are\s+the\s+options|what\s+options\s+do\s+i\s+have|what\s+do\s+i\s+have|show\s+me\s+(?:my\s+)?options|show\s+me\s+what'?s\s+available|available\s+to\s+me|what\s+are\s+my\s+benefits|what\s+benefits?\s+do\s+i\s+have|life\s+insurance\s+info|medical\s+options|medical\s+plan\s+options|what\s+are\s+my\s+other\s+benefit\s+options|go\s+through\s+all\s+my\s+options|top\s+to\s+bottom|all\s+my\s+options)\b/i.test(lower)
    || /\b(let'?s\s+(?:look\s+at|do)|move\s+on\s+to|move\s+to|look\s+at)\s+(?:my\s+)?(?:medical|health|dental|vision|life(?:\s+insurance)?|disability|critical(?:\s+illness)?|accident(?:\/ad&d)?|ad&d|hsa|fsa|benefits?)\b/i.test(lower);
}

function isDeclinedRoutineTopic(queryLower: string, topic: 'dental' | 'vision'): boolean {
  const topicPattern = topic === 'dental'
    ? 'dental'
    : '(?:vision|eye|glasses|contacts|lasik)';

  return new RegExp(
    `\\b(?:skip(?:ping)?|done\\s+with|not\\s+interested\\s+in|do\\s+not\\s+want|don'?t\\s+want|dont\\s+want|not\\s+getting|without|other\\s+than)\\b[^.?!]{0,40}\\b${topicPattern}\\b|\\b${topicPattern}\\b[^.?!]{0,40}\\b(?:skip(?:ping)?|done\\s+with|not\\s+interested|do\\s+not\\s+want|don'?t\\s+want|dont\\s+want|not\\s+getting)\\b`,
    'i',
  ).test(queryLower);
}

function isShortTopicPivot(query: string, topic: string): boolean {
  const normalized = stripAffirmationLeadIn(query.trim())
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;

  const topicPatterns: Record<string, RegExp> = {
    Medical: /^(medical|health|medical plans?|medical options?|kaiser|hsa plans?)$/,
    Dental: /^dental$/,
    Vision: /^(vision|eye|glasses|contacts)$/,
    'Life Insurance': /^(life|life insurance|life ins|term life|whole life|basic life)$/,
    Disability: /^(disability|std|ltd)$/,
    'Critical Illness': /^(critical illness|illness)$/,
    'Accident/AD&D': /^(accident|ad&d|ad d|ad\/d)$/,
    'HSA/FSA': /^(hsa|fsa|hsa fsa|hsa\/fsa)$/,
  };

  if (topicPatterns[topic]?.test(normalized)) return true;

  const guidedPivotPatterns: Record<string, RegExp> = {
    Medical: /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:medical|health|medical plans?|medical options?|kaiser|hsa plans?)(?:\s+next)?$/,
    Dental: /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?dental(?:\s+next)?$/,
    Vision: /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:vision|eye|glasses|contacts)(?:\s+next)?$/,
    'Life Insurance': /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:life|life insurance|life ins|term life|whole life|basic life)(?:\s+next)?$/,
    Disability: /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:disability|std|ltd)(?:\s+next)?$/,
    'Critical Illness': /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:critical illness|illness)(?:\s+next)?$/,
    'Accident/AD&D': /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:accident|ad&d|ad d|ad\/d)(?:\s+next)?$/,
    'HSA/FSA': /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:hsa|fsa|hsa fsa|hsa\/fsa)(?:\s+next)?$/,
  };

  return guidedPivotPatterns[topic]?.test(normalized) || false;
}

function canonicalTopicQuery(topic: string, query: string): string {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (topic === 'Medical') {
    if (/\b(compare|comparison|tradeoff|side\s+by\s+side)\b/i.test(lower)) return 'compare the plan tradeoffs';
    if (/\b(cost|costs|out[- ]of[- ]pocket|oop)\b/i.test(lower)) return 'estimate likely costs';
    return 'medical options';
  }
  if (topic === 'Life Insurance') return 'life insurance info';
  if (topic === 'Disability') return 'tell me about the disability stuff';
  if (topic === 'Critical Illness') return 'critical illness';
  if (topic === 'Accident/AD&D') return 'what is accident/ad&d?';
  if (topic === 'HSA/FSA') return 'tell me about hsa/fsa';
  if (topic === 'Dental') return 'dental please';
  if (topic === 'Vision') return 'vision please';
  return query;
}

function preferredTopicOverride(query: string): string | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();

  if (isDeclinedRoutineTopic(lower, 'dental') && /\b(vision|eye|glasses|contacts|lasik)\b/i.test(lower)) {
    return 'Vision';
  }
  if (isDeclinedRoutineTopic(lower, 'vision') && /\bdental\b/i.test(lower)) {
    return 'Dental';
  }
  if (/\bsupplemental protections?\b|\bsupplemental options?\b/i.test(lower)) {
    return 'Supplemental';
  }

  return null;
}

function isReturnToMedicalIntent(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(go\s+back\s+to\s+(?:my\s+)?medical|back\s+to\s+(?:my\s+)?medical|back\s+to\s+(?:my\s+)?medical\s+plan\s+options|done\s+with\s+hsa\/fsa|done\s+with\s+hsa|done\s+with\s+fsa|medical\s+plan\s+options|show\s+me\s+(?:my\s+)?medical\s+plan\s+options|show\s+me\s+(?:my\s+)?medical\s+options|show\s+me\s+my\s+options|show\s+me\s+the\s+plans|plans\s+side\s+by\s+side|side\s+by\s+side|compare\s+the\s+plans)\b/i.test(lower);
}

function isMedicalRecommendationClarificationQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(what\s+do\s+you\s+mean\s+by\s+richer|what\s+do\s+you\s+mean\s+by\s+leaner|by\s+richer|by\s+leaner|what\s+do\s+you\s+mean\s+by\s+higher[- ]cost|more\s+expensive\s+is\s+that\s+right|do\s+you\s+mean\s+more\s+expensive|do\s+you\s+mean\s+cheaper|is\s+that\s+just\s+more\s+expensive)\b/i.test(lower);
}

function buildMedicalRecommendationClarificationReply(query: string): string {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (/\bleaner|cheaper\b/i.test(lower)) {
    return [
      `By **leaner** or **cheaper**, I mean the plan costs less up front each month but usually leaves you with more deductible and out-of-pocket exposure when care happens.`,
      ``,
      `In AmeriVet's medical options, that usually points closer to **Standard HSA** than the higher-cost options.`,
      ``,
      `So yes: "leaner" usually means cheaper up front, but with less cost protection if you end up using more care.`,
    ].join('\n');
  }

  return [
    `By **higher-cost** or **more protective**, I mean the plan gives you stronger cost protection, even though it usually costs more up front in premium.`,
    ``,
    `In practical terms, that usually means:`,
    `- lower deductible`,
    `- lower out-of-pocket exposure in a higher-use year`,
    `- less of the bill staying with you when care actually happens`,
    ``,
    `So yes: the higher-cost option usually does mean **more expensive up front**, but the tradeoff is that you may pay less when the household actually uses care.`,
  ].join('\n');
}

function upsertLifeEvent(session: Session, event: string) {
  if (!session.lifeEvents) session.lifeEvents = [];
  if (!session.lifeEvents.includes(event)) {
    session.lifeEvents.push(event);
  }
}

function extractExplicitChildCount(query: string): number | null {
  const matches = Array.from(query.matchAll(/\b(\d+)\s+(kids?|children|sons?|daughters?)\b/gi));
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(match[1])));
}

function extractAdditionalChildCount(query: string): number {
  const numericMatch = query.match(/\b(?:adopt(?:ing|ion)?|adding)\s+(\d+)\s+(?:more\s+)?(kids?|children|sons?|daughters?)\b/i);
  if (numericMatch) return Number(numericMatch[1]);
  if (/\b(adopt(?:ing|ion)?\s+(?:one|another)\s+(kid|child)|one\s+more\s+(kid|child)|another\s+(kid|child)|adding\s+(?:one|another)\s+(kid|child))\b/i.test(query)) {
    return 1;
  }
  return 0;
}

function rememberHouseholdContext(session: Session, query: string) {
  const lower = query.toLowerCase();
  const details = session.familyDetails || {};
  const explicitHouseholdOverride = extractExplicitHouseholdOverride(lower, details);

  if (explicitHouseholdOverride) {
    if (typeof explicitHouseholdOverride.hasSpouse === 'boolean') {
      details.hasSpouse = explicitHouseholdOverride.hasSpouse;
    }
    if (typeof explicitHouseholdOverride.numChildren === 'number') {
      details.numChildren = explicitHouseholdOverride.numChildren;
    }
  }

  if (
    explicitHouseholdOverride?.hasSpouse !== false
    && /\b(spouse|wife|husband|partner|married|get(?:ting)? married|marriage|fianc(?:e|ée))\b/i.test(lower)
  ) {
    details.hasSpouse = true;
    if (/\b(married|get(?:ting)? married|marriage)\b/i.test(lower)) {
      upsertLifeEvent(session, 'marriage');
    }
  }

  const explicitChildCount = extractExplicitChildCount(lower);
  const additionalChildCount = extractAdditionalChildCount(lower);

  if (explicitHouseholdOverride && typeof explicitHouseholdOverride.numChildren === 'number') {
    details.numChildren = explicitHouseholdOverride.numChildren;
  } else if (explicitChildCount !== null) {
    details.numChildren = explicitChildCount + additionalChildCount;
  } else if (additionalChildCount > 0) {
    details.numChildren = Math.max(details.numChildren || 0, 0) + additionalChildCount;
  } else if (/\b(kids?|children|son|daughter|single\s+(?:mom|dad))\b/i.test(lower)) {
    details.numChildren = Math.max(details.numChildren || 0, 1);
  }

  if (/\b(adopt|adoption|adopting)\b/i.test(lower)) {
    upsertLifeEvent(session, 'adoption');
  }

  if (Object.keys(details).length > 0) {
    session.familyDetails = details;
  }

  if (/\b(pregnan|expecting|having\s+a\s+baby|due\s+date|maternity|prenatal|postnatal|delivery|birth)\b/i.test(lower)) {
    upsertLifeEvent(session, 'pregnancy');
  }
}

function rememberMedicalDirection(session: Session, query: string) {
  const lower = query.toLowerCase();
  if (shouldIgnoreSelectedPlanBias(query)) {
    if (isSelectedPlanReconsideration(query) || isDirectMedicalRecommendationQuestion(query)) {
      delete session.selectedPlan;
    }
    if (
      /don'?t\s+want\s+standard|do\s+not\s+want\s+standard|not\s+standard\b/i.test(lower)
      && session.selectedPlan === 'Standard HSA'
    ) {
      delete session.selectedPlan;
    }
    if (
      /don'?t\s+want\s+enhanced|do\s+not\s+want\s+enhanced|not\s+enhanced\b/i.test(lower)
      && session.selectedPlan === 'Enhanced HSA'
    ) {
      delete session.selectedPlan;
    }
    if (
      /don'?t\s+want\s+kaiser|do\s+not\s+want\s+kaiser|not\s+kaiser\b/i.test(lower)
      && session.selectedPlan === 'Kaiser Standard HMO'
    ) {
      delete session.selectedPlan;
    }
    return;
  }
  if (/\b(go(?:ing)? with|lean(?:ing)? toward|choose|choosing|picked|select(?:ed|ing)?|sticking with|keep|keeping|probably do|probably pick)\b[^.]*\bstandard\s+hsa\b/i.test(lower)) {
    session.selectedPlan = 'Standard HSA';
    return;
  }
  if (/\b(go(?:ing)? with|lean(?:ing)? toward|choose|choosing|picked|select(?:ed|ing)?|sticking with|keep|keeping|probably do|probably pick)\b[^.]*\benhanced\s+hsa\b/i.test(lower)) {
    session.selectedPlan = 'Enhanced HSA';
    return;
  }
  if (/\b(go(?:ing)? with|lean(?:ing)? toward|choose|choosing|picked|select(?:ed|ing)?|sticking with|keep|keeping|probably do|probably pick)\b[^.]*\bkaiser\b/i.test(lower)) {
    session.selectedPlan = 'Kaiser Standard HMO';
  }
}

function refreshSessionSignals(session: Session, query: string) {
  rememberHouseholdContext(session, query);
  rememberMedicalDirection(session, query);
}

function extractExplicitHouseholdOverride(
  query: string,
  currentDetails: NonNullable<Session['familyDetails']>,
): Partial<NonNullable<Session['familyDetails']>> | null {
  const update: Partial<NonNullable<Session['familyDetails']>> = {};
  let changed = false;
  const explicitChildCount = extractExplicitChildCount(query);

  if (/\b(employee\s*only|just\s*me|only\s*me|no\s+dependents?)\b/i.test(query)) {
    update.hasSpouse = false;
    update.numChildren = 0;
    changed = true;
  }

  if (/\b(no\s+spouse|without\s+(?:my\s+)?spouse|without\s+(?:my\s+)?partner|not\s+(?:my\s+)?spouse|not\s+(?:my\s+)?partner)\b/i.test(query)) {
    update.hasSpouse = false;
    changed = true;
  }

  if (/\b(no\s+kids|no\s+children|without\s+(?:my\s+)?kids|without\s+(?:my\s+)?children)\b/i.test(query)) {
    update.numChildren = 0;
    changed = true;
  }

  if (/\b(employee\s*\+\s*spouse|just\s+me\s+and\s+(?:my\s+)?(?:spouse|partner|wife|husband)|me\s+and\s+my\s+(?:spouse|partner|wife|husband))\b/i.test(query)) {
    update.hasSpouse = true;
    update.numChildren = 0;
    changed = true;
  }

  if (/\b(employee\s*\+\s*child(?:ren)?|employee\s*\+\s*\d+\s*kids?|employee\s*\+\s*(?:one|two|three|four|five|six)\s+kids?|just\s+me\s+and\s+(?:the\s+)?(?:\d+|one|two|three|four|five|six)\s+(?:kids?|children)|just\s+me\s+and\s+my\s+kids|me\s+and\s+the\s+kids)\b/i.test(query)) {
    update.hasSpouse = false;
    update.numChildren = explicitChildCount ?? Math.max(currentDetails.numChildren || 0, 1);
    changed = true;
  }

  return changed ? update : null;
}

function shouldRefreshCoverageTierLock(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const hasExplicitTierLanguage = /\b(employee\s*\+|employee\s*only|family\s+(?:coverage|plan|pricing)|spouse\s+(?:coverage|plan|pricing)|child(?:ren)?\s+(?:coverage|plan|pricing)|coverage\s+tier|coverage\s+tiers)\b/i.test(lower);
  const hasMedicalContext = /\b(medical|plan|plans|premium|premiums|pricing|cost|costs|coverage|deductible|out[- ]of[- ]pocket|kaiser|hsa|hmo|ppo|specialist|prescription|pregnan|maternity|baby)\b/i.test(lower);
  const hasHouseholdContext = /\b(spouse|wife|husband|partner|kids?|children|family|household|dependents?)\b/i.test(lower);

  return hasExplicitTierLanguage
    || isCostModelRequest(query)
    || isMedicalPremiumReplayQuestion(query)
    || isDirectMedicalRecommendationQuestion(query)
    || isMedicalCoverageTierQuestion(query)
    || isMedicalDetailQuestion(query)
    || isMedicalPregnancySignal(query)
    || (hasMedicalContext && hasHouseholdContext);
}

function getFilteredMedicalPricingRowsForTier(session: Session, coverageTier: string) {
  const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, session.payPeriods || 26)
    .filter((row) => !/dental|vision/i.test(row.plan) && row.provider !== 'VSP');

  return session.userState && !isKaiserEligibleState(session.userState)
    ? rows.filter((row) => !/kaiser/i.test(row.plan))
    : rows;
}

function isPackageRecommendationQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(which\s+benefits?\s+should\s+i\s+(?:get|take)|which\s+benefits?\s+do\s+you\s+recommend|which\s+ones?\s+would\s+you\s+recommend\s+i\s+get|what\s+benefits?\s+should\s+i\s+(?:get|take)|what\s+other\s+benefits?\s+should\s+i\s+get|should\s+i\s+get\s+any\s+of\s+the\s+other\s+benefits|knowing\s+what\s+you\s+know\s+about\s+me|based\s+on\s+what\s+you\s+know\s+about\s+me)\b/i.test(lower);
}

function buildPackageRecommendationReply(session: Session, query: string): string {
  const householdText = `${(session.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n')}\n${query}`.toLowerCase();
  const hasSpouse = Boolean(session.familyDetails?.hasSpouse)
    || /\b(spouse|wife|husband|partner|married|get(?:ting)? married)\b/i.test(householdText);
  const numChildren = session.familyDetails?.numChildren || 0;
  const pregnancy = hasPregnancyContext(session, query);
  const soleBreadwinner = /\b(sole\s+bread\s*winner|breadwinner|only\s+income|sole\s+provider|only\s+provider|family\s+relies\s+on\s+my\s+income|rely\s+on\s+my\s+income|single\s+(?:mom|dad))\b/i.test(householdText);

  const likelyTier = hasSpouse && numChildren > 0
    ? 'Employee + Family'
    : hasSpouse
      ? 'Employee + Spouse'
      : numChildren > 0
        ? 'Employee + Child(ren)'
        : 'Employee Only';

  const lines = [
    `Based on what you have told me, I would usually prioritize your benefits in this order:`,
    ``,
    pregnancy
      ? `- **Medical first**: because pregnancy or a baby-related life event makes the core medical decision and coverage tier the biggest immediate choice`
      : `- **Medical first**: because that is still the biggest cost and coverage decision in the package`,
  ];

  if (likelyTier !== 'Employee Only') {
    lines.push(`- **Use ${likelyTier} medical pricing as your working tier** once the household changes are active`);
  }

  if (soleBreadwinner || hasSpouse || numChildren > 0) {
    lines.push(`- **Disability next**, because protecting the paycheck usually matters before smaller supplemental add-ons when other people depend on your income`);
    lines.push(`- **Life insurance after that**, especially if you want more protection than AmeriVet's employer-paid basic life benefit`);
  } else {
    lines.push(`- **Dental or vision next only if you already expect to use them**, because they are routine-care add-ons rather than the main financial-risk decision`);
  }

  if (numChildren > 0) {
    lines.push(`- **Dental and vision become more worth looking at after medical** if the kids will actually use cleanings, orthodontia, eye exams, glasses, or contacts`);
  } else {
    lines.push(`- **Dental and vision stay secondary** unless you already know you will use routine care enough to justify the added payroll deduction`);
  }

  lines.push(`- **Accident and critical illness last**, because they are usually optional extra cash-protection layers after medical and income protection are settled`);
  lines.push(``);
  lines.push(
    soleBreadwinner || hasSpouse || numChildren > 0
      ? `So if you want the shortest version: I would usually settle **medical first**, then look at **disability/life**, then decide whether **dental/vision** are worth adding, and only then worry about **critical illness or accident**.`
      : `So if you want the shortest version: I would usually settle **medical first**, then decide whether **dental/vision** are worth adding, then look at **life/disability**, and only after that consider **critical illness or accident**.`,
  );

  return lines.join('\n');
}

function isQleTimingQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(how\s+long\s+do\s+we\s+have|how\s+many\s+days\s+do\s+we\s+have|how\s+long\s+do\s+i\s+have|how\s+many\s+days\s+do\s+i\s+have|deadline|window|qualifying\s+life\s+event|qle|when\s+do\s+we\s+have\s+to|when\s+do\s+i\s+have\s+to)\b/i.test(lower)
    && /\b(married|marriage|get(?:ting)? married|spouse|wife|husband|partner|baby|birth|born|delivery|pregnan|adopt|adoption|child)\b/i.test(lower);
}

function buildQleTimingReply(session: Session, query: string): string {
  const lower = query.toLowerCase();
  const marriageEvent = /\b(married|marriage|get(?:ting)? married|spouse|wife|husband|partner)\b/i.test(lower);
  const birthOrAdoptionEvent = /\b(baby|birth|born|delivery|pregnan|adopt|adoption|child)\b/i.test(lower);

  if (marriageEvent && birthOrAdoptionEvent) {
    return [
      `Marriage and birth/adoption are both qualifying life events, so I would treat this as a timing question rather than a medical-plan question.`,
      ``,
      buildQleFilingOrderMessage(session),
      ``,
      `The safest practical answer is: handle each event in Workday as soon as it happens, and do not wait for open enrollment if you need to change coverage.`,
    ].join('\n');
  }

  if (birthOrAdoptionEvent) {
    return [
      `Birth or adoption is a qualifying life event, so you should handle that change in Workday as soon as the event happens rather than waiting for open enrollment.`,
      ``,
      `The safest practical answer is:`,
      `- add the baby or adopted child through the QLE workflow after the event date`,
      `- assume the filing window is limited and commonly around 30 days unless Workday or the SPD shows a different deadline`,
      `- use that event to update the child and, if needed, change your coverage tier or plan`,
      ``,
      `I would confirm the exact deadline in Workday right away or call HR at ${HR_PHONE} if you want the official cutoff before the event happens.`,
    ].join('\n');
  }

  return [
    `Marriage is a qualifying life event, so you should not wait for open enrollment if you need to change coverage after getting married.`,
    ``,
    `The safest practical answer is:`,
    `- file the marriage event in Workday promptly after the marriage date`,
    `- assume the filing window is limited and commonly around 30 days unless Workday or the SPD shows a different deadline`,
    `- use that event to add your spouse and update the medical coverage tier if needed`,
    ``,
    `If you want the exact deadline AmeriVet is showing for your event, I would check Workday immediately or call HR at ${HR_PHONE}.`,
  ].join('\n');
}

function isMedicalPremiumReplayQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(show\s+me\s+the\s+numbers(?:\s+again)?|show\s+me\s+the\s+monthly\s+numbers|show\s+me\s+how\s+much\s+i\s+have\s+to\s+pay\s+each\s+month|monthly\s+premiums?|per\s+month\s+on\s+each\s+plan|how\s+much\s+will\s+my\s+premium\s+be|what\s+are\s+the\s+premiums?|what\s+would\s+the\s+premium\s+be|show\s+me\s+.*pricing|pricing\s+for\s+employee|show\s+me\s+the\s+employee\s*\+|employee\s*\+\s*(?:family|spouse|child(?:ren)?)\s+pricing)\b/i.test(lower);
}

function buildMedicalPremiumReplayReply(session: Session, query: string): string {
  const coverageTier = getCoverageTierForQuery(query, session);
  const rows = getFilteredMedicalPricingRowsForTier(session, coverageTier);
  const locationLabel = session.userState ? ` in ${session.userState}` : '';

  const lines = [`Here are the monthly medical premiums for ${coverageTier} coverage${locationLabel}:`, ``];
  for (const row of rows) {
    lines.push(`- **${row.plan}**: $${pricingUtils.formatMoney(row.perMonth)}/month ($${pricingUtils.formatMoney(row.perPaycheck)} per paycheck)`);
  }
  lines.push(``);
  lines.push(`If you want, I can also compare the deductible and out-of-pocket tradeoff right next to those premiums.`);
  return lines.join('\n');
}

function countSupplementalTopicsMentioned(query: string): number {
  const lower = query.toLowerCase();
  let count = 0;
  if (/\b(life(?:\s+insurance)?|term life|whole life|basic life)\b/i.test(lower)) count += 1;
  if (/\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower)) count += 1;
  if (/\bcritical(?:\s+illness)?\b/i.test(lower)) count += 1;
  if (/\b(accident|ad&d|ad\/d)\b/i.test(lower)) count += 1;
  return count;
}

function isSupplementalNarrowingQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return countSupplementalTopicsMentioned(lower) >= 2
    || /\b(narrow\s+down|most\s+relevant\s+next|which\s+is\s+most\s+relevant|which\s+one\s+matters\s+more|more\s+useful|what\s+should\s+i\s+add\s+next|if\s+i\s+add\s+one\s+thing)\b/i.test(lower)
      && /\b(life|disability|critical|accident|supplemental)\b/i.test(lower);
}

function buildSupplementalNarrowingReply(session: Session, query: string): string {
  const lower = query.toLowerCase();
  const householdText = `${(session.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n')}\n${query}`.toLowerCase();
  const soleBreadwinner = /\b(sole\s+bread\s*winner|breadwinner|only\s+income|sole\s+provider|only\s+provider|family\s+relies\s+on\s+my\s+income|rely\s+on\s+my\s+income|single\s+(?:mom|dad))\b/i.test(householdText);
  const householdDependsOnIncome = soleBreadwinner || /\b(spouse|wife|husband|partner|kids?|children|family|household)\b/i.test(householdText);
  const mentionsLife = /\b(life(?:\s+insurance)?|term life|whole life|basic life|25k)\b/i.test(lower);
  const mentionsDisability = /\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower);
  const mentionsCritical = /\bcritical(?:\s+illness)?\b/i.test(lower);
  const mentionsAccident = /\b(accident|ad&d|ad\/d)\b/i.test(lower);

  if (mentionsLife && mentionsDisability) {
    return [
      householdDependsOnIncome
        ? `If you are choosing between more life insurance and disability, I would usually tighten up **disability first** when the household depends on your paycheck.`
        : `If you are choosing between more life insurance and disability, the practical split is paycheck protection versus long-term survivor protection.`,
      ``,
      `Why:`,
      `- **Disability** protects part of your income if you are alive but unable to work`,
      `- **Life insurance** protects the household if you die`,
      `- AmeriVet already gives you a basic employer-paid life benefit, so the extra gap is often disability first when missing income would hurt immediately`,
      ``,
      householdDependsOnIncome
        ? `So if you are asking me to lead the decision, I would usually do **disability first**, then add more **life insurance** if the household still needs more survivor protection than the employer-paid basic benefit.`
        : `So if you are asking me to lead the decision, I would usually choose the one that covers the bigger real-world gap first: paycheck interruption or survivor protection.`,
    ].join('\n');
  }

  if (mentionsDisability && (mentionsCritical || mentionsAccident)) {
    return [
      `If you want me to narrow down disability versus the smaller supplemental cash benefits, I would usually put **disability first** when income protection matters for the household.`,
      ``,
      `After that:`,
      `- choose **Critical Illness** if the bigger fear is the financial shock of a serious diagnosis`,
      `- choose **Accident/AD&D** if the bigger fear is injury risk`,
      ``,
      `So my practical order is usually: **medical first**, then **disability/life** if income protection matters, then **critical illness or accident** if you still want an extra cash-support layer.`,
    ].join('\n');
  }

  if (mentionsCritical && mentionsAccident) {
    return buildAccidentVsCriticalComparison();
  }

  return [
    `If you want me to narrow down the supplemental side, I would usually decide it in this order:`,
    ``,
    `- **Disability or life** first if the household depends on your income`,
    `- **Critical Illness** next if diagnosis-triggered cash support feels more relevant`,
    `- **Accident/AD&D** next if injury risk feels more relevant`,
    ``,
    `So if you want, tell me whether your bigger concern is paycheck interruption, survivor protection, diagnosis risk, or injury risk and I’ll narrow it to the most relevant next step.`,
  ].join('\n');
}

function isExplicitTopicDirectQuestion(topic: string, query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();

  if (topic === 'Medical') {
    return isTopicOverviewQuestion(query)
      || isShortTopicPivot(query, 'Medical')
      || isDirectMedicalContinuationQuestion(query)
      || isMedicalCoverageTierQuestion(query)
      || isMedicalPremiumReplayQuestion(query)
      || isMedicalPregnancySignal(query);
  }

  if (topic === 'HSA/FSA') {
    return isTopicOverviewQuestion(query)
      || isShortTopicPivot(query, 'HSA/FSA')
      || isDirectHsaFsaFitQuestion(query)
      || isHsaFsaCompatibilityQuestion(query)
      || /\bwhat\s+does\s+(hsa|fsa)\s+mean\b|\bwhat\s+is\s+an?\s+(hsa|fsa)\b|\bhelp\s+me\s+with\s+hsa\/fsa\b|\bhsa\/fsa\s+stuff\b|\btell\s+me\s+about\s+hsa\/fsa\b/i.test(lower);
  }

  if (topic === 'Dental' || topic === 'Vision') {
    return isTopicOverviewQuestion(query)
      || isShortTopicPivot(query, topic)
      || isRoutineBenefitDetailQuestion(query)
      || isWorthAddingFollowup(query);
  }

  return isTopicOverviewQuestion(query)
    || isShortTopicPivot(query, topic)
    || isNonMedicalDetailQuestion(topic, query)
    || isSupplementalRecommendationQuestion(query)
    || isWorthAddingFollowup(query);
}

function buildHighPriorityIntentReply(session: Session, query: string): EngineResult | null {
  const normalizedQuery = normalizeContinuationQuery(query);
  const lower = normalizedQuery.toLowerCase();
  const activeTopic = session.currentTopic || inferTopicFromLastBotMessage(session.lastBotMessage);
  const explicitTopic = benefitTopicFromQuery(normalizedQuery);
  const medicalContext = activeTopic === 'Medical'
    || explicitTopic === 'Medical'
    || /\b(plan|plans|medical|kaiser|hsa|hmo|ppo|coverage|premium|premiums|employee\s*\+|spouse|family|kids?|children|household)\b/i.test(lower);
  const wantsMedicalPremiumReplay = isMedicalPremiumReplayQuestion(normalizedQuery);
  const wantsMedicalCostEstimate = isCostModelRequest(normalizedQuery)
    || /\b(what\s+are\s+the\s+costs?|what\s+would\s+the\s+costs?\s+be|estimate\s+the\s+likely\s+costs?|estimate\s+likely\s+costs?|projected\s+costs?|show\s+me\s+the\s+costs?|what\s+would\s+i\s+pay)\b/i.test(lower);

  // Desired precedence contract:
  // 1. Direct support / Workday / HR lives outside this helper.
  // 2. Fresh package-level recommendation questions.
  // 3. Fresh direct practical questions.
  // 4. Fresh direct policy / QLE questions.
  // 5. Fresh explicit topic pivots.
  // 6. Only then let stale-topic continuation and pending-guidance scaffolding try to carry the conversation.

  if (isPackageRecommendationQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    return { answer: buildPackageRecommendationReply(session, normalizedQuery), metadata: { intercept: 'package-recommendation-v2' } };
  }

  if (
    isReturnToMedicalIntent(normalizedQuery)
    && (
      activeTopic === 'HSA/FSA'
      || activeTopic === 'Medical'
      || /hsa\/fsa overview|health savings account|flexible spending account|medical plan options|standard hsa|enhanced hsa|kaiser standard hmo/i.test(session.lastBotMessage || '')
    )
  ) {
    setTopic(session, 'Medical');
    return {
      answer: buildTopicReply(session, 'Medical', canonicalTopicQuery('Medical', normalizedQuery)),
      metadata: { intercept: 'return-to-medical-priority-v2', topic: 'Medical' },
    };
  }

  if (isQleTimingQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    return { answer: buildQleTimingReply(session, normalizedQuery), metadata: { intercept: 'qle-timing-v2' } };
  }

  if (explicitTopic && explicitTopic !== 'Benefits Overview') {
    const normalizedExplicitTopic = normalizeBenefitCategory(explicitTopic);
    if (isExplicitTopicDirectQuestion(normalizedExplicitTopic, normalizedQuery)) {
      const topicQuery =
        isTopicOverviewQuestion(normalizedQuery) || isShortTopicPivot(normalizedQuery, normalizedExplicitTopic)
          ? canonicalTopicQuery(normalizedExplicitTopic, normalizedQuery)
          : normalizedQuery;
      setTopic(session, normalizedExplicitTopic);
      return {
        answer: buildTopicReply(session, normalizedExplicitTopic, topicQuery),
        metadata: { intercept: 'fresh-topic-direct-v2', topic: normalizedExplicitTopic },
      };
    }
  }

  if (
    (activeTopic === 'Medical' || explicitTopic === 'Medical')
    && (isDirectMedicalContinuationQuestion(normalizedQuery)
      || isMedicalPregnancySignal(normalizedQuery)
      || isMedicalAccumulatorComparisonQuestion(normalizedQuery))
  ) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildTopicReply(session, 'Medical', normalizedQuery),
      metadata: { intercept: 'direct-medical-priority-v2', topic: 'Medical' },
    };
  }

  if (medicalContext && wantsMedicalPremiumReplay) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildMedicalPremiumReplayReply(session, normalizedQuery),
      metadata: { intercept: 'medical-premium-replay-v2', topic: 'Medical' },
    };
  }

  if (medicalContext && wantsMedicalCostEstimate) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildTopicReply(session, 'Medical', normalizedQuery),
      metadata: { intercept: 'medical-cost-priority-v2', topic: 'Medical' },
    };
  }

  if (isMedicalCoverageTierQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildMedicalCoverageTierDecisionReply(session, normalizedQuery),
      metadata: { intercept: 'medical-coverage-tier-priority-v2', topic: 'Medical' },
    };
  }

  if (
    (explicitTopic === 'HSA/FSA' || activeTopic === 'HSA/FSA')
    && (isDirectHsaFsaFitQuestion(normalizedQuery) || isHsaFsaCompatibilityQuestion(normalizedQuery))
  ) {
    setTopic(session, 'HSA/FSA');
    return {
      answer: buildTopicReply(session, 'HSA/FSA', normalizedQuery),
      metadata: { intercept: 'direct-hsa-fsa-priority-v2', topic: 'HSA/FSA' },
    };
  }

  if (isSupplementalNarrowingQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    return { answer: buildSupplementalNarrowingReply(session, normalizedQuery), metadata: { intercept: 'supplemental-narrowing-v2' } };
  }

  return null;
}

function buildHsaFsaCompatibilityReply(query: string): string {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (/\b(if\s+i\s+really\s+want\s+to\s+use\s+an?\s+hsa|want\s+to\s+keep\s+hsa\s+eligibility|does\s+that\s+mean\s+i\s+can'?t\s+use\s+an?\s+hsa|can(?:not|'t)\s+use\s+an?\s+hsa|use\s+an?\s+hsa\s+with\s+kaiser)\b/i.test(lower)) {
    return [
      `If using an **HSA** is important to you, I would usually **not** go with **Kaiser Standard HMO**.`,
      ``,
      `Why:`,
      `- AmeriVet's HSA-qualified medical plans are **Standard HSA** and **Enhanced HSA**`,
      `- **Kaiser Standard HMO** is the non-HSA-qualified path in AmeriVet's package`,
      `- So if Kaiser is your medical plan, FSA is usually the cleaner pre-tax account and HSA is not the main fit there`,
      ``,
      `So yes: if HSA eligibility is the priority, I would usually stay with **Standard HSA** or **Enhanced HSA** instead of Kaiser.`,
    ].join('\n');
  }

  if (/\bcan\s+i\s+use\s+an?\s+fsa\b.*\b(kaiser|hmo)\b|\b(kaiser|hmo)\b.*\bcan\s+i\s+use\s+an?\s+fsa\b/i.test(lower)) {
    return [
      `Yes. If you enroll in **Kaiser Standard HMO**, **FSA** is usually the more natural pre-tax account.`,
      ``,
      `Why:`,
      `- Kaiser Standard HMO is AmeriVet's non-HSA-qualified medical option`,
      `- FSA is the cleaner fit when you want pre-tax help for near-term eligible expenses and you are not trying to preserve HSA eligibility`,
      ``,
      `So the short version is: **Kaiser pairs more naturally with FSA than HSA.**`,
    ].join('\n');
  }

  if (/\bshould\s+i\s+use\s+an?\s+fsa\b|\buse\s+an?\s+fsa\b/i.test(lower)) {
    return [
      `I would usually use an FSA only if you expect to spend the money within the current plan year and you are not trying to keep HSA eligibility as the main priority.`,
      ``,
      `In AmeriVet's package, that usually means:`,
      `- choose HSA if you are in Standard HSA or Enhanced HSA and want rollover plus longer-term savings`,
      `- choose FSA if you are in a non-HSA-qualified setup like Kaiser Standard HMO or if your goal is near-term pre-tax spending rather than building an HSA balance`,
      ``,
      `So my practical take is: use FSA when you expect to spend the dollars soon; use HSA when you want the long-term tax-advantaged account.`,
    ].join('\n');
  }

  if (/\b(kaiser|hmo)\b/i.test(lower)) {
    return [
      `FSA is not really about the Kaiser network itself. The practical question is whether your medical plan is HSA-qualified.`,
      ``,
      `For AmeriVet's package:`,
      `- Kaiser Standard HMO is generally the kind of plan where an FSA is the cleaner pre-tax spending companion, because it is not the HSA-qualified option`,
      `- Standard HSA and Enhanced HSA are the HSA-qualified medical plans, so that is where HSA is usually the better fit`,
      `- You generally cannot make full HSA contributions while covered by a general-purpose healthcare FSA`,
      ``,
      `So if you are choosing Kaiser Standard HMO, FSA is usually the more natural pre-tax account than HSA.`,
    ].join('\n');
  }

  return [
    `The practical answer is that FSA makes more sense when you want pre-tax help for expenses you expect to use within the current plan year and you are not relying on an HSA-qualified medical plan.`,
    ``,
    `In AmeriVet's package:`,
    `- HSA is usually the cleaner fit with Standard HSA or Enhanced HSA`,
    `- FSA is usually the cleaner fit if you are not on an HSA-qualified medical plan, or if you expect to spend the money soon rather than build a longer-term healthcare cushion`,
    `- You generally cannot make full HSA contributions while covered by a general-purpose healthcare FSA`,
  ].join('\n');
}

function isDirectHsaFsaFitQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(which\s+one\s+is\s+better|which\s+one\s+is\s+best|better\s+fit|best\s+fit|which\s+one\s+fits|which\s+would\s+you\s+recommend|what\s+would\s+you\s+recommend|which\s+do\s+you\s+recommend|recommend\s+(?:for|to)\s+me|when\s+does\s+hsa\s+fit\s+better|when\s+does\s+fsa\s+fit\s+better|when\s+is\s+hsa\s+better|when\s+is\s+fsa\s+better|should\s+i\s+get|should\s+i\s+use|is\s+it\s+worth\s+it|worth\s+it|worth\s+using)\b/i.test(lower);
}

function buildHsaFsaPracticalFitReply(session: Session, query: string): string | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const currentPlan = session.selectedPlan || '';

  if (/\b(if\s+i\s+really\s+want\s+to\s+use\s+an?\s+hsa|want\s+to\s+keep\s+hsa\s+eligibility)\b/i.test(lower)) {
    return [
      `If keeping **HSA eligibility** is the priority, I would usually stay with **Standard HSA** or **Enhanced HSA** rather than **Kaiser Standard HMO**.`,
      ``,
      `Why:`,
      `- Standard HSA and Enhanced HSA are AmeriVet's HSA-qualified medical paths`,
      `- Kaiser Standard HMO is the non-HSA-qualified path`,
      `- So the cleaner match for "I really want an HSA" is one of the two HSA medical plans`,
    ].join('\n');
  }

  if (/\b(this\s+year|current\s+plan\s+year|spend\s+it\s+soon|use\s+it\s+soon|near[- ]term|right\s+away)\b/i.test(lower)) {
    return [
      `If the goal is to spend the money in the current plan year, **FSA is usually the cleaner fit.**`,
      ``,
      `Why:`,
      `- It is built for near-term eligible expenses instead of long-term rollover savings`,
      `- If you are leaning toward an HSA-qualified medical plan like Standard HSA or Enhanced HSA, HSA is still the better long-term account`,
      `- But for "use it soon" spending, FSA is the more natural answer`,
    ].join('\n');
  }

  if (/\b(long[- ]term|rollover|save\s+it|future|build\s+a\s+cushion)\b/i.test(lower)) {
    return [
      `If the goal is long-term rollover savings, **HSA is usually the cleaner fit.**`,
      ``,
      `Why:`,
      `- The account stays with you`,
      `- Unused funds can roll forward year to year`,
      `- It is the stronger fit for building a longer-term healthcare cushion`,
    ].join('\n');
  }

  if (/\bkaiser|hmo\b/i.test(lower) || /Kaiser Standard HMO/i.test(currentPlan)) {
    return [
      `If you are leaning toward **Kaiser Standard HMO**, FSA is usually the more natural pre-tax account and the cleaner fit.`,
      ``,
      `Why:`,
      `- The practical dividing line is whether your medical plan is HSA-qualified`,
      `- Kaiser Standard HMO is the non-HSA-qualified path in AmeriVet's package`,
    ].join('\n');
  }

  if (/Standard HSA|Enhanced HSA/i.test(currentPlan)) {
    return [
      `Because you are already leaning toward **${currentPlan}**, **HSA is usually the cleaner fit.**`,
      ``,
      `Why:`,
      `- It keeps the tax account aligned with the HSA-qualified medical plan`,
      `- It gives you the rollover advantage if you do not need to spend every dollar in the current plan year`,
    ].join('\n');
  }

  if (isDirectHsaFsaFitQuestion(query)) {
    return buildHsaFitGuidance();
  }

  return null;
}

function isBenefitDecisionGuidanceRequest(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (isCostModelRequest(lower)) return false;
  if (isDirectMedicalRecommendationQuestion(lower)) return false;
  if (isMedicalDetailQuestion(lower)) return false;
  if (/\b(plan|kaiser|standard hsa|enhanced hsa|maternity|pregnan|copay|prescription|deductible|coinsurance|out[- ]of[- ]pocket)\b/i.test(lower)) return false;
  return (
    /\b(worth\s+considering|think\s+through|help\s+me\s+decide|what\s+should\s+i\s+consider|what\s+else\s+should\s+i\s+consider|which\s+of\s+these\s+benefits|which\s+benefit\s+is\s+worth|what\s+should\s+i\s+look\s+at\s+first|pay\s+attention\s+to\s+first)\b/i.test(lower)
    && /\b(benefit|benefits|package|coverage)\b/i.test(lower)
  ) || /\bprotecting\s+my\s+family|routine\s+care|healthcare\s+costs\b/i.test(lower);
}

function detectBenefitPriorityFocus(query: string): BenefitPriorityFocus | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (/\b(family\s+protection|protect(?:ing)?\s+my\s+family|protect\s+my\s+family|income\s+protection|family\s+stuff|household\s+protection|protect\s+the\s+household)\b/i.test(lower)) {
    return 'family_protection';
  }
  if (/\b(routine\s+care|routine\s+stuff|everyday\s+care|everyday\s+stuff|day[- ]to[- ]day\s+care|dental\s+and\s+vision|glasses|contacts|cleanings)\b/i.test(lower)) {
    return 'routine_care';
  }
  if (/\b(healthcare\s+costs?|medical\s+costs?|lowest\s+bills|save\s+money|keep\s+costs?\s+down|lowest\s+premium|lowest\s+premiums|lowest\s+payroll\s+deduction|monthly\s+premium|mostly\s+care\s+about\s+costs?)\b/i.test(lower)) {
    return 'healthcare_costs';
  }
  return null;
}

function detectSupplementalComparisonFocus(query: string): SupplementalComparisonFocus | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (/\b(injury\s+risk|accident\s+risk|injury|accidents?|active\s+household|active\s+kids?)\b/i.test(lower)) {
    return 'injury_risk';
  }
  if (/\b(diagnosis\s+risk|serious\s+diagnosis|major\s+diagnosis|illness\s+risk|cancer|heart attack|stroke)\b/i.test(lower)) {
    return 'diagnosis_risk';
  }
  return null;
}

function detectHsaFitFocus(query: string): HsaFitFocus | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (/\b(long[- ]term|savings|save it|rollover|future medical costs|build a cushion)\b/i.test(lower)) {
    return 'long_term_savings';
  }
  if (/\b(near[- ]term|this year|use it soon|use it right away|near term|current plan year|spend it soon)\b/i.test(lower)) {
    return 'near_term_expenses';
  }
  return null;
}

function buildBenefitDecisionGuidance(session: Session, focus?: BenefitPriorityFocus | null): string {
  const hasDependents = /employee\s+\+\s+(spouse|child|family)/i.test(session.coverageTierLock || '');
  if (focus === 'family_protection') {
    setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
    return [
      `If protecting your family is the top priority, I would focus here first:`,
      ``,
      `- Keep medical in place first so a major illness or injury does not become the biggest financial hit`,
      `- Look at life insurance next so your household has income replacement if something happens to you`,
      `- Look at disability after that, because protecting your paycheck is often just as important as the death benefit when people rely on your income`,
      `- Treat dental and vision as secondary unless your household expects regular routine use`,
      ``,
      `If you want, I can walk you through life versus disability next and explain which one usually matters more for family protection.`,
    ].join('\n');
  }

  if (focus === 'routine_care') {
    setPendingGuidance(session, 'dental_vs_vision', 'Dental');
    return [
      `If routine care is what matters most, I would usually narrow it this way:`,
      ``,
      `- Start with medical so you choose the right core plan for doctor visits, prescriptions, and unexpected care`,
      `- Look at dental next if your household expects cleanings, fillings, crowns, or orthodontic use`,
      `- Look at vision after that if you expect eye exams, glasses, or contacts`,
      `- Leave life, disability, and supplemental plans for after your everyday care decisions are settled`,
      ``,
      `If you want, I can help you decide whether dental or vision is more worth adding first based on what your household actually uses.`,
    ].join('\n');
  }

  if (focus === 'healthcare_costs') {
    setPendingGuidance(session, 'medical_tradeoff_compare', 'Medical');
    return [
      `If keeping healthcare costs down is the priority, I would narrow it this way:`,
      ``,
      `- Focus on medical first, because that is where premium, deductible, and out-of-pocket exposure matter most`,
      `- Compare Standard HSA versus Enhanced HSA based on how much care you expect to use`,
      `- Consider dental and vision after that only if you know your household will actually use them enough to justify the extra payroll deduction`,
      `- Leave supplemental plans for later unless you already know you want extra cash-protection coverage`,
      ``,
      `If you want, I can compare the medical tradeoff first and then help you decide whether dental or vision is worth adding on top.`,
    ].join('\n');
  }

  const guidance = [
    `If you are deciding what is actually worth attention first, I would usually think about your benefits in this order:`,
    ``,
    `- Medical first if you want to manage the biggest healthcare cost risk`,
    `- Dental and vision next if you expect routine use and want predictable everyday coverage`,
    `- Life and disability next if protecting family income matters more than routine care`,
    `- Accident or critical illness last if you want extra cash-support protection on top of your core coverage`,
  ];

  if (hasDependents) {
    guidance.push('', `Since you appear to be covering more than just yourself, the most important areas are usually medical first, then life/disability protection, then dental/vision if your household expects to use them.`);
  }

  guidance.push('', `If you want, tell me whether you are optimizing more for healthcare costs, family protection, or routine care, and I’ll narrow down what is most worth considering first.`);
  return guidance.join('\n');
}

function buildHsaFitGuidance(): string {
  return [
    `Here is the simplest way to think about HSA versus FSA fit:`,
    ``,
    `- HSA is usually the better fit if you are enrolled in AmeriVet's Standard HSA or Enhanced HSA plan, want long-term tax advantages, and like the idea of rollover year to year instead of losing the unused balance`,
    `- FSA is usually the better fit if you expect to spend the money within the current plan year and want pre-tax help with eligible expenses without needing an HSA-qualified medical plan`,
    `- HSA is usually stronger for people who want to build a longer-term healthcare cushion`,
    `- FSA is usually stronger for people who know they will use the dollars soon and do not need the portability of an HSA`,
    ``,
    `The biggest rule to remember is that you generally cannot make full HSA contributions while covered by a general-purpose healthcare FSA.`,
    ``,
    `If you want, I can help you think through which one fits better based on whether you are optimizing for long-term savings or near-term medical expenses.`,
  ].join('\n');
}

function buildHsaFitSpecificReply(focus: HsaFitFocus): string {
  if (focus === 'long_term_savings') {
    return [
      `If you are thinking more about long-term savings, HSA is usually the cleaner fit.`,
      ``,
      `That is because:`,
      `- unused HSA funds roll over year to year`,
      `- the account stays with you`,
      `- it is better for building a longer-term healthcare cushion instead of spending everything in the current plan year`,
    ].join('\n');
  }

  return [
    `If you are thinking more about near-term expenses, FSA is usually the cleaner fit.`,
    ``,
    `That is because:`,
    `- it is meant for eligible expenses you expect to pay within the current plan year`,
    `- it still uses pre-tax dollars`,
    `- it makes more sense when you care more about spending soon than rolling money forward long term`,
  ].join('\n');
}

function buildAccidentVsCriticalComparison(): string {
  return [
    `Here is the plain-language difference between Accident/AD&D and Critical Illness:`,
    ``,
    `- Accident/AD&D is tied to covered accidental injuries and accidental loss-of-life or limb events`,
    `- Critical illness is tied to covered diagnoses like a heart attack, stroke, or certain cancers`,
    `- Accident/AD&D is usually more relevant if you want extra protection for injury-related events`,
    `- Critical illness is usually more relevant if you are more worried about the financial shock of a serious diagnosis`,
    ``,
    `If your main worry is an active household and accidental injury, Accident/AD&D usually feels more relevant.`,
    `If your main worry is a major diagnosis creating cash pressure on top of medical bills, Critical Illness usually feels more relevant.`,
    ``,
    `If you want, I can narrow down which one is the better fit based on whether you are more worried about injury risk or diagnosis risk.`,
  ].join('\n');
}

function buildLifeVsDisabilityComparison(): string {
  return [
    `Here is the simplest way to separate life insurance from disability:`,
    ``,
    `- Life insurance is for protecting your household if you die`,
    `- Disability is for protecting part of your income if you are alive but unable to work because of illness or injury`,
    `- If people rely on your paycheck, disability often matters sooner than people expect`,
    `- If people rely on your long-term income and would need support after your death, life insurance is essential too`,
    ``,
    `For many working families, disability and life are both important, but disability is often the more immediate paycheck-protection decision while life is the household-replacement decision.`,
  ].join('\n');
}

function buildDentalVsVisionDecision(): string {
  return [
    `If you are deciding between dental and vision as the next add-on, I would usually frame it this way:`,
    ``,
    `- Choose dental first if your household expects cleanings, fillings, crowns, or orthodontic use`,
    `- Choose vision first if you expect regular eye exams, glasses, or contacts`,
    `- Dental usually has the bigger upside when there is known procedure use`,
    `- Vision is usually easier to justify when you know the household uses exams and eyewear every year`,
    ``,
    `So the better add-on depends less on theory and more on what your household already knows it will use.`,
  ].join('\n');
}

function buildMedicalRecommendationWhy(session: Session): string {
  const usage = usageLevelFromSession(session);
  const recommendationHistory = (session.messages || [])
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .reverse()
    .find((content) => /My recommendation:\s*/i.test(content)) || session.lastBotMessage || '';
  const recommendation = recommendationHistory.match(/My recommendation:\s*([A-Za-z ]+)/i)?.[1]?.trim();

  if (/Enhanced HSA/i.test(recommendation || '')) {
    return [
      `The reason I leaned Enhanced HSA is that your usage sounds high enough that paying more in premium can still be the better trade if it lowers the deductible shock when care actually happens.`,
      ``,
      `The practical tradeoff is:`,
      `- Standard HSA keeps your monthly premium lower`,
      `- Enhanced HSA usually feels better once you expect regular care, prescriptions, or a meaningful chance of hitting the deductible`,
      ``,
      `So I would only move off the cheaper option if you think the extra premium is buying you real peace of mind against higher medical use.`,
    ].join('\n');
  }

  if (/Kaiser Standard HMO/i.test(recommendation || '')) {
    return [
      `The reason I leaned Kaiser is that if you specifically want the Kaiser-style integrated network and you are in an eligible state, it can be a reasonable fit even when it is not the lowest-premium option.`,
      ``,
      `The tradeoff is usually about the network and cost-sharing structure, not just premium alone.`,
    ].join('\n');
  }

  return [
    `The reason I leaned Standard HSA is that it is usually the better fit when the goal is to keep your own monthly premium lower and you do not expect much care.`,
    ``,
    `The practical tradeoff is:`,
    `- Standard HSA keeps your monthly premium lower`,
    `- Enhanced HSA can be worth the extra premium if you expect enough care for the stronger cost protection to matter`,
    ``,
    usage === 'low'
      ? `Since your expected usage sounds low, I would usually only pay more for Enhanced HSA if you strongly prefer extra deductible protection over lower premiums.`
      : `If your usage creeps up into moderate or high territory, that is when paying more for Enhanced HSA starts to make more sense.`,
  ].join('\n');
}

function buildMedicalWorthExtraPremiumReply(session: Session): string {
  const usage = usageLevelFromSession(session);
  return [
    `Whether the higher-cost medical option is worth the extra premium mostly comes down to expected use.`,
    ``,
    `- If usage is low, I would usually keep the cheaper option and avoid paying more up front`,
    `- If usage is moderate to high, the extra premium can be worth it if it meaningfully softens the deductible and out-of-pocket risk`,
    `- If you care most about the lowest ongoing monthly cost, the higher-premium option is usually harder to justify`,
    ``,
    usage === 'high'
      ? `Because your current context sounds closer to higher usage, I would take the stronger cost protection more seriously.`
      : usage === 'low'
        ? `Because your current context sounds closer to low usage, I would usually stay with the cheaper plan unless you really want the extra protection.`
        : `Because your current context sounds moderate, this is the gray zone where the choice is really about your comfort with risk versus premium spend.`,
  ].join('\n');
}

function hasPregnancyContext(session: Session, query = ''): boolean {
  const lower = `${query}\n${(session.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n')}`.toLowerCase();
  return /\b(my wife is pregnant|i'?m pregnant|we(?:'re| are) expecting|pregnant|maternity|prenatal|postnatal|delivery|baby|birth)\b/i.test(lower)
    || Boolean(session.lifeEvents?.includes('pregnancy'));
}

function buildWhyNotKaiserReply(session: Session): string {
  const state = session.userState || 'your state';
  const kaiserEligible = !!session.userState && isKaiserEligibleState(session.userState);

  if (hasPregnancyContext(session) && kaiserEligible) {
    return [
      `If pregnancy is already part of the picture and Kaiser is available in ${state}, I would actually look at **Kaiser Standard HMO** very seriously for the lowest likely maternity-related out-of-pocket exposure.`,
      ``,
      `The practical tradeoff is:`,
      `- **Kaiser Standard HMO** usually becomes the more natural answer if your top priority is lowering maternity cost exposure in a Kaiser-eligible state`,
      `- **Standard HSA** only stays in front if your bigger priority is keeping the monthly premium lower and taking on more cost risk when care happens`,
      ``,
      `So in a pregnancy-heavy conversation, I would not frame Standard HSA as the default answer over Kaiser.`,
    ].join('\n');
  }

  if (kaiserEligible) {
    return [
      `I would not rule out **Kaiser Standard HMO** if you prefer that integrated network in ${state}.`,
      ``,
      `The main question is whether you value the Kaiser network and cost-sharing structure more than the PPO flexibility in Standard HSA or Enhanced HSA.`,
    ].join('\n');
  }

  return [
    `I did not keep **Kaiser Standard HMO** in front because it is only available in CA, GA, WA, and OR.`,
    ``,
    `Outside those states, the practical comparison is really **Standard HSA** versus **Enhanced HSA**.`,
  ].join('\n');
}

function buildMedicalPracticalTake(session: Session): string {
  const usage = usageLevelFromSession(session);
  const recommendationHistory = (session.messages || [])
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .reverse()
    .find((content) => /My recommendation:\s*/i.test(content)) || session.lastBotMessage || '';
  const recommendation = recommendationHistory.match(/My recommendation:\s*([A-Za-z ]+)/i)?.[1]?.trim();
  const chosen = recommendation || (usage === 'high' ? 'Enhanced HSA' : 'Standard HSA');

  return [
    `My practical take is that I would usually land on **${chosen}** for this situation.`,
    ``,
    chosen === 'Enhanced HSA'
      ? `I would make that choice when I think the household is likely to use enough care that the stronger cost protection is worth paying for up front.`
      : `I would make that choice when I think the household is trying to keep costs down and is unlikely to use enough care to justify the higher-cost option.`,
    ``,
    `So the real question is not which plan sounds nicer — it is whether you think your likely usage is high enough to make the extra premium pay for itself in peace of mind or actual cost protection.`,
  ].join('\n');
}

function buildMedicalFamilySpecificReply(session: Session, query = ''): string {
  const tier = coverageTierFromConversation(session) || session.coverageTierLock || 'Employee Only';
  const usage = usageLevelFromSession(session);
  const lower = query.toLowerCase();
  const spouseFocused = /\bspouse\b|\bpartner\b/i.test(lower);
  const childFocused = /\bkids?\b|\bchildren\b/i.test(lower);

  if (/Employee \+ Family|Employee \+ Child|Employee \+ Spouse/i.test(tier)) {
    const lead = childFocused
      ? `If you are thinking specifically about your kids, the practical question is whether the household is likely to use enough care for the stronger medical protection to matter.`
      : spouseFocused
        ? `If you are thinking specifically about your spouse, the practical question is whether the household is likely to use enough care for the stronger medical protection to matter.`
        : `If you are thinking specifically about your household, the practical question is whether the household is likely to use enough care for the stronger medical protection to matter.`;
    const richerProtectionLine = /Employee \+ Spouse/i.test(tier)
      ? `- If your spouse has recurring visits, regular prescriptions, therapy, or a strong preference for using more care than routine checkups, the stronger medical protection becomes easier to justify`
      : `- If you expect specialist care, recurring prescriptions, therapy, or a real chance of using more than routine pediatric care, the stronger medical protection becomes easier to justify`;
    return [
      lead,
      ``,
      childFocused
        ? `- If your kids are generally healthy and the household mostly needs routine visits, the lower-premium option is still usually the better fit`
        : spouseFocused
          ? `- If your spouse is generally healthy and the household mostly needs routine visits, the lower-premium option is still usually the better fit`
          : `- If the household is generally healthy and mostly needs routine visits, the lower-premium option is still usually the better fit`,
      richerProtectionLine,
      `- If Kaiser is available in your state and you strongly prefer that integrated network for the family, that can outweigh pure premium savings`,
      ``,
      usage === 'high'
        ? `Because your current context already sounds closer to higher usage, I would take the stronger family protection more seriously than I would for a low-use household.`
        : `Because your current context does not sound like heavy use, I would usually avoid paying more just in case unless you already know the family will use the plan heavily.`,
    ].join('\n');
  }

  return [
    `If you are really asking about household impact, I would first decide whether the medical choice is mainly about routine care, larger-risk protection, or a preferred network.`,
    ``,
    `That is what tells you whether the cheaper plan or the higher-cost plan is more worth it in practice.`,
  ].join('\n');
}

function buildSupplementalPracticalTake(topic: string): string {
  if (topic === 'Accident/AD&D') {
    return [
      `My practical take is that I would usually choose Accident/AD&D before Critical Illness only if the household is especially active and I am more worried about injury risk than diagnosis risk.`,
      ``,
      `If the bigger fear is a serious diagnosis creating financial stress, I would usually look at Critical Illness first.`,
      ``,
      `So my recommendation is: treat Accident/AD&D as a situational add-on for injury risk, not an automatic must-have.`,
    ].join('\n');
  }

  if (topic === 'Life Insurance') {
    return [
      `My practical take is that if people rely on your income, I would not leave life insurance as an afterthought.`,
      ``,
      `It usually becomes one of the first optional benefits worth tightening up once the medical choice is settled.`,
    ].join('\n');
  }

  if (topic === 'Disability') {
    return [
      `My practical take is that disability is often more important than people expect, because losing part of your paycheck can create a problem long before many people think about life insurance payouts.`,
      ``,
      `If your household depends on your ongoing income, disability usually deserves real attention.`,
      ``,
      `So my recommendation is: if your paycheck supports the household, disability is often one of the first optional protections worth tightening up.`,
    ].join('\n');
  }

  if (topic === 'Critical Illness') {
    return [
      `My practical take is that critical illness usually comes after the core medical choice, and after life or disability if income protection is the bigger issue.`,
      ``,
      `Critical illness becomes more worthwhile when you want diagnosis-triggered cash support on top of the core package rather than because the medical plan itself is inadequate.`,
      ``,
      `So my recommendation is: do not treat critical illness as a first-line replacement for the core package; add it only if you want extra diagnosis-triggered cash protection on top.`,
    ].join('\n');
  }

  return [
    `My practical take is that supplemental benefits usually come after the core medical choice, and after life or disability if income protection is the bigger issue.`,
    ``,
    `They become more worthwhile when you want an extra layer of protection rather than because the core package is inadequate.`,
  ].join('\n');
}

function buildAccidentVsCriticalFocusedReply(focus: SupplementalComparisonFocus): string {
  if (focus === 'injury_risk') {
    return [
      `If your concern is more about injury risk, I would usually lean Accident/AD&D first.`,
      ``,
      `That is the cleaner fit when the household is active and you want extra help for accidental-injury scenarios rather than diagnosis-driven scenarios.`,
    ].join('\n');
  }

  return [
    `If your concern is more about diagnosis risk, I would usually lean Critical Illness first.`,
    ``,
    `That becomes more relevant when the bigger fear is a serious diagnosis creating financial stress on top of the medical plan rather than an accidental injury event.`,
  ].join('\n');
}

function buildComparisonFamilyReply(
  kind: 'accident_vs_critical' | 'life_vs_disability' | 'dental_vs_vision',
  query = '',
): string {
  const lower = query.toLowerCase();
  const spouseFocused = /\bspouse\b|\bpartner\b/i.test(lower);
  const childFocused = /\bkids?\b|\bchildren\b/i.test(lower);

  if (kind === 'life_vs_disability') {
    return [
      childFocused
        ? `If you are thinking about your kids first, life and disability usually work together rather than replacing each other.`
        : spouseFocused
          ? `If you are thinking about your spouse or partner first, life and disability usually work together rather than replacing each other.`
          : `If you are thinking about your family or household first, life and disability usually work together rather than replacing each other.`,
      ``,
      `- Life insurance is the household-replacement decision if something happens to you`,
      `- Disability is the paycheck-protection decision if you are alive but unable to work`,
      `- For many families, disability matters sooner than people expect because an interrupted paycheck can create stress before anyone is thinking about a death benefit`,
      ``,
      childFocused
        ? `So if your kids depend on your income, I would usually tighten up disability and life before I worry about smaller supplemental add-ons.`
        : spouseFocused
          ? `So if your spouse depends on your income, I would usually tighten up disability and life before I worry about smaller supplemental add-ons.`
          : `So if your household depends on your income, I would usually tighten up disability and life before I worry about smaller supplemental add-ons.`,
    ].join('\n');
  }

  if (kind === 'dental_vs_vision') {
    return [
      childFocused
        ? `If you are thinking about your kids specifically, dental usually becomes the first add-on more often than vision.`
        : spouseFocused
          ? `If you are thinking about your spouse specifically, the better add-on depends on whether the household expects dental work or regular eyewear use first.`
          : `If you are thinking about your household specifically, dental usually becomes the first add-on more often than vision unless regular eyewear use is already obvious.`,
      ``,
      `- Dental is usually easier to justify if the household will use cleanings, fillings, or orthodontic care`,
      `- Vision becomes easier to justify when you already know the kids need regular eye exams, glasses, or contacts`,
      `- If you do not already expect eyewear use, dental usually has the bigger family upside`,
      ``,
      `So for many households with kids, dental is the first routine-care add-on unless vision use is already obvious.`,
    ].join('\n');
  }

  return [
    `If you are thinking about your household, Accident/AD&D usually matters more when your concern is injury risk, while Critical Illness matters more when your concern is the financial shock of a serious diagnosis.`,
    ``,
    `For a family, I would usually only prioritize either one after the core medical choice and after life or disability if income protection is the bigger concern.`,
  ].join('\n');
}

function buildWhyNotOtherFirstReply(kind: 'accident_vs_critical' | 'life_vs_disability' | 'dental_vs_vision', query: string): string | null {
  const lower = query.toLowerCase();

  if (kind === 'dental_vs_vision' && /\bwhy not vision first\b/i.test(lower)) {
    return [
      `Vision can absolutely come first if your household already knows it will use regular eye exams, glasses, or contacts.`,
      ``,
      `I only lean dental first by default when procedure use like cleanings, fillings, or orthodontia feels more certain than eyewear use.`,
      `So "why not vision first?" really comes down to whether vision use is already obvious in your household.`,
    ].join('\n');
  }

  if (kind === 'life_vs_disability' && /\bwhy not disability first\b/i.test(lower)) {
    return [
      `Disability often can come first, especially if your household depends heavily on your paycheck.`,
      ``,
      `That is because a work-stopping illness or injury can create financial stress long before anyone is thinking about a life insurance payout.`,
      `So if paycheck interruption feels like the more immediate risk, disability first is a very reasonable way to think about it.`,
    ].join('\n');
  }

  if (kind === 'accident_vs_critical' && /\bwhy not critical illness first\b/i.test(lower)) {
    return [
      `Critical Illness can absolutely come first if the bigger fear is the financial shock of a serious diagnosis rather than an accidental injury.`,
      ``,
      `I only lean Accident/AD&D first when the household feels more exposed to injury risk than diagnosis risk.`,
      `So "why not critical illness first?" is really a fair question when diagnosis risk is what feels more relevant to you.`,
    ].join('\n');
  }

  return null;
}

function buildSupplementalFitGuidance(session: Session, topicOverride?: string | null): string {
  const topic = topicOverride || session.currentTopic || session.pendingGuidanceTopic || 'Supplemental';

  if (topic === 'Accident/AD&D') {
    setPendingGuidance(session, 'accident_vs_critical', 'Accident/AD&D');
    return [
      `Accident/AD&D is usually worth considering when one of these sounds true:`,
      ``,
      `- You want extra cash support if an accidental injury happens, even with medical coverage in place`,
      `- Your household is active and you want another layer beyond the core medical plan`,
      `- You would feel better having a supplemental benefit that can help with bills after an accidental injury`,
      ``,
      `It is usually less important than choosing the right medical plan, and usually comes after life or disability if family income protection is the bigger concern.`,
      ``,
      `If you want, I can compare accident/AD&D versus critical illness in plain language so you can see which one is more relevant for your situation.`,
    ].join('\n');
  }

  if (topic === 'Critical Illness') {
    setPendingGuidance(session, 'supplemental_fit', 'Critical Illness');
    return [
      `Critical illness is usually worth considering when you want extra cash support if a major diagnosis happens and you are worried about the non-medical financial ripple effects.`,
      ``,
      `People usually give it more attention when:`,
      `- They have a high deductible medical plan and want extra protection on top`,
      `- They would struggle with household costs, travel, or childcare during a serious health event`,
      `- They want a lump-sum style supplemental benefit rather than just relying on medical coverage alone`,
      ``,
      `It usually comes after the medical decision and often after life or disability if income protection is the bigger concern for the household.`,
    ].join('\n');
  }

  if (topic === 'Disability') {
    setPendingGuidance(session, 'supplemental_fit', 'Disability');
    return [
      `Disability is usually worth considering if missing part of your paycheck would create a bigger financial problem than the medical bills themselves.`,
      ``,
      `People usually prioritize it when:`,
      `- Their household depends on their income`,
      `- They do not have a large emergency cushion`,
      `- Protecting ongoing income feels more urgent than adding another routine-care benefit`,
      ``,
      `If family protection is the priority, disability often matters sooner than supplemental cash benefits like accident or critical illness.`,
    ].join('\n');
  }

  setPendingGuidance(session, 'supplemental_fit', topic === 'Life Insurance' ? 'Life Insurance' : 'Supplemental');
  return [
    `A supplemental benefit is usually worth considering when you already have your core medical decision in place and want an extra layer of cash-support protection.`,
    ``,
    `The usual order is: medical first, then life/disability if income protection matters, then supplemental benefits if you want extra protection on top.`,
    ``,
    `If you want, I can narrow down whether accident, critical illness, or disability is the most relevant next step for your situation.`,
  ].join('\n');
}

function isWorthAddingFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(how\s+do\s+i\s+know|how\s+can\s+i\s+tell|is\s+it\s+worth|worth\s+adding|worth\s+it|should\s+i\s+get|should\s+i\s+add|do\s+i\s+need\s+it|useful|only\s+option|do\s+you\s+recommend|what\s+would\s+you\s+recommend|what\s+do\s+you\s+recommend)\b/i.test(lower);
}

function isRoutineCareComparisonPrompt(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(which\s+one\s+matters\s+more|matters\s+more|which\s+one\s+first|how\s+can\s+i\s+tell\s+which\s+one\s+matters\s+more|do\s+you\s+recommend\s+getting|is\s+(?:dental|vision)\s+worth\s+it)\b/i.test(lower);
}

function buildVisionWorthAddingReply(): string {
  return [
    `Vision is usually worth adding when your household already expects to use eye exams, glasses, or contacts.`,
    ``,
    `A simple way to think about it is:`,
    `- If someone in the household gets routine eye exams and uses glasses or contacts, vision is easier to justify`,
    `- If no one really uses exams or eyewear, it is harder to justify as a must-have add-on`,
    `- In AmeriVet's package, vision is a routine-care add-on, not a replacement for medical coverage`,
    ``,
    `AmeriVet currently offers one vision plan, so the real decision is usually whether it is worth adding at all, not which vision plan to choose.`,
  ].join('\n');
}

function buildVisionOnlyOptionReply(): string {
  return [
    `Yes — AmeriVet currently offers one vision plan, which is **VSP Vision Plus**.`,
    ``,
    `So the real decision is usually not "which vision plan?" but whether it is worth adding at all for your household based on expected eye exams, glasses, or contacts use.`,
    ``,
    `If you want, I can help you think through whether vision is worth adding at all.`,
  ].join('\n');
}

function buildDentalWorthAddingReply(): string {
  return [
    `Dental is usually worth adding when your household expects regular cleanings, fillings, crowns, or orthodontic use.`,
    ``,
    `A simple way to think about it is:`,
    `- If you expect routine dental visits or known dental work, dental is often easier to justify than vision`,
    `- If you do not expect much use at all, then it becomes more of a judgment call rather than an automatic add-on`,
    `- In AmeriVet's package, there is one dental plan, so the decision is usually whether to add it, not which dental plan to choose`,
    ``,
    `If you want, I can also help you decide whether dental or vision is the more useful routine-care add-on for your household.`,
  ].join('\n');
}

function buildDentalOnlyOptionReply(): string {
  return [
    `Yes — there is one dental plan in AmeriVet's package, which is **BCBSTX Dental PPO**.`,
    ``,
    `So the practical decision is usually whether to add it for your household, not which dental plan to choose.`,
    ``,
    `If you want, I can help you think through whether dental is worth adding at all.`,
  ].join('\n');
}

function isOnlyOptionQuestion(query: string): boolean {
  return /\b(is\s+that\s+the\s+only\s+(?:option|one)|that'?s\s+the\s+only\s+one|only\s+option|any\s+other\s+options|is\s+there\s+only\s+one|only\s+one\s+(?:vision|dental)\s+plan|alternate\s+(?:vision|dental)\s+plan|another\s+(?:vision|dental)\s+plan|other\s+(?:vision|dental)\s+plan)\b/i.test(stripAffirmationLeadIn(query.trim()).toLowerCase());
}

function shouldHandleSupplementalFitFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return isSimpleAffirmation(query)
    || /\b(worth\s+considering|is\s+it\s+worth|worth\s+adding|should\s+i\s+get|should\s+i\s+add|do\s+i\s+need\s+it|when\s+would\s+i\s+want|tell\s+me\s+more|help\s+me\s+think\s+through|how\s+do\s+i\s+know|how\s+can\s+i\s+tell)\b/i.test(lower);
}

function isRepeatedSupplementalWorthQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(how\s+do\s+i\s+know|how\s+can\s+i\s+tell|worth\s+adding|worth\s+it|should\s+i\s+get|should\s+i\s+add)\b/i.test(lower);
}

function lastMessageHasSupplementalFitSetup(lastBotMessage?: string | null): boolean {
  const lower = (lastBotMessage || '').toLowerCase();
  return /usually worth considering when one of these sounds true|usually worth considering when you want extra cash support|usually worth considering if missing part of your paycheck|a supplemental benefit is usually worth considering when you already have your core medical decision in place|people usually give it more attention when|people usually prioritize it when|my practical take is that|plain-language difference between accident\/ad&d and critical illness/i.test(lower);
}

function benefitTopicFromQuery(query: string): string | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const declinedDental = isDeclinedRoutineTopic(lower, 'dental');
  const declinedVision = isDeclinedRoutineTopic(lower, 'vision');
  if (/\b(all\s+benefits|benefits\s+overview|what\s+are\s+all\s+the\s+benefits|what\s+benefits\s+do\s+i\s+have|other\s+types?\s+of\s+coverage|what\s+other\s+coverage|other\s+coverage\s+available|what\s+else\s+is\s+available)\b/i.test(lower)) return 'Benefits Overview';
  if (/\b(life(?:\s+insurance)?|term\s+life|whole\s+life|basic\s+life)\b/i.test(lower)) return 'Life Insurance';
  if (/\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower)) return 'Disability';
  if (/\bcritical(?:\s+illness)?\b/i.test(lower)) return 'Critical Illness';
  if (/\b(accident|ad&d|ad\/d)\b/i.test(lower)) return 'Accident/AD&D';
  if (/\b(hsa(?:\s*\/\s*fsa)?|fsa)\b/i.test(lower)) return 'HSA/FSA';
  if (!declinedDental && /\bdental\b/i.test(lower)) return 'Dental';
  if (!declinedVision && /\b(vision|eye|glasses|contacts|lasik)\b/i.test(lower)) return 'Vision';
  if (/\b(medical|health|hsa\s+plan|kaiser|hmo|ppo|standard\s+hsa|enhanced\s+hsa)\b/i.test(lower)) return 'Medical';
  if (/\b(coverage\s+tier|coverage\s+tiers|plan\s+tradeoffs?|tradeoffs?|maternity|pregnan\w*|prenatal|postnatal|delivery|prescriptions?|generic\s+rx|brand\s+rx|specialty\s+rx|in[- ]network|out[- ]of[- ]network|standard\s+plan|enhanced\s+plan|kaiser\s+plan)\b/i.test(lower)) return 'Medical';
  return null;
}

function isLiveSupportRequest(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(talk\s+to\s+(?:a\s+)?human|talk\s+to\s+(?:a\s+)?real\s+person|talk\s+to\s+someone|speak\s+with\s+someone|speak\s+to\s+someone|real\s+person|human\s+support|live\s+support|someone\s+directly|person\s+directly)\b/i.test(lower);
}

function buildDirectSupportReply(session: Session, query: string): string | null {
  if (isLiveSupportRequest(query)) {
    return buildLiveSupportMessage(session, HR_PHONE, ENROLLMENT_PORTAL_URL);
  }

  return checkL1FAQ(query, {
    enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
    hrPhone: HR_PHONE,
  });
}

function inferTopicFromLastBotMessage(lastBotMessage?: string | null): string | null {
  const lower = (lastBotMessage || '').toLowerCase();
  if (!lower) return null;
  if (/medical plan options|recommendation for .* coverage|projected healthcare costs|standard hsa|enhanced hsa|kaiser standard hmo/.test(lower)) return 'Medical';
  if (/dental coverage:\s*\*\*bcbstx dental ppo\*\*|orthodontia rider/.test(lower)) return 'Dental';
  if (/vision coverage:\s*\*\*vsp vision plus\*\*|glasses|contacts|eye exams?/.test(lower)) return 'Vision';
  if (/life insurance options|unum basic life|whole life|voluntary term life/.test(lower)) return 'Life Insurance';
  if (/disability coverage|short-term disability|long-term disability/.test(lower)) return 'Disability';
  if (/accident\/ad&d coverage|accident\/ad&d is usually worth considering|accident\/ad&d versus critical illness/.test(lower)) return 'Accident/AD&D';
  if (/critical illness coverage|what critical illness is not|critical illness is usually worth considering|plain-language difference between accident\/ad&d and critical illness/.test(lower)) return 'Critical Illness';
  if (/hsa\/fsa overview|health savings account|flexible spending account/.test(lower)) return 'HSA/FSA';
  return null;
}

function comparisonKindFromTopics(topicA?: string | null, topicB?: string | null): 'dental_vs_vision' | 'life_vs_disability' | 'accident_vs_critical' | null {
  const pair = [topicA, topicB].filter(Boolean).sort().join('|');
  if (pair === ['Dental', 'Vision'].sort().join('|')) return 'dental_vs_vision';
  if (pair === ['Life Insurance', 'Disability'].sort().join('|')) return 'life_vs_disability';
  if (pair === ['Accident/AD&D', 'Critical Illness'].sort().join('|')) return 'accident_vs_critical';
  return null;
}

function detectContextualComparisonKind(session: Session, query: string): 'dental_vs_vision' | 'life_vs_disability' | 'accident_vs_critical' | null {
  const lower = query.toLowerCase();
  if (!/\b(more important|matters more|which one first|which matters more|better than|more worth adding|worth adding first)\b/i.test(lower)) {
    return null;
  }

  const current = session.currentTopic || null;
  const mentioned = benefitTopicFromQuery(query);
  return comparisonKindFromTopics(current, mentioned);
}

function extractAge(message: string): number | null {
  const match = message.match(/\b(1[8-9]|[2-9][0-9])\b/);
  return match ? Number(match[1]) : null;
}

function extractCorrectionLead(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  return trimmed.match(/\b(?:actually|sorry|correction)\b[\s,:-]*(.+)$/i)?.[1]
    ?? trimmed.match(/\b(?:i\s+meant|meant)\b[\s,:-]*(.+)$/i)?.[1]
    ?? null;
}

function extractState(message: string): string | null {
  const lower = message.toLowerCase();
  const normalized = message.trim().toLowerCase().replace(/[.!?]+$/g, '');

  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE).sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(lower)) return code;
  }

  const ageThenState = message.match(/\b(1[8-9]|[2-9][0-9])\b(?:\s*,\s*|\s*\/\s*|\s*-\s*)(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i);
  if (ageThenState) return ageThenState[2].toUpperCase();

  const exactAgeState = message.match(/^\s*(?:ok(?:ay)?\b[\s,-]*)?(?:i'?m\s*)?(1[8-9]|[2-9][0-9])\s+(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s*$/i);
  if (exactAgeState) return exactAgeState[2].toUpperCase();

  const locationCueMatch = message.match(/\b(?:in|from|live in|located in|state is|i'm in|i am in)\s+(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i);
  if (locationCueMatch) return locationCueMatch[1].toUpperCase();

  if (normalized === 'ok' || normalized === 'okay') {
    return null;
  }

  const exactStateOnly = message.match(/^\s*(?:ok(?:ay)?\b[\s,-]*)?(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s*$/i);
  if (exactStateOnly) return exactStateOnly[1].toUpperCase();

  return null;
}

function detectExplicitNameCorrection(query: string, currentName?: string | null): string | null {
  if (!currentName) return null;
  if (extractAge(query) || extractState(query) || benefitTopicFromQuery(query)) return null;
  if (!/^(?:actually[, ]+)?(?:my name is|i'?m called|i am called|i'?m|i am|call me)\s+/i.test(query.trim())) return null;

  const detectedName = extractName(query);
  if (!detectedName) return null;
  if (detectedName.toLowerCase() === currentName.trim().toLowerCase()) return null;
  return detectedName;
}

function detectExplicitAgeCorrection(query: string, currentAge?: number | null): number | null {
  if (typeof currentAge !== 'number') return null;

  const age = extractAge(query);
  if (!age || age === currentAge) return null;

  const correctionLead = extractCorrectionLead(query);
  const normalized = stripAffirmationLeadIn(query.trim());
  const ageOnly = /^(?:i'?m|i am)?\s*(1[8-9]|[2-9][0-9])$/i.test(normalized);

  if (!correctionLead && !ageOnly) return null;

  return age;
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

function isStateOnlyMessage(query: string): boolean {
  return Boolean(extractState(query)) && !extractAge(query) && !benefitTopicFromQuery(query);
}

function buildStateOnlyReply(session: Session, priorState: string | null | undefined, query: string): string | null {
  const extractedState = extractState(query);
  if (!extractedState || extractAge(query) || benefitTopicFromQuery(query)) return null;

  if (!priorState) {
    if (session.userAge) {
      return buildBenefitsOverviewReply(session, { onboarding: true });
    }
    return null;
  }

  if (priorState === extractedState) {
    return `I have you in ${extractedState}, and I’ll keep using that for any state-specific guidance.`;
  }

  if (session.currentTopic === 'Medical') {
    return `Thanks — I’ve updated your state to ${extractedState}. Here’s the refreshed medical view:\n\n${buildTopicReply(session, 'Medical', 'medical options')}`;
  }

  if (session.currentTopic) {
    return `Thanks — I’ve updated your state to ${extractedState}. That doesn’t materially change the ${session.currentTopic.toLowerCase()} options I just showed, but I’ll use ${extractedState} for any state-specific guidance going forward.`;
  }

  return `Thanks — I’ve updated your state to ${extractedState}.\n\n${buildBenefitsLineupPrompt(session)}`;
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
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(calculate|estimate|estimated|project(?:ed)?|model)\b[^.?!]{0,50}\b(cost|costs|expense|expenses)\b|\bcompare\b[^.?!]{0,40}\b(cost|costs|expense|expenses)\b|\bhealthcare\s+costs?\b|\bestimate\s+likely\s+costs?\b|\bwhat\s+(?:are|would\s+be)\s+the\s+costs?\b[^.?!]{0,60}\b(plan|plans|medical|kaiser|hsa|hmo|ppo|employee\s*\+|spouse|family|kids?|children|household)\b|\bwhat\s+would\s+i\s+pay\b[^.?!]{0,60}\b(plan|plans|medical|kaiser|hsa|hmo|ppo)\b|\busage\s+level\s+is\b|\b(low|moderate|high)\s+usage\b/i.test(lower);
}

function isMedicalPregnancySignal(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(my wife is pregnant|i'?m pregnant|we(?:'re| are) expecting|pregnant|maternity|prenatal|postnatal|delivery|baby|birth)\b/i.test(lower);
}

function usageLevelFromQuery(query: string): 'low' | 'moderate' | 'high' {
  const lower = query.toLowerCase();
  if (/\bhigh\s+usage\b|\bhigh\s+utilization\b|\busage\s+level\s+is\s+high\b|\bfrequent\b|\bongoing\b/i.test(lower)) return 'high';
  if (/\bmoderate\s+usage\b|\bmoderate\s+utilization\b|\busage\s+level\s+is\s+moderate\b/i.test(lower)) return 'moderate';
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

function coverageTierFromConversation(session: Session): string | null {
  if (session.coverageTierLock) return session.coverageTierLock;

  const assistantMessages = (session.messages || [])
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n');

  const match = assistantMessages.match(/Recommendation for (Employee Only|Employee \+ Spouse|Employee \+ Child\(ren\)|Employee \+ Family) coverage/i);
  return match ? match[1] : null;
}

function isOrthodontiaBracesFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(braces|orthodontic|orthodontia|out[- ]of[- ]pocket|what\s+that\s+means)\b/i.test(lower);
}

function buildBenefitsOverviewReply(session: Session, options?: { contextual?: boolean; onboarding?: boolean }): string {
  const contextual = options?.contextual || false;
  const onboarding = options?.onboarding || false;
  const intro = hasDemographics(session)
    ? onboarding
      ? `Perfect! ${session.userAge} in ${session.userState}.`
      : contextual
      ? `Here are the other benefit areas available to you as an AmeriVet employee:`
      : `Perfect! ${session.userAge} in ${session.userState}.`
    : 'Here is the AmeriVet benefits lineup:';
  return `${intro}\n\n${buildAllBenefitsMenu()}\n\nWhat would you like to explore first?`;
}

function isBenefitsOverviewQuestion(query: string): boolean {
  return /\b(all\s+benefits|benefits\s+overview|what\s+are\s+all\s+the\s+benefits|what\s+benefits\s+do\s+i\s+have|other\s+types?\s+of\s+coverage|what\s+other\s+coverage|other\s+coverage\s+available|what\s+else\s+is\s+available|other\s+benefit\s+options|other\s+benefits?|all\s+my\s+options|top\s+to\s+bottom)\b/i
    .test(stripAffirmationLeadIn(query.trim()).toLowerCase());
}

function isContextualBenefitsOverviewQuestion(query: string): boolean {
  return /\b(other\s+types?\s+of\s+coverage|what\s+other\s+coverage|other\s+coverage\s+available|what\s+else\s+is\s+available|other\s+benefit\s+options|other\s+benefits?|all\s+my\s+options|top\s+to\s+bottom)\b/i
    .test(stripAffirmationLeadIn(query.trim()).toLowerCase());
}

function isMedicalCoverageTierQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (
    isCostModelRequest(query)
    || isMedicalPremiumReplayQuestion(query)
    || /\b(compare|show\s+me|what\s+are|what\s+would)\b[^.?!]{0,40}\b(cost|costs|pricing|premium|premiums)\b/i.test(lower)
  ) {
    return false;
  }
  return /\b(coverage\s+tier|coverage\s+tiers|what'?s\s+a\s+coverage\s+tier|what\s+are\s+the\s+tiers?|which\s+tier|compare\s+tiers?|employee\s*\+\s*spouse|employee\s*\+\s*family|employee\s*\+\s*child(?:ren)?|family\s+plan|spouse\s+plan|child(?:ren)?\s+plan|family\s+one|spouse\s+one|when\s+i\s+select\s+my\s+plan)\b/i.test(lower);
}

function buildMedicalCoverageTierDecisionReply(session: Session, query: string): string {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const mentionsFutureBaby = /\b(baby|pregnan|expecting|due|birth|next\s+year|next\s+feb)\b/i.test(lower);
  const hasSpouse = /\b(spouse|wife|husband|partner)\b/i.test(lower) || !!session.familyDetails?.hasSpouse;
  const asksCompare = /\b(compare\s+tiers?|what\s+are\s+the\s+tiers?)\b/i.test(lower);
  const likelyTier = getCoverageTierForQuery(query, session);

  if (hasSpouse && mentionsFutureBaby) {
    return [
      `If it is just you and your spouse on the plan right now, I would usually enroll as **Employee + Spouse** for now.`,
      ``,
      `Then once the baby is born, birth is a qualifying life event, so you can move to **Employee + Family** and add the baby in Workday.`,
      ``,
      `So the practical answer is: **Employee + Spouse now, then Employee + Family after the baby arrives.**`,
      ``,
      `If you want, I can also recommend which medical plan makes the most sense for that spouse-plus-baby situation.`,
    ].join('\n');
  }

  const lines = [
    `A coverage tier is the level of people you are enrolling, which changes both who is covered and what you pay.`,
    ``,
    `AmeriVet's medical tiers are:`,
    `- Employee Only`,
    `- Employee + Spouse`,
    `- Employee + Child(ren)`,
    `- Employee + Family`,
  ];

  if (likelyTier !== 'Employee Only') {
    lines.push(``, `Based on what you have shared so far, the most likely tier is **${likelyTier}**.`);
  }

  lines.push(
    ``,
    asksCompare
      ? `The practical difference is that premiums rise as you move from Employee Only to the broader household tiers. If you want, I can show the actual medical premiums across those tiers next.`
      : `If you tell me who you need covered right now, I can point you to the most likely tier and then compare the medical plans inside that tier.`,
  );

  return lines.join('\n');
}

function buildTopicReply(session: Session, topic: string, query: string): string {
  clearPendingGuidance(session);

  if (topic === 'Benefits Overview') {
    return buildBenefitsOverviewReply(session, { contextual: isContextualBenefitsOverviewQuestion(query) });
  }

  if (topic === 'Medical') {
    refreshCoverageTierLock(session, query);
    if (isCostModelRequest(query)) {
      const projectionParams: Parameters<typeof pricingUtils.estimateCostProjection>[0] = {
        coverageTier: session.coverageTierLock || coverageTierFromConversation(session) || 'Employee Only',
        usage: usageLevelFromQuery(query),
        network: normalizeNetworkPreference(query),
      };
      if (session.userState) projectionParams.state = session.userState;
      if (typeof session.userAge === 'number') projectionParams.age = session.userAge;
      return pricingUtils.estimateCostProjection(projectionParams);
    }
    if (isMedicalAccumulatorComparisonQuestion(query)) {
      const detailedAnswer = buildMedicalPlanDetailAnswer(query, session);
      if (detailedAnswer) return detailedAnswer;
    }
    if (isMedicalWorthPremiumQuestion(query)) {
      return buildMedicalWorthExtraPremiumReply(session);
    }
    if (isDirectMedicalRecommendationQuestion(query)) {
      const recommendation = buildRecommendationOverview(query, session);
      if (recommendation) return recommendation;
    }
    const detailedAnswer = buildMedicalPlanDetailAnswer(query, session);
    if (detailedAnswer) return detailedAnswer;
    const medicalFallback = buildMedicalPlanFallback(query, session);
    if (medicalFallback) return medicalFallback;

    const recommendation = buildRecommendationOverview(query, session);
    if (recommendation) return recommendation;
  }

  if (topic === 'HSA/FSA') {
    const lower = query.toLowerCase();
    const practicalFitReply = buildHsaFsaPracticalFitReply(session, query);
    if (practicalFitReply) {
      return practicalFitReply;
    }
    if (isHsaFsaCompatibilityQuestion(query)) {
      return buildHsaFsaCompatibilityReply(query);
    }
    if (/\bwhat\s+does\s+hsa\s+mean\b|\bwhat\s+is\s+an?\s+hsa\b/.test(lower)) {
      return `HSA stands for **Health Savings Account**.\n\nIt is a tax-advantaged account you can use for eligible healthcare expenses when you are enrolled in an HSA-qualified medical plan like AmeriVet's **Standard HSA** or **Enhanced HSA**.\n\nThe short version is:\n- You contribute pre-tax money\n- The money can be used for eligible medical expenses\n- Unused funds roll over year to year\n- The account stays with you`;
    }
    if (/\bwhat\s+does\s+fsa\s+mean\b|\bwhat\s+is\s+an?\s+fsa\b/.test(lower)) {
      return `FSA stands for **Flexible Spending Account**.\n\nIt lets you set aside pre-tax dollars for eligible healthcare expenses, but it follows different rollover and ownership rules than an HSA.\n\nThe short version is:\n- Contributions come out pre-tax\n- It can be used for eligible healthcare expenses\n- It is generally tied to the employer plan year\n- Unused funds usually have stricter rollover rules than an HSA`;
    }
  }

  if (topic === 'Dental' || topic === 'Vision') {
    if (isOnlyOptionQuestion(query)) {
      return topic === 'Vision' ? buildVisionOnlyOptionReply() : buildDentalOnlyOptionReply();
    }
    if (isWorthAddingFollowup(query)) {
      return topic === 'Vision' ? buildVisionWorthAddingReply() : buildDentalWorthAddingReply();
    }
    const detailedAnswer = buildRoutineBenefitDetailAnswer(topic, query, session);
    if (detailedAnswer) return detailedAnswer;
  }

  if (topic === 'Life Insurance' || topic === 'Disability' || topic === 'Critical Illness' || topic === 'Accident/AD&D') {
    if (/\b(should\s+i\s+get|should\s+i\s+add|do\s+you\s+recommend|would\s+you\s+recommend|worth\s+it|worth\s+adding|with\s+my\s+situation|for\s+my\s+family|for\s+our\s+family|sole\s+bread[- ]?winner|only\s+income|bread[- ]?winner)\b/i.test(query.toLowerCase())) {
      const recommendation = buildSupplementalRecommendationReply(topic, session, query);
      if (recommendation) return recommendation;
    }
    const detailedAnswer = buildNonMedicalDetailAnswer(topic, query, session);
    if (detailedAnswer) {
      if (topic === 'Accident/AD&D' || topic === 'Critical Illness' || topic === 'Disability' || topic === 'Life Insurance') {
        setPendingGuidance(session, 'supplemental_fit', topic);
      }
      return detailedAnswer;
    }
  }

  const categoryResponse = buildCategoryExplorationResponse({
    queryLower: query.toLowerCase(),
    session,
    coverageTier: getCoverageTierForQuery(query, session),
    enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
    hrPhone: HR_PHONE,
  });

  if (categoryResponse) {
    if (topic === 'Dental' && !(session.completedTopics || []).includes('Vision')) {
      setPendingTopicSuggestion(session, 'Vision');
    } else if (topic === 'Vision' && !(session.completedTopics || []).includes('Dental')) {
      setPendingTopicSuggestion(session, 'Dental');
    } else if (topic === 'Life Insurance') {
      setPendingTopicSuggestion(session, 'Disability');
    } else if (topic === 'Disability') {
      setPendingTopicSuggestion(session, 'Life Insurance');
    } else {
      delete session.pendingTopicSuggestion;
    }

    if (topic === 'HSA/FSA' && /better fit versus an FSA for your situation/i.test(categoryResponse)) {
      session.pendingGuidancePrompt = 'hsa_vs_fsa';
      session.pendingGuidanceTopic = 'HSA/FSA';
    }
    if ((topic === 'Accident/AD&D' || topic === 'Critical Illness' || topic === 'Disability')
      && /worth considering for your situation/i.test(categoryResponse)) {
      session.pendingGuidancePrompt = 'supplemental_fit';
      session.pendingGuidanceTopic = topic;
    }
    return categoryResponse;
  }

  return `I can help with ${topic.toLowerCase()}, but I want to keep it grounded in the AmeriVet benefits package. Please ask that one a little more specifically and I’ll answer directly.`;
}

function buildContextualFallback(session: Session): string {
  if (session.currentTopic === 'Medical') {
    return [
      `We can stay with medical. The most useful next step is usually one of these:`,
      ``,
      `- Compare the plan tradeoff`,
      `- Estimate likely costs`,
      `- Talk through why one option fits better for your situation`,
    ].join('\n');
  }

  if (session.currentTopic === 'Dental') {
    return [
      `We can stay with dental. The most useful next step is usually one of these:`,
      ``,
      `- Whether the plan is worth adding`,
      `- What orthodontia means in practice`,
      `- Whether dental matters more than vision for your household`,
    ].join('\n');
  }

  if (session.currentTopic === 'Vision') {
    return [
      `We can stay with vision. The most useful next step is usually one of these:`,
      ``,
      `- Whether it is worth adding for your household`,
      `- Whether vision matters more than dental based on expected use`,
    ].join('\n');
  }

  if (session.currentTopic === 'Life Insurance') {
    return [
      `We can stay with life insurance. The most useful next step is usually one of these:`,
      ``,
      `- Whether life or disability matters more first`,
      `- How much protection is worth paying for if your family relies on your income`,
    ].join('\n');
  }

  if (session.currentTopic === 'Disability') {
    return [
      `We can stay with disability. The most useful next step is usually one of these:`,
      ``,
      `- Whether disability or life insurance deserves priority`,
      `- Whether paycheck protection is worth adding for your household`,
    ].join('\n');
  }

  if (session.currentTopic === 'Accident/AD&D' || session.currentTopic === 'Critical Illness') {
    return [
      `We can stay with supplemental protection. The most useful next step is usually one of these:`,
      ``,
      `- Whether this is worth adding at all`,
      `- How it compares with the other supplemental options`,
    ].join('\n');
  }

  if (session.currentTopic === 'HSA/FSA') {
    return [
      `We can stay with HSA/FSA. The most useful next step is usually one of these:`,
      ``,
      `- When HSA fits better`,
      `- When FSA fits better`,
      `- What the tax and rollover tradeoff means in practice`,
    ].join('\n');
  }

  return `I can help you narrow this down. The usual starting points are medical if you are choosing core coverage, dental or vision for routine care, or life and disability if family protection matters more than everyday care.`;
}

function inferSupplementalTopicForFollowup(session: Session, query: string): 'Life Insurance' | 'Disability' | 'Critical Illness' | 'Accident/AD&D' | null {
  const explicit = benefitTopicFromQuery(query);
  if (explicit === 'Life Insurance' || explicit === 'Disability' || explicit === 'Critical Illness' || explicit === 'Accident/AD&D') {
    return explicit;
  }

  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const anaphoricFollowup = /\b(it|that|this)\b/i.test(lower) || /\bwhat\s+is\s+it\s+not\b|\bwhat\s+is\s+it\s+for\b|\bdo\s+you\s+recommend\b|\bshould\s+i\s+get\s+it\b|\bwhat\s+would\s+you\s+recommend\b/i.test(lower);
  const pending = session.pendingGuidanceTopic;
  if (
    anaphoricFollowup
    && (pending === 'Life Insurance' || pending === 'Disability' || pending === 'Critical Illness' || pending === 'Accident/AD&D')
  ) {
    return pending;
  }

  const current = session.currentTopic;
  const inferred = inferTopicFromLastBotMessage(session.lastBotMessage);
  if (
    anaphoricFollowup
    && current
    && inferred
    && current !== inferred
    && (current === 'Life Insurance' || current === 'Disability' || current === 'Critical Illness' || current === 'Accident/AD&D')
    && (inferred === 'Life Insurance' || inferred === 'Disability' || inferred === 'Critical Illness' || inferred === 'Accident/AD&D')
  ) {
    return inferred;
  }
  if (current === 'Life Insurance' || current === 'Disability' || current === 'Critical Illness' || current === 'Accident/AD&D') {
    return current;
  }
  if (
    anaphoricFollowup
    && (inferred === 'Life Insurance' || inferred === 'Disability' || inferred === 'Critical Illness' || inferred === 'Accident/AD&D')
  ) {
    return inferred;
  }
  if (inferred === 'Life Insurance' || inferred === 'Disability' || inferred === 'Critical Illness' || inferred === 'Accident/AD&D') {
    return inferred;
  }

  return null;
}

function buildSupplementalRecommendationReply(topic: string, session: Session, query: string): string | null {
  const lower = query.toLowerCase();
  const userHistory = (session.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content.toLowerCase())
    .join(' ');
  const combined = `${userHistory}\n${lower}`;
  const normalizedCombined = combined.replace(/[^a-z0-9]+/gi, ' ');
  const soleBreadwinner = /\b(sole\s+bread\s*winner|breadwinner|only\s+income|sole\s+provider|only\s+provider|husband\s+doesn\s*t\s+work|spouse\s+doesn\s*t\s+work|family\s+relies\s+on\s+my\s+income|rely\s+on\s+my\s+income)\b/i.test(normalizedCombined);
  const familyContext = /\b(spouse|partner|kids?|children|family|household)\b/i.test(combined);
  const standardPlanContext = /\bstandard hsa|standard plan\b/i.test(combined) || /Standard HSA/i.test(session.selectedPlan || '');

  if (topic === 'Critical Illness') {
    if (soleBreadwinner) {
      return [
        `**My practical take:** I would usually **not** make critical illness the first extra add-on if you are the sole breadwinner.`,
        ``,
        `Why:`,
        `- I would usually prioritize the core medical decision first`,
        `- Then disability or life if income protection is the bigger household risk`,
        `- I would only add critical illness after that if you want an extra diagnosis-triggered cash buffer on top of the core package`,
        ``,
        standardPlanContext
          ? `Because you are already leaning toward the lower-premium Standard HSA, I would be especially careful about adding supplemental payroll deductions before I am confident the household has the right core medical and income protection in place. So if you are asking me directly, my answer is usually **not yet**.`
          : `So my recommendation is: treat critical illness as optional extra protection, not the first must-have decision for this household.`,
      ].join('\n');
    }

    if (standardPlanContext && familyContext) {
      return [
        `**My practical take:** critical illness is usually **not** the first add-on I would tighten up when you are already leaning toward Standard HSA for the household.`,
        ``,
        `Why:`,
        `- I would usually go medical first`,
        `- Then look at life or disability if income protection matters more for the household`,
        `- Critical illness becomes more reasonable after that if you specifically want extra diagnosis-triggered cash support`,
        ``,
        `So if you are asking me directly, my answer is usually **not yet**.`,
      ].join('\n');
    }

    return [
      `**My practical take:** critical illness is worth adding **only if** you want extra diagnosis-triggered cash support on top of your medical plan.`,
      ``,
      `Why:`,
      `- I would usually say yes when a household would feel real stress from travel, childcare, or other non-medical bills during a serious diagnosis`,
      `- I would usually say no when the main concern is just routine care costs or when the household has bigger priorities like choosing the right medical plan first`,
      ``,
      familyContext
        ? `Since you are asking in a family context, I would usually put medical first, then life or disability if income protection matters, and critical illness after that if you still want extra diagnosis protection. So if you are asking me directly, my answer is usually **only after** the bigger household-protection choices are settled.`
        : `So I see critical illness as a later-layer protection decision, not one of the first core choices.`,
    ].join('\n');
  }

  if (topic === 'Accident/AD&D') {
    return [
      `**My practical take:** I would only add Accident/AD&D if the household feels meaningfully exposed to injury risk and you want extra cash support after a covered accident.`,
      ``,
      `Why:`,
      `- If the bigger concern is diagnosis risk, I would usually look at critical illness first`,
      `- If the bigger concern is income protection, I would usually look at disability or life first`,
      ``,
      `So if you are asking me directly, my answer is usually **yes only when** injury risk feels like the real gap you are trying to protect.`,
    ].join('\n');
  }

  if (topic === 'Disability') {
    return [
      `**My practical take:** disability is often worth adding sooner than people expect if your household depends on your paycheck.`,
      ``,
      `Why:`,
      `- If missing part of your income would create a real problem, disability usually deserves more attention than smaller supplemental cash benefits`,
      ``,
      `So if you are asking me directly, my answer is usually **yes** when your paycheck is carrying the household.`,
    ].join('\n');
  }

  if (topic === 'Life Insurance') {
    return [
      `**My practical take:** life insurance is usually worth tightening up if other people rely on your income and would need support if something happened to you.`,
      ``,
      `Why:`,
      `- I would usually treat that as a more important household-protection decision than smaller supplemental add-ons`,
      ``,
      `So if you are asking me directly, my answer is usually **yes** when other people depend on your income.`,
    ].join('\n');
  }

  return null;
}

function isSupplementalRecommendationQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(should\s+i\s+get|should\s+i\s+add|do\s+you\s+recommend|would\s+you\s+recommend|so\s+should\s+i\s+get\s+it|so\s+should\s+i\s+add\s+it|with\s+my\s+situation|for\s+my\s+family|for\s+our\s+family|sole\s+bread[- ]?winner|only\s+income|bread[- ]?winner|what\s+would\s+you\s+recommend|what\s+do\s+you\s+recommend)\b/i.test(lower);
}

function isFamilySpecificFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(what about|how about|for)\s+((my|our|the)\s+)?(kids|children|family|household)\b/i.test(lower)
    || /\b(what about|how about|for)\s+((my|our)\s+)?(spouse|partner)\b/i.test(lower)
    || /\b(my|our|the)\s+(kids|children|family|household)\b/i.test(lower)
    || /\bmy spouse\b|\bour spouse\b|\bmy partner\b|\bour partner\b/i.test(lower)
    || /\b(kids|children|family|household|spouse|partner)\s+then\b/i.test(lower)
    || /\bwe mostly care about (the kids|our kids|our family|the family|our household)\b/i.test(lower);
}

function buildContinuationReply(session: Session, query: string): string | null {
  const normalizedQuery = normalizeContinuationQuery(query);
  const lower = normalizedQuery.toLowerCase();
  const activeTopic = session.currentTopic || inferTopicFromLastBotMessage(session.lastBotMessage);
  const explicitTopic = benefitTopicFromQuery(normalizedQuery);
  const inferredSupplementalTopic = inferSupplementalTopicForFollowup(session, normalizedQuery);
  const focus = detectBenefitPriorityFocus(normalizedQuery);
  const hsaFitFocus = detectHsaFitFocus(normalizedQuery);
  const supplementalComparisonFocus = detectSupplementalComparisonFocus(normalizedQuery);
  const lastBotMessage = session.lastBotMessage || '';
  const assistantHistory = (session.messages || [])
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content);
  const hasMedicalRecommendationInHistory = assistantHistory.some((content) => /My recommendation:\s*/i.test(content));
  const wantsWhy = /\bwhy\b|\bwhy that\b|\bwhy is that\b/i.test(lower);
  const wantsPracticalTake = /\bwhat would you do\b|\bwhich would you pick\b|\bwhat'?s your practical take\b|\bwhich one would you choose\b|\bwhich one would you pick\b/i.test(lower);
  const wantsWorthPremium = isMedicalWorthPremiumQuestion(normalizedQuery);
  const wantsDecisionReason = /\bwhy would i pick that\b|\bwhy pick that\b|\bwhy choose that\b|\bwhy that one\b|\bwhy that one over the other\b|\bwhy that over the other\b/i.test(lower);
  const wantsCheaperOption = /\b(the cheaper one|cheaper one|cheaper option|lower premium one|lower premium option|lowest premium one|lowest premium option)\b/i.test(lower);
  const wantsThatOne = /\b(that one|that plan|that option|the recommended one)\b/i.test(lower);
  const wantsFamilySpecific = isFamilySpecificFollowup(normalizedQuery);
  const contextualComparisonKind = detectContextualComparisonKind(session, normalizedQuery);

  if (isMedicalCoverageTierQuestion(normalizedQuery)) {
    setTopic(session, 'Medical');
    return buildMedicalCoverageTierDecisionReply(session, normalizedQuery);
  }

  if (isSupplementalOverviewQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    return buildSupplementalBenefitsOverviewReply();
  }

  if (isBenefitsOverviewQuestion(normalizedQuery) && isContextualBenefitsOverviewQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    return buildBenefitsOverviewReply(session, { contextual: true });
  }

  const topicOverride = preferredTopicOverride(normalizedQuery);
  if (topicOverride === 'Supplemental') {
    clearPendingGuidance(session);
    return buildSupplementalBenefitsOverviewReply();
  }
  if (topicOverride === 'Vision' || topicOverride === 'Dental') {
    setTopic(session, topicOverride);
    return buildTopicReply(session, topicOverride, canonicalTopicQuery(topicOverride, normalizedQuery));
  }

  if (
    isReturnToMedicalIntent(normalizedQuery)
    && (
      activeTopic === 'HSA/FSA'
      || activeTopic === 'Medical'
      || /hsa\/fsa overview|health savings account|flexible spending account|medical plan options|standard hsa|enhanced hsa|kaiser standard hmo/i.test(lastBotMessage)
    )
  ) {
    setTopic(session, 'Medical');
    return buildTopicReply(session, 'Medical', canonicalTopicQuery('Medical', normalizedQuery));
  }

  if (isHsaFsaCompatibilityQuestion(normalizedQuery)) {
    setTopic(session, 'HSA/FSA');
    return buildTopicReply(session, 'HSA/FSA', normalizedQuery);
  }

  if (explicitTopic && explicitTopic !== 'Benefits Overview') {
    const normalizedExplicitTopic = normalizeBenefitCategory(explicitTopic);
    if (isTopicOverviewQuestion(normalizedQuery) || isShortTopicPivot(normalizedQuery, normalizedExplicitTopic)) {
      setTopic(session, normalizedExplicitTopic);
      return buildTopicReply(session, normalizedExplicitTopic, canonicalTopicQuery(normalizedExplicitTopic, normalizedQuery));
    }
  }

  if (
    activeTopic
    && activeTopic !== 'Benefits Overview'
    && !explicitTopic
    && isTopicOverviewQuestion(normalizedQuery)
  ) {
    if (activeTopic === 'Medical' && /\b(all\s+my\s+options|top\s+to\s+bottom|other\s+benefit\s+options)\b/i.test(lower)) {
      return buildBenefitsOverviewReply(session, { contextual: true });
    }
    setTopic(session, activeTopic);
    return buildTopicReply(session, activeTopic, canonicalTopicQuery(activeTopic, normalizedQuery));
  }

  if (
    explicitTopic
    && explicitTopic !== 'Benefits Overview'
    && explicitTopic !== activeTopic
  ) {
    const normalizedExplicitTopic = normalizeBenefitCategory(explicitTopic);
    const directTopicQuestion =
      normalizedExplicitTopic === 'Medical'
        ? (isDirectMedicalContinuationQuestion(normalizedQuery) || isMedicalPregnancySignal(normalizedQuery))
        : normalizedExplicitTopic === 'Dental' || normalizedExplicitTopic === 'Vision'
          ? (isRoutineBenefitDetailQuestion(normalizedQuery) || isWorthAddingFollowup(normalizedQuery))
          : normalizedExplicitTopic === 'HSA/FSA'
            ? (isHsaFsaCompatibilityQuestion(normalizedQuery) || isDirectHsaFsaFitQuestion(normalizedQuery) || /\bwhat\s+does\s+(hsa|fsa)\s+mean\b|\bwhat\s+is\s+an?\s+(hsa|fsa)\b/i.test(lower))
            : (
              isNonMedicalDetailQuestion(normalizedExplicitTopic, normalizedQuery)
              || isSupplementalRecommendationQuestion(normalizedQuery)
              || isWorthAddingFollowup(normalizedQuery)
            );

    if (directTopicQuestion) {
      setTopic(session, normalizedExplicitTopic);
      return buildTopicReply(session, normalizedExplicitTopic, normalizedQuery);
    }
  }

  if (isLifeFamilyCoverageQuestion(normalizedQuery)) {
    setTopic(session, 'Life Insurance');
    return buildTopicReply(session, 'Life Insurance', normalizedQuery);
  }

  if (
    /(?:want|wanted)\s+to\s+compare\s+(?:those|these)\s+plans|\bcompare\s+(?:those|these)\s+plans\b/i.test(lower)
    && /want to compare plans or switch coverage tiers/i.test(lastBotMessage)
  ) {
    setTopic(session, 'Medical');
    return buildTopicReply(session, 'Medical', 'compare the plan tradeoffs');
  }

  if (
    isDirectMedicalContinuationQuestion(normalizedQuery)
    && /\b(plan|medical|copay|copays|deductible|coinsurance|out[- ]of[- ]pocket|maternity|pregnan|baby|birth|delivery|prenatal|postnatal|kaiser|hsa|hmo|tier|tradeoff|prescription|network)\b/i.test(lower)
  ) {
    setTopic(session, 'Medical');
    return buildTopicReply(session, 'Medical', normalizedQuery);
  }

  if (
    activeTopic === 'Medical'
    && /\b(other\s+than\s+medical|other\s+types?\s+of\s+coverage|what\s+else\s+is\s+available|supplemental\s+benefits?)\b/i.test(lower)
  ) {
    clearPendingGuidance(session);
    if (isSupplementalOverviewQuestion(normalizedQuery)) {
      return buildSupplementalBenefitsOverviewReply();
    }
    return buildBenefitsOverviewReply(session, { contextual: true });
  }

  if (
    (activeTopic === 'Medical' || inferTopicFromLastBotMessage(lastBotMessage) === 'Medical')
    && isDirectMedicalContinuationQuestion(normalizedQuery)
  ) {
    setTopic(session, 'Medical');
    return buildTopicReply(session, 'Medical', normalizedQuery);
  }

  if (
    activeTopic === 'Medical'
    && inferredSupplementalTopic
    && isSupplementalRecommendationQuestion(normalizedQuery)
  ) {
    const recommendation = buildSupplementalRecommendationReply(inferredSupplementalTopic, session, normalizedQuery);
    if (recommendation) {
      setTopic(session, inferredSupplementalTopic);
      return recommendation;
    }
  }

  if (activeTopic === 'HSA/FSA' && (/\bwhat\s+does\s+hsa\s+mean\b|\bwhat\s+is\s+an?\s+hsa\b|\bwhat\s+does\s+fsa\s+mean\b|\bwhat\s+is\s+an?\s+fsa\b/i.test(lower))) {
    return buildTopicReply(session, 'HSA/FSA', normalizedQuery);
  }

  if (
    (activeTopic === 'Life Insurance' || activeTopic === 'Disability')
    && /\b(which\s+matters\s+more|which\s+one\s+first|which\s+matters\s+more\s+first)\b/i.test(lower)
  ) {
    return buildLifeVsDisabilityComparison();
  }

  if (session.pendingGuidancePrompt === 'benefit_decision' && focus) {
    session.pendingGuidancePrompt = 'benefit_decision';
    return buildBenefitDecisionGuidance(session, focus);
  }
  if (session.pendingGuidancePrompt === 'benefit_decision' && wantsFamilySpecific) {
    session.pendingGuidancePrompt = 'benefit_decision';
    return buildBenefitDecisionGuidance(session, 'family_protection');
  }

  if (session.pendingGuidancePrompt === 'orthodontia_braces' && isOrthodontiaBracesFollowup(normalizedQuery)) {
    clearPendingGuidance(session);
    return [
      `For braces, the practical question is not just whether orthodontia exists on the plan, but how much of the cost the plan actually helps with.`,
      ``,
      `With AmeriVet's dental plan:`,
      `- Orthodontic coverage is included instead of excluded outright`,
      `- The orthodontia copay is $500`,
      `- In plain language, orthodontia copay is $500`,
      `- You would still want to confirm waiting periods, age limits, and any orthodontic maximums in Workday before counting on a specific dollar outcome`,
      ``,
      `So the short version is: this plan is more helpful for a household expecting braces than a dental plan with no orthodontic benefit at all, but it still does not mean braces are fully covered.`,
    ].join('\n');
  }

  if (session.pendingGuidancePrompt === 'hsa_vs_fsa') {
    if (hsaFitFocus) {
      clearPendingGuidance(session);
      return buildHsaFitSpecificReply(hsaFitFocus);
    }
    if (isSimpleAffirmation(normalizedQuery) || /\b(hsa|fsa|better fit|which one|long[- ]term savings|near[- ]term medical expenses)\b/i.test(lower)) {
      clearPendingGuidance(session);
      return buildHsaFitGuidance();
    }
  }

  if (session.pendingGuidancePrompt === 'supplemental_fit' && shouldHandleSupplementalFitFollowup(normalizedQuery)) {
    const fitTopic =
      session.pendingGuidanceTopic
      || (session.currentTopic === 'Life Insurance' || session.currentTopic === 'Disability' || session.currentTopic === 'Critical Illness' || session.currentTopic === 'Accident/AD&D'
        ? session.currentTopic
        : inferTopicFromLastBotMessage(lastBotMessage));
    if (
      fitTopic
      && (fitTopic === 'Life Insurance' || fitTopic === 'Disability' || fitTopic === 'Critical Illness' || fitTopic === 'Accident/AD&D')
      && isRepeatedSupplementalWorthQuestion(normalizedQuery)
    ) {
      clearPendingGuidance(session);
      setTopic(session, fitTopic);
      return buildSupplementalPracticalTake(fitTopic);
    }
    clearPendingGuidance(session);
    return buildSupplementalFitGuidance(session, fitTopic);
  }

  if (
    (activeTopic === 'Accident/AD&D' || activeTopic === 'Critical Illness' || activeTopic === 'Disability' || activeTopic === 'Life Insurance'
      || inferredSupplementalTopic === 'Accident/AD&D' || inferredSupplementalTopic === 'Critical Illness' || inferredSupplementalTopic === 'Disability' || inferredSupplementalTopic === 'Life Insurance')
    && shouldHandleSupplementalFitFollowup(normalizedQuery)
    && /worth considering for your situation|usually worth considering when one of these sounds true|usually worth considering when you want extra cash support|usually worth considering if missing part of your paycheck|people usually give it more attention when|people usually prioritize it when/i.test(lastBotMessage)
  ) {
    const fitTopic = inferredSupplementalTopic || activeTopic;
    if (fitTopic === 'Accident/AD&D' || fitTopic === 'Critical Illness' || fitTopic === 'Disability' || fitTopic === 'Life Insurance') {
      if (isRepeatedSupplementalWorthQuestion(normalizedQuery)) {
        setTopic(session, fitTopic);
        return buildSupplementalPracticalTake(fitTopic);
      }
      setTopic(session, fitTopic);
      return buildSupplementalFitGuidance(session, fitTopic);
    }
  }

  if (session.pendingGuidancePrompt === 'accident_vs_critical' && isAffirmativeCompareFollowup(normalizedQuery)) {
    if (/plain-language difference between Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
      return buildSupplementalPracticalTake('Accident/AD&D');
    }
    setPendingGuidance(session, 'accident_vs_critical', 'Accident/AD&D');
    return buildAccidentVsCriticalComparison();
  }
  if (session.pendingGuidancePrompt === 'accident_vs_critical' && supplementalComparisonFocus) {
    clearPendingGuidance(session);
    return buildAccidentVsCriticalFocusedReply(supplementalComparisonFocus);
  }

  if (session.pendingGuidancePrompt === 'life_vs_disability' && isAffirmativeCompareFollowup(normalizedQuery)) {
    clearPendingGuidance(session);
    return buildLifeVsDisabilityComparison();
  }

  if (session.pendingGuidancePrompt === 'dental_vs_vision' && isAffirmativeCompareFollowup(normalizedQuery)) {
    clearPendingGuidance(session);
    return buildDentalVsVisionDecision();
  }

  if (session.pendingGuidancePrompt === 'medical_tradeoff_compare' && isAffirmativeCompareFollowup(normalizedQuery)) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    const projectionParams: Parameters<typeof pricingUtils.estimateCostProjection>[0] = {
      coverageTier: coverageTierFromConversation(session) || session.coverageTierLock || 'Employee Only',
      usage: usageLevelFromSession(session),
    };
    if (session.userState) projectionParams.state = session.userState;
    if (typeof session.userAge === 'number') projectionParams.age = session.userAge;
    return pricingUtils.estimateCostProjection(projectionParams);
  }

  if (contextualComparisonKind) {
    if (contextualComparisonKind === 'dental_vs_vision') {
      return buildDentalVsVisionDecision();
    }
    if (contextualComparisonKind === 'life_vs_disability') {
      return buildLifeVsDisabilityComparison();
    }
    if (contextualComparisonKind === 'accident_vs_critical') {
      setPendingGuidance(session, 'accident_vs_critical', 'Accident/AD&D');
      return buildAccidentVsCriticalComparison();
    }
  }

  if (
    (inferredSupplementalTopic === 'Accident/AD&D'
      || inferredSupplementalTopic === 'Critical Illness'
      || inferredSupplementalTopic === 'Disability'
      || inferredSupplementalTopic === 'Life Insurance')
    && /\b(should\s+i\s+get|should\s+i\s+add|do\s+you\s+recommend|would\s+you\s+recommend|with\s+my\s+situation|for\s+my\s+family|for\s+our\s+family|sole\s+bread[- ]?winner|only\s+income|bread[- ]?winner)\b/i.test(lower)
  ) {
    const recommendation = buildSupplementalRecommendationReply(inferredSupplementalTopic, session, normalizedQuery);
    if (recommendation) {
      setTopic(session, inferredSupplementalTopic);
      return recommendation;
    }
  }

  if (activeTopic === 'Medical' && (hasMedicalRecommendationInHistory || /My recommendation:/i.test(lastBotMessage))) {
    if (isMedicalRecommendationClarificationQuestion(normalizedQuery)) {
      return buildMedicalRecommendationClarificationReply(normalizedQuery);
    }
    if (/\bwhy\b[^.?!]*\b(?:recommend|pick|choose)\b[^.?!]*\bkaiser\b|\bwhy\s+not\s+kaiser\b|\bless\s+out[- ]of[- ]pocket\b[^.?!]*\bkaiser\b/i.test(lower)) {
      return buildWhyNotKaiserReply(session);
    }
    if (wantsPracticalTake || wantsDecisionReason || wantsThatOne) {
      return buildMedicalPracticalTake(session);
    }
    if (wantsCheaperOption) {
      return [
        `If you mean the cheaper option, that is usually **Standard HSA**.`,
        ``,
        `That is the one I would usually keep if the goal is lower monthly premium and you do not expect enough care to justify paying more up front.`,
      ].join('\n');
    }
    if (wantsWorthPremium) {
      return buildMedicalWorthExtraPremiumReply(session);
    }
    if (isMedicalRecommendationPreferenceFollowup(normalizedQuery)) {
      return buildTopicReply(session, 'Medical', normalizedQuery);
    }
    if (isDirectMedicalRecommendationQuestion(normalizedQuery)) {
      return buildTopicReply(session, 'Medical', normalizedQuery);
    }
    if (wantsWhy) {
      return buildMedicalRecommendationWhy(session);
    }
    if (wantsFamilySpecific) {
      return buildMedicalFamilySpecificReply(session, normalizedQuery);
    }
  }

  if (activeTopic === 'Medical' && isMedicalPregnancySignal(normalizedQuery) && !isCostModelRequest(normalizedQuery)) {
    return buildTopicReply(session, 'Medical', /maternity|pregnan|baby|birth|delivery|prenatal|postnatal/i.test(lower) ? normalizedQuery : 'maternity coverage');
  }

  if (activeTopic === 'HSA/FSA' && (isDirectHsaFsaFitQuestion(normalizedQuery) || hsaFitFocus)) {
    return buildTopicReply(session, 'HSA/FSA', normalizedQuery);
  }

  if (activeTopic === 'Vision' && /\bdental\b/i.test(lower) && /\b(recommend|worth|useful|should\s+i\s+add|should\s+i\s+get)\b/i.test(lower)) {
    return buildDentalWorthAddingReply();
  }

  if (activeTopic === 'Dental' && /\bvision\b/i.test(lower) && /\b(recommend|worth|useful|should\s+i\s+add|should\s+i\s+get)\b/i.test(lower)) {
    return buildVisionWorthAddingReply();
  }

  if (
    ((activeTopic === 'Vision' && (session.completedTopics || []).includes('Dental'))
      || (activeTopic === 'Dental' && (session.completedTopics || []).includes('Vision')))
    && (isRoutineCareComparisonPrompt(normalizedQuery)
      || /\b(dental|vision)\b/i.test(lower) && /\b(recommend|get|worth|useful|only\s+option)\b/i.test(lower))
  ) {
    return buildDentalVsVisionDecision();
  }

  if (activeTopic === 'Vision' && isOnlyOptionQuestion(normalizedQuery)) {
    return buildVisionOnlyOptionReply();
  }

  if (activeTopic === 'Vision' && isWorthAddingFollowup(normalizedQuery)) {
    return buildVisionWorthAddingReply();
  }

  if (activeTopic === 'Dental' && isOnlyOptionQuestion(normalizedQuery)) {
    return buildDentalOnlyOptionReply();
  }

  if (activeTopic === 'Dental' && isWorthAddingFollowup(normalizedQuery)) {
    return buildDentalWorthAddingReply();
  }

  if (
    (inferredSupplementalTopic === 'Accident/AD&D' || inferredSupplementalTopic === 'Critical Illness' || inferredSupplementalTopic === 'Disability' || inferredSupplementalTopic === 'Life Insurance')
    && isRepeatedSupplementalWorthQuestion(normalizedQuery)
  ) {
    setTopic(session, inferredSupplementalTopic);
    return buildSupplementalPracticalTake(inferredSupplementalTopic);
  }

  if (
    (activeTopic === 'Accident/AD&D' || activeTopic === 'Critical Illness' || activeTopic === 'Disability' || activeTopic === 'Life Insurance')
    && isRepeatedSupplementalWorthQuestion(normalizedQuery)
  ) {
    setTopic(session, activeTopic);
    return buildSupplementalPracticalTake(activeTopic);
  }

  if ((activeTopic === 'Accident/AD&D' || activeTopic === 'Critical Illness' || activeTopic === 'Disability' || activeTopic === 'Life Insurance') && isWorthAddingFollowup(normalizedQuery)) {
    if (isSupplementalRecommendationQuestion(normalizedQuery)) {
      const recommendation = buildSupplementalRecommendationReply(activeTopic, session, normalizedQuery);
      if (recommendation) {
        setTopic(session, activeTopic);
        return recommendation;
      }
    }
    setTopic(session, activeTopic);
    return buildSupplementalFitGuidance(session, activeTopic);
  }

  if ((inferredSupplementalTopic === 'Accident/AD&D' || inferredSupplementalTopic === 'Critical Illness' || inferredSupplementalTopic === 'Disability' || inferredSupplementalTopic === 'Life Insurance') && isWorthAddingFollowup(normalizedQuery)) {
    if (isSupplementalRecommendationQuestion(normalizedQuery)) {
      const recommendation = buildSupplementalRecommendationReply(inferredSupplementalTopic, session, normalizedQuery);
      if (recommendation) {
        setTopic(session, inferredSupplementalTopic);
        return recommendation;
      }
    }
    setPendingGuidance(session, 'supplemental_fit', inferredSupplementalTopic);
    setTopic(session, inferredSupplementalTopic);
    return buildSupplementalFitGuidance(session, inferredSupplementalTopic);
  }

  if (
    /simplest way to think about HSA versus FSA fit/i.test(lastBotMessage)
  ) {
    if (hsaFitFocus) {
      return buildHsaFitSpecificReply(hsaFitFocus);
    }
  }

  if ((inferredSupplementalTopic === 'Life Insurance' || inferredSupplementalTopic === 'Disability' || inferredSupplementalTopic === 'Critical Illness' || inferredSupplementalTopic === 'Accident/AD&D')
    && isNonMedicalDetailQuestion(inferredSupplementalTopic, normalizedQuery)
    && !(supplementalComparisonFocus && /Accident\/AD&D and Critical Illness/i.test(lastBotMessage))) {
    setTopic(session, inferredSupplementalTopic);
    return buildTopicReply(session, inferredSupplementalTopic, normalizedQuery);
  }

  if (
    /plain-language difference between Accident\/AD&D and Critical Illness/i.test(lastBotMessage)
    || /simplest way to separate life insurance from disability/i.test(lastBotMessage)
    || /deciding between dental and vision as the next add-on/i.test(lastBotMessage)
  ) {
    if (/Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
      const reply = buildWhyNotOtherFirstReply('accident_vs_critical', normalizedQuery);
      if (reply) return reply;
    }
    if (/life insurance from disability/i.test(lastBotMessage)) {
      const reply = buildWhyNotOtherFirstReply('life_vs_disability', normalizedQuery);
      if (reply) return reply;
    }
    if (/dental and vision as the next add-on/i.test(lastBotMessage)) {
      const reply = buildWhyNotOtherFirstReply('dental_vs_vision', normalizedQuery);
      if (reply) return reply;
    }
    if (supplementalComparisonFocus && /Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
      return buildAccidentVsCriticalFocusedReply(supplementalComparisonFocus);
    }
    if (
      wantsPracticalTake
      || wantsDecisionReason
      || wantsThatOne
      || isAffirmativeCompareFollowup(normalizedQuery)
      || /\bwhich matters more\b|\bwhich one is more relevant\b|\bwhich one first\b/i.test(lower)
    ) {
      if (/Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
        return buildSupplementalPracticalTake('Accident/AD&D');
      }
      if (/life insurance from disability/i.test(lastBotMessage)) {
        return buildSupplementalPracticalTake('Disability');
      }
      if (/dental and vision as the next add-on/i.test(lastBotMessage)) {
        return `My practical take is to choose dental first if you already expect fillings, crowns, or orthodontic use, and vision first if the household already knows it will use exams, glasses, or contacts every year. If you do not already know the household will use vision, dental usually has the bigger upside.`;
      }
    }
    if (wantsFamilySpecific) {
      if (/Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
        return buildComparisonFamilyReply('accident_vs_critical', normalizedQuery);
      }
      if (/life insurance from disability/i.test(lastBotMessage)) {
        return buildComparisonFamilyReply('life_vs_disability', normalizedQuery);
      }
      if (/dental and vision as the next add-on/i.test(lastBotMessage)) {
        return buildComparisonFamilyReply('dental_vs_vision', normalizedQuery);
      }
    }
  }

  if (isAffirmativeCompareFollowup(normalizedQuery)) {
    if (/compare accident\/ad&d versus critical illness/i.test(lastBotMessage)) {
      setPendingGuidance(session, 'accident_vs_critical', 'Accident/AD&D');
      return buildAccidentVsCriticalComparison();
    }
    if (/walk you through life versus disability/i.test(lastBotMessage)) {
      return buildLifeVsDisabilityComparison();
    }
    if (/decide whether dental or vision is more worth adding first/i.test(lastBotMessage)) {
      return buildDentalVsVisionDecision();
    }
    if (/I can use that tier to compare the medical plans|show how pricing changes across tiers/i.test(lastBotMessage)) {
      setTopic(session, 'Medical');
      return buildTopicReply(session, 'Medical', 'compare the plan tradeoffs');
    }
    if (
      activeTopic === 'Medical'
      && /\b(compare the plan tradeoff|compare the plan tradeoffs|estimate likely costs|talk through why one option fits better)\b/i.test(lastBotMessage)
    ) {
      setTopic(session, 'Medical');
      return buildTopicReply(session, 'Medical', 'compare the plan tradeoffs');
    }
  }

  if (session.pendingTopicSuggestion && (/\b(yes|yes please|yeah|yep|sure|do that|do this|do it|let'?s do that|let'?s do this|let'?s do it|next one|show me that one)\b/i.test(lower))) {
    const suggestedTopic = session.pendingTopicSuggestion;
    clearPendingGuidance(session);
    setTopic(session, suggestedTopic);
    return buildTopicReply(session, suggestedTopic, `${suggestedTopic} options`);
  }

  if (!activeTopic && !session.pendingGuidancePrompt) return null;

  if (/\b(what'?s\s+next|what\s+is\s+next|where\s+to\s+next|where\s+do\s+we\s+go\s+next|move\s+on|what\s+should\s+we\s+do\s+next)\b/i.test(lower)) {
    return buildPackageGuidance(session, session.currentTopic);
  }

  if (isPackageGuidanceMessage(lower)) {
    return buildPackageGuidance(session, session.currentTopic);
  }

  if (isOtherChoicesMessage(lower)) {
    return buildPackageGuidance(session, session.currentTopic);
  }

  const pivotTopic = benefitTopicFromQuery(normalizedQuery);
  if (pivotTopic && pivotTopic !== 'Benefits Overview' && pivotTopic !== session.currentTopic) {
    setTopic(session, pivotTopic);
    return buildTopicReply(session, pivotTopic, normalizedQuery);
  }

  if (!pivotTopic && session.currentTopic !== 'Critical Illness' && /\billness\b/i.test(lower) && /critical\s+illness/i.test(lastBotMessage)) {
    setTopic(session, 'Critical Illness');
    return buildTopicReply(session, 'Critical Illness', 'critical illness');
  }

  if (
    !pivotTopic
    && /\billness\b/i.test(lower)
    && /(critical illness|accident or critical illness|life insurance, disability, or supplemental)/i.test(lastBotMessage)
  ) {
    setTopic(session, 'Critical Illness');
    return buildTopicReply(session, 'Critical Illness', 'critical illness');
  }

  if (
    activeTopic === 'Medical'
    && !pivotTopic
    && /\billness\b/i.test(lower)
    && !isMedicalDetailQuestion(normalizedQuery)
  ) {
    setTopic(session, 'Critical Illness');
    return buildTopicReply(session, 'Critical Illness', 'critical illness');
  }

  if (activeTopic === 'Medical') {
    if (isCostModelRequest(normalizedQuery)) {
      return buildTopicReply(session, 'Medical', normalizedQuery);
    }
    if (
      /\b(which\s+plan\s+is\s+best\s+for\s+my\s+family|which\s+plan\s+is\s+best|best\s+for\s+my\s+family|best\s+choice\s+for\s+my\s+family|what\s+plan\s+will\s+give\s+us\s+the\s+lowest|lowest\s+out[- ]of[- ]pocket|we'?re\s+also\s+having\s+a\s+baby|my\s+wife\s+is\s+pregnant)\b/i.test(lower)
    ) {
      return buildTopicReply(session, 'Medical', normalizedQuery);
    }
    if (isMedicalDetailQuestion(normalizedQuery)) {
      const detailedAnswer = buildMedicalPlanDetailAnswer(normalizedQuery, session);
      if (detailedAnswer) return detailedAnswer;
      const medicalFallback = buildMedicalPlanFallback(normalizedQuery, session);
      if (medicalFallback) return medicalFallback;
    }
    if (
      (isSimpleAffirmation(normalizedQuery) || /\b(compare|yes)\b/i.test(lower)) &&
      /\blikely\s+total\s+annual\s+cost\b|\bcompare\b.*\bstandard\s+hsa\b.*\benhanced\s+hsa\b/i.test(session.lastBotMessage || '')
    ) {
      const projectionParams: Parameters<typeof pricingUtils.estimateCostProjection>[0] = {
        coverageTier: coverageTierFromConversation(session) || 'Employee Only',
        usage: usageLevelFromSession(session),
      };
      if (session.userState) projectionParams.state = session.userState;
      if (typeof session.userAge === 'number') projectionParams.age = session.userAge;
      return pricingUtils.estimateCostProjection(projectionParams);
    }
    if (/\b(low|moderate|high)\s+usage\b|\bgenerally\s+healthy\b|\blow\s+bills\b/i.test(lower)) {
      const recommendation = buildRecommendationOverview(normalizedQuery, session);
      if (recommendation) return recommendation;
    }
  }

  if (isSimpleAffirmation(normalizedQuery)) {
    return buildPackageGuidance(session, session.currentTopic);
  }

  if (activeTopic === 'Dental' && /\borthodontia\s+rider\b|\brider\b/i.test(lower)) {
    session.pendingGuidancePrompt = 'orthodontia_braces';
    session.pendingGuidanceTopic = 'Dental';
    return `An orthodontia rider means the dental plan includes an added orthodontic benefit instead of excluding braces and related treatment entirely. In practical terms, it is the part of the dental coverage that makes orthodontia available under the plan's rules.\n\nFor AmeriVet's dental plan, that means orthodontic coverage is included rather than being a separate standalone dental plan. If you want, I can explain what that means for braces and out-of-pocket costs next.`;
  }

  return null;
}

function joinHumanList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function buildProfileCorrectionReply(session: Session, query: string): string | null {
  const nameCorrection = detectExplicitNameCorrection(query, session.userName);
  const ageCorrection = detectExplicitAgeCorrection(query, session.userAge);
  const stateCorrection = detectExplicitStateCorrection(query, session.userState);
  if (!nameCorrection && !ageCorrection && !stateCorrection) return null;

  if (nameCorrection) {
    session.userName = nameCorrection;
    session.hasCollectedName = true;
  }
  if (typeof ageCorrection === 'number') session.userAge = ageCorrection;
  if (stateCorrection) session.userState = stateCorrection.state;

  const updatedFields: string[] = [];
  if (nameCorrection) updatedFields.push(`your name to ${nameCorrection}`);
  if (typeof ageCorrection === 'number') updatedFields.push(`your age to ${ageCorrection}`);
  if (stateCorrection) updatedFields.push(`your state to ${stateCorrection.state}`);
  const correctionPrefix = `Thanks for the correction — I’ve updated ${joinHumanList(updatedFields)}.`;

  const detectedTopic = benefitTopicFromQuery(query);
  const normalizedTopic = detectedTopic && detectedTopic !== 'Benefits Overview'
    ? normalizeBenefitCategory(detectedTopic)
    : detectedTopic;

  if (!hasDemographics(session)) {
    return `${correctionPrefix}\n\n${missingDemographicsMessage(session, normalizedTopic)}`;
  }

  if (isCostModelRequest(query)) {
    setTopic(session, 'Medical');
    return `${correctionPrefix}\n\nHere’s the updated cost view:\n\n${buildTopicReply(session, 'Medical', query)}`;
  }

  if (normalizedTopic && normalizedTopic !== 'Benefits Overview') {
    setTopic(session, normalizedTopic);
    return `${correctionPrefix}\n\nHere’s the updated ${normalizedTopic.toLowerCase()} view:\n\n${buildTopicReply(session, normalizedTopic, canonicalTopicQuery(normalizedTopic, query))}`;
  }

  if (!session.currentTopic) {
    return `${correctionPrefix}\n\n${buildBenefitsLineupPrompt(session)}`;
  }

  if (session.currentTopic === 'Medical' && (stateCorrection || typeof ageCorrection === 'number')) {
    return `${correctionPrefix}\n\nHere’s the updated medical view:\n\n${buildTopicReply(session, 'Medical', canonicalTopicQuery('Medical', query))}`;
  }

  if (stateCorrection) {
    return `${correctionPrefix} That does not materially change the ${session.currentTopic.toLowerCase()} options I just showed, but I’ll use ${stateCorrection.state} for any state-specific guidance going forward.`;
  }

  return `${correctionPrefix} I’ll use that going forward as we keep looking at ${session.currentTopic.toLowerCase()}.`;
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
  refreshSessionSignals(session, query);

  const profileCorrectionReply = buildProfileCorrectionReply(session, query);
  if (profileCorrectionReply) {
    session.lastBotMessage = profileCorrectionReply;
    session.messages.push({ role: 'assistant', content: profileCorrectionReply });
    return { answer: profileCorrectionReply, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'profile-correction-v2' } };
  }

  const priorState = session.userState || null;
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

  if (isStateOnlyMessage(query) && hasDemographics(session)) {
    const stateOnlyReply = buildStateOnlyReply(session, priorState, query);
    if (stateOnlyReply) {
      session.lastBotMessage = stateOnlyReply;
      session.messages.push({ role: 'assistant', content: stateOnlyReply });
      return { answer: stateOnlyReply, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'state-only-v2' } };
    }
  }

  if (age || state) {
    session.dataConfirmed = hasDemographics(session);
    if (hasDemographics(session) && !detectedTopic) {
      const answer = buildBenefitsOverviewReply(session, { onboarding: true });
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

  refreshCoverageTierLock(session, query);

  const directSupportReply = buildDirectSupportReply(session, query);
  if (directSupportReply) {
    clearPendingGuidance(session);
    session.lastBotMessage = directSupportReply;
    session.messages.push({ role: 'assistant', content: directSupportReply });
    return { answer: directSupportReply, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'direct-support-v2', topic: session.currentTopic || null } };
  }

  const highPriorityReply = buildHighPriorityIntentReply(session, query);
  if (highPriorityReply) {
    session.lastBotMessage = highPriorityReply.answer;
    session.messages.push({ role: 'assistant', content: highPriorityReply.answer });
    return {
      answer: highPriorityReply.answer,
      tier: 'L1',
      sessionContext: buildSessionContext(session),
      metadata: highPriorityReply.metadata,
    };
  }

  const standaloneFocus = detectBenefitPriorityFocus(query);
  if (standaloneFocus && !benefitTopicFromQuery(query) && /^(\s*(healthcare costs|family protection|routine care)\s*)$/i.test(query)) {
    const answer = buildBenefitDecisionGuidance(session, standaloneFocus);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'benefit-focus-shortcut-v2' } };
  }

  const continuationReply = buildContinuationReply(session, query);
  if (continuationReply) {
    session.lastBotMessage = continuationReply;
    session.messages.push({ role: 'assistant', content: continuationReply });
    return { answer: continuationReply, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'continuation-v2', topic: session.currentTopic || null } };
  }

  if (isCostModelRequest(query) && !detectedTopic) {
    setTopic(session, 'Medical');
    const answer = buildTopicReply(session, 'Medical', query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'cost-model-v2', topic: 'Medical' } };
  }

  if (isDirectMedicalRecommendationQuestion(query)) {
    setTopic(session, 'Medical');
    const answer = buildTopicReply(session, 'Medical', query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'direct-medical-recommendation-v2', topic: 'Medical' } };
  }

  if (isMedicalCoverageTierQuestion(query)) {
    setTopic(session, 'Medical');
    const answer = buildMedicalCoverageTierDecisionReply(session, query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'medical-coverage-tier-v2', topic: 'Medical' } };
  }

  if (isSupplementalOverviewQuestion(query)) {
    clearPendingGuidance(session);
    const answer = buildSupplementalBenefitsOverviewReply();
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'supplemental-overview-v2' } };
  }

  if (isHsaFsaCompatibilityQuestion(query)) {
    setTopic(session, 'HSA/FSA');
    const answer = buildTopicReply(session, 'HSA/FSA', query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'hsa-fsa-compatibility-v2', topic: 'HSA/FSA' } };
  }

  if (isLifeFamilyCoverageQuestion(query)) {
    setTopic(session, 'Life Insurance');
    const answer = buildTopicReply(session, 'Life Insurance', query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'life-family-coverage-v2', topic: 'Life Insurance' } };
  }

  if (isBenefitDecisionGuidanceRequest(query)) {
    const focus = detectBenefitPriorityFocus(query);
    const answer = buildBenefitDecisionGuidance(session, focus);
    if (!focus) {
      setPendingGuidance(session, 'benefit_decision', 'general');
    }
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'benefit-decision-guidance-v2' } };
  }

  if (isBenefitsOverviewQuestion(query)) {
    const answer = buildBenefitsOverviewReply(session, { contextual: isContextualBenefitsOverviewQuestion(query) });
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'benefits-overview-v2' } };
  }

  if ((detectedTopic === 'Medical' || session.currentTopic === 'Medical') && isMedicalDetailQuestion(query) && !isCostModelRequest(query)) {
    setTopic(session, 'Medical');
    const answer = buildTopicReply(session, 'Medical', query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'medical-detail-v2', topic: 'Medical' } };
  }

  const supplementalTopic = inferSupplementalTopicForFollowup(session, query);

  if (
    (supplementalTopic === 'Life Insurance'
      || supplementalTopic === 'Disability'
      || supplementalTopic === 'Critical Illness'
      || supplementalTopic === 'Accident/AD&D')
    && isNonMedicalDetailQuestion(supplementalTopic, query)
    && !(detectSupplementalComparisonFocus(query) && /Accident\/AD&D and Critical Illness/i.test(session.lastBotMessage || ''))
  ) {
    const topic = supplementalTopic;
    setTopic(session, topic);
    const answer = buildTopicReply(session, topic, query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'non-medical-detail-v2', topic } };
  }

  if (
    ((detectedTopic === 'Dental' || session.currentTopic === 'Dental')
      || (detectedTopic === 'Vision' || session.currentTopic === 'Vision'))
    && isRoutineBenefitDetailQuestion(query)
  ) {
    const topic = detectedTopic === 'Vision' || session.currentTopic === 'Vision' ? 'Vision' : 'Dental';
    setTopic(session, topic);
    const answer = buildTopicReply(session, topic, query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'routine-detail-v2', topic } };
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

  const answer = buildContextualFallback(session);
  session.lastBotMessage = answer;
  session.messages.push({ role: 'assistant', content: answer });
  return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'fallback-v2' } };
}
