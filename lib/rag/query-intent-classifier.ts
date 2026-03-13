/**
 * Query Intent Classifier — Response Shape Router
 *
 * Classifies user queries by the *type of answer* expected,
 * NOT by topic (that's semantic-router.ts) or scenario (that's query-intent-detector.ts).
 *
 * Used in two places:
 * 1. buildCategoryExplorationResponse() — to sub-route deterministic templates
 * 2. LLM user message — to inject a response-shape hint so the LLM
 *    knows whether to give a full overview, a yes/no, a single fact, etc.
 */

export type QueryIntent =
  | 'exploratory'    // "tell me about", "what options", first mention of a category
  | 'yes_no'         // "do we have", "is there", "can I get"
  | 'factual_lookup' // "who is", "which company", "what is the deductible"
  | 'advisory'       // "how much should I buy", "what do you recommend"
  | 'comparison'     // "difference between", "compare", "vs"
  | 'cost_lookup'    // "how much does", "what's the premium", "per paycheck"
  | 'followup';      // short query with no category keyword (uses session topic)

export interface IntentClassification {
  intent: QueryIntent;
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern tables — ordered by priority (first match wins within a tier)
// ─────────────────────────────────────────────────────────────────────────────

const YES_NO_PATTERNS = [
  /\b(do\s+we\s+have|is\s+there|are\s+there|does\s+amerivet\s+(?:have|offer)|do\s+(?:we|you|they)\s+offer)\b/i,
  /\b(can\s+i\s+(?:get|add|enroll|keep|use|have))\b/i,
  /\b(is\s+(?:it|this|that)\s+(?:available|included|covered|portable|taxable))\b/i,
  /\b(am\s+i\s+(?:eligible|covered|enrolled))\b/i,
  /\b(do\s+i\s+(?:have|need|qualify|get))\b/i,
  /\b(is\s+(?:kaiser|unum|allstate|bcbs|vsp)\s+(?:available|included))\b/i,
];

const FACTUAL_LOOKUP_PATTERNS = [
  /\b(who\s+(?:is|provides|covers|carries|offers|underwrites))\b/i,
  /\b(which\s+(?:company|carrier|provider|insurer))\b/i,
  /\b(what\s+(?:is|are)\s+the\s+(?:deductible|copay|coinsurance|out.of.pocket|oop|premium|maximum|limit|elimination|waiting))\b/i,
  /\b(what\s+(?:is|are)\s+(?:my|the)\s+(?:coverage|benefit)\s+(?:amount|limit))\b/i,
  /\b(how\s+(?:long|many)\s+(?:is|are|does))\b/i,
  /\b(what\s+network)\b/i,
  /\b(when\s+(?:does|is|can)\s+(?:it|coverage|enrollment))\b/i,
];

const ADVISORY_PATTERNS = [
  /\b(how\s+much\s+(?:life\s+insurance\s+)?should\s+i)\b/i,
  /\b(should\s+i\s+(?:buy|get|enroll|choose|pick|add|sign\s+up))\b/i,
  /\b(what\s+(?:do\s+you|would\s+you)\s+recommend)\b/i,
  /\b(which\s+(?:plan|option)\s+(?:is\s+)?(?:best|right|better)\s+(?:for\s+me)?)\b/i,
  /\b(what\s+should\s+i\s+(?:do|choose|pick|get|select))\b/i,
  /\b(how\s+much\s+(?:coverage\s+)?(?:do\s+i\s+need|should\s+i\s+(?:get|buy)))\b/i,
  /\b(is\s+it\s+worth)\b/i,
  /\b(do\s+i\s+need)\b.*\b(more|extra|additional)\b/i,
];

const COMPARISON_PATTERNS = [
  /\b((?:what(?:'s|\s+is)\s+the\s+)?difference\s+between)\b/i,
  /\b(compare|comparison)\b/i,
  /\b(vs\.?|versus)\b/i,
  /\b((?:which\s+is\s+)?(?:better|cheaper|more\s+(?:expensive|affordable)))\b/i,
  /\b(how\s+(?:does|do)\s+.+\s+compare)\b/i,
  /\b(pros?\s+and\s+cons?)\b/i,
  /\b(term\s+(?:vs?\.?|or|versus)\s+whole)\b/i,
  /\b(hsa\s+(?:vs?\.?|or|versus)\s+(?:fsa|ppo))\b/i,
];

const COST_LOOKUP_PATTERNS = [
  /\b(how\s+much\s+(?:does|is|will|would)\s+(?:it|the|my))\b/i,
  /\b(how\s+much\s+(?:does|is)\s+(?:dental|vision|medical|life|disability))\b/i,
  /\b(what(?:'s|\s+is)\s+the\s+(?:premium|cost|price|rate))\b/i,
  /\b(what\s+(?:does|would)\s+(?:it|this|that)\s+cost)\b/i,
  /\b(per\s+(?:paycheck|month|year|pay\s*period))\b/i,
  /\b(monthly\s+(?:cost|premium|rate|price))\b/i,
];

const EXPLORATORY_PATTERNS = [
  /\b(tell\s+me\s+(?:about|more))\b/i,
  /\b(what\s+(?:are|is)\s+(?:my|our|the)\s+(?:options?|benefits?|plans?|coverage))\b/i,
  /\b((?:show|give)\s+me\s+(?:an?\s+)?(?:overview|summary|breakdown|details?|info))\b/i,
  /\b((?:explain|describe)\s+(?:the|my|our)?\s*(?:life|dental|vision|medical|disability|hsa|fsa|benefits?))\b/i,
  /\b(what(?:'s|\s+is)\s+available)\b/i,
  /\b(what\s+(?:do\s+)?(?:i|we)\s+(?:have|get))\b/i,
  /\b((?:let(?:'s|\s+us)\s+)?(?:look\s+at|explore|go\s+(?:over|through)|review))\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Main classifier
// ─────────────────────────────────────────────────────────────────────────────

export function classifyQueryIntent(
  query: string,
  sessionTopic?: string,
): IntentClassification {
  const q = query.trim();
  const lower = q.toLowerCase();

  // Short follow-ups with an active session topic
  if (q.length < 25 && sessionTopic) {
    const hasNoCategory = !/\b(medical|dental|vision|life|disability|hsa|fsa|critical|accident|supplemental)\b/i.test(lower);
    if (hasNoCategory) {
      return { intent: 'followup', confidence: 0.80 };
    }
  }

  // Run pattern tiers in priority order.
  // Cost-lookup before advisory because "how much does X cost" is cost, not advice.
  // Yes/no before factual-lookup because "do we have X" is yes/no, not a fact dump.

  if (matchesAny(lower, COST_LOOKUP_PATTERNS)) {
    return { intent: 'cost_lookup', confidence: 0.90 };
  }

  if (matchesAny(lower, COMPARISON_PATTERNS)) {
    return { intent: 'comparison', confidence: 0.90 };
  }

  if (matchesAny(lower, YES_NO_PATTERNS)) {
    return { intent: 'yes_no', confidence: 0.85 };
  }

  if (matchesAny(lower, ADVISORY_PATTERNS)) {
    return { intent: 'advisory', confidence: 0.85 };
  }

  if (matchesAny(lower, FACTUAL_LOOKUP_PATTERNS)) {
    return { intent: 'factual_lookup', confidence: 0.85 };
  }

  if (matchesAny(lower, EXPLORATORY_PATTERNS)) {
    return { intent: 'exploratory', confidence: 0.80 };
  }

  // Default: if the query is very short (a bare category name) → exploratory
  if (q.length < 30 && /\b(medical|dental|vision|life|disability|hsa|fsa|critical|accident)\b/i.test(lower)) {
    return { intent: 'exploratory', confidence: 0.65 };
  }

  // Fallback — no strong signal → exploratory (safe default)
  return { intent: 'exploratory', confidence: 0.50 };
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM intent hint — injected into the user message before the LLM call
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_HINTS: Record<QueryIntent, string> = {
  yes_no:
    'RESPONSE TYPE: YES/NO — Answer yes or no first, then one sentence of supporting detail from the catalog. Do NOT give a full overview.',
  factual_lookup:
    'RESPONSE TYPE: FACTUAL LOOKUP — Answer with the specific fact requested. One to two sentences maximum. Do NOT give a full overview.',
  advisory:
    'RESPONSE TYPE: ADVISORY — Give personalized guidance based on their age, state, and situation. Use catalog data to support the recommendation. Do NOT just dump a plan overview.',
  comparison:
    'RESPONSE TYPE: COMPARISON — Compare the relevant options side by side. Highlight key differences (cost, coverage, portability). Do NOT give a full overview of every plan.',
  cost_lookup:
    'RESPONSE TYPE: COST LOOKUP — Lead with the specific cost figure (monthly). Add brief context. Do NOT give a full plan overview.',
  followup:
    'RESPONSE TYPE: FOLLOW-UP — Answer the specific follow-up question. Do NOT repeat a full overview of the benefit category.',
  exploratory:
    'RESPONSE TYPE: EXPLORATORY — Give a comprehensive overview of the benefit category with key details and pricing.',
};

export function getIntentHint(intent: QueryIntent): string {
  return INTENT_HINTS[intent];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}
