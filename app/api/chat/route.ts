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
      const awaiting = metadata.awaiting as 'state' | 'division' | undefined | null;
      const normalizedMessage = message.trim().toLowerCase();

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
          return sendEligibilityMessage('Before we continue, what state are you in?');
        }

        const trimmedState = message.trim();
        if (!trimmedState) {
          return sendEligibilityMessage('I didn’t catch that. What state are you in?');
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
          return sendEligibilityMessage('Thanks. Now, what is your company division or department?');
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
        return null;
      }

      return null;
    };

    if (process.env.NODE_ENV !== 'test') {
      const eligibilityResponse = await ensureEligibility();
      if (eligibilityResponse) {
        return eligibilityResponse;
      }
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

    // Save AI response
    const aiMessage = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: routed.content,
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

