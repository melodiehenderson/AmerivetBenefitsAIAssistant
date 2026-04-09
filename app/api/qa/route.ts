import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { azureOpenAIService } from '@/lib/azure/openai';
import type { RetrievalContext, Chunk } from '@/types/rag';
import { getOrCreateSession, updateSession, type Session } from '@/lib/rag/session-store';
import {
  validatePricingFormat,
  enforceMonthlyFirstFormat,
  cleanResponseText,
  stripInternalPrompts
} from '@/lib/rag/response-utils';
import {
  runValidationPipeline,
  generateAlternativeResponse,
  type PipelineResult,
  type ValidationResult
} from '@/lib/rag/validation-pipeline';
import { detectTextualHallucination } from '@/lib/rag/validation';
import { verifyNumericalIntegrity } from '@/lib/rag/grounding-audit';
import { pipelineLogger, createTrace } from '@/lib/services/pipeline-logger';
import { buildPersonaDirective, detectPersona, type ResponsePersona } from '@/lib/response-persona';
import { digestIntent, detectIntentDomain, type IntentDomain } from '@/lib/intent-digest';
import { applyChildCoverageTierLock, applyNameCapture, applySelfHealGuest, ensureNameForDemographics, shouldPromptForName } from '@/lib/session-logic';

import { IRS_2026 } from '@/lib/data/irs-limits-2026';
import {
  routeIntent,
  checkStateGate,
  applyBrandonRule,
  getAgeBandedResponse,
  type RouterResult
} from '@/lib/rag/semantic-router';
import pricingUtils from '@/lib/rag/pricing-utils';
import { classifyQueryIntent, getIntentHint, type QueryIntent } from '@/lib/rag/query-intent-classifier';
import { amerivetBenefits2024_2025, getCatalogForPrompt, KAISER_AVAILABLE_STATE_CODES } from '@/lib/data/amerivet';
import {
  buildKaiserUnavailableFallback,
  buildMedicalPlanFallback,
  buildPpoClarificationFallback,
  buildRecommendationOverview,
  getAvailablePricingRows,
  getCoverageTierForQuery,
  isKaiserEligibleState,
} from '@/lib/qa/medical-helpers';
import {
  buildAllPlansEstimateMessage,
  buildMedicalComparisonMessage,
  buildPerPaycheckMessage,
  buildPlanPricingMessage,
  buildTwoPlanComparisonMessage,
} from '@/lib/qa/medical-response-builders';
import {
  buildExplicitCategoryPrompt,
  buildGateFailureEscalationMessage,
  buildSingleDentalPlanFallback,
  buildValidationSafeFallback,
  buildZeroChunkFallbackMessage,
  recordAssistantReply,
} from '@/lib/qa/post-retrieval-fallbacks';
import { buildScopeGuardResponse } from '@/lib/qa/scope-guard';
import {
  buildCategoryExplorationResponse,
  buildDentalVisionComparisonResponse,
} from '@/lib/qa/category-response-builders';
import {
  buildAccidentPlanNamesMessage,
  buildAllstateTermLifeCorrection,
  buildAuthorityResolutionMessage,
  buildLiveSupportMessage,
  buildParentalLeavePlan,
  buildQleFilingOrderMessage,
  buildStdLeavePayTimeline,
  buildStdPreexistingGuidance,
} from '@/lib/qa/policy-response-builders';
import { buildLiveSupportFallback } from '@/lib/qa/support-response-builders';
import {
  resolvePipelineFirstFallback,
  resolveValidationFallback,
} from '@/lib/qa/fallback-decision-router';
import {
  checkL1FAQ,
  compileSummary,
  deriveConversationTopic,
  isLikelyFollowUpMessage,
  isSimpleAffirmation,
  isSummaryRequest,
  isTopicContinuationMessage,
  normalizeBenefitCategory,
  shouldUseCategoryExplorationIntercept,
  shouldUseMedicalComparisonIntercept,
  shouldUsePlanPricingIntercept,
} from '@/lib/qa/routing-helpers';
// Utility to extract all numbers from the AmeriVet catalog object
function extractAllNumbers(obj: any): number[] {
  const nums: number[] = [];
  if (typeof obj === 'number') {
    nums.push(obj);
  } else if (Array.isArray(obj)) {
    for (const v of obj) nums.push(...extractAllNumbers(v));
  } else if (typeof obj === 'object' && obj !== null) {
    for (const v of Object.values(obj)) nums.push(...extractAllNumbers(v));
  }
  return nums;
}

export const dynamic = 'force-dynamic';

// Enrollment portal URL — use env var to avoid hardcoding
const ENROLLMENT_PORTAL_URL = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.html';
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
const KAISER_STATES = new Set<string>(KAISER_AVAILABLE_STATE_CODES);

// City -> State resolver: if user provides a city, resolve state automatically (No-Loop Rule)
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
  const agePlusState = original.match(/\b(1[8-9]|[2-9][0-9])\b\s*[,-/\s]+\s*([A-Za-z]{2})\b/);
  const statePlusAge = original.match(/\b([A-Za-z]{2})\b\s*[,-/\s]+\s*\b(1[8-9]|[2-9][0-9])\b/);
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

  // 3) City name -> State resolution (No-Loop Rule)
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
  //    Also covers: "not asking about pricing", "don't tell me prices", "skip the price", "just features"
  //    NOTE: Trailing \b removed on partial-word patterns (pric->pricing, cost->costs, etc.)
  const noPricing = /(?:\bno\s*pric|\bno\s*rates?\b|\bno\s*costs?\b|\bno\s*dollar|\bno\s+money\b|\bcoverage\s*only\b|\bfeatures?\s*only\b|\bwithout\s*(?:any\s*)?(?:pric|cost|dollar|rate)|\bskip\s*(?:the\s*)?pric|(?:\bdon'?t|\bdo\s+not)\s*(?:show|tell|include|need|list|mention|give|use|add|display|put)\s*(?:me\s*)?(?:any\s*)?(?:the\s*)?(?:cost|pric|rate|premium|dollar)|\bnot\s+(?:asking|looking)\s+(?:about|for)\s+(?:any\s*)?(?:the\s*)?(?:pric|rate|cost)|\bjust\s+(?:the\s*)?(?:feature|coverage|detail|difference|plan|option|benefit)|\bno\s*\$|\bno\s+price|\bignore\s*(?:the\s*)?(?:pric|cost|rate)|\bforget\s*(?:the\s*)?(?:pric|cost|rate))/i.test(clean);

  // E. FAMILY TIER DETECTION — "Spouse and 3 children", "family of 5", "wife and kids", "a spouse and 3 kids"
  //    Automatically locks subsequent responses to Employee + Family tier.
  const familyTierSignal = /\b(spouse\s*(?:and|\+|&)\s*(?:\d+\s*)?(?:child|kid)|family\s*of\s*[3-9]|wife\s*and\s*(?:\d+\s*)?kid|husband\s*and\s*(?:\d+\s*)?kid|partner\s*and\s*(?:\d+\s*)?child|(?:my|our)\s*(?:whole\s*)?family|spouse.*children|children.*spouse|have\s+(?:a\s+)?spouse\s+and\s+(?:\d+\s*)?(?:child|kid)|(?:\d+)\s*kids?\s*(?:and|with)\s*(?:a\s+)?spouse|spouse.*(?:\d+)\s*kids?)\b/i.test(clean);

  // F. PPO PLAN REQUEST — user explicitly asks for "the PPO plan" (does not exist)
  // Exclude: comparison queries like "compare X vs the PPO" should not trigger the PPO-CLARIFICATION intercept
  const asksPPOPlan = /\b(?:ppo\s*plan|the\s*ppo|ppo\s*option|ppo\s*medical|medical\s*ppo)\b/i.test(clean) && !/dental/i.test(clean) && !/\b(?:compare|vs\.?|versus|between|both|vs\s|and\s+the\s+ppo)\b/i.test(clean);

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

function getRemainingBenefits(decisions: Record<string, any>): string[] {
  const allCategories = ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA'];
  return allCategories.filter(c => !decisions[c]);
}

function normalizeMojibake(text: string): string {
  const replacements: Array<[string, string]> = [
    ['ΓÇö', '-'],
    ['ΓÇô', '-'],
    ['ΓÇÖ', "'"],
    ['ΓÇ£', '"'],
    ['ΓÇ¥', '"'],
    ['ΓÇó', '-'],
    ['ΓòÉ', ''],
    ['ΓöÇ', ''],
    ['Γû╢', ''],
    ['ΓåÆ', '->'],
    ['├╖', '/'],
    ['├ù', 'x'],
  ];

  let out = text;
  for (const [bad, good] of replacements) {
    out = out.split(bad).join(good);
  }
  return out;
}

function applyPricingExclusion(answer: string, pricingExclusion: boolean): string {
  if (!pricingExclusion) return answer;
  const withoutDollarLines = answer
    .split('\n')
    .filter(line => !/\$\d/.test(line))
    .join('\n');
  return withoutDollarLines.replace(/\$\d+(?:,\d{3})*(?:\.\d{1,2})?/g, '[see portal for pricing]');
}

function isLikelyGarbledInput(query: string): boolean {
  const normalized = query.toLowerCase().trim();
  if (normalized.length < 24) return false;

  const knownIntent = /\b(health|medical|dental|vision|life|hsa|fsa|kaiser|benefit|benefits|premium|cost|compare|plan|family|spouse|child|enroll|enrollment|workday|hr)\b/i.test(normalized);
  if (knownIntent) return false;

  const compact = normalized.replace(/\s+/g, '');
  if (compact.length < 20) return false;

  const alphaCount = (compact.match(/[a-z]/g) || []).length;
  const punctCount = (compact.match(/[^a-z0-9]/g) || []).length;
  const vowels = (compact.match(/[aeiou]/g) || []).length;
  const vowelRatio = alphaCount > 0 ? vowels / alphaCount : 0;
  const punctRatio = punctCount / Math.max(compact.length, 1);

  const tokens = normalized.split(/\s+/).filter(t => t.length >= 4);
  const noVowelTokens = tokens.filter(t => !/[aeiou]/.test(t)).length;
  const weirdTokenRatio = tokens.length > 0 ? noVowelTokens / tokens.length : 0;

  const keyboardMash = /(\w*[bcdfghjklmnpqrstvwxyz]{6,}\w*)/i.test(normalized);

  return (
    punctRatio > 0.22 ||
    (vowelRatio < 0.24 && keyboardMash) ||
    (tokens.length >= 4 && weirdTokenRatio >= 0.5)
  );
}

function toPlainAssistantText(text: string): string {
  const normalized = normalizeMojibake(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  return normalized
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================================
// L1 STATIC FAQ CACHE  (zero-LLM, zero-hallucination for 100% static answers)
// ============================================================================
// Any question that matches a pattern here is answered deterministically
// without touching RAG or the LLM.  Add entries as AmeriVet FAQ solidifies.
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
 * Extract monthly salary (in dollars) from a free-text user message.
 * Handles: "$5,000/month" | "$5k/month" | "$60k/year" | "earn 5000 monthly" | "$60,000 annually"
 * Annual amounts are converted to monthly (/ 12, rounded).
 * Returns null if no salary found or value is outside a plausible employee range.
 */
export function extractSalaryFromMessage(msg: string): number | null {
  // Monthly: $5,000/month | $5k/month | 5000 per month | earn $5000 monthly
  const MONTHLY_RE = /(?:earn|make|paid|salary\s+is?)?\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*|[1-9][0-9]{3,5})\s*(k)?\s*(?:\/\s*month|per\s+month|a\s+month|\bmonthly\b)/i;
  const monthlyM = MONTHLY_RE.exec(msg);
  if (monthlyM) {
    let v = Number(monthlyM[1].replace(/,/g, ''));
    if (monthlyM[2]) v *= 1000;
    if (v >= 1_000 && v <= 50_000) return v;
  }
  // Annual: $60,000/year | $60k/year | $60k annually
  const ANNUAL_RE = /(?:earn|make|paid|salary\s+is?)?\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*|[1-9][0-9]{4,6})\s*(k)?\s*(?:\/\s*year|per\s+year|annually|\ba\s+year\b)/i;
  const annualM = ANNUAL_RE.exec(msg);
  if (annualM) {
    let v = Number(annualM[1].replace(/,/g, ''));
    if (annualM[2]) v *= 1000;
    if (v >= 12_000 && v <= 600_000) return Math.round(v / 12);
  }
  return null;
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
function buildGroundedContext(chunks: Chunk[], rrfScores: number[]): { context: string; stats: { chunksRaw: number; chunksPassedFilter: number; totalChars: number } } {
  if (!chunks.length) return { context: 'No retrieval context available.', stats: { chunksRaw: 0, chunksPassedFilter: 0, totalChars: 0 } };

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

  const stats = { chunksRaw: chunks.length, chunksPassedFilter: parts.length, totalChars };
  if (parts.length === 0) {
    logger.debug(`[CONTEXT] No chunks passed score filter (raw=${chunks.length}, threshold=${scoreThreshold.toFixed(4)})`);
    return { context: 'No relevant benefit documents retrieved.', stats: { ...stats, chunksPassedFilter: 0 } };
  }
  logger.debug(`[CONTEXT] Grounded context: ${parts.length}/${chunks.length} chunks passed filter, ${totalChars} chars (threshold=${scoreThreshold.toFixed(4)})`);
  return { context: parts.join('\n\n---\n\n'), stats };
}

/**
 * Score how well the generated answer addresses the original query.
 * Returns a 0–1 composite from three signals:  
 *  - coverage: fraction of meaningful query tokens found in the answer
 *  - specificity: presence of plan names, dollar amounts, or carrier names
 *  - length: proportional penalty if answer is too short or too long
 */
/**
 * Extract all dollar amounts from the serialized catalog string into a normalised Set.
 * Used by auditDollarGrounding for O(1) lookup.
 */
export function buildCatalogNumberSet(catalogText: string): Set<string> {
  const raw = catalogText.match(/\$[\d,]+\.?\d*/g) || [];
  return new Set(raw.map(v => v.replace(/[$,]/g, '').replace(/\.0{1,2}$/, '')));
}

/**
 * Soft dollar-grounding audit.
 * - Sentences containing math markers (├╖, ├ù, 4.33, weekly pay, STD) are EXEMPT.
 * - For every other sentence: extract $X amounts, normalise and check against catalog
 *   numbers AND the raw retrieved chunk text.
 * - Ungrounded amounts are replaced with "(see enrollment portal for exact rate)".
 * Returns { answer (possibly revised), warnings (list of flagged amounts for logging) }.
 */
export function auditDollarGrounding(
  answer: string,
  catalogNumbers: Set<string>,
  chunks: Chunk[]
): { answer: string; warnings: string[] } {
  const warnings: string[] = [];
  const chunkText = chunks.map(c => c.content).join(' ');
  // Sentences with computation language are exempt from the grounding check
  const mathSentenceRe = /\/|\*|4\.33|weekly\s+(?:pay|benefit|base)|std\s+(?:pay|benefit|weekly)|60%\s+of|salary.*(?:\/|\*|\/\s*4)|annually|per\s+year|annual\s+(?:premium|cost|total)/i;
  // Split on sentence-ending punctuation, preserving the delimiter
  const sentences = answer.split(/(?<=[.!?\n])\s+/);
  const audited = sentences.map(sentence => {
    if (mathSentenceRe.test(sentence)) return sentence; // exempt calculation context
    const dollarMatches = [...new Set(sentence.match(/\$[\d,]+\.?\d*/g) || [])];
    let s = sentence;
    for (const dm of dollarMatches) {
      const normalized = dm.replace(/[$,]/g, '').replace(/\.0{1,2}$/, '');
      const inCatalog = catalogNumbers.has(normalized);
      // Check both the normalised form ('1200') and the raw form ('$1,200') so
      // comma-separated amounts authored in chunk text are correctly matched.
      const inChunks  = chunkText.includes(normalized) || chunkText.includes(dm);
      if (!inCatalog && !inChunks) {
        warnings.push(dm);
        // Build a safe regex from the raw match (e.g. '$9,999')
        const escapedDm = dm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp(escapedDm, 'g'), '(see enrollment portal for exact rate)');
      }
    }
    return s;
  });
  return { answer: audited.join(' ').trim(), warnings };
}

function scoreGenerationQuality(
  query: string,
  answer: string
): { score: number; coverage: number; specificity: number; lengthOk: boolean } {
  const STOPWORDS = new Set(['i','the','a','an','is','are','was','were','in','on','at','to','of','and','or','for','with','my','me','do','does','what','how','which','can','be','have','has','that','it','this','not','no','help','about','much']);
  const queryTokens = query.toLowerCase().split(/\W+/).filter(t => t.length > 2 && !STOPWORDS.has(t));
  const answerLower = answer.toLowerCase();

  // 1. Keyword coverage: how many query terms appear in the answer?
  const matched = queryTokens.filter(t => answerLower.includes(t));
  const coverage = queryTokens.length > 0 ? matched.length / queryTokens.length : 0;

  // 2. Specificity: does the answer contain concrete data (numbers, plan names, carriers)?
  const specificitySignals = [
    /\$[\d,]+/.test(answer),           // dollar amounts
    /\b(standard hsa|enhanced hsa|kaiser|bcbstx?|unum|allstate|vsp)\b/i.test(answer), // plan/carrier names
    /\b\d{1,3}(?:[.,]\d+)?\s*%/.test(answer),  // percentages
    /\b(week|month|year|day)\b/i.test(answer),  // time references
  ];
  const specificity = specificitySignals.filter(Boolean).length / specificitySignals.length;

  // 3. Length penalty: too short (<120 chars) or too long (>3 600 chars)
  const lengthOk = answer.length >= 120 && answer.length <= 3_600;
  const lengthMultiplier = lengthOk ? 1 : (answer.length < 120 ? 0.6 : 0.85);

  const score = Math.min(1, (coverage * 0.55 + specificity * 0.45) * lengthMultiplier);
  return { score: parseFloat(score.toFixed(3)), coverage: parseFloat(coverage.toFixed(3)), specificity: parseFloat(specificity.toFixed(3)), lengthOk };
}

// ============================================================================
// 2. SYSTEM PROMPT — "ABSOLUTE TRUTH" (Data-Sovereign Benefits Engine)
// ============================================================================
// BENEFIT_CONSTRAINTS constant to enforce structured output and persona.
const BENEFIT_CONSTRAINTS = `
## ROLE
Senior Benefits Advisor. Stay accurate and adapt the presentation to the user's intent and persona.

## FORMATTING RULES (ADAPTIVE)
1. Use tables when they clarify comparisons, numeric tradeoffs, or plan differences.
2. Use short narrative blocks when the user is asking for explanation, guidance, or reassurance.
3. Start with the most useful answer, not a generic opener.
4. Use '⚠️ Not Covered' for any null or missing catalog values.
5. Keep structure aligned to the active persona and the user's intent.

## OUTPUT STRUCTURE
[REASONING]: <Internal CoT>
[RESPONSE]:
| Feature | {Plan A} | {Plan B} |
|:---|:---|:---|
...
`;

function buildSystemPrompt(session: any, persona: ResponsePersona): string {
  const formattingDirective = buildPersonaDirective(persona);
  // === ANNUAL STATUTORY LIMITS (IMMUTABLE) ===
  const irsBlock = `\nANNUAL STATUTORY LIMITS (IMMUTABLE)\n-----------------------------------\nHSA Self-Only Limit: $${IRS_2026.HSA_SELF_ONLY}\nHSA Family Limit: $${IRS_2026.HSA_FAMILY}\nHSA Catch-Up (age ${IRS_2026.HSA_CATCHUP_AGE}+): +$${IRS_2026.HSA_CATCHUP_ADDITIONAL}\nFSA General Purpose Max: $${IRS_2026.FSA_GENERAL_MAX}\nFSA Limited Purpose Max: $${IRS_2026.FSA_LIMITED_MAX}\nFSA Rollover Max: $${IRS_2026.FSA_ROLLOVER_MAX}\nDependent Care FSA Max: $${IRS_2026.DEPENDENT_CARE_FSA_MAX}\nRULE: Use ONLY these numbers for IRS limits. Never use training knowledge.\n-----------------------------------\n\nIRS_2026 JSON:\n${JSON.stringify(IRS_2026, null, 2)}\n-----------------------------------`;

  // === Session context ===
  const decisions = session.decisionsTracker || {};
  const decisionEntries = Object.entries(decisions);
  const decisionsText = decisionEntries.length > 0
    ? decisionEntries.map(([cat, val]: [string, any]) => {
        const entry = typeof val === 'string' ? { status: 'selected', value: val } : val;
        return `- ${cat}: ${entry.status === 'selected' ? entry.value || 'Selected' : 'Declined'}`;
      }).join('\n')
    : 'None yet';
  const remaining = getRemainingBenefits(decisions);
    const remainingText = remaining.length > 0 ? remaining.join(', ') : 'All categories explored';
  
    // === Kaiser eligibility ===
    const userState = session.userState || '';
    const kaiserEligible = KAISER_STATES.has(userState.toUpperCase());
    const kaiserRule = userState
      ? (kaiserEligible
        ? `Kaiser HMO IS available in ${userState}. Include Kaiser in medical comparisons.`
        : `Kaiser HMO is NOT available in ${userState}. Exclude Kaiser from offered plans and pricing. If a regional comparison requires a Kaiser row, mark it as '⚠️ Not Covered'.`)
      : `State unknown. Do not reference Kaiser or regional plan availability.`;
  
    // === Catalog injection (state-filtered) ===
    const catalog = getCatalogForPrompt(userState || null);
  
    // === Dynamic mode blocks ===
    const policyModeHint = session.policyReasoningMode
      ? `\n**POLICY MODE ACTIVE**: Lead with eligibility rules/QLE windows, not pricing tables.`
      : '';
    const noPricingHint = session.noPricingMode
      ? `
  **NO PRICING MODE**: Do NOT include $ amounts, premiums, or cost tables. Coverage/rules only.`
      : '';
  
    // Enhanced rule for "Not Covered" tagging
    const notCoveredRule = `
  - **Not Covered Tagging**: If a feature or benefit is not available or a value is null/undefined in the catalog, you MUST represent it in any generated Markdown table with the specific string '⚠️ Not Covered'.`;

  return `
${irsBlock}
<Session>
  Name: ${session.userName || 'Guest'} | State: ${userState || 'Unknown'} | Age: ${session.userAge || 'Unknown'}
  Salary: ${session.userSalary ? '$' + session.userSalary.toLocaleString() + '/month' : 'Unknown'}
  Topic: ${session.currentTopic || 'General Benefits'} | Turn: ${session.turn || 1}
  Decisions: ${decisionsText}
  Remaining: ${remainingText}
</Session>

<Role>AmeriVet Senior Benefits Advisor — data-sovereign, zero-hallucination, expert in IRS rules for HSA/FSA conflicts.</Role>

<Reasoning>
Before answering:
1.  **Self-Ask**: Identify hidden sub-questions. For spousal insurance changes, the CRITICAL sub-question is the "HSA/FSA dual-enrollment conflict" (IRS Publication 969). Does the spouse's new plan have a general-purpose FSA? This is the #1 point to address. Other sub-questions: coordination of benefits, QLE opportunity.
2.  **CoT**: Step through policy rules. Math: Monthly / 4.33 = Weekly; Weekly * 0.60 = STD pay
3.  **ReAct**: If data needed, search IMMUTABLE CATALOG below. Never fabricate.

Output format:
[REASONING]: Sub-questions -> CoT steps -> ReAct observations
[RESPONSE]: Final conversational answer (no [Source N] citations, no <thought> tags)
</Reasoning>

<Critical_Rules>
STATE-LOCK: ${kaiserRule}
CARRIER-LOCK:
- Medical: BCBSTX Standard HSA & Enhanced HSA${kaiserEligible ? ', Kaiser HMO' : ''} (PPO network, but HDHP plans)
- Dental: BCBSTX Dental PPO | Vision: VSP
- When asked about any benefit (dental, vision, medical, life, disability, HSA), answer immediately with full details from the catalog. Never ask clarifying questions before answering. Provide the answer first, then offer follow-up options at the end.
- Life: Unum (Basic $25k employer-paid, Voluntary Term) + Allstate (Whole Life)
- Disability: Unum | Critical Illness/Accident: Allstate
- NEVER cross these assignments. Term life = Unum. Whole life = Allstate.

NO-HALLUCINATION:
- Every dollar amount, plan name, carrier MUST appear verbatim in IMMUTABLE CATALOG
- If not in catalog: "Check ${ENROLLMENT_PORTAL_URL} or call HR at ${HR_PHONE}"
- Age-banded products: "Log in at ${ENROLLMENT_PORTAL_URL} for your personalized rate"

FORBIDDEN:
- Rightway — NOT an AmeriVet resource
- Phone (305) 851-7310 — NOT an AmeriVet number
- Medical "PPO plan" — no standalone PPO exists. Standard/Enhanced HSA use PPO network.
- DHMO dental — AmeriVet only offers BCBSTX Dental PPO

NO-LOOP: You have Name=${session.userName || '?'}, Age=${session.userAge || '?'}, State=${userState || '?'}. NEVER re-ask.

COST FORMAT (when pricing allowed):
- Always show: "$X.XX/month" — monthly is canonical
- Biweekly/annual ONLY if explicitly requested
- Round to 2 decimal places, use exact catalog numbers
${policyModeHint}${noPricingHint}
</Critical_Rules>

<Life_Insurance_Guidance>
Three layers: Basic $25k (Unum, employer-paid) + Voluntary Term (Unum) + Whole Life (Allstate)
Pro tip: 80% Voluntary Term for protection, 20% Whole Life for permanent cash value.
</Life_Insurance_Guidance>

<Response_Style>
- Match the active persona: narrative for explorer/guide, scannable for analyzer, step-by-step for urgent.
- Use tables when comparing plans or numbers; otherwise prefer concise prose or short lists.
- Keep the answer readable on first pass. Do not force a table if it makes the response worse.
- Do NOT restate the user's message verbatim.
- If acknowledgement helps, paraphrase in your own words in 8-14 words max, then answer.
- Use bold sparingly for key figures or plan names.
- One follow-up suggestion at end when it is helpful.
</Response_Style>

${session.lastBotMessage ? `<Previous_Response>"${session.lastBotMessage.slice(0, 300)}${session.lastBotMessage.length > 300 ? '...' : ''}"</Previous_Response>\n` : ''}
<IMMUTABLE_CATALOG STATE="${userState || 'ALL'}">
${catalog}
</IMMUTABLE_CATALOG>

${BENEFIT_CONSTRAINTS}

Answer directly, accurately, ONLY from the catalog above. When asked about any benefit, retrieve from the catalog and answer directly ΓÇö do not say you cannot answer if the information is in the catalog. Generate follow-up suggestions only from: compare plans, explore different benefit, see pricing for different tier. Never suggest looking up age-banded rates ΓÇö always say to visit enrollment portal.

${formattingDirective}`;
}

// ============================================================================
// 2b-HELPER. SHORT CATEGORY ANSWERS (yes/no, factual lookups)
// ============================================================================
// Returns a concise deterministic answer for yes/no and factual-lookup intents
// so the bot doesn't dump a full overview for every question.

function buildShortCategoryAnswer(
  queryLower: string,
  intent: 'yes_no' | 'factual_lookup',
  session: Session,
): string | null {
  const catalog = amerivetBenefits2024_2025;

  // ΓöÇΓöÇ LIFE INSURANCE: Route to RAG + LLM (templates removed) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  

  // ΓöÇΓöÇ VISION: Route to RAG + LLM (templates removed) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (/\b(vision|eye)\b/i.test(queryLower)) {
    return null; // Fall through to RAG + LLM pipeline
  }

  // ΓöÇΓöÇ DISABILITY: Route to RAG + LLM (templates removed) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (/\b(disability|ltd)\b/i.test(queryLower)) {
    return null; // Fall through to RAG + LLM pipeline
  }

  // ΓöÇΓöÇ CRITICAL ILLNESS / ACCIDENT: Route to RAG + LLM (templates removed) ΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (/\b(critical\s*illness|accident|ad&d|supplemental)\b/i.test(queryLower)) {
    return null; // Fall through to RAG + LLM pipeline
  }

  // ΓöÇΓöÇ HSA/FSA ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  // KEEP: IRS rule enforcement for ineligible expenses (hard rule, not LLM reasoning)
  if (/\b(hsa|fsa|flexible\s*spending|health\s*savings)\b/i.test(queryLower)) {
    const ineligibleExpensePattern = /\b(dog|cat|pet|animal|vet|veterinary|cosmetic|gym|fitness|massage|spa|teeth\s*whitening|supplements|vitamins)\b/i;
    if (ineligibleExpensePattern.test(queryLower)) {
      return `No ΓÇö HSA funds cannot be used for ${ineligibleExpensePattern.exec(queryLower)?.[0] || 'that expense'}. HSA-eligible expenses are limited to qualified medical expenses for yourself, your spouse, and tax dependents as defined by the IRS. Pet/veterinary expenses, cosmetic procedures, gym memberships, and general wellness items are not eligible. For a full list of eligible expenses, see IRS Publication 502 or contact your HSA administrator.`;
    }
    // Other HSA/FSA queries route to LLM for richer answers
    return null;
  }

  // ΓöÇΓöÇ MEDICAL ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  // KEEP: Kaiser geographic guard (hard rule - state check must happen before LLM)
  if (/\b(medical|health\s*(?:care|insurance|plan|coverage)?)\b/i.test(queryLower)) {
    const userState = session.userState || '';
    const isKaiserEligible = KAISER_STATES.has(userState.toUpperCase());

    // Kaiser state check - KEEP this hard rule
    if (/\b(kaiser|hmo)\b/i.test(queryLower)) {
      if (isKaiserEligible) {
        return `Yes ΓÇö Kaiser HMO is available in your state (${userState}). AmeriVet offers the Kaiser Standard HMO for employees in CA, GA, WA, and OR.`;
      }
      if (userState) {
        return `Kaiser HMO is only available in CA, GA, WA, and OR ΓÇö it is not available in ${userState}. Your medical options are the Standard HSA and Enhanced HSA plans through BCBSTX.`;
      }
      return 'Kaiser HMO is available in CA, GA, WA, and OR only. Let me know your state and I can confirm your options.';
    }

    // Other medical queries route to LLM
    return null;
  }

  return null; // No short answer matched — fall through to full overview
}


// ============================================================================
// 3. SESSION CONTEXT BUILDER (for frontend caching)
// ============================================================================
function buildSessionContext(session: Session) {
  return {
    userName: session.userName || null,
    dataConfirmed: session.dataConfirmed || false,
    noPricingMode: session.noPricingMode || false,
    decisionsTracker: session.decisionsTracker || {},
    completedTopics: session.completedTopics || [],
    lifeEvents: session.lifeEvents || [],
    lastDetectedLocationChange: session.lastDetectedLocationChange || null
  };
}

type IntentDomainRoute = 'policy' | 'pricing' | 'general';
// Helper: Build a concise acknowledgement without parroting the user sentence.
const buildTopicSummaryMarkdown = (topicLabel: string): string => {
  return `Quick summary of ${topicLabel.toLowerCase()}:`;
};

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
    const { query: rawQuery, companyId, sessionId, context: clientContext } = body;
    // Sanitize query ΓÇö strip trailing/leading quotes and whitespace
    const query = rawQuery?.trim().replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '').trim();
    const reqId = sessionId ? sessionId.substring(0, 8) : Math.random().toString(36).slice(2, 10);
    const t0 = Date.now();
    
    logger.info(`[REQ:${reqId}] ΓòÉΓòÉΓòÉΓòÉ NEW REQUEST ΓòÉΓòÉΓòÉΓòÉ QueryLen=${query?.length} Session=${sessionId?.substring(0, 8)}`);
    logger.info(`[REQ:${reqId}] Query: "${(query || '').slice(0, 120)}"`);
    
    if (!query || !sessionId) {
      logger.warn(`[REQ:${reqId}] REJECTED ΓÇö missing query or sessionId`);
      return NextResponse.json({ error: 'Missing inputs' }, { status: 400 });
    }

    const session = await getOrCreateSession(sessionId);
    session.turn = (session.turn ?? 0) + 1;

    if (isLikelyGarbledInput(query)) {
      logger.info(`[REQ:${reqId}][STEP-1d GUARD] Garbled input detected`);
      const nameRef = session.userName && session.userName !== 'Guest' ? session.userName : 'there';
      const msg = toPlainAssistantText(
        `I could not parse that message, ${nameRef}. Please rephrase in one sentence and tell me the benefit topic you want (medical, dental, vision, or life).`
      );
      session.lastBotMessage = msg;
      await updateSession(sessionId, session);
      return NextResponse.json({
        answer: msg,
        tier: 'L1',
        sessionContext: buildSessionContext(session),
        metadata: { intercept: 'garbled-input' },
      });
    }

    // ΓöÇΓöÇ Pipeline trace: begin ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const pipelineTrace = createTrace(reqId, sessionId, query, session);

    logger.info(`[REQ:${reqId}][STEP-1 SESSION] Turn=${session.turn} Name=${session.userName||'?'} Age=${session.userAge||'?'} State=${session.userState||'?'} DataConfirmed=${!!session.dataConfirmed} NoPricing=${!!session.noPricingMode}`);
    
    // SERVERLESS RESILIENCE: Restore session from client context if backend lost it
    // This handles the case where Redis/memory/fs all fail in serverless
    if (clientContext) {
      logger.info(`[REQ:${reqId}][STEP-1b CLIENT-CTX] Restoring from client context: name=${!!clientContext.userName} age=${!!clientContext.userAge} state=${!!clientContext.userState}`);
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
      // Sanitize string "undefined"/"null" values that can appear if client persisted bad state.
      // Must run HERE ΓÇö before any KAISER_STATES.has(session.userState) checks downstream.
      if (session.userState === 'undefined' || session.userState === 'null') {
        session.userState = null;
        logger.warn('[QA] Null-ing invalid userState string "undefined"/"null" from client context');
      }
      // Restore persistent preference flags so they survive serverless restarts
      if (clientContext.noPricingMode && !session.noPricingMode) {
        session.noPricingMode = true;
        logger.debug(`[QA] Restored noPricingMode from client context`);
      }
      if (clientContext.coverageTierLock && !session.coverageTierLock) {
        session.coverageTierLock = clientContext.coverageTierLock;
        logger.debug(`[QA] Restored coverageTierLock from client context: ${clientContext.coverageTierLock}`);
      }
      if (clientContext.dataConfirmed && !session.dataConfirmed) {
        session.dataConfirmed = true;
        session.step = 'active_chat';
        logger.debug(`[QA] Restored dataConfirmed from client context`);
      } else if (session.userName && session.userAge && session.userState) {
        // NOTE: Do NOT set dataConfirmed here. Let the normal flow at line ~1085
        // handle it so the deterministic ALL_BENEFITS_MENU is shown to the user.
        // Setting dataConfirmed here causes the LLM to generate a hallucinated menu.
        session.step = 'active_chat';
      }
    }
    
    // STEP 0: Persist salary from current message so STD math works across turns
    // (session.userSalary is injected into Session_Metadata on every request)
    const extractedSalary = extractSalaryFromMessage(query);
    if (extractedSalary) {
      session.userSalary = extractedSalary;
      logger.info(`[REQ:${reqId}][STEP-1c SALARY] Extracted salary: $${extractedSalary}/month`);
    }

    logger.debug(`[QA] Session state - Turn: ${session.turn}, HasName: ${session.hasCollectedName}, HasAge: ${!!session.userAge}, HasState: ${!!session.userState}, Salary: ${session.userSalary ?? 'none'}`);
    
    // ------------------------------------------------------------------------
    // STEP 1: READ THE USER'S MIND (Intent Analysis)
    // ------------------------------------------------------------------------
    const intent = classifyInput(query);
    logger.info(`[REQ:${reqId}][STEP-2 INTENT] continuation=${intent.isContinuation} topic=${intent.isTopic} demographics=${intent.isDemographics} hasAge=${intent.hasAge} hasState=${intent.hasState} stateCode=${intent.stateCode||'none'} noPricing=${intent.noPricing} familyTier=${intent.familyTierSignal} asksPPO=${intent.asksPPOPlan}`);

    const nameCapture = applyNameCapture(session, query);
    if (nameCapture.detectedName) {
      await updateSession(sessionId, session);
      logger.info(`[REQ:${reqId}][STEP-2 NAME] Captured name: ${nameCapture.detectedName}`);
    }

    // ------------------------------------------------------------------------
    // STEP 2: SELF-HEALING (The "Win-Win" Fix)
    // ------------------------------------------------------------------------
    // PROBLEM: Server restarts, session is empty.
    // FIX: If user input looks like "25 in CA" or "Medical", we force a session restore.
    
    if (!session.hasCollectedName && (intent.isContinuation || intent.isTopic || intent.isDemographics)) {
      logger.info(`[REQ:${reqId}][STEP-2b SELF-HEAL] Restoring lost session as Guest`);
      applySelfHealGuest(session);
      await updateSession(sessionId, session);
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
            logger.info(`[REQ:${reqId}][STEP-3 DATA] Age extracted: ${session.userAge}`);
        }
    }
    if (intent.hasState && intent.stateCode) {
      const newStateCode = intent.stateCode.toUpperCase();
      session.userState = newStateCode;
      logger.info(`[REQ:${reqId}][STEP-3 DATA] State extracted: ${newStateCode}${previousState && previousState !== newStateCode ? ` (changed from ${previousState})` : ''}`);

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
        logger.info('[QA] State updated mid-session ΓÇö Kaiser eligibility re-evaluated', { from: previousState, to: newStateCode, kaiserNow: KAISER_STATES.has(newStateCode) });
      }
    }
    
    // Ensure session is saved after data extraction
    if ((intent.hasAge && session.userAge) || (intent.hasState && session.userState)) {
      await updateSession(sessionId, session);
        logger.debug(`[QA] Session updated - HasAge: ${!!session.userAge}, HasState: ${!!session.userState}`);
    }

    if (session.userAge || session.userState) {
      ensureNameForDemographics(session);
      await updateSession(sessionId, session);
    }

    // ========================================================================
    // DETERMINISTIC STATE-BASED ENFORCEMENT (Refactor: Template ΓåÆ State-Based)
    // ========================================================================

    // RULE 1: FAMILY TIER LOCK ΓÇö "Spouse and 3 children" ΓåÆ Employee + Family
    // Once detected, ALL subsequent pricing defaults to Employee + Family until
    // the user explicitly requests a different tier (e.g., "Employee Only").
    if (intent.familyTierSignal) {
      session.coverageTierLock = 'Employee + Family';
      logger.info(`[REQ:${reqId}][STEP-4 RULE] TIER-LOCK: Employee + Family`);
    }

    // RULE 1b: CHILD-ONLY TIER LOCK ΓÇö "employee + child" or "me and my kids"
    const childTierLock = applyChildCoverageTierLock(session, query);
    if (childTierLock.locked) {
      logger.info(`[REQ:${reqId}][STEP-4 RULE] TIER-LOCK: Employee + Child(ren)`);
    }

    // RULE 2: NO-PRICING INTENT ΓÇö user said "no pricing" / "coverage only"
    // Persists on session so follow-up messages also respect it.
    // User can unlock by saying "show pricing" / "include costs".
    if (intent.noPricing) {
      session.noPricingMode = true;
      logger.info(`[REQ:${reqId}][STEP-4 RULE] NO-PRICING activated`);
    }
    if (/\b(show\s*pric|include\s*cost|with\s*pric|add\s*pric|show\s*rates?|include\s*rates?)\b/i.test(query.toLowerCase())) {
      session.noPricingMode = false;
      logger.info(`[REQ:${reqId}][STEP-4 RULE] NO-PRICING deactivated (user wants pricing)`);
      // Persist immediately so the unlock survives even if RAG returns no-chunks
      await updateSession(sessionId, session);
    }

    // RULE 3: PPO PLAN CLARIFICATION ΓÇö user asks for "the PPO plan" (medical)
    // Deterministic response: no LLM needed, no hallucination possible.
    if (intent.asksPPOPlan) {
      const kaiserEligible = isKaiserEligibleState(session.userState);
      logger.info(`[REQ:${reqId}][STEP-5 INTERCEPT] PPO-CLARIFICATION (kaiserEligible=${kaiserEligible})`);
      const followUp = kaiserEligible || !session.userState
        ? 'Would you like to compare the available medical plans?'
        : 'Would you like to see a comparison of the Standard HSA vs. Enhanced HSA?';
      const msg = `${buildPpoClarificationFallback(session)}\n\n${followUp}`;
      session.lastBotMessage = msg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'ppo-clarification', retrievalScore: 1.0, confidence: 'High' } });
    }

    // RULE 4: KAISER IN NON-KAISER STATE ΓÇö user explicitly asks about Kaiser when not in CA/GA/WA/OR
    const asksKaiser = /\bkaiser\b/i.test(query);
    const userInNonKaiserState = !!session.userState && !isKaiserEligibleState(session.userState);
    if (asksKaiser && userInNonKaiserState) {
      logger.info(`[REQ:${reqId}][STEP-5 INTERCEPT] KAISER-REDIRECT: User in ${session.userState} asked about Kaiser`);
      const plainMsg = toPlainAssistantText(buildKaiserUnavailableFallback(session, 'redirect'));
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'kaiser-redirect-non-eligible-state', retrievalScore: 1.0, confidence: 'High' } });
    }

    // Save session if state-based flags changed
    if (intent.familyTierSignal || intent.noPricing || childTierLock.locked) {
      await updateSession(sessionId, session);
    }
    
    // If we have data now, ensure the gate is open and acknowledge
    if (session.userAge && session.userState && !session.dataConfirmed) {
        session.step = 'active_chat';
        session.dataConfirmed = true; // Prevent repeated confirmations
        
        // ALWAYS show the ALL_BENEFITS_MENU when demographics are provided for the first time.
        // Previous bug: query.length < 40 check would skip this when user combined
        // demographics with other intents like "no pricing" (e.g. "I'm 30 in Houston. No pricing please.")
        if (intent.isDemographics) {
            logger.info(`[REQ:${reqId}][STEP-5 INTERCEPT] DEMOGRAPHICS-CONFIRMED: Age=${session.userAge} State=${session.userState} NoPricing=${!!session.noPricingMode} ΓåÆ showing ALL_BENEFITS_MENU`);
            const pricingIntro = session.noPricingMode
              ? `Got it! ${session.userAge} in ${session.userState}. I'll focus on coverage details without pricing.`
              : `Perfect! ${session.userAge} in ${session.userState}. Now I can show you accurate pricing.`;
            const msg = `${pricingIntro}\n\n${ALL_BENEFITS_MENU}\n\nWhat would you like to explore first?`;
            session.lastBotMessage = msg;
        await updateSession(sessionId, session);
            return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
        }
    }

    // ------------------------------------------------------------------------
    // STEP 4: CONVERSATION FLOW (State Machine)
    // ------------------------------------------------------------------------

    // PHASE 1: GET NAME (Only if session is empty AND input is NOT data/topic)
    if (shouldPromptForName(session)) {
      const nameCapture = applyNameCapture(session, query);
      if (nameCapture.detectedName) {
        logger.info(`[REQ:${reqId}][STEP-5 INTERCEPT] NAME-COLLECTED: ${nameCapture.detectedName}`);
        session.step = 'awaiting_demographics';
        const msg = `Thanks, ${nameCapture.detectedName}! It's great to meet you.\n\nTo help me find the best plans for you, could you please share your age and state?`;
            
        session.lastBotMessage = msg;
      await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
      } else {
        // Default Welcome
        logger.info(`[REQ:${reqId}][STEP-5 INTERCEPT] WELCOME-PROMPT: No name detected, asking for name`);
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

    logger.info(`[REQ:${reqId}][STEP-6 GATE] HasAge=${hasAge} HasState=${hasState} HasData=${hasData}`);

    // CRITICAL FIX: If we have data, always allow the request through
    // POLICY BYPASS: Policy/procedure questions (HSA eligibility, QLE deadlines,
    // STD calculations, pre-existing conditions) do NOT require age/state.
    // They are answered from plan rules, not pricing tables.
    const intentDomainEarly = detectIntentDomain(query.toLowerCase());
    if (!hasData && !intent.isContinuation && intentDomainEarly !== 'policy') {
        logger.info(`[REQ:${reqId}][STEP-6 GATE] BLOCKED ΓÇö missing data, intentDomain=${intentDomainEarly}`);
        
        // Scenario A: User asks "Medical PPO" or "critical injury insurance" but we don't know their State.
        // STOP THEM explicitly.
        if (intent.isTopic) {
             logger.info(`[REQ:${reqId}][STEP-6 GATE] Topic request without data ΓåÆ asking for ${!hasState ? 'State' : 'Age'}`);
             const missing = !hasState ? "State" : "Age";
             const msg = `I can definitely help you with ${query}, but plan availability and costs vary by location.\n\nFirst, please tell me your ${missing} so I can give you the correct information.`;
             
             session.lastBotMessage = msg;
         await updateSession(sessionId, session);
             return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
        }

        // Scenario B: User provided PARTIAL data (e.g. just "43")
        if (intent.isDemographics) {
             logger.info(`[REQ:${reqId}][STEP-6 GATE] Partial demographics ΓåÆ asking for ${!hasState ? 'State' : 'Age'}`);
             const missing = !hasState ? "State" : "Age";
             const current = session.userAge ? `Age ${session.userAge}` : `State ${session.userState}`;
             
             const msg = `Got it (${current}). To pull the accurate rates, I just need your ${missing}.`;
             
             session.lastBotMessage = msg;
         await updateSession(sessionId, session);
             return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
        }

        // Scenario C: Generic chitchat while waiting for data
        logger.info(`[REQ:${reqId}][STEP-6 GATE] Generic chitchat without data ΓåÆ asking for demographics`);
        const nameRef = session.userName !== "Guest" ? session.userName : "there";
        const msg = `Thanks ${nameRef}. Before we look at plans, I need your Age and State (e.g., "I'm 25 in CA") to calculate your costs.`;
        
        session.lastBotMessage = msg;
       await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
    }

    // Log when user with complete data proceeds to RAG
    if (hasData) {
        logger.info(`[REQ:${reqId}][STEP-6 GATE] PASSED ΓÇö Age=${session.userAge} State=${session.userState}${!hasData && intentDomainEarly === 'policy' ? ' (policy bypass)' : ''}`);
    } else if (intentDomainEarly === 'policy') {
        logger.info(`[REQ:${reqId}][STEP-6 GATE] POLICY-BYPASS ΓÇö no data but intent=policy`);
    }

    const lowerQuery = query.toLowerCase();
    const intentDomain = detectIntentDomain(lowerQuery);
    const pipelineFirstMode = true;

    // ========================================================================
    // INTERCEPT: L1 STATIC FAQ CACHE (always run ΓÇö no gate, specific patterns only)
    // ========================================================================
    // Run checkL1FAQ unconditionally so Rightway, HR, portal queries are ALWAYS
    // caught before reaching any downstream logic. The L1_FAQ patterns are
    // sufficiently specific that false positives are not a concern.
    const l1Answer = checkL1FAQ(query, { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE });
    if (!pipelineFirstMode && l1Answer) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] L1-STATIC-FAQ matched ΓåÆ returning cached answer (${l1Answer.length} chars)`);
      session.lastBotMessage = l1Answer;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: l1Answer, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'l1-static-faq' } });
    }

    const scopeGuardAnswer = buildScopeGuardResponse(query, { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE });
    if (scopeGuardAnswer) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] SCOPE-GUARD matched`);
      const plainMsg = toPlainAssistantText(scopeGuardAnswer);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'scope-guard' } });
    }

    // INTERCEPT: LIVE SUPPORT / TALK TO A PERSON
    // ========================================================================
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

    if (!pipelineFirstMode && preprocessSignals.spouseGeneralFsaConflictIntent) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] HSA-SPOUSE-FSA-CONFLICT detected`);
      // ΓöÇΓöÇ Block 1: IRS compliance (always fires) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
      let msg = `IRS COMPLIANCE RULE (IRS Publication 969): If your spouse is enrolled in a general-purpose Healthcare FSA, you are NOT eligible to contribute to an HSA for those same months. This is a hard IRS rule with no exceptions.

The only workaround: your spouse switches to a Limited Purpose FSA (LPFSA) that covers ONLY dental and vision ΓÇö then your HSA eligibility is restored.

Action order:
1. Confirm your spouse's FSA type with their employer (general-purpose vs limited-purpose).
2. If general-purpose FSA: do NOT elect HSA contributions ΓÇö you are ineligible.
3. If limited-purpose FSA: you may elect HSA contributions normally.
4. Make this determination BEFORE finalizing plan elections in Workday. You cannot retroactively correct excess HSA contributions without IRS penalty.

For enrollment: ${ENROLLMENT_PORTAL_URL} | HR: ${HR_PHONE}`;

      // ΓöÇΓöÇ Block 2: Compound-query extension (ReAct ΓÇö if query ALSO asks about maternity/STD pay) ΓöÇΓöÇ
      // Principal Architect Rule: compound queries must receive BOTH answers ΓÇö never silently drop one.
      const hasCompoundStdPay = (
        /\b(maternity(?:\s+leave)?|parental\s+leave|fmla|leave\s+of\s+absence)\b/i.test(lowerQuery) &&
        /\b(pay(?:check)?|paid|income|salary|money|how\s+much|week\s*\d*|6th\s+week|sixth\s+week|std|60%)\b/i.test(lowerQuery)
      ) || (
        /\b(std|short\s*[- ]?term\s+disability)\b/i.test(lowerQuery) &&
        /\b(maternity|leave|pay(?:check)?|paid|salary|60%|sixty\s*percent|week\s*\d+|6th\s+week|sixth\s+week|get\s+paid|income)\b/i.test(lowerQuery)
      );

      if (hasCompoundStdPay) {
        // ReAct: Action ΓåÆ extract salary from message; Observation ΓåÆ compute STD weekly pay
        // Fallback chain: current message ΓåÆ persisted session salary ΓåÆ null (ask user)
        const salary = extractSalaryFromMessage(lowerQuery) ?? session.userSalary ?? null;
        const weeklyBase = salary ? salary / 4.33 : null;
        const stdWeekly  = weeklyBase ? (weeklyBase * 0.6).toFixed(2) : null;
        const mathLine   = stdWeekly
          ? `With a salary of $${(salary as number).toLocaleString()}/month: $${(salary as number).toLocaleString()} ├╖ 4.33 = $${(weeklyBase as number).toFixed(2)}/week ├ù 60% = $${stdWeekly}/week via UNUM STD.`
          : `Share your monthly salary and I can calculate the exact weekly payment.`;

        msg += `\n\nΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ\nMaternity Leave Pay ΓÇö UNUM STD Timeline:\n\n- Weeks 1ΓÇô2 (Elimination Period): STD is not yet active. Use PTO or this period may be unpaid.\n- Weeks 3ΓÇô6 (STD Active ΓÇö UNUM): UNUM pays 60% of your pre-disability base earnings. FMLA runs concurrently and provides job protection.\n- Weeks 7ΓÇô8 (if physician-certified): STD may extend through week 8 (vaginal delivery) or week 10 (C-section), subject to UNUM claim approval.\n- FMLA (all 12 weeks): Job-protected leave only ΓÇö income comes from UNUM STD, not FMLA.\n\nWeek 6 specifically: You are inside the UNUM STD benefit window. ${mathLine}\n\nNote: The spouse FSA conflict above must be resolved BEFORE electing HSA contributions in Workday ΓÇö your maternity leave coverage under the chosen medical plan is not affected by the FSA ruling.`;
      }

      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: hasCompoundStdPay ? 'hsa-spouse-fsa-conflict+std-pay' : 'hsa-spouse-fsa-conflict' } });
    }

    // ΓöÇΓöÇ MULTI-QLE STATE MACHINE INTERCEPTOR ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // Fires when user reports BOTH a marriage QLE AND a job-status change (or
    // pregnancy) in the same message. Returns ordered A-grade response with
    // state-specific plan recommendation.  Must run BEFORE qleFilingOrderRequested.
    if (!pipelineFirstMode && preprocessSignals.multiQLESignal) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] MULTI-QLE detected ΓÇö marriage + ${/pregnan|expecting/i.test(lowerQuery) ? 'pregnancy' : 'job-change'}`);
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
      msg += `Step 1 ΓÇö Marriage QLE (30-day window, file FIRST)\n`;
      msg += `- File the marriage QLE in Workday immediately to add your spouse to Medical, Dental, and Vision.\n`;
      msg += `- Upload your marriage certificate as documentation.\n`;
      msg += `- Most plans require QLE submission within 30 days of the marriage date. Missing this window locks you out until Open Enrollment.\n\n`;

      if (hasJobChange) {
        msg += `Step 2 ΓÇö Employment Status Change (file same day or next business day)\n`;
        msg += `- A change from part-time to full-time resets your benefits eligibility tier.\n`;
        msg += `- File this event in Workday AFTER the marriage QLE so you get the correct full-time plan options.\n`;
        msg += `- Confirm with HR that your status is updated to Full-Time in the payroll system BEFORE electing benefits.\n\n`;
      }

      if (hasPregnancy) {
        msg += `Step ${hasJobChange ? 3 : 2} ΓÇö Maternity Prep (act now, before Open Enrollment)\n`;
        msg += `- Enroll in Short-Term Disability (STD) via Unum NOW if not already enrolled.\n`;
        msg += `- UNUM STD pays 60% of your salary during the disability period from delivery (typically up to 13 weeks, with a 2-week elimination period).\n`;
        msg += `- FMLA provides up to 12 weeks of job-protected leave ΓÇö it runs concurrently with STD, not after.\n`;
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
    if (!pipelineFirstMode && marriageWindowQuestion) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] MARRIAGE-WINDOW-DEDUCTIBLE`);
      const msg = `Marriage is typically a Qualifying Life Event (QLE), and most plans require you to submit the change within a limited window (commonly 30 days, sometimes 31/60 depending on plan rules).\n\nDeductible reset: adding a spouse usually changes you from individual to family tier, but it does **not** automatically reset all year-to-date deductible/OOP accumulators to $0. Mid-year accumulator handling follows plan/administrator rules.\n\nAction now: submit the marriage QLE in Workday immediately, upload documentation, and confirm both (1) election effective date and (2) how prior individual accumulators map to family accumulators for your plan.`;
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(msg)) : toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'marriage-window-deductible' } });
    }

    // ΓöÇΓöÇ FMLA + STD Leave Pay Timeline (week-by-week) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // Fires on ANY leave/pay question involving maternity leave or STD ΓÇö
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
    if (!pipelineFirstMode && stdLeavePayQuestion) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] FMLA-STD-LEAVE-PAY-TIMELINE`);
      const lines = buildStdLeavePayTimeline(lowerQuery);
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(lines)) : toPlainAssistantText(lines);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'fmla-std-leave-pay-timeline' } });
    }

    const stdPreexistingQuestion = /\b(std|short\s*[- ]?term\s+disability)\b/i.test(lowerQuery)
      && /\bpre-?existing|deny\s+my\s+maternity\s+claim|already\s+\d+\s*months\s+pregnant\b/i.test(lowerQuery);
    if (!pipelineFirstMode && stdPreexistingQuestion) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] STD-PREEXISTING-GUIDANCE`);
      const msg = buildStdPreexistingGuidance();
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(msg)) : toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'std-preexisting-guidance' } });
    }

    const allstateTermQuestion = /\b(allstate)\b/i.test(lowerQuery) && /\b(term\s+life)\b/i.test(lowerQuery);
    if (!pipelineFirstMode && allstateTermQuestion) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] CARRIER-CORRECTION-TERM-LIFE`);
      const msg = buildAllstateTermLifeCorrection();
      const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(msg)) : toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'carrier-correction-term-life' } });
    }

    if (!pipelineFirstMode && preprocessSignals.authorityConflictIntent) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] AUTHORITY-RESOLUTION`);
      const msg = buildAuthorityResolutionMessage();
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'authority-resolution' } });
    }

    const qleFilingOrderRequested =
      preprocessSignals.hasQLEIntent ||
      (preprocessSignals.hasLifecycleEvent && preprocessSignals.hasFilingOrderIntent);

    if (!pipelineFirstMode && qleFilingOrderRequested) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] QLE-FILING-ORDER`);
      const msg = buildQleFilingOrderMessage(session);
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'qle-filing-order' } });
    }
    const isLiveSupportRequest = (
        /\b(live\s*(support|agent|person|chat|help)|talk\s*to\s*(a\s*)?(human|person|agent|someone|representative|rep)|speak\s*(to|with)\s*(a\s*)?(human|person|agent|someone)|real\s*(person|human|agent)|customer\s*service|call\s*(someone|support)|phone\s*(number|support)|contact\s*(hr|support|someone)|get\s*(me\s*)?(a\s*)?(human|person|agent))\b/i.test(query)
    );
    if (!pipelineFirstMode && isLiveSupportRequest) {
        logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] LIVE-SUPPORT requested`);
        const msg = buildLiveSupportMessage(session, HR_PHONE, ENROLLMENT_PORTAL_URL);
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session) });
    }

    // INTERCEPT: SUMMARY REQUEST
    // ========================================================================
    if (isSummaryRequest(query)) {
        logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] SUMMARY requested`);
        const nameRef = session.userName && session.userName !== 'Guest' ? session.userName : 'there';
        const decisions = session.decisionsTracker || {};
        const msg = compileSummary(decisions, nameRef, ENROLLMENT_PORTAL_URL, ALL_BENEFITS_SHORT);
      const plainMsg = toPlainAssistantText(applyPricingExclusion(msg, session.noPricingMode || intent.noPricing));
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session) });
    }

    // CUSTOM INTERCEPT: Accident plan name inquiry
    const planNumbersQuery = /plan\s*1\b.*plan\s*2/i.test(lowerQuery);
    if (!pipelineFirstMode && planNumbersQuery && /\baccident\b/i.test(lowerQuery)) {
        logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] ACCIDENT-PLAN-NAMES`);
        const msg = buildAccidentPlanNamesMessage(HR_PHONE);
        const plainMsg = toPlainAssistantText(msg);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'accident-plan-names' } });
    }

    // CUSTOM INTERCEPT: Simple recommendation request ("I'm single and healthy, what do you recommend?")
    // Returns deterministic Employee Only pricing instead of relying on LLM to hallucinate numbers
    const recommendRequested = /\b(recommend|recommendation|suggestion|which plan|what plan|what do you recommend|best plan)\b/i.test(lowerQuery);
    const singleHealthy = /\b(single|healthy|just me|only me|individual|no dependents)\b/i.test(lowerQuery);
    const recommendationScenarioRequested = /\b(recommendation|recommend|suggest|best plan|best option|what do you recommend|which plan|save money|lowest premium)\b/i.test(lowerQuery);
    if (!pipelineFirstMode && recommendRequested && singleHealthy) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] RECOMMEND-SINGLE`);
      const rows = pricingUtils.buildPerPaycheckBreakdown('Employee Only', session.payPeriods || 26);
      // Filter to medical-only and exclude Kaiser for states outside CA/GA/WA/OR
      const medRows = rows.filter(r => !/dental|vision/i.test(r.plan) && r.provider !== 'VSP');
      const filtered = session.userState && !isKaiserEligibleState(session.userState)
        ? medRows.filter(r => !/kaiser/i.test(r.plan))
        : medRows;
        let msg = `Great question! For a single, healthy individual, here are your medical plan options (Employee Only):\n\n`;
        for (const r of filtered) {
          if (!session.noPricingMode) {
            msg += `- **${r.plan}**: $${pricingUtils.formatMoney(r.perMonth)}/month ($${pricingUtils.formatMoney(r.annually)}/year)\n`;
          } else {
            msg += `- **${r.plan}**\n`;
          }
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

    // CUSTOM INTERCEPT: Two-plan side-by-side comparison (deterministic)
    // Catches "compare Standard HSA vs Enhanced HSA", "Standard HSA vs PPO", "HSA vs HMO"
    // Returns both plans in a markdown table using canonical pricing data
    const twoPlanCompare = (() => {
      const compareSignal = /\b(?:compare|vs\.?|versus|side\s*by\s*side|difference\s+between|compared\s+to)\b/i.test(lowerQuery) || (/\b(?:or)\b/i.test(lowerQuery) && /\b(?:hsa|hmo|ppo|dental|vision)\b/i.test(lowerQuery));
      if (!compareSignal) return null;
      const knownPlans: { key: string; label: string; regex: RegExp }[] = [
        { key: 'standard hsa', label: 'Standard HSA', regex: /\bstandard\s*(?:hsa)?\b/i },
        { key: 'enhanced hsa', label: 'Enhanced HSA', regex: /\benhanced\s*(?:hsa)?\b/i },
        { key: 'kaiser',       label: 'Kaiser Standard HMO', regex: /\b(kaiser|hmo)\b/i },
      ];
      const matched = knownPlans.filter(p => p.regex.test(lowerQuery));
      if (matched.length >= 2) return matched.slice(0, 2);
      // Also handle "standard hsa vs ppo" / "the ppo" (PPO = Enhanced HSA in AmeriVet context)
      // and implicit "compare the two plans" / "compare both plans" when standard hsa is mentioned
      if (matched.length === 1 && /\b(?:ppo|hmo|enhanced|both\s+plans?|the\s+other|the\s+two)\b/i.test(lowerQuery)) {
        const other = knownPlans.find(p => !p.regex.test(lowerQuery) && p.key !== 'kaiser');
        if (other) return [matched[0], other];
      }
      // Implicit: "the two medical plans" or "both hsa plans" or "standard vs enhanced" ΓÇö no specific plan named
      if (matched.length === 0 && /\b(?:both\s+(?:medical\s+)?plans?|two\s+(?:medical\s+)?plans?|both\s+hsa|two\s+hsa|medical\s+plans?.*compare|compare.*medical\s+plans?|standard.*enhanced|enhanced.*standard)\b/i.test(lowerQuery)) {
        return [knownPlans[0], knownPlans[1]]; // Standard HSA vs Enhanced HSA
      }
      return null;
    })();
    if (twoPlanCompare) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] TWO-PLAN-COMPARE: ${twoPlanCompare.map(p => p.label).join(' vs ')}`);
      // Prefer the tier set by RULE 1 in this turn (familyTierSignal) over the locked session value,
      // because the user may have stated family size in the same message as the comparison request.
      const coverageTier = (intent.familyTierSignal ? 'Employee + Family' : null) || session.coverageTierLock || extractCoverageFromQuery(query);
      const payPeriods = session.payPeriods || 26;
      const rows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);
      const findRow = (planKey: string) => rows.find((r: { plan: string }) => {
        const rLow = r.plan.toLowerCase();
        return planKey.split(' ').every((w: string) => rLow.includes(w));
      });
      const row1 = findRow(twoPlanCompare[0].key);
      const row2 = findRow(twoPlanCompare[1].key);
      if (!row1 || !row2) {
        // Rows not found ΓÇö log and fall through to LLM rather than silently producing nothing
        logger.warn(`[REQ:${reqId}][STEP-7 INTERCEPT] TWO-PLAN-COMPARE rows not found: row1=${!!row1} row2=${!!row2} ΓÇö falling through to LLM`);
      } else {
        // Filter Kaiser for non-Kaiser states (CA, WA, OR)
        const hasKaiser = twoPlanCompare.some(p => p.key === 'kaiser');
        if (hasKaiser && session.userState && !isKaiserEligibleState(session.userState)) {
          const msg = buildKaiserUnavailableFallback(session, 'compare');
          session.lastBotMessage = msg;
          await updateSession(sessionId, session);
          return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'two-plan-compare-kaiser-unavailable' } });
        }
        let msg = buildTwoPlanComparisonMessage({
          coverageTier,
          payPeriods,
          row1,
          row2,
          noPricingMode: session.noPricingMode || intent.noPricing,
        });
        msg = applyPricingExclusion(msg, session.noPricingMode || intent.noPricing);
        session.lastBotMessage = msg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'two-plan-compare' } });
      }
    }

    // CUSTOM INTERCEPT: Direct plan pricing lookup (deterministic)
    // Catches "how much is Standard HSA?", "Enhanced HSA cost", "what does Kaiser cost"
    // Prevents LLM from hallucinating plan prices by returning canonical data (Issue 1 fix)
    const planNamesRegex = /\b(standard\s*hsa|enhanced\s*hsa|kaiser\s*(?:standard\s*)?(?:hmo)?|dental\s*ppo|vision\s*plus|bcbstx\s*dental|vsp)\b/i;
    const pricingQuestion = /\b(how much|cost|price|premium|rate|what does|pricing|what is|how expensive)\b/i;
    const isCostModelingQuery = /(?:calculate|projected?|estimate|next year|for \d{4}|usage)/i.test(lowerQuery);
    const planNameMatch = lowerQuery.match(planNamesRegex);
    if (!pipelineFirstMode && planNameMatch && pricingQuestion.test(lowerQuery) && !/per[\s-]*pay/i.test(lowerQuery) && !isCostModelingQuery && shouldUsePlanPricingIntercept(query, lowerQuery)) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] PLAN-PRICING: plan=${planNameMatch[1]}`);
      const coverageTier = getCoverageTierForQuery(query, session);
      const { payPeriods, rows } = getAvailablePricingRows(session, coverageTier, { includeNonMedical: true });
      const targetPlan = planNameMatch[1].toLowerCase().replace(/\s+/g, ' ').trim();
      const matchedRow = rows.find(r => {
        const rLow = r.plan.toLowerCase();
        return rLow.includes(targetPlan) || targetPlan.split(' ').every((w: string) => rLow.includes(w));
      });
      if (matchedRow) {
        // Filter Kaiser for states outside CA/GA/WA/OR
        if (/kaiser/i.test(matchedRow.plan) && session.userState && !isKaiserEligibleState(session.userState)) {
          const msg = buildKaiserUnavailableFallback(session, 'pricing');
          session.lastBotMessage = msg;
          await updateSession(sessionId, session);
          return NextResponse.json({ answer: msg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'plan-pricing-kaiser-unavailable' } });
        }
        const msg = buildPlanPricingMessage({
          matchedRow,
          coverageTier,
          payPeriods,
          noPricingMode: session.noPricingMode,
        });
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
    const medicalComparisonRequested = hasMedicalKeyword && hasPlanKeyword && hasCompareKeyword && !/per[\s-]*pay/i.test(lowerQuery) && !isCostModelingQuery && !recommendationScenarioRequested;
    if (medicalComparisonRequested && shouldUseMedicalComparisonIntercept(query, lowerQuery, intentDomain) && !(recommendRequested && singleHealthy)) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] MEDICAL-COMPARISON`);
      const coverageTier = getCoverageTierForQuery(query, session);
      const { rows, filtered } = getAvailablePricingRows(session, coverageTier);
      const msg = buildMedicalComparisonMessage({
        coverageTier,
        filtered,
        hasHiddenKaiser: filtered.length < medRows.length,
        noPricingMode: session.noPricingMode || intent.noPricing,
      });
      const plainMsg = toPlainAssistantText(applyPricingExclusion(msg, session.noPricingMode || intent.noPricing));
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'medical-comparison' } });
    }

    // CUSTOM INTERCEPT: Scenario recommendation overview (deterministic)
    const recommendationOverview = buildRecommendationOverview(query, session);
    if (recommendationOverview) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] RECOMMENDATION-OVERVIEW`);
      const plainMsg = toPlainAssistantText(applyPricingExclusion(recommendationOverview, session.noPricingMode || intent.noPricing));
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'recommendation-overview' } });
    }

    // CUSTOM INTERCEPT: HSA / Savings recommendation (deterministic)
    // Catches "savings recommendation", "HSA advice", "tax savings" etc. that otherwise fall to RAG and hallucinate
    const savingsRequested = /\b(savings?\s*(recommend|advice|scenario|strategy|tip)|hsa\s*(recommend|advice|benefit|advantage|savings)|tax\s*(savings?|advantage|benefit)\s*(plan|account|option)?|pre-?tax\s*(dollar|saving|benefit))\b/i.test(lowerQuery);
    if (!pipelineFirstMode && savingsRequested) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] SAVINGS-RECOMMENDATION`);
      const rows = pricingUtils.buildPerPaycheckBreakdown('Employee Only', session.payPeriods || 26);
      const hsaPlans = rows.filter(r => /hsa/i.test(r.plan));
      let msg = `Here's a savings-focused recommendation for your tax-advantaged benefit options:\n\n`;
      msg += `**Health Savings Account (HSA) Plans:**\n`;
      for (const r of hsaPlans) {
        if (!session.noPricingMode) {
          msg += `- **${r.plan}**: $${pricingUtils.formatMoney(r.perMonth)}/month ($${pricingUtils.formatMoney(r.annually)}/year)\n`;
        } else {
          msg += `- **${r.plan}**\n`;
        }
      }
      msg += `\nHSA Tax Advantages:\n`;
      msg += `- Contributions are deducted pre-tax from your paycheck, lowering your taxable income\n`;
      msg += `- Funds grow tax-free (interest and investments)\n`;
      msg += `- Withdrawals for eligible medical expenses are tax-free (triple tax advantage)\n`;
      msg += `- Unused funds roll over year to year ΓÇö there is no "use it or lose it"\n`;
      msg += `- The account is yours ΓÇö it stays with you even if you leave AmeriVet\n`;
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
    if (!pipelineFirstMode && costModelRequested) {
        logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] COST-MODEL`);
        // try to parse usage level
        const usageMatch = lowerQuery.match(/(low|moderate|high)\s+usage/);
        const usage: any = usageMatch ? usageMatch[1] as 'low'|'moderate'|'high' : 'moderate';
        const coverageTier = lowerQuery.includes('family') || /family\s*(?:of)?\s*\d|family\d/i.test(lowerQuery) ? 'Employee + Family' : (lowerQuery.includes('child') ? 'Employee + Child(ren)' : 'Employee Only');
        const networkMatch = lowerQuery.match(/kaiser|ppo|hsa|hmo/i);
        const network = networkMatch ? networkMatch[0] : undefined;
        const rawMsg = pricingUtils.estimateCostProjection({ coverageTier, usage, network, state: session.userState || undefined, age: session.userAge || undefined });
        const plainMsg = session.noPricingMode ? stripPricingDetails(toPlainAssistantText(rawMsg)) : toPlainAssistantText(rawMsg);
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
    if (!pipelineFirstMode && parentalLeaveStepByStep) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] PARENTAL-LEAVE-STEP-BY-STEP`);
      const msg = buildParentalLeavePlan(ENROLLMENT_PORTAL_URL, HR_PHONE);
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'parental-leave-plan' } });
    }

    const maternityRequested = intentDomain !== 'policy' && /maternity|baby|pregnan|birth|deliver/i.test(lowerQuery);
    // Guard: if the query is REALLY a leave-pay / STD salary question, let stdLeavePayQuestion handle it above.
    // maternityFlowRequested should only fire for pure maternity COST questions, not salary/leave pay math.
    const hasStdPaySignals = /\b(salary|paid|income|60%|sixty\s*percent|how\s+much\s+(?:will|do|would)\s+i|week\s*\d+|6th\s+week|sixth\s+week|std|short\s*[- ]?term\s+disability|leave\s+pay|maternity\s+pay|get\s+paid|paychec?k)\b/i.test(lowerQuery);
    const maternityFlowRequested = maternityRequested && !qleFilingOrderRequested && !hasStdPaySignals;
    if (!pipelineFirstMode && maternityFlowRequested) {
  logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] MATERNITY-FLOW`);
  // If noPricingMode is active, the deterministic function produces empty plan
  // sections after stripPricingDetails removes all $ lines ΓÇö fall through to LLM.
  if (session.noPricingMode) {
    logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] MATERNITY-FLOW: noPricingMode active ΓåÆ falling through to LLM`);
    // fall through to RAG + LLM pipeline
  } else {
    const coverageTier = lowerQuery.includes('family') ? 'Employee + Family'
      : lowerQuery.includes('employee only') ? 'Employee Only'
      : 'Employee + Child(ren)';
    const rawMsg = pricingUtils.compareMaternityCosts(coverageTier, session.userState || null);
    const plainMsg = toPlainAssistantText(rawMsg);
    session.lastBotMessage = plainMsg;
    await updateSession(sessionId, session);
    return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'maternity' } });
  }
}


    // CUSTOM INTERCEPT: Orthodontics/braces direct answer (deterministic)
    // Uses canonical dental plan data ΓÇö no LLM hallucination possible
    const orthoRequested = /orthodont|braces|\bortho\b|dental\s*(?:cover|include).*(?:ortho|brace)/i.test(lowerQuery);
    if (orthoRequested) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] ORTHODONTICS`);
      const dental = pricingUtils.getDentalPlanDetails();
      let msg = `Yes! The **${dental.name}** (${dental.provider}) includes orthodontia coverage. Here are the key details:\n\n`;
      msg += `- **Orthodontia copay**: $${dental.orthoCopay} (your share after the plan pays)\n`;
      msg += `- **Deductible**: $${dental.deductible} individual / $${dental.familyDeductible} family\n`;
      msg += `- **Coinsurance**: Preventive 100% covered, Basic services 80/20, Major services 50/50\n`;
      msg += `- **Out-of-pocket max**: $${pricingUtils.formatMoney(dental.outOfPocketMax)}\n`;
      msg += `- **Waiting period**: 6 months for major services\n`;
      msg += `- **Network**: Nationwide PPO\n`;
      if (!session.noPricingMode) {
        msg += `\n**Monthly premiums:**\n`;
        msg += `- Employee Only: $${pricingUtils.formatMoney(dental.tiers.employeeOnly)}\n`;
        msg += `- Employee + Child(ren): $${pricingUtils.formatMoney(dental.tiers.employeeChildren)}\n`;
        msg += `- Employee + Family: $${pricingUtils.formatMoney(dental.tiers.employeeFamily)}\n`;
      }
      msg += `\nOrthodontic coverage typically applies to both children and adults. For the full Dental Summary with age limits and lifetime maximums, check in Workday: ${ENROLLMENT_PORTAL_URL}`;
        const plainMsg = applyPricingExclusion(session.noPricingMode ? stripPricingDetails(toPlainAssistantText(msg)) : toPlainAssistantText(msg), session.noPricingMode || intent.noPricing);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'orthodontics' } });
    }

    // ========================================================================
    // CONTINUATION / FOLLOW-UP HANDLER (Short messages with session context)
    // ========================================================================
    // Catches short follow-ups like "difference", "more", "details", "explain"
    // and uses session.currentTopic to provide a context-aware response.
    const isShortFollowUp = isLikelyFollowUpMessage(query.trim()) && query.trim().length < 30;
    const isTopicContinuation = isTopicContinuationMessage(query, session.currentTopic);

    if (!pipelineFirstMode && (isShortFollowUp || isTopicContinuation) && session.currentTopic) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] CONTINUATION-HANDLER: topic=${session.currentTopic}, short=${isShortFollowUp}, topicCont=${isTopicContinuation}`);
      // Use topicLabel instead of parroting the user's query
      const topicLabel = session.currentTopic;
      const summaryMarkdown = buildTopicSummaryMarkdown(topicLabel);
      const topicResponse = buildCategoryExplorationResponse({ queryLower: session.currentTopic.toLowerCase(), session, coverageTier: extractCoverageFromQuery(query), enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE });
      if (topicResponse) {
        // Prepend the summaryMarkdown to the deterministic response
        const plainMsg = toPlainAssistantText(`${summaryMarkdown}\n\n${topicResponse}`);
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'continuation-handler', topic: session.currentTopic } });
      }
    }

    // ========================================================================
    // FOLLOW-UP: YES to compare dental vs vision
    // ========================================================================
    const isYes = isSimpleAffirmation(query);
    const lastAskedCompare = /compare\s+with\s+vision|compare\s+with\s+vision\s+coverage|compare\s+vision/i.test(session.lastBotMessage || '');
    const currentTopicLower = (session.currentTopic || '').toLowerCase();
    if (!pipelineFirstMode && isYes && lastAskedCompare && currentTopicLower.includes('dental')) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] YES-COMPARE-DENTAL-VISION`);
      const msg = buildDentalVisionComparisonResponse(session);
      const plainMsg = toPlainAssistantText(msg);
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'compare-dental-vision-yes' } });
    }

    // ========================================================================
    // DENTAL/VISION COMPARISON (Deterministic)
    // ========================================================================
    const compareDentalVisionRequested = /\bcompare\b/i.test(lowerQuery) && /\bvision\b/i.test(lowerQuery) && ( /\bdental\b/i.test(lowerQuery) || currentTopicLower.includes('dental') );
    if (compareDentalVisionRequested) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] COMPARE-DENTAL-VISION`);
      const msg = buildDentalVisionComparisonResponse(session);
      const plainMsg = toPlainAssistantText(applyPricingExclusion(msg, session.noPricingMode || intent.noPricing));
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'compare-dental-vision' } });
    }

    // If user asks to compare dental plans, clarify there is only one plan.
    const compareDentalOnlyRequested = /\bcompare\b/i.test(lowerQuery) && /\bdental\b/i.test(lowerQuery) && !/\bvision\b/i.test(lowerQuery);
    if (compareDentalOnlyRequested) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] COMPARE-DENTAL-ONLY`);
      let msg = `AmeriVet offers one comprehensive dental plan: **${amerivetBenefits2024_2025.dentalPlan.name}** (${amerivetBenefits2024_2025.dentalPlan.provider}).\n\n`;
      msg += `If you'd like a full “Teeth & Eyes” overview, I can compare it side-by-side with the vision plan.`;
      const plainMsg = toPlainAssistantText(applyPricingExclusion(session.noPricingMode ? stripPricingDetails(msg) : msg, session.noPricingMode || intent.noPricing));
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'compare-dental-only' } });
    }

    // ========================================================================
    // FIRST-PASS: DETERMINISTIC SHORT ANSWERS (yes/no + factual lookups)
    // ========================================================================
    // Intercepts "do we have X?", "who provides X?", "is X available?" queries
    // BEFORE they reach RAG or the LLM. Returns catalog-grounded answers
    // instantly ΓÇö no hallucination possible.
    {
      const { intent: firstPassIntent } = classifyQueryIntent(lowerQuery, session.currentTopic);
      if (!pipelineFirstMode && (firstPassIntent === 'yes_no' || firstPassIntent === 'factual_lookup')) {
        let shortAnswer = buildShortCategoryAnswer(lowerQuery, firstPassIntent, session);
        // Retry with session topic injected for context-free follow-ups
        // e.g. "who is this coverage with?" + currentTopic="life insurance"
        //   ΓåÆ "life insurance who is this coverage with?" ΓåÆ matches carrier lookup
        if (shortAnswer === null && session.currentTopic) {
          const topicAugmented = `${session.currentTopic} ${lowerQuery}`;
          shortAnswer = buildShortCategoryAnswer(topicAugmented.toLowerCase(), firstPassIntent, session);
        }
        if (shortAnswer !== null) {
          logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] FIRST-PASS-SHORT-ANSWER: intent=${firstPassIntent}`);
          session.currentTopic = normalizeBenefitCategory(lowerQuery) || session.currentTopic;
          const plainShort = toPlainAssistantText(shortAnswer);
          session.lastBotMessage = plainShort;
          await updateSession(sessionId, session);
          pipelineTrace.intent = { detected: firstPassIntent, confidence: 0.85 };
          pipelineTrace.response = { type: 'intercept', interceptName: 'first-pass-short-answer', citationsStripped: 0, hallucinationsDetected: 0, groundingWarnings: 0, length: plainShort.length };
          pipelineTrace.totalLatencyMs = Date.now() - new Date(pipelineTrace.timestamp).getTime();
          pipelineTrace.success = true;
          pipelineLogger.log(pipelineTrace).catch(() => {});
          return NextResponse.json({ answer: plainShort, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'first-pass-short-answer', intent: firstPassIntent } });
        }
      }
    }

    // ========================================================================
    // CATEGORY EXPLORATION INTERCEPT (Deterministic ΓÇö no RAG needed)
    // ========================================================================
    // When user says "medical", "dental", "life insurance", "vision", etc.
    // we return a deterministic overview from canonical data. This prevents
    // RAG retrieval failures from producing dead-end "couldn't find" messages.
    const categoryExplorationIntercept = shouldUseCategoryExplorationIntercept(query, lowerQuery, intentDomain)
      ? buildCategoryExplorationResponse({ queryLower: lowerQuery, session, coverageTier: extractCoverageFromQuery(query), enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE })
      : null;
    if (categoryExplorationIntercept && (!pipelineFirstMode || /\b(life\s+insurance|term\s+life|whole\s+life|basic\s+life)\b/i.test(lowerQuery))) {
        logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] CATEGORY-EXPLORATION: ${normalizeBenefitCategory(lowerQuery)}`);
        // Track current topic so "no thanks" / "skip" can decline it
        session.currentTopic = normalizeBenefitCategory(lowerQuery);
      const plainCategoryResponse = toPlainAssistantText(applyPricingExclusion(categoryExplorationIntercept, session.noPricingMode || intent.noPricing));
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
        if (!pipelineFirstMode) {
          const plainMsg = toPlainAssistantText(msg);
          session.lastBotMessage = plainMsg;
          await updateSession(sessionId, session);
          return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session) });
        }
        await updateSession(sessionId, session);
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
      // Family tier from "spouse and N children/kids" or "wife and kids" patterns
      if (/spouse\s*(?:and|\+|&)\s*(?:\d+\s*)?(?:child|kid)|wife\s*and\s*(?:\d+\s*)?kid|husband\s*and\s*(?:\d+\s*)?kid|partner\s*and\s*(?:\d+\s*)?child|children.*spouse|spouse.*children|have\s+(?:a\s+)?spouse\s+and\s+(?:\d+\s*)?(?:child|kid)|(?:\d+)\s*kids?.*spouse|spouse.*(?:\d+)\s*kids?/i.test(low)) return 'Employee + Family';
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

    // INTERCEPT: Total deduction calculation ΓÇö checked BEFORE generic per-paycheck
    // so "enroll in all benefits per paycheck" triggers the total, not the per-plan breakdown.
    if (totalDeductionRequested) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] TOTAL-DEDUCTION`);
      const coverageTier = extractCoverageFromQuery(query);
      const payPeriods = session.payPeriods || 26;

      // Try saved selections first
      const monthlyFromSelections = session.decisionsTracker
        ? pricingUtils.computeTotalMonthlyFromSelections(session.decisionsTracker, coverageTier)
        : 0;

      if (monthlyFromSelections > 0) {
        // User has confirmed plan selections ΓÇö use them
        let msg: string;
        if (session.noPricingMode) {
          msg = `Your selected benefits are confirmed. Pricing is currently off ΓÇö say "show pricing" to see deduction amounts. For exact deductions during enrollment, visit Workday: ${ENROLLMENT_PORTAL_URL}`;
        } else {
          const perPay = Number(((monthlyFromSelections * 12) / payPeriods).toFixed(2));
          const annual = Number((monthlyFromSelections * 12).toFixed(2));
          msg = `Based on your selected benefits, estimated deductions are $${pricingUtils.formatMoney(perPay)} per paycheck ($${pricingUtils.formatMoney(monthlyFromSelections)}/month, $${pricingUtils.formatMoney(annual)}/year).\n\nThis includes only the plan premiums I can calculate from your saved selections. For exact deductions during enrollment (and any age-banded voluntary benefits), confirm in Workday: ${ENROLLMENT_PORTAL_URL}`;
        }
        const plainMsg = toPlainAssistantText(applyPricingExclusion(msg, session.noPricingMode || intent.noPricing));
        session.lastBotMessage = plainMsg;
        await updateSession(sessionId, session);
        return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'total-deduction' } });
      }

      // Fallback: "enroll in ALL benefits" ΓÇö pick ONE medical plan + dental + vision
      // Users can only enroll in ONE medical plan, so show a range (cheapest ΓåÆ most expensive)
      const allRows = pricingUtils.buildPerPaycheckBreakdown(coverageTier, payPeriods);
      // Filter region-limited plans if we know the user's state
      const regionFiltered = session.userState && !isKaiserEligibleState(session.userState)
        ? allRows.filter(r => !/kaiser/i.test(r.plan))
        : allRows;

      const msg = buildAllPlansEstimateMessage({
        coverageTier,
        payPeriods,
        regionFilteredRows: regionFiltered,
        noPricingMode: session.noPricingMode || intent.noPricing,
        hasUserState: !!session.userState,
        enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
      });
      const plainMsg = toPlainAssistantText(applyPricingExclusion(msg, session.noPricingMode || intent.noPricing));
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'total-deduction', allPlans: true } });
    }

    if (perPaycheckRequested) {
      logger.info(`[REQ:${reqId}][STEP-7 INTERCEPT] PER-PAYCHECK`);
      const coverageTier = getCoverageTierForQuery(query, session);

      // Default to medical-only when user didn't explicitly ask about other benefit types.
      const wantsNonMedical = /\b(dental|vision|life|disability|accident|critical illness|hospital indemnity|voluntary)\b/i.test(query);
      const { payPeriods, filtered } = getAvailablePricingRows(session, coverageTier, { includeNonMedical: wantsNonMedical });

      const msg = buildPerPaycheckMessage({
        filtered,
        coverageTier,
        payPeriods,
        wantsNonMedical,
        noPricingMode: session.noPricingMode || intent.noPricing,
        hasUserState: !!session.userState,
        enrollmentPortalUrl: ENROLLMENT_PORTAL_URL,
      });
      const plainMsg = toPlainAssistantText(applyPricingExclusion(msg, session.noPricingMode || intent.noPricing));
      session.lastBotMessage = plainMsg;
      await updateSession(sessionId, session);
      return NextResponse.json({ answer: plainMsg, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'per-paycheck' } });
    }

    logger.info(`[REQ:${reqId}][STEP-8 RAG] No intercept matched ΓåÆ entering RAG pipeline. Category=${category||'ALL'} State=${resolvedState||'unknown'} IntentDomain=${intentDomain}`);
    logger.debug(`[RAG] Searching with Context - Category: ${category}, HasAge: ${!!session.userAge}, HasState: ${!!session.userState}`);

    const retrievalQuery = preprocessSignals.retrievalBoostTerms.length > 0
      ? `${query}\nFocus topics: ${preprocessSignals.retrievalBoostTerms.join(', ')}`
      : query;

    // 2. HYBRID SEARCH (Vector + BM25 with Category Filter + Query Expansion)
    const tRetrieval = Date.now();
    let result = await hybridRetrieve(retrievalQuery, context);
    logger.info(`[REQ:${reqId}][STEP-8a RETRIEVAL] ${result.chunks?.length||0} chunks in ${Date.now()-tRetrieval}ms`);

    // ========================================================================
    // GATE 2: Pre-LLM Retrieval Quality Check
    // If retrieval quality is too low, short-circuit before GPT-4 call to prevent hallucination
    // ========================================================================
    if (result.gatePass === false) {
      logger.warn(`[REQ:${reqId}][GATE2 FAIL] ${result.gateFailReason}, topScore=${result.gateTopScore?.toFixed(3)}`);

      if (pipelineFirstMode) {
        const nameRef = session.userName && session.userName !== 'Guest' ? session.userName : 'there';
        const summaryAnswer = isSummaryRequest(query)
          ? toPlainAssistantText(compileSummary(session.decisionsTracker || {}, nameRef, ENROLLMENT_PORTAL_URL, ALL_BENEFITS_SHORT))
          : null;
        const recommendationAnswer = buildRecommendationOverview(query, session)
          ? toPlainAssistantText(applyPricingExclusion(buildRecommendationOverview(query, session)!, session.noPricingMode || intent.noPricing))
          : null;
        const medicalAnswer = buildMedicalPlanFallback(query, session)
          ? toPlainAssistantText(buildMedicalPlanFallback(query, session)!)
          : null;
        const pipelineFallback = resolvePipelineFirstFallback({
          query,
          session,
          summaryAnswer,
          faqAnswer: checkL1FAQ(query, { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
          ppoAnswerFactory: () => toPlainAssistantText(buildPpoClarificationFallback(session)),
          recommendationAnswer,
          medicalAnswer,
        });

        if (pipelineFallback) {
          session.lastBotMessage = pipelineFallback.answer;
          await updateSession(sessionId, session);
          return NextResponse.json({
            answer: pipelineFallback.answer,
            tier: 'L1',
            sessionContext: buildSessionContext(session),
            metadata: { gatePass: false, intercept: pipelineFallback.intercept },
          });
        }
      }

      // COMPARISON FALLBACK: before dead-ending, check if this is a compare/options
      // query with a known topic ΓÇö buildCategoryExplorationResponse can handle it
      // deterministically without RAG. E.g. "what's the difference between the plans
      // available?" while currentTopic="Medical" gives a full medical overview.
      const hasCompareIntent = /\bdifference|compare|available|options\b/i.test(query);
      if (hasCompareIntent && session?.currentTopic) {
        const topicQuery = `${session.currentTopic} ${query}`.toLowerCase();
        const compareFallback = buildCategoryExplorationResponse({ queryLower: topicQuery, session, coverageTier: extractCoverageFromQuery(query), enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE });
        if (compareFallback) {
          const plainCompareFallback = toPlainAssistantText(compareFallback);
          recordAssistantReply(session, plainCompareFallback);
          await updateSession(sessionId, session);
          logger.info(`[REQ:${reqId}][GATE2 COMPARE-FALLBACK] Served deterministic response for topic=${session.currentTopic}`);
          return NextResponse.json({ answer: plainCompareFallback, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { gatePass: false, compareFallback: true } });
        }
      }

      const fallbackMsg = buildGateFailureEscalationMessage(HR_PHONE, ENROLLMENT_PORTAL_URL);
      const plainFallback = toPlainAssistantText(fallbackMsg);
      recordAssistantReply(session, plainFallback);
      await updateSession(sessionId, session);
      return NextResponse.json({
        answer: plainFallback,
        tier: 'L1',
        sessionContext: buildSessionContext(session),
        metadata: {
          gatePass: false,
          gateFailReason: result.gateFailReason,
          gateTopScore: result.gateTopScore,
          escalated: true
        }
      });
    }

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
    
    logger.info(`[REQ:${reqId}][STEP-8b PIPELINE] Retrieval=${pipelineResult.retrieval.passed?'PASS':'FAIL'}(${pipelineResult.retrieval.score.toFixed(3)}) Reasoning=${pipelineResult.reasoning.passed?'PASS':'FAIL'} Action=${pipelineResult.suggestedAction}`);
    logger.debug(`[PIPELINE] Initial: Retrieval=${pipelineResult.retrieval.passed ? '?' : '?'}, Reasoning=${pipelineResult.reasoning.passed ? '?' : '?'}, Action=${pipelineResult.suggestedAction}`);

    // 4. HANDLE PIPELINE RESULTS
    // ========================================================================
    
    // CASE A: Retrieval failed - try query expansion
    if (!pipelineResult.retrieval.passed || pipelineResult.suggestedAction === 'expand_query') {
        logger.info(`[REQ:${reqId}][STEP-8c EXPAND] Retrieval failed ΓåÆ expanding query (explicitCategory=${!!explicitCategoryRequested})`);
        logger.debug(`[PIPELINE] Triggering query expansion...`);
        
      // If the user explicitly asked for a specific category (e.g., "medical"), do NOT drop the category filter.
      // Dropping the filter can return unrelated voluntary/accident docs and confuse pricing.
      if (category && explicitCategoryRequested) {
        logger.debug('[PIPELINE] Explicit category requested; trying deterministic fallback before dead-end');
        // IMPORTANT: pass the full lowerQuery (not category.toLowerCase()) so buildCategoryExplorationResponse
        // can evaluate exclusion patterns (e.g. "dhmo", "compare") and check noPricingMode context correctly.
        const deterministicFallback = buildCategoryExplorationResponse({ queryLower: lowerQuery, session, coverageTier: extractCoverageFromQuery(query), enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE });
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
        logger.warn(`[REQ:${reqId}][STEP-8d] NO CHUNKS ΓåÆ attempting deterministic category fallback`);

        // Last-ditch safety net: if the query mentions a recognizable benefit category,
        // return the deterministic category exploration response instead of a dead-end.
        // Pass the category keyword directly (not lowerQuery, which may contain exclusion
        // words like "difference") so buildCategoryExplorationResponse can find the template.
        const detectedCategory = normalizeBenefitCategory(lowerQuery);
        const categoryKeyword = detectedCategory !== lowerQuery.charAt(0).toUpperCase() + lowerQuery.slice(1)
          ? detectedCategory.toLowerCase()
          : null;
        if (categoryKeyword) {
          const deterministicFallbackB = buildCategoryExplorationResponse({ queryLower: categoryKeyword, session, coverageTier: extractCoverageFromQuery(query), enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE });
          if (deterministicFallbackB) {
            logger.info(`[REQ:${reqId}][STEP-8d] Deterministic fallback hit for category: ${detectedCategory}`);
            session.currentTopic = detectedCategory;
            const plainFallback = toPlainAssistantText(deterministicFallbackB);
            recordAssistantReply(session, plainFallback);
            await updateSession(sessionId, session);
            return NextResponse.json({ answer: plainFallback, tier: 'L1', sessionContext: buildSessionContext(session), metadata: { intercept: 'zero-chunk-category-fallback', category: detectedCategory } });
          }
        }

        const msg = buildZeroChunkFallbackMessage(intent.isContinuation, ALL_BENEFITS_SHORT);
        const plainMsg = toPlainAssistantText(msg);
        recordAssistantReply(session, plainMsg);
        await updateSession(sessionId, session);
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
        logger.info(`[REQ:${reqId}][STEP-8d] Reasoning failed ΓåÆ offering alternative`);
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

    // 5. GENERATE ANSWER ΓÇö Data-Sovereign prompt with immutable catalog
    // Score-filtered, deduplicated, token-budgeted context ΓÇö see buildGroundedContext() for rationale
    const { context: contextText, stats: ctxStats } = buildGroundedContext(result.chunks, result.scores?.rrf || []);
    
    // Build conversation history for context (last 2 exchanges)
    const recentHistory = (session.messages || []).slice(-4)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

    const personaState = detectPersona(query, (session.messages || []).slice(-4).map(m => m.content), session.activePersona);
    if (session.activePersona !== personaState.persona || !session.personaUpdatedAt) {
      session.activePersona = personaState.persona;
      session.personaUpdatedAt = Date.now();
      session.personaHistory = [
        ...(session.personaHistory || []),
        {
          persona: personaState.persona,
          switchedAt: Date.now(),
          reason: personaState.reason,
          query,
        },
      ].slice(-6);
      await updateSession(sessionId, session);
    }

    const systemPrompt = buildSystemPrompt(session, personaState.persona);

    // Confidence-based hint (minor ΓÇö the system prompt already enforces catalog-only answers)
    const confidenceHint = useDisclaimer
        ? `If the catalog doesn't have an exact match, say: "Based on the plans available to you..." and give the closest answer from the catalog.`
        : `Answer directly from the catalog.`;

    // POLICY ROUTING MODE: when intent is policy (FMLA, SPD, QLE, IRS rules)
    // instruct LLM to SKIP pricing tables and focus on rules/process.
    const policyRoutingHint = preprocessSignals.intentDomainRoute === 'policy'
      ? `\nPOLICY REASONING MODE ACTIVE: The user is asking about rules, process, timelines, or compliance ΓÇö NOT about pricing. Do NOT show any cost tables, premium comparisons, or dollar amounts. Search specifically for SPD language, QLE rules, FMLA policy, and IRS compliance rules. Answer in plain text paragraphs, not tables.`
      : '';

    // NO-PRICING MODE: If user requested "no pricing" / "coverage only", instruct LLM accordingly
    const noPricingHint = (session.noPricingMode || intent.noPricing)
        ? `\nΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù\nΓòæ MANDATORY ΓÇö NO PRICING MODE ACTIVE                            Γòæ\nΓòæ The user explicitly said "no pricing/no dollar signs".        Γòæ\nΓòæ You MUST NOT include ANY:                                     Γòæ\nΓòæ   ΓÇó Dollar amounts ($X.XX)  ΓÇó Cost tables  ΓÇó Premiums         Γòæ\nΓòæ   ΓÇó Rates  ΓÇó Per-paycheck figures  ΓÇó Annual costs             Γòæ\nΓòæ Focus ONLY on: features, deductibles, coinsurance %, networks Γòæ\nΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥`
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
    // Classify query intent for response-shape routing
    const { intent: queryResponseIntent, confidence: intentConfidence } = classifyQueryIntent(query, session.currentTopic);
    const intentHintText = getIntentHint(queryResponseIntent);
    const pricingExclusion = session.noPricingMode || intent.noPricing;
    const digestedIntent = digestIntent(query, session, queryResponseIntent, intentDomain, pricingExclusion);
    logger.info(`[REQ:${reqId}][STEP-8e INTENT] responseIntent=${queryResponseIntent} confidence=${intentConfidence.toFixed(2)}`);

    // Build the strict state header to inject into every user message (re-enforcement)
    const stateEnforcement = session.userState
      ? (isKaiserEligibleState(session.userState)
        ? `STATE LOCK [${session.userState}]: Kaiser IS available. Include it.`
        : `STATE LOCK [${session.userState}]: KAISER IS FORBIDDEN ΓÇö exclude it entirely. Do NOT mention Kaiser.`)
      : `STATE: Unknown ΓÇö do not reference regional plan availability.`;

    const userMessage = `Topic: ${digestedIntent.topic}
  Intent: ${digestedIntent.intent}
  Persona: ${personaState.persona}
  Guardrail: ${digestedIntent.guardrail}
  ${digestedIntent.pricingExclusion ? 'PRICING EXCLUSION: Describe all coverage features, networks, and inclusions, but strictly omit all dollar amounts for premiums.' : ''}
  ${digestedIntent.regionalCheck}

  ${stateEnforcement}

${intentHintText}

Γû╢ EXACT QUESTION TO ANSWER: "${query}"
   Read this carefully. Answer SPECIFICALLY what is being asked ΓÇö do NOT default to a
   general category overview unless the user asks for one. If the user asks about a
   contact/navigation service not in AmeriVet's package, say so clearly.

RETRIEVAL CONTEXT (supplementary ΓÇö catalog in system prompt is authoritative):
${contextText}

CONVERSATION HISTORY:
${recentHistory}

QUESTION: ${query}

ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
PRINCIPAL ARCHITECT REASONING PROTOCOL (MANDATORY)
ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
Execute the full Self-Ask ΓåÆ CoT ΓåÆ ReAct pipeline from the system prompt.
Output your answer in EXACTLY this two-section format ΓÇö both sections required:

[REASONING]:
ΓÇó Self-Ask: list the hidden sub-questions you must resolve (FSA type, salary math, state, week-N)
ΓåÆ CoT: step-by-step logic + any math (Monthly ├╖ 4.33 ├ù 0.60 for STD weekly pay)
ΓåÆ ReAct: if any catalog lookup is needed, state "Action: look up X" then "Observation: Found Y"

[RESPONSE]:
<your final conversational answer ΓÇö use the voice of a senior benefits specialist speaking directly
to the employee. Write in flowing, well-constructed prose. Vary sentence structure. Lead with the
most important finding. No [Source N] citations, no <thought> tags, no robotic bullet dumps.>
${confidenceHint}${alternativeHint}${noPricingHint}${policyRoutingHint}${tierLockHint}
Remember: answer ONLY from the IMMUTABLE CATALOG. Do NOT ask for name, age, or state. Do NOT mention Rightway. Do NOT attribute Whole Life to Unum or Term Life to Allstate. Do NOT invent a "PPO" medical plan. Do NOT show [Source N] or [Doc N] citations in your response. AmeriVet does NOT offer a DHMO dental plan ΓÇö only the BCBSTX Dental PPO.`;

    logger.info(`[REQ:${reqId}][STEP-9 LLM] Generating answer: chunks=${result.chunks.length} contextChars=${ctxStats.totalChars} confidenceTier=${confidenceTier} useDisclaimer=${useDisclaimer}`);

    // temperature=0.15: slightly above 0.1 to allow natural, sophisticated prose while
    // keeping factual grounding tight. 0.1 was causing formulaic/robotic phrasing.
    const tLlm = Date.now();
    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ], { temperature: 0.2 });
    const llmMs = Date.now() - tLlm;
    logger.info(`[REQ:${reqId}][STEP-9a LLM-DONE] ${llmMs}ms rawLen=${completion.content.length}`);

    let answer = completion.content.trim();
    // Strict/minimal output pipeline
    answer = extractReasonedResponse(answer, true); // [RESPONSE] extraction + trace
    answer = stripThoughtBlock(answer, true);       // Remove <thought> blocks + trace
    answer = enforceMonthlyFirstFormat(answer);     // Normalize pricing
    answer = validatePricingFormat(answer);         // Remove hedging, markdown, internal prompts
    answer = cleanResponseText(answer);             // Remove repeated phrases/sentences
    answer = stripInternalPrompts(answer);           // Strip leaked internal reminders/instructions
    answer = answer.replace(/\n{3,}/g, '\n\n').trim(); // Remove excessive newlines
    // Remove boilerplate/disclaimer paragraphs (strict minimal)
    answer = answer.replace(/\n?\s*For live support or additional assistance.*?\n/gi, '');
    answer = answer.replace(/\n?\s*Would you like to explore a different benefit category\?\s*/gi, '');
    answer = answer.replace(/\n?\s*Would you like to:\s*-.*?\n/gi, '');
    answer = answer.replace(/\n?\s*Which benefit would you like to explore first\?.*?\n/gi, '');
    answer = answer.replace(/\n?\s*Is there anything else I can help you with\?\s*/gi, '');
    // Tracing hook: log final minimal output
    logger.info(`[TRACE-STRICT-MINIMAL] Final output: ${answer.slice(0, 600)}`);
    // Normalize pricing/state consistency
    try {
      answer = pricingUtils.normalizePricingInText(answer, session.payPeriods || 26);
      answer = pricingUtils.ensureStateConsistency(answer, session.userState || null);
    } catch (e) {
      logger.warn('[QA] Pricing normalization failed:', e);
    }
    
    // POST-PROCESSING: Strip banned content (Rightway, wrong phone numbers, wrong carriers)
    // Sentence-level removal: match any sentence containing a banned term
    const BANNED_TERMS_RE = /rightway|right\s*way/i;
    const BANNED_PHONE_RE = /\(?\s*305\s*\)?\s*[-.]?\s*851\s*[-.]?\s*7310/g;
    if (BANNED_TERMS_RE.test(answer)) {
        logger.warn(`[REQ:${reqId}][STEP-10 POST] Rightway reference stripped`);
        // Remove sentences (delimited by . ! ? or newline) mentioning banned terms
        answer = answer
            .split(/(?<=[.!?\n])/)
            .filter(sentence => !BANNED_TERMS_RE.test(sentence))
            .join('')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        // If stripping left the answer empty or broken, provide fallback
        if (answer.length < 20) {
            answer = buildLiveSupportFallback(ENROLLMENT_PORTAL_URL, HR_PHONE);
        }
    }
    // Strip the (305) 851-7310 number if it appears - replace with real HR number
    answer = answer.replace(BANNED_PHONE_RE, `AmeriVet HR/Benefits at ${HR_PHONE}`);

    // POST-PROCESSING: Strip [Source N] / [Doc N] citation artifacts from LLM output
    answer = answer.replace(/\[(?:Source|Doc(?:ument)?|Ref(?:erence)?)\s*\d+\]/gi, '').replace(/\s{2,}/g, ' ').trim();

    // POST-PROCESSING: Strip <thought>ΓÇª</thought> CoT blocks (log to debug, never show user)
    answer = stripThoughtBlock(answer, true);

    // POST-PROCESSING: Apply Brandon Rule (HSA Cross-Sell)
    
    // POST-PROCESSING: Orthodontics grounding check
    if (/orthodont/i.test(answer) && !result.chunks.some(c => /orthodont/i.test(c.content))) {
        logger.warn('[QA] Removed ungrounded orthodontics claim from answer');
        answer = answer.replace(/[^.]*orthodont[^.]*\./gi, '').trim();
    }

    answer = applyBrandonRule(answer, routerResult);

    // POST-PROCESSING: CARRIER INTEGRITY GUARD (Deterministic)
    // ΓÇö Allstate = Whole Life (permanent), Accident Insurance, Critical Illness ONLY.
    // ΓÇö UNUM = Basic Life & AD&D (employer-paid), Voluntary Term Life, STD, LTD ONLY.
    // ΓÇö BCBSTX = Medical/Dental. Never attribute life/accident/critical to BCBSTX.
    // ΓÇö Never mention "Rightway" (already handled above).
    const CARRIER_MISATTRIBUTION_RULES: Array<{ pattern: RegExp; fix: string }> = [
      { pattern: /allstate\s+(?:voluntary\s+)?term\s+life/gi, fix: 'Unum Voluntary Term Life' },
      { pattern: /unum\s+whole\s+life/gi, fix: 'Allstate Whole Life' },
      { pattern: /unum\s+(?:voluntary\s+)?accident(?:\s+insurance)?/gi, fix: 'Allstate Accident Insurance' },
      { pattern: /unum\s+critical\s+illness/gi, fix: 'Allstate Critical Illness' },
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

    // POST-PROCESSING: DHMO HALLUCINATION GUARD
    // AmeriVet has NO DHMO plan. If LLM output mentions DHMO as if it exists, correct it.
    const DHMO_HALLUCINATION = /\b(?:dental\s+hmo|dhmo\s+plan|the\s+dhmo|dhmo\s+(?:option|coverage|premium|cost|rate|provider))\b/gi;
    if (DHMO_HALLUCINATION.test(answer)) {
      logger.warn('[DHMO-GUARD] Stripped hallucinated DHMO plan reference');
      answer = answer.replace(DHMO_HALLUCINATION, 'BCBSTX Dental PPO (the only dental plan)');
    }

    // POST-PROCESSING: PPO HALLUCINATION GUARD
    // If the answer mentions a "PPO" medical plan (not dental PPO), strip or correct it
    const PPO_MEDICAL_HALLUCINATION = /\b(?:BCBSTX?\s+(?:medical\s+)?PPO(?!\s+dental|\s+Dental)|PPO\s+(?:Standard|plan|medical)|medical\s+PPO)\b/gi;
    if (PPO_MEDICAL_HALLUCINATION.test(answer) && !/dental\s+ppo/i.test(answer.match(PPO_MEDICAL_HALLUCINATION)?.[0] || '')) {
      logger.warn('[PPO-GUARD] Stripped hallucinated PPO medical plan reference');
      answer = answer.replace(PPO_MEDICAL_HALLUCINATION, 'Standard HSA/Enhanced HSA (PPO network)');
    }

    if (/\bppo\b/i.test(query) && !/dental\s+ppo/i.test(query) && !/does\s+not\s+offer|no\s+standalone|not\s+a\s+traditional\s+ppo/i.test(answer)) {
      logger.warn('[PPO-GUARD] Enforced PPO clarification response');
      answer = buildPpoClarificationFallback(session);
    }

    // POST-PROCESSING: ALLSTATE WHOLE LIFE HALLUCINATION GUARD
    // The catalog has NO specific coverage amounts for Allstate Whole Life (age-banded/placeholder).
    // Strip any invented coverage ranges (e.g., "$20,000ΓÇô$100,000") or age guarantees (e.g., "until age 95").
    const WHOLE_LIFE_FAKE_AMOUNTS = /(?:allstate|whole\s*life)[^.]*?\$[\d,]+\s*(?:[-ΓÇôΓÇöto]+\s*\$[\d,]+)?[^.]*\./gi;
    if (WHOLE_LIFE_FAKE_AMOUNTS.test(answer)) {
      logger.warn('[WHOLE-LIFE-GUARD] Stripped hallucinated Allstate Whole Life coverage amounts');
      answer = answer.replace(WHOLE_LIFE_FAKE_AMOUNTS, 'Allstate Whole Life coverage amounts are age-banded ΓÇö visit the enrollment portal for your personalized rate.');
    }
    const WHOLE_LIFE_AGE_GUARANTEE = /(?:allstate|whole\s*life)[^.]*(?:guaranteed\s+(?:until|to)\s+age\s+\d+|until\s+age\s+\d+)[^.]*\./gi;
    if (WHOLE_LIFE_AGE_GUARANTEE.test(answer)) {
      logger.warn('[WHOLE-LIFE-GUARD] Stripped hallucinated Allstate age guarantee');
      answer = answer.replace(WHOLE_LIFE_AGE_GUARANTEE, 'Allstate Whole Life is permanent coverage that does not expire as long as premiums are paid. Rates are locked at your enrollment age.');
    }

    // POST-PROCESSING: NO-PRICING ENFORCEMENT ΓÇö strip all $ and cost lines if noPricingMode
    // Check BOTH session.noPricingMode (from previous turns) AND intent.noPricing (current turn)
    // so the rule is bulletproof even if the session was not yet persisted.
    if (session.noPricingMode || intent.noPricing) {
      // Remove lines containing dollar amounts
      answer = answer.split('\n').filter(line => !/\$\d/.test(line)).join('\n');
      // Remove inline dollar mentions
      answer = answer.replace(/\$[\d,]+\.?\d{0,2}(?:\/(?:month|year|mo|yr|paycheck|pay period|bi-?weekly?))?/gi, '[see portal for pricing]');
      answer = answer.replace(/\[see portal for pricing\](?:\s*\([^)]*\))?/g, '[see portal for pricing]');
      logger.info(`[REQ:${reqId}][STEP-10 POST] NO-PRICING: stripped pricing from response`);
    }

    answer = applyPricingExclusion(answer, pricingExclusion);

    answer = toPlainAssistantText(answer);


    // ΓöÇΓöÇ NUMERICAL INTEGRITY GUARD: catch hallucinated numbers not in catalog or IRS constants ΓöÇΓöÇ
    const allowedValues = [
      ...extractAllNumbers(amerivetBenefits2024_2025),
      ...Object.values(IRS_2026)
    ];
    const hallucinations = verifyNumericalIntegrity(answer, allowedValues);
    if (hallucinations.length > 0) {
      logger.error(`[CRITICAL] Hallucination detected: ${hallucinations}`);
      // Optionally redact or flag for audit dashboard here
    }

    // ΓöÇΓöÇ GROUNDING AUDIT: verify every $X in the answer exists in the catalog ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // Sentences with STD math (├╖ 4.33, weekly pay) are exempt ΓÇö those are derived values.
    const catalogNumbers = buildCatalogNumberSet(getCatalogForPrompt(session.userState || null));
    const { answer: auditedAnswer, warnings: groundingWarnings } = auditDollarGrounding(answer, catalogNumbers, result.chunks);
    if (groundingWarnings.length) {
      logger.warn(`[GROUNDING-AUDIT] ${groundingWarnings.length} ungrounded amount(s) corrected: ${groundingWarnings.join(', ')}`);
      answer = auditedAnswer;
    }

    // ΓöÇΓöÇ TEXTUAL HALLUCINATION AUDIT: detect fabricated policy details ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const { hasHallucination, matches: hallucinationMatches } = detectTextualHallucination(answer);
    if (hasHallucination) {
      logger.warn(`[HALLUCINATION-AUDIT] ${hallucinationMatches.length} fabricated detail(s) detected: ${hallucinationMatches.map(m => m.label).join(', ')}`);
      // Strip sentences containing hallucinated content
      for (const { matched } of hallucinationMatches) {
        const escaped = matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Remove the entire sentence containing the hallucination
        answer = answer.replace(new RegExp(`[^.!?\\n]*${escaped}[^.!?\\n]*[.!?]?\\s*`, 'gi'), '');
      }
      answer = answer.replace(/\n{3,}/g, '\n\n').trim();
    }

    let finalGenQuality = scoreGenerationQuality(query, answer);

    // ΓöÇΓöÇ LOW-SCORE RETRY GATE ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // If generation quality < 0.42, retry once with a directive prompt (temp=0.05).
    // Uses the better-scoring answer.  Does NOT re-run full post-processing chain ΓÇö
    // just the light cleanup needed to produce a clean final answer.
    if (finalGenQuality.score < 0.42) {
      logger.warn(`[REQ:${reqId}][STEP-10b RETRY] Low score ${finalGenQuality.score} ΓåÆ retrying with directive prompt (temp=0.05)`);
      try {
        const retryMsg = `${stateEnforcement}

RETRIEVAL CONTEXT:
${contextText}

QUESTION: ${query}

[RESPONSE]:
Answer directly from the IMMUTABLE CATALOG. Name the plan. State the exact figure. Explain the rule in one clear paragraph. Do not ask clarifying questions.`;
        const retryCompletion = await azureOpenAIService.generateChatCompletion([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: retryMsg }
        ], { temperature: 0.05 });
        let retryAnswer = retryCompletion.content.trim();
        // Strict/minimal output pipeline for retry
        retryAnswer = extractReasonedResponse(retryAnswer, false);
        retryAnswer = stripThoughtBlock(retryAnswer, false);
        retryAnswer = enforceMonthlyFirstFormat(retryAnswer);
        retryAnswer = validatePricingFormat(retryAnswer);
        retryAnswer = cleanResponseText(retryAnswer);
        retryAnswer = stripInternalPrompts(retryAnswer);
        retryAnswer = retryAnswer.replace(/\n{3,}/g, '\n\n').trim();
        retryAnswer = retryAnswer.replace(/\n?\s*For live support or additional assistance.*?\n/gi, '');
        retryAnswer = retryAnswer.replace(/\n?\s*Would you like to explore a different benefit category\?\s*/gi, '');
        retryAnswer = retryAnswer.replace(/\n?\s*Would you like to:\s*-.*?\n/gi, '');
        retryAnswer = retryAnswer.replace(/\n?\s*Which benefit would you like to explore first\?.*?\n/gi, '');
        retryAnswer = retryAnswer.replace(/\n?\s*Is there anything else I can help you with\?\s*/gi, '');
        logger.info(`[TRACE-STRICT-MINIMAL-RETRY] Final output: ${retryAnswer.slice(0, 600)}`);
        try {
          retryAnswer = pricingUtils.normalizePricingInText(retryAnswer, session.payPeriods || 26);
          retryAnswer = cleanResponseText(retryAnswer);
        } catch { /* non-fatal */ }
        if (session.noPricingMode || intent.noPricing) {
          retryAnswer = retryAnswer.split('\n').filter(line => !/\$\d/.test(line)).join('\n');
          retryAnswer = retryAnswer.replace(/\$[\d,]+\.?\d{0,2}(?:\/(?:month|year|mo|yr|paycheck|pay period|bi-?weekly?))?/gi, '[see portal for pricing]');
        }
        retryAnswer = toPlainAssistantText(retryAnswer);
        // Apply grounding audit to retry too
        const { answer: auditedRetry, warnings: retryWarnings } = auditDollarGrounding(retryAnswer, catalogNumbers, result.chunks);
        if (retryWarnings.length) retryAnswer = auditedRetry;
        const retryQuality = scoreGenerationQuality(query, retryAnswer);
        if (retryQuality.score > finalGenQuality.score) {
          logger.info(`[QA] Retry improved generation score: ${finalGenQuality.score} ΓåÆ ${retryQuality.score}`);
          answer = retryAnswer;
          finalGenQuality = retryQuality;
        } else {
          logger.debug(`[QA] Retry score ${retryQuality.score} did not improve on ${finalGenQuality.score} ΓÇö keeping original`);
        }
      } catch (retryErr) {
        logger.warn('[QA] Retry attempt failed (non-fatal):', retryErr);
      }
    }

    const validationGateFailures: string[] = [];
    if (hallucinations.length > 0) validationGateFailures.push('numerical-integrity');
    if (hallucinationMatches.length > 0) validationGateFailures.push('textual-hallucination');
    if (groundingWarnings.length > 0) validationGateFailures.push('grounding-audit');
    if (finalGenQuality.score < 0.42) validationGateFailures.push('generation-quality');
    if (!pipelineResult.overallPassed) validationGateFailures.push('pipeline-overall');

    const highConfidenceMedicalFallback = pipelineResult.retrieval.score >= 0.01 || (result.gateTopScore ?? 0) >= 0.01;

    const validationGatePassed = validationGateFailures.length === 0;
    if (!validationGatePassed) {
      logger.warn(`[REQ:${reqId}][STEP-11 GATE-FAIL] validation gate blocked response: ${validationGateFailures.join(', ')}`);

      if (pipelineFirstMode) {
        const nameRef = session.userName && session.userName !== 'Guest' ? session.userName : 'there';
        const summaryAnswer = isSummaryRequest(query)
          ? toPlainAssistantText(compileSummary(session.decisionsTracker || {}, nameRef, ENROLLMENT_PORTAL_URL, ALL_BENEFITS_SHORT))
          : null;
        const medicalAnswer = highConfidenceMedicalFallback
          ? buildMedicalPlanFallback(query, session)
          : null;
        const validationPipelineFallback = resolvePipelineFirstFallback({
          query,
          session,
          interceptSuffix: '-validation',
          summaryAnswer,
          faqAnswer: checkL1FAQ(query, { enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE }),
          ppoAnswerFactory: () => toPlainAssistantText(buildPpoClarificationFallback(session)),
          medicalAnswer: medicalAnswer ? toPlainAssistantText(medicalAnswer) : null,
        });

        if (validationPipelineFallback) {
          recordAssistantReply(session, validationPipelineFallback.answer, query);
          await updateSession(sessionId, session);
          return NextResponse.json({
            answer: validationPipelineFallback.answer,
            tier: 'L1',
            citations: result.chunks,
            sessionContext: buildSessionContext(session),
            metadata: {
              category,
              validationGate: { passed: false, failures: validationGateFailures, generationScore: finalGenQuality.score },
              validation: { retrieval: pipelineResult.retrieval, reasoning: pipelineResult.reasoning, output: pipelineResult.output, overallPassed: pipelineResult.overallPassed },
              intercept: validationPipelineFallback.intercept
            },
          });
        }
      }

      // Prefer deterministic, catalog-based responses before using the
      // "could not validate" fallback.
      const validationFallback = resolveValidationFallback({
        lowerQuery,
        interceptSuffix: '-validation',
        currentTopic: session.currentTopic,
        dentalVisionAnswer: toPlainAssistantText(buildDentalVisionComparisonResponse(session)),
        singleDentalAnswer: toPlainAssistantText(
          session.noPricingMode
            ? stripPricingDetails(buildSingleDentalPlanFallback(amerivetBenefits2024_2025.dentalPlan.name, amerivetBenefits2024_2025.dentalPlan.provider))
            : buildSingleDentalPlanFallback(amerivetBenefits2024_2025.dentalPlan.name, amerivetBenefits2024_2025.dentalPlan.provider)
        ),
        categoryExplorationAnswer: (() => {
          const deterministicFallback = buildCategoryExplorationResponse({ queryLower: lowerQuery, session, coverageTier: extractCoverageFromQuery(query), enrollmentPortalUrl: ENROLLMENT_PORTAL_URL, hrPhone: HR_PHONE });
          return deterministicFallback ? toPlainAssistantText(deterministicFallback) : null;
        })(),
        recommendationAnswer: (() => {
          const recommendationFallback = buildRecommendationOverview(query, session);
          return recommendationFallback
            ? toPlainAssistantText(applyPricingExclusion(recommendationFallback, session.noPricingMode || intent.noPricing))
            : null;
        })(),
      });

      if (validationFallback) {
        recordAssistantReply(session, validationFallback.answer, query);
        await updateSession(sessionId, session);
        return NextResponse.json({
          answer: validationFallback.answer,
          tier: 'L1',
          citations: result.chunks,
          sessionContext: buildSessionContext(session),
          metadata: {
            category,
            validationGate: { passed: false, failures: validationGateFailures, generationScore: finalGenQuality.score },
            validation: { retrieval: pipelineResult.retrieval, reasoning: pipelineResult.reasoning, output: pipelineResult.output, overallPassed: pipelineResult.overallPassed },
            intercept: validationFallback.intercept
          },
        });
      }

      const safeFallback = toPlainAssistantText(
        buildValidationSafeFallback(HR_PHONE, ENROLLMENT_PORTAL_URL)
      );

      recordAssistantReply(session, safeFallback, query)
      await updateSession(sessionId, session);

      return NextResponse.json({
        answer: safeFallback,
        tier: 'L1',
        citations: result.chunks,
        sessionContext: buildSessionContext(session),
        metadata: {
          category,
          validationGate: {
            passed: false,
            failures: validationGateFailures,
            generationScore: finalGenQuality.score,
            groundingWarnings: groundingWarnings.length,
            textualHallucinations: hallucinationMatches.length,
            numericalHallucinations: hallucinations.length,
          },
          validation: {
            retrieval: pipelineResult.retrieval,
            reasoning: pipelineResult.reasoning,
            output: pipelineResult.output,
            overallPassed: pipelineResult.overallPassed,
          },
        },
      });
    }

    logger.info(`[REQ:${reqId}][STEP-11 SCORECARD] score=${finalGenQuality.score} coverage=${finalGenQuality.coverage} specificity=${finalGenQuality.specificity} groundingWarnings=${groundingWarnings.length} answerChars=${answer.length}`);
    logger.info('[QA-SCORECARD]', {
      sessionId,
      query: query.slice(0, 80),
      retrieval: {
        chunksRaw:          ctxStats.chunksRaw,
        chunksPassedFilter: ctxStats.chunksPassedFilter,
        totalContextChars:  ctxStats.totalChars,
        retrievalScore:     pipelineResult.retrieval.score.toFixed(3),
        confidenceTier,
        topRrfScore:        topScore.toFixed(4),
      },
      generation: {
        score:       finalGenQuality.score,
        coverage:    finalGenQuality.coverage,
        specificity: finalGenQuality.specificity,
        lengthOk:    finalGenQuality.lengthOk,
        answerChars: answer.length,
        groundingWarnings: groundingWarnings.length,
      },
      temperature: 0.2,
    });
    logger.debug(`[RAG] Final answer (${answer.length} chars) ΓÇö generation quality ${(finalGenQuality.score * 100).toFixed(0)}% | coverage ${(finalGenQuality.coverage * 100).toFixed(0)}% | specificity ${(finalGenQuality.specificity * 100).toFixed(0)}% | grounding warnings: ${groundingWarnings.length}`);

    recordAssistantReply(session, answer, query)
    
    await updateSession(sessionId, session);
    logger.info(`[REQ:${reqId}][STEP-12 DONE] RAG path ΓåÆ ${answer.length} chars, totalTime=${Date.now()-t0}ms, tier=${confidenceTier}`);

    // ΓöÇΓöÇ Pipeline trace: finalize and log (non-blocking) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    pipelineTrace.intent = { detected: queryResponseIntent, confidence: intentConfidence };
    pipelineTrace.retrieval = {
      chunksReturned: result.chunks?.length || 0,
      topScore: parseFloat(topScore.toFixed(3)),
      latencyMs: 0, // filled earlier if tRetrieval was tracked
      method: 'hybrid',
      category: category || null,
    };
    pipelineTrace.gate = {
      passed: result.gatePass !== false,
      topScore: result.gateTopScore ?? 0,
      chunkCount: result.chunks?.length || 0,
      failReason: result.gateFailReason,
    };
    pipelineTrace.llm = {
      model: 'gpt-4.1-mini',
      promptTokens: completion.usage?.promptTokens ?? 0,
      completionTokens: completion.usage?.completionTokens ?? 0,
      latencyMs: llmMs,
      temperature: 0.2,
    };
    pipelineTrace.response = {
      type: 'generated',
      citationsStripped: 0,
      hallucinationsDetected: hallucinationMatches.length,
      groundingWarnings: groundingWarnings.length,
      length: answer.length,
    };
    pipelineTrace.totalLatencyMs = Date.now() - t0;
    pipelineTrace.coverageTier = session.coverageTierLock ?? extractCoverageFromQuery(query);
    // Fire-and-forget ΓÇö never block the response
    pipelineLogger.log(pipelineTrace).catch(() => {});

    return NextResponse.json({
      answer,
      tier: 'L2',
      citations: result.chunks,
      sessionContext: buildSessionContext(session),
      metadata: {
        category: category,
        chunksUsed:         result.chunks?.length || 0,
        chunksRaw:          ctxStats.chunksRaw,
        chunksPassedFilter: ctxStats.chunksPassedFilter,
        sessionId,
        confidenceTier,
        usedDisclaimer: useDisclaimer,
        topScore: topScore.toFixed(3),
        generationScore:       finalGenQuality.score,
        generationCoverage:    finalGenQuality.coverage,
        generationSpecificity: finalGenQuality.specificity,
        groundingWarnings:     groundingWarnings.length,
        userAge: session.userAge,
        userState: session.userState,
        // Router result (Senior Engineer approach)
        router: {
          category: routerResult.category,
          confidence: routerResult.confidence,
          triggersHSACrossSell: routerResult.triggersHSACrossSell,
          requiresAgeBand: routerResult.requiresAgeBand
        },
        queryIntent: {
          intent: queryResponseIntent,
          confidence: intentConfidence,
        },
        validation: {
          retrieval: pipelineResult.retrieval,
          reasoning: pipelineResult.reasoning,
          output: pipelineResult.output,
          overallPassed: pipelineResult.overallPassed
        },
        validationGate: {
          passed: true,
          failures: [],
          generationScore: finalGenQuality.score,
          groundingWarnings: groundingWarnings.length,
          textualHallucinations: hallucinationMatches.length,
          numericalHallucinations: hallucinations.length,
        }
      }
    });

  } catch (error) {
    // Enhanced error logging for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : 'No stack trace';
    logger.error('[QA] Error:', errorMessage);
    logger.error('[QA] Stack:', errorStack);
    logger.error(`[QA] Request body query: "${(parsedBody?.query || '').slice(0, 100)}"`);

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
