import { getAmerivetBenefitsPackage } from '@/lib/data/amerivet-package';
import { getAmerivetPackageCopySnapshot } from '@/lib/data/amerivet-package-copy';
import { BCG_EMPLOYER_GUIDANCE_RULES } from '@/lib/data/bcg-employer-guidance';
import type { Session } from '@/lib/rag/session-store';
import { extractName } from '@/lib/session-logic';
import pricingUtils from '@/lib/rag/pricing-utils';
import { buildCategoryExplorationResponse } from '@/lib/qa/category-response-builders';
import {
  buildMedicalPlanFallback,
  buildRecommendationOverview,
  getCoverageTierForQuery,
  hasExplicitNoPregnancyOverride,
  isKaiserEligibleState,
} from '@/lib/qa/medical-helpers';
import { buildMedicalPlanDetailAnswer } from '@/lib/qa/plan-detail-lookup';
import { matchShortDefinitionAsk, lookupPackageTerm } from '@/lib/qa/package-term-registry';
import { buildRoutineBenefitDetailAnswer, isRoutineBenefitDetailQuestion } from '@/lib/qa/routine-benefit-detail-lookup';
import { buildLifeSizingGuidance, buildNonMedicalDetailAnswer, isNonMedicalDetailQuestion } from '@/lib/qa/non-medical-detail-lookup';
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
import { IRS_2026 } from '@/lib/data/irs-limits-2026';
import { runLlmPassthrough } from '@/lib/qa-v2/llm-passthrough';
import { tryDeterministicIntent } from '@/lib/qa-v2/deterministic-intents';

const ENROLLMENT_PORTAL_URL = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.html';
const HR_PHONE = process.env.HR_PHONE_NUMBER || '888-217-4728';
const ACTIVE_AMERIVET_PACKAGE = getAmerivetBenefitsPackage();
const ACTIVE_AMERIVET_COPY = getAmerivetPackageCopySnapshot(ACTIVE_AMERIVET_PACKAGE);
const ACTIVE_BASIC_LIFE_NAME = ACTIVE_AMERIVET_COPY.lifePlanNames.find((name) => /basic life/i.test(name)) || 'Basic Life';
const ACTIVE_TERM_LIFE_NAME = ACTIVE_AMERIVET_COPY.lifePlanNames.find((name) => /term life/i.test(name)) || 'Voluntary Term Life';
const ACTIVE_WHOLE_LIFE_NAME = ACTIVE_AMERIVET_COPY.lifePlanNames.find((name) => /whole life/i.test(name)) || 'Whole Life';
const ACTIVE_LIFE_SPLIT_RULE = BCG_EMPLOYER_GUIDANCE_RULES.find((rule) =>
  rule.topic === 'Life Insurance' && rule.intentFamily === 'life_split_term_vs_whole',
) || null;

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

// Apr 21 regression fix: generic comparison/recommendation/definition shapes
// ("compare the plans", "which should I pick?", "what's bcbstx?") were firing
// Medical fast-paths even when the user was anchored inside a non-Medical
// topic like Vision, Dental, Life Insurance, etc. The rule: only pivot back
// to Medical if the query carries an unambiguous Medical disambiguator —
// otherwise honor the active topic.
function isLockedToNonMedicalTopic(session: Session): boolean {
  const topic = session.currentTopic;
  if (!topic) return false;
  if (topic === 'Medical' || topic === 'Benefits Overview' || topic === 'HSA/FSA') return false;
  return true;
}

function hasExplicitMedicalDisambiguator(query: string): boolean {
  const lower = query.toLowerCase();
  // Tokens and phrases that are meaningfully medical-coded, even if the
  // query is otherwise generic-sounding. Includes family-medical rec asks
  // like "best for my family" which only make sense against medical plans
  // (dental/vision have single plans — no "best for my family" tradeoff).
  return /\b(medical\s+plan|medical\s+plans|medical\s+premium|medical\s+premiums|medical\s+coverage|medical\s+deductible|medical\s+pricing|hmo|kaiser|standard\s+hsa|enhanced\s+hsa|hdhp|copay|copays|coinsurance|out[- ]of[- ]pocket|oop|prescriptions?|\brx\b|office\s+visit|primary\s+care|\bpcp\b|urgent\s+care|emergency\s+room|telehealth|telemedicine|maternity|pregnan\w*|\bdelivery\b|prenatal|postnatal|therapy|therapist|mental\s+health|specialist|best\s+for\s+my\s+family|best\s+for\s+my\s+household|plan\s+is\s+best\s+for\s+my\s+family|best\s+choice\s+for\s+my\s+family|plan\s+tradeoffs?|coverage\s+tier|coverage\s+tiers)\b/i.test(lower);
}

// Apr 21 Step 7a: deictic tier reference.
// User has just been shown pricing/comparison and asks "what coverage tier is
// that for?" / "is that the family tier?" / "which tier was that?". The old
// engine matched on the lexical token "coverage tier" and fired the definition
// handler ("A coverage tier is the level of people you are enrolling..."). The
// rule here is: if the query is a short reference-ask pointing at the prior
// bot message, echo the tier on record rather than defining the concept.
function isDeicticTierReference(query: string, session: Session): boolean {
  const lower = query.trim().toLowerCase();
  if (lower.length > 80) return false;
  const hasTierNoun = /\b(tier|coverage|pricing|price|premium|premiums|plan\s+price|that\s+one)\b/i.test(lower);
  if (!hasTierNoun) return false;
  const hasDeicticMarker = /\b(that|this|those|these|it|above)\b/i.test(lower);
  if (!hasDeicticMarker) return false;
  // Must be shaped like a question-about-reference, not a fresh ask.
  const hasReferenceShape =
    /\b(what|which)\b[^.?!]{0,30}\b(coverage\s+)?(tier|pricing|price|premium|premiums)\b[^.?!]{0,30}\b(that|this|those|these|it|above)\b/i.test(lower)
    || /\b(is|was|are|were)\s+(that|this|those|these|it)\b[^.?!]{0,30}\b(for\s+)?(employee|family|spouse|kids?|children|child(?:ren)?|the\s+family|the\s+spouse)\b/i.test(lower)
    || /\b(that|this|those)\s+(pricing|price|premium|premiums|tier|one)\s+(for|above|from)\b/i.test(lower)
    || /\b(what|which)\s+(coverage\s+)?tier\s+(is|was|are|were)\s+(that|this|those|these|it|above)\b/i.test(lower);
  if (!hasReferenceShape) return false;
  // Guard: only fire if the last bot message actually showed pricing/tier info.
  const lastBot = (session.lastBotMessage || '').toLowerCase();
  return /employee\s*\+\s*(spouse|child|family)|employee\s+only|\$\d|per paycheck|\/month|monthly\s+premium|coverage\s+tier|coverage\s+tiers|medical\s+premium|practical\s+tradeoff|here\s+(is|are)\s+the\s+(practical|monthly|actual)/i.test(lastBot);
}

function buildDeicticTierReferenceReply(session: Session): string {
  const tier = session.coverageTierLock
    || coverageTierFromConversation(session)
    || coverageTierFromHousehold(session.familyDetails || undefined)
    || 'Employee Only';
  return [
    `That was for **${tier}** coverage — the tier I inferred from what you have shared about your household so far.`,
    ``,
    `If the household on the plan is different, tell me who needs to be covered (for example "just me and my spouse" or "me, spouse, and 2 kids") and I will re-run the pricing for the right tier.`,
  ].join('\n');
}

// Apr 21 Step 7b: menu-reply loop detection.
// When the last two bot messages are "useful next step" menus and the user's
// last two queries are semantically similar, the engine is stuck retrying the
// same fallback instead of answering. Escalate: name the stuck state honestly
// and offer both a concrete rephrase nudge and the human-support path.
function isMenuReply(message: string | undefined): boolean {
  if (!message) return false;
  return /useful\s+next\s+[a-z-]*\s*step\s+is\s+usually\s+one\s+of\s+these/i.test(message)
    || /pick\s+one\s+and\s+i['’]ll\s+(take\s+you\s+(straight\s+)?into\s+it|walk\s+through\s+it|walk\s+you\s+through)/i.test(message);
}

function contentWordOverlapRatio(a: string, b: string): number {
  const stopwords = new Set([
    'a','an','the','is','are','was','were','be','been','being','to','of','in','for','with','on','at',
    'from','by','as','it','this','that','and','or','but','if','do','does','did','have','has','had',
    'i','you','my','your','we','our','us','me','yes','no','ok','okay','so','just','also','please',
    'then','than','more','less','same','one','two','too','very','really','actually','maybe',
    'would','could','should','can','will','what','which','when','how','why','here','there','tell','let','help','about',
  ]);
  // Light stem — strip trailing 's' on words longer than 3 chars so plans/plan
  // and options/option collapse to the same key.
  const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
  const tokens = (s: string) => new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopwords.has(w))
      .map(stem),
  );
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const w of setA) if (setB.has(w)) overlap++;
  return overlap / Math.min(setA.size, setB.size);
}

function detectRepeatRephraseLoop(session: Session, currentQuery: string): boolean {
  const messages = session.messages || [];
  if (messages.length < 3) return false;
  // Look at the last two assistant messages: both must be menus.
  const assistantHistory = messages.filter((m) => m.role === 'assistant');
  if (assistantHistory.length < 2) return false;
  const lastBot = assistantHistory[assistantHistory.length - 1]?.content || '';
  const prevBot = assistantHistory[assistantHistory.length - 2]?.content || '';
  if (!isMenuReply(lastBot) || !isMenuReply(prevBot)) return false;
  // Prior user query = the most recent user message before the current one.
  const userHistory = messages.filter((m) => m.role === 'user');
  // The current query has already been pushed into session.messages by runQaV2Engine,
  // so the prior user query is the second-to-last user message.
  if (userHistory.length < 2) return false;
  const priorUserQuery = userHistory[userHistory.length - 2]?.content || '';
  if (!priorUserQuery) return false;
  return contentWordOverlapRatio(priorUserQuery, currentQuery) >= 0.34;
}

function buildRephraseEscalationReply(session: Session): string {
  const topic = session.currentTopic;
  const topicLabel = topic ? ` about **${topic}**` : '';
  const name = session.userName ? `, ${session.userName}` : '';
  return [
    `I notice I have been bouncing you back to the same menu${topicLabel} instead of answering your question directly${name} — I am sorry about that.`,
    ``,
    `A couple of things that usually help me land a better answer:`,
    `- Tell me the specific fact that should drive the call (for example "my daughter already wears glasses" or "nobody in the house uses the dentist"). I will use that to tip the recommendation one way or the other.`,
    `- Or rephrase in plain terms — "is this worth it for my family?", "how many plans are there?", "what would you pick?" — and I will try to give you a direct yes/no or recommendation rather than another menu.`,
    ``,
    `If you would rather skip the bot and talk to a person, AmeriVet HR is at **${HR_PHONE}**, and the Workday enrollment portal is [here](${ENROLLMENT_PORTAL_URL}).`,
  ].join('\n');
}

// Apr 21 Step 4 Layer 1: procedural intent family.
// Three factual, mechanics-flavored question shapes users ask that the old
// engine used to drop into a next-step menu:
// 1. HSA/FSA funding mechanics — "does it come out of my paycheck?",
//    "does AmeriVet contribute to the HSA?", "how much can I contribute?"
// 2. Enrollment timing — "when is open enrollment?", "when does coverage
//    start?", "am I enrolled yet?"
// 3. Waiting periods — "is there a waiting period?", "how long until dental
//    kicks in?", "waiting period for major services?"
// Each has a deterministic answer from the package data, and should be
// answered directly before any fallback can fire.

function isHsaFsaFundingQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const mentionsAccount = /\b(hsa|fsa|health\s+savings\s+account|flexible\s+spending\s+account)\b/i.test(lower);
  if (!mentionsAccount) return false;
  return /\b(come\s+out\s+of\s+my\s+paycheck|out\s+of\s+my\s+paycheck|paycheck\s+deduction|payroll\s+deduction|pre[-\s]?tax|pretax|tax[-\s]?free\s+contribution|how\s+(?:do|can)\s+i\s+(?:fund|contribute(?:\s+to)?)|employer\s+(?:contribute|contribution|match|put|pay|add)|amerivet\s+(?:contribute|contribution|match|put|pay|add|kick\s+in)|company\s+(?:contribute|contribution|match|put|pay|add|kick\s+in)|does\s+(?:amerivet|the\s+company|my\s+employer)\s+(?:contribute|match|put|pay|add)|does\s+(?:my\s+employer|amerivet|the\s+company)\s+(?:chip|kick)\s+in|employer\s+(?:kicks?|chips?)\s+in|how\s+much\s+(?:can|does)\s+(?:i|amerivet|the\s+company|my\s+employer)\s+(?:contribute|put|add|match|kick\s+in)|contribution\s+limits?|max(?:imum)?\s+contribution|irs\s+limit|fund\s+(?:an?\s+)?(?:hsa|fsa))\b/i.test(lower);
}

function buildHsaFsaFundingReply(session: Session): string {
  const hsa = ACTIVE_AMERIVET_PACKAGE.catalog.specialCoverage?.hsa;
  const rawContribs = hsa?.employerContribution;
  const contribsByTier: Record<string, number> =
    typeof rawContribs === 'number'
      ? { 'Employee Only': rawContribs }
      : (rawContribs as Record<string, number> | undefined) || {};
  const lines: string[] = [];
  lines.push(`How HSA funding works at AmeriVet:`);
  lines.push(``);
  lines.push(`- **Your contributions** come out of your paycheck **pre-tax**, spread across the plan year (so you do not fund the whole annual amount up front).`);
  lines.push(`- **AmeriVet's employer contribution** is added to your HSA on top of what you put in — it is free money, not a match you have to earn:`);
  const tierOrder = ['Employee Only', 'Employee + Spouse', 'Employee + Child(ren)', 'Employee + Family'] as const;
  for (const tier of tierOrder) {
    const amount = contribsByTier[tier];
    if (typeof amount === 'number') {
      lines.push(`  - ${tier}: **$${amount.toLocaleString()}/year**`);
    }
  }
  lines.push(``);
  lines.push(`- **IRS annual contribution limits (2026)** — the combined employee + employer total cannot exceed:`);
  lines.push(`  - Self-only coverage: **$${IRS_2026.HSA_SELF_ONLY.toLocaleString()}**`);
  lines.push(`  - Family coverage: **$${IRS_2026.HSA_FAMILY.toLocaleString()}**`);
  lines.push(`  - Age 55+ catch-up: **+$${IRS_2026.HSA_CATCHUP_ADDITIONAL.toLocaleString()}**`);
  lines.push(``);
  lines.push(`FSA contributions also come out of your paycheck pre-tax. The 2026 general-purpose FSA max is **$${IRS_2026.FSA_GENERAL_MAX.toLocaleString()}**. Unlike the HSA, AmeriVet does not add an employer contribution to the FSA.`);
  lines.push(``);
  lines.push(`If you want the exact payroll cadence (which paycheck starts the deduction, whether it is split evenly, etc.), that is a Workday/HR lookup — the portal is [here](${ENROLLMENT_PORTAL_URL}) and HR is at **${HR_PHONE}**.`);
  return lines.join('\n');
}

function isEnrollmentTimingQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(when\s+is\s+(?:open\s+)?enrollment|when\s+does\s+(?:open\s+)?enrollment|enrollment\s+window|enrollment\s+dates?|enrollment\s+deadline|enrollment\s+period|open\s+enrollment\s+(?:start|end|dates?|period)|when\s+do\s+i\s+enroll|when\s+can\s+i\s+enroll|deadline\s+to\s+enroll|when\s+does\s+(?:my\s+|the\s+)?coverage\s+(?:start|begin|take\s+effect|kick\s+in)|when\s+will\s+(?:my\s+|the\s+)?coverage\s+(?:start|begin)|coverage\s+effective\s+date|effective\s+date\s+of\s+(?:my\s+)?coverage|first\s+day\s+of\s+coverage|new\s+hire\s+(?:enrollment|window|waiting)|how\s+long\s+(?:after|until|till|\u2019til)\s+(?:i|my|new\s+hire).{0,30}(?:coverage|enrolled|benefits))\b/i.test(lower);
}

function buildEnrollmentTimingReply(): string {
  const oe = ACTIVE_AMERIVET_PACKAGE.catalog.openEnrollment;
  const elig = ACTIVE_AMERIVET_PACKAGE.catalog.eligibility;
  const formatDate = (iso: string) => {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  };
  return [
    `Enrollment timing for AmeriVet (${oe.year}):`,
    ``,
    `- **Open enrollment window:** ${formatDate(oe.startDate)} \u2013 ${formatDate(oe.endDate)}`,
    `- **Coverage effective date** (elections made during open enrollment): ${formatDate(oe.effectiveDate)}`,
    `- **New hires:** ${elig.coverageEffective}`,
    `- **Eligibility:** full-time at ${elig.fullTimeHours}+ hours/week; part-time at ${elig.partTimeHours}+ hours/week (plan-specific).`,
    ``,
    `Outside of open enrollment, you can only change elections if you have a qualifying life event (marriage, birth, loss of other coverage, etc.).`,
    ``,
    `Your actual enrollment status and paycheck deduction start date live in Workday \u2014 [portal here](${ENROLLMENT_PORTAL_URL}). HR can confirm anything specific: **${HR_PHONE}**.`,
  ].join('\n');
}

function isWaitingPeriodQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(waiting\s+period|wait\s+period|how\s+long\s+(?:do\s+i\s+)?(?:have\s+to\s+)?wait|do\s+i\s+have\s+to\s+wait|is\s+there\s+a\s+wait|any\s+wait\s+before|cover(?:age|ed)\s+kick(?:s)?\s+in)\b/i.test(lower);
}

function buildWaitingPeriodReply(session: Session): string {
  const topic = session.currentTopic;
  const dentalWait = `Dental **major services** (crowns, bridges, oral surgery) have a **6-month waiting period** for new enrollees. Preventive and basic services are covered right away.`;
  const genericWait = `Coverage generally begins on the first of the month following 30 days of employment for new hires; existing employees who elect during open enrollment have coverage effective ${ACTIVE_AMERIVET_PACKAGE.catalog.openEnrollment.effectiveDate}. Most plans do not have additional waiting periods beyond that.`;
  if (topic === 'Dental') {
    return [
      dentalWait,
      ``,
      `Everything else on the dental side (cleanings, exams, fillings) has no waiting period — it is covered from your coverage start date.`,
      ``,
      `If you need the exact date your dental kicks in, that is a Workday lookup — [portal here](${ENROLLMENT_PORTAL_URL}), HR at **${HR_PHONE}**.`,
    ].join('\n');
  }
  return [
    `Short answer on waiting periods in AmeriVet's package:`,
    ``,
    `- **Medical, Vision, HSA, FSA, Life, Disability, Accident/AD&D, Critical Illness:** no waiting period beyond the standard coverage-effective-date rule.`,
    `- **Dental:** ${dentalWait.replace(/^Dental\s+/, '')}`,
    ``,
    genericWait,
    ``,
    `Your exact effective date lives in Workday — [portal here](${ENROLLMENT_PORTAL_URL}). HR can confirm: **${HR_PHONE}**.`,
  ].join('\n');
}

// Apr 21 Step 6: dependent eligibility.
// When a user asks "can I cover my 28-year-old son who lives at home?" the
// answer lives right in the package data (`catalog.eligibility.dependents`).
// Before this step, that query bounced into a generic menu because none of
// the medical-compare, pricing, or topic detectors matched. Now we extract
// the age + relation, compare against the package's child-age cutoff, and
// answer directly — like a counselor who knows the rule.

function extractDependentContextFromQuery(query: string): { age: number | null; relation: 'son' | 'daughter' | 'child' | 'spouse' | 'domestic_partner' | null } {
  const lower = query.toLowerCase();
  // Age captured from phrasings like "28-year-old", "28 year old", "28yo",
  // "my son who is 28", "he is 28", "age 28".
  let age: number | null = null;
  const hyphenMatch = lower.match(/\b(\d{1,2})[-\s]?years?[-\s]?old\b/);
  const isMatch = lower.match(/\b(?:who\s+is|is)\s+(\d{1,2})(?:\s+years?\s+old)?\b/);
  const ageMatch = lower.match(/\bage\s+(\d{1,2})\b/);
  const yoMatch = lower.match(/\b(\d{1,2})\s*yo\b/);
  for (const m of [hyphenMatch, isMatch, ageMatch, yoMatch]) {
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 99) {
        age = n;
        break;
      }
    }
  }
  let relation: 'son' | 'daughter' | 'child' | 'spouse' | 'domestic_partner' | null = null;
  if (/\bson\b/.test(lower)) relation = 'son';
  else if (/\bdaughter\b/.test(lower)) relation = 'daughter';
  else if (/\b(kid|child|children|dependent)\b/.test(lower)) relation = 'child';
  else if (/\b(wife|husband|spouse)\b/.test(lower)) relation = 'spouse';
  else if (/\bdomestic\s+partner\b/.test(lower)) relation = 'domestic_partner';
  return { age, relation };
}

function isDependentEligibilityQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const { age, relation } = extractDependentContextFromQuery(lower);
  // Anti-patterns: these queries mention a dependent but are really about
  // something else (pricing, product scope, protection ranking, survivor
  // hypotheticals). Exclude them up front so we don't hijack those flows.
  // - Pricing / cost shape → belongs to the premium / pricing handlers.
  if (/\b(pay|paid|paying|cost|costs|price|priced|pricing|premium|premiums|how\s+much)\b/.test(lower)) return false;
  // - Product-scope shape: "would/does the [product] (also )?cover ..." — this
  //   is asking whether the insurance product extends to a person, not whether
  //   the person is an eligible dependent. Let topic handlers answer.
  if (/\b(would|does|will|can|could)\s+(?:the\s+|my\s+|our\s+)?(life|disability|medical|dental|vision|accident|critical(?:\s+illness)?|hospital|coverage|policy|plan|insurance|ad&d|ad\s*and\s*d)\b[^?.]{0,40}\b(also\s+)?cover\b/.test(lower)) return false;
  // - Protection ranking / "what should I add first" — belongs to the
  //   life-vs-disability / supplemental-priority handlers.
  if (/\b(what\s+(?:protection|benefit|coverage)\s+should\s+i\s+add\s+first|add\s+first|which\s+(?:protection|benefit|coverage)\s+(?:should\s+i\s+add|first))\b/.test(lower)) return false;
  // - Survivor / hypothetical-death framing → life vs. disability reasoning.
  if (/\b(if\s+(?:i|something)\s+(?:die|died|happened|happens)|if\s+something\s+happened\s+to\s+me)\b/.test(lower)) return false;
  // Require an eligibility-framed verb. This keeps us from hijacking every
  // "my 28-year-old son uses X" narrative turn.
  const eligibilityVerb = /\b(cover|covered|covering|add|adding|enroll|enrolled|enrolling|include|including|qualif(?:y|ies)|eligible|eligibility|on\s+my\s+(?:plan|coverage)|on\s+my\s+medical|my\s+(?:dependent|dependents)|count\s+as\s+(?:a\s+)?dependent|be\s+(?:a\s+)?dependent|still\s+(?:a\s+)?dependent)\b/i.test(lower);
  if (!eligibilityVerb) return false;
  // Spouse / domestic partner: relation alone is enough — they have no
  // age-dependent cutoff, so "can I add my spouse?" is decisive on its own.
  if (relation === 'spouse' || relation === 'domestic_partner') return true;
  // Child/son/daughter: prefer age + relation for a decisive age answer.
  if (age !== null && relation !== null) return true;
  // Fallback: relation + lives-with-me / adult-child signal. This covers
  // "my adult son" or "my son who lives at home" without an explicit age.
  if (relation && /\b(adult|lives\s+(?:at\s+home|with\s+me|with\s+us)|still\s+lives|stays\s+with\s+me|stays\s+with\s+us)\b/i.test(lower)) return true;
  return false;
}

function buildDependentEligibilityReply(session: Session, query: string): string {
  const { age, relation } = extractDependentContextFromQuery(query);
  const childRule = ACTIVE_AMERIVET_PACKAGE.catalog.eligibility.dependents.children;
  // Parse the cutoff age out of the rule string (e.g. "through age 26").
  const cutoffMatch = /through\s+age\s+(\d{1,2})/i.exec(childRule);
  const cutoffAge = cutoffMatch ? parseInt(cutoffMatch[1], 10) : 26;
  const relationLabel = relation === 'son'
    ? 'son'
    : relation === 'daughter'
      ? 'daughter'
      : relation === 'child'
        ? 'child'
        : relation === 'spouse'
          ? 'spouse'
          : relation === 'domestic_partner'
            ? 'domestic partner'
            : 'dependent';
  // Spouse / domestic partner path — different rules from children.
  if (relation === 'spouse') {
    return [
      `Yes — your spouse is eligible as a dependent on AmeriVet's medical, dental, vision, and voluntary plans.`,
      ``,
      `You would just need to add them during open enrollment or within 30 days of a qualifying life event (marriage, loss of other coverage, etc.). Your coverage tier changes to **Employee + Spouse** or **Employee + Family** depending on who else is on the plan.`,
      ``,
      `If you want, I can show what Employee + Spouse pricing looks like on the medical plans.`,
    ].join('\n');
  }
  if (relation === 'domestic_partner') {
    return [
      `Yes — AmeriVet's plans allow domestic partners as eligible dependents on medical, dental, and vision coverage.`,
      ``,
      `Enrollment works the same as adding a spouse: during open enrollment or within 30 days of a qualifying life event. Tax treatment of the premium share may differ — HR can confirm at **${HR_PHONE}**.`,
    ].join('\n');
  }
  // Child path — age-based rule.
  if (age === null) {
    // Relation suggests a child but no age supplied. Give the rule and ask
    // for the age so we can answer decisively.
    return [
      `Children qualify as dependents on AmeriVet's plans **through age ${cutoffAge}, regardless of student status**.`,
      ``,
      `If you can tell me the age of your ${relationLabel}, I can give you a direct yes/no on whether they are still eligible on your coverage.`,
    ].join('\n');
  }
  const eligible = age <= cutoffAge;
  if (eligible) {
    return [
      `Yes — a ${age}-year-old ${relationLabel} is still eligible as a dependent on AmeriVet's plans.`,
      ``,
      `Children qualify through age ${cutoffAge}, regardless of student status, so you can keep your ${relationLabel} on your medical, dental, and vision coverage. They age off the plan at the end of the month they turn ${cutoffAge + 1}.`,
      ``,
      `If you want, I can show what your coverage tier and pricing look like with your ${relationLabel} included.`,
    ].join('\n');
  }
  return [
    `A ${age}-year-old ${relationLabel} is past AmeriVet's dependent-child age limit.`,
    ``,
    `AmeriVet's plans cover dependent children **through age ${cutoffAge}, regardless of student status** — that is the cutoff in the eligibility rules. A ${age}-year-old is beyond that window, so your ${relationLabel} would not qualify as a dependent on your medical, dental, or vision coverage.`,
    ``,
    `Common next steps for an adult child in that situation:`,
    `- **Their own employer's plan** if they are working`,
    `- **An individual plan on HealthCare.gov** (open enrollment or a special enrollment period after losing other coverage)`,
    `- **Medicaid** depending on income and state`,
    ``,
    `If anything about that situation is different — they are disabled and claimed as a tax dependent, for example — AmeriVet HR can confirm the edge-case rules at **${HR_PHONE}**.`,
  ].join('\n');
}

function isMedicalDetailQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(coverage\s+tier|coverage\s+tiers|copay|copays|coinsurance|deductible|out[- ]of[- ]pocket|oop\s*max|primary\s+care|pcp|specialist|urgent\s+care|emergency\s+room|er|network|in[- ]network|out[- ]of[- ]network|ppo|hmo|bcbstx|blue\s+cross\s+blue\s+shield|prescriptions?|drugs?|generic|brand|specialty|maternity|pregnan\w*|delivery|prenatal|postnatal|therapy|therapist|physical\s+therapy|mental\s+health|virtual\s+visits?|telehealth(?:\s+visits?)?|telemedicine|tradeoffs?|differences?\s+between\s+the\s+plans|compare\s+the\s+plans|compare\s+the\s+plan\s+tradeoffs?)\b/i.test(lower)
    || (/\b(cost|costs|what\s+would\s+i\s+pay|what\s+are\s+my\s+costs|if\s+i\s+use)\b/i.test(lower) && /\b(standard|standard hsa|enhanced|enhanced hsa|kaiser|kaiser hmo)\b/i.test(lower));
}

function isGlobalMedicalDefinitionQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(what\s+does\s+ppo\s+(?:mean|stand\s+for)|what'?s\s+(?:a\s+)?ppo|what\s+is\s+(?:a\s+)?ppo|define\s+ppo|what\s+does\s+hmo\s+(?:mean|stand\s+for)|what'?s\s+(?:an?\s+)?hmo|what\s+is\s+(?:an?\s+)?hmo|define\s+hmo|what'?s\s+bcbstx|what\s+is\s+bcbstx|what\s+does\s+bcbstx\s+(?:mean|stand\s+for)|define\s+bcbstx|what\s+is\s+blue\s+cross\s+blue\s+shield\s+of\s+texas)\b/i.test(lower);
}

function buildMedicalScenarioOverrideQuery(session: Session, query: string): string {
  const recentUserContext = (session.messages || [])
    .filter((message) => message.role === 'user')
    .slice(-6)
    .map((message) => message.content)
    .join('\n');

  return recentUserContext ? `${recentUserContext}\n${query}` : query;
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

function isGuidanceAdvanceAffirmation(query: string): boolean {
  const normalized = query.trim().replace(/[.!?]+$/g, '');
  return /^(yes|yes please|yeah|yep|sure|do that|do this|do it|go ahead|let'?s do that|let'?s do this|let'?s do it|show me that one|next one)$/i.test(normalized);
}

function isLifeSizingDecisionQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(which\s+one\s+should\s+i\s+get|which\s+ones\s+should\s+i\s+get|which\s+of\s+those\s+should\s+i\s+get|which\s+should\s+i\s+get|what\s+do\s+you\s+recommend|what\s+would\s+you\s+recommend|would\s+you\s+recommend|how\s+much\s+should\s+i\s+get|how\s+much\s+coverage\s+should\s+i\s+get|how\s+much\s+would\s+you\s+recommend|what\s+amount\s+would\s+you\s+recommend|how\s+much\s+protection\s+is\s+worth\s+paying|help\s+me\s+think\s+through\s+that|how\s+much\s+of\s+each|which\s+split\s+would\s+you\s+use|what\s+split\s+do\s+you\s+recommend)\b/i.test(lower);
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

function primeSupplementalRecommendationFollowup(session: Session, topic: string) {
  if (topic === 'Life Insurance') {
    setPendingGuidance(session, 'life_sizing', 'Life Insurance');
    return;
  }

  if (topic === 'Disability') {
    setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
    return;
  }

  if (topic === 'Accident/AD&D' || topic === 'Critical Illness') {
    setPendingGuidance(session, 'accident_vs_critical', 'Accident/AD&D');
    return;
  }

  setPendingGuidance(session, 'supplemental_fit', topic === 'Life Insurance' ? 'Life Insurance' : 'Supplemental');
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

function sessionHasDependents(session: Session): boolean {
  return /employee\s+\+\s+(spouse|child|family)/i.test(session.coverageTierLock || '')
    || Boolean(session.familyDetails?.hasSpouse)
    || Boolean((session.familyDetails?.numChildren || 0) > 0);
}

function hasCoveredTopic(session: Session, topic: string, currentTopic?: string | null): boolean {
  return (currentTopic || session.currentTopic || null) === topic
    || (session.completedTopics || []).includes(topic);
}

function nextUncoveredTopic(
  session: Session,
  topics: string[],
  currentTopic?: string | null,
): string | null {
  return topics.find((candidate) => !hasCoveredTopic(session, candidate, currentTopic)) || null;
}

function guidanceTopicLabel(topic: string): string {
  if (topic === 'Life Insurance') return 'life insurance';
  if (topic === 'Accident/AD&D') return 'accident coverage';
  if (topic === 'HSA/FSA') return 'HSA/FSA';
  return topic.toLowerCase();
}

function buildGuidancePivotPrompt(primaryTopic: string, alternateTopic?: string | null): string {
  const primaryLabel = guidanceTopicLabel(primaryTopic);
  if (!alternateTopic) {
    return `If you want, I can take you straight into **${primaryLabel}** next.`;
  }

  return `If you want, I can take you straight into **${primaryLabel}** next, or we can jump to **${guidanceTopicLabel(alternateTopic)}** first if that matters more.`;
}

function buildPackageGuidance(session: Session, topic?: string | null): string {
  const completed = new Set(session.completedTopics || []);
  const currentTopic = topic || session.currentTopic || null;
  const hasDependents = sessionHasDependents(session);
  const hasMedical = hasCoveredTopic(session, 'Medical', currentTopic);
  const hasHsaFsa = hasCoveredTopic(session, 'HSA/FSA', currentTopic);
  const nextRoutineTopic = nextUncoveredTopic(session, ['Dental', 'Vision'], currentTopic);
  const nextProtectionTopic = nextUncoveredTopic(session, ['Life Insurance', 'Disability'], currentTopic);
  const nextSupplementalTopic = nextUncoveredTopic(session, ['Critical Illness', 'Accident/AD&D'], currentTopic);
  const selectedPlan = session.selectedPlan || '';
  const selectedMedicalPath = /Kaiser Standard HMO|Standard HSA|Enhanced HSA/i.test(selectedPlan)
    ? selectedPlan
    : null;
  const hsaRelevantMedicalPath = /Kaiser Standard HMO|Standard HSA|Enhanced HSA/i.test(selectedPlan);

  switch (currentTopic) {
    case 'Medical':
      if (!hasHsaFsa && hsaRelevantMedicalPath) {
        setPendingTopicSuggestion(session, 'HSA/FSA');
        return [
          selectedMedicalPath
            ? `Because you are leaning toward **${selectedMedicalPath}**, the next most useful step is usually **HSA/FSA** so the tax account matches the medical path.`
            : `The next most useful step is usually **HSA/FSA** so the tax account matches the medical path you are leaning toward.`,
          ``,
          /Kaiser Standard HMO/i.test(selectedPlan)
            ? `- Kaiser Standard HMO generally points you toward the FSA side of the decision rather than HSA eligibility`
            : `- Standard HSA and Enhanced HSA make the HSA-versus-FSA decision more important, because the account choice changes the tax side of the package`,
          nextRoutineTopic
            ? `- ${nextRoutineTopic} is the next routine-care decision after that if you still want to round out the package`
            : `- After that, we can move to the smaller add-ons if you still want more protection`,
          ``,
          buildGuidancePivotPrompt('HSA/FSA', nextRoutineTopic || nextProtectionTopic),
        ].join('\n');
      }

      if (hasDependents && nextRoutineTopic && nextProtectionTopic) {
        setPendingTopicSuggestion(session, nextRoutineTopic);
        return [
          `Since you appear to be covering more than just yourself, I would usually split the next step after medical into two lanes: **${guidanceTopicLabel(nextRoutineTopic)}** for routine care and **${guidanceTopicLabel(nextProtectionTopic)}** for protection.`,
          ``,
          `- ${nextRoutineTopic} is usually the better next move if your household expects cleanings, eye exams, glasses, contacts, or braces and you want to round out routine care coverage`,
          `- ${nextProtectionTopic === 'Life Insurance' ? 'Life insurance' : 'Disability'} is usually the better next move if income replacement or household protection matters more than routine care right now`,
          `- My default nudge here is usually **${guidanceTopicLabel(nextRoutineTopic)} first**, then **${guidanceTopicLabel(nextProtectionTopic)}** after that`,
          ``,
          buildGuidancePivotPrompt(nextRoutineTopic, nextProtectionTopic),
        ].join('\n');
      }

      if (hasDependents && nextProtectionTopic) {
        setPendingTopicSuggestion(session, nextProtectionTopic);
        return [
          `Since you appear to be covering more than just yourself, the next most useful step after medical is usually **${nextProtectionTopic === 'Life Insurance' ? 'life insurance' : 'disability'}**.`,
          ``,
          `- ${nextProtectionTopic === 'Life Insurance' ? 'Life insurance helps if other people would need support or income replacement if something happened to you' : 'Disability helps if missing part of your paycheck would be the more immediate household risk'}`,
          `- ${nextProtectionTopic === 'Life Insurance' ? 'Disability is usually the companion protection decision after that, because paycheck protection matters too' : 'Life insurance is usually the companion protection decision after that if other people depend on your income'}`,
          nextRoutineTopic
            ? `- ${nextRoutineTopic} can come after that if you still want to round out routine care coverage`
            : `- After that, we can either tighten the tax-account fit or look at smaller supplemental add-ons`,
          ``,
          buildGuidancePivotPrompt(nextProtectionTopic, nextRoutineTopic),
        ].join('\n');
      }

      if (nextRoutineTopic) {
        setPendingTopicSuggestion(session, nextRoutineTopic);
        return [
          `If you want to move on from medical, the most useful next step is usually **${nextRoutineTopic}** if routine care coverage matters.`,
          ``,
          `- ${nextRoutineTopic} helps round out the everyday-care side of the package`,
          nextProtectionTopic
            ? `- ${nextProtectionTopic === 'Life Insurance' ? 'Life insurance' : 'Disability'} is the more important move first if family or paycheck protection matters more than routine care`
            : `- If routine care is settled, we can move to protection benefits next`,
          ``,
          buildGuidancePivotPrompt(nextRoutineTopic, nextProtectionTopic),
        ].join('\n');
      }

      if (nextProtectionTopic) {
        setPendingTopicSuggestion(session, nextProtectionTopic);
        return [
          `If you want to move on from medical, the next most useful step is usually **${nextProtectionTopic === 'Life Insurance' ? 'life insurance' : 'disability'}**.`,
          ``,
          `- That is usually the next package decision once the core medical choice is settled`,
          nextSupplementalTopic
            ? `- After that, we can compare ${nextSupplementalTopic === 'Critical Illness' ? 'critical illness' : 'accident coverage'} if you want extra cash-support protection`
            : `- After that, we can either tighten the tax-account fit or wrap up the smaller add-ons`,
          ``,
          buildGuidancePivotPrompt(nextProtectionTopic, nextSupplementalTopic),
        ].join('\n');
      }

      return [
        `If you want to move on from medical, the next most useful step is usually one of these:`,
        ``,
        `- HSA/FSA if you want to make sure the tax-account side matches the medical path you picked`,
        `- Accident or critical illness if you still want extra cash-support protection on top of the core package`,
        ``,
        `If you want, I can take you straight into **HSA/FSA** next.`,
      ].join('\n');
    case 'Dental':
      if (!hasMedical) {
        setPendingTopicSuggestion(session, 'Medical');
        return [
          `If you want to keep going after dental, the next most useful step is usually **medical** because that is still the bigger core coverage decision.`,
          ``,
          `- Medical drives the biggest premium, deductible, and out-of-pocket exposure`,
          `- After that, we can come back to vision or protection benefits depending on what matters more`,
        ].join('\n');
      }

      if (!completed.has('Vision')) {
        setPendingTopicSuggestion(session, 'Vision');
        return [
          `Since dental is usually a yes/no decision rather than a plan comparison, the next useful step is usually **vision** if routine care matters for your household.`,
          ``,
          `- Vision is the natural companion if you expect eye exams, glasses, or contacts`,
          nextProtectionTopic
            ? `- ${nextProtectionTopic === 'Life Insurance' ? 'Life insurance' : 'Disability'} matters more first if family or paycheck protection is the bigger concern`
            : `- If routine care is settled, we can move to protection benefits after that`,
        ].join('\n');
      }

      if (hasDependents && nextProtectionTopic) {
        setPendingTopicSuggestion(session, nextProtectionTopic);
        return [
          `Since routine care questions look more settled, the next most useful area is usually **${nextProtectionTopic === 'Life Insurance' ? 'life insurance' : 'disability'}**.`,
          ``,
          `- That is usually the bigger next decision for a household beyond dental and vision`,
          nextSupplementalTopic
            ? `- After that, we can compare ${nextSupplementalTopic === 'Critical Illness' ? 'critical illness' : 'accident coverage'} if you want extra cash-support protection`
            : `- After that, we can tighten any remaining tax-account or supplemental questions`,
          ``,
          buildGuidancePivotPrompt(nextProtectionTopic, nextSupplementalTopic),
        ].join('\n');
      }

      if (!hasHsaFsa && hsaRelevantMedicalPath) {
        setPendingTopicSuggestion(session, 'HSA/FSA');
        return [
          `Since routine care questions look more settled, the next most useful step is usually **HSA/FSA** so the tax-account side matches your medical path.`,
          ``,
          `- That matters more once the core medical decision is already in place`,
          `- After that, we can still move to life, disability, or supplemental protection if needed`,
        ].join('\n');
      }

      return [
        `Since you have already looked at vision too, the next most useful area is usually:`,
        ``,
        `- life, disability, or supplemental protection`,
      ].join('\n');
    case 'Vision':
      if (!hasMedical) {
        setPendingTopicSuggestion(session, 'Medical');
        return [
          `If you want to keep going after vision, the next most useful step is usually **medical** because that is still the bigger core coverage decision.`,
          ``,
          `- Medical drives the biggest premium, deductible, and out-of-pocket exposure`,
          `- After that, we can come back to dental or protection benefits depending on what matters more`,
        ].join('\n');
      }

      if (!completed.has('Dental')) {
        setPendingTopicSuggestion(session, 'Dental');
        return [
          `Since vision is usually a yes/no decision rather than a plan comparison, the next useful step is usually **dental** if routine care matters for your household.`,
          ``,
          `- Dental is the natural companion if you expect cleanings, fillings, crowns, or orthodontic use`,
          nextProtectionTopic
            ? `- ${nextProtectionTopic === 'Life Insurance' ? 'Life insurance' : 'Disability'} matters more first if family or paycheck protection is the bigger concern`
            : `- If routine care is settled, we can move to protection benefits after that`,
        ].join('\n');
      }

      if (hasDependents && nextProtectionTopic) {
        setPendingTopicSuggestion(session, nextProtectionTopic);
        return [
          `Since routine care questions look more settled, the next most useful area is usually **${nextProtectionTopic === 'Life Insurance' ? 'life insurance' : 'disability'}**.`,
          ``,
          `- That is usually the bigger next decision for a household beyond dental and vision`,
          nextSupplementalTopic
            ? `- After that, we can compare ${nextSupplementalTopic === 'Critical Illness' ? 'critical illness' : 'accident coverage'} if you want extra cash-support protection`
            : `- After that, we can tighten any remaining tax-account or supplemental questions`,
          ``,
          buildGuidancePivotPrompt(nextProtectionTopic, nextSupplementalTopic),
        ].join('\n');
      }

      if (!hasHsaFsa && hsaRelevantMedicalPath) {
        setPendingTopicSuggestion(session, 'HSA/FSA');
        return [
          `Since routine care questions look more settled, the next most useful step is usually **HSA/FSA** so the tax-account side matches your medical path.`,
          ``,
          `- That matters more once the core medical decision is already in place`,
          `- After that, we can still move to life, disability, or supplemental protection if needed`,
        ].join('\n');
      }

      return [
        `Since you have already looked at dental too, the next most useful area is usually:`,
        ``,
        `- life, disability, or supplemental protection`,
      ].join('\n');
    case 'Life Insurance':
      if (!completed.has('Disability')) {
        setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
        setPendingTopicSuggestion(session, 'Disability');
        return [
          `If you want to keep going after life insurance, the most useful next comparison is usually **disability**.`,
          ``,
          `- Life protects the household if something happens to you`,
          `- Disability protects the paycheck if you are unable to work but still living with the ongoing bills`,
          !hasHsaFsa && hsaRelevantMedicalPath
            ? selectedMedicalPath
              ? `- Once the core protection choices are clearer, **HSA/FSA** is the next tax-account fit decision for **${selectedMedicalPath}**`
              : `- Once the core protection choices are clearer, **HSA/FSA** is the next tax-account fit decision so the medical path and account choice stay aligned`
            : '',
          nextSupplementalTopic
            ? `- After that, we can look at ${nextSupplementalTopic === 'Critical Illness' ? 'critical illness' : 'accident coverage'} if you want smaller cash-support add-ons`
            : `- After that, we can wrap up any smaller add-on questions`,
          ``,
          !hasHsaFsa && hsaRelevantMedicalPath
            ? buildGuidancePivotPrompt('Disability', 'HSA/FSA')
            : '',
        ].filter(Boolean).join('\n');
      }

      if (!hasMedical) {
        setPendingTopicSuggestion(session, 'Medical');
        return [
          `If you want to keep going after life insurance, the next most useful move is usually **medical** if you still have not settled the core plan choice.`,
          ``,
          `- Medical is still the biggest cost-risk decision in the package`,
          `- After that, we can return to the smaller add-ons if you want more protection`,
        ].join('\n');
      }

      if (!hasHsaFsa && hsaRelevantMedicalPath) {
        setPendingTopicSuggestion(session, 'HSA/FSA');
        return [
          `If you want to keep going after life insurance, the most useful next step is usually **HSA/FSA** so the tax-account side matches your medical path.`,
          ``,
          `- You have already looked at the main household-protection question, so the cleaner remaining package-fit decision is whether the tax account matches the medical path`,
          selectedMedicalPath
            ? `- Because you are leaning toward **${selectedMedicalPath}**, the HSA/FSA choice now affects how well the package fits together`
            : `- That matters more now because the medical path is already clearer than the remaining smaller add-ons`,
          nextSupplementalTopic
            ? `- After that, we can still compare ${nextSupplementalTopic === 'Critical Illness' ? 'critical illness' : 'accident coverage'} if you want smaller cash-support add-ons`
            : `- After that, we can wrap up any smaller add-on questions`,
          ``,
          buildGuidancePivotPrompt('HSA/FSA', nextSupplementalTopic),
        ].join('\n');
      }

      return [
        `If you want to keep going after life insurance, the most useful next comparison is usually:`,
        ``,
        `- Disability for paycheck protection`,
        `- Critical illness or accident coverage for extra cash-support protection`,
      ].join('\n');
    case 'Disability':
      if (!completed.has('Life Insurance')) {
        setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
        setPendingTopicSuggestion(session, 'Life Insurance');
        return [
          `If you want to keep going after disability, the most useful companion benefit is usually **life insurance**.`,
          ``,
          `- Disability protects the paycheck while you are alive but unable to work`,
          `- Life insurance protects the household if you are no longer there to provide that income`,
          !hasHsaFsa && hsaRelevantMedicalPath
            ? selectedMedicalPath
              ? `- Once the core protection choices are clearer, **HSA/FSA** is the next tax-account fit decision for **${selectedMedicalPath}**`
              : `- Once the core protection choices are clearer, **HSA/FSA** is the next tax-account fit decision so the medical path and account choice stay aligned`
            : '',
          nextSupplementalTopic
            ? `- After that, we can look at ${nextSupplementalTopic === 'Critical Illness' ? 'critical illness' : 'accident coverage'} if you want smaller cash-support add-ons`
            : `- After that, we can wrap up any smaller add-on questions`,
          ``,
          !hasHsaFsa && hsaRelevantMedicalPath
            ? buildGuidancePivotPrompt('Life Insurance', 'HSA/FSA')
            : '',
        ].filter(Boolean).join('\n');
      }

      if (!hasMedical) {
        setPendingTopicSuggestion(session, 'Medical');
        return [
          `If you want to keep going after disability, the next most useful move is usually **medical** if you still have not settled the core plan choice.`,
          ``,
          `- Medical is still the biggest cost-risk decision in the package`,
          `- After that, we can return to the smaller add-ons if you want more protection`,
        ].join('\n');
      }

      if (!hasHsaFsa && hsaRelevantMedicalPath) {
        setPendingTopicSuggestion(session, 'HSA/FSA');
        return [
          `If you want to keep going after disability, the next most useful step is usually **HSA/FSA** so the tax-account side matches your medical path.`,
          ``,
          `- You have already looked at the main income-protection question, so the cleaner remaining package-fit decision is whether the tax account matches the medical path`,
          selectedMedicalPath
            ? `- Because you are leaning toward **${selectedMedicalPath}**, the HSA/FSA choice now affects how well the package fits together`
            : `- That matters more now because the medical path is already clearer than the remaining smaller add-ons`,
          nextSupplementalTopic
            ? `- After that, we can still compare ${nextSupplementalTopic === 'Critical Illness' ? 'critical illness' : 'accident coverage'} if you want smaller cash-support add-ons`
            : `- After that, we can wrap up any smaller add-on questions`,
          ``,
          buildGuidancePivotPrompt('HSA/FSA', nextSupplementalTopic),
        ].join('\n');
      }

      return [
        `If you want to keep going after disability, the most useful companion benefit is usually:`,
        ``,
        `- Life insurance`,
        `- Critical illness or accident coverage depending on how much extra protection you want`,
      ].join('\n');
    case 'Critical Illness':
      if (hasDependents && nextProtectionTopic) {
        setPendingTopicSuggestion(session, nextProtectionTopic);
        return [
          `Before you spend more time on smaller add-ons, the next most useful step is usually **${nextProtectionTopic === 'Life Insurance' ? 'life insurance' : 'disability'}**.`,
          ``,
          `- That is usually the bigger household-protection decision`,
          `- Critical illness works better as an extra layer after the core protection choices are in place`,
        ].join('\n');
      }

      if (!completed.has('Accident/AD&D')) {
        setPendingTopicSuggestion(session, 'Accident/AD&D');
        return [
          `If you want to keep going after critical illness, the next useful step is usually **accident coverage** if you want to compare the smaller cash-support add-ons.`,
          ``,
          `- Critical illness is more about diagnosis-triggered cash support`,
          `- Accident coverage is the cleaner contrast if the concern is injury risk`,
        ].join('\n');
      }

      if (!hasHsaFsa && hsaRelevantMedicalPath) {
        setPendingTopicSuggestion(session, 'HSA/FSA');
        return [
          `If you want to keep going after critical illness, the next useful step is usually **HSA/FSA** so the tax-account side matches your medical path.`,
          ``,
          `- That usually matters more than adding even more small payroll deductions`,
        ].join('\n');
      }

      return [
        `If you want to keep going after critical illness, the next useful step is usually:`,
        ``,
        `- Accident/AD&D if you want to compare supplemental cash-protection options`,
        `- HSA/FSA if you want to tighten the tax side of your benefits package`,
      ].join('\n');
    case 'Accident/AD&D':
      if (hasDependents && nextProtectionTopic) {
        setPendingTopicSuggestion(session, nextProtectionTopic);
        return [
          `Before you spend more time on smaller add-ons, the next most useful step is usually **${nextProtectionTopic === 'Life Insurance' ? 'life insurance' : 'disability'}**.`,
          ``,
          `- That is usually the bigger household-protection decision`,
          `- Accident coverage works better as an extra layer after the core protection choices are in place`,
        ].join('\n');
      }

      if (!completed.has('Critical Illness')) {
        setPendingTopicSuggestion(session, 'Critical Illness');
        return [
          `If you want to keep going after Accident/AD&D, the next useful step is usually **critical illness** if you want to compare the smaller cash-support add-ons.`,
          ``,
          `- Accident coverage is more about injury-triggered cash support`,
          `- Critical illness is the cleaner contrast if the concern is diagnosis risk`,
        ].join('\n');
      }

      if (!hasHsaFsa && hsaRelevantMedicalPath) {
        setPendingTopicSuggestion(session, 'HSA/FSA');
        return [
          `If you want to keep going after Accident/AD&D, the next useful step is usually **HSA/FSA** so the tax-account side matches your medical path.`,
          ``,
          `- That usually matters more than adding even more small payroll deductions`,
        ].join('\n');
      }

      return [
        `If you want to keep going after Accident/AD&D, the next useful step is usually:`,
        ``,
        `- Critical illness for a diagnosis-risk comparison`,
        `- HSA/FSA if you want to round out the tax side of the package`,
      ].join('\n');
    case 'HSA/FSA':
      if (!hasMedical) {
        setPendingTopicSuggestion(session, 'Medical');
        return [
          `From here, the most useful next step is usually **medical** so the tax account matches the plan you are actually comparing.`,
          ``,
          `- HSA versus FSA only makes full sense once the medical path is clearer`,
          `- After that, we can decide whether routine care or protection benefits deserve attention next`,
        ].join('\n');
      }

      if (hasDependents && nextProtectionTopic) {
        setPendingTopicSuggestion(session, nextProtectionTopic);
        return [
          `From here, the most useful next step is usually **${nextProtectionTopic === 'Life Insurance' ? 'life insurance' : 'disability'}** if the household depends on your income.`,
          ``,
          `- The tax-account choice is helpful, but household protection is usually the bigger remaining decision`,
          nextRoutineTopic
            ? `- ${nextRoutineTopic} can come after that if you still want routine care coverage`
            : `- After that, we can wrap up any smaller add-on questions`,
          ``,
          buildGuidancePivotPrompt(nextProtectionTopic, nextRoutineTopic),
        ].join('\n');
      }

      if (nextRoutineTopic) {
        setPendingTopicSuggestion(session, nextRoutineTopic);
        return [
          `From here, the most useful next step is usually **${nextRoutineTopic}** if you still want routine care coverage on top of the medical plan.`,
          ``,
          `- That is usually the next practical coverage decision once the tax-account fit is settled`,
          nextProtectionTopic
            ? `- ${nextProtectionTopic === 'Life Insurance' ? 'Life insurance' : 'Disability'} matters more first if household protection is the bigger concern`
            : `- After that, we can wrap up any smaller add-on questions`,
        ].join('\n');
      }

      return [
        `From here, the most useful next step is usually:`,
        ``,
        `- Wrapping up any remaining supplemental-protection questions`,
        `- Closing out any loose routine-care questions`,
      ].join('\n');
    default:
      if (hasDependents) {
        setPendingTopicSuggestion(session, 'Life Insurance');
      } else if (!hasMedical) {
        setPendingTopicSuggestion(session, 'Medical');
      }
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
function isShortRecommendationAsk(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const stripped = lower.replace(/^(?:so|well|hmm|ok(?:ay)?|alright|right)\b[\s,.\-]*/i, '').trim();
  return /^(?:what'?s\s+your\s+recommendation|what\s+is\s+your\s+recommendation|what\s+do\s+you\s+recommend|give\s+me\s+your\s+recommendation|your\s+recommendation|which\s+(?:one|plan|option)\s+(?:will\s+be|is\s+going\s+to\s+be|would\s+be|ends\s+up(?:\s+being)?|is)\s+(?:the\s+)?(?:cheapest|lowest|least\s+expensive|most\s+affordable|cheaper)|which\s+(?:one|plan|option)\s+is\s+cheapest|(?:cheapest|least\s+expensive|most\s+affordable)\s+(?:plan|option|one))\s*\??\s*$/i.test(stripped);
}

// Apr 21 Step 5: detects "just pick one / just give me the answer / skip the
// clarifier" phrasings. When this fires alongside a recommendation ask, we
// tell `buildRecommendationOverview` to commit rather than route through the
// low/moderate/high clarifier. This is the direct fix for "I already got the
// considerations, just give me a recommendation."
function isJustCommitRecommendationAsk(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(just\s+(?:pick|tell|give|commit|recommend|choose)|pick\s+one(?:\s+already)?|give\s+me\s+(?:a|an|the|your)\s+(?:direct\s+)?answer|give\s+me\s+an?\s+answer|skip\s+the\s+(?:clarifier|questions?)|i\s+(?:just\s+)?want\s+(?:a|an|the|your)\s+(?:direct\s+)?(?:answer|recommendation|rec)|i\s+(?:already\s+)?(?:saw|got|have)\s+(?:the\s+)?considerations?|you\s+already\s+gave\s+me\s+(?:the\s+)?considerations?|jump\s+(?:right\s+)?to\s+(?:what\s+)?you(?:'d|\s+would)?\s+recommend|what\s+would\s+you\s+pick|what\s+would\s+you\s+choose|just\s+(?:an?\s+)?answer\s+(?:please|already))\b/i.test(lower);
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
  return /\b(life(?:\s+insurance)?|term life|vol(?:untary)?\s+term(?:\s+life)?|vol(?:untary)?\s+life|whole life|basic life|perm(?:anent)?(?:\s+life)?).*\b(wife|husband|spouse|partner|kids|children|family|dependents?|cover|coverage|benefits?|qualify|portable|guaranteed issue|cash value|how much)\b|\b(wife|husband|spouse|partner|kids|children|family|dependents?|cover|coverage|benefits?|qualify|portable|guaranteed issue|cash value|how much)\b.*\b(life(?:\s+insurance)?|term life|vol(?:untary)?\s+term(?:\s+life)?|vol(?:untary)?\s+life|whole life|basic life|perm(?:anent)?(?:\s+life)?)\b/i.test(lower);
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

function isHsaFsaCompatibilityQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (isMedicalPlanComparisonOrPricingQuestion(query) || isCostModelRequest(query) || isMedicalDetailQuestion(query)) {
    return false;
  }
  return /\b(fsa|hsa)\b.*\b(kaiser|hmo)\b|\b(kaiser|hmo)\b.*\b(fsa|hsa)\b|\bshould\s+i\s+use\s+an?\s+fsa\b|\bshould\s+i\s+use\s+fsa\b|\buse\s+an?\s+fsa\b|\buse\s+fsa\b|\bcan\s+i\s+(?:still\s+)?use\s+an?\s+hsa\b|\bcan\s+i\s+(?:still\s+)?use\s+hsa\b|\bcan(?:not|'t)\s+use\s+an?\s+hsa\b|\b(hsa|fsa)\b.*\b(pair\s+best\s+with|go\s+best\s+with|fit\s+best\s+with)\b|\b(pair\s+best\s+with|go\s+best\s+with|fit\s+best\s+with)\b.*\b(hsa|fsa)\b/i.test(lower);
}

function isDirectMedicalContinuationQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return isDirectMedicalRecommendationQuestion(query)
    || isMedicalRecommendationPreferenceFollowup(query)
    || isMedicalDetailQuestion(query)
    || isMedicalPlanComparisonOrPricingQuestion(query)
    || /\b(which\s+plan\s+is\s+best\s+for\s+my\s+family|which\s+plan\s+is\s+best|which\s+plan\s+is\s+better|which\s+one\s+do\s+you\s+recommend|best\s+choice\s+for\s+my\s+family|what\s+plan\s+will\s+give\s+us\s+the\s+lowest|other\s+standard\s+plan|other\s+plan|plan\s+tradeoffs?|medical\s+options|medical\s+plan\s+options|show\s+me\s+(?:my\s+)?(?:medical\s+)?options|show\s+me\s+the\s+plans|plans\s+side\s+by\s+side|side\s+by\s+side|let'?s\s+talk\s+(?:thru|through)\s+which\s+plan|talk\s+(?:thru|through)\s+which\s+plan|talk\s+me\s+through\s+which\s+plan|talk\s+through\s+which\s+option\s+fits\s+better|talk\s+through\s+why\s+one\s+option\s+fits\s+better|which\s+option\s+fits\s+better|best\s+choice\s+for\s+my\s+family|best\s+for\s+my\s+family|better\s+for\s+me|better\s+for\s+us)\b/i.test(lower);
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

function isExcludedTopicMention(queryLower: string, topicPattern: string): boolean {
  return new RegExp(
    `\\b(?:other\\s+than|except(?:\\s+for)?|besides|anything\\s+but|not\\s+including)\\b[^.?!]{0,40}\\b${topicPattern}\\b|\\b${topicPattern}\\b[^.?!]{0,20}\\b(?:other\\s+than|except(?:\\s+for)?|besides|anything\\s+but|not\\s+including)\\b`,
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
    Medical: /^(medical|health|medical plans?|medical options?|kaiser|hsa plans?)(?:\s+next)?(?:\s+please)?$/,
    Dental: /^dental(?:\s+next)?(?:\s+please)?$/,
    Vision: /^(vision|eye|glasses|contacts)(?:\s+next)?(?:\s+please)?$/,
    'Life Insurance': /^(life|life insurance|life ins|term life|vol(?:untary)? term|vol(?:untary)? life|whole life|basic life|perm|permanent(?: life)?)(?:\s+next)?(?:\s+please)?$/,
    Disability: /^(disability|std|ltd)(?:\s+next)?(?:\s+please)?$/,
    'Critical Illness': /^(critical illness|illness|ci|ci insurance)(?:\s+next)?(?:\s+please)?$/,
    'Accident/AD&D': /^(accident|ad&d|ad d|ad\/d)(?:\s+next)?(?:\s+please)?$/,
    'HSA/FSA': /^(hsa|fsa|hsa fsa|hsa\/fsa)(?:\s+next)?(?:\s+please)?$/,
  };

  if (topicPatterns[topic]?.test(normalized)) return true;

  const guidedPivotPatterns: Record<string, RegExp> = {
    Medical: /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:medical|health|medical plans?|medical options?|kaiser|hsa plans?)(?:\s+next)?(?:\s+please)?$/,
    Dental: /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?dental(?:\s+next)?(?:\s+please)?$/,
    Vision: /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:vision|eye|glasses|contacts)(?:\s+next)?(?:\s+please)?$/,
    'Life Insurance': /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:life|life insurance|life ins|term life|vol(?:untary)? term|vol(?:untary)? life|whole life|basic life|perm|permanent(?: life)?)(?:\s+next)?(?:\s+please)?$/,
    Disability: /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:disability|std|ltd)(?:\s+next)?(?:\s+please)?$/,
    'Critical Illness': /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:critical illness|illness|ci|ci insurance)(?:\s+next)?(?:\s+please)?$/,
    'Accident/AD&D': /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:accident|ad&d|ad d|ad\/d)(?:\s+next)?(?:\s+please)?$/,
    'HSA/FSA': /^(?:show me|tell me about|let s do|lets do|do|look at|move to|move on to)\s+(?:my\s+)?(?:hsa|fsa|hsa fsa|hsa\/fsa)(?:\s+next)?(?:\s+please)?$/,
  };

  return guidedPivotPatterns[topic]?.test(normalized) || false;
}

function canonicalTopicQuery(topic: string, query: string): string {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (topic === 'Medical') {
    if (isDirectMedicalRecommendationQuestion(query)) return query;
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
  return /\b(go\s+back\s+to\s+(?:my\s+)?medical|back\s+to\s+(?:my\s+)?medical|back\s+to\s+(?:my\s+)?medical\s+plan\s+options|done\s+with\s+hsa\/fsa|done\s+with\s+hsa|done\s+with\s+fsa|medical\s+plan\s+options|show\s+me\s+(?:my\s+)?medical\s+plan\s+options|show\s+me\s+(?:my\s+)?medical\s+options|show\s+me\s+my\s+options|show\s+me\s+the\s+plans|plans\s+side\s+by\s+side|side\s+by\s+side|compare\s+the\s+plans|just\s+want\s+to\s+see\s+(?:the\s+)?plans?|just\s+wanna\s+see\s+(?:the\s+)?plans?|breakdown\s+of\s+(?:(?:each\s+of\s+)?(?:those|these)\s+plans?|each\s+plan)|just\s+plan\s+pricing)\b/i.test(lower);
}

function isNegativeSupplementalToMedicalPivot(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (!isReturnToMedicalIntent(query)) return false;

  const declineSignal = /\b(don'?t\s+really\s+care\s+about|do\s+not\s+really\s+care\s+about|don'?t\s+care\s+about|do\s+not\s+care\s+about|done\s+with|skip|other\s+than|not\s+focused\s+on|not\s+worrying\s+about|not\s+thinking\s+about)\b/i.test(lower);
  const supplementalTopicSignal = /\b(life(?:\s+insurance)?|term\s+life|whole\s+life|basic\s+life|disability|critical(?:\s+illness)?|ci|accident(?:\/ad&d)?|ad&d|ad\/d|hsa|fsa|hsa\/fsa)\b/i.test(lower);

  return declineSignal && supplementalTopicSignal;
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
  return /\b(which\s+benefits?\s+should\s+i\s+(?:get|take)|which\s+benefits?\s+do\s+you\s+recommend|which\s+ones?\s+would\s+you\s+recommend\s+i\s+get|what\s+benefits?\s+should\s+i\s+(?:get|take)|what\s+other\s+benefits?\s+should\s+i\s+get|should\s+i\s+get\s+any\s+of\s+the\s+other\s+benefits|knowing\s+what\s+you\s+know\s+about\s+me|based\s+on\s+what\s+you\s+know\s+about\s+me|what\s+would\s+you\s+do\s+if\s+you\s+were\s+me(?:\s+with\s+(?:these|my)\s+(?:benefits|coverage|package))?|if\s+you\s+were\s+me(?:\s+with\s+(?:these|my)\s+(?:benefits|coverage|package))?\s+what\s+would\s+you\s+(?:get|do)|how\s+would\s+you\s+prioriti[sz]e\s+(?:my|these)?\s*(?:benefits|coverage|package)|what\s+should\s+i\s+prioriti[sz]e\s+next\s+(?:with|for)\s+(?:my|these)?\s*(?:benefits|coverage|package)|what\s+should\s+i\s+get\s+next\s+(?:with|for)\s+(?:my|these)?\s*(?:benefits|coverage|package))\b/i.test(lower);
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
  const currentTopic = session.currentTopic || '';
  const completedTopics = new Set(session.completedTopics || []);
  const lastBot = (session.lastBotMessage || '').toLowerCase();
  const selectedPlanContext = `${session.selectedPlan || ''}\n${session.lastBotMessage || ''}\n${query}`;
  const hsaQualifiedPath = /Enhanced HSA|Standard HSA/i.test(selectedPlanContext);
  const hsaPlanLabel = /Enhanced HSA/i.test(selectedPlanContext)
    ? 'Enhanced HSA'
    : /Standard HSA/i.test(selectedPlanContext)
      ? 'Standard HSA'
      : 'your HSA-qualified medical plan';
  const kaiserPath = /Kaiser Standard HMO/i.test(selectedPlanContext);
  const medicalAlreadyInMotion = currentTopic === 'Medical'
    || completedTopics.has('Medical')
    || /medical plan options|monthly medical premiums|practical tradeoff across amerivet's medical options|recommendation for .* coverage|deductible|out-of-pocket max/i.test(lastBot);
  const lifeAlreadyInMotion = currentTopic === 'Life Insurance'
    || completedTopics.has('Life Insurance')
    || /life insurance options:|voluntary term life|whole life|basic life|80% voluntary term life/i.test(lastBot);
  const protectionPriority = soleBreadwinner || hasSpouse || numChildren > 0;

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

  if (medicalAlreadyInMotion) {
    lines.push(`- **Medical is already the active anchor**, so I would mainly use it to decide what deserves the next dollar after the core plan is settled`);
  }

  if (medicalAlreadyInMotion && hsaQualifiedPath) {
    lines.push(`- **HSA/FSA right after the core medical choice**, because staying on **${hsaPlanLabel}** means the tax-account decision becomes part of the same healthcare-cost strategy`);
  } else if (medicalAlreadyInMotion && kaiserPath) {
    lines.push(`- **FSA only if pre-tax near-term spending matters**, because **Kaiser Standard HMO** is the non-HSA-qualified medical path`);
  }

  if (likelyTier !== 'Employee Only') {
    lines.push(`- **Use ${likelyTier} medical pricing as your working tier** once the household changes are active`);
  }

  if (protectionPriority) {
    setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
    lines.push(`- **Disability next**, because protecting the paycheck usually matters before smaller supplemental add-ons when other people depend on your income`);
    lines.push(`- **Life insurance after that**, especially if you want more protection than AmeriVet's employer-paid basic life benefit`);
    if (lifeAlreadyInMotion) {
      lines.push(`- **If extra life coverage is already clearly in play**, AmeriVet's default starting split is usually **${ACTIVE_LIFE_SPLIT_RULE?.recommendationLabel || `80% ${ACTIVE_TERM_LIFE_NAME} / 20% ${ACTIVE_WHOLE_LIFE_NAME}` }** — keep **${ACTIVE_TERM_LIFE_NAME}** as the main added protection layer on top of **${ACTIVE_BASIC_LIFE_NAME}** and use **${ACTIVE_WHOLE_LIFE_NAME}** as the smaller permanent layer`);
    }
  } else {
    setPendingGuidance(session, 'dental_vs_vision', 'Dental');
    lines.push(`- **Dental or vision next only if you already expect to use them**, because they are routine-care add-ons rather than the main financial-risk decision`);
  }

  if (numChildren > 0) {
    lines.push(`- **Dental and vision become more worth looking at after medical** if the kids will actually use cleanings, orthodontia, eye exams, glasses, or contacts`);
  } else {
    lines.push(`- **Dental and vision stay secondary** unless you already know you will use routine care enough to justify the added payroll deduction`);
  }

  lines.push(`- **Accident and critical illness last**, because they are usually optional extra cash-protection layers after medical and income protection are settled`);
  lines.push(``);
  if (protectionPriority && lifeAlreadyInMotion) {
    lines.push(
      hsaQualifiedPath
        ? `So if you want the shortest version: keep **medical** as the anchor, use **disability/life** as the next real protection decision, line up **HSA/FSA** with **${hsaPlanLabel}**, and if you already know you want extra life coverage I would usually start with **${ACTIVE_LIFE_SPLIT_RULE?.recommendationLabel || `80% ${ACTIVE_TERM_LIFE_NAME} / 20% ${ACTIVE_WHOLE_LIFE_NAME}` }** — make **${ACTIVE_TERM_LIFE_NAME}** do most of the income-protection job on top of **${ACTIVE_BASIC_LIFE_NAME}**, and keep **${ACTIVE_WHOLE_LIFE_NAME}** as the smaller permanent layer.`
        : `So if you want the shortest version: keep **medical** as the anchor, then use **disability/life** as the next real decision, and if you already know you want extra life coverage I would usually start with **${ACTIVE_LIFE_SPLIT_RULE?.recommendationLabel || `80% ${ACTIVE_TERM_LIFE_NAME} / 20% ${ACTIVE_WHOLE_LIFE_NAME}` }** — make **${ACTIVE_TERM_LIFE_NAME}** do most of the income-protection job on top of **${ACTIVE_BASIC_LIFE_NAME}**, and keep **${ACTIVE_WHOLE_LIFE_NAME}** as the smaller permanent layer.`,
    );
    lines.push(
      hsaQualifiedPath
        ? `If you want, I can help you decide whether **disability** or **HSA/FSA** deserves the next decision first.`
        : `If you want, I can help you decide whether **disability** or **extra life** deserves the next dollar first.`,
    );
  } else {
    lines.push(
      protectionPriority
        ? hsaQualifiedPath
          ? `So if you want the shortest version: I would usually settle **medical first**, then look at **disability/life**, then line up **HSA/FSA** with **${hsaPlanLabel}**, then decide whether **dental/vision** are worth adding, and only after that worry about **critical illness or accident**.`
          : `So if you want the shortest version: I would usually settle **medical first**, then look at **disability/life**, then decide whether **dental/vision** are worth adding, and only then worry about **critical illness or accident**.`
        : hsaQualifiedPath
          ? `So if you want the shortest version: I would usually settle **medical first**, line up **HSA/FSA** with **${hsaPlanLabel}**, then decide whether **dental/vision** are worth adding, then look at **disability/life**, and only after that consider **critical illness or accident**.`
          : `So if you want the shortest version: I would usually settle **medical first**, then decide whether **dental/vision** are worth adding, then look at **disability/life**, and only after that consider **critical illness or accident**.`,
    );
    lines.push(
      protectionPriority
        ? hsaQualifiedPath
          ? `If you want, I can help you decide whether **disability** or **HSA/FSA** deserves your next decision first.`
          : `If you want, I can help you decide whether **disability** or **life insurance** deserves your next decision first.`
        : hsaQualifiedPath
          ? `If you want, I can help you decide whether **HSA/FSA** or **dental/vision** deserves your next decision first.`
          : `If you want, I can help you decide whether **dental** or **vision** deserves your next decision first.`,
    );
  }

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
  return /\b(show\s+me\s+the\s+numbers(?:\s+again)?|show\s+me\s+the\s+monthly\s+numbers|show\s+me\s+how\s+much\s+i\s+have\s+to\s+pay\s+each\s+month|monthly\s+premiums?|per\s+month\s+on\s+each\s+plan|how\s+much\s+will\s+my\s+premium\s+be|how\s+much\s+(?:the\s+)?premiums?\s+are|what\s+are\s+the\s+premiums?|what\s+are\s+the\s+medical\s+plan\s+prices?|what\s+are\s+the\s+prices?\s+again|what\s+are\s+the\s+medical\s+plan\s+prices?\s+again|what\s+are\s+those\s+(?:medical\s+)?(?:plan\s+)?(?:prices?|premiums?)\s+again|what\s+about\s+those\s+(?:medical\s+)?(?:plan\s+)?(?:prices?|premiums?)\s+again|show\s+me\s+those\s+(?:plan\s+)?(?:prices?|premiums?)\s+again|show\s+me\s+those\s+plan\s+numbers\s+again|can\s+i\s+just\s+see\s+those\s+(?:plan\s+)?(?:prices?|premiums?)\s+again|what\s+would\s+the\s+premium\s+be|what\s+would\s+(?:i|we)\s+pay|what\s+would\s+it\s+cost|how\s+much\s+would\s+it\s+cost|how\s+much\s+are\s+the\s+family\s+medical\s+plans?|how\s+much\s+are\s+the\s+medical\s+plans?|what\s+does\s+(?:spouse|family|medical)\s+coverage\s+cost|cost\s+to\s+cover|show\s+me\s+.*pricing|pricing\s+for\s+employee|show\s+me\s+the\s+employee\s*\+|show\s+me\s+the\s+employee\s*\+\s*(?:family|spouse|child(?:ren)?)\s+(?:premiums|prices)|employee\s*\+\s*(?:family|spouse|child(?:ren)?)\s+pricing|employee\s*\+\s*(?:family|spouse|child(?:ren)?)\s+premiums|employee\s*\+\s*(?:family|spouse|child(?:ren)?)\s+prices|just\s+plan\s+pricing|what\s+about\s+just\s+plan\s+pricing|whole\s+family\s+pricing|show\s+me\s+the\s+family\s+prices|show\s+me\s+family\s+prices|family\s+prices|show\s+me\s+the\s+spouse\s+prices|spouse\s+prices|prices?\s+for\s+premiums?|show\s+me\s+the\s+prices|show\s+me\s+the\s+premiums|show\s+me\s+the\s+breakdown\s+of\s+(?:(?:each\s+of\s+)?(?:those|these)\s+plans?|each\s+plan)|breakdown\s+of\s+(?:(?:each\s+of\s+)?(?:those|these)\s+plans?|each\s+plan)|just\s+wanna\s+see\s+(?:the\s+)?plans?)\b/i.test(lower)
    || (
      /\bcover\s+(?:me|myself)\b/i.test(lower)
      && /\b(wife|husband|spouse|partner)\b/i.test(lower)
      && /\b(kids?|children|family)\b/i.test(lower)
      && /\b(price|prices|pricing|premium|premiums|per month|monthly|show me|what would (?:i|we) pay|what would it cost|how much would it cost)\b/i.test(lower)
    );
}

function recentAssistantHistory(session: Session, limit = 4): string {
  return (session.messages || [])
    .filter((message) => message.role === 'assistant')
    .slice(-limit)
    .map((message) => message.content.toLowerCase())
    .join('\n');
}

function contextualMedicalPricingReplayQuery(session: Session, query: string): string | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (!lower || isMedicalPremiumReplayQuestion(query) || isMedicalPlanComparisonOrPricingQuestion(query)) {
    return null;
  }

  if (/\b(therapy|therapist|mental\s+health|behavioral\s+health|counsel(?:ing|or)|specialist|doctor|visit|visits|prescriptions?|rx|drugs?|maternity|pregnan\w*|delivery|copay|copays|coinsurance|deductible|out[- ]of[- ]pocket|oop)\b/i.test(lower)) {
    return null;
  }

  const hasShortPricingSignal = /\b(what\s+will\s+that\s+cost|what\s+would\s+that\s+cost|how\s+much\s+would\s+that\s+be|how\s+much\s+would\s+that\s+cost|what\s+about\s+that\s+price|what\s+about\s+that\s+cost|what\s+about\s+the\s+family\s+price|what\s+about\s+family\s+pricing|what\s+about\s+spouse\s+pricing|how\s+much\s+would\s+that\s+be\s+for\s+my\s+spouse|how\s+much\s+would\s+that\s+be\s+for\s+my\s+family|and\s+what\s+about\s+the\s+price|and\s+what\s+would\s+that\s+be|what\s+are\s+those\s+(?:prices?|premiums?)\s+again|what\s+about\s+those\s+(?:prices?|premiums?)\s+again|show\s+me\s+those\s+(?:prices?|premiums?)\s+again|can\s+i\s+just\s+see\s+those\s+(?:prices?|premiums?)\s+again)\b/i.test(lower);
  if (!hasShortPricingSignal) {
    return null;
  }

  const lastBot = (session.lastBotMessage || '').toLowerCase();
  const assistantHistory = recentAssistantHistory(session);
  const activeTopic = session.currentTopic || inferTopicFromLastBotMessage(session.lastBotMessage);
  const hasEstablishedMedicalPricingContext = activeTopic === 'Medical'
    || /medical plan options|monthly medical premiums|side-by-side comparison for .* coverage|practical tradeoff across amerivet's medical options|want to compare plans or switch coverage tiers/i.test(lastBot)
    || /medical plan options|monthly medical premiums|side-by-side comparison for .* coverage|practical tradeoff across amerivet's medical options|want to compare plans or switch coverage tiers/i.test(assistantHistory);

  if (!hasEstablishedMedicalPricingContext) {
    return null;
  }

  if (/\b(spouse|wife|husband|partner)\b/i.test(lower)) {
    return 'show me the spouse prices';
  }

  if (/\b(family|whole family|kids?|children|sons?|daughters?)\b/i.test(lower)) {
    return 'show me the family prices';
  }

  const tier = session.coverageTierLock || coverageTierFromConversation(session) || 'Employee Only';
  if (/Spouse/i.test(tier)) return 'show me the spouse prices';
  if (/Family/i.test(tier)) return 'show me the family prices';
  if (/Child/i.test(tier)) return 'show me the employee + child pricing';
  return 'what are the medical plan prices again?';
}

function contextualMedicalPlanReplayQuery(session: Session, query: string): string | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (
    !lower
    || isMedicalPlanComparisonOrPricingQuestion(query)
    || isMedicalPremiumReplayQuestion(query)
    || isCostModelRequest(query)
    || isMedicalDetailQuestion(query)
  ) {
    return null;
  }

  const hasShortPlanReplaySignal = /\b(show\s+me\s+those\s+plans(?:\s+again)?|show\s+me\s+those\s+options(?:\s+again)?|show\s+me\s+that\s+breakdown(?:\s+again)?|show\s+me\s+that\s+comparison(?:\s+again)?|can\s+you\s+show\s+me\s+those\s+plans(?:\s+again)?|can\s+you\s+show\s+me\s+those\s+options(?:\s+again)?|can\s+you\s+show\s+me\s+that\s+breakdown(?:\s+again)?|can\s+you\s+show\s+me\s+that\s+comparison(?:\s+again)?)\b/i.test(lower);
  if (!hasShortPlanReplaySignal) {
    return null;
  }

  const lastBot = (session.lastBotMessage || '').toLowerCase();
  const assistantHistory = recentAssistantHistory(session);
  const activeTopic = session.currentTopic || inferTopicFromLastBotMessage(session.lastBotMessage);
  const hasEstablishedMedicalPlanContext = activeTopic === 'Medical'
    || /medical plan options|monthly medical premiums|side-by-side comparison for .* coverage|practical tradeoff across amerivet's medical options|want to compare plans or switch coverage tiers/i.test(lastBot)
    || /medical plan options|monthly medical premiums|side-by-side comparison for .* coverage|practical tradeoff across amerivet's medical options|want to compare plans or switch coverage tiers/i.test(assistantHistory);

  if (!hasEstablishedMedicalPlanContext) {
    return null;
  }

  if (/\b(breakdown|comparison)\b/i.test(lower) || /side-by-side comparison|practical tradeoff across amerivet's medical options/i.test(lastBot)) {
    return 'compare the plan tradeoffs';
  }

  return 'medical options';
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

function medicalInviteFollowupQuery(lastBotMessage: string): string | null {
  const followups: Array<{ pattern: RegExp; query: string }> = [
    {
      pattern: /compare AmeriVet's medical plans specifically on copays next/i,
      query: 'compare copays across the medical plans',
    },
    {
      pattern: /compare the AmeriVet medical plans on coinsurance next/i,
      query: 'compare coinsurance across the medical plans',
    },
    {
      pattern: /compare the AmeriVet plans specifically on deductible versus out-of-pocket max/i,
      query: 'compare the deductible and out-of-pocket max across the medical plans',
    },
    {
      pattern: /compare AmeriVet's plans specifically on primary care visit costs next/i,
      query: 'compare primary care visit costs across the medical plans',
    },
    {
      pattern: /compare AmeriVet's plans specifically on specialist visit costs next/i,
      query: 'compare specialist visit costs across the medical plans',
    },
    {
      pattern: /compare AmeriVet's plans specifically on urgent-care cost sharing next/i,
      query: 'compare urgent care costs across the medical plans',
    },
    {
      pattern: /compare AmeriVet's plans specifically on emergency-room cost sharing next/i,
      query: 'compare emergency room costs across the medical plans',
    },
    {
      pattern: /compare AmeriVet's medical plans specifically on in-network versus out-of-network rules/i,
      query: 'compare in-network versus out-of-network rules across the medical plans',
    },
  ];

  return followups.find(({ pattern }) => pattern.test(lastBotMessage))?.query || null;
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

function isSupplementalNarrowingQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const costQuestion = /\b(how\s+much|cost|costs|price|prices|rate|rates|premium|premiums)\b/i.test(lower);
  if (costQuestion) return false;
  return countSupplementalTopicsMentioned(lower) >= 2
    || /\b(narrow\s+down|most\s+relevant\s+next|which\s+is\s+most\s+relevant|which\s+one\s+matters\s+more|more\s+useful|what\s+should\s+i\s+add\s+next|if\s+i\s+add\s+one\s+thing)\b/i.test(lower)
      && /\b(life|disability|critical|accident|supplemental)\b/i.test(lower);
}

function detectLifeProtectionFocus(text: string): 'survivor_protection' | 'paycheck_protection' | null {
  const lower = stripAffirmationLeadIn(text.trim()).toLowerCase();
  const survivorProtection = /\b(if\s+i\s+die|if\s+i\s+died|after\s+my\s+death|after\s+i\s+die|if\s+something\s+happens?\s+to\s+me|if\s+something\s+happened\s+to\s+me|if\s+i\s+passed\s+away|if\s+i\s+wasn'?t\s+here|survivor\s+protection|survivor\s+support|death\s+benefit|would\s+need\s+support\s+if\s+i\s+die|would\s+need\s+support\s+if\s+something\s+happens?\s+to\s+me|would\s+need\s+support\s+after\s+my\s+death)\b/i.test(lower);
  const paycheckProtection = /\b(if\s+i\s+can'?t\s+work|if\s+i\s+couldn'?t\s+work|if\s+i\s+get\s+sick\s+and\s+can'?t\s+work|if\s+i\s+got\s+hurt\s+and\s+can'?t\s+work|unable\s+to\s+work|can'?t\s+work|couldn'?t\s+work|paycheck|income\s+interruption|income\s+stops?|while\s+i'?m\s+alive|if\s+i'?m\s+alive\s+but\s+can'?t\s+work)\b/i.test(lower);

  if (survivorProtection && !paycheckProtection) return 'survivor_protection';
  if (paycheckProtection && !survivorProtection) return 'paycheck_protection';
  return null;
}

function isNextDollarDecisionQuestion(text: string): boolean {
  const lower = stripAffirmationLeadIn(text.trim()).toLowerCase();
  return /\b(next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|gets?\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|deserves?\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|what\s+gets\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|what\s+deserves\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar))\b/i.test(lower);
}

function isProtectionPriorityQuestion(text: string): boolean {
  const lower = stripAffirmationLeadIn(text.trim()).toLowerCase();
  return /\b(what|which)\s+(?:protection|coverage|benefit)\s+should\s+i\s+(?:add|get|prioriti[sz]e|focus\s+on)\s+(?:first|next)\b/i.test(lower)
    || (/\bwhat\s+should\s+i\s+(?:add|get|prioriti[sz]e|focus\s+on)\s+first\b/i.test(lower)
      && /\b(protection|after\s+medical|once\s+medical|when\s+medical|breadwinner|family|household|spouse|kids?|children|income)\b/i.test(lower))
    || (/\bwhat\s+should\s+i\s+tighten\s+up\s+first\b/i.test(lower)
      && /\b(family|household|spouse|kids?|children|income|breadwinner|protection)\b/i.test(lower))
    || (/\b(after|once|when)\s+medical\b/i.test(lower)
      && /\b(first|next)\b/i.test(lower)
      && /\b(protection|benefit|coverage|add|get|prioriti[sz]e|focus\s+on)\b/i.test(lower));
}

function buildSupplementalNarrowingReply(session: Session, query: string): string {
  const lower = query.toLowerCase();
  const householdText = `${(session.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n')}\n${query}`.toLowerCase();
  const soleBreadwinner = /\b(sole\s+bread\s*winner|breadwinner|only\s+income|sole\s+provider|only\s+provider|family\s+relies\s+on\s+my\s+income|rely\s+on\s+my\s+income|single\s+(?:mom|dad))\b/i.test(householdText);
  const householdDependsOnIncome = soleBreadwinner || /\b(spouse|wife|husband|partner|kids?|children|family|household)\b/i.test(householdText);
  const lifeProtectionFocus = detectLifeProtectionFocus(householdText);
  const nextDollarQuestion = isNextDollarDecisionQuestion(query);
  const priorityFirstQuestion = isProtectionPriorityQuestion(query);
  const mentionsLife = /\b(life(?:\s+insurance)?|term life|vol(?:untary)?\s+term(?:\s+life)?|vol(?:untary)?\s+life|whole life|basic life|perm(?:anent)?(?:\s+life)?|25k)\b/i.test(lower);
  const mentionsDisability = /\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower);
  const mentionsCritical = /\bcritical(?:\s+illness)?\b/i.test(lower);
  const mentionsAccident = /\b(accident|ad&d|ad\/d)\b/i.test(lower);

  if (mentionsLife && mentionsDisability && (mentionsCritical || mentionsAccident)) {
    const lifeFirst = lifeProtectionFocus === 'survivor_protection';
    return [
      lifeFirst
        ? `If you are choosing across **life insurance**, **disability**, and the smaller supplemental cash benefits, I would usually settle **life insurance first** when survivor protection is the biggest concern.`
        : `If you are choosing across **life insurance**, **disability**, and the smaller supplemental cash benefits, I would usually settle **disability first** when the household depends on your paycheck.`,
      ``,
      `After that:`,
      lifeFirst
        ? `- tighten **disability** next if the household also depends heavily on your ongoing paycheck`
        : `- tighten **life insurance** next if the household would still need more survivor protection than the employer-paid basic benefit`,
      ...(mentionsCritical ? [`- choose **Critical Illness** after that if the bigger fear is the financial shock of a serious diagnosis`] : []),
      ...(mentionsAccident ? [`- choose **Accident/AD&D** after that if the bigger fear is injury risk`] : []),
      ``,
      `So my practical order is usually: **medical first**, then **life/disability**, and only after that **critical illness or accident** if you still want an extra cash-support layer.`,
    ].join('\n');
  }

  if (mentionsLife && mentionsDisability) {
    if (lifeProtectionFocus === 'survivor_protection') {
      return [
        nextDollarQuestion || priorityFirstQuestion
          ? `If you are really asking where the **next protection dollar** should go because your household would need support **if something happened to you**, I would usually put that dollar into **life insurance first**.`
          : `If you are choosing between more life insurance and disability because your household would need support **if something happened to you**, I would usually tighten up **life insurance first**.`,
        ``,
        `Why:`,
        `- **Life insurance** is the household-replacement decision if you die`,
        `- **Disability** is the paycheck-protection decision if you are alive but unable to work`,
        `- If the fear is survivor protection more than paycheck interruption, the bigger immediate gap is usually whether the employer-paid basic life benefit would actually be enough`,
        ``,
        nextDollarQuestion || priorityFirstQuestion
          ? `So if you want the shortest answer, I would usually let the **next dollar go to life insurance first**, then tighten up **disability** right after that if the household also depends heavily on your ongoing paycheck.`
          : `So if you are asking me to lead the decision, I would usually do **life insurance first**, then tighten up **disability** right after that if the household also depends heavily on your ongoing paycheck.`,
      ].join('\n');
    }

    return [
      householdDependsOnIncome || lifeProtectionFocus === 'paycheck_protection'
        ? nextDollarQuestion || priorityFirstQuestion
          ? `If you are really asking where the **next protection dollar** should go when the household depends on your paycheck, I would usually put that dollar into **disability first**.`
          : `If you are choosing between more life insurance and disability, I would usually tighten up **disability first** when the household depends on your paycheck.`
        : `If you are choosing between more life insurance and disability, the practical split is paycheck protection versus long-term survivor protection.`,
      ``,
      `Why:`,
      `- **Disability** protects part of your income if you are alive but unable to work`,
      `- **Life insurance** protects the household if you die`,
      `- AmeriVet already gives you a basic employer-paid life benefit, so the extra gap is often disability first when missing income would hurt immediately`,
      ``,
      householdDependsOnIncome || lifeProtectionFocus === 'paycheck_protection'
        ? nextDollarQuestion || priorityFirstQuestion
          ? `So if you want the shortest answer, I would usually let the **next dollar go to disability first**, then add more **life insurance** if the household still needs more survivor protection than the employer-paid basic benefit.`
          : `So if you are asking me to lead the decision, I would usually do **disability first**, then add more **life insurance** if the household still needs more survivor protection than the employer-paid basic benefit.`
        : `So if you are asking me to lead the decision, I would usually choose the one that covers the bigger real-world gap first: paycheck interruption or survivor protection.`,
      ].join('\n');
  }

  if (mentionsLife && (mentionsCritical || mentionsAccident)) {
    return [
      `If you are choosing between **life insurance** and the smaller supplemental cash benefits, I would usually settle **life insurance first** when the household would need support if something happened to you.`,
      ``,
      `After that:`,
      ...(mentionsCritical ? [`- choose **Critical Illness** if the bigger fear is the financial shock of a serious diagnosis`] : []),
      ...(mentionsAccident ? [`- choose **Accident/AD&D** if the bigger fear is injury risk`] : []),
      ``,
      `So my practical order is usually: **medical first**, then **life/disability** if household protection matters, and only after that **critical illness or accident** if you still want a smaller cash-support layer.`,
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
  const hasDirectMedicalSignal = /\b(plan|plans|medical|kaiser|hsa|hmo|ppo|bcbstx|blue\s+cross\s+blue\s+shield|coverage|coverage\s+tier|deductible|premium|premiums|copay|copays|coinsurance|out[- ]of[- ]pocket|oop|max|therapy|therapist|mental\s+health|specialist|prescriptions?|rx|drugs?|maternity|pregnan\w*|delivery|network|routine\s+care|doctor|visit|visits|wife|husband|spouse|partner|kids?|children|family|household)\b/i.test(lower);
  const isBareBenefitPriorityFocus = /^(\s*(healthcare costs|family protection|routine care)\s*)$/i.test(normalizedQuery);
  const wantsMedicalPremiumReplay = isMedicalPremiumReplayQuestion(normalizedQuery);
  const contextualPricingReplayQuery = contextualMedicalPricingReplayQuery(session, normalizedQuery);
  const contextualPlanReplayQuery = contextualMedicalPlanReplayQuery(session, normalizedQuery);
  const wantsMedicalCostEstimate = isCostModelRequest(normalizedQuery)
    || /\b(what\s+are\s+the\s+costs?|what\s+would\s+the\s+costs?\s+be|estimate\s+the\s+likely\s+costs?|estimate\s+likely\s+costs?|projected\s+costs?|show\s+me\s+the\s+costs?|what\s+would\s+i\s+pay)\b/i.test(lower);

  // Desired precedence contract:
  // 1. Direct support / Workday / HR lives outside this helper.
  // 2. Fresh package-level recommendation questions.
  // 3. Fresh direct practical questions.
  // 4. Fresh direct policy / QLE questions.
  // 5. Fresh explicit topic pivots.
  // 6. Only then let stale-topic continuation and pending-guidance scaffolding try to carry the conversation.

  // Apr 21 Step 3: centralized package-term registry.
  // Short-definition shapes ("what's VSP?", "what's Unum?", "what's BCBSTX?")
  // should answer topic-aware. We match the registry BEFORE the medical
  // definition fast-path so a Dental-anchored user asking "what's BCBSTX?"
  // gets the dental-flavored definition, and so terms like VSP/Unum/AD&D
  // are handled centrally instead of falling into generic menus.
  const termAskMatch = matchShortDefinitionAsk(normalizedQuery);
  if (termAskMatch) {
    const termDefinition = lookupPackageTerm(termAskMatch.alias, session.currentTopic || null);
    if (termDefinition) {
      clearPendingGuidance(session);
      return {
        answer: termDefinition,
        metadata: {
          intercept: 'term-registry-priority-v2',
          term: termAskMatch.alias,
          topic: session.currentTopic || null,
        },
      };
    }
  }

  // Apr 21 Step 7a: deictic tier reference ("what coverage tier is that for?",
  // "is that for family?") must fire BEFORE any topic-pivot path — otherwise
  // the presence of "coverage tier" routes through fresh-topic-direct or the
  // tier definition handler. The rule is: if the user is pointing at the
  // immediately preceding bot message asking which tier it applied to, echo
  // the locked tier instead of redefining tiers from scratch.
  if (isDeicticTierReference(normalizedQuery, session)) {
    clearPendingGuidance(session);
    return {
      answer: buildDeicticTierReferenceReply(session),
      metadata: {
        intercept: 'deictic-tier-reference-v2',
        tier: session.coverageTierLock || coverageTierFromConversation(session) || null,
      },
    };
  }

  // Apr 21 Step 4 Layer 1: procedural intent family.
  // HSA/FSA funding mechanics, enrollment timing, and waiting-period asks all
  // have deterministic answers from the package data and should be answered
  // directly before any topic-pivot or fallback can route them into a menu.
  if (isHsaFsaFundingQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    setTopic(session, 'HSA/FSA');
    return {
      answer: buildHsaFsaFundingReply(session),
      metadata: { intercept: 'hsa-fsa-funding-v2', topic: 'HSA/FSA' },
    };
  }

  if (isEnrollmentTimingQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    return {
      answer: buildEnrollmentTimingReply(),
      metadata: { intercept: 'enrollment-timing-v2' },
    };
  }

  if (isWaitingPeriodQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    return {
      answer: buildWaitingPeriodReply(session),
      metadata: { intercept: 'waiting-period-v2', topic: session.currentTopic || null },
    };
  }

  // Apr 21 Step 6: dependent eligibility. Directly answer "can I cover my
  // 28-year-old son who lives at home?"-style questions from the package's
  // eligibility rule (children eligible through age 26, regardless of
  // student status). Previously this bounced into a next-step menu.
  if (isDependentEligibilityQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    const { age, relation } = extractDependentContextFromQuery(normalizedQuery);
    return {
      answer: buildDependentEligibilityReply(session, normalizedQuery),
      metadata: { intercept: 'dependent-eligibility-v2', age, relation },
    };
  }

  if (isGlobalMedicalDefinitionQuestion(normalizedQuery)) {
    const detailedAnswer = buildMedicalPlanDetailAnswer(normalizedQuery, session);
    if (detailedAnswer) {
      clearPendingGuidance(session);
      return {
        answer: detailedAnswer,
        metadata: { intercept: 'medical-definition-priority-v2' },
      };
    }
  }

  if (isPackageRecommendationQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    return { answer: buildPackageRecommendationReply(session, normalizedQuery), metadata: { intercept: 'package-recommendation-v2' } };
  }

  if (
    isReturnToMedicalIntent(normalizedQuery)
    && (
      activeTopic === 'HSA/FSA'
      || activeTopic === 'Medical'
      || isNegativeSupplementalToMedicalPivot(normalizedQuery)
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

  if (contextualPricingReplayQuery) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildMedicalPremiumReplayReply(session, contextualPricingReplayQuery),
      metadata: { intercept: 'medical-pricing-contextual-replay-v2', topic: 'Medical' },
    };
  }

  if (contextualPlanReplayQuery) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildTopicReply(session, 'Medical', contextualPlanReplayQuery),
      metadata: { intercept: 'medical-plan-contextual-replay-v2', topic: 'Medical' },
    };
  }

  if (
    isMedicalPlanComparisonOrPricingQuestion(normalizedQuery)
    && !wantsMedicalPremiumReplay
    && !wantsMedicalCostEstimate
    && !isMedicalCoverageTierQuestion(normalizedQuery)
    && !/\b(voluntary\s+term(?:\s+life)?|term\s+life|whole\s+life|basic\s+life|life\s+insurance|disability|critical\s+illness|accident(?:\/ad&d)?|ad&d)\b/i.test(lower)
    && !(isLockedToNonMedicalTopic(session) && !hasExplicitMedicalDisambiguator(normalizedQuery))
  ) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildTopicReply(session, 'Medical', normalizedQuery),
      metadata: { intercept: 'medical-compare-priority-v2', topic: 'Medical' },
    };
  }

  if ((activeTopic === 'Medical' || explicitTopic === 'Medical') && hasExplicitNoPregnancyOverride(normalizedQuery)) {
    const scenarioOverrideRecommendation = buildRecommendationOverview(
      buildMedicalScenarioOverrideQuery(session, normalizedQuery),
      session,
    );
    if (scenarioOverrideRecommendation) {
      clearPendingGuidance(session);
      setTopic(session, 'Medical');
      return {
        answer: scenarioOverrideRecommendation,
        metadata: { intercept: 'medical-scenario-override-recommendation-v2', topic: 'Medical' },
      };
    }
  }

  if (
    (explicitTopic === 'HSA/FSA' || activeTopic === 'HSA/FSA')
    && (isDirectHsaFsaFitQuestion(normalizedQuery) || isHsaFsaCompatibilityQuestion(normalizedQuery) || isHsaFsaRuleQuestion(normalizedQuery))
  ) {
    setTopic(session, 'HSA/FSA');
    return {
      answer: buildTopicReply(session, 'HSA/FSA', normalizedQuery),
      metadata: { intercept: 'direct-hsa-fsa-priority-v2', topic: 'HSA/FSA' },
    };
  }

  if (isCostModelRequest(normalizedQuery) && hasDirectMedicalSignal && !isBareBenefitPriorityFocus) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildTopicReply(session, 'Medical', normalizedQuery),
      metadata: { intercept: 'medical-cost-model-priority-v2', topic: 'Medical' },
    };
  }

  if (
    isDirectMedicalRecommendationQuestion(normalizedQuery)
    && hasDirectMedicalSignal
    && !(isLockedToNonMedicalTopic(session) && !hasExplicitMedicalDisambiguator(normalizedQuery))
  ) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildTopicReply(session, 'Medical', normalizedQuery),
      metadata: { intercept: 'direct-medical-recommendation-priority-v2', topic: 'Medical' },
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

  if (explicitTopic && explicitTopic !== 'Benefits Overview') {
    const normalizedExplicitTopic = normalizeBenefitCategory(explicitTopic);
    // Apr 21 regression fix: don't let a generic Medical-inferred query
    // (e.g. "compare the plans") pivot a user who is anchored in a
    // non-Medical topic unless they name a Medical disambiguator.
    const wouldBlindlyPivotToMedical =
      normalizedExplicitTopic === 'Medical'
      && isLockedToNonMedicalTopic(session)
      && !hasExplicitMedicalDisambiguator(normalizedQuery);
    if (isExplicitTopicDirectQuestion(normalizedExplicitTopic, normalizedQuery) && !wouldBlindlyPivotToMedical) {
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
    && !(isLockedToNonMedicalTopic(session) && !hasExplicitMedicalDisambiguator(normalizedQuery))
  ) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return {
      answer: buildTopicReply(session, 'Medical', normalizedQuery),
      metadata: { intercept: 'direct-medical-priority-v2', topic: 'Medical' },
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

  if (isSupplementalNarrowingQuestion(normalizedQuery)) {
    clearPendingGuidance(session);
    if (/\b(life(?:\s+insurance)?|term life|whole life|basic life)\b/i.test(lower) && /\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower)) {
      setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
    } else if (/\b(accident|ad&d|ad\/d)\b/i.test(lower) && /\bcritical(?:\s+illness)?\b/i.test(lower)) {
      setPendingGuidance(session, 'accident_vs_critical', 'Accident/AD&D');
    }
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

function isHsaFsaRuleQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const rolloverPattern = /\b(roll(?:\s+over|\s+forward)|rollover|carry\s+over|carryover)\b/i;
  return /\b(how\s+much\s+can\s+i\s+put\s+in\s+my\s+hsa|hsa\s+contribution\s+limits?|irs\s+hsa\s+limits?|catch[- ]?up\s+contribution|contribute\s+to\s+an?\s+hsa)\b/i.test(lower)
    || /\b(limit|cap|max|maximum)\b[^.?!]{0,60}\b(roll(?:\s+over|\s+forward)|rollover|carry\s+over|carryover|unused\s+(?:funds|money|balance))\b/i.test(lower)
    || /\b(roll(?:\s+over|\s+forward)|rollover|carry\s+over|carryover|unused\s+(?:funds|money|balance))\b[^.?!]{0,80}\b(limit|cap|max|maximum)\b/i.test(lower)
    || (/\b(tax|taxes)\b/i.test(lower) && rolloverPattern.test(lower))
    || /\b(use[- ]it[- ]or[- ]lose[- ]it)\b/i.test(lower);
}

function buildHsaFsaRuleReply(query: string): string | null {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const rolloverPattern = /\b(roll(?:\s+over|\s+forward)|rollover|carry\s+over|carryover)\b/i;

  if (/\b(how\s+much\s+can\s+i\s+put\s+in\s+my\s+hsa|hsa\s+contribution\s+limits?|irs\s+hsa\s+limits?|catch[- ]?up\s+contribution|contribute\s+to\s+an?\s+hsa)\b/i.test(lower)) {
    return [
      `For **2025**, the **IRS HSA contribution limits** are **$4,300** for **self-only** coverage and **$8,550** for **family** coverage.`,
      ``,
      `A couple practical notes:`,
      `- If you are **55 or older**, you can add another **$1,000** catch-up contribution`,
      `- AmeriVet also contributes **$750/year** to your HSA when you are enrolled in an HSA-qualified medical plan`,
      `- Those are contribution limits for new money going in, not a cap on already-accumulated HSA dollars rolling forward`,
    ].join('\n');
  }

  if (/\b(tax|taxes)\b/i.test(lower) && rolloverPattern.test(lower)) {
    return [
      `Here is what the **tax and rollover tradeoff** means in practice:`,
      ``,
      `- **HSA** is the stronger long-term tax account when you are on **Standard HSA** or **Enhanced HSA**`,
      `- Unused **HSA** money stays with you and can **roll forward year to year**`,
      `- **FSA** still uses pre-tax dollars for eligible expenses, but it is more of a plan-year spending account with much stricter carryover or use-it-or-lose-it rules`,
      `- So if your goal is long-term savings, HSA is usually the cleaner fit; if your goal is near-term spending, FSA is usually the cleaner fit`,
      ``,
      `If you want, tell me whether you care more about **long-term savings** or **using the money this year**, and I will tell you which one is the cleaner fit.`,
    ].join('\n');
  }

  if (/\b(limit|cap|max|maximum)\b[^.?!]{0,60}\b(roll(?:\s+over|\s+forward)|rollover|carry\s+over|carryover|unused\s+(?:funds|money|balance))\b/i.test(lower)
    || /\b(roll(?:\s+over|\s+forward)|rollover|carry\s+over|carryover|unused\s+(?:funds|money|balance))\b[^.?!]{0,80}\b(limit|cap|max|maximum)\b/i.test(lower)) {
    return [
      `If you mean the **HSA** balance itself, unused HSA money generally **rolls forward year to year** instead of expiring at the end of the plan year.`,
      ``,
      `The practical distinction is:`,
      `- There is not a separate AmeriVet rollover cap on the HSA balance itself`,
      `- The limit that usually matters is the **IRS annual contribution limit** for new money going in`,
      `- For **2025**, those HSA contribution limits are **$4,300** for self-only coverage and **$8,550** for family coverage, plus **$1,000** catch-up at age 55+`,
      `- **FSA** is the account with the stricter carryover or use-it-or-lose-it rules`,
      ``,
      `If you want, I can turn that into the practical **HSA-versus-FSA** recommendation next.`,
    ].join('\n');
  }

  if (/\b(use[- ]it[- ]or[- ]lose[- ]it)\b/i.test(lower)) {
    return [
      `That phrase is much more about **FSA** than **HSA**.`,
      ``,
      `- **HSA** funds roll forward year to year and stay with you`,
      `- **FSA** follows much stricter plan-year carryover rules, which is why people describe it as a use-it-or-lose-it account`,
      `- If you need the exact AmeriVet FSA carryover handling for the current plan year, I would confirm that specific rule in Workday`,
      ``,
      `If you want, I can also help you decide whether **HSA** or **FSA** is the better fit for how you actually expect to use the money.`,
    ].join('\n');
  }

  return null;
}

function isDirectHsaFsaFitQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(which\s+one\s+is\s+better|which\s+one\s+is\s+best|better\s+fit|best\s+fit|which\s+one\s+fits|when\s+does\s+hsa\s+fit\s+better|when\s+does\s+fsa\s+fit\s+better|when\s+is\s+hsa\s+better|when\s+is\s+fsa\s+better|how\s+do\s+i\s+know\s+when\s+(?:an?\s+)?hsa\s+(?:fits|is)\s+better|how\s+do\s+i\s+know\s+when\s+(?:an?\s+)?fsa\s+(?:fits|is)\s+better|how\s+can\s+i\s+tell\s+when\s+(?:an?\s+)?hsa\s+(?:fits|is)\s+better|how\s+can\s+i\s+tell\s+when\s+(?:an?\s+)?fsa\s+(?:fits|is)\s+better|should\s+i\s+get|should\s+i\s+use|is\s+it\s+worth\s+it|worth\s+it|worth\s+using)\b/i.test(lower);
}

function isDirectHsaFsaRecommendationAsk(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(which\s+would\s+you\s+recommend|what\s+would\s+you\s+recommend|what\s+do\s+you\s+recommend(?:\s+(?:for|to)\s+me)?|which\s+do\s+you\s+recommend|recommend\s+(?:for|to)\s+me)\b/i.test(lower);
}

function isHsaFsaSpecificQuestion(query: string): boolean {
  return isDirectHsaFsaRecommendationAsk(query)
    || isDirectHsaFsaFitQuestion(query)
    || isHsaFsaRuleQuestion(query)
    || isHsaFsaCompatibilityQuestion(query);
}

function buildHsaFsaRecommendationReply(session: Session): string {
  const currentPlan = session.selectedPlan || '';

  if (/Kaiser Standard HMO/i.test(currentPlan)) {
    return [
      `My practical take is: if you stay with **Kaiser Standard HMO**, **FSA is usually the cleaner fit.**`,
      ``,
      `Why:`,
      `- Kaiser is AmeriVet's non-HSA-qualified medical path`,
      `- FSA is the more natural pre-tax account when HSA eligibility is not the goal`,
      `- HSA only really makes sense when you are on an HSA-qualified medical plan`,
      ``,
      `If you want, I can also help you decide whether Kaiser itself is still the right medical path.`,
    ].join('\n');
  }

  if (/Standard HSA|Enhanced HSA/i.test(currentPlan)) {
    return [
      `My practical take is: with **${currentPlan}**, **HSA is usually the cleaner fit.**`,
      ``,
      `Why:`,
      `- It keeps the tax account aligned with the HSA-qualified medical plan`,
      `- It preserves rollover and longer-term savings advantages`,
      `- FSA becomes the cleaner answer only when you care more about near-term spending than HSA eligibility`,
      ``,
      `If you want, I can also make that practical by walking through when FSA would still beat HSA for this situation.`,
    ].join('\n');
  }

  return [
    `My practical take is: **HSA is usually the better default recommendation** if you are on an HSA-qualified medical plan and want rollover plus longer-term savings.`,
    ``,
    `I would usually lean **FSA** instead only when one of these is true:`,
    `- you expect to spend the money in the current plan year`,
    `- you are not trying to preserve HSA eligibility`,
    `- you are on a non-HSA-qualified path like **Kaiser Standard HMO**`,
    ``,
    `So unless your main goal is near-term spending, I would usually start from **HSA** rather than **FSA**.`,
  ].join('\n');
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
      `- Unused funds can roll over year to year`,
      `- It is the stronger fit for building a longer-term healthcare cushion`,
      ``,
      `If you want, I can compare **Standard HSA** versus **Enhanced HSA** next and explain which medical path fits that long-term savings approach better.`,
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

  if (isDirectHsaFsaRecommendationAsk(query)) {
    return buildHsaFsaRecommendationReply(session);
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
    /\b(worth\s+considering|think\s+through|help\s+me\s+decide|what\s+should\s+i\s+consider|what\s+else\s+should\s+i\s+consider|what\s+else\s+should\s+be\s+on\s+my\s+radar|what\s+should\s+be\s+on\s+my\s+radar|what\s+should\s+i\s+prioriti[sz]e\s+next|what\s+should\s+i\s+focus\s+on\s+next|what\s+should\s+i\s+be\s+paying\s+attention\s+to|which\s+of\s+these\s+benefits|which\s+benefit\s+is\s+worth|what\s+should\s+i\s+look\s+at\s+first|pay\s+attention\s+to\s+first)\b/i.test(lower)
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
      `- Look at disability next, because protecting your paycheck is usually the more immediate family-protection risk when people rely on your income`,
      `- Tighten up life insurance right after that so your household has longer-term income replacement if something happens to you, especially if the employer-paid basic life benefit would not be enough`,
      `- Treat dental and vision as secondary unless your household expects regular routine use`,
      ``,
      `If you want, I can walk you through disability versus extra life next and explain which one usually matters first for family protection.`,
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
      `If you want, I can help you think through whether each of dental and vision is worth adding for your household — they are independent decisions, so either one, both, or neither can make sense depending on your use.`,
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
      `If you want, I can compare the medical tradeoff first and then walk through whether each of dental and vision is worth adding on top — they are independent add-or-not decisions.`,
    ].join('\n');
  }

  const guidance = [
    `If you are deciding what is actually worth attention first, I would usually think about your benefits in this order:`,
    ``,
    `- Medical first if you want to manage the biggest healthcare cost risk`,
    `- Dental and vision next if you expect routine use and want predictable everyday coverage`,
    `- Disability and life next if protecting family income matters more than routine care`,
    `- Accident or critical illness last if you want extra cash-support protection on top of your core coverage`,
  ];

  if (hasDependents) {
    guidance.push('', `Since you appear to be covering more than just yourself, the most important areas are usually medical first, then disability/life protection, then dental/vision if your household expects to use them.`);
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
      ``,
      `If you want, I can compare **Standard HSA** versus **Enhanced HSA** next and explain which medical path fits that long-term savings approach better.`,
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

function buildLifeVsDisabilityComparison(query = ''): string {
  const lifeProtectionFocus = detectLifeProtectionFocus(query);
  const nextDollarQuestion = isNextDollarDecisionQuestion(query);
  const priorityFirstQuestion = isProtectionPriorityQuestion(query);

  if (lifeProtectionFocus === 'survivor_protection') {
    return [
      `Here is the simplest way to separate life insurance from disability:`,
      ``,
      `- Life insurance is for protecting your household if you die`,
      `- Disability is for protecting part of your income if you are alive but unable to work because of illness or injury`,
      `- If your bigger fear is what happens to your spouse, kids, or household **after your death**, life insurance usually becomes the first thing I would tighten up`,
      `- Disability still matters right after that if the household also depends heavily on your ongoing paycheck`,
      ``,
      nextDollarQuestion || priorityFirstQuestion
        ? `So when the question is really about **survivor protection**, I would usually let the **next dollar go to life insurance first**, then disability right after that.`
        : `So when the question is really about **survivor protection**, I would usually do **life insurance first**, then disability right after that.`,
    ].join('\n');
  }

  return [
    `Here is the simplest way to separate life insurance from disability:`,
    ``,
    `- Life insurance is for protecting your household if you die`,
    `- Disability is for protecting part of your income if you are alive but unable to work because of illness or injury`,
    `- If people rely on your paycheck, disability often matters sooner than people expect`,
    `- If people rely on your long-term income and would need support after your death, life insurance is essential too`,
    ``,
    nextDollarQuestion || priorityFirstQuestion
      ? `For many working families, both matter, but I would usually let the **next dollar go to disability first** because paycheck interruption tends to create the more immediate pressure while life is the household-replacement decision.`
      : `For many working families, disability and life are both important, but disability is often the more immediate paycheck-protection decision while life is the household-replacement decision.`,
  ].join('\n');
}

function buildDentalVsVisionDecision(): string {
  return [
    `Dental and vision are separate add-or-not decisions, so it is not really dental **versus** vision — it is dental **and** vision, each evaluated on its own. Plenty of households add both, some add one, some add neither.`,
    ``,
    `Here is how I would think through each:`,
    ``,
    `**Dental — is it worth adding?**`,
    `- Yes if your household expects cleanings, fillings, crowns, or orthodontic use`,
    `- Harder to justify if you do not expect much dental use at all`,
    ``,
    `**Vision — is it worth adding?**`,
    `- Yes if someone in the household gets regular eye exams and uses glasses or contacts`,
    `- Harder to justify if no one really uses exams or eyewear`,
    ``,
    `So the real question isn't which one to pick — it is whether each one matches how your household actually uses care.`,
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
  const lifeProtectionFocus = detectLifeProtectionFocus(query);
  const nextDollarQuestion = isNextDollarDecisionQuestion(query);
  const priorityFirstQuestion = isProtectionPriorityQuestion(query);

  if (kind === 'life_vs_disability') {
    if (lifeProtectionFocus === 'survivor_protection') {
      return [
        childFocused
          ? `If you are thinking about what your kids would need if something happened to you, life insurance usually becomes the first thing I would tighten up.`
          : spouseFocused
            ? `If you are thinking about what your spouse or partner would need if something happened to you, life insurance usually becomes the first thing I would tighten up.`
            : `If you are thinking about survivor protection for your household, life insurance usually becomes the first thing I would tighten up.`,
        ``,
        `- Life insurance is the household-replacement decision if something happens to you`,
        `- Disability still matters, but that is the paycheck-protection decision while you are alive`,
        `- So if the main fear is survivor support rather than paycheck interruption, life usually deserves the first extra attention`,
        ``,
        nextDollarQuestion || priorityFirstQuestion
          ? `So if you are really asking where the **next dollar** should go, I would usually put it into **life first**, then **disability** right after that if the household also depends on your paycheck.`
          : `So my practical order is usually **life first**, then **disability** right after that if the household also depends on your paycheck.`,
      ].join('\n');
    }

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
        ? nextDollarQuestion || priorityFirstQuestion
          ? `So if your kids depend on your income and you are asking where the **next dollar** should go, I would usually put it into **disability first**, then tighten up **life** before I worry about smaller supplemental add-ons.`
          : `So if your kids depend on your income, I would usually tighten up disability and life before I worry about smaller supplemental add-ons.`
        : spouseFocused
          ? nextDollarQuestion || priorityFirstQuestion
            ? `So if your spouse depends on your income and you are asking where the **next dollar** should go, I would usually put it into **disability first**, then tighten up **life** before I worry about smaller supplemental add-ons.`
            : `So if your spouse depends on your income, I would usually tighten up disability and life before I worry about smaller supplemental add-ons.`
          : nextDollarQuestion || priorityFirstQuestion
            ? `So if your household depends on your income and you are asking where the **next dollar** should go, I would usually put it into **disability first**, then tighten up **life** before I worry about smaller supplemental add-ons.`
            : `So if your household depends on your income, I would usually tighten up disability and life before I worry about smaller supplemental add-ons.`,
    ].join('\n');
  }

  if (kind === 'dental_vs_vision') {
    // Dental and vision are independent add-or-not decisions, not an either/or.
    // Plenty of households add both.
    return [
      childFocused
        ? `If you are thinking about your kids specifically, dental and vision are two separate add-or-not decisions — plenty of families with kids add both, some add one, some add neither.`
        : spouseFocused
          ? `If you are thinking about your spouse specifically, dental and vision are two separate add-or-not decisions — either one, both, or neither can make sense depending on what you actually expect to use.`
          : `Dental and vision are two separate add-or-not decisions — plenty of households add both, some add one, some add neither. It is not really a "pick one" question.`,
      ``,
      `**Dental — is it worth adding?**`,
      `- Yes if the household will use cleanings, fillings, crowns, or orthodontic care`,
      `- Harder to justify if dental use is genuinely rare`,
      ``,
      `**Vision — is it worth adding?**`,
      `- Yes if anyone in the household gets regular eye exams, glasses, or contacts`,
      `- Harder to justify if nobody uses eyewear`,
      ``,
      `So the better question isn't which one first — it is whether each one matches how your household actually uses care.`,
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
  const lifeProtectionFocus = detectLifeProtectionFocus(query);

  if (kind === 'dental_vs_vision' && /\bwhy not vision first\b/i.test(lower)) {
    // "Why not vision first?" reframed — neither has to go first.
    // Each is a standalone add-or-not decision.
    return [
      `Fair question — and the honest answer is that neither has to go first. Vision and dental are independent add-or-not decisions, so plenty of households just add both.`,
      ``,
      `Vision can absolutely make sense on its own if someone in the household already uses regular eye exams, glasses, or contacts.`,
      `Dental can make sense on its own if you expect cleanings, fillings, crowns, or orthodontia.`,
      ``,
      `So if vision use is obvious for your household, start there. If dental use is obvious, start there. If both are obvious, add both — they are not competing for the same slot.`,
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

  if (kind === 'life_vs_disability' && /\bwhy not life first\b/i.test(lower)) {
    return [
      lifeProtectionFocus === 'survivor_protection'
        ? `Life absolutely can come first if your bigger fear is what your household would need and how they would find support after my death.`
        : `Life absolutely can come first when the bigger gap is survivor protection rather than paycheck interruption.`,
      ``,
      `That is because life insurance is the household-replacement decision if you die, while disability is the paycheck-protection decision while you are alive.`,
      `So if the concern is "would my spouse, partner, or kids be supported after my death?", life first is a very reasonable way to think about it.`,
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
  const conversationText = [
    ...(session.messages || []).map((message) => message.content.toLowerCase()),
    (session.lastBotMessage || '').toLowerCase(),
  ].join('\n');
  const familyProtectionContext = Boolean(session.familyDetails?.hasSpouse)
    || Boolean((session.familyDetails?.numChildren || 0) > 0)
    || /employee\s+\+\s+(spouse|child|family)/i.test(session.coverageTierLock || '')
    || /\b(spouse|wife|husband|partner|kids?|children|family|household|dependents?)\b/i.test(conversationText);

  if (topic === 'Life Insurance') {
    setPendingGuidance(session, 'supplemental_fit', 'Life Insurance');
    return [
      `Life insurance is usually worth tightening up when other people would need support if something happened to you.`,
      ``,
      `The practical order is usually:`,
      `- Keep **Basic Life** as the included base layer`,
      `- Add **Voluntary Term Life** first if the bigger job is household income replacement`,
      `- Add **Whole Life** only if you also want a permanent cash-value layer on top`,
      ``,
      familyProtectionContext
        ? `If family protection is still the focus, the next decision is usually whether to size extra life now or compare **life versus disability** if paycheck protection still feels exposed.`
        : `If you want, I can help you decide whether extra life is worth tightening up before the other optional protections.`,
    ].join('\n');
  }

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
    `The usual order is: medical first, then disability/life if income protection matters, then supplemental benefits if you want extra protection on top.`,
    ``,
    `If you want, I can narrow down whether accident, critical illness, or disability is the most relevant next step for your situation.`,
  ].join('\n');
}

function isWorthAddingFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(how\s+do\s+i\s+know|how\s+can\s+i\s+tell|is\s+it\s+worth|worth\s+adding|worth\s+it|should\s+i\s+get|should\s+i\s+add|do\s+i\s+need\s+it|useful|only\s+option|do\s+you\s+recommend|what\s+would\s+you\s+recommend|what\s+do\s+you\s+recommend|which\s+one\s+should\s+i\s+get|which\s+ones\s+should\s+i\s+get|which\s+should\s+i\s+get|should\s+i\s+pay\s+for\s+more|what\s+should\s+i\s+think\s+about|how\s+much\s+should\s+i\s+get|how\s+much\s+coverage\s+should\s+i\s+get|help\s+me\s+think\s+through(?:\s+that|\s+this|\s+it)?)\b/i.test(lower);
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
    `- If someone in the household gets routine eye exams and uses glasses or contacts, vision is easy to justify`,
    `- If no one really uses exams or eyewear, it is harder to justify as a must-have add-on`,
    `- In AmeriVet's package, vision is a routine-care add-on, not a replacement for medical coverage`,
    ``,
    `AmeriVet currently offers one vision plan, so the real decision is usually whether it is worth adding at all, not which vision plan to choose.`,
    ``,
    `Vision and dental are separate add-or-not decisions — either one can make sense on its own, and plenty of households add both. If you want, I can also walk through whether dental is worth adding for your household.`,
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
    `- If you expect routine dental visits or known dental work, dental is usually easy to justify`,
    `- If you do not expect much use at all, then it becomes more of a judgment call rather than an automatic add-on`,
    `- In AmeriVet's package, there is one dental plan, so the decision is usually whether to add it, not which dental plan to choose`,
    ``,
    `Dental and vision are separate add-or-not decisions — either one can make sense on its own, and plenty of households add both. If you want, I can also walk through whether vision is worth adding for your household.`,
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
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(is\s+that\s+the\s+only\s+(?:option|one)|that'?s\s+the\s+only\s+one|only\s+option|any\s+other\s+options|is\s+there\s+only\s+one|only\s+one\s+(?:vision|dental)\s+plan|alternate\s+(?:vision|dental)\s+plan|another\s+(?:vision|dental)\s+plan|other\s+(?:vision|dental)\s+plan|more\s+than\s+one\s+(?:vision|dental)\s+plans?|more\s+(?:vision|dental)\s+(?:plans?|options?)|other\s+options\s+for\s+(?:vision|dental)|any\s+other\s+(?:vision|dental)\s+(?:plans?|options?))\b/i.test(lower);
}

// Apr 21 Step 8: topic-aware only-option detector. When the user is clearly
// anchored in Vision or Dental (via active topic or the prior bot message),
// they can ask about "another plan" or "more plans" without re-naming the
// topic and still mean the vision/dental plan list. The topic-blind detector
// above intentionally requires the word "vision" or "dental" to avoid false
// positives for medical compare asks; this helper relaxes that when we have
// clear topic context.
function isOnlyOptionQuestionForTopic(query: string, topic: string | undefined, lastBotMessage?: string | null): boolean {
  if (isOnlyOptionQuestion(query)) return true;
  if (topic !== 'Vision' && topic !== 'Dental') return false;
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  const bareOnlyOptionShape =
    /\b(is\s+there\s+another\s+plan|another\s+plan\s+to\s+(?:compare|consider|look\s+at)|are\s+there\s+(?:more|other|any\s+other)\s+plans?|more\s+than\s+one\s+plans?|more\s+than\s+one\s+option|more\s+(?:plans?|options?)\s+(?:i|we|to)\s+can\s+(?:consider|choose|pick)|just\s+(?:one|the\s+one)\s+plan|only\s+one\s+plan|so,?\s+just\s+one\s+plan|any\s+other\s+plans?|other\s+plans?\s+(?:available|to\s+consider|i\s+can\s+consider))\b/i.test(lower);
  if (!bareOnlyOptionShape) return false;
  // Extra safety: if there is a lastBotMessage, confirm it mentioned the
  // topic-specific plan name so we know the bare "plan" refers to it.
  const last = (lastBotMessage || '').toLowerCase();
  if (topic === 'Vision') {
    return !last || /vsp\s+vision|vision\s+coverage|vision\s+plan|vision\s+service\s+plan/i.test(last);
  }
  return !last || /bcbstx\s+dental|dental\s+ppo|dental\s+coverage|dental\s+plan/i.test(last);
}

function shouldHandleSupplementalFitFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return isGuidanceAdvanceAffirmation(query)
    || /\b(do that|do this|do it|let'?s do that|let'?s do this|let'?s do it)\b/i.test(lower)
    || /\b(worth\s+considering|is\s+it\s+worth|worth\s+adding|should\s+i\s+get|should\s+i\s+add|do\s+i\s+need\s+it|when\s+would\s+i\s+want|tell\s+me\s+more|help\s+me\s+think\s+through|how\s+do\s+i\s+know|how\s+can\s+i\s+tell|what\s+should\s+i\s+add\s+next|which\s+one\s+matters\s+more|which\s+one\s+first|what\s+else\s+should\s+i\s+consider|next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|gets?\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|deserves?\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar))\b/i.test(lower);
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

function comparisonKindFromTopics(topicA?: string | null, topicB?: string | null): 'dental_vs_vision' | 'life_vs_disability' | 'accident_vs_critical' | null {
  const pair = [topicA, topicB].filter(Boolean).sort().join('|');
  if (pair === ['Dental', 'Vision'].sort().join('|')) return 'dental_vs_vision';
  if (pair === ['Life Insurance', 'Disability'].sort().join('|')) return 'life_vs_disability';
  if (pair === ['Accident/AD&D', 'Critical Illness'].sort().join('|')) return 'accident_vs_critical';
  return null;
}

function detectContextualComparisonKind(session: Session, query: string): 'dental_vs_vision' | 'life_vs_disability' | 'accident_vs_critical' | null {
  const lower = query.toLowerCase();
  if (!/\b(more important|matters more|which one first|which matters more|better than|more worth adding|worth adding first|next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|gets?\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|deserves?\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar))\b/i.test(lower)) {
    return null;
  }

  const current = session.currentTopic || null;
  const mentioned = benefitTopicFromQuery(query);
  return comparisonKindFromTopics(current, mentioned);
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
  if (isCostModelRequest(query) || isMedicalPremiumReplayQuestion(query) || isMedicalCoverageTierQuestion(query)) return false;
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

  if (session.currentTopic === 'Medical') {
    return `Thanks — I’ve updated your state to ${extractedState}. Here’s the refreshed medical view:\n\n${buildTopicReply(session, 'Medical', 'medical options')}`;
  }

  if (session.currentTopic) {
    return `Thanks — I’ve updated your state to ${extractedState}. That doesn’t materially change the ${session.currentTopic.toLowerCase()} options I just showed, but I’ll use ${extractedState} for any state-specific guidance going forward.`;
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
  if (session.currentTopic === 'Medical') {
    return `Thanks — I’ve updated the household to **${refreshedTier}** coverage. Here’s the refreshed medical view:\n\n${buildTopicReply(session, 'Medical', 'medical options')}`;
  }

  if (session.currentTopic) {
    return `Thanks — I’ve updated the household to **${refreshedTier}** coverage. I’ll use that tier for the ${session.currentTopic.toLowerCase()} guidance going forward.`;
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
  if (hasExplicitNoPregnancyOverride(lower)) return false;
  return /\b(my wife is pregnant|i'?m pregnant|we(?:'re| are) expecting|pregnant|maternity|prenatal|postnatal|delivery|baby|birth)\b/i.test(lower);
}

function usageLevelFromQuery(query: string): 'low' | 'moderate' | 'high' {
  const lower = query.toLowerCase();
  const recurringTherapySignal = /\b(therapy|therapist|mental\s+health|behavioral\s+health|counsel(?:ing|or))\b/i.test(lower)
    && /\b(weekly|twice\s+(?:a\s+)?month|2x\s+monthly|monthly|every\s+month|every\s+week|regular(?:ly)?|ongoing|recurring|frequent)\b/i.test(lower);
  const recurringSpecialistSignal = /\b(specialist|psychiatrist|psychologist|physical\s+therapy|physical\s+therapist)\b/i.test(lower)
    && /\b(weekly|twice\s+(?:a\s+)?month|2x\s+monthly|monthly|every\s+month|every\s+week|regular(?:ly)?|ongoing|recurring|frequent)\b/i.test(lower);
  const recurringPrescriptionSignal = /\b(prescriptions?|rx|drugs?|medications?|meds?)\b/i.test(lower)
    && /\b(weekly|monthly|every\s+month|regular(?:ly)?|ongoing|recurring|frequent|takes?\s+\d+\s+(?:prescriptions?|medications?)|on\s+\d+\s+(?:prescriptions?|medications?)|multiple\s+(?:prescriptions?|medications?))\b/i.test(lower);
  if (recurringTherapySignal || recurringSpecialistSignal || recurringPrescriptionSignal) return 'high';
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

function isMedicalCoverageTierQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (
    isCostModelRequest(query)
    || isMedicalPremiumReplayQuestion(query)
    || /\b(life(?:\s+insurance)?|term\s+life|whole\s+life|basic\s+life|disability|std|ltd|critical(?:\s+illness)?|accident|ad&d|ad\/d)\b/i.test(lower)
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
    // Apr 21 Step 5: honor explicit just-commit asks so the clarifier branch
    // is bypassed even on the first turn. The helper also auto-bypasses when
    // the clarifier has been shown in the last couple of turns.
    const forceCommit = isJustCommitRecommendationAsk(query);
    if (isDirectMedicalRecommendationQuestion(query)) {
      const recommendation = buildRecommendationOverview(query, session, forceCommit ? { forceCommit: true } : undefined);
      if (recommendation) return recommendation;
    }
    // Explicit just-commit asks like "just pick one for me please" don't
    // carry the literal "recommend" keyword and so won't trip
    // `isDirectMedicalRecommendationQuestion`. Route them to the
    // recommendation path directly BEFORE the generic next-step menu,
    // otherwise the user hits the "Pick one and I'll take you straight
    // into it" scaffold instead of a committed plan.
    if (forceCommit) {
      const committed = buildRecommendationOverview(query, session, { forceCommit: true });
      if (committed) return committed;
    }
    const detailedAnswer = buildMedicalPlanDetailAnswer(query, session);
    if (detailedAnswer) return detailedAnswer;
    const medicalFallback = buildMedicalPlanFallback(query, session);
    if (medicalFallback) return medicalFallback;

    const recommendation = buildRecommendationOverview(query, session, forceCommit ? { forceCommit: true } : undefined);
    if (recommendation) return recommendation;
  }

  if (topic === 'HSA/FSA') {
    const lower = query.toLowerCase();
    // Apr 20 v2 regression fix: pure knowledge definitions must run BEFORE
    // the practical-fit groove. Otherwise a session with selectedPlan set
    // to "Kaiser Standard HMO" forces every HSA/FSA knowledge ask into the
    // "leaning toward Kaiser — FSA is the cleaner fit" pairing answer,
    // regardless of what the user actually asked.
    if (/\bwhat\s+does\s+hsa\s+mean\b|\bwhat\s+is\s+an?\s+hsa\b|\bhow\s+does\s+(?:an?\s+)?hsa\s+work\b|\bdefine\s+hsa\b/.test(lower)) {
      return `HSA stands for **Health Savings Account**.\n\nIt is a tax-advantaged account you can use for eligible healthcare expenses when you are enrolled in an HSA-qualified medical plan like AmeriVet's **Standard HSA** or **Enhanced HSA**.\n\nThe short version is:\n- You contribute pre-tax money\n- The money can be used for eligible medical expenses\n- Unused funds roll over year to year\n- The account stays with you`;
    }
    if (/\bwhat\s+does\s+fsa\s+mean\b|\bwhat\s+is\s+an?\s+fsa\b|\bhow\s+does\s+(?:an?\s+)?fsa\s+work\b|\bdefine\s+fsa\b|\bwhat\s+does\s+an?\s+fsa\s+cover\b/.test(lower)) {
      return `FSA stands for **Flexible Spending Account**.\n\nIt lets you set aside pre-tax dollars for eligible healthcare expenses, but it follows different rollover and ownership rules than an HSA.\n\nThe short version is:\n- Contributions come out pre-tax\n- It can be used for eligible healthcare expenses\n- It is generally tied to the employer plan year\n- Unused funds usually have stricter rollover rules than an HSA`;
    }
    const ruleReply = buildHsaFsaRuleReply(query);
    if (ruleReply) {
      return ruleReply;
    }
    const practicalFitReply = buildHsaFsaPracticalFitReply(session, query);
    if (practicalFitReply) {
      return practicalFitReply;
    }
    if (isHsaFsaCompatibilityQuestion(query)) {
      return buildHsaFsaCompatibilityReply(query);
    }
  }

  if (topic === 'Dental' || topic === 'Vision') {
    if (isOnlyOptionQuestionForTopic(query, topic, session.lastBotMessage || null)) {
      return topic === 'Vision' ? buildVisionOnlyOptionReply() : buildDentalOnlyOptionReply();
    }
    if (isWorthAddingFollowup(query)) {
      return topic === 'Vision' ? buildVisionWorthAddingReply() : buildDentalWorthAddingReply();
    }
    const detailedAnswer = buildRoutineBenefitDetailAnswer(topic, query, session);
    if (detailedAnswer) return detailedAnswer;
  }

  if (topic === 'Life Insurance' || topic === 'Disability' || topic === 'Critical Illness' || topic === 'Accident/AD&D') {
    const detailedAnswer = buildNonMedicalDetailAnswer(topic, query, session);
    if (detailedAnswer) {
      if (topic === 'Life Insurance' && isLifeSizingDecisionQuestion(query)) {
        setPendingGuidance(session, 'life_sizing', 'Life Insurance');
      } else if (isSupplementalRecommendationQuestion(query)) {
        primeSupplementalRecommendationFollowup(session, topic);
      } else if (topic === 'Accident/AD&D' || topic === 'Critical Illness' || topic === 'Disability' || topic === 'Life Insurance') {
        setPendingGuidance(session, 'supplemental_fit', topic);
      }
      return detailedAnswer;
    }
    if (/\b(should\s+i\s+get|should\s+i\s+add|do\s+you\s+recommend|would\s+you\s+recommend|worth\s+it|worth\s+adding|with\s+my\s+situation|for\s+my\s+family|for\s+our\s+family|sole\s+bread[- ]?winner|only\s+income|bread[- ]?winner)\b/i.test(query.toLowerCase())) {
      const recommendation = buildSupplementalRecommendationReply(topic, session, query);
      if (recommendation) {
        primeSupplementalRecommendationFollowup(session, topic);
        return recommendation;
      }
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

  return buildContextualFallback(session, topic);
}

function buildContextualFallback(session: Session, topicOverride?: string | null): string {
  const topic = topicOverride || session.currentTopic;

  if (topic === 'Medical') {
    return [
      `A useful next medical step is usually one of these:`,
      ``,
      `- Compare the plan tradeoff`,
      `- Estimate likely costs`,
      `- Talk through why one option fits better for your situation`,
      ``,
      `Pick one and I’ll take you straight into it.`,
    ].join('\n');
  }

  if (topic === 'Dental') {
    return [
      `A useful next dental step is usually one of these:`,
      ``,
      `- Whether the dental plan is worth adding for your household`,
      `- What orthodontia means in practice`,
      `- Whether vision is also worth adding (separate decision — plenty of households add both)`,
      ``,
      `Pick one and I’ll walk through it with you.`,
    ].join('\n');
  }

  if (topic === 'Vision') {
    return [
      `A useful next vision step is usually one of these:`,
      ``,
      `- Whether the vision plan is worth adding for your household`,
      `- Whether dental is also worth adding (separate decision — plenty of households add both)`,
      ``,
      `Pick one and I’ll walk through it with you.`,
    ].join('\n');
  }

  if (topic === 'Life Insurance') {
    return [
      `A useful next life-insurance step is usually one of these:`,
      ``,
      `- Whether life or disability matters more first`,
      `- How much protection is worth paying for if your family relies on your income`,
      ``,
      `Pick one and I’ll take you into that decision.`,
    ].join('\n');
  }

  if (topic === 'Disability') {
    return [
      `A useful next disability step is usually one of these:`,
      ``,
      `- Whether disability or life insurance deserves priority`,
      `- Whether paycheck protection is worth adding for your household`,
      ``,
      `Pick one and I’ll take you into that decision.`,
    ].join('\n');
  }

  if (topic === 'Accident/AD&D' || topic === 'Critical Illness') {
    return [
      `A useful next supplemental step is usually one of these:`,
      ``,
      `- Whether this is worth adding at all`,
      `- How it compares with the other supplemental options`,
      ``,
      `Pick one and I’ll narrow it down.`,
    ].join('\n');
  }

  if (topic === 'HSA/FSA') {
    return [
      `A useful next HSA/FSA question is usually one of these:`,
      ``,
      `- When HSA fits better`,
      `- When FSA fits better`,
      `- What the tax and rollover tradeoff means in practice`,
      ``,
      `Pick one and I’ll make it practical.`,
    ].join('\n');
  }

  return `I can help you narrow this down. The usual starting points are medical if you are choosing core coverage, dental and vision for routine care (each a separate add-or-not decision), or disability and life if family protection matters more than everyday care.`;
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
  if (topic === 'Life Insurance') {
    const employerGuidanceAnswer = buildNonMedicalDetailAnswer(topic, query, session);
    if (employerGuidanceAnswer) {
      return employerGuidanceAnswer;
    }
  }

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
  const nextDollarQuestion = isNextDollarDecisionQuestion(query);
  const priorityFirstQuestion = isProtectionPriorityQuestion(query);
  const protectionPriorityAsk = nextDollarQuestion || priorityFirstQuestion;
  const supplementalComparisonFocus = detectSupplementalComparisonFocus(query);

  if (topic === 'Critical Illness') {
    if (protectionPriorityAsk && (soleBreadwinner || familyContext)) {
      return [
        `**My practical take:** if you are really asking where the next protection dollar should go for this household, I would usually **not** put it into critical illness first.`,
        ``,
        `Why:`,
        `- I would still settle the core medical choice first`,
        `- If the household depends on your income, I would usually tighten **disability** before smaller supplemental cash benefits`,
        `- I would usually tighten **life insurance** after that if the household would still need more survivor protection than the employer-paid basic life benefit`,
        `- I would only move to **critical illness** after those bigger protection questions are covered and you still want diagnosis-triggered cash support on top`,
        ``,
        `So if you are asking me to rank it: **disability first, life right after that, critical illness only after those are in place**.`,
      ].join('\n');
    }

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
    if (protectionPriorityAsk && (familyContext || soleBreadwinner)) {
      if (supplementalComparisonFocus === 'injury_risk') {
        return [
          `**My practical take:** even when injury risk is what you are picturing, I would usually still settle the bigger family-protection questions before I spend the next dollar on Accident/AD&D.`,
          ``,
          `Why:`,
          `- I would still keep the core medical decision first`,
          `- If the household depends on your paycheck, I would usually tighten **disability** before the smaller supplemental cash benefits`,
          `- If the household would need more survivor protection than AmeriVet's employer-paid basic life benefit, I would usually tighten **life insurance** right after that`,
          `- Then I would look at **Accident/AD&D** if the household is active and you still want extra accident-specific cash support`,
          ``,
          `So if you are asking me to rank it: **disability first, life right after that if the household still needs it, then Accident/AD&D if injury risk is still the concern**.`,
        ].join('\n');
      }

      return [
        `**My practical take:** I would usually **not** spend the next protection dollar on Accident/AD&D first when the bigger household question is still income protection.`,
        ``,
        `Why:`,
        `- Accident/AD&D is a smaller accident-triggered cash layer, not the main income-protection decision`,
        `- I would usually settle **disability** first if the household depends on your paycheck`,
        `- I would usually tighten **life insurance** after that if the household would still need more survivor protection than the employer-paid basic life benefit`,
        `- I would only move to **Accident/AD&D** once those bigger protection gaps are covered and injury risk is still what feels exposed`,
        ``,
        `So if you are asking me to rank it: **disability first, life right after that, Accident/AD&D only after the bigger family-protection questions are settled**.`,
      ].join('\n');
    }

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
    if (protectionPriorityAsk && (familyContext || soleBreadwinner)) {
      return [
        `**My practical take:** if the household depends on your paycheck, I would usually spend the next protection dollar on **disability first**.`,
        ``,
        `Why:`,
        `- A work-stopping illness or injury can create pressure long before anyone is thinking about a life-insurance payout`,
        `- AmeriVet already gives you an employer-paid basic life benefit, so the first extra gap is often paycheck protection, not survivor protection`,
        `- After that, I would usually tighten **life insurance** if the household would still need more long-term income replacement than the included base life benefit provides`,
        ``,
        `So if you are asking me to rank it: **disability first, life right after that, and only then the smaller supplemental cash benefits**.`,
      ].join('\n');
    }

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
    return buildLifeSizingGuidance(session);
  }

  return null;
}

function isSupplementalRecommendationQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(should\s+i\s+get|should\s+i\s+add|do\s+you\s+recommend|would\s+you\s+recommend|so\s+should\s+i\s+get\s+it|so\s+should\s+i\s+add\s+it|with\s+my\s+situation|for\s+my\s+family|for\s+our\s+family|sole\s+bread[- ]?winner|only\s+income|bread[- ]?winner|what\s+would\s+you\s+recommend|what\s+do\s+you\s+recommend|right\s+for\s+me|how\s+do\s+i\s+decide|help\s+me\s+decide|which\s+one\s+should\s+i\s+get|which\s+ones\s+should\s+i\s+get|which\s+should\s+i\s+get|should\s+i\s+pay\s+for\s+more|what\s+should\s+i\s+think\s+about|what\s+should\s+i\s+add\s+next|how\s+much\s+should\s+i\s+get|how\s+much\s+coverage\s+should\s+i\s+get|next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|gets?\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar)|deserves?\s+the\s+next\s+(?:dollar|premium\s+dollar|protection\s+dollar|coverage\s+dollar))\b/i.test(lower);
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
  const lifeProtectionFocus = detectLifeProtectionFocus(normalizedQuery);

  // Apr 21 Step 7a: same deictic-before-lexical ordering in the continuation
  // path so "what tier is that for?" doesn't get redirected into the tier
  // definition when the highpriority path has already passed.
  if (isDeicticTierReference(normalizedQuery, session)) {
    clearPendingGuidance(session);
    return buildDeicticTierReferenceReply(session);
  }

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

  if (
    isMedicalPlanComparisonOrPricingQuestion(normalizedQuery)
    && !/\b(voluntary\s+term(?:\s+life)?|term\s+life|whole\s+life|basic\s+life|life\s+insurance|disability|critical\s+illness|accident(?:\/ad&d)?|ad&d)\b/i.test(lower)
    && !(isLockedToNonMedicalTopic(session) && !hasExplicitMedicalDisambiguator(normalizedQuery))
  ) {
    setTopic(session, 'Medical');
    return buildTopicReply(session, 'Medical', normalizedQuery);
  }

  if (isHsaFsaCompatibilityQuestion(normalizedQuery)) {
    setTopic(session, 'HSA/FSA');
    return buildTopicReply(session, 'HSA/FSA', normalizedQuery);
  }

  if (activeTopic === 'HSA/FSA' && (isHsaFsaRuleQuestion(normalizedQuery) || isDirectHsaFsaRecommendationAsk(normalizedQuery) || isDirectHsaFsaFitQuestion(normalizedQuery) || hsaFitFocus)) {
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
    // Apr 21 regression fix: same topic-lock rule here — don't let a generic
    // Medical-inferred query pivot away from a non-Medical active topic.
    const wouldBlindlyPivotToMedical =
      normalizedExplicitTopic === 'Medical'
      && isLockedToNonMedicalTopic(session)
      && !hasExplicitMedicalDisambiguator(normalizedQuery);
    const directTopicQuestion =
      normalizedExplicitTopic === 'Medical'
        ? (isDirectMedicalContinuationQuestion(normalizedQuery) || isMedicalPregnancySignal(normalizedQuery))
        : normalizedExplicitTopic === 'Dental' || normalizedExplicitTopic === 'Vision'
          ? (isRoutineBenefitDetailQuestion(normalizedQuery) || isWorthAddingFollowup(normalizedQuery))
          : normalizedExplicitTopic === 'HSA/FSA'
            ? (isHsaFsaCompatibilityQuestion(normalizedQuery) || isDirectHsaFsaRecommendationAsk(normalizedQuery) || isDirectHsaFsaFitQuestion(normalizedQuery) || isHsaFsaRuleQuestion(normalizedQuery) || /\bwhat\s+does\s+(hsa|fsa)\s+mean\b|\bwhat\s+is\s+an?\s+(hsa|fsa)\b/i.test(lower))
            : (
              isNonMedicalDetailQuestion(normalizedExplicitTopic, normalizedQuery)
              || isSupplementalRecommendationQuestion(normalizedQuery)
              || isWorthAddingFollowup(normalizedQuery)
            );

    if (directTopicQuestion && !wouldBlindlyPivotToMedical) {
      setTopic(session, normalizedExplicitTopic);
      return buildTopicReply(session, normalizedExplicitTopic, normalizedQuery);
    }
  }

  if (
    isLifeFamilyCoverageQuestion(normalizedQuery)
    && !/simplest way to separate life insurance from disability/i.test(lastBotMessage)
  ) {
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
    !isHsaFsaSpecificQuestion(normalizedQuery)
    &&
    isDirectMedicalContinuationQuestion(normalizedQuery)
    && /\b(plan|medical|copay|copays|deductible|coinsurance|out[- ]of[- ]pocket|maternity|pregnan|baby|birth|delivery|prenatal|postnatal|kaiser|hsa|hmo|tier|tradeoff|prescription|network)\b/i.test(lower)
    && !(isLockedToNonMedicalTopic(session) && !hasExplicitMedicalDisambiguator(normalizedQuery))
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
      primeSupplementalRecommendationFollowup(session, inferredSupplementalTopic);
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

  if (
    (activeTopic === 'Life Insurance' || inferredSupplementalTopic === 'Life Insurance')
    && (
      isGuidanceAdvanceAffirmation(normalizedQuery)
      || /\b(help\s+me\s+think\s+through\s+that|help\s+me\s+think\s+through\s+this|help\s+me\s+think\s+through\s+it)\b/i.test(lower)
    )
    && /life insurance is usually worth tightening up|people rely on your income|household would need support if something happened to you|practical life-sizing question|included base benefit is not enough|included starting point|main added layer for income replacement|80%\s+voluntary term life\s*\/\s*20%\s+whole life/i.test(lastBotMessage)
  ) {
    setPendingGuidance(session, 'life_sizing', 'Life Insurance');
    setTopic(session, 'Life Insurance');
    return buildLifeSizingGuidance(session);
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
    if (isGuidanceAdvanceAffirmation(normalizedQuery) || /\b(hsa|fsa|better fit|which one|long[- ]term savings|near[- ]term medical expenses)\b/i.test(lower)) {
      clearPendingGuidance(session);
      return buildHsaFitGuidance();
    }
  }

  if (session.pendingGuidancePrompt === 'life_sizing') {
    const detailedLifeAnswer = buildNonMedicalDetailAnswer('Life Insurance', normalizedQuery, session);
    if (detailedLifeAnswer) {
      setPendingGuidance(session, 'life_sizing', 'Life Insurance');
      setTopic(session, 'Life Insurance');
      return detailedLifeAnswer;
    }
    if (isGuidanceAdvanceAffirmation(normalizedQuery) || /\b(help\s+me\s+think\s+through\s+that|help\s+me\s+think\s+through\s+it|yes\s+please|go\s+ahead)\b/i.test(lower)) {
      setPendingGuidance(session, 'life_sizing', 'Life Insurance');
      setTopic(session, 'Life Insurance');
      return buildLifeSizingGuidance(session);
    }
  }

  if (session.pendingGuidancePrompt === 'supplemental_fit' && shouldHandleSupplementalFitFollowup(normalizedQuery)) {
    const fitTopic =
      session.pendingGuidanceTopic
      || (session.currentTopic === 'Life Insurance' || session.currentTopic === 'Disability' || session.currentTopic === 'Critical Illness' || session.currentTopic === 'Accident/AD&D'
        ? session.currentTopic
        : inferTopicFromLastBotMessage(lastBotMessage));
    if (fitTopic === 'Life Insurance') {
      const detailedAnswer = buildNonMedicalDetailAnswer('Life Insurance', normalizedQuery, session);
      if (detailedAnswer) {
        setTopic(session, 'Life Insurance');
        return detailedAnswer;
      }
    }
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

  if (session.pendingGuidancePrompt === 'life_vs_disability') {
    const whyNotReply = buildWhyNotOtherFirstReply('life_vs_disability', normalizedQuery);
    if (whyNotReply) {
      setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
      return whyNotReply;
    }
    if (isProtectionPriorityQuestion(normalizedQuery)) {
      setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
      return buildComparisonFamilyReply('life_vs_disability', normalizedQuery);
    }
    if (
      isAffirmativeCompareFollowup(normalizedQuery)
      || isNextDollarDecisionQuestion(normalizedQuery)
      || isProtectionPriorityQuestion(normalizedQuery)
      || Boolean(lifeProtectionFocus)
      || /\b(which\s+protection|which\s+one\s+matters\s+more|which\s+one\s+first|which\s+should\s+i\s+get|which\s+ones\s+should\s+i\s+get)\b/i.test(lower)
    ) {
      setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
      return buildLifeVsDisabilityComparison(normalizedQuery);
    }
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
      setPendingGuidance(session, 'life_vs_disability', 'Life Insurance');
      return buildLifeVsDisabilityComparison(normalizedQuery);
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
      primeSupplementalRecommendationFollowup(session, inferredSupplementalTopic);
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

  if (
    activeTopic === 'Medical'
    && /compare the medical options at a high level for someone who expects ongoing prescriptions/i.test(lastBotMessage)
    && (isSimpleAffirmation(normalizedQuery) || isAffirmativeCompareFollowup(normalizedQuery))
  ) {
    return [
      `If **ongoing prescriptions** are part of the picture, I would usually compare the stronger-protection medical option more seriously instead of only chasing the cheapest premium.`,
      ``,
      buildTopicReply(session, 'Medical', 'which medical plan is better if I expect ongoing prescriptions'),
    ].join('\n');
  }

  if (
    activeTopic === 'Medical'
    && /compare the deductible and out-of-pocket tradeoff right next to those premiums/i.test(lastBotMessage)
    && (isSimpleAffirmation(normalizedQuery) || isAffirmativeCompareFollowup(normalizedQuery))
  ) {
    return buildTopicReply(session, 'Medical', 'compare the deductible and out-of-pocket max across the medical plans');
  }

  if (activeTopic === 'Medical' && (isSimpleAffirmation(normalizedQuery) || isAffirmativeCompareFollowup(normalizedQuery))) {
    const followupQuery = medicalInviteFollowupQuery(lastBotMessage);
    if (followupQuery) {
      return buildTopicReply(session, 'Medical', followupQuery);
    }
  }

  if (
    activeTopic === 'HSA/FSA'
    && /compare \*\*standard hsa\*\* versus \*\*enhanced hsa\*\* next and explain which medical path fits that long-term savings approach better/i.test(lastBotMessage)
    && (isSimpleAffirmation(normalizedQuery) || isAffirmativeCompareFollowup(normalizedQuery))
  ) {
    setTopic(session, 'Medical');
    return [
      `If **long-term HSA savings** are part of the goal, the medical question is usually about which HSA-qualified plan still fits your expected care without overpaying for protection you may not need.`,
      ``,
      buildTopicReply(session, 'Medical', 'compare Standard HSA and Enhanced HSA if I want long-term HSA savings'),
    ].join('\n');
  }

  if (activeTopic === 'HSA/FSA' && (isDirectHsaFsaRecommendationAsk(normalizedQuery) || isDirectHsaFsaFitQuestion(normalizedQuery) || isHsaFsaRuleQuestion(normalizedQuery) || hsaFitFocus)) {
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

  if (activeTopic === 'Vision' && isOnlyOptionQuestionForTopic(normalizedQuery, 'Vision', session.lastBotMessage || null)) {
    return buildVisionOnlyOptionReply();
  }

  if (activeTopic === 'Vision' && isWorthAddingFollowup(normalizedQuery)) {
    return buildVisionWorthAddingReply();
  }

  if (activeTopic === 'Dental' && isOnlyOptionQuestionForTopic(normalizedQuery, 'Dental', session.lastBotMessage || null)) {
    return buildDentalOnlyOptionReply();
  }

  if (activeTopic === 'Dental' && isWorthAddingFollowup(normalizedQuery)) {
    return buildDentalWorthAddingReply();
  }

  if (
    (inferredSupplementalTopic === 'Accident/AD&D' || inferredSupplementalTopic === 'Critical Illness' || inferredSupplementalTopic === 'Disability' || inferredSupplementalTopic === 'Life Insurance')
    && isRepeatedSupplementalWorthQuestion(normalizedQuery)
  ) {
    if (inferredSupplementalTopic === 'Life Insurance') {
      const detailedAnswer = buildNonMedicalDetailAnswer('Life Insurance', normalizedQuery, session);
      if (detailedAnswer) {
        setTopic(session, 'Life Insurance');
        return detailedAnswer;
      }
    }
    setTopic(session, inferredSupplementalTopic);
    return buildSupplementalPracticalTake(inferredSupplementalTopic);
  }

  if (
    (activeTopic === 'Accident/AD&D' || activeTopic === 'Critical Illness' || activeTopic === 'Disability' || activeTopic === 'Life Insurance')
    && isRepeatedSupplementalWorthQuestion(normalizedQuery)
  ) {
    if (activeTopic === 'Life Insurance') {
      const detailedAnswer = buildNonMedicalDetailAnswer('Life Insurance', normalizedQuery, session);
      if (detailedAnswer) {
        setTopic(session, 'Life Insurance');
        return detailedAnswer;
      }
    }
    setTopic(session, activeTopic);
    return buildSupplementalPracticalTake(activeTopic);
  }

  if ((activeTopic === 'Accident/AD&D' || activeTopic === 'Critical Illness' || activeTopic === 'Disability' || activeTopic === 'Life Insurance') && isWorthAddingFollowup(normalizedQuery)) {
    if (activeTopic === 'Life Insurance') {
      const detailedAnswer = buildNonMedicalDetailAnswer('Life Insurance', normalizedQuery, session);
      if (detailedAnswer) {
        setTopic(session, 'Life Insurance');
        return detailedAnswer;
      }
    }
    if (isSupplementalRecommendationQuestion(normalizedQuery)) {
      const recommendation = buildSupplementalRecommendationReply(activeTopic, session, normalizedQuery);
      if (recommendation) {
        setTopic(session, activeTopic);
        primeSupplementalRecommendationFollowup(session, activeTopic);
        return recommendation;
      }
    }
    setTopic(session, activeTopic);
    return buildSupplementalFitGuidance(session, activeTopic);
  }

  if ((inferredSupplementalTopic === 'Accident/AD&D' || inferredSupplementalTopic === 'Critical Illness' || inferredSupplementalTopic === 'Disability' || inferredSupplementalTopic === 'Life Insurance') && isWorthAddingFollowup(normalizedQuery)) {
    if (inferredSupplementalTopic === 'Life Insurance') {
      const detailedAnswer = buildNonMedicalDetailAnswer('Life Insurance', normalizedQuery, session);
      if (detailedAnswer) {
        setTopic(session, 'Life Insurance');
        return detailedAnswer;
      }
    }
    if (isSupplementalRecommendationQuestion(normalizedQuery)) {
      const recommendation = buildSupplementalRecommendationReply(inferredSupplementalTopic, session, normalizedQuery);
      if (recommendation) {
        setTopic(session, inferredSupplementalTopic);
        primeSupplementalRecommendationFollowup(session, inferredSupplementalTopic);
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
    || /each of dental and vision is worth adding/i.test(lastBotMessage)
    || /dental and vision are separate add-or-not decisions/i.test(lastBotMessage)
  ) {
    if (/Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
      const reply = buildWhyNotOtherFirstReply('accident_vs_critical', normalizedQuery);
      if (reply) return reply;
    }
    if (/life insurance from disability/i.test(lastBotMessage)) {
      const reply = buildWhyNotOtherFirstReply('life_vs_disability', normalizedQuery);
      if (reply) return reply;
    }
    if (/each of dental and vision is worth adding|dental and vision are separate add-or-not decisions/i.test(lastBotMessage)) {
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
        return buildSupplementalPracticalTake(lifeProtectionFocus === 'survivor_protection' ? 'Life Insurance' : 'Disability');
      }
      if (/separate add-or-not decisions|dental and vision are two separate|each of dental and vision is worth adding/i.test(lastBotMessage)) {
        // Dental/vision are parallel decisions, not an either/or ranking.
        return `My practical take is that dental and vision are two separate yes/no decisions, not a ranking. If your household already expects cleanings, fillings, or orthodontia, add dental. If anyone uses regular exams, glasses, or contacts, add vision. If both are true, add both — they do not compete for the same slot.`;
      }
    }
    if (wantsFamilySpecific) {
      if (/Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
        return buildComparisonFamilyReply('accident_vs_critical', normalizedQuery);
      }
      if (/life insurance from disability/i.test(lastBotMessage)) {
        return buildComparisonFamilyReply('life_vs_disability', normalizedQuery);
      }
      if (/each of dental and vision is worth adding|dental and vision are separate add-or-not decisions/i.test(lastBotMessage)) {
        return buildComparisonFamilyReply('dental_vs_vision', normalizedQuery);
      }
    }
  }

  if (isAffirmativeCompareFollowup(normalizedQuery)) {
    if (/compare accident\/ad&d versus critical illness/i.test(lastBotMessage)) {
      setPendingGuidance(session, 'accident_vs_critical', 'Accident/AD&D');
      return buildAccidentVsCriticalComparison();
    }
    if (/walk you through life versus disability|walk you through disability versus extra life/i.test(lastBotMessage)) {
      return buildLifeVsDisabilityComparison(normalizedQuery);
    }
    if (/whether each of dental and vision is worth adding for your household|walk through whether each of dental and vision is worth adding/i.test(lastBotMessage)) {
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

  if (activeTopic === 'Life Insurance' && isExcludedTopicMention(lower, '(?:life(?:\\s+insurance)?|term\\s+life|whole\\s+life|basic\\s+life)')) {
    clearPendingGuidance(session);
    return buildPackageGuidance(session, 'Life Insurance');
  }

  const pivotTopic = benefitTopicFromQuery(normalizedQuery);
  if (pivotTopic && pivotTopic !== 'Benefits Overview' && pivotTopic !== session.currentTopic) {
    // Apr 21 regression fix: same topic-lock rule — a generic
    // Medical-inferred query (e.g. "compare the plans") should not
    // yank the user out of a non-Medical active topic.
    const wouldBlindlyPivotToMedical =
      pivotTopic === 'Medical'
      && isLockedToNonMedicalTopic(session)
      && !hasExplicitMedicalDisambiguator(normalizedQuery);
    if (!wouldBlindlyPivotToMedical) {
      setTopic(session, pivotTopic);
      return buildTopicReply(session, pivotTopic, normalizedQuery);
    }
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

  if (activeTopic === 'Life Insurance' || activeTopic === 'Disability' || activeTopic === 'Critical Illness' || activeTopic === 'Accident/AD&D') {
    const detailedAnswer = buildNonMedicalDetailAnswer(activeTopic, normalizedQuery, session);
    if (detailedAnswer) {
      if (activeTopic === 'Life Insurance' && isLifeSizingDecisionQuestion(normalizedQuery)) {
        setPendingGuidance(session, 'life_sizing', 'Life Insurance');
      } else if (isSupplementalRecommendationQuestion(normalizedQuery)) {
        primeSupplementalRecommendationFollowup(session, activeTopic);
      } else {
        setPendingGuidance(session, 'supplemental_fit', activeTopic);
      }
      return detailedAnswer;
    }

    if (isSupplementalRecommendationQuestion(normalizedQuery)) {
      const recommendation = buildSupplementalRecommendationReply(activeTopic, session, normalizedQuery);
      if (recommendation) {
        primeSupplementalRecommendationFollowup(session, activeTopic);
        return recommendation;
      }
    }
  }

  if (isGuidanceAdvanceAffirmation(normalizedQuery)) {
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
