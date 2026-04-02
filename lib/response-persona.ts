export type ResponsePersona = 'EXPLORER' | 'ANALYZER' | 'URGENT' | 'GUIDE';

export interface PersonaConfig {
  structure: 'narrative' | 'scannable' | 'step-by-step' | 'minimal';
  tone: 'warm' | 'clinical' | 'urgent' | 'casual';
  useTables: 'always' | 'on-request' | 'never';
  maxSentencesPerBlock: number;
}

export interface PersonaDetectionResult {
  persona: ResponsePersona;
  confidence: number;
  reason: string;
  switched: boolean;
  previousPersona?: ResponsePersona;
}

const URGENT_TRIGGERS = [
  'urgent',
  'asap',
  'emergency',
  'help now',
  'stressed',
  'freaking out',
  'lost my coverage',
  'need this today',
  'need help',
  'confused',
];

const ANALYZER_TRIGGERS = [
  'compare',
  'difference',
  'cost',
  'price',
  'premium',
  'numbers',
  'exactly',
  'better',
  'worth',
  'save',
  'which one',
  'how much',
];

const EXPLORER_TRIGGERS = [
  'tell me about',
  'explain',
  'how does',
  'what is',
  'what are',
  'curious',
  'interested',
  'learn',
  'overview',
  'walk me through',
];

export const PERSONA_SETTINGS: Record<ResponsePersona, PersonaConfig> = {
  EXPLORER: {
    structure: 'narrative',
    tone: 'warm',
    useTables: 'on-request',
    maxSentencesPerBlock: 4,
  },
  ANALYZER: {
    structure: 'scannable',
    tone: 'clinical',
    useTables: 'always',
    maxSentencesPerBlock: 2,
  },
  URGENT: {
    structure: 'step-by-step',
    tone: 'urgent',
    useTables: 'never',
    maxSentencesPerBlock: 1,
  },
  GUIDE: {
    structure: 'narrative',
    tone: 'casual',
    useTables: 'on-request',
    maxSentencesPerBlock: 3,
  },
};

export function detectPersona(
  userQuery: string,
  conversationHistory: string[] = [],
  previousPersona?: ResponsePersona,
): PersonaDetectionResult {
  const query = userQuery.toLowerCase();
  const history = conversationHistory.join(' ').toLowerCase();
  const combined = `${query} ${history}`;

  const scores: Record<ResponsePersona, number> = {
    EXPLORER: scoreFor(combined, EXPLORER_TRIGGERS, 1),
    ANALYZER: scoreFor(combined, ANALYZER_TRIGGERS, 1),
    URGENT: scoreFor(combined, URGENT_TRIGGERS, 1),
    GUIDE: 0.25,
  };

  if (previousPersona) {
    scores[previousPersona] += 0.25;
  }

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]) as Array<[ResponsePersona, number]>;
  const [bestPersona, bestScore] = ranked[0];
  const [, runnerUpScore] = ranked[1];
  const previousScore = previousPersona ? scores[previousPersona] : 0;

  const shouldKeepPrevious = Boolean(
    previousPersona &&
    bestPersona !== previousPersona &&
    bestScore < 1 &&
    bestScore - previousScore < 0.5,
  );
  const persona = shouldKeepPrevious ? previousPersona! : bestPersona;
  const switched = Boolean(previousPersona && previousPersona !== persona);
  const confidence = Math.min(0.99, Math.max(0.5, bestScore / Math.max(bestScore + runnerUpScore, 1)));

  return {
    persona,
    confidence: parseFloat(confidence.toFixed(2)),
    reason: buildReason(persona, query, history),
    switched,
    previousPersona,
  };
}

export function buildPersonaDirective(persona: ResponsePersona): string {
  const settings = PERSONA_SETTINGS[persona];

  return `
CURRENT MODE: ${persona}
- Structure: ${settings.structure}
- Tone: ${settings.tone}
- Tables: ${settings.useTables}
- Max sentences per block: ${settings.maxSentencesPerBlock}

ADAPTIVE RESPONSE RULES:
- Match the user's energy and intent.
- Avoid repeating the user's question verbatim.
- Use tables for comparisons when they clarify tradeoffs; use narrative when the user is asking for explanation or guidance.
- If the user sounds stressed or time-sensitive, lead with the next action first.
- Keep the answer direct, but let the shape of the answer vary with the query.
`;
}

function scoreFor(text: string, triggers: string[], base: number): number {
  return triggers.reduce((score, trigger) => score + (text.includes(trigger) ? base : 0), 0);
}

function buildReason(persona: ResponsePersona, query: string, history: string): string {
  if (persona === 'URGENT') {
    return /urgent|asap|emergency|help now|stressed|freaking out/i.test(`${query} ${history}`)
      ? 'Detected urgency or distress language.'
      : 'Defaulted to urgent because the prior context was already high priority.';
  }

  if (persona === 'ANALYZER') {
    return /compare|difference|cost|price|premium|numbers|exactly|better|worth|save|which one|how much/i.test(`${query} ${history}`)
      ? 'Detected comparison or cost-analysis language.'
      : 'Defaulted to analyzer due to prior analytical context.';
  }

  if (persona === 'EXPLORER') {
    return /tell me about|explain|how does|what is|what are|curious|interested|learn|overview|walk me through/i.test(`${query} ${history}`)
      ? 'Detected exploratory or learning-oriented language.'
      : 'Defaulted to explorer because the question is open-ended.';
  }

  return 'Defaulted to guide for navigation and next-step questions.';
}