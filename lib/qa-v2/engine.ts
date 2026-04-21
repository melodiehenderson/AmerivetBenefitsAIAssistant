import { getAmerivetBenefitsPackage } from '@/lib/data/amerivet-package';
import { getAmerivetPackageCopySnapshot } from '@/lib/data/amerivet-package-copy';
import type { Session } from '@/lib/rag/session-store';
import { extractName } from '@/lib/session-logic';
import { getCoverageTierForQuery } from '@/lib/qa/medical-helpers';
import {
  checkL1FAQ,
  detectExplicitStateCorrection,
  normalizeBenefitCategory,
  stripAffirmationLeadIn,
} from '@/lib/qa/routing-helpers';
import { buildLiveSupportMessage } from '@/lib/qa/policy-response-builders';
import { runLlmPassthrough } from '@/lib/qa-v2/llm-passthrough';
import { tryDeterministicIntent } from '@/lib/qa-v2/deterministic-intents';

const ENROLLMENT_PORTAL_URL = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.html';
const HR_PHONE = process.env.HR_PHONE_NUMBER || '888-217-4728';
const ACTIVE_AMERIVET_PACKAGE = getAmerivetBenefitsPackage();
const ACTIVE_AMERIVET_COPY = getAmerivetPackageCopySnapshot(ACTIVE_AMERIVET_PACKAGE);

const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(ACTIVE_AMERIVET_PACKAGE.stateAbbrevToName).map(([code, name]) => [name.toLowerCase(), code]),
);

// Apr 21 regression fix: generic comparison/recommendation/definition shapes
// ("compare the plans", "which should I pick?", "what's bcbstx?") were firing
// Medical fast-paths even when the user was anchored inside a non-Medical
// topic like Vision, Dental, Life Insurance, etc. The rule: only pivot back
// to Medical if the query carries an unambiguous Medical disambiguator —
// otherwise honor the active topic.
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
  // Cheap enough to always recompute on every turn — the tier comes from
  // household signals in session + current query and is idempotent.
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

function buildAllBenefitsMenu(): string {
  const medicalLine = ACTIVE_AMERIVET_COPY.medicalPlanNames.join(', ');
  const lifeLine = ACTIVE_AMERIVET_COPY.lifePlanNames.join(', ');
  const disabilityLine = ACTIVE_AMERIVET_COPY.disabilityPlanNames.join(', ');

  return [
    `- Medical (${medicalLine})`,
    `- Dental (${ACTIVE_AMERIVET_COPY.dentalPlanName})`,
    `- Vision (${ACTIVE_AMERIVET_COPY.visionPlanName})`,
    `- Life Insurance (${lifeLine})`,
    `- Disability (${disabilityLine})`,
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

function isDirectMedicalRecommendationQuestion(query: string): boolean {
  const rawLower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  // Apr 20 regression fix: collapse adverbial fillers ("actually", "really",
  // "honestly", "truly", "genuinely", "just", "seriously") between pronouns
  // and verbs so "which one do you actually recommend for me?" is treated
  // identically to "which one do you recommend for me?".
  const lower = rawLower.replace(
    /\b(do|would|should|can|will|did)\s+(i|you|we)\s+(actually|really|honestly|truly|genuinely|just|seriously|still|even)\b/gi,
    '$1 $2',
  );
  const canonicalRecommendationSignal = /\b(which\s+plan\s+is\s+best|which\s+plan\s+is\s+better|which\s+plan\s+(?:do|would)\s+you\s+recommend|what\s+plan\s+(?:do|would)\s+you\s+recommend|which\s+(?:option|medical\s+option)\s+would\s+you\s+recommend|best\s+(medical\s+)?plan|which\s+medical\s+plan|which\s+one\s+do\s+you\s+recommend|what\s+do\s+you\s+recommend\s+for\s+me|which\s+one\s+do\s+i\s+pick|which\s+one\s+should\s+i\s+pick|what\s+should\s+i\s+pick|which\s+option\s+should\s+i\s+pick|which\s+one\s+would\s+you\s+pick|which\s+plan\s+is\s+right\s+for\s+me|lowest\s+out[- ]of[- ]pocket|lowest\s+oop|lowest\s+bills|best\s+choice\s+for\s+my\s+family|plan\s+is\s+best\s+for\s+my\s+family|best\s+for\s+my\s+family|better\s+for\s+me|better\s+for\s+us|which\s+plan\s+will\s+give\s+us\s+the\s+lowest|let'?s\s+talk\s+(?:thru|through)\s+which\s+plan\s+is\s+best|talk\s+me\s+through\s+which\s+plan\s+is\s+best|should\s+(?:we|i)\s+switch\b|switch\s+from\s+(?:the\s+)?(?:standard|enhanced|kaiser)|make\s+the\s+case\s+for\s+(?:the\s+)?(?:standard|enhanced|kaiser)|sell\s+me\s+on\s+(?:the\s+)?(?:standard|enhanced|kaiser)|talk\s+me\s+into\s+(?:the\s+)?(?:standard|enhanced|kaiser)|i\s+know\s+i\s+said\s+(?:standard|enhanced|kaiser)|which\s+one\s+is\s+better\b[^.?!]{0,60}\b(expect|care|specialist|prescription|usage)|is\s+(?:enhanced|standard|kaiser)\s+worth\b)\b/i.test(lower);
  const naturalRecurringCareRecommendationSignal =
    /\b(which\s+(?:medical\s+)?(?:plan|option)\s+makes\s+the\s+most\s+sense|which\s+(?:medical\s+)?(?:plan|option)\s+should\s+(?:we|i)\s+lean\s+toward|what\s+should\s+(?:we|i)\s+(?:pick|lean\s+toward))\b/i.test(lower)
    && /\b(expect|care|specialist|therapy|therapist|prescription|usage|visit|visits|wife|husband|spouse|partner|kids?|children|son|daughter|family)\b/i.test(lower);
  const naturalFamilyPlanRecommendationSignal =
    /\b(which|what)\s+(?:medical\s+)?(?:plan|option)\s+(?:makes\s+the\s+most\s+sense|should\s+(?:we|i)\s+(?:choose|go\s+with)|fits\s+best)\b/i.test(lower)
    && /\b(family|wife|husband|spouse|partner|kids?|children|us)\b/i.test(lower);
  return canonicalRecommendationSignal || naturalRecurringCareRecommendationSignal || naturalFamilyPlanRecommendationSignal;
}

// Apr 20 v2 regression: bare/short recommendation asks ("what's your
// recommendation?", "what do you recommend?", "so which one will be
// cheapest?") lost to the generic contextual-fallback menu. This helper
// detects those topic-agnostic short asks so the caller can route them
// based on the user's currently-active topic instead of dropping them
// into a next-step menu.
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

function isMedicalPlanComparisonOrPricingQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return (
    /\b(compare|comparison|versus|vs\.?|side\s+by\s+side|breakdown|pricing|plan pricing|price|prices|premium|premiums|per month|monthly|show me the plans|show me the breakdown|show me the prices|show me the premiums|show me the numbers|numbers again|prices again|premiums again|costs?\s+again|just want to see the plans|just wanna see the plans|just plan pricing|what about just plan pricing|how much are(?: the)? (?:medical )?(?:plans?|premiums?)|what do(?:es)?(?: the)? (?:medical )?(?:plans?|coverage) cost|show me the employee\s*\+\s*(?:family|spouse|child(?:ren)?)\s+(?:premiums|prices)|show me the family prices|show me the spouse prices|what would (?:i|we) pay|what would it cost|how much would it cost|cost to cover)\b/i.test(lower)
      && /\b(medical|plan|plans|standard hsa|enhanced hsa|kaiser|hmo|coverage|coverage tier|coverage tiers|employee\s*\+|spouse|family|whole family|wife|husband|partner|kids?|children)\b/i.test(lower)
  ) || (
    /\b(whole family|my family|family|wife|husband|spouse|partner|kids?|children|household|employee\s*\+\s*(?:family|spouse|child(?:ren)?)|cover myself)\b/i.test(lower)
      && /\b(price|prices|pricing|premium|premiums|per month|monthly|show me|breakdown|what would (?:i|we) pay|what would it cost|how much would it cost|cost to cover)\b/i.test(lower)
  ) || (
    /\bcover\s+(?:me|myself)\b/i.test(lower)
      && /\b(wife|husband|spouse|partner)\b/i.test(lower)
      && /\b(kids?|children|family)\b/i.test(lower)
      && /\b(price|prices|pricing|premium|premiums|per month|monthly|show me|what would (?:i|we) pay|what would it cost|how much would it cost)\b/i.test(lower)
  );
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

function isExcludedTopicMention(queryLower: string, topicPattern: string): boolean {
  return new RegExp(
    `\\b(?:other\\s+than|except(?:\\s+for)?|besides|anything\\s+but|not\\s+including)\\b[^.?!]{0,40}\\b${topicPattern}\\b|\\b${topicPattern}\\b[^.?!]{0,20}\\b(?:other\\s+than|except(?:\\s+for)?|besides|anything\\s+but|not\\s+including)\\b`,
    'i',
  ).test(queryLower);
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

function countSupplementalTopicsMentioned(query: string): number {
  const lower = query.toLowerCase();
  let count = 0;
  if (/\b(life(?:\s+insurance)?|term life|vol(?:untary)?\s+term(?:\s+life)?|vol(?:untary)?\s+life|whole life|basic life|perm(?:anent)?(?:\s+life)?)\b/i.test(lower)) count += 1;
  if (/\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower)) count += 1;
  if (/\bcritical(?:\s+illness)?\b/i.test(lower)) count += 1;
  if (/\b(accident|ad&d|ad\/d)\b/i.test(lower)) count += 1;
  return count;
}

function benefitTopicFromQuery(query: string): string | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const declinedDental = isDeclinedRoutineTopic(lower, 'dental');
  const declinedVision = isDeclinedRoutineTopic(lower, 'vision');
  const declinedLife = isExcludedTopicMention(lower, '(?:life(?:\\s+insurance)?|term\\s+life|vol(?:untary)?\\s+term(?:\\s+life)?|vol(?:untary)?\\s+life|whole\\s+life|basic\\s+life|perm(?:anent)?(?:\\s+life)?)');
  if (countSupplementalTopicsMentioned(lower) >= 2) return null;
  if (isMedicalPlanComparisonOrPricingQuestion(query)) return 'Medical';
  if (/\b(all\s+benefits|benefits\s+overview|what\s+are\s+all\s+the\s+benefits|what\s+benefits\s+do\s+i\s+have|other\s+types?\s+of\s+coverage|what\s+other\s+coverage|other\s+coverage\s+available|what\s+else\s+is\s+available)\b/i.test(lower)) return 'Benefits Overview';
  if (!declinedLife && /\b(life(?:\s+insurance)?|term\s+life|vol(?:untary)?\s+term(?:\s+life)?|vol(?:untary)?\s+life|whole\s+life|basic\s+life|perm(?:anent)?(?:\s+life)?)\b/i.test(lower)) return 'Life Insurance';
  if (/\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower)) return 'Disability';
  if (/\b(?:critical(?:\s+illness)?|ci(?:\s+insurance)?)\b/i.test(lower)) return 'Critical Illness';
  if (/\b(accident|ad&d|ad\/d)\b/i.test(lower)) return 'Accident/AD&D';
  if (/\b(hsa(?:\s*\/\s*fsa)?|fsa)\b/i.test(lower)) return 'HSA/FSA';
  if (!declinedDental && /\bdental\b/i.test(lower)) return 'Dental';
  if (!declinedVision && /\b(vision|eye|glasses|contacts|lasik)\b/i.test(lower)) return 'Vision';
  if (/\b(medical|health|hsa\s+plan|kaiser|hmo|ppo|standard\s+hsa|enhanced\s+hsa)\b/i.test(lower)) return 'Medical';
  if (/\b(coverage\s+tier|coverage\s+tiers|plan\s+tradeoffs?|tradeoffs?|maternity|pregnan\w*|prenatal|postnatal|delivery|prescriptions?|generic\s+rx|brand\s+rx|specialty\s+rx|in[- ]network|out[- ]of[- ]network|standard\s+plan|enhanced\s+plan|kaiser\s+plan|therapy|therapist|mental\s+health|specialist)\b/i.test(lower)) return 'Medical';
  return null;
}

function isLiveSupportRequest(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(talk\s+to\s+(?:a\s+)?human|talk\s+to\s+(?:a\s+)?real\s+person|talk\s+to\s+someone|speak\s+with\s+someone|speak\s+to\s+someone|real\s+person|human\s+support|live\s+support|someone\s+directly|person\s+directly)\b/i.test(lower);
}

function isSelfServiceLookupQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(where\s+can\s+i|where\s+do\s+i|how\s+do\s+i|can\s+i\s+(?:see|check|find)|go\s+to\s+see|see\s+that\s+myself|see\s+it\s+myself|find\s+that\s+out|look\s+that\s+up|check\s+that\s+myself|is\s+that\s+only\s+in|only\s+in\s+(?:the\s+)?(?:guide|workday))\b/i.test(lower);
}

function buildMedicalSelfServiceReply(session: Session, query: string): string | null {
  if (!isSelfServiceLookupQuestion(query)) return null;

  const activeTopic = session.currentTopic || inferTopicFromLastBotMessage(session.lastBotMessage);
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const lastBotMessage = (session.lastBotMessage || '').toLowerCase();
  const hasRxContext = /\b(rx|prescriptions?|drugs?|generic|brand|specialty)\b/i.test(lower)
    || /\bprescription|drug tier details|drug pricing|formulary\b/i.test(lastBotMessage);

  if (activeTopic !== 'Medical' || !hasRxContext) {
    return null;
  }

  return [
    `For exact prescription tiers or drug-pricing details, I would use **Workday** as the starting point rather than guess from memory.`,
    ``,
    `- Open the AmeriVet medical plan materials in Workday: ${ENROLLMENT_PORTAL_URL}`,
    `- Look for the prescription-drug section or any linked carrier formulary / drug-pricing tool for the plan you are comparing`,
    `- If Workday does not show the exact RX detail clearly, HR at ${HR_PHONE} is the fastest way to confirm where AmeriVet wants you to check it`,
    ``,
    `If you want, I can still compare the medical options at a high level for someone who expects ongoing prescriptions.`,
  ].join('\n');
}

function buildDirectSupportReply(session: Session, query: string): string | null {
  const medicalSelfServiceReply = buildMedicalSelfServiceReply(session, query);
  if (medicalSelfServiceReply) {
    return medicalSelfServiceReply;
  }

  if (isLiveSupportRequest(query)) {
    return buildLiveSupportMessage(session, HR_PHONE, ENROLLMENT_PORTAL_URL);
  }

  return checkL1FAQ(query, {
    enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
    hrPhone: HR_PHONE,
    userState: session.userState,
  });
}

function inferTopicFromLastBotMessage(lastBotMessage?: string | null): string | null {
  const lower = (lastBotMessage || '').toLowerCase();
  if (!lower) return null;
  if (/medical plan options|recommendation for .* coverage|projected healthcare costs|standard hsa|enhanced hsa|kaiser standard hmo/.test(lower)) return 'Medical';
  if (/dental coverage:\s*\*\*bcbstx dental ppo\*\*|orthodontia rider/.test(lower)) return 'Dental';
  if (/vision coverage:\s*\*\*vsp vision plus\*\*|glasses|contacts|eye exams?/.test(lower)) return 'Vision';
  if (/life insurance options|unum basic life|whole life|voluntary term(?: life)?/.test(lower)) return 'Life Insurance';
  if (/disability coverage|short-term disability|long-term disability/.test(lower)) return 'Disability';
  if (/accident\/ad&d coverage|accident\/ad&d is usually worth considering|accident\/ad&d versus critical illness/.test(lower)) return 'Accident/AD&D';
  if (/critical illness coverage|what critical illness is not|critical illness is usually worth considering|plain-language difference between accident\/ad&d and critical illness/.test(lower)) return 'Critical Illness';
  if (/hsa\/fsa overview|health savings account|flexible spending account/.test(lower)) return 'HSA/FSA';
  return null;
}

function extractAge(message: string): number | null {
  const normalized = message.replace(/\$\s*\d[\d,]*/g, ' ');
  const match = normalized.match(/\b(1[8-9]|[2-9][0-9])\b/);
  return match ? Number(match[1]) : null;
}

// Strict intake-shape age extractor. Only matches shapes where the user is
// clearly stating THEIR OWN age — the bare age, "I'm 49", "49, GA", etc.
// Does NOT match family-member age mentions like "my wife is 38" or
// "my son is 14", which the loose extractAge would incorrectly capture
// and write into session.userAge.
function extractIntakeAge(message: string): number | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\$\s*\d[\d,]*/g, ' ').replace(/\s+/g, ' ').trim();

  const patterns: RegExp[] = [
    // 1. Bare age: "49", "okay 49", "49."
    /^(?:ok(?:ay)?[\s,.\-]+)?(1[8-9]|[2-9][0-9])[.!?\s]*$/i,
    // 2. "I'm 49", "I am 49", "I'm 49 years old", "I'm a 49 year old male"
    /^(?:ok(?:ay)?[\s,.\-]+)?(?:i'?m|i\s+am)\s+(?:a\s+)?(1[8-9]|[2-9][0-9])(?:[\s,\-]+years?\s*old)?(?:\s+(?:male|female|man|woman|guy|gal))?[.!?\s]*$/i,
    // 3. Age + separator + something (usually state): "49, GA", "I'm 49, CA", "49/GA", "49 - CA"
    /^(?:ok(?:ay)?[\s,.\-]+)?(?:i'?m\s+|i\s+am\s+)?(1[8-9]|[2-9][0-9])\s*[,/\-]\s*[A-Za-z].*$/i,
    // 3b. Age + location cue + state: "I'm 42 in OR", "42 from GA", "I'm 49 living in CA"
    /^(?:ok(?:ay)?[\s,.\-]+)?(?:i'?m\s+|i\s+am\s+)?(1[8-9]|[2-9][0-9])\s+(?:in|from|living\s+in|located\s+in|based\s+in)\s+[A-Za-z].*$/i,
    // 4. Age + space + 2-letter state code: "49 GA"
    /^(?:ok(?:ay)?[\s,.\-]+)?(?:i'?m\s+|i\s+am\s+)?(1[8-9]|[2-9][0-9])\s+[A-Z]{2}[.!?\s]*$/,
    // 5. State + separator + age: "GA, 49"
    /^[A-Za-z]{2,}\s*[,/\-]\s*(1[8-9]|[2-9][0-9])[.!?\s]*$/i,
    // 6. Correction lead: "actually, I'm 50" (safety net; profile-correction path usually catches this first)
    /^(?:actually|sorry|correction|i\s+meant|meant)[\s,.:\-]+(?:i'?m\s+|i\s+am\s+)?(1[8-9]|[2-9][0-9])[.!?\s]*$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractCorrectionLead(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  return trimmed.match(/\b(?:actually|sorry|correction)\b[\s,:-]*(.+)$/i)?.[1]
    ?? trimmed.match(/\b(?:i\s+meant|meant)\b[\s,:-]*(.+)$/i)?.[1]
    ?? null;
}

const STATE_CODE_ALTERNATION = 'AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY';

function stripNegatedStateClauses(message: string): string {
  const stateNames = Object.keys(STATE_NAME_TO_CODE).join('|');
  const negationPattern = new RegExp(
    `\\b(?:not|never|no\\s+longer|isn'?t|aren'?t|am\\s+not|'?m\\s+not)\\s+(?:in|from|at|located\\s+in|living\\s+in)\\s+(?:${STATE_CODE_ALTERNATION}|${stateNames})\\b`,
    'gi',
  );
  const bareNegationPattern = new RegExp(
    `\\bnot\\s+(?:${STATE_CODE_ALTERNATION}|${stateNames})\\b`,
    'gi',
  );
  return message.replace(negationPattern, ' ').replace(bareNegationPattern, ' ');
}

function extractState(message: string): string | null {
  const sanitized = stripNegatedStateClauses(message);
  const lower = sanitized.toLowerCase();
  const normalized = sanitized.trim().toLowerCase().replace(/[.!?]+$/g, '');

  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE).sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(lower)) return code;
  }

  const ageThenState = sanitized.match(new RegExp(`\\b(1[8-9]|[2-9][0-9])\\b(?:\\s*,\\s*|\\s*\\/\\s*|\\s*-\\s*)(${STATE_CODE_ALTERNATION})\\b`, 'i'));
  if (ageThenState) return ageThenState[2].toUpperCase();

  const exactAgeState = sanitized.match(new RegExp(`^\\s*(?:ok(?:ay)?\\b[\\s,-]*)?(?:i'?m\\s*)?(1[8-9]|[2-9][0-9])\\s+(${STATE_CODE_ALTERNATION})\\s*$`, 'i'));
  if (exactAgeState) return exactAgeState[2].toUpperCase();

  const locationCueMatch = sanitized.match(new RegExp(`\\b(?:in|from|live in|located in|state is|i'm in|i am in)\\s+(${STATE_CODE_ALTERNATION})\\b`, 'i'));
  if (locationCueMatch) return locationCueMatch[1].toUpperCase();

  if (normalized === 'ok' || normalized === 'okay') {
    return null;
  }

  const exactStateOnly = sanitized.match(new RegExp(`^\\s*(?:ok(?:ay)?\\b[\\s,-]*)?(${STATE_CODE_ALTERNATION})\\s*$`, 'i'));
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
  // Use the strict intake-shape extractor for the write path so that
  // family-member age mentions ("my wife is 38", "my son is 14", "the kid is 15")
  // never overwrite session.userAge. Explicit age corrections
  // ("actually, I'm 50") are handled upstream by buildProfileCorrectionReply
  // but are also matched by extractIntakeAge as a safety net.
  const age = extractIntakeAge(query);
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

function householdSnapshot(details?: Session['familyDetails'] | null) {
  return {
    hasSpouse: Boolean(details?.hasSpouse),
    numChildren: details?.numChildren || 0,
  };
}

function householdChanged(
  priorDetails: Session['familyDetails'] | null | undefined,
  currentDetails: Session['familyDetails'] | null | undefined,
): boolean {
  const prior = householdSnapshot(priorDetails);
  const current = householdSnapshot(currentDetails);
  return prior.hasSpouse !== current.hasSpouse || prior.numChildren !== current.numChildren;
}

function coverageTierFromHousehold(details?: Session['familyDetails'] | null): string | null {
  if (!details) return null;
  const hasSpouse = Boolean(details?.hasSpouse);
  const numChildren = details?.numChildren || 0;

  if (hasSpouse && numChildren > 0) return 'Employee + Family';
  if (hasSpouse) return 'Employee + Spouse';
  if (numChildren > 0) return 'Employee + Child(ren)';
  return 'Employee Only';
}

function isHouseholdOnlyMessage(query: string): boolean {
  const trimmed = query.trim();
  const lower = stripAffirmationLeadIn(trimmed).toLowerCase();
  if (!/\b(spouse|wife|husband|partner|kids?|children|family|household|dependents?)\b/i.test(lower)) return false;
  if (extractAge(query) || extractState(query) || benefitTopicFromQuery(query)) return false;
  // The broad phrase guard below already excludes cost/premium/plan shapes,
  // so an explicit cost-model detector isn't needed here.
  if (/\b(show|compare|which|what\s+are|what\s+would|recommend|best|cost|costs|pricing|premium|premiums|plan|plans|medical|vision|dental|life|disability|hsa|fsa)\b/i.test(lower)) return false;
  if (/\?|^(what|which|should|would|could|can|do|does|did|is|are|am)\b|\bwhat\s+about\b|\bwhat\s+if\b|\bfor\s+my\b|\bfor\s+our\b|\b(?:kids?|spouse|family)\s+then\b|\bmostly\s+care\b/i.test(trimmed)) {
    return false;
  }

  return /^(?:i\s+have|we\s+have|i'?ve\s+got|we'?ve\s+got|i\s+got|we\s+got|it'?s|it\s+is|just\s+me|me\s+and|only\s+me|my\s+household|our\s+household|my\s+family|our\s+family|i'?m\s+looking\s+for\s+myself|i\s+am\s+looking\s+for\s+myself|looking\s+for\s+myself|there'?s|there\s+is|no\s+(?:kids?|children|spouse|partner|dependents?))\b/i.test(lower)
    || /\b(?:now|not\s+anymore|instead|turned\s+out)\b/i.test(lower);
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

  if (session.currentTopic) {
    return `Thanks — I’ve updated your state to ${extractedState}. I’ll use that for any state-specific guidance from here. Want me to re-run the ${session.currentTopic.toLowerCase()} view with the new state?`;
  }

  return `Thanks — I’ve updated your state to ${extractedState}.\n\n${buildBenefitsLineupPrompt(session)}`;
}

function buildHouseholdOnlyReply(
  session: Session,
  priorDetails: Session['familyDetails'] | null | undefined,
  priorCoverageTier: string | null | undefined,
  query: string,
): string | null {
  if (!isHouseholdOnlyMessage(query)) return null;
  const priorTier = coverageTierFromHousehold(priorDetails) || priorCoverageTier || null;
  const refreshedTier = coverageTierFromHousehold(session.familyDetails)
    || getCoverageTierForQuery(query, session)
    || priorCoverageTier
    || 'Employee Only';
  if (!householdChanged(priorDetails, session.familyDetails) && priorTier === refreshedTier) return null;

  session.coverageTierLock = refreshedTier;
  if (session.currentTopic) {
    return `Thanks — I’ve updated the household to **${refreshedTier}** coverage. I’ll use that tier for ${session.currentTopic.toLowerCase()} going forward. Want me to re-run the ${session.currentTopic.toLowerCase()} view at the new tier?`;
  }

  return `Thanks — I’ve updated the household to **${refreshedTier}** coverage.\n\n${buildBenefitsLineupPrompt(session)}`;
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

function coverageTierFromConversation(session: Session): string | null {
  if (session.coverageTierLock) return session.coverageTierLock;

  const assistantMessages = (session.messages || [])
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n');

  const match = assistantMessages.match(/Recommendation for (Employee Only|Employee \+ Spouse|Employee \+ Child\(ren\)|Employee \+ Family) coverage/i);
  return match ? match[1] : null;
}

function buildBenefitsOverviewReply(session: Session, options?: { contextual?: boolean; onboarding?: boolean }): string {
  const contextual = options?.contextual || false;
  const onboarding = options?.onboarding || false;
  const intro = hasDemographics(session)
    ? onboarding
      ? `Perfect! ${session.userAge} in ${session.userState}.`
      : contextual
      ? `Here are the other benefit areas available to you as an AmeriVet employee:`
      : `Here are the benefits available to you as an AmeriVet employee:`
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

  if (normalizedTopic && normalizedTopic !== 'Benefits Overview') {
    setTopic(session, normalizedTopic);
    return `${correctionPrefix} Ask the ${normalizedTopic.toLowerCase()} question again and I’ll re-answer with the updated profile.`;
  }

  if (!session.currentTopic) {
    return `${correctionPrefix}\n\n${buildBenefitsLineupPrompt(session)}`;
  }

  if (stateCorrection) {
    return `${correctionPrefix} That does not materially change the ${session.currentTopic.toLowerCase()} options I just showed, but I’ll use ${stateCorrection.state} for any state-specific guidance going forward.`;
  }

  return `${correctionPrefix} I’ll use that going forward as we keep looking at ${session.currentTopic.toLowerCase()}.`;
}

export async function runQaV2Engine(params: {
  query: string;
  session: Session;
}): Promise<{ answer: string; tier: 'L1' | 'L2'; sessionContext: ReturnType<typeof buildSessionContext>; metadata?: Record<string, unknown> }> {
  const { query, session } = params;
  incrementTurn(session);

  if (!session.messages) session.messages = [];

  // __WELCOME__ sentinel: page-load greeting before any user input.
  if (query === '__WELCOME__') {
    const answer = `Hi there! Welcome!\n\nI'm your AmeriVet Benefits Assistant. I'm here to help you compare plans, understand your options, and make confident benefit decisions.\n\nLet's get started — what's your name?`;
    return emit(answer, 'L1', session, { intercept: 'welcome-v2' });
  }

  session.messages.push({ role: 'user', content: query });
  const priorState = session.userState || null;
  const priorFamilyDetails = session.familyDetails ? { ...session.familyDetails } : null;
  const priorCoverageTier = session.coverageTierLock || null;
  refreshSessionSignals(session, query);

  // Profile correction ("actually, my name is X" / "I meant 35").
  const profileCorrectionReply = buildProfileCorrectionReply(session, query);
  if (profileCorrectionReply) {
    return emit(profileCorrectionReply, 'L1', session, { intercept: 'profile-correction-v2' });
  }

  // Name capture.
  const detectedName = !session.userName && query.trim() && !extractAge(query) && !extractState(query) && !benefitTopicFromQuery(query)
    ? extractName(query)
    : null;
  if (detectedName) {
    session.userName = detectedName;
    session.hasCollectedName = true;
    const answer = `Thanks, ${session.userName}! To keep the guidance accurate, please share your age and state next. For example: "35, FL".`;
    return emit(answer, 'L1', session, { intercept: 'name-capture-v2' });
  }

  // Demographics intake (age, state).
  const { age, state } = applyDemographics(session, query);
  const detectedTopic = benefitTopicFromQuery(query);

  if (isStateOnlyMessage(query) && hasDemographics(session)) {
    const stateOnlyReply = buildStateOnlyReply(session, priorState, query);
    if (stateOnlyReply) {
      return emit(stateOnlyReply, 'L1', session, { intercept: 'state-only-v2' });
    }
  }

  if (isHouseholdOnlyMessage(query) && hasDemographics(session)) {
    const householdOnlyReply = buildHouseholdOnlyReply(session, priorFamilyDetails, priorCoverageTier, query);
    if (householdOnlyReply) {
      return emit(householdOnlyReply, 'L1', session, { intercept: 'household-only-v2', topic: session.currentTopic || null });
    }
  }

  if (age || state) {
    session.dataConfirmed = hasDemographics(session);
    if (hasDemographics(session) && !detectedTopic) {
      const answer = buildBenefitsOverviewReply(session, { onboarding: true });
      return emit(answer, 'L1', session, { intercept: 'demographics-complete-v2' });
    }
  }

  if (!hasDemographics(session)) {
    const topic = detectedTopic;
    const answer = missingDemographicsMessage(session, topic);
    if (topic) session.currentTopic = topic;
    return emit(answer, 'L1', session, { intercept: 'demographic-gate-v2' });
  }

  refreshCoverageTierLock(session, query);

  // Compliance-sensitive facts from the package (HR phone, enrollment portal,
  // QLE timing, self-service lookups). These must be exact.
  const directSupportReply = buildDirectSupportReply(session, query);
  if (directSupportReply) {
    clearPendingGuidance(session);
    return emit(directSupportReply, 'L1', session, { intercept: 'direct-support-v2', topic: session.currentTopic || null });
  }

  // Benefits lineup: "what are my options", "list all my benefits".
  if (isBenefitsOverviewQuestion(query)) {
    const answer = buildBenefitsOverviewReply(session, { contextual: isContextualBenefitsOverviewQuestion(query) });
    return emit(answer, 'L1', session, { intercept: 'benefits-overview-v2' });
  }

  // Small deterministic allowlist: term registry, plan detail by name,
  // topic overview/switch. Anything that isn't catalog-exact falls
  // through to the LLM.
  const deterministic = tryDeterministicIntent({
    query,
    session,
    detectedTopic,
    enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
    hrPhone: HR_PHONE,
  });
  if (deterministic) {
    if (deterministic.topic) setTopic(session, deterministic.topic);
    return emit(deterministic.answer, 'L1', session, deterministic.metadata);
  }

  // LLM passthrough is the DEFAULT conversational path. On disabled or
  // failure, the engine emits a single-line counselor escalation — never
  // a menu.
  const l2 = await runLlmPassthrough(query, session);
  if (l2) {
    if (detectedTopic && detectedTopic !== 'Benefits Overview') setTopic(session, detectedTopic);
    return emit(l2.answer, 'L2', session, { ...l2.metadata, intercept: 'llm-passthrough-v2' });
  }

  return emit(counselorEscalation(), 'L1', session, {
    intercept: 'counselor-escalation-v2',
    topic: session.currentTopic || null,
  });
}

function emit(
  answer: string,
  tier: 'L1' | 'L2',
  session: Session,
  metadata: Record<string, unknown>,
): { answer: string; tier: 'L1' | 'L2'; sessionContext: ReturnType<typeof buildSessionContext>; metadata?: Record<string, unknown> } {
  session.lastBotMessage = answer;
  if (!session.messages) session.messages = [];
  session.messages.push({ role: 'assistant', content: answer });
  return { answer, tier, sessionContext: buildSessionContext(session), metadata };
}

function counselorEscalation(): string {
  return `I want to make sure you get this right — a benefits counselor can walk you through this at ${HR_PHONE}, or you can open enrollment materials in Workday at ${ENROLLMENT_PORTAL_URL}.`;
}
