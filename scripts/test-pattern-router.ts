/**
 * Test script for pattern router
 * Run: npx tsx scripts/test-pattern-router.ts
 */

import {
  calculateRoutingSignals,
  selectTier,
  explainTierSelection,
  formatRoutingDecision,
  shouldEscalateTier,
  escalateTier,
  shouldDowngradeTier,
  downgradeTier,
} from "../lib/rag/pattern-router";
import { analyzeQuery } from "../lib/rag/query-understanding";
import type { Chunk, RoutingSignals } from "../types/rag";

// Create stub chunks for testing
function createStubChunks(count: number, relevanceScore: number = 0.8): Chunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i}`,
    docId: `doc-${i % 3}`, // Simulate 3 different docs
    companyId: "",
    sectionPath: `section-${i}`,
    content: `This is test content for chunk ${i}`,
    title: `Document ${i % 3}`,
    position: i,
    windowStart: 0,
    windowEnd: 100,
    metadata: {
      tokenCount: 100,
      relevanceScore,
    },
    createdAt: new Date(),
  }));
}

console.log("=".repeat(80));
console.log("Pattern Router Test");
console.log("=".repeat(80));
console.log("");

// Test scenarios
const scenarios = [
  {
    name: "Simple FAQ (L1 Expected)",
    query: "What is a PPO plan?",
    chunks: createStubChunks(2, 0.95),
  },
  {
    name: "Moderate Comparison (L2 Expected)",
    query: "What is the difference between PPO and HMO?",
    chunks: createStubChunks(4, 0.75),
  },
  {
    name: "Complex Calculation (L3 Expected)",
    query: "How much will I pay for a $5000 procedure with 80% coverage and $1000 deductible?",
    chunks: createStubChunks(3, 0.70),
  },
  {
    name: "Low Coverage Query (L3 Expected)",
    query: "How does FSA interact with COBRA after voluntary termination?",
    chunks: createStubChunks(2, 0.40),
  },
  {
    name: "High Risk Legal Query (L3 Expected)",
    query: "What are my rights under FMLA for mental health treatment and can I file discrimination complaint?",
    chunks: createStubChunks(3, 0.65),
  },
  {
    name: "Multi-Doc Synthesis (L2/L3 Expected)",
    query: "Compare out-of-pocket costs across all plans for in-network vs out-of-network providers",
    chunks: createStubChunks(8, 0.70), // 8 chunks from 3 docs
  },
];

for (const scenario of scenarios) {
  console.log("─".repeat(80));
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Query: "${scenario.query}"`);
  console.log("─".repeat(80));

  // Analyze query
  const profile = analyzeQuery(scenario.query);
  console.log(`\nQuery Profile:`);
  console.log(`  Intent: ${profile.intent}`);
  console.log(`  Complexity: ${(profile.complexity * 100).toFixed(0)}%`);
  console.log(`  Risk: ${(profile.riskScore * 100).toFixed(0)}%`);
  console.log(`  Needs Tool: ${profile.needsTool ? "Yes" : "No"}`);

  // Calculate routing signals
  const signals = calculateRoutingSignals(scenario.query, profile, scenario.chunks);
  console.log(`\nRouting Signals:`);
  console.log(`  Coverage: ${(signals.coverage * 100).toFixed(0)}%`);
  console.log(`  Evidence Score: ${(signals.evidenceScore * 100).toFixed(0)}%`);
  console.log(`  Complexity: ${(signals.complexityScore * 100).toFixed(0)}%`);
  console.log(`  Risk: ${(signals.riskScore * 100).toFixed(0)}%`);
  console.log(`  Multi-doc: ${signals.multiDocSynthesis ? "Yes" : "No"}`);
  console.log(`  Chunks Retrieved: ${scenario.chunks.length}`);

  // Select tier
  const selectedTier = selectTier(signals);
  const explanation = explainTierSelection(signals);
  
  console.log(`\nTier Selection: ${selectedTier}`);
  console.log(`Reasons:`);
  explanation.reasons.forEach((reason) => {
    console.log(`  - ${reason}`);
  });

  console.log(`\nDecision Summary:`);
  console.log(`  ${formatRoutingDecision(signals, selectedTier)}`);

  console.log("");
}

// Test escalation logic
console.log("=".repeat(80));
console.log("Tier Escalation Tests");
console.log("=".repeat(80));
console.log("");

const escalationTests = [
  { tier: "L1" as const, groundingScore: 0.5, citationsValid: true, expected: true },
  { tier: "L1" as const, groundingScore: 0.8, citationsValid: false, expected: true },
  { tier: "L2" as const, groundingScore: 0.9, citationsValid: true, expected: false },
  { tier: "L3" as const, groundingScore: 0.5, citationsValid: false, expected: false },
];

for (const test of escalationTests) {
  const shouldEscalate = shouldEscalateTier(test.tier, test.groundingScore, test.citationsValid);
  const result = shouldEscalate === test.expected ? "✓ PASS" : "✗ FAIL";
  console.log(`${result} | Tier ${test.tier}, Grounding ${test.groundingScore}, Citations ${test.citationsValid} → Escalate: ${shouldEscalate}`);
  
  if (shouldEscalate) {
    const newTier = escalateTier(test.tier);
    console.log(`       → Escalated to: ${newTier}`);
  }
}

// Test downgrade logic
console.log("");
console.log("=".repeat(80));
console.log("Tier Downgrade Tests");
console.log("=".repeat(80));
console.log("");

const downgradeTests = [
  { tier: "L3" as const, error: new Error("timeout"), elapsedMs: 7000, expected: true },
  { tier: "L2" as const, error: new Error("rate limit"), elapsedMs: 2000, expected: true },
  { tier: "L1" as const, error: null, elapsedMs: 1000, expected: false },
  { tier: "L3" as const, error: new Error("other error"), elapsedMs: 3000, expected: false },
];

for (const test of downgradeTests) {
  const shouldDowngrade = shouldDowngradeTier(test.tier, test.error, test.elapsedMs);
  const result = shouldDowngrade === test.expected ? "✓ PASS" : "✗ FAIL";
  console.log(`${result} | Tier ${test.tier}, Error: ${test.error?.message || "none"}, Elapsed ${test.elapsedMs}ms → Downgrade: ${shouldDowngrade}`);
  
  if (shouldDowngrade) {
    const newTier = downgradeTier(test.tier);
    console.log(`       → Downgraded to: ${newTier}`);
  }
}

console.log("");
console.log("=".repeat(80));
console.log("Test Complete");
console.log("=".repeat(80));
