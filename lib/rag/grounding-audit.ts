// lib/rag/grounding-audit.ts
export function verifyNumericalIntegrity(llmResponse: string, allowedValues: number[]): string[] {
  const extracted = (llmResponse.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  // Filter for numbers > 10 to ignore small counts/list items
  return extracted.filter(n => n > 10 && !allowedValues.some(v => Math.abs(v - n) < 1));
}
