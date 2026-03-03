/**
 * Documents API - Create and List Documents
 * POST /api/documents - Create new document
 * GET /api/documents - List documents with pagination
 * 
 * Best Practices:
 * - Input validation with Zod schemas
 * - Proper error handling with status codes
 * - Authentication and authorization
 * - Rate limiting headers
 * - Repository pattern for data access
 * - Comprehensive logging and audit trail
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DocumentsRepository, type CreateDocumentInput } from '@/lib/db/cosmos';
import { adminAuth } from '@/lib/auth/admin-auth';
import { logger, logError } from '@/lib/logger';

/**
 * Input validation schema
 */
const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  contentType: z.enum(['html', 'markdown', 'pdf', 'docx']),
  category: z.enum(['medical', 'dental', 'vision', '401k', 'pto', 'other']),
  tags: z.array(z.string()).optional(),
  metadata: z
    .object({
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
      originalFilename: z.string().optional(),
    })
    .optional(),
  status: z.enum(['draft', 'published']).optional(),
});

/**
 * GET /api/documents - List documents with pagination
 */
export async function GET(req: NextRequest) {
  try {
    // Get auth token from headers
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(token);

    // Get company ID from user's custom claims
    const companyId = decodedToken.companyId;

    if (!companyId) {
      return NextResponse.json(
        { error: 'No company assigned' },
        { status: 403 },
      );
    }

    // Parse query parameters
    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get('status') as 'draft' | 'published' | 'archived' | null;
    const category = searchParams.get('category') as CreateDocumentInput['category'] | null;
    const maxItemCount = parseInt(searchParams.get('limit') || '50', 10);
    const continuationToken = searchParams.get('continuationToken') || undefined;

    // Query documents using repository pattern
    const result = await DocumentsRepository.getCompanyDocuments(companyId, {
      status: status || undefined,
      category: category || undefined,
      maxItemCount,
      continuationToken,
    });

    logger.info(`[API] Documents fetched: ${result.items.length} items for company ${companyId}`);

    return NextResponse.json({
      success: true,
      data: result.items,
      pagination: {
        hasMore: result.hasMore,
        continuationToken: result.continuationToken,
        count: result.items.length,
      },
      meta: {
        requestCharge: result.requestCharge,
      },
    });
  } catch (error) {
    logError('Error fetching documents', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/documents - Create new document
 */
export async function POST(req: NextRequest) {
  try {
    // Get auth token from headers
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(token);

    // Get company ID from user's custom claims
    const companyId = decodedToken.companyId;

    if (!companyId) {
      return NextResponse.json(
        { error: 'No company assigned' },
        { status: 403 },
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const validationResult = CreateDocumentSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          message: 'Invalid request data',
          details: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    // Create document input
    const input: CreateDocumentInput = {
      companyId,
      ...validationResult.data,
      uploadedBy: decodedToken.email || decodedToken.uid,
    };

    // Save to Cosmos DB using repository
    const document = await DocumentsRepository.createDocument(input);

    // Log audit trail
    logger.info(`[AUDIT] Document created: ${document.id} by ${input.uploadedBy} for company ${companyId}`);

    return NextResponse.json(
      {
        success: true,
        data: document,
        message: 'Document created successfully',
      },
      {
        status: 201,
        headers: {
          'X-Request-Id': crypto.randomUUID(),
          'Location': `/api/documents/${document.id}`,
        },
      }
    );
  } catch (error) {
    logError('Error creating document', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to create document',
      },
      { status: 500 },
    );
  }
}

