export type BCGEmployerGuidanceTopic = 'Life Insurance';

export type BCGEmployerGuidanceIntentFamily =
  | 'life_split_term_vs_whole';

export type BCGEmployerGuidancePlanKey =
  | 'voluntary_term_life'
  | 'whole_life';

export interface BCGEmployerGuidanceRule {
  id: string;
  topic: BCGEmployerGuidanceTopic;
  intentFamily: BCGEmployerGuidanceIntentFamily;
  title: string;
  recommendationLabel: string;
  allocation: {
    primaryPlan: BCGEmployerGuidancePlanKey;
    primaryPercent: number;
    secondaryPlan: BCGEmployerGuidancePlanKey;
    secondaryPercent: number;
  };
  rationale: readonly string[];
}

export const BCG_EMPLOYER_GUIDANCE_RULES: readonly BCGEmployerGuidanceRule[] = [
  {
    id: 'life-default-term-whole-split',
    topic: 'Life Insurance',
    intentFamily: 'life_split_term_vs_whole',
    title: 'Default permanent versus voluntary term split',
    recommendationLabel: '80% Voluntary Term Life / 20% Whole Life',
    allocation: {
      primaryPlan: 'voluntary_term_life',
      primaryPercent: 80,
      secondaryPlan: 'whole_life',
      secondaryPercent: 20,
    },
    rationale: [
      'Use voluntary term life as the main extra income-replacement layer.',
      'Use a smaller whole-life slice only when you want some permanent cash-value coverage on top.',
    ],
  },
] as const;

const WHOLE_LIFE_PATTERN = /\b(whole life|permanent(?:\s+life)?|perm)\b/i;
const TERM_LIFE_PATTERN = /\b(voluntary term(?:\s+life)?|voluntary life|term life|vol life|vol term)\b/i;
const SPLIT_PATTERN = /\b(split|mix|ratio|allocate|allocation|divide|percent|80\s*\/\s*20|20\s*\/\s*80|part of each|blend)\b/i;
const BOTH_LIFE_PATTERN = /\b(do\s+i\s+need\s+both|do\s+we\s+need\s+both|should\s+i\s+do\s+both|should\s+we\s+do\s+both|should\s+i\s+carry\s+both|should\s+we\s+carry\s+both|should\s+i\s+pay\s+for\s+both|should\s+we\s+pay\s+for\s+both|should\s+i\s+buy\s+both|should\s+we\s+buy\s+both|both\s+of\s+those)\b/i;
const LIFE_DECISION_PATTERN = /\b(what\s+do\s+you\s+recommend|would\s+you\s+recommend|how\s+much\s+would\s+you\s+recommend|what\s+amount\s+would\s+you\s+recommend|how\s+much\s+of\s+each\s+would\s+you\s+recommend|which\s+one\s+should\s+i\s+get|which\s+ones\s+should\s+i\s+get|which\s+of\s+those\s+should\s+i\s+get|which\s+should\s+i\s+get|which\s+should\s+i\s+prioritize|what\s+should\s+i\s+prioritize|what\s+should\s+i\s+start\s+with|which\s+one\s+should\s+i\s+start\s+with|what'?s\s+the\s+smarter\s+move|what\s+is\s+the\s+smarter\s+move|which\s+one\s+makes\s+more\s+sense|what\s+makes\s+more\s+sense|help\s+me\s+decide|help\s+me\s+with\s+that|what\s+should\s+i\s+think\s+about|which\s+fits\s+better|which\s+life\s+(?:option|coverage)\s+fits|how\s+much\s+should\s+i\s+get|how\s+much\s+coverage\s+should\s+i\s+get|how\s+much\s+protection\s+is\s+worth\s+paying|how\s+do\s+i\s+know\s+how\s+much\s+of\s+each\s+to\s+get|how\s+should\s+i\s+split\s+that|how\s+do\s+i\s+split\s+that|what\s+mix\s+makes\s+sense|should\s+i\s+do\s+(?:perm|whole\s+life)\s+or\s+(?:vol(?:untary)?\s+)?term(?:\s+life)?|should\s+i\s+do\s+(?:vol(?:untary)?\s+)?term(?:\s+life)?\s+or\s+(?:perm|whole\s+life)|perm\s+vs\.?\s+(?:vol(?:untary)?\s+)?term(?:\s+life)?|(?:vol(?:untary)?\s+)?term(?:\s+life)?\s+vs\.?\s+(?:perm|whole\s+life))\b/i;
const EXTRA_LIFE_CONTEXT_PATTERN = /\b(more\s+than\s+just\s+(?:the\s+)?basic|beyond\s+(?:the\s+)?basic|extra\s+life|additional\s+life|want\s+life\s+insurance|also\s+want\s+(?:voluntary\s+)?term(?:\s+life)?|want\s+(?:voluntary\s+)?term(?:\s+life)?|base\s+benefit\s+isn'?t\s+enough|not\s+enough\s+by\s+itself)\b/i;
const FAMILY_PROTECTION_PATTERN = /\b(wife|husband|spouse|partner|kids?|children|family|dependents?)\b/i;

export function inferBCGEmployerGuidanceIntentFamily(
  topic: string,
  query: string,
): BCGEmployerGuidanceIntentFamily | null {
  if (topic !== 'Life Insurance') return null;

  const lower = query.toLowerCase();
  const mentionsWhole = WHOLE_LIFE_PATTERN.test(lower);
  const mentionsTerm = TERM_LIFE_PATTERN.test(lower);
  const mentionsSplit = SPLIT_PATTERN.test(lower);
  const asksRecommendation = /\b(what\s+do\s+you\s+recommend|would\s+you\s+recommend|how\s+should\s+i|help\s+me\s+decide|help\s+me\s+split|how\s+much\s+of\s+each)\b/i.test(lower);
  const asksLifeDecision = LIFE_DECISION_PATTERN.test(lower);
  const hasExtraLifeContext = EXTRA_LIFE_CONTEXT_PATTERN.test(lower) || FAMILY_PROTECTION_PATTERN.test(lower);

  if (
    (mentionsWhole && mentionsTerm)
    || (BOTH_LIFE_PATTERN.test(lower) && /\b(life|insurance|coverage|benefit)\b/i.test(lower) && (mentionsWhole || mentionsTerm || hasExtraLifeContext))
    || ((mentionsWhole || mentionsTerm) && mentionsSplit && /\b(life|insurance|coverage)\b/i.test(lower))
    || (mentionsWhole && mentionsTerm && asksRecommendation)
    || ((mentionsWhole || mentionsTerm) && asksLifeDecision && /\b(life|insurance|coverage|benefit)\b/i.test(lower))
    || ((mentionsWhole || mentionsTerm) && hasExtraLifeContext && asksLifeDecision)
    || (EXTRA_LIFE_CONTEXT_PATTERN.test(lower) && asksLifeDecision && /\b(life|insurance|coverage|benefit)\b/i.test(lower))
  ) {
    return 'life_split_term_vs_whole';
  }

  return null;
}

export function findBCGEmployerGuidanceRule(
  topic: string,
  query: string,
  rules: readonly BCGEmployerGuidanceRule[] = BCG_EMPLOYER_GUIDANCE_RULES,
): BCGEmployerGuidanceRule | null {
  const intentFamily = inferBCGEmployerGuidanceIntentFamily(topic, query);
  if (!intentFamily) return null;
  return rules.find((rule) => rule.topic === topic && rule.intentFamily === intentFamily) || null;
}
