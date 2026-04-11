import type { Session } from '@/lib/rag/session-store';
import {
  AMERIVET_MEDICAL_PLAN_SUMMARIES,
  findMedicalPlanSummaryByAlias,
  type MedicalPlanSummary,
} from '@/lib/data/amerivet-plan-summaries';

function inferPlanFromQuery(queryLower: string, session: Session): MedicalPlanSummary | null {
  const direct = findMedicalPlanSummaryByAlias(queryLower);
  if (direct) return direct;

  if ((session.currentTopic || '').toLowerCase().includes('medical')) {
    const lastBot = (session.lastBotMessage || '').toLowerCase();
    if (/standard hsa/.test(lastBot) && /\bstandard\b/.test(queryLower)) {
      return AMERIVET_MEDICAL_PLAN_SUMMARIES.find((plan) => plan.planKey === 'standard_hsa') || null;
    }
    if (/enhanced hsa/.test(lastBot) && /\benhanced\b/.test(queryLower)) {
      return AMERIVET_MEDICAL_PLAN_SUMMARIES.find((plan) => plan.planKey === 'enhanced_hsa') || null;
    }
    if (/kaiser/.test(lastBot) && /\bkaiser\b/.test(queryLower)) {
      return AMERIVET_MEDICAL_PLAN_SUMMARIES.find((plan) => plan.planKey === 'kaiser_standard_hmo') || null;
    }
  }

  return null;
}

function buildPlanOverview(summary: MedicalPlanSummary): string {
  const lines = [
    `${summary.displayName} (${summary.provider}) summary:`,
    ``,
    `- Network: ${summary.network}`,
    `- Deductible: ${summary.deductible}`,
    `- Out-of-pocket max: ${summary.outOfPocketMax}`,
    `- Preventive care: ${summary.preventiveCare}`,
    `- Primary care: ${summary.primaryCare}`,
    `- Specialist: ${summary.specialist}`,
  ];

  if (summary.urgentCare) lines.push(`- Urgent care: ${summary.urgentCare}`);
  if (summary.emergencyRoom) lines.push(`- Emergency room: ${summary.emergencyRoom}`);
  lines.push(`- In-network coinsurance: ${summary.inNetworkCoinsurance}`);
  if (summary.outOfNetworkCoinsurance) lines.push(`- Out-of-network coinsurance: ${summary.outOfNetworkCoinsurance}`);
  if (summary.notes?.length) lines.push('', ...summary.notes.map((note) => `- Note: ${note}`));

  return lines.join('\n');
}

export function buildMedicalPlanDetailAnswer(query: string, session: Session): string | null {
  const queryLower = query.toLowerCase();
  const summary = inferPlanFromQuery(queryLower, session);
  if (!summary) return null;

  if (/\b(more\s+info|more\s+detail|details|summary|tell\s+me\s+about|show\s+me|overview)\b/i.test(queryLower)) {
    return `${buildPlanOverview(summary)}\n\nIf you want, I can also drill into a specific part of the plan like specialist visits, coinsurance, prescriptions, maternity, or therapy coverage.`;
  }

  if (/\b(primary\s+care|pcp|doctor\s+visit|office\s+visit)\b/i.test(queryLower)) {
    return `${summary.displayName}: primary care is ${summary.primaryCare}.`;
  }

  if (/\b(specialist)\b/i.test(queryLower)) {
    return `${summary.displayName}: specialist care is ${summary.specialist}.`;
  }

  if (/\b(urgent\s+care)\b/i.test(queryLower)) {
    return summary.urgentCare
      ? `${summary.displayName}: urgent care is ${summary.urgentCare}.`
      : `${summary.displayName}: I do not yet have a separate urgent care line item structured.`;
  }

  if (/\b(emergency\s+room|er)\b/i.test(queryLower)) {
    return summary.emergencyRoom
      ? `${summary.displayName}: emergency room care is ${summary.emergencyRoom}.`
      : `${summary.displayName}: I do not yet have a separate emergency room line item structured.`;
  }

  if (/\b(in[- ]network|in network)\b/i.test(queryLower) && /\b(coinsurance|cost[- ]sharing|coverage)\b/i.test(queryLower)) {
    return `${summary.displayName}: in-network coinsurance is ${summary.inNetworkCoinsurance}.`;
  }

  if (/\b(out[- ]of[- ]network|out of network)\b/i.test(queryLower) && /\b(coinsurance|cost[- ]sharing|coverage)\b/i.test(queryLower)) {
    return summary.outOfNetworkCoinsurance
      ? `${summary.displayName}: out-of-network coverage is ${summary.outOfNetworkCoinsurance}.`
      : `${summary.displayName}: I do not yet have a separate out-of-network line item structured.`;
  }

  if (/\b(network|ppo|hmo)\b/i.test(queryLower) && !/\bcoinsurance\b/i.test(queryLower)) {
    return `${summary.displayName} uses the ${summary.network}.`;
  }

  if (/\b(deductible)\b/i.test(queryLower)) {
    return `${summary.displayName}: deductible is ${summary.deductible}.`;
  }

  if (/\b(out[- ]of[- ]pocket|oop\s*max|max(?:imum)?\s*out[- ]of[- ]pocket)\b/i.test(queryLower)) {
    return `${summary.displayName}: out-of-pocket max is ${summary.outOfPocketMax}.`;
  }

  if (/\b(preventive)\b/i.test(queryLower)) {
    return `${summary.displayName}: preventive care is ${summary.preventiveCare}.`;
  }

  if (/\b(physical\s+therapy|therapy|pt|outpatient\s+therapy)\b/i.test(queryLower)) {
    return summary.physicalTherapy
      ? `${summary.displayName}: ${summary.physicalTherapy}.`
      : `${summary.displayName}: I do not yet have a separate physical therapy line item structured.`;
  }

  if (/\b(maternity|pregnan|delivery|prenatal|postnatal|baby|birth)\b/i.test(queryLower)) {
    return summary.maternity
      ? `${summary.displayName}: ${summary.maternity}.`
      : `${summary.displayName}: I do not yet have a dedicated maternity line item structured.`;
  }

  if (/\b(rx|prescription|drug|generic|brand|specialty)\b/i.test(queryLower)) {
    const rx = summary.prescriptionDrugs;
    if (!rx) return `${summary.displayName}: I do not yet have the prescription drug tiers structured.`;

    if (/\bgeneric\b/i.test(queryLower) && rx.generic) {
      return `${summary.displayName}: generic prescriptions are ${rx.generic}.`;
    }
    if (/\b(preferred\s+brand|brand)\b/i.test(queryLower) && rx.preferredBrand) {
      return `${summary.displayName}: preferred brand prescriptions are ${rx.preferredBrand}.`;
    }
    if (/\b(non[- ]preferred)\b/i.test(queryLower) && rx.nonPreferredBrand) {
      return `${summary.displayName}: non-preferred brand prescriptions are ${rx.nonPreferredBrand}.`;
    }
    if (/\bspecialty\b/i.test(queryLower) && rx.specialty) {
      return `${summary.displayName}: specialty prescriptions are ${rx.specialty}.`;
    }
    return `${summary.displayName}: ${rx.note || 'I do not yet have the prescription drug tiers structured in the plan-summary layer.'}`;
  }

  return null;
}
