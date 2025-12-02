import { Session } from './session-store';

export const FINAL_RECOMMENDATION_PROMPT = `Would you like my official recommendation based on what we've discussed?`;
export const TOPIC_TRANSITION_PROMPT = `Now that we've covered medical, should we move to Dental, Vision, or other benefits next?`;

export function hasPrompt(content: string, prompt: string) {
  return content.toLowerCase().includes(prompt.toLowerCase());
}

export function shouldAppendRecommendation(content: string, session: Session): boolean {
  if (!content.trim()) return false;
  if (hasPrompt(content, FINAL_RECOMMENDATION_PROMPT)) return false;

  const last = session.context.lastRecommendationPromptAt ?? 0;
  return Date.now() - last > 45_000;
}

export function shouldAppendTransition(content: string, session: Session): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (hasPrompt(content, TOPIC_TRANSITION_PROMPT)) return false;

  const normalized = trimmed.toLowerCase();
  if (normalized.includes('enrollment portal')) return false;
  if (trimmed.endsWith('?')) return false;
  if ((session.lastBotMessage || '').includes('Dental, Vision')) return false;

  const lastTurn = session.lastTransitionTurn ?? -Infinity;
  const currentTurn = session.turn ?? 0;
  if (Number.isFinite(lastTurn) && currentTurn - lastTurn < 2) return false;

  const lastTimestamp = session.context.lastTransitionPromptAt ?? 0;
  return Date.now() - lastTimestamp > 45_000;
}

// Helper to reinforce monthly-first pricing presentation
export function enforceMonthlyFirstFormat(text: string): string {
  const hasAnnually = text.toLowerCase().includes('annually');
  const hasPerMonth = text.toLowerCase().includes('per month');
  if (hasAnnually && !hasPerMonth) {
    return `Reminder: Show costs as "$X per month ($Y annually)".\n\n${text}`;
  }
  return text;
}

// Regex-based validator to ensure monthly pricing is present when annual pricing appears
export function validatePricingFormat(text: string): string {
  // Detect annual pricing mentions such as "$4,800/year" or "$4,800 annually"
  const annualPriceRegex = /\$[\d,]+(?:\s*\/|\s+per\s+)?(?:year|annually)/gi;
  if (annualPriceRegex.test(text) && !text.toLowerCase().includes('month')) {
    // Append a disclaimer rather than attempting arithmetic in code
    return text + '\n_(Note: Please divide annual costs by 12 for your monthly premium)_';
  }
  return text;
}

export function classifyIntent(message: string): 'age_banded_cost' | 'ancillary_switch' | 'enrollment_handoff' | 'general' {
  const msg = message.toLowerCase();
  const ageBandedKeywords = ['cost of life', 'price of critical illness', 'critical illness cost', 'disability cost', 'voluntary life cost'];
  if (ageBandedKeywords.some((k) => msg.includes(k))) return 'age_banded_cost';

  const ancillaryKeywords = ['other plans', 'anything else', 'move on', 'other benefits', 'what else'];
  if (ancillaryKeywords.some((k) => msg.includes(k))) return 'ancillary_switch';

  if (msg.includes('enroll') || msg.includes('sign up') || msg.includes('portal')) return 'enrollment_handoff';

  return 'general';
}
