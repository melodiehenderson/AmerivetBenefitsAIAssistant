import { NextRequest, NextResponse } from 'next/server';
import { hybridRetrieve } from '../../../lib/rag/hybrid-retrieval';
import type { RetrievalContext } from '../../../types/rag';

const DENTAL_RE = /\bdental\b|\bdentist\b|\borthodontic\b|\bppo\b/i;

interface DiagnosticResponse {
  totalChunks: number;
  dentalChunks: number;
  topDentalRank: number | null;
  dentalOnly: Array<{
    rank: number;
    score: number;
    docId?: string;
    preview: string;
  }>;
  warning?: string;
}

function chunkPreview(chunkText: string): string {
  if (!chunkText) return '';
  const normalized = chunkText.replace(/\s+/g, ' ').trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 240)}…`;
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({}));
  const query = String(payload?.query ?? '').trim();
  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }

  const context: RetrievalContext = {
    companyId: String(payload?.companyId ?? 'amerivet'),
  };

  try {
    const result = await hybridRetrieve(query, context, {
      vectorK: 48,
      bm25K: 48,
      finalTopK: 24,
      rerankedTopK: 24,
      enableReranking: false,
    });

    const chunks = result.chunks ?? [];
    const dentalChunks = chunks.filter((chunk) =>
      DENTAL_RE.test(`${chunk.title ?? ''} ${chunk.sectionPath ?? ''} ${chunk.content ?? ''}`)
    );

    const dentalOnly = dentalChunks.slice(0, 10).map((chunk) => {
      const rank = chunks.indexOf(chunk) + 1;
      const score =
        (chunk.metadata?.vectorScore ?? 0) +
        (chunk.metadata?.bm25Score ?? 0) +
        (chunk.metadata?.rrfScore ?? 0);
      return {
        rank,
        score,
        docId: chunk.docId,
        preview: chunkPreview(chunk.content ?? ''),
      };
    });

    const topDentalRank =
      dentalChunks.length > 0 ? chunks.findIndex((chunk) => chunk === dentalChunks[0]) + 1 : null;

    const response: DiagnosticResponse = {
      totalChunks: chunks.length,
      dentalChunks: dentalChunks.length,
      topDentalRank,
      dentalOnly,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[DIAGNOSTIC] Retrieval failed', error);
    return NextResponse.json(
      {
        totalChunks: 0,
        dentalChunks: 0,
        topDentalRank: null,
        dentalOnly: [],
        warning: 'Retrieval failed; check Azure Search configuration.',
      },
      { status: 500 }
    );
  }
}
