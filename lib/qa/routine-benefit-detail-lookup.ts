import { amerivetBenefits2024_2025 } from '@/lib/data/amerivet';
import type { Session } from '@/lib/rag/session-store';
import { getCoverageTierForQuery } from '@/lib/qa/medical-helpers';

function normalizeCoverageTierKey(tier: string) {
  switch (tier) {
    case 'Employee + Spouse':
      return 'employeeSpouse' as const;
    case 'Employee + Child(ren)':
      return 'employeeChildren' as const;
    case 'Employee + Family':
      return 'employeeFamily' as const;
    default:
      return 'employeeOnly' as const;
  }
}

function formatMonthlyPremium(monthly: number): string {
  return `$${monthly.toFixed(2)}/month`;
}

export function buildRoutineBenefitDetailAnswer(
  topic: 'Dental' | 'Vision',
  query: string,
  session: Session,
): string | null {
  const lower = query.toLowerCase();
  const coverageTier = getCoverageTierForQuery(query, session);
  const tierKey = normalizeCoverageTierKey(coverageTier);

  if (topic === 'Dental') {
    const dental = amerivetBenefits2024_2025.dentalPlan;
    const deductible = dental.coverage?.deductibles?.individual ?? dental.benefits.deductible;
    const familyDeductible = dental.coverage?.deductibles?.family ?? dental.benefits.deductible * 3;
    const preventiveCovered = dental.coverage?.coinsurance?.preventive !== undefined
      ? Math.round((1 - dental.coverage.coinsurance.preventive) * 100)
      : null;
    const basicCovered = dental.coverage?.coinsurance?.basic !== undefined
      ? Math.round((1 - dental.coverage.coinsurance.basic) * 100)
      : null;
    const majorCovered = dental.coverage?.coinsurance?.major !== undefined
      ? Math.round((1 - dental.coverage.coinsurance.major) * 100)
      : null;
    const orthoCopay = dental.coverage?.copays?.orthodontia;
    const premium = dental.tiers[tierKey];

    if (/\b(orthodont|braces)\b/i.test(lower)) {
      return [
        `For braces, the practical question is not just whether orthodontia exists on the plan, but how much of the cost the plan actually helps with.`,
        ``,
        `${dental.name}: orthodontia is included rather than excluded outright.`,
        '',
        typeof orthoCopay === 'number' ? `- Orthodontia copay: $${orthoCopay}` : '',
        typeof orthoCopay === 'number' ? `- In plain language, orthodontia copay is $${orthoCopay}` : '',
        '- This is more helpful than a dental plan with no orthodontic benefit at all',
        '- You still need to confirm any age limits, waiting periods, and orthodontic maximums in Workday before counting on a specific dollar outcome',
      ].filter(Boolean).join('\n');
    }

    if (/\b(waiting\s+period|how\s+long\s+before|when\s+does\s+major\s+service)\b/i.test(lower)) {
      const waiting = dental.limitations.find((item) => /waiting period/i.test(item));
      return waiting
        ? `${dental.name}: ${waiting}.`
        : `${dental.name}: I do not have a waiting-period line in the current source data, so I do not want to guess.`;
    }

    if (/\b(what\s+does\s+(?:the\s+)?dental\s+plan\s+cover|what\s+is\s+covered|dental\s+coverage|what\s+do\s+we\s+get)\b/i.test(lower)) {
      return [
        `${dental.name} coverage snapshot:`,
        '',
        `- Deductible: $${deductible} individual / $${familyDeductible} family`,
        preventiveCovered !== null ? `- Preventive care: ${preventiveCovered}% covered` : '',
        basicCovered !== null ? `- Basic services: ${basicCovered}% covered` : '',
        majorCovered !== null ? `- Major services: ${majorCovered}% covered` : '',
        typeof orthoCopay === 'number' ? `- Orthodontia copay: $${orthoCopay}` : '',
        typeof dental.coverage?.outOfPocketMax === 'number' ? `- Out-of-pocket max: $${dental.coverage.outOfPocketMax}` : '',
        `- ${coverageTier} premium: ${formatMonthlyPremium(premium)}`,
        '',
        '- Source-backed plan features:',
        ...dental.features.map((item) => `- ${item}`),
      ].filter(Boolean).join('\n');
    }

    if (/\b(what\s+does\s+preventive\s+care\s+mean|what\s+is\s+preventive\s+care|what\s+does\s+preventive\s+mean)\b/i.test(lower)) {
      return [
        `In AmeriVet's dental plan, preventive care usually means the routine care people expect to use to avoid bigger problems later.`,
        ``,
        `That typically includes things like cleanings, exams, and preventive x-rays under the plan's preventive bucket.`,
        preventiveCovered !== null ? `Source-backed detail: preventive care is ${preventiveCovered}% covered.` : '',
        `The key practical point is that preventive care is the easiest part of the dental plan to justify if your household actually goes to routine visits.`,
      ].filter(Boolean).join('\n');
    }

    if (/\b(what\s+are\s+basic\s+services|what\s+does\s+basic\s+services\s+mean|what\s+are\s+major\s+services|what\s+does\s+major\s+services\s+mean)\b/i.test(lower)) {
      return [
        `In AmeriVet's dental plan, the difference is basically about how simple versus expensive the procedure is.`,
        ``,
        `- Basic services usually mean more routine restorative work like fillings`,
        `- Major services usually mean bigger-ticket dental work like crowns, bridges, or more involved treatment`,
        ``,
        `That is why the plan usually feels most valuable when you already expect more than just preventive cleanings.`,
      ].join('\n');
    }

    if (/\b(copay|copays|deductible|preventive|basic services|major services|out[- ]of[- ]pocket)\b/i.test(lower)) {
      return [
        `${dental.name} practical cost structure:`,
        '',
        `- Deductible: $${deductible} individual / $${familyDeductible} family`,
        preventiveCovered !== null ? `- Preventive care: ${preventiveCovered}% covered` : '',
        basicCovered !== null ? `- Basic services: ${basicCovered}% covered` : '',
        majorCovered !== null ? `- Major services: ${majorCovered}% covered` : '',
        typeof orthoCopay === 'number' ? `- Orthodontia copay: $${orthoCopay}` : '',
        typeof dental.coverage?.outOfPocketMax === 'number' ? `- Out-of-pocket max: $${dental.coverage.outOfPocketMax}` : '',
      ].filter(Boolean).join('\n');
    }
  }

  if (topic === 'Vision') {
    const vision = amerivetBenefits2024_2025.visionPlan;
    const examCopay = vision.coverage?.copays?.exam;
    const lensesCopay = vision.coverage?.copays?.lenses;
    const premium = vision.tiers[tierKey];

    if (/\b(copay|copays|exam|eye exam|lenses)\b/i.test(lower)) {
      return [
        `${vision.name} point-of-service cost structure:`,
        '',
        typeof examCopay === 'number' ? `- Eye exam copay: $${examCopay}` : '',
        typeof lensesCopay === 'number' ? `- Lenses copay: $${lensesCopay}` : '',
        `- ${coverageTier} premium: ${formatMonthlyPremium(premium)}`,
      ].filter(Boolean).join('\n');
    }

    if (/\b(what\s+does\s+allowance\s+mean|what\s+is\s+the\s+frame\s+allowance|what\s+does\s+frame\s+allowance\s+mean)\b/i.test(lower)) {
      return [
        `The frame allowance is the amount the vision plan helps toward frames before you are paying the rest yourself.`,
        ``,
        `In AmeriVet's VSP Vision Plus plan, the source-backed perk is a $200 frame allowance.`,
        `So the practical question is whether your household actually buys glasses often enough for that allowance to matter.`,
      ].join('\n');
    }

    if (/\b(what\s+does\s+lasik\s+discount\s+mean|what\s+is\s+the\s+lasik\s+discount|lasik\s+discount)\b/i.test(lower)) {
      const lasikFeature = vision.features.find((item) => /lasik/i.test(item));
      return [
        `The LASIK discount means the vision plan gives you a discount arrangement for LASIK rather than treating it like standard medical coverage.`,
        ``,
        lasikFeature ? `In AmeriVet's VSP Vision Plus plan: ${lasikFeature}` : `In AmeriVet's VSP Vision Plus plan, LASIK is mentioned as a discount feature rather than a full traditional coverage benefit.`,
        `So this is more of a perk than a reason by itself to choose the plan unless someone in the household is already planning vision correction.`,
      ].join('\n');
    }

    if (/\b(frame|frames|contacts?|lasik|glasses)\b/i.test(lower)) {
      const lines = [`${vision.name} practical vision perks:`, ''];
      if (vision.features.some((item) => /frame allowance/i.test(item))) {
        lines.push(`- ${vision.features.find((item) => /frame allowance/i.test(item))}`);
      }
      if (vision.features.some((item) => /contact/i.test(item))) {
        lines.push(`- ${vision.features.find((item) => /contact/i.test(item))}`);
      }
      if (vision.features.some((item) => /lasik/i.test(item))) {
        lines.push(`- ${vision.features.find((item) => /lasik/i.test(item))}`);
      }
      if (vision.limitations.some((item) => /frame allowance/i.test(item))) {
        lines.push(`- ${vision.limitations.find((item) => /frame allowance/i.test(item))}`);
      }
      return lines.join('\n');
    }

    if (/\b(what\s+does\s+(?:the\s+)?vision\s+plan\s+cover|what\s+is\s+covered|vision\s+coverage|what\s+do\s+we\s+get)\b/i.test(lower)) {
      return [
        `${vision.name} coverage snapshot:`,
        '',
        typeof examCopay === 'number' ? `- Eye exam copay: $${examCopay}` : '',
        typeof lensesCopay === 'number' ? `- Lenses copay: $${lensesCopay}` : '',
        `- ${coverageTier} premium: ${formatMonthlyPremium(premium)}`,
        '',
        '- Source-backed plan features:',
        ...vision.features.map((item) => `- ${item}`),
        '',
        '- Source-backed limitations:',
        ...vision.limitations.map((item) => `- ${item}`),
      ].filter(Boolean).join('\n');
    }
  }

  return null;
}

export function isRoutineBenefitDetailQuestion(query: string): boolean {
  return /\b(what\s+does\s+(?:the\s+)?(?:dental|vision)\s+plan\s+cover|what\s+is\s+covered|copay|copays|orthodont|braces|waiting\s+period|major\s+services|basic\s+services|preventive\s+care|frame|frames|contacts?|lasik|glasses|eye exam|lenses|allowance)\b/i
    .test(query.toLowerCase());
}
