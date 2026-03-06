/**
 * Hybrid LLM Router
 * Routes requests between different LLM providers for cost optimization and performance
 */

import { OpenAI } from 'openai';
import { logger } from '@/lib/logger';

export interface LLMRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: number;
}

export class HybridLLMRouter {
  private openaiClient: OpenAI | null = null;
  private costThreshold: number = 0.01; // $0.01 threshold for model selection

  constructor() {
    // Lazy initialization: defer OpenAI client creation until runtime to prevent build-time crashes
  }

  /**
   * Lazy-initialize OpenAI client on first use (runtime only)
   */
  private getClient(): OpenAI {
    if (!this.openaiClient) {
      this.openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-build',
      });
    }
    return this.openaiClient;
  }

  /**
   * Route request to appropriate LLM based on cost and performance requirements
   */
  async routeRequest(request: LLMRequest): Promise<LLMResponse> {
    try {
      // For simple queries, use GPT-3.5 Turbo for cost efficiency
      if (this.isSimpleQuery(request.messages)) {
        return await this.routeToGPT35(request);
      }

      // For complex queries, use GPT-4 for better quality
      return await this.routeToGPT4(request);
    } catch (error) {
      logger.error('LLM routing failed', error);
      throw new Error('Failed to process LLM request');
    }
  }

  /**
   * Create chat completion (alias for compatibility)
   */
  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    return this.routeRequest(request);
  }

  /**
   * Process message (alias for compatibility)
   */
  async processMessage(request: { message: string; userId: string; conversationId: string }): Promise<LLMResponse> {
    return this.routeRequest({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: request.message },
      ],
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 1000
    });
  }

  private async routeToGPT35(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.getClient().chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: request.messages as any,
      temperature: request.temperature || 0.7,
      max_tokens: request.maxTokens || 1000,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      model: 'gpt-3.5-turbo',
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      cost: this.calculateCost('gpt-3.5-turbo', response.usage?.total_tokens || 0),
    };
  }

  private async routeToGPT4(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.getClient().chat.completions.create({
      model: 'gpt-4',
      messages: request.messages as any,
      temperature: request.temperature || 0.7,
      max_tokens: request.maxTokens || 2000,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      model: 'gpt-4',
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      cost: this.calculateCost('gpt-4', response.usage?.total_tokens || 0),
    };
  }

  private isSimpleQuery(messages: Array<{ role: string; content: string }>): boolean {
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage?.content || '';
    
    // Simple heuristics for query complexity
    const simpleKeywords = ['what', 'how', 'when', 'where', 'yes', 'no'];
    const complexKeywords = ['analyze', 'compare', 'explain', 'evaluate', 'synthesize'];
    
    const hasSimpleKeywords = simpleKeywords.some(keyword => 
      content.toLowerCase().includes(keyword)
    );
    const hasComplexKeywords = complexKeywords.some(keyword => 
      content.toLowerCase().includes(keyword)
    );
    
    return hasSimpleKeywords && !hasComplexKeywords && content.length < 200;
  }

  private calculateCost(model: string, tokens: number): number {
    const pricing = {
      'gpt-3.5-turbo': 0.0005 / 1000, // $0.0005 per 1K tokens
      'gpt-4': 0.03 / 1000, // $0.03 per 1K tokens
    };

    return (pricing[model as keyof typeof pricing] || 0.001) * tokens;
  }
}

export const hybridLLMRouter = new HybridLLMRouter();
