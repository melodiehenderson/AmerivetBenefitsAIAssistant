// LLM passthrough: the default conversational path in the Phase 1
// architecture.
//
// The Phase 1 pivot inverts the engine: a tiny deterministic allowlist
// (plan detail by name, term registry, benefits overview, topic
// switch) handles the must-be-exact asks; everything else — natural
// follow-ups, recommendations, "what would you do in my situation",
// decision guidance — comes through here. The LLM has the immutable
// AmeriVet catalog and the BCG ground-truth rules in its system
// prompt, and is explicitly instructed to answer from them and nowhere
// else.
//
// Layered for safety:
// - ON by default. Kill switch via env `QA_V2_LLM_PASSTHROUGH=0`. If
//   disabled, the engine emits a one-line counselor escalation rather
//   than a scaffold menu.
// - Grounded on the package catalog prompt builder (`getAmerivetCatalogForPrompt`)
//   and BCG employer-guidance rules (ground-truth reasoning rules that
//   apply even when the user's wording doesn't match).
// - Best-effort retrieval augmentation via `hybridRetrieve` (tolerates
//   failure — catalog + rules alone are enough for counselor-style asks).
// - Returns `null` on any failure path (disabled, missing creds, LLM
//   error, empty content). The engine's caller emits the one-line
//   escalation in that case.

import { azureOpenAIService } from '@/lib/azure/openai';
import { getAmerivetBenefitsPackage, getAmerivetCatalogForPrompt } from '@/lib/data/amerivet-package';
import { BCG_EMPLOYER_GUIDANCE_RULES, type BCGEmployerGuidanceRule } from '@/lib/data/bcg-employer-guidance';
import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { logger } from '@/lib/logger';
import type { Session, ChatMessage } from '@/lib/rag/session-store';
import type { Chunk } from '@/types/rag';
import { validateLlmOutput } from '@/lib/qa-v2/post-gen-validator';

export type LlmPassthroughResult = {
  answer: string;
  metadata: {
    tier: 'L2-llm';
    retrievalChunks: number;
    latencyMs: number;
    usedRetrieval: boolean;
    retried?: boolean;
    validationWarning?: boolean;
  };
};

const PASSTHROUGH_ENV_FLAG = 'QA_V2_LLM_PASSTHROUGH';

/**
 * True unless the kill switch is explicitly set to '0'. Checked at call
 * time (not at import time) so tests can toggle the flag per-case.
 *
 * Phase 1 pivot: passthrough is the default conversational path. The
 * '0' kill switch reverts to deterministic-only mode (allowlist +
 * one-line escalation), which stays functional — just less chatty.
 */
export function isLlmPassthroughEnabled(): boolean {
  return process.env[PASSTHROUGH_ENV_FLAG] !== '0';
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
  if (typeof session.userSalary === 'number') lines.push(`Salary: $${session.userSalary.toLocaleString()}/yr`);

  if (session.familyDetails) {
    const { hasSpouse, numChildren } = session.familyDetails;
    const family: string[] = [];
    if (hasSpouse) family.push('spouse');
    if (typeof numChildren === 'number' && numChildren > 0) family.push(`${numChildren} child(ren)`);
    if (family.length) lines.push(`Household: ${family.join(' + ')}`);
  }

  // Usage signals — the two signals we act on (pregnancy affects plan-type
  // recommendation; upcoming surgery affects OOP max reasoning).
  const usageSignals: string[] = [];
  if (session.lifeEvents?.includes('pregnancy') || session.medicalNeeds?.includes('pregnancy/delivery')) {
    usageSignals.push('PREGNANCY — recommend plans with lower deductible and OOP max; flag HMO network risk for OB');
  }
  if (session.medicalNeeds?.includes('upcoming-surgery')) {
    usageSignals.push('UPCOMING SURGERY — employee will likely hit OOP max; prioritise lower OOP max over lower premium');
  }
  if (usageSignals.length) lines.push(`Usage signals:\n${usageSignals.map((s) => `  - ${s}`).join('\n')}`);

  if (session.currentTopic) lines.push(`Current topic: ${session.currentTopic}`);
  if (session.selectedPlan) lines.push(`Medical plan chosen: ${session.selectedPlan}`);

  const covered = session.completedTopics ?? [];
  if (covered.length) lines.push(`Topics already covered: ${covered.join(', ')}`);

  return lines.length ? lines.join('\n') : 'No profile facts on file yet.';
}

function formatRecentMessages(messages: ChatMessage[] | undefined, limit = 6): string {
  if (!messages || !messages.length) return '(no prior turns)';
  const tail = messages.slice(-limit);
  return tail.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
}

function formatBcgRulesBlock(rules: readonly BCGEmployerGuidanceRule[]): string {
  if (!rules.length) return '(no client-level reasoning rules active)';
  return rules
    .map((rule) => {
      const lines: string[] = [];
      lines.push(`RULE ${rule.id} — ${rule.title}`);
      lines.push(`Topic: ${rule.topic} (intent family: ${rule.intentFamily})`);
      lines.push(`Recommendation: ${rule.recommendationLabel}.`);
      const primaryPlan = rule.allocation.primaryPlan.replace(/_/g, ' ');
      const secondaryPlan = rule.allocation.secondaryPlan.replace(/_/g, ' ');
      lines.push(
        `Allocation: ${rule.allocation.primaryPercent}% ${primaryPlan} + ${rule.allocation.secondaryPercent}% ${secondaryPlan}.`,
      );
      if (rule.rationale.length) {
        lines.push(`Rationale:`);
        for (const reason of rule.rationale) lines.push(`  - ${reason}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function formatTopicsRemaining(session: Session): string {
  const order = ['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident/AD&D', 'HSA/FSA'];
  const covered = new Set(session.completedTopics ?? []);
  const remaining = order.filter((t) => !covered.has(t));
  if (!remaining.length) return '(all package topics have been touched)';
  return remaining.join(', ');
}

function buildSystemPrompt(
  catalog: string,
  retrievalBlock: string,
  session: Session,
  catalogViolations?: string[],
): string {
  const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL ?? 'https://wd5.myworkday.com/amerivet/login.html';
  const pricingRule = session.noPricingMode
    ? `- NO PRICING MODE ACTIVE: do not include $ amounts, premiums, or cost tables.`
    : `- When a dollar amount appears in your answer, it MUST come from the CATALOG below — never invent a number. If you cannot find the exact figure, say "I don't have that detail" and direct them to ${enrollmentUrl} or 888-217-4728.`;

  const violationWarning = catalogViolations?.length
    ? [
        ``,
        `⚠ GROUNDING CORRECTION REQUIRED:`,
        `Your previous response contained values not found in the catalog: ${catalogViolations.join(', ')}.`,
        `Do not use those values. Answer using ONLY information in the CATALOG block below.`,
        `If you cannot answer without those values, use the escalation line instead.`,
      ].join('\n')
    : '';

  const bcgRules = formatBcgRulesBlock(BCG_EMPLOYER_GUIDANCE_RULES);
  const topicsRemaining = formatTopicsRemaining(session);

  return [
    violationWarning,
    `You are a benefits counselor talking 1:1 with an employee.`,
    ``,
    `COUNSELOR VOICE:`,
    `You are a trusted HR friend who knows this benefits handbook cold. You give straight answers, commit to opinions when asked, and never apologize for what the plan does or doesn't include — you explain what's there and how it works for this specific person. No hedging, no menus, no "it depends" without immediately saying what it depends on and resolving it. When only one plan is available for this employee, present it confidently as their plan. You are not an AI; you are the counselor. Lead with the answer — never build up to it. If someone asks what their total costs are, say the number first, then explain it. When a user is confirming or reacting to a number or recommendation you already gave, answer the specific question directly and briefly — don't repeat the full comparison.`,
    ``,
    `FORMAT: For plan pricing, feature lists, and multi-item comparisons always use bullet points or a structured list — prose makes numbers hard to scan. For short answers and transitions, prose is fine.`,
    ``,
    `GROUNDING RULES (non-negotiable):`,
    `- Answer ONLY from the AMERIVET CATALOG block, the BCG REASONING RULES block, and the optional BENEFIT DOCUMENT chunks below. If the answer is not derivable from those sources, say so plainly and point to the enrollment portal (${enrollmentUrl}) or a benefits counselor (888-217-4728). Do not speculate.`,
    `- Use plan names, carriers, and numbers verbatim from the catalog.`,
    pricingRule,
    `- Coverage tier: always quote plan costs at the tier shown as "Coverage tier (locked)" in EMPLOYEE PROFILE. Never default to Employee Only if a different tier is already established. If no tier is locked, use Employee Only and note it.`,
    `- BCG REASONING RULES are ground truth. They apply every time their topic comes up, even when the employee's wording does not literally match the rule's wording. Never give a recommendation that contradicts a BCG rule.`,
    `- Do not re-emit a generic "useful next step" menu. Give a substantive answer.`,
    ``,
    `RECOMMENDATION STYLE:`,
    `- When you give a recommendation, include (a) the pick, (b) one sentence on why it fits this specific employee, (c) one tradeoff worth knowing. No hedging.`,
    `- When the employee asks "which one?", "what do you recommend?", "should I get X?", or confirms a plan choice — COMMIT to a specific answer. Never escalate on a recommendation or sizing question. If salary data is missing and needed, ask for it in one sentence rather than escalating.`,
    `- Clarifying-question budget: at most one per recommendation, and only if the answer genuinely changes. If the user's facts are thin, commit to the best-guess pick and note the assumption out loud.`,
    ``,
    `PROACTIVE NEXT DECISION (important):`,
    `- When your answer closes out a topic (the employee has what they need to decide), end with a short one-sentence nudge toward the next outstanding topic.`,
    `- Topics still outstanding for this employee (IN THIS ORDER): ${topicsRemaining}.`,
    `- Always nudge toward the FIRST topic in that list — do not skip ahead to a topic you think is more important. The order is intentional.`,
    `- Example phrasing: "Dental is settled — vision is the next decision. Want me to walk you through it?" / "That covers medical — dental is next. Ready?"`,
    `- Skip the nudge if the employee is mid-question or the turn is clearly not a closing one.`,
    ``,
    `RUNNING COST TOTAL RULE:`,
    `- When the employee asks about their total so far, combined monthly premium, or "how much am I already paying" — this is NEVER a question about the current topic. Read back through the conversation history, identify every plan the employee has confirmed or said they want, look up each premium from the catalog at the locked coverage tier, sum them, and lead with the total dollar amount. Example: "You're at $172.76/month — Enhanced HSA ($160.36) + VSP Vision Plus ($12.40)." If a plan they mentioned has no confirmed premium, say you don't have that figure and note what you do have.`,
    ``,
    `TOPIC OVERVIEW RULE:`,
    `- When the employee says "yes", "sure", "ok", or a similar affirmation in response to a topic nudge, give a complete overview of that topic. For Life Insurance: always lead with the employer-paid Basic Life & AD&D ($25,000 at $0 cost, auto-enrolled) before discussing optional additions. For all topics: use the locked coverage tier for all pricing.`,
    ``,
    `ESCALATION:`,
    `- Only use the escalation line for asks that are completely off-catalog — not listed in any plan, carrier, or benefit in the catalog at all (e.g. pet insurance, legal plans, gym memberships).`,
    `- For "tell me more", "show me the details", or "what else should I know" — answer from the catalog even if your answer is shorter than ideal. Never escalate on a covered benefit.`,
    `- When you must escalate, use only this line: "I want to make sure you get this right — a benefits counselor can walk you through this at 888-217-4728, or you can review enrollment materials at ${enrollmentUrl}." No bullet lists.`,
    ``,
    `=== BCG REASONING RULES (ground truth — always apply) ===`,
    bcgRules,
    ``,
    `=== AMERIVET CATALOG (immutable truth) ===`,
    catalog,
    ``,
    retrievalBlock
      ? `=== ADDITIONAL BENEFIT DOCUMENTS (retrieved) ===\n${retrievalBlock}`
      : `=== ADDITIONAL BENEFIT DOCUMENTS ===\n(none retrieved for this turn — rely on the catalog and rules above)`,
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
  if (!isLlmPassthroughEnabled()) return null;
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

    const completion = await azureOpenAIService.generateChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        maxTokens: 600,
        temperature: 0.3,
        topP: 0.9,
      },
    );

    const answer = completion?.content?.trim();
    if (!answer) {
      logger.warn('L2 passthrough: empty LLM response; falling through to rule-based fallback');
      return null;
    }

    // Phase 2: post-generation catalog validation.
    const validation = validateLlmOutput(answer, session.userState ?? null);
    if (!validation.valid) {
      logger.warn(
        'L2 passthrough: catalog validation failed; retrying with stricter grounding prompt',
        { offenders: validation.offenders },
      );
      // Retry once with a stricter system prompt that surfaces the specific violations.
      const strictSystemPrompt = buildSystemPrompt(catalog, retrievalBlock, session, validation.offenders);
      const retryCompletion = await azureOpenAIService.generateChatCompletion(
        [
          { role: 'system', content: strictSystemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { maxTokens: 600, temperature: 0.2, topP: 0.9 },
      ).catch(() => null);
      const retryAnswer = retryCompletion?.content?.trim();
      if (!retryAnswer) {
        logger.warn('L2 passthrough: retry also failed; falling through to escalation');
        return null;
      }
      const retryValidation = validateLlmOutput(retryAnswer, session.userState ?? null);
      if (!retryValidation.valid) {
        // Retry still has catalog violations. Return the retry answer anyway
        // with a Workday verification note — a slightly-imperfect answer is
        // far better than a counselor escalation for routine plan questions.
        logger.warn(
          'L2 passthrough: retry still contains catalog violations; returning with disclaimer',
          { offenders: retryValidation.offenders },
        );
        const disclaimer = `\n\n*For exact figures, confirm in [Workday](https://wd5.myworkday.com/amerivet/login.html) or call a benefits counselor at 888-217-4728.*`;
        return {
          answer: retryAnswer + disclaimer,
          metadata: {
            tier: 'L2-llm',
            retrievalChunks,
            latencyMs: Date.now() - start,
            usedRetrieval,
            retried: true,
            validationWarning: true,
          },
        };
      }
      return {
        answer: retryAnswer,
        metadata: {
          tier: 'L2-llm',
          retrievalChunks,
          latencyMs: Date.now() - start,
          usedRetrieval,
          retried: true,
        },
      };
    }

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
      'L2 passthrough: LLM call failed; falling through to rule-based fallback',
      {},
      error as Error,
    );
    return null;
  }
}
