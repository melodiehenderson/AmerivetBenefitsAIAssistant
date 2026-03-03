/**
 * Multi-Stage Validation Pipeline for RAG
 * 
 * Three gates:
 * 1. Retrieval Gate - RRF score validation with query expansion fallback
 * 2. Reasoning Gate - Chain of Thought context validation
 * 3. Output Gate - Faithfulness check with specific alternatives
 */

import type { Chunk } from '@/types/rag';

// ============================================================================
// ValidationResult Type (Used by all gates)
// ============================================================================

export interface ValidationResult {
  score: number;       // 0.0 - 1.0
  passed: boolean;     // Did it pass the gate?
  reason: string;      // Human-readable explanation
  stage: 'retrieval' | 'reasoning' | 'output';
  metadata?: Record<string, any>;
}

export interface PipelineResult {
  retrieval: ValidationResult;
  reasoning: ValidationResult;
  output: ValidationResult;
  overallPassed: boolean;
  suggestedAction?: 'proceed' | 'expand_query' | 'offer_alternative' | 'ask_clarification';
  alternativeOffer?: string;
}

// ============================================================================
// Gate 1: RETRIEVAL VALIDATION (RRF Score Check)
// ============================================================================

const RETRIEVAL_THRESHOLDS = {
  HIGH: 0.7,    // Confident match
  MEDIUM: 0.4,  // Usable with disclaimer
  LOW: 0.2,     // Trigger query expansion
};

export interface RetrievalValidationInput {
  chunks: Chunk[];
  rrfScores: number[];
  bm25Scores: number[];
  vectorScores: number[];
  query: string;
}

export function validateRetrieval(input: RetrievalValidationInput): ValidationResult {
  const { chunks, rrfScores, bm25Scores, vectorScores, query } = input;
  
  // No results at all
  if (!chunks.length) {
    return {
      score: 0,
      passed: false,
      reason: `No documents found for query: "${query.substring(0, 50)}..."`,
      stage: 'retrieval',
      metadata: { resultCount: 0, action: 'expand_query' }
    };
  }
  
  // Calculate combined confidence from RRF scores
  const avgRRF = rrfScores.length > 0 
    ? rrfScores.reduce((a, b) => a + b, 0) / rrfScores.length 
    : 0;
  const maxRRF = rrfScores.length > 0 ? Math.max(...rrfScores) : 0;
  
  // Check BM25 keyword coverage
  const bm25HitCount = bm25Scores.filter(s => s > 0).length;
  const hasBM25Hits = bm25HitCount > 0;
  
  // Check vector semantic relevance
  const vectorAboveThreshold = vectorScores.filter(s => s > 0.5).length;
  const hasSemanticRelevance = vectorAboveThreshold > 0;
  
  // Combined confidence score (weighted)
  const confidenceScore = (maxRRF * 0.5) + (avgRRF * 0.3) + 
    (hasBM25Hits ? 0.1 : 0) + (hasSemanticRelevance ? 0.1 : 0);
  
  // Determine pass/fail and reason
  if (confidenceScore >= RETRIEVAL_THRESHOLDS.HIGH) {
    return {
      score: confidenceScore,
      passed: true,
      reason: `High confidence match (${(confidenceScore * 100).toFixed(0)}%). Found ${chunks.length} relevant documents.`,
      stage: 'retrieval',
      metadata: { 
        resultCount: chunks.length, 
        bm25Hits: bm25HitCount,
        semanticHits: vectorAboveThreshold,
        tier: 'HIGH'
      }
    };
  }
  
  if (confidenceScore >= RETRIEVAL_THRESHOLDS.MEDIUM) {
    return {
      score: confidenceScore,
      passed: true,
      reason: `Moderate confidence (${(confidenceScore * 100).toFixed(0)}%). Found ${chunks.length} potentially relevant documents.`,
      stage: 'retrieval',
      metadata: { 
        resultCount: chunks.length, 
        bm25Hits: bm25HitCount,
        semanticHits: vectorAboveThreshold,
        tier: 'MEDIUM',
        needsDisclaimer: true
      }
    };
  }
  
  if (confidenceScore >= RETRIEVAL_THRESHOLDS.LOW) {
    return {
      score: confidenceScore,
      passed: true, // Pass but trigger expansion
      reason: `Low confidence (${(confidenceScore * 100).toFixed(0)}%). Query expansion recommended.`,
      stage: 'retrieval',
      metadata: { 
        resultCount: chunks.length, 
        tier: 'LOW',
        action: 'expand_query',
        needsDisclaimer: true
      }
    };
  }
  
  // Very low confidence
  return {
    score: confidenceScore,
    passed: false,
    reason: `Very low relevance (${(confidenceScore * 100).toFixed(0)}%). Consider broadening search.`,
    stage: 'retrieval',
    metadata: { resultCount: chunks.length, action: 'expand_query' }
  };
}

// ============================================================================
// Gate 2: REASONING VALIDATION (Chain of Thought Context Check)
// ============================================================================

export interface ReasoningValidationInput {
  chunks: Chunk[];
  userState: string | null;
  userAge: number | null;
  requestedCategory: string | null; // e.g., "Medical", "Dental"
}

export function validateReasoning(input: ReasoningValidationInput): ValidationResult {
  const { chunks, userState, userAge, requestedCategory } = input;
  
  if (!chunks.length) {
    return {
      score: 0,
      passed: false,
      reason: 'No context available for reasoning validation.',
      stage: 'reasoning'
    };
  }
  
  // Chain of Thought validation
  const allContent = chunks.map(c => c.content.toLowerCase()).join(' ');
  
  // Check 1: Does context mention the user's state?
  const stateCheck = userState 
    ? allContent.includes(userState.toLowerCase()) || 
      allContent.includes('national') || 
      allContent.includes('all states')
    : true;
  
  // Check 2: Does context contain age-relevant information?
  const ageCheck = userAge
    ? allContent.includes('age') || 
      allContent.includes('eligibility') ||
      allContent.includes(`${userAge}`) ||
      !allContent.includes('age restriction') // No age restriction mentioned = OK
    : true;
  
  // Check 3: Does context match requested category?
  const categoryKeywords: Record<string, string[]> = {
    'Medical': ['medical', 'health', 'hmo', 'ppo', 'deductible', 'copay', 'prescription'],
    'Dental': ['dental', 'teeth', 'orthodontic', 'cleaning', 'oral'],
    'Vision': ['vision', 'eye', 'glasses', 'contacts', 'optometrist'],
    'Life': ['life insurance', 'death benefit', 'beneficiary', 'ad&d'],
    'Disability': ['disability', 'std', 'ltd', 'income protection'],
    'Voluntary': ['voluntary', 'critical illness', 'accident', 'supplemental'],
  };
  
  let categoryCheck = true;
  const foundCategories: string[] = [];
  
  if (requestedCategory && categoryKeywords[requestedCategory]) {
    const keywords = categoryKeywords[requestedCategory];
    categoryCheck = keywords.some(kw => allContent.includes(kw));
    
    // Also check what categories ARE present (for alternatives)
    for (const [cat, kws] of Object.entries(categoryKeywords)) {
      if (kws.some(kw => allContent.includes(kw))) {
        foundCategories.push(cat);
      }
    }
  }
  
  // Calculate reasoning score
  const checks = [
    { name: 'state', passed: stateCheck, weight: 0.3 },
    { name: 'age', passed: ageCheck, weight: 0.2 },
    { name: 'category', passed: categoryCheck, weight: 0.5 },
  ];
  
  const score = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const failedChecks = checks.filter(c => !c.passed).map(c => c.name);
  
  if (score >= 0.8) {
    return {
      score,
      passed: true,
      reason: `Context validated. Found relevant information for ${userState || 'user'} (${requestedCategory || 'benefits'}).`,
      stage: 'reasoning',
      metadata: { stateCheck, ageCheck, categoryCheck, foundCategories }
    };
  }
  
  if (score >= 0.5) {
    return {
      score,
      passed: true,
      reason: `Partial context match. Missing: ${failedChecks.join(', ')}. Found categories: ${foundCategories.join(', ') || 'general'}.`,
      stage: 'reasoning',
      metadata: { 
        stateCheck, ageCheck, categoryCheck, 
        foundCategories,
        missingChecks: failedChecks,
        needsDisclaimer: true
      }
    };
  }
  
  // Build alternative suggestion
  const alternative = foundCategories.length > 0 && !categoryCheck
    ? `I found information about ${foundCategories.join(' and ')}, but not ${requestedCategory}.`
    : null;
  
  return {
    score,
    passed: false,
    reason: `Context validation failed. Checks failed: ${failedChecks.join(', ')}.`,
    stage: 'reasoning',
    metadata: { 
      stateCheck, ageCheck, categoryCheck, 
      foundCategories,
      alternativeSuggestion: alternative
    }
  };
}

// ============================================================================
// Gate 3: OUTPUT VALIDATION (Faithfulness & Citation Check)
// ============================================================================

export interface OutputValidationInput {
  generatedAnswer: string;
  chunks: Chunk[];
  userState: string | null;
  requestedCategory: string | null;
}

export function validateOutput(input: OutputValidationInput): ValidationResult {
  const { generatedAnswer, chunks, userState, requestedCategory } = input;
  
  const answer = generatedAnswer.toLowerCase();
  
  // Check 1: Does the answer cite specific sources?
  const hasCitation = /source|document|plan|according to|based on/.test(answer);
  
  // Check 2: Does the answer mention specific plan details?
  const hasSpecifics = /\$[\d,]+|percent|deductible|copay|premium|coverage/.test(answer);
  
  // Check 3: Does the answer avoid generic uncertainty phrases?
  const uncertaintyPhrases = [
    "i'm not 100% sure",
    "i'm not sure",
    "i don't have information",
    "i couldn't find",
    "i can't determine"
  ];
  const hasUncertainty = uncertaintyPhrases.some(p => answer.includes(p));
  
  // Check 4: Does the answer address the user's state?
  const addressesState = userState 
    ? answer.includes(userState.toLowerCase()) || 
      answer.includes('your state') ||
      answer.includes('in your area')
    : true;
  
  // Check 5: Does the answer provide actionable alternatives if needed?
  const hasAlternative = /would you like|alternatively|instead|other option|also available/.test(answer);
  
  // Calculate faithfulness score
  const score = (
    (hasCitation ? 0.25 : 0) +
    (hasSpecifics ? 0.25 : 0) +
    (!hasUncertainty ? 0.25 : 0) +
    (addressesState ? 0.15 : 0) +
    (hasAlternative || !hasUncertainty ? 0.1 : 0)
  );
  
  // Determine what categories are available for alternatives
  const availableCategories = new Set<string>();
  for (const chunk of chunks) {
    const content = chunk.content.toLowerCase();
    if (/medical|health|hmo|ppo/.test(content)) availableCategories.add('Medical');
    if (/dental|teeth/.test(content)) availableCategories.add('Dental');
    if (/vision|eye/.test(content)) availableCategories.add('Vision');
    if (/life|death benefit/.test(content)) availableCategories.add('Life');
    if (/disability|std|ltd/.test(content)) availableCategories.add('Disability');
  }
  
  if (score >= 0.7) {
    return {
      score,
      passed: true,
      reason: 'Output is faithful and well-grounded in context.',
      stage: 'output',
      metadata: { hasCitation, hasSpecifics, hasUncertainty, addressesState }
    };
  }
  
  if (score >= 0.4) {
    return {
      score,
      passed: true,
      reason: 'Output is partially grounded. Consider adding more specific details.',
      stage: 'output',
      metadata: { 
        hasCitation, hasSpecifics, hasUncertainty, addressesState,
        needsEnhancement: true,
        availableCategories: Array.from(availableCategories)
      }
    };
  }
  
  // Build alternative offer
  const altCategories = Array.from(availableCategories).filter(c => c !== requestedCategory);
  const alternativeOffer = altCategories.length > 0
    ? `I found information about ${altCategories.join(' and ')}. Would you like to explore those instead?`
    : 'Would you like me to search for a different benefit type?';
  
  return {
    score,
    passed: false,
    reason: 'Output lacks grounding. Generic response detected.',
    stage: 'output',
    metadata: { 
      hasCitation, hasSpecifics, hasUncertainty, addressesState,
      alternativeOffer,
      availableCategories: Array.from(availableCategories)
    }
  };
}

// ============================================================================
// Full Pipeline Execution
// ============================================================================

export interface PipelineInput {
  // Retrieval inputs
  chunks: Chunk[];
  rrfScores: number[];
  bm25Scores: number[];
  vectorScores: number[];
  query: string;
  
  // Reasoning inputs
  userState: string | null;
  userAge: number | null;
  requestedCategory: string | null;
  
  // Output inputs (optional - only for post-generation validation)
  generatedAnswer?: string;
}

export function runValidationPipeline(input: PipelineInput): PipelineResult {
  // Gate 1: Retrieval
  const retrievalResult = validateRetrieval({
    chunks: input.chunks,
    rrfScores: input.rrfScores,
    bm25Scores: input.bm25Scores,
    vectorScores: input.vectorScores,
    query: input.query,
  });
  
  // Gate 2: Reasoning
  const reasoningResult = validateReasoning({
    chunks: input.chunks,
    userState: input.userState,
    userAge: input.userAge,
    requestedCategory: input.requestedCategory,
  });
  
  // Gate 3: Output (if answer provided)
  const outputResult = input.generatedAnswer
    ? validateOutput({
        generatedAnswer: input.generatedAnswer,
        chunks: input.chunks,
        userState: input.userState,
        requestedCategory: input.requestedCategory,
      })
    : {
        score: 1,
        passed: true,
        reason: 'Output validation skipped (no answer provided yet).',
        stage: 'output' as const,
      };
  
  // Determine overall pass and suggested action
  const overallPassed = retrievalResult.passed && reasoningResult.passed;
  
  let suggestedAction: PipelineResult['suggestedAction'] = 'proceed';
  let alternativeOffer: string | undefined;
  
  if (!retrievalResult.passed || retrievalResult.metadata?.action === 'expand_query') {
    suggestedAction = 'expand_query';
  } else if (!reasoningResult.passed) {
    const foundCats = reasoningResult.metadata?.foundCategories as string[] | undefined;
    if (foundCats && foundCats.length > 0 && input.requestedCategory) {
      suggestedAction = 'offer_alternative';
      alternativeOffer = `I found ${foundCats.join(' and ')} plans, but not ${input.requestedCategory}. Would you like to see those?`;
    } else {
      suggestedAction = 'ask_clarification';
    }
  } else if (reasoningResult.metadata?.needsDisclaimer) {
    suggestedAction = 'proceed'; // But with disclaimer
  }
  
  // Log pipeline results
  console.log(`[VALIDATION] Retrieval: ${retrievalResult.passed ? '✅' : '❌'} (${(retrievalResult.score * 100).toFixed(0)}%) - ${retrievalResult.reason}`);
  console.log(`[VALIDATION] Reasoning: ${reasoningResult.passed ? '✅' : '❌'} (${(reasoningResult.score * 100).toFixed(0)}%) - ${reasoningResult.reason}`);
  if (input.generatedAnswer) {
    console.log(`[VALIDATION] Output: ${outputResult.passed ? '✅' : '❌'} (${(outputResult.score * 100).toFixed(0)}%) - ${outputResult.reason}`);
  }
  
  return {
    retrieval: retrievalResult,
    reasoning: reasoningResult,
    output: outputResult,
    overallPassed,
    suggestedAction,
    alternativeOffer,
  };
}

// ============================================================================
// Helper: Generate Alternative Response
// ============================================================================

export function generateAlternativeResponse(
  pipelineResult: PipelineResult,
  requestedCategory: string | null,
  userState: string | null
): string {
  const { suggestedAction, alternativeOffer, reasoning } = pipelineResult;

  if (alternativeOffer) {
    return alternativeOffer;
  }

  const foundCategories = reasoning.metadata?.foundCategories as string[] | undefined;

  switch (suggestedAction) {
    case 'offer_alternative':
      if (foundCategories && foundCategories.length > 0) {
        return `I found information about ${foundCategories.join(' and ')} plans${userState ? ` for ${userState}` : ''}. Would you like to explore those options?`;
      }
      return 'I found some related benefit information. Would you like me to show you what\'s available?';

    case 'ask_clarification':
      return `I want to make sure I find the right plan for you. Are you looking for Medical, Dental, Vision, or another type of benefit?`;

    case 'expand_query':
      return `I'm searching for more options${requestedCategory ? ` related to ${requestedCategory}` : ''}. One moment...`;

    default:
      return 'Let me help you find the right benefit information.';
  }
}

// ============================================================================
// Issue #7 Fix: Chunk-Presence Validation for Specific Claims
// ============================================================================

/**
 * Validate that specific benefit claims are grounded in retrieved chunks.
 * This prevents hallucinations about benefits like orthodontics coverage.
 *
 * E.g., If answer mentions "orthodontics" but no chunk contains "orthodont",
 * remove or flag the claim as ungrounded.
 */
export function validateChunkPresenceForClaims(answer: string, chunks: Chunk[]): {
  valid: boolean;
  ungroundedClaims: string[];
  sanitizedAnswer: string;
} {
  const ungroundedClaims: string[] = [];
  let sanitizedAnswer = answer;

  // Define specific benefit claims that require chunk grounding
  const BENEFIT_CLAIMS: Record<string, RegExp[]> = {
    orthodontics: [/orthodontic/i, /orthodontia/i, /braces coverage/i, /braces benefit/i],
    maternity: [/maternity/i, /pregnancy coverage/i, /prenatal/i, /postnatal/i],
    criticalIllness: [/critical illness/i, /cancer payout/i, /heart attack coverage/i, /stroke benefit/i],
    accident: [/accident insurance/i, /fracture coverage/i, /burn benefit/i],
    hospitalIndemnity: [/hospital indemnity/i, /hospital stay payout/i, /hospitalization cash/i],
  };

  // Combine all chunk content for validation
  const allChunkContent = chunks.map(c => c.content + ' ' + (c.title || '')).join(' ').toLowerCase();

  // Check each benefit claim
  for (const [benefit, patterns] of Object.entries(BENEFIT_CLAIMS)) {
    const answerMentions = patterns.some(pattern => answer.match(pattern));
    const chunkMentions = patterns.some(pattern => allChunkContent.match(pattern));

    if (answerMentions && !chunkMentions) {
      ungroundedClaims.push(benefit);
      console.warn(`[CHUNK_VALIDATION] Ungrounded claim detected: ${benefit}`);
    }
  }

  // Remove or flag ungrounded claims
  if (ungroundedClaims.length > 0) {
    for (const claim of ungroundedClaims) {
      // Remove specific sentences mentioning the ungrounded benefit
      const patterns = BENEFIT_CLAIMS[claim];
      for (const pattern of patterns) {
        // Simple removal: replace sentences containing the pattern
        sanitizedAnswer = sanitizedAnswer.replace(new RegExp(`[^.]*${pattern.source}[^.]*\\.?`, 'gi'), '');
      }
    }

    // Clean up extra whitespace
    sanitizedAnswer = sanitizedAnswer.replace(/\s+/g, ' ').trim();

    // Add disclaimer if we removed content
    if (sanitizedAnswer.length < answer.length * 0.8) {
      sanitizedAnswer += '\n\n**Note:** For detailed coverage information, please check your benefits enrollment portal.';
    }
  }

  return {
    valid: ungroundedClaims.length === 0,
    ungroundedClaims,
    sanitizedAnswer
  };
}
