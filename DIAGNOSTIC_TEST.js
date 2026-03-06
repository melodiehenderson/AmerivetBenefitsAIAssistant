// DIAGNOSTIC: Test the exact scenario that's failing
// Question: "I'm single and healthy. What do you recommend"
// User: Age 23, State: Oregon

const testScenario = {
  query: "I'm single and healthy. What do you recommend",
  age: 23,
  state: "Oregon",
  timestamp: new Date().toISOString()
};

console.log('=== DIAGNOSTIC TEST ===');
console.log('Testing scenario that failed in production:');
console.log(JSON.stringify(testScenario, null, 2));

// Simulate what should happen:
console.log('\n=== EXPECTED FLOW ===');
console.log('1. Extract category from query');
console.log('   - Keywords: "single", "healthy"');
console.log('   - Expected category: MEDICAL');

console.log('\n2. Build context with user demographics');
console.log('   - userAge: 23');
console.log('   - userState: Oregon');
console.log('   - category: MEDICAL');

console.log('\n3. Search Azure Search Index');
console.log('   - Filter should include category');
console.log('   - If category field missing, graceful fallback');

console.log('\n4. Generate recommendation');
console.log('   - Run validation pipeline');
console.log('   - Call Azure OpenAI');
console.log('   - Return with pricing');

console.log('\n=== POTENTIAL FAILURE POINTS ===');
console.log('[1] Session not found or corrupted');
console.log('    - Check if sessionId is valid');
console.log('    - Check if Redis/session store is accessible');

console.log('[2] Azure Search failing');
console.log('    - OData filter malformed (category field missing)');
console.log('    - Index might be offline or quota exceeded');
console.log('    - Connection string invalid');

console.log('[3] Azure OpenAI failing');
console.log('    - API quota exceeded');
console.log('    - Authentication failed');
console.log('    - Request timeout');

console.log('[4] Session update failing');
console.log('    - Redis write error');
console.log('    - Session encoding issue');

console.log('\n=== RECOMMENDED DEBUGGING ===');
console.log('1. Check Vercel logs for the EXACT error message');
console.log('2. Verify Azure Services status:');
console.log('   - Azure Search index availability');
console.log('   - Azure OpenAI endpoint status');
console.log('   - Redis connection status');
console.log('3. Test with simpler question first');
console.log('   - "What benefits do we have?"');
console.log('   - "Tell me about medical plans"');
console.log('4. Check if session is persisting between messages');

console.log('\n=== NEXT STEPS ===');
console.log('✓ Deployed safer category filter (graceful fallback)');
console.log('? Need to re-test with same question');
console.log('? Check Vercel dashboard for actual error logs');
console.log('? Verify all Azure services are healthy');
