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

    // ------------------------------------------------------------------------
    // RAG PIPELINE (High Precision)
    // ------------------------------------------------------------------------
    const context: RetrievalContext = {
      companyId,
      state: session.userState || session.context?.state,
      dept: session.context?.dept,
    };

    const result = await hybridRetrieve(query, context);
    
    if (!result.chunks || result.chunks.length === 0) {
      const fallback = `I'm sorry ${session.userName !== "Guest" ? session.userName : ""}, I couldn't find specific details about that. Could you try asking differently?`;
      session.lastBotMessage = fallback;
      updateSession(sessionId, session);
      return NextResponse.json({ answer: fallback });
    }

    const contextText = result.chunks
      .map((c, i) => `[${i+1}] ${c.content}`)
      .join('\n\n');

    const systemPrompt = buildSystemPrompt(session.userName !== "Guest", session.userName);
    const memoryContext = `[DEVELOPER CONTEXT]
    - User: ${session.userName}
    - Age: ${session.userAge || "Unknown"}
    - State: ${session.userState || "Unknown"}
    
    INSTRUCTION: If Age/State is known, DO NOT ask for it again. Answer the user's question based on the context below.`;

    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'system', content: memoryContext },
      { role: 'user', content: `Context:\n${contextText}\n\nQuestion: ${query}` }
    ], { temperature: 0.1 });

    let answer = completion.content.trim();
    answer = enforceMonthlyFirstFormat(answer);
    answer = validatePricingFormat(answer);

    session.lastBotMessage = answer;
    updateSession(sessionId, session);

    return NextResponse.json({
      answer,
      tier: 'L1',
      citations: result.chunks
    });

  } catch (error) {
    console.error('[QA] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}