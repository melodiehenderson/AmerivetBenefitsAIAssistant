/**
 * CacheFirstRouter
 *
 * Decision engine that runs BEFORE any LLM or RAG call.
 * Implements a 3-tier resolution chain:
 *
 *   L0 → Exact cache hit  (hash match → return immediately, 0 LLM tokens)
 *   L1 → Semantic cache hit (cosine similarity ≥ threshold → cheap reframe, ~60 tokens)
 *   MISS → Caller escalates to RAG / Smart / Simple
 *
 * Cache scope: company + state  (so TX employees never get CA answer)
 * Written back after every new RAG/LLM answer.
 */

import { logger } from '@/lib/logger';
import { redisService } from '@/lib/azure/redis';
import { hybridLLMRouter } from '@/lib/services/hybrid-llm-router';
import {
  buildCacheKey,
  buildSemanticCacheKey,
  normalizeQueryWithSynonyms,
  queryToVector,
  findMostSimilar,
  getTTLWithJitter,
} from '@/lib/rag/cache-utils';

// ─── types ───────────────────────────────────────────────────────────────────

export type CacheRouteSource =
  | 'cache-exact'    // L0 exact hash hit — zero LLM cost
  | 'cache-semantic' // L1 similarity hit — cheap reframe only
  | 'rag-doc'        // RAG: retrieved Azure Search chunks
  | 'rag-fallback'   // RAG attempted but returned the safe no-grounding fallback
  | 'smart'          // SmartChatRouter (pattern-matching, no RAG)
  | 'simple';        // SimpleChatRouter (no RAG, no pattern)

export interface CacheHitResult {
  hit: true;
  content: string;
  source: 'cache-exact' | 'cache-semantic';
  similarity?: number;   // present on L1 hits
  cachedAt?: number;     // unix ms
}

export interface CacheMissResult {
  hit: false;
}

export type CacheResult = CacheHitResult | CacheMissResult;

// L1 entry stored in the recent-queries Redis list.
interface L1Entry {
  queryNormalized: string;
  queryVector: number[];
  answer: string;
  state?: string;
  cachedAt: number;
  groundingScore: number;
  metadata?: Record<string, unknown>;
}

const L1_MAX_ENTRIES = 120;   // entries kept per company+state bucket
const L1_TTL_S      = 43200;  // 12 h
const L0_TTL_S      = 86400;  // 24 h (exact answers live longer)

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Scope key includes state so TX employees never see CA answers */
function scopedCompanyId(companyId: string, state?: string): string {
  return state ? `${companyId}:${state.toUpperCase()}` : companyId;
}

// ─── read path ────────────────────────────────────────────────────────────────

/**
 * Try to satisfy the query from cache.
 * Returns a CacheHitResult (with answer) or CacheMissResult.
 */
export async function tryCache(
  query: string,
  companyId: string,
  state?: string,
): Promise<CacheResult> {
  const scoped = scopedCompanyId(companyId, state);

  // ── L0: exact hash ──────────────────────────────────────────────────────────
  try {
    const l0Key = buildCacheKey(scoped, query);
    const l0Raw = await redisService.get(l0Key);
    if (l0Raw) {
      const parsed = JSON.parse(l0Raw) as { answer: string; cachedAt: number };
      logger.info('[CacheRouter] L0 exact hit', { l0Key });
      return {
        hit: true,
        content: parsed.answer,
        source: 'cache-exact',
        cachedAt: parsed.cachedAt,
      };
    }
  } catch (err) {
    logger.warn('[CacheRouter] L0 lookup failed', { err });
  }

  // ── L1: semantic similarity ─────────────────────────────────────────────────
  try {
    const l1Key = buildSemanticCacheKey(scoped);
    const l1Raw = await redisService.get(l1Key);
    if (l1Raw) {
      const entries: L1Entry[] = JSON.parse(l1Raw);
      const queryVec = queryToVector(normalizeQueryWithSynonyms(query));
      const match = findMostSimilar(
        queryVec,
        entries.map(e => ({
          ...e,
          queryVector: e.queryVector,
          query: e.queryNormalized,
          timestamp: e.cachedAt,
          similarity: 0,
        })) as unknown as Parameters<typeof findMostSimilar>[1],
      );

      if (match) {
        const entry = match as unknown as L1Entry & { similarity: number };
        logger.info('[CacheRouter] L1 semantic hit', {
          similarity: entry.similarity,
          cachedQuery: entry.queryNormalized,
        });

        // Cheap reframe: rephrase to match the current question's wording.
        // Uses only ~60 completion tokens; facts are never regenerated.
        const reframed = await reframeAnswer(query, entry.answer);
        return {
          hit: true,
          content: reframed,
          source: 'cache-semantic',
          similarity: entry.similarity,
          cachedAt: entry.cachedAt,
        };
      }
    }
  } catch (err) {
    logger.warn('[CacheRouter] L1 lookup failed', { err });
  }

  return { hit: false };
}

// ─── write path ───────────────────────────────────────────────────────────────

/**
 * Write a freshly-generated answer to both L0 and L1.
 * Call this after every RAG / LLM answer so future identical or similar
 * questions are served from cache.
 */
export async function writeCache(
  query: string,
  answer: string,
  companyId: string,
  state?: string,
  groundingScore: number = 0.75,
): Promise<void> {
  const scoped = scopedCompanyId(companyId, state);

  // ── L0 write (exact) ────────────────────────────────────────────────────────
  try {
    const l0Key = buildCacheKey(scoped, query);
    const l0Entry = JSON.stringify({ answer, cachedAt: Date.now() });
    await redisService.set(l0Key, l0Entry, getTTLWithJitter(L0_TTL_S));
    logger.debug('[CacheRouter] L0 write', { l0Key });
  } catch (err) {
    logger.warn('[CacheRouter] L0 write failed', { err });
  }

  // ── L1 write (semantic list) ────────────────────────────────────────────────
  try {
    const l1Key = buildSemanticCacheKey(scoped);
    const l1Raw = await redisService.get(l1Key);
    const entries: L1Entry[] = l1Raw ? JSON.parse(l1Raw) : [];

    // Remove duplicate exact query if already in list
    const normalizedQ = normalizeQueryWithSynonyms(query);
    const deduped = entries.filter(e => e.queryNormalized !== normalizedQ);

    const newEntry: L1Entry = {
      queryNormalized: normalizedQ,
      queryVector: queryToVector(normalizedQ),
      answer,
      state,
      cachedAt: Date.now(),
      groundingScore,
    };

    // Prepend newest, trim oldest beyond max
    const updated = [newEntry, ...deduped].slice(0, L1_MAX_ENTRIES);
    await redisService.set(l1Key, JSON.stringify(updated), getTTLWithJitter(L1_TTL_S));
    logger.debug('[CacheRouter] L1 write', { l1Key, total: updated.length });
  } catch (err) {
    logger.warn('[CacheRouter] L1 write failed', { err });
  }
}

// ─── reframe helper ───────────────────────────────────────────────────────────

/**
 * Uses a single cheap LLM call (~60 tokens) to rephrase a cached answer
 * so it reads naturally for the current phrasing of the question.
 * NEVER changes facts — only adjusts tone, opening sentence, and phrasing.
 */
async function reframeAnswer(
  currentQuestion: string,
  cachedAnswer: string,
): Promise<string> {
  try {
    const response = await hybridLLMRouter.createChatCompletion({
      model: 'gpt-4.1-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a reframing assistant. You will be given a cached answer and a new question. ' +
            'Rewrite the answer so it flows naturally from the new question. ' +
            'RULES: (1) Keep every fact, number, plan name, and carrier identical. ' +
            '(2) Only adjust the opening sentence and overall phrasing. ' +
            '(3) Do NOT add new information. (4) Output ONLY the reframed answer, nothing else.',
        },
        {
          role: 'user',
          content:
            `New question: ${currentQuestion}\n\n` +
            `Cached answer to reframe:\n${cachedAnswer}`,
        },
      ],
    });
    return response.content || cachedAnswer;
  } catch {
    // If reframe fails, return the cached answer verbatim — still better than LLM call.
    return cachedAnswer;
  }
}
