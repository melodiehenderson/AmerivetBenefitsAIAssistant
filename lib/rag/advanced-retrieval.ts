/**
 * Advanced Multi-Stage RAG Pipeline
 * Features: Query Expansion, Hybrid Search with RRF, Re-ranking, Self-Correction
 */

import { azureOpenAIService } from '@/lib/azure/openai';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import type { RetrievalContext, RetrievalResult, Chunk } from '@/types/rag';

const MIN_RELEVANCE_SCORE = 0.75; // The "Confidence Gate"
const MAX_RETRIES = 2; // Prevent infinite loops
const RERANK_TOP_K = 10; // Rerank top 10 candidates

export interface AdvancedRetrievalResult {
  chunks: Chunk[];
  usedQuery: string;
  status: 'SUCCESS' | 'FAILED';
  attempt: number;
  confidence: number;
}

// ============================================================================
// STEP 1: QUERY EXPANSION & REWRITING
// ============================================================================
async function expandQuery(userQuery: string, history: string[], category?: string): Promise<string[]> {
  // Uses LLM to generate synonyms and resolve pronouns based on history
  const categoryContext = category ? `Focus on ${category} benefits.` : '';
  const historyContext = history.length > 0 ? `Recent conversation: ${history.slice(-2).join('; ')}` : '';
  
  const prompt = `You are a benefits search query optimizer.

User's latest query: "${userQuery}"
${historyContext}
${categoryContext}

Task: Generate 3 optimized variations of this query for benefits document search.
1. De-reference pronouns (replace "it", "that", "they" with specific benefit names)
2. Add missing domain keywords (e.g., "medical coverage", "dental benefits", "plan details")
3. Keep one variation close to the original but with better keywords

Focus on terms like: coverage, deductible, copay, premium, network, provider, enrollment, eligibility

Return ONLY a JSON array of 3 strings: ["query1", "query2", "query3"]`;

  try {
    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: 'You are a search query optimizer. Return only valid JSON arrays.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.3 });

    const response = completion.content.trim();
    // Clean up response in case LLM adds extra text
    const jsonMatch = response.match(/\[.*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Fallback if parsing fails
    return [userQuery, userQuery + " benefits coverage", userQuery + " plan details"];
  } catch (error) {
    console.error('[Query Expansion] Error:', error);
    // Fallback to manual expansion
    return [
      userQuery,
      userQuery + " benefits coverage", 
      userQuery + " plan details"
    ];
  }
}

// ============================================================================
// STEP 2: RECIPROCAL RANK FUSION (RRF)
// ============================================================================
function fuseResults(resultSets: Chunk[][], k = 60): Chunk[] {
  const scores = new Map<string, number>();
  const chunkMap = new Map<string, Chunk>();

  // Add RRF scores: 1 / (k + rank)
  resultSets.forEach(results => {
    results.forEach((chunk, index) => {
      const currentScore = scores.get(chunk.id) || 0;
      const rrfScore = 1 / (k + index + 1);
      scores.set(chunk.id, currentScore + rrfScore);
      chunkMap.set(chunk.id, chunk);
    });
  });

  // Sort by merged RRF score and add final score to chunks
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => {
      const chunk = chunkMap.get(id)!;
      return {
        ...chunk,
        score: Math.min(score * 2, 1.0), // Normalize and cap at 1.0
        metadata: {
          ...chunk.metadata,
          rrfScore: score
        }
      };
    });
}

// ============================================================================
// STEP 3: LLM-BASED RE-RANKING
// ============================================================================
async function rerankResults(query: string, docs: Chunk[], topK = 5): Promise<Chunk[]> {
  if (docs.length === 0) return [];
  if (docs.length <= topK) return docs; // No need to rerank if we have fewer than topK
  
  const candidates = docs.slice(0, RERANK_TOP_K).map((d, i) => {
    const preview = d.content.substring(0, 150).replace(/\n/g, ' ');
    return `[${i}] ${d.title || 'Document'}: ${preview}...`;
  }).join('\n\n');
  
  const prompt = `Query: "${query}"

Rank these benefit documents by relevance to the user's question. Consider:
- Direct answers to the question
- Specific plan details mentioned
- Relevant coverage information
- Cost/pricing details if asked

Return ONLY the IDs (0-9) of the top ${topK} most relevant documents as a JSON array.
If fewer than ${topK} documents are relevant, return fewer IDs.

Documents:
${candidates}`;

  try {
    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: 'You are a document relevance ranker. Return only JSON arrays of numbers.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.1 });

    const response = completion.content.trim();
    const jsonMatch = response.match(/\[[\d,\s]*\]/);
    
    if (jsonMatch) {
      const topIndices = JSON.parse(jsonMatch[0]).filter((idx: number) => idx < docs.length);
      const rerankedChunks = topIndices.map((idx: number) => docs[idx]);
      
      // Add rerank scores based on position
      return rerankedChunks.map((chunk: any, index: number) => ({
        ...chunk,
        score: Math.max(chunk.score || 0, 0.9 - (index * 0.1)), // Boost reranked items
        metadata: {
          ...chunk.metadata,
          rerankPosition: index + 1
        }
      }));
    }
    
    // Fallback: return top items by current score
    return docs.slice(0, topK);
  } catch (error) {
    console.error('[Re-ranking] Error:', error);
    return docs.slice(0, topK);
  }
}

// ============================================================================
// STEP 4: QUERY REWRITING FOR FAILED SEARCHES
// ============================================================================
async function rewriteFailedQuery(
  originalQuery: string, 
  failedQueries: string[], 
  foundTopics: string[]
): Promise<string> {
  const prompt = `The user asked: "${originalQuery}"

We tried searching with: ${failedQueries.map(q => `"${q}"`).join(', ')}

We found some results about: ${foundTopics.length > 0 ? foundTopics.join(', ') : 'unrelated topics'}

Problem: Results are not relevant enough to answer the user's question.

Write ONE specific, keyword-rich search query that would better find the answer. Focus on:
- Specific benefit types (medical, dental, vision, life, disability)
- Key terms (coverage, deductible, copay, premium, network, enrollment)
- Plan names or codes if mentioned

Return only the rewritten query, nothing else.`;

  try {
    const completion = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: 'You are a search query rewriter. Return only the improved query.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.3 });

    return completion.content.trim().replace(/^["']|["']$/g, ''); // Remove quotes
  } catch (error) {
    console.error('[Query Rewrite] Error:', error);
    // Fallback: add generic benefit terms
    return originalQuery + " benefits coverage details";
  }
}

// ============================================================================
// MASTER ORCHESTRATOR: ADVANCED RETRIEVAL PIPELINE
// ============================================================================
export async function advancedRetrieve(
  originalQuery: string, 
  context: RetrievalContext,
  history: string[] = []
): Promise<AdvancedRetrievalResult> {
  let currentQuery = originalQuery;
  let queriesToRun = [originalQuery];
  let attempt = 0;
  const allFailedQueries: string[] = [];

  console.log(`[Advanced RAG] Starting pipeline for: "${originalQuery}"`);

  while (attempt <= MAX_RETRIES) {
    console.log(`[Advanced RAG] Attempt ${attempt + 1}: "${currentQuery}"`);

    try {
      // 1. QUERY EXPANSION (Only on first attempt or after rewrite)
      if (attempt === 0) {
        queriesToRun = await expandQuery(currentQuery, history, context.category);
        console.log(`[Advanced RAG] Expanded queries:`, queriesToRun);
      } else {
        queriesToRun = [currentQuery]; // Use rewritten query only
      }

      // 2. PARALLEL HYBRID SEARCH for all query variations
      const searchPromises = queriesToRun.map(async (query) => {
        const result = await hybridRetrieve(query, context);
        return result.chunks || [];
      });

      const allResultSets = await Promise.all(searchPromises);
      const allResults = allResultSets.filter(results => results.length > 0);

      if (allResults.length === 0) {
        console.warn(`[Advanced RAG] No results found for any query variation`);
        allFailedQueries.push(...queriesToRun);
        attempt++;
        continue;
      }

      // 3. RRF FUSION of all result sets
      const fusedResults = fuseResults(allResults);
      console.log(`[Advanced RAG] Fused ${fusedResults.length} unique results`);

      // 4. RE-RANKING
      const rankedResults = await rerankResults(currentQuery, fusedResults, 8);
      const topMatch = rankedResults[0];
      const confidence = topMatch?.score || 0;

      console.log(`[Advanced RAG] Top result confidence: ${confidence.toFixed(3)}`);

      // 5. CONFIDENCE GATE
      if (confidence >= MIN_RELEVANCE_SCORE) {
        return {
          chunks: rankedResults,
          usedQuery: currentQuery,
          status: 'SUCCESS',
          attempt: attempt + 1,
          confidence
        };
      }

      // 6. FAILED CONFIDENCE - PREPARE FOR RETRY
      allFailedQueries.push(...queriesToRun);
      
      if (attempt < MAX_RETRIES) {
        // Extract topics from failed results for context
        const foundTopics = rankedResults
          .slice(0, 3)
          .map(r => r.metadata.docType || r.title)
          .filter(Boolean);

        currentQuery = await rewriteFailedQuery(originalQuery, allFailedQueries, foundTopics);
        console.log(`[Advanced RAG] Rewritten query: "${currentQuery}"`);
      }

      attempt++;
    } catch (error) {
      console.error(`[Advanced RAG] Error in attempt ${attempt + 1}:`, error);
      attempt++;
    }
  }

  // Final fallback after all retries failed
  console.warn(`[Advanced RAG] All attempts failed for: "${originalQuery}"`);
  return {
    chunks: [],
    usedQuery: currentQuery,
    status: 'FAILED',
    attempt: MAX_RETRIES + 1,
    confidence: 0
  };
}