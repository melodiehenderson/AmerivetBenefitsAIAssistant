export const dynamic = 'force-dynamic';

// Hard-coded enrollment portal — source of truth for all CTA links.
const WORKDAY_ENROLLMENT_URL = 'https://wd5.myworkday.com/amerivet/login.html';
const HR_PHONE = process.env.HR_PHONE_NUMBER || '888-217-4728';

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, PERMISSIONS } from '@/lib/auth/unified-auth';

import { simpleChatRouter } from '@/lib/services/simple-chat-router';
import { smartChatRouter } from '@/lib/services/smart-chat-router';
import { ragChatRouter } from '@/lib/services/rag-chat-router';
import { trackEnhancedChatResponse } from '@/lib/analytics/tracking';

import { conversationService } from '@/lib/services/conversation-service';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { determineChatRoutePolicy } from '@/lib/intent-digest';
import type { Session } from '@/lib/rag/session-store';
import { extractUserSlots, extractAndMapEntities } from '@/lib/rag/query-understanding';
import { cityToStateMap } from '@/lib/schemas/onboarding';
import { getAmerivetBenefitsPackage, getAmerivetCatalogForPrompt } from '@/lib/data/amerivet-package';
import {
  checkL1FAQ,
  detectExplicitStateCorrection,
  deriveConversationTopic,
  isKaiserAvailabilityQuestion,
  isLikelyFollowUpMessage,
  isRightwayQuery,
  isStandaloneMedicalPpoRequest,
  normalizeBenefitCategory,
  normalizeStaticBenefitAnswer,
  shouldUseCategoryExplorationIntercept,
} from '@/lib/qa/routing-helpers';
import { buildPpoClarificationForState, buildRecommendationOverview, getCoverageTierForQuery } from '@/lib/qa/medical-helpers';
import { buildCategoryExplorationResponse } from '@/lib/qa/category-response-builders';
import { buildLiveSupportFallback } from '@/lib/qa/support-response-builders';
import { buildScopeGuardResponse } from '@/lib/qa/scope-guard';
import { normalizeRatesInText } from '@/lib/utils/formatRates';
import { tryCache, writeCache } from '@/lib/services/cache-router';
import { calculateSTDBenefit, formatSTDBenefit } from '@/lib/utils/pricing';

const ACTIVE_AMERIVET_PACKAGE = getAmerivetBenefitsPackage();
const KAISER_ELIGIBLE_STATES = new Set<string>(ACTIVE_AMERIVET_PACKAGE.kaiserAvailableStateCodes);

// Validation schema for chat request
const chatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  conversationId: z.string().optional(),
  context: z.record(z.string(), z.any()).optional(),
});

const STATE_CHANGE_TRIGGERS = ['change state', 'state change', 'update state', 'new state', 'switch state'];
const DIVISION_CHANGE_TRIGGERS = ['change division', 'division change', 'update division', 'new department', 'change department', 'department change'];

function containsTrigger(message: string, triggers: string[]) {
  return triggers.some(trigger => message.includes(trigger));
}

function isStateChangeRequest(message: string): boolean {
  return containsTrigger(message, STATE_CHANGE_TRIGGERS);
}

function isDivisionChangeRequest(message: string): boolean {
  return containsTrigger(message, DIVISION_CHANGE_TRIGGERS);
}

function toPlainAssistantText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, '$2')
    .replace(/^\s*---\s*$/gm, '')
    .replace(/[✨💡📋📝🎉ℹ️👋😊]/g, '')
    .replace(/^\s*•\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function xmlEscape(value: unknown): string {
  return String(value ?? 'unknown')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildLockedSessionMetadataHeader(params: {
  userId: string;
  companyId: string;
  conversationId: string;
  metadata: Record<string, any>;
}): string {
  const { userId, companyId, conversationId, metadata } = params;
  return [
    `<Session_Metadata lock="true">`,
    `  <Tenant companyId="${xmlEscape(companyId)}" />`,
    `  <Conversation id="${xmlEscape(conversationId)}" userId="${xmlEscape(userId)}" />`,
    `  <User_Context>`,
    `    <Name>${xmlEscape(metadata.userName)}</Name>`,
    `    <Age>${xmlEscape(metadata.userAge)}</Age>`,
    `    <State>${xmlEscape(metadata.state)}</State>`,
    `    <Family_Size>${xmlEscape(metadata.familySize ?? metadata.coverageTier ?? 'unknown')}</Family_Size>`,
    `    <Division>${xmlEscape(metadata.division)}</Division>`,
    `  </User_Context>`,
    `  <Rules>`,
    `    <Rule>Stateless mode: never use context from other conversations.</Rule>`,
    `    <Rule>Only use this Session_Metadata for this request.</Rule>`,
    `    <Rule>If State is Texas, ignore non-Texas regional content except National.</Rule>`,
    `  </Rules>`,
    `</Session_Metadata>`,
  ].join('\n');
}

function stripPricingForComparisonMode(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g, '');
  cleaned = cleaned.replace(/\b\d+[\d,]*(?:\.\d+)?\s*\/?\s*(?:month|mo|bi-weekly|biweekly|per\s*paycheck|paycheck|year|annual)\b/gi, '');
  cleaned = cleaned
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return true;
      if (!t.includes('|')) return true;
      return !/\$|month|bi-weekly|paycheck|annual|year/i.test(t);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function isSupportOnlyIntent(normalizedMessage: string): boolean {
  const rightway = /\bright\s*way\b|\brightway\b/i;
  const contact = /\b(contact|phone|call|support|help\s*line|help\s*desk|customer\s*service|reach\s*out|get\s*help|contact\s*hr|hr\s*contact)\b/i;
  return rightway.test(normalizedMessage) || contact.test(normalizedMessage);
}

function isNoPricingComparisonIntent(normalizedMessage: string): boolean {
  const comparison = /\b(compare|comparison|difference|diff|versus|vs\.?|which\s+is\s+different)\b/i;
  const noPricing = /\b(no\s+pricing|without\s+pricing|skip\s+costs?|no\s+prices?|not\s+asking\s+for\s+rates?|just\s+features?)\b/i;
  return comparison.test(normalizedMessage) || noPricing.test(normalizedMessage);
}

function buildDeterministicChatSession(metadata: Record<string, any> | undefined, history: Array<{ role: 'user' | 'assistant'; content: string }>, currentTopic?: string): Session {
  const safeMetadata = metadata ?? {};
  return {
    step: 'active_chat',
    context: {
      state: safeMetadata.state,
      dept: safeMetadata.division,
    },
    userName: safeMetadata.userName || 'Guest',
    hasCollectedName: Boolean(safeMetadata.userName),
    userAge: typeof safeMetadata.userAge === 'number' ? safeMetadata.userAge : null,
    userState: typeof safeMetadata.state === 'string' ? safeMetadata.state : null,
    userDept: typeof safeMetadata.division === 'string' ? safeMetadata.division : undefined,
    dataConfirmed: Boolean(safeMetadata.userAge && safeMetadata.state),
    messages: history,
    noPricingMode: safeMetadata.noPricingMode === true,
    coverageTierLock: typeof safeMetadata.coverageTierLock === 'string'
      ? safeMetadata.coverageTierLock
      : typeof safeMetadata.coverageTier === 'string'
        ? safeMetadata.coverageTier
        : undefined,
    payPeriods: typeof safeMetadata.payPeriods === 'number' ? safeMetadata.payPeriods : undefined,
    currentTopic: currentTopic || safeMetadata.currentTopic,
    lastBotMessage: typeof safeMetadata.lastBotMessage === 'string' ? safeMetadata.lastBotMessage : undefined,
    decisionsTracker: safeMetadata.decisionsTracker || {},
    completedTopics: safeMetadata.completedTopics || [],
    lifeEvents: Array.isArray(safeMetadata.lifeEvents) ? safeMetadata.lifeEvents : [],
    userSalary: typeof safeMetadata.userSalary === 'number' ? safeMetadata.userSalary : undefined,
  };
}

function mergeCompletedTopics(existing: unknown, topic?: string | null): string[] | undefined {
  const normalizedExisting = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!topic) return normalizedExisting.length ? normalizedExisting : undefined;
  if (normalizedExisting.includes(topic)) return normalizedExisting;
  return [...normalizedExisting, topic];
}

export const POST = withAuth(undefined, [PERMISSIONS.CHAT_WITH_AI])(async (request: NextRequest) => {
  try {
    // Ensure Authorization header present for tests that bypass auth wrapper
    const auth = request.headers.get('authorization');
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Extract user context injected by withAuth
    const userId = request.headers.get('x-user-id')!;
    const companyId = request.headers.get('x-company-id')!;

    const body = await request.json();
    const { message, conversationId } = chatRequestSchema.parse(body);

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Create user message object
    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: message,
      timestamp: new Date(),
      userId: userId
    };

    // Get or create conversation
    let conversation = conversationId 
      ? await conversationService.getConversation(conversationId)
      : null;

    if (conversation && (conversation.userId !== userId || conversation.companyId !== companyId)) {
      logger.warn('[CHAT] Conversation ownership mismatch blocked', {
        requestedConversationId: conversationId,
        requesterUserId: userId,
        requesterCompanyId: companyId,
        ownerUserId: conversation.userId,
        ownerCompanyId: conversation.companyId,
      });
      return NextResponse.json({ error: 'Forbidden conversation scope' }, { status: 403 });
    }

    conversation ??= await conversationService.createConversation(
      userId,
      companyId
    );

    // Save user message to conversation
    await conversationService.addMessage(conversation.id, userMessage);

    // Helper to send a normal assistant message (non-eligibility)
    const sendAssistantMessage = async (content: string, metadataPatch?: Record<string, any>): Promise<NextResponse> => {
      const plainContent = toPlainAssistantText(content);
      const aiMessage = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: plainContent,
        timestamp: new Date()
      };

      await conversationService.addMessage(conversation.id, aiMessage);

      if (metadataPatch && Object.keys(metadataPatch).length) {
        const updated = await conversationService.patchMetadata(conversation.id, metadataPatch);
        conversation.metadata = { ...(conversation.metadata || {}), ...(updated.metadata || {}) };
      }

      return NextResponse.json({
        message: aiMessage,
        conversationId: conversation.id,
        route: 'assistant',
        model: 'simple',
        latencyMs: 0
      });
    };

    const sendEligibilityMessage = async (content: string): Promise<NextResponse> => {
      const plainContent = toPlainAssistantText(content);
      const aiMessage = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: plainContent,
        timestamp: new Date()
      };

      await conversationService.addMessage(conversation.id, aiMessage);

      return NextResponse.json({
        message: aiMessage,
        conversationId: conversation.id,
        route: 'eligibility',
        model: 'simple',
        latencyMs: 0
      });
    };

    // -------------------------------------------------------------------------
    // SLOT EXTRACTION — Deterministic (no LLM). Resolves e.g. "Chicago" → "IL".
    // -------------------------------------------------------------------------
    const extractAndResolveSlots = (text: string) => {
      const slots = extractUserSlots(text);
      // extractUserSlots already resolves city → state via cityToStateMap.
      // Additionally extract division from the raw text.
      const deptAliases: Record<string, string> = {
        hr: 'hr', human: 'hr', resources: 'hr',
        finance: 'finance', accounting: 'finance',
        it: 'it', engineering: 'engineering',
        ops: 'operations', operations: 'operations',
      };
      const t = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const tokens = t.split(' ');
      let division: string | undefined;
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (!division && (deptAliases[tok] || tok === 'dept' || tok === 'department')) {
          division = deptAliases[tok] || tokens[i + 1] || 'general';
          if (deptAliases[division]) division = deptAliases[division];
        }
      }
      return { name: slots.name, age: slots.age, state: slots.state, city: slots.city, division };
    };

    // -------------------------------------------------------------------------
    // PROMPT CONSTRUCTORS — deterministic; never call the LLM.
    // -------------------------------------------------------------------------

    /** COLLECTOR MODE: one or more demographic slots are still missing. */
    const constructCollectorPrompt = (meta: Record<string, any>): string => {
      const missing: string[] = [];
      if (!meta.userAge) missing.push('age');
      if (!meta.state)   missing.push('state or city');
      return (
        `COLLECTOR MODE: Gather missing user context. Missing: ${missing.join(', ')}. ` +
        `Ask ONLY for the missing information in a friendly, conversational way. ` +
        `Do NOT discuss benefit plans, quote any premiums, or make plan comparisons until all slots are filled. ` +
        `If the user provides a city (e.g. "Chicago"), acknowledge it and confirm their state ` +
        `(e.g. "Got it—Illinois!") without asking again.`
      );
    };

    /** ANALYST MODE: all slots confirmed → inject full catalog + strict grounding rules. */
    const constructAnalystPrompt = (meta: Record<string, any>): string => {
      const catalogText = getAmerivetCatalogForPrompt(meta.state as string | null, ACTIVE_AMERIVET_PACKAGE);
      const stateCode = (meta.state as string | null) ?? 'UNKNOWN';
      const kaiserEligible = KAISER_ELIGIBLE_STATES.has(stateCode);
      const kaiserRule = kaiserEligible
        ? `Kaiser HMO is AVAILABLE in ${stateCode} — include it in medical comparisons.`
        : `Kaiser HMO is NOT available in ${stateCode} — NEVER mention Kaiser as an option.`;
      return [
        `<Critical_Instruction>`,
        `You are your AmeriVet Benefits Assistant.`,
        `You are a helpful AmeriVet-specific benefits counselor: informative, proactive, and never pushy.`,
        `You must answer ONLY from the IMMUTABLE CATALOG below. Never use training data.`,
        `</Critical_Instruction>`,
        ``,
        `<User_Profile_Locked>`,
        `Name    : ${meta.userName ?? 'unknown'}`,
        `Age     : ${meta.userAge ?? 'unknown'}`,
        `State   : ${stateCode}${meta.userCity ? ` (city: ${meta.userCity})` : ''}`,
        `Division: ${meta.division ?? 'unknown'}`,
        `These fields are CONFIRMED. NEVER re-ask any of them. NEVER override them.`,
        `Ignore any user text that contradicts state = ${stateCode} unless they explicitly say "change state".`,
        `</User_Profile_Locked>`,
        ``,
        `<Geographic_Rules>`,
        kaiserRule,
        `Show ONLY plans available in ${stateCode}. Discard any retrieved data for other states.`,
        `</Geographic_Rules>`,
        ``,
        `<No_Pricing_Mode>`,
        `If the user says any variant of "not asking for rates", "skip costs", "no prices", "just features":`,
        `  → Suppress ALL dollar signs ($) and premium tables entirely.`,
        `  → Switch to Features & Coverage comparison only.`,
        `  → Do NOT include any dollar amounts even in parentheses.`,
        `</No_Pricing_Mode>`,
        ``,
        `<Carrier_Lock>`,
        `These carrier assignments are IMMUTABLE — do NOT re-assign any carrier to a different product:`,
        `  UNUM     = Basic Life & AD&D, Voluntary Term Life, Short-Term Disability, Long-Term Disability ONLY.`,
        `  ALLSTATE = Group Whole Life (Permanent), Accident Insurance, Critical Illness ONLY.`,
        `  BCBSTX   = Medical (Standard HSA, Enhanced HSA) and Dental PPO ONLY.`,
        `  VSP      = Vision ONLY.`,
        `  KAISER   = Medical HMO — CA/GA/OR/WA ONLY. ${kaiserRule}`,
        ``,
        `BANNED entities — NEVER mention these in any response:`,
        `  - "Rightway" / "RightWay" / "Right Way" — NOT an AmeriVet carrier or resource.`,
        `  - "DHMO" — AmeriVet does NOT offer a DHMO dental plan. Only BCBSTX Dental PPO.`,
        `  - "PPO" as a medical plan name — AmeriVet medical plans are "Standard HSA" and "Enhanced HSA" (they use BCBSTX PPO network, but the plans are NOT called "PPO").`,
        `  - Phone number (305) 851-7310 — this is NOT an AmeriVet number.`,
        `</Carrier_Lock>`,
        ``,
        `<Catalog_Rules>`,
        `1. STRICTLY FORBIDDEN: Do not ask for age or state — they are confirmed above.`,
        `2. Answer ONLY from the catalog below. Never invent plans, premiums, or benefit types not listed.`,
        `3. If the user asks about a benefit NOT in the catalog, say: "That benefit isn't part of AmeriVet's package." then list what IS available.`,
        `4. Always show premiums as "$X.XX/month ($Y.YY bi-weekly)".`,
        `5. Rate frequency: quote ONLY as monthly or per-paycheck (bi-weekly). Never say "annual" for premiums.`,
        `6. WHY → prose paragraphs. WHAT → markdown tables. Never mix.`,
        `7. Default stance: inform first, do not pressure, but proactively help the user decide what to consider next.`,
        `8. After each benefit topic, proactively transition: e.g. after medical → offer Dental/Vision or the next useful benefit topic.`,
        `9. When the user explicitly asks for your opinion or what they should choose, give a recommendation if enough context exists.`,
        `10. If one missing factor would materially change the recommendation, ask exactly ONE focused clarifying question, then recommend.`,
        `11. End every substantive reply with a useful next-step prompt, not a dead end.`,
        `12. Enrollment link to append to every substantive reply: ${WORKDAY_ENROLLMENT_URL}`,
        `13. Direct Refusal: If user asks "Which is best?" without providing usage level (Low/Moderate/High), ask for it before answering.`,
        `14. For "contact" / "support" / "help" queries, direct users to HR/Benefits team ONLY — NOT to Rightway.`,
        `15. IRS COMPLIANCE (Pub 969): If user mentions spouse + FSA + HSA in any context, you MUST warn that a general-purpose Healthcare FSA disqualifies HSA contributions. The ONLY workaround is a Limited Purpose FSA (LPFSA) covering dental/vision only. NEVER show HSA contribution details without this warning when spouse FSA is mentioned.`,
        `16. STD ≠ Medical Cost: "How much will I get paid on leave?" is an STD/income question (UNUM, 60% salary). "What are maternity costs?" is a medical plan question (deductible, OOP). NEVER conflate these two intents.`,
        `</Catalog_Rules>`,
        ``,
        catalogText,
      ].join('\n');
    };

    const ensureEligibility = async (): Promise<NextResponse | null> => {
      const metadata = conversation.metadata ?? {};
      const awaiting = metadata.awaiting as 'name' | 'age' | 'state' | 'division' | undefined | null;
      const normalizedMessage = message.trim().toLowerCase();
      const explicitStateCorrection = detectExplicitStateCorrection(
        message,
        typeof metadata.state === 'string' ? metadata.state : null,
      );

      // Step 1: Welcome and ask for name (only for brand new conversations)
      if (!metadata.userName && !awaiting) {
        const updated = await conversationService.patchMetadata(conversation.id, { awaiting: 'name' });
        conversation.metadata = updated.metadata ?? {};
        return sendEligibilityMessage(
          "Hi! 👋 I'm your AmeriVet Benefits Assistant. My goal is to make this easy, friendly, and stress-free so you feel confident in your choices.\n\nℹ️ **Heads-up**: I'm here to help you understand your options, think through what fits best, and decide what to consider next. You'll make your official selections later in your company's enrollment system.\n\nLet's begin—what's your first name?"
        );
      }

      // Step 2: Capture name and ask for age
      if (!metadata.userName && metadata.awaiting === 'name') {
        const userName = message.trim();
        if (!userName || userName.length < 2) {
          return sendEligibilityMessage("I didn't quite catch that. What's your first name?");
        }
        
        const updated = await conversationService.patchMetadata(conversation.id, {
          userName,
          awaiting: 'age'
        });
        conversation.metadata = updated.metadata ?? {};
        return sendEligibilityMessage(
          `Nice to meet you, ${userName}! 😊\n\nTo tailor the guidance, how old are you? (Just the number in years is perfect)`
        );
      }

      // Step 3: Capture age and ask for state
      if (metadata.userName && !metadata.userAge && metadata.awaiting === 'age') {
        const ageMatch = message.match(/\d+/);
        if (!ageMatch) {
          return sendEligibilityMessage("Please enter your age as a number (for example: 35)");
        }
        
        const userAge = parseInt(ageMatch[0]);
        if (userAge < 18 || userAge > 100) {
          return sendEligibilityMessage("Please enter a valid age between 18 and 100.");
        }

        const updated = await conversationService.patchMetadata(conversation.id, {
          userAge,
          awaiting: 'state'
        });
        conversation.metadata = updated.metadata ?? {};
        return sendEligibilityMessage(
          `Thanks, ${metadata.userName}!\n\nWhich state do you live in? That helps me show what's available in your area.`
        );
      }

      if (metadata.state && metadata.division && !awaiting) {
        if (explicitStateCorrection) {
          const correctedState = explicitStateCorrection.state.toUpperCase();
          const updated = await conversationService.patchMetadata(conversation.id, {
            state: correctedState,
            ...(explicitStateCorrection.city ? { userCity: explicitStateCorrection.city } : {}),
            lastEligibilityResetAt: new Date().toISOString(),
            eligibilityConfirmedAt: new Date().toISOString(),
          });
          conversation.metadata = updated.metadata ?? {};

          const currentTopic = typeof conversation.metadata?.currentTopic === 'string'
            ? conversation.metadata.currentTopic
            : undefined;

          if (currentTopic) {
            const correctedTopicResponse = buildCategoryExplorationResponse({
              queryLower: currentTopic.toLowerCase(),
              session: buildDeterministicChatSession(conversation.metadata, [], currentTopic),
              coverageTier: getCoverageTierForQuery(`${currentTopic} ${message}`, buildDeterministicChatSession(conversation.metadata, [], currentTopic)),
              enrollmentPortalUrl: WORKDAY_ENROLLMENT_URL,
              hrPhone: HR_PHONE,
            });

            if (correctedTopicResponse) {
              return sendAssistantMessage(
                `Thanks for the correction — I updated your state to ${correctedState}. Here’s the updated ${currentTopic.toLowerCase()} view:\n\n${correctedTopicResponse}`,
                {
                  currentTopic,
                  lastBotMessage: toPlainAssistantText(correctedTopicResponse),
                },
              );
            }
          }

          return sendAssistantMessage(
            `Thanks for the correction — I updated your state to ${correctedState}. What would you like to look at next?`,
            {
              lastBotMessage: `Thanks for the correction — I updated your state to ${correctedState}. What would you like to look at next?`,
            },
          );
        }
        if (isStateChangeRequest(normalizedMessage)) {
          const updated = await conversationService.patchMetadata(conversation.id, {
            state: undefined,
            awaiting: 'state',
            lastEligibilityResetAt: new Date().toISOString()
          });
          conversation.metadata = updated.metadata ?? {};
          return sendEligibilityMessage(
            'Thanks for letting me know. I cleared the eligibility assumptions, so we can start over. What state are you in now?'
          );
        }
        if (isDivisionChangeRequest(normalizedMessage)) {
          const updated = await conversationService.patchMetadata(conversation.id, {
            division: undefined,
            awaiting: 'division',
            lastEligibilityResetAt: new Date().toISOString()
          });
          conversation.metadata = updated.metadata ?? {};
          return sendEligibilityMessage(
            'Understood. I cleared the eligibility assumptions. Which division or department are you in now?'
          );
        }
      }

      if (!metadata.state) {
        if (metadata.awaiting !== 'state') {
          const updated = await conversationService.patchMetadata(conversation.id, { awaiting: 'state' });
          conversation.metadata = updated.metadata ?? {};
          const greeting = metadata.userName ? `${metadata.userName}, which` : 'Which';
          return sendEligibilityMessage(`${greeting} state are you in? This helps me show location-specific benefits.`);
        }

        const trimmedState = message.trim();
        if (!trimmedState) {
          return sendEligibilityMessage("I didn't catch that. What state are you in? (You can also say a city, like 'Chicago')");
        }

        // Deterministic city-to-state resolution — never asks the LLM.
        const locationSlots = extractUserSlots(trimmedState);
        const resolvedState = locationSlots.state ?? trimmedState;
        const resolvedCity  = locationSlots.city  ?? undefined;

        const needsDivision = !metadata.division;
        const statePatch: Record<string, any> = {
          state: resolvedState,
          ...(resolvedCity ? { userCity: resolvedCity } : {}),
          awaiting: needsDivision ? 'division' : null
        };
        if (!needsDivision) {
          statePatch.eligibilityConfirmedAt = new Date().toISOString();
        }

        const updated = await conversationService.patchMetadata(conversation.id, statePatch);
        conversation.metadata = updated.metadata ?? {};
        if (needsDivision) {
          const userName = metadata.userName ? metadata.userName : 'there';
          return sendEligibilityMessage(
            `Perfect, ${userName}! Last question: what's your company division or department? (e.g., Sales, Engineering, Operations)`
          );
        }

        return null;
      }

      if (!metadata.division) {
        if (metadata.awaiting !== 'division') {
          const updated = await conversationService.patchMetadata(conversation.id, { awaiting: 'division' });
          conversation.metadata = updated.metadata ?? {};
          return sendEligibilityMessage('What is your company division or department?');
        }

        const trimmedDivision = message.trim();
        if (!trimmedDivision) {
          return sendEligibilityMessage('I didn’t catch that. Which division or department are you in?');
        }

        const updated = await conversationService.patchMetadata(conversation.id, {
          division: trimmedDivision,
          awaiting: null,
          eligibilityConfirmedAt: new Date().toISOString()
        });
        conversation.metadata = updated.metadata ?? {};
        
        // Send personalized welcome after collecting all info
        const userName = metadata.userName || 'there';
        const userAge = metadata.userAge;
        const ageContext = userAge ? ` At ${userAge}, you` : ' You';
        const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || process.env.NEXT_PUBLIC_ENROLLMENT_URL || WORKDAY_ENROLLMENT_URL;
        const enrollmentCta = `\n\n📋 **When you're ready to enroll**: [${enrollmentUrl}](${enrollmentUrl})`;
        
        return sendEligibilityMessage(
            `Awesome, ${userName}! 🎉\n\nGreat, I have what I need:
• Name: ${userName}
• Age: ${userAge || 'Not specified'}
• Location: ${metadata.state}
• Department: ${trimmedDivision}

        ${ageContext} may be eligible for health, dental, vision, and retirement benefits in ${metadata.state}.\n\nI'm here to keep things simple, friendly, and useful so you feel confident in your choices.\n\n**What would you like to look at first?**
• Medical plans (Standard HSA, Enhanced HSA${metadata.state && KAISER_ELIGIBLE_STATES.has(metadata.state) ? ', Kaiser HMO' : ''})
• Dental (BCBSTX PPO) & Vision (VSP)
• Critical Illness, Accident, or Hospital Indemnity
• Life Insurance & Disability (Unum)
• Retirement (401k) options${enrollmentCta}`
        );
      }

      // If user provided free-text onboarding details, parse and patch without re-asking.
      // extractAndResolveSlots uses the full city-to-state truth table.
      const parsed = extractAndResolveSlots(message);
      const patch: Record<string, any> = {};
      if (parsed.name     && !metadata.userName) patch.userName = parsed.name;
      if (parsed.age      && !metadata.userAge)  patch.userAge  = parsed.age;
      if (parsed.state    && !metadata.state)    patch.state    = parsed.state;
      if (parsed.city     && !metadata.userCity) patch.userCity = parsed.city;
      if (parsed.division && !metadata.division) patch.division = parsed.division;
      if (Object.keys(patch).length) {
        patch.awaiting = null;
        const updated = await conversationService.patchMetadata(conversation.id, patch);
        conversation.metadata = { ...(conversation.metadata || {}), ...(updated.metadata || {}) };
      }
      return null;
    };

    if (process.env.NODE_ENV !== 'test') {
      const eligibilityResponse = await ensureEligibility();
      if (eligibilityResponse) {
        return eligibilityResponse;
      }
    }

    // --- Early intent interceptors before routing ---
    const normalizedMessage = message.trim().toLowerCase();
    const supportOnlyIntent = isSupportOnlyIntent(normalizedMessage);
    const comparisonNoPricingIntent = isNoPricingComparisonIntent(normalizedMessage);
    const faqAnswer = checkL1FAQ(message, {
      enrollmentPortalUrl: WORKDAY_ENROLLMENT_URL,
      hrPhone: HR_PHONE,
    });

    // =========================================================================
    // L1 INTERCEPT: FAQ / support / regional availability queries
    // Keep these deterministic so chat and QA do not drift on static answers.
    // =========================================================================
    if (faqAnswer) {
      return sendAssistantMessage(faqAnswer);
    }

    const scopeGuardAnswer = buildScopeGuardResponse(message, {
      enrollmentPortalUrl: WORKDAY_ENROLLMENT_URL,
      hrPhone: HR_PHONE,
    });
    if (scopeGuardAnswer) {
      return sendAssistantMessage(scopeGuardAnswer);
    }

    // =========================================================================
    // L1 INTERCEPT: PPO clarification
    // AmeriVet does not offer a standalone medical PPO plan. Handle this before
    // any routed/model path so chat and QA agree on the same clarification.
    // =========================================================================
    if (isStandaloneMedicalPpoRequest(normalizedMessage)) {
      const userState = typeof conversation.metadata?.state === 'string'
        ? conversation.metadata.state.toUpperCase()
        : undefined;
      const followUp = userState && KAISER_ELIGIBLE_STATES.has(userState)
        ? 'Would you like to compare the available medical plans?'
        : 'Would you like to see a comparison of the Standard HSA vs. Enhanced HSA?';
      return sendAssistantMessage(`${buildPpoClarificationForState(userState)}\n\n${followUp}`);
    }

    // Medical Loop Fix (Sprint 1.2): "other plans" should not loop to medical
    const otherPlansRegex = /(what|which)?\s*(other|else)\s*(plans|benefits)/i;
    if (otherPlansRegex.test(normalizedMessage)) {
      return sendAssistantMessage(
        `Great question! Beyond medical, many employees also explore:
• Dental & Vision coverage
• Life Insurance & Disability protection
• Critical Illness, Accident, and Hospital Indemnity

Which of these would you like to learn about next?`
      );
    }

    // Age-Banded Cost Safe Path (Sprint 3.1): CI / Life / Disability costs.
    // Only intercept when we DON'T have the user's age confirmed — once age is locked,
    // the Analyst prompt + Senior Strategist persona calculate Unum age-band rates directly.
    const costKeywords = /(how much|cost|price|quote|rate|premium|per month|per paycheck)/i;
    const ageBandedProducts = /(critical illness|ci|disability|short term disability|long term disability|std|ltd)/i;
    const ageConfirmed = !!(conversation.metadata?.userAge);
    if (!ageConfirmed && costKeywords.test(normalizedMessage) && ageBandedProducts.test(normalizedMessage)) {
      return sendAssistantMessage(
        `Thanks for asking! I just need your age to look up the exact premium for this age-rated product. How old are you?`
      );
    }

    // =========================================================================
    // L1 INTERCEPT: HSA / Spouse FSA — IRS Publication 969 Compliance
    // If a spouse has a general-purpose Healthcare FSA, the employee is
    // INELIGIBLE to contribute to an HSA. This is a hard IRS rule — intercept
    // BEFORE any LLM call to prevent incorrect HSA detail generation.
    // =========================================================================
    const hsaFsaSpouseConflict =
      /\bhsa\b/i.test(normalizedMessage) &&
      /\bspouse\b/i.test(normalizedMessage) &&
      /\b(general\s*[- ]?purpose\s*fsa|health\s*(?:care)?\s*fsa|medical\s*fsa|fsa)\b/i.test(normalizedMessage);

    if (hsaFsaSpouseConflict) {
      return sendAssistantMessage(
        `**IRS COMPLIANCE RULE (IRS Publication 969):** If your spouse is enrolled in a general-purpose Healthcare FSA, ` +
        `you are **NOT eligible** to contribute to an HSA for those same months. This is a hard IRS rule with no exceptions.\n\n` +
        `**The only workaround:** your spouse switches to a Limited Purpose FSA (LPFSA) that covers ONLY dental and vision — ` +
        `then your HSA eligibility is restored.\n\n` +
        `**Action order:**\n` +
        `1. Confirm your spouse's FSA type with their employer (general-purpose vs limited-purpose).\n` +
        `2. If general-purpose FSA: do NOT elect HSA contributions — you are ineligible.\n` +
        `3. If limited-purpose FSA: you may elect HSA contributions normally.\n` +
        `4. Make this determination BEFORE finalizing plan elections in Workday. You cannot retroactively correct excess HSA contributions without IRS penalty.\n\n` +
        `For enrollment: ${WORKDAY_ENROLLMENT_URL} | HR: ${HR_PHONE}`
      );
    }

    // =========================================================================
    // L1 INTERCEPT: Maternity / STD Leave Pay Timeline
    // Separates "leave pay" intent (STD at 60% salary) from "medical cost"
    // intent (deductible / OOP). Fires BEFORE any LLM call to prevent the
    // model from confusing STD income replacement with medical plan costs.
    // Uses deterministic calculateSTDBenefit() — no LLM math.
    // =========================================================================
    const stdLeavePayIntent = (
      /\b(maternity(?:\s+leave)?|parental\s+leave|fmla|leave\s+of\s+absence)\b/i.test(normalizedMessage) &&
      /\b(pay(?:check)?|paid|income|salary|money|how\s+much|week\s*\d*|6th\s+week|sixth\s+week|std|short\s*[- ]?term\s+disability|60%)\b/i.test(normalizedMessage)
    ) || (
      /\b(std|short\s*[- ]?term\s+disability)\b/i.test(normalizedMessage) &&
      /\b(maternity|leave|pay(?:check)?|paid|salary|60%|sixty\s*percent|week\s*\d+|6th\s+week|sixth\s+week|get\s+paid|income)\b/i.test(normalizedMessage)
    );

    if (stdLeavePayIntent) {
      const salaryMatch = normalizedMessage.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{4,6})\s*\/?\s*(?:month|mo)/);
      const salary = salaryMatch ? Number(salaryMatch[1].replace(/,/g, '')) : null;
      let mathLine: string;
      if (salary) {
        const std = calculateSTDBenefit(salary);
        mathLine = `With a salary of $${salary.toLocaleString()}/month:\n${formatSTDBenefit(std)}`;
      } else {
        mathLine = 'Share your monthly salary if you want a precise dollar calculation.';
      }
      return sendAssistantMessage(
        `**Leave Pay Timeline — Maternity / FMLA + UNUM STD:**\n\n` +
        `- **Weeks 1–2 (Elimination Period):** STD benefit is not yet active. Use PTO or this period may be unpaid, depending on your employer leave policy.\n` +
        `- **Weeks 3–6 (STD Active — UNUM):** UNUM pays 60% of your pre-disability base earnings. FMLA runs concurrently, providing job protection.\n` +
        `- **Weeks 7–8 (if physician-certified):** STD may continue through week 8 for vaginal delivery or week 10 for C-section, subject to claim approval.\n` +
        `- **FMLA (all 12 weeks):** Job-protected leave — FMLA does NOT supply pay on its own; income comes from STD and any PTO coordination.\n\n` +
        `**Key distinctions:**\n` +
        `- STD = income replacement (60% of base pay via UNUM).\n` +
        `- FMLA = job protection (federal law, concurrent with STD, unpaid on its own).\n` +
        `- Medical out-of-pocket costs (deductible, OOP max) are a **separate question** from leave pay.\n\n` +
        `${mathLine}\n\n` +
        `Verify elimination period, claim approval timeline, and PTO coordination in your UNUM STD certificate/SPD and Workday.`
      );
    }

    // ==========================================================================
    // STATE MACHINE: EXTRACT → PERSIST → GUARD → GATE → CACHE → ROUTE
    // ==========================================================================
    const started = Date.now();
    const useSmart = process.env.USE_SMART_ROUTER === 'true';
    const useRAG   = process.env.USE_RAG_ROUTER   === 'true';

    // 1. EXTRACT & PERSIST — deterministic; no LLM; resolves "Chicago" → "IL".
    const mapped = extractAndMapEntities(message);
    const slotPatch: Record<string, any> = {};
    if (mapped.slots.age   && !conversation.metadata?.userAge)  slotPatch.userAge  = mapped.slots.age;
    if (mapped.slots.state && !conversation.metadata?.state)    slotPatch.state    = mapped.slots.state;
    if (mapped.slots.city  && !conversation.metadata?.userCity) slotPatch.userCity = mapped.slots.city;
    if (Object.keys(slotPatch).length) {
      await conversationService.patchMetadata(conversation.id, slotPatch);
      // Apply new slots to in-memory metadata immediately using the known slotPatch values.
      // Do NOT rely on patchResult.metadata — Cosmos may return a partial or empty payload
      // in certain serverless / cold-start scenarios, causing context drift where the LLM
      // re-asks for state or age that was provided in THIS message.
      conversation.metadata = { ...(conversation.metadata ?? {}), ...slotPatch };
    }

    // 2. OUT-OF-CATALOG GUARD — intercept before any LLM call.
    if (mapped.isAboutBenefitNotInCatalog) {
      return sendAssistantMessage(
        `I'm sorry, but that benefit isn't part of the AmeriVet benefits package. ` +
        `AmeriVet offers: Medical (BCBSTX HSA plans + Kaiser HMO in CA/GA/OR/WA), ` +
        `Dental (BCBSTX PPO), Vision (VSP Plus), Life & Disability (Unum), ` +
        `and special accounts (HSA / FSA / Commuter). ` +
        `Which of these would you like to explore?`
      );
    }

    // 3. VALIDATION GATE — Collector prompt if slots incomplete, Analyst if full.
    const gateMeta = conversation.metadata ?? {};
    const slotsComplete = !!(gateMeta.userAge && gateMeta.state);
    const sessionHeader = buildLockedSessionMetadataHeader({
      userId,
      companyId,
      conversationId: conversation.id,
      metadata: gateMeta,
    });

    const intentGate = comparisonNoPricingIntent
      ? [
          '<Dynamic_Intent_Gate>',
          'Comparison intent detected.',
          'Provide structural features/coverage comparison only.',
          'Do not include dollar signs, premiums, or cost tables in this response.',
          '</Dynamic_Intent_Gate>',
        ].join('\n')
      : '';

    const validationGate = [
      sessionHeader,
      intentGate,
      slotsComplete ? constructAnalystPrompt(gateMeta) : constructCollectorPrompt(gateMeta),
    ].filter(Boolean).join('\n\n');

    // Derive primary benefit category from entity extraction (used for Azure Search filtering).
    // Maps benefitTypes like ['dental'] → 'Dental' to match INTENT_CATEGORY_MAP values.
    const BENEFIT_CATEGORY_MAP: Record<string, string> = {
      medical: 'Medical', health: 'Medical', dental: 'Dental', vision: 'Vision',
      life: 'Life', disability: 'Disability', hsa: 'Savings', fsa: 'Savings',
      voluntary: 'Voluntary', accident: 'Voluntary', critical: 'Voluntary',
    };
    let primaryCategory = mapped.benefitTypes.length > 0
      ? (BENEFIT_CATEGORY_MAP[mapped.benefitTypes[0]] ?? undefined)
      : undefined;

    const existingTopic = conversation.metadata?.currentTopic as string | undefined;
    const followUpMessage = isLikelyFollowUpMessage(normalizedMessage);
    if (!primaryCategory && existingTopic && followUpMessage) {
      primaryCategory = existingTopic;
    }

    // INTENT SWITCHER: STD / Leave-pay queries must search Disability docs, not Medical.
    // Without this, "how much will I get paid on maternity leave" searches Medical and
    // returns deductible/OOP data instead of the UNUM STD policy.
    const isSTDIntent =
      /\b(std|short\s*[- ]?term\s+disability|leave\s+pay|maternity\s+pay|fmla\s+pay|disability\s+pay)\b/i.test(normalizedMessage);
    if (isSTDIntent && (!primaryCategory || primaryCategory === 'Medical')) {
      primaryCategory = 'Disability';
    }

    const recentHistory: Array<{ role: 'user' | 'assistant'; content: string }> = (conversation.messages || [])
      .flatMap((m) => (m.role === 'user' || m.role === 'assistant')
        ? [{ role: m.role, content: m.content }]
        : [])
      .slice(-10);

    // Shared router context — injected into every LLM call as the "developer message".
    const conversationTopic = deriveConversationTopic({
      benefitTypes: mapped.benefitTypes,
      primaryCategory,
      existingTopic,
      normalizedMessage,
    });

    const qaSession = buildDeterministicChatSession(conversation.metadata, recentHistory, conversationTopic);
    const coverageTier = getCoverageTierForQuery(message, qaSession);
    const chatRoutePolicy = determineChatRoutePolicy({
      lowerQuery: normalizedMessage,
      benefitTypes: mapped.benefitTypes,
      mappedIntent: mapped.intent ?? null,
      slotsComplete,
      useRagOverride: useRAG,
      useSmartOverride: useSmart,
    });
    const { intentDomain } = chatRoutePolicy;

    const categoryExplorationIntercept = shouldUseCategoryExplorationIntercept(message, normalizedMessage, intentDomain)
      ? buildCategoryExplorationResponse({
          queryLower: normalizedMessage,
          session: qaSession,
          coverageTier,
          enrollmentPortalUrl: WORKDAY_ENROLLMENT_URL,
          hrPhone: HR_PHONE,
        })
      : null;
    if (categoryExplorationIntercept) {
      const nextTopic = primaryCategory || conversationTopic || conversation.metadata?.currentTopic || null;
      return sendAssistantMessage(categoryExplorationIntercept, {
        currentTopic: nextTopic,
        completedTopics: mergeCompletedTopics(conversation.metadata?.completedTopics, nextTopic),
        lastBotMessage: toPlainAssistantText(categoryExplorationIntercept),
      });
    }

    const recommendationOverview = buildRecommendationOverview(message, qaSession);
    if (recommendationOverview) {
      const nextTopic = conversationTopic || conversation.metadata?.currentTopic || null;
      return sendAssistantMessage(recommendationOverview, {
        currentTopic: nextTopic,
        completedTopics: mergeCompletedTopics(conversation.metadata?.completedTopics, nextTopic),
        lastBotMessage: toPlainAssistantText(recommendationOverview),
      });
    }

    const routerContext = {
      userAge:  gateMeta.userAge as number | undefined,
      state:    gateMeta.state  as string | undefined,
      division: gateMeta.division as string | undefined,
      category: primaryCategory,
      currentTopic: conversationTopic,
      lastBotMessage: conversation.metadata?.lastBotMessage as string | undefined,
      intent:   mapped.intent,
      validationGate,
      history: recentHistory,
    };

    // 4. CACHE CHECK — L0 exact + L1 semantic before any LLM call.
    let routeSource: 'cache-exact' | 'cache-semantic' | 'rag-doc' | 'rag-fallback' | 'smart' | 'simple' = 'simple';
    if (slotsComplete) {
      const cacheResult = await tryCache(message, companyId, gateMeta.state as string | undefined);
      if (cacheResult.hit) {
        routeSource = cacheResult.source; // 'cache-exact' | 'cache-semantic'
        const cachedAiMessage = {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: comparisonNoPricingIntent
            ? stripPricingForComparisonMode(cacheResult.content)
            : cacheResult.content,
          timestamp: new Date(),
        };
        await conversationService.addMessage(conversation.id, cachedAiMessage);
        try {
          await conversationService.patchMetadata(conversation.id, {
            currentTopic: conversationTopic || conversation.metadata?.currentTopic || null,
            lastBotMessage: cachedAiMessage.content,
          });
        } catch {}
        return NextResponse.json({
          message: cachedAiMessage,
          conversationId: conversation.id,
          route: 'cached',
          model: 'cache',
          latencyMs: Date.now() - started,
          source: routeSource,
          chunksUsed: 0,
        });
      }
    }

    // 5. ROUTE — safe to reference mapped + slotsComplete (both declared above).
    const { shouldUseRag: shouldUseRAG, shouldUseSmart } = chatRoutePolicy;
    let routed;
    let modelUsed: 'simple' | 'smart' | 'rag' = 'simple';
    let ragChunksUsed = 0;

    if (shouldUseRAG) {
      try {
        routed = await ragChatRouter.routeMessage(userMessage.content, {
          companyId,
          ...routerContext,
        });
        modelUsed = 'rag';
        ragChunksUsed = (routed as any).metadata?.chunksUsed ?? 0;
        // Distinguish: did we retrieve real docs, or fall back to the safe hand-off response?
        routeSource = (routed as any).responseType === 'rag' && ragChunksUsed > 0
          ? 'rag-doc'
          : 'rag-fallback';
        logger.info('[Router] RAG path', { intentDomain, ragChunksUsed, routeSource });
      } catch (err) {
        logger.warn('RAG router failed, falling back to smart/simple', { err });
      }
    }

    if (!routed && shouldUseSmart) {
      try {
        routed = await smartChatRouter.routeMessage(userMessage.content, {
          ...routerContext,
        });
        modelUsed = 'smart';
        routeSource = 'smart';
      } catch (err) {
        logger.warn('SmartChatRouter failed, falling back to simple', { err });
      }
    }

    if (!routed) {
      routed = await simpleChatRouter.routeMessage(userMessage.content, {
        ...routerContext,
      });
      modelUsed = 'simple';
      routeSource = 'simple';
    }

    const latencyMs = Date.now() - started;

    // 6. POST-PROCESS — normalize rates, state consistency, cross-sell hints.
    // Issue #6 Fix: Enforce state consistency in responses
    let enhancedContent = normalizeRatesInText(routed.content); // Fix #3: normalize all rates before they reach the user
    const userState = conversation.metadata?.state;
    if (userState) {
      const { ensureStateConsistency, cleanRepeatedPhrases } = require('@/lib/rag/pricing-utils');
      enhancedContent = ensureStateConsistency(enhancedContent, userState);
      enhancedContent = cleanRepeatedPhrases(enhancedContent);
    }

    if (comparisonNoPricingIntent) {
      enhancedContent = stripPricingForComparisonMode(enhancedContent);
    }

    // =========================================================================
    // L3 CARRIER LOCK VALIDATION — deterministic post-processing gates
    // These run AFTER every LLM response, regardless of route (RAG/smart/simple).
    // =========================================================================

    // L3.1: RIGHTWAY STRIP — sentence-level removal of banned terms
    enhancedContent = normalizeStaticBenefitAnswer(enhancedContent);
    if (isRightwayQuery(message)) {
      enhancedContent = checkL1FAQ('rightway', {
        enrollmentPortalUrl: WORKDAY_ENROLLMENT_URL,
        hrPhone: HR_PHONE,
      }) || buildLiveSupportFallback(WORKDAY_ENROLLMENT_URL, HR_PHONE);
    }

    const L3_BANNED_TERMS_RE = /rightway|right\s*way/i;
    const L3_BANNED_PHONE_RE = /\(?\s*305\s*\)?\s*[-.]?\s*851\s*[-.]?\s*7310/g;
    if (L3_BANNED_TERMS_RE.test(enhancedContent)) {
      logger.warn('[L3] Stripped Rightway reference from response');
      enhancedContent = enhancedContent
        .split(/(?<=[.!?\n])/)
        .filter(sentence => !L3_BANNED_TERMS_RE.test(sentence))
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (enhancedContent.length < 20) {
        enhancedContent = buildLiveSupportFallback(WORKDAY_ENROLLMENT_URL, HR_PHONE);
      }
    }
    enhancedContent = enhancedContent.replace(L3_BANNED_PHONE_RE, `AmeriVet HR/Benefits at ${HR_PHONE}`);

    // L3.2: CARRIER MISATTRIBUTION GUARD — fix wrong carrier assignments
    const L3_CARRIER_RULES: Array<{ pattern: RegExp; fix: string }> = [
      { pattern: /allstate\s+(?:voluntary\s+)?term\s+life/gi, fix: 'Unum Voluntary Term Life' },
      { pattern: /unum\s+whole\s+life/gi, fix: 'Allstate Whole Life' },
      { pattern: /unum\s+(?:voluntary\s+)?accident(?:\s+insurance)?/gi, fix: 'Allstate Accident Insurance' }, // Fix 31 — Accident = Allstate only
      { pattern: /unum\s+critical\s+illness/gi, fix: 'Allstate Critical Illness' },                          // Fix 31 — Critical Illness = Allstate only
      { pattern: /bcbstx?\s+(?:life|disability|accident|critical)/gi, fix: '' }, // strip entirely
    ];
    for (const rule of L3_CARRIER_RULES) {
      if (rule.fix) {
        enhancedContent = enhancedContent.replace(rule.pattern, rule.fix);
      } else {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(enhancedContent)) {
          logger.warn('[L3] Stripped misattributed carrier sentence');
          enhancedContent = enhancedContent.split(/(?<=[.!?\n])/).filter(s => !rule.pattern.test(s)).join('').trim();
        }
      }
    }

    // L3.3: PPO HALLUCINATION GUARD — no "PPO" medical plan exists
    const L3_PPO_MEDICAL = /\b(?:BCBSTX?\s+PPO|PPO\s+(?:Standard|plan|medical)|medical\s+PPO)\b/gi;
    if (L3_PPO_MEDICAL.test(enhancedContent) && !/dental\s+ppo/i.test(enhancedContent.match(L3_PPO_MEDICAL)?.[0] || '')) {
      logger.warn('[L3] Corrected hallucinated PPO medical plan reference');
      enhancedContent = enhancedContent.replace(L3_PPO_MEDICAL, 'Standard HSA/Enhanced HSA (PPO network)');
    }

    // L3.4: DHMO GUARD — AmeriVet does NOT offer a DHMO dental plan
    const L3_DHMO_RE = /\bDHMO\b/gi;
    if (L3_DHMO_RE.test(enhancedContent)) {
      logger.warn('[L3] Stripped hallucinated DHMO reference');
      enhancedContent = enhancedContent.replace(L3_DHMO_RE, 'BCBSTX Dental PPO');
    }

    // L3.5: KAISER GEOGRAPHIC GUARD — Kaiser only where the catalog allows it
    const kaiserApplicable = userState && KAISER_ELIGIBLE_STATES.has(userState);
    if (!kaiserApplicable && /\bkaiser\b/i.test(enhancedContent)) {
      logger.warn(`[L3] Stripped Kaiser reference for non-eligible state: ${userState}`);
      enhancedContent = enhancedContent
        .split(/(?<=[.!?\n])/)
        .filter(sentence => !/\bkaiser\b/i.test(sentence))
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // L3.6: NO-PRICING ENFORCEMENT — deterministic $ strip when user asked no prices
    const noPricingSignals = /(not asking for (?:rates|prices|costs|pricing)|skip (?:costs|prices|pricing)|no pric(?:es|ing)|just features|don'?t (?:need|want) (?:prices|rates|costs))/i;
    const noPricingMode = conversation.metadata?.noPricingMode === true ||
      noPricingSignals.test(normalizedMessage);
    if (noPricingMode) {
      // Persist noPricingMode for future messages in this conversation
      if (!conversation.metadata?.noPricingMode) {
        conversationService.patchMetadata(conversation.id, { noPricingMode: true }).catch(() => {});
      }
      // Remove lines containing dollar amounts
      enhancedContent = enhancedContent.split('\n').filter(line => !/\$\d/.test(line)).join('\n');
      // Remove inline dollar mentions
      enhancedContent = enhancedContent.replace(/\$[\d,]+\.?\d{0,2}(?:\/(?:month|year|mo|yr|paycheck|pay period|bi-?weekly?))?/gi, '[see portal for pricing]');
      enhancedContent = enhancedContent.replace(/\[see portal for pricing\](?:\s*\([^)]*\))?/g, '[see portal for pricing]');
      logger.debug('[L3] Stripped pricing from response (noPricingMode)');
    }

    // L3.7: SOURCE CITATION STRIP — remove [Source N] / [Doc N] artifacts
    enhancedContent = enhancedContent.replace(/\[(?:Source|Doc(?:ument)?|Ref(?:erence)?)\s*\d+\]/gi, '').replace(/\s{2,}/g, ' ').trim();

    // 7. WRITE CACHE — persist this fresh answer so next identical/similar query is free.
    if (slotsComplete && enhancedContent.length > 80) {
      const groundingScore = (routed as any).confidence ?? 0.75;
      writeCache(
        message,
        enhancedContent,
        companyId,
        gateMeta.state as string | undefined,
        groundingScore,
      ).catch(err => logger.warn('[Router] writeCache failed (non-fatal)', { err }));
    }

    const hsaTriggers = ['hsa', 'high deductible', 'health savings', 'hdhp', 'high-deductible'];
    const mentionsHSA = hsaTriggers.some(trigger => normalizedMessage.includes(trigger));
    
    if (mentionsHSA && !conversation.metadata?.hsaCrossSellShown) {
      enhancedContent += `\n\n💡 **Smart Tip**: Since you're considering an HSA or High Deductible plan, I highly recommend also looking at:\n\n• **Critical Illness Insurance** - Pays cash if diagnosed with a major illness\n• **Accident Insurance** - Covers unexpected injuries\n• **Hospital Indemnity** - Pays you cash for hospital stays\n\nThese plans can help you cover your deductible and out-of-pocket costs! Would you like to learn more about any of these?`;
      
      // Mark that we've shown the HSA cross-sell to avoid repeating
      await conversationService.patchMetadata(conversation.id, { hsaCrossSellShown: true });
    }

    // Topic Transitions (Sprint 2.4)
    const medicalTopicComplete = normalizedMessage.match(/(selected|choosing|pick|going with|decided on).*(medical|plan|hsa|ppo|hmo)/i);
    if (medicalTopicComplete && !conversation.metadata?.suggestedOtherBenefits) {
      enhancedContent += `\n\n---\n\n✨ **What's next?** Now that we've covered medical, would you like to discuss:\n• Dental & Vision coverage\n• Life Insurance & Disability protection\n• Critical Illness or Accident insurance\n• Retirement planning (401k)\n\nJust let me know what interests you!`;
      
      await conversationService.patchMetadata(conversation.id, { suggestedOtherBenefits: true });
    }

    // Final Recommendation Prompt (Sprint 2.3)
    const asksForRecommendation = normalizedMessage.match(/(what.*recommend|which.*should|help.*choose|best.*for me)/i);
    if (asksForRecommendation && !enhancedContent.includes('my recommendation')) {
      enhancedContent += `\n\n**Would you like my official recommendation** based on what you've told me (${conversation.metadata?.userName || 'your'} situation in ${conversation.metadata?.state || 'your state'})? I can help you narrow it down!`;
    }

    // Enrollment Portal CTA (Sprint 2.5) - Add to end of substantive responses
    const isSubstantiveResponse = enhancedContent.length > 200;
    // Transition guard: don't append transitions during onboarding
    const onboardingActive = !!conversation.metadata?.awaiting;
    if (!onboardingActive) {
      const resolvedEnrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || process.env.NEXT_PUBLIC_ENROLLMENT_URL || WORKDAY_ENROLLMENT_URL;
    if (isSubstantiveResponse && !conversation.metadata?.enrollmentLinkShown && normalizedMessage.match(/(enroll|sign up|how do i|where do i|ready to)/i)) {
      enhancedContent += `\n\n---\n\n📝 **Ready to make it official?** Finalize your selections at: [${WORKDAY_ENROLLMENT_URL}](${resolvedEnrollmentUrl})`;
      await conversationService.patchMetadata(conversation.id, { enrollmentLinkShown: true });
      }
    }

    // Backend seed greeting: prepend once per conversation
    const seedShown = conversation.metadata?.seedGreetingShown === true;
    if (!seedShown) {
      const greeting = "Hi! 👋 Welcome! I'm your Benefits Assistant. I'll keep this friendly and easy so you feel confident about your benefits.\n\nℹ️ You'll make official selections in your company's enrollment system—I'm here to help you understand and decide. How can I help today?";
      enhancedContent = `${greeting}\n\n${enhancedContent}`;
      try {
        await conversationService.patchMetadata(conversation.id, { seedGreetingShown: true });
      } catch {}
    }

    enhancedContent = toPlainAssistantText(enhancedContent);

    // Save AI response
    const aiMessage = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: enhancedContent,
      timestamp: new Date()
    };

    await conversationService.addMessage(conversation.id, aiMessage);

    try {
      await conversationService.patchMetadata(conversation.id, {
        currentTopic: conversationTopic || conversation.metadata?.currentTopic || null,
        lastBotMessage: enhancedContent,
      });
    } catch {}

    // Track analytics for user satisfaction monitoring
    try {
      trackEnhancedChatResponse(
        userId,
        conversation.id,
        message,
        enhancedContent,
        modelUsed,
        latencyMs,
        {
          issue1_pricingConsistent: true, // Always applied now
          issue2_categoryFiltered: !!conversation.metadata?.state, // Applied when state exists
          issue6_stateConsistent: !!conversation.metadata?.state, // Applied when state exists
          issue7_validationPassed: modelUsed === 'rag' // Only for RAG router
        }
      );
    } catch (trackingError) {
      logger.warn('Analytics tracking failed', { error: trackingError });
      // Don't fail the request if tracking fails
    }

    return NextResponse.json({
      message: aiMessage,
      conversationId: conversation.id,
      route: routed.responseType,
      model: modelUsed,
      latencyMs,
      source: routeSource,      // 'cache-exact' | 'cache-semantic' | 'rag-doc' | 'rag-fallback' | 'smart' | 'simple'
      chunksUsed: ragChunksUsed, // > 0 means Azure Search docs were retrieved
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 }
      );
    }

    logger.error('Chat error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Chat processing failed' }, { status: 500 });
  }
});
