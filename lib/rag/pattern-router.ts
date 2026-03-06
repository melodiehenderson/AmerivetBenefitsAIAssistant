/**
 * Pattern Router - Tiered LLM Selection
 * Bootstrap Step 4: Deterministic routing logic for L1/L2/L3 tier selection
 * 
 * Phase 2 Integration: Model migration with A/B testing
 * - L3: gpt-4 → gpt-4-turbo (60% cost reduction)
 * - L2: 20% traffic to gpt-3.5-turbo (88% cost reduction)
 */

import type { Tier, RoutingSignals, TierConfig } from "../../types/rag";
import type { QueryProfile } from "./query-understanding";
import type { Chunk } from "../../types/rag";
import { calculateCoverage } from "./hybrid-retrieval";
import { getModelForPhase2, shouldUseTreatmentModel } from "./model-migration";

// ============================================================================
// Tier Configuration
// ============================================================================

/**
 * Tier configurations with Phase 2 model migration defaults
 * - L1: gpt-4o-mini (no change)
 * - L2: gpt-4-turbo (20% A/B test to gpt-3.5-turbo)
 * - L3: gpt-4-turbo (migrated from gpt-4, -60% cost)
 */
export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  L1: {
    model: process.env.AZURE_OPENAI_DEPLOYMENT_L1 || "gpt-4o-mini",
    maxTokens: 1200,
    contextTokens: 800,
    temperature: 0.2,
    timeoutMs: 1500,
    cacheTTL: 6 * 3600, // 6 hours
  },
  L2: {
    // Phase 2: Control is gpt-4-turbo, treatment is gpt-3.5-turbo (20% A/B test)
    model: process.env.AZURE_OPENAI_DEPLOYMENT_L2 || "gpt-4-turbo",
    maxTokens: 2400,
    contextTokens: 1600,
    temperature: 0.2,
    timeoutMs: 3000,
    cacheTTL: 12 * 3600, // 12 hours
  },
  L3: {
    // Phase 2: Migrated from gpt-4 to gpt-4-turbo (-60% cost)
    model: process.env.AZURE_OPENAI_DEPLOYMENT_L3 || "gpt-4-turbo",
    maxTokens: 4000,
    contextTokens: 3000,
    temperature: 0.2,
    timeoutMs: 6000,
    cacheTTL: 24 * 3600, // 24 hours
  },
};

// ============================================================================
// Signal Calculation
// ============================================================================

/**
 * Calculate routing signals from query profile and retrieval results
 */
export function calculateRoutingSignals(
  query: string,
  queryProfile: QueryProfile,
  retrievedChunks: Chunk[]
): RoutingSignals {
  // Evidence score: max relevance score from chunks
  const evidenceScore = retrievedChunks.length > 0
    ? Math.max(...retrievedChunks.map((c) => c.metadata.relevanceScore || 0))
    : 0;

  // Coverage: what % of query terms appear in chunks
  const coverage = calculateCoverage(query, retrievedChunks);

  // Multi-doc synthesis needed?
  const uniqueDocs = new Set(retrievedChunks.map((c) => c.docId));
  const multiDocSynthesis = uniqueDocs.size > 2;

  return {
    queryLength: queryProfile.normalized.length,
    hasOperators: queryProfile.signals.hasOperators,
    needsTools: queryProfile.needsTool,
    coverage,
    evidenceScore,
    riskScore: queryProfile.riskScore,
    complexityScore: queryProfile.complexity,
    multiDocSynthesis,
  };
}

// ============================================================================
// Tier Selection Logic
// ============================================================================

/**
 * Select appropriate tier based on routing signals
 * Deterministic rule-based approach
 */
export function selectTier(signals: RoutingSignals): Tier {
  // L1: Simple, high-confidence FAQ
  if (isSimpleQuery(signals)) {
    return "L1";
  }

  // L3: Complex, low coverage, or tools required
  if (isComplexQuery(signals)) {
    return "L3";
  }

  // L2: Moderate (default)
  return "L2";
}

/**
 * Check if query is simple enough for L1 (fast tier)
 */
function isSimpleQuery(signals: RoutingSignals): boolean {
  return (
    // High coverage and evidence
    signals.coverage > 0.85 &&
    signals.evidenceScore > 0.9 &&
    // No complex requirements
    !signals.needsTools &&
    !signals.multiDocSynthesis &&
    // Short query
    signals.queryLength < 200 &&
    // Low complexity and risk
    signals.complexityScore < 0.3 &&
    signals.riskScore < 0.3
  );
}

/**
 * Check if query requires L3 (complex tier)
 */
function isComplexQuery(signals: RoutingSignals): boolean {
  return (
    // Requires tools or calculation
    signals.needsTools ||
    // Low coverage (hard to answer)
    signals.coverage < 0.5 ||
    // High risk (compliance/legal)
    signals.riskScore > 0.7 ||
    // High complexity
    signals.complexityScore > 0.8 ||
    // Multi-document synthesis with low evidence
    (signals.multiDocSynthesis && signals.evidenceScore < 0.6)
  );
}

// ============================================================================
// Tier Escalation
// ============================================================================

/**
 * Determine if tier should be escalated based on validation results
 */
export function shouldEscalateTier(
  currentTier: Tier,
  groundingScore: number,
  citationsValid: boolean
): boolean {
  // Already at highest tier
  if (currentTier === "L3") return false;

  // Grounding below threshold
  if (groundingScore < 0.7) return true;

  // Citations invalid
  if (!citationsValid) return true;

  return false;
}

/**
 * Get next tier up (for escalation)
 */
export function escalateTier(currentTier: Tier): Tier {
  if (currentTier === "L1") return "L2";
  if (currentTier === "L2") return "L3";
  return "L3"; // Already at max
}

// ============================================================================
// Tier Downgrade (for timeout/failure)
// ============================================================================

/**
 * Determine if tier should be downgraded due to timeout/failure
 */
export function shouldDowngradeTier(
  currentTier: Tier,
  error: Error | null,
  elapsedMs: number
): boolean {
  if (!error) return false;

  const config = TIER_CONFIGS[currentTier];
  
  // Timeout exceeded
  if (elapsedMs > config.timeoutMs) return true;

  // Specific error types that warrant downgrade
  if (
    error.message.includes("timeout") ||
    error.message.includes("rate limit") ||
    error.message.includes("quota")
  ) {
    return true;
  }

  return false;
}

/**
 * Get next tier down (for degradation)
 */
export function downgradeTier(currentTier: Tier): Tier {
  if (currentTier === "L3") return "L2";
  if (currentTier === "L2") return "L1";
  return "L1"; // Already at min
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get tier configuration
 */
export function getTierConfig(tier: Tier): TierConfig {
  return TIER_CONFIGS[tier];
}

/**
 * Get model name for tier
 * Phase 2 Integration: Applies model migration rules (L3 downgrade + L2 A/B test)
 * 
 * @param tier - L1, L2, or L3
 * @param userId - For deterministic A/B test assignment
 * @param conversationId - For deterministic A/B test assignment
 * @returns model name to use (respects Phase 2 migrations)
 */
export function getModelForTier(tier: Tier, userId?: string, conversationId?: string): string {
  // Use Phase 2 model migration logic
  if (userId && conversationId && tier === "L2") {
    // Deterministic A/B test assignment for L2
    const useTreatment = shouldUseTreatmentModel(userId, conversationId, 0.20);
    return getModelForPhase2(tier, undefined, useTreatment);
  }

  // For L1 and L3, or when no user context available
  return getModelForPhase2(tier);
}

/**
 * Get max tokens for tier
 */
export function getMaxTokensForTier(tier: Tier): number {
  return TIER_CONFIGS[tier].maxTokens;
}

/**
 * Get context token budget for tier
 */
export function getContextTokensForTier(tier: Tier): number {
  return TIER_CONFIGS[tier].contextTokens;
}

/**
 * Get timeout budget for tier
 */
export function getTimeoutForTier(tier: Tier): number {
  return TIER_CONFIGS[tier].timeoutMs;
}

/**
 * Get cache TTL for tier
 */
export function getCacheTTLForTier(tier: Tier): number {
  return TIER_CONFIGS[tier].cacheTTL;
}

// ============================================================================
// Logging and Debugging
// ============================================================================

/**
 * Format routing decision for logging
 */
export function formatRoutingDecision(
  signals: RoutingSignals,
  selectedTier: Tier,
  reason?: string
): string {
  return [
    `Tier: ${selectedTier}`,
    `Coverage: ${(signals.coverage * 100).toFixed(0)}%`,
    `Evidence: ${(signals.evidenceScore * 100).toFixed(0)}%`,
    `Complexity: ${(signals.complexityScore * 100).toFixed(0)}%`,
    `Risk: ${(signals.riskScore * 100).toFixed(0)}%`,
    `Tools: ${signals.needsTools ? "Yes" : "No"}`,
    `Multi-doc: ${signals.multiDocSynthesis ? "Yes" : "No"}`,
    reason ? `Reason: ${reason}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * Explain tier selection (for debugging/transparency)
 */
export function explainTierSelection(signals: RoutingSignals): {
  tier: Tier;
  reasons: string[];
} {
  const reasons: string[] = [];

  // Check L1 conditions
  if (signals.coverage > 0.85) {
    reasons.push("High coverage (>85%)");
  }
  if (signals.evidenceScore > 0.9) {
    reasons.push("High evidence score (>0.9)");
  }
  if (signals.queryLength < 200) {
    reasons.push("Short query (<200 chars)");
  }
  if (signals.complexityScore < 0.3) {
    reasons.push("Low complexity (<0.3)");
  }
  if (signals.riskScore < 0.3) {
    reasons.push("Low risk (<0.3)");
  }

  if (
    signals.coverage > 0.85 &&
    signals.evidenceScore > 0.9 &&
    !signals.needsTools &&
    !signals.multiDocSynthesis &&
    signals.queryLength < 200 &&
    signals.complexityScore < 0.3 &&
    signals.riskScore < 0.3
  ) {
    return { tier: "L1", reasons: ["All L1 conditions met", ...reasons] };
  }

  // Check L3 conditions
  const l3Reasons: string[] = [];
  if (signals.needsTools) {
    l3Reasons.push("Tools required");
  }
  if (signals.coverage < 0.5) {
    l3Reasons.push("Low coverage (<50%)");
  }
  if (signals.riskScore > 0.7) {
    l3Reasons.push("High risk (>0.7)");
  }
  if (signals.complexityScore > 0.8) {
    l3Reasons.push("High complexity (>0.8)");
  }
  if (signals.multiDocSynthesis && signals.evidenceScore < 0.6) {
    l3Reasons.push("Multi-doc synthesis with low evidence");
  }

  if (l3Reasons.length > 0) {
    return { tier: "L3", reasons: l3Reasons };
  }

  // Default L2
  return {
    tier: "L2",
    reasons: [
      "Default (moderate complexity)",
      ...reasons.filter((r) => !r.includes("High") && !r.includes("Low")),
    ],
  };
}

/**
 * Estimate cost for tier (in tokens)
 */
export function estimateCost(tier: Tier, retrievalCount: number): {
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedTotalTokens: number;
} {
  const config = TIER_CONFIGS[tier];
  
  // Rough estimation
  const avgChunkTokens = 200;
  const systemPromptTokens = 150;
  const promptTokens = systemPromptTokens + (retrievalCount * avgChunkTokens);
  const completionTokens = Math.floor(config.maxTokens * 0.6); // Assume 60% of max

  return {
    estimatedPromptTokens: promptTokens,
    estimatedCompletionTokens: completionTokens,
    estimatedTotalTokens: promptTokens + completionTokens,
  };
}
