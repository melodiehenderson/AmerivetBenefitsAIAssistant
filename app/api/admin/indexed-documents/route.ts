import { NextResponse } from 'next/server';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface IndexedDocument {
  docId: string;
  title: string;
  fileName: string;
  chunkCount: number;
}

export async function GET() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX || 'chunks_prod_v1';

  if (!endpoint || !apiKey) {
    return NextResponse.json({ error: 'Search not configured' }, { status: 503 });
  }

  try {
    const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));

    const result = await client.search('*', {
      top: 1000,
      filter: "company_id eq 'amerivet'",
      select: ['doc_id', 'document_id', 'metadata'],
      queryType: 'simple',
    });

    const docMap = new Map<string, { title: string; fileName: string; count: number }>();

    for await (const item of result.results) {
      const doc = item.document as any;
      const docId: string = doc.doc_id || doc.document_id || 'unknown';
      let title = '';
      let fileName = '';

      if (doc.metadata) {
        try {
          const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
          title = meta.title || meta.documentTitle || '';
          fileName = meta.fileName || meta.source || '';
        } catch {
          // ignore parse errors
        }
      }

      const display = title || fileName || docId;
      if (docMap.has(docId)) {
        docMap.get(docId)!.count++;
      } else {
        docMap.set(docId, { title: display, fileName: fileName || docId, count: 1 });
      }
    }

    const documents: IndexedDocument[] = Array.from(docMap.entries()).map(([docId, info]) => ({
      docId,
      title: info.title,
      fileName: info.fileName,
      chunkCount: info.count,
    }));

    documents.sort((a, b) => a.title.localeCompare(b.title));

    return NextResponse.json({ documents, total: documents.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
