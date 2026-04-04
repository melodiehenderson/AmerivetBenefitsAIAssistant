import type { Session } from '@/lib/rag/session-store';
import type { QueryIntent } from '@/lib/rag/query-intent-classifier';

export type IntentDomain = 'pricing' | 'policy' | 'general';

export type DigestedIntent = {
  topic: string;
  intent: string;
  guardrail: string;
  regionalCheck: string;
  pricingExclusion: boolean;
};

export function getTopicLabel(query: string, currentTopic?: string): string {
  const lower = query.toLowerCase();
  if (/family|spouse|child|kid|dependent/i.test(lower)) return 'your family coverage options';
  if (/medical|health|hsa|ppo|hmo|kaiser/i.test(lower)) return 'medical plan details';
  if (/dental|vision|teeth|eye/i.test(lower)) return 'ancillary benefits (dental/vision)';
  if (/life|disability|accident|critical/i.test(lower)) return 'voluntary/supplemental insurance';
  return currentTopic ? `${currentTopic.toLowerCase()} details` : 'your benefits inquiry';
}

export function detectIntentDomain(lowerQuery: string): IntentDomain {
  const hasPolicy = /\b(can\s+i|am\s+i|eligible|qualif(?:y|ied)|how\s+many\s+days|deadline|window|qle|qualifying\s+life\s+event|special\s+enrollment|filing\s+order|what\s+order|step\s*by\s*step|fmla|std|short\s*[- ]?term\s+disability|pre-?existing|clause|deny|denied|deductible\s+reset|effective\s+date)\b/i.test(lowerQuery);
  const hasPricing = /\b(how\s+much|cost|price|premium|deduct(?:ed|ion)|per\s*pay(?:check|period)|monthly|annual|compare\s+cost|estimate|projection|oop|out\s*of\s*pocket)\b/i.test(lowerQuery);

  if (hasPolicy && !hasPricing) return 'policy';
  if (hasPricing) return 'pricing';
  return 'general';
}

export function digestIntent(
  query: string,
  session: Session,
  responseIntent: QueryIntent,
  intentDomain: IntentDomain,
  pricingExclusion: boolean,
): DigestedIntent {
  const lower = query.toLowerCase();
  const stateCode = (session.userState || '').toUpperCase();

  let topic = getTopicLabel(query, session.currentTopic);
  if (/\b(maternity|parental|fmla|std|leave|pregnan|birth|baby)\b/i.test(lower)) {
    topic = 'Maternity Leave Timeline';
  }

  let intent = responseIntent.toUpperCase();
  if (/\b(maternity|parental|fmla|std|leave)\b/i.test(lower)) {
    intent = 'LEAVE_TIMELINE';
  } else if (responseIntent === 'cost_lookup') {
    intent = 'PLAN_COST_LOOKUP';
  } else if (responseIntent === 'comparison') {
    intent = 'PLAN_COMPARISON';
  }

  const guardrailParts: string[] = [];
  if (intentDomain === 'policy' || intent === 'LEAVE_TIMELINE') {
    guardrailParts.push('FOCUS ON: duration, eligibility, pay percentages, waiting periods, and filing order.');
    guardrailParts.push('AVOID: plan premium comparisons and unrelated plan pricing.');
  } else if (intent === 'PLAN_COMPARISON') {
    guardrailParts.push('FOCUS ON: side-by-side differences with a markdown table.');
    guardrailParts.push('AVOID: off-topic policy narration.');
  } else if (intent === 'PLAN_COST_LOOKUP') {
    guardrailParts.push('FOCUS ON: exact monthly amounts and requested tier only.');
    guardrailParts.push('AVOID: broad overviews of unrelated plans.');
  } else {
    guardrailParts.push('FOCUS ON: the exact question and direct catalog-grounded answer.');
    guardrailParts.push('AVOID: repeating the user question or generic filler intros.');
  }

  if (session.noPricingMode) {
    guardrailParts.push('NO-PRICING MODE: never include dollar amounts.');
  }

  if (/\bppo\b/i.test(lower)) {
    guardrailParts.push('PPO GUARDRAIL: AmeriVet does not offer a standalone PPO plan; however, both the Standard and Enhanced HSA plans utilize the BCBSTX Nationwide PPO network.');
  }

  if (pricingExclusion) {
    guardrailParts.push('PRICING EXCLUSION: Describe all coverage features, networks, and inclusions, but strictly omit all dollar amounts for premiums.');
  }

  let regionalCheck = 'REGIONAL CHECK: apply state-locked medical availability rules before answering.';
  if (stateCode === 'OR') {
    regionalCheck = 'REGIONAL CHECK: Oregon is Kaiser-eligible. Include Kaiser in medical options/comparisons and show in table form.';
  } else if (stateCode === 'GA') {
    regionalCheck = 'REGIONAL CHECK: Georgia is Kaiser-eligible. Include Kaiser in medical options/comparisons and present the regional comparison in table form.';
  } else if (stateCode) {
    regionalCheck = `REGIONAL CHECK: ${stateCode} state lock applies. Only show region-eligible medical options.`;
  }

  return {
    topic,
    intent,
    guardrail: guardrailParts.join(' '),
    regionalCheck,
    pricingExclusion,
  };
}
