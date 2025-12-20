export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/unified-auth';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { logger } from '@/lib/logger';
import { getStorageServices } from '@/lib/azure/storage';
import { crypto } from 'crypto'; // Native Node module for UUIDs

// 1. SECURITY: Define allowed file types
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // .xlsx
]);

export const POST = requireCompanyAdmin(async (request: NextRequest) => {
  const startTime = Date.now();
  
  try {
    // Apply rate limiting
    const rateLimitResponse = await rateLimiters.upload(request);
    if (rateLimitResponse) return rateLimitResponse;

    const userId = request.headers.get('x-user-id')!;
    const body = await request.json();
    const { fileName, fileType } = body;
    
    // 2. VALIDATION: Check for missing fields
    if (!fileName || !fileType) {
      return NextResponse.json(
        { success: false, error: 'fileName and fileType are required' },
        { status: 400 }
      );
    }

    // 3. SECURITY: Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(fileType)) {
      logger.warn('Blocked invalid file type upload attempt', { userId, fileType });
      return NextResponse.json(
        { success: false, error: 'Invalid file type. Only PDF, Docs, and Spreadsheets are allowed.' },
        { status: 400 }
      );
    }

    logger.info('API Request: Generate Upload SAS', { userId, fileName, fileType });

    const storageServices = await getStorageServices();
    
    // 4. ROBUST NAMING: Use UUID to prevent collisions & sanitize filename
    // Sanitize: "My Report (2024).pdf" -> "my-report-2024.pdf"
    const sanitizedName = fileName.toLowerCase().replace(/[^a-z0-9.]/g, '-');
    const blobName = `${crypto.randomUUID()}-${sanitizedName}`;
    
    // 5. CRITICAL FIX: Generate a WRITE-capable SAS URL
    // Note: Ensure your storage service has a method that creates a SAS with "write" permissions.
    // Standard "getFileUrl" usually returns a public read link, which won't work for uploads.
    const sasUrl = await storageServices.documents.generateUploadUrl(blobName, fileType);

    const duration = Date.now() - startTime;
    
    logger.apiResponse('POST', '/api/admin/documents/upload-url', 200, duration, {
      userId,
      fileName,
      blobName
    });

    return NextResponse.json({ 
      success: true,
      data: {
        sasUrl,      // The specialized URL the frontend uses to PUT the file
        blobName,    // The ID stored in your database
        expiresIn: 3600 // Helpful for frontend to know (1 hour)
      }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('SAS URL generation error', {
      path: request.nextUrl.pathname,
      method: request.method,
      duration
    }, error as Error);
    
    return NextResponse.json(
      { success: false, error: 'Failed to generate upload URL' }, 
      { status: 500 }
    );
  }
});