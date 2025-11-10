export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    azureOpenAI: {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT ? 'SET' : 'MISSING',
      apiKey: process.env.AZURE_OPENAI_API_KEY ? 'SET' : 'MISSING',
      embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'NOT SET',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || 'NOT SET',
    },
    azureSearch: {
      endpoint: process.env.AZURE_SEARCH_ENDPOINT ? 'SET' : 'MISSING',
      apiKey: (process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY) ? 'SET' : 'MISSING',
      index: process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'chunks_prod_v1 (default)',
    },
    redis: {
      url: process.env.REDIS_URL ? 'SET' : 'MISSING',
    },
  });
}
