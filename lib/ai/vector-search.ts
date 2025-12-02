// lib/ai/vector-search.ts

import type { SearchClient } from '@azure/search-documents';
import { isBuild } from '@/lib/runtime/is-build';
import { DISABLE_AZURE } from '@/lib/runtime/feature-flags';
import { getContainer } from '@/lib/azure/cosmos-db';
import { generateEmbedding, generateEmbeddings } from './embeddings';
import { isVitest, isNodeRuntime } from '@/lib/ai/runtime';

const VECTOR_FIELD = process.env.AZURE_SEARCH_VECTOR_FIELD || 'content_vector';
const COMPANY_FIELD = process.env.AZURE_SEARCH_COMPANY_FIELD || 'company_id';
const DOCUMENT_FIELD = process.env.AZURE_SEARCH_DOCUMENT_FIELD || 'document_id';
const CONTENT_FIELD = process.env.AZURE_SEARCH_CONTENT_FIELD || 'content';

let searchClient: SearchClient | null = null;

const sanitizeFilterValue = (value: string) => value.replace(/'/g, "''");

async function ensureInitialized(): Promise<SearchClient | null> {
  if (isBuild || DISABLE_AZURE) return null;
  if (searchClient) return searchClient;
  if (!isNodeRuntime && !isVitest) throw new Error('Server-only module');

  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME || 'document-chunks';

  if (!endpoint || !apiKey) {
    throw new Error('AZURE_SEARCH not configured');
  }

  const { SearchClient, AzureKeyCredential } = await import('@azure/search-documents');
  searchClient = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
  
  return searchClient;
}

class VectorSearchService {
  async upsertChunks(
    chunks: {
      id: string;
      embedding: number[];
      companyId: string;
      documentId?: string;
      content?: string;
      metadata?: Record<string, unknown>;
    }[],
  ) {
    const client = await ensureInitialized();
    if (!client) return;
    const docs = chunks.map((c, idx) => ({
      id: c.id,
      [VECTOR_FIELD]: c.embedding,
      [COMPANY_FIELD]: c.companyId,
      [DOCUMENT_FIELD]: c.documentId,
      [CONTENT_FIELD]: c.content ?? '',
      chunk_index: idx,
      metadata: c.metadata ? JSON.stringify(c.metadata) : undefined,
    }));
    await client.mergeOrUploadDocuments(docs as any);
  }

  async upsertDocumentChunks(
    companyId: string,
    chunks: { id: string; text: string; metadata: { documentId: string } }[],
  ) {
    const client = await ensureInitialized();
    if (!client) return;
    try {
      const texts = chunks.map((c) => c.text);
      const embeddings = await generateEmbeddings(texts);

      // Feed memory index for tests
      if (isVitest) {
        const { __test_only_addToMemoryIndex } = await import('@/lib/rag/hybrid-retrieval');
        __test_only_addToMemoryIndex(chunks.map((c, i) => ({
          id: c.id,
          text: c.text,
          embedding: embeddings[i],
          docId: c.metadata.documentId,
          companyId,
        })));
      }

      // Store chunk data with embeddings in Cosmos DB
      const documentsContainer = await getContainer('Documents');
      for (let i = 0; i < chunks.length; i += 100) {
        const slice = chunks.slice(i, i + 100);
        const chunkData = slice.map((chunk, idx) => ({
          id: chunk.id,
          companyId,
          content: chunk.text,
          metadata: chunk.metadata,
          embedding: embeddings[i + idx],
          createdAt: new Date().toISOString(),
        }));
        
        // Batch insert into Cosmos DB
        for (const chunk of chunkData) {
          await documentsContainer.items.create(chunk);
        }
      }

      const docs = chunks.map((chunk, i) => {
        const metadata = {
          ...chunk.metadata,
          companyId,
          documentId: chunk.metadata.documentId,
        };
        return {
          id: chunk.id,
          [COMPANY_FIELD]: companyId,
          [DOCUMENT_FIELD]: chunk.metadata.documentId,
          [CONTENT_FIELD]: chunk.text,
          [VECTOR_FIELD]: embeddings[i],
          chunk_index: i,
          metadata: JSON.stringify(metadata),
        };
      });
      await searchClient!.mergeOrUploadDocuments(docs as any);
      return docs.length;
    } catch (error) {
      console.error('Error upserting document chunks to Azure AI Search:', error);
      throw new Error('Failed to upsert document chunks');
    }
  }

  async removeDatapoints(datapointIds: string[]) {
    await ensureInitialized();
    if (!datapointIds.length) return;
    const docs = datapointIds.map((id) => ({ id }));
    await searchClient!.deleteDocuments(docs as any);
  }

  async findNearestNeighbors(
    queryEmbedding: number[],
    companyId: string,
    numNeighbors = 5,
  ) {
    await ensureInitialized();
    const vectorQuery = {
      kind: 'vector',
      fields: [VECTOR_FIELD],
      kNearestNeighborsCount: numNeighbors,
      vector: queryEmbedding,
    } as const;

    const filter = `${COMPANY_FIELD} eq '${sanitizeFilterValue(companyId)}'`;

    const results = await searchClient!.search('', {
      vectorSearchOptions: {
        queries: [vectorQuery],
      },
      filter,
      select: ['id', COMPANY_FIELD, DOCUMENT_FIELD, CONTENT_FIELD, 'metadata'],
      top: numNeighbors,
    });

    const items: { chunk: any; score: number }[] = [];
    for await (const res of results.results) {
      const doc: any = res.document;
      const chunk = {
        id: doc.id,
        companyId: doc[COMPANY_FIELD] ?? doc.companyId ?? doc.company_id,
        documentId: doc[DOCUMENT_FIELD] ?? doc.documentId ?? doc.document_id,
        content: doc[CONTENT_FIELD] ?? doc.content ?? '',
        metadata: doc.metadata,
      };
      items.push({
        chunk,
        score: res.score,
      });
    }
    return items;
  }
}

export const vectorSearchService = new VectorSearchService();

export async function upsertDocumentChunks(
  companyId: string,
  chunks: {
    id: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }[],
): Promise<{ status: 'success' | 'error'; vectorsUpserted: number }> {
  if (!chunks.length) {
    return { status: 'success', vectorsUpserted: 0 };
  }

  try {
    // Store chunk metadata and embeddings in Cosmos DB in batches of 100
    const documentsContainer = await getContainer('Documents');
    for (let i = 0; i < chunks.length; i += 100) {
      const slice = chunks.slice(i, i + 100);
      for (const chunk of slice) {
        await documentsContainer.items.create({
          id: chunk.id,
          companyId,
          content: chunk.text,
          metadata: chunk.metadata,
          embedding: chunk.embedding,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Upsert embeddings to Azure AI Search in batches of 100
    let upserted = 0;
    for (let i = 0; i < chunks.length; i += 100) {
      const slice = chunks.slice(i, i + 100).map((chunk, idx) => ({
        id: chunk.id,
        embedding: chunk.embedding,
        companyId,
        documentId: (chunk.metadata as any)?.documentId,
        content: chunk.text,
        metadata: chunk.metadata,
        chunk_index: i + idx,
      }));
      if (slice.length > 0) {
        await vectorSearchService.upsertChunks(slice);
        upserted += slice.length;
      }
    }

    console.log(`Stored ${upserted} embedding vectors for company ${companyId}`);
    return { status: 'success', vectorsUpserted: upserted };
  } catch (error) {
    console.error('Error upserting document chunks:', error);
    return { status: 'error', vectorsUpserted: 0 };
  }
}

export async function searchVectors(
  companyId: string,
  query: string,
  numNeighbors = 5,
) {
  const embedding = await generateEmbedding(query);
  return vectorSearchService.findNearestNeighbors(
    embedding,
    companyId,
    numNeighbors,
  );
}

export const getDocumentChunks = async (
  companyId: string,
  documentId: string,
  limit: number = 100,
  offset: number = 0
): Promise<{
  chunks: Array<{
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    embedding: number[];
    createdAt: string;
  }>;
  total: number;
}> => {
  try {
    const documentsContainer = await getContainer('Documents');
    
    // Get total count
    const countQuery = {
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.companyId = @companyId AND c.metadata.documentId = @documentId",
      parameters: [
        { name: '@companyId', value: companyId },
        { name: '@documentId', value: documentId }
      ]
    };
    
    const { resources: countResult } = await documentsContainer.items.query(countQuery).fetchAll();
    const total = countResult[0] || 0;

    // Get chunks with pagination
    const query = {
      query: "SELECT * FROM c WHERE c.companyId = @companyId AND c.metadata.documentId = @documentId ORDER BY c.createdAt OFFSET @offset LIMIT @limit",
      parameters: [
        { name: '@companyId', value: companyId },
        { name: '@documentId', value: documentId },
        { name: '@offset', value: offset },
        { name: '@limit', value: limit }
      ]
    };

    const { resources: chunks } = await documentsContainer.items.query(query).fetchAll();

    return {
      chunks: chunks.map((chunk: any) => ({
        id: chunk.id,
        content: chunk.content,
        metadata: chunk.metadata || {},
        embedding: chunk.embedding || [],
        createdAt: chunk.createdAt
      })),
      total
    };
  } catch (error) {
    console.error('Error retrieving document chunks:', error);
    return { chunks: [], total: 0 };
  }
};

export const batchUpsertChunks = async (
  companyId: string,
  chunks: Array<{
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    embedding: number[];
  }>
): Promise<{ status: 'success' | 'error'; chunksUpserted: number }> => {
  try {
    if (chunks.length === 0) {
      return { status: 'success', chunksUpserted: 0 };
    }

    const documentsContainer = await getContainer('Documents');
    let upserted = 0;

    // Process chunks in batches of 100
    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      
      // Upsert each chunk individually (Cosmos DB doesn't have batch upsert)
      for (const chunk of batch) {
        try {
          const chunkData = {
            id: chunk.id,
            companyId,
            content: chunk.content,
            metadata: chunk.metadata,
            embedding: chunk.embedding,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          // Try to update first, if it fails, create new
          try {
            await documentsContainer.item(chunk.id, companyId).replace(chunkData);
          } catch (error: any) {
            if (error.code === 404) {
              // Document doesn't exist, create it
              await documentsContainer.items.create(chunkData);
            } else {
              throw error;
            }
          }
          
          upserted++;
        } catch (error) {
          console.error(`Failed to upsert chunk ${chunk.id}:`, error);
          // Continue with other chunks even if one fails
        }
      }
    }

    console.log(`Upserted ${upserted} chunks for company ${companyId}`);
    return { status: 'success', chunksUpserted: upserted };
  } catch (error) {
    console.error('Error batch upserting chunks:', error);
    return { status: 'error', chunksUpserted: 0 };
  }
};

export const deleteDocumentVectors = async (
  companyId: string,
  documentId: string,
): Promise<{ status: 'success' | 'error'; vectorsDeleted: number }> => {
  try {
    // Fetch all chunk docs for the given document from Azure Cosmos DB
    const documentsContainer = await getContainer('Documents');
    const query = {
      query: "SELECT * FROM c WHERE c.companyId = @companyId AND c.metadata.documentId = @documentId",
      parameters: [
        { name: '@companyId', value: companyId },
        { name: '@documentId', value: documentId }
      ]
    };

    const { resources: chunks } = await documentsContainer.items.query(query).fetchAll();

    if (chunks.length === 0) {
      return { status: 'success', vectorsDeleted: 0 };
    }

    const chunkIds = chunks.map((chunk: any) => chunk.id);

    // Remove vectors from Azure AI Search index
    await vectorSearchService.removeDatapoints(chunkIds);

    // Delete chunk docs from Cosmos DB in batches of 100
    for (let i = 0; i < chunks.length; i += 100) {
      const slice = chunks.slice(i, i + 100);
      
      // Delete each chunk individually (Cosmos DB doesn't have batch delete)
      for (const chunk of slice) {
        try {
          await documentsContainer.item(chunk.id, companyId).delete();
        } catch (error) {
          console.error(`Failed to delete chunk ${chunk.id}:`, error);
          // Continue with other chunks even if one fails
        }
      }
    }

    console.log(`Deleted ${chunkIds.length} document vectors for document ${documentId}`);
    return { status: 'success', vectorsDeleted: chunkIds.length };
  } catch (error) {
    console.error('Error deleting document vectors:', error);
    return { status: 'error', vectorsDeleted: 0 };
  }
};
