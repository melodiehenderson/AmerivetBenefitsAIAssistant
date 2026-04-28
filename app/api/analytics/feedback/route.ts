/**
 * Feedback API
 * Records a thumbs-up or thumbs-down on a single assistant message.
 * Writes to BenefitsChat.Feedback (auto-created by getContainer).
 * Fire-and-forget from the client — no personal data stored.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/azure/cosmos-db';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, messageId, feedback, companyId } = body;

    if (!sessionId || !messageId || (feedback !== 'up' && feedback !== 'down')) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const container = await getContainer('Feedback');

    // Upsert so a double-tap updates rather than duplicates
    const item = {
      id: `fb-${sessionId}-${messageId}`,
      sessionId,
      messageId,
      feedback,                               // 'up' | 'down'
      companyId: companyId || 'amerivet',
      timestamp: Date.now(),
    };

    await container.items.upsert(item);

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('[Feedback] Write failed:', err);
    // Return 200 anyway — client doesn't need to retry on analytics write failures
    return NextResponse.json({ ok: false });
  }
}
