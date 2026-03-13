/**
 * Hybrid LLM Routing Service
 * Intelligently routes queries between GPT-3.5 Turbo (80%) and GPT-4 (20%) for cost optimization
 */

import { logger } from '@/lib/logger';
import { azureOpenAIService } from '@/lib/azure/openai';

export interface LLMQuery {
  prompt: string;
  context?: string;
  userId?: string;
  companyId?: string;
  conversationId?: string;
  metadata?: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: number;
  latency: number;
}

export interface LLMRoutingConfig {
  gpt35Threshold: number; // 0-1, queries below this complexity use GPT-3.5
  maxTokens: {
    gpt35: number;
    gpt4: number;
  };
  temperature: {
    gpt35: number;
    gpt4: number;
  };
  costPerToken: {
    gpt35: {
      prompt: number;
      completion: number;
    };
    gpt4: {
      prompt: number;
      completion: number;
    };
  };
}

export class HybridLLMService {
  private config: LLMRoutingConfig;
  private queryHistory: Map<string, number> = new Map();
  private modelUsage: Map<string, number> = new Map();

  constructor(config?: Partial<LLMRoutingConfig>) {
    this.config = {
      gpt35Threshold: 0.7, // 70% of queries use GPT-3.5
      maxTokens: {
        gpt35: 4000,
        gpt4: 8000,
      },
      temperature: {
        gpt35: 0,  // Must be 0 for deterministic factual RAG answers
        gpt4: 0,   // Must be 0 for deterministic factual RAG answers
      },
      costPerToken: {
        gpt35: {
          prompt: 0.0005 / 1000, // $0.0005 per 1K tokens
          completion: 0.0015 / 1000, // $0.0015 per 1K tokens
        },
        gpt4: {
          prompt: 0.03 / 1000, // $0.03 per 1K tokens
          completion: 0.06 / 1000, // $0.06 per 1K tokens
        },
      },
      ...config,
    };
  }

  /**
   * Route query to appropriate LLM based on complexity analysis
   */
  async routeQuery(query: LLMQuery): Promise<LLMResponse> {
    const startTime = Date.now();
    
    try {
      // Analyze query complexity
      const complexity = await this.analyzeQueryComplexity(query);
      
      // Determine which model to use
      const useGPT4 = complexity > this.config.gpt35Threshold;
      const model = useGPT4 ? 'gpt-4' : 'gpt-3.5-turbo';
      
      logger.info('LLM Routing Decision', {
        queryId: query.conversationId || 'unknown',
        complexity,
        threshold: this.config.gpt35Threshold,
        selectedModel: model,
        userId: query.userId,
        companyId: query.companyId,
      });

      // Generate response using selected model
      const response = await this.generateResponse(query, model);
      
      // Calculate metrics
      const latency = Date.now() - startTime;
      const cost = this.calculateCost(response.tokens, model);
      
      // Update usage statistics
      this.updateUsageStats(model, response.tokens.total);
      
      const result: LLMResponse = {
        content: response.content,
        model,
        tokens: response.tokens,
        cost,
        latency,
      };

      // Log response metrics
      logger.info('LLM Response Generated', {
        model,
        tokens: response.tokens.total,
        cost,
        latency,
        userId: query.userId,
        companyId: query.companyId,
      });

      return result;
    } catch (error) {
      logger.error('LLM Routing Error', {
        query: query.prompt.substring(0, 100),
        userId: query.userId,
        companyId: query.companyId,
      }, error as Error);
      
      // Fallback to GPT-3.5 on error
      return this.generateFallbackResponse(query);
    }
  }

  /**
   * Analyze query complexity to determine appropriate model
   */
  private async analyzeQueryComplexity(query: LLMQuery): Promise<number> {
    const prompt = query.prompt.toLowerCase();
    let complexity = 0.5; // Base complexity

    // Complexity indicators for GPT-4
    const gpt4Indicators = [
      // Complex reasoning
      'analyze', 'compare', 'evaluate', 'assess', 'calculate', 'compute',
      'reasoning', 'logic', 'deduce', 'infer', 'conclude',
      
      // Technical complexity
      'technical', 'complex', 'detailed', 'comprehensive', 'thorough',
      'advanced', 'sophisticated', 'intricate',
      
      // Multi-step tasks
      'step by step', 'process', 'workflow', 'procedure', 'methodology',
      'strategy', 'approach', 'plan', 'roadmap',
      
      // Creative tasks
      'creative', 'innovative', 'design', 'develop', 'create', 'build',
      'generate', 'compose', 'write', 'draft',
      
      // Problem solving
      'problem', 'issue', 'challenge', 'difficulty', 'troubleshoot',
      'debug', 'fix', 'resolve', 'solve',
      
      // Analysis tasks
      'data', 'statistics', 'metrics', 'analytics', 'insights',
      'trends', 'patterns', 'correlations', 'relationships',
    ];

    // Check for GPT-4 indicators
    for (const indicator of gpt4Indicators) {
      if (prompt.includes(indicator)) {
        complexity += 0.1;
      }
    }

    // Length-based complexity
    const wordCount = prompt.split(/\s+/).length;
    if (wordCount > 100) complexity += 0.2;
    if (wordCount > 200) complexity += 0.2;
    if (wordCount > 500) complexity += 0.3;

    // Context complexity
    if (query.context && query.context.length > 1000) {
      complexity += 0.2;
    }

    // Question complexity
    const questionMarks = (prompt.match(/\?/g) || []).length;
    if (questionMarks > 2) complexity += 0.1;

    // Cap complexity between 0 and 1
    return Math.min(Math.max(complexity, 0), 1);
  }

  /**
   * Generate response using specified model
   */
  private async generateResponse(query: LLMQuery, model: string): Promise<{
    content: string;
    tokens: { prompt: number; completion: number; total: number };
  }> {
    const maxTokens = model === 'gpt-4' 
      ? this.config.maxTokens.gpt4 
      : this.config.maxTokens.gpt35;
    
    const temperature = model === 'gpt-4' 
      ? this.config.temperature.gpt4 
      : this.config.temperature.gpt35;

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(query);
    
    // Build user prompt
    const userPrompt = this.buildUserPrompt(query);

    // Call Azure OpenAI service
    const response = await azureOpenAIService.generateChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], {
      maxTokens,
      temperature,
    });

    return {
      content: response.content,
      tokens: {
        prompt: response.usage?.promptTokens || 0,
        completion: response.usage?.completionTokens || 0,
        total: response.usage?.totalTokens || 0,
      },
    };
  }

  /**
   * Build system prompt based on query context
   */
  private buildSystemPrompt(query: LLMQuery): string {
    let systemPrompt = `You are a helpful benefits assistant AI. You help employees understand their benefits, answer questions, and provide guidance on benefit plans and policies.

Key guidelines:
- Be accurate and helpful
- Provide clear, concise answers
- If you don't know something, say so
- Focus on benefits-related topics
- Be professional and empathetic`;

    if (query.companyId) {
      systemPrompt += `\n\nYou are assisting employees from a specific company. Be aware of company-specific context when relevant.`;
    }

    if (query.context) {
      systemPrompt += `\n\nAdditional context: ${query.context}`;
    }

    return systemPrompt;
  }

  /**
   * Build user prompt from query
   */
  private buildUserPrompt(query: LLMQuery): string {
    let userPrompt = query.prompt;

    if (query.metadata) {
      const metadataStr = Object.entries(query.metadata)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      userPrompt += `\n\nAdditional information: ${metadataStr}`;
    }

    return userPrompt;
  }

  /**
   * Calculate cost based on token usage and model
   */
  private calculateCost(tokens: { prompt: number; completion: number }, model: string): number {
    const costs = model === 'gpt-4' 
      ? this.config.costPerToken.gpt4 
      : this.config.costPerToken.gpt35;
    
    const promptCost = tokens.prompt * costs.prompt;
    const completionCost = tokens.completion * costs.completion;
    
    return promptCost + completionCost;
  }

  /**
   * Update usage statistics
   */
  private updateUsageStats(model: string, tokens: number): void {
    const currentUsage = this.modelUsage.get(model) || 0;
    this.modelUsage.set(model, currentUsage + tokens);
  }

  /**
   * Generate fallback response using GPT-3.5
   */
  private async generateFallbackResponse(query: LLMQuery): Promise<LLMResponse> {
    logger.warn('Using fallback GPT-3.5 response', {
      queryId: query.conversationId || 'unknown',
      userId: query.userId,
      companyId: query.companyId,
    });

    const response = await this.generateResponse(query, 'gpt-3.5-turbo');
    
    return {
      content: response.content,
      model: 'gpt-3.5-turbo',
      tokens: response.tokens,
      cost: this.calculateCost(response.tokens, 'gpt-3.5-turbo'),
      latency: 0,
    };
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): {
    totalTokens: number;
    modelBreakdown: Record<string, number>;
    estimatedCost: number;
  } {
    const totalTokens = Array.from(this.modelUsage.values()).reduce((sum, tokens) => sum + tokens, 0);
    const modelBreakdown = Object.fromEntries(this.modelUsage);
    
    // Calculate estimated cost
    let estimatedCost = 0;
    for (const [model, tokens] of this.modelUsage) {
      const costs = model === 'gpt-4' 
        ? this.config.costPerToken.gpt4 
        : this.config.costPerToken.gpt35;
      
      // Assume 70% prompt, 30% completion for cost estimation
      const promptTokens = tokens * 0.7;
      const completionTokens = tokens * 0.3;
      
      estimatedCost += (promptTokens * costs.prompt) + (completionTokens * costs.completion);
    }

    return {
      totalTokens,
      modelBreakdown,
      estimatedCost,
    };
  }

  /**
   * Reset usage statistics
   */
  resetUsageStats(): void {
    this.modelUsage.clear();
    this.queryHistory.clear();
  }
}

// Export singleton instance
export const hybridLLMService = new HybridLLMService();
