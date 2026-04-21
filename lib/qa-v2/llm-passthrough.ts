// Step 6 Layer C: LLM passthrough grounded in the AmeriVet package.
//
// Problem this solves: the L1 rule-based engine covers the most common and
// highest-stakes asks deterministically, but there will always be natural
// conversational shapes that no single regex catches. When L1 would
// otherwise fall through to the generic "useful next step" menu, we can
// defer to an LLM — strictly grounded in the AmeriVet catalog — so the
// assistant produces a real answer instead of a scaffold.
//
// Layered for safety:
// - OFF by default. Opt in via env `QA_V2_LLM_PASSTHROUGH=1`.
// - Grounded on the package catalog prompt builder (`getAmerivetCatalogForPrompt`)
//   — the same immutable-catalog text used by the legacy /api/qa route.
// - Best-effort retrieval augmentation via `hybridRetrieve` (tolerates
//   failure — catalog alone is enough for counselor-style asks).
// - Returns `null` on any failure path (missing creds, LLM error, empty
//   content). The engine falls through to its existing rule-based
//   `buildContextualFallback` menu in that case, so behavior is never
//   worse than before.

import { azureOpenAIService } from '@/lib/azure/openai';
import { getAmerivetBenefitsPackage, getAmerivetCatalogForPrompt } from '@/lib/data/amerivet-package';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { logger } from '@/lib/logger';
import type { Session, ChatMessage } from '@/lib/rag/session-store';
import type { Chunk } from '@/types/rag';

export type LlmPassthroughResult = {
  answer: string;
  metadata: {
    tier: 'L2-llm';
    retrievalChunks: number;
    latencyMs: number;
    usedRetrieval: boolean;
  };
};

const PASSTHROUGH_ENV_FLAG = 'QA_V2_LLM_PASSTHROUGH';

/**
 * True iff the passthrough is enabled for this process. Checked at call
 * time (not at import time) so tests can toggle the flag per-case.
 */
export function isLlmPassthroughEnabled(): boolean {
  return process.env[PASSTHROUGH_ENV_FLAG] === '1';
}

/**
 * Build the retrieval-augmentation block from hybrid-retrieval chunks.
 * Mirrors the score-filtered, token-budgeted shape of the production
 * `buildGroundedContext` but stays local so we don't depend on the
 * 3400-line /api/qa route module.
 */
function buildRetrievalBlock(chunks: Chunk[], rrfScores: number[]): string {
  if (!chunks.length) return '';
  const topScore = Math.max(...rrfScores, 0.001);
  const scoreThreshold = topScore * 0.25;
  const MAX_CHARS_PER_CHUNK = 700;
  const MAX_TOTAL_CHARS = 6000;

  const seen = new Set<string>();
  const parts: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < chunks.length; i++) {
    const score = rrfScores[i] ?? 0;
    if (score < scoreThreshold) continue;
    const chunk = chunks[i];
    const fingerprint = chunk.content.slice(0, 120).trim();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const title = chunk.title || 'Benefit Document';
    const section = chunk.sectionPath ? ` — ${chunk.sectionPath}` : '';
    const header = `BENEFIT DOCUMENT: ${title}${section}`;
    const body = chunk.content.length > MAX_CHARS_PER_CHUNK
      ? chunk.content.slice(0, MAX_CHARS_PER_CHUNK) + ' ...'
      : chunk.content;
    const entry = `${header}\n${body}`;
    if (totalChars + entry.length > MAX_TOTAL_CHARS) break;
    parts.push(entry);
    totalChars += entry.length;
  }
  return parts.join('\n\n---\n\n');
}

function formatSessionFacts(session: Session): string {
  const lines: string[] = [];
  if (session.userName) lines.push(`Name: ${session.userName}`);
  if (typeof session.userAge === 'number') lines.push(`Age: ${session.userAge}`);
  if (session.userState) lines.push(`State: ${session.userState}`);
  if (session.coverageTierLock) lines.push(`Coverage tier (locked): ${session.coverageTierLock}`);
  if (session.currentTopic) lines.push(`Current topic: ${session.currentTopic}`);
  if (session.familyDetails) {
    const { hasSpouse, numChildren } = session.familyDetails;
    const family: string[] = [];
    if (hasSpouse) family.push('spouse');
    if (typeof numChildren === 'number' && numChildren > 0) family.push(`${numChildren} child(ren)`);
    if (family.length) lines.push(`Household: ${family.join(' + ')}`);
  }
  if (session.selectedPlan) lines.push(`Selected plan so far: ${session.selectedPlan}`);
  return lines.length ? lines.join('\n') : 'No profile facts on file yet.';
}

function formatRecentMessages(messages: ChatMessage[] | undefined, limit = 6): string {
  if (!messages || !messages.length) return '(no prior turns)';
  const tail = messages.slice(-limit);
  return tail.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
}

function buildSystemPrompt(catalog: string, retrievalBlock: string, session: Session): string {
  const pricingRule = session.noPricingMode
    ? `- NO PRICING MODE ACTIVE: do not include $ amounts, premiums, or cost tables.`
    : `- When a dollar amount appears in your answer, it MUST come from the CATALOG below — never invent a number.`;

  return [
    `You are an AmeriVet benefits counselor talking 1:1 with an employee.`,
    ``,
    `COUNSELOR VOICE:`,
    `- Warm, direct, and decisive. Lead with the answer.`,
    `- Short paragraphs. No bullet-list scaffolding unless it genuinely helps.`,
    `- Never say "I'm an AI" or "Based on my training". You are the counselor.`,
    `- Never say "consult your HR representative" as your main answer — use the catalog below first, and only add an HR-contact line for truly off-catalog asks.`,
    ``,
    `GROUNDING RULES (non-negotiable):`,
    `- Answer ONLY from the AMERIVET CATALOG block and the optional BENEFIT DOCUMENT chunks below. If the answer is not derivable from those sources, say so plainly and point to HR (888-217-4728) or the enrollment portal. Do not speculate.`,
    `- Use plan names, carriers, and numbers verbatim from the catalog.`,
    pricingRule,
    `- Do not re-emit a generic "useful next step" menu. Give a substantive answer or a clear escalation.`,
    ``,
    `=== AMERIVET CATALOG (immutable truth) ===`,
    catalog,
    ``,
    retrievalBlock
      ? `=== ADDITIONAL BENEFIT DOCUMENTS (retrieved) ===\n${retrievalBlock}`
      : `=== ADDITIONAL BENEFIT DOCUMENTS ===\n(none retrieved for this turn — rely on the catalog above)`,
  ].join('\n');
}

function buildUserPrompt(query: string, session: Session): string {
  return [
    `EMPLOYEE PROFILE`,
    formatSessionFacts(session),
    ``,
    `RECENT CONVERSATION (most recent last)`,
    formatRecentMessages(session.messages),
    ``,
    `CURRENT QUESTION`,
    query,
  ].join('\n');
}

/**
 * Fire the LLM passthrough. Returns `null` when disabled, misconfigured,
 * or on any failure — the engine's caller falls through to the existing
 * rule-based fallback in those cases.
 */
export async function runLlmPassthrough(
  query: string,
  session: Session,
): Promise<LlmPassthroughResult | null> {
  const flagEnabled = isLlmPassthroughEnabled();
  logger.info(`[L2] passthrough entry: flag=${flagEnabled} queryLen=${query?.length ?? 0}`);
  if (!flagEnabled) return null;
  const cleanQuery = query?.trim();
  if (!cleanQuery) return null;

  const start = Date.now();
  try {
    const pkg = getAmerivetBenefitsPackage();
    const catalog = getAmerivetCatalogForPrompt(session.userState ?? null, pkg);

    let retrievalBlock = '';
    let retrievalChunks = 0;
    let usedRetrieval = false;
    try {
      const result = await hybridRetrieve(cleanQuery, {
        companyId: 'amerivet',
        ...(session.userState ? { state: session.userState } : {}),
        ...(typeof session.userAge === 'number' ? { userAge: session.userAge } : {}),
      });
      if (result?.gatePass !== false && result?.chunks?.length) {
        retrievalBlock = buildRetrievalBlock(result.chunks, result.scores?.rrf || []);
        retrievalChunks = result.chunks.length;
        usedRetrieval = Boolean(retrievalBlock);
      }
    } catch (retrievalError) {
      logger.warn(
        'L2 passthrough: retrieval augmentation failed; using catalog-only grounding',
        {},
        retrievalError as Error,
      );
    }

    const systemPrompt = buildSystemPrompt(catalog, retrievalBlock, session);
    const userPrompt = buildUserPrompt(cleanQuery, session);

    logger.info(`[L2] calling LLM: sysLen=${systemPrompt.length} userLen=${userPrompt.length} retrievalChunks=${retrievalChunks}`);
    const completion = await azureOpenAIService.generateChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        maxTokens: 600,
        temperature: 0.4,
        topP: 0.9,
      },
    );

    const answer = completion?.content?.trim();
    if (!answer) {
      logger.warn('[L2] empty LLM response; falling through to rule-based fallback');
      return null;
    }

    logger.info(`[L2] LLM replied: chars=${answer.length} latencyMs=${Date.now() - start}`);
    return {
      answer,
      metadata: {
        tier: 'L2-llm',
        retrievalChunks,
        latencyMs: Date.now() - start,
        usedRetrieval,
      },
    };
  } catch (error) {
    logger.warn(
      `[L2] LLM call failed; falling through: ${(error as Error)?.message ?? 'unknown'}`,
      {},
      error as Error,
    );
    return null;
  }
}
