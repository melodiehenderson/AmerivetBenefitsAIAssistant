import { encodingForModel } from 'js-tiktoken';

const enc = encodingForModel('gpt-4');

export function countTokens(text: string): number {
  return enc.encode(text).length;
}

export function truncateToTokens(text: string, maxTokens: number): string {
  const tokens = enc.encode(text);
  if (tokens.length <= maxTokens) return text;
  return enc.decode(tokens.slice(0, maxTokens));
}

export function buildContextWithBudget(
  chunks: string[],
  systemPromptTokens: number,
  maxContextWindow = 8192,
  reserveForResponse = 1000
): string {
  const available = maxContextWindow - systemPromptTokens - reserveForResponse;
  let total = 0;
  const selected: string[] = [];
  for (const chunk of chunks) {
    const t = countTokens(chunk);
    if (total + t > available) break;
    selected.push(chunk);
    total += t;
  }
  return selected.join('\n\n---\n\n');
}
