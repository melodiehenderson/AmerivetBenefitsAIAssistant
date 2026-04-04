import type { Session } from '@/lib/rag/session-store';

const NOT_NAMES = new Set([
  'hello', 'hi', 'hlo', 'hey', 'medical', 'dental', 'vision', 'help', 'benefits',
  'insurance', 'quote', 'cost', 'ok', 'yes', 'no',
]);

export function extractName(query: string): string | null {
  const match = query.match(/(?:name is|i'm|i am|call me)\s+([a-zA-Z]{2,15})/i);
  if (match && !NOT_NAMES.has(match[1].toLowerCase())) return match[1];

  const words = query.trim().split(/\s+/);
  const firstWord = words[0]?.toLowerCase();
  if (
    words.length <= 2 &&
    firstWord &&
    !NOT_NAMES.has(firstWord) &&
    /^[a-zA-Z]{3,}$/.test(words[0]) &&
    /[aeiou]/i.test(words[0])
  ) {
    return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  }
  return null;
}

export function applyNameCapture(session: Session, query: string) {
  const detectedName = extractName(query);
  if (detectedName && (!session.userName || session.userName === 'Guest')) {
    session.userName = detectedName;
    session.hasCollectedName = true;
  }
  return { session, detectedName };
}

export function ensureNameForDemographics(session: Session) {
  if ((session.userAge || session.userState) && !session.hasCollectedName) {
    session.userName = session.userName || 'Guest';
    session.hasCollectedName = true;
  }
  return session;
}

export function applySelfHealGuest(session: Session) {
  session.userName = 'Guest';
  session.hasCollectedName = true;
  session.step = 'active_chat';
  return session;
}

export function shouldPromptForName(session: Session): boolean {
  return !session.hasCollectedName && !session.userAge && !session.userState;
}
