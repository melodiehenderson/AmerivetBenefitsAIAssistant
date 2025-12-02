import { NextRequest, NextResponse } from 'next/server';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import { validateResponse } from '@/lib/rag/validation';
import { detectQueryIntent } from '@/lib/rag/query-intent-detector';
import type { RetrievalContext } from '@/types/rag';
import { 
  findQueryClusterSimple, 
  addQueryToClusterSimple,
  queryToVector 
} from '@/lib/rag/cache-utils';
import { trackCacheHit } from '@/lib/rag/observability';
import { getOrCreateSession, updateSession } from '@/lib/rag/session-store';
import { 
  shouldAppendTransition, 
  validatePricingFormat, 
  enforceMonthlyFirstFormat, 
  TOPIC_TRANSITION_PROMPT 
} from '@/lib/rag/response-utils';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { query, companyId, sessionId, context: reqContext } = await req.json();
    
    if (!query || !companyId || !sessionId) {
      return NextResponse.json({ error: 'Missing query, companyId, or sessionId' }, { status: 400 });
    }

    console.log(`[QA] Session: ${sessionId} | Query: "${query.substring(0, 80)}..." | Company: ${companyId}`);

    // Initialize session and update context
    const session = getOrCreateSession(sessionId);
    session.turn = (session.turn ?? 0) + 1;
    if (reqContext?.state) session.context.state = reqContext.state;
    if (reqContext?.dept) session.context.dept = reqContext.dept;

    // Step 1: Hybrid Retrieval
    const context: RetrievalContext = {
      companyId,
      state: session.context.state,
      dept: session.context.dept,
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

    // Phase 3: Query Clustering - Check for similar cached queries
    console.log('[QA] Checking query cluster cache...');
    
    // Generate query vector for clustering
    const queryVector = queryToVector(query);
    
    // Try to find a matching cluster (similar previously answered question)
    const clusterMatch = findQueryClusterSimple(queryVector, companyId, 0.85);
    
    if (clusterMatch && clusterMatch.confidence >= 0.85) {
      // CLUSTER HIT: Return cached answer from similar query
      console.log(`[QA] Cluster hit found (confidence: ${clusterMatch.confidence.toFixed(3)}) - returning cached answer`);
      trackCacheHit('cluster');
      
      return NextResponse.json({
        answer: clusterMatch.answer,
        tier: 'L1',
        cacheSource: 'cluster',
        metadata: {
          groundingScore: clusterMatch.groundingScore || 0.85,
          distinctDocIds: 0,
          rerankedCount: 0,
          retrievalTimeMs: Date.now() - startTime,
          cacheHitType: 'cluster',
          clusterConfidence: clusterMatch.confidence,
        }
      });
    }

    console.log('[QA] No suitable cluster found - proceeding with LLM generation');

    // Step 2: Build context from chunks
    const contextText = result.chunks
      .map((chunk, idx) => `[${idx + 1}] ${chunk.title}\n${chunk.content}`)
      .join('\n\n');

    const distinctDocs = new Set(result.chunks.map(c => c.docId)).size;

    // Step 3: Generate answer with Azure OpenAI (Chat Completion API)
    console.log('[QA] Generating response with Azure OpenAI...');
    const generationStart = Date.now();

    const systemPrompt = `You are Susie, a proactive virtual Benefits Assistant for AmeriVet.

Core behaviors:
- Be proactive and guide to the next logical step.
- Tone: professional, empathetic, concise.
- Grounding: use only provided context; if unsure, say so and ask for the missing detail.

Identity and eligibility:
- Consider the user's name, age, and location (state/department) before recommending anything.
- If age or location are missing, ask for them first; do not recommend plans until you have them.

Pricing rule (critical):
- Always show costs as: "$X per month ($Y annually)". Never show annual alone.

Flow rules:
- Offer an official recommendation after presenting options.
- After medical, prompt: "Should we look at Dental, Vision, or other benefits next?"
- If user picks HSA/HDHP, suggest Accident and Critical Illness as deductible offset.
- If the question is about age-banded products (Critical Illness, Voluntary Life, Disability) and you lack exact rates, use the safe-path explanation and send them to the enrollment portal for exact deductions.

Content rules:
- Plain text only (no markdown). Short sentences. Use line breaks for readability.
- Be clear if data is missing; never hallucinate plan details.

Goal:
Provide clear, grounded answers that respect the user's state/department context, and keep the conversation moving toward a decision and enrollment.`;

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
    let cleanedAnswer = answer
      .replace(/\*\*/g, '') // Remove bold markers (**)
      .replace(/\*/g, '') // Remove single asterisks
      .replace(/__/g, '') // Remove bold underscores
      .replace(/_/g, '') // Remove single underscores
      .trim();

    // Apply pricing validation
    cleanedAnswer = enforceMonthlyFirstFormat(cleanedAnswer);
    cleanedAnswer = validatePricingFormat(cleanedAnswer);

    // Apply transition logic (Nagging Bot Fix)
    if (shouldAppendTransition(cleanedAnswer, session)) {
      cleanedAnswer += `\n\n${TOPIC_TRANSITION_PROMPT}`;
      session.lastTransitionTurn = session.turn;
      session.context.lastTransitionPromptAt = Date.now();
    }

    session.lastBotMessage = cleanedAnswer;
    updateSession(sessionId, session);

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

    // Phase 3: Update cluster with this new answer for future queries
    if (validation.grounding.ok && validation.grounding.score >= 0.70) {
      console.log('[QA] Updating query cluster with new high-quality answer...');
      try {
        addQueryToClusterSimple(
          query,
          queryVector,
          cleanedAnswer,
          validation.grounding.score,
          {
            docIds: Array.from(new Set(result.chunks.map(c => c.docId))),
            groundingScore: validation.grounding.score,
            validationPassed: validation.grounding.ok,
          }
        );
        console.log('[QA] Cluster updated successfully');
      } catch (clusterError) {
        // Non-fatal: cluster update failure doesn't break response
        console.warn('[QA] Failed to update cluster:', clusterError);
      }
    }

    const totalTime = Date.now() - startTime;

    return NextResponse.json({
      answer: cleanedAnswer,
      tier: 'L1',
      cacheSource: 'miss_with_cluster_update',
      metadata: {
        groundingScore: validation.grounding.score,
        distinctDocIds: distinctDocs,
        rerankedCount: result.chunks.length,
        retrievalTimeMs: retrievalTime,
        generationTimeMs: generationTime,
        validationTimeMs: validationTime,
        totalTimeMs: totalTime,
        clusterUpdated: true,
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
