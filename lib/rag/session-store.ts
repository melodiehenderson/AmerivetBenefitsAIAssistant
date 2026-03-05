
import { redisService } from '@/lib/azure/redis';
import { logger } from '@/lib/logger';
import { promises as fs } from 'fs';
import path from 'path';

export type SessionStep = 'start' | 'awaiting_state' | 'awaiting_dept' | 'active_chat' | 'awaiting_demographics';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type DecisionStatus = 'selected' | 'declined' | 'interested';

export interface DecisionEntry {
  status: DecisionStatus;
  value?: string;
  updatedAt: number;
  source: 'user' | 'assistant' | 'system';
}

export type DecisionValue = string | DecisionEntry;

export type Session = {
  step: SessionStep;
  context?: {
    state?: string;
    dept?: string;
    lastTransitionPromptAt?: number;
    lastRecommendationPromptAt?: number;
    stateUpdatedAt?: number;
  };
  // Conversational UX state
  turn?: number;
  lastBotMessage?: string;
  lastTransitionTurn?: number;
  
  // Extended fields for advanced session management
  userName?: string;
  hasCollectedName?: boolean;
  userAge?: number | null;
  userState?: string | null;
  userDept?: string;                  // User's department/division for group filtering
  dataConfirmed?: boolean;
  messages?: ChatMessage[]; // For conversation history and context-aware query expansion
  
  // FIX: Conversation flow control flags
  disclaimerShown?: boolean;          // "I'm not your enrollment platform" shown once
  optionsPresented?: boolean;         // Have we shown plan options yet (don't ask "decided?" before this)
  decisionsTracker?: Record<string, DecisionValue>; // Track user's benefit decisions/preferences for summary
  askedForDemographics?: boolean;     // AMNESIA GUARDRAIL: Only ask for age/state once
  
  // NEW: Family & Coverage Information (Smart Memory)
  coverageTier?: string;              // 'employee-only', 'employee-spouse', 'employee-children', 'employee-family'
  coverageTierLock?: string;          // Locked tier from family detection (e.g., 'Employee + Family')
  noPricingMode?: boolean;            // When true, suppress all $ and cost tables in responses
  payPeriods?: number;                // Paycheck frequency (24=biweekly, 26=weekly, 12=monthly)
  familyDetails?: {                   // Detailed family info for personalized recommendations
    hasSpouse?: boolean;
    numChildren?: number;
    childrenAges?: number[];
    spouseWorksFullTime?: boolean;
  };
  medicalNeeds?: string[];            // Anticipated procedures: ['surgery', 'delivery', 'kidney stone', etc.]
  pricingShownForCategory?: string[]; // Categories where pricing has been shown (avoid repeating)
  
  // NEW: Conversation Engine State (Senior Engineer Architecture)
  currentTopic?: string;              // 'Medical', 'Dental', etc. - for topic focus
  completedTopics?: string[];         // Topics user has resolved
  selectedPlan?: string;              // Currently selected plan name
  topicStates?: Record<string, {
    topic: string;
    questionsAsked: number;
    plansDiscussed: string[];
    userSelectedPlan: string | null;
    resolved: boolean;
  }>;
  lastAskedQuestion?: string;         // Loop detection
  loopCount?: number;                 // How many times we've asked same thing

  // NEW: Lightweight memory for lifecycle/event reasoning
  lifeEvents?: string[];              // e.g., ['marriage', 'job-change', 'pregnancy']
  lastDetectedLocationChange?: {
    from: string;
    to: string;
    updatedAt: number;
  };
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
