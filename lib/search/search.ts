import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { OpenAI } from 'openai';

const VECTOR_FIELD = process.env.AZURE_SEARCH_VECTOR_FIELD || 'content_vector';
const COMPANY_FIELD = process.env.AZURE_SEARCH_COMPANY_FIELD || 'company_id';
const sanitizeFilterValue = (value: string) => value.replace(/'/g, "''");

// Client for getting query embeddings
const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT}`,
  defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
});

// Client for Azure AI Search
const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT!,
  process.env.AZURE_SEARCH_INDEX_NAME!,
  new AzureKeyCredential(process.env.AZURE_SEARCH_ADMIN_KEY!)
);

// This is the type that route.ts needs to import
export interface RetrievedChunk {
  docId: string;
  content: string;
  title?: string;
  sectionPath?: string;
  metadata: {
    tokenCount: number;
    bm25Score?: number;
    vectorScore?: number;
    rrfScore?: number;
  };
}

export async function search({ query, companyId }: { query: string; companyId: string; }) {
  
  // 1. Get embedding for the user's query
  const embeddingResponse = await openai.embeddings.create({
    model: process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || '',
    input: query,
  });
  const queryVector = embeddingResponse.data[0].embedding;
  const filter = `${COMPANY_FIELD} eq '${sanitizeFilterValue(companyId)}'`;

  // 2. Perform Hybrid Search
  const searchResults = await searchClient.search(query, {
    vectorQueries: [
      {
        vector: queryVector,
        kNearestNeighborsCount: 50,
        fields: [VECTOR_FIELD],
      },
    ],
    filter,
    top: 20, // Retrieve top 20 for reranking
  });

  // 3. Map results to our standard RetrievedChunk format
  const results: RetrievedChunk[] = [];
  for await (const doc of searchResults.results) {
    if (doc.score < 0.03) continue; // RRF score threshold

    results.push({
      docId: doc.document.doc_id as string,
      content: doc.document.content as string,
      title: doc.document.title as string,
      sectionPath: doc.document.section_path as string,
      metadata: {
        tokenCount: (doc.document.token_count ?? 0) as number,
        rrfScore: doc.score, // Hybrid search returns an RRF score
        bm25Score: doc.score, // Use RRF score as a proxy
        vectorScore: doc.score, // Use RRF score as a proxy
      },
    });
  }
  
  return { results };
}
