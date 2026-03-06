export const dynamic = 'force-dynamic';

// app/api/super-admin/documents/process/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getContainerClient, DOCUMENTS_CONTAINER_NAME } from '@/lib/azure/blob-storage';
import { getContainer, DOCUMENTS_CONTAINER } from '@/lib/azure/cosmos-db';
import { ragSystem } from '@/lib/ai/rag-system';
import { requireCompanyAdmin } from '@/lib/auth/unified-auth';

async function streamToString(readableStream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    readableStream.on('data', (data) => {
      chunks.push(data.toString());
    });
    readableStream.on('end', () => {
      resolve(chunks.join(''));
    });
    readableStream.on('error', reject);
  });
}

export const POST = requireCompanyAdmin(async (request: NextRequest) => {
  try {
    const { blobName, fileName, companyId } = await request.json();

    const containerClient = await getContainerClient(DOCUMENTS_CONTAINER_NAME);
    if (!containerClient) {
      return NextResponse.json({ error: 'Storage not available' }, { status: 503 });
    }
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const downloadResponse = await blockBlobClient.download(0);
    const content = await streamToString(downloadResponse.readableStreamBody as NodeJS.ReadableStream);

    const documentsContainer = await getContainer(DOCUMENTS_CONTAINER);
    const { resource: newDoc } = await documentsContainer.items.create({
      id: blobName,
      partitionKey: companyId,
      fileName,
      companyId,
      status: 'processing',
      createdAt: new Date().toISOString(),
    });

    if (!newDoc) {
      throw new Error('Document creation failed');
    }

    await ragSystem.processDocument(
      newDoc.id,
      companyId,
      content,
      { fileName }
    );

    return NextResponse.json({ success: true, documentId: newDoc.id });
  } catch (error) {
    console.error('Error processing document:', error);
    return NextResponse.json({ error: 'Failed to process document' }, { status: 500 });
  }
});

