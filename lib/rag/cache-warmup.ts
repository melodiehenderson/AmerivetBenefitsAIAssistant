/**
 * Cache Warmup Strategy
 * Phase 2: Pre-loads common questions and answers at startup
 * 
 * Purpose:
 * - Reduce cold start latency for new sessions
 * - Improve cache hit rate by 5-10%
 * - Pre-seed Redis with high-frequency questions
 * 
 * Target: Pre-load top 50 queries per company at deployment
 */

import { isBuild } from "@/lib/runtime/is-build";
import type { QAResponse } from "@/types/rag";

export interface WarmupQuery {
  text: string;
  count: number;
  lastAsked: Date;
}

export interface WarmupStats {
  companyId: string;
  queriesPreloaded: number;
  queriesSkipped: number;
  durationMs: number;
  timestamp: Date;
}

/**
 * Cache warmup configuration
 */
export const WARMUP_CONFIG = {
  enabled: process.env.NODE_ENV === "production",
  frequency: "startup" as const,
  topQueriesCount: 50,
  ttlSeconds: 24 * 3600, // 24 hours
};

/**
 * Main warmup function - call at application startup
 * Pre-loads top queries from Cosmos DB into Redis
 */
export async function warmupCache(
  redis: any,
  cosmosClient: any,
  companyId: string,
  config: typeof WARMUP_CONFIG = WARMUP_CONFIG
): Promise<WarmupStats> {
  const startTime = Date.now();
  const stats: WarmupStats = {
    companyId,
    queriesPreloaded: 0,
    queriesSkipped: 0,
    durationMs: 0,
    timestamp: new Date(),
  };

  if (isBuild() || !config.enabled) {
    console.log("[Cache Warmup] Skipped (build or disabled)");
    return stats;
  }

  try {
    console.log(
      `[Cache Warmup] Starting for company: ${companyId}, target: ${config.topQueriesCount} queries`
    );

    // Fetch top queries from Cosmos DB
    const topQueries = await getTopQueriesByCompany(
      cosmosClient,
      companyId,
      config.topQueriesCount
    );

    if (topQueries.length === 0) {
      console.log(
        `[Cache Warmup] No historical queries found for ${companyId}`
      );
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

    // Pre-cache each query (retrieve or generate answer)
    for (const query of topQueries) {
      try {
        await warmupSingleQuery(redis, companyId, query, config.ttlSeconds);
        stats.queriesPreloaded++;
      } catch (error) {
        console.warn(`[Cache Warmup] Failed to warm query: ${query.text}`, error);
        stats.queriesSkipped++;
      }
    }

    stats.durationMs = Date.now() - startTime;

    console.log(
      `[Cache Warmup] Completed: ${stats.queriesPreloaded} loaded, ` +
        `${stats.queriesSkipped} skipped, ${stats.durationMs}ms`
    );

    // Log warmup event
    logWarmupEvent(stats);

    return stats;
  } catch (error) {
    console.error("[Cache Warmup] Fatal error:", error);
    stats.durationMs = Date.now() - startTime;
    return stats;
  }
}

/**
 * Fetch top queries from Cosmos DB
 * Queries last 30 days of conversation history, groups by query text,
 * returns top N by frequency
 */
async function getTopQueriesByCompany(
  cosmosClient: any,
  companyId: string,
  limit: number = 50
): Promise<WarmupQuery[]> {
  try {
    // Query: GROUP BY query, COUNT, ORDER BY count DESC, LIMIT
    const container = cosmosClient.database("BenefitsChat").container("Conversations");

    const query = `
      SELECT TOP @limit
        c.query as text,
        COUNT(1) as count,
        MAX(c._ts) as lastAsked
      FROM c
      WHERE c.companyId = @companyId
        AND c.query != null
        AND c.query != ""
        AND c.timestamp > DateTimeAdd("day", -30, GetCurrentTimestamp())
      GROUP BY c.query
      ORDER BY count DESC
    `;

    const { resources } = await container.items
      .query(query, {
        parameters: [
          { name: "@companyId", value: companyId },
          { name: "@limit", value: limit },
        ],
      })
      .fetchAll();

    return (resources as any[]).map((r) => ({
      text: r.text,
      count: r.count,
      lastAsked: new Date(r.lastAsked * 1000), // Convert Unix timestamp
    }));
  } catch (error) {
    console.error("[Cache Warmup] Query failed:", error);
    return [];
  }
}

/**
 * Warm up a single query
 * Check if already cached; if not, retrieve from Cosmos or generate
 */
async function warmupSingleQuery(
  redis: any,
  companyId: string,
  query: WarmupQuery,
  ttlSeconds: number
): Promise<void> {
  try {
    // Build cache key
    const { buildCacheKey, normalizeQueryWithSynonyms, hashQuery } = await import(
      "./cache-utils"
    );

    const cacheKey = buildCacheKey(companyId, query.text);

    // Check if already cached
    const existing = await redis.get(cacheKey);
    if (existing) {
      // Already cached, skip
      return;
    }

    // Try to retrieve cached answer from Cosmos DB
    const cachedAnswer = await getCachedAnswer(companyId, query.text);

    if (cachedAnswer) {
      // Store in Redis
      await redis.setex(cacheKey, ttlSeconds, JSON.stringify(cachedAnswer));
      console.log(`[Cache Warmup] ✓ Pre-loaded: "${query.text}"`);
    } else {
      console.log(`[Cache Warmup] ⊘ No answer found: "${query.text}"`);
    }
  } catch (error) {
    console.error(
      `[Cache Warmup] Error warming query "${query.text}":`,
      error
    );
    throw error;
  }
}

/**
 * Retrieve cached answer from Cosmos DB Conversations
 * Looks for most recent cached response for this query
 */
async function getCachedAnswer(
  companyId: string,
  queryText: string
): Promise<QAResponse | null> {
  try {
    // Import at function level to avoid build-time dependency issues
    const { cosmosClient } = await import("@/lib/azure/cosmos-db");

    if (!cosmosClient) {
      return null;
    }

    const container = cosmosClient
      .database("BenefitsChat")
      .container("Conversations");

    // Query for most recent answer to this query
    const { resources } = await container.items
      .query(
        `
        SELECT TOP 1 c.response
        FROM c
        WHERE c.companyId = @companyId
          AND c.query = @query
          AND c.response != null
          AND c.response.answer != null
        ORDER BY c._ts DESC
      `,
        {
          parameters: [
            { name: "@companyId", value: companyId },
            { name: "@query", value: queryText },
          ],
        }
      )
      .fetchAll();

    if (resources.length > 0) {
      return (resources[0] as any).response as QAResponse;
    }

    return null;
  } catch (error) {
    console.error("[Cache Warmup] getCachedAnswer failed:", error);
    return null;
  }
}

/**
 * Log warmup event for monitoring
 */
function logWarmupEvent(stats: WarmupStats): void {
  try {
    // Could integrate with Application Insights here
    console.log("[Cache Warmup] Event:", {
      event: "cache_warmup_complete",
      companyId: stats.companyId,
      queriesPreloaded: stats.queriesPreloaded,
      queriesSkipped: stats.queriesSkipped,
      durationMs: stats.durationMs,
      timestamp: stats.timestamp.toISOString(),
    });
  } catch (error) {
    // Silently fail - don't block warmup
    console.debug("[Cache Warmup] Event logging failed:", error);
  }
}

/**
 * Initialize warmup on module load (for startup)
 * Call this in app/api/qa/route.ts or similar
 */
export async function initializeWarmupOnStartup(): Promise<void> {
  if (isBuild()) {
    return; // Skip during build
  }

  try {
    // Import clients with runtime checks
    const { redisService } = await import("@/lib/azure/redis");
    const { cosmosClient } = await import("@/lib/azure/cosmos-db");

    if (!redisService || !cosmosClient) {
      console.log("[Cache Warmup] Clients not available, skipping");
      return;
    }

    // Note: Would need actual companyId(s) from request context
    // This is a placeholder - call this within request handler for specific company
    console.log("[Cache Warmup] Ready to initialize on first request");
  } catch (error) {
    console.error("[Cache Warmup] Initialization error:", error);
  }
}

/**
 * Warmup statistics helper
 */
export function formatWarmupStats(stats: WarmupStats): string {
  const hitRate = (
    (stats.queriesPreloaded /
      (stats.queriesPreloaded + stats.queriesSkipped || 1)) *
    100
  ).toFixed(1);

  return (
    `[Warmup] ${stats.queriesPreloaded} queries pre-loaded ` +
    `(${hitRate}% success) in ${stats.durationMs}ms`
  );
}

export default warmupCache;
