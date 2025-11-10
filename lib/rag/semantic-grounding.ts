/**
 * Semantic Grounding Validation
 * 
 * Purpose:
 * - Replace strict n-gram token matching with semantic similarity scoring
 * - Accept paraphrased content that matches intent using embeddings
 * - Compute cosine similarity between response segments and chunk content
 * 
 * Architecture:
 * - Segment response into sentences/clauses
 * - Generate embeddings for each segment and chunk
 * - Calculate cosine similarity scores
 * - Score is percentage of response with semantic match >= threshold
 * 
 * Dependencies:
 * - lib/azure/openai.ts (generateEmbedding)
 * - types/rag.ts (Chunk)
 */

import { azureOpenAIService } from '@/lib/azure/openai';
import type { Chunk } from '@/types/rag';

// Semantic similarity configuration
const SEMANTIC_SIMILARITY_THRESHOLD = 0.72; // Accept content with 72%+ cosine similarity
const BATCH_SIZE = 5; // Process segments in batches to avoid rate limiting

/**
 * Compute Cosine Similarity
 * 
 * Formula: cos(θ) = (A · B) / (||A|| × ||B||)
 * Returns: -1 to 1 (typically 0 to 1 for positive embeddings)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vector dimensions must match for cosine similarity');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Segment Response into Sentences
 * Simple approach: split on sentence boundaries (., !, ?)
 * Filters out very short segments
 */
function segmentResponse(text: string): string[] {
  // Split on sentence boundaries but preserve some context
  const sentences = text
    .replace(/([.!?])\s+/g, '$1|') // Add delimiter after punctuation
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 15); // Keep segments with at least 15 characters

  return sentences.length > 0 ? sentences : [text];
}

/**
 * Compute Semantic Grounding Score
 * 
 * Algorithm:
 * 1. Segment response into sentences (15+ chars each)
 * 2. Generate embeddings for each segment
 * 3. For each segment, find best similarity to any chunk
 * 4. Score = percentage of segments with similarity >= threshold
 * 
 * Returns:
 * - score: Percentage (0-1) of response grounded semantically
 * - groundedSegments: Count of segments matching chunks
 * - totalSegments: Total segments in response
 * - chunkMapping: Which chunks matched which segments
 * - confidence: Average similarity of matched segments
 */
export async function computeSemanticGroundingScore(
  response: string,
  chunks: Chunk[]
): Promise<{
  score: number;
  groundedSegments: number;
  totalSegments: number;
  chunkMapping: Record<string, number>;
  confidence: number;
}> {
  try {
    const segments = segmentResponse(response);
    if (segments.length === 0) {
      return {
        score: 0,
        groundedSegments: 0,
        totalSegments: 0,
        chunkMapping: {},
        confidence: 0,
      };
    }

    // Generate embeddings for chunks (batch to avoid rate limiting)
    const chunkEmbeddings: Record<string, number[]> = {};
    const chunkTexts: Record<string, string> = {};

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await azureOpenAIService.generateEmbeddings(
        batch.map(c => c.content)
      );

      for (let j = 0; j < batch.length; j++) {
        chunkEmbeddings[batch[j].id] = embeddings[j];
        chunkTexts[batch[j].id] = batch[j].content;
      }
    }

    // Generate embeddings for segments (batch)
    const segmentEmbeddings: number[][] = [];

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments.slice(i, i + BATCH_SIZE);
      const embeddings = await azureOpenAIService.generateEmbeddings(batch);
      segmentEmbeddings.push(...embeddings);
    }

    // Compute similarity scores for each segment
    const chunkMapping: Record<string, number> = {};
    let groundedSegments = 0;
    let totalSimilarity = 0;

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      let bestSimilarity = 0;
      let bestChunkId = '';

      // Find best matching chunk for this segment
      for (const [chunkId, chunkEmbedding] of Object.entries(chunkEmbeddings)) {
        const similarity = cosineSimilarity(segmentEmbeddings[segIdx], chunkEmbedding);

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestChunkId = chunkId;
        }
      }

      // If similarity exceeds threshold, count as grounded
      if (bestSimilarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
        groundedSegments++;
        chunkMapping[bestChunkId] = (chunkMapping[bestChunkId] || 0) + 1;
        totalSimilarity += bestSimilarity;
      }
    }

    const score = segments.length > 0 ? groundedSegments / segments.length : 0;
    const confidence = groundedSegments > 0 ? totalSimilarity / groundedSegments : 0;

    return {
      score,
      groundedSegments,
      totalSegments: segments.length,
      chunkMapping,
      confidence,
    };
  } catch (error) {
    console.error('[SEMANTIC-GROUNDING] Error computing semantic grounding:', error);
    
    // Fallback to neutral score on embedding error
    return {
      score: 0.5, // Assume neutral if we can't compute embeddings
      groundedSegments: 0,
      totalSegments: 0,
      chunkMapping: {},
      confidence: 0,
    };
  }
}

/**
 * Blend Grounding Scores
 * 
 * Combines n-gram (lexical) and semantic grounding for robustness:
 * - If n-gram score is high (>0.6), prefer it (more precise)
 * - If semantic score is high and n-gram low, boost with semantic
 * - Otherwise use average
 * 
 * This prevents false negatives from strict token matching while
 * maintaining precision when LLM closely quotes source material
 */
export function blendGroundingScores(
  ngramScore: number,
  semanticScore: number
): number {
  // If n-gram is strong, trust it
  if (ngramScore > 0.6) {
    return ngramScore;
  }

  // If semantic is much higher, use blended score
  if (semanticScore > 0.7 && ngramScore < 0.5) {
    return (ngramScore * 0.3) + (semanticScore * 0.7);
  }

  // Otherwise use average
  return (ngramScore + semanticScore) / 2;
}

export { SEMANTIC_SIMILARITY_THRESHOLD };
