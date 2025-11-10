/**
 * Debug endpoint to inspect raw retrieval results before reranking
 */
import { NextRequest, NextResponse } from 'next/server';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, companyId } = body;

    if (!query || !companyId) {
      return NextResponse.json(
        { error: 'Missing query or companyId' },
        { status: 400 }
      );
    }

    // Execute hybrid retrieval
    const retrievalResult = await hybridRetrieve(query, {
      companyId,
      conversationId: 'debug-retrieval',
    });

    // Extract doc_id and scores from chunks
    const chunkDetails = retrievalResult.chunks.map((chunk, idx) => ({
      index: idx + 1,
      doc_id: chunk.docId,
      chunk_id: chunk.id,
      title: chunk.title,
      vectorScore: chunk.metadata.vectorScore?.toFixed(4) || 'N/A',
      rrfScore: chunk.metadata.rrfScore?.toFixed(4) || 'N/A',
      relevanceScore: chunk.metadata.relevanceScore?.toFixed(4) || 'N/A',
      combinedScore: (
        (chunk.metadata.vectorScore || 0) +
        (chunk.metadata.rrfScore || 0) +
        (chunk.metadata.relevanceScore || 0)
      ).toFixed(4),
      contentPreview: chunk.content.substring(0, 100) + '...',
    }));

    // Count unique doc_ids
    const uniqueDocIds = new Set(retrievalResult.chunks.map(c => c.docId));

    return NextResponse.json({
      success: true,
      query,
      companyId,
      totalChunks: retrievalResult.chunks.length,
      uniqueDocIds: uniqueDocIds.size,
      docIdList: Array.from(uniqueDocIds),
      retrievedChunks: chunkDetails,
      method: retrievalResult.metadata.method,
    });
  } catch (error) {
    console.error('[DEBUG][RETRIEVAL] Error:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
