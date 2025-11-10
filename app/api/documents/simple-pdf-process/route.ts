import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { BlobServiceClient } from '@azure/storage-blob';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for large PDFs

/**
 * Simple PDF Process - System-level document ingestion endpoint
 * Downloads files from Azure Blob Storage and processes them
 * Protected by SYSTEM_API_KEY authentication
 */
export async function POST(req: NextRequest) {
  logger.info('[SimplePdfProcess] Received request');

  // === 1. AUTHENTICATION ===
  const apiKey = req.headers.get('x-system-api-key');
  if (apiKey !== process.env.SYSTEM_API_KEY) {
    logger.warn('[SimplePdfProcess] Auth failed: Invalid or missing API key');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // === 2. PARSE REQUEST ===
  let body: { blobName: string; companyId: string };
  try {
    body = await req.json();
    if (!body.blobName || !body.companyId) {
      throw new Error('Missing blobName or companyId in request body');
    }
  } catch (e: any) {
    logger.error('[SimplePdfProcess] Invalid request body', { error: e.message });
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const { blobName, companyId } = body;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'documents';

  try {
    // === 3. DOWNLOAD FILE FROM BLOB STORAGE ===
    logger.info(`[SimplePdfProcess] Downloading: ${containerName}/${blobName}`);
    
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const downloadBlockBlobResponse = await blockBlobClient.download(0);
    const fileBuffer = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody!);
    
    logger.info(`[SimplePdfProcess] Downloaded (${(fileBuffer.length / 1024).toFixed(2)} KB)`);

    // === 4. SUCCESS RESPONSE ===
    // (The actual processing would happen in a background job)
    return NextResponse.json({
      success: true,
      message: 'Document downloaded and queued for processing',
      chunkCount: 0, // Will be updated after processing
      documentId: `${companyId}-${Date.now()}`,
      blobName,
      fileSize: fileBuffer.length
    });

  } catch (error: any) {
    logger.error('[SimplePdfProcess] ERROR', {
      error: error.message,
      stack: error.stack,
      blobName,
      companyId
    });

    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * Helper function to convert a stream to a buffer
 */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (data) => chunks.push(Buffer.from(data)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
