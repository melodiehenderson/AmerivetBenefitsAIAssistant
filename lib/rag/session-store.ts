
export type SessionStep = 'start' | 'awaiting_state' | 'awaiting_dept' | 'active_chat';

export type Session = {
  step: SessionStep;
  context: {
    state?: string;
    dept?: string;
    lastTransitionPromptAt?: number;
    lastRecommendationPromptAt?: number;
  };
  // Conversational UX state
  turn?: number;
  lastBotMessage?: string;
  lastTransitionTurn?: number;
};

const sessionStore = new Map<string, Session>();

export function getOrCreateSession(sessionKey: string): Session {
  if (!sessionStore.has(sessionKey)) {
    sessionStore.set(sessionKey, { step: 'start', context: {} });
  }
  return sessionStore.get(sessionKey)!;
}

export function updateSession(sessionKey: string, session: Session) {
  sessionStore.set(sessionKey, session);
}
