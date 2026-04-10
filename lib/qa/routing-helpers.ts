import { KAISER_AVAILABLE_STATE_CODES } from '@/lib/data/amerivet';
import type { IntentDomain } from '@/lib/intent-digest';

type L1FAQArgs = {
  enrollmentPortalUrl: string;
  hrPhone: string;
};

type L1FAQEntry = {
  patterns: RegExp[];
  answer: (args: L1FAQArgs) => string;
};

const L1_FAQ: L1FAQEntry[] = [
  {
    patterns: [/\b(hr\s*(phone|number|contact|line)|phone\s*number.*hr|call\s*(hr|human\s*resources)|hr\s*hotline|how\s*do\s*i\s*(call|reach|contact)\s*(hr|amerivet))\b/i],
    answer: ({ enrollmentPortalUrl, hrPhone }) => `AmeriVet HR/Benefits can be reached at ${hrPhone}. For self-service enrollment, visit ${enrollmentPortalUrl}.`,
  },
  {
    patterns: [/\b(where\s*do\s*i\s*(enroll|sign\s*up|register)|enrollment\s*(portal|link|url|site|page)|workday\s*(link|url|portal)|how\s*do\s*i\s*(access|open|find)\s*(workday|the\s*portal|enrollment))\b/i],
    answer: ({ enrollmentPortalUrl, hrPhone }) => `The AmeriVet benefits enrollment portal is Workday: ${enrollmentPortalUrl}\n\nYou can also call HR at ${hrPhone} for guided enrollment support.`,
  },
  {
    patterns: [/\bright\s*way\b|\brightway\b/i],
    answer: ({ enrollmentPortalUrl, hrPhone }) => `Rightway is not an AmeriVet benefits resource and is not part of the AmeriVet benefits package.\n\nFor benefits navigation support, please contact AmeriVet HR/Benefits at ${hrPhone} or visit ${enrollmentPortalUrl}.`,
  },
  {
    patterns: [/\bkaiser\b.*\b(only|available|states?|where|which\s+states?|limited|regions?)\b|\b(only|available|states?|where|which\s+states?|limited|regions?)\b.*\bkaiser\b/i],
    answer: () => `Kaiser HMO is only available in California (CA), Georgia (GA), Washington (WA), and Oregon (OR) through AmeriVet. It is not available in any other state. In all other states, your medical options are Standard HSA and Enhanced HSA (both through BCBS of Texas, nationwide PPO network).`,
  },
  {
    patterns: [/\b(receptionist|office\s*(staff|personnel|directory)|name\s*of.*(?:dentist|doctor|office|staff)|staff\s*(name|list|directory)|who\s*is\s*(?:the|my)\s*(?:dentist|doctor|hr\s*rep|benefits\s*rep))\b/i],
    answer: ({ hrPhone }) => `I don't have that specific internal personnel data. For office-level contacts or staff directories, please reach out to AmeriVet HR at ${hrPhone}.`,
  },
];

const KAISER_STATE_CODES = new Set<string>(KAISER_AVAILABLE_STATE_CODES);

const STALE_KAISER_GEOGRAPHY_PATTERNS: RegExp[] = [
  /California,\s+Washington,\s+and\s+Oregon/gi,
  /California\s+\(CA\),\s+Washington\s+\(WA\),\s+and\s+Oregon\s+\(OR\)/gi,
  /\bCA,\s*WA,\s*OR\b/gi,
];

export function isRightwayQuery(query: string): boolean {
  return /\bright\s*way\b|\brightway\b/i.test(query);
}

export function normalizeStaticBenefitAnswer(answer: string): string {
  let normalized = answer;
  for (const pattern of STALE_KAISER_GEOGRAPHY_PATTERNS) {
    normalized = normalized.replace(pattern, "California, Georgia, Washington, and Oregon");
  }

  normalized = normalized.replace(
    /Kaiser HMO is only available in California \(CA\), Washington \(WA\), and Oregon \(OR\)/gi,
    "Kaiser HMO is only available in California (CA), Georgia (GA), Washington (WA), and Oregon (OR)"
  );

  return normalized;
}

export function normalizeBenefitCategory(keyword: string): string {
  const lower = keyword.toLowerCase();
  if (/medical|health|ppo|hmo|hdhp|kaiser/.test(lower)) return 'Medical';
  if (/dental/.test(lower)) return 'Dental';
  if (/vision|eye/.test(lower)) return 'Vision';
  if (/life/.test(lower)) return 'Life Insurance';
  if (/disability|std|ltd/.test(lower)) return 'Disability';
  if (/critical/.test(lower)) return 'Critical Illness';
  if (/accident|ad&d/.test(lower)) return 'Accident/AD&D';
  if (/hsa|fsa/.test(lower)) return 'HSA/FSA';
  return keyword.charAt(0).toUpperCase() + keyword.slice(1);
}

export function isSimpleAffirmation(message: string): boolean {
  const normalized = message.trim().replace(/[.!?]+$/g, '');
  return /^(yes|yes please|yeah|yep|sure|ok|okay|please|do it|go ahead)$/i.test(normalized);
}

export function isStandaloneMedicalPpoRequest(query: string): boolean {
  const lower = query.toLowerCase();
  if (!/\bppo\b/i.test(lower)) return false;
  if (/\bdental\s+ppo\b/i.test(lower)) return false;
  if (/\b(dp?po|dhmo)\b/i.test(lower)) return false;
  return /\b(medical|health|plan|plans|coverage|option|options|hmo|hsa|kaiser)\b/i.test(lower) || !/\bdental\b/i.test(lower);
}

export function isKaiserAvailabilityQuestion(query: string): boolean {
  return /\bkaiser\b.*\b(only|available|states?|where|which\s+states?|limited|regions?)\b|\b(only|available|states?|where|which\s+states?|limited|regions?)\b.*\bkaiser\b/i.test(query);
}

export function buildKaiserAvailabilityFaqAnswer(userState?: string | null): string {
  if (userState) {
    const normalized = userState.toUpperCase();
    if (KAISER_STATE_CODES.has(normalized)) {
      return `Yes — Kaiser HMO is available in ${normalized}. AmeriVet offers Kaiser in California (CA), Georgia (GA), Washington (WA), and Oregon (OR).`;
    }
    return `Kaiser HMO is only available in California (CA), Georgia (GA), Washington (WA), and Oregon (OR) — it is not available in ${normalized}. In ${normalized}, your medical options are Standard HSA and Enhanced HSA through BCBSTX.`;
  }

  return `Kaiser HMO is only available in California (CA), Georgia (GA), Washington (WA), and Oregon (OR) through AmeriVet. It is not available in any other state. In all other states, your medical options are Standard HSA and Enhanced HSA (both through BCBS of Texas, nationwide PPO network).`;
}

export function isLikelyFollowUpMessage(normalizedMessage: string): boolean {
  const normalized = normalizedMessage.trim().replace(/[.!?]+$/g, '');
  return normalized.length <= 120 && /(^((yes|yes please|yeah|yep|sure|ok|okay|please|go ahead|do it|any workaround\??|what about the waiting period\??|i'?m in\s+[a-z]{2}|my usage is\s+(?:low|moderate|high)|(?:low|moderate|high)\s+usage))$|\b(more|details|difference|compare|comparison|that one|those|it|what about that|which one|go on|continue|expand|break it down|tell me more|workaround|waiting period|coverage tiers?|different coverage tier|switch coverage tiers?|my usage is|low usage|moderate usage|high usage)\b)/i.test(normalized);
}

export function isTopicContinuationMessage(query: string, currentTopic?: string): boolean {
  if (!currentTopic) return false;

  const trimmed = query.trim();
  if (trimmed.length >= 120) return false;

  const lowerQuery = trimmed.toLowerCase();
  const hasNoCategoryKeyword = !/\b(medical|dental|vision|life|disability|hsa|fsa|critical|accident|supplemental)\b/i.test(lowerQuery);
  if (!hasNoCategoryKeyword) return false;

  const shortFollowUp = trimmed.length <= 60 && /^(yes please|any workaround\??|what about the waiting period\??|difference|more|details|explain|tell me more|what'?s the difference|go on|elaborate|how so|why|which one|more info|more details|expand|break it down|what coverage tiers? (?:are available)?|coverage tiers?|i'?m in\s+[a-z]{2}|my usage is\s+(?:low|moderate|high)|(?:low|moderate|high)\s+usage)$/i.test(trimmed);
  const topicContinuation = /\b(difference|what(?:'s|\s+is)\s+available|what\s+(?:options?|plans?|choices?|coverage\s+tiers?)|what\s+(?:do\s+)?(?:i|we)\s+(?:have|get)|available\s+to\s+me|what\s+(?:are|is)\s+(?:the|my)\s+(?:options?|plans?|choices?|coverage\s+tiers?)|tell\s+me\s+(?:about\s+)?(?:the\s+)?(?:plans?|options?|coverage\s+tiers?)|just\s+want\s+to\s+know|want\s+to\s+(?:know|see|understand)|switch\s+coverage\s+tiers?|different\s+coverage\s+tier|i'?m\s+in\s+[a-z]{2}|my\s+usage\s+is\s+(?:low|moderate|high)|(?:low|moderate|high)\s+usage)\b/i.test(lowerQuery);

  return shortFollowUp || topicContinuation;
}

export function deriveConversationTopic(params: {
  benefitTypes: string[];
  primaryCategory?: string;
  existingTopic?: string;
  normalizedMessage?: string;
}): string | undefined {
  const { benefitTypes, primaryCategory, existingTopic, normalizedMessage } = params;

  if (primaryCategory) return primaryCategory;
  if (benefitTypes.length > 0) return normalizeBenefitCategory(benefitTypes[0]);

  if (!existingTopic) return undefined;
  if (normalizedMessage && isLikelyFollowUpMessage(normalizedMessage)) return existingTopic;

  return existingTopic;
}

export function isSummaryRequest(query: string): boolean {
  const lower = query.toLowerCase();
  return /\b(summary|summarize|summarise|recap|review|what\s+(?:have\s+i|did\s+i)\s+(?:decided|chosen|picked|selected)|show\s+(?:me\s+)?my\s+(?:choices|selections|decisions)|wrap\s*up|overview\s+of\s+my)\b/i.test(lower);
}

export function compileSummary(
  decisions: Record<string, any>,
  userName: string,
  enrollmentPortalUrl: string,
  allBenefitsShort: string
): string {
  const entries = Object.entries(decisions);
  if (entries.length === 0) {
    return `I don't have any benefit decisions recorded yet, ${userName}. Would you like to start exploring? Available benefits include: ${allBenefitsShort}`;
  }

  let summary = `Here's a summary of your benefit decisions so far, ${userName}:\n\n`;
  for (const [category, value] of entries) {
    const entry = typeof value === 'string' ? { status: 'selected', value } : value;
    if (entry.status === 'selected') {
      summary += `- ${category}: ${entry.value || 'Selected'}\n`;
    } else if (entry.status === 'declined') {
      summary += `- ${category}: Declined\n`;
    } else {
      summary += `- ${category}: Interested (no final decision yet)\n`;
    }
  }

  const allCategories = ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA'];
  const remaining = allCategories.filter(category => !decisions[category]);
  if (remaining.length > 0) {
    summary += `\nBenefits you haven't explored yet: ${remaining.join(', ')}\n`;
    summary += `\nWould you like to look into any of these?`;
  } else {
    summary += `\nYou've reviewed all available benefits! When you're ready to enroll, visit the portal at ${enrollmentPortalUrl}`;
  }

  return summary;
}

export function checkL1FAQ(query: string, args: L1FAQArgs): string | null {
  if (isKaiserAvailabilityQuestion(query)) {
    const stateMatch = query.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i);
    return buildKaiserAvailabilityFaqAnswer(stateMatch?.[0]?.toUpperCase());
  }

  const lower = query.toLowerCase();
  for (const entry of L1_FAQ) {
    if (entry.patterns.some(pattern => pattern.test(lower))) {
      return entry.answer(args);
    }
  }
  return null;
}

export function shouldUseCategoryExplorationIntercept(query: string, lowerQuery: string, intentDomain: IntentDomain): boolean {
  if (intentDomain === 'policy') return false;
  if (query.length > 150) return false;

  if (/\b(compare|difference|recommend|best|should\s+i|for\s+me|my\s+situation|if\s+|because|while|calculate|estimate|project|scenario|qle|fmla|std)\b/i.test(lowerQuery)) {
    return false;
  }

  if (/\b(do\s+we\s+have|is\s+there|does\s+it|are\s+there|who\s+is|which\s+company|what\s+carrier|what\s+provider|how\s+much\s+should|how\s+much\s+do\s+i\s+need|how\s+much\s+life|do\s+i\s+have|am\s+i\s+covered|i\s+thought)\b/i.test(lowerQuery)) {
    return false;
  }

  const trimmed = query.trim();
  const directCategory = /^(medical|medical\s+please|health|health\s+please|dental|dental\s+please|vision|vision\s+please|life(?:\s+insurance)?|life(?:\s+insurance)?\s+please|disability|disability\s+please|hsa|fsa|critical(?:\s+illness)?|accident|supplemental|benefits|benefits\s+overview|overview|family\s+coverage|family\s+coverage\s+options|what\s+benefits\s+do\s+i\s+have|what\s+are\s+my\s+options|show\s+me\s+benefits|i'?d\s+like\s+to\s+see\s+my\s+(medical|health|dental|vision)\s+options)$/i;
  const lightExplore = /^(tell\s+me\s+about|show\s+me|overview\s+of|explain)\s+(medical|health|dental|vision|life(?:\s+insurance)?|disability|hsa|fsa|critical(?:\s+illness)?|accident|supplemental|benefits)\b/i;
  const conversationalExplore = /\b(?:what\s+about|let'?s\s+(?:\w+\s+){0,2}(?:do|look\s+at|talk\s+about|go\s+(?:over|through)|explore|discuss|review|see)|what(?:'s|\s+is)\s+available\s+(?:for|in|under|with)|i\s+want\s+to\s+(?:know|learn|see|hear|understand)\s+about|how\s+about|talk\s+about|interested\s+in)\s+(?:the\s+)?(?:my\s+)?(medical|health|dental|vision|life(?:\s+insurance)?|disability|hsa|fsa|critical(?:\s+illness)?|accident|supplemental|benefits|family\s+coverage(?:\s+options)?)\b/i;
  const availableWithCategory = /\b(?:what(?:'s|\s+is)\s+available|what\s+(?:do\s+)?(?:i|we)\s+(?:have|get)|what\s+(?:options?|plans?|choices?)\s+(?:are|do))\b/i.test(lowerQuery)
    && /\b(medical|health|dental|vision|life(?:\s+insurance)?|disability|hsa|fsa|critical(?:\s+illness)?|accident|supplemental|family|spouse|child|kid|dependent)\b/i.test(lowerQuery);
  const familyCoverageExplore = /\b(family\s+coverage|family\s+plan|spouse\s+works?\s+part[- ]?time|we\s+have\s+\w+\s+kids?|we\s+have\s+\w+\s+children|coverage\s+for\s+my\s+family|our\s+family)\b/i.test(lowerQuery);

  return directCategory.test(trimmed) || lightExplore.test(trimmed) || conversationalExplore.test(trimmed) || availableWithCategory || familyCoverageExplore;
}

export function shouldUsePlanPricingIntercept(query: string, lowerQuery: string): boolean {
  if (query.length > 120) return false;

  if (/\b(my\s+(family|situation|state|needs?|usage|health)|for\s+me|if\s+i|what\s+should\s+i|which\s+is\s+better|recommend|scenario|based\s+on)\b/i.test(lowerQuery)) {
    return false;
  }

  return true;
}

export function shouldUseMedicalComparisonIntercept(query: string, lowerQuery: string, intentDomain: IntentDomain): boolean {
  if (intentDomain === 'policy') return false;
  if (query.length > 120) return false;

  if (/\b(my\s+(family|situation|state|needs?|usage|health|age)|for\s+me|for\s+my|if\s+i|what\s+should\s+i|which\s+is\s+better|recommend|best\s+for|based\s+on|given\s+|specific|i\s+have|i\s+am|scenario)\b/i.test(lowerQuery)) {
    return false;
  }

  return true;
}
