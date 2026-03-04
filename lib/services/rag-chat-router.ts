/**
 * RAG-Enhanced Chat Router
 * Combines hybrid retrieval with LLM generation and chunk validation
 */

import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { validateChunkPresenceForClaims } from '@/lib/rag/validation-pipeline';
import { buildRAGContext } from '@/lib/rag/context-builder';
import { hybridLLMRouter } from './hybrid-llm-router';
import { logger } from '@/lib/logger';
import { verifyResponse, buildPortalFallback } from '@/lib/rag/response-verifier';
import {
  buildChainOfVerificationPrompt,
  buildCorrectiveRetryPrompt,
} from '@/lib/rag/chain-of-verification';
import type { IntentType } from '@/lib/rag/query-understanding';

type ChatContext = {
  state?: string;
  division?: string;
  companyId: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  validationGate?: string;
  userAge?: number;
  category?: string;
  intent?: IntentType;
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
        state:     context.state,
        dept:      context.division,
        userState: context.state,
        userAge:   context.userAge,
        ...(context.category ? { category: context.category } : {}),
      });

      if (!retrievalResult.chunks || retrievalResult.chunks.length === 0) {
        // No chunks found - fall back to LLM-only response
        return this.getFallbackResponse(message, context);
      }

      // Step 2: Build context from retrieved chunks
      const ragContext = buildRAGContext(retrievalResult.chunks);

      // Step 3: Generate response using LLM with RAG context
      // DEVELOPER MESSAGE: hard-lock user context so the LLM never re-asks for age/state.
      const developerHeader = context.validationGate
        ? context.validationGate
        : [
            `USER CONTEXT (LOCKED — DO NOT ask for these again):`,
            context.userAge  ? `Age: ${context.userAge}` : null,
            context.state    ? `State: ${context.state}` : null,
            context.division ? `Division: ${context.division}` : null,
            context.category ? `Benefit Category in scope: ${context.category}` : null,
          ].filter(Boolean).join(' | ');

      // Use Chain-of-Verification prompt to force the LLM to self-validate
      // before emitting a response.
      const covSystemPrompt = buildChainOfVerificationPrompt(
        message,
        ragContext,
        developerHeader + '\n\n' + RAG_SYSTEM_PROMPT
      );

      const messages = [
        { role: 'system', content: covSystemPrompt },
        { role: 'user',   content: message }
      ];

      if (context.history) {
        context.history.forEach((h) => messages.splice(2, 0, h));
      }

      let llmResponse = await hybridLLMRouter.createChatCompletion({
        messages,
        model: process.env.SMART_ROUTER_MODEL || 'gpt-4o-mini',
        temperature: 0.3
      });

      // -----------------------------------------------------------------------
      // POST-GENERATION VERIFICATION GATE
      // -----------------------------------------------------------------------
      const verifierCtx = { intent: context.intent, category: context.category, state: context.state };
      let verification = verifyResponse(llmResponse.content, verifierCtx);

      if (verification.action === 'refuse') {
        // Hard refuse — send portal fallback; do not show LLM content.
        const fallback = buildPortalFallback();
        return {
          content: fallback,
          responseType: 'fallback',
          confidence: 0.0,
          timestamp: new Date(),
          metadata: { chunksUsed: retrievalResult.chunks.length, validationPassed: false,
            ungroundedClaims: verification.reasons },
        };
      }

      if (verification.action === 'retry' && verification.correctiveInstruction) {
        // Single corrective re-try — append correction to messages and call LLM once more.
        logger.warn('[RAG] Verifier triggered retry', { reasons: verification.reasons });
        const retryMessages = [
          ...messages,
          { role: 'assistant', content: llmResponse.content },
          { role: 'system',    content: buildCorrectiveRetryPrompt(llmResponse.content, verification.correctiveInstruction) },
        ];
        const retryResponse = await hybridLLMRouter.createChatCompletion({
          messages: retryMessages,
          model: process.env.SMART_ROUTER_MODEL || 'gpt-4o-mini',
          temperature: 0.15, // lower temp → more conservative on the correction
        });
        // Re-verify once; if still failing, pass through with a warning rather than looping.
        const retryVerification = verifyResponse(retryResponse.content, verifierCtx);
        if (retryVerification.action === 'refuse') {
          return {
            content: buildPortalFallback(),
            responseType: 'fallback',
            confidence: 0.0,
            timestamp: new Date(),
            metadata: { chunksUsed: retrievalResult.chunks.length, validationPassed: false,
              ungroundedClaims: retryVerification.reasons },
          };
        }
        llmResponse = retryResponse;
        verification = retryVerification;
      }

      // Step 4: Validate chunk presence for specific benefit claims (Issue #7 fix)
      const chunkValidation = validateChunkPresenceForClaims(
        llmResponse.content,
        retrievalResult.chunks
      );

      const finalContent = chunkValidation.valid
        ? llmResponse.content
        : chunkValidation.sanitizedAnswer;

      const latencyMs = Date.now() - started;

      logger.info('RAG chat response generated', {
        latencyMs,
        chunksUsed: retrievalResult.chunks.length,
        validationPassed: chunkValidation.valid,
        verifierAction: verification.action,
        ungroundedClaims: chunkValidation.ungroundedClaims
      });

      return {
        content: finalContent,
        responseType: 'rag',
        confidence: verification.action === 'pass' ? 0.95 : 0.75,
        timestamp: new Date(),
        metadata: {
          chunksUsed: retrievalResult.chunks.length,
          validationPassed: chunkValidation.valid,
          ungroundedClaims: chunkValidation.ungroundedClaims
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

      if (context.validationGate) {
        messages.unshift({ role: 'system', content: context.validationGate });
      }

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
