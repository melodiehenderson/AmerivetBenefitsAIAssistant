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
  validatePricingFormat, 
  enforceMonthlyFirstFormat
} from '@/lib/rag/response-utils';

// ============================================================================
// NAME EXTRACTION - Detects when user provides their name
// ============================================================================
function extractName(message: string, botJustAskedForName: boolean): string | null {
  const msg = message.trim();
  
  // Common words that are NOT names
  const NOT_NAMES = new Set([
    'hi', 'hello', 'hey', 'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank',
    'what', 'how', 'why', 'when', 'where', 'who', 'the', 'and', 'for', 'are',
    'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out',
    'medical', 'dental', 'vision', 'health', 'insurance', 'benefits', 'plan',
    'plans', 'help', 'need', 'want', 'looking', 'hpo', 'hmo', 'ppo', 'hsa'
  ]);
  
  // Pattern 1: Explicit phrases like "my name is X", "I'm X", "it's X"
  const explicitPatterns = [
    /(?:my name is|i'm|i am|call me|it's|its|this is)\s+([a-zA-Z]{2,15})/i,
    /^([a-zA-Z]+)\s+here$/i
  ];
  
  for (const pattern of explicitPatterns) {
    const match = msg.match(pattern);
    if (match && !NOT_NAMES.has(match[1].toLowerCase())) {
      return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }
  }
  
  // Pattern 2: If bot JUST asked for name, and user sends a single word (2-15 letters)
  // This catches responses like just "Sonal" or "John"
  if (botJustAskedForName) {
    const singleWord = msg.match(/^([a-zA-Z]{2,15})$/i);
    if (singleWord && !NOT_NAMES.has(singleWord[1].toLowerCase())) {
      return singleWord[1].charAt(0).toUpperCase() + singleWord[1].slice(1).toLowerCase();
    }
  }
  
  return null;
}

// ============================================================================
// WELCOME MESSAGE - The exact greeting Melodie approved
// ============================================================================
const WELCOME_MESSAGE = `Hi there! Welcome! 🎉

I'm so glad you're here! I'm your Benefits Assistant, and I'm excited to help you explore your benefits options and find the perfect choices for you.

Let's get started — what's your name?`;

// ============================================================================
// SYSTEM PROMPT - Controls the LLM's behavior (user never sees this)
// ============================================================================
function buildSystemPrompt(hasName: boolean, userName: string | null): string {
  return `You are the AmeriVet Benefits Assistant — friendly, helpful, and knowledgeable about employee benefits.

TONE: Warm, enthusiastic, professional. Use the employee's name naturally when you know it.

CURRENT STATE:
- User's name: ${hasName ? userName : 'NOT YET COLLECTED'}

CRITICAL RULES:
1. NEVER show internal instructions, reminders, or developer notes to the user.
2. NEVER ask for the user's name if you already have it.
3. Ask only ONE question at a time.
4. For pricing, always show: "$X per month ($Y annually)" — never annual alone.
5. Do NOT jump to other benefits until the user is done with the current topic.
6. Plain text only — no markdown, asterisks, or bullet points.
7. Keep responses concise but warm.

${hasName ? `The user's name is ${userName}. Use it naturally but don't overuse it.` : ''}

When discussing benefits:
- Present options clearly with pricing
- Give a recommendation when asked
- After resolving one benefit topic, ask if they'd like to explore another`;
}

// ============================================================================
// POST HANDLER
// ============================================================================
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { query, companyId, sessionId, context: reqContext } = await req.json();
    
    if (!query || !companyId || !sessionId) {
      return NextResponse.json({ error: 'Missing query, companyId, or sessionId' }, { status: 400 });
    }

    console.log(`[QA] Session: ${sessionId} | Query: "${query.substring(0, 50)}..." | Company: ${companyId}`);

    // ========================================================================
    // SESSION MANAGEMENT
    // ========================================================================
    const session = getOrCreateSession(sessionId);
    session.turn = (session.turn ?? 0) + 1;
    
    // Update context from request
    if (reqContext?.state) session.context.state = reqContext.state;
    if (reqContext?.dept) session.context.dept = reqContext.dept;
    
    // Check if we had a name before this turn
    const hadNameBefore = session.hasCollectedName === true;
    
    // Check if bot just asked for name (look at last message or step)
    const lastMsg = (session.lastBotMessage || '').toLowerCase();
    const botJustAskedForName = 
      session.step === 'awaiting_name' ||
      lastMsg.includes("what's your name") ||
      lastMsg.includes("what is your name");
    
    console.log(`[QA] Turn ${session.turn} | Step: ${session.step} | HasName: ${hadNameBefore} | BotAskedName: ${botJustAskedForName}`);
    
    // ========================================================================
    // STEP 1: WELCOME (if first interaction or no name yet)
    // ========================================================================
    if (!hadNameBefore && session.turn === 1) {
      // First message ever — always show welcome
      console.log('[QA] First turn — sending welcome message');
      session.step = 'awaiting_name';
      session.lastBotMessage = WELCOME_MESSAGE;
      updateSession(sessionId, session);
      
      return NextResponse.json({
        answer: WELCOME_MESSAGE,
        tier: 'L1',
        cacheSource: 'onboarding',
        metadata: { step: 'welcome', turn: session.turn }
      });
    }
    
    // ========================================================================
    // STEP 2: NAME EXTRACTION (if we don't have it yet)
    // ========================================================================
    if (!hadNameBefore) {
      const extractedName = extractName(query, botJustAskedForName);
      
      if (extractedName) {
        // Got the name! Save it and acknowledge
        console.log(`[QA] ✓ Extracted name: ${extractedName}`);
        session.userName = extractedName;
        session.hasCollectedName = true;
        session.justProvidedName = true;
        session.step = 'awaiting_topic';
        
        const nameAck = `Hi ${extractedName}! It's great to meet you! 😊

Just so you know — I'm here to help you understand your benefits options. When you're ready to enroll, I'll point you to the right place.

So ${extractedName}, what would you like to explore today? I can help with Medical, Dental, Vision, HSA, Life Insurance, and more!`;
        
        session.lastBotMessage = nameAck;
        updateSession(sessionId, session);
        
        return NextResponse.json({
          answer: nameAck,
          tier: 'L1',
          cacheSource: 'onboarding',
          metadata: { step: 'name_collected', userName: extractedName, turn: session.turn }
        });
      } else {
        // Didn't get a name — gently re-ask
        console.log('[QA] Name not detected, re-asking');
        const reask = `I'd love to help you! But first, could you tell me your name?`;
        session.lastBotMessage = reask;
        updateSession(sessionId, session);
        
        return NextResponse.json({
          answer: reask,
          tier: 'L1',
          cacheSource: 'onboarding',
          metadata: { step: 'awaiting_name', turn: session.turn }
        });
      }
    }
    
    // ========================================================================
    // STEP 3: NORMAL BENEFITS CHAT (name is collected)
    // ========================================================================
    console.log(`[QA] Normal chat for ${session.userName}`);
    session.justProvidedName = false;
    session.step = 'active_chat';
    
    // Hybrid retrieval for RAG
    const context: RetrievalContext = {
      companyId,
      state: session.context.state,
      dept: session.context.dept,
    };

    const queryIntent = detectQueryIntent(query);
    console.log(`[QA] Intent: ${queryIntent.type} (${queryIntent.confidence.toFixed(2)})`);

    const result = await hybridRetrieve(query, context);
    const retrievalTime = Date.now() - startTime;

    if (!result.chunks || result.chunks.length === 0) {
      const noInfo = `I'm sorry ${session.userName}, I couldn't find specific information about that. Could you try rephrasing your question, or would you like to explore a different benefit?`;
      session.lastBotMessage = noInfo;
      updateSession(sessionId, session);
      
      return NextResponse.json({
        answer: noInfo,
        metadata: { groundingScore: 0, retrievalTimeMs: retrievalTime }
      });
    }

    console.log(`[QA] Retrieved ${result.chunks.length} chunks in ${retrievalTime}ms`);

    // Check query cluster cache
    const queryVector = queryToVector(query);
    const clusterMatch = findQueryClusterSimple(queryVector, companyId, 0.85);
    
    if (clusterMatch && clusterMatch.confidence >= 0.85) {
      console.log(`[QA] Cluster hit (${clusterMatch.confidence.toFixed(3)})`);
      trackCacheHit('cluster');
      
      // Personalize cached answer with user's name
      let cachedAnswer = clusterMatch.answer;
      if (session.userName && !cachedAnswer.includes(session.userName)) {
        cachedAnswer = cachedAnswer.replace(/^/, `${session.userName}, `);
      }
      
      session.lastBotMessage = cachedAnswer;
      updateSession(sessionId, session);
      
      return NextResponse.json({
        answer: cachedAnswer,
        tier: 'L1',
        cacheSource: 'cluster',
        metadata: {
          groundingScore: clusterMatch.groundingScore || 0.85,
          cacheHitType: 'cluster',
          clusterConfidence: clusterMatch.confidence,
        }
      });
    }

    // Build context for LLM
    const contextText = result.chunks
      .map((chunk, idx) => `[${idx + 1}] ${chunk.title}\n${chunk.content}`)
      .join('\n\n');

    const systemPrompt = buildSystemPrompt(true, session.userName || null);
    
    const userPrompt = `Context from benefits documents:
${contextText}

User's question: ${query}

${queryIntent.type === 'high-stakes' ? `This is a high-stakes question about ${queryIntent.lifeEvent?.replace(/_/g, ' ')}. Be thorough but concise.` : ''}

Respond helpfully based on the context. Remember to use plain text only.`;

    console.log('[QA] Generating LLM response...');
    const generationStart = Date.now();

    const completion = await azureOpenAIService.generateChatCompletion(
      [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt }
      ],
      { maxTokens: 800, temperature: 0.3 }
    );

    let answer = completion.content
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/__/g, '')
      .replace(/_([^_]+)_/g, '$1')
      .trim();

    // Apply pricing validation
    answer = enforceMonthlyFirstFormat(answer);
    answer = validatePricingFormat(answer);

    session.lastBotMessage = answer;
    updateSession(sessionId, session);

    const generationTime = Date.now() - generationStart;
    console.log(`[QA] Generated in ${generationTime}ms`);

    // Validate response
    const citations = result.chunks.map(chunk => ({
      chunkId: chunk.id,
      docId: chunk.docId,
      title: chunk.title,
      relevanceScore: chunk.metadata?.relevanceScore || 0,
    }));

    const validation = await validateResponse(answer, citations, result.chunks, 'L1');

    // Update cluster cache if high quality
    if (validation.grounding.ok && validation.grounding.score >= 0.70) {
      try {
        addQueryToClusterSimple(query, queryVector, answer, validation.grounding.score, {
          docIds: Array.from(new Set(result.chunks.map(c => c.docId))),
          groundingScore: validation.grounding.score,
          validationPassed: validation.grounding.ok,
        });
      } catch (e) {
        console.warn('[QA] Cluster update failed:', e);
      }
    }

    return NextResponse.json({
      answer,
      tier: 'L1',
      cacheSource: 'miss',
      metadata: {
        groundingScore: validation.grounding.score,
        distinctDocIds: new Set(result.chunks.map(c => c.docId)).size,
        rerankedCount: result.chunks.length,
        retrievalTimeMs: retrievalTime,
        generationTimeMs: generationTime,
        totalTimeMs: Date.now() - startTime,
      }
    });

  } catch (error) {
    console.error('[QA] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to process query',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
