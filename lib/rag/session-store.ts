
import { redisService } from '@/lib/azure/redis';
import { logger } from '@/lib/logger';
import { promises as fs } from 'fs';
import path from 'path';

export type SessionStep = 'start' | 'awaiting_state' | 'awaiting_dept' | 'active_chat' | 'awaiting_demographics';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

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
  
  // Extended fields for advanced session management
  userName?: string;
  hasCollectedName?: boolean;
  userAge?: number;
  userState?: string;
  dataConfirmed?: boolean;
  messages?: ChatMessage[]; // For conversation history and context-aware query expansion
};

// In-memory cache as a fast fallback; Redis provides true persistence across lambdas/region hops
type MemoryEntry = { session: Session; expiresAt: number };

const memoryStore = new Map<string, MemoryEntry>();
const MEMORY_TTL_MS = 15 * 60 * 1000; // 15 minutes in-memory to reduce Redis round-trips
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours persistent TTL
const REDIS_PREFIX = 'rag:session:';
const FS_PATH = path.join('/tmp', 'rag-session-cache.json');

function getNow() {
  return Date.now();
}

function seedSession(): Session {
  return { step: 'start', context: {} };
}

async function getFromRedis(sessionKey: string): Promise<Session | null> {
  try {
    const data = await redisService.get(`${REDIS_PREFIX}${sessionKey}`);
    if (!data) return null;
    const parsed = JSON.parse(data) as Session;
    memoryStore.set(sessionKey, { session: parsed, expiresAt: getNow() + MEMORY_TTL_MS });
    return parsed;
  } catch (error) {
    logger.warn('Redis session fetch failed; using memory fallback', { sessionKey }, error as Error);
    return null;
  }
}

async function readFsStore(): Promise<Record<string, MemoryEntry>> {
  try {
    const raw = await fs.readFile(FS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, MemoryEntry>;
    return parsed;
  } catch {
    return {};
  }
}

async function writeFsStore(store: Record<string, MemoryEntry>) {
  try {
    await fs.writeFile(FS_PATH, JSON.stringify(store), 'utf-8');
  } catch (error) {
    logger.warn('File session persist failed; continuing without fs cache', {}, error as Error);
  }
}

async function getFromFs(sessionKey: string): Promise<Session | null> {
  const store = await readFsStore();
  const entry = store[sessionKey];
  if (!entry) return null;
  if (entry.expiresAt < getNow()) {
    delete store[sessionKey];
    await writeFsStore(store);
    return null;
  }
  memoryStore.set(sessionKey, entry);
  return entry.session;
}

async function persist(sessionKey: string, session: Session) {
  memoryStore.set(sessionKey, { session, expiresAt: getNow() + MEMORY_TTL_MS });
  try {
    await redisService.set(`${REDIS_PREFIX}${sessionKey}`, JSON.stringify(session), SESSION_TTL_SECONDS);
  } catch (error) {
    logger.warn('Redis session persist failed; session kept in memory only', { sessionKey }, error as Error);
  }

  // File-system fallback for environments without Redis
  try {
    const store = await readFsStore();
    store[sessionKey] = { session, expiresAt: getNow() + MEMORY_TTL_MS };
    await writeFsStore(store);
  } catch (error) {
    logger.warn('FS session persist failed; session kept in memory only', { sessionKey }, error as Error);
  }
}

export async function getOrCreateSession(sessionKey: string): Promise<Session> {
  const cached = memoryStore.get(sessionKey);
  const now = getNow();

  if (cached && cached.expiresAt > now) {
    return cached.session;
  }

  const redisSession = await getFromRedis(sessionKey);
  if (redisSession) return redisSession;

  const fsSession = await getFromFs(sessionKey);
  if (fsSession) return fsSession;

  const session = seedSession();
  await persist(sessionKey, session);
  return session;
}

export async function updateSession(sessionKey: string, session: Session) {
  await persist(sessionKey, session);
}

export async function clearSession(sessionKey: string) {
  memoryStore.delete(sessionKey);
  try {
    await redisService.del(`${REDIS_PREFIX}${sessionKey}`);
  } catch (error) {
    logger.warn('Redis session delete failed', { sessionKey }, error as Error);
  }
}
