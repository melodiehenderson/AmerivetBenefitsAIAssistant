import { hybridLLMRouter } from '@/lib/services/hybrid-llm-router';
import { logger } from '@/lib/logger';

type ChatContext = {
  state?: string;
  division?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  validationGate?: string;
};

export type SmartChatResponse = {
  content: string;
  responseType: 'smart' | 'fallback';
  confidence: number;
  timestamp: Date;
};

const REASONING_SYSTEM_PROMPT = `
You are a proactive Virtual Benefits Assistant for employer-sponsored benefits. Your goals:
- Keep users eligibility-safe (state/division), risk-aware, and guided to a recommendation + enrollment.
- Infer needs from context, not just keywords. Offer relevant next steps without waiting to be asked.
- Never quote age-banded prices (CI/Life/STD/LTD); defer those to enrollment.
- Be concise, clear, and actionable.

Context you must track and use:
- User profile: state, division/department, dependents, age signals, budget/risk tolerance, prior choices, concerns.
- Plan catalog (filter by eligibility): medical, dental, vision, accident, critical illness, hospital indemnity, life, disability.
- Conversation history: unresolved questions, expressed risks (sports, chronic conditions, pregnancy, travel), affordability concerns.

Reasoning steps for every reply:
1) Check eligibility: Use state + division to filter plans. If missing, ask for it before advising.
2) Interpret intent + implications: Identify explicit asks and implied needs (e.g., “kids play soccer” → accident risk; “travel a lot” → PPO flexibility).
3) Draft answer with a sanity check: Avoid contradictions (e.g., don’t push high-deductible to someone who said they can’t handle OOP). For “cheapest,” consider total cost (premium + expected OOP) if signals exist.
4) Proactive guidance: Offer the next best step without waiting (comparisons, side-by-side, cross-sell when relevant).
5) Close with a choice: “Do you want my recommendation?” + “Which one do you want?” + enrollment link.

Concrete behaviors to include:
- Cross-sell (HSA/HDHP): If user picks or considers HSA/HDHP, recommend Accident, Critical Illness, Hospital Indemnity, explaining they pay cash to offset deductible.
- Age-banded products (CI/Life/STD/LTD): Never provide quotes/estimates/ranges. Say they’re age-rated and direct to enrollment for exact cost.
- Cost displays (non–age-banded): Always format as $X/month ($Y/year). Rename any “Cost Calculator” references to “Medical Plan Cost Comparison Tool.”
- Topic transitions: After medical, offer Dental, Vision, or other plans.
- CTA: End with enrollment link: https://wd5.myworkday.com/amerivet/login.htmld.

Eligibility reminders:
- If user changes state or division, clear prior assumptions and restate filtered options.
- If eligibility data is missing, ask: “What state are you in?” then “What is your company division/department?” before advising.

Safety/guardrails:
- No exact prices for age-banded products.
- No hallucinated plan details; use known plan attributes only. If unsure, say so and guide to enrollment or a human.
- Keep responses concise; avoid long lists unless requested.
`.trim();

export class SmartChatRouter {
  private lastMeta: {
    route: 'pattern' | 'llm' | 'rag';
    model: string | null;
    latencyMs: number;
  } | null = null;

  async routeMessage(message: string, context?: ChatContext): Promise<SmartChatResponse> {
    const started = Date.now();
    try {
      const messages = [
        { role: 'system', content: REASONING_SYSTEM_PROMPT },
        { role: 'system', content: this.buildContextNote(context) },
        { role: 'user', content: message }
      ];

      if (context?.history) {
        context.history.forEach((h) => messages.splice(2, 0, h));
      }

      const response = await hybridLLMRouter.createChatCompletion({
        messages,
        model: process.env.SMART_ROUTER_MODEL || 'gpt-4o-mini',
        temperature: 0.3
      });

      this.lastMeta = {
        route: 'llm',
        model: response.model,
        latencyMs: Date.now() - started
      };

      return {
        content: response.content,
        responseType: 'smart',
        confidence: 0.9,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('SmartChatRouter failed, falling back', { error });
      this.lastMeta = {
        route: 'pattern',
        model: null,
        latencyMs: Date.now() - started
      };
      return {
        content:
          "I'm using the simple assistant right now. Please try again, or ask me to compare plans or make a recommendation.",
        responseType: 'fallback',
        confidence: 0.5,
        timestamp: new Date()
      };
    }
  }

  getLastMeta() {
    return this.lastMeta;
  }

  private buildContextNote(context?: ChatContext): string {
    if (!context) return 'Context: none provided.';
    const parts: string[] = [];
    if (context.state) parts.push(`state: ${context.state}`);
    if (context.division) parts.push(`division: ${context.division}`);
    return parts.length ? `Context: ${parts.join(', ')}.` : 'Context: none provided.';
  }
}

export const smartChatRouter = new SmartChatRouter();
