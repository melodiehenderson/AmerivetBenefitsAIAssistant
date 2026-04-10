import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/lib/rag/session-store';

const sessionStore = new Map<string, Session>();

vi.mock('@/lib/rag/session-store', () => ({
  getOrCreateSession: vi.fn(async (sessionId: string) => {
    return sessionStore.get(sessionId) ?? { step: 'start', context: {} };
  }),
  updateSession: vi.fn(async (sessionId: string, session: Session) => {
    sessionStore.set(sessionId, session);
  }),
}));

describe('QA route spouse-tier follow-up', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('handles "yes, can i see just employee + spouse" as a medical tier switch', async () => {
    const sessionId = 'spouse-followup-test';
    sessionStore.set(sessionId, {
      step: 'active_chat',
      context: {},
      hasCollectedName: true,
      userName: 'Sandra',
      userAge: 37,
      userState: 'CA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage:
        'Medical plan options (Employee Only):\n' +
        '- Standard HSA (BCBSTX): $86.84/month ($1,042.08/year)\n' +
        '- Enhanced HSA (BCBSTX): $160.36/month ($1,924.32/year)\n\n' +
        'Note: Kaiser Standard HMO is only available in CA, GA, WA, and OR.\n\n' +
        'Want to compare plans or switch coverage tiers?',
    });

    const { POST } = await import('@/app/api/qa/route');

    const req = new Request('http://localhost/api/qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'yes, can i see just employee + spouse',
        companyId: 'amerivet',
        sessionId,
      }),
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(body.answer).toContain('Employee + Spouse');
    expect(body.answer).not.toContain('temporary issue');
    expect(body.metadata?.intercept).toMatch(/tier-switch|early-tier-switch/);
  });
});
