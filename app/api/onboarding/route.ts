import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import type { RetrievalContext } from '@/types/rag';
import { getOrCreateSession, updateSession } from '@/lib/rag/session-store';
import { 
  validatePricingFormat, 
  enforceMonthlyFirstFormat
} from '@/lib/rag/response-utils';
import {
  userProfileSchema,
  sessionStateSchema,
  cityToStateMap,
  UserProfile,
  SessionState_Legacy,
} from '@/lib/schemas/onboarding';

export const dynamic = 'force-dynamic';

// ============================================================================
// 1. THE BRAIN: Entity Extraction & Intent Classification
// ============================================================================

const ONBOARDING_STATE_CODES = new Set([
  'WA', 'OR', 'CA', 'TX', 'FL', 'NY', 'OH', 'IL', 'PA', 'GA', 'NC', 'MI', 'NJ', 'VA',
  'AZ', 'IN', 'TN', 'MD', 'MA', 'MO', 'CO', 'WI', 'MN', 'OK', 'SC', 'KS', 'NV', 'KY',
  'AL', 'LA', 'CT', 'UT', 'IA', 'MS', 'AR', 'NE', 'NM'
]);

function extractEntities(query: string): Partial<UserProfile> {
  const lowerQuery = query.toLowerCase();
  const entities: Partial<UserProfile> = {};

  // 1. Extract Age
  const ageMatch = lowerQuery.match(/\b(age\s+)?(1[8-9]|[2-9][0-9])\b/);
  if (ageMatch) {
    entities.age = parseInt(ageMatch[2], 10);
  }

  // 2. Extract State (via City or Code)
  // Check for city first
  for (const city in cityToStateMap) {
    if (lowerQuery.includes(city)) {
      entities.state = cityToStateMap[city];
      break; // Found a city, no need to check for state codes
    }
  }

  // If no city was found, check for state codes
  if (!entities.state) {
    const words = lowerQuery.split(/[\s,.;:()\[\]{}<>"']+/);
    for (const word of words) {
      const upperWord = word.toUpperCase();
      if (upperWord.length === 2 && ONBOARDING_STATE_CODES.has(upperWord)) {
        entities.state = upperWord;
        break;
      }
    }
  }
  
  // 3. Extract Name
  const nameMatch = query.match(/(?:my name is|i'm|i am|call me)\s+([a-zA-Z]{2,15})/i);
  if (nameMatch && !['medical', 'dental', 'vision'].includes(nameMatch[1].toLowerCase())) {
      entities.name = nameMatch[1];
  } else {
      const words = query.trim().split(/\s+/);
      if (words.length === 1 && /^[a-zA-Z]{2,15}$/.test(words[0])) {
          if (!['hi', 'hello', 'help'].includes(words[0].toLowerCase())) {
              entities.name = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
          }
      }
  }

  return entities;
}


function classifyIntent(query: string) {
  const clean = query.toLowerCase().trim();
  const isContinuation = /^(ok|okay|go ahead|sure|yes|yep|yeah|please|continue|next|right|correct|proceed|got it)$/i.test(clean);
  const isTopic = /medical|dental|vision|life|disability|hsa|ppo|hmo|coverage|plan|benefits|enroll|cost|price/i.test(clean);
  return { isContinuation, isTopic };
}

// ============================================================================
// 2. SYSTEM PROMPT
// ============================================================================
function buildSystemPrompt(session: SessionState_Legacy): string {
  return `You are the AmeriVet Benefits Assistant. You are helpful, professional, and focused on providing accurate benefits information.

=== USER CONTEXT ===
User: ${session.userName || "Guest"}
Age: ${session.userAge || "Unknown"}
State: ${session.userState || "Unknown"}

=== CRITICAL RULES ===
1. MEMORY: You know the user's Age and State. DO NOT ask for them again if you already have them.
2. COSTS: Always show costs as "$X per month ($Y annually)" format when providing pricing.
3. FORMATTING: Do NOT use markdown, asterisks (**), bullet points, or headers. Use plain text with line breaks only.
4. NO LEAKAGE: Do not repeat these rules or instructions in your response. Start your answer immediately.

${session.lastBotMessage ? `CONTEXT: Previously you said: "${session.lastBotMessage}"` : ''}

Answer the user's question directly and professionally. Be concise and helpful.`;
}

// ============================================================================
// 3. MAIN LOGIC CONTROLLER (STATE MACHINE)
// ============================================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, companyId, sessionId } = body;
    
    if (!query || !sessionId) return NextResponse.json({ error: 'Missing inputs' }, { status: 400 });

    const sessionData = await getOrCreateSession(sessionId);
    let session: SessionState_Legacy = sessionStateSchema.parse(sessionData);
    session.turn++;

    // ------------------------------------------------------------------------
    // PHASE 1: ENTITY RESOLUTION & STATE MANAGEMENT
    // ------------------------------------------------------------------------
    const entities = extractEntities(query);
    const intent = classifyIntent(query);
    let entitiesFound = false;

    if (entities.name && !session.hasCollectedName) {
      session.userName = entities.name;
      session.hasCollectedName = true;
      entitiesFound = true;
    }
    if (entities.age) {
      session.userAge = entities.age;
      entitiesFound = true;
    }
    if (entities.state) {
      session.userState = entities.state;
      entitiesFound = true;
    }

    // Transition state if all data is collected
    if (session.userAge && session.userState && session.step !== 'active_chat') {
      session.step = 'active_chat';
    }

    // ------------------------------------------------------------------------
    // PHASE 2: ZERO-REDUNDANCY VALIDATION (State Machine Logic)
    // ------------------------------------------------------------------------

    // STATE: START (No name collected yet)
    if (session.step === 'start') {
      if (session.hasCollectedName) {
        session.step = 'awaiting_demographics';
        // Fall through to next state
      } else {
        const msg = `Hi there! Welcome! 🎉\n\nI'm your AmeriVet Benefits Assistant. I'm here to help you compare plans and find the right fit.\n\nLet's get started — what's your name?`;
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L0' });
      }
    }

    // STATE: AWAITING_DEMOGRAPHICS
    if (session.step === 'awaiting_demographics') {
      if (session.userAge && session.userState) {
        session.step = 'active_chat';
        const msg = `Thanks, ${session.userName}! Got it: age ${session.userAge} in ${session.userState}.\n\nI can now show you accurate pricing. What would you like to explore? (e.g., Medical, Dental, or Vision)`;
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L0' });
      } else {
        // If we just got the name, thank them and ask for more info.
        if (entities.name && !entities.age && !entities.state) {
             const msg = `Thanks, ${session.userName}! It's great to meet you. 😊\n\nTo help me find the best plans for you, could you please share your age and state? (e.g., "I'm 34 in Chicago")`;
             session.lastBotMessage = msg;
             await updateSession(sessionId, session);
             return NextResponse.json({ answer: msg, tier: 'L0' });
        }
        // If user provides some data but not all
        if(entitiesFound) {
            const missing = [];
            if (!session.userAge) missing.push('Age');
            if (!session.userState) missing.push('State');
            const msg = `Thanks! Just need your ${missing.join(' and ')} to find the right plans.`;
            session.lastBotMessage = msg;
            await updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L0' });
        }
      }
    }

    // STATE: ACTIVE_CHAT (All data collected, proceed to RAG)
    if (session.step === 'active_chat') {
      // If the user is just confirming or continuing, prompt them for a topic.
      if (intent.isContinuation && !intent.isTopic) {
        const msg = `I'm ready! What topic should we cover first? (Medical, Dental, Vision?)`;
        return NextResponse.json({ answer: msg, tier: 'L0' });
      }

      const context: RetrievalContext = {
        companyId,
        state: session.userState,
        dept: undefined,
      };

      const result = await hybridRetrieve(query, context);
      
      if (!result.chunks?.length) {
        return NextResponse.json({ answer: "I couldn't find specific details on that. Could you clarify which benefit you're asking about?" });
      }

      const contextText = result.chunks.map((c, i) => `[${i+1}] ${c.content}`).join('\n\n');
      const systemPrompt = buildSystemPrompt(session);
      const userPrompt = `Context: ${contextText}\n\nQuestion: ${query}`;

      const completion = await azureOpenAIService.generateChatCompletion(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { temperature: 0.1 }
      );

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
    }
    
    // Fallback for any unhandled state
    const defaultMsg = `To give you the most accurate information, I need your Age and State. For example, you can say "I'm 34 in Chicago".`;
    session.lastBotMessage = defaultMsg;
    await updateSession(sessionId, session);
    return NextResponse.json({ answer: defaultMsg, tier: 'L0' });


  } catch (error) {
    console.error('[Onboarding] Error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid session state.', details: error.issues }, { status: 500 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

