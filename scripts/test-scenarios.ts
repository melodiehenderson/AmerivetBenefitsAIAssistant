/**
 * Test Scenarios for Benefits AI Chatbot
 * 
 * Principal Developer Workflow:
 * 1. Run locally: npm run dev
 * 2. Execute tests: npx tsx scripts/test-scenarios.ts
 * 3. Review results
 * 4. Deploy: vercel --prod
 * 5. Run tests against production
 */

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:3000';

interface TestResult {
  scenario: string;
  passed: boolean;
  details: string;
  response?: string;
  duration?: number;
}

interface QAResponse {
  answer: string;
  metadata?: {
    category?: string;
    router?: {
      category: string;
      confidence: number;
      triggersHSACrossSell: boolean;
      requiresAgeBand: boolean;
    };
    validation?: {
      overallPassed: boolean;
    };
  };
  sessionContext?: {
    userName?: string;
    userAge?: number;
    userState?: string;
  };
}

// ============================================================================
// Test Helper Functions
// ============================================================================

async function sendMessage(
  query: string, 
  sessionId: string,
  context?: { userAge?: number; userState?: string }
): Promise<QAResponse> {
  const response = await fetch(`${BASE_URL}/api/qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      sessionId,
      context
    })
  });
  
  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }
  
  return response.json();
}

// ============================================================================
// Test Scenarios
// ============================================================================

const testScenarios: Array<{
  name: string;
  steps: Array<{ query: string; context?: any }>;
  assertions: (responses: QAResponse[]) => TestResult;
}> = [
  
  // SCENARIO 1: Complete Onboarding Flow
  {
    name: 'Complete Onboarding Flow',
    steps: [
      { query: 'hello' },
      { query: 'John' },
      { query: '34 CA' },
      { query: 'Medical plans' }
    ],
    assertions: (responses) => {
      const lastResponse = responses[responses.length - 1];
      const hasAge = responses.some(r => r.sessionContext?.userAge === 34);
      const hasState = responses.some(r => r.sessionContext?.userState === 'CA');
      const hasMedicalContent = lastResponse.answer.toLowerCase().includes('medical') ||
                                 lastResponse.answer.toLowerCase().includes('hmo') ||
                                 lastResponse.answer.toLowerCase().includes('ppo');
      
      return {
        scenario: 'Complete Onboarding Flow',
        passed: hasAge && hasState && hasMedicalContent,
        details: `Age captured: ${hasAge}, State captured: ${hasState}, Medical content: ${hasMedicalContent}`,
        response: lastResponse.answer.substring(0, 200)
      };
    }
  },
  
  // SCENARIO 2: Critical Illness Query (Should NOT return Medical docs)
  {
    name: 'Critical Illness - No Medical Loop',
    steps: [
      { query: 'Tell me about Critical Illness coverage', context: { userAge: 40, userState: 'TX' } }
    ],
    assertions: (responses) => {
      const answer = responses[0].answer.toLowerCase();
      const router = responses[0].metadata?.router;
      
      // Should be routed to ANCILLARY, not MEDICAL
      const correctCategory = router?.category === 'ANCILLARY' || 
                             answer.includes('critical illness') ||
                             answer.includes('supplemental');
      
      // Should NOT be talking about PPO/HMO/deductibles
      const noMedicalLoop = !answer.includes('ppo plan') && 
                           !answer.includes('hmo plan') &&
                           !(answer.includes('deductible') && answer.includes('medical'));
      
      return {
        scenario: 'Critical Illness - No Medical Loop',
        passed: correctCategory && noMedicalLoop,
        details: `Router: ${router?.category}, No medical loop: ${noMedicalLoop}`,
        response: responses[0].answer.substring(0, 200)
      };
    }
  },
  
  // SCENARIO 3: Age-Banded Product Cost Refusal
  {
    name: 'Age-Banded Cost Refusal (Life Insurance)',
    steps: [
      { query: 'How much does Voluntary Life insurance cost for a 50 year old?', context: { userAge: 50, userState: 'CA' } }
    ],
    assertions: (responses) => {
      const answer = responses[0].answer.toLowerCase();
      const router = responses[0].metadata?.router;
      
      // Should refuse specific dollar amount
      const refusesCost = answer.includes('portal') || 
                         answer.includes('age-rated') ||
                         answer.includes('personalized rate');
      
      // Should NOT contain a specific dollar amount for life insurance
      const noSpecificCost = !(/\$\d+.*life/i.test(answer) || /life.*\$\d+/i.test(answer));
      
      return {
        scenario: 'Age-Banded Cost Refusal',
        passed: refusesCost || noSpecificCost,
        details: `Refuses cost: ${refusesCost}, No specific $: ${noSpecificCost}, AgeBand flag: ${router?.requiresAgeBand}`,
        response: responses[0].answer.substring(0, 200)
      };
    }
  },
  
  // SCENARIO 4: HSA Cross-Sell (Brandon Rule)
  {
    name: 'HSA Cross-Sell (Brandon Rule)',
    steps: [
      { query: 'Tell me about the HDHP plan', context: { userAge: 30, userState: 'CA' } }
    ],
    assertions: (responses) => {
      const answer = responses[0].answer.toLowerCase();
      const router = responses[0].metadata?.router;
      
      // Should trigger HSA cross-sell
      const hasCrossSell = router?.triggersHSACrossSell === true;
      
      // Should mention Accident or Critical Illness
      const mentionsSupplemental = answer.includes('accident') || 
                                   answer.includes('critical illness') ||
                                   answer.includes('supplemental') ||
                                   answer.includes('pro tip');
      
      return {
        scenario: 'HSA Cross-Sell (Brandon Rule)',
        passed: hasCrossSell || mentionsSupplemental,
        details: `Triggers cross-sell: ${hasCrossSell}, Mentions supplemental: ${mentionsSupplemental}`,
        response: responses[0].answer.substring(0, 200)
      };
    }
  },
  
  // SCENARIO 5: Cost Format Validation
  {
    name: 'Cost Format ($X/month)',
    steps: [
      { query: 'What is the cost of the PPO plan?', context: { userAge: 35, userState: 'CA' } }
    ],
    assertions: (responses) => {
      const answer = responses[0].answer;
      
      // Should have monthly format: $X per month or $X/month
      const hasMonthlyFormat = /\$[\d,]+(\.\d{2})?\s*(per month|\/month)/i.test(answer);
      
      // Should have annual format too
      const hasAnnualFormat = /\$[\d,]+(\.\d{2})?\s*(per year|annually|\/year)/i.test(answer);
      
      return {
        scenario: 'Cost Format ($X/month)',
        passed: hasMonthlyFormat || hasAnnualFormat,
        details: `Has monthly: ${hasMonthlyFormat}, Has annual: ${hasAnnualFormat}`,
        response: answer.substring(0, 300)
      };
    }
  },
  
  // SCENARIO 6: No Markdown in Response
  {
    name: 'No Raw Markdown Leakage',
    steps: [
      { query: 'Compare PPO and HMO plans', context: { userAge: 30, userState: 'CA' } }
    ],
    assertions: (responses) => {
      const answer = responses[0].answer;
      
      // Should NOT have raw markdown
      const hasRawBold = /\*\*[^*]+\*\*/g.test(answer);
      const hasRawItalic = /(?<!\*)\*[^*]+\*(?!\*)/g.test(answer);
      const hasRawHeaders = /^#+\s/gm.test(answer);
      
      return {
        scenario: 'No Raw Markdown Leakage',
        passed: !hasRawBold && !hasRawHeaders,
        details: `Raw bold: ${hasRawBold}, Raw headers: ${hasRawHeaders}`,
        response: answer.substring(0, 200)
      };
    }
  },
  
  // SCENARIO 7: Technical Difficulty Recovery
  {
    name: 'No Technical Difficulty Error',
    steps: [
      { query: 'best plan for me this year', context: { userAge: 34, userState: 'CA' } }
    ],
    assertions: (responses) => {
      const answer = responses[0].answer.toLowerCase();
      
      // Should NOT have the error message
      const noError = !answer.includes('technical difficulty') && 
                      !answer.includes('apologize for');
      
      // Should have actual content
      const hasContent = answer.length > 100 && 
                        (answer.includes('plan') || answer.includes('coverage'));
      
      return {
        scenario: 'No Technical Difficulty Error',
        passed: noError && hasContent,
        details: `No error: ${noError}, Has content: ${hasContent}`,
        response: responses[0].answer.substring(0, 200)
      };
    }
  }
];

// ============================================================================
// Test Runner
// ============================================================================

async function runTests(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Benefits AI Chatbot - Test Suite');
  console.log(`Target: ${BASE_URL}`);
  console.log('='.repeat(60));
  console.log('');
  
  const results: TestResult[] = [];
  
  for (const scenario of testScenarios) {
    const sessionId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const responses: QAResponse[] = [];
    
    console.log(`\n📋 Running: ${scenario.name}`);
    
    try {
      const startTime = Date.now();
      
      for (const step of scenario.steps) {
        const response = await sendMessage(step.query, sessionId, step.context);
        responses.push(response);
        
        // Small delay between steps
        await new Promise(r => setTimeout(r, 500));
      }
      
      const duration = Date.now() - startTime;
      const result = scenario.assertions(responses);
      result.duration = duration;
      results.push(result);
      
      if (result.passed) {
        console.log(`   ✅ PASSED (${duration}ms)`);
      } else {
        console.log(`   ❌ FAILED (${duration}ms)`);
        console.log(`   Details: ${result.details}`);
        if (result.response) {
          console.log(`   Response: "${result.response}..."`);
        }
      }
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({
        scenario: scenario.name,
        passed: false,
        details: `Error: ${errorMsg}`
      });
      console.log(`   ❌ ERROR: ${errorMsg}`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`\n✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}`);
  
  if (failed > 0) {
    console.log('\nFailed Scenarios:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.scenario}: ${r.details}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  
  // Exit with error code if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(console.error);
