import { NextRequest, NextResponse } from 'next/server';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import { validateResponse } from '@/lib/rag/validation';
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
      // Pass sessionId to retrieval for chat history awareness
      sessionId,
    };

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

    const systemPrompt = `You are an expert benefits advisor and healthcare specialist. Provide authoritative, comprehensive answers based on the provided context.

Key guidelines:
- Answer with confidence and clarity based on the provided information
- Include specific examples and real-world scenarios when relevant
- Explain the "why" behind benefit features and policies
- Provide actionable recommendations based on the context
- Use plain, conversational language - no asterisks or markdown formatting
- Do NOT include citations or reference numbers
- If information is incomplete, acknowledge it and provide what you do know

When answering:
1. Start with a direct answer to the question
2. Add relevant details and context
3. Include 1-2 practical examples if applicable
4. End with clear takeaways or recommendations`;

    const userPrompt = `Context:
${contextText}

Question: ${query}

Provide a clear, concise answer based on the context above.`;

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

    const validation = await validateResponse(answer, citations, result.chunks, 'L1');
    const validationTime = Date.now() - validationStart;

    console.log(`[QA] Validation complete: grounding=${validation.grounding.score.toFixed(2)}, valid=${validation.grounding.ok}`);

    const totalTime = Date.now() - startTime;

    return NextResponse.json({
      answer,
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
