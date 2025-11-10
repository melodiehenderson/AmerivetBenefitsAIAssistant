export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRepositories } from '@/lib/azure/cosmos';
import { storageServices } from '@/lib/storageServices';
import { documentProcessingService } from '@/lib/services/document-processing.service';
import { logger } from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_COMPANY_ID, DOCUMENT_CATEGORIES } from '@/lib/config';

/**
 * Subdomain document upload endpoint
 * Does NOT require admin auth - uses subdomain session
 */
export async function POST(request: NextRequest) {
  try {
    // Check subdomain session from cookie
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('amerivet_session');
    const sessionValue = sessionCookie?.value;
    
    if (!sessionValue) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    
    const role = sessionValue === 'admin' ? 'admin' : sessionValue === 'employee' ? 'employee' : null;
    if (!role) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    
    const sessionData = { 
      ok: true, 
      role, 
      userId: `${role}-user-${Date.now()}`,
      permissions: role === 'admin' ? ['*'] : ['VIEW_BENEFITS', 'USE_CHAT', 'COMPARE_PLANS', 'VIEW_DOCUMENTS']
    };

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const companyId = String(formData.get('companyId') || DEFAULT_COMPANY_ID);
    const documentType = String(formData.get('documentType') || 'benefits');
    const category = String(formData.get('category') || DOCUMENT_CATEGORIES.BENEFIT_GUIDE);

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain'
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only PDF, DOCX, DOC, and TXT files are supported' },
        { status: 400 }
      );
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 10MB' },
        { status: 400 }
      );
    }

    // Generate unique document ID
    const documentId = uuidv4();
    
    // Convert file to buffer for processing
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    
    // Upload to Azure Blob Storage with folder structure
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
      type: 'guide' as const,
      content: '', // Will be filled after processing
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      companyId,
      uploadedBy: sessionData.userId || 'subdomain-user',
      documentType: 'benefits_guide' as const,
      ragProcessed: false,
      tags: [],
      metadata: {
        author: sessionData.userId || 'subdomain-user',
        tags: [],
        category: category,
        uploadedVia: 'subdomain',
        userRole: sessionData.role,
        storagePath: fileName,
        storageUrl: uploadResult.url
      },
      processingStatus: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: {
        current: 1,
        history: []
      }
    };

    await repositories.documents.create(document);

    // Process document with actual text extraction
    let summary = 'Document uploaded and processing started.';
    try {
      const processedDoc = await documentProcessingService.processDocument(
        documentId,
        fileBuffer,
        file.name
      );
      
      logger.info('Subdomain document processing completed', { 
        documentId, 
        companyId,
        wordCount: processedDoc.metadata.wordCount,
        chunkCount: processedDoc.chunks.length
      });

      // Generate a quick summary
      if (processedDoc.chunks.length > 0) {
        const firstChunk = processedDoc.chunks[0];
        summary = `Document contains ${processedDoc.metadata.wordCount} words across ${processedDoc.chunks.length} sections. You can now ask questions about ${file.name}.`;
      }
    } catch (error) {
      logger.error('Subdomain document processing failed', { 
        documentId, 
        companyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Update document status to error
      await repositories.documents.update(documentId, {
        processingStatus: 'failed',
        updatedAt: new Date().toISOString()
      });
      
      summary = 'Document uploaded but processing encountered an error. Please contact support.';
    }

    return NextResponse.json({
      success: true,
      documentId,
      summary,
      message: 'Document uploaded successfully'
    });

  } catch (error) {
    logger.error('Subdomain document upload failed', { error: error as Error });
    return NextResponse.json(
      { 
        error: 'Failed to upload document',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
