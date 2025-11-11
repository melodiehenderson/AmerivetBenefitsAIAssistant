import { NextRequest, NextResponse } from 'next/server';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import { validateResponse } from '@/lib/rag/validation';
import { detectQueryIntent } from '@/lib/rag/query-intent-detector';
import type { RetrievalContext } from '@/types/rag';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { query, companyId, sessionId } = await req.json();
    
    if (!query || !companyId || !sessionId) {
      return NextResponse.json({ error: 'Missing query, companyId, or sessionId' }, { status: 400 });
    }

    console.log(`[QA] Session: ${sessionId} | Query: "${query.substring(0, 80)}..." | Company: ${companyId}`);

    // Step 1: Hybrid Retrieval
    const context: RetrievalContext = {
      companyId,
    };

    // Detect query intent for intelligent routing
    const queryIntent = detectQueryIntent(query);
    console.log(`[QA] Intent detected: ${queryIntent.type} (confidence: ${queryIntent.confidence.toFixed(2)}) | Conditions: ${queryIntent.variables.conditions?.join(', ') || 'none'}`);

    console.log('[QA] Starting hybrid retrieval...');
    const result = await hybridRetrieve(query, context);
    const retrievalTime = Date.now() - startTime;

    if (!result.chunks || result.chunks.length === 0) {
      console.log('[QA] No chunks retrieved');
      return NextResponse.json({
        answer: 'I could not find any relevant information to answer your question.',
        metadata: {
          groundingScore: 0,
          distinctDocIds: 0,
          rerankedCount: 0,
          retrievalTimeMs: retrievalTime,
        }
      });
    }

    console.log(`[QA] Retrieved ${result.chunks.length} chunks in ${retrievalTime}ms`);

    // Step 2: Build context from chunks
    const contextText = result.chunks
      .map((chunk, idx) => `[${idx + 1}] ${chunk.title}\n${chunk.content}`)
      .join('\n\n');

    const distinctDocs = new Set(result.chunks.map(c => c.docId)).size;

    // Step 3: Generate answer with Azure OpenAI (Chat Completion API)
    console.log('[QA] Generating response with Azure OpenAI...');
    const generationStart = Date.now();

    const systemPrompt = `You are an elite benefits advisor for AmeriVet - think like Albert Einstein approaching complex problems: break them into components, identify patterns, reason through consequences, and provide elegant solutions grounded in evidence.

=== CORE PRINCIPLES (APPLY ALWAYS) ===

1. DIRECT & CONFIDENT
- NO opening greetings like "Hello" or "I'm your Benefits Assistant"
- Start immediately with the answer
- Use plain, everyday language - never jargon-heavy

2. ZERO FORMATTING - THIS IS NON-NEGOTIABLE
- NO asterisks (*), dashes (-), underscores (_), or any special characters for formatting
- NO bold, italics, headers, or markdown of ANY kind
- NO brackets [1] [2] [3], no citations, no reference numbers
- ONLY plain text - nothing else
- Write headers as: "Section Name:" (colon only, no special characters before)
- Example: Write "Plan Comparison:" NOT "**Plan Comparison**" or "--- Plan Comparison ---"

3. INTELLIGENT CONTEXT DETECTION
- When someone mentions specific life events (pregnancy, chemotherapy, mental health, surgery, chronic conditions), IMMEDIATELY identify this as a high-stakes decision
- Recognize that these scenarios demand detailed plan comparison, not generic advice
- Extract key variables from the question (age, family size, anticipated expenses, health conditions)

=== SMART RESPONSE FRAMEWORK ===

A) FOR "WHAT ARE MY OPTIONS?" OR SIMPLE PLAN AVAILABILITY
Start with: "You can choose from [X] plans: [Name 1], [Name 2], [Name 3]"
Then briefly describe each
Keep it concise and actionable

B) FOR HIGH-STAKES HEALTH SCENARIOS (pregnancy, mental health, expensive treatments, chronic conditions)
1. IDENTIFY THE CORE CONCERN
   - What specific health service or condition are they asking about?
   - What's their family situation and anticipated usage?

2. EXTRACT KEY INFORMATION FROM CONTEXT
   - Look for copay amounts, deductibles, out-of-pocket maximums for the relevant service
   - Find coverage details (is this service covered? Any waiting periods?)
   - Check network information

3. COMPARE PLANS SYSTEMATICALLY
   - Line up plans side-by-side on the specific metric that matters (e.g., for maternity: copay per visit, total pregnancy coverage, delivery costs)
   - Highlight which plan is best for THEIR specific scenario

4. GIVE A CLEAR RECOMMENDATION
   - "Based on your situation [specific details], [Plan Name] is the best choice because [concrete reason with numbers]"
   - Explain second-choice alternatives if relevant

5. ASK CLARIFYING FOLLOW-UPS (if critical info is missing)
   - If you don't have enough info to recommend confidently, ask: "To give you the best recommendation, I need to know: [specific question]"
   - Common follow-ups: anticipated frequency of visits, whether in-network vs out-of-network matters, budget constraints

C) FOR COMPARATIVE QUESTIONS ("Plan A vs Plan B for [condition]")
1. Pull the specific coverage details for that condition in each plan
2. Create a mini-comparison using text lines: "Plan A: [detail]. Plan B: [detail]."
3. Give a recommendation based on their specific needs

D) FOR ENROLLMENT, DEADLINES, OR PROCESS QUESTIONS
- Give exact dates and clear next steps
- If deadlines are mentioned in context, emphasize them

=== LOGIC MODEL (REASON LIKE EINSTEIN) ===

Before answering, think through:
- What is the person's TRUE question beneath what they asked?
- What are the constraints they're operating under? (budget, health needs, family size)
- Which plan variables matter most for their scenario?
- What evidence supports this recommendation?
- Am I missing critical information that would change my answer?

=== HANDLING INCOMPLETE INFORMATION ===

If the context doesn't have specific details you need (e.g., maternity copay amounts, mental health session limits):
- Say explicitly: "I can see [Plan Name] covers this, but the specific copay isn't detailed in our materials"
- Provide what you DO know with confidence
- Suggest asking a benefits counselor ONLY if you genuinely cannot answer without that info

=== TONE ===
- Expert but accessible (explain like to a smart friend, not an insurance manual)
- Warm but efficient (respect their time)
- Confident in what you know, transparent about what you don't

REMEMBER: NO ASTERISKS, NO SPECIAL FORMATTING, ONLY PLAIN TEXT.`;

    const userPrompt = `Context:
${contextText}

Question: ${query}

${queryIntent.type === 'high-stakes' ? `
IMPORTANT: This is a high-stakes health scenario (${queryIntent.lifeEvent?.replace(/_/g, ' ')}).
Variables identified:
${queryIntent.variables.familySize ? `- Family size: ${queryIntent.variables.familySize} people` : ''}
${queryIntent.variables.conditions ? `- Health conditions: ${queryIntent.variables.conditions.join(', ')}` : ''}
${queryIntent.variables.expectedVisitFrequency ? `- Expected visit frequency: ${queryIntent.variables.expectedVisitFrequency}` : ''}
${queryIntent.variables.budget ? `- Budget preference: ${queryIntent.variables.budget}` : ''}

Your response MUST:
1. Extract the specific coverage details from each plan for ${queryIntent.lifeEvent?.replace(/_/g, ' ')}
2. Compare plans side-by-side on the metrics that matter most for this scenario
3. Give a clear recommendation for WHICH PLAN IS BEST based on their specific situation
4. Use concrete numbers (copays, deductibles, out-of-pocket max) in your comparison

${queryIntent.followUpQuestions ? `
If you need clarification to give the best recommendation, ask: ${queryIntent.followUpQuestions[0]}
` : ''}
` : `${queryIntent.type === 'availability' ? `This is a simple availability question. Start your answer with the plan names/options.` : ''}`}

Provide a clear, concise answer based on the context above. Focus on what matters most for their situation.`;


    const completion = await azureOpenAIService.generateChatCompletion(
      [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt }
      ],
      {
        maxTokens: 800,
        temperature: 0.1,
      }
    );

    const answer = completion.content;

    // Post-process: Remove any asterisks, bold markers, or markdown formatting
    const cleanedAnswer = answer
      .replace(/\*\*/g, '') // Remove bold markers (**)
      .replace(/\*/g, '') // Remove single asterisks
      .replace(/__/g, '') // Remove bold underscores
      .replace(/_/g, '') // Remove single underscores
      .trim();

    const generationTime = Date.now() - generationStart;
    console.log(`[QA] Generated response in ${generationTime}ms`);

    // Step 4: Validate response
    console.log('[QA] Validating response...');
    const validationStart = Date.now();
    
    // Build citations from chunks for validation
    const citations = result.chunks.map(chunk => ({
      chunkId: chunk.id,
      docId: chunk.docId,
      title: chunk.title,
      relevanceScore: chunk.metadata?.relevanceScore || 0,
    }));

    const validation = await validateResponse(cleanedAnswer, citations, result.chunks, 'L1');
    const validationTime = Date.now() - validationStart;

    console.log(`[QA] Validation complete: grounding=${validation.grounding.score.toFixed(2)}, valid=${validation.grounding.ok}`);

    const totalTime = Date.now() - startTime;

    return NextResponse.json({
      answer: cleanedAnswer,
      tier: 'L1',
      metadata: {
        groundingScore: validation.grounding.score,
        distinctDocIds: distinctDocs,
        rerankedCount: result.chunks.length,
        retrievalTimeMs: retrievalTime,
        generationTimeMs: generationTime,
        validationTimeMs: validationTime,
        totalTimeMs: totalTime,
      }
    });

  } catch (error) {
    console.error('[QA] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ 
      error: 'Failed to process query',
      details: errorMessage
    }, { status: 500 });
  }
}
