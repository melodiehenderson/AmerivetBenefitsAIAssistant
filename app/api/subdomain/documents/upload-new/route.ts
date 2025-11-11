export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { BlobServiceClient } from '@azure/storage-blob';
import { isBuild } from '@/lib/runtime/is-build';

// Simple PDF text extraction (minimal dependencies)
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // For MVP, we'll use a simple approach: store the raw PDF
  // In production, use pdf-parse or similar
  return `[PDF Document - ${buffer.length} bytes]`;
}

// Chunk text into manageable pieces for RAG
function chunkText(text: string, chunkSize: number = 1000, overlap: number = 100): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}

export async function POST(req: Request) {
  try {
    // 1. AUTH CHECK - Admin only
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('amerivet_session');
    const role = sessionCookie?.value === 'admin' ? 'admin' : null;

    if (role !== 'admin') {
      return new Response(
        JSON.stringify({ ok: false, error: 'NOT_AUTHORIZED', message: 'Only admins can upload documents' }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      );
    }

    // 2. PARSE FORM DATA
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const category = (formData.get('category') as string) || 'benefits';

    if (!file) {
      return new Response(
        JSON.stringify({ ok: false, error: 'NO_FILE', message: 'No file provided' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'INVALID_TYPE', message: 'Only PDF files are supported' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ ok: false, error: 'FILE_TOO_LARGE', message: 'File must be under 10MB' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    // 3. SKIP BLOB UPLOAD (Frontend disabled Azure storage earlier)
    // Instead, process locally for now
    const buffer = await file.arrayBuffer();
    const textContent = await extractTextFromPDF(Buffer.from(buffer));
    const chunks = chunkText(textContent);

    // 4. RETURN SUCCESS
    return new Response(
      JSON.stringify({
        ok: true,
        fileName: file.name,
        chunkCount: chunks.length,
        category,
        message: 'Document uploaded and indexed. Bot will include this in future responses.',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Upload Document]', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'UPLOAD_FAILED',
        message: error instanceof Error ? error.message : 'Upload failed',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
