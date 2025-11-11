/**
 * Observability & Monitoring
 * 
 * Purpose:
 * - Track per-tier performance metrics (latency, cost, errors)
 * - Monitor cache hit rates (L0 exact, L1 semantic)
 * - Record retrieval coverage and grounding scores
 * - Integrate with Application Insights for production telemetry
 * 
 * Metrics Tracked:
 * - Request volume by tier (L1/L2/L3)
 * - Latency breakdown (cache, retrieval, generation, validation)
 * - Cost per request (token usage × pricing)
 * - Cache hit rate (exact vs semantic)
 * - Grounding score distribution
 * - Escalation rate (L1→L2→L3)
 * - Error rate by component
 * 
 * Integration:
 * - Application Insights: Custom events and metrics
 * - Structured logging: JSON format for log aggregation
 * - Performance counters: In-memory tracking with periodic flush
 */

import type { Tier, QAMetrics } from '../../types/rag';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const METRICS_FLUSH_INTERVAL = 60000; // Flush metrics every 60 seconds
const ENABLE_CONSOLE_LOGGING = true;
 // Enable when Azure Application Insights configured
const ENABLE_APP_INSIGHTS = process.env.ENABLE_APP_INSIGHTS === 'true' || process.env.NEXT_PUBLIC_ENVIRONMENT === 'production'
// Token pricing (per 1M tokens) - Update with current Azure OpenAI pricing
const TOKEN_PRICING = {
  L1: {
    prompt: 0.15,      // gpt-4o-mini: $0.15/1M input tokens
    completion: 0.60,  // gpt-4o-mini: $0.60/1M output tokens
  },
  L2: {
    prompt: 10.00,     // gpt-4-turbo: $10/1M input tokens
    completion: 30.00, // gpt-4-turbo: $30/1M output tokens
  },
  L3: {
    prompt: 30.00,     // gpt-4: $30/1M input tokens
    completion: 60.00, // gpt-4: $60/1M output tokens
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Collection
// ─────────────────────────────────────────────────────────────────────────────

interface MetricsSnapshot {
  timestamp: Date;
  requests: {
    total: number;
    byTier: Record<Tier, number>;
    cached: number;
    escalated: number;
  };
  latency: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    byComponent: {
      cache: number[];
      retrieval: number[];
      generation: number[];
      validation: number[];
    };
  };
  cost: {
    total: number;
    byTier: Record<Tier, number>;
    avgPerRequest: number;
  };
  cache: {
    hitRate: number;
    exactHits: number;
    semanticHits: number;
    misses: number;
  };
  grounding: {
    avg: number;
    belowThreshold: number;
  };
  errors: {
    total: number;
    byType: Record<string, number>;
  };
}

class MetricsCollector {
  private requests: QAMetrics[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;
  private exactHits = 0;
  private semanticHits = 0;
  private errors: Array<{ type: string; timestamp: Date; message: string }> = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (METRICS_FLUSH_INTERVAL > 0) {
      this.startPeriodicFlush();
    }
  }

  /**
   * Record QA request metrics
   */
  recordRequest(metrics: QAMetrics): void {
    this.requests.push(metrics);

    // Track cache hits
    if (metrics.fromCache) {
      this.cacheHits++;
      if (metrics.cacheType === 'exact') {
        this.exactHits++;
      } else if (metrics.cacheType === 'semantic') {
        this.semanticHits++;
      }
    } else {
      this.cacheMisses++;
    }

    // Log to console if enabled
    if (ENABLE_CONSOLE_LOGGING) {
      this.logRequest(metrics);
    }

    // Send to Application Insights if enabled
    if (ENABLE_APP_INSIGHTS) {
      this.sendToAppInsights(metrics);
    }
  }

  /**
   * Record error
   */
  recordError(type: string, message: string): void {
    this.errors.push({ type, timestamp: new Date(), message });

    if (ENABLE_CONSOLE_LOGGING) {
      console.error(`[Observability] Error (${type}): ${message}`);
    }
  }

  /**
   * Calculate cost for request
   */
  private calculateCost(metrics: QAMetrics): number {
    const pricing = TOKEN_PRICING[metrics.tier];
    const promptCost = (metrics.usage.promptTokens / 1_000_000) * pricing.prompt;
    const completionCost = (metrics.usage.completionTokens / 1_000_000) * pricing.completion;
    return promptCost + completionCost;
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    const totalRequests = this.requests.length;
    const requestsByTier = this.requests.reduce(
      (acc, r) => {
        acc[r.tier] = (acc[r.tier] || 0) + 1;
        return acc;
      },
      {} as Record<Tier, number>
    );

    // Calculate latencies
    const allLatencies = this.requests.map(r => r.latency.total).sort((a, b) => a - b);
    const cacheLatencies = this.requests.map(r => r.latency.retrieval).filter(l => l > 0);
    const retrievalLatencies = this.requests.map(r => r.latency.retrieval).filter(l => l > 0);
    const generationLatencies = this.requests.map(r => r.latency.generation).filter(l => l > 0);
    const validationLatencies = this.requests.map(r => r.latency.validation).filter(l => l > 0);

    const p50Idx = Math.floor(allLatencies.length * 0.5);
    const p95Idx = Math.floor(allLatencies.length * 0.95);
    const p99Idx = Math.floor(allLatencies.length * 0.99);

    // Calculate costs
    const costs = this.requests.map(r => this.calculateCost(r));
    const totalCost = costs.reduce((sum, c) => sum + c, 0);
    const costsByTier = this.requests.reduce(
      (acc, r) => {
        const cost = this.calculateCost(r);
        acc[r.tier] = (acc[r.tier] || 0) + cost;
        return acc;
      },
      {} as Record<Tier, number>
    );

    // Grounding metrics
    const groundingScores = this.requests.map(r => r.grounding.score);
    const avgGrounding = groundingScores.reduce((sum, s) => sum + s, 0) / groundingScores.length || 0;
    const belowThreshold = groundingScores.filter(s => !this.requests.find(r => r.grounding.score === s)?.grounding.passed).length;

    // Error counts by type
    const errorsByType = this.errors.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      timestamp: new Date(),
      requests: {
        total: totalRequests,
        byTier: requestsByTier,
        cached: this.cacheHits,
        escalated: this.requests.filter(r => r.tier === 'L2' || r.tier === 'L3').length,
      },
      latency: {
        avg: allLatencies.reduce((sum, l) => sum + l, 0) / allLatencies.length || 0,
        p50: allLatencies[p50Idx] || 0,
        p95: allLatencies[p95Idx] || 0,
        p99: allLatencies[p99Idx] || 0,
        byComponent: {
          cache: cacheLatencies,
          retrieval: retrievalLatencies,
          generation: generationLatencies,
          validation: validationLatencies,
        },
      },
      cost: {
        total: totalCost,
        byTier: costsByTier,
        avgPerRequest: totalCost / totalRequests || 0,
      },
      cache: {
        hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0,
        exactHits: this.exactHits,
        semanticHits: this.semanticHits,
        misses: this.cacheMisses,
      },
      grounding: {
        avg: avgGrounding,
        belowThreshold,
      },
      errors: {
        total: this.errors.length,
        byType: errorsByType,
      },
    };
  }

  /**
   * Log request to console
   */
  private logRequest(metrics: QAMetrics): void {
    const cost = this.calculateCost(metrics);

    console.log(`[Observability] Request: ${metrics.requestId}`, {
      tier: metrics.tier,
      fromCache: metrics.fromCache,
      latency: `${metrics.latency.total}ms`,
      cost: `$${cost.toFixed(6)}`,
      grounding: `${(metrics.grounding.score * 100).toFixed(1)}%`,
      retrieval: `${metrics.retrieval.count} chunks (${(metrics.retrieval.coverage * 100).toFixed(1)}%)`,
    });
  }

  /**
   * Send metrics to Application Insights
   */
  private sendToAppInsights(metrics: QAMetrics): void {
    // TODO: Integrate Azure Application Insights SDK
    // Example:
    // appInsights.defaultClient.trackEvent({
    //   name: 'QARequest',
    //   properties: {
    //     tier: metrics.tier,
    //     fromCache: metrics.fromCache,
    //     companyId: metrics.companyId,
    //   },
    //   measurements: {
    //     latency: metrics.latency.total,
    //     cost: this.calculateCost(metrics),
    //     groundingScore: metrics.grounding.score,
    //   },
    // });
  }

  /**
   * Start periodic metrics flush
   */
  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flushMetrics();
    }, METRICS_FLUSH_INTERVAL);
  }

  /**
   * Flush metrics and reset counters
   */
  flushMetrics(): void {
    const snapshot = this.getSnapshot();

    if (ENABLE_CONSOLE_LOGGING) {
      console.log('[Observability] Metrics Snapshot:', {
        timestamp: snapshot.timestamp.toISOString(),
        requests: snapshot.requests,
        latency: {
          avg: `${snapshot.latency.avg.toFixed(0)}ms`,
          p95: `${snapshot.latency.p95.toFixed(0)}ms`,
        },
        cost: {
          total: `$${snapshot.cost.total.toFixed(4)}`,
          avgPerRequest: `$${snapshot.cost.avgPerRequest.toFixed(6)}`,
        },
        cache: {
          hitRate: `${(snapshot.cache.hitRate * 100).toFixed(1)}%`,
        },
        grounding: {
          avg: `${(snapshot.grounding.avg * 100).toFixed(1)}%`,
        },
      });
    }

    // Reset counters (keep last hour for trending)
    const oneHourAgo = Date.now() - 3600000;
    this.requests = this.requests.filter(r => new Date(r.requestId).getTime() > oneHourAgo);
    this.errors = this.errors.filter(e => e.timestamp.getTime() > oneHourAgo);
  }

  /**
   * Stop periodic flush
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

let metricsCollector: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new MetricsCollector();
  }
  return metricsCollector;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

export function recordRequest(metrics: QAMetrics): void {
  getMetricsCollector().recordRequest(metrics);
}

export function recordError(type: string, message: string): void {
  getMetricsCollector().recordError(type, message);
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return getMetricsCollector().getSnapshot();
}

export function flushMetrics(): void {
  getMetricsCollector().flushMetrics();
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export type { MetricsSnapshot };
export { MetricsCollector, TOKEN_PRICING };
