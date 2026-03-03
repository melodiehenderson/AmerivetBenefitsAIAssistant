import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import type { RetrievalContext } from '@/types/rag';
import { getOrCreateSession, updateSession, type Session } from '@/lib/rag/session-store';
import { 
  validatePricingFormat, 
  enforceMonthlyFirstFormat,
  cleanResponseText
} from '@/lib/rag/response-utils';
import {
  runValidationPipeline,
  generateAlternativeResponse,
  type PipelineResult,
  type ValidationResult
} from '@/lib/rag/validation-pipeline';
import {
  routeIntent,
  checkStateGate,
  applyBrandonRule,
  getAgeBandedResponse,
  type RouterResult
} from '@/lib/rag/semantic-router';
import pricingUtils from '@/lib/rag/pricing-utils';

export const dynamic = 'force-dynamic';

// Enrollment portal URL — use env var to avoid hardcoding
const ENROLLMENT_PORTAL_URL = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.htmld';
const HR_PHONE = process.env.HR_PHONE_NUMBER || '888-217-4728';

// ============================================================================
// 1. THE BRAIN: Intent Classification (Enhanced)
// ============================================================================
// US States mapping for better detection
const US_STATES_MAP: Record<string, string> = {
  "alabama": "AL", "al": "AL", "alaska": "AK", "ak": "AK",
  "arizona": "AZ", "az": "AZ", "arkansas": "AR", "ar": "AR",
  "california": "CA", "ca": "CA", "colorado": "CO", "co": "CO",
  "connecticut": "CT", "ct": "CT", "delaware": "DE", "de": "DE",
  "florida": "FL", "fl": "FL", "georgia": "GA", "ga": "GA",
  "hawaii": "HI", "hi": "HI", "idaho": "ID", "id": "ID",
  "illinois": "IL", "il": "IL", "indiana": "IN", "in": "IN",
  "iowa": "IA", "ia": "IA", "kansas": "KS", "ks": "KS",
  "kentucky": "KY", "ky": "KY", "louisiana": "LA", "la": "LA",
  "maine": "ME", "me": "ME", "maryland": "MD", "md": "MD",
  "massachusetts": "MA", "ma": "MA", "michigan": "MI", "mi": "MI",
  "minnesota": "MN", "mn": "MN", "mississippi": "MS", "ms": "MS",
  "missouri": "MO", "mo": "MO", "montana": "MT", "mt": "MT",
  "nebraska": "NE", "ne": "NE", "nevada": "NV", "nv": "NV",
  "new hampshire": "NH", "nh": "NH", "new jersey": "NJ", "nj": "NJ",
  "new mexico": "NM", "nm": "NM", "new york": "NY", "ny": "NY",
  "north carolina": "NC", "nc": "NC", "north dakota": "ND", "nd": "ND",
  "ohio": "OH", "oh": "OH", "oklahoma": "OK", "ok": "OK",
  "oregon": "OR", "or": "OR", "pennsylvania": "PA", "pa": "PA",
  "rhode island": "RI", "ri": "RI", "south carolina": "SC", "sc": "SC",
  "south dakota": "SD", "sd": "SD", "tennessee": "TN", "tn": "TN",
  "texas": "TX", "tx": "TX", "utah": "UT", "ut": "UT",
  "vermont": "VT", "vt": "VT", "virginia": "VA", "va": "VA",
  "washington": "WA", "wa": "WA", "west virginia": "WV", "wv": "WV",
  "wisconsin": "WI", "wi": "WI", "wyoming": "WY", "wy": "WY"
};

const US_STATE_CODES = new Set(Object.values(US_STATES_MAP));

// export for testing
export function extractStateCode(msg: string, hasAge: boolean): { code: string | null; token: string | null } {
  const original = msg.trim();
  const lower = original.toLowerCase();

  // 1) Prefer full state names (handles "new york", "washington", etc.)
  // Note: we only consider map keys longer than 2 chars to avoid pronouns like "me".
  let bestName: string | null = null;
  for (const key of Object.keys(US_STATES_MAP)) {
    if (key.length <= 2) continue;
    if (!lower.includes(key)) continue;
    // Require word boundaries-ish to avoid partial matches
    const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(original)) {
      if (!bestName || key.length > bestName.length) bestName = key;
    }
  }
  if (bestName) {
    // ignore negated mentions, e.g. "not indiana" or "except colorado"
    const idx = lower.indexOf(bestName);
      const preceding = lower.slice(Math.max(0, idx - 20), idx);
      if (/\b(?:not|n't|except|but not|without)\b/i.test(preceding)) {
      bestName = null; // treat as if not found
    } else {
      return { code: US_STATES_MAP[bestName], token: bestName };
    }
  }

  // 2) Two-letter codes (avoid false positives like "me" in "for me")
  // IMPORTANT: Do NOT include bare "in" here. It's too common and caused false positives
  // for the state code "IN" (Indiana) in normal sentences.
  const hasLocationCue = /\b(from|live|located|state)\b/i.test(original);
  const agePlusState = original.match(/\b(1[8-9]|[2-9][0-9])\b\s*[,\-\/\s]+\s*([A-Za-z]{2})\b/);
  const statePlusAge = original.match(/\b([A-Za-z]{2})\b\s*[,\-\/\s]+\s*\b(1[8-9]|[2-9][0-9])\b/);
  const adjacentToken = (agePlusState?.[2] || statePlusAge?.[1] || null)?.trim();

  const rawTokens = original.split(/[\s,.;:()\[\]{}<>"']+/).filter(Boolean);
  for (const raw of rawTokens) {
    // if token appears in negated phrase, skip
    const lowerRaw = raw.toLowerCase();
    const negPattern = new RegExp(`\\b(?:not|n't|except|but not|without)\\s+${lowerRaw}\\b`, 'i');
    if (negPattern.test(lower)) continue;
    const cleaned = raw.replace(/[^A-Za-z]/g, '');
    if (cleaned.length !== 2) continue;

    const upper = cleaned.toUpperCase();
    if (!US_STATE_CODES.has(upper)) continue;

    // If it's a common English word that collides with a state code, only accept
    // when it is clearly intended as a location.
    const lower2 = cleaned.toLowerCase();
    const ambiguousCode = lower2 === 'me' || lower2 === 'or' || lower2 === 'in';

    const isUpperInOriginal = cleaned === upper;
    const isAdjacentToAge = adjacentToken ? adjacentToken.toLowerCase() === lower2 : false;
    const accept =
      isUpperInOriginal ||
      isAdjacentToAge ||
      (hasLocationCue && !ambiguousCode) ||
      // Allow ambiguous codes only when explicit (except "in")
      (hasLocationCue && ambiguousCode && lower2 !== 'in') ||
      (hasAge && !ambiguousCode) ||
      (hasAge && isAdjacentToAge);

    if (!accept) continue;
    // Never treat lowercase "in" as Indiana; require explicit uppercase "IN" or adjacency to age.
    if (lower2 === 'in' && !isUpperInOriginal && !isAdjacentToAge) continue;
    if (ambiguousCode && !isUpperInOriginal && !hasLocationCue && !isAdjacentToAge && !hasAge) continue;

    return { code: upper, token: cleaned };
  }

  return { code: null, token: null };
}

function classifyInput(msg: string) {
  const clean = msg.toLowerCase().trim();
  
  // A. Continuation ("Go ahead", "Sure", "Okay")
  const isContinuation = /^(ok|okay|go ahead|sure|yes|yep|yeah|please|continue|next|right|correct|proceed|got it)$/i.test(clean);
  
  // B. Topic Jump - EXPANDED LIST
  // Added: insurance, critical, accident, injury, voluntary, help, select, choose, premium, coverage, claim
  const isTopic = /medical|dental|vision|life|disability|hsa|ppo|hmo|coverage|plan|benefits|enroll|cost|price|insurance|critical|accident|injury|voluntary|help|select|choose|premium|claim|supplemental|accidental/i.test(clean);
  
  // C. Demographics ("25 in WA", "California", "Age 40", "24 and ohio")
  const hasAge = /\b(1[8-9]|[2-9][0-9])\b/.test(clean);

  const extractedState = extractStateCode(msg, hasAge);
  const hasState = !!extractedState.code;
  const foundState = extractedState.token;
  
  const isDemographics = hasAge || hasState;

  return { isContinuation, isTopic, isDemographics, hasAge, hasState, foundState, stateCode: extractedState.code };
}

// ============================================================================
// 1.5 SMART METADATA EXTRACTION (Topic Classifier)
// ============================================================================
// Map user keywords to your specific Document Categories (Metadata)
// IMPORTANT: Returns category ONLY if explicitly mentioned, not from vague keywords
function extractCategory(msg: string): string | null {
  const lower = msg.toLowerCase();
  
  // EXPLICIT mentions only (user directly said the category name)
  // Avoid ambiguous keywords like "healthy" which could be just casual conversation
  if (lower.match(/\b(medical|health\s+insurance|health\s+plans?|medical\s+plans?|medical\s+coverage|health\s+coverage)\b/)) return 'Medical';
  if (lower.match(/\b(dental|teeth|orthodont)\b/)) return 'Dental';
  if (lower.match(/\b(vision|eye|glasses|contact)\b/)) return 'Vision';
  if (lower.match(/\b(life\s+insurance|life\s+coverage)\b/)) return 'Life';
  if (lower.match(/\b(disability|std|ltd|income\s+protection)\b/)) return 'Disability';
  if (lower.match(/\b(hsa|fsa|spending|savings\s+account)\b/)) return 'Savings';
  if (lower.match(/\b(critical|accident|injury|hospital|supplemental|voluntary|ad&d)\b/)) return 'Voluntary';

  // Heuristic: coverage-tier + per-paycheck questions are almost always about medical plan premiums.
  // This prevents accidental routing to Voluntary benefits when user didn't specify a category.
  const hasCoverageTierCue = /(employee\s*\+\s*(?:child|children|spouse|family)|employee\s*only|individual|single)/i.test(lower);
  const hasPaycheckCue = /(per\s*pay(?:check|period)|per\s*pay\b)/i.test(lower);
  const hasOtherBenefitCue = /(dental|vision|life|disability|accident|critical illness|hospital indemnity)/i.test(lower);
  if ((hasCoverageTierCue || hasPaycheckCue) && !hasOtherBenefitCue) return 'Medical';
  
  return null; // Fallback to searching everything
}

// Smart Name Extractor
function extractName(msg: string): string | null {
  const NOT_NAMES = new Set(['hello', 'hi', 'hlo', 'hey', 'medical', 'dental', 'vision', 'help', 'benefits', 'insurance', 'quote', 'cost', 'ok', 'yes', 'no']);
  
  // 1. Explicit: "My name is Sonal"
  const match = msg.match(/(?:name is|i'm|i am|call me)\s+([a-zA-Z]{2,15})/i);
  if (match && !NOT_NAMES.has(match[1].toLowerCase())) return match[1];

  // 2. Implicit: Single word that looks like a name ("Sonal")
  const words = msg.trim().split(/\s+/);
  const firstWord = words[0].toLowerCase();
  
  // Must be 3+ characters, all letters, not a common word, and have vowels
  if (words.length <= 2 && 
      !NOT_NAMES.has(firstWord) && 
      /^[a-zA-Z]{3,}$/.test(words[0]) &&
      /[aeiou]/i.test(words[0])) {
    return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  }
  return null;
}

// ============================================================================
// 1.6 FULL BENEFITS LIST & DECISION TRACKER
// ============================================================================
const ALL_BENEFITS_SHORT = 'Medical, Dental, Vision, Life Insurance, Disability, Critical Illness, Accident/AD&D, and HSA/FSA';

const ALL_BENEFITS_MENU = `Here are all the benefits available to you as an AmeriVet employee:
- Medical (PPO, HMO, HDHP/HSA, Kaiser where available)
- Dental (DPPO, DHMO)
- Vision
- Life Insurance (Basic, Voluntary, Whole Life)
- Disability (Short-Term and Long-Term)
- Critical Illness
- Accident/AD&D
- HSA/FSA Accounts`;

function normalizeBenefitCategory(keyword: string): string {
  const lower = keyword.toLowerCase();
  if (/medical|health|ppo|hmo|hdhp|kaiser/.test(lower)) return 'Medical';
  if (/dental/.test(lower)) return 'Dental';
  if (/vision|eye/.test(lower)) return 'Vision';
  if (/life/.test(lower)) return 'Life Insurance';
  if (/disability|std|ltd/.test(lower)) return 'Disability';
  if (/critical/.test(lower)) return 'Critical Illness';
  if (/accident|ad&d/.test(lower)) return 'Accident/AD&D';
  if (/hsa|fsa/.test(lower)) return 'HSA/FSA';
  return keyword.charAt(0).toUpperCase() + keyword.slice(1);
}

function detectDecision(query: string): { category: string; decision: string; status: 'selected' | 'declined' } | null {
  const lower = query.toLowerCase();

  // GUARD: Don't match decision patterns if this is a deduction/calculation request
  // Pattern: User asking "how much would be deducted", "total deduction", etc.
  if (/(?:how\s+much|how\s+much\s+would|total\s+deduction|deducted?\s+per|cost\s+per|paycheck|per\s+pay)/i.test(query)) {
    return null; // Let the totalDeductionRequested intercept handle it
  }

  // Decline patterns: "no vision needed", "skip dental", "don't need life"
  const declineMatch = lower.match(/(?:no|don'?t\s*need|skip|pass\s*on|not\s*interested\s*in|don'?t\s*want|no\s*thanks\s*(?:on|for|to))\s+(?:the\s+)?(?:any\s+)?(medical|dental|vision|life|disability|critical|accident|hsa|fsa)/i);
  if (declineMatch) {
    const cat = normalizeBenefitCategory(declineMatch[1]);
    return { category: cat, decision: 'Declined', status: 'declined' };
  }

  // Explicit decline of current topic: "no thanks", "I'm good", "not for me" (with context)
  const explicitDecline = /^(no thanks|i'?m good|not for me|pass|skip it|skip this|i'?ll pass|not interested|no need)$/i.test(lower.trim());
  // This will be handled with session.currentTopic in the route logic

  // Selection patterns: "I'll go with Kaiser", "I want the PPO", "sign me up for HDHP"
  const selectMatch = lower.match(/(?:i'?ll?\s*(?:go\s*with|take|choose|want|pick)|let'?s?\s*go\s*with|i\s*(?:chose|picked|selected|want)|sign\s*me\s*up\s*for|enroll\s*(?:me\s*)?in|i\s*(?:like|prefer))\s+(?:the\s+)?(.+?)(?:\s*plan)?$/i);
  if (selectMatch) {
    const plan = selectMatch[1].trim();
    const cat = normalizeBenefitCategory(plan);
    return { category: cat, decision: plan.charAt(0).toUpperCase() + plan.slice(1), status: 'selected' };
  }

  return null;
}

function isSummaryRequest(query: string): boolean {
  const lower = query.toLowerCase();
  return /\b(summary|recap|review|what\s+(?:have\s+i|did\s+i)\s+(?:decided|chosen|picked|selected)|show\s+(?:me\s+)?my\s+(?:choices|selections|decisions)|wrap\s*up|overview\s+of\s+my)\b/i.test(lower);
}

function compileSummary(decisions: Record<string, any>, userName: string): string {
  const entries = Object.entries(decisions);
  if (entries.length === 0) {
    return `I don't have any benefit decisions recorded yet, ${userName}. Would you like to start exploring? Available benefits include: ${ALL_BENEFITS_SHORT}`;
  }

  let summary = `Here's a summary of your benefit decisions so far, ${userName}:\n\n`;
  for (const [category, value] of entries) {
    const entry = typeof value === 'string' ? { status: 'selected', value } : value;
    if (entry.status === 'selected') {
      summary += `- ${category}: ${entry.value || 'Selected'}\n`;
    } else if (entry.status === 'declined') {
      summary += `- ${category}: Declined\n`;
    } else {
      summary += `- ${category}: Interested (no final decision yet)\n`;
    }
  }

  const allCategories = ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA'];
  const remaining = allCategories.filter(c => !decisions[c]);
  if (remaining.length > 0) {
    summary += `\nBenefits you haven't explored yet: ${remaining.join(', ')}\n`;
    summary += `\nWould you like to look into any of these?`;
  } else {
    summary += `\nYou've reviewed all available benefits! When you're ready to enroll, visit the portal at ${ENROLLMENT_PORTAL_URL}`;
  }

  return summary;
}

function getRemainingBenefits(decisions: Record<string, any>): string[] {
  const allCategories = ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA'];
  return allCategories.filter(c => !decisions[c]);
}

// ============================================================================
// 2. SYSTEM PROMPT (Senior Engineer - Stateful Guarded Agent)
// ============================================================================
function buildSystemPrompt(session: any): string {
  // Build decisions context for the LLM
  const decisions = session.decisionsTracker || {};
  const decisionEntries = Object.entries(decisions);
  const decisionsText = decisionEntries.length > 0
    ? decisionEntries.map(([cat, val]: [string, any]) => {
        const entry = typeof val === 'string' ? { status: 'selected', value: val } : val;
        return `- ${cat}: ${entry.status === 'selected' ? entry.value || 'Selected' : 'Declined'}`;
      }).join('\n')
    : 'None yet';

  return `You are the AmeriVet Virtual Benefits Assistant.
Your goal is 100% accuracy and compliance. You help users navigate benefits, but you DO NOT process enrollments.

## USER CONTEXT
User: ${session.userName || "Guest"}
State: ${session.userState || "Unknown"}
Age: ${session.userAge || "Unknown"}
Decisions so far:
${decisionsText}

## RULES OF ENGAGEMENT

### 1. SCOPE ENFORCEMENT
- ONLY answer based on the provided Context Documents
- If the answer is not in context, say: "I don't have that specific information. Please check the enrollment portal at ${ENROLLMENT_PORTAL_URL} or contact HR."
- NEVER make up plan details, costs, or coverage information

### 2. COST FORMATTING (Critical)
- ALWAYS format costs as: "$X.XX/month ($Y.YY/year)" — monthly first, then annual
- NEVER show an annual-only or paycheck-only amount without the monthly figure
- Canonical Employee Only premiums (use these exact numbers):
  - Standard HSA: $86.84/month ($1,042.08/year)
  - Enhanced HSA: $160.36/month ($1,924.32/year)
  - Kaiser Standard HMO: $142.17/month ($1,706.04/year) — California only
  - BCBSTX Dental PPO: $28.90/month ($346.80/year)
  - VSP Vision Plus: $12.40/month ($148.80/year)
- If you cite a dollar amount, it MUST include "/month" or "/year" label — never a bare number
- Round to 2 decimal places

### 3. AGE-BANDED PRODUCTS (Refuse Specific Costs)
- For Voluntary Life, Disability, Critical Illness, AD&D:
- DO NOT provide specific dollar amounts
- Instead say: "This is an age-rated product. Please log in to the Enrollment Portal at ${ENROLLMENT_PORTAL_URL} to see your personalized rate based on your age and coverage selection."

### 4. MEMORY RULES
- You know the user's Age (${session.userAge}) and State (${session.userState})
- DO NOT ask for information you already have
- If user says "go ahead" or "continue", proceed with the previous topic

### 5. FORMATTING
- Use plain conversational text
- Avoid markdown headers unless listing multiple options
- Be concise and direct
- When providing URLs, show them as plain text (e.g., https://example.com), NOT as markdown links like [text](url)
- Use bullet points with dashes (-) not emojis

### 6. LIFE INSURANCE CARRIER RULES (STRICT)
- UNUM provides: Basic Life ($25k employer-paid) and Voluntary Life (term life)
- ALLSTATE provides: Whole Life Insurance ONLY (permanent life with cash value)
- NEVER say Allstate offers term life - that is INCORRECT
- NEVER say UNUM offers whole/permanent life - that is INCORRECT
- When discussing life insurance, ALWAYS mention all three types: Basic (UNUM), Voluntary (UNUM), and Whole Life (ALLSTATE)
- Tip to share: Many advisors recommend splitting coverage approximately 20% into Permanent (Whole) Life and 80% into Voluntary (Term) Life for the best balance of lifetime coverage and affordable protection

### 7. NEVER MENTION THESE
- NEVER mention "Rightway" or "Rightway app" or "Rightway service" - this is NOT part of AmeriVet's benefits
- NEVER mention the phone number (305) 851-7310 - this is NOT an AmeriVet number
- If user asks for live support or to talk to a person, direct them to AmeriVet HR/Benefits at ${HR_PHONE} or the enrollment portal

### 8. CONVERSATION FLOW
- The FIRST time you help a user, mention: "I'm here to help you understand your benefits - actual enrollment happens at the portal."
- Do NOT repeat that disclaimer in subsequent messages
- When user finishes exploring a benefit (makes a decision or says they're done), proactively suggest the remaining benefits they haven't explored
- ALL available AmeriVet benefits: Medical (PPO, HMO, HDHP/HSA, Kaiser where available), Dental (DPPO, DHMO), Vision, Life Insurance (Basic, Voluntary, Whole Life), Disability (Short-Term, Long-Term), Critical Illness, Accident/AD&D, HSA/FSA
- Always list ALL remaining benefits when suggesting what to explore next - never give an abbreviated list
- Only ask one question at a time to keep the conversation flowing naturally

${session.lastBotMessage ? `## CONTEXT
Previously you said: "${session.lastBotMessage}"` : ''}

Answer directly, accurately, and helpfully.`;
}

// ============================================================================
// 3. SESSION CONTEXT BUILDER (for frontend caching)
// ============================================================================
function buildSessionContext(session: Session) {
  return {
    userName: session.userName || null,
    userAge: session.userAge || null,
    userState: session.userState || null,
    hasCollectedName: session.hasCollectedName || false,
    dataConfirmed: session.dataConfirmed || false,
    decisionsTracker: session.decisionsTracker || {},
    completedTopics: session.completedTopics || []
  };
}

// ============================================================================
// 4. MAIN LOGIC CONTROLLER
// ============================================================================
export async function POST(req: NextRequest) {
  let parsedBody: any = null;
  try {
    const body = await req.json();
    parsedBody = body;
    // Accept optional context from frontend as fallback for serverless session loss
    const { query, companyId, sessionId, context: clientContext } = body;
    
    logger.debug(`[QA] New request - QueryLen: ${query?.length}, SessionId: ${sessionId?.substring(0, 8)}...`);
    
    if (!query || !sessionId) return NextResponse.json({ error: 'Missing inputs' }, { status: 400 });

    const session = await getOrCreateSession(sessionId);
    session.turn = (session.turn ?? 0) + 1;
    
    // SERVERLESS RESILIENCE: Restore session from client context if backend lost it
    // This handles the case where Redis/memory/fs all fail in serverless
    if (clientContext) {
      if (clientContext.userName && !session.userName) {
        session.userName = clientContext.userName;
        session.hasCollectedName = true;
        logger.debug(`[QA] Restored userName from client context`);
      }
      if (clientContext.userAge && !session.userAge) {
        session.userAge = clientContext.userAge;
        logger.debug(`[QA] Restored userAge from client context`);
      }
      if (clientContext.userState && !session.userState) {
        session.userState = clientContext.userState;
        logger.debug(`[QA] Restored userState from client context`);
      }
      if (session.userName && session.userAge && session.userState) {
        session.dataConfirmed = true;
        session.step = 'active_chat';
      }
    }
    
    logger.debug(`[QA] Session state - Turn: ${session.turn}, HasName: ${session.hasCollectedName}, HasAge: ${!!session.userAge}, HasState: ${!!session.userState}`);
    
    // ------------------------------------------------------------------------
    // STEP 1: READ THE USER'S MIND (Intent Analysis)
    // ------------------------------------------------------------------------
    const intent = classifyInput(query);
    logger.debug(`[QA] Intent analysis:`, intent);

    // ------------------------------------------------------------------------
    // STEP 2: SELF-HEALING (The "Win-Win" Fix)
    // ------------------------------------------------------------------------
    // PROBLEM: Server restarts, session is empty.
    // FIX: If user input looks like "25 in CA" or "Medical", we force a session restore.
    
    if (!session.hasCollectedName && (intent.isContinuation || intent.isTopic || intent.isDemographics)) {
       logger.debug(`[Self-Healing] Restoring lost session, queryLen: ${query?.length}`);
       session.userName = "Guest"; // Fallback name so we don't loop
       session.hasCollectedName = true;
       session.step = 'active_chat';
    }

    // ------------------------------------------------------------------------
    // STEP 3: FLASHBULB MEMORY (Data Extraction)
    // ------------------------------------------------------------------------
    // Extract Age/State regardless of where we are in the flow
    if (intent.hasAge) {
        const ageMatch = query.match(/\b(1[8-9]|[2-9][0-9])\b/);
        if (ageMatch) {
            session.userAge = parseInt(ageMatch[0]);
            logger.debug(`[QA] Extracted age from input`);
        }
    }
    if (intent.hasState && intent.stateCode) {
      session.userState = intent.stateCode;
      logger.debug(`[QA] Extracted state from input`);
    }
    
    // Ensure session is saved after data extraction
    if ((intent.hasAge && session.userAge) || (intent.hasState && session.userState)) {
      await updateSession(sessionId, session);
        logger.debug(`[QA] Session updated - HasAge: ${!!session.userAge}, HasState: ${!!session.userState}`);
    }
    
    // If we have data now, ensure the gate is open and acknowledge
    if (session.userAge && session.userState && !session.dataConfirmed) {
        session.step = 'active_chat';
        session.dataConfirmed = true; // Prevent repeated confirmations
        
        // If query was ONLY data ("43 CA"), confirm it
        if (query.length < 40 && !query.includes("?") && intent.isDemographics) {
            const msg = `Perfect! ${session.userAge} in ${session.userState}. Now I can show you accurate pricing.\n\n${ALL_BENEFITS_MENU}\n\nWhat would you like to explore first?`;
            session.lastBotMessage = msg;
        await updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
        }
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
            const msg = `Thanks, ${name}! It's great to meet you.\n\nTo help me find the best plans for *you*, could you please share your **Age** and **State**?`;
            
            session.lastBotMessage = msg;
        await updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
        } else {
            // Default Welcome
            const msg = `Hi there! Welcome!\n\nI'm your AmeriVet Benefits Assistant. I'm here to help you compare plans and find the right fit.\n\nLet's get started - what's your name?`;
            session.lastBotMessage = msg;
        await updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
        }
    }

    // PHASE 2: THE STRICT GATEKEEPER
    // Sanitize Data (Fix the "undefined" bug)
    if (session.userState === "undefined" || session.userState === "null") {
        session.userState = null;
    }
    // Only nullify age if it's actually invalid, not if it's a valid number
    if (session.userAge !== null && (typeof session.userAge !== 'number' || isNaN(session.userAge))) {
        logger.debug(`[QA] Nullifying invalid age value`);
        session.userAge = null;
    }

    const hasAge = !!session.userAge;
    const hasState = !!session.userState;
    const hasData = hasAge && hasState;

    logger.debug(`[QA] Gatekeeper check - HasAge: ${hasAge}, HasState: ${hasState}, HasData: ${hasData}`);

    // CRITICAL FIX: If we have data, always allow the request through
    if (!hasData && !intent.isContinuation) {
        
        // Scenario A: User asks "Medical PPO" or "critical injury insurance" but we don't know their State.
        // STOP THEM explicitly.
        if (intent.isTopic) {
             const missing = !hasState ? "State" : "Age";
             const msg = `I can definitely help you with ${query}, but plan availability and costs vary by location.\n\nFirst, please tell me your ${missing} so I can give you the correct information.`;
             
             session.lastBotMessage = msg;
         await updateSession(sessionId, session);
             return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
        }

        // Scenario B: User provided PARTIAL data (e.g. just "43")
        if (intent.isDemographics) {
             const missing = !hasState ? "State" : "Age";
             const current = session.userAge ? `Age ${session.userAge}` : `State ${session.userState}`;
             
             const msg = `Got it (${current}). To pull the accurate rates, I just need your ${missing}.`;
             
             session.lastBotMessage = msg;
         await updateSession(sessionId, session);
             return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
        }

        // Scenario C: Generic chitchat while waiting for data
        const nameRef = session.userName !== "Guest" ? session.userName : "there";
        const msg = `Thanks ${nameRef}. Before we look at plans, I need your Age and State (e.g., "I'm 25 in CA") to calculate your costs.`;
        
        session.lastBotMessage = msg;
       await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
    }

    // Log when user with complete data proceeds to RAG
    if (hasData) {
        logger.debug(`[QA] User has complete data, proceeding to RAG`);
    }

    // INTERCEPT: LIVE SUPPORT / TALK TO A PERSON
    // ========================================================================
    const lowerQuery = query.toLowerCase();
    const isLiveSupportRequest = (
        /\b(live\s*(support|agent|person|chat|help)|talk\s*to\s*(a\s*)?(human|person|agent|someone|representative|rep)|speak\s*(to|with)\s*(a\s*)?(human|person|agent|someone)|real\s*(person|human|agent)|customer\s*service|call\s*(someone|support)|phone\s*(number|support)|contact\s*(hr|support|someone)|get\s*(me\s*)?(a\s*)?(human|person|agent))\b/i.test(query)
    );
    if (isLiveSupportRequest) {
        const nameRef = session.userName && session.userName !== 'Guest' ? session.userName : 'there';
        const msg = `I understand you'd like to speak with someone directly, ${nameRef}. You can reach AmeriVet's HR/Benefits team at ${HR_PHONE} for personalized assistance. You can also visit the enrollment portal at ${ENROLLMENT_PORTAL_URL} for self-service options.\n\nIs there anything else I can help you with in the meantime?`;
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
    }

    // INTERCEPT: SUMMARY REQUEST
    // ========================================================================
    if (isSummaryRequest(query)) {
        const nameRef = session.userName && session.userName !== 'Guest' ? session.userName : 'there';
        const decisions = session.decisionsTracker || {};
        const msg = compileSummary(decisions, nameRef);
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
    }

    // CUSTOM INTERCEPT: Accident plan name inquiry
    const planNumbersQuery = /plan\s*1\b.*plan\s*2/i.test(lowerQuery);
    if (planNumbersQuery && /\baccident\b/i.test(lowerQuery)) {
        const msg = `There are two accident policy options: **Accident Plan 1** and **Accident Plan 2**. ` +
                    `Plan 1 typically has a higher premium with more comprehensive benefits, while Plan 2 has a lower premium but lower benefit limits. ` +
                    `Refer to the Accident Insurance summary for exact details, or contact HR at ${HR_PHONE}.`;
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'accident-plan-names' } });
    }

    // CUSTOM INTERCEPT: Simple recommendation request ("I'm single and healthy, what do you recommend?")
    // Returns deterministic Employee Only pricing instead of relying on LLM to hallucinate numbers
    const recommendRequested = /\b(recommend|suggestion|which plan|what plan|what do you recommend|best plan)\b/i.test(lowerQuery);
    const singleHealthy = /\b(single|healthy|just me|only me|individual|no dependents)\b/i.test(lowerQuery);
    if (recommendRequested && singleHealthy) {
      const rows = pricingUtils.buildPerPaycheckBreakdown('Employee Only', session.payPeriods || 26);
      // Filter to medical-only and exclude Kaiser for non-CA users
      const medRows = rows.filter(r => !/dental|vision/i.test(r.plan) && r.provider !== 'VSP');
      const filtered = session.userState && session.userState.toUpperCase() !== 'CA'
        ? medRows.filter(r => !/kaiser/i.test(r.plan))
        : medRows;
        let msg = `Great question! For a single, healthy individual, here are your medical plan options (Employee Only):\n\n`;
        for (const r of filtered) {
        msg += `- **${r.plan}**: $${pricingUtils.formatMoney(r.perMonth)}/month ($${pricingUtils.formatMoney(r.annually)}/year)\n`;
        }
        msg += `\nFor a single, healthy employee with low expected usage, **Standard HSA** is often a strong choice because it has the lowest premium and is HSA-eligible. If you expect more usage (or want a lower deductible), **Enhanced HSA** typically provides better cost protection at a higher premium.`;
        if (filtered.some(r => /kaiser/i.test(r.plan))) {
          msg += ` If you're in a Kaiser service area, **Kaiser Standard HMO** can be a good fit for people who prefer an integrated network.`;
        }
        msg += `\n\nWould you like help choosing based on your expected usage (low/moderate/high) or comparing total annual cost?`;
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'recommend-single' } });
    }

    // CUSTOM INTERCEPT: Direct plan pricing lookup (deterministic)
    // Catches "how much is Standard HSA?", "Enhanced HSA cost", "what does Kaiser cost"
    // Prevents LLM from hallucinating plan prices by returning canonical data (Issue 1 fix)
    const planNamesRegex = /\b(standard\s*hsa|enhanced\s*hsa|kaiser\s*(?:standard\s*)?(?:hmo)?|dental\s*ppo|vision\s*plus|bcbstx\s*dental|vsp)\b/i;
    const pricingQuestion = /\b(how much|cost|price|premium|rate|what does|pricing|what is|how expensive)\b/i;
    const isCostModelingQuery = /(?:calculate|projected?|estimate|next year|for \d{4}|usage)/i.test(lowerQuery);
    const planNameMatch = lowerQuery.match(planNamesRegex);
    if (planNameMatch && pricingQuestion.test(lowerQuery) && !/per[\s-]*pay/i.test(lowerQuery) && !isCostModelingQuery) {
      const coverageTier = extractCoverageFromQuery(query);
      const payPeriods = session.payPeriods || 26;
      const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);
      const targetPlan = planNameMatch[1].toLowerCase().replace(/\s+/g, ' ').trim();
      const matchedRow = rows.find(r => {
        const rLow = r.plan.toLowerCase();
        return rLow.includes(targetPlan) || targetPlan.split(' ').every((w: string) => rLow.includes(w));
      });
      if (matchedRow) {
        // Filter Kaiser for non-CA users
        if (/kaiser/i.test(matchedRow.plan) && session.userState && session.userState.toUpperCase() !== 'CA') {
          const msg = `Kaiser Standard HMO is only available in California. Since you're in ${session.userState}, your medical plan options are **Standard HSA** and **Enhanced HSA**. Would you like pricing for those?`;
          session.lastBotMessage = msg;
          await updateSession(sessionId, session);
          return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'plan-pricing-kaiser-unavailable' } });
        }
        let msg = `Here's the pricing for **${matchedRow.plan}** (${coverageTier}):\n\n`;
        msg += `- **$${pricingUtils.formatMoney(matchedRow.perMonth)}/month** ($${pricingUtils.formatMoney(matchedRow.annually)}/year)\n`;
        msg += `- Per paycheck (${payPeriods} pay periods): $${pricingUtils.formatMoney(matchedRow.perPaycheck)}\n`;
        msg += `\nWould you like to compare this with other plans, or see pricing for a different coverage tier?`;
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'plan-pricing' } });
      }
    }

    // CUSTOM INTERCEPT: Medical plan comparison / overview (deterministic)
    // Catches "compare medical plans", "show me medical options", "medical plan costs" (Issue 1 fix)
    const hasMedicalKeyword = /\b(medical|health)\b/i.test(lowerQuery);
    const hasPlanKeyword = /\b(plan|option|coverage)s?\b/i.test(lowerQuery);
    const hasCompareKeyword = /\b(compare|comparison|option|show|list|available|costs?|prices?|premiums?)\b/i.test(lowerQuery);
    const medicalComparisonRequested = hasMedicalKeyword && hasPlanKeyword && hasCompareKeyword && !/per[\s-]*pay/i.test(lowerQuery) && !isCostModelingQuery;
    if (medicalComparisonRequested && !(recommendRequested && singleHealthy)) {
      const coverageTier = extractCoverageFromQuery(query);
      const payPeriods = session.payPeriods || 26;
      const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);
      const medRows = rows.filter(r => !/dental|vision/i.test(r.plan) && r.provider !== 'VSP');
      const filtered = session.userState && session.userState.toUpperCase() !== 'CA'
        ? medRows.filter(r => !/kaiser/i.test(r.plan))
        : medRows;
      let msg = `Here are the available medical plans for the **${coverageTier}** tier:\n\n`;
      for (const r of filtered) {
        msg += `- **${r.plan}** (${r.provider}): **$${pricingUtils.formatMoney(r.perMonth)}/month** ($${pricingUtils.formatMoney(r.annually)}/year)\n`;
      }
      if (filtered.length < medRows.length) {
        msg += `\n_Note: Kaiser Standard HMO is available only in California._\n`;
      }
      msg += `\nWould you like more detail on any plan, a different coverage tier, or to move on to Dental/Vision?`;
      session.lastBotMessage = msg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'medical-comparison' } });
    }

    // CUSTOM INTERCEPT: HSA / Savings recommendation (deterministic)
    // Catches "savings recommendation", "HSA advice", "tax savings" etc. that otherwise fall to RAG and hallucinate
    const savingsRequested = /\b(savings?\s*(recommend|advice|scenario|strategy|tip)|hsa\s*(recommend|advice|benefit|advantage|savings)|tax\s*(savings?|advantage|benefit)\s*(plan|account|option)?|pre-?tax\s*(dollar|saving|benefit))\b/i.test(lowerQuery);
    if (savingsRequested) {
      const rows = pricingUtils.buildPerPaycheckBreakdown('Employee Only', session.payPeriods || 26);
      const hsaPlans = rows.filter(r => /hsa/i.test(r.plan));
      let msg = `Here's a savings-focused recommendation for your tax-advantaged benefit options:\n\n`;
      msg += `**Health Savings Account (HSA) Plans:**\n`;
      for (const r of hsaPlans) {
        msg += `- **${r.plan}**: $${pricingUtils.formatMoney(r.perMonth)}/month ($${pricingUtils.formatMoney(r.annually)}/year)\n`;
      }
      msg += `\n**HSA Tax Advantages:**\n`;
      msg += `- Contributions are deducted **pre-tax** from your paycheck, lowering your taxable income\n`;
      msg += `- Funds grow **tax-free** (interest and investments)\n`;
      msg += `- Withdrawals for eligible medical expenses are **tax-free** (triple tax advantage)\n`;
      msg += `- Unused funds **roll over** year to year — there is no "use it or lose it"\n`;
      msg += `- The account is **yours** — it stays with you even if you leave AmeriVet\n`;
      msg += `\n**Also consider:**\n`;
      msg += `- **FSA (Flexible Spending Account)**: Pre-tax dollars for healthcare expenses, but funds typically don't roll over\n`;
      msg += `- **Commuter Benefits**: Pre-tax transit and parking deductions\n`;
      msg += `\n${session.userAge && session.userAge >= 55 ? 'Since you are 55+, you\'re eligible for an additional **$1,000 HSA catch-up contribution** per year. ' : ''}For personalized rates and enrollment, visit Workday: ${ENROLLMENT_PORTAL_URL}`;
      session.lastBotMessage = msg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'savings-recommendation' } });
    }

    // CUSTOM INTERCEPT: Cost modeling request
    // User wants projected expenses or advanced cost comparison
    // Tightened regex: require explicit cost-modeling language, avoid matching generic "low"/"high"
    const costModelRequested = /(?:calculate|projected?|estimate).*(?:cost|expense)|healthcare costs.*(?:next year|for \d{4})|(?:low|moderate|high)\s+usage/i.test(lowerQuery);
    if (costModelRequested) {
        // try to parse usage level
        const usageMatch = lowerQuery.match(/(low|moderate|high)\s+usage/);
        const usage: any = usageMatch ? usageMatch[1] as 'low'|'moderate'|'high' : 'moderate';
        const coverageTier = lowerQuery.includes('family') || /family\s*(?:of)?\s*\d|family\d/i.test(lowerQuery) ? 'Employee + Family' : (lowerQuery.includes('child') ? 'Employee + Child(ren)' : 'Employee Only');
        const networkMatch = lowerQuery.match(/kaiser|ppo|hsa|hmo/i);
        const network = networkMatch ? networkMatch[0] : undefined;
        const msg = pricingUtils.estimateCostProjection({ coverageTier, usage, network, state: session.userState || undefined, age: session.userAge || undefined });
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'cost-model' } });
    }

    // CUSTOM INTERCEPT: Maternity coverage comparison
    // Default to Employee + Child for maternity (having a baby implies a dependent)
    const maternityRequested = /maternity|baby|pregnan|birth|deliver/i.test(lowerQuery);
    if (maternityRequested) {
        const coverageTier = lowerQuery.includes('family') ? 'Employee + Family'
            : lowerQuery.includes('employee only') ? 'Employee Only'
            : 'Employee + Child(ren)'; // sensible default for maternity
        const msg = pricingUtils.compareMaternityCosts(coverageTier, session.userState || null);
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'maternity' } });
    }

    // CUSTOM INTERCEPT: Orthodontics/braces direct answer (deterministic)
    // Uses canonical dental plan data — no LLM hallucination possible
    const orthoRequested = /orthodont|braces|\bortho\b|dental\s*(?:cover|include).*(?:ortho|brace)/i.test(lowerQuery);
    if (orthoRequested) {
      const dental = pricingUtils.getDentalPlanDetails();
      let msg = `Yes! The **${dental.name}** (${dental.provider}) includes orthodontia coverage. Here are the key details:\n\n`;
      msg += `- **Orthodontia copay**: $${dental.orthoCopay} (your share after the plan pays)\n`;
      msg += `- **Deductible**: $${dental.deductible} individual / $${dental.familyDeductible} family\n`;
      msg += `- **Coinsurance**: Preventive 100% covered, Basic services 80/20, Major services 50/50\n`;
      msg += `- **Out-of-pocket max**: $${pricingUtils.formatMoney(dental.outOfPocketMax)}\n`;
      msg += `- **Waiting period**: 6 months for major services\n`;
      msg += `- **Network**: Nationwide PPO\n`;
      msg += `\n**Monthly premiums:**\n`;
      msg += `- Employee Only: $${pricingUtils.formatMoney(dental.tiers.employeeOnly)}\n`;
      msg += `- Employee + Child(ren): $${pricingUtils.formatMoney(dental.tiers.employeeChildren)}\n`;
      msg += `- Employee + Family: $${pricingUtils.formatMoney(dental.tiers.employeeFamily)}\n`;
      msg += `\nOrthodontic coverage typically applies to both children and adults. For the full Dental Summary with age limits and lifetime maximums, check in Workday: ${ENROLLMENT_PORTAL_URL}`;
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'orthodontics' } });
    }

    // INTERCEPT: DECISION DETECTION (Track user choices for summary)
    // ========================================================================
    const decision = detectDecision(query);
    if (decision) {
        if (!session.decisionsTracker) session.decisionsTracker = {};
        session.decisionsTracker[decision.category] = {
            status: decision.status,
            value: decision.decision,
            updatedAt: Date.now(),
            source: 'user'
        };
        if (!session.completedTopics) session.completedTopics = [];
        if (!session.completedTopics.includes(decision.category)) {
            session.completedTopics.push(decision.category);
        }
        logger.debug(`[DECISION] ${decision.status === 'selected' ? '?' : '?'} ${decision.category}: ${decision.decision}`);
        
        // Build response acknowledging the decision + suggest remaining benefits
        const nameRef = session.userName && session.userName !== 'Guest' ? session.userName : 'there';
        const remaining = getRemainingBenefits(session.decisionsTracker);
        let msg: string;
        if (decision.status === 'selected') {
            msg = `Great choice, ${nameRef}! I've noted that you'd like to go with ${decision.decision} for ${decision.category}.`;
        } else {
            msg = `Got it, ${nameRef}! I've noted that you're skipping ${decision.category} for now.`;
        }
        msg += `\n\nWhen you're ready to enroll, visit the portal at ${ENROLLMENT_PORTAL_URL}`;
        if (remaining.length > 0) {
            msg += `\n\nWould you like to explore any of your other benefits? You still have: ${remaining.join(', ')}`;
        } else {
            msg += `\n\nYou've now reviewed all your available benefits! You can say "summary" anytime to see a recap of your decisions.`;
        }
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
    }

    // PHASE 3: STATEFUL GUARDED AGENT ARCHITECTURE
    // ========================================================================
    // Senior Engineer Approach:
    // 1. Semantic Router ? Classify intent BEFORE retrieval
    // 2. State Gate ? Ensure we have required user info
    // 3. Filtered Retrieval ? Only fetch relevant docs
    // 4. Validation Pipeline ? Verify quality
    // 5. Post-Processing ? Apply Brandon Rule, format response
    
    // STEP 1: SEMANTIC ROUTER (Prevents "Medical Loop" bug)
    const routerResult = routeIntent(query);
    logger.debug(`[ROUTER] Category: ${routerResult.category}, Confidence: ${(routerResult.confidence * 100).toFixed(0)}%`);
    
    // STEP 2: AGE-BANDED PRODUCT CHECK (Refuse specific costs)
    const ageBandedResponse = getAgeBandedResponse(routerResult.category, routerResult);
    if (ageBandedResponse) {
        logger.debug(`[QA] Age-banded product detected, returning portal redirect`);
        session.lastBotMessage = ageBandedResponse;
        await updateSession(sessionId, session);
        return NextResponse.json({ 
            answer: ageBandedResponse, 
            tier: 'L1', 
            sessionContext: buildSessionContext(session),
            metadata: { category: routerResult.category, ageBanded: true }
        });
    }
    
    // STEP 3: BUILD CONTEXT WITH ROUTER FILTERS
    const explicitCategory = extractCategory(query);
    const category = explicitCategory || (routerResult.category !== 'GENERAL' ? routerResult.category : null);
    const explicitCategoryRequested = !!explicitCategory;
    
    // Enhanced context with user demographics + router filters
    const context: RetrievalContext & { userAge?: number; userState?: string } = {
      companyId,
      state: session.userState || 'National',
      dept: session.context?.dept,
      category: category || undefined,
      // NEW: Pass user demographics for query enhancement
      userAge: session.userAge === null ? undefined : session.userAge,
      userState: session.userState === null ? undefined : session.userState
    };

    // QUICK INTERCEPT: per-paycheck deterministic breakdown when user asks explicitly
    const perPaycheckRequested = /per[\s-]*pay(?:check|\s*period)?\b|per[\s-]*pay\b|\bbiweekly\b|\bbi-weekly\b/i.test(query);
    // Separate signals for total deduction detection (handles multiline and varied phrasings)
    const enrollAllSignal = /\b(enroll\s+in\s+all(?:\s+benefits)?|sign\s+(?:me\s+)?up\s+for\s+(?:all|everything)|all\s+benefits|every\s+benefit|everything)\b/i.test(query);
    const deductionQuestionSignal = /\b(deduct(?:ion|ed|ions)?|per[\s-]*pay(?:check|period)?|how\s+much|total|cost|what\s+would)\b/i.test(query);
    const explicitTotalDeduction = /\b(total\s+deduct(?:ion|ed|ions)?|total\s+(?:monthly|annual)\s+(?:cost|premium)|how\s+much\s+(?:would\s+)?(?:be\s+)?deducted)\b/i.test(query);
    const totalDeductionRequested = (enrollAllSignal && deductionQuestionSignal) || explicitTotalDeduction;

    function extractCoverageFromQuery(q: string): string {
      const low = q.toLowerCase();
      // Employee + Family (including natural language like "family of 4", "family plan")
      if (/employee\s*\+?\s*family|family\s*(of|plan|coverage)|family\s*\d|for\s*(my|the|our)\s*family/i.test(low)) return 'Employee + Family';
      // Employee + Spouse
      if (/employee\s*\+?\s*spouse|spouse|husband|wife|partner/i.test(low)) return 'Employee + Spouse';
      // Employee + Child(ren) (including "child coverage", "for my kid(s)")
      if (/employee\s*\+?\s*child|child(?:ren)?\s*coverage|for\s*(my|the)\s*(kid|child|son|daughter)|dependent\s*child/i.test(low)) return 'Employee + Child(ren)';
      // Employee Only
      if (/employee\s*only|individual|single|just\s*me|only\s*me/i.test(low)) return 'Employee Only';
      return 'Employee Only';
    }

    // INTERCEPT: Total deduction calculation — checked BEFORE generic per-paycheck
    // so "enroll in all benefits per paycheck" triggers the total, not the per-plan breakdown.
    if (totalDeductionRequested) {
      const coverageTier = extractCoverageFromQuery(query);
      const payPeriods = session.payPeriods || 26;

      // Try saved selections first
      const monthlyFromSelections = session.decisionsTracker
        ? pricingUtils.computeTotalMonthlyFromSelections(session.decisionsTracker, coverageTier)
        : 0;

      if (monthlyFromSelections > 0) {
        // User has confirmed plan selections — use them
        const perPay = Number(((monthlyFromSelections * 12) / payPeriods).toFixed(2));
        const annual = Number((monthlyFromSelections * 12).toFixed(2));
        const msg = `Based on your selected benefits, estimated deductions are $${pricingUtils.formatMoney(perPay)} per paycheck ($${pricingUtils.formatMoney(monthlyFromSelections)}/month, $${pricingUtils.formatMoney(annual)}/year).\n\nThis includes only the plan premiums I can calculate from your saved selections. For exact deductions during enrollment (and any age-banded voluntary benefits), confirm in Workday: ${ENROLLMENT_PORTAL_URL}`;
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'total-deduction' } });
      }

      // Fallback: "enroll in ALL benefits" — pick ONE medical plan + dental + vision
      // Users can only enroll in ONE medical plan, so show a range (cheapest → most expensive)
      const allRows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);
      // Filter region-limited plans if we know the user's state
      const regionFiltered = session.userState && session.userState.toUpperCase() !== 'CA'
        ? allRows.filter(r => !/kaiser/i.test(r.plan))
        : allRows;

      // Separate medical vs non-medical (dental + vision)
      const medicalRows = regionFiltered.filter(r => !/dental|vision/i.test(r.plan) && r.provider !== 'VSP');
      const nonMedicalRows = regionFiltered.filter(r => /dental|vision/i.test(r.plan) || r.provider === 'VSP');
      const nonMedicalMonthly = Number(nonMedicalRows.reduce((sum, r) => sum + r.perMonth, 0).toFixed(2));

      // Calculate range: cheapest medical + non-medical → most expensive medical + non-medical
      const cheapestMed = medicalRows.reduce((min, r) => r.perMonth < min.perMonth ? r : min, medicalRows[0]);
      const priciest = medicalRows.reduce((max, r) => r.perMonth > max.perMonth ? r : max, medicalRows[0]);
      const minMonthly = Number((cheapestMed.perMonth + nonMedicalMonthly).toFixed(2));
      const maxMonthly = Number((priciest.perMonth + nonMedicalMonthly).toFixed(2));
      const minPerPay = Number(((minMonthly * 12) / payPeriods).toFixed(2));
      const maxPerPay = Number(((maxMonthly * 12) / payPeriods).toFixed(2));

      let msg = `Great question! You can only enroll in **one** medical plan, so your total deduction depends on which one you choose. Here's the range for all benefits at the **${coverageTier}** tier:\n\n`;
      msg += `**Estimated total: $${pricingUtils.formatMoney(minPerPay)} – $${pricingUtils.formatMoney(maxPerPay)} per paycheck** ($${pricingUtils.formatMoney(minMonthly)} – $${pricingUtils.formatMoney(maxMonthly)}/month)\n\n`;
      msg += `**Medical options (choose one):**\n`;
      for (const r of medicalRows) {
        msg += `- ${r.plan}: $${pricingUtils.formatMoney(r.perPaycheck)} per paycheck ($${pricingUtils.formatMoney(r.perMonth)}/month)\n`;
      }
      msg += `\n**Plus these standard benefits:**\n`;
      for (const r of nonMedicalRows) {
        msg += `- ${r.plan}: $${pricingUtils.formatMoney(r.perPaycheck)} per paycheck ($${pricingUtils.formatMoney(r.perMonth)}/month)\n`;
      }
      msg += `\n**Important:** Voluntary benefits (Life/Disability/Critical Illness/Accident) are age-banded and not included above. Check Workday for your personalized voluntary rates.\n`;
      if (!session.userState) {
        msg += `\nNote: Some plans are region-limited (for example, Kaiser availability depends on your state). If you share your state, I can filter to only the plans available to you.\n`;
      }
      msg += `\nFor your exact payroll deductions during enrollment, please verify in Workday: ${ENROLLMENT_PORTAL_URL}`;
      session.lastBotMessage = msg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'total-deduction', allPlans: true } });
    }

    if (perPaycheckRequested) {
      const coverageTier = extractCoverageFromQuery(query);
      const payPeriods = session.payPeriods || 26;
      const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);

      // Default to medical-only when user didn't explicitly ask about other benefit types.
      const wantsNonMedical = /\b(dental|vision|life|disability|accident|critical illness|hospital indemnity|voluntary)\b/i.test(query);
      const medicalOnly = wantsNonMedical ? rows : rows.filter(r => !/dental|vision/i.test(r.plan) && r.provider !== 'VSP');

      // Hide region-limited plans if we know the user's state doesn't support them.
      const filtered = session.userState && session.userState.toUpperCase() !== 'CA'
        ? medicalOnly.filter(r => !/kaiser/i.test(r.plan))
        : medicalOnly;

      const benefitLabel = wantsNonMedical ? 'benefit' : 'medical plan';
      let msg = `Here are the estimated **${benefitLabel}** premiums for **${coverageTier}** (based on ${payPeriods} pay periods/year):\n`;
      for (const r of filtered) {
        msg += `- ${r.plan}: $${pricingUtils.formatMoney(r.perPaycheck)} per paycheck ($${pricingUtils.formatMoney(r.perMonth)}/month, $${pricingUtils.formatMoney(r.annually)}/year)\n`;
      }

      if (!session.userState) {
        msg += `\nNote: Some plans are region-limited (for example, Kaiser availability depends on your state). If you share your state, I can filter to only the plans available to you.`;
      }
      msg += `\nFor your exact payroll deductions during enrollment, please verify in Workday: ${ENROLLMENT_PORTAL_URL}`;
      session.lastBotMessage = msg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'per-paycheck' } });
    }

    logger.debug(`[RAG] Searching with Context - Category: ${category}, HasAge: ${!!session.userAge}, HasState: ${!!session.userState}`);

    // 2. HYBRID SEARCH (Vector + BM25 with Category Filter + Query Expansion)
    let result = await hybridRetrieve(query, context);
    
    // 3. RUN VALIDATION PIPELINE (3 Gates)
    // ========================================================================
    // Gate 1: Retrieval Validation (RRF scores)
    // Gate 2: Reasoning Validation (Context relevance)
    // Gate 3: Output Validation (Faithfulness - done post-generation)
    
    let pipelineResult = runValidationPipeline({
      chunks: result.chunks || [],
      rrfScores: result.scores?.rrf || [],
      bm25Scores: result.scores?.bm25 || [],
      vectorScores: result.scores?.vector || [],
      query,
      userState: session.userState ?? null,
      userAge: session.userAge ?? null,
      requestedCategory: category,
    });
    
    logger.debug(`[PIPELINE] Initial: Retrieval=${pipelineResult.retrieval.passed ? '?' : '?'}, Reasoning=${pipelineResult.reasoning.passed ? '?' : '?'}, Action=${pipelineResult.suggestedAction}`);

    // 4. HANDLE PIPELINE RESULTS
    // ========================================================================
    
    // CASE A: Retrieval failed - try query expansion
    if (!pipelineResult.retrieval.passed || pipelineResult.suggestedAction === 'expand_query') {
        logger.debug(`[PIPELINE] Triggering query expansion...`);
        
      // If the user explicitly asked for a specific category (e.g., "medical"), do NOT drop the category filter.
      // Dropping the filter can return unrelated voluntary/accident docs and confuse pricing.
      if (category && explicitCategoryRequested) {
        logger.debug('[PIPELINE] Explicit category requested; skipping expansion to avoid cross-category leakage');
        // Offer an alternative message instead of expanding
        const alt = `I searched our documents for ${category} plans but couldn't find confident pricing for your request. Please try rephrasing (for example: "How much per paycheck for Employee + Child under PPO?") or check the enrollment portal at ${ENROLLMENT_PORTAL_URL} for the exact rate.`;
        session.lastBotMessage = alt;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: alt, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { expanded: false, explicitCategoryRequested } });
      }

      // Expand search by removing category filter when the category was NOT explicitly requested
      if (category) {
        const wideContext = { ...context, category: undefined };
        result = await hybridRetrieve(query, wideContext);
            
        // Re-run validation
        pipelineResult = runValidationPipeline({
          chunks: result.chunks || [],
          rrfScores: result.scores?.rrf || [],
          bm25Scores: result.scores?.bm25 || [],
          vectorScores: result.scores?.vector || [],
          query,
          userState: session.userState ?? null,
          userAge: session.userAge ?? null,
          requestedCategory: null, // Expanded search
        });
            
        logger.debug(`[PIPELINE] After expansion: Retrieval=${pipelineResult.retrieval.passed ? '?' : '?'}, Reasoning=${pipelineResult.reasoning.passed ? '?' : '?'}`);
      }
    }
    
    // CASE B: No results at all
    if (!result.chunks?.length) {
        const msg = intent.isContinuation 
            ? `I'm ready! What topic should we cover first? Available benefits include: ${ALL_BENEFITS_SHORT}`
            : "I checked our benefits documents, but I couldn't find any information matching that request. Could you try rephrasing or specify which benefit you're asking about?";
        return NextResponse.json({ 
            answer: msg, 
            sessionContext: buildSessionContext(session),
            validation: {
                retrieval: pipelineResult.retrieval,
                reasoning: pipelineResult.reasoning,
                overallPassed: false
            }
        });
    }
    
    // CASE C: Reasoning failed - offer alternative
    if (!pipelineResult.reasoning.passed && pipelineResult.suggestedAction === 'offer_alternative') {
        const alternativeMsg = generateAlternativeResponse(pipelineResult, category, session.userState ?? null);
        logger.debug(`[PIPELINE] Offering alternative: "${alternativeMsg}"`);
        
        // Don't fail completely - use the alternative as a helpful response
        session.lastBotMessage = alternativeMsg;
        await updateSession(sessionId, session);
        
        return NextResponse.json({ 
            answer: alternativeMsg, 
            tier: 'L1',
            sessionContext: buildSessionContext(session),
            validation: {
                retrieval: pipelineResult.retrieval,
                reasoning: pipelineResult.reasoning,
                overallPassed: false,
                suggestedAction: pipelineResult.suggestedAction
            }
        });
    }
    
    // Determine confidence tier and scores from validation pipeline
    const topScore = Math.max(
        pipelineResult.retrieval.score,
        ...((result.scores?.rrf || []).slice(0, 3)),
        0.01 // Fallback to prevent NaN
    );
    
    const confidenceTier = pipelineResult.retrieval.score >= 0.7 ? 'HIGH' 
        : pipelineResult.retrieval.score >= 0.4 ? 'MEDIUM' 
        : 'LOW';
    
    // Determine if we need a disclaimer based on validation scores
    const useDisclaimer = !pipelineResult.overallPassed || 
        pipelineResult.retrieval.metadata?.needsDisclaimer ||
        pipelineResult.reasoning.metadata?.needsDisclaimer ||
        pipelineResult.retrieval.score < 0.7;

    // 5. GENERATE ANSWER (With Chain-of-Thought Validation Instructions)
    const contextText = result.chunks.map((c, i) => `[Source ${i+1}: ${(c as any).title || 'Document'}] ${c.content}`).join('\n\n');
    
    const systemPrompt = buildSystemPrompt(session);
    
    // Build conversation history for context
    const historyText = (session.messages || []).slice(-4)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

    // Chain-of-Thought validation instruction
    const cotValidation = `
CHAIN-OF-THOUGHT VALIDATION (Internal reasoning before answering):
1. Do the context documents contain information about ${category || 'benefits'} plans?
2. Is there specific information for ${session.userState || 'the user\'s'} state?
3. Are there cost/eligibility details relevant to age ${session.userAge || 'the user'}?

If ANY of these are true, provide a helpful answer. If the exact match isn't found but related info exists, say:
"Based on the plans I found, [provide the closest match]. Would you like more details about [specific alternative]?"`;

    // Confidence-based instruction addendum
    const confidenceInstruction = useDisclaimer
        ? `\nIMPORTANT: Confidence is moderate. Start your response with "Based on the plans I found..." and give your best answer from the available context. Do NOT say "I'm not sure" - be helpful!`
        : `\nConfidence is high. Answer directly and confidently.`;

    // Found categories for alternative suggestions
    const foundCategories = pipelineResult.reasoning.metadata?.foundCategories as string[] | undefined;
    const alternativeHint = foundCategories && foundCategories.length > 0 && category && !foundCategories.includes(category)
        ? `\nNOTE: If ${category} info is missing, mention that you found ${foundCategories.join(' and ')} plans and offer to show those.`
        : '';

    const promptTemplate = `You are the AmeriVet Benefits AI Assistant. Use the provided benefit documents to answer the user's question.
${cotValidation}

CONTEXT DOCUMENTS:
${contextText}

USER DEMOGRAPHICS:
- Age: ${session.userAge}
- State: ${session.userState}

CONVERSATION HISTORY:
${historyText}

CURRENT QUESTION: ${query}

INSTRUCTIONS:
- Use the context documents to provide a specific, helpful answer
- ALWAYS cite the source (e.g., "According to Source 1..." or "The Medical Plan document shows...")
- Include relevant plan details, costs, and eligibility requirements
- Be conversational and friendly while being accurate
- If asked about costs or plan options, reference the user's age (${session.userAge}) and state (${session.userState})
- Don't ask for information we already have (age: ${session.userAge}, state: ${session.userState})
- NEVER say "I'm not 100% sure" - be confident and helpful
- If exact match not found, offer the CLOSEST alternative (e.g., "I found the HMO plan details. Would you also like PPO?")
${confidenceInstruction}${alternativeHint}

Answer:`;

    logger.debug(`[RAG] Generating answer with ${result.chunks.length} chunks`);

    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: promptTemplate }
    ], { temperature: 0.1 });

    let answer = completion.content.trim();
    answer = enforceMonthlyFirstFormat(answer);
    answer = validatePricingFormat(answer);

    // Normalize pricing mentions to monthly-first canonical form and enforce state consistency
    try {
      answer = pricingUtils.normalizePricingInText(answer, session.payPeriods || 26);
      answer = pricingUtils.ensureStateConsistency(answer, session.userState || null);
      answer = cleanResponseText(answer);  // Remove repeated phrases and duplicate sentences
    } catch (e) {
      logger.warn('[QA] Pricing normalization failed:', e);
    }
    
    // POST-PROCESSING: Strip banned content (Rightway, wrong phone numbers)
    if (/rightway/i.test(answer)) {
        logger.warn('[QA] Stripped Rightway reference from LLM response');
        answer = answer.replace(/[^.]*[Rr]ightway[^.]*\./g, '').trim();
        // If stripping left the answer empty or broken, provide fallback
        if (answer.length < 20) {
            answer = "For live support or additional assistance, please contact AmeriVet HR/Benefits at ${HR_PHONE}. You can also visit the enrollment portal at ${ENROLLMENT_PORTAL_URL} for self-service options.\n\nIs there anything else I can help you with?";
        }
    }
    // Strip the (305) 851-7310 number if it appears - replace with real HR number
    answer = answer.replace(/\(?\s*305\s*\)?\s*[-.]?\s*851\s*[-.]?\s*7310/g, 'AmeriVet HR/Benefits at ${HR_PHONE}');

    // POST-PROCESSING: Apply Brandon Rule (HSA Cross-Sell)
    
    // POST-PROCESSING: Orthodontics grounding check
    if (/orthodont/i.test(answer) && !result.chunks.some(c => /orthodont/i.test(c.content))) {
        logger.warn('[QA] Removed ungrounded orthodontics claim from answer');
        answer = answer.replace(/[^.]*orthodont[^.]*\./gi, '').trim();
    }

    answer = applyBrandonRule(answer, routerResult);

    logger.debug(`[RAG] Final answer generated (${answer.length} chars) with ${result.chunks?.length || 0} citations`);

    session.lastBotMessage = answer;
    
    // Store message in session history for future context
    if (!session.messages) session.messages = [];
    session.messages.push(
        { role: 'user', content: query },
        { role: 'assistant', content: answer }
    );
    // Keep only last 6 messages (3 exchanges) for context
    if (session.messages.length > 6) {
        session.messages = session.messages.slice(-6);
    }
    
    await updateSession(sessionId, session);

    return NextResponse.json({
      answer,
      tier: 'L1',
      citations: result.chunks,
      sessionContext: buildSessionContext(session),
      metadata: {
        category: category,
        chunksUsed: result.chunks?.length || 0,
        sessionId,
        confidenceTier,
        usedDisclaimer: useDisclaimer,
        topScore: topScore.toFixed(3),
        userAge: session.userAge,
        userState: session.userState,
        // Router result (Senior Engineer approach)
        router: {
          category: routerResult.category,
          confidence: routerResult.confidence,
          triggersHSACrossSell: routerResult.triggersHSACrossSell,
          requiresAgeBand: routerResult.requiresAgeBand
        },
        validation: {
          retrieval: pipelineResult.retrieval,
          reasoning: pipelineResult.reasoning,
          output: pipelineResult.output,
          overallPassed: pipelineResult.overallPassed
        }
      }
    });

  } catch (error) {
    // Enhanced error logging for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : 'No stack trace';
    logger.error('[QA] Error:', errorMessage);
    logger.error('[QA] Stack:', errorStack);

    // RESILIENCE: Try a deterministic fallback for common query types even on failure
    try {
      const fallbackQuery = (parsedBody?.query || '').toLowerCase();
      const isPaycheckQ = /per\s*pay(?:check|\s*period)?/i.test(fallbackQuery);
      const isOrthoQ = /orthodont|braces/i.test(fallbackQuery);

      if (isPaycheckQ) {
        const rows = pricingUtils.buildPerPaycheckBreakdown('Employee Only', 26);
        let msg = `Here are the estimated Employee Only premiums (based on 26 pay periods/year):\n`;
        for (const r of rows) {
          msg += `- ${r.plan}: $${pricingUtils.formatMoney(r.perPaycheck)} per paycheck ($${pricingUtils.formatMoney(r.perMonth)}/month)\n`;
        }
        msg += `\nFor other coverage tiers or exact deductions, visit Workday: ${ENROLLMENT_PORTAL_URL}`;
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: null, metadata: { fallback: true } }, { status: 200 });
      }

      if (isOrthoQ) {
        const dental = pricingUtils.getDentalPlanDetails();
        const msg = `Yes, the ${dental.name} includes orthodontia coverage with a $${dental.orthoCopay} copay. Deductible: $${dental.deductible} individual. For the full Dental Summary, visit Workday: ${ENROLLMENT_PORTAL_URL}`;
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: null, metadata: { fallback: true } }, { status: 200 });
      }
    } catch (fallbackErr) {
      logger.error('[QA] Fallback also failed:', fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
    }
    
    return NextResponse.json({ 
      answer: `I hit a temporary issue processing your request. Please try again, or for immediate help contact AmeriVet HR/Benefits at ${HR_PHONE}. You can also visit the enrollment portal at ${ENROLLMENT_PORTAL_URL}.`,
      error: errorMessage,
      tier: 'L1',
      sessionContext: null  // Session may be corrupted
    }, { status: 200 });
  }
}