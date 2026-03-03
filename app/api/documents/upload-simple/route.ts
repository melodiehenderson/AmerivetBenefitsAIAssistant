export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/unified-auth';
import { getRepositories } from '@/lib/azure/cosmos';
import { storageServices } from '@/lib/storageServices';
import { documentProcessingService } from '@/lib/services/document-processing.service';
import { logger } from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { DEFAULT_COMPANY_ID, DOCUMENT_CATEGORIES } from '@/lib/config';

export const POST = requireCompanyAdmin(async (request: NextRequest) => {
  try {
    // Apply rate limiting
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Authenticate and authorize
    // Extract user information from headers
    const userId = request.headers.get('x-user-id')!;
    const userCompanyId = request.headers.get('x-company-id')!;
    // Authentication handled by requireCompanyAdmin/requireSuperAdmin
    // Error handling managed by auth middleware

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const companyId = String(formData.get('companyId') || DEFAULT_COMPANY_ID);
    const documentType = String(formData.get('documentType') || 'benefits');
    const category = String(formData.get('category') || DOCUMENT_CATEGORIES.BENEFIT_GUIDE);

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only PDF, DOCX, DOC, and TXT files are supported' }, { status: 400 });
    }

    // Generate unique document ID
    const documentId = uuidv4();
    
    // Convert file to buffer for processing
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    
    // Upload to Azure Blob Storage with folder structure
    const fileExtension = file.name.split('.').pop() || 'bin';
    const safeName = file.name.replace(/\s+/g, '-');
    const fileName = `${category}/${companyId}/${Date.now()}-${safeName}`;
    
    const uploadResult = await storageServices.documents.uploadFile(
      fileBuffer,
      fileName,
      file.type || 'application/octet-stream'
    );

    if (!uploadResult.url) {
      throw new Error('Failed to upload file to storage');
    }

    // Create document record in Cosmos DB
    const repositories = await getRepositories();
    const document = {
      id: documentId,
      title: file.name.replace(/\.[^/.]+$/, ''),
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      storagePath: fileName,
      storageUrl: uploadResult.url,
      companyId,
      documentType: documentType as 'benefits_guide' | 'policy' | 'form' | 'other',
      type: (documentType === 'benefits_guide' ? 'guide' : documentType === 'form' || documentType === 'other' ? 'policy' : documentType) as 'policy' | 'benefit_plan' | 'faq' | 'guide',
      content: '',
      status: 'pending' as 'pending' | 'processing' | 'processed' | 'error',
      processingStatus: 'pending' as 'pending' | 'processing' | 'ready' | 'failed',
      uploadedBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { author: userId, tags: [], category: documentType },
      version: { current: 1, history: [{ version: 1, timestamp: new Date().toISOString(), userId, changes: 'Initial upload' }] }
    };

    await repositories.documents.create(document);

    // Process document with actual text extraction
    try {
      const processedDoc = await documentProcessingService.processDocument(
        documentId,
        fileBuffer,
        file.name
      );
      
      logger.info('Document processing completed', { 
        documentId, 
        companyId,
        wordCount: processedDoc.metadata.wordCount,
        chunkCount: processedDoc.chunks.length
      });
    } catch (error) {
      logger.error('Document processing failed', { 
        documentId, 
        companyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Update document status to error
      await repositories.documents.update(documentId, {
        processingStatus: 'failed',
        updatedAt: new Date().toISOString()
      } as any);
    }

    return NextResponse.json({
      success: true,
      documentId,
      message: 'Document uploaded successfully and processing started'
    });

  } catch (error) {
    logger.error('Document upload failed', { data: error as Error });
    return NextResponse.json(
      { error: 'Failed to upload document' },
      { status: 500 }
    );
  }
});

