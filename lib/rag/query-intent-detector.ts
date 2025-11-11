/**
 * Query Intent Detector
 * Identifies high-stakes health scenarios and extracts key variables
 * for intelligent, context-aware recommendations
 */

export type IntentType = 'availability' | 'comparison' | 'high-stakes' | 'process' | 'general';

export interface QueryIntent {
  type: IntentType;
  confidence: number;
  keywords: string[];
  lifeEvent?: string;
  variables: {
    familySize?: number;
    conditions?: string[];
    expectedVisitFrequency?: string;
    budget?: string;
    timeline?: string;
  };
  needsFollowUp: boolean;
  followUpQuestions?: string[];
}

const HIGH_STAKES_KEYWORDS = {
  pregnancy: ['pregnant', 'pregnancy', 'maternity', 'baby', 'newborn', 'expecting', 'prenatal', 'postnatal', 'delivery', 'c-section', 'ob/gyn'],
  mental_health: ['mental health', 'therapy', 'therapist', 'psychiatrist', 'depression', 'anxiety', 'counseling', 'psychologist'],
  cancer: ['cancer', 'chemotherapy', 'chemo', 'oncology', 'tumor', 'radiation'],
  chronic: ['chronic', 'diabetes', 'hypertension', 'asthma', 'arthritis', 'heart disease', 'copd', 'autoimmune'],
  expensive_procedure: ['surgery', 'surgical', 'hospital', 'treatment', 'specialist', 'orthopedic', 'cardiac', 'neurological'],
  disability: ['disability', 'disabled', 'wheelchair', 'mobility', 'adaptive care'],
};

const COMPARISON_KEYWORDS = ['compare', 'vs', 'versus', 'which', 'better', 'difference', 'plan a', 'plan b'];
const AVAILABILITY_KEYWORDS = ['options', 'available', 'plans', 'choose from', 'what can i'];
const PROCESS_KEYWORDS = ['enroll', 'enrollment', 'deadline', 'sign up', 'register', 'open enrollment', 'effective date', 'when can'];

/**
 * Detect query intent and extract key information
 */
export function detectQueryIntent(query: string): QueryIntent {
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/);
  
  let type: IntentType = 'general';
  let confidence = 0;
  let keywords: string[] = [];
  let lifeEvent: string | undefined;
  let needsFollowUp = false;
  let followUpQuestions: string[] = [];

  const variables = {
    familySize: extractFamilySize(query),
    conditions: extractConditions(query, lowerQuery),
    expectedVisitFrequency: extractFrequency(query),
    budget: extractBudget(query),
    timeline: extractTimeline(query),
  };

  // Check for high-stakes keywords
  for (const [event, eventKeywords] of Object.entries(HIGH_STAKES_KEYWORDS)) {
    const matches = eventKeywords.filter(kw => lowerQuery.includes(kw));
    if (matches.length > 0) {
      type = 'high-stakes';
      confidence = Math.min(0.95, 0.5 + (matches.length * 0.15));
      keywords = matches;
      lifeEvent = event;
      needsFollowUp = !variables.conditions || variables.conditions.length === 0;
      
      // Suggest follow-up questions if critical info is missing
      if (!variables.expectedVisitFrequency) {
        followUpQuestions.push('How frequently do you expect to use this service? (e.g., monthly, weekly)');
      }
      if (!variables.budget) {
        followUpQuestions.push('Do you prefer to minimize monthly premiums or out-of-pocket costs?');
      }
      break;
    }
  }

  // Check for comparison intent
  if (type === 'general') {
    const comparisonMatches = COMPARISON_KEYWORDS.filter(kw => lowerQuery.includes(kw));
    if (comparisonMatches.length > 0) {
      type = 'comparison';
      confidence = 0.7 + (comparisonMatches.length * 0.1);
      keywords = comparisonMatches;
    }
  }

  // Check for availability intent
  if (type === 'general') {
    const availabilityMatches = AVAILABILITY_KEYWORDS.filter(kw => lowerQuery.includes(kw));
    if (availabilityMatches.length > 0) {
      type = 'availability';
      confidence = 0.8;
      keywords = availabilityMatches;
    }
  }

  // Check for process intent
  if (type === 'general') {
    const processMatches = PROCESS_KEYWORDS.filter(kw => lowerQuery.includes(kw));
    if (processMatches.length > 0) {
      type = 'process';
      confidence = 0.75;
      keywords = processMatches;
    }
  }

  return {
    type,
    confidence,
    keywords,
    lifeEvent,
    variables: {
      familySize: variables.familySize,
      conditions: variables.conditions && variables.conditions.length > 0 ? variables.conditions : undefined,
      expectedVisitFrequency: variables.expectedVisitFrequency,
      budget: variables.budget,
      timeline: variables.timeline,
    },
    needsFollowUp,
    followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : undefined,
  };
}

/**
 * Extract family size from query (e.g., "me, wife, and 2 kids" → 4)
 */
function extractFamilySize(query: string): number | undefined {
  const familyMatch = query.match(/(\d+)\s*(?:kids?|children|family members?)/i);
  if (familyMatch) {
    const num = parseInt(familyMatch[1]);
    // Add 1 for the person asking
    return num + 1;
  }

  // Check for specific family compositions
  if (/me and my (?:wife|husband|spouse|partner)/.test(query)) return 2;
  if (/family of (\d+)/.test(query)) return parseInt(query.match(/family of (\d+)/)?.[1] || '0');

  return undefined;
}

/**
 * Extract health conditions mentioned
 */
function extractConditions(query: string, lowerQuery: string): string[] {
  const conditions: string[] = [];
  
  const conditionPatterns: Record<string, string[]> = {
    pregnancy: ['pregnant', 'pregnancy', 'maternity', 'baby', 'expecting'],
    mental_health: ['mental health', 'therapy', 'depression', 'anxiety'],
    diabetes: ['diabetes', 'diabetic'],
    heart_disease: ['heart', 'cardiac', 'hypertension'],
    cancer: ['cancer', 'chemo', 'chemotherapy'],
    asthma: ['asthma'],
    arthritis: ['arthritis'],
  };

  for (const [condition, patterns] of Object.entries(conditionPatterns)) {
    if (patterns.some(p => lowerQuery.includes(p))) {
      conditions.push(condition);
    }
  }

  return conditions;
}

/**
 * Extract expected visit frequency
 */
function extractFrequency(query: string): string | undefined {
  const frequencyPatterns = [
    { regex: /(?:weekly|every week)/i, value: 'weekly' },
    { regex: /(?:bi-weekly|every 2 weeks)/i, value: 'bi-weekly' },
    { regex: /(?:monthly|every month)/i, value: 'monthly' },
    { regex: /(?:quarterly|every 3 months)/i, value: 'quarterly' },
    { regex: /(?:annually|every year|yearly)/i, value: 'annually' },
    { regex: /(?:(\d+)\s*times? per (?:week|month|year))/i, value: 'multiple' },
  ];

  for (const pattern of frequencyPatterns) {
    if (pattern.regex.test(query)) {
      return pattern.value;
    }
  }

  return undefined;
}

/**
 * Extract budget constraints
 */
function extractBudget(query: string): string | undefined {
  const budgetMatch = query.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (budgetMatch) {
    return `$${budgetMatch[1]}`;
  }

  if (/low cost|cheap|affordable|minimize|minimize costs?/i.test(query)) {
    return 'minimize-premium';
  }
  if (/don't care about|willing to pay|expensive|premium/i.test(query)) {
    return 'flexible';
  }

  return undefined;
}

/**
 * Extract timeline (when is this needed?)
 */
function extractTimeline(query: string): string | undefined {
  const timelinePatterns = [
    { regex: /(?:this month|this year|this spring)/i, value: 'immediate' },
    { regex: /(?:next month|next year|next quarter)/i, value: 'soon' },
    { regex: /(?:in (\d+)\s*(?:weeks?|months?|years?))/i, value: 'specific' },
  ];

  for (const pattern of timelinePatterns) {
    if (pattern.regex.test(query)) {
      return pattern.value;
    }
  }

  return undefined;
}
