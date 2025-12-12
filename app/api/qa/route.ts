import { NextRequest, NextResponse } from 'next/server';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import { validateResponse } from '@/lib/rag/validation';
import type { RetrievalContext } from '@/types/rag';
import { trackCacheHit } from '@/lib/rag/observability';
import { getOrCreateSession, updateSession } from '@/lib/rag/session-store';
import { 
  validatePricingFormat, 
  enforceMonthlyFirstFormat
} from '@/lib/rag/response-utils';

export const dynamic = 'force-dynamic';

// ============================================================================
// 1. THE BRAIN: Intent Classification
// ============================================================================
function classifyInput(msg: string) {
  const clean = msg.toLowerCase().trim();
  
  // A. Continuation (The "Go Ahead" Fix)
  const isContinuation = /^(ok|okay|go ahead|sure|yes|yep|yeah|please|continue|next|right|correct|proceed)$/i.test(clean);
  
  // B. Topic Jump (The "Medical" Fix)
  const isTopic = /medical|dental|vision|life|disability|hsa|ppo|hmo|coverage|plan|benefits|enroll/i.test(clean);
  
  // C. Demographics ("42 in WA")
  const hasAge = /\b([1-9][0-9])\b/.test(clean);
  const hasState = /\b(wa|or|ca|tx|fl|ny|oh|il|pa|ga|nc|mi|nj|va|washington|oregon|california)\b/i.test(clean);
  const isDemographics = hasAge || hasState;

  return { isContinuation, isTopic, isDemographics, hasAge, hasState };
}

function extractName(msg: string): string | null {
  const NOT_NAMES = new Set(['hello', 'hi', 'medical', 'dental', 'vision', 'help', 'benefits']);
  
  // 1. Explicit: "My name is Sonal"
  const match = msg.match(/(?:name is|i'm|i am|call me)\s+([a-zA-Z]{2,15})/i);
  if (match && !NOT_NAMES.has(match[1].toLowerCase())) return match[1];

  // 2. Implicit: Single word that looks like a name
  const words = msg.trim().split(/\s+/);
  if (words.length <= 2 && !NOT_NAMES.has(words[0].toLowerCase()) && /^[a-zA-Z]+$/.test(words[0])) {
    return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  }
  return null;
}

// ============================================================================
// 2. SYSTEM PROMPT (The Personality)
// ============================================================================
function buildSystemPrompt(session: any): string {
  return `You are the AmeriVet Benefits Assistant.

=== CONTEXT ===
User: ${session.userName || "Guest"}
Age: ${session.userAge || "Unknown"}
State: ${session.userState || "Unknown"}

=== RULES ===
1. **MEMORY:** You know the user's Age and State. DO NOT ask for them again.
2. **PERSISTENCE:** If the user says "go ahead" or "continue", proceed with the previous topic.
3. **PRICING:** Format exactly as "$X per month ($Y annually)".
4. **NO LOOPS:** Do not restart the welcome script.

${session.lastBotMessage ? `PREVIOUSLY YOU SAID: "${session.lastBotMessage}"` : ''}`;
}

// ============================================================================
// 3. MAIN LOGIC CONTROLLER
// ============================================================================
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await req.json();
    const { query, companyId, sessionId } = body;
    
    if (!query || !sessionId) return NextResponse.json({ error: 'Missing inputs' }, { status: 400 });

    const session = getOrCreateSession(sessionId);
    session.turn = (session.turn ?? 0) + 1;
    
    // 1. ANALYZE INTENT (The "Mindful" Step)
    const intent = classifyInput(query);
    
    // 2. SELF-HEALING (Fixing the "Go Ahead" Crash)
    // If we are 'lost' (no name) but the user implies continuity, we auto-recover.
    if (!session.hasCollectedName && (intent.isContinuation || intent.isTopic || intent.isDemographics)) {
       session.userName = "Guest";
       session.hasCollectedName = true;
       session.step = 'active_chat';
    }

    // 3. DATA EXTRACTION (The "Memory" Step)
    if (intent.hasAge) session.userAge = parseInt(query.match(/\b([1-9][0-9])\b/)![1]);
    if (intent.hasState) session.userState = query.match(/\b(wa|or|ca|tx|fl|ny|oh|il|pa|ga|nc|mi|nj|va)\b/i)![1].toUpperCase();
    
    // If we just got the data we were waiting for, move state forward
    if (session.step === 'awaiting_demographics' && (session.userAge || session.userState)) {
        session.step = 'active_chat';
    }

    // ========================================================================
    // STATE MACHINE (The "Intuitive" Logic)
    // ========================================================================

    // PHASE 1: GET NAME
    if (!session.hasCollectedName) {
        const name = extractName(query);
        if (name) {
            session.userName = name;
            session.hasCollectedName = true;
            session.step = 'awaiting_demographics';
            const msg = `Thanks, ${name}! To give you accurate pricing, could you share your **Age** and **State**?`;
            
            session.lastBotMessage = msg;
            updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L1' });
        } else {
            const msg = `Hi! I'm your AmeriVet Benefits Assistant. Let's get started — what's your name?`;
            session.lastBotMessage = msg;
            updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L1' });
        }
    }

    // PHASE 2: GET DEMOGRAPHICS (The Gate)
    // We only block if we truly have nothing AND the user isn't just saying "ok/go ahead"
    if ((!session.userAge || !session.userState) && !intent.isContinuation) {
        // Did they just provide it?
        if (intent.isDemographics) {
             session.step = 'active_chat'; 
             // If query was ONLY data ("42 in WA"), confirm it.
             if (query.length < 30) {
                 const msg = `Got it! ${session.userAge} in ${session.userState}. What can I help you with? (Medical, Dental, Vision?)`;
                 session.lastBotMessage = msg;
                 updateSession(sessionId, session);
                 return NextResponse.json({ answer: msg, tier: 'L1' });
             }
        } else {
             // Still missing.
             const msg = `To check specific plans for you, I need your **Age** and **State** (e.g., "I'm 42 in WA").`;
             session.lastBotMessage = msg;
             updateSession(sessionId, session);
             return NextResponse.json({ answer: msg, tier: 'L1' });
        }
    }

    // PHASE 3: THE BRAIN (RAG)
    const context: RetrievalContext = {
      companyId,
      state: session.userState, 
      dept: session.context?.dept,
    };

    const result = await hybridRetrieve(query, context);
    
    // Fallback if RAG fails
    if (!result.chunks?.length) {
        // If user said "Go ahead" and we have no context, ask for a topic
        if (intent.isContinuation) {
            const msg = `I'm ready! What topic should we cover? (Medical, Dental, Vision?)`;
            return NextResponse.json({ answer: msg });
        }
        return NextResponse.json({ answer: "I couldn't find specific details on that. Could you clarify which benefit you're asking about?" });
    }

    const contextText = result.chunks.map((c, i) => `[${i+1}] ${c.content}`).join('\n\n');
    const systemPrompt = buildSystemPrompt(session);
    
    // Inject Memory into the AI so it acts "Mindful"
    const finalPrompt = `CONTEXT:\n${contextText}\n\nUSER QUERY: ${query}\n\nINSTRUCTION: Answer using the context. Be concise.`;

    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: finalPrompt }
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

    // ------------------------------------------------------------------------
    // B. "YES PLEASE" LOOP FIX
    // ------------------------------------------------------------------------
    // If the user says "yes", "sure", "please" and we don't have a name, 
    // we assume we lost the session state but they are deep in chat.
    // We auto-recover by setting a Guest name so they don't get the Welcome Loop.
    const isContinuation = /^(yes|sure|ok|please|yep|yeah|right|correct)/i.test(query);
    if (!session.hasCollectedName && isContinuation) {
        session.userName = "Guest";
        session.hasCollectedName = true;
        session.step = 'active_chat';
    }

    // ------------------------------------------------------------------------
    // C. STEP 1: NAME COLLECTION
    // ------------------------------------------------------------------------
    if (!session.hasCollectedName) {
        // 1. Check if user provided name
        const lastMsg = session.lastBotMessage?.toLowerCase() || "";
        const botAskedForName = lastMsg.includes("what's your name") || lastMsg.includes("your name");
        const name = extractName(query, botAskedForName || session.turn === 1);

        if (name) {
            session.userName = name;
            session.hasCollectedName = true;
            // UPDATE: Don't go to active_chat yet. Go to Step 2.
            session.step = 'awaiting_demographics';
            
            const response = `Thanks, ${name}! It's great to meet you. 😊\n\nTo help me find the best plans for *you*, I just need two quick details:\n\n**What is your Age and State?**`;
            
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

    // ------------------------------------------------------------------------
    // D. STEP 2: DEMOGRAPHICS COLLECTION (High Precision Gate)
    // ------------------------------------------------------------------------
    // We strictly require Age and State for accurate pricing.
    // We ask for it IF:
    // 1. We don't have it yet AND
    // 2. The user isn't just saying "Hi" or "Thanks" (intent check) AND
    // 3. The user isn't asking a generic definition question (e.g. "What is a PPO?")
    
    const hasDemographics = session.userAge && session.userState;
    const isGenericQuestion = query.toLowerCase().includes("what is") || query.toLowerCase().includes("define") || query.toLowerCase().includes("explain");
    
    if (!hasDemographics && !isGenericQuestion) {
        
        // Did they just provide it in this turn? (Metadata extraction ran above)
        if (session.userAge && session.userState) {
            // YES! They gave it. Transition to help.
            session.step = 'active_chat';
            
            // If they ONLY gave data ("I'm 42 in WA"), confirm receipt.
            const isDataOnly = query.length < 50 && !query.includes("?");
            if (isDataOnly) {
                const readyMsg = `Got it! ${session.userAge} in ${session.userState}. Thanks!\n\nNow I can give you accurate pricing and eligibility.\n\nWhat would you like to look at first? (Medical, Dental, Vision, Life?)`;
                session.lastBotMessage = readyMsg;
                updateSession(sessionId, session);
                return NextResponse.json({ answer: readyMsg, tier: 'L1' });
            }
            // If they asked a question too ("I'm 42 in WA, what's the PPO cost?"), FALL THROUGH to RAG.
        } else {
            // NO. We are missing data. We MUST interrupt to get it.
            // This ensures we never give a generic answer when a specific one is needed.
            const ask = `Thanks ${session.userName}. To check your specific eligibility and costs, I need to know your **Age** and **State** (e.g., "42 in Washington").`;
            session.lastBotMessage = ask;
            updateSession(sessionId, session);
            return NextResponse.json({ answer: ask, tier: 'L1' });
        }
    }

    // ------------------------------------------------------------------------
    // E. STEP 3: RAG PIPELINE (High Precision)
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
    const memoryContext = `[DEVELOPER CONTEXT - USER PROFILE]
    - User: ${session.userName}
    - Age: ${session.userAge || "Unknown"}
    - State: ${session.userState || "Unknown"}
    - Turn: ${session.turn}
    
    CRITICAL INSTRUCTIONS:
    1. If Age/State is known, DO NOT ask for it again
    2. Use their age and state for personalized recommendations
    3. Mention specific costs for their state when available
    4. ${session.userAge && session.userAge < 30 ? 'Focus on affordable options for young adults' : session.userAge && session.userAge > 50 ? 'Highlight comprehensive coverage for mature adults' : 'Provide balanced coverage options'}
    5. Always be specific with pricing in "$X per month ($Y annually)" format`;

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