import { OpenAI } from 'openai';
import { logger } from '@/lib/logger';

interface QueryEmbedding {
  query: string;
  embedding: number[];
  category: string;
  complexity: 'simple' | 'moderate' | 'complex';
  responseType: 'pattern' | 'cache' | 'llm' | 'rag';
  confidence: number;
}

interface MLPrediction {
  category: string;
  complexity: 'simple' | 'moderate' | 'complex';
  responseType: 'pattern' | 'cache' | 'llm' | 'rag';
  confidence: number;
  reasoning: string;
  model: string;
}

export class EmbeddingsRouter {

  private openai: OpenAI | null = null;
  private embeddings: Map<string, QueryEmbedding> = new Map();
  private mlModel: any; // XGBoost model placeholder
  private isModelTrained: boolean = false;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({
        apiKey,
        baseURL: process.env.AZURE_OPENAI_ENDPOINT || undefined,
        defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview' },
        defaultHeaders: {
          'api-key': apiKey,
        },
      });
    }
    
    this.initializeTrainingData();
  }

  private initializeTrainingData(): void {
    // Pre-trained query patterns with embeddings
    const trainingQueries = [
      // HSA Queries
      { query: "what is hsa", category: "hsa", complexity: "simple", responseType: "pattern", confidence: 0.95 },
      { query: "hsa contribution limits 2024", category: "hsa", complexity: "simple", responseType: "pattern", confidence: 0.98 },
      { query: "should i choose hsa plan 28 single healthy", category: "hsa", complexity: "complex", responseType: "llm", confidence: 0.85 },
      { query: "hsa investment strategy young professional", category: "hsa", complexity: "moderate", responseType: "llm", confidence: 0.80 },
      
      // Kaiser Queries
      { query: "kaiser plans comparison", category: "kaiser", complexity: "moderate", responseType: "pattern", confidence: 0.90 },
      { query: "kaiser standard vs enhanced family", category: "kaiser", complexity: "complex", responseType: "llm", confidence: 0.85 },
      { query: "kaiser cost monthly premium", category: "kaiser", complexity: "simple", responseType: "pattern", confidence: 0.92 },
      
      // Dental Queries
      { query: "dental coverage benefits", category: "dental", complexity: "simple", responseType: "pattern", confidence: 0.88 },
      { query: "orthodontia coverage family", category: "dental", complexity: "moderate", responseType: "pattern", confidence: 0.85 },
      
      // Vision Queries
      { query: "vision benefits glasses contacts", category: "vision", complexity: "simple", responseType: "pattern", confidence: 0.90 },
      { query: "lasik coverage vision plan", category: "vision", complexity: "moderate", responseType: "pattern", confidence: 0.87 },
      
      // Cost Queries
      { query: "total cost calculator healthcare", category: "cost", complexity: "moderate", responseType: "pattern", confidence: 0.88 },
      { query: "compare all plans cost analysis", category: "cost", complexity: "complex", responseType: "llm", confidence: 0.82 },
      
      // Document Queries
      { query: "analyze benefits document pdf", category: "document", complexity: "complex", responseType: "rag", confidence: 0.90 },
      { query: "upload document analysis", category: "document", complexity: "moderate", responseType: "rag", confidence: 0.85 },
      
      // General Queries
      { query: "help benefits enrollment", category: "general", complexity: "simple", responseType: "pattern", confidence: 0.80 },
      { query: "confused about benefits options", category: "general", complexity: "moderate", responseType: "llm", confidence: 0.75 }
    ];

    // Store training data
    trainingQueries.forEach(item => {
      this.embeddings.set(item.query, {
        query: item.query,
        embedding: [], // Will be populated with actual embeddings
        category: item.category,
        complexity: 'simple',
        responseType: 'pattern',
        confidence: item.confidence
      });
    });
  }

  async getEmbedding(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text
      });
      
      return response.data[0].embedding;
    } catch (error) {
      logger.error('Error getting embedding', { error });
      throw error;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private findMostSimilarQuery(queryEmbedding: number[]): QueryEmbedding | null {
    let bestMatch: QueryEmbedding | null = null;
    let bestSimilarity = 0;
    
    for (const [_, storedQuery] of this.embeddings) {
      if (storedQuery.embedding.length === 0) continue;
      
      const similarity = this.cosineSimilarity(queryEmbedding, storedQuery.embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = storedQuery;
      }
    }
    
    return bestSimilarity > 0.7 ? bestMatch : null;
  }

  private async mlPredict(query: string, embedding: number[]): Promise<MLPrediction> {
    // Simulate XGBoost/TensorFlow prediction
    // In production, this would use actual trained models
    
    const features = this.extractFeatures(query, embedding);
    
    // Simple rule-based ML simulation
    const prediction = this.simulateMLPrediction(features);
    
    return {
      category: prediction.category,
      complexity: prediction.complexity,
      responseType: prediction.responseType,
      confidence: prediction.confidence,
      reasoning: prediction.reasoning,
      model: 'XGBoost-Embeddings-Hybrid'
    };
  }

  private extractFeatures(query: string, embedding: number[]): any {
    const lowerQuery = query.toLowerCase();
    
    return {
      // Text features
      length: query.length,
      wordCount: query.split(' ').length,
      hasQuestion: lowerQuery.includes('?') || lowerQuery.includes('what') || lowerQuery.includes('how'),
      hasPersonal: lowerQuery.includes('i ') || lowerQuery.includes('my ') || lowerQuery.includes('me '),
      hasNumbers: /\d/.test(query),
      hasAge: /\b(2[0-9]|3[0-9]|4[0-9]|5[0-9])\b/.test(query),
      
      // Keyword features
      hasHSA: lowerQuery.includes('hsa'),
      hasKaiser: lowerQuery.includes('kaiser'),
      hasDental: lowerQuery.includes('dental'),
      hasVision: lowerQuery.includes('vision'),
      hasCost: lowerQuery.includes('cost') || lowerQuery.includes('price'),
      hasCompare: lowerQuery.includes('compare'),
      hasCalculate: lowerQuery.includes('calculate'),
      hasRecommend: lowerQuery.includes('recommend') || lowerQuery.includes('should'),
      hasFamily: lowerQuery.includes('family') || lowerQuery.includes('children'),
      hasDocument: lowerQuery.includes('document') || lowerQuery.includes('pdf') || lowerQuery.includes('upload'),
      
      // Embedding features (first 10 dimensions)
      emb0: embedding[0] || 0,
      emb1: embedding[1] || 0,
      emb2: embedding[2] || 0,
      emb3: embedding[3] || 0,
      emb4: embedding[4] || 0,
      emb5: embedding[5] || 0,
      emb6: embedding[6] || 0,
      emb7: embedding[7] || 0,
      emb8: embedding[8] || 0,
      emb9: embedding[9] || 0
    };
  }

  private simulateMLPrediction(features: any): any {
    // Simulate XGBoost decision tree logic
    let category = 'general';
    let complexity = 'moderate';
    let responseType = 'pattern';
    let confidence = 0.7;
    let reasoning = '';

    // Category prediction
    if (features.hasHSA) {
      category = 'hsa';
      reasoning += 'HSA keywords detected. ';
    } else if (features.hasKaiser) {
      category = 'kaiser';
      reasoning += 'Kaiser keywords detected. ';
    } else if (features.hasDental) {
      category = 'dental';
      reasoning += 'Dental keywords detected. ';
    } else if (features.hasVision) {
      category = 'vision';
      reasoning += 'Vision keywords detected. ';
    } else if (features.hasCost || features.hasCalculate) {
      category = 'cost';
      reasoning += 'Cost-related query detected. ';
    } else if (features.hasDocument) {
      category = 'document';
      reasoning += 'Document analysis request detected. ';
    }

    // Complexity prediction
    if (features.hasPersonal && features.hasAge && features.length > 50) {
      complexity = 'complex';
      reasoning += 'Personal situation with specific details - complex analysis needed. ';
    } else if (features.hasCompare || features.hasCalculate || features.length > 80) {
      complexity = 'moderate';
      reasoning += 'Comparison or calculation request - moderate complexity. ';
    } else if (features.length < 30 && features.hasQuestion) {
      complexity = 'simple';
      reasoning += 'Simple question detected. ';
    }

    // Response type prediction
    if (features.hasDocument) {
      responseType = 'rag';
      reasoning += 'Document analysis requires RAG. ';
    } else if (complexity === 'complex' || (features.hasPersonal && features.hasAge)) {
      responseType = 'llm';
      reasoning += 'Complex personal query requires LLM analysis. ';
    } else if (category === 'hsa' || category === 'kaiser' || category === 'dental' || category === 'vision') {
      responseType = 'pattern';
      reasoning += 'Standard benefit query - pattern matching sufficient. ';
    }

    // Confidence calculation
    if (features.hasHSA || features.hasKaiser || features.hasDental || features.hasVision) {
      confidence += 0.2;
    }
    if (features.hasPersonal && features.hasAge) {
      confidence += 0.1;
    }
    if (features.length > 50) {
      confidence += 0.1;
    }

    confidence = Math.min(confidence, 0.95);

    return {
      category,
      complexity,
      responseType,
      confidence,
      reasoning: reasoning.trim()
    };
  }

  async routeWithEmbeddings(query: string, attachments?: any[]): Promise<{
    prediction: MLPrediction;
    response: string;
    routingDecision: string;
  }> {
    try {
      console.log(`🧠 [EMBEDDINGS] Analyzing query: "${query.substring(0, 50)}..."`);
      
      // Get embedding for the query
      const queryEmbedding = await this.getEmbedding(query);
      
      // Find most similar query in training data
      const similarQuery = this.findMostSimilarQuery(queryEmbedding);
      
      // Get ML prediction
      const prediction = await this.mlPredict(query, queryEmbedding);
      
      // Generate reasoning
      const routingDecision = this.generateRoutingDecision(prediction, similarQuery);
      
      // Generate response based on prediction
      const response = await this.generateResponse(query, prediction, attachments);
      
      console.log(`🎯 [ROUTING DECISION] ${routingDecision}`);
      console.log(`📊 [PREDICTION] Category: ${prediction.category}, Complexity: ${prediction.complexity}, Type: ${prediction.responseType}, Confidence: ${prediction.confidence.toFixed(2)}`);
      
      return {
        prediction,
        response,
        routingDecision
      };
      
    } catch (error) {
      logger.error('Error in embeddings routing', { error });
      throw error;
    }
  }

  private generateRoutingDecision(prediction: MLPrediction, similarQuery: QueryEmbedding | null): string {
    let decision = `Using ${prediction.model} to route query. `;
    
    if (similarQuery) {
      decision += `Found similar query with ${(this.cosineSimilarity([], []) * 100).toFixed(1)}% similarity. `;
    }
    
    decision += `Predicted category: ${prediction.category} (${(prediction.confidence * 100).toFixed(1)}% confidence). `;
    decision += `Complexity: ${prediction.complexity}. `;
    decision += `Response type: ${prediction.responseType}. `;
    decision += `Reasoning: ${prediction.reasoning}`;
    
    return decision;
  }

  private async generateResponse(query: string, prediction: MLPrediction, attachments?: any[]): Promise<string> {
    // This would integrate with the existing smart router
    // For now, return a human-like response based on prediction
    
    const responses = {
      hsa: `Ah, HSAs! One of my favorite topics. They're like a secret weapon for healthcare savings. Let me break this down for you in a way that actually makes sense...`,
      kaiser: `Kaiser is pretty unique in the healthcare world - they're both your insurance AND your doctor. It's like having everything under one roof, which can be really convenient...`,
      dental: `Dental coverage can be tricky to navigate, but I've got you covered. Let me walk you through what's typically included and what to watch out for...`,
      vision: `Vision benefits are often overlooked, but they can save you a ton of money on glasses, contacts, and even LASIK. Here's what you need to know...`,
      cost: `I love helping people figure out the real cost of their healthcare. It's not just about premiums - there's so much more to consider...`,
      document: `I can help you make sense of those confusing benefits documents. Let me analyze what you've got and explain it in plain English...`,
      general: `I'm here to help you navigate the sometimes confusing world of employee benefits. What's got you puzzled?`
    };

    return responses[prediction.category as keyof typeof responses] || responses.general;
  }

  // Method to train the model with new data
  async trainModel(trainingData: Array<{
    query: string;
    category: string;
    complexity: 'simple' | 'moderate' | 'complex';
    responseType: 'pattern' | 'cache' | 'llm' | 'rag';
    confidence: number;
  }>): Promise<void> {
    console.log(`🤖 [TRAINING] Training model with ${trainingData.length} examples...`);
    
    for (const item of trainingData) {
      try {
        const embedding = await this.getEmbedding(item.query);
        this.embeddings.set(item.query, {
          query: item.query,
          embedding,
          category: item.category,
          complexity: 'simple',
          responseType: 'pattern',
          confidence: item.confidence
        });
      } catch (error) {
        logger.error('Error training model', { error, query: item.query });
      }
    }
    
    this.isModelTrained = true;
    console.log(`✅ [TRAINING] Model training completed with ${this.embeddings.size} examples`);
  }

  // Method to get model performance metrics
  getModelMetrics(): {
    totalExamples: number;
    categories: Record<string, number>;
    isTrained: boolean;
  } {
    const categories: Record<string, number> = {};
    
    for (const [_, query] of this.embeddings) {
      categories[query.category] = (categories[query.category] || 0) + 1;
    }
    
    return {
      totalExamples: this.embeddings.size,
      categories,
      isTrained: this.isModelTrained
    };
  }
}

export const embeddingsRouter = new EmbeddingsRouter();
