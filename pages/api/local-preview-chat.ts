import type { NextApiRequest, NextApiResponse } from 'next';
import { ragChatRouter } from '@/lib/services/rag-chat-router';

type Plan = {
  name: string;
  provider: string;
  monthly: string;
  biweekly: string;
  deductible: string;
  oop: string;
  notes: string;
};

const ENROLLMENT_URL =
  process.env.NEXT_PUBLIC_ENROLLMENT_URL ||
  process.env.ENROLLMENT_PORTAL_URL ||
  'https://wd5.myworkday.com/amerivet/login.html';

const HR_PHONE = process.env.HR_PHONE_NUMBER || '888-217-4728';

const PLANS_BY_STATE: Record<string, Plan[]> = {
  TX: [
    {
      name: 'Standard HSA',
      provider: 'BCBSTX',
      monthly: '$86.84/month',
      biweekly: '$40.08 bi-weekly',
      deductible: '$3,500 individual / $7,000 family',
      oop: '$6,500',
      notes: 'Nationwide PPO network, HSA eligible, preventive care at 100%.',
    },
    {
      name: 'Enhanced HSA',
      provider: 'BCBSTX',
      monthly: '$160.36/month',
      biweekly: '$74.01 bi-weekly',
      deductible: '$2,500 individual / $5,000 family',
      oop: '$5,500',
      notes:
        'Lower deductible, enhanced employer HSA contribution, nationwide provider access.',
    },
  ],
  GA: [
    {
      name: 'Standard HSA',
      provider: 'BCBSTX',
      monthly: '$86.84/month',
      biweekly: '$40.08 bi-weekly',
      deductible: '$3,500 individual / $7,000 family',
      oop: '$6,500',
      notes: 'Nationwide PPO network, HSA eligible.',
    },
    {
      name: 'Enhanced HSA',
      provider: 'BCBSTX',
      monthly: '$160.36/month',
      biweekly: '$74.01 bi-weekly',
      deductible: '$2,500 individual / $5,000 family',
      oop: '$5,500',
      notes: 'Lower deductible, enhanced employer HSA contribution.',
    },
    {
      name: 'Kaiser Standard HMO',
      provider: 'Kaiser',
      monthly: '$142.17/month',
      biweekly: '$65.62 bi-weekly',
      deductible: '$1,000 individual / $2,000 family',
      oop: '$4,500',
      notes: 'Integrated Kaiser HMO only in Kaiser service areas.',
    },
  ],
  CA: [
    {
      name: 'Standard HSA',
      provider: 'BCBSTX',
      monthly: '$86.84/month',
      biweekly: '$40.08 bi-weekly',
      deductible: '$3,500 individual / $7,000 family',
      oop: '$6,500',
      notes: 'Nationwide PPO network, HSA eligible.',
    },
    {
      name: 'Enhanced HSA',
      provider: 'BCBSTX',
      monthly: '$160.36/month',
      biweekly: '$74.01 bi-weekly',
      deductible: '$2,500 individual / $5,000 family',
      oop: '$5,500',
      notes: 'Lower deductible, enhanced employer HSA contribution.',
    },
    {
      name: 'Kaiser Standard HMO',
      provider: 'Kaiser',
      monthly: '$142.17/month',
      biweekly: '$65.62 bi-weekly',
      deductible: '$1,000 individual / $2,000 family',
      oop: '$4,500',
      notes: 'Integrated Kaiser HMO only in Kaiser service areas.',
    },
  ],
  OR: [
    {
      name: 'Standard HSA',
      provider: 'BCBSTX',
      monthly: '$86.84/month',
      biweekly: '$40.08 bi-weekly',
      deductible: '$3,500 individual / $7,000 family',
      oop: '$6,500',
      notes: 'Nationwide PPO network, HSA eligible.',
    },
    {
      name: 'Enhanced HSA',
      provider: 'BCBSTX',
      monthly: '$160.36/month',
      biweekly: '$74.01 bi-weekly',
      deductible: '$2,500 individual / $5,000 family',
      oop: '$5,500',
      notes: 'Lower deductible, enhanced employer HSA contribution.',
    },
    {
      name: 'Kaiser Standard HMO',
      provider: 'Kaiser',
      monthly: '$142.17/month',
      biweekly: '$65.62 bi-weekly',
      deductible: '$1,000 individual / $2,000 family',
      oop: '$4,500',
      notes: 'Integrated Kaiser HMO only in Kaiser service areas.',
    },
  ],
  WA: [
    {
      name: 'Standard HSA',
      provider: 'BCBSTX',
      monthly: '$86.84/month',
      biweekly: '$40.08 bi-weekly',
      deductible: '$3,500 individual / $7,000 family',
      oop: '$6,500',
      notes: 'Nationwide PPO network, HSA eligible.',
    },
    {
      name: 'Enhanced HSA',
      provider: 'BCBSTX',
      monthly: '$160.36/month',
      biweekly: '$74.01 bi-weekly',
      deductible: '$2,500 individual / $5,000 family',
      oop: '$5,500',
      notes: 'Lower deductible, enhanced employer HSA contribution.',
    },
    {
      name: 'Kaiser Standard HMO',
      provider: 'Kaiser',
      monthly: '$142.17/month',
      biweekly: '$65.62 bi-weekly',
      deductible: '$1,000 individual / $2,000 family',
      oop: '$4,500',
      notes: 'Integrated Kaiser HMO only in Kaiser service areas.',
    },
  ],
};

function buildPlanTable(plans: Plan[]) {
  const header = '| Plan | Provider | Employee Only | Deductible | Out-of-Pocket Max | Notes |';
  const divider = '| --- | --- | --- | --- | --- | --- |';
  const rows = plans.map((plan) =>
    [
      plan.name,
      plan.provider,
      `${plan.monthly}<br />${plan.biweekly}`,
      plan.deductible,
      plan.oop,
      plan.notes,
    ].join(' | '),
  );

  return [header, divider, ...rows.map((row) => `| ${row} |`)].join('\n');
}

function buildLocalPreviewResponse(message: string, state: string, userAge?: number) {
  const normalized = message.toLowerCase();
  const selectedState = state.toUpperCase();
  const availablePlans = PLANS_BY_STATE[selectedState] || PLANS_BY_STATE.TX;

  if (/right\s*way|rightway|gold\s*ppo|ppo\s+support/.test(normalized)) {
    return {
      content: [
        "I couldn't verify that in the official AmeriVet benefits materials available in this local preview.",
        "If you'd like, reply with the specific benefit, plan name, or state you're asking about and I'll try again.",
        `For accurate, plan-specific details, please visit your [benefits enrollment portal](${ENROLLMENT_URL}) or speak with your HR team at ${HR_PHONE}.`,
      ].join('\n\n'),
      responseType: 'fallback',
      confidence: 0,
      metadata: {
        chunksUsed: 0,
        validationPassed: false,
        localPreview: true,
        ungroundedClaims: ['No Azure retrieval context is available in local preview mode'],
      },
    };
  }

  if (/compare.*medical.*table/.test(normalized)) {
    return {
      content: [
        `Here is a side-by-side comparison for **${selectedState}** based on the repo catalog used by this local preview:`,
        buildPlanTable(availablePlans),
        'Want me to walk through which plan is usually better for lower premiums versus lower deductible exposure?',
      ].join('\n\n'),
      responseType: 'catalog_preview',
      confidence: 0.83,
      metadata: {
        chunksUsed: 0,
        validationPassed: true,
        localPreview: true,
        source: 'repo-catalog-preview',
      },
    };
  }

  if (/what medical plans|medical plans are available|available in/.test(normalized)) {
    return {
      content: [
        `For **${selectedState}**, the medical plans available in this local repo preview are:`,
        buildPlanTable(availablePlans),
        userAge
          ? `I also captured age **${userAge}** for follow-up questions. If you want, I can compare these side by side next.`
          : 'If you want, I can compare these side by side next.',
      ].join('\n\n'),
      responseType: 'catalog_preview',
      confidence: 0.83,
      metadata: {
        chunksUsed: 0,
        validationPassed: true,
        localPreview: true,
        source: 'repo-catalog-preview',
      },
    };
  }

  return {
    content: [
      'This local preview is focused on grounded plan availability, no-guessing fallback behavior, and markdown table rendering.',
      'Try one of these:',
      '- `Does AmeriVet offer a gold PPO with Rightway support?`',
      '- `What medical plans are available in Texas?`',
      '- `Compare the medical plans in Texas in a table.`',
    ].join('\n\n'),
    responseType: 'catalog_preview',
    confidence: 0.4,
    metadata: {
      chunksUsed: 0,
      validationPassed: true,
      localPreview: true,
      source: 'repo-catalog-preview',
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, history, state, userAge } = req.body ?? {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (process.env.DISABLE_AZURE === '1') {
      return res.status(200).json(
        buildLocalPreviewResponse(
          message,
          typeof state === 'string' && state.trim() ? state : 'TX',
          typeof userAge === 'number' ? userAge : undefined,
        ),
      );
    }

    const response = await ragChatRouter.routeMessage(message, {
      companyId: 'amerivet',
      state: typeof state === 'string' ? state : undefined,
      userAge: typeof userAge === 'number' ? userAge : undefined,
      history: Array.isArray(history)
        ? history
            .filter(
              (item) =>
                item &&
                (item.role === 'user' || item.role === 'assistant') &&
                typeof item.content === 'string',
            )
            .map((item) => ({ role: item.role, content: item.content }))
        : undefined,
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error('Local preview chat failed', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
