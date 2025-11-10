import { NextResponse } from 'next/server';
import { withBuildBypass } from '@/lib/middleware/with-build-bypass';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withBuildBypass(async () => {
  const testQuery = 'health insurance benefits';
  const companyId = process.env.DEBUG_COMPANY_ID || 'amerivet';

  try {
    // Lazy import to avoid build-time side effects
    const { retrieveBM25TopK, retrieveVectorTopK } = await import('@/lib/rag/hybrid-retrieval');

    const context = { companyId } as any;

    const [bm25, vector] = await Promise.all([
      retrieveBM25TopK(testQuery, context, 8).catch((e) => ({ error: String(e) } as any)),
      retrieveVectorTopK(testQuery, context, 8).catch((e) => ({ error: String(e) } as any)),
    ]);

    return NextResponse.json({
      ok: true,
      env: {
        AZURE_SEARCH_ENDPOINT: !!process.env.AZURE_SEARCH_ENDPOINT,
        AZURE_SEARCH_API_KEY: !!(process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY),
        AZURE_SEARCH_INDEX: process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'NOT_SET',
      },
      bm25Count: Array.isArray(bm25) ? bm25.length : -1,
      vectorCount: Array.isArray(vector) ? vector.length : -1,
      bm25Error: (bm25 as any)?.error,
      vectorError: (vector as any)?.error,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
  }
});
