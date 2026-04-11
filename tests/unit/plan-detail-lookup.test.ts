import { describe, expect, it } from 'vitest';

import { buildMedicalPlanDetailAnswer } from '@/lib/qa/plan-detail-lookup';
import type { Session } from '@/lib/rag/session-store';

const baseSession: Session = {
  sessionId: 'test',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  history: [],
  mode: 'hybrid',
  currentTopic: 'Medical',
  userName: 'Test',
  disclaimersShown: false,
  payPeriods: 26,
};

describe('buildMedicalPlanDetailAnswer', () => {
  it('answers plan overview requests from structured summary data', () => {
    const answer = buildMedicalPlanDetailAnswer('more info on standard', baseSession);
    expect(answer).toContain('Standard HSA');
    expect(answer).toContain('Network');
    expect(answer).toContain('Primary care');
  });

  it('answers specialist questions generically from the plan-summary layer', () => {
    const answer = buildMedicalPlanDetailAnswer("what's the specialist copay on the enhanced plan?", baseSession);
    expect(answer).toContain('Enhanced HSA');
    expect(answer).toContain('$40');
  });

  it('returns rx note when rx tiers are not yet structured', () => {
    const answer = buildMedicalPlanDetailAnswer('what is the generic rx cost on the standard plan?', baseSession);
    expect(answer).toContain('Rx tier breakdown');
  });
});
