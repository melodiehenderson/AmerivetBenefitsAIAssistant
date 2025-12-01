import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { hybridLLMRouter } from '@/lib/services/hybrid-llm-router';

type SessionStep = 'start' | 'awaiting_state' | 'awaiting_dept' | 'active_chat';

type Session = {
  step: SessionStep;
  context: {
    state?: string;
    dept?: string;
  };
};

const sessionStore = new Map<string, Session>();

// Sprint 2 & 3 content and persona configuration
const WELCOME_MESSAGE = `**Welcome! I'm Susie, your virtual Benefits Assistant.**

I'm here to help you compare plans, check eligibility, and understand your options.

Warning: I am not your enrollment platform. Once you decide, I'll give you the link to complete your elections.

To get started, what **state** do you live in?`;

const SYSTEM_PROMPT = `
You are Susie, a proactive Virtual Benefits Assistant for AmeriVet.
Goal: guide employees to the right plans using the provided context and the user's state/department filters.

CORE BEHAVIORS
- Be proactive. Offer the next logical step after every answer.
- Tone: professional, empathetic, and concise.
- Grounding: use only provided context and user-supplied state/department. If unsure, say so and ask clarifying questions.

CRITICAL PRICING RULES (Sprint 3.3)
- Never show annual premium alone.
- Always show Monthly first, then Annual in parentheses. Format: "$X per month ($Y annually)".
- If data is missing, be transparent and ask for specifics.

CONVERSATIONAL RULES (Sprint 2.4)
- After covering Medical, ask: "Would you like my official recommendation, or should we look at Dental and Vision next?"
- When the user selects a plan, confirm it and ask if they want to move to the next benefit category.

SAFETY & SCOPE
- If a question is about age-banded products (Critical Illness, Voluntary Life, Disability) and exact rates are unknown, use the age-banded safe-path guidance instead of guessing numbers.
- Do NOT recommend plans that conflict with the user's state or department context.
`;

const AGE_BANDED_RESPONSE = `That's a great question. Plans like Critical Illness, Voluntary Life, and Disability are age-banded, so costs change by age and coverage amount.

To stay 100% accurate, I won't quote a dollar amount here.

Action: Please log into the Enrollment Portal to see your exact paycheck deduction based on your date of birth.

Would you like the link to the portal?`;

const ENROLLMENT_HANDOFF_MSG = `Ready to enroll?

Great! I'm your assistant, so you'll submit elections in the official system.

Go to your enrollment portal: [Enrollment Portal Link]

Do you want to review Dental or Vision before you head over?`;

const ANCILLARY_MENU = `We can review Dental, Vision, Accident, Critical Illness, Hospital Indemnity, Life, or Disability. Which one would you like to explore next?`;

const CROSS_SELL_TIP = `\n\nPro Tip: Since you're looking at an HSA/High Deductible plan, consider Accident and Critical Illness. They pay you cash to help offset the higher deductible if something happens.`;

export async function POST(req: NextRequest) {
  try {
    const { message, attachments = [], sessionId }: { message?: string; attachments?: any[]; sessionId?: string } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const sessionKey = sessionId || req.headers.get('x-session-id') || 'demo-session';
    const session = getOrCreateSession(sessionKey);
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

    // Sprint 1.1: Eligibility scoping (state -> dept)
    if (session.step === 'start') {
      updateSession(sessionKey, { ...session, step: 'awaiting_state' });
      return respond(WELCOME_MESSAGE, 'eligibility');
    }

    if (session.step === 'awaiting_state') {
      session.context.state = message.trim();
      updateSession(sessionKey, { ...session, step: 'awaiting_dept' });
      return respond('Got it. Which department or division are you in? (e.g., Sales, Operations, HQ)', 'eligibility');
    }

    if (session.step === 'awaiting_dept') {
      session.context.dept = message.trim();
      updateSession(sessionKey, { ...session, step: 'active_chat' });
      const intro = `Thanks! I've personalized options for ${session.context.state} - ${session.context.dept}.\n\nWe can discuss Medical, Dental, Vision, or other ancillary benefits. Where would you like to start?`;
      return respond(intro, 'eligibility');
    }

    // Sprint 1.2 & 1.3: Intent routing to avoid loops and unsafe costs
    const intent = classifyIntent(message);
    if (intent === 'age_banded_cost') {
      return respond(AGE_BANDED_RESPONSE, 'age-banded');
    }
    if (intent === 'ancillary_switch') {
      return respond(ANCILLARY_MENU, 'ancillary');
    }
    if (intent === 'enrollment_handoff') {
      return respond(ENROLLMENT_HANDOFF_MSG, 'handoff');
    }

    // Main AI flow with system prompt + context
    const userContextPrefix = [
      `User State: ${session.context.state || 'unknown'}`,
      `User Department: ${session.context.dept || 'unknown'}`,
      hasAttachments ? `Attachments: ${attachments.map((f) => f?.name || 'file').join(', ')}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');

    const userContent = hasAttachments
      ? `${userContextPrefix}\nThe user provided attachments. Analyze them and answer the question.\n\nUser request: ${message}`
      : `${userContextPrefix}\nUser request: ${message}`;

    try {
      const aiResponse = await hybridLLMRouter.routeRequest({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        model: 'gpt-4',
        temperature: 0.6,
        maxTokens: 1800,
      });

      let content = (aiResponse.content || '').trim();

      // Sprint 2.2: Proactive cross-sell for HSA/HDHP
      if (isHsaDiscussion(content, message)) {
        content += CROSS_SELL_TIP;
      }

      return respond(content, 'azure-openai');
    } catch (aiError) {
      console.log(
        'Azure OpenAI not available, using enhanced pattern matching:',
        aiError instanceof Error ? aiError.message : String(aiError),
      );
      return getPatternMatchingResponse(message, hasAttachments, attachments);
    }
  } catch (error) {
    console.error('Error in chat-demo API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function classifyIntent(message: string): 'age_banded_cost' | 'ancillary_switch' | 'enrollment_handoff' | 'general' {
  const msg = message.toLowerCase();
  const ageBandedKeywords = ['cost of life', 'price of critical illness', 'critical illness cost', 'disability cost', 'voluntary life cost'];
  if (ageBandedKeywords.some((k) => msg.includes(k))) return 'age_banded_cost';

  const ancillaryKeywords = ['other plans', 'anything else', 'move on', 'other benefits', 'what else'];
  if (ancillaryKeywords.some((k) => msg.includes(k))) return 'ancillary_switch';

  if (msg.includes('enroll') || msg.includes('sign up') || msg.includes('portal')) return 'enrollment_handoff';

  return 'general';
}

function isHsaDiscussion(response: string, query: string): boolean {
  const text = `${response} ${query}`.toLowerCase();
  return ['hsa', 'high deductible', 'hdhp'].some((token) => text.includes(token));
}

function getOrCreateSession(sessionKey: string): Session {
  if (!sessionStore.has(sessionKey)) {
    sessionStore.set(sessionKey, { step: 'start', context: {} });
  }
  return sessionStore.get(sessionKey)!;
}

function updateSession(sessionKey: string, session: Session) {
  sessionStore.set(sessionKey, session);
}

function respond(content: string, source: string) {
  const message = {
    id: randomUUID(),
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(
    {
      message,
      content,
      source,
    },
    { status: 200 },
  );
}

// Pattern-matching fallback that honors the new UX and safety rules
function getPatternMatchingResponse(userMessage: string, hasAttachments: boolean, attachments: any[]) {
  const lowerMessage = userMessage.toLowerCase();

  if (hasAttachments || lowerMessage.includes('attached') || lowerMessage.includes('pdf') || lowerMessage.includes('document')) {
    const fileName = attachments?.[0]?.name || 'your document';
    return respond(
      `**Document Analysis - ${fileName}**

I'll review your benefits document and summarize the key points:

**Document Details**
- File: ${fileName}
- Type: Benefits summary / plan details
- Provider: AmeriVet Benefits
- Coverage Period: 2024-2025

**What I Typically Look For**
- Health Plans: Kaiser HMO options (Standard and Enhanced)
- Dental Coverage: Regional DHMO plan options
- Vision Benefits: Eye care and corrective lenses
- Voluntary Benefits: Disability, life insurance, and worksite benefits

**Cost Structure (Examples)**
- Monthly premiums vary by plan and tier
- Copays vs. deductibles depending on the plan
- Annual maximums to cap out-of-pocket exposure

**How I Can Help Next**
1) Compare plans side-by-side
2) Estimate monthly vs. annual costs
3) Check network/provider fit
4) Guide you to the enrollment portal when you're ready`,
      'pattern-matching',
    );
  }

  if (['hsa', 'health savings', 'investment'].some((k) => lowerMessage.includes(k))) {
    return respond(
      `**HSA Quick Guide**

**Why Choose HSA/HDHP**
- Lower premiums, higher deductible
- Triple tax advantage on contributions, growth, and qualified withdrawals
- Good fit if you have low-to-moderate medical usage and an emergency fund

**Cost Snapshot (example individual)**
- Monthly Premium: $200
- Annual Premium: $2,400
- Deductible: $3,500
- Suggested HSA contribution: $4,300/year ($358/month)
- Always show costs as: "$X per month ($Y annually)"`
        + CROSS_SELL_TIP,
      'pattern-matching',
    );
  }

  return respond(
    `**AmeriVet Benefits Assistant (fallback mode)**

I can help you with:
- Plan information: Kaiser HMO, HSA/HDHP, PPO, Dental, Vision
- Cost and coverage analysis: monthly vs. annual costs, comparisons
- Document help: upload benefits PDFs for review
- Enrollment guidance: steps and timelines

Tell me what you'd like to explore first. If you've selected a medical plan, I can move you to Dental, Vision, and other benefits next.`,
    'pattern-matching',
  );
}
