/**
 * Hybrid LLM Router
 * Routes benefits queries through Azure OpenAI only so production traffic stays
 * within the Azure stack this app is already built around.
 */

import { logger } from '@/lib/logger';
import { azureOpenAIService } from '@/lib/services/azure-openai';

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

const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gpt-4.1-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4': { inputPer1M: 30, outputPer1M: 60 },
};

export class HybridLLMRouter {
  async routeRequest(request: LLMRequest): Promise<LLMResponse> {
    try {
      const requestedModel =
        request.model ||
        process.env.SMART_ROUTER_MODEL ||
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
        'gpt-4.1-mini';

      const response = await azureOpenAIService.generateText({
        messages: request.messages
          .filter((message): message is { role: 'system' | 'user' | 'assistant'; content: string } => {
            return ['system', 'user', 'assistant'].includes(message.role);
          })
          .map((message) => ({
            role: message.role as 'system' | 'user' | 'assistant',
            content: message.content,
          })),
        model: requestedModel,
        maxTokens: request.maxTokens || 1000,
        temperature: request.temperature ?? 0.3,
      });

      return {
        content: response.content,
        model: requestedModel,
        usage: response.usage,
        cost: this.calculateCost(
          requestedModel,
          response.usage.promptTokens,
          response.usage.completionTokens,
        ),
      };
    } catch (error) {
      logger.error('Azure LLM routing failed', error);
      throw new Error('Failed to process LLM request');
    }
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    return this.routeRequest(request);
  }

  async processMessage(request: {
    message: string;
    userId: string;
    conversationId: string;
  }): Promise<LLMResponse> {
    return this.routeRequest({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: request.message },
      ],
      model:
        process.env.SMART_ROUTER_MODEL ||
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
        'gpt-4.1-mini',
      temperature: 0.3,
      maxTokens: 1000,
    });
  }

  private calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4.1-mini'];
    return (
      (promptTokens / 1_000_000) * pricing.inputPer1M +
      (completionTokens / 1_000_000) * pricing.outputPer1M
    );
  }
}

export const hybridLLMRouter = new HybridLLMRouter();
