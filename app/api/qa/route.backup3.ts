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

export const dynamic = 'force-dynamic';

// ============================================================================
// 1. HELPER: Name Extraction
// ============================================================================
function extractName(msg: string, botJustAskedForName: boolean): string | null {
  const NOT_NAMES = new Set([
    'hello', 'hi', 'hey', 'yes', 'no', 'ok', 'thanks', 'please', 'sure',
    'medical', 'dental', 'vision', 'health', 'insurance', 'benefits', 'plan',
    'plans', 'help', 'need', 'want', 'looking', 'hpo', 'hmo', 'ppo', 'hsa'
  ]);
  
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
  
  if (botJustAskedForName) {
    const cleanMsg = msg.trim().replace(/[^\w\s]/gi, '');
    const words = cleanMsg.split(/\s+/);
    if (words.length <= 2 && !NOT_NAMES.has(words[0].toLowerCase())) {
       return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
    }
  }
  return null;
}

// ============================================================================
// 2. SYSTEM PROMPT
// ============================================================================
function buildSystemPrompt(hasName: boolean, userName: string | null): string {
  return `You are the AmeriVet Benefits Assistant.

=== INTERNAL RULES (DO NOT OUTPUT THESE) ===
1. **MEMORY:** Use the [DEVELOPER CONTEXT]. If 'Age' or 'State' is known, DO NOT ask for them.
2. **FOCUS:** Stay on the current topic. Do not offer "Dental/Vision" if the user is still asking about "Medical".
3. **PRICING:** Format exactly as: "$X per month ($Y annually)". NEVER say "approximately".
4. **NO LEAKS:** Do not output text starting with "Reminder:", "Note:", or "Instruction:".

=== TONE ===
Warm, professional, and concise.
${hasName ? `Address the user as ${userName} naturally.` : ''}`;
}

// ============================================================================
// 3. ROUTE HANDLER
// ============================================================================
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await req.json();
    const { query, companyId, sessionId, context: reqContext } = body;
    
    if (!query || !sessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ------------------------------------------------------------------------
    // Session Retrieval
    // ------------------------------------------------------------------------
    const session = getOrCreateSession(sessionId);
    session.turn = (session.turn ?? 0) + 1;

    // Metadata Extraction (Always runs)
    const ageMatch = query.match(/\b([1-9][0-9])\b/);
    if (ageMatch) {
       const age = parseInt(ageMatch[1]);
       if (age >= 18 && age <= 99) session.userAge = age;
    }
    const stateMatch = query.match(/\b(WA|OR|CA|TX|FL|NY|OH|IL|PA|GA|NC|MI|NJ|VA)\b/i);
    if (stateMatch) session.userState = stateMatch[1].toUpperCase();

    // ------------------------------------------------------------------------
    // ONBOARDING LOGIC (With "Medical" Bypass)
    // ------------------------------------------------------------------------
    if (!session.hasCollectedName) {
      
      // 1. BYPASS CHECK: Is the user asking about a topic?
      // If they say "Medical", "Dental", "Vision", they are clearly NOT trying to tell us their name.
      // We assume we missed the name or they are a returning user, and let them proceed.
      const isTopicSelection = /medical|dental|vision|life|disability|hsa|ppo|hmo|coverage|plan/i.test(query);
      
      if (isTopicSelection) {
         session.hasCollectedName = true;
         session.step = 'active_chat';
         // We might not know their name, so we default to generic.
         if (!session.userName) session.userName = "Guest";
         updateSession(sessionId, session);
         
         // FALL THROUGH TO RAG (Do not return yet)
      } 
      else {
          // 2. Normal Onboarding (Name Check)
          const lastMsg = session.lastBotMessage?.toLowerCase() || "";
          const botAskedForName = lastMsg.includes("what's your name") || lastMsg.includes("your name");
          
          const name = extractName(query, botAskedForName || session.turn === 1);
          
          if (name) {
            session.userName = name;
            session.hasCollectedName = true;
            session.step = 'active_chat';
            
            const response = `Thanks, ${name}! It's great to meet you. 😊\n\nJust a quick note: I'm here to help you understand your benefits, but you'll need to log into the official portal to actually enroll.\n\nSo, what can I help you with today? I can answer questions about Medical, Dental, Vision, and more!`;
            
            session.lastBotMessage = response;
            updateSession(sessionId, session);
            return NextResponse.json({ answer: response, tier: 'L1' });
          } else {
            // Force Welcome
            const welcome = `Hi there! Welcome! 🎉\n\nI'm your AmeriVet Benefits Assistant. I'm here to help you compare plans and find the right fit.\n\nLet's get started — what's your name?`;
            
            session.lastBotMessage = welcome;
            updateSession(sessionId, session);
            return NextResponse.json({ answer: welcome, tier: 'L1' });
          }
      }
    }
    }

    if (reqContext) {
      session.context = { ...session.context, ...reqContext };
    }

    // ========================================================================
    // ONBOARDING FLOW (Behavioral Logic)
    // ========================================================================
    
    // Check if we just asked for a name
    let botJustAskedForName = false;
    if (session.step === 'awaiting_name' || session.turn === 1) {
      botJustAskedForName = true;
    } else if (session.lastBotMessage) {
      const lastMsg = session.lastBotMessage.toLowerCase();
      botJustAskedForName = lastMsg.includes("what's your name") || lastMsg.includes("your name");
    }

    // Bug Fix: If we have name but flag is false, fix it
    if (session.userName && !session.hasCollectedName) {
       console.log(`[QA] FIXING: Found userName but hasCollectedName=false`);
       session.hasCollectedName = true;
       session.step = 'active_chat';
       updateSession(sessionId, session);
    }

    console.log(`[QA] AFTER BUG FIX: hasCollectedName=${session.hasCollectedName}, userName=${session.userName}`);

    // If still no name, run onboarding
    if (!session.hasCollectedName) {
      console.log(`[QA] ONBOARDING: No name collected, running onboarding flow`);
      const extractedName = extractName(query, botJustAskedForName || session.turn > 1);
      
      if (extractedName) {
        session.userName = extractedName;
        session.hasCollectedName = true;
        session.step = 'awaiting_topic';
        
        console.log(`[QA] NAME EXTRACTED: ${extractedName}, saving session...`);
        updateSession(sessionId, session);
        console.log(`[QA] Session saved. Verifying: hasCollectedName=${session.hasCollectedName}`);
        
        const nameAck = `Hi ${extractedName}! It's great to meet you! 😊

Just so you know — I'm here to help you understand your benefits options. When you're ready to enroll, I'll point you to the right place.

So ${extractedName}, what would you like to explore today? I can help with Medical, Dental, Vision, HSA, Life Insurance, and more!`;
        
        session.lastBotMessage = nameAck;
        updateSession(sessionId, session);
        
        return NextResponse.json({
          answer: nameAck,
          tier: 'L1',
          cacheSource: 'onboarding',
          metadata: { step: 'name_collected', userName: extractedName }
        });
      } else {
        const welcomeMsg = `Hi there! Welcome! 🎉

I'm so glad you're here! I'm your Benefits Assistant, and I'm excited to help you explore your benefits options and find the perfect choices for you.

Let's get started — what's your name?`;
        
        session.step = 'awaiting_name';
        session.lastBotMessage = welcomeMsg;
        updateSession(sessionId, session);
        
        return NextResponse.json({
          answer: welcomeMsg,
          tier: 'L1',
          cacheSource: 'onboarding',
          metadata: { step: 'awaiting_name', turn: session.turn }
        });
      }
    }

    console.log(`[QA] PROCEEDING TO RAG: hasCollectedName=${session.hasCollectedName}, userName=${session.userName}`);

    // ========================================================================
    // METADATA EXTRACTION (The Memory Fix)
    // ========================================================================
    session.step = 'active_chat';
    
    // Extract Age
    if (!session.userAge) {
      const ageMatch = query.match(/\b([1-9][0-9])\b/);
      if (ageMatch) {
        const age = parseInt(ageMatch[1]);
        if (age >= 18 && age <= 99) session.userAge = age;
      }
    }
    
    // Extract State
    if (!session.userState) {
      const stateMatch = query.match(/\b(WA|OR|CA|TX|FL|NY|OH|PA|VA|NC|SC|GA|AL|MI|IL|IN|WI|MN|IA|MO|AR|LA|MS|TN|KY|WV|MD|DE|NJ|CT|RI|MA|VT|NH|ME|AK|HI|NV|UT|CO|WY|MT|ND|SD|NE|KS|OK|NM|AZ|ID)\b/i);
      if (stateMatch) session.userState = stateMatch[1];
    }
    
    updateSession(sessionId, session);

    // ========================================================================
    // RAG RETRIEVAL (The Ferrari Pipeline)
    // ========================================================================
    const context: RetrievalContext = {
      companyId,
      state: session.context.state,
      dept: session.context.dept,
    };

    const queryIntent = detectQueryIntent(query);
    const result = await hybridRetrieve(query, context);
    const retrievalTime = Date.now() - startTime;

    if (!result.chunks || result.chunks.length === 0) {
      const noInfo = `I'm sorry ${session.userName}, I couldn't find specific information about that. Could you try rephrasing your question?`;
      session.lastBotMessage = noInfo;
      updateSession(sessionId, session);
      
      return NextResponse.json({
        answer: noInfo,
        metadata: { groundingScore: 0, retrievalTimeMs: retrievalTime }
      });
    }

    const contextText = result.chunks
      .map((chunk, idx) => `[${idx + 1}] ${chunk.title}\n${chunk.content}`)
      .join('\n\n');

    // ========================================================================
    // CACHE & LLM GENERATION
    // ========================================================================
    const queryVector = queryToVector(query);
    const clusterMatch = findQueryClusterSimple(queryVector, companyId, 0.85);
    
    if (clusterMatch && clusterMatch.confidence >= 0.85) {
      trackCacheHit('cluster');
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
        metadata: { groundingScore: 0.85 }
      });
    }

    const systemPrompt = buildSystemPrompt(!!session.userName, session.userName || null);
    
    const developerContext = `[DEVELOPER CONTEXT - USER MEMORY]
- User Name: ${session.userName || "Unknown"}
- User Age: ${session.userAge || "Missing"}
- User State: ${session.userState || "Missing"}
- Current Topic: ${session.currentTopic || "General"}

CRITICAL MEMORY RULES:
- If Age is NOT "Missing", DO NOT ask for age
- If State is NOT "Missing", DO NOT ask for state
- Stay focused on Current Topic until resolved`;
    
    const userPrompt = `Context from benefits documents:
${contextText}

User's question: ${query}

${queryIntent.type === 'high-stakes' ? `High-stakes scenario: ${queryIntent.lifeEvent?.replace(/_/g, ' ')}` : ''}

Respond based on context and follow memory rules.`;

    const completion = await azureOpenAIService.generateChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: developerContext },
        { role: 'user', content: userPrompt }
      ],
      { maxTokens: 800, temperature: 0.1 }
    );

    let answer = completion.content
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .trim();

    answer = enforceMonthlyFirstFormat(answer);
    answer = validatePricingFormat(answer);

    session.lastBotMessage = answer;
    updateSession(sessionId, session);

    // ========================================================================
    // CACHE UPDATE
    // ========================================================================
    const citations = result.chunks.map(chunk => ({
      chunkId: chunk.id,
      docId: chunk.docId,
      title: chunk.title,
      relevanceScore: chunk.metadata?.relevanceScore || 0,
    }));

    const validation = await validateResponse(answer, citations, result.chunks, 'L1');

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
        retrievalTimeMs: retrievalTime,
        generationTimeMs: Date.now() - startTime,
      }
    });

  } catch (error) {
    console.error("Error in QA Route:", error);
    return NextResponse.json({ 
      error: "Internal Server Error", 
      details: error instanceof Error ? error.message : "Unknown" 
    }, { status: 500 });
  }
}