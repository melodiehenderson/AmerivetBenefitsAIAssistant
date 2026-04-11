import type { Session } from '@/lib/rag/session-store';

const NOT_NAMES = new Set([
  'hello', 'hi', 'hlo', 'hey', 'medical', 'dental', 'vision', 'help', 'benefits',
  'insurance', 'quote', 'cost', 'ok', 'yes', 'no', 'thanks', 'thank', 'pricing',
]);

function normalizeNameToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 2 || /^[A-Z]+$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function normalizeNamePhrase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map(normalizeNameToken)
    .join(' ');
}

function isReservedNameToken(token: string): boolean {
  return NOT_NAMES.has(token.toLowerCase());
}

export function extractName(query: string): string | null {
  const explicitMatch = query.match(
    /(?:actually[, ]+)?(?:my name is|i'm called|i am called|i'm|i am|call me)\s+([a-zA-Z][a-zA-Z' -]{0,30})/i,
  );
  if (explicitMatch) {
    const candidate = explicitMatch[1].trim();
    const parts = candidate.split(/\s+/);
    if (parts.every((part) => /^[a-zA-Z][a-zA-Z'-]*$/.test(part) && !isReservedNameToken(part))) {
      return normalizeNamePhrase(candidate);
    }
  }

  const words = query.trim().split(/\s+/).filter(Boolean);
  const normalizedWords = words.map((word) => word.replace(/[^a-zA-Z'-]/g, ''));

  if (
    normalizedWords.length >= 1 &&
    normalizedWords.length <= 2 &&
    normalizedWords.every((word) => word && /^[a-zA-Z][a-zA-Z'-]*$/.test(word) && !isReservedNameToken(word))
  ) {
    return normalizeNamePhrase(normalizedWords.join(' '));
  }

  return null;
}

export function applyNameCapture(session: Session, query: string) {
  const detectedName = extractName(query);
  const explicitRename = /(?:actually[, ]+)?(?:my name is|i'm called|i am called|i'm|i am|call me)\s+/i.test(query);
  if (detectedName && (explicitRename || !session.userName || session.userName === 'Guest')) {
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

export function applyChildCoverageTierLock(session: Session, query: string): { session: Session; locked: boolean } {
  const lower = query.toLowerCase();
  const explicitEmployeeOnly = /\b(employee\s*only|individual|single|just\s*me|only\s*me)\b/i.test(lower);
  const explicitFamily = /\b(employee\s*\+?\s*family|family\s*(?:of|plan|coverage)|family\s*\d|for\s*(?:my|the|our)\s*family)\b/i.test(lower);
  const explicitSpouse = /\b(spouse|husband|wife|partner)\b/i.test(lower);
  const hasChild = /\b(child|children|kid|kids|son|daughter|dependent)\b/i.test(lower);

  if (session.coverageTierLock === 'Employee + Family' || session.coverageTierLock === 'Employee + Spouse') {
    return { session, locked: false };
  }

  if (hasChild && !explicitFamily && !explicitSpouse && !explicitEmployeeOnly) {
    session.coverageTierLock = 'Employee + Child(ren)';
    return { session, locked: true };
  }

  return { session, locked: false };
}

export function shouldPromptForName(session: Session): boolean {
  return !session.hasCollectedName && !session.userAge && !session.userState;
}
