import { logger } from '@/lib/logger';
import { azureOpenAIService as openaiService } from '@/lib/azure/openai';

export interface GenerateTextRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateTextResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

class AzureOpenAIService {
  async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
    try {
      const response = await openaiService.generateChatCompletion(
        request.messages,
        {
          maxTokens: request.maxTokens || 1000,
          temperature: request.temperature ?? 0  // Default to 0 for deterministic factual answers
        }
      );

      return {
        content: response.content,
        usage: response.usage
      };
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        model: request.model,
        messageCount: request.messages.length
      }, 'Azure OpenAI service error');
      throw error;
    }
  }

  async generateEmbeddings(text: string): Promise<number[]> {
    try {
      const response = await openaiService.generateEmbedding(text);
      return response;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        textLength: text.length
      }, 'Azure OpenAI embeddings error');
      throw error;
    }
  }

  async createChatCompletion(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<any> {
    return openaiService.generateChatCompletion(messages);
  }

  async generateResponse(prompt: string): Promise<string> {
    return openaiService.generateText(prompt);
  }
}

export const azureOpenAIService = new AzureOpenAIService();
