import { Session } from './session-store';

export const FINAL_RECOMMENDATION_PROMPT = `Would you like my official recommendation based on what we've discussed?`;
export const TOPIC_TRANSITION_PROMPT = `Now that we've covered medical, should we move to Dental, Vision, or other benefits next?`;

export function hasPrompt(content: string, prompt: string) {
  return content.toLowerCase().includes(prompt.toLowerCase());
}

export function shouldAppendRecommendation(content: string, session: Session): boolean {
  if (!content.trim()) return false;
  if (hasPrompt(content, FINAL_RECOMMENDATION_PROMPT)) return false;

  const last = session.context?.lastRecommendationPromptAt ?? 0;
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

  const lastTimestamp = session.context?.lastTransitionPromptAt ?? 0;
  return Date.now() - lastTimestamp > 45_000;
}

// Strip citation tags like [Source 1], [1], [Doc 3], (Source 1) from user-facing output
export function stripCitations(text: string): string {
  let result = text;
  // Remove [Source X], [Doc X], [Document X] patterns
  result = result.replace(/\[(?:Source|Doc|Document)\s*\d+\]/gi, '');
  // Remove standalone [1], [2], etc.
  result = result.replace(/\[\d+\]/g, '');
  // Remove [ref] [ref1] patterns
  result = result.replace(/\[ref\s*\d*\]/gi, '');
  // Remove (Source: ...) patterns with colon
  result = result.replace(/\(Source:[^)]+\)/gi, '');
  // Remove (Source N) patterns without colon (Bug fix: catches "(Source 1)" format)
  result = result.replace(/\(Source\s*\d+\)/gi, '');
  // Remove (doc. 1) or (doc 2) patterns
  result = result.replace(/\(doc\.?\s*\d+\)/gi, '');
  // Remove superscript numbers ¹²³⁴⁵
  result = result.replace(/[¹²³⁴⁵]/g, '');
  // Remove "according to document/source/chunk N" phrases
  result = result.replace(/according to (?:document|source|chunk)\s*\d*/gi, '');
  // Clean up double spaces left behind
  result = result.replace(/  +/g, ' ');
  return result.trim();
}

// Strip bi-weekly pricing, keep only monthly
export function stripBiweeklyPricing(text: string): string {
  let result = text;
  // Remove bi-weekly mentions like "($X.XX bi-weekly)" or "$X.XX per pay period"
  result = result.replace(/\s*\(\$[\d,.]+\s*(?:bi-?weekly|per pay period|every two weeks)\)/gi, '');
  result = result.replace(/\$[\d,.]+\s*(?:bi-?weekly|per pay period|every two weeks)/gi, '');
  // Remove "bi-weekly: $X" patterns
  result = result.replace(/bi-?weekly:?\s*\$[\d,.]+/gi, '');
  return result;
}

// Strip annual pricing - keep only monthly
export function stripAnnualPricing(text: string): string {
  let result = text;
  // Remove ($XXX/year) or ($X,XXX/year) parenthetical annual amounts
  result = result.replace(/\s*\(\$[\d,]+(?:\.\d{2})?\s*\/?\s*(?:year|annually|yr|per year)\)/gi, '');
  // Remove standalone "($X,XXX annually)" 
  result = result.replace(/\s*\(\$[\d,]+(?:\.\d{2})?\s+annually\)/gi, '');
  return result;
}

// Strip $XXX placeholder values
export function stripPlaceholderPricing(text: string): string {
  // Replace $XXX patterns with empty string or a note
  return text.replace(/\$X{2,}/g, '[pricing available in calculator]');
}

// Helper to reinforce monthly-first pricing presentation
export function enforceMonthlyFirstFormat(text: string): string {
  // Convert annual-only prices to monthly format
  // Match patterns like "$1,042.08 per year" and convert to "$86.84/month"
  const annualOnlyRegex = /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:per year|\/year|annually)/gi;
  
  let result = text;
  let match;
  
  while ((match = annualOnlyRegex.exec(text)) !== null) {
    const annualAmount = parseFloat(match[1].replace(/,/g, ''));
    const monthlyAmount = (annualAmount / 12).toFixed(0);
    const original = match[0];
    const replacement = `$${monthlyAmount}/month`;
    result = result.replace(original, replacement);
  }
  
  return result;
}

// Strip markdown formatting from responses
export function stripMarkdown(text: string): string {
  let result = text;
  
  // Remove bold **text** -> text
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  
  // Remove italic *text* -> text (but not ** which is bold)
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
  
  // Remove headers # Header -> Header
  result = result.replace(/^#+\s*/gm, '');
  
  // Remove bullet points - item -> item
  result = result.replace(/^[-*]\s+/gm, '• ');
  
  // Remove numbered lists 1. item -> 1. item (keep numbers)
  // result = result.replace(/^\d+\.\s+/gm, '');
  
  return result;
}

// NEW: Strip internal prompts/reminders that leak into responses
export function stripInternalPrompts(text: string): string {
  let result = text;
  
  // Pattern list for internal instruction leakage - EXPANDED for comprehensive filtering
  const patterns = [
    // Direct reminders/instructions
    /^Reminder:.*$/gmi,
    /^\*\*Reminder:?\*\*.*$/gmi,
    /^Reminder \(.*?\):.*$/gmi,
    /Reminder:.*?(?:\.|$)/gi,
    /^\[Internal\].*$/gmi,
    /^Note to self:.*$/gmi,
    /^INSTRUCTION:.*$/gmi,
    /^Chain-of-thought:.*$/gmi,
    /Based on my instructions.*$/gmi,
    /According to my guidelines.*$/gmi,
    /I need to remember to.*$/gmi,
    /Let me think through this.*$/gmi,
    /show costs as.*monthly.*annually/gi,
    /Remember to format.*$/gmi,
    /I should mention.*$/gmi,
    /I should note.*$/gmi,
    /As instructed.*$/gmi,
    /Per my guidelines.*$/gmi,
    /Following my instructions.*$/gmi,
    /\(Note: I'm showing.*?\)/gi,
    /\(I'm displaying.*?\)/gi,
    /\[System:.*?\]/gi,
    // Meta-commentary about formatting
    /I'll present this in.*format.*$/gmi,
    /I'm formatting this as.*$/gmi,
    /Let me show you.*format.*$/gmi,
    // Instruction echoing patterns
    /^As your AmeriVet Benefits Advisor,.*$/gmi,
    /^Since I'm.*advisor.*$/gmi,
    /showing.*both monthly and annual/gi,
  ];
  
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }
  
  // Remove lines that are ONLY instruction-like (start with instruction keywords)
  const lines = result.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim().toLowerCase();
    // Filter out instruction-only lines
    if (trimmed.startsWith('reminder:')) return false;
    if (trimmed.startsWith('note:') && trimmed.includes('format')) return false;
    if (trimmed.startsWith('i need to')) return false;
    if (trimmed.match(/^as instructed/i)) return false;
    return true;
  });
  result = filteredLines.join('\n');
  
  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  
  return result;
}

// Regex-based validator to ensure monthly pricing is present when annual pricing appears
export function validatePricingFormat(text: string): string {
  // First strip markdown
  let result = stripMarkdown(text);
  
  // Then strip internal prompts
  result = stripInternalPrompts(result);
  
  // Strip approximate language from pricing
  result = stripApproximateLanguage(result);
  
  // Detect annual pricing mentions such as "$4,800/year" or "$4,800 annually"
  const annualPriceRegex = /\$[\d,]+(?:\s*\/|\s+per\s+)?(?:year|annually)/gi;
  if (annualPriceRegex.test(result) && !result.toLowerCase().includes('month')) {
    // Append a disclaimer rather than attempting arithmetic in code
    return result + '\n(Note: Please divide annual costs by 12 for your monthly premium)';
  }
  return result;
}

// NEW: Strip approximate/hedging language from pricing statements
export function stripApproximateLanguage(text: string): string {
  let result = text;
  
  // Remove hedging words before prices: "approximately $X" → "$X"
  result = result.replace(/approximately\s+(\$[\d,.]+)/gi, '$1');
  result = result.replace(/around\s+(\$[\d,.]+)/gi, '$1');
  result = result.replace(/roughly\s+(\$[\d,.]+)/gi, '$1');
  result = result.replace(/about\s+(\$[\d,.]+)/gi, '$1');
  result = result.replace(/estimated at\s+(\$[\d,.]+)/gi, '$1');
  result = result.replace(/estimated\s+(\$[\d,.]+)/gi, '$1');
  result = result.replace(/approximately\s*:\s*(\$[\d,.]+)/gi, '$1');
  
  // Remove hedging phrases: "could be around", "might be approximately"
  result = result.replace(/(?:could|might|may)\s+be\s+(?:around|approximately)\s+(\$[\d,.]+)/gi, 'is $1');
  
  return result;
}

// NEW: Smart response enhancer - adds proactive suggestions based on context
export function enhanceResponseWithSuggestions(
  answer: string, 
  currentTopic: string | null,
  completedTopics: string[],
  selectedPlan: string | null,
  allBenefits: string[]
): string {
  // Don't enhance if answer already ends with a question
  if (answer.trim().endsWith('?')) {
    return answer;
  }
  
  // Don't enhance if answer already has suggestions
  if (/would you like|shall i|should i|want me to/i.test(answer)) {
    return answer;
  }
  
  // Build smart suggestion based on context
  let suggestion = '';
  
  // If user selected HSA, suggest accident/critical illness (Brandon logic)
  if (selectedPlan && /hsa|high deductible/i.test(selectedPlan) && currentTopic === 'Medical') {
    suggestion = '\n\n💡 **Pro tip:** Since HSA plans have higher out-of-pocket costs, many employees pair them with Accident Insurance or Critical Illness coverage for extra protection. Would you like to learn more about these options?';
  }
  // If discussing dental, suggest pairing with vision
  else if (currentTopic === 'Dental' && !completedTopics.includes('Vision')) {
    suggestion = '\n\nWould you like me to show you Vision coverage as well? Many employees enroll in both dental and vision together.';
  }
  // If medical decision made, suggest dental/vision
  else if (completedTopics.includes('Medical') && !completedTopics.includes('Dental') && currentTopic === 'Medical') {
    const remaining = allBenefits.filter(b => !completedTopics.some(t => b.includes(t)));
    if (remaining.length > 0) {
      suggestion = `\n\nNow that you've decided on medical coverage, would you like to explore ${remaining[0].split(' (')[0]}?`;
    }
  }
  
  return answer + suggestion;
}

// NEW: Detect if response seems incomplete or cut off
export function detectIncompleteResponse(answer: string): boolean {
  const trimmed = answer.trim();
  
  // Check for incomplete sentences (ends with comma, colon, or mid-word)
  if (/[,:]\s*$/.test(trimmed)) return true;
  if (/\b(the|a|an|to|for|and|or|but|with)\s*$/i.test(trimmed)) return true;
  
  // Check for truncated bullet points
  if (/^[•-]\s*$/m.test(trimmed)) return true;
  
  return false;
}

// NEW: Clean up duplicate sentences that sometimes appear in LLM output
export function removeDuplicateSentences(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const unique: string[] = [];
  
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase().trim();
    if (normalized.length > 10 && !seen.has(normalized)) {
      seen.add(normalized);
      unique.push(sentence);
    } else if (normalized.length <= 10) {
      // Keep short sentences (might be important)
      unique.push(sentence);
    }
  }
  
  return unique.join(' ');
}

// NEW: Remove repeated phrases within sentences (e.g., "Indiana, Indiana, and Indiana" → "Indiana")
export function removeRepeatedPhrases(text: string): string {
  // Pattern: match repeated words/phrases separated by commas or "and"
  // "Indiana, Indiana, and Indiana" → "Indiana"
  // "California, California, California" → "California"

  let result = text;

  // Find sequences like "word, word, and word" or "word, word, word"
  result = result.replace(/\b(\w+(\s+\w+)?)(,\s+\1)+(,?\s+and\s+\1)?\b/gi, '$1');

  // Handle "X and X and X" patterns (2+ and-repeats)
  result = result.replace(/\b(\w+(\s+\w+)?)\s+and\s+\1(\s+and\s+\1)+\b/gi, '$1');

  // Bug fix: Handle simple "X and X" pattern (single repetition with "and")
  // e.g., "California and California" → "California"
  result = result.replace(/\b(\w+)\s+and\s+\1\b/gi, '$1');

  return result;
}

export function cleanResponseText(text: string): string {
  let result = text;
  result = stripCitations(result);            // Remove citation artifacts like (Source 1)
  result = removeDuplicateSentences(result);  // Remove duplicate sentences first
  result = removeRepeatedPhrases(result);      // Then remove repeated phrases
  return result;
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
