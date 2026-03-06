// Stub implementation for vector store
export class VectorStore {
  async search(query: string) {
    // TODO: Implement vector search
    return [];
  }

  async add(documents: any[]) {
    // TODO: Implement document addition
    return Promise.resolve();
  }
}

export const vectorStore = new VectorStore();

// Additional exports needed by admin/faqs route
export async function generateEmbeddings(text: string) {
  try {
      const { generateEmbedding } = await import('@/lib/ai/embeddings');
      return await generateEmbedding(text);
  } catch (error) {
      console.warn("Embedding generation failed (legacy route):", error);
      return [];
  }
}

export async function upsertVectors(vectors: any[]) {
    // Safe failover - legacy admin route support
    console.warn("Legacy upsertVectors called but not implemented. Consider migrating to new vector system.");
    return Promise.resolve();
}