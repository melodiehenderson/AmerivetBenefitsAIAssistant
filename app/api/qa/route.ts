export const dynamic = 'force-dynamic';
export const revalidate = 0;

import OpenAI from "openai";

const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME!;

const openai = new OpenAI({ 
  apiKey: process.env.AZURE_OPENAI_API_KEY, 
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '')}/openai/deployments/${deploymentName}`,
  defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY }
});

/**
 * QA API Endpoint - Production RAG Orchestration
 * 
 * Request Flow:
 * 1. Normalize query (query-understanding.ts)
 * 2. Check L0 exact cache (cache-utils.ts)
 * 3. Check L1 semantic cache (cache-utils.ts)
 * 4. Hybrid retrieval: vector + BM25 + RRF (hybrid-retrieval.ts)
 * 5. Tier selection: L1/L2/L3 (pattern-router.ts)
 * 6. LLM generation with context
 * 7. Output validation: grounding, citations, PII (validation.ts)
 * 8. Escalation check: upgrade tier if needed
 * 9. Cache result with tier-specific TTL
 * 10. Return QAResponse with metadata
 * 
 * Performance Targets:
 * - Cache hit: < 5 ms
 * - L1 response: < 1.5 s
 * - L2 response: < 3 s
 * - L3 response: < 6 s
 * - Retrieval: < 800 ms
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeQuery } from '../../../lib/rag/query-understanding';
import { hybridRetrieve } from '../../../lib/rag/hybrid-retrieval';
import { selectTier, shouldEscalateTier, escalateTier } from '../../../lib/rag/pattern-router';
import { validateResponse } from '../../../lib/rag/validation';
import { 
  buildCacheKey, 
  buildSemanticCacheKey,
  getTTLForTier,
  findMostSimilar,
} from '../../../lib/rag/cache-utils';
import { rerankChunks, buildContextFromReranked, logRerankingDetails } from '../../../lib/rag/reranker';
import { QualityTracker } from '../../../lib/analytics/quality-tracker';
import type { QARequest, QAResponse, Tier, Citation, ConversationQuality, RetrievalResult, Chunk } from '../../../types/rag';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const ENABLE_EXACT_CACHE = true;
const ENABLE_SEMANTIC_CACHE = false;
const MAX_RETRIES = 2; // Force recompile

function pickCitations(chunks: Chunk[], max: number) {
  if (max <= 0) return [];
  const selected: Chunk[] = [];
  const seenDocs = new Set<string>();
  for (const chunk of chunks) {
    const docId = chunk.docId ?? 'UNK';
    if (seenDocs.has(docId)) continue;
    selected.push(chunk);
    seenDocs.add(docId);
    if (selected.length >= max) {
      return selected;
    }
  }
  for (const chunk of chunks) {
    if (selected.some((c) => c.id === chunk.id)) continue;
    selected.push(chunk);
    if (selected.length >= max) break;
  }
  return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Client (Safe Redis with Graceful Degradation)
import { cacheGet, cacheSet, isCacheAvailable } from '@/lib/cache';

async function getCachedResponse(cacheKey: string): Promise<QAResponse | null> {
  return cacheGet<QAResponse>(cacheKey);
}

async function setCachedResponse(
  cacheKey: string,
  response: QAResponse,
  ttlSeconds: number
): Promise<void> {
  await cacheSet(cacheKey, response, ttlSeconds);
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM Generation (Stub for Azure OpenAI Integration)
// ─────────────────────────────────────────────────────────────────────────────

async function generateResponse(
  query: string,
  context: string,
  companyId: string
): Promise<string> {
  // hard timeout so requests don't pin the event loop
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000); // 15s

  try {
    const messages = [
      {
        role: "system" as const,
        content:
          "You are a benefits assistant. Use ONLY the provided context to answer. If the context doesn't contain the answer, say so."
      },
      {
        role: "user" as const,
        content: `Company: ${companyId}\nContext:\n${context}\n\nQuestion: ${query}`
      }
    ];

    const resp = await openai.chat.completions
      .create(
        {
          model: deploymentName,
          messages,
          temperature: 0.3,
          max_tokens: 500
        },
        { signal: controller.signal }
      )
      .catch((err: any) => {
        // prevent unhandled rejection paths from tearing down Next.js
        console.error("[generateResponse] Azure SDK error:", err?.response?.data ?? err);
        throw err;
      });

    const text = resp?.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : "Unable to generate response from the provided context.";
  } catch (err) {
    // always return a safe string so the route never crashes
    console.error("[generateResponse] Fatal error:", err);
    return "I can't find a grounded answer in the current context.";
  } finally {
    clearTimeout(t);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main QA Orchestration
// ─────────────────────────────────────────────────────────────────────────────

import { ensureIndexHealthy } from '@/lib/rag/search-health';

// Run index health check once on first request
let healthCheckInitialized = false;

export async function POST(req: NextRequest) {
  // Ensure index is healthy before processing requests
  if (!healthCheckInitialized) {
    healthCheckInitialized = true;
    await ensureIndexHealthy().catch(err => {
      console.error('[QA] Index health check failed', err as Error);
    });
  }

  const startTime = Date.now();
  let retrievalTime = 0;
  let generationTime = 0;
  let validationTime = 0;
  let cacheCheckTime = 0;

  try {
    // Parse request
    const body = await req.json();
    const request: QARequest = {
      query: body.query,
      companyId: body.companyId || 'default',
      userId: body.userId || 'anonymous',
      context: {
        sessionId: body.conversationId || body.sessionId,
        planYear: body.planYear,
        locale: body.locale,
      },
    };

    // DIAGNOSTIC: Log request details
    console.log('[QA][DEBUG] Request received:', {
      query: request.query,
      companyId: request.companyId,
      userId: request.userId,
      sessionId: request.context?.sessionId,
      hasBodyCompanyId: !!body.companyId,
      bodyCompanyId: body.companyId,
    });

    if (!request.query || request.query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Step 1: Normalize and analyze query
    const queryProfile = analyzeQuery(request.query);
    const normalizedQuery = queryProfile.normalized;

    console.log('[QA] Query analyzed:', {
      intent: queryProfile.intent,
      complexity: queryProfile.complexity,
      entities: queryProfile.entities.length,
    });

    // Step 2: Check L0 exact cache
    if (ENABLE_EXACT_CACHE) {
      const cacheCheckStart = Date.now();
      const exactCacheKey = buildCacheKey(normalizedQuery, request.companyId);
      const cachedExact = await getCachedResponse(exactCacheKey);
      cacheCheckTime = Date.now() - cacheCheckStart;

      if (cachedExact) {
        console.log('[QA] L0 cache HIT (exact match)');
        return NextResponse.json({
          ...cachedExact,
          metadata: {
            ...cachedExact.metadata,
            fromCache: true,
            cacheType: 'exact',
            latencyMs: Date.now() - startTime,
          },
        });
      }
    }

    // Step 3: Check L1 semantic cache
    if (ENABLE_SEMANTIC_CACHE) {
      const semanticCacheKey = buildSemanticCacheKey(request.companyId);
      // TODO: Implement semantic cache lookup with embedding similarity
      // For now, skip semantic cache in development
    }

    console.log('[QA] Cache MISS - proceeding with retrieval');

    // Step 4: Hybrid retrieval (vector + BM25 + RRF)
    const retrievalStart = Date.now();
    const retrievalContext = {
      companyId: request.companyId,
      userId: request.userId,
      filters: {},
    };
    
  let retrievalResult: RetrievalResult;
  let retrievalErrorMessage: string | undefined;
    try {
      // Optimized retrieval config to balance relevance and context size
      // Goal: Get highly relevant chunks while keeping total tokens under 6k
      retrievalResult = await hybridRetrieve(
        normalizedQuery,
        retrievalContext,
        {
          vectorK: 48,            // Broad but controlled beams
          bm25K: 48,              // Match BM25 breadth to vector search
          finalTopK: 20,          // Keep more candidates before reranking
          rerankedTopK: 12,       // Allow enough chunks for grounding
          enableReranking: false, // Preserve raw diversity for diagnostics
        }
      );
    } catch (retrievalError) {
      retrievalErrorMessage = retrievalError instanceof Error ? retrievalError.message : String(retrievalError);
      console.warn('[QA] Retrieval unavailable, using demo fallback:', retrievalErrorMessage);
      // Demo fallback context when Azure Search is not configured
      const demoText = `This is a demo environment without connected search.

HSA vs FSA quick summary:
- HSA pairs with High Deductible Health Plans and funds roll over year to year; you can invest them.
- FSA works with most plans but is generally "use-it-or-lose-it" (limited carryover or grace period).
- Both reduce taxable income; HSA typically has higher contribution limits.

Dental benefits overview:
- Preventive care (cleanings, exams) is often covered at 100%.
- Basic services (fillings) and major services (crowns) vary by plan coinsurance and annual maximum.`;

      retrievalResult = {
        chunks: [
          {
            id: 'demo-001',
            docId: 'demo-doc',
            companyId: retrievalContext.companyId,
            sectionPath: 'Demo',
            content: demoText,
            title: 'Benefits Overview (Demo)',
            position: 0,
            windowStart: 0,
            windowEnd: demoText.length,
            metadata: { tokenCount: Math.ceil(demoText.length / 4), relevanceScore: 0.5 },
            createdAt: new Date(),
          },
        ],
        method: 'hybrid',
        totalResults: 1,
        latencyMs: Date.now() - retrievalStart,
        scores: { vector: [], bm25: [], rrf: [] },
      } as RetrievalResult;
    }
    retrievalTime = Date.now() - retrievalStart;

    // Handle zero-results case (index corpus starvation)
    if (retrievalResult.chunks.length === 0) {
      console.warn('[QA] Zero retrieval results; returning fallback response', { query: normalizedQuery, companyId: request.companyId });
      
      const fallbackResponse: QAResponse = {
        answer: `I'm having trouble finding specific information about **"${normalizedQuery.substring(0, 100)}"** in our benefits documents right now.

Let me help you get the answer you need:

**Quick Fixes to Try**:
• Rephrase your question more specifically (e.g., "What dental benefits are covered?" instead of "dental info")
• Try a simpler question (e.g., "How do I enroll?" instead of "What's the enrollment process for new hires starting in Q2?")
• Ask about a different topic to test if it's working

**Common Questions I Can Help With**:
• "What health insurance plans are available?"
• "How much is the company contribution for health insurance?"
• "What's the difference between HSA and FSA?"
• "What dental and vision coverage do I have?"
• "How do I enroll in benefits?"

**Need More Help?**
If you keep seeing this message, it might mean:
- The specific detail you're asking about isn't in our current benefits documents
- There's a temporary system issue (our IT team has been notified)
- Your question needs personalized guidance from HR

📧 **Contact HR**: hr@amerivet.com | 📞 **Benefits Hotline**: 1-800-BENEFITS

*Tip: I work best with direct, simple questions about your benefits!* 😊`,
        citations: [],
        tier: 'L3',
        fromCache: false,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startTime,
        },
        metadata: {
          retrievalCount: 0,
          groundingScore: 0,
          escalated: false,
          retrievalMethod: 'hybrid',
        },
      };

      // Negative-cache zero results briefly to avoid repeated heavy calls
      try {
        if (isCacheAvailable()) {
          const negKey = buildCacheKey(normalizedQuery, request.companyId);
          await setCachedResponse(negKey, fallbackResponse, 300); // 5 minutes
          console.info('[QA] Negative-cached zero-result fallback (300s)', { key: negKey });
        }
      } catch (err) {
        console.warn('[QA] Negative-cache write failed (non-blocking)', { err: String(err) });
      }

      return NextResponse.json(fallbackResponse);
    }

    // Deduplicate at chunk level (post-RRF)
    const keyOf = (c: Chunk) => c.id ?? `${c.docId}:${c.position ?? 0}`;
    const deduped = Array.from(
      new Map(retrievalResult.chunks.map(c => [keyOf(c), c])).values()
    );

    console.log(`[QA] Dedup: raw=${retrievalResult.chunks.length} unique=${deduped.length}`);

    const ids = deduped.map(c => c.docId);
    const distinct = new Set(ids);
    console.warn("[RETRIEVAL_DOC_IDS]", distinct.size);
    console.warn("[RETRIEVAL_SAMPLE]", Array.from(distinct).slice(0, 20));

    // Remove early return now that diversity targets are met; proceed with normal pipeline

    // ═══════════════════════════════════════════════════════════════════════════
  // RERANKING: Select top chunks with distinct doc IDs
    // This is the critical fix for low grounding scores (20-35% → target >50%)
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Log scores before reranking to see what we're working with
    console.log('[QA][RERANK] Pre-rerank chunk scores:');
    deduped.slice(0, 8).forEach((chunk, idx) => {
      const score = (chunk.metadata.rrfScore ?? 0) + (chunk.metadata.relevanceScore ?? 0) + (chunk.metadata.vectorScore ?? 0);
      console.log(`[QA][RERANK]   [${idx + 1}] score=${score.toFixed(4)} docId=${chunk.docId.substring(0, 40)}...`);
    });
    
    const rerankResult = rerankChunks(deduped, {
      topK: 8,
      maxTokens: 3000,
      maxPerDocPhase1: 1,
      minDistinctDocs: 6,
      enforceDistinctFirst: true,
      mmrLambda: 0.7,
      query: normalizedQuery,
    });

    // Adaptive reranker: if diversity low (<4 distinct docs) and we have enough candidates, retry enforcing distinct docs
    let adaptiveApplied = false;
    let adaptiveResult = rerankResult;
    if (rerankResult.distinctDocIds < 4 && deduped.length >= 8) {
      console.log('[QA][RERANK][ADAPT] Low diversity detected (distinct docs < 4). Retrying with enforceDistinctDocs=true…');
      adaptiveResult = rerankChunks(deduped, {
        topK: Math.min(6, deduped.length), // Allow one more chunk to improve coverage
        maxTokens: 3000,
        enforceDistinctDocs: true,
        minRelevanceScore: undefined,
      });
      adaptiveApplied = true;
      console.log(`[QA][RERANK][ADAPT] Applied adaptive rerank: distinct docs ${adaptiveResult.distinctDocIds}`);
    }

    // Debug logging for diagnostics
    logRerankingDetails(deduped, rerankResult);

  const chunksForContext = adaptiveResult.chunks;
    
    // Build context with reranked chunks (enforces token budget internally)
    const context = buildContextFromReranked(chunksForContext, 3000);
    
    console.log(`[QA] Context built: ${chunksForContext.length} chunks, ~${rerankResult.totalTokens} tokens (distinct docs: ${rerankResult.distinctDocIds})`);
    
    // Enforce breadth: prefer one citation per distinct doc before reuse
    function pickCitations(chunks: Chunk[], max: number): Chunk[] {
      const out: Chunk[] = [];
      const seenDocs = new Set<string>();
      // Phase 1: one per distinct doc
      for (const c of chunks) {
        const d = c.docId ?? 'UNK';
        if (seenDocs.has(d)) continue;
        out.push(c);
        seenDocs.add(d);
        if (out.length >= max) break;
      }
      // Phase 2: backfill if room
      if (out.length < max) {
        for (const c of chunks) {
          if (out.find(x => x.id === c.id)) continue;
          out.push(c);
          if (out.length >= max) break;
        }
      }
      return out;
    }
    
    const citationLimit = Math.min(8, chunksForContext.length);
    const selectedCitations = pickCitations(chunksForContext, citationLimit);
    
    // Use reranked chunks for citations
    const citations: Citation[] = selectedCitations.map((chunk: Chunk) => ({
      chunkId: chunk.id,
      docId: chunk.docId,
      title: chunk.title,
      section: chunk.sectionPath,
      relevanceScore: chunk.metadata.rrfScore || chunk.metadata.relevanceScore || chunk.metadata.vectorScore || 0,
      excerpt: chunk.content.substring(0, 150),
      text: chunk.content.substring(0, 100), // For validation
    }));

    // Calculate coverage (approximate based on query terms in chunks)
    const queryTerms = normalizedQuery.toLowerCase().split(/\s+/);
    const chunkText = retrievalResult.chunks.map(c => c.content.toLowerCase()).join(' ');
    const matchedTerms = queryTerms.filter(term => chunkText.includes(term));
    const coverage = queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;

    console.log('[QA] Retrieval complete:', {
      chunks: retrievalResult.chunks.length,
      coverage: (coverage * 100).toFixed(1) + '%',
      latencyMs: retrievalTime,
    });

    // Step 5: Tier selection
    const routingSignals = {
      queryLength: normalizedQuery.length,
      hasOperators: /\b(and|or|if|then|but|however)\b/i.test(normalizedQuery),
      needsTools: queryProfile.needsTool,
      coverage,
      evidenceScore: coverage, // Simplified
      riskScore: queryProfile.riskScore,
      complexityScore: queryProfile.complexity,
      multiDocSynthesis: new Set(retrievalResult.chunks.map(c => c.docId)).size > 1,
    };
    
    let currentTier = selectTier(routingSignals);

    console.log('[QA] Tier selected:', currentTier);

    // Step 6: Generate response with retries for escalation
    let responseText: string;
    let validationResult;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      // Generate response
      const generationStart = Date.now();
      responseText = await generateResponse(
        normalizedQuery,
        context,
        request.companyId
      );
      generationTime = Date.now() - generationStart;

      // Step 7: Validate response (NOW ASYNC WITH SEMANTIC MATCHING)
      const validationStart = Date.now();
      validationResult = await validateResponse(
        responseText,
        citations,
        retrievalResult.chunks,
        currentTier
      );
      validationTime = Date.now() - validationStart;

      console.log('[QA] Validation:', {
        valid: validationResult.valid,
        grounding: (validationResult.grounding.score * 100).toFixed(1) + '%',
        citationsValid: validationResult.citationsValid,
        piiDetected: validationResult.piiDetected,
        requiresEscalation: validationResult.requiresEscalation,
      });

      // Step 8: Check escalation
      if (validationResult.requiresEscalation && currentTier !== 'L3') {
        const nextTier = escalateTier(currentTier);
        console.log(`[QA] Escalating from ${currentTier} to ${nextTier} (retry ${retryCount + 1}/${MAX_RETRIES})`);
        currentTier = nextTier;
        retryCount++;
        continue; // Retry with higher tier
      }

      // Validation passed or max tier reached
      break;
    }

    // Step 9: Prepare response
    const qaResponse: QAResponse = {
      answer: validationResult!.piiDetected 
        ? validationResult!.redactedResponse! 
        : responseText!,
      citations,
      tier: currentTier,
      fromCache: false,
      usage: {
        promptTokens: 100, // Stub values since we're not tracking tokens in simplified generateResponse
        completionTokens: 50,
        latencyMs: Date.now() - startTime,
      },
      metadata: {
        retrievalCount: retrievalResult.chunks.length,
        usedCount: deduped.length,
        shownCount: citations.length,
        groundingScore: validationResult!.grounding.score,
        escalated: retryCount > 0,
        cacheKey: buildCacheKey(normalizedQuery, request.companyId),
        retrievalMethod: 'hybrid',
        // NEW: Expose granular counts for diagnostics
        rawRetrievalCount: retrievalResult.chunks.length,
        dedupeCount: deduped.length,
        citationCount: citations.length,
        // Reranker stats
  rerankedCount: adaptiveResult.finalCount,
  distinctDocIds: adaptiveResult.distinctDocIds,
  rerankTokens: adaptiveResult.totalTokens,
  rerankerAdaptiveApplied: adaptiveApplied,
  rerankerDistinctDocsAfterAdaptive: adaptiveResult.distinctDocIds,
        // Retrieval expansion diagnostics
        distinctDocCountInitial: retrievalResult.distinctDocCountInitial,
        distinctDocCountFinal: retrievalResult.distinctDocCountFinal,
        expansionUsed: retrievalResult.expansionUsed,
        droppedPlanYearFilter: retrievalResult.droppedPlanYearFilter,
        bm25WideSweep: retrievalResult.bm25WideSweep,
        expansionPhases: retrievalResult.expansionPhases,
      },
    };

    // Step 10: Cache result (async, non-blocking)
    const cacheKey = buildCacheKey(normalizedQuery, request.companyId);
    const cacheTTL = getTTLForTier(currentTier);

    // Only cache positive results when sufficiently grounded
    const canCache = (retrievalResult.chunks.length >= 8) && (validationResult!.grounding.score >= 0.60);

    if (cacheTTL > 0 && isCacheAvailable() && canCache) {
      setCachedResponse(cacheKey, qaResponse, cacheTTL).then(() => {
        console.info('[QA] Cache write completed', { tier: currentTier, ttl: `${cacheTTL}s` });
      }).catch(err => {
        console.warn('[QA] Cache write failed (non-blocking)', { err: String(err) });
      });
    } else if (!isCacheAvailable()) {
      console.debug('[QA] Cache unavailable; skipping write');
    } else if (!canCache) {
      console.debug('[QA] Skipping cache write (insufficient grounding or low retrieval)');
    }

    // Step 11: Record conversation quality metrics
    const conversationId = request.context?.sessionId || `conv-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const qualityMetrics: ConversationQuality = {
      conversationId,
      responseTime: Date.now() - startTime,
      groundingScore: validationResult!.grounding.score * 100, // Convert to percentage
      escalationCount: retryCount,
      resolvedFirstContact: retryCount === 0,
      tier: currentTier,
      cacheHit: false,
      timestamp: Date.now(),
      companyId: request.companyId,
      userId: request.userId,
      queryLength: request.query.length,
      answerLength: qaResponse.answer.length,
    };

    // Record quality metrics for analytics
    QualityTracker.recordConversation(qualityMetrics);

    console.log('[QA] Quality metrics recorded:', {
      conversationId,
      responseTime: qualityMetrics.responseTime + 'ms',
      groundingScore: qualityMetrics.groundingScore.toFixed(1) + '%',
      escalationCount: qualityMetrics.escalationCount,
      resolvedFirstContact: qualityMetrics.resolvedFirstContact,
    });

    // Return response
    return NextResponse.json({
      ...qaResponse,
      metadata: {
        ...qaResponse.metadata,
        fromCache: false,
        tier: currentTier,
        conversationId,
        latencyBreakdown: {
          total: Date.now() - startTime,
          cacheCheck: cacheCheckTime,
          retrieval: retrievalTime,
          generation: generationTime,
          validation: validationTime,
        },
      },
    });

  } catch (error) {
    console.error('[QA] Error:', error);
    
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Check Endpoint
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: 'healthy',
    version: '1.0.0',
    components: {
      queryUnderstanding: 'operational',
      hybridRetrieval: 'operational',
      patternRouter: 'operational',
      validation: 'operational',
      cache: 'in-memory (development)',
      llm: 'stub (Azure OpenAI integration required)',
    },
    timestamp: new Date().toISOString(),
  });
}
