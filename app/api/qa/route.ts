import { OpenAI } from 'openai';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ONBOARDING_SYSTEM_PROMPT = `
You are the Amerivet Benefits Assistant. 
Your goal: Guide the user through a strict onboarding flow.

=== STATE ===
Check the [DEVELOPER CONTEXT] below.
- IF "has_collected_name" is FALSE: You MUST run the Welcome Script.
- IF "has_collected_name" is TRUE: You can help the user.
- IF "just_provided_name" is TRUE: You MUST say: "Thanks, [Name]! Before we continue... I'm not your enrollment platform... What can I help with?"

=== WELCOME SCRIPT ===
"Hi there! Welcome! 🎉
I'm so glad you're here! I'm your Benefits Assistant.
Let's get started — what's your name?"

=== RULES ===
1. Do not loop. If the user gives a name, accept it and move on.
2. "$X per month ($Y annually)" format for costs.
`;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    
    // --- ROBUST STATE DETECTION (The Fix) ---
    
    // 1. Find the last thing the BOT said
    // We reverse search the array to find the most recent 'assistant' message
    const lastBotMessageObj = [...messages].reverse().find((m: any) => m.role === 'assistant');
    const lastBotText = lastBotMessageObj ? lastBotMessageObj.content.toLowerCase() : "";
    
    const lastUserMessageObj = messages[messages.length - 1];
    const userText = lastUserMessageObj.content;

    let hasCollectedName = false;
    let justProvidedName = false;

    // 2. CHECK: Did the bot just ask for a name?
    // We check for keywords: "what's your name", "what is your name", "your name?"
    if (lastBotText.includes("name") && (lastBotText.includes("what") || lastBotText.includes("?"))) {
        // If the bot asked for a name, and the user replied (with anything), we accept it.
        hasCollectedName = true;
        justProvidedName = true;
    }
    
    // 3. CHECK: Are we already deep in conversation?
    // If the history shows we already said "Thanks" or discussed benefits, we know the name.
    if (messages.some((m: any) => m.role === 'assistant' && (m.content.includes("enrollment platform") || m.content.includes("help you with")))) {
        hasCollectedName = true;
        justProvidedName = false; // We already knew it, so don't greet again.
    }

    // --- INJECT STATE ---
    const developerContext = {
      role: 'system',
      content: `[DEVELOPER CONTEXT]: 
      - has_collected_name: ${hasCollectedName}
      - just_provided_name: ${justProvidedName}
      - user_input_is_name: "${userText}"
      
      CRITICAL INSTRUCTION: 
      If just_provided_name is TRUE, you MUST output the 'Thanks [Name]' script using "${userText}" as the name.`
    };

    // --- CALL OPENAI ---
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o', 
      messages: [
        { role: 'system', content: ONBOARDING_SYSTEM_PROMPT },
        ...messages.slice(0, -1),
        developerContext, // <--- This forces the bot to recognize the state
        lastUserMessageObj
      ],
      temperature: 0.1, // Very low temp to prevent it from ignoring instructions
    });

    return NextResponse.json({
      content: response.choices[0].message.content,
      role: 'assistant'
    });

  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}