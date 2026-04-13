import { STATE_ABBREV_TO_NAME } from '@/lib/data/amerivet';
import type { Session } from '@/lib/rag/session-store';
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

type BenefitPriorityFocus = 'healthcare_costs' | 'family_protection' | 'routine_care';
type SupplementalComparisonFocus = 'injury_risk' | 'diagnosis_risk';
type HsaFitFocus = 'long_term_savings' | 'near_term_expenses';

function isMedicalDetailQuestion(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return /\b(coverage\s+tier|coverage\s+tiers|copay|copays|coinsurance|deductible|out[- ]of[- ]pocket|oop\s*max|primary\s+care|pcp|specialist|urgent\s+care|emergency\s+room|er|network|in[- ]network|out[- ]of[- ]network|ppo|hmo|prescriptions?|drugs?|generic|brand|specialty|maternity|pregnan\w*|delivery|prenatal|postnatal|therapy|physical\s+therapy|virtual\s+visits?|telehealth(?:\s+visits?)?|telemedicine|tradeoffs?|differences?\s+between\s+the\s+plans|compare\s+the\s+plans|compare\s+the\s+plan\s+tradeoffs?)\b/i.test(lower)
    || (/\b(cost|costs|what\s+would\s+i\s+pay|what\s+are\s+my\s+costs|if\s+i\s+use)\b/i.test(lower) && /\b(standard|standard hsa|enhanced|enhanced hsa|kaiser|kaiser hmo)\b/i.test(lower));
}

function isAffirmativeCompareFollowup(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  return isSimpleAffirmation(query)
    || /\b(compare|comparison|vs\.?|versus|which one|which matters more|do that|i'?d like that|yes please|tell me more)\b/i.test(lower);
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

function isBenefitDecisionGuidanceRequest(query: string): boolean {
  const lower = stripAffirmationLeadIn(query.trim()).toLowerCase();
  if (isCostModelRequest(lower)) return false;
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
      `The reason I leaned Enhanced HSA is that your usage sounds high enough that paying more in premium can still be the cleaner trade if it lowers the deductible shock when care actually happens.`,
      ``,
      `The practical tradeoff is:`,
      `- Standard HSA keeps payroll cost lower`,
      `- Enhanced HSA usually feels better once you expect regular care, prescriptions, or a meaningful chance of hitting the deductible`,
      ``,
      `So I would only move off the cheaper option if you think the extra premium is buying you real peace of mind against higher medical use.`,
    ].join('\n');
  }

  if (/Kaiser Standard HMO/i.test(recommendation || '')) {
    return [
      `The reason I kept Kaiser in the conversation is that if you specifically want the Kaiser-style integrated network and you are in an eligible state, it can be a reasonable fit even when it is not the lowest-premium option.`,
      ``,
      `The tradeoff is usually about network preference more than pure savings.`,
    ].join('\n');
  }

  return [
    `The reason I leaned Standard HSA is that it is usually the cleaner fit when the goal is to keep payroll cost lower and you do not expect much care.`,
    ``,
    `The practical tradeoff is:`,
    `- Standard HSA keeps more of the savings in your paycheck`,
    `- Enhanced HSA can be worth the extra premium if you expect enough care for the richer protection to matter`,
    ``,
    usage === 'low'
      ? `Since your expected usage sounds low, I would usually only pay more for Enhanced HSA if you strongly prefer extra deductible protection over lower premiums.`
      : `If your usage creeps up into moderate or high territory, that is when paying more for Enhanced HSA starts to make more sense.`,
  ].join('\n');
}

function buildMedicalWorthExtraPremiumReply(session: Session): string {
  const usage = usageLevelFromSession(session);
  return [
    `Whether the richer medical option is worth the extra premium mostly comes down to expected use.`,
    ``,
    `- If usage is low, I would usually keep the cheaper option and avoid paying more up front`,
    `- If usage is moderate to high, the extra premium can be worth it if it meaningfully softens the deductible and out-of-pocket risk`,
    `- If you care most about the lowest ongoing payroll deduction, the higher-premium option is usually harder to justify`,
    ``,
    usage === 'high'
      ? `Because your current context sounds closer to higher usage, I would take the richer protection more seriously.`
      : usage === 'low'
        ? `Because your current context sounds closer to low usage, I would usually stay with the cheaper plan unless you really want the extra protection.`
        : `Because your current context sounds moderate, this is the gray zone where the choice is really about your comfort with risk versus premium spend.`,
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
      ? `I would make that choice when I think the household is likely to use enough care that the richer protection is worth paying for up front.`
      : `I would make that choice when I think the household is trying to keep costs down and is unlikely to use enough care to justify the richer option.`,
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
      ? `If you are thinking specifically about your kids, the practical question is whether the household is likely to use enough care for the richer medical plan to matter.`
      : spouseFocused
        ? `If you are thinking specifically about your spouse, the practical question is whether the household is likely to use enough care for the richer medical plan to matter.`
        : `If you are thinking specifically about your household, the practical question is whether the household is likely to use enough care for the richer medical plan to matter.`;
    const richerProtectionLine = /Employee \+ Spouse/i.test(tier)
      ? `- If your spouse has recurring visits, regular prescriptions, therapy, or a strong preference for using more care than routine checkups, the richer medical protection becomes easier to justify`
      : `- If you expect specialist care, recurring prescriptions, therapy, or a real chance of using more than routine pediatric care, the richer protection becomes easier to justify`;
    return [
      lead,
      ``,
      childFocused
        ? `- If your kids are generally healthy and the household mostly needs routine visits, the lower-premium option is still usually the cleaner fit`
        : spouseFocused
          ? `- If your spouse is generally healthy and the household mostly needs routine visits, the lower-premium option is still usually the cleaner fit`
          : `- If the household is generally healthy and mostly needs routine visits, the lower-premium option is still usually the cleaner fit`,
      richerProtectionLine,
      `- If Kaiser is available in your state and you strongly prefer that integrated network for the family, that can outweigh pure premium savings`,
      ``,
      usage === 'high'
        ? `Because your current context already sounds closer to higher usage, I would take the richer family protection more seriously than I would for a low-use household.`
        : `Because your current context does not sound like heavy use, I would usually avoid paying more just in case unless you already know the family will use the plan heavily.`,
    ].join('\n');
  }

  return [
    `If you are really asking about household impact, I would first decide whether the medical choice is mainly about routine care, larger-risk protection, or a preferred network.`,
    ``,
    `That is what tells you whether the cheaper plan or the richer plan is more worth it in practice.`,
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
  return /\b(is\s+that\s+the\s+only\s+(?:option|one)|that'?s\s+the\s+only\s+one|only\s+option|any\s+other\s+options|is\s+there\s+only\s+one|only\s+one\s+(?:vision|dental)\s+plan)\b/i.test(stripAffirmationLeadIn(query.trim()).toLowerCase());
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
  if (/\b(all\s+benefits|benefits\s+overview|what\s+are\s+all\s+the\s+benefits|what\s+benefits\s+do\s+i\s+have|other\s+types?\s+of\s+coverage|what\s+other\s+coverage|other\s+coverage\s+available|what\s+else\s+is\s+available)\b/i.test(lower)) return 'Benefits Overview';
  if (/\b(life(?:\s+insurance)?|term\s+life|whole\s+life|basic\s+life)\b/i.test(lower)) return 'Life Insurance';
  if (/\b(disability|std|ltd|short[- ]?term|long[- ]?term)\b/i.test(lower)) return 'Disability';
  if (/\bcritical(?:\s+illness)?\b/i.test(lower)) return 'Critical Illness';
  if (/\b(accident|ad&d|ad\/d)\b/i.test(lower)) return 'Accident/AD&D';
  if (/\b(hsa(?:\s*\/\s*fsa)?|fsa)\b/i.test(lower)) return 'HSA/FSA';
  if (/\bdental\b/i.test(lower)) return 'Dental';
  if (/\b(vision|eye|glasses|contacts|lasik)\b/i.test(lower)) return 'Vision';
  if (/\b(medical|health|hsa\s+plan|kaiser|hmo|ppo|standard\s+hsa|enhanced\s+hsa)\b/i.test(lower)) return 'Medical';
  if (/\b(coverage\s+tier|coverage\s+tiers|plan\s+tradeoffs?|tradeoffs?|maternity|pregnan\w*|prenatal|postnatal|delivery|prescriptions?|generic\s+rx|brand\s+rx|specialty\s+rx|in[- ]network|out[- ]of[- ]network|standard\s+plan|enhanced\s+plan|kaiser\s+plan)\b/i.test(lower)) return 'Medical';
  return null;
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

function extractState(message: string): string | null {
  const lower = message.toLowerCase();

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

function isStateOnlyMessage(query: string): boolean {
  return Boolean(extractState(query)) && !extractAge(query) && !benefitTopicFromQuery(query);
}

function buildStateOnlyReply(session: Session, priorState: string | null | undefined, query: string): string | null {
  const extractedState = extractState(query);
  if (!extractedState || extractAge(query) || benefitTopicFromQuery(query)) return null;

  if (!priorState) {
    if (session.userAge) {
      return `Thanks — I’ll use ${extractedState} for plan availability and pricing going forward.`;
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

  return `Thanks — I’ve updated your state to ${extractedState}, and I’ll use that going forward.`;
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
  return /\b(all\s+benefits|benefits\s+overview|what\s+are\s+all\s+the\s+benefits|what\s+benefits\s+do\s+i\s+have|other\s+types?\s+of\s+coverage|what\s+other\s+coverage|other\s+coverage\s+available|what\s+else\s+is\s+available)\b/i
    .test(stripAffirmationLeadIn(query.trim()).toLowerCase());
}

function isContextualBenefitsOverviewQuestion(query: string): boolean {
  return /\b(other\s+types?\s+of\s+coverage|what\s+other\s+coverage|other\s+coverage\s+available|what\s+else\s+is\s+available)\b/i
    .test(stripAffirmationLeadIn(query.trim()).toLowerCase());
}

function buildTopicReply(session: Session, topic: string, query: string): string {
  clearPendingGuidance(session);

  if (topic === 'Benefits Overview') {
    return buildBenefitsOverviewReply(session, { contextual: isContextualBenefitsOverviewQuestion(query) });
  }

  if (topic === 'Medical') {
    session.coverageTierLock = getCoverageTierForQuery(query, session);
    if (isCostModelRequest(query)) {
      return pricingUtils.estimateCostProjection({
        coverageTier: session.coverageTierLock,
        usage: usageLevelFromQuery(query),
        network: normalizeNetworkPreference(query),
        state: session.userState || undefined,
        age: session.userAge || undefined,
      });
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
    return `We can stay with medical. The most useful next step is usually one of these: compare the plan tradeoff, estimate likely costs, or talk through why one option fits better for your situation.`;
  }

  if (session.currentTopic === 'Dental') {
    return `We can stay with dental. The most useful next step is usually whether the plan is worth adding, what orthodontia means in practice, or whether dental matters more than vision for your household.`;
  }

  if (session.currentTopic === 'Vision') {
    return `We can stay with vision. The most useful next step is usually whether it is worth adding for your household, or whether vision matters more than dental based on expected use.`;
  }

  if (session.currentTopic === 'Life Insurance') {
    return `We can stay with life insurance. The most useful next step is usually whether life or disability matters more first, or how much protection is worth paying for if your family relies on your income.`;
  }

  if (session.currentTopic === 'Disability') {
    return `We can stay with disability. The most useful next step is usually whether disability or life insurance deserves priority, or whether paycheck protection is worth adding for your household.`;
  }

  if (session.currentTopic === 'Accident/AD&D' || session.currentTopic === 'Critical Illness') {
    return `We can stay with supplemental protection. The most useful next step is usually whether this is worth adding at all, or how it compares with the other supplemental options.`;
  }

  if (session.currentTopic === 'HSA/FSA') {
    return `We can stay with HSA/FSA. The most useful next step is usually when HSA fits better, when FSA fits better, or what the tax and rollover tradeoff means in practice.`;
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
  const soleBreadwinner = /\b(sole\s+bread[- ]?winner|only\s+income|husband doesn'?t work|spouse doesn'?t work|family relies on my income|rely on my income)\b/i.test(combined);
  const familyContext = /\b(spouse|partner|kids?|children|family|household)\b/i.test(combined);
  const standardPlanContext = /\bstandard hsa|standard plan\b/i.test(combined);

  if (topic === 'Critical Illness') {
    if (soleBreadwinner) {
      return [
        `My practical take is that I would usually **not** make critical illness the first extra add-on if you are the sole breadwinner.`,
        ``,
        `In that situation, I would usually prioritize the core medical decision first, then disability or life if income protection is the bigger household risk.`,
        `I would only add critical illness after that if you want an extra diagnosis-triggered cash buffer on top of the core package.`,
        ``,
        standardPlanContext
          ? `Because you are already leaning toward the lower-premium Standard HSA, I would be especially careful about adding supplemental payroll deductions before I am confident the household has the right core medical and income protection in place. So if you are asking me directly, my answer is usually **not yet**.`
          : `So my recommendation is: treat critical illness as optional extra protection, not the first must-have decision for this household.`,
      ].join('\n');
    }

    return [
      `My practical take is that critical illness is worth adding **only if** you want extra diagnosis-triggered cash support on top of your medical plan.`,
      ``,
      `I would usually say yes when a household would feel real stress from travel, childcare, or other non-medical bills during a serious diagnosis.`,
      `I would usually say no when the main concern is just routine care costs or when the household has bigger priorities like choosing the right medical plan first.`,
      ``,
      familyContext
        ? `Since you are asking in a family context, I would usually put medical first, then life or disability if income protection matters, and critical illness after that if you still want extra diagnosis protection. So if you are asking me directly, my answer is usually **only after** the bigger household-protection choices are settled.`
        : `So I see critical illness as a later-layer protection decision, not one of the first core choices.`,
    ].join('\n');
  }

  if (topic === 'Accident/AD&D') {
    return [
      `My practical take is that I would only add Accident/AD&D if the household feels meaningfully exposed to injury risk and you want extra cash support after a covered accident.`,
      ``,
      `If the bigger concern is diagnosis risk or income protection, I would usually look at critical illness, disability, or life before accident coverage.`,
      ``,
      `So if you are asking me directly, my answer is usually **yes only when** injury risk feels like the real gap you are trying to protect.`,
    ].join('\n');
  }

  if (topic === 'Disability') {
    return [
      `My practical take is that disability is often worth adding sooner than people expect if your household depends on your paycheck.`,
      ``,
      `If missing part of your income would create a real problem, disability usually deserves more attention than smaller supplemental cash benefits.`,
      ``,
      `So if you are asking me directly, my answer is usually **yes** when your paycheck is carrying the household.`,
    ].join('\n');
  }

  if (topic === 'Life Insurance') {
    return [
      `My practical take is that life insurance is usually worth tightening up if other people rely on your income and would need support if something happened to you.`,
      ``,
      `I would usually treat that as a more important household-protection decision than smaller supplemental add-ons.`,
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
  const lower = query.toLowerCase();
  const activeTopic = session.currentTopic || inferTopicFromLastBotMessage(session.lastBotMessage);
  const inferredSupplementalTopic = inferSupplementalTopicForFollowup(session, query);
  const focus = detectBenefitPriorityFocus(query);
  const hsaFitFocus = detectHsaFitFocus(query);
  const supplementalComparisonFocus = detectSupplementalComparisonFocus(query);
  const lastBotMessage = session.lastBotMessage || '';
  const assistantHistory = (session.messages || [])
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content);
  const hasMedicalRecommendationInHistory = assistantHistory.some((content) => /My recommendation:\s*/i.test(content));
  const wantsWhy = /\bwhy\b|\bwhy that\b|\bwhy is that\b/i.test(lower);
  const wantsPracticalTake = /\bwhat would you do\b|\bwhich would you pick\b|\bwhat'?s your practical take\b|\bwhich one would you choose\b|\bwhich one would you pick\b/i.test(lower);
  const wantsWorthPremium = /\bworth the extra premium\b|\bworth paying more\b|\bworth the higher premium\b|\bwhy pay more\b/i.test(lower);
  const wantsDecisionReason = /\bwhy would i pick that\b|\bwhy pick that\b|\bwhy choose that\b|\bwhy that one\b|\bwhy that one over the other\b|\bwhy that over the other\b/i.test(lower);
  const wantsCheaperOption = /\b(the cheaper one|cheaper one|cheaper option|lower premium one|lower premium option|lowest premium one|lowest premium option)\b/i.test(lower);
  const wantsThatOne = /\b(that one|that plan|that option|the recommended one)\b/i.test(lower);
  const wantsFamilySpecific = isFamilySpecificFollowup(query);
  const contextualComparisonKind = detectContextualComparisonKind(session, query);

  if (
    activeTopic === 'Medical'
    && inferredSupplementalTopic
    && isSupplementalRecommendationQuestion(query)
  ) {
    const recommendation = buildSupplementalRecommendationReply(inferredSupplementalTopic, session, query);
    if (recommendation) {
      setTopic(session, inferredSupplementalTopic);
      return recommendation;
    }
  }

  if (activeTopic === 'HSA/FSA' && (/\bwhat\s+does\s+hsa\s+mean\b|\bwhat\s+is\s+an?\s+hsa\b|\bwhat\s+does\s+fsa\s+mean\b|\bwhat\s+is\s+an?\s+fsa\b/i.test(lower))) {
    return buildTopicReply(session, 'HSA/FSA', query);
  }

  if (session.pendingGuidancePrompt === 'benefit_decision' && focus) {
    session.pendingGuidancePrompt = 'benefit_decision';
    return buildBenefitDecisionGuidance(session, focus);
  }
  if (session.pendingGuidancePrompt === 'benefit_decision' && wantsFamilySpecific) {
    session.pendingGuidancePrompt = 'benefit_decision';
    return buildBenefitDecisionGuidance(session, 'family_protection');
  }

  if (session.pendingGuidancePrompt === 'orthodontia_braces' && isOrthodontiaBracesFollowup(query)) {
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
    if (isSimpleAffirmation(query) || /\b(hsa|fsa|better fit|which one|long[- ]term savings|near[- ]term medical expenses)\b/i.test(lower)) {
      clearPendingGuidance(session);
      return buildHsaFitGuidance();
    }
  }

  if (session.pendingGuidancePrompt === 'supplemental_fit' && shouldHandleSupplementalFitFollowup(query)) {
    const fitTopic =
      session.pendingGuidanceTopic
      || (session.currentTopic === 'Life Insurance' || session.currentTopic === 'Disability' || session.currentTopic === 'Critical Illness' || session.currentTopic === 'Accident/AD&D'
        ? session.currentTopic
        : inferTopicFromLastBotMessage(lastBotMessage));
    if (
      fitTopic
      && (fitTopic === 'Life Insurance' || fitTopic === 'Disability' || fitTopic === 'Critical Illness' || fitTopic === 'Accident/AD&D')
      && isRepeatedSupplementalWorthQuestion(query)
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
    && shouldHandleSupplementalFitFollowup(query)
    && /worth considering for your situation|usually worth considering when one of these sounds true|usually worth considering when you want extra cash support|usually worth considering if missing part of your paycheck|people usually give it more attention when|people usually prioritize it when/i.test(lastBotMessage)
  ) {
    const fitTopic = inferredSupplementalTopic || activeTopic;
    if (fitTopic === 'Accident/AD&D' || fitTopic === 'Critical Illness' || fitTopic === 'Disability' || fitTopic === 'Life Insurance') {
      if (isRepeatedSupplementalWorthQuestion(query)) {
        setTopic(session, fitTopic);
        return buildSupplementalPracticalTake(fitTopic);
      }
      setTopic(session, fitTopic);
      return buildSupplementalFitGuidance(session, fitTopic);
    }
  }

  if (session.pendingGuidancePrompt === 'accident_vs_critical' && isAffirmativeCompareFollowup(query)) {
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

  if (session.pendingGuidancePrompt === 'life_vs_disability' && isAffirmativeCompareFollowup(query)) {
    clearPendingGuidance(session);
    return buildLifeVsDisabilityComparison();
  }

  if (session.pendingGuidancePrompt === 'dental_vs_vision' && isAffirmativeCompareFollowup(query)) {
    clearPendingGuidance(session);
    return buildDentalVsVisionDecision();
  }

  if (session.pendingGuidancePrompt === 'medical_tradeoff_compare' && isAffirmativeCompareFollowup(query)) {
    clearPendingGuidance(session);
    setTopic(session, 'Medical');
    return pricingUtils.estimateCostProjection({
      coverageTier: coverageTierFromConversation(session) || session.coverageTierLock || 'Employee Only',
      usage: usageLevelFromSession(session),
      state: session.userState || undefined,
      age: session.userAge || undefined,
    });
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
    const recommendation = buildSupplementalRecommendationReply(inferredSupplementalTopic, session, query);
    if (recommendation) {
      setTopic(session, inferredSupplementalTopic);
      return recommendation;
    }
  }

  if (activeTopic === 'Medical' && (hasMedicalRecommendationInHistory || /My recommendation:/i.test(lastBotMessage))) {
    if (wantsPracticalTake || wantsDecisionReason || wantsThatOne) {
      return buildMedicalPracticalTake(session);
    }
    if (wantsCheaperOption) {
      return [
        `If you mean the cheaper option, that is usually **Standard HSA**.`,
        ``,
        `That is the one I would usually keep if the goal is lower payroll cost and you do not expect enough care to justify paying more up front.`,
      ].join('\n');
    }
    if (wantsWhy) {
      return buildMedicalRecommendationWhy(session);
    }
    if (wantsWorthPremium) {
      return buildMedicalWorthExtraPremiumReply(session);
    }
    if (wantsFamilySpecific) {
      return buildMedicalFamilySpecificReply(session, query);
    }
  }

  if (activeTopic === 'Medical' && isMedicalPregnancySignal(query) && !isCostModelRequest(query)) {
    return buildTopicReply(session, 'Medical', /maternity|pregnan|baby|birth|delivery|prenatal|postnatal/i.test(lower) ? query : 'maternity coverage');
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
    && (isRoutineCareComparisonPrompt(query)
      || /\b(dental|vision)\b/i.test(lower) && /\b(recommend|get|worth|useful|only\s+option)\b/i.test(lower))
  ) {
    return buildDentalVsVisionDecision();
  }

  if (activeTopic === 'Vision' && isOnlyOptionQuestion(query)) {
    return buildVisionOnlyOptionReply();
  }

  if (activeTopic === 'Vision' && isWorthAddingFollowup(query)) {
    return buildVisionWorthAddingReply();
  }

  if (activeTopic === 'Dental' && isOnlyOptionQuestion(query)) {
    return buildDentalOnlyOptionReply();
  }

  if (activeTopic === 'Dental' && isWorthAddingFollowup(query)) {
    return buildDentalWorthAddingReply();
  }

  if (
    (inferredSupplementalTopic === 'Accident/AD&D' || inferredSupplementalTopic === 'Critical Illness' || inferredSupplementalTopic === 'Disability' || inferredSupplementalTopic === 'Life Insurance')
    && isRepeatedSupplementalWorthQuestion(query)
  ) {
    setTopic(session, inferredSupplementalTopic);
    return buildSupplementalPracticalTake(inferredSupplementalTopic);
  }

  if (
    (activeTopic === 'Accident/AD&D' || activeTopic === 'Critical Illness' || activeTopic === 'Disability' || activeTopic === 'Life Insurance')
    && isRepeatedSupplementalWorthQuestion(query)
  ) {
    setTopic(session, activeTopic);
    return buildSupplementalPracticalTake(activeTopic);
  }

  if ((activeTopic === 'Accident/AD&D' || activeTopic === 'Critical Illness' || activeTopic === 'Disability' || activeTopic === 'Life Insurance') && isWorthAddingFollowup(query)) {
    if (isSupplementalRecommendationQuestion(query)) {
      const recommendation = buildSupplementalRecommendationReply(activeTopic, session, query);
      if (recommendation) {
        setTopic(session, activeTopic);
        return recommendation;
      }
    }
    setTopic(session, activeTopic);
    return buildSupplementalFitGuidance(session, activeTopic);
  }

  if ((inferredSupplementalTopic === 'Accident/AD&D' || inferredSupplementalTopic === 'Critical Illness' || inferredSupplementalTopic === 'Disability' || inferredSupplementalTopic === 'Life Insurance') && isWorthAddingFollowup(query)) {
    if (isSupplementalRecommendationQuestion(query)) {
      const recommendation = buildSupplementalRecommendationReply(inferredSupplementalTopic, session, query);
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
    && isNonMedicalDetailQuestion(inferredSupplementalTopic, query)
    && !(supplementalComparisonFocus && /Accident\/AD&D and Critical Illness/i.test(lastBotMessage))) {
    setTopic(session, inferredSupplementalTopic);
    return buildTopicReply(session, inferredSupplementalTopic, query);
  }

  if (
    /plain-language difference between Accident\/AD&D and Critical Illness/i.test(lastBotMessage)
    || /simplest way to separate life insurance from disability/i.test(lastBotMessage)
    || /deciding between dental and vision as the next add-on/i.test(lastBotMessage)
  ) {
    if (/Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
      const reply = buildWhyNotOtherFirstReply('accident_vs_critical', query);
      if (reply) return reply;
    }
    if (/life insurance from disability/i.test(lastBotMessage)) {
      const reply = buildWhyNotOtherFirstReply('life_vs_disability', query);
      if (reply) return reply;
    }
    if (/dental and vision as the next add-on/i.test(lastBotMessage)) {
      const reply = buildWhyNotOtherFirstReply('dental_vs_vision', query);
      if (reply) return reply;
    }
    if (supplementalComparisonFocus && /Accident\/AD&D and Critical Illness/i.test(lastBotMessage)) {
      return buildAccidentVsCriticalFocusedReply(supplementalComparisonFocus);
    }
    if (
      wantsPracticalTake
      || wantsDecisionReason
      || wantsThatOne
      || isAffirmativeCompareFollowup(query)
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
        return buildComparisonFamilyReply('accident_vs_critical', query);
      }
      if (/life insurance from disability/i.test(lastBotMessage)) {
        return buildComparisonFamilyReply('life_vs_disability', query);
      }
      if (/dental and vision as the next add-on/i.test(lastBotMessage)) {
        return buildComparisonFamilyReply('dental_vs_vision', query);
      }
    }
  }

  if (isAffirmativeCompareFollowup(query)) {
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
  }

  if (session.pendingTopicSuggestion && (isSimpleAffirmation(query) || /\b(do that|do it|let'?s do that|let'?s do it|next one|show me that one)\b/i.test(lower))) {
    const suggestedTopic = session.pendingTopicSuggestion;
    clearPendingGuidance(session);
    setTopic(session, suggestedTopic);
    return buildTopicReply(session, suggestedTopic, `${suggestedTopic} options`);
  }

  if (!activeTopic && !session.pendingGuidancePrompt) return null;

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
    && !isMedicalDetailQuestion(query)
  ) {
    setTopic(session, 'Critical Illness');
    return buildTopicReply(session, 'Critical Illness', 'critical illness');
  }

  if (activeTopic === 'Medical') {
    if (isCostModelRequest(query)) {
      return buildTopicReply(session, 'Medical', query);
    }
    if (isMedicalDetailQuestion(query)) {
      const detailedAnswer = buildMedicalPlanDetailAnswer(query, session);
      if (detailedAnswer) return detailedAnswer;
      const medicalFallback = buildMedicalPlanFallback(query, session);
      if (medicalFallback) return medicalFallback;
    }
    if (
      (isSimpleAffirmation(query) || /\b(compare|yes)\b/i.test(lower)) &&
      /\blikely\s+total\s+annual\s+cost\b|\bcompare\b.*\bstandard\s+hsa\b.*\benhanced\s+hsa\b/i.test(session.lastBotMessage || '')
    ) {
      return pricingUtils.estimateCostProjection({
        coverageTier: coverageTierFromConversation(session) || 'Employee Only',
        usage: usageLevelFromSession(session),
        state: session.userState || undefined,
        age: session.userAge || undefined,
      });
    }
    if (/\b(low|moderate|high)\s+usage\b|\bgenerally\s+healthy\b|\blow\s+bills\b/i.test(lower)) {
      const recommendation = buildRecommendationOverview(query, session);
      if (recommendation) return recommendation;
    }
  }

  if (isSimpleAffirmation(query)) {
    return buildPackageGuidance(session, session.currentTopic);
  }

  if (activeTopic === 'Dental' && /\borthodontia\s+rider\b|\brider\b/i.test(lower)) {
    session.pendingGuidancePrompt = 'orthodontia_braces';
    session.pendingGuidanceTopic = 'Dental';
    return `An orthodontia rider means the dental plan includes an added orthodontic benefit instead of excluding braces and related treatment entirely. In practical terms, it is the part of the dental coverage that makes orthodontia available under the plan's rules.\n\nFor AmeriVet's dental plan, that means orthodontic coverage is included rather than being a separate standalone dental plan. If you want, I can explain what that means for braces and out-of-pocket costs next.`;
  }

  return null;
}

function buildStateCorrectionReply(session: Session, query: string): string | null {
  const correction = detectExplicitStateCorrection(query, session.userState);
  if (!correction) return null;

  session.userState = correction.state;
  const detectedTopic = benefitTopicFromQuery(query);
  const normalizedTopic = detectedTopic && detectedTopic !== 'Benefits Overview'
    ? normalizeBenefitCategory(detectedTopic)
    : detectedTopic;

  if (!session.currentTopic) {
    return `Thanks for the correction — I’ve updated your state to ${correction.state}.`;
  }

  if (isCostModelRequest(query)) {
    session.currentTopic = 'Medical';
    return `Thanks for the correction — in ${correction.state}, here’s the updated cost view:\n\n${buildTopicReply(session, 'Medical', query)}`;
  }

  if (normalizedTopic && normalizedTopic !== 'Benefits Overview' && normalizedTopic !== session.currentTopic) {
    setTopic(session, normalizedTopic);
    return `Thanks for the correction — I’ve updated your state to ${correction.state}. Here’s the updated ${normalizedTopic.toLowerCase()} view:\n\n${buildTopicReply(session, normalizedTopic, query)}`;
  }

  if (session.currentTopic === 'Medical') {
    return `Thanks for the correction — in ${correction.state}, here’s the updated medical view:\n\n${buildTopicReply(session, 'Medical', query)}`;
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

  const standaloneFocus = detectBenefitPriorityFocus(query);
  if (standaloneFocus && !benefitTopicFromQuery(query) && /^(\s*(healthcare costs|family protection|routine care)\s*)$/i.test(query)) {
    const answer = buildBenefitDecisionGuidance(session, standaloneFocus);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'benefit-focus-shortcut-v2' } };
  }

  if (isCostModelRequest(query) && !detectedTopic) {
    setTopic(session, 'Medical');
    const answer = buildTopicReply(session, 'Medical', query);
    session.lastBotMessage = answer;
    session.messages.push({ role: 'assistant', content: answer });
    return { answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'cost-model-v2', topic: 'Medical' } };
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

  const continuationReply = buildContinuationReply(session, query);
  if (continuationReply) {
    session.lastBotMessage = continuationReply;
    session.messages.push({ role: 'assistant', content: continuationReply });
    return { answer: continuationReply, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'continuation-v2', topic: session.currentTopic || null } };
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
