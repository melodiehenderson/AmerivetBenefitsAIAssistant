import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateSession, updateSession } from '@/lib/rag/session-store';
import { runQaV2Engine } from '@/lib/qa-v2/engine';
import { conversationService } from '@/lib/services/conversation-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = typeof body?.query === 'string' ? body.query : '';
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim()
      ? body.sessionId
      : `qa-v2-${Date.now()}`;

    const session = await getOrCreateSession(sessionId);
    if (body?.context && typeof body.context === 'object') {
      const context = body.context as Record<string, unknown>;
      if (!session.userName && typeof context.userName === 'string') session.userName = context.userName;
      if ((session.userAge === undefined || session.userAge === null) && typeof context.userAge === 'number') session.userAge = context.userAge;
      if (!session.userState && typeof context.userState === 'string') session.userState = context.userState;
      if (!session.currentTopic && typeof context.currentTopic === 'string') session.currentTopic = context.currentTopic;
      if (!session.completedTopics && Array.isArray(context.completedTopics)) {
        session.completedTopics = context.completedTopics.filter((item): item is string => typeof item === 'string');
      }
      if (!session.coverageTierLock && typeof context.coverageTierLock === 'string') session.coverageTierLock = context.coverageTierLock;
      if (!session.dataConfirmed && typeof context.dataConfirmed === 'boolean') session.dataConfirmed = context.dataConfirmed;
      if (!session.hasCollectedName && typeof context.hasCollectedName === 'boolean') session.hasCollectedName = context.hasCollectedName;
    }
    const result = await runQaV2Engine({ query, session });
    await updateSession(sessionId, session);

    // ── Cosmos DB persistence (non-blocking — analytics only) ──────────────
    // Fire-and-forget: if Cosmos is unavailable the chat still returns normally.
    const userId = typeof body?.userId === 'string' && body.userId ? body.userId : `anon-${sessionId}`;
    const companyId = typeof body?.companyId === 'string' && body.companyId ? body.companyId : 'amerivet';
    const isEscalation = result?.metadata?.intercept === 'counselor-escalation-v2';

    conversationService
      .getOrCreateForSession(sessionId, userId, companyId)
      .then(() => {
        const topicPatch = session.currentTopic
          ? { currentTopic: session.currentTopic }
          : undefined;
        return conversationService.incrementMessageCount(sessionId, 2, topicPatch);
      })
      .then(() => {
        if (isEscalation) {
          return conversationService.recordEscalation(sessionId);
        }
      })
      .catch((err) => {
        // Log but never surface to the user
        console.error('[qa-v2] Cosmos persistence error (non-fatal):', err);
      });
    // ──────────────────────────────────────────────────────────────────────

    return NextResponse.json(result);
  } catch (error) {
    console.error('qa-v2 route error', error);
    return NextResponse.json(
      {
        answer: 'I hit an unexpected issue while processing that. Please try again.',
        tier: 'L1',
      },
      { status: 500 },
    );
  }
}
