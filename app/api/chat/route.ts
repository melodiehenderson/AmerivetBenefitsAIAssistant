export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, PERMISSIONS } from '@/lib/auth/unified-auth';

import { simpleChatRouter } from '@/lib/services/simple-chat-router';
import { smartChatRouter } from '@/lib/services/smart-chat-router';

import { conversationService } from '@/lib/services/conversation-service';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// Validation schema for chat request
const chatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  conversationId: z.string().optional(),
  context: z.record(z.any()).optional(),
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
      const aiMessage = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content,
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
      const aiMessage = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content,
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

    const ensureEligibility = async (): Promise<NextResponse | null> => {
      const metadata = conversation.metadata ?? {};
      const awaiting = metadata.awaiting as 'name' | 'age' | 'state' | 'division' | undefined | null;
      const normalizedMessage = message.trim().toLowerCase();

      // Step 1: Welcome and ask for name (only for brand new conversations)
      if (!metadata.userName && !awaiting) {
        const updated = await conversationService.patchMetadata(conversation.id, { awaiting: 'name' });
        conversation.metadata = updated.metadata ?? {};
        return sendEligibilityMessage(
          "Hi! 👋 I'm Susie, your Amerivet Benefits Assistant. I'm here to help you understand your benefits options and make informed decisions.\n\n⚠️ **Important**: I am NOT your enrollment platform. I'm here to help you learn and decide, but you'll make your final selections in your company's benefits enrollment system.\n\nLet's get started! What's your first name?"
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
          `Nice to meet you, ${userName}! 😊\n\nTo help me provide the most relevant benefits information, how old are you? (Just your age in years is fine)`
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
          `Got it, thanks ${metadata.userName}!\n\nNow, which state do you live in? This helps me show you benefits available in your area.`
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
          return sendEligibilityMessage(`${greeting} state are you in? This helps me show you location-specific benefits.`);
        }

        const trimmedState = message.trim();
        if (!trimmedState) {
          return sendEligibilityMessage("I didn't catch that. What state are you in?");
        }

        const needsDivision = !metadata.division;
        const statePatch: Record<string, any> = {
          state: trimmedState,
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
            `Perfect, ${userName}! Last question: what is your company division or department? (For example: Sales, Engineering, Operations, etc.)`
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
        const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || process.env.NEXT_PUBLIC_ENROLLMENT_URL;
        const enrollmentCta = enrollmentUrl 
          ? `\n\n📋 **Ready to enroll?** When you're ready to make your official selections, visit your [benefits enrollment portal](${enrollmentUrl}).`
          : '';
        
        return sendEligibilityMessage(
          `Awesome, ${userName}! 🎉\n\nI now have everything I need:
• Name: ${userName}
• Age: ${userAge || 'Not specified'}
• Location: ${metadata.state}
• Department: ${trimmedDivision}

${ageContext} may be eligible for various health, dental, vision, and retirement benefits in ${metadata.state}.\n\nI'm here to help you understand your options so you can make the best choices for you and your family. Let's explore together!\n\n**What would you like to discuss first?**
• Medical plans (PPO, HMO, HSA options)
• Dental & Vision coverage
• Critical Illness, Accident, or Hospital Indemnity
• Life Insurance & Disability
• Retirement (401k) options${enrollmentCta}`
        );
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

    // Age-Banded Cost Safe Path (Sprint 3.1): CI / Life / Disability costs
    const costKeywords = /(how much|cost|price|quote|rate|premium|per month|per paycheck)/i;
    const ageBandedProducts = /(critical illness|ci|life(\s|$)|disability|short term disability|long term disability|std|ltd)/i;
    if (costKeywords.test(normalizedMessage) && ageBandedProducts.test(normalizedMessage)) {
      const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || process.env.NEXT_PUBLIC_ENROLLMENT_URL;
      const portalLine = enrollmentUrl
        ? ` You can see your exact pricing any time in your [benefits enrollment portal](${enrollmentUrl}).`
        : '';
      return sendAssistantMessage(
        `Thanks for asking! This is an age-rated product, and pricing can vary based on factors like age, coverage amount, and pay frequency. To ensure accuracy, I don't quote exact amounts here.${portalLine}\n\nIf you'd like, I can explain how the coverage works and when it pays out—would that be helpful?`
      );
    }

    // Route via SimpleChatRouter
    const started = Date.now();
    const useSmart = process.env.USE_SMART_ROUTER === 'true';
    let routed;
    let modelUsed: 'simple' | 'smart' = 'simple';

    if (useSmart) {
      try {
        routed = await smartChatRouter.routeMessage(userMessage.content, {
          state: conversation.metadata?.state,
          division: conversation.metadata?.division
        });
        modelUsed = 'smart';
      } catch (err) {
        logger.warn('SmartChatRouter failed, falling back to simple', { err });
      }
    }

    if (!routed) {
      routed = await simpleChatRouter.routeMessage(userMessage.content, {
        state: conversation.metadata?.state,
        division: conversation.metadata?.division
      });
      modelUsed = 'simple';
    }

    const latencyMs = Date.now() - started;

    // Brandon Logic: HSA Cross-Selling (Sprint 2.2)
    let enhancedContent = routed.content;
    // Note: normalizedMessage declared above; reuse here
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
    const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || process.env.NEXT_PUBLIC_ENROLLMENT_URL;
    if (isSubstantiveResponse && enrollmentUrl && !conversation.metadata?.enrollmentLinkShown && normalizedMessage.match(/(enroll|sign up|how do i|where do i|ready to)/i)) {
      enhancedContent += `\n\n---\n\n📝 **Ready to make it official?** You can finalize your benefit selections at your [benefits enrollment portal](${enrollmentUrl}).`;
      await conversationService.patchMetadata(conversation.id, { enrollmentLinkShown: true });
    }

    // Backend seed greeting: prepend once per conversation
    const seedShown = conversation.metadata?.seedGreetingShown === true;
    if (!seedShown) {
      const greeting = "Hi! 👋 Welcome! I'm your virtual Benefits Assistant. I can help with AmeriVet benefits, plans, and enrollment guidance. I am NOT your enrollment platform — you'll still make official selections in your benefits system. How can I help today?";
      enhancedContent = `${greeting}\n\n${enhancedContent}`;
      try {
        await conversationService.patchMetadata(conversation.id, { seedGreetingShown: true });
      } catch {}
    }

    // Save AI response
    const aiMessage = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: enhancedContent,
      timestamp: new Date()
    };

    await conversationService.addMessage(conversation.id, aiMessage);

    return NextResponse.json({
      message: aiMessage,
      conversationId: conversation.id,
      route: routed.responseType,
      model: modelUsed,
      latencyMs
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    logger.error('Chat error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Chat processing failed' }, { status: 500 });
  }
});

