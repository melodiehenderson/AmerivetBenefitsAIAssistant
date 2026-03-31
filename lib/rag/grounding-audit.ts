// lib/rag/grounding-audit.ts
export function verifyNumericalIntegrity(llmResponse: string, allowedValues: number[]): number[] {
  // Use a fallback empty array if match() returns null
  const matches = llmResponse.match(/\d+(?:\.\d+)?/g) || [];
  const extracted = matches.map(Number);
  // Return the list of numbers that DON'T exist in our allowed catalog
  return extracted.filter(n => n > 10 && !allowedValues.some(v => Math.abs(v - n) < 1));
}
