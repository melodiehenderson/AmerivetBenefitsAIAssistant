import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import type { RetrievalContext, Chunk } from '@/types/rag';
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
import { amerivetBenefits2024_2025, getCatalogForPrompt } from '@/lib/data/amerivet';

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

// Kaiser HMO is ONLY available in these states — DO NOT show it anywhere else
const KAISER_STATES = new Set(['CA', 'WA', 'OR']);

// City → State resolver: if user provides a city, resolve state automatically (No-Loop Rule)
const CITY_TO_STATE: Record<string, string> = {
  'chicago': 'IL', 'los angeles': 'CA', 'san francisco': 'CA', 'san diego': 'CA',
  'seattle': 'WA', 'portland': 'OR', 'houston': 'TX', 'dallas': 'TX', 'austin': 'TX',
  'san antonio': 'TX', 'phoenix': 'AZ', 'denver': 'CO', 'atlanta': 'GA',
  'miami': 'FL', 'orlando': 'FL', 'tampa': 'FL', 'jacksonville': 'FL',
  'new york': 'NY', 'brooklyn': 'NY', 'manhattan': 'NY', 'queens': 'NY',
  'boston': 'MA', 'philadelphia': 'PA', 'pittsburgh': 'PA', 'detroit': 'MI',
  'minneapolis': 'MN', 'st. louis': 'MO', 'kansas city': 'MO', 'nashville': 'TN',
  'memphis': 'TN', 'charlotte': 'NC', 'raleigh': 'NC', 'richmond': 'VA',
  'virginia beach': 'VA', 'baltimore': 'MD', 'washington dc': 'DC', 'dc': 'DC',
  'indianapolis': 'IN', 'columbus': 'OH', 'cleveland': 'OH', 'cincinnati': 'OH',
  'milwaukee': 'WI', 'las vegas': 'NV', 'salt lake city': 'UT', 'sacramento': 'CA',
  'oakland': 'CA', 'san jose': 'CA', 'fresno': 'CA', 'long beach': 'CA',
  'albuquerque': 'NM', 'tucson': 'AZ', 'el paso': 'TX', 'fort worth': 'TX',
  'oklahoma city': 'OK', 'louisville': 'KY', 'new orleans': 'LA', 'boise': 'ID',
  'anchorage': 'AK', 'honolulu': 'HI', 'omaha': 'NE', 'des moines': 'IA',
  'little rock': 'AR', 'birmingham': 'AL', 'charleston': 'SC',
};

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
    // "in" is almost always the English preposition ("45 in Ranchi", "I'm in sales").
    // Only treat it as Indiana when written in UPPERCASE "IN" in the original text.
    // Users who mean Indiana can type "IN", "Indiana", or "indiana".
    if (lower2 === 'in' && !isUpperInOriginal) continue;
    if (ambiguousCode && !isUpperInOriginal && !hasLocationCue && !isAdjacentToAge && !hasAge) continue;

    return { code: upper, token: cleaned };
  }

  // 3) City name → State resolution (No-Loop Rule)
  // If user says "I'm in Chicago" we resolve to IL without asking for state
  for (const [city, stateCode] of Object.entries(CITY_TO_STATE)) {
    const cityRe = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (cityRe.test(original)) {
      return { code: stateCode, token: city };
    }
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

  // D. NO-PRICING INTENT — "no pricing", "no rates", "coverage only", "features only"
  //    When detected, ALL downstream logic must suppress $ signs and cost tables.
  //    Covers: "don't include pricing", "do not include any pricing", "no dollar signs", "without costs"
  //    NOTE: Trailing \b removed on partial-word patterns (pric→pricing, cost→costs, etc.)
  const noPricing = /(?:\bno\s*pric|\bno\s*rates?\b|\bno\s*costs?\b|\bno\s*dollar|\bcoverage\s*only\b|\bfeatures?\s*only\b|\bwithout\s*(?:any\s*)?(?:pric|cost|dollar|rate)|\bskip\s*pric|(?:\bdon'?t|\bdo\s+not)\s*(?:show|include|need|list|mention)\s*(?:any\s*)?(?:the\s*)?(?:cost|pric|rate|premium|dollar))/i.test(clean);

  // E. FAMILY TIER DETECTION — "Spouse and 3 children", "family of 5", "wife and kids"
  //    Automatically locks subsequent responses to Employee + Family tier.
  const familyTierSignal = /\b(spouse\s*(?:and|\+|&)\s*(?:\d+\s*)?child|family\s*of\s*[3-9]|wife\s*and\s*(?:\d+\s*)?kid|husband\s*and\s*(?:\d+\s*)?kid|partner\s*and\s*(?:\d+\s*)?child|(?:my|our)\s*(?:whole\s*)?family|spouse.*children|children.*spouse)\b/i.test(clean);

  // F. PPO PLAN REQUEST — user explicitly asks for "the PPO plan" (does not exist)
  const asksPPOPlan = /\b(?:ppo\s*plan|the\s*ppo|ppo\s*option|ppo\s*medical|medical\s*ppo)\b/i.test(clean) && !/dental/i.test(clean);

  return { isContinuation, isTopic, isDemographics, hasAge, hasState, foundState, stateCode: extractedState.code, noPricing, familyTierSignal, asksPPOPlan };
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
- Medical (Standard HSA, Enhanced HSA — BCBSTX nationwide PPO network; Kaiser HMO where available)
- Dental (BCBSTX Dental PPO)
- Vision (VSP Vision Plus)
- Life Insurance (Unum Basic, Unum Voluntary Term, Allstate Whole Life)
- Disability (Short-Term and Long-Term — Unum)
- Critical Illness (Allstate)
- Accident/AD&D (Allstate)
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

  // GUARD: Don't match selection patterns if user is asking for information, not making a decision
  // Prevents false positives like "I want to know the difference" being treated as a plan selection
  if (/\b(want\s+to\s+(?:know|understand|learn|see|compare|find|hear|look|explore|ask|talk)|what\s+(?:is|are)|tell\s+me|explain|difference|available|options|which\s+(?:plan|one)|compare|between|about)\b/i.test(query)) {
    return null;
  }

  // Selection patterns: "I'll go with Kaiser", "I want the PPO", "sign me up for HDHP"
  const selectMatch = lower.match(/(?:i'?ll?\s*(?:go\s*with|take|choose|want|pick)|let'?s?\s*go\s*with|i\s*(?:chose|picked|selected|want)|sign\s*me\s*up\s*for|enroll\s*(?:me\s*)?in|i\s*(?:like|prefer))\s+(?:the\s+)?(.+?)(?:\s*plan)?$/i);
  if (selectMatch) {
    const plan = selectMatch[1].trim();
    // Extra guard: if captured "plan" is > 40 chars or contains verbs, it's likely not a real selection
    if (plan.length > 40 || /\b(to|know|understand|difference|available|compare|what|about|between)\b/i.test(plan)) {
      return null;
    }
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

function toPlainAssistantText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^\s*---\s*$/gm, '')
    .replace(/[✨💡📋📝🎉ℹ️👋😊⚠️]/g, '')
    .replace(/^\s*•\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================================
// L1 STATIC FAQ CACHE  (zero-LLM, zero-hallucination for 100% static answers)
// ============================================================================
// Any question that matches a pattern here is answered deterministically
// without touching RAG or the LLM.  Add entries as AmeriVet FAQ solidifies.
type L1FAQEntry = { patterns: RegExp[]; answer: (session: any) => string };

const L1_FAQ: L1FAQEntry[] = [
  {
    // HR phone number
    patterns: [/\b(hr\s*(phone|number|contact|line)|phone\s*number.*hr|call\s*(hr|human\s*resources)|hr\s*hotline|how\s*do\s*i\s*(call|reach|contact)\s*(hr|amerivet))\b/i],
    answer: () => `AmeriVet HR/Benefits can be reached at ${HR_PHONE}. For self-service enrollment, visit ${ENROLLMENT_PORTAL_URL}.`,
  },
  {
    // Enrollment portal URL
    patterns: [/\b(where\s*do\s*i\s*(enroll|sign\s*up|register)|enrollment\s*(portal|link|url|site|page)|workday\s*(link|url|portal)|how\s*do\s*i\s*(access|open|find)\s*(workday|the\s*portal|enrollment))\b/i],
    answer: () => `The AmeriVet benefits enrollment portal is Workday: ${ENROLLMENT_PORTAL_URL}\n\nYou can also call HR at ${HR_PHONE} for guided enrollment support.`,
  },
  {
    // Rightway — explicit negative answer
    patterns: [/\b(what\s*is\s*rightway|rightway\s*(app|service|number|contact|available|offer)|is\s*rightway|does\s*amerivet\s*(use|have|offer)\s*rightway)\b/i],
    answer: () => `Rightway is not an AmeriVet benefits resource and is not part of the AmeriVet benefits package.\n\nFor benefits navigation support, please contact AmeriVet HR/Benefits at ${HR_PHONE} or visit ${ENROLLMENT_PORTAL_URL}.`,
  },
  {
    // Kaiser in non-Kaiser states (hard negative)
    patterns: [/\b(kaiser.*(?:michigan|ohio|florida|texas|georgia|illinois|new\s*york|pennsylvania|arizona|nevada|colorado|north\s*carolina|virginia|minnesota|indiana|wisconsin|tennessee|missouri|maryland|iowa|kentucky|oklahoma|connecticut|utah|kansas|arkansas|mississippi|alabama|louisiana|west\s*virginia|idaho|nebraska|new\s*mexico|maine|south\s*carolina|north\s*dakota|south\s*dakota|alaska|vermont|wyoming|montana|hawaii|delaware|new\s*hampshire|rhode\s*island)|(?:michigan|ohio|florida|texas|georgia|illinois|new\s*york|pennsylvania|arizona|nevada|colorado|north\s*carolina|virginia|minnesota|indiana|wisconsin|tennessee|missouri|maryland|iowa|kentucky|oklahoma|connecticut|utah|kansas|arkansas|mississippi|alabama|louisiana|west\s*virginia|idaho|nebraska|new\s*mexico|maine|south\s*carolina|north\s*dakota|south\s*dakota|alaska|vermont|wyoming|montana|hawaii|delaware|new\s*hampshire|rhode\s*island).*kaiser)\b/i],
    answer: (session: any) => {
      const state = session.userState || 'your state';
      return `Kaiser Permanente is not available in ${state}. Kaiser HMO is only offered in California (CA), Washington (WA), and Oregon (OR) through AmeriVet.\n\nIn ${state}, your medical plan options are Standard HSA and Enhanced HSA (both through BCBS of Texas, nationwide PPO network). Would you like to compare those?`;
    },
  },
  {
    // Missing internal personnel data (Detroit office dental receptionist style questions)
    patterns: [/\b(receptionist|office\s*(staff|personnel|directory)|name\s*of.*(?:dentist|doctor|office|staff)|staff\s*(name|list|directory)|who\s*is\s*(?:the|my)\s*(?:dentist|doctor|hr\s*rep|benefits\s*rep))\b/i],
    answer: () => `I don't have that specific internal personnel data. For office-level contacts or staff directories, please reach out to AmeriVet HR at ${HR_PHONE}.`,
  },
];

/**
 * L1 FAQ lookup: check if query matches a 100%-static answer.
 * Returns the answer string if matched, null otherwise.
 */
function checkL1FAQ(query: string, session: any): string | null {
  const lower = query.toLowerCase();
  for (const entry of L1_FAQ) {
    if (entry.patterns.some(p => p.test(lower))) {
      return toPlainAssistantText(entry.answer(session));
    }
  }
  return null;
}

export function stripPricingDetails(text: string): string {
  return text
    .split('\n')
    .filter(line => !/\$\d|premium|per\s*pay(?:check|period)|\/month|\/year|annual\s+premium|cost\s+comparison|total\s+estimated\s+annual\s+cost/i.test(line))
    .join('\n')
    .replace(/\$[\d,]+\.?\d{0,2}(?:\/(?:month|year|mo|yr|paycheck|pay period|bi-?weekly?))?/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract the [RESPONSE] section from a [REASONING]/[RESPONSE] tagged LLM output.
 * Logs the [REASONING] block as a debug trace (Principal Architect protocol).
 * Falls back to full text if the model omits the tags.
 * Exported so unit tests can verify extraction behaviour.
 */
export function extractReasonedResponse(rawText: string, debugLog = false): string {
  const responseIdx = rawText.search(/\[RESPONSE\]\s*:?/i);
  if (responseIdx !== -1) {
    if (debugLog) {
      const reasoningIdx = rawText.search(/\[REASONING\]\s*:?/i);
      if (reasoningIdx !== -1) {
        const reasoningRaw = rawText.slice(reasoningIdx, responseIdx).replace(/\[REASONING\]\s*:?\s*/i, '');
        logger.debug(`[ReAct-TRACE] Principal Architect reasoning:\n${reasoningRaw.slice(0, 1400)}`);
      }
    }
    // Everything after the first newline following [RESPONSE] tag is the final answer.
    const afterTag = rawText.slice(responseIdx).replace(/\[RESPONSE\]\s*:?\s*/i, '');
    return afterTag.trim();
  }
  return rawText; // model omitted tags — return untouched
}

/**
 * Strip <thought>…</thought> Chain-of-Thought blocks from LLM output.
 * The thought content is logged for debugging but NEVER shown to the user.
 * Exported so unit tests can verify stripping behaviour.
 */
export function stripThoughtBlock(text: string, debugLog = false): string {
  if (!/<thought>/i.test(text)) return text;
  if (debugLog) {
    const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/i);
    if (thoughtMatch) {
      logger.debug(`[CoT-TRACE] Internal reasoning: ${thoughtMatch[1].slice(0, 800)}`);
    }
  }
  return text
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Build grounded context from retrieved chunks for LLM consumption.
 *
 * Improvements over a raw `chunks.map((c,i) => \`[Doc ${i}] ${c.content}\`).join`:  
 *  - Score-filters chunks below 25% of the top RRF score (eliminates tail noise)
 *  - Deduplicates by 120-char content fingerprint (prevents repeated paragraphs)
 *  - Truncates each chunk to 900 chars (avoids per-chunk token bloat)
 *  - Caps total context at 9 600 chars (~2 400 tokens) so the IMMUTABLE CATALOG  
 *    remains the dominant signal in the system prompt
 *  - Uses `BENEFIT DOCUMENT:` headers instead of `[Doc N]` to avoid citation  
 *    artifacts leaking into model output
 */
function buildGroundedContext(chunks: Chunk[], rrfScores: number[]): string {
  if (!chunks.length) return 'No retrieval context available.';

  const topScore = Math.max(...rrfScores, 0.001);
  const scoreThreshold = topScore * 0.25; // drop bottom-quartile chunks
  const MAX_CHARS_PER_CHUNK = 900;
  const MAX_TOTAL_CHARS = 9_600;

  const seen = new Set<string>();
  const parts: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < chunks.length; i++) {
    const score = rrfScores[i] ?? 0;
    if (score < scoreThreshold) continue; // low-relevance tail — skip

    const chunk = chunks[i];
    const fingerprint = chunk.content.slice(0, 120).trim();
    if (seen.has(fingerprint)) continue; // duplicate content block
    seen.add(fingerprint);

    const category = (chunk.metadata as any)?.category || '';
    const title    = chunk.title      || 'Benefit Document';
    const section  = chunk.sectionPath ? ` — ${chunk.sectionPath}` : '';
    const header   = `BENEFIT DOCUMENT${category ? ` (${category})` : ''}: ${title}${section}`;
    const body     = chunk.content.length > MAX_CHARS_PER_CHUNK
      ? chunk.content.slice(0, MAX_CHARS_PER_CHUNK) + ' ...'
      : chunk.content;

    const entry = `${header}\n${body}`;
    if (totalChars + entry.length > MAX_TOTAL_CHARS) break;
    parts.push(entry);
    totalChars += entry.length;
  }

  if (parts.length === 0) return 'No relevant benefit documents retrieved.';
  logger.debug(`[CONTEXT] Built grounded context: ${parts.length} chunks, ${totalChars} chars`);
  return parts.join('\n\n---\n\n');
}

type IntentDomain = 'pricing' | 'policy' | 'general';

export function detectIntentDomain(lowerQuery: string): IntentDomain {
  const hasPolicy = /\b(can\s+i|am\s+i|eligible|qualif(?:y|ied)|how\s+many\s+days|deadline|window|qle|qualifying\s+life\s+event|special\s+enrollment|filing\s+order|what\s+order|step\s*by\s*step|fmla|std|short\s*[- ]?term\s+disability|pre-?existing|clause|deny|denied|deductible\s+reset|effective\s+date)\b/i.test(lowerQuery);
  const hasPricing = /\b(how\s+much|cost|price|premium|deduct(?:ed|ion)|per\s*pay(?:check|period)|monthly|annual|compare\s+cost|estimate|projection|oop|out\s+of\s+pocket)\b/i.test(lowerQuery);

  if (hasPolicy && !hasPricing) return 'policy';
  if (hasPricing) return 'pricing';
  return 'general';
}

// ============================================================================
// 2. SYSTEM PROMPT — "ABSOLUTE TRUTH" (Data-Sovereign Benefits Engine)
// ============================================================================
function buildSystemPrompt(session: any): string {
  // === Decisions context ===
  const decisions = session.decisionsTracker || {};
  const decisionEntries = Object.entries(decisions);
  const decisionsText = decisionEntries.length > 0
    ? decisionEntries.map(([cat, val]: [string, any]) => {
        const entry = typeof val === 'string' ? { status: 'selected', value: val } : val;
        return `- ${cat}: ${entry.status === 'selected' ? entry.value || 'Selected' : 'Declined'}`;
      }).join('\n')
    : 'None yet';

  // === Remaining benefits ===
  const remaining = getRemainingBenefits(decisions);
  const remainingText = remaining.length > 0 ? remaining.join(', ') : 'All categories explored';

  // === Kaiser eligibility — STRICT IMMUTABLE RULE ===
  const userState = session.userState || '';
  const kaiserEligible = KAISER_STATES.has(userState.toUpperCase());
  const strictStateRule = userState
    ? (kaiserEligible
      ? `STRICT RULE — KAISER AVAILABLE: User is confirmed in ${userState}. Kaiser HMO IS available. Include Kaiser in all medical comparisons for this user.`
      : `STRICT RULE — KAISER FORBIDDEN: User is in ${userState}. Kaiser HMO is NOT available in ${userState}. Do NOT mention Kaiser to this user in any form — not even to say it is unavailable in their state. Compare ONLY Standard HSA and Enhanced HSA. Programmatically exclude all CA/OR/WA-only plan data from your response.`)
    : `STRICT RULE — STATE UNKNOWN: Do not reference Kaiser or regional plan availability until the user provides their state.`;

  // === Catalog injection (state-filtered, immutable) ===
  const catalog = getCatalogForPrompt(userState || null);

  // === Policy Reasoning Mode block (multi-life-event scenario) ===
  const policyReasoningModeBlock = session.policyReasoningMode
    ? `
═══════════════════════════════════════════════════════════════════════════
POLICY REASONING MODE — ACTIVE (do NOT open with pricing tables)
═══════════════════════════════════════════════════════════════════════════
The user is navigating multiple simultaneous life events.
- Lead with eligibility rules, QLE windows, and filing sequence.
- Do NOT open with a pricing table or premium dollars on your FIRST response.
- Once the user confirms their current state and family size, you may present
  cost context as a follow-up.`
    : '';

  const costFormattingBlock = session.noPricingMode
    ? `
═══════════════════════════════════════════════════════════════════════════
HARD CONSTRAINT — NO PRICING MODE (MANDATORY)
═══════════════════════════════════════════════════════════════════════════
The user has forbidden pricing output.
- Do NOT include dollar signs ($), premium values, per-paycheck figures, monthly/yearly totals
- Do NOT render pricing tables or cost comparisons
- Provide coverage/rules/process guidance only`
    : `
═══════════════════════════════════════════════════════════════════════════
COST FORMATTING
═══════════════════════════════════════════════════════════════════════════
- Always show: "$X.XX/month" — monthly is the canonical unit
- Show biweekly/per-paycheck ONLY when user explicitly asks "per paycheck", "per check", "bi-weekly", or "each paycheck"
- NEVER include biweekly or annual amounts unless the user specifically requests them
- For age-banded products (Vol. Life, Disability, Critical Illness, Accident):
  say "This is age-rated — log in at ${ENROLLMENT_PORTAL_URL} for your personalized rate."
- Round to 2 decimal places. Use exact catalog numbers.`;

  // Build the state status label for Session_Metadata
  const stateStatus = session.userState
    ? session.userState
    : session.context?.stateUpdatedAt
      ? `${session.context.stateUpdatedAt}` // fallback
      : 'Unknown';

  return `<Session_Metadata>
  User: ${session.userName || 'Guest'}, State: ${stateStatus || 'Unknown'}, Age: ${session.userAge || 'Unknown'}
  Topic: ${session.currentTopic || 'General Benefits'}, Turn: ${session.turn || 1}
  NoPricingMode: ${session.noPricingMode ? 'YES' : 'NO'}, PolicyReasoningMode: ${session.policyReasoningMode ? 'YES' : 'NO'}
</Session_Metadata>

<Role>AmeriVet Principal Benefits Consultant — DETERMINISTIC information engine</Role>

<Reasoning_Protocol>
### TECHNIQUE 1 — SELF-ASK (Decomposition)
Before answering, identify ALL hidden sub-questions inside the user's message:
- What type of FSA does the spouse have? (general-purpose BLOCKS HSA; limited-purpose does not)
- Is the user asking about IRS eligibility, plan pricing, OR leave/STD pay? Each is a SEPARATE answer.
- Does the query include salary data that requires STD math? (Monthly ÷ 4.33 × 0.60 = weekly pay)
- What is the confirmed state? Kaiser is ONLY CA/WA/OR — never mention it otherwise.

### TECHNIQUE 2 — CHAIN OF THOUGHT (Policy + Math)
Work step-by-step before writing your answer:
- Step 1: Read Session_Metadata → confirmed Name, Age, State. NEVER re-ask these.
- Step 2: List ALL benefit categories the query touches (may be more than one).
- Step 3: For each category, extract the EXACT rule or figure from the IMMUTABLE CATALOG.
- Step 4: Math formula: Monthly salary ÷ 4.33 = Weekly; Weekly × 0.60 = UNUM STD weekly pay.
- Step 5: Check eligibility blockers: spouse FSA type, state restrictions, pre-existing clauses.

### TECHNIQUE 3 — ReAct (Reasoning + Acting)
Iterate until all sub-questions are answered:
- Thought: "I need the UNUM STD elimination period to answer the week-6 pay question."
- Action: Search IMMUTABLE CATALOG for "Short-Term Disability elimination period".
- Observation: Found "7-day (2-week) elimination; 60% of pre-disability earnings; benefit begins Week 3."
- Thought: "Week 6 is inside the STD benefit window → I can calculate exact pay."

### OPERATIONAL CONSTRAINTS
- Zero Hallucination: If a benefit is not in the IMMUTABLE CATALOG, trigger REFUSAL_MANDATE.
- Immutable Context: Name, Age, State are CONFIRMED in Session_Metadata. Never re-ask.
- Normalization: Premiums must be monthly. Never mix bi-weekly/annual unless explicitly requested.
- Compound Queries: If the message asks TWO separate questions (e.g. IRS conflict AND STD pay),
  answer BOTH sequentially — do NOT silently drop one.

### MANDATORY OUTPUT FORMAT
You MUST structure every response exactly as shown below:

[REASONING]:
• Sub-questions: <list hidden variables you must resolve>
→ CoT: <step-by-step logic for policy rules and math>
→ ReAct: <any retrieval action and observation if data point needed>

[RESPONSE]:
<final conversational answer — plain prose, no [Source N] citations, no <thought> tags>
</Reasoning_Protocol>

<Constraints>
  <Rule id="STATE-LOCK" priority="CRITICAL">${strictStateRule}</Rule>
  <Rule id="DATA-SOVEREIGNTY">Every dollar amount, plan name, carrier name, and feature MUST appear verbatim in the IMMUTABLE CATALOG. Never fabricate, extrapolate, or approximate.</Rule>
  <Rule id="KAISER-ZERO-TOLERANCE">Kaiser HMO is available ONLY in CA, WA, OR. If user state is NOT one of those, Kaiser must NEVER appear in your response — not in plan lists, not in comparisons, not in any form.</Rule>
  <Rule id="CARRIER-LOCK">Medical: BCBSTX Standard HSA and Enhanced HSA only (plus Kaiser if CA/WA/OR). Dental: BCBSTX DPPO. Vision: VSP. Life: Unum (Basic + Voluntary Term), Allstate (Whole Life). Disability: Unum. Critical Illness/Accident: Allstate. NEVER cross these assignments.</Rule>
  <Rule id="NO-RIGHTWAY">Rightway is NOT an AmeriVet resource. If mentioned, say: "Rightway is not part of the AmeriVet benefits package." Never describe Rightway services.</Rule>
  <Rule id="NO-PPO-MEDICAL">AmeriVet has NO standalone PPO medical plan. Standard HSA and Enhanced HSA USE a PPO network but are HDHP/HSA plans. Never invent a plan called "BCBSTX PPO" or "PPO Standard".</Rule>
  <Rule id="NO-LOOP">You already have Name=${session.userName || '?'}, Age=${session.userAge || '?'}, State=${session.userState || '?'}. NEVER ask for these again.</Rule>
  <Rule id="MISSING-DATA">If the catalog does not contain an exact answer, say: "I don't have that specific information for AmeriVet. Please check ${ENROLLMENT_PORTAL_URL} or call HR at ${HR_PHONE}."</Rule>
</Constraints>



<Negative_Constraints>
  - NEVER guess prices. If a price is not in the catalog, say "check Workday for your personalized rate".
  - NEVER mention a carrier not in the CARRIER-LOCK rule.
  - NEVER show [Source N] or [Doc N] citation artifacts.
  - NEVER ask for the user's name, age, or state — you already have them.
  - NEVER include [Source N] or [Doc N] citation markers in responses.
  - For "Is [service] available in [state]?": check CARRIER-LOCK and STATE-LOCK first. If not in catalog, use MISSING-DATA rule.
</Negative_Constraints>

You answer ONLY from the IMMUTABLE CATALOG below. You DO NOT process enrollments.

═══════════════════════════════════════════════════════════════════════════
DATA SOVEREIGNTY — MANDATORY
═══════════════════════════════════════════════════════════════════════════
Every dollar amount, plan name, carrier name, and feature you state MUST appear
verbatim in the IMMUTABLE CATALOG below. If the catalog does not contain an
answer, respond: "I don't have that specific information. Please check the
enrollment portal at ${ENROLLMENT_PORTAL_URL} or call AmeriVet HR at ${HR_PHONE}."
NEVER fabricate, extrapolate, or approximate. Zero tolerance for hallucination.

═══════════════════════════════════════════════════════════════════════════
USER STATE (already collected — NEVER re-ask)
═══════════════════════════════════════════════════════════════════════════
Name  : ${session.userName || 'Guest'}
Age   : ${session.userAge || 'Unknown'}
State : ${session.userState || 'Unknown'}
Current Topic : ${session.currentTopic || 'None'}
Decisions so far:
${decisionsText}
Still to explore: ${remainingText}

═══════════════════════════════════════════════════════════════════════════
NO-LOOP RULE (CRITICAL)
═══════════════════════════════════════════════════════════════════════════
You already know Name=${session.userName || '?'}, Age=${session.userAge || '?'}, State=${session.userState || '?'}.
DO NOT ask for name, age, state, or location under ANY circumstance.
DO NOT ask "what state are you in?" or "how old are you?" — you have these values.
If a value is still "Unknown" or "?", skip it gracefully — DO NOT interrogate the user.
If user says "go ahead", "continue", "yes", proceed with the current topic: ${session.currentTopic || 'general benefits'}.

═══════════════════════════════════════════════════════════════════════════
CARRIER LOCKDOWN (STRICT — zero exceptions)
═══════════════════════════════════════════════════════════════════════════
Medical : BCBS of Texas Standard HSA & Enhanced HSA (HDHP plans using a nationwide PPO *network* — there is NO standalone "PPO" plan)${kaiserEligible ? ', Kaiser Permanente Standard HMO (WA/CA/OR only)' : ''}
Dental  : BCBS of Texas Dental PPO (DPPO)
Vision  : VSP (Vision Plus)
Basic Life & AD&D      : Unum — employer-paid $25,000 flat, $0 to employee
Voluntary Term Life    : Unum — age-banded, 1×-5× salary up to $500k, GI $150k
Whole Life (permanent) : Allstate — age-banded, cash value, portable
Disability (STD/LTD)   : Unum (age-banded)
Critical Illness       : Allstate (age-banded)
Accident/AD&D vol.     : Unum (age-banded)

If a carrier or plan name NOT listed above appears in retrieval context, IGNORE IT.
NEVER attribute term life to Allstate. NEVER attribute whole/permanent life to Unum.

═══════════════════════════════════════════════════════════════════════════
LIFE INSURANCE — 20/80 SPLIT GUIDANCE
═══════════════════════════════════════════════════════════════════════════
When the user asks about life insurance, present all three layers:
1. Basic Life & AD&D (Unum) — $25k flat, employer-paid, $0 cost
2. Voluntary Term Life (Unum) — age-banded, high coverage at low cost
3. Whole Life (Allstate) — permanent, cash value, portable

Pro tip to share: "Many advisors recommend an 80/20 split — about 80% of your
coverage in affordable Voluntary Term Life (Unum) for maximum protection, and
20% in Whole Life (Allstate) to build a permanent cash-value foundation that
stays with you regardless of employment."

═══════════════════════════════════════════════════════════════════════════
KAISER PROTOCOL
═══════════════════════════════════════════════════════════════════════════
${strictStateRule}
Kaiser is available ONLY in: California (CA), Washington (WA), Oregon (OR).
Re-statement of zero-tolerance rule: if user's state is NOT in that list, Kaiser
must NEVER appear in your response — not in plan lists, not in comparisons,
not in "not available" notes. Omit it entirely.

═══════════════════════════════════════════════════════════════════════════
PPO CLARIFICATION (CRITICAL — prevents hallucination)
═══════════════════════════════════════════════════════════════════════════
AmeriVet does NOT offer a standalone "PPO" medical plan.
The Standard HSA and Enhanced HSA use a nationwide PPO *network* for provider access,
but the plans themselves are HDHP/HSA plans. If a user asks for "the PPO plan",
clarify: "AmeriVet's medical plans (Standard HSA and Enhanced HSA) use the BCBSTX
nationwide PPO network, but they are structured as HDHP/HSA plans, not a traditional PPO."
NEVER invent a plan called "BCBSTX PPO", "PPO Standard", or any Medical PPO.
The ONLY PPO-labeled plan is the Dental PPO (BCBSTX Dental PPO).

═══════════════════════════════════════════════════════════════════════════
FORBIDDEN DATA (never output)
═══════════════════════════════════════════════════════════════════════════
- "Rightway", "Rightway app", "Rightway service" — NOT an AmeriVet resource
- Phone number "(305) 851-7310" — NOT an AmeriVet number
- Any carrier name not in CARRIER LOCKDOWN above
- Any plan name not in the IMMUTABLE CATALOG below
- NEVER say "BCBSTX PPO" as a medical plan — it does not exist
If user asks for live human help → AmeriVet HR at ${HR_PHONE} or ${ENROLLMENT_PORTAL_URL}

${costFormattingBlock}${policyReasoningModeBlock}

═══════════════════════════════════════════════════════════════════════════
CONVERSATION STYLE
═══════════════════════════════════════════════════════════════════════════
- Plain conversational English. No markdown headers in single-topic answers.
- Bullet points with dashes (-), never emojis.
- URLs as plain text, never markdown links: ${ENROLLMENT_PORTAL_URL}
- Ask ONE question at a time.
- First message only: "I'm here to help you explore your benefits — actual enrollment happens at the portal."
- After a decision or decline, show remaining categories: ${remainingText}

═══════════════════════════════════════════════════════════════════════════
RESPONSE STYLE — L3 ADVISOR MODE
═══════════════════════════════════════════════════════════════════════════
You are a senior human benefits advisor, not a search engine. Match tone to context:

NARRATIVE (life events, math, comparisons):
- Write professional conversational paragraphs. "Because you are in ${userState || 'your state'}, your medical options are Standard HSA and Enhanced HSA. Since your salary is $X/month, your STD benefit during weeks 3–8 would be exactly $Y/week via UNUM."
- Explain the WHY. "This matters because the IRS treats a general-purpose FSA as incompatible with an HSA — so your spouse's FSA must be addressed before you open one."
- Lead with the highest-priority risk before showing any costs.

EMPATHY (use when a life event is detected — one sentence only, then pivot):
- Pregnancy / new baby: "Planning for a new baby is a big deal — let's make sure your coverage is exactly right."
- Marriage QLE: "Congratulations — you have a 30-day window to update your coverage, so let's move quickly."
- Disability / leave: "I know this timing is stressful. Here is exactly what your income protection looks like..."
- DO NOT dwell on empathy; pivot immediately to the actionable answer.

NEXT-BEST-ACTION (end EVERY substantive answer with exactly one follow-up suggestion):
- Make it specific, not generic. NOT "Is there anything else?" BUT:
  "Should we calculate your total out-of-pocket cost for the hospital stay next?"
  "Would you like to compare the Enhanced HSA deductible vs. Standard HSA for your family size?"
  "Want me to walk through the QLE filing order for marriage and pregnancy together?"

BULLET CONSTRAINT:
- Bullets ONLY for: ordered steps, side-by-side tier tables, feature-by-feature lists.
- NEVER open a life-event or calculation response with bullets — use a paragraph first.

${session.lastBotMessage ? `═══════════════════════════════════════════════════════════════════════════
PREVIOUS BOT MESSAGE (for continuity):
"${session.lastBotMessage}"` : ''}

═══════════════════════════════════════════════════════════════════════════
IMMUTABLE CATALOG (source of truth — state-filtered for ${userState || 'all states'})
═══════════════════════════════════════════════════════════════════════════
${catalog}

Answer directly, accurately, and ONLY from the catalog above.`;
}

// ============================================================================
// 2b. CATEGORY EXPLORATION RESPONSE BUILDER (Deterministic)
// ============================================================================
// Returns a rich deterministic overview when user asks about a benefit category.
// This ensures we NEVER return dead-end "couldn't find pricing" for basic queries.

function buildCategoryExplorationResponse(
  queryLower: string,
  session: Session,
  coverageTier: string
): string | null {
  const noPricingMode = !!session.noPricingMode;
  const finalize = (response: string) => noPricingMode ? stripPricingDetails(response) : response;

  const tierKey = coverageTier === 'Employee + Spouse' ? 'employeeSpouse'
    : coverageTier === 'Employee + Child(ren)' ? 'employeeChildren'
    : coverageTier === 'Employee + Family' ? 'employeeFamily'
    : 'employeeOnly';
  const tierLabel = coverageTier || 'Employee Only';
  const userState = session.userState || '';
  const isKaiserEligible = KAISER_STATES.has(userState.toUpperCase());

  // Detect if this is a category exploration (not a specific calculation/comparison already handled)
  // Skip if user is asking for very specific things handled by other intercepts
  if (/per[\s-]*pay(?:check|period)?|deduct(?:ion|ed)|enroll\s+in\s+all|total\s+cost|how\s+much\s+would|maternity|pregnan|orthodont|braces|recommend|which\s+plan\s+should|qle|qualifying\s+life\s+event|how\s+many\s+days|deadline|window|fmla|short\s*[- ]?term\s+disability|pre-?existing|clause|can\s+i|d(?:ifference|ppo)\s*(?:vs?\.?|versus|between|and|compared)|compare|explain\s*(?:the)?\s*difference|dhmo/i.test(queryLower)) {
    return null; // Let the specialized intercepts handle these
  }

  const catalog = amerivetBenefits2024_2025;

  // GENERAL OVERVIEW — "what are my options?", "what benefits do I have?", "what's available?"
  // Fires when NO specific category is mentioned but user is asking broadly
  const isGeneralOverview = /\b(what\s+(?:are|is)\s+(?:my|the|our)\s+(?:option|benefit|plan|coverage|package)|what(?:'s| is)\s+available|what\s+(?:do\s+)?(?:i|we)\s+(?:have|get)|(?:show|tell|give)\s+me\s+(?:my|the|all)\s+(?:option|benefit|plan)|overview\s+of\s+(?:my|the|all)|all\s+(?:my\s+)?(?:benefit|option|plan)|what\s+(?:can|should)\s+i\s+(?:get|choose|enroll|sign\s+up)|benefits?\s+(?:overview|summary|lineup|offerings?))\b/i.test(queryLower)
    && !/\b(medical|dental|vision|life|disability|hsa|fsa|critical|accident|supplemental)\b/i.test(queryLower);

  if (isGeneralOverview) {
    const userName = session.userName || '';
    const greeting = userName ? `Great question, ${userName}! ` : '';
    const stateNote = isKaiserEligible
      ? ' (including Kaiser HMO, which is available in your state!)'
      : '';

    let response = `${greeting}Here's everything available to you as an AmeriVet employee${stateNote}:\n\n`;

    // Medical plans summary
    const medPlans = catalog.medicalPlans.filter(p => isKaiserEligible || !p.regionalAvailability.includes('California'));
    const medNames = medPlans.map(p => `${p.name} (${p.provider})`).join(', ');
    response += `**Medical** — ${medNames}\n`;

    // Dental
    response += `**Dental** — ${catalog.dentalPlan.name} (${catalog.dentalPlan.provider})\n`;

    // Vision
    response += `**Vision** — ${catalog.visionPlan.name} (${catalog.visionPlan.provider})\n`;

    // Life Insurance
    response += `**Life Insurance** — UNUM Basic Life (employer-paid), UNUM Voluntary Term Life, Allstate Whole Life\n`;

    // Disability
    response += `**Disability** — Short-Term (UNUM) and Long-Term (UNUM)\n`;

    // Supplemental
    response += `**Critical Illness** — Allstate\n`;
    response += `**Accident/AD&D** — Allstate\n`;

    // Tax-advantaged
    response += `**HSA/FSA** — Health Savings Account, Flexible Spending Account, Commuter Benefits\n\n`;

    response += `Which benefit would you like to explore first? I can give you plan details, pricing, and help you decide what's right for your situation.`;

    return finalize(response);
  }

  // MEDICAL exploration
  if (/\b(medical|health\s*(?:care|insurance|plan|coverage)?)\b/i.test(queryLower)) {
    const plans = catalog.medicalPlans.filter(p =>
      isKaiserEligible || !p.regionalAvailability.includes('California')
    );

    let response = `Here's an overview of the medical plans available to you:\n\n`;

    for (const plan of plans) {
      const monthly = plan.tiers[tierKey];
      const ded = plan.coverage?.deductibles;
      const coins = plan.coverage?.coinsurance;
      const copays = plan.coverage?.copays;

      response += `**${plan.name}** (${plan.provider})`;
      if (plan.regionalAvailability.includes('California')) {
        response += ` — California only`;
      }
      response += `\n`;
      response += `- Premium (${tierLabel}): **$${monthly.toFixed(2)}/month**\n`;
      response += `- Deductible: $${ded?.individual?.toLocaleString() ?? plan.benefits.deductible.toLocaleString()} individual / $${ded?.family?.toLocaleString() ?? (plan.benefits.deductible * 2).toLocaleString()} family\n`;
      response += `- Out-of-Pocket Max: $${plan.benefits.outOfPocketMax.toLocaleString()}\n`;
      response += `- Coinsurance: ${Math.round((coins?.inNetwork ?? plan.benefits.coinsurance) * 100)}% in-network\n`;
      if (copays) {
        const copayParts: string[] = [];
        if (copays.primaryCare !== undefined) copayParts.push(`PCP $${copays.primaryCare}`);
        if (copays.specialist !== undefined) copayParts.push(`Specialist $${copays.specialist}`);
        if (copayParts.length > 0) response += `- Copays: ${copayParts.join(', ')}\n`;
      }
      response += `- Key features: ${plan.features.slice(0, 3).join(', ')}\n\n`;
    }

    // Only mention Kaiser availability if user is NOT in a Kaiser state (and we know their state)
    // Per Kaiser Protocol: don't mention Kaiser at all to non-eligible users
    // (Kaiser plans are already filtered out of the list above)

    response += `Would you like to:\n- Compare two specific plans in detail?\n- See pricing for a different coverage tier (e.g., Employee + Family)?\n- Explore another benefit like Dental or Vision?`;

    return finalize(response);
  }

  // DENTAL exploration
  if (/\b(dental)\b/i.test(queryLower)) {
    const plan = catalog.dentalPlan;
    const monthly = plan.tiers[tierKey];
    const ded = plan.coverage?.deductibles;
    const coins = plan.coverage?.coinsurance;

    let response = `Here's your dental plan overview:\n\n`;
    response += `**${plan.name}** (${plan.provider})\n`;
    response += `- Premium (${tierLabel}): **$${monthly.toFixed(2)}/month**\n`;
    response += `- Deductible: $${ded?.individual ?? plan.benefits.deductible} individual / $${ded?.family ?? plan.benefits.deductible * 3} family\n`;
    response += `- Preventive care: Covered at 100% (cleanings, exams, X-rays)\n`;
    response += `- Basic services (fillings, extractions): ${coins?.basic !== undefined ? `${Math.round(coins.basic * 100)}% coinsurance` : '20% coinsurance'}\n`;
    response += `- Major services (crowns, bridges): ${coins?.major !== undefined ? `${Math.round(coins.major * 100)}% coinsurance` : '50% coinsurance'}\n`;
    response += `- Annual maximum: $${plan.benefits.outOfPocketMax?.toLocaleString() ?? '1,500'}\n`;
    response += `- Orthodontia: $${plan.coverage?.copays?.orthodontia ?? 500} copay (with coverage)\n`;
    response += `- Network: Nationwide PPO\n\n`;
    response += `Would you like to:\n- See pricing for a different coverage tier?\n- Learn more about orthodontia coverage?\n- Explore another benefit like Vision or Medical?`;

    return finalize(response);
  }

  // VISION exploration
  if (/\b(vision|eye)\b/i.test(queryLower)) {
    const plan = catalog.visionPlan;
    const monthly = plan.tiers[tierKey];

    let response = `Here's your vision plan overview:\n\n`;
    response += `**${plan.name}** (${plan.provider})\n`;
    response += `- Premium (${tierLabel}): **$${monthly.toFixed(2)}/month**\n`;
    response += `- Eye exam: $${plan.coverage?.copays?.exam ?? 10} copay (covered every 12 months)\n`;
    response += `- Frames: $200 allowance every 12 months\n`;
    response += `- Contact lens allowance included\n`;
    response += `- LASIK discounts available\n`;
    response += `- Lenses: $${plan.coverage?.copays?.lenses ?? 25} copay\n`;
    response += `- Network: VSP nationwide\n\n`;
    response += `Would you like to:\n- See pricing for a different coverage tier?\n- Explore another benefit like Medical or Dental?`;

    return finalize(response);
  }

  // LIFE INSURANCE exploration
  if (/\b(life\s*(?:insurance)?|life\b)\b/i.test(queryLower)) {
    let response = `Here's an overview of the life insurance options available to you:\n\n`;

    response += `**1. UNUM Basic Life & AD&D** (Employer-Paid)\n`;
    response += `- Coverage: $25,000 flat benefit\n`;
    response += `- Cost: **$0** — fully paid by AmeriVet\n`;
    response += `- Includes Accidental Death & Dismemberment (AD&D)\n`;
    response += `- All benefits-eligible employees are automatically enrolled\n\n`;

    response += `**2. UNUM Voluntary Term Life**\n`;
    response += `- Coverage: Additional term life insurance you can purchase\n`;
    response += `- Options: 1x to 5x salary (up to $500,000)\n`;
    response += `- Pricing: Age-banded (rates vary by age bracket)\n`;
    response += `- Guaranteed Issue: Up to $150,000 without medical questions during open enrollment\n`;
    response += `- Spouse and dependent child coverage also available\n\n`;

    response += `**3. Allstate Whole Life**\n`;
    response += `- Coverage: Permanent life insurance that builds cash value\n`;
    response += `- Pricing: Age-banded (rates locked at enrollment age)\n`;
    response += `- Portable: You keep it even if you leave AmeriVet\n`;
    response += `- Cash value accumulates over time\n\n`;

    response += `Pro tip: Many advisors recommend an 80/20 split — about 80% of your coverage in affordable Voluntary Term Life (Unum) for maximum protection, and 20% in Whole Life (Allstate) to build a permanent cash-value foundation that stays with you regardless of employment. The employer-paid Basic Life ($25K) is your starting base on top of that.\n\n`;

    response += `Would you like to:\n- Learn more about any specific life insurance option?\n- Explore other benefits like Medical or Dental?`;

    return finalize(response);
  }

  // DISABILITY exploration
  if (/\b(disability|std|ltd|short[\s-]*term|long[\s-]*term)\b/i.test(queryLower)) {
    let response = `Here's an overview of the disability insurance options:\n\n`;

    response += `**Short-Term Disability (STD)** — UNUM\n`;
    response += `- Replaces a portion of income if you can't work due to illness/injury\n`;
    response += `- Typical benefit: 60% of weekly salary\n`;
    response += `- Waiting period: 7 days (illness) / 0 days (accident)\n`;
    response += `- Benefit duration: Up to 13 weeks\n\n`;

    response += `**Long-Term Disability (LTD)** — UNUM\n`;
    response += `- Kicks in after STD benefits end\n`;
    response += `- Typical benefit: 60% of monthly salary (up to $10,000/month)\n`;
    response += `- Waiting period: 90 days\n`;
    response += `- Benefit duration: Up to age 65 or Social Security Normal Retirement Age\n\n`;

    response += `*Pricing for disability coverage is age-banded. For exact rates, please visit the enrollment portal at ${ENROLLMENT_PORTAL_URL} or contact HR at ${HR_PHONE}.*\n\n`;

    response += `Would you like to explore a different benefit category?`;

    return finalize(response);
  }

  // CRITICAL ILLNESS / ACCIDENT exploration
  if (/\b(critical\s*illness|accident|ad&d|supplemental)\b/i.test(queryLower)) {
    let response = `Here's an overview of supplemental coverage options:\n\n`;

    response += `**Critical Illness Insurance** — Allstate\n`;
    response += `- Lump-sum cash benefit if diagnosed with a covered condition\n`;
    response += `- Covered conditions: Heart attack, stroke, cancer, organ transplant, and more\n`;
    response += `- Benefit amounts: $10,000 to $30,000 (age-banded pricing)\n`;
    response += `- Covers employee, spouse, and dependent children\n\n`;

    response += `**Accident Insurance** — Allstate\n`;
    response += `- Cash benefit for covered accidents (fractures, dislocations, burns, etc.)\n`;
    response += `- Includes initial treatment, follow-up, hospitalization, and rehab\n`;
    response += `- Works alongside your medical plan to offset out-of-pocket costs\n\n`;

    response += `*Both are age-banded products. For exact rates, visit ${ENROLLMENT_PORTAL_URL} or call HR at ${HR_PHONE}.*\n\n`;

    response += `Would you like to explore a different benefit category?`;

    return finalize(response);
  }

  // HSA / FSA exploration
  if (/\b(hsa|fsa|flexible\s*spending|health\s*savings|tax[\s-]*(?:free|advantaged))\b/i.test(queryLower)) {
    const hsa = catalog.specialCoverage.hsa;
    const fsa = catalog.specialCoverage.fsa;

    let response = `Here's an overview of your tax-advantaged savings accounts:\n\n`;

    response += `**Health Savings Account (HSA)**\n`;
    response += `- Available with: Standard HSA or Enhanced HSA medical plans\n`;
    response += `- Employer contribution: **$${hsa.employerContribution}/year** (seeded by AmeriVet)\n`;
    response += `- 2025 IRS limits: $4,300 (individual) / $8,550 (family)\n`;
    response += `- Triple tax advantage: Tax-free contributions, growth, and withdrawals for medical expenses\n`;
    response += `- Funds roll over year to year — no "use it or lose it"\n`;
    response += `- Portable: You keep it if you leave AmeriVet\n\n`;

    response += `**Flexible Spending Account (FSA)**\n`;
    response += `- Maximum contribution: $${fsa.maximumContribution.toLocaleString()}/year\n`;
    response += `- Pre-tax contributions reduce taxable income\n`;
    response += `- Available for: Healthcare FSA, Dependent Care FSA, and Limited Purpose FSA\n`;
    response += `- ⚠️ Use-it-or-lose-it: Funds must be used within the plan year\n`;
    response += `- Cannot have both a general FSA and an HSA simultaneously\n\n`;

    response += `**Commuter Benefits**\n`;
    response += `- Monthly benefit: Up to $${catalog.specialCoverage.commuter.monthlyBenefit}/month pre-tax\n`;
    response += `- Covers: Transit, parking, and qualified commuter expenses\n\n`;

    response += `Would you like to:\n- Learn how HSA vs. FSA compares for your situation?\n- Explore another benefit category?`;

    return response;
  }

  return null;
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
    completedTopics: session.completedTopics || [],
    lifeEvents: session.lifeEvents || [],
    lastDetectedLocationChange: session.lastDetectedLocationChange || null
  };
}

type IntentDomainRoute = 'policy' | 'pricing' | 'general';

type PreprocessSignals = {
  hasQLEIntent: boolean;
  hasFilingOrderIntent: boolean;
  hasLifecycleEvent: boolean;
  spouseGeneralFsaConflictIntent: boolean;
  authorityConflictIntent: boolean;
  retrievalBoostTerms: string[];
  // State-machine additions
  multiQLESignal: boolean;         // marriage + job-change OR pregnancy in same message
  intentDomainRoute: IntentDomainRoute; // policy=SPD/QLE/FMLA, pricing=cost tables, general=other
};

function collectPreprocessSignals(lowerQuery: string): PreprocessSignals {
  const hasQLEIntent = /\b(qualifying\s+life\s+event|qle|special\s+enrollment|life\s+event\s+window)\b/i.test(lowerQuery);
  const hasFilingOrderIntent = /\b(filing\s+order|what\s+order|which\s+order|step\s*by\s*step|sequence|what\s+should\s+i\s+do\s+first|how\s+do\s+i\s+file|file\s+first)\b/i.test(lowerQuery);
  const hasLifecycleEvent = /\b(marriage|married|wedding|spouse|job\s+change|hours\s+change|part\s*[- ]?time|full\s*[- ]?time|pregnan|birth|baby|adoption)\b/i.test(lowerQuery);

  const spouseGeneralFsaConflictIntent =
    /\bhsa\b/i.test(lowerQuery) &&
    /\bspouse\b/i.test(lowerQuery) &&
    /\b(general\s*[- ]?purpose\s*fsa|health\s*(care)?\s*fsa|medical\s*fsa|fsa)\b/i.test(lowerQuery);

  const authorityConflictIntent =
    /\b(conflict|conflicting|authoritative|which\s+document\s+controls|which\s+is\s+authoritative|age\s+limit)\b/i.test(lowerQuery) &&
    /\b(spd|summary\s+plan\s+description|plan\s+document|certificate|sbc)\b/i.test(lowerQuery);

  // Multi-QLE signal: marriage AND (job-change OR pregnancy) in the SAME message
  const hasMarriageSignal = /\b(married|marriage|wedding|got\s+married|just\s+married)\b/i.test(lowerQuery);
  const hasJobChangeSignal = /\b(job\s+change|hours\s+change|part\s*[- ]?time|full\s*[- ]?time|now\s+full\s*[- ]?time|went\s+full\s*[- ]?time|status\s+change)\b/i.test(lowerQuery);
  const hasPregnancySignal = /\b(pregnan|expecting|maternity|having\s+a\s+baby|due\s+date)\b/i.test(lowerQuery);
  const multiQLESignal = hasMarriageSignal && (hasJobChangeSignal || hasPregnancySignal);

  // Intent domain routing: policy vs pricing vs general
  // NOTE: alternatives that end with a prefix ("pric" in "pricing", "without pric...") are kept
  // OUTSIDE the word-boundary group so the trailing \b doesn't block "pricing" or "prices".
  const policyKeywords = (
    /\b(fmla|family\s+(?:and\s+)?medical\s+leave|qualifying\s+life\s+event|qle|special\s+enrollment|spd|summary\s+plan|pre-?existing|elimination\s+period|waiting\s+period|deadline|window|filing\s+order|step\s*by\s*step|how\s+to\s+file|hsa\s+eligib|irs\s+rule|irs\s+pub|coordination|no\s+cost|coverage\s+only)\b/i.test(lowerQuery) ||
    /\bno\s+pric\w*/i.test(lowerQuery) ||
    /\bwithout\s+pric\w*/i.test(lowerQuery)
  );
  const pricingKeywords = /\b(premium|per\s+paycheck|per\s+pay|biweekly|monthly\s+cost|annual\s+cost|how\s+much|what\s+does\s+it\s+cost|price|rate|\$)\b/i.test(lowerQuery);
  const intentDomainRoute: IntentDomainRoute = policyKeywords ? 'policy' : pricingKeywords ? 'pricing' : 'general';

  const retrievalBoostTerms: string[] = [];
  if (hasQLEIntent || (hasLifecycleEvent && hasFilingOrderIntent) || multiQLESignal) {
    retrievalBoostTerms.push('qualifying life event', 'special enrollment', 'filing order', 'required documentation', 'effective date');
  }
  if (spouseGeneralFsaConflictIntent) {
    retrievalBoostTerms.push('HSA eligibility', 'spouse general purpose FSA', 'limited purpose FSA');
  }
  if (authorityConflictIntent) {
    retrievalBoostTerms.push('Summary Plan Description', 'SPD controls', 'plan document precedence');
  }

  return {
    hasQLEIntent,
    hasFilingOrderIntent,
    hasLifecycleEvent,
    spouseGeneralFsaConflictIntent,
    authorityConflictIntent,
    retrievalBoostTerms,
    multiQLESignal,
    intentDomainRoute,
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
        // NOTE: Do NOT set dataConfirmed here. Let the normal flow at line ~1085
        // handle it so the deterministic ALL_BENEFITS_MENU is shown to the user.
        // Setting dataConfirmed here causes the LLM to generate a hallucinated menu.
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
    const previousState = session.userState || null;
    if (intent.hasAge) {
        const ageMatch = query.match(/\b(1[8-9]|[2-9][0-9])\b/);
        if (ageMatch) {
            session.userAge = parseInt(ageMatch[0]);
            logger.debug(`[QA] Extracted age from input`);
        }
    }
    if (intent.hasState && intent.stateCode) {
      const newStateCode = intent.stateCode.toUpperCase();
      session.userState = newStateCode;
      logger.debug(`[QA] Extracted state from input: ${newStateCode}`);

      if (previousState && previousState.toUpperCase() !== newStateCode) {
        session.lastDetectedLocationChange = {
          from: previousState,
          to: newStateCode,
          updatedAt: Date.now(),
        };
        session.context = session.context || {};
        session.context.stateUpdatedAt = Date.now();
        // Invalidate any cached Kaiser eligibility so the next buildSystemPrompt
        // re-evaluates against the new state.
        (session.context as Record<string, unknown>).kaiserEligibilityCachedFor = null;
        logger.info('[QA] State updated mid-session — Kaiser eligibility re-evaluated', { from: previousState, to: newStateCode, kaiserNow: KAISER_STATES.has(newStateCode) });
      }
    }
    
    // Ensure session is saved after data extraction
    if ((intent.hasAge && session.userAge) || (intent.hasState && session.userState)) {
      await updateSession(sessionId, session);
        logger.debug(`[QA] Session updated - HasAge: ${!!session.userAge}, HasState: ${!!session.userState}`);
    }

    // ========================================================================
    // DETERMINISTIC STATE-BASED ENFORCEMENT (Refactor: Template → State-Based)
    // ========================================================================

    // RULE 1: FAMILY TIER LOCK — "Spouse and 3 children" → Employee + Family
    // Once detected, ALL subsequent pricing defaults to Employee + Family until
    // the user explicitly requests a different tier (e.g., "Employee Only").
    if (intent.familyTierSignal) {
      session.coverageTierLock = 'Employee + Family';
      logger.debug(`[TIER-LOCK] Session tier locked to Employee + Family`);
    }

    // RULE 2: NO-PRICING INTENT — user said "no pricing" / "coverage only"
    // Persists on session so follow-up messages also respect it.
    // User can unlock by saying "show pricing" / "include costs".
    if (intent.noPricing) {
      session.noPricingMode = true;
      logger.debug(`[NO-PRICING] Pricing suppression activated`);
    }
    if (/\b(show\s*pric|include\s*cost|with\s*pric|add\s*pric|show\s*rates?|include\s*rates?)\b/i.test(query.toLowerCase())) {
      session.noPricingMode = false;
      logger.debug(`[NO-PRICING] Pricing suppression deactivated`);
    }

    // RULE 3: PPO PLAN CLARIFICATION — user asks for "the PPO plan" (medical)
    // Deterministic response: no LLM needed, no hallucination possible.
    if (intent.asksPPOPlan && session.userState && !KAISER_STATES.has(session.userState.toUpperCase())) {
      const msg = `AmeriVet does not offer a standalone "PPO" medical plan. Your medical plans — Standard HSA and Enhanced HSA (both through BCBS of Texas) — use a nationwide PPO network for provider access, but they are structured as HDHP/HSA plans.\n\nWould you like to see a comparison of the Standard HSA vs. Enhanced HSA?`;
      session.lastBotMessage = msg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'ppo-clarification' } });
    }
    if (intent.asksPPOPlan && (!session.userState || KAISER_STATES.has((session.userState || '').toUpperCase()))) {
      const kaiserNote = session.userState ? ` You also have access to Kaiser Standard HMO in ${session.userState}.` : '';
      const msg = `AmeriVet does not offer a standalone "PPO" medical plan. The Standard HSA and Enhanced HSA (BCBS of Texas) use a nationwide PPO network, but they are HDHP/HSA plans — not a traditional PPO.${kaiserNote}\n\nWould you like to compare the available medical plans?`;
      session.lastBotMessage = msg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'ppo-clarification' } });
    }

    // RULE 4: KAISER IN NON-KAISER STATE — user explicitly asks about Kaiser when not in CA/WA/OR
    const asksKaiser = /\bkaiser\b/i.test(query);
    const userInNonKaiserState = !!session.userState && !KAISER_STATES.has(session.userState.toUpperCase());
    if (asksKaiser && userInNonKaiserState) {
      const stateLabel = session.userState!.toUpperCase();
      const msg = `Kaiser is only available in California, Washington, and Oregon. In ${stateLabel}, your medical options are:\n\n- Standard HSA (BCBS of Texas) — lower premium, higher deductible, full HSA contribution eligible\n- Enhanced HSA (BCBS of Texas) — higher premium, lower deductible, better for anticipated medical use\n\nBoth use the nationwide BCBSTX PPO network. Would you like a side-by-side comparison?`;
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'kaiser-redirect-non-eligible-state' } });
    }

    // Save session if state-based flags changed
    if (intent.familyTierSignal || intent.noPricing) {
      await updateSession(sessionId, session);
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
            const msg = `Thanks, ${name}! It's great to meet you.\n\nTo help me find the best plans for you, could you please share your age and state?`;
            
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
    // POLICY BYPASS: Policy/procedure questions (HSA eligibility, QLE deadlines,
    // STD calculations, pre-existing conditions) do NOT require age/state.
    // They are answered from plan rules, not pricing tables.
    const intentDomainEarly = detectIntentDomain(query.toLowerCase());
    if (!hasData && !intent.isContinuation && intentDomainEarly !== 'policy') {
        
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

    // ========================================================================
    // INTERCEPT: L1 STATIC FAQ CACHE (zero-LLM, highest priority)
    // ========================================================================
    const l1Answer = checkL1FAQ(query, session);
    if (l1Answer) {
      session.lastBotMessage = l1Answer;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: l1Answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'l1-static-faq' } });
    }

    // INTERCEPT: LIVE SUPPORT / TALK TO A PERSON
    // ========================================================================
    const lowerQuery = query.toLowerCase();
    const intentDomain = detectIntentDomain(lowerQuery);
    const preprocessSignals = collectPreprocessSignals(lowerQuery);

    const inferredTopic = normalizeBenefitCategory(lowerQuery);
    if (session.currentTopic && inferredTopic && inferredTopic !== session.currentTopic && inferredTopic !== lowerQuery.charAt(0).toUpperCase() + lowerQuery.slice(1)) {
      const previousTopic = session.currentTopic;
      session.loopCount = 0;
      session.lastAskedQuestion = undefined;
      session.currentTopic = inferredTopic;
      logger.debug('[STATE] Topic shift detected, loop state reset', { from: previousTopic, to: inferredTopic });
    }

    if (preprocessSignals.hasLifecycleEvent) {
      const lifeEvents = new Set(session.lifeEvents || []);
      if (/\bmarriage|married|wedding\b/i.test(lowerQuery)) lifeEvents.add('marriage');
      if (/\bjob\s+change|hours\s+change|part\s*[- ]?time|full\s*[- ]?time\b/i.test(lowerQuery)) lifeEvents.add('job-change');
      if (/\bpregnan|birth|baby|adoption\b/i.test(lowerQuery)) lifeEvents.add('pregnancy-or-child-event');
      session.lifeEvents = Array.from(lifeEvents);
    }

    if (preprocessSignals.spouseGeneralFsaConflictIntent) {
      // ── Block 1: IRS compliance (always fires) ───────────────────────────
      let msg = `IRS COMPLIANCE RULE (IRS Publication 969): If your spouse is enrolled in a general-purpose Healthcare FSA, you are NOT eligible to contribute to an HSA for those same months. This is a hard IRS rule with no exceptions.

The only workaround: your spouse switches to a Limited Purpose FSA (LPFSA) that covers ONLY dental and vision — then your HSA eligibility is restored.

Action order:
1. Confirm your spouse's FSA type with their employer (general-purpose vs limited-purpose).
2. If general-purpose FSA: do NOT elect HSA contributions — you are ineligible.
3. If limited-purpose FSA: you may elect HSA contributions normally.
4. Make this determination BEFORE finalizing plan elections in Workday. You cannot retroactively correct excess HSA contributions without IRS penalty.

For enrollment: ${ENROLLMENT_PORTAL_URL} | HR: ${HR_PHONE}`;

      // ── Block 2: Compound-query extension (ReAct — if query ALSO asks about maternity/STD pay) ──
      // Principal Architect Rule: compound queries must receive BOTH answers — never silently drop one.
      const hasCompoundStdPay = (
        /\b(maternity(?:\s+leave)?|parental\s+leave|fmla|leave\s+of\s+absence)\b/i.test(lowerQuery) &&
        /\b(pay(?:check)?|paid|income|salary|money|how\s+much|week\s*\d*|6th\s+week|sixth\s+week|std|60%)\b/i.test(lowerQuery)
      ) || (
        /\b(std|short\s*[- ]?term\s+disability)\b/i.test(lowerQuery) &&
        /\b(maternity|leave|pay(?:check)?|paid|salary|60%|sixty\s*percent|week\s*\d+|6th\s+week|sixth\s+week|get\s+paid|income)\b/i.test(lowerQuery)
      );

      if (hasCompoundStdPay) {
        // ReAct: Action → extract salary from message; Observation → compute STD weekly pay
        const salaryMatch = lowerQuery.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{4,6})\s*\/\s*month/);
        const salary = salaryMatch ? Number(salaryMatch[1].replace(/,/g, '')) : null;
        const weeklyBase = salary ? salary / 4.33 : null;
        const stdWeekly  = weeklyBase ? (weeklyBase * 0.6).toFixed(2) : null;
        const mathLine   = stdWeekly
          ? `With a salary of $${(salary as number).toLocaleString()}/month: $${(salary as number).toLocaleString()} ÷ 4.33 = $${(weeklyBase as number).toFixed(2)}/week × 60% = $${stdWeekly}/week via UNUM STD.`
          : `Share your monthly salary and I can calculate the exact weekly payment.`;

        msg += `\n\n────────────────────────────────────────\nMaternity Leave Pay — UNUM STD Timeline:\n\n- Weeks 1–2 (Elimination Period): STD is not yet active. Use PTO or this period may be unpaid.\n- Weeks 3–6 (STD Active — UNUM): UNUM pays 60% of your pre-disability base earnings. FMLA runs concurrently and provides job protection.\n- Weeks 7–8 (if physician-certified): STD may extend through week 8 (vaginal delivery) or week 10 (C-section), subject to UNUM claim approval.\n- FMLA (all 12 weeks): Job-protected leave only — income comes from UNUM STD, not FMLA.\n\nWeek 6 specifically: You are inside the UNUM STD benefit window. ${mathLine}\n\nNote: The spouse FSA conflict above must be resolved BEFORE electing HSA contributions in Workday — your maternity leave coverage under the chosen medical plan is not affected by the FSA ruling.`;
      }

      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: hasCompoundStdPay ? 'hsa-spouse-fsa-conflict+std-pay' : 'hsa-spouse-fsa-conflict' } });
    }

    // ── MULTI-QLE STATE MACHINE INTERCEPTOR ─────────────────────────────────
    // Fires when user reports BOTH a marriage QLE AND a job-status change (or
    // pregnancy) in the same message. Returns ordered A-grade response with
    // state-specific plan recommendation.  Must run BEFORE qleFilingOrderRequested.
    if (preprocessSignals.multiQLESignal) {
      session.policyReasoningMode = true;  // Prevent pricing tables on subsequent turns
      const currentState = session.userState || '';
      const isKaiserState = KAISER_STATES.has(currentState.toUpperCase());
      const stateLabel = currentState || 'your state';
      const stateNote = currentState
        ? (isKaiserState
          ? `For ${stateLabel}: Kaiser Permanente Standard HMO is available as a third option alongside Standard HSA and Enhanced HSA.`
          : `For ${stateLabel}: Kaiser HMO is not available. Your medical options are Standard HSA and Enhanced HSA (both BCBSTX). For maternity cost protection, Enhanced HSA has a lower deductible and is the stronger choice. Consider pairing it with an HSA contribution to offset out-of-pocket costs.`)
        : `Share your state and I can add a specific plan recommendation.`;

      const hasPregnancy = /\b(pregnan|expecting|maternity|having\s+a\s+baby|due\s+date)\b/i.test(lowerQuery);
      const hasJobChange = /\b(job\s+change|hours\s+change|part\s*[- ]?time|full\s*[- ]?time|now\s+full\s*[- ]?time|went\s+full\s*[- ]?time|status\s+change)\b/i.test(lowerQuery);

      let msg = `You have multiple Qualifying Life Events (QLEs) active at once. Here is your correct action sequence:\n\n`;
      msg += `Step 1 — Marriage QLE (30-day window, file FIRST)\n`;
      msg += `- File the marriage QLE in Workday immediately to add your spouse to Medical, Dental, and Vision.\n`;
      msg += `- Upload your marriage certificate as documentation.\n`;
      msg += `- Most plans require QLE submission within 30 days of the marriage date. Missing this window locks you out until Open Enrollment.\n\n`;

      if (hasJobChange) {
        msg += `Step 2 — Employment Status Change (file same day or next business day)\n`;
        msg += `- A change from part-time to full-time resets your benefits eligibility tier.\n`;
        msg += `- File this event in Workday AFTER the marriage QLE so you get the correct full-time plan options.\n`;
        msg += `- Confirm with HR that your status is updated to Full-Time in the payroll system BEFORE electing benefits.\n\n`;
      }

      if (hasPregnancy) {
        msg += `Step ${hasJobChange ? 3 : 2} — Maternity Prep (act now, before Open Enrollment)\n`;
        msg += `- Enroll in Short-Term Disability (STD) via Unum NOW if not already enrolled.\n`;
        msg += `- UNUM STD pays 60% of your salary during the disability period from delivery (typically up to 13 weeks, with a 2-week elimination period).\n`;
        msg += `- FMLA provides up to 12 weeks of job-protected leave — it runs concurrently with STD, not after.\n`;
        msg += `- File FMLA paperwork with HR at least 30 days before your expected leave date.\n\n`;
      }

      msg += `State-Specific Recommendation:\n`;
      msg += `${stateNote}\n\n`;
      msg += `IRS Rule to know: If your spouse has a general-purpose FSA at their employer, you cannot contribute to an HSA. Confirm FSA type before electing HSA contributions.\n\n`;
      msg += `To file all QLE events: ${ENROLLMENT_PORTAL_URL} | HR questions: ${HR_PHONE}`;

      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'multi-qle-state-machine' } });
    }

    const marriageWindowQuestion = /\b(married|marriage|got\s+married)\b/i.test(lowerQuery)
      && /\b(add\s+my\s+spouse|add\s+spouse|how\s+many\s+days|deadline|window|deductible\s+reset|reset\s+to\s+0)\b/i.test(lowerQuery);
    if (marriageWindowQuestion) {
      const msg = `Marriage is typically a Qualifying Life Event (QLE), and most plans require you to submit the change within a limited window (commonly 30 days, sometimes 31/60 depending on plan rules).\n\nDeductible reset: adding a spouse usually changes you from individual to family tier, but it does **not** automatically reset all year-to-date deductible/OOP accumulators to $0. Mid-year accumulator handling follows plan/administrator rules.\n\nAction now: submit the marriage QLE in Workday immediately, upload documentation, and confirm both (1) election effective date and (2) how prior individual accumulators map to family accumulators for your plan.`;
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(msg)) : toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'marriage-window-deductible' } });
    }

    // ── FMLA + STD Leave Pay Timeline (week-by-week) ────────────────────────
    // Fires on ANY leave/pay question involving maternity leave or STD —
    // even without a salary number. Returns the 3-phase timeline + inline math
    // if salary was given. NEVER returns a medical OOP cost table.
    // Broadened: first condition catches "maternity pay" even without the word "leave",
    // preventing the generic maternityFlowRequested block from firing with a cost table
    // when the user is actually asking about STD pay rules.
    const stdLeavePayQuestion = (
      /\b(maternity(?:\s+leave)?|parental\s+leave|fmla|leave\s+of\s+absence)\b/i.test(lowerQuery) &&
      /\b(pay(?:check)?|paid|income|salary|money|how\s+much|week\s*\d*|6th\s+week|sixth\s+week|std|short\s*[- ]?term\s+disability|60%)\b/i.test(lowerQuery)
    ) || (
      /\b(std|short\s*[- ]?term\s+disability)\b/i.test(lowerQuery) &&
      /\b(maternity|leave|pay(?:check)?|paid|salary|60%|sixty\s*percent|week\s*\d+|6th\s+week|sixth\s+week|get\s+paid|income)\b/i.test(lowerQuery)
    );
    if (stdLeavePayQuestion) {
      const salaryMatch = lowerQuery.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{4,6})\s*\/?\s*month/);
      const salary = salaryMatch ? Number(salaryMatch[1].replace(/,/g, '')) : null;
      const stdMonthly = salary ? (salary * 0.6).toFixed(2) : null;
      const mathLine = stdMonthly
        ? `With a salary of $${salary?.toLocaleString()}/month, UNUM STD pays $${stdMonthly}/month during the STD-active weeks (once the 2-week elimination period is satisfied).`
        : 'Share your monthly salary if you want a precise dollar calculation.';
      const lines = [
        'Leave Pay Timeline — Maternity / FMLA + UNUM STD:',
        '',
        '- Weeks 1-2 (Elimination Period): STD benefit is not yet active. Use PTO or this period may be unpaid, depending on your employer leave policy.',
        '- Weeks 3-6 (STD Active — UNUM): UNUM pays 60% of your pre-disability base earnings. FMLA runs concurrently, providing job protection.',
        '- Weeks 7-8 (if physician-certified): STD may continue through week 8 for vaginal delivery or week 10 for C-section, subject to claim approval.',
        '- FMLA (all 12 weeks): Job-protected leave — FMLA does NOT supply pay on its own; income comes from STD and any PTO coordination.',
        '',
        'Key distinctions:',
        '- STD = income replacement (60% of base pay via UNUM).',
        '- FMLA = job protection (federal law, concurrent with STD, unpaid on its own).',
        '- Medical out-of-pocket costs (deductible, OOP max) are a separate question from leave pay.',
        '',
        mathLine,
        '',
        'Verify elimination period, claim approval timeline, and PTO coordination in your UNUM STD certificate/SPD and Workday.',
      ].join('\n');
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(lines)) : toPlainAssistantText(lines);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'fmla-std-leave-pay-timeline' } });
    }

    const stdPreexistingQuestion = /\b(std|short\s*[- ]?term\s+disability)\b/i.test(lowerQuery)
      && /\bpre-?existing|deny\s+my\s+maternity\s+claim|already\s+\d+\s*months\s+pregnant\b/i.test(lowerQuery);
    if (stdPreexistingQuestion) {
      const msg = `This depends on your specific STD policy language and effective-date history. Many STD contracts include pre-existing condition provisions and look-back/look-forward windows, and timing of full-time eligibility can matter.\n\nI can’t safely approve or deny the claim outcome here. The right next step is to check your UNUM STD certificate/SPD clause for pre-existing conditions and confirm your effective date with HR/Benefits immediately.`;
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(msg)) : toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'std-preexisting-guidance' } });
    }

    const allstateTermQuestion = /\b(allstate)\b/i.test(lowerQuery) && /\b(term\s+life)\b/i.test(lowerQuery);
    if (allstateTermQuestion) {
      const msg = `CORRECTION: For AmeriVet plans, Term Life is through UNUM, not Allstate. Allstate is used for Whole Life (permanent, cash-value) only.\n\nIf you want Term Life pricing, it is age-banded and personalized in Workday; I can help with coverage options and enrollment steps.`;
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(msg)) : toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'carrier-correction-term-life' } });
    }

    if (preprocessSignals.authorityConflictIntent) {
      const msg = `For conflicting benefit terms, the Summary Plan Description (SPD) / official plan document is the controlling source in most employer plans.\n\nUse this tie-break order:\n1) SPD / official plan document\n2) Carrier certificate of coverage\n3) Enrollment summaries/SBC or marketing summaries\n\nIf two official docs conflict, escalate to HR/Benefits for a written determination before relying on age-limit rules.`;
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'authority-resolution' } });
    }

    const qleFilingOrderRequested =
      preprocessSignals.hasQLEIntent ||
      (preprocessSignals.hasLifecycleEvent && preprocessSignals.hasFilingOrderIntent);

    if (qleFilingOrderRequested) {
      const stateNote = session.lastDetectedLocationChange
        ? `I updated your location to ${session.lastDetectedLocationChange.to} (from ${session.lastDetectedLocationChange.from}) for this guidance.\n\n`
        : '';
      const msg = `${stateNote}For marriage/job-status/pregnancy scenarios, the safest filing order is:\n1) File the marriage QLE first (add spouse/update dependents).\n2) File the employment-status change event next (part-time/full-time, eligibility status).\n3) File the birth/adoption event after delivery/adoption date.\n4) Upload supporting documents at each step and confirm effective dates in Workday.\n\nMost plans require QLE actions within a limited window (commonly 30 days, sometimes 31/60 by plan/event), so check your SPD and Workday event deadlines immediately.`;
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'qle-filing-order' } });
    }
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
        const plainMsg = toPlainAssistantText(msg);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session) });
    }

    // CUSTOM INTERCEPT: Accident plan name inquiry
    const planNumbersQuery = /plan\s*1\b.*plan\s*2/i.test(lowerQuery);
    if (planNumbersQuery && /\baccident\b/i.test(lowerQuery)) {
        const msg = `There are two accident policy options: Accident Plan 1 and Accident Plan 2. ` +
                    `Plan 1 typically has a higher premium with more comprehensive benefits, while Plan 2 has a lower premium but lower benefit limits. ` +
                    `Refer to the Accident Insurance summary for exact details, or contact HR at ${HR_PHONE}.`;
        const plainMsg = toPlainAssistantText(msg);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'accident-plan-names' } });
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
      let msg = `Here are the available medical plans for the ${coverageTier} tier:\n\n`;
      for (const r of filtered) {
        msg += `- ${r.plan} (${r.provider}): $${pricingUtils.formatMoney(r.perMonth)}/month ($${pricingUtils.formatMoney(r.annually)}/year)\n`;
      }
      if (filtered.length < medRows.length) {
        msg += `\nNote: Kaiser Standard HMO is available only in California.\n`;
      }
      msg += `\nWould you like more detail on any plan, a different coverage tier, or to move on to Dental/Vision?`;
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'medical-comparison' } });
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
      msg += `\nHSA Tax Advantages:\n`;
      msg += `- Contributions are deducted pre-tax from your paycheck, lowering your taxable income\n`;
      msg += `- Funds grow tax-free (interest and investments)\n`;
      msg += `- Withdrawals for eligible medical expenses are tax-free (triple tax advantage)\n`;
      msg += `- Unused funds roll over year to year — there is no "use it or lose it"\n`;
      msg += `- The account is yours — it stays with you even if you leave AmeriVet\n`;
      msg += `\nAlso consider:\n`;
      msg += `- FSA (Flexible Spending Account): Pre-tax dollars for healthcare expenses, but funds typically don't roll over\n`;
      msg += `- Commuter Benefits: Pre-tax transit and parking deductions\n`;
      msg += `\n${session.userAge && session.userAge >= 55 ? 'Since you are 55+, you\'re eligible for an additional $1,000 HSA catch-up contribution per year. ' : ''}For personalized rates and enrollment, visit Workday: ${ENROLLMENT_PORTAL_URL}`;
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'savings-recommendation' } });
    }

    // CUSTOM INTERCEPT: Cost modeling request
    // User wants projected expenses or advanced cost comparison
    // Tightened regex: require explicit cost-modeling language, avoid matching generic "low"/"high"
    const costModelRequested = intentDomain !== 'policy' && /(?:calculate|projected?|estimate).*(?:cost|expense)|healthcare costs.*(?:next year|for \d{4})|(?:low|moderate|high)\s+usage/i.test(lowerQuery);
    if (costModelRequested) {
        // try to parse usage level
        const usageMatch = lowerQuery.match(/(low|moderate|high)\s+usage/);
        const usage: any = usageMatch ? usageMatch[1] as 'low'|'moderate'|'high' : 'moderate';
        const coverageTier = lowerQuery.includes('family') || /family\s*(?:of)?\s*\d|family\d/i.test(lowerQuery) ? 'Employee + Family' : (lowerQuery.includes('child') ? 'Employee + Child(ren)' : 'Employee Only');
        const networkMatch = lowerQuery.match(/kaiser|ppo|hsa|hmo/i);
        const network = networkMatch ? networkMatch[0] : undefined;
        const msg = pricingUtils.estimateCostProjection({ coverageTier, usage, network, state: session.userState || undefined, age: session.userAge || undefined });
        const plainMsg = toPlainAssistantText(msg);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'cost-model' } });
    }

    // CUSTOM INTERCEPT: Maternity coverage comparison
    // Default to Employee + Child for maternity (having a baby implies a dependent)
    // DETERMINISTIC INTERCEPT: Step-by-step parental leave + STD/FMLA planning
    // Catches complex leave-planning queries that would otherwise crash in RAG
    const parentalLeaveStepByStep = /\b(step[- ]by[- ]step|step\s+by\s+step|parental\s+leave|fmla|family\s+(?:and\s+)?medical\s+leave|maternity\s+\+|maternity.*parental|company\s+leave|pay\s+overlap|overlap\s+edge|leave\s+plan|leave\s+across)\b/i.test(lowerQuery)
      && /\b(maternity|pregnant|birth|baby|leave|std|short[- ]term\s+disability)\b/i.test(lowerQuery);
    if (parentalLeaveStepByStep) {
      const msg = `Here is a step-by-step parental leave plan for AmeriVet employees:\n\n` +
        `Step 1 — Short-Term Disability (STD) via Unum\n` +
        `- STD covers disability from delivery itself (childbirth is a covered disability event).\n` +
        `- Standard benefit: 60% of weekly salary after the elimination period (typically 7 days for illness).\n` +
        `- Duration: up to 13 weeks from the qualifying disability date.\n` +
        `- File your STD claim with Unum before your due date. Unum will coordinate with your OB to confirm delivery date and disability period.\n\n` +
        `Step 2 — FMLA (Federal Family and Medical Leave Act)\n` +
        `- FMLA provides up to 12 weeks of job-protected, unpaid leave per year.\n` +
        `- Runs concurrently with STD, not consecutively — they overlap during the STD period.\n` +
        `- Eligibility: 12 months of employment and 1,250 hours worked in the past 12 months at a covered employer.\n` +
        `- File FMLA paperwork with HR at least 30 days before your expected leave date when possible.\n\n` +
        `Step 3 — Company / Employer Paid Leave (if applicable)\n` +
        `- Check your offer letter and HR handbook for any employer-paid parental leave benefit beyond STD.\n` +
        `- Employer-paid leave may stack before or after STD/FMLA — clarify with HR which runs first.\n` +
        `- PTO/vacation can typically be used to top up pay during any unpaid FMLA weeks.\n\n` +
        `Pay overlap edge cases:\n` +
        `- STD + FMLA overlap: You receive STD pay (60% salary) while FMLA job protection runs at the same time.\n` +
        `- If employer leave and STD overlap: most plans offset — you receive the higher of the two, not both added together. Confirm with Unum and HR.\n` +
        `- PTO coordination: some plans require you to exhaust PTO before STD begins. Check your STD certificate.\n` +
        `- Return-to-work: after FMLA expires, additional leave (bonding, non-medical) is at employer discretion and is unpaid unless a separate policy applies.\n\n` +
        `Recommended filing order: (1) Notify HR and file FMLA paperwork, (2) File STD claim with Unum, (3) Confirm any company leave policy with HR, (4) Coordinate PTO usage with payroll.\n\n` +
        `For your specific plan details and to file claims, visit Workday: ${ENROLLMENT_PORTAL_URL} or call HR at ${HR_PHONE}.`;
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'parental-leave-plan' } });
    }

    const maternityRequested = intentDomain !== 'policy' && /maternity|baby|pregnan|birth|deliver/i.test(lowerQuery);
    const maternityFlowRequested = maternityRequested && !qleFilingOrderRequested;
    if (maternityFlowRequested) {
        const coverageTier = lowerQuery.includes('family') ? 'Employee + Family'
            : lowerQuery.includes('employee only') ? 'Employee Only'
            : 'Employee + Child(ren)'; // sensible default for maternity
        const msg = pricingUtils.compareMaternityCosts(coverageTier, session.userState || null);
        const plainMsg = toPlainAssistantText(msg);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'maternity' } });
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
        const plainMsg = toPlainAssistantText(msg);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'orthodontics' } });
    }

    // ========================================================================
    // DENTAL DHMO CLARIFICATION INTERCEPT (Deterministic)
    // ========================================================================
    // AmeriVet does NOT offer a DHMO plan. Only BCBSTX Dental PPO (DPPO).
    // If user asks about DHMO or compares DPPO vs DHMO, clarify and provide DPPO details.
    const dentalDhmoAsked = /\bdhmo\b/i.test(lowerQuery);
    const dentalComparisonAsked = /\b(?:d(?:ifference|ppo)\s*(?:vs?\.?|versus|between|and|compared)|compare.*dental|dental.*compare|explain.*difference.*dental|dental.*difference)\b/i.test(lowerQuery) && /\bdental\b/i.test(lowerQuery);
    if (dentalDhmoAsked || dentalComparisonAsked) {
      const dental = pricingUtils.getDentalPlanDetails();
      let msg = '';
      if (dentalDhmoAsked) {
        msg = `Important clarification: AmeriVet does **not** offer a DHMO (Dental Health Maintenance Organization) plan. Your dental benefit is the **${dental.name}** through ${dental.provider}.\n\n`;
        msg += `Here's what the ${dental.name} provides:\n`;
      } else {
        msg = `AmeriVet offers one dental plan: the **${dental.name}** (${dental.provider}). There is no DHMO option — only the DPPO.\n\n`;
        msg += `Here's what it includes:\n`;
      }
      msg += `- Preventive care (cleanings, exams, X-rays): Covered at 100%\n`;
      msg += `- Basic services (fillings, extractions): 80/20 coinsurance\n`;
      msg += `- Major services (crowns, bridges): 50/50 coinsurance\n`;
      msg += `- Orthodontia: $${dental.orthoCopay} copay\n`;
      msg += `- Deductible: $${dental.deductible} individual / $${dental.familyDeductible} family\n`;
      msg += `- Annual maximum: $${pricingUtils.formatMoney(dental.outOfPocketMax)}\n`;
      msg += `- Network: Nationwide PPO — you can see any dentist, but in-network saves more\n`;
      if (!session.noPricingMode) {
        msg += `\nMonthly premiums:\n`;
        msg += `- Employee Only: $${pricingUtils.formatMoney(dental.tiers.employeeOnly)}/month\n`;
        msg += `- Employee + Spouse: $${pricingUtils.formatMoney(dental.tiers.employeeSpouse)}/month\n`;
        msg += `- Employee + Child(ren): $${pricingUtils.formatMoney(dental.tiers.employeeChildren)}/month\n`;
        msg += `- Employee + Family: $${pricingUtils.formatMoney(dental.tiers.employeeFamily)}/month\n`;
      }
      msg += `\nWould you like to explore another benefit, or do you have questions about dental coverage details?`;
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(msg)) : toPlainAssistantText(msg);
      session.currentTopic = 'Dental';
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'dental-dhmo-clarification' } });
    }

    // ========================================================================
    // CONTINUATION / FOLLOW-UP HANDLER (Short messages with session context)
    // ========================================================================
    // Catches short follow-ups like "difference", "more", "details", "explain"
    // and uses session.currentTopic to provide a context-aware response.
    const isShortFollowUp = query.trim().length < 30 && /^(difference|more|details|explain|tell me more|what'?s the difference|go on|elaborate|how so|why|which one|more info|more details|expand|break it down)$/i.test(query.trim());
    if (isShortFollowUp && session.currentTopic) {
      // Re-route to category exploration with the current topic
      const topicResponse = buildCategoryExplorationResponse(session.currentTopic.toLowerCase(), session, extractCoverageFromQuery(query));
      if (topicResponse) {
        const plainMsg = toPlainAssistantText(topicResponse);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'continuation-handler', topic: session.currentTopic } });
      }
    }

    // ========================================================================
    // CATEGORY EXPLORATION INTERCEPT (Deterministic — no RAG needed)
    // ========================================================================
    // When user says "medical", "dental", "life insurance", "vision", etc.
    // we return a deterministic overview from canonical data. This prevents
    // RAG retrieval failures from producing dead-end "couldn't find" messages.
    const categoryExplorationIntercept = intentDomain === 'policy' ? null : buildCategoryExplorationResponse(lowerQuery, session, extractCoverageFromQuery(query));
    if (categoryExplorationIntercept) {
        // Track current topic so "no thanks" / "skip" can decline it
        session.currentTopic = normalizeBenefitCategory(lowerQuery);
        const plainCategoryResponse = toPlainAssistantText(categoryExplorationIntercept);
        session.lastBotMessage = plainCategoryResponse;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainCategoryResponse, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'category-exploration' } });
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
        const plainMsg = toPlainAssistantText(msg);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session) });
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
    
    // L2 HARD METADATA FILTER: Pass the known user state so the OData filter
    // in hybrid-retrieval.ts can physically restrict the vector index to
    // documents tagged for this state + National. When state is unknown, omit
    // it so the filter falls back to all-national results (no false exclusions).
    const resolvedState = session.userState ?? null;
    const context: RetrievalContext & { userAge?: number; userState?: string } = {
      companyId,
      // Only set state when we KNOW the user's state so the filter is accurate;
      // omit (undefined) when unknown to avoid filtering to 'National' only.
      state: resolvedState ?? undefined,
      dept: session.context?.dept,
      category: category || undefined,
      userAge: session.userAge === null ? undefined : session.userAge,
      userState: resolvedState ?? undefined,
    };

    // QUICK INTERCEPT: per-paycheck deterministic breakdown when user asks explicitly
    const perPaycheckRequested = intentDomain !== 'policy' && /per[\s-]*pay(?:check|\s*period)?\b|per[\s-]*pay\b|\bbiweekly\b|\bbi-weekly\b/i.test(query);
    // Separate signals for total deduction detection (handles multiline and varied phrasings)
    const enrollAllSignal = /\b(enroll\s+in\s+all(?:\s+benefits)?|sign\s+(?:me\s+)?up\s+for\s+(?:all|everything)|all\s+benefits|every\s+benefit|everything)\b/i.test(query);
    const deductionQuestionSignal = /\b(deduct(?:ion|ed|ions)?|per[\s-]*pay(?:check|period)?|how\s+much|total|cost|what\s+would)\b/i.test(query);
    const explicitTotalDeduction = /\b(total\s+deduct(?:ion|ed|ions)?|total\s+(?:monthly|annual)\s+(?:cost|premium)|how\s+much\s+(?:would\s+)?(?:be\s+)?deducted)\b/i.test(query);
    const totalDeductionRequested = intentDomain !== 'policy' && ((enrollAllSignal && deductionQuestionSignal) || explicitTotalDeduction);

    function extractCoverageFromQuery(q: string): string {
      const low = q.toLowerCase();
      // Employee + Family (including natural language like "family of 4", "family plan", "spouse and children")
      if (/employee\s*\+?\s*family|family\s*(of|plan|coverage)|family\s*\d|for\s*(my|the|our)\s*family/i.test(low)) return 'Employee + Family';
      // Family tier from "spouse and N children" or "wife and kids" patterns
      if (/spouse\s*(?:and|\+|&)\s*(?:\d+\s*)?child|wife\s*and\s*(?:\d+\s*)?kid|husband\s*and\s*(?:\d+\s*)?kid|partner\s*and\s*(?:\d+\s*)?child|children.*spouse|spouse.*children/i.test(low)) return 'Employee + Family';
      // Employee + Spouse
      if (/employee\s*\+?\s*spouse|spouse|husband|wife|partner/i.test(low)) return 'Employee + Spouse';
      // Employee + Child(ren) (including "child coverage", "for my kid(s)")
      if (/employee\s*\+?\s*child|child(?:ren)?\s*coverage|for\s*(my|the)\s*(kid|child|son|daughter)|dependent\s*child/i.test(low)) return 'Employee + Child(ren)';
      // Employee Only
      if (/employee\s*only|individual|single|just\s*me|only\s*me/i.test(low)) return 'Employee Only';
      // SESSION TIER LOCK: If session has a locked tier from family detection, use it
      if (session.coverageTierLock) return session.coverageTierLock;
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
        const plainMsg = toPlainAssistantText(msg);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'total-deduction' } });
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
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'total-deduction', allPlans: true } });
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
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'per-paycheck' } });
    }

    logger.debug(`[RAG] Searching with Context - Category: ${category}, HasAge: ${!!session.userAge}, HasState: ${!!session.userState}`);

    const retrievalQuery = preprocessSignals.retrievalBoostTerms.length > 0
      ? `${query}\nFocus topics: ${preprocessSignals.retrievalBoostTerms.join(', ')}`
      : query;

    // 2. HYBRID SEARCH (Vector + BM25 with Category Filter + Query Expansion)
    let result = await hybridRetrieve(retrievalQuery, context);
    
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
        logger.debug('[PIPELINE] Explicit category requested; trying deterministic fallback before dead-end');
        // Try deterministic fallback FIRST instead of a dead-end message
        const deterministicFallback = buildCategoryExplorationResponse(category.toLowerCase(), session, extractCoverageFromQuery(query));
        if (deterministicFallback) {
          const plainDeterministicFallback = toPlainAssistantText(deterministicFallback);
          session.lastBotMessage = plainDeterministicFallback;
          await updateSession(sessionId, session);
          return NextResponse.json({ answer: plainDeterministicFallback, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { expanded: false, explicitCategoryRequested, deterministicFallback: true } });
        }
        // Last resort: helpful message (not a dead-end)
        const alt = `I'd be happy to help with ${category} benefits! Could you tell me more about what you'd like to know? For example:\n- Plan options and what they cover\n- Pricing for your coverage tier\n- How to compare plans\n\nOr check the enrollment portal at ${ENROLLMENT_PORTAL_URL} for full details.`;
        const plainAlt = toPlainAssistantText(alt);
        session.lastBotMessage = plainAlt;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainAlt, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { expanded: false, explicitCategoryRequested } });
      }

      // Expand search by removing category filter when the category was NOT explicitly requested
      if (category) {
        const wideContext = { ...context, category: undefined };
        result = await hybridRetrieve(retrievalQuery, wideContext);
            
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
        const plainMsg = toPlainAssistantText(msg);
        return NextResponse.json({ 
          answer: plainMsg, 
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
        const plainAlternativeMsg = toPlainAssistantText(alternativeMsg);
        session.lastBotMessage = plainAlternativeMsg;
        await updateSession(sessionId, session);
        
        return NextResponse.json({ 
          answer: plainAlternativeMsg, 
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

    // 5. GENERATE ANSWER — Data-Sovereign prompt with immutable catalog
    // Score-filtered, deduplicated, token-budgeted context — see buildGroundedContext() for rationale
    const contextText = buildGroundedContext(result.chunks, result.scores?.rrf || []);
    
    const systemPrompt = buildSystemPrompt(session);
    
    // Build conversation history for context (last 2 exchanges)
    const recentHistory = (session.messages || []).slice(-4)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

    // Confidence-based hint (minor — the system prompt already enforces catalog-only answers)
    const confidenceHint = useDisclaimer
        ? `If the catalog doesn't have an exact match, say: "Based on the plans available to you..." and give the closest answer from the catalog.`
        : `Answer directly from the catalog.`;

    // POLICY ROUTING MODE: when intent is policy (FMLA, SPD, QLE, IRS rules)
    // instruct LLM to SKIP pricing tables and focus on rules/process.
    const policyRoutingHint = preprocessSignals.intentDomainRoute === 'policy'
      ? `\nPOLICY REASONING MODE ACTIVE: The user is asking about rules, process, timelines, or compliance — NOT about pricing. Do NOT show any cost tables, premium comparisons, or dollar amounts. Search specifically for SPD language, QLE rules, FMLA policy, and IRS compliance rules. Answer in plain text paragraphs, not tables.`
      : '';

    // NO-PRICING MODE: If user requested "no pricing" / "coverage only", instruct LLM accordingly
    const noPricingHint = session.noPricingMode
        ? `\nIMPORTANT: The user has requested NO PRICING information. Do NOT include any dollar amounts, cost tables, premium figures, or $ signs. Focus exclusively on plan features, deductibles, coinsurance percentages, coverage details, and network information.`
        : '';

    // TIER LOCK HINT: If session has a locked tier, inform LLM
    const tierLockHint = session.coverageTierLock
        ? `\nThe user has indicated they need ${session.coverageTierLock} coverage. Default ALL pricing and plan comparisons to the ${session.coverageTierLock} tier unless they explicitly ask for a different tier.`
        : '';

    // Found categories for alternative suggestions
    const foundCategories = pipelineResult.reasoning.metadata?.foundCategories as string[] | undefined;
    const alternativeHint = foundCategories && foundCategories.length > 0 && category && !foundCategories.includes(category)
        ? `\nIf ${category} info is missing from retrieval, mention that you found ${foundCategories.join(' and ')} plans and offer those instead.`
        : '';

    // User message with retrieval context and current question
    // Build the strict state header to inject into every user message (re-enforcement)
    const stateEnforcement = session.userState
      ? (KAISER_STATES.has(session.userState.toUpperCase())
        ? `STATE LOCK [${session.userState}]: Kaiser IS available. Include it.`
        : `STATE LOCK [${session.userState}]: KAISER IS FORBIDDEN — exclude it entirely. Do NOT mention Kaiser.`)
      : `STATE: Unknown — do not reference regional plan availability.`;

    const userMessage = `${stateEnforcement}

RETRIEVAL CONTEXT (supplementary — catalog in system prompt is authoritative):
${contextText}

CONVERSATION HISTORY:
${recentHistory}

QUESTION: ${query}

═══════════════════════════════════════════════════════════════════════════
PRINCIPAL ARCHITECT REASONING PROTOCOL (MANDATORY)
═══════════════════════════════════════════════════════════════════════════
Execute the full Self-Ask → CoT → ReAct pipeline from the system prompt.
Output your answer in EXACTLY this two-section format — both sections required:

[REASONING]:
• Self-Ask: list the hidden sub-questions you must resolve (FSA type, salary math, state, week-N)
→ CoT: step-by-step logic + any math (Monthly ÷ 4.33 × 0.60 for STD weekly pay)
→ ReAct: if any catalog lookup is needed, state "Action: look up X" then "Observation: Found Y"

[RESPONSE]:
<your final conversational answer — plain prose, no [Source N] citations, no <thought> tags>
${confidenceHint}${alternativeHint}${noPricingHint}${policyRoutingHint}${tierLockHint}
Remember: answer ONLY from the IMMUTABLE CATALOG. Do NOT ask for name, age, or state. Do NOT mention Rightway. Do NOT attribute Whole Life to Unum or Term Life to Allstate. Do NOT invent a "PPO" medical plan. Do NOT show [Source N] or [Doc N] citations in your response. AmeriVet does NOT offer a DHMO dental plan — only the BCBSTX Dental PPO.`;

    logger.debug(`[RAG] Generating answer with ${result.chunks.length} chunks`);

    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ], { temperature: 0.1 });

    let answer = completion.content.trim();
    answer = extractReasonedResponse(answer, true); // extract [RESPONSE], log [REASONING] debug trace
    answer = stripThoughtBlock(answer, true);        // strip any residual <thought> blocks
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
    
    // POST-PROCESSING: Strip banned content (Rightway, wrong phone numbers, wrong carriers)
    // Sentence-level removal: match any sentence containing a banned term
    const BANNED_TERMS_RE = /rightway|right\s*way/i;
    const BANNED_PHONE_RE = /\(?\s*305\s*\)?\s*[-.]?\s*851\s*[-.]?\s*7310/g;
    if (BANNED_TERMS_RE.test(answer)) {
        logger.warn('[QA] Stripped Rightway reference from LLM response');
        // Remove sentences (delimited by . ! ? or newline) mentioning banned terms
        answer = answer
            .split(/(?<=[.!?\n])/)
            .filter(sentence => !BANNED_TERMS_RE.test(sentence))
            .join('')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        // If stripping left the answer empty or broken, provide fallback
        if (answer.length < 20) {
            answer = `For live support or additional assistance, please contact AmeriVet HR/Benefits at ${HR_PHONE}. You can also visit the enrollment portal at ${ENROLLMENT_PORTAL_URL} for self-service options.\n\nIs there anything else I can help you with?`;
        }
    }
    // Strip the (305) 851-7310 number if it appears - replace with real HR number
    answer = answer.replace(BANNED_PHONE_RE, `AmeriVet HR/Benefits at ${HR_PHONE}`);

    // POST-PROCESSING: Strip [Source N] / [Doc N] citation artifacts from LLM output
    answer = answer.replace(/\[(?:Source|Doc(?:ument)?|Ref(?:erence)?)\s*\d+\]/gi, '').replace(/\s{2,}/g, ' ').trim();

    // POST-PROCESSING: Strip <thought>…</thought> CoT blocks (log to debug, never show user)
    answer = stripThoughtBlock(answer, true);

    // POST-PROCESSING: Apply Brandon Rule (HSA Cross-Sell)
    
    // POST-PROCESSING: Orthodontics grounding check
    if (/orthodont/i.test(answer) && !result.chunks.some(c => /orthodont/i.test(c.content))) {
        logger.warn('[QA] Removed ungrounded orthodontics claim from answer');
        answer = answer.replace(/[^.]*orthodont[^.]*\./gi, '').trim();
    }

    answer = applyBrandonRule(answer, routerResult);

    // POST-PROCESSING: CARRIER INTEGRITY GUARD (Deterministic)
    // — Allstate = Whole Life only. Never attribute term life to Allstate.
    // — UNUM = Basic/Voluntary Term Life only. Never attribute whole life to Unum.
    // — BCBSTX = Medical/Dental. Never attribute life insurance to BCBSTX.
    // — Never mention "Rightway" (already handled above).
    const CARRIER_MISATTRIBUTION_RULES: Array<{ pattern: RegExp; fix: string }> = [
      { pattern: /allstate\s+(?:voluntary\s+)?term\s+life/gi, fix: 'Unum Voluntary Term Life' },
      { pattern: /unum\s+whole\s+life/gi, fix: 'Allstate Whole Life' },
      { pattern: /bcbstx?\s+(?:life|disability|accident|critical)/gi, fix: '' }, // strip entirely
    ];
    for (const rule of CARRIER_MISATTRIBUTION_RULES) {
      if (rule.fix) {
        answer = answer.replace(rule.pattern, rule.fix);
      } else {
        // Strip sentences containing the misattribution
        const test = rule.pattern;
        test.lastIndex = 0; // Reset regex state
        if (test.test(answer)) {
          logger.warn(`[CARRIER-INTEGRITY] Stripped misattributed carrier sentence`);
          answer = answer.split(/(?<=[.!?\n])/).filter(s => !rule.pattern.test(s)).join('').trim();
        }
      }
    }

    // POST-PROCESSING: PPO HALLUCINATION GUARD
    // If the answer mentions a "PPO" medical plan (not dental PPO), strip or correct it
    const PPO_MEDICAL_HALLUCINATION = /\b(?:BCBSTX?\s+PPO|PPO\s+(?:Standard|plan|medical)|medical\s+PPO)\b/gi;
    if (PPO_MEDICAL_HALLUCINATION.test(answer) && !/dental\s+ppo/i.test(answer.match(PPO_MEDICAL_HALLUCINATION)?.[0] || '')) {
      logger.warn('[PPO-GUARD] Stripped hallucinated PPO medical plan reference');
      answer = answer.replace(PPO_MEDICAL_HALLUCINATION, 'Standard HSA/Enhanced HSA (PPO network)');
    }

    // POST-PROCESSING: NO-PRICING ENFORCEMENT — strip all $ and cost lines if noPricingMode
    if (session.noPricingMode) {
      // Remove lines containing dollar amounts
      answer = answer.split('\n').filter(line => !/\$\d/.test(line)).join('\n');
      // Remove inline dollar mentions
      answer = answer.replace(/\$[\d,]+\.?\d{0,2}(?:\/(?:month|year|mo|yr|paycheck|pay period|bi-?weekly?))?/gi, '[see portal for pricing]');
      answer = answer.replace(/\[see portal for pricing\](?:\s*\([^)]*\))?/g, '[see portal for pricing]');
      logger.debug('[NO-PRICING] Stripped pricing from response');
    }

    answer = toPlainAssistantText(answer);

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
        const plainMsg = toPlainAssistantText(msg);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: null, metadata: { fallback: true } }, { status: 200 });
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