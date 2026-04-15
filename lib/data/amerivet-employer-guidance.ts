export type AmerivetEmployerGuidanceTopic = 'Life Insurance';

export type AmerivetEmployerGuidanceIntentFamily =
  | 'life_split_term_vs_whole';

export type AmerivetEmployerGuidancePlanKey =
  | 'voluntary_term_life'
  | 'whole_life';

export interface AmerivetEmployerGuidanceRule {
  id: string;
  topic: AmerivetEmployerGuidanceTopic;
  intentFamily: AmerivetEmployerGuidanceIntentFamily;
  title: string;
  recommendationLabel: string;
  allocation: {
    primaryPlan: AmerivetEmployerGuidancePlanKey;
    primaryPercent: number;
    secondaryPlan: AmerivetEmployerGuidancePlanKey;
    secondaryPercent: number;
  };
  rationale: readonly string[];
}

export const AMERIVET_EMPLOYER_GUIDANCE_RULES: readonly AmerivetEmployerGuidanceRule[] = [
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
const TERM_LIFE_PATTERN = /\b(voluntary term(?:\s+life)?|voluntary life|term life|vol life)\b/i;
const SPLIT_PATTERN = /\b(split|mix|ratio|allocate|allocation|divide|percent|80\s*\/\s*20|20\s*\/\s*80|part of each|blend)\b/i;
const LIFE_DECISION_PATTERN = /\b(what\s+do\s+you\s+recommend|would\s+you\s+recommend|how\s+much\s+would\s+you\s+recommend|what\s+amount\s+would\s+you\s+recommend|how\s+much\s+of\s+each\s+would\s+you\s+recommend|which\s+one\s+should\s+i\s+get|which\s+ones\s+should\s+i\s+get|which\s+of\s+those\s+should\s+i\s+get|which\s+should\s+i\s+get|help\s+me\s+decide|help\s+me\s+with\s+that|what\s+should\s+i\s+think\s+about|which\s+fits\s+better|which\s+life\s+(?:option|coverage)\s+fits|how\s+much\s+should\s+i\s+get|how\s+much\s+coverage\s+should\s+i\s+get|how\s+much\s+protection\s+is\s+worth\s+paying|how\s+do\s+i\s+know\s+how\s+much\s+of\s+each\s+to\s+get)\b/i;
const EXTRA_LIFE_CONTEXT_PATTERN = /\b(more\s+than\s+just\s+(?:the\s+)?basic|beyond\s+(?:the\s+)?basic|extra\s+life|additional\s+life|want\s+life\s+insurance|also\s+want\s+(?:voluntary\s+)?term(?:\s+life)?|want\s+(?:voluntary\s+)?term(?:\s+life)?|base\s+benefit\s+isn'?t\s+enough|not\s+enough\s+by\s+itself)\b/i;
const FAMILY_PROTECTION_PATTERN = /\b(wife|husband|spouse|partner|kids?|children|family|dependents?)\b/i;

export function inferAmerivetEmployerGuidanceIntentFamily(
  topic: string,
  query: string,
): AmerivetEmployerGuidanceIntentFamily | null {
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

export function findAmerivetEmployerGuidanceRule(
  topic: string,
  query: string,
  rules: readonly AmerivetEmployerGuidanceRule[] = AMERIVET_EMPLOYER_GUIDANCE_RULES,
): AmerivetEmployerGuidanceRule | null {
  const intentFamily = inferAmerivetEmployerGuidanceIntentFamily(topic, query);
  if (!intentFamily) return null;
  return rules.find((rule) => rule.topic === topic && rule.intentFamily === intentFamily) || null;
}
