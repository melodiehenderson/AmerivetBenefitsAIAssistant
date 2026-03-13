/**
 * Pipeline Logger — Per-request observability for the QA pipeline
 *
 * Logs every AI pipeline execution to Cosmos DB for debugging,
 * auditing, and performance analysis. Non-blocking — never delays
 * the user response.
 *
 * Container: pipeline_logs (partitionKey: /sessionId, TTL: 30 days)
 */

import { logger } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Trace interface
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineTrace {
  id: string;               // uuid — also Cosmos document id
  traceId: string;          // same as id (alias for readability)
  sessionId: string;
  timestamp: string;        // ISO-8601
  userQuery: string;
  userName: string;
  userState: string;
  userAge: number | null;
  coverageTier: string;

  intent: {
    detected: string;       // factual_lookup | advisory | yes_no | comparison | exploratory | cost_lookup | followup
    confidence: number;
  };

  retrieval: {
    chunksReturned: number;
    topScore: number;
    latencyMs: number;
    method: string;         // hybrid | vector | bm25
    category: string | null;
  };

  gate: {
    passed: boolean;
    topScore: number;
    chunkCount: number;
    failReason?: string;
  };

  llm: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    temperature: number;
  } | null;  // null when L1 intercept (no LLM call)

  response: {
    type: string;           // template | generated | intercept
    interceptName?: string; // which intercept fired (e.g. 'category-exploration', 'yes-no-short')
    citationsStripped: number;
    hallucinationsDetected: number;
    groundingWarnings: number;
    length: number;
  };

  totalLatencyMs: number;
  success: boolean;
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutable trace builder — populate fields as pipeline runs
// ─────────────────────────────────────────────────────────────────────────────

export function createTrace(traceId: string, sessionId: string, query: string, session: {
  userName?: string | null;
  userState?: string | null;
  userAge?: number | null;
}): PipelineTrace {
  return {
    id: traceId,
    traceId,
    sessionId,
    timestamp: new Date().toISOString(),
    userQuery: query,
    userName: session.userName || 'Guest',
    userState: session.userState || 'Unknown',
    userAge: session.userAge ?? null,
    coverageTier: 'Employee Only',

    intent: { detected: 'unknown', confidence: 0 },

    retrieval: {
      chunksReturned: 0,
      topScore: 0,
      latencyMs: 0,
      method: 'hybrid',
      category: null,
    },

    gate: { passed: true, topScore: 0, chunkCount: 0 },

    llm: null,

    response: {
      type: 'unknown',
      citationsStripped: 0,
      hallucinationsDetected: 0,
      groundingWarnings: 0,
      length: 0,
    },

    totalLatencyMs: 0,
    success: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger class — writes to Cosmos DB (non-blocking)
// ─────────────────────────────────────────────────────────────────────────────

const CONTAINER_NAME = 'pipeline_logs';
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

class PipelineLoggerImpl {
  private containerRef: unknown = null;
  private initFailed = false;

  private async getContainer() {
    if (this.initFailed) return null;
    if (this.containerRef) return this.containerRef as import('@azure/cosmos').Container;

    try {
      // Dynamic import to avoid build-time Cosmos initialization
      const { getDatabase } = await import('@/lib/db/cosmos/client');
      const db = getDatabase();
      // Ensure container exists (idempotent)
      const { container } = await db.containers.createIfNotExists({
        id: CONTAINER_NAME,
        partitionKey: { paths: ['/sessionId'] },
        defaultTtl: TTL_SECONDS,
      });
      this.containerRef = container;
      return container;
    } catch (err) {
      // If Cosmos is unavailable (local dev, missing env), log and disable silently
      logger.warn(`[PipelineLogger] Cosmos container init failed — logging disabled: ${err instanceof Error ? err.message : err}`);
      this.initFailed = true;
      return null;
    }
  }

  /**
   * Log a trace. Fire-and-forget — never blocks the response.
   */
  async log(trace: PipelineTrace): Promise<void> {
    try {
      const container = await this.getContainer();
      if (!container) {
        // Fallback: structured console log
        logger.info(`[PipelineTrace] ${JSON.stringify({
          traceId: trace.traceId,
          intent: trace.intent.detected,
          gate: trace.gate.passed ? 'PASS' : 'FAIL',
          responseType: trace.response.type,
          totalMs: trace.totalLatencyMs,
          success: trace.success,
        })}`);
        return;
      }

      await container.items.create({
        ...trace,
        ttl: TTL_SECONDS,
      });
    } catch (err) {
      // Never throw — pipeline logger must not break the request
      logger.warn(`[PipelineLogger] Write failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Get recent traces (for admin dashboard).
   */
  async getRecentTraces(limit = 50): Promise<PipelineTrace[]> {
    try {
      const container = await this.getContainer();
      if (!container) return [];

      const { resources } = await container.items
        .query({
          query: 'SELECT * FROM c ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit',
          parameters: [{ name: '@limit', value: limit }],
        })
        .fetchAll();

      return resources as PipelineTrace[];
    } catch (err) {
      logger.warn(`[PipelineLogger] Read failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  /**
   * Get failed traces for debugging.
   */
  async getFailedTraces(hours = 24): Promise<PipelineTrace[]> {
    try {
      const container = await this.getContainer();
      if (!container) return [];

      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const { resources } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.success = false AND c.timestamp >= @since ORDER BY c.timestamp DESC',
          parameters: [{ name: '@since', value: since }],
        })
        .fetchAll();

      return resources as PipelineTrace[];
    } catch (err) {
      logger.warn(`[PipelineLogger] Read failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}

// Singleton
export const pipelineLogger = new PipelineLoggerImpl();
