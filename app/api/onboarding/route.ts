import { NextRequest, NextResponse } from 'next/server';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import type { RetrievalContext } from '@/types/rag';
import { getOrCreateSession, updateSession } from '@/lib/rag/session-store';
import { 
  validatePricingFormat, 
  enforceMonthlyFirstFormat
} from '@/lib/rag/response-utils';

export const dynamic = 'force-dynamic';

// ============================================================================
// 1. THE BRAIN: Intent Classification
// ============================================================================
const ONBOARDING_STATE_NAME_TO_CODE: Record<string, string> = {
  'washington': 'WA',
  'oregon': 'OR',
  'california': 'CA',
  'texas': 'TX',
  'florida': 'FL',
  'new york': 'NY',
  'ohio': 'OH',
};

const ONBOARDING_STATE_CODES = new Set([
  'WA', 'OR', 'CA', 'TX', 'FL', 'NY', 'OH', 'IL', 'PA', 'GA', 'NC', 'MI', 'NJ', 'VA',
]);

function extractStateCode(msg: string, hasAge: boolean): { code: string | null; token: string | null } {
  const original = msg.trim();
  const lower = original.toLowerCase();

  // Prefer full names first
  let bestName: string | null = null;
  for (const name of Object.keys(ONBOARDING_STATE_NAME_TO_CODE)) {
    if (!lower.includes(name)) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(original)) {
      if (!bestName || name.length > bestName.length) bestName = name;
    }
  }
  if (bestName) return { code: ONBOARDING_STATE_NAME_TO_CODE[bestName], token: bestName };

  const hasLocationCue = /\b(in|from|live|located|state)\b/i.test(original);
  const agePlusState = original.match(/\b(1[8-9]|[2-9][0-9])\b\s*[,\-\/\s]+\s*([A-Za-z]{2})\b/);
  const adjacent = (agePlusState?.[2] || null)?.trim();

  const rawTokens = original.split(/[\s,.;:()\[\]{}<>"']+/).filter(Boolean);
  for (const raw of rawTokens) {
    const cleaned = raw.replace(/[^A-Za-z]/g, '');
    if (cleaned.length !== 2) continue;

    const upper = cleaned.toUpperCase();
    if (!ONBOARDING_STATE_CODES.has(upper)) continue;

    const lower2 = cleaned.toLowerCase();
    const ambiguousCode = lower2 === 'or' || lower2 === 'in';
    const isUpperInOriginal = cleaned === upper;
    const isAdjacentToAge = adjacent ? adjacent.toLowerCase() === lower2 : false;

    // Avoid treating conjunctions/prepositions as states unless the user is clearly providing location.
    if (ambiguousCode && !isUpperInOriginal && !hasLocationCue && !hasAge && !isAdjacentToAge) continue;

    if (isUpperInOriginal || isAdjacentToAge || hasLocationCue || hasAge) {
      return { code: upper, token: cleaned };
    }
  }

  return { code: null, token: null };
}

function classifyInput(msg: string) {
  const clean = msg.toLowerCase().trim();
  
  // A. Continuation ("Go ahead", "Sure", "Okay")
  const isContinuation = /^(ok|okay|go ahead|sure|yes|yep|yeah|please|continue|next|right|correct|proceed|got it)$/i.test(clean);
  
  // B. Topic Jump ("Medical", "Dental", "Enroll")
  const isTopic = /medical|dental|vision|life|disability|hsa|ppo|hmo|coverage|plan|benefits|enroll|cost|price/i.test(clean);
  
  // C. Demographics ("25 in WA", "California", "Age 40")
  // Broader regex to catch "25 and in california"
  const hasAge = /\b(1[8-9]|[2-9][0-9])\b/.test(clean); 
  const extractedState = extractStateCode(msg, hasAge);
  const hasState = !!extractedState.code;
  const isDemographics = hasAge || hasState;

  return { isContinuation, isTopic, isDemographics, hasAge, hasState, stateCode: extractedState.code };
}

// Smart Name Extractor
function extractName(msg: string): string | null {
  const NOT_NAMES = new Set(['hello', 'hi', 'medical', 'dental', 'vision', 'help', 'benefits', 'insurance', 'quote', 'cost']);
  
  // 1. Explicit: "My name is Sonal"
  const match = msg.match(/(?:name is|i'm|i am|call me)\s+([a-zA-Z]{2,15})/i);
  if (match && !NOT_NAMES.has(match[1].toLowerCase())) return match[1];

  // 2. Implicit: Single word that looks like a name ("Sonal")
  const words = msg.trim().split(/\s+/);
  if (words.length <= 2 && !NOT_NAMES.has(words[0].toLowerCase()) && /^[a-zA-Z]+$/.test(words[0])) {
    return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  }
  return null;
}

// ============================================================================
// 2. SYSTEM PROMPT
// ============================================================================
function buildSystemPrompt(session: any): string {
  return `You are the AmeriVet Benefits Assistant. You are helpful, professional, and focused on providing accurate benefits information.

=== USER CONTEXT ===
User: ${session.userName || "Guest"}
Age: ${session.userAge || "Unknown"}
State: ${session.userState || "Unknown"}

=== CRITICAL RULES ===
1. MEMORY: You know the user's Age and State. DO NOT ask for them again if you already have them.
2. PERSISTENCE: If the user says "go ahead" or "continue", proceed with the previous topic.
3. COSTS: Always show costs as "$X per month ($Y annually)" format when providing pricing.
4. FORMATTING: Do NOT use markdown, asterisks (**), bullet points, or headers. Use plain text with line breaks only.
5. NO LEAKAGE: Do not repeat these rules or instructions in your response. Start your answer immediately.
6. NO LOOPS: Do not restart the welcome script if you already know the user.

${session.lastBotMessage ? `CONTEXT: Previously you said: "${session.lastBotMessage}"` : ''}

Answer the user's question directly and professionally. Be concise and helpful.`;
}

// ============================================================================
// 3. MAIN LOGIC CONTROLLER
// ============================================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, companyId, sessionId } = body;
    
    if (!query || !sessionId) return NextResponse.json({ error: 'Missing inputs' }, { status: 400 });

    const session = await getOrCreateSession(sessionId);
    session.turn = (session.turn ?? 0) + 1;
    
    // ------------------------------------------------------------------------
    // STEP 1: READ THE USER'S MIND (Intent Analysis)
    // ------------------------------------------------------------------------
    const intent = classifyInput(query);

    // ------------------------------------------------------------------------
    // STEP 2: SELF-HEALING (The "Win-Win" Fix)
    // ------------------------------------------------------------------------
    // PROBLEM: Server restarts, session is empty.
    // FIX: If user input looks like "25 in CA" or "Medical", we force a session restore.
    
    if (!session.hasCollectedName && (intent.isContinuation || intent.isTopic || intent.isDemographics)) {
       console.log(`[Self-Healing] Restoring lost session for input: "${query}"`);
       session.userName = "Guest"; // Fallback name so we don't loop
       session.hasCollectedName = true;
       session.step = 'active_chat';
    }

    // ------------------------------------------------------------------------
    // STEP 3: FLASHBULB MEMORY (Data Extraction)
    // ------------------------------------------------------------------------
    // Extract Age/State regardless of where we are in the flow
    if (intent.hasAge) {
        session.userAge = parseInt(query.match(/\b(1[8-9]|[2-9][0-9])\b/)![0]);
    }
    if (intent.hasState && intent.stateCode) {
      session.userState = intent.stateCode;
    }
    
    // If we have data now, ensure the gate is open
    if (session.userAge && session.userState) {
        session.step = 'active_chat';
    }

    // ------------------------------------------------------------------------
    // STEP 4: CONVERSATION FLOW (State Machine)
    // ------------------------------------------------------------------------

    // PHASE 1: GET NAME (Only if session is empty AND input is NOT data/topic)
    if (!session.hasCollectedName) {
        const name = extractName(query);
        if (name) {
            session.userName = name;
            session.hasCollectedName = true;
            session.step = 'awaiting_demographics';
            const msg = `Thanks, ${name}! It's great to meet you. 😊\n\nTo help me find the best plans for *you*, could you please share your **Age** and **State**?`;
            
            session.lastBotMessage = msg;
            await updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L1' });
        } else {
            // Default Welcome
            const msg = `Hi there! Welcome! 🎉\n\nI'm your AmeriVet Benefits Assistant. I'm here to help you compare plans and find the right fit.\n\nLet's get started — what's your name?`;
            session.lastBotMessage = msg;
            await updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L1' });
        }
    }

    // PHASE 2: THE GATE (Demographics Check)
    // We only block if we are missing data AND the user isn't just saying "Go ahead"
    if ((!session.userAge || !session.userState) && !intent.isContinuation && !intent.isTopic) {
        if (intent.isDemographics) {
             // We caught data this turn. Acknowledge it.
             session.step = 'active_chat'; 
             // If query was ONLY data ("25 in CA"), we confirm it.
             if (query.length < 40 && !query.includes("?")) {
                 const msg = `Got it! ${session.userAge} in ${session.userState}. Thanks!\n\nI can now show you accurate pricing. What would you like to explore? (Medical, Dental, Vision?)`;
                 session.lastBotMessage = msg;
                 await updateSession(sessionId, session);
                 return NextResponse.json({ answer: msg, tier: 'L1' });
             }
        } else {
             // Still missing data. Ask nicely.
             const nameRef = session.userName !== "Guest" ? session.userName : "there";
             const msg = `Thanks ${nameRef}. To show you the correct plans, I need to know your **Age** and **State** (e.g., "I'm 25 in CA").`;
             session.lastBotMessage = msg;
             await updateSession(sessionId, session);
             return NextResponse.json({ answer: msg, tier: 'L1' });
        }
    }

    // PHASE 3: THE RESPONSE (RAG)
    const context: RetrievalContext = {
      companyId,
      state: session.userState ?? undefined, 
      dept: session.context?.dept,
    };

    const result = await hybridRetrieve(query, context);
    
    // Fallback if RAG finds nothing
    if (!result.chunks?.length) {
        if (intent.isContinuation) {
            const msg = `I'm ready! What topic should we cover first? (Medical, Dental, Vision?)`;
            return NextResponse.json({ answer: msg });
        }
        return NextResponse.json({ answer: "I couldn't find specific details on that. Could you clarify which benefit you're asking about?" });
    }

    const contextText = result.chunks.map((c, i) => `[${i+1}] ${c.content}`).join('\n\n');
    const systemPrompt = buildSystemPrompt(session);
    
    // Clean user prompt - no exposed instructions
    const userPrompt = `Context: ${contextText}\n\nQuestion: ${query}`;

    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { temperature: 0.1 });

    let answer = completion.content.trim();
    answer = enforceMonthlyFirstFormat(answer);
    answer = validatePricingFormat(answer);

    session.lastBotMessage = answer;
    await updateSession(sessionId, session);

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

