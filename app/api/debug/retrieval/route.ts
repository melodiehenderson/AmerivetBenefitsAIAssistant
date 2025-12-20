import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/unified-auth'; // SECURITY: Protect data access
import { logger } from '@/lib/logger';

// Enforce dynamic behavior so we don't cache debug results
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Define result shape for safer typing
interface SearchResult {
  id: string;
  score: number;
  content: string;
  source: 'bm25' | 'vector';
}

export const GET = requireCompanyAdmin(async (req: NextRequest, { user }) => {
  const startTime = Date.now();
  const searchParams = req.nextUrl.searchParams;
  
  // 1. DYNAMIC INPUTS: Allow testing different queries/companies on the fly
  const queryText = searchParams.get('query') || 'health insurance benefits';
  const targetCompanyId = searchParams.get('companyId') || user.companyId;
  const limit = parseInt(searchParams.get('limit') || '5');

  try {
    // Lazy import RAG tools
    const { retrieveBM25TopK, retrieveVectorTopK } = await import('@/lib/rag/hybrid-retrieval');

    const context = { companyId: targetCompanyId };

    // 2. PERFORMANCE TRACKING: Measure latency of each stream independently
    const startVector = performance.now();
    const vectorPromise = retrieveVectorTopK(queryText, context, limit)
      .then(res => ({ 
        data: res, 
        latency: Math.round(performance.now() - startVector),
        error: null 
      }))
      .catch(e => ({ data: [], latency: 0, error: e.message }));

    const startBM25 = performance.now();
    const bm25Promise = retrieveBM25TopK(queryText, context, limit)
      .then(res => ({ 
        data: res, 
        latency: Math.round(performance.now() - startBM25),
        error: null 
      }))
      .catch(e => ({ data: [], latency: 0, error: e.message }));

    const [vectorRes, bm25Res] = await Promise.all([vectorPromise, bm25Promise]);

    // 3. ANALYSIS: detailed breakdown of results
    // We map results to a standardized format to inspect scores easily
    const formatResults = (items: any[], type: 'vector' | 'bm25'): SearchResult[] => {
      return items.map(item => ({
        id: item.id || item.metadata?.id || 'unknown',
        score: typeof item.score === 'number' ? parseFloat(item.score.toFixed(4)) : 0,
        content: (item.pageContent || item.text || '').substring(0, 150) + '...', // Truncate for readability
        source: type
      }));
    };

    const vectorHits = formatResults(vectorRes.data, 'vector');
    const bm25Hits = formatResults(bm25Res.data, 'bm25');

    // 4. OVERLAP CHECK: Do Vector and Keyword find the same things?
    // High overlap = high confidence. Low overlap = distinct signals (good for hybrid).
    const vectorIds = new Set(vectorHits.map(x => x.id));
    const overlapCount = bm25Hits.filter(x => vectorIds.has(x.id)).length;

    const duration = Date.now() - startTime;
    logger.info('Debug Retrieval Executed', { query: queryText, duration });

    return NextResponse.json({
      ok: true,
      meta: {
        query: queryText,
        companyId: targetCompanyId,
        totalDurationMs: duration,
        environment: {
          indexName: process.env.AZURE_SEARCH_INDEX || 'NOT_SET',
          endpointConfigured: !!process.env.AZURE_SEARCH_ENDPOINT,
        }
      },
      analysis: {
        overlapCount,
        vectorLatencyMs: vectorRes.latency,
        bm25LatencyMs: bm25Res.latency,
      },
      results: {
        vector: {
            count: vectorHits.length,
            error: vectorRes.error,
            topHits: vectorHits // SHOW THE ACTUAL DATA
        },
        bm25: {
            count: bm25Hits.length,
            error: bm25Res.error,
            topHits: bm25Hits // SHOW THE ACTUAL DATA
        }
      }
    });

  } catch (error: any) {
    return NextResponse.json({ 
        ok: false, 
        error: error?.message || 'Unknown Debug Error',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
});