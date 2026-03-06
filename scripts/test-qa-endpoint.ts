/**
 * Test Suite: QA API Endpoint
 * 
 * Tests the full RAG orchestration flow:
 * - Request parsing and validation
 * - Query understanding integration
 * - Cache hit/miss scenarios
 * - Tier selection and escalation
 * - Response generation and validation
 * - Performance tracking
 * 
 * Note: Requires Next.js dev server running on http://localhost:3000
 */

const API_URL = 'http://localhost:3000/api/qa';

interface TestCase {
  name: string;
  request: {
    query: string;
    companyId?: string;
    userId?: string;
  };
  expectedTier?: string;
  expectCache?: boolean;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Simple FAQ - L1 Tier',
    request: {
      query: 'What is a PPO plan?',
      companyId: 'amerivet',
      userId: 'test-user-1',
    },
    expectedTier: 'L1',
  },
  {
    name: 'Moderate Comparison - L2 Tier',
    request: {
      query: 'What is the difference between PPO and HDHP plans?',
      companyId: 'amerivet',
      userId: 'test-user-2',
    },
    expectedTier: 'L2',
  },
  {
    name: 'Complex Calculation - L3 Tier',
    request: {
      query: 'How much will I pay for a $5000 procedure with 80% coverage and a $2000 deductible?',
      companyId: 'amerivet',
      userId: 'test-user-3',
    },
    expectedTier: 'L3',
  },
  {
    name: 'Cache Hit - Repeat Query',
    request: {
      query: 'What is a PPO plan?',
      companyId: 'amerivet',
      userId: 'test-user-1',
    },
    expectCache: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Test Execution
// ─────────────────────────────────────────────────────────────────────────────

async function runTest(testCase: TestCase): Promise<void> {
  console.log(`\n=== ${testCase.name} ===`);
  console.log(`Query: "${testCase.request.query}"`);

  try {
    const startTime = Date.now();
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testCase.request),
    });

    const latency = Date.now() - startTime;
    const data = await response.json();

    if (!response.ok) {
      console.log(`✗ FAIL: ${data.error || 'Unknown error'}`);
      return;
    }

    console.log(`✓ SUCCESS (${latency}ms)`);
    console.log(`  Tier: ${data.tier || data.metadata?.tier || 'unknown'}`);
    console.log(`  From Cache: ${data.fromCache ? 'YES' : 'NO'}`);
    console.log(`  Grounding: ${((data.metadata?.groundingScore || 0) * 100).toFixed(1)}%`);
    console.log(`  Retrieval Count: ${data.metadata?.retrievalCount || 0}`);
    console.log(`  Escalated: ${data.metadata?.escalated ? 'YES' : 'NO'}`);
    
    if (data.metadata?.latencyBreakdown) {
      console.log(`  Latency Breakdown:`);
      console.log(`    - Cache Check: ${data.metadata.latencyBreakdown.cacheCheck}ms`);
      console.log(`    - Retrieval: ${data.metadata.latencyBreakdown.retrieval}ms`);
      console.log(`    - Generation: ${data.metadata.latencyBreakdown.generation}ms`);
      console.log(`    - Validation: ${data.metadata.latencyBreakdown.validation}ms`);
      console.log(`    - Total: ${data.metadata.latencyBreakdown.total}ms`);
    }

    console.log(`  Answer Preview: "${data.answer.substring(0, 100)}..."`);

    // Validate expectations
    if (testCase.expectedTier && data.tier !== testCase.expectedTier) {
      console.log(`  ⚠ WARNING: Expected tier ${testCase.expectedTier}, got ${data.tier}`);
    }

    if (testCase.expectCache && !data.fromCache) {
      console.log(`  ⚠ WARNING: Expected cache hit, but got cache miss`);
    }

  } catch (error) {
    console.log(`✗ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function runAllTests(): Promise<void> {
  console.log('='.repeat(80));
  console.log('QA API Endpoint Test Suite');
  console.log('='.repeat(80));

  // Health check first
  console.log('\n=== Health Check ===');
  try {
    const response = await fetch(API_URL, { method: 'GET' });
    const health = await response.json();
    console.log(`Status: ${health.status}`);
    console.log(`Components:`, JSON.stringify(health.components, null, 2));
  } catch (error) {
    console.log('✗ FAIL: API not reachable. Is the dev server running?');
    console.log('   Run: npm run dev');
    process.exit(1);
  }

  // Run test cases
  for (const testCase of TEST_CASES) {
    await runTest(testCase);
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n' + '='.repeat(80));
  console.log('Test suite complete');
  console.log('='.repeat(80));
}

// Execute tests
runAllTests().catch(console.error);
