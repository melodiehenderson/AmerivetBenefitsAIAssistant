/**
 * Phase 2: Model Migration Strategy
 * Selective model downgrading for cost optimization
 * 
 * Implements:
 * 1. L3 Migration: gpt-4 → gpt-4-turbo (60% cost reduction)
 * 2. L2 A/B Test: gpt-4-turbo → gpt-3.5-turbo (88% cost reduction, 20% traffic)
 * 
 * Tracks: Model usage, cost impact, quality metrics during A/B test
 */

import type { Tier } from "../../types/rag";

// ============================================================================
// Model Migration Configuration
// ============================================================================

export interface ModelConfig {
  model: string;
  costPerMTokenIn: number;     // Cost per 1M input tokens
  costPerMTokenOut: number;    // Cost per 1M output tokens
  qualityScore: number;        // 0-1 relative quality vs gpt-4
  expectedGroundingScore: number; // Expected grounding score (0-1)
}

/**
 * Current Azure OpenAI model pricing (as of Nov 2024)
 * Based on Microsoft Learn documentation
 */
export const MODEL_PRICING: Record<string, ModelConfig> = {
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    costPerMTokenIn: 0.15,
    costPerMTokenOut: 0.60,
    qualityScore: 0.75,
    expectedGroundingScore: 0.90,
  },
  'gpt-4-turbo': {
    model: 'gpt-4-turbo',
    costPerMTokenIn: 10.00,
    costPerMTokenOut: 30.00,
    qualityScore: 0.95,
    expectedGroundingScore: 0.87,
  },
  'gpt-4': {
    model: 'gpt-4',
    costPerMTokenIn: 30.00,
    costPerMTokenOut: 60.00,
    qualityScore: 1.0,
    expectedGroundingScore: 0.92,
  },
  'gpt-3.5-turbo': {
    model: 'gpt-3.5-turbo',
    costPerMTokenIn: 0.50,
    costPerMTokenOut: 1.50,
    qualityScore: 0.70,
    expectedGroundingScore: 0.75,
  },
};

// ============================================================================
// Phase 2 Migration Strategies
// ============================================================================

/**
 * Migration Strategy Configuration
 * Defines cost optimization targets and A/B test parameters
 */
export interface MigrationStrategy {
  // L3 Migration (immediate, low risk)
  l3Migration: {
    enabled: boolean;
    oldModel: string;      // gpt-4
    newModel: string;      // gpt-4-turbo
    expectedSavings: number; // % cost reduction
  };
  
  // L2 A/B Test (gradual, monitored)
  l2ABTest: {
    enabled: boolean;
    control: string;       // gpt-4-turbo (100% until test)
    treatment: string;     // gpt-3.5-turbo (20% of L2 traffic)
    treatmentRatio: number; // 0.2 = 20% of traffic to cheaper model
    expectedGroundingDropThreshold: number; // Abort if <75%
  };
}

/**
 * Default migration strategy
 * Phase 2 targets: L3 downgrade + L2 A/B test
 */
export const DEFAULT_MIGRATION_STRATEGY: MigrationStrategy = {
  l3Migration: {
    enabled: true,
    oldModel: 'gpt-4',
    newModel: 'gpt-4-turbo',
    expectedSavings: 0.60, // 60% cheaper
  },
  l2ABTest: {
    enabled: true,
    control: 'gpt-4-turbo',
    treatment: 'gpt-3.5-turbo',
    treatmentRatio: 0.20, // 20% to cheaper model
    expectedGroundingDropThreshold: 0.75, // Minimum 75% grounding
  },
};

// ============================================================================
// Model Selection Logic
// ============================================================================

/**
 * Determine the model to use for a given tier
 * Applies Phase 2 migration rules (L3 downgrade + L2 A/B test)
 */
export function getModelForPhase2(
  tier: Tier,
  strategy: MigrationStrategy = DEFAULT_MIGRATION_STRATEGY,
  useABTestTreatment?: boolean
): string {
  // L1: No change (gpt-4o-mini - already cheap)
  if (tier === 'L1') {
    return process.env.AZURE_OPENAI_DEPLOYMENT_L1 || 'gpt-4o-mini';
  }

  // L2: Apply A/B test if enabled
  if (tier === 'L2') {
    if (strategy.l2ABTest.enabled) {
      // Determine if this request gets treatment (cheaper model)
      const getTreatment = useABTestTreatment !== undefined
        ? useABTestTreatment
        : Math.random() < strategy.l2ABTest.treatmentRatio;

      if (getTreatment) {
        return process.env.AZURE_OPENAI_DEPLOYMENT_L2_TREATMENT || strategy.l2ABTest.treatment;
      }
    }
    // Control: standard gpt-4-turbo
    return process.env.AZURE_OPENAI_DEPLOYMENT_L2 || strategy.l2ABTest.control;
  }

  // L3: Apply migration (downgrade from gpt-4 to gpt-4-turbo)
  if (tier === 'L3') {
    if (strategy.l3Migration.enabled) {
      return process.env.AZURE_OPENAI_DEPLOYMENT_L3 || strategy.l3Migration.newModel;
    }
    // Fallback: original gpt-4
    return process.env.AZURE_OPENAI_DEPLOYMENT_L3 || 'gpt-4';
  }

  return 'gpt-4o-mini'; // Fallback
}

/**
 * Determine if a request should receive A/B test treatment
 * Uses deterministic hashing for consistency within a session
 */
export function shouldUseTreatmentModel(
  userId: string,
  conversationId: string,
  treatmentRatio: number = 0.20
): boolean {
  // Create deterministic hash based on user + conversation
  // This ensures same user gets consistent treatment throughout conversation
  const seed = `${userId}:${conversationId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Normalize to 0-1 and compare against ratio
  const normalized = Math.abs(hash) % 1000 / 1000;
  return normalized < treatmentRatio;
}

// ============================================================================
// Cost Analysis & Metrics
// ============================================================================

export interface ModelMigrationMetrics {
  tier: Tier;
  controlModel: string;
  treatmentModel?: string;
  usedModel: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  savingsVsOriginal: number;
  groundingScore: number;
  isABTestRequest?: boolean;
}

/**
 * Calculate estimated cost for a given model and token usage
 */
export function estimateModelCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const modelConfig = MODEL_PRICING[model];
  if (!modelConfig) {
    console.warn(`[Model Cost] Unknown model: ${model}`);
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * modelConfig.costPerMTokenIn;
  const outputCost = (outputTokens / 1_000_000) * modelConfig.costPerMTokenOut;
  return inputCost + outputCost;
}

/**
 * Calculate cost savings from model migration
 */
export function calculateSavings(
  originalModel: string,
  newModel: string,
  inputTokens: number,
  outputTokens: number
): {
  originalCost: number;
  newCost: number;
  savings: number;
  savingsPercent: number;
} {
  const originalCost = estimateModelCost(originalModel, inputTokens, outputTokens);
  const newCost = estimateModelCost(newModel, inputTokens, outputTokens);
  const savings = originalCost - newCost;
  const savingsPercent = originalCost > 0 ? (savings / originalCost) * 100 : 0;

  return {
    originalCost,
    newCost,
    savings,
    savingsPercent,
  };
}

/**
 * Estimate monthly savings from Phase 2 migration
 */
export function estimatePhase2Savings(
  monthlyQueries: number = 60_000,
  avgInputTokens: number = 800,
  avgOutputTokens: number = 400,
  strategy: MigrationStrategy = DEFAULT_MIGRATION_STRATEGY
): {
  l3SavingsMonthly: number;
  l2SavingsMonthly: number;
  totalSavingsMonthly: number;
  annualSavings: number;
  breakdown: {
    l3: { queries: number; savings: number };
    l2Control: { queries: number; savings: number };
    l2Treatment: { queries: number; savings: number };
  };
} {
  // Estimate queries per tier (from load test: L1=25%, L2=60%, L3=15%)
  const l3Queries = Math.floor(monthlyQueries * 0.15);
  const l2Queries = Math.floor(monthlyQueries * 0.60);
  
  // L3 Savings: gpt-4 → gpt-4-turbo
  const l3OriginalCost = estimateModelCost('gpt-4', avgInputTokens, avgOutputTokens);
  const l3NewCost = estimateModelCost('gpt-4-turbo', avgInputTokens, avgOutputTokens);
  const l3SavingsPerQuery = l3OriginalCost - l3NewCost;
  const l3SavingsMonthly = l3SavingsPerQuery * l3Queries;

  // L2 Savings: 20% traffic → gpt-3.5-turbo
  const l2ControlCost = estimateModelCost('gpt-4-turbo', avgInputTokens, avgOutputTokens);
  const l2TreatmentCost = estimateModelCost('gpt-3.5-turbo', avgInputTokens, avgOutputTokens);
  const l2TreatmentQueries = Math.floor(l2Queries * strategy.l2ABTest.treatmentRatio);
  const l2ControlQueries = l2Queries - l2TreatmentQueries;
  
  const l2SavingsPerQuery = l2ControlCost - l2TreatmentCost;
  const l2SavingsMonthly = l2SavingsPerQuery * l2TreatmentQueries;

  const totalSavingsMonthly = l3SavingsMonthly + l2SavingsMonthly;
  const annualSavings = totalSavingsMonthly * 12;

  return {
    l3SavingsMonthly,
    l2SavingsMonthly,
    totalSavingsMonthly,
    annualSavings,
    breakdown: {
      l3: { queries: l3Queries, savings: l3SavingsMonthly },
      l2Control: { queries: l2ControlQueries, savings: 0 },
      l2Treatment: { queries: l2TreatmentQueries, savings: l2SavingsMonthly },
    },
  };
}

// ============================================================================
// Quality Monitoring (A/B Test)
// ============================================================================

export interface ABTestMetrics {
  testId: string;
  controlModel: string;
  treatmentModel: string;
  treatmentRatio: number;
  
  // Control group metrics
  controlQueries: number;
  controlAvgGroundingScore: number;
  controlAvgLatency: number;
  controlErrorRate: number;
  
  // Treatment group metrics
  treatmentQueries: number;
  treatmentAvgGroundingScore: number;
  treatmentAvgLatency: number;
  treatmentErrorRate: number;
  
  // Statistical significance
  groundingScoreDrop: number;
  groundingScoreDropPercent: number;
  latencyImprovement: number;
  
  // Decision
  passedThreshold: boolean;
  recommendedAction: 'CONTINUE' | 'ABORT' | 'EXPAND';
}

/**
 * Evaluate A/B test results against quality thresholds
 */
export function evaluateABTest(
  metrics: ABTestMetrics,
  groundingThreshold: number = 0.75,
  maxAllowedDrop: number = 0.10 // 10% drop allowed
): ABTestMetrics {
  // Calculate metrics
  const groundingScoreDrop = metrics.controlAvgGroundingScore - metrics.treatmentAvgGroundingScore;
  const groundingScoreDropPercent = (groundingScoreDrop / metrics.controlAvgGroundingScore) * 100;
  const latencyImprovement = metrics.controlAvgLatency - metrics.treatmentAvgLatency;

  // Decision logic
  let recommendedAction: 'CONTINUE' | 'ABORT' | 'EXPAND' = 'CONTINUE';
  let passedThreshold = true;

  // ABORT if:
  // - Treatment grounding score below threshold
  // - Drop exceeds tolerance (10%)
  // - Error rate too high
  if (
    metrics.treatmentAvgGroundingScore < groundingThreshold ||
    groundingScoreDrop > maxAllowedDrop ||
    metrics.treatmentErrorRate > 0.05
  ) {
    recommendedAction = 'ABORT';
    passedThreshold = false;
  }
  // EXPAND if:
  // - Treatment performs well (no quality loss)
  // - Error rate acceptable
  // - Sufficient queries tested (>1000)
  else if (
    metrics.treatmentQueries > 1000 &&
    groundingScoreDrop < 0.05 && // <5% drop
    metrics.treatmentErrorRate < 0.02
  ) {
    recommendedAction = 'EXPAND';
    passedThreshold = true;
  }

  return {
    ...metrics,
    groundingScoreDrop,
    groundingScoreDropPercent,
    latencyImprovement,
    passedThreshold,
    recommendedAction,
  };
}

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Load Phase 2 migration configuration from environment
 */
export function getPhase2Config(): MigrationStrategy {
  return {
    l3Migration: {
      enabled: process.env.PHASE2_L3_MIGRATION_ENABLED !== 'false',
      oldModel: process.env.PHASE2_L3_OLD_MODEL || 'gpt-4',
      newModel: process.env.PHASE2_L3_NEW_MODEL || 'gpt-4-turbo',
      expectedSavings: 0.60,
    },
    l2ABTest: {
      enabled: process.env.PHASE2_L2_AB_TEST_ENABLED !== 'false',
      control: process.env.PHASE2_L2_CONTROL_MODEL || 'gpt-4-turbo',
      treatment: process.env.PHASE2_L2_TREATMENT_MODEL || 'gpt-3.5-turbo',
      treatmentRatio: parseFloat(process.env.PHASE2_L2_TREATMENT_RATIO || '0.20'),
      expectedGroundingDropThreshold: 0.75,
    },
  };
}

// ============================================================================
// Logging and Telemetry
// ============================================================================

/**
 * Format Phase 2 migration metrics for logging
 */
export function formatMigrationMetrics(metrics: ModelMigrationMetrics): string {
  const lines = [
    `[Phase 2] Tier: ${metrics.tier}`,
    `Control: ${metrics.controlModel}`,
    metrics.treatmentModel ? `Treatment: ${metrics.treatmentModel}` : '',
    `Used: ${metrics.usedModel}${metrics.isABTestRequest ? ' (A/B Test)' : ''}`,
    `Tokens: ${metrics.inputTokens}/${metrics.outputTokens} (in/out)`,
    `Cost: $${metrics.estimatedCost.toFixed(4)}`,
    `Savings: $${metrics.savingsVsOriginal.toFixed(4)} vs original`,
    `Grounding: ${(metrics.groundingScore * 100).toFixed(1)}%`,
  ].filter(Boolean);

  return lines.join(' | ');
}

/**
 * Log Phase 2 decision (model selection)
 */
export function logPhase2Decision(
  tier: Tier,
  model: string,
  reason: string,
  context?: Record<string, unknown>
): void {
  const message = [
    `[Phase 2 Decision]`,
    `Tier: ${tier}`,
    `Model: ${model}`,
    `Reason: ${reason}`,
    context ? JSON.stringify(context) : '',
  ]
    .filter(Boolean)
    .join(' | ');

  console.log(message);
}

/**
 * Log A/B test evaluation results
 */
export function logABTestResults(testMetrics: ABTestMetrics): void {
  const lines = [
    `[A/B Test Results]`,
    `Test ID: ${testMetrics.testId}`,
    `Queries: Control=${testMetrics.controlQueries} | Treatment=${testMetrics.treatmentQueries}`,
    `Grounding: Control=${(testMetrics.controlAvgGroundingScore * 100).toFixed(1)}% | Treatment=${(testMetrics.treatmentAvgGroundingScore * 100).toFixed(1)}%`,
    `Drop: ${(testMetrics.groundingScoreDropPercent).toFixed(1)}%`,
    `Latency Improvement: ${(testMetrics.latencyImprovement).toFixed(0)}ms`,
    `Error Rates: Control=${(testMetrics.controlErrorRate * 100).toFixed(2)}% | Treatment=${(testMetrics.treatmentErrorRate * 100).toFixed(2)}%`,
    `Status: ${testMetrics.passedThreshold ? 'PASS ✓' : 'FAIL ✗'}`,
    `Recommendation: ${testMetrics.recommendedAction}`,
  ];

  console.log(lines.join('\n'));
}
