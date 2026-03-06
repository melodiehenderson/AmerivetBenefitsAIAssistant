/**
 * Documents API - Individual Document Operations
 * GET /api/documents/[id] - Get document
 * PATCH /api/documents/[id] - Update document with versioning
 * DELETE /api/documents/[id] - Archive document
 * 
 * Best Practices:
 * - RESTful design patterns
 * - Optimistic concurrency control with ETags
 * - Proper HTTP methods and status codes
 * - Detailed error messages
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DocumentsRepository, type UpdateDocumentInput } from '@/lib/db/cosmos';
import { getServerSession } from 'next-auth';

/**
 * Update document schema
 */
const UpdateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  category: z.enum(['medical', 'dental', 'vision', '401k', 'pto', 'other']).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  changes: z.string().min(1).max(500),
});

/**
 * GET /api/documents/[id] - Get single document
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = request.headers.get('x-company-id');
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }

    const document = await DocumentsRepository.getDocument(params.id, companyId);

    if (!document) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: document,
    });
  } catch (error) {
    console.error('[API ERROR] Get document failed:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch document' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/documents/[id] - Update document with versioning
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = request.headers.get('x-company-id');
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }

    // Get ETag for optimistic concurrency
    const etag = request.headers.get('if-match');

    // Validate request body
    const body = await request.json();
    const validationResult = UpdateDocumentSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          details: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    // Update document with version increment
    const input: UpdateDocumentInput = {
      ...validationResult.data,
      modifiedBy: session.user.email || (session.user as any).id || 'unknown',
    };

    const updated = await DocumentsRepository.updateDocument(
      params.id,
      companyId,
      input,
      etag || undefined
    );

    console.log(`[AUDIT] Document updated: ${params.id} v${updated.version.current} by ${input.modifiedBy}`);

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Document updated successfully',
    });
  } catch (error: any) {
    console.error('[API ERROR] Update document failed:', error);

    if (error.message.includes('modified by another process')) {
      return NextResponse.json(
        {
          error: 'Conflict',
          message: 'Document was modified. Please refresh and try again.',
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documents/[id] - Soft delete (archive)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = request.headers.get('x-company-id');
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }

    await DocumentsRepository.deleteDocument(
      params.id,
      companyId,
      session.user.email || (session.user as any).id || 'unknown'
    );

    console.log(`[AUDIT] Document archived: ${params.id} by ${session.user.email}`);

    return NextResponse.json({
      success: true,
      message: 'Document archived successfully',
    });
  } catch (error) {
    console.error('[API ERROR] Delete document failed:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to archive document' },
      { status: 500 }
    );
  }
}
