/**
 * Conversation Engine - Stateful Topic-Locked Flow
 * 
 * Senior Engineer Architecture to fix:
 * 1. Memory loss (age/state re-asked)
 * 2. Topic jumping (moving on too fast)
 * 3. Loop detection (same question repeated)
 * 4. Choice tracking (user confirms a plan)
 * 5. Internal prompt leakage (stripping "Reminder:")
 */

import type { Session } from './session-store';

// ============================================================================
// 1. CONVERSATION STATE MACHINE
// ============================================================================

export type ConversationPhase = 
  | 'WELCOME'           // Initial greeting, get name
  | 'DEMOGRAPHICS'      // Collecting age + state
  | 'TOPIC_SELECTION'   // User picks a benefit category
  | 'TOPIC_EXPLORATION' // Diving deep into one topic
  | 'CONFIRMATION'      // "Is this the plan you want?"
  | 'TRANSITION'        // Moving to next topic
  | 'ENROLLMENT';       // Ready to enroll

export interface TopicState {
  topic: string;           // 'Medical', 'Dental', etc.
  questionsAsked: number;
  plansDiscussed: string[];
  userSelectedPlan: string | null;
  resolved: boolean;
}

export interface ConversationState {
  phase: ConversationPhase;
  currentTopic: TopicState | null;
  completedTopics: string[];
  loopCounter: Map<string, number>; // Track repeated questions
  lastThreeMessages: string[];      // For loop detection
}

// ============================================================================
// 2. LOOP DETECTION
// ============================================================================

const LOOP_THRESHOLD = 2;

export function detectLoop(session: Session, currentMessage: string): boolean {
  const messages = session.messages || [];
  const lastBotMessages = messages
    .filter(m => m.role === 'assistant')
    .slice(-3)
    .map(m => m.content.toLowerCase().substring(0, 100));
  
  // Check if current message pattern matches recent bot messages
  const patterns = [
    'what is your age',
    'what state',
    'please tell me your',
    'could you share your age',
    'need your age',
    'need your state'
  ];
  
  const matchCount = lastBotMessages.filter(msg => 
    patterns.some(p => msg.includes(p))
  ).length;
  
  return matchCount >= LOOP_THRESHOLD;
}

// ============================================================================
// 3. INTERNAL PROMPT STRIPPING
// ============================================================================

const INTERNAL_PATTERNS = [
  /^Reminder:.*$/gm,
  /^\[Internal\].*$/gm,
  /^Note to self:.*$/gm,
  /^INSTRUCTION:.*$/gm,
  /^Chain-of-thought:.*$/gm,
  /\*\*Reminder\*\*:.*$/gm,
  /Based on my instructions.*$/gm,
  /According to my guidelines.*$/gm,
  /I need to remember to.*$/gm,
  /Let me think through this.*$/gm,
  /show costs as.*monthly.*annually/gi
];

export function stripInternalPrompts(text: string): string {
  let result = text;
  
  for (const pattern of INTERNAL_PATTERNS) {
    result = result.replace(pattern, '');
  }
  
  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  
  return result;
}

// ============================================================================
// 4. TOPIC RESOLUTION CHECK
// ============================================================================

export function isTopicResolved(session: Session, topic: string): boolean {
  // Check if user has explicitly selected a plan for this topic
  const topicState = getTopicState(session, topic);
  if (!topicState) return false;
  
  return topicState.userSelectedPlan !== null || topicState.resolved;
}

export function getTopicState(session: Session, topic: string): TopicState | null {
  const topicStates = (session as any).topicStates as Record<string, TopicState> | undefined;
  return topicStates?.[topic] || null;
}

export function setTopicState(session: Session, topic: string, state: Partial<TopicState>) {
  if (!(session as any).topicStates) {
    (session as any).topicStates = {};
  }
  const existing = (session as any).topicStates[topic] || {
    topic,
    questionsAsked: 0,
    plansDiscussed: [],
    userSelectedPlan: null,
    resolved: false
  };
  (session as any).topicStates[topic] = { ...existing, ...state };
}

// ============================================================================
// 5. USER CHOICE EXTRACTION
// ============================================================================

const AFFIRMATIVE_PATTERNS = [
  /\b(yes|yeah|yep|sure|okay|ok|correct|right|that one|sounds good|perfect|let's do it|i'll take|i want|select|choose)\b/i
];

const PLAN_SELECTION_PATTERNS = [
  /\b(ppo|hmo|hdhp|gold|silver|bronze|basic|enhanced|high|low|option\s*[abc123])\b/i,
  /\bi(?:'ll)?\s*(?:go with|take|choose|select|want)\s*(?:the\s*)?(\w+)/i
];

export function extractUserChoice(query: string, lastBotMessage: string): string | null {
  const lower = query.toLowerCase();
  
  // Check if user is affirming a specific plan
  const isAffirmative = AFFIRMATIVE_PATTERNS.some(p => p.test(lower));
  
  // Try to find a plan name in the user's message
  for (const pattern of PLAN_SELECTION_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  
  // If user says "yes" and bot previously offered a specific plan, infer it
  if (isAffirmative && lastBotMessage) {
    const planMatch = lastBotMessage.match(/(\w+\s*(?:PPO|HMO|HDHP|Plan|Option))/i);
    if (planMatch) {
      return planMatch[1];
    }
  }
  
  return null;
}

// ============================================================================
// 6. TRANSITION GUARD (Don't Jump Topics)
// ============================================================================

export function shouldOfferTransition(session: Session): boolean {
  const currentTopic = (session as any).currentTopic as string | undefined;
  if (!currentTopic) return false;
  
  const topicState = getTopicState(session, currentTopic);
  if (!topicState) return false;
  
  // Only offer transition if:
  // 1. User has selected a plan OR
  // 2. At least 3 questions asked AND user hasn't asked more questions about this topic
  const hasSelectedPlan = topicState.userSelectedPlan !== null;
  const minQuestionsAsked = topicState.questionsAsked >= 3;
  const resolved = topicState.resolved;
  
  return hasSelectedPlan || resolved || minQuestionsAsked;
}

export function getTransitionMessage(session: Session): string {
  const completedTopics = (session as any).completedTopics as string[] || [];
  const allTopics = ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'HSA/FSA', 'Accident'];
  const remainingTopics = allTopics.filter(t => !completedTopics.includes(t));
  
  if (remainingTopics.length === 0) {
    return "We've covered all the main benefits! Would you like to review any of your selections or head to the enrollment portal?";
  }
  
  return `Would you like to explore ${remainingTopics.slice(0, 3).join(', ')}, or any other benefits?`;
}

// ============================================================================
// 7. DEMOGRAPHIC MEMORY CHECK
// ============================================================================

export function hasDemographics(session: Session): boolean {
  const hasAge = typeof session.userAge === 'number' && !isNaN(session.userAge);
  const hasState = typeof session.userState === 'string' && session.userState.length === 2;
  return hasAge && hasState;
}

export function getMissingDemographics(session: Session): string | null {
  const hasAge = typeof session.userAge === 'number' && !isNaN(session.userAge);
  const hasState = typeof session.userState === 'string' && session.userState.length === 2;
  
  if (!hasAge && !hasState) return 'age and state';
  if (!hasAge) return 'age';
  if (!hasState) return 'state';
  return null;
}

// ============================================================================
// 8. ONBOARDING FLOW (One Question at a Time)
// ============================================================================

export function getOnboardingMessage(session: Session, isFirstMessage: boolean): string {
  // Phase 1: Welcome
  if (!session.hasCollectedName || !session.userName) {
    return `Hi there! Welcome to your AmeriVet Benefits Assistant! 🎉

I'm here to help you understand and compare your benefit options.

First, what's your name?`;
  }
  
  // Phase 2: Age
  if (!session.userAge) {
    return `Nice to meet you, ${session.userName}! 😊

To show you accurate costs, what's your age?`;
  }
  
  // Phase 3: State
  if (!session.userState) {
    return `Thanks! And which state do you live in? (e.g., CA, TX, NY)`;
  }
  
  // Phase 4: Topic Selection
  return `Perfect! I have your info:
- Age: ${session.userAge}
- State: ${session.userState}

What would you like to explore first?
• Medical Plans
• Dental & Vision
• Life Insurance
• Disability
• HSA/FSA Accounts

Just type the benefit you're interested in, or ask me any question!`;
}

// ============================================================================
// 9. AGE-BANDED PRODUCT HANDLING
// ============================================================================

const AGE_BANDED_PRODUCTS = new Set([
  'life insurance', 'voluntary life', 'basic life',
  'disability', 'std', 'ltd', 'short term disability', 'long term disability',
  'critical illness', 'ci',
  'ad&d', 'accidental death'
]);

export function isAgeBandedProduct(topic: string): boolean {
  const lower = topic.toLowerCase();
  return Array.from(AGE_BANDED_PRODUCTS).some(p => lower.includes(p));
}

export function getAgeBandedDisclaimer(topic: string, age: number | undefined): string {
  if (!age) {
    return `${topic} pricing varies by age. Please share your age so I can give you an estimate, or check the enrollment portal for exact rates.`;
  }
  
  return `For ${topic}, pricing is based on age bands. As a ${age}-year-old, you'll see your exact rate in the enrollment portal. The documents show general rate tables, but your specific cost depends on coverage amount selected.`;
}
