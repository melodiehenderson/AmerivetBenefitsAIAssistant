export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { type NextRequest, NextResponse } from 'next/server';
import { protectAdminEndpoint } from '@/lib/middleware/auth';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { logger } from '@/lib/logging/logger';
import { getRepositories } from '@/lib/azure/cosmos';
import { getStorageServices } from '@/lib/azure/storage';
import { deleteDocumentVectors } from '@/lib/ai/vector-search';

interface RouteParams {
  params: Promise<{
    companyId: string;
    documentId: string;
  }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { companyId, documentId } = await params;
  
  try {
    // ----------------------------------------------------------------------
    // 1. SECURITY & RATE LIMITING
    // ----------------------------------------------------------------------
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) return rateLimitResponse;

    // Combined auth check is usually preferred if your logic supports it
    const { user, error } = await protectAdminEndpoint(request);
    if (error || !user) return error!;

    // Parse Body for Blob URL
    let url: string | undefined;
    try {
        const body = await request.json();
        url = body.url;
    } catch (e) {
        // Body might be empty, that's fine
    }

    logger.info('API Request: DELETE Document', { userId: user.id, companyId, documentId });

    // ----------------------------------------------------------------------
    // 2. PARALLEL CLEANUP (The "Heavy Lifting")
    // ----------------------------------------------------------------------
    // We run these tasks in parallel using allSettled so one failure doesn't 
    // stop the others. We delete dependents FIRST.
    
    const repositories = await getRepositories();

    const tasks = [
        // Task A: Delete from Blob Storage
        (async () => {
            if (!url) return;
            const storageServices = await getStorageServices();
            const fileName = url.split('/').pop(); // Safer extraction
            if (fileName) {
                await storageServices.documents.deleteFile(fileName);
                logger.info('Blob deleted', { documentId });
            }
        })(),

        // Task B: Delete Vectors
        (async () => {
            await deleteDocumentVectors(companyId, documentId);
            logger.info('Vectors deleted', { documentId });
        })(),

        // Task C: Delete Chunks (Optimized)
        (async () => {
            const chunksQuery = `SELECT * FROM c WHERE c.documentId = @documentId AND c.companyId = @companyId`;
            const chunks = await repositories.documentChunks.query({
                query: chunksQuery,
                parameters: [{ name: '@documentId', value: documentId }, { name: '@companyId', value: companyId }]
            });

            if (chunks.length > 0) {
                // DELETE IN PARALLEL (Not one by one)
                const deletePromises = chunks.map((chunk: any) => 
                    repositories.documentChunks.delete(chunk.id, companyId)
                );
                await Promise.all(deletePromises);
                logger.info('Chunks deleted', { count: chunks.length });
            }
        })()
    ];

    // Wait for all cleanup tasks to finish (Success or Fail)
    const results = await Promise.allSettled(tasks);
    
    // Check for critical failures (Optional: logic to abort if critical parts fail)
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
        logger.warn('Some cleanup tasks failed', { errors: failed });
        // We proceed to delete the metadata anyway to honor the user's intent,
        // but you could choose to throw here if strict consistency is required.
    }

    // ----------------------------------------------------------------------
    // 3. COMMIT (Delete the Main Record)
    // ----------------------------------------------------------------------
    // Only delete the master record after attempting to clear the children.
    await repositories.documents.delete(documentId);
    
    const duration = Date.now() - startTime;
    logger.apiResponse('DELETE', '/api/admin/companies/documents', 200, duration, {
      documentId,
      companyId
    });

    return NextResponse.json({
      success: true,
      message: 'Document deleted successfully',
      data: { documentId, deletedAt: new Date().toISOString() }
    });

  } catch (error) {
    logger.error('Document deletion critical error', { companyId, documentId }, error as Error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete document' },
      { status: 500 }
    );
  }
}