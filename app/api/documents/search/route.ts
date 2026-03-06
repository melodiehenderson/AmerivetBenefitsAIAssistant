export const dynamic = 'force-dynamic';

/**
 * Document Search API
 * Handles document search and retrieval
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/unified-auth';
import { documentService } from '@/lib/document-processing/document-service';
import { logger } from '@/lib/logger';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { handleAPIError } from '@/lib/errors/api-errors';

export const GET = requireCompanyAdmin(async (request: NextRequest) => {
  const startTime = Date.now();

  try {
    // Extract user info from middleware
    const userId = request.headers.get('x-user-id');
    const tenantId = request.headers.get('x-company-id');

    if (!userId || !tenantId) {
      logger.warn('Unauthorized document search request', {
        userAgent: request.headers.get('user-agent'),
      });
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Apply rate limiting
    const rateLimitResponse = await rateLimiters.api(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const category = searchParams.get('category');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!query) {
      return new NextResponse('Search query is required', { status: 400 });
    }

    // Search documents
    const documents = await documentService.searchDocuments(query, tenantId, {
      category: category || undefined,
      limit
    });

    // Log successful search
    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/documents/search', 200, duration, {
      userId,
      tenantId,
      query,
      category,
      resultCount: documents.length,
    });

    return NextResponse.json({
      success: true,
      query,
      category,
      documents: documents.map(doc => ({
        id: doc.id,
        filename: doc.fileName,
        title: doc.title,
        content: doc.content?.substring(0, 500) + '...', // Truncate for response
        category: doc.category,
        tags: doc.tags,
        relevanceScore: doc.relevanceScore,
        highlights: doc.highlights,
        createdAt: doc.createdAt,
      })),
      total: documents.length,
    });
  } catch (error) {
    const errorInfo = handleAPIError(error);
    return NextResponse.json(
      {
        success: false,
        error: errorInfo.message,
        code: errorInfo.code,
      },
      { status: errorInfo.statusCode }
    );
  }
});

