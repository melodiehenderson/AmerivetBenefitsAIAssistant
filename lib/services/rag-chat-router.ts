import { buildCarrierLockBlock } from '@/lib/qa/facts';
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
  currentTopic?: string;
  lastBotMessage?: string;
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
You are Susie, a Senior Benefits Strategist for AmeriVet Veterinary Partners. You answer ONLY from
the retrieved context chunks injected below - never from general training knowledge.

GROUNDING RULES (non-negotiable):
- Every factual claim must be traceable to a specific plan name in the retrieved context.
- Citation format: state the plan name in-line, e.g. "The Standard HSA (BCBSTX) covers..."
- If a requested plan or benefit type is NOT present in the retrieved context, state it explicitly:
  "That plan or benefit is not in the retrieved AmeriVet catalog for your state."
- Never invent premiums, deductibles, network names, or coverage limits.
- If the context is insufficient to answer confidently, emit [[INSUFFICIENT_DATA]] and direct the
  user to: https://wd5.myworkday.com/amerivet/login.html

CARRIER LOCK (immutable - never re-assign a carrier to a different product):
${buildCarrierLockBlock()}

BANNED ENTITIES - NEVER include in responses:
- "Rightway" or "Right Way" - NOT an AmeriVet resource or carrier.
- "DHMO" - AmeriVet does NOT offer a DHMO dental plan. Only BCBSTX Dental PPO.
- "PPO" as a medical plan name - AmeriVet medical plans are "Standard HSA" and "Enhanced HSA" (they use BCBSTX PPO network, but the plans are NOT called "PPO").
- Phone number (305) 851-7310 - this is NOT an AmeriVet number.

DATA SCRUB RULES:
- Never attribute a Unum product to Allstate or vice versa.
- Never mention Rightway - it is not part of AmeriVet's network.
- Rate frequency: use ONLY "monthly" or "bi-weekly (per paycheck)". Never say "annual" or "yearly" for premiums.

OUTPUT STYLE:
- WHY (reasoning, risk/reward, age logic) -> natural language paragraphs.
- WHAT (plan comparisons, premiums, coverage tiers) -> markdown tables.
- Premium format: always "$X.XX/month ($Y.YY bi-weekly)".
- After answering a benefit topic, proactively offer the next relevant topic:
  e.g. after medical -> "Want to look at Dental and Vision next?"

CTA: End every substantive reply with the enrollment link:
  https://wd5.myworkday.com/amerivet/login.html
`.trim();

export class RAGChatRouter {
  async routeMessage(
    message: string,
    context: ChatContext,
  ): Promise<RAGChatResponse> {
    const started = Date.now();

    try {
      const retrievalResult = await hybridRetrieve(message, {
        companyId: context.companyId,
        state: context.state,
        dept: context.division,
        userState: context.state,
        userAge: context.userAge,
        ...(context.category ? { category: context.category } : {}),
      });

      if (!retrievalResult.chunks || retrievalResult.chunks.length === 0) {
        return this.getFallbackResponse(message, context);
      }

      const ragContext = buildRAGContext(retrievalResult.chunks);

      const lockedHeader = context.validationGate
        ? context.validationGate
        : [
            `USER CONTEXT (LOCKED - DO NOT ask for these again):`,
            context.userAge ? `Age: ${context.userAge}` : null,
            context.state ? `State: ${context.state}` : null,
            context.division ? `Division: ${context.division}` : null,
            context.category ? `Benefit Category in scope: ${context.category}` : null,
            context.currentTopic ? `Current Topic: ${context.currentTopic}` : null,
          ]
            .filter(Boolean)
            .join(' | ');

      const covSystemPrompt = buildChainOfVerificationPrompt(
        message,
        ragContext,
        RAG_SYSTEM_PROMPT,
      );

      const messages = [
        { role: 'system', content: lockedHeader },
        { role: 'system', content: covSystemPrompt },
        { role: 'user', content: message },
      ];

      if (context.history) {
        context.history.forEach((h) => messages.splice(2, 0, h));
      }

      let llmResponse = await hybridLLMRouter.createChatCompletion({
        messages,
        model: process.env.SMART_ROUTER_MODEL || 'gpt-4.1-mini',
        temperature: 0.3,
      });

      const verifierCtx = {
        intent: context.intent,
        category: context.category,
        state: context.state,
      };
      let verification = verifyResponse(llmResponse.content, verifierCtx);

      if (verification.action === 'refuse') {
        const fallback = buildPortalFallback();
        return {
          content: fallback,
          responseType: 'fallback',
          confidence: 0.0,
          timestamp: new Date(),
          metadata: {
            chunksUsed: retrievalResult.chunks.length,
            validationPassed: false,
            ungroundedClaims: verification.reasons,
          },
        };
      }

      if (verification.action === 'retry' && verification.correctiveInstruction) {
        logger.warn('[RAG] Verifier triggered retry', { reasons: verification.reasons });
        const retryMessages = [
          ...messages,
          { role: 'assistant', content: llmResponse.content },
          {
            role: 'system',
            content: buildCorrectiveRetryPrompt(
              llmResponse.content,
              verification.correctiveInstruction,
            ),
          },
        ];
        const retryResponse = await hybridLLMRouter.createChatCompletion({
          messages: retryMessages,
          model: process.env.SMART_ROUTER_MODEL || 'gpt-4.1-mini',
          temperature: 0.15,
        });
        const retryVerification = verifyResponse(retryResponse.content, verifierCtx);
        if (retryVerification.action === 'refuse') {
          return {
            content: buildPortalFallback(),
            responseType: 'fallback',
            confidence: 0.0,
            timestamp: new Date(),
            metadata: {
              chunksUsed: retrievalResult.chunks.length,
              validationPassed: false,
              ungroundedClaims: retryVerification.reasons,
            },
          };
        }
        llmResponse = retryResponse;
        verification = retryVerification;
      }

      const chunkValidation = validateChunkPresenceForClaims(
        llmResponse.content,
        retrievalResult.chunks,
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
        ungroundedClaims: chunkValidation.ungroundedClaims,
      });

      return {
        content: finalContent,
        responseType: 'rag',
        confidence: verification.action === 'pass' ? 0.95 : 0.75,
        timestamp: new Date(),
        metadata: {
          chunksUsed: retrievalResult.chunks.length,
          validationPassed: chunkValidation.valid,
          ungroundedClaims: chunkValidation.ungroundedClaims,
        },
      };
    } catch (error) {
      logger.error('RAGChatRouter failed, falling back', { error });
      return this.getFallbackResponse(message, context);
    }
  }

  private async getFallbackResponse(
    message: string,
    context: ChatContext,
  ): Promise<RAGChatResponse> {
    logger.warn('RAG fallback triggered without sufficient grounded context', {
      message,
      companyId: context.companyId,
      state: context.state,
      category: context.category,
    });

    return {
      content: buildPortalFallback(),
      responseType: 'fallback',
      confidence: 0,
      timestamp: new Date(),
      metadata: {
        chunksUsed: 0,
        validationPassed: false,
        ungroundedClaims: ['No grounded retrieval context was available'],
      },
    };
  }
}

export const ragChatRouter = new RAGChatRouter();
