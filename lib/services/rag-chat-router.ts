/**
 * RAG-Enhanced Chat Router
 * Combines hybrid retrieval with LLM generation and chunk validation
 */

import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { validateChunkPresenceForClaims } from '@/lib/rag/validation-pipeline';
import { buildRAGContext } from '@/lib/rag/context-builder';
import { hybridLLMRouter } from './hybrid-llm-router';
import { logger } from '@/lib/logger';

type ChatContext = {
  state?: string;
  division?: string;
  companyId: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export interface RAGChatResponse {
  content: string;
  responseType: 'rag' | 'fallback';
  confidence: number;
  timestamp: Date;
  metadata?: {
    chunksUsed: number;
    validationPassed: boolean;
    ungroundedClaims?: string[];
  };
}

const RAG_SYSTEM_PROMPT = `
You are a helpful Benefits Assistant. Use the provided context from retrieved documents to answer the user's question.
- Base your answers ONLY on the provided context chunks
- If the context doesn't contain enough information, say so and suggest checking the enrollment portal
- Cite specific plan names and details from the context
- Never hallucinate benefit details not present in the context
- Be concise, clear, and actionable
`.trim();

export class RAGChatRouter {
  async routeMessage(
    message: string,
    context: ChatContext
  ): Promise<RAGChatResponse> {
    const started = Date.now();

    try {
      // Step 1: Retrieve relevant chunks using hybrid search
      const retrievalResult = await hybridRetrieve(message, {
        companyId: context.companyId,
        state: context.state,
        dept: context.division,
      });

      if (!retrievalResult.chunks || retrievalResult.chunks.length === 0) {
        // No chunks found - fall back to LLM-only response
        return this.getFallbackResponse(message, context);
      }

      // Step 2: Build context from retrieved chunks
      const ragContext = buildRAGContext(retrievalResult.chunks);

      // Step 3: Generate response using LLM with RAG context
      const messages = [
        { role: 'system', content: RAG_SYSTEM_PROMPT },
        { role: 'system', content: `Context:\n${ragContext}` },
        { role: 'user', content: message }
      ];

      if (context.history) {
        context.history.forEach((h) => messages.splice(2, 0, h));
      }

      const llmResponse = await hybridLLMRouter.createChatCompletion({
        messages,
        model: process.env.SMART_ROUTER_MODEL || 'gpt-4o-mini',
        temperature: 0.3
      });

      // Step 4: Validate chunk presence for specific benefit claims (Issue #7 fix)
      const validation = validateChunkPresenceForClaims(
        llmResponse.content,
        retrievalResult.chunks
      );

      const finalContent = validation.valid
        ? llmResponse.content
        : validation.sanitizedAnswer;

      const latencyMs = Date.now() - started;

      logger.info('RAG chat response generated', {
        latencyMs,
        chunksUsed: retrievalResult.chunks.length,
        validationPassed: validation.valid,
        ungroundedClaims: validation.ungroundedClaims
      });

      return {
        content: finalContent,
        responseType: 'rag',
        confidence: 0.9,
        timestamp: new Date(),
        metadata: {
          chunksUsed: retrievalResult.chunks.length,
          validationPassed: validation.valid,
          ungroundedClaims: validation.ungroundedClaims
        }
      };

    } catch (error) {
      logger.error('RAGChatRouter failed, falling back', { error });
      return this.getFallbackResponse(message, context);
    }
  }

  private async getFallbackResponse(
    message: string,
    context: ChatContext
  ): Promise<RAGChatResponse> {
    // Fallback to LLM-only response without RAG
    try {
      const messages = [
        { role: 'system', content: RAG_SYSTEM_PROMPT },
        { role: 'user', content: message }
      ];

      const llmResponse = await hybridLLMRouter.createChatCompletion({
        messages,
        model: process.env.SMART_ROUTER_MODEL || 'gpt-4o-mini',
        temperature: 0.3
      });

      return {
        content: llmResponse.content,
        responseType: 'fallback',
        confidence: 0.5,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Fallback LLM failed', { error });
      return {
        content: "I'm sorry, I encountered an error processing your request. Please try again.",
        responseType: 'fallback',
        confidence: 0.3,
        timestamp: new Date()
      };
    }
  }
}

export const ragChatRouter = new RAGChatRouter();
