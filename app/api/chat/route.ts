export const dynamic = 'force-dynamic';

// Hard-coded enrollment portal — source of truth for all CTA links.
const WORKDAY_ENROLLMENT_URL = 'https://wd5.myworkday.com/amerivet/login.htmld';

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, PERMISSIONS } from '@/lib/auth/unified-auth';

import { simpleChatRouter } from '@/lib/services/simple-chat-router';
import { smartChatRouter } from '@/lib/services/smart-chat-router';
import { ragChatRouter } from '@/lib/services/rag-chat-router';
import { trackEnhancedChatResponse } from '@/lib/analytics/tracking';

import { conversationService } from '@/lib/services/conversation-service';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { extractUserSlots, extractAndMapEntities } from '@/lib/rag/query-understanding';
import { cityToStateMap } from '@/lib/schemas/onboarding';
import { getCatalogForPrompt } from '@/lib/data/amerivet';
import { normalizeRatesInText } from '@/lib/utils/formatRates';
import { tryCache, writeCache } from '@/lib/services/cache-router';

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

    conversation ??= await conversationService.createConversation(
      userId,
      companyId
    );

    // Save user message to conversation
    await conversationService.addMessage(conversation.id, userMessage);

    // Helper to send a normal assistant message (non-eligibility)
    const sendAssistantMessage = async (content: string): Promise<NextResponse> => {
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
      const catalogText = getCatalogForPrompt(meta.state as string | null);
      const stateCode = (meta.state as string | null) ?? 'UNKNOWN';
      const kaiserRule = stateCode === 'CA'
        ? 'Kaiser HMO is AVAILABLE in California — include it in medical comparisons.'
        : `Kaiser HMO is NOT available in ${stateCode} — NEVER mention Kaiser as an option.`;
      return [
        `ANALYST MODE — STRICT GROUNDING RULES (non-negotiable):`,
        ``,
        `━━━ USER_PROFILE (LOCKED — NEVER re-ask any of these fields) ━━━`,
        `Name    : ${meta.userName ?? 'unknown'}`,
        `Age     : ${meta.userAge ?? 'unknown'}`,
        `State   : ${stateCode}${meta.userCity ? ` (city: ${meta.userCity})` : ''}`,
        `Division: ${meta.division ?? 'unknown'}`,
        ``,
        `━━━ GEOGRAPHIC RULES ━━━`,
        kaiserRule,
        ``,
        `━━━ INTENT SENSITIVITY ━━━`,
        `If the user says any variant of "not asking for rates", "skip costs", "no prices", or "just features":`,
        `  → Suppress ALL dollar signs and premium tables. Switch to Features & Coverage comparison only.`,
        ``,
        `━━━ CARRIER LOCK (immutable — do NOT re-assign any carrier to a different product) ━━━`,
        `  UNUM     = Basic Life & AD&D, Voluntary Term Life, Short-Term Disability, Long-Term Disability ONLY.`,
        `  ALLSTATE = Group Whole Life (Permanent), Accident, Critical Illness ONLY.`,
        `  BCBSTX   = Medical (Standard HSA, Enhanced HSA) and Dental PPO ONLY.`,
        `  VSP      = Vision ONLY.`,
        `  KAISER   = Medical HMO — CA/OR/WA ONLY. ` + kaiserRule,
        `  RIGHTWAY = NOT an AmeriVet carrier — NEVER mention Rightway.`,
        ``,
        `━━━ CATALOG GROUNDING RULES ━━━`,
        `1. STRICTLY FORBIDDEN: Do not ask for age or state — they are confirmed above.`,
        `2. Answer ONLY from the catalog below. Never invent plans, premiums, or benefit types not listed.`,
        `3. If the user asks about a benefit NOT in the catalog, say: "That benefit isn't part of AmeriVet's package." then list what IS available.`,
        `4. Always show premiums as "$X.XX/month ($Y.YY bi-weekly)".`,
        `5. Rate frequency: quote ONLY as monthly or per-paycheck (bi-weekly). Never mix frequencies in the same reply.`,
        `6. WHY → prose paragraphs. WHAT → markdown tables. Never mix.`,
        `7. After each benefit topic, proactively transition: e.g. after medical → offer Dental/Vision.`,
        `8. Enrollment link to append to every substantive reply: ${WORKDAY_ENROLLMENT_URL}`,
        `9. Direct Refusal: If user asks "Which is best?" without providing usage level (Low/Moderate/High), ask for it before answering.`,
        ``,
        catalogText,
      ].join('\n');
    };

    const ensureEligibility = async (): Promise<NextResponse | null> => {
      const metadata = conversation.metadata ?? {};
      const awaiting = metadata.awaiting as 'name' | 'age' | 'state' | 'division' | undefined | null;
      const normalizedMessage = message.trim().toLowerCase();

      // Step 1: Welcome and ask for name (only for brand new conversations)
      if (!metadata.userName && !awaiting) {
        const updated = await conversationService.patchMetadata(conversation.id, { awaiting: 'name' });
        conversation.metadata = updated.metadata ?? {};
        return sendEligibilityMessage(
          "Hi! 👋 I'm Susie, your AmeriVet Benefits Assistant. My goal is to make this easy, friendly, and stress-free so you feel confident in your choices.\n\nℹ️ **Heads-up**: I'm here to help you learn and decide. You'll make your official selections later in your company's enrollment system.\n\nLet's begin—what's your first name?"
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
• Medical plans (PPO, HMO, HSA options)
• Dental & Vision coverage
• Critical Illness, Accident, or Hospital Indemnity
• Life Insurance & Disability
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
      const patchResult = await conversationService.patchMetadata(conversation.id, slotPatch);
      conversation.metadata = { ...(conversation.metadata ?? {}), ...(patchResult.metadata ?? {}) };
    }

    // 2. OUT-OF-CATALOG GUARD — intercept before any LLM call.
    if (mapped.isAboutBenefitNotInCatalog) {
      return sendAssistantMessage(
        `I'm sorry, but that benefit isn't part of the AmeriVet benefits package. ` +
        `AmeriVet offers: Medical (BCBSTX HSA plans + Kaiser HMO in CA/OR/WA), ` +
        `Dental (BCBSTX PPO), Vision (VSP Plus), Life & Disability (Unum), ` +
        `and special accounts (HSA / FSA / Commuter). ` +
        `Which of these would you like to explore?`
      );
    }

    // 3. VALIDATION GATE — Collector prompt if slots incomplete, Analyst if full.
    const gateMeta = conversation.metadata ?? {};
    const slotsComplete = !!(gateMeta.userAge && gateMeta.state);
    const validationGate = slotsComplete
      ? constructAnalystPrompt(gateMeta)
      : constructCollectorPrompt(gateMeta);

    // Derive primary benefit category from entity extraction (used for Azure Search filtering).
    // Maps benefitTypes like ['dental'] → 'Dental' to match INTENT_CATEGORY_MAP values.
    const BENEFIT_CATEGORY_MAP: Record<string, string> = {
      medical: 'Medical', health: 'Medical', dental: 'Dental', vision: 'Vision',
      life: 'Life', disability: 'Disability', hsa: 'Savings', fsa: 'Savings',
      voluntary: 'Voluntary', accident: 'Voluntary', critical: 'Voluntary',
    };
    const primaryCategory = mapped.benefitTypes.length > 0
      ? (BENEFIT_CATEGORY_MAP[mapped.benefitTypes[0]] ?? undefined)
      : undefined;

    // Shared router context — injected into every LLM call as the "developer message".
    const routerContext = {
      userAge:  gateMeta.userAge as number | undefined,
      state:    gateMeta.state  as string | undefined,
      division: gateMeta.division as string | undefined,
      category: primaryCategory,
      intent:   mapped.intent,
      validationGate,
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
          content: cacheResult.content,
          timestamp: new Date(),
        };
        await conversationService.addMessage(conversation.id, cachedAiMessage);
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
    const COMPLEX_INTENTS = new Set(['compare', 'cost', 'recommend', 'coverage', 'details', 'enroll']);
    const isComplexBenefitQuery = (
      mapped.benefitTypes.length > 0 ||
      COMPLEX_INTENTS.has(mapped.intent ?? '')
    ) && slotsComplete;
    const shouldUseRAG = useRAG || isComplexBenefitQuery;
    let routed;
    let modelUsed: 'simple' | 'smart' | 'rag' = 'simple';
    let ragChunksUsed = 0;

    if (shouldUseRAG) {
      try {
        routed = await ragChatRouter.routeMessage(userMessage.content, {
          companyId,
          history:  [],
          ...routerContext,
        });
        modelUsed = 'rag';
        ragChunksUsed = (routed as any).metadata?.chunksUsed ?? 0;
        // Distinguish: did we retrieve real docs, or was it a fallback LLM-only call?
        routeSource = (routed as any).responseType === 'rag' && ragChunksUsed > 0
          ? 'rag-doc'      // ✅ retrieved chunks from Azure Search
          : 'rag-fallback'; // ⚠️  RAG tried but no matching docs — LLM answered alone
        logger.info('[Router] RAG path', { isComplexBenefitQuery, ragChunksUsed, routeSource });
      } catch (err) {
        logger.warn('RAG router failed, falling back to smart/simple', { err });
      }
    }

    if (!routed && useSmart) {
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

