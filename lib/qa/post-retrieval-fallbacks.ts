import type { Session } from '@/lib/rag/session-store';

export function recordAssistantReply(session: Session, answer: string, query?: string): void {
  session.lastBotMessage = answer;

  if (!query) return;

  if (!session.messages) {
    session.messages = [];
  }

  session.messages.push(
    { role: 'user', content: query },
    { role: 'assistant', content: answer },
  );

  if (session.messages.length > 24) {
    session.messages = session.messages.slice(-24);
  }
}

export function buildGateFailureEscalationMessage(hrPhone: string, enrollmentPortalUrl: string): string {
  return `I don't have enough information to answer that accurately. Please contact the AmeriVet benefits team at ${hrPhone} or visit the enrollment portal at ${enrollmentPortalUrl} for assistance.`;
}

export function buildExplicitCategoryPrompt(category: string, enrollmentPortalUrl: string): string {
  return `I'd be happy to help with ${category} benefits! Could you tell me more about what you'd like to know? For example:\n- Plan options and what they cover\n- Pricing for your coverage tier\n- How to compare plans\n\nOr check the enrollment portal at ${enrollmentPortalUrl} for full details.`;
}

export function buildZeroChunkFallbackMessage(isContinuation: boolean, allBenefitsShort: string): string {
  if (isContinuation) {
    return `I'm ready! What topic should we cover first? Available benefits include: ${allBenefitsShort}`;
  }

  return `I checked our benefits documents, but I couldn't find any information matching that request. Could you try rephrasing or specify which benefit you're asking about?`;
}

export function buildValidationSafeFallback(hrPhone: string, enrollmentPortalUrl: string): string {
  return `I want to give you a fully accurate answer, but I could not validate this response with high confidence. Please rephrase your question in one sentence and include the exact benefit topic (medical, dental, vision, life, disability, or HSA/FSA). You can also contact AmeriVet HR/Benefits at ${hrPhone} or use ${enrollmentPortalUrl} for official plan details.`;
}

export function buildSingleDentalPlanFallback(planName: string, provider: string): string {
  return `AmeriVet offers a single dental plan: **${planName}** (${provider}).\n\nIf you'd like, I can compare it side-by-side with the vision plan or show pricing for a specific coverage tier.`;
}
