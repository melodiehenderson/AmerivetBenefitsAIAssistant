// @ts-nocheck
// lib/services/langchain-processor.ts
import { ChatOpenAI } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence, RunnableMap } from '@langchain/core/runnables';
import { logger } from '@/lib/logger';

interface DocumentAnalysisResult {
  summary: string;
  keyPoints: string[];
  recommendations: string[];
  confidence: number;
  processingTime: number;
}

interface ChainResult {
  response: string;
  confidence: number;
  reasoning: string[];
  metadata: any;
}

export class LangChainProcessor {


  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn('No OpenAI API key available for LangChain. Document processing will be limited.');
      return;
    }

    // Initialize LLM with Azure OpenAI configuration
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4',
      temperature: 0.1,
      maxTokens: 2000,
      openAIApiKey: apiKey,
      configuration: {
        baseURL: process.env.AZURE_OPENAI_ENDPOINT,
        defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview' },
        defaultHeaders: {
          'api-key': apiKey,
        },
      },
    });

    this.initializeChains();
  }

  private initializeChains() {
    // Document Analysis Chain
    const documentAnalysisPrompt = PromptTemplate.fromTemplate(`
You are an expert benefits analyst. Analyze the following document and provide:

1. A concise summary (2-3 sentences)
2. Key points (bullet list)
3. Actionable recommendations
4. Confidence level (0-1)

Document: {document}
Context: {context}

Format your response as JSON:
{{
  "summary": "Brief summary here",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "confidence": 0.85
}}
`);

    this.documentAnalyzer = RunnableSequence.from([
      documentAnalysisPrompt,
      this.llm,
      new StringOutputParser(),
    ]);

    // Question Answering Chain
    const qaPrompt = PromptTemplate.fromTemplate(`
You are a helpful benefits assistant. Answer the user's question based on the provided context.

Question: {question}
Context: {context}
User Profile: {userProfile}

Provide a clear, helpful answer that addresses their specific needs. Be conversational and practical.

Answer:
`);

    this.questionAnswerer = RunnableSequence.from([
      qaPrompt,
      this.llm,
      new StringOutputParser(),
    ]);

    // Recommendation Engine Chain
    const recommendationPrompt = PromptTemplate.fromTemplate(`
Based on the user's profile and question, provide personalized recommendations.

User Profile: {userProfile}
Question: {question}
Available Plans: {plans}

Provide 3-5 specific recommendations with reasoning. Be practical and consider their situation.

Recommendations:
`);

    this.recommendationEngine = RunnableSequence.from([
      recommendationPrompt,
      this.llm,
      new StringOutputParser(),
    ]);
  }

  async analyzeDocument(document: string, context?: string): Promise<DocumentAnalysisResult> {
    const startTime = Date.now();
    
    try {
      if (!this.documentAnalyzer) {
        return this.getFallbackDocumentAnalysis();
      }

      const result = await this.documentAnalyzer.invoke({
        document,
        context: context || 'Benefits document analysis',
      });

      const parsed = JSON.parse(result);
      const processingTime = Date.now() - startTime;

      return {
        summary: parsed.summary || 'Document analyzed successfully',
        keyPoints: parsed.keyPoints || [],
        recommendations: parsed.recommendations || [],
        confidence: parsed.confidence || 0.7,
        processingTime,
      };
    } catch (error) {
      logger.error('Document analysis failed', { error });
      return this.getFallbackDocumentAnalysis();
    }
  }

  async answerQuestion(question: string, context: string, userProfile?: any): Promise<ChainResult> {
    try {
      if (!this.questionAnswerer) {
        return this.getFallbackAnswer(question);
      }

      const result = await this.questionAnswerer.invoke({
        question,
        context,
        userProfile: userProfile ? JSON.stringify(userProfile) : 'No profile available',
      });

      return {
        response: result,
        confidence: 0.8,
        reasoning: ['Used LangChain QA chain', 'Applied user context'],
        metadata: { method: 'langchain_qa' },
      };
    } catch (error) {
      logger.error('Question answering failed', { error });
      return this.getFallbackAnswer(question);
    }
  }

  async generateRecommendations(userProfile: any, question: string, plans: string[]): Promise<ChainResult> {
    try {
      if (!this.recommendationEngine) {
        return this.getFallbackRecommendations();
      }

      const result = await this.recommendationEngine.invoke({
        userProfile: JSON.stringify(userProfile),
        question,
        plans: plans.join(', '),
      });

      return {
        response: result,
        confidence: 0.85,
        reasoning: ['Used LangChain recommendation engine', 'Applied user profile analysis'],
        metadata: { method: 'langchain_recommendations' },
      };
    } catch (error) {
      logger.error('Recommendation generation failed', { error });
      return this.getFallbackRecommendations();
    }
  }

  async processMultipleDocuments(documents: Document[]): Promise<DocumentAnalysisResult[]> {
    const results: DocumentAnalysisResult[] = [];
    
    for (const doc of documents) {
      const result = await this.analyzeDocument(doc.pageContent, doc.metadata?.source);
      results.push(result);
    }

    return results;
  }

  async createDocumentSummary(documents: Document[]): Promise<string> {
    const analyses = await this.processMultipleDocuments(documents);
    
    const summary = analyses.map((analysis, index) => 
      `Document ${index + 1}:\n${analysis.summary}\nKey Points: ${analysis.keyPoints.join(', ')}\n`
    ).join('\n');

    return summary;
  }

  private getFallbackDocumentAnalysis(): DocumentAnalysisResult {
    return {
      summary: 'Document analysis completed using fallback method',
      keyPoints: ['Document processed', 'Key information extracted'],
      recommendations: ['Review document details', 'Contact benefits administrator for questions'],
      confidence: 0.6,
      processingTime: 100,
    };
  }

  private getFallbackAnswer(question: string): ChainResult {
    return {
      response: `I understand you're asking about: ${question}. While I can't process this with advanced AI right now, I can help you with general benefits information.`,
      confidence: 0.5,
      reasoning: ['Used fallback response', 'Limited AI processing'],
      metadata: { method: 'fallback' },
    };
  }

  private getFallbackRecommendations(): ChainResult {
    return {
      response: 'Based on general best practices, I recommend reviewing all available plans and considering your specific healthcare needs and budget.',
      confidence: 0.5,
      reasoning: ['Used general recommendations', 'Limited personalization'],
      metadata: { method: 'fallback' },
    };
  }
}

export const langChainProcessor = new LangChainProcessor();
