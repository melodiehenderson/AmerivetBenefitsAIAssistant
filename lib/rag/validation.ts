/**
 * Output Validation & Guardrails
 * 
 * Purpose:
 * - Verify LLM responses are grounded in retrieved chunks
 * - Detect and redact PII/PHI from responses
 * - Validate citations map to actual source chunks
 * - Trigger tier escalation on validation failures
 * 
 * Architecture:
 * - Grounding Check: Token-level overlap between response and retrieved chunks (threshold: 70%)
 * - Citation Validation: Ensure all citation IDs exist in chunk set
 * - PII/PHI Redaction: Regex-based detection with configurable patterns
 * - Escalation Integration: Automatic tier upgrade on grounding < 70%
 * 
 * Dependencies:
 * - types/rag.ts (ValidationResult, Citation, Chunk, GroundingMetrics)
 * - lib/rag/pattern-router.ts (shouldEscalateTier, escalateTier)
 */

import type {
  ValidationResult,
  Citation,
  Chunk,
  GroundingMetrics,
  PIIDetectionResult,
  PIIFinding,
  PIIType,
  LLMTier,
} from '../../types/rag';
import {
  computeSemanticGroundingScore,
  blendGroundingScores,
  SEMANTIC_SIMILARITY_THRESHOLD,
} from './semantic-grounding';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const GROUNDING_THRESHOLD = 0.70; // 70% of response tokens must be grounded
const MIN_CITATION_LENGTH = 20; // Minimum characters for a valid citation
const PII_REDACTION_ENABLED = true;

/**
 * PII/PHI Detection Patterns
 * 
 * Categories:
 * - SSN: Social Security Numbers (XXX-XX-XXXX)
 * - Email: Email addresses
 * - Phone: US phone numbers (various formats)
 * - Credit Card: 13-19 digit card numbers
 * - DOB: Date of birth patterns (MM/DD/YYYY, YYYY-MM-DD)
 * - MRN: Medical Record Numbers (alphanumeric, 6-10 chars)
 * - Names: Proper names (Mr./Ms./Dr. followed by capitalized words)
 */
const PII_PATTERNS = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  dob: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12][0-9]|3[01])\/(?:19|20)\d{2}\b|\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])\b/g,
  mrn: /\b(?:MRN|Medical Record|Patient ID)[:\s]*([A-Z0-9]{6,10})\b/gi,
  names: /\b(?:Mr\.|Ms\.|Mrs\.|Dr\.|Miss)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
};

/**
 * Redaction Templates
 * Replace detected PII with semantic placeholders
 */
const REDACTION_MASKS = {
  ssn: '[SSN REDACTED]',
  email: '[EMAIL REDACTED]',
  phone: '[PHONE REDACTED]',
  creditCard: '[CARD REDACTED]',
  dob: '[DOB REDACTED]',
  mrn: '[MRN REDACTED]',
  names: '[NAME REDACTED]',
};

// ─────────────────────────────────────────────────────────────────────────────
// Grounding Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute Grounding Score
 * 
 * Algorithm (HYBRID APPROACH):
 * 1. Primary: N-gram token matching (strict, precise)
 *    - Tokenize response into n-grams (unigrams, bigrams, trigrams)
 *    - For each n-gram, check if it appears verbatim in any chunk
 *    - Weight by n-gram length
 * 
 * 2. Secondary: Semantic similarity matching (lenient, catches paraphrasing)
 *    - Segment response into sentences
 *    - Embed segments and chunks
 *    - Compute cosine similarity
 *    - Score % of segments with similarity >= 0.72
 * 
 * 3. Blend scores intelligently:
 *    - If n-gram strong (>60%), trust it (precise)
 *    - If semantic strong but n-gram weak, boost with semantic
 *    - Otherwise average them
 * 
 * This hybrid approach:
 * - Rewards close paraphrasing (semantic boost)
 * - Maintains precision when LLM quotes verbatim (n-gram)
 * - Avoids false negatives from hallucinations
 */
export async function computeGroundingScore(
  response: string,
  chunks: Chunk[]
): Promise<GroundingMetrics> {
  const tokens = tokenize(response);
  const chunkTexts = chunks.map(c => c.content.toLowerCase());
  
  let totalWeight = 0;
  let groundedWeight = 0;
  const chunkMapping: Record<string, number> = {}; // chunkId -> grounded token count
  const ungroundedSpans: string[] = [];

  // ─ PART 1: N-GRAM MATCHING (LEXICAL)
  const ngrams = generateNGrams(tokens, 3);

  for (const ngram of ngrams) {
    const ngramText = ngram.tokens.join(' ').toLowerCase();
    const weight = ngram.tokens.length; // Longer n-grams = higher weight
    totalWeight += weight;

    let isGrounded = false;
    for (let i = 0; i < chunks.length; i++) {
      if (chunkTexts[i].includes(ngramText)) {
        isGrounded = true;
        groundedWeight += weight;
        chunkMapping[chunks[i].id] = (chunkMapping[chunks[i].id] || 0) + weight;
        break; // Count each n-gram only once
      }
    }

    if (!isGrounded && ngram.tokens.length === 1) {
      // Track ungrounded unigrams for diagnostics
      ungroundedSpans.push(ngramText);
    }
  }

  const ngramScore = totalWeight > 0 ? groundedWeight / totalWeight : 0;

  // ─ PART 2: SEMANTIC SIMILARITY MATCHING (ATTEMPTED IF N-GRAM SCORE LOW)
  let semanticScore = ngramScore; // Default to n-gram if semantic fails
  let blendedScore = ngramScore;

  try {
    if (ngramScore < 0.65) {
      // Only compute semantic grounding if n-gram score is below threshold
      // This saves API calls and is more efficient
      console.log('[GROUNDING] N-gram score below 65%, attempting semantic matching...');
      
      const semanticMetrics = await computeSemanticGroundingScore(response, chunks);
      semanticScore = semanticMetrics.score;
      
      // Blend the two scores intelligently
      blendedScore = blendGroundingScores(ngramScore, semanticScore);
      
      console.log(`[GROUNDING] N-gram=${(ngramScore * 100).toFixed(1)}%, Semantic=${(semanticScore * 100).toFixed(1)}%, Blended=${(blendedScore * 100).toFixed(1)}%`);
    }
  } catch (error) {
    console.error('[GROUNDING] Semantic matching failed, using n-gram score:', error);
    blendedScore = ngramScore; // Fallback to n-gram on error
  }

  // ─ DETERMINE FINAL PASSING STATUS
  const isPassing = blendedScore >= GROUNDING_THRESHOLD;

  return {
    score: blendedScore, // USE BLENDED SCORE (hybrid semantic+lexical)
    isPassing,
    totalTokens: tokens.length,
    groundedTokens: Math.round((blendedScore * tokens.length)),
    chunkMapping,
    ungroundedSpans: ungroundedSpans.slice(0, 10), // Limit to first 10 for diagnostics
  };
}

/**
 * Tokenize Text
 * Split text into words, normalize whitespace, preserve punctuation context
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ') // Keep hyphens and apostrophes
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Generate N-Grams
 * Create overlapping n-grams up to maxN length
 */
function generateNGrams(
  tokens: string[],
  maxN: number
): Array<{ tokens: string[]; start: number; end: number }> {
  const ngrams: Array<{ tokens: string[]; start: number; end: number }> = [];

  for (let n = maxN; n >= 1; n--) {
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.push({
        tokens: tokens.slice(i, i + n),
        start: i,
        end: i + n,
      });
    }
  }

  return ngrams;
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate Citations
 * 
 * Checks:
 * 1. All citation IDs exist in the chunk set
 * 2. Citation text length meets minimum threshold
 * 3. Cited text actually appears in the referenced chunk
 * 4. No duplicate citations (same chunkId + span)
 * 
 * Returns:
 * - valid: All citations pass validation
 * - invalidCitations: List of citations that failed validation with reasons
 */
export function validateCitations(
  citations: Citation[],
  chunks: Chunk[]
): { valid: boolean; invalidCitations: Array<{ citation: Citation; reason: string }> } {
  const chunkMap = new Map(chunks.map(c => [c.id, c]));
  const invalidCitations: Array<{ citation: Citation; reason: string }> = [];
  const seenCitations = new Set<string>();

  for (const citation of citations) {
    // Check 1: Citation ID exists
    const chunk = chunkMap.get(citation.chunkId);
    if (!chunk) {
      invalidCitations.push({
        citation,
        reason: `Chunk ID "${citation.chunkId}" not found in retrieved chunks`,
      });
      continue;
    }

    // Check 2: Citation text exists (optional field)
    if (!citation.text) {
      invalidCitations.push({
        citation,
        reason: 'Citation missing text field',
      });
      continue;
    }

    // Check 3: Minimum citation length
    if (citation.text.length < MIN_CITATION_LENGTH) {
      invalidCitations.push({
        citation,
        reason: `Citation text too short (${citation.text.length} < ${MIN_CITATION_LENGTH} chars)`,
      });
      continue;
    }

    // Check 4: Citation text appears in chunk (case-insensitive, normalized whitespace)
    const normalizedCitation = citation.text.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedChunk = chunk.content.toLowerCase().replace(/\s+/g, ' ');
    
    if (!normalizedChunk.includes(normalizedCitation)) {
      invalidCitations.push({
        citation,
        reason: `Citation text not found in chunk "${citation.chunkId}"`,
      });
      continue;
    }

    // Check 5: No duplicate citations
    const citationKey = `${citation.chunkId}:${citation.text.slice(0, 50)}`;
    if (seenCitations.has(citationKey)) {
      invalidCitations.push({
        citation,
        reason: 'Duplicate citation',
      });
      continue;
    }
    seenCitations.add(citationKey);
  }

  return {
    valid: invalidCitations.length === 0,
    invalidCitations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PII/PHI Redaction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect PII/PHI
 * Scan text for personally identifiable information using regex patterns
 * 
 * Returns:
 * - detected: Array of PII detections with category, match, and position
 * - hasPII: Boolean flag for quick check
 */
export function detectPII(text: string): {
  detected: Array<{ category: string; match: string; index: number }>;
  hasPII: boolean;
} {
  const detected: Array<{ category: string; match: string; index: number }> = [];

  for (const [category, pattern] of Object.entries(PII_PATTERNS)) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      detected.push({
        category,
        match: match[0],
        index: match.index ?? 0,
      });
    }
  }

  return {
    detected,
    hasPII: detected.length > 0,
  };
}

/**
 * Redact PII/PHI
 * Replace detected PII with semantic placeholders
 * 
 * Strategy:
 * - Apply all PII patterns sequentially
 * - Use semantic masks (e.g., [SSN REDACTED] instead of [REDACTED])
 * - Preserve text structure and readability
 * - Return both redacted text and redaction metadata
 */
export function redactPII(text: string): {
  redactedText: string;
  redactionsMade: number;
  categories: string[];
} {
  if (!PII_REDACTION_ENABLED) {
    return { redactedText: text, redactionsMade: 0, categories: [] };
  }

  let redactedText = text;
  let totalRedactions = 0;
  const categoriesDetected = new Set<string>();

  for (const [category, pattern] of Object.entries(PII_PATTERNS)) {
    const mask = REDACTION_MASKS[category as keyof typeof REDACTION_MASKS];
    const matches = redactedText.match(pattern);
    
    if (matches && matches.length > 0) {
      redactedText = redactedText.replace(pattern, mask);
      totalRedactions += matches.length;
      categoriesDetected.add(category);
    }
  }

  return {
    redactedText,
    redactionsMade: totalRedactions,
    categories: Array.from(categoriesDetected),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comprehensive Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate LLM Response
 * 
 * Orchestrates all validation checks:
 * 1. Grounding verification (70% threshold) - NOW WITH SEMANTIC MATCHING
 * 2. Citation validation (existence, content, uniqueness)
 * 3. PII/PHI detection and redaction
 * 
 * Returns ValidationResult with:
 * - valid: Boolean (all checks passed)
 * - grounding: GroundingMetrics
 * - citations: Citation validation results
 * - piiDetected: PII detection results
 * - redactedResponse: Cleaned response text
 * - errors: List of validation failures
 * - requiresEscalation: Tier upgrade needed (grounding < 70%)
 */
export async function validateResponse(
  response: string,
  citations: Citation[],
  chunks: Chunk[],
  currentTier: LLMTier
): Promise<ValidationResult> {
  const errors: string[] = [];
  let requiresEscalation = false;

  // Step 1: Grounding Check (NOW ASYNC WITH SEMANTIC MATCHING)
  const groundingMetrics = await computeGroundingScore(response, chunks);
  
  // Convert to GroundingResult format (for compatibility)
  const grounding = {
    ok: groundingMetrics.isPassing,
    score: groundingMetrics.score,
    unmappedSentences: groundingMetrics.ungroundedSpans,
    mappedCount: groundingMetrics.groundedTokens,
    totalSentences: groundingMetrics.totalTokens,
  };
  
  if (!groundingMetrics.isPassing) {
    errors.push(
      `Grounding score ${(groundingMetrics.score * 100).toFixed(1)}% below threshold (${GROUNDING_THRESHOLD * 100}%)`
    );
    requiresEscalation = true;
  }

  // Step 2: Citation Validation
  const citationValidation = validateCitations(citations, chunks);
  if (!citationValidation.valid) {
    const citationErrors = citationValidation.invalidCitations
      .map(ic => `${ic.reason} (chunk: ${ic.citation.chunkId})`)
      .join('; ');
    errors.push(`Invalid citations: ${citationErrors}`);
    
    // Invalid citations also trigger escalation
    if (citationValidation.invalidCitations.length > citations.length * 0.3) {
      // More than 30% of citations invalid
      requiresEscalation = true;
    }
  }

  // Step 3: PII/PHI Detection
  const piiDetection = detectPII(response);
  const piiRedaction = redactPII(response);

  if (piiDetection.hasPII) {
    errors.push(
      `PII detected: ${piiDetection.detected.length} instances (${piiDetection.detected.map(d => d.category).join(', ')})`
    );
  }

  // Step 3.5: Speculation Detection
  const speculation = detectSpeculation(response);
  if (speculation.hasSpeculation) {
    errors.push(
      `Speculative language detected: ${speculation.matches.length} patterns found`
    );
    requiresEscalation = true; // Speculative answers should be escalated or retried
  }

  // Step 4: Determine Overall Validity
  const valid = errors.length === 0 || (piiDetection.hasPII && errors.length === 1);
  // Valid if no errors OR only PII detected (since we redact it)

  return {
    // Required base fields (GroundingResult format)
    grounding,
    pii: {
      hasPII: piiDetection.hasPII,
      redactedText: piiRedaction.redactedText,
      findings: piiDetection.detected.map(d => ({
        type: d.category as PIIType,
        value: d.match,
        span: [d.index, d.index + d.match.length] as [number, number],
        confidence: 1.0,
      })),
    },
    citationsValid: citationValidation.valid,
    shouldEscalate: requiresEscalation,
    issues: errors,
    
    // Extended fields (for enhanced validation)
    valid,
    citations: {
      valid: citationValidation.valid,
      invalidCitations: citationValidation.invalidCitations,
    },
    piiDetected: piiDetection.hasPII,
    piiCategories: piiDetection.detected.map(d => d.category),
    redactedResponse: piiRedaction.redactedText,
    errors,
    requiresEscalation,
    currentTier,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier Escalation Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check Escalation Needed
 * Wrapper around pattern-router's shouldEscalateTier logic
 * 
 * Escalation Triggers:
 * - Grounding score < 70%
 * - > 30% of citations invalid
 * - Current tier not at L3 (max tier)
 * 
 * Note: Actual escalation logic lives in pattern-router.ts
 * This function provides validation-specific context
 */
export function checkEscalationNeeded(
  validationResult: ValidationResult
): boolean {
  if (validationResult.currentTier === 'L3') {
    return false; // Already at max tier
  }

  // Escalate if grounding fails (using .ok from GroundingResult)
  if (!validationResult.grounding.ok) {
    return true;
  }

  // Escalate if too many invalid citations
  if (!validationResult.citationsValid) {
    const invalidCount = validationResult.citations?.invalidCitations.length ?? 0;
    if (invalidCount > 2) {
      // More than 2 invalid citations
      return true;
    }
  }

  return false;
}

/**
 * Format Validation Report
 * Human-readable summary of validation results
 */
export function formatValidationReport(result: ValidationResult): string {
  const lines: string[] = [];
  
  lines.push('=== Validation Report ===');
  lines.push(`Overall: ${result.valid ? '✓ PASS' : '✗ FAIL'}`);
  lines.push('');
  
  // Grounding (use GroundingResult fields)
  lines.push(`Grounding: ${result.grounding.ok ? '✓' : '✗'} ${(result.grounding.score * 100).toFixed(1)}%`);
  lines.push(`  Mapped: ${result.grounding.mappedCount}/${result.grounding.totalSentences} sentences`);
  if (result.grounding.unmappedSentences.length > 0) {
    lines.push(`  Unmapped samples: ${result.grounding.unmappedSentences.slice(0, 5).join(', ')}`);
  }
  lines.push('');
  
  // Citations
  lines.push(`Citations: ${result.citationsValid ? '✓ VALID' : '✗ INVALID'}`);
  if (!result.citationsValid && result.citations) {
    result.citations.invalidCitations.forEach((ic: { citation: Citation; reason: string }) => {
      lines.push(`  - ${ic.reason}`);
    });
  }
  lines.push('');
  
  // PII
  lines.push(`PII Detected: ${result.piiDetected ? '⚠ YES' : '✓ NO'}`);
  if (result.piiDetected && result.piiCategories) {
    lines.push(`  Categories: ${result.piiCategories.join(', ')}`);
  }
  lines.push('');
  
  // Escalation
  if (result.requiresEscalation) {
    lines.push(`⚠ Tier Escalation Required (current: ${result.currentTier})`);
  }
  
  // Errors
  if (result.errors && result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    result.errors.forEach((err: string) => lines.push(`  - ${err}`));
  }
  
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Speculation Detection
// ─────────────────────────────────────────────────────────────────────────────

const SPECULATION_PATTERNS = [
  /\bI think\b/i,
  /\bI believe\b/i,
  /\bprobably\b/i,
  /\btypically\b/i,
  /\bgenerally\b/i,
  /\bin most cases\b/i,
  /\busually\b/i,
  /\bI would assume\b/i,
  /\bI'm not sure\b/i,
  /\bI'm not certain\b/i,
  /\bit's likely\b/i,
  /\bmight be available\b/i,
];

/**
 * Detect speculative/hedging language in LLM responses.
 * Insurance/benefits answers must be factual, not speculative.
 */
export function detectSpeculation(response: string): {
  hasSpeculation: boolean;
  matches: string[];
} {
  const matches = SPECULATION_PATTERNS
    .filter(p => p.test(response))
    .map(p => p.toString());
  return { hasSpeculation: matches.length > 0, matches };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  GROUNDING_THRESHOLD,
  MIN_CITATION_LENGTH,
  PII_PATTERNS,
  REDACTION_MASKS,
};
