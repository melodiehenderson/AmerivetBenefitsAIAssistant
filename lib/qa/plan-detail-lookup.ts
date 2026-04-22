import type { Session } from '@/lib/rag/session-store';
import {
  AMERIVET_MEDICAL_PLAN_SUMMARIES,
  findMedicalPlanSummaryByAlias,
  type MedicalPlanSummary,
} from '@/lib/data/amerivet-plan-summaries';
import {
  type BenefitPlan,
  type BenefitTier,
} from '@/lib/data/amerivet';
import {
  getAmerivetBenefitsPackage,
  getAmerivetPlanById,
  type AmerivetBenefitsPackage,
} from '@/lib/data/amerivet-package';
import { getCoverageTierForQuery, hasExplicitNoPregnancyOverride, isKaiserEligibleState, sessionHasPregnancySignal } from '@/lib/qa/medical-helpers';
import pricingUtils from '@/lib/rag/pricing-utils';

function availableMedicalSummaries(session: Session): MedicalPlanSummary[] {
  return AMERIVET_MEDICAL_PLAN_SUMMARIES.filter((plan) => {
    if (plan.planKey !== 'kaiser_standard_hmo') return true;
    return isKaiserEligibleState(session.userState);
  });
}

const PLAN_KEY_TO_CATALOG_ID: Record<MedicalPlanSummary['planKey'], string> = {
  standard_hsa: 'bcbstx-standard-hsa',
  enhanced_hsa: 'bcbstx-enhanced-hsa',
  kaiser_standard_hmo: 'kaiser-standard-hmo',
};

function normalizeCoverageTierKey(tier: string): BenefitTier {
  switch (tier) {
    case 'Employee + Spouse':
      return 'employeeSpouse';
    case 'Employee + Child(ren)':
      return 'employeeChildren';
    case 'Employee + Family':
      return 'employeeFamily';
    default:
      return 'employeeOnly';
  }
}

function getCatalogPlan(
  summary: MedicalPlanSummary,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): BenefitPlan | null {
  const planId = PLAN_KEY_TO_CATALOG_ID[summary.planKey];
  return getAmerivetPlanById(planId, benefitsPackage) || null;
}

function formatCoverageTierPremium(plan: BenefitPlan, coverageTier: string): string {
  const tierKey = normalizeCoverageTierKey(coverageTier);
  const monthly = plan.tiers[tierKey];
  return `$${monthly.toFixed(2)}/month`;
}

function buildCopayDetail(summary: MedicalPlanSummary, plan: BenefitPlan | null): string[] {
  const copays = plan?.coverage?.copays || {};
  const lines = [
    `- Primary care: ${summary.primaryCare}`,
    `- Specialist: ${summary.specialist}`,
    `- Urgent care: ${summary.urgentCare || 'I do not have a separate urgent care line item in the current summary.'}`,
    `- Emergency room: ${summary.emergencyRoom || 'I do not have a separate emergency room line item in the current summary.'}`,
    `- In-network coinsurance: ${summary.inNetworkCoinsurance}`,
  ];

  if (summary.outOfNetworkCoinsurance) {
    lines.push(`- Out-of-network coinsurance: ${summary.outOfNetworkCoinsurance}`);
  }

  if (copays.virtualVisit !== undefined) {
    const virtualVisit = copays.virtualVisit === 0 ? 'deductible-first / no flat copay listed' : `$${copays.virtualVisit} copay`;
    lines.push(`- Virtual visit: ${virtualVisit}`);
  }

  return lines;
}

function buildNetworkPracticalNote(summary: MedicalPlanSummary, plan: BenefitPlan | null): string {
  const limitations = plan?.limitations || [];
  const noOutOfNetwork = limitations.find((item) => /no out-of-network coverage except emergencies/i.test(item));
  if (noOutOfNetwork) {
    return `The practical network difference is that ${summary.displayName} keeps you inside the ${summary.network}, and out-of-network care is generally not covered except emergencies.`;
  }

  return `The practical network difference is that in-network care uses ${summary.inNetworkCoinsurance}, while out-of-network care is ${summary.outOfNetworkCoinsurance || 'not separately described in the current summary'}.`;
}

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

function inferPlansFromQuery(queryLower: string, session: Session): MedicalPlanSummary[] {
  const available = availableMedicalSummaries(session);
  const mentioned = available.filter((plan) =>
    plan.aliases.some((alias) => queryLower.includes(alias)),
  );
  if (mentioned.length > 0) return mentioned;

  if (/\b(two\s+different\s+plans|different\s+plans|both\s+plans|plan\s+tradeoffs?|tradeoffs?|compare(?:\s+plans?)?|options)\b/i.test(queryLower)) {
    return available;
  }

  return [];
}

function buildPlanOverview(
  summary: MedicalPlanSummary,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): string {
  const plan = getCatalogPlan(summary, benefitsPackage);
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
  if (plan?.features?.length) {
    lines.push('', '- Source-backed plan features:');
    lines.push(...plan.features.map((feature) => `- ${feature}`));
  }

  return lines.join('\n');
}

function buildCoverageTierExplanation(query: string, session: Session): string {
  const inferredTier = getCoverageTierForQuery(query, session);
  return [
    `A coverage tier is just the level of people you are enrolling, which changes the payroll deduction and which family members are covered.`,
    ``,
    `AmeriVet's medical coverage tiers are:`,
    `- Employee Only`,
    `- Employee + Spouse`,
    `- Employee + Child(ren)`,
    `- Employee + Family`,
    ``,
    `For the household details you have shared so far, the most likely tier is **${inferredTier}**.`,
    `If you want, I can use that tier to compare the medical plans or show how pricing changes across tiers.`,
  ].join('\n');
}

function buildMedicalTermExplanation(
  term:
    | 'copay'
    | 'ppo'
    | 'hmo'
    | 'bcbstx'
    | 'deductible'
    | 'coinsurance'
    | 'out_of_pocket_max'
    | 'network'
    | 'primary_care'
    | 'specialist'
    | 'urgent_care'
    | 'emergency_room'
    | 'prescriptions',
): string {
  if (term === 'ppo') {
    return [
      `PPO stands for **Preferred Provider Organization**.`,
      ``,
      `In AmeriVet's package, the BCBSTX medical options use a PPO-style network, which usually means you can use a broader network of doctors and facilities outside the Kaiser integrated model.`,
      ``,
      `The practical question is whether you want that broader-network PPO setup or the tighter Kaiser HMO structure.`,
      `If you want, I can compare the BCBSTX PPO options against Kaiser next.`,
    ].join('\n');
  }

  if (term === 'hmo') {
    return [
      `HMO stands for **Health Maintenance Organization**.`,
      ``,
      `In AmeriVet's package, the Kaiser Standard HMO uses an integrated-network HMO structure, which usually means you pick a primary care doctor inside Kaiser's system and get referrals for specialty care through that network.`,
      ``,
      `The practical tradeoff against the BCBSTX PPO-style plans is network breadth versus lower overall cost and tighter coordination inside one system.`,
      `If you want, I can compare Kaiser Standard HMO against the BCBSTX PPO options next.`,
    ].join('\n');
  }

  if (term === 'bcbstx') {
    return [
      `BCBSTX stands for **Blue Cross Blue Shield of Texas**.`,
      ``,
      `In AmeriVet's package, BCBSTX is the carrier behind the Standard HSA and Enhanced HSA medical plans.`,
      ``,
      `So when you see BCBSTX in the plan list, that is the PPO carrier side of AmeriVet's medical package rather than the Kaiser option.`,
      `If you want, I can compare the BCBSTX plans against Kaiser next.`,
    ].join('\n');
  }

  if (term === 'copay') {
    return [
      `A copay is the flat dollar amount you pay at the time of a covered service, before you even start talking about bigger deductible or coinsurance math.`,
      ``,
      `In AmeriVet's package, copays usually matter most for services like primary care, specialist visits, urgent care, and some prescription tiers.`,
      ``,
      `The practical question is not just "is there a copay?" but whether the plan uses more flat copays versus more deductible-first cost sharing.`,
      `If you want, I can compare AmeriVet's medical plans specifically on copays next.`,
    ].join('\n');
  }

  if (term === 'deductible') {
    return [
      `A deductible is the amount you usually pay out of pocket before the plan starts sharing more of the cost for many services.`,
      ``,
      `In AmeriVet's medical plans, the deductible is one of the biggest tradeoffs between the lower-premium option and the stronger-protection option.`,
      ``,
      `The practical way to think about it is: a higher deductible usually keeps premium lower, while a lower deductible usually means you pay more up front in payroll but get help sooner when care happens.`,
      `If you want, I can compare AmeriVet's plans specifically on deductible and out-of-pocket exposure.`,
    ].join('\n');
  }

  if (term === 'coinsurance') {
    return [
      `Coinsurance is the percentage of a covered bill you pay after the plan's rules kick in, instead of a flat copay.`,
      ``,
      `So if a plan says 20% coinsurance, that usually means you are paying 20% of the allowed in-network amount and the plan is paying the rest.`,
      ``,
      `In AmeriVet's package, coinsurance matters most when you are comparing in-network versus out-of-network cost sharing and stronger versus lighter medical coverage.`,
      `If you want, I can compare the AmeriVet medical plans on coinsurance next.`,
    ].join('\n');
  }

  if (term === 'out_of_pocket_max') {
    return [
      `The out-of-pocket max is the ceiling on how much you pay for covered in-network care during the plan year before the plan takes over more fully.`,
      ``,
      `That is why it matters so much in higher-use years: even if premium is not the cheapest, a lower out-of-pocket max can make the stronger-protection plan feel safer.`,
      ``,
      `In AmeriVet's package, this is one of the biggest guardrail numbers to compare across medical plans.`,
      `If you want, I can compare the AmeriVet plans specifically on deductible versus out-of-pocket max.`,
    ].join('\n');
  }

  if (term === 'primary_care') {
    return [
      `Primary care usually means your everyday doctor visit layer, like routine sick visits, check-ins, and the place many people start before moving to specialty care.`,
      ``,
      `In AmeriVet's package, primary care is useful to compare because some plans use a flat office-visit copay while others lean more heavily on deductible-first cost sharing.`,
      ``,
      `If you want, I can compare AmeriVet's plans specifically on primary care visit costs next.`,
    ].join('\n');
  }

  if (term === 'specialist') {
    return [
      `A specialist visit means care from a doctor focused on a specific area like dermatology, cardiology, orthopedics, or similar specialty care.`,
      ``,
      `In AmeriVet's package, specialist costs are one of the most practical comparisons because the stronger-protection plans often make repeated specialty care feel more manageable.`,
      ``,
      `If you want, I can compare AmeriVet's plans specifically on specialist visit costs next.`,
    ].join('\n');
  }

  if (term === 'urgent_care') {
    return [
      `Urgent care is the in-between level for problems that need prompt treatment but are not severe enough for the emergency room.`,
      ``,
      `In AmeriVet's package, the practical question is whether the plan gives you a predictable urgent-care copay or pushes more of that cost through deductible and coinsurance.`,
      ``,
      `If you want, I can compare AmeriVet's plans specifically on urgent-care cost sharing next.`,
    ].join('\n');
  }

  if (term === 'emergency_room') {
    return [
      `Emergency room coverage matters for true emergencies, and the key question is usually how much cost sharing the plan leaves with you when something serious happens.`,
      ``,
      `In AmeriVet's package, ER cost sharing is part of the bigger tradeoff between lower premium and stronger protection in a bad health year.`,
      ``,
      `If you want, I can compare AmeriVet's plans specifically on emergency-room cost sharing next.`,
    ].join('\n');
  }

  if (term === 'prescriptions') {
    return [
      `Prescription coverage is the part of the medical plan that helps with generic, brand, and specialty drugs.`,
      ``,
      `In AmeriVet's current source summaries, I do not have the full prescription tier table yet, so I do not want to guess at generic versus brand copays.`,
      ``,
      `What I can say confidently is that prescription use is one of the strongest reasons to compare the lower-cost versus stronger-protection medical options more closely.`,
      `If you want, I can still compare the AmeriVet plans at a high level for someone who expects ongoing prescriptions.`,
    ].join('\n');
  }

  return [
    `In-network means you are using providers inside the plan's contracted network, where the plan's negotiated pricing and cost sharing apply.`,
    ``,
    `Out-of-network means you are going outside that network, which usually means higher cost sharing and sometimes very limited coverage depending on the plan.`,
    ``,
    `In AmeriVet's package, this matters most when comparing the BCBSTX PPO-style options versus the Kaiser integrated-network option.`,
    `If you want, I can compare AmeriVet's medical plans specifically on in-network versus out-of-network rules.`,
  ].join('\n');
}

function buildTradeoffComparison(query: string, session: Session): string {
  const plans = availableMedicalSummaries(session);
  const coverageTier = getCoverageTierForQuery(query, session);
  const lines = [
    `Here is the practical tradeoff across AmeriVet's medical options:`,
    ``,
  ];

  for (const plan of plans) {
    const catalogPlan = getCatalogPlan(plan);
    const premiumNote = catalogPlan ? `; ${coverageTier} premium ${formatCoverageTierPremium(catalogPlan, coverageTier)}` : '';
    lines.push(`**${plan.displayName}**`);
    lines.push(`- Network: ${plan.network}`);
    lines.push(`- Deductible: ${plan.deductible}`);
    lines.push(`- Out-of-pocket max: ${plan.outOfPocketMax}`);
    lines.push(`- Primary care: ${plan.primaryCare}`);
    lines.push(`- Specialist: ${plan.specialist}`);
    lines.push(`- In-network cost sharing: ${plan.inNetworkCoinsurance}${premiumNote ? ` (${coverageTier} premium ${formatCoverageTierPremium(catalogPlan!, coverageTier)})` : ''}`);
    lines.push('');
  }

  lines.push(
    `The short version is:`,
    `- **Standard HSA** is usually the lower-premium / higher-deductible choice`,
    `- **Enhanced HSA** usually gives stronger point-of-service cost sharing and a lower deductible`,
  );

  if (plans.some((plan) => plan.planKey === 'kaiser_standard_hmo')) {
    lines.push(`- **Kaiser Standard HMO** is the integrated-network option if you want Kaiser and are in an eligible state`);
  }

  lines.push('', `If you want, I can also compare one of these specifically on copays, network access, maternity, prescriptions, or in-network versus out-of-network costs.`);
  return lines.join('\n');
}

function buildServiceComparison(
  plans: MedicalPlanSummary[],
  label: string,
  accessor: (plan: MedicalPlanSummary) => string | undefined,
): string {
  const lines = [`Here is the ${label.toLowerCase()} comparison across the available medical plans:`, ``];
  for (const plan of plans) {
    lines.push(`- **${plan.displayName}**: ${accessor(plan) || 'I do not have that line item in the current summary, so I do not want to guess.'}`);
  }
  return lines.join('\n');
}

function buildCopayComparison(plans: MedicalPlanSummary[]): string {
  const lines = ['Here is the copay comparison across the available medical plans:', ''];
  for (const plan of plans) {
    lines.push(`- **${plan.displayName}**`);
    lines.push(`  - Primary care: ${plan.primaryCare || 'I do not have that line item in the current summary, so I do not want to guess.'}`);
    lines.push(`  - Specialist: ${plan.specialist || 'I do not have that line item in the current summary, so I do not want to guess.'}`);
    if (plan.urgentCare) {
      lines.push(`  - Urgent care: ${plan.urgentCare}`);
    }
    if (plan.emergencyRoom) {
      lines.push(`  - Emergency room: ${plan.emergencyRoom}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function hasRecurringTherapyUsage(queryLower: string): boolean {
  return /\b(therapy|therapist|mental\s+health|behavioral\s+health|counsel(?:ing|or))\b/i.test(queryLower)
    && /\b(weekly|twice\s+(?:a\s+)?month|2x\s+monthly|monthly|every\s+month|every\s+week|regular(?:ly)?|ongoing|recurring|frequent)\b/i.test(queryLower);
}

function buildTherapyComparison(plans: MedicalPlanSummary[], queryLower = ''): string {
  const lines = ['Here is the Therapy / specialist care comparison across the available medical plans:', ''];
  for (const plan of plans) {
    const therapyDetail = plan.physicalTherapy || 'I do not have a separate therapy line item in the current summary';
    lines.push(`- **${plan.displayName}**: ${therapyDetail}; closest specialist proxy: ${plan.specialist}`);
  }
  if (hasRecurringTherapyUsage(queryLower)) {
    lines.push(
      '',
      `If therapy is likely to be a recurring part of your year, **Enhanced HSA** is the plan I would look at first because repeated specialist-style use makes the stronger point-of-service protection more valuable.`,
    );
  }
  return lines.join('\n');
}

function buildPlanCoverageAnswer(summary: MedicalPlanSummary, coverageTier: string): string {
  const plan = getCatalogPlan(summary);
  const lines = [
    `${summary.displayName} coverage snapshot:`,
    '',
    `- Network: ${summary.network}`,
    `- Preventive care: ${summary.preventiveCare}`,
    `- Primary care: ${summary.primaryCare}`,
    `- Specialist: ${summary.specialist}`,
    `- Deductible: ${summary.deductible}`,
    `- Out-of-pocket max: ${summary.outOfPocketMax}`,
    `- In-network coinsurance: ${summary.inNetworkCoinsurance}`,
  ];

  if (summary.outOfNetworkCoinsurance) {
    lines.push(`- Out-of-network coinsurance: ${summary.outOfNetworkCoinsurance}`);
  }
  if (summary.urgentCare) {
    lines.push(`- Urgent care: ${summary.urgentCare}`);
  }
  if (summary.emergencyRoom) {
    lines.push(`- Emergency room: ${summary.emergencyRoom}`);
  }
  if (summary.maternity) {
    lines.push(`- Maternity: ${summary.maternity}`);
  }
  if (summary.physicalTherapy) {
    lines.push(`- Therapy: ${summary.physicalTherapy}`);
  }
  if (summary.prescriptionDrugs?.note) {
    lines.push(`- Prescriptions: ${summary.prescriptionDrugs.note}`);
  }
  if (plan) {
    lines.push(`- ${coverageTier} premium: ${formatCoverageTierPremium(plan, coverageTier)}`);
    if (plan.features?.length) {
      lines.push('', '- Source-backed plan features:');
      lines.push(...plan.features.map((feature) => `- ${feature}`));
    }
    if (plan.limitations?.length) {
      lines.push('', '- Source-backed limitations:');
      lines.push(...plan.limitations.map((item) => `- ${item}`));
    }
  }

  lines.push('', `If you want, I can answer something more specific about copays, prescriptions, maternity, network rules, or out-of-pocket exposure on this plan.`);
  return lines.join('\n');
}

function buildCoverageComparisonAnswer(plans: MedicalPlanSummary[], coverageTier: string): string {
  const lines = [
    `Here is the practical coverage comparison across the available medical plans:`,
    '',
  ];

  for (const planSummary of plans) {
    const catalogPlan = getCatalogPlan(planSummary);
    lines.push(`- **${planSummary.displayName}**: ${planSummary.network}; preventive ${planSummary.preventiveCare}; primary care ${planSummary.primaryCare}; specialist ${planSummary.specialist}; deductible ${planSummary.deductible}; out-of-pocket max ${planSummary.outOfPocketMax}; in-network ${planSummary.inNetworkCoinsurance}${planSummary.outOfNetworkCoinsurance ? `; out-of-network ${planSummary.outOfNetworkCoinsurance}` : ''}`);
    if (planSummary.maternity) {
      lines.push(`  - Maternity: ${planSummary.maternity}`);
    }
    if (planSummary.prescriptionDrugs?.note) {
      lines.push(`  - Prescriptions: ${planSummary.prescriptionDrugs.note}`);
    }
    if (catalogPlan) {
      lines.push(`  - ${coverageTier} premium: ${formatCoverageTierPremium(catalogPlan, coverageTier)}`);
    }
  }

  lines.push('', `If you want, I can narrow this down further on one dimension like copays, prescriptions, maternity, therapy, or network access.`);
  return lines.join('\n');
}

function buildAccumulatorComparisonAnswer(session: Session): string {
  const plans = availableMedicalSummaries(session);
  const standard = plans.find((plan) => plan.planKey === 'standard_hsa');
  const enhanced = plans.find((plan) => plan.planKey === 'enhanced_hsa');
  const kaiser = plans.find((plan) => plan.planKey === 'kaiser_standard_hmo');

  if (kaiser && standard && enhanced) {
    return [
      `If you are comparing deductible and out-of-pocket guardrails only:`,
      ``,
      `- **${kaiser.displayName}** has the lowest deductible (${kaiser.deductible}) and the lowest out-of-pocket max (${kaiser.outOfPocketMax}) overall`,
      `- Between the two HSA plans, **${enhanced.displayName}** is lower than **${standard.displayName}** on both deductible (${enhanced.deductible} vs ${standard.deductible}) and out-of-pocket max (${enhanced.outOfPocketMax} vs ${standard.outOfPocketMax})`,
      ``,
      `So the short answer is: **Kaiser Standard HMO** is lowest overall where available, and **Enhanced HSA** is the lower-exposure choice if you are comparing just the HSA options.`,
    ].join('\n');
  }

  if (standard && enhanced) {
    return [
      `Between **${standard.displayName}** and **${enhanced.displayName}**, **${enhanced.displayName}** has the lower deductible (${enhanced.deductible} vs ${standard.deductible}) and the lower out-of-pocket max (${enhanced.outOfPocketMax} vs ${standard.outOfPocketMax}).`,
      ``,
      `So if you are comparing those two on cost protection only, **Enhanced HSA** is the stronger-protection option while **Standard HSA** is the lower-premium option.`,
    ].join('\n');
  }

  return `I can compare deductible and out-of-pocket exposure across AmeriVet's medical plans, but I do not want to guess if I am missing one of the plans in the current summary.`;
}

function buildLowestOutOfPocketAnswer(queryLower: string, session: Session): string {
  const plans = availableMedicalSummaries(session);
  const standard = plans.find((plan) => plan.planKey === 'standard_hsa');
  const enhanced = plans.find((plan) => plan.planKey === 'enhanced_hsa');
  const kaiser = plans.find((plan) => plan.planKey === 'kaiser_standard_hmo');
  const assistantMaternityContext = [
    session.lastBotMessage || '',
    ...(session.messages || [])
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content || ''),
  ].join('\n');
  const pregnancySignal = !hasExplicitNoPregnancyOverride(queryLower) && (
    sessionHasPregnancySignal(session, queryLower)
    || /\b(maternity\s+coverage\s+comparison|pregnancy\s+is\s+already\s+expected|maternity\s+cost\s+comparison|prenatal|postnatal|delivery)\b/i.test(assistantMaternityContext)
  );

  if (pregnancySignal && kaiser && session.userState && isKaiserEligibleState(session.userState)) {
    return [
      `If your goal is the **lowest likely maternity-related out-of-pocket exposure** and Kaiser is available in ${session.userState}, I would look at **${kaiser.displayName}** first.`,
      ``,
      enhanced && standard
        ? `Between the two HSA plans, **${enhanced.displayName}** is still lower than **${standard.displayName}** on both deductible and out-of-pocket max.`
        : `Among the HSA options, the lower-deductible / lower-out-of-pocket path is still the stronger-protection one.`,
      ``,
      `So yes: the lower out-of-pocket logic points away from **Standard HSA**, but in this pregnancy scenario **Kaiser Standard HMO** is the strongest overall starting point where it is available.`,
    ].join('\n');
  }

  if (kaiser && session.userState && isKaiserEligibleState(session.userState)) {
    return [
      `Across all of the medical plans available in ${session.userState}, **${kaiser.displayName}** has the lowest deductible and the lowest out-of-pocket max overall.`,
      ``,
      enhanced && standard
        ? `If you are comparing only the two HSA plans, **${enhanced.displayName}** is the lower out-of-pocket option because it has both the lower deductible and the lower out-of-pocket max compared with **${standard.displayName}**.`
        : `If you are comparing only the HSA options, the lower-deductible HSA is the one with the stronger cost protection.`,
    ].join('\n');
  }

  if (enhanced && standard) {
    return [
      `Yes — if you are comparing **${standard.displayName}** versus **${enhanced.displayName}**, **${enhanced.displayName}** is the lower out-of-pocket option.`,
      ``,
      `That is because it has both the lower deductible (${enhanced.deductible} vs ${standard.deductible}) and the lower out-of-pocket max (${enhanced.outOfPocketMax} vs ${standard.outOfPocketMax}).`,
      ``,
      `The tradeoff is that **${standard.displayName}** usually keeps the monthly premium lower.`,
    ].join('\n');
  }

  return `I can answer lowest out-of-pocket questions from the current AmeriVet plan summaries, but I do not want to guess if I am missing one of the medical options.`;
}

function buildLowestOopConfirmationAnswer(queryLower: string, session: Session): string | null {
  const plans = availableMedicalSummaries(session);
  const standard = plans.find((plan) => plan.planKey === 'standard_hsa');
  const enhanced = plans.find((plan) => plan.planKey === 'enhanced_hsa');
  const kaiser = plans.find((plan) => plan.planKey === 'kaiser_standard_hmo');
  const asksAboutEnhanced = /\benhanced\b/i.test(queryLower);
  const asksAboutStandard = /\bstandard\b/i.test(queryLower);
  const asksAboutKaiser = /\bkaiser\b/i.test(queryLower);
  const asksForConfirmation = /\b(yes|right|correct|should\s+i|so\s+if|because|am\s+i\s+right|is\s+that\s+right)\b/i.test(queryLower);
  const asksAboutLowerOop = /\b(out[- ]of[- ]pocket|oop)\b/i.test(queryLower)
    && /\b(lower|lowest)\b/i.test(queryLower);

  if (!asksForConfirmation || !asksAboutLowerOop || !standard || !enhanced) {
    return null;
  }

  if (asksAboutEnhanced && !asksAboutKaiser) {
    if (kaiser && session.userState && isKaiserEligibleState(session.userState)) {
      return [
        `If you are comparing just the two HSA plans, **yes** — **${enhanced.displayName}** is the lower out-of-pocket choice because it has the lower deductible (${enhanced.deductible}) and the lower out-of-pocket max (${enhanced.outOfPocketMax}) compared with **${standard.displayName}**.`,
        ``,
        `Across all of the medical plans available in ${session.userState}, **${kaiser.displayName}** is still lower overall on deductible and out-of-pocket max.`,
        ``,
        `So the short answer is: **yes for the HSA comparison, but Kaiser is the overall lower-exposure option where available**.`,
      ].join('\n');
    }

    return [
      `**Yes** — if you are comparing **${enhanced.displayName}** versus **${standard.displayName}**, **${enhanced.displayName}** is the lower out-of-pocket choice.`,
      ``,
      `That is because **${enhanced.displayName}** has both the lower deductible (${enhanced.deductible}) and the lower out-of-pocket max (${enhanced.outOfPocketMax}) compared with **${standard.displayName}** (${standard.deductible} deductible / ${standard.outOfPocketMax} out-of-pocket max).`,
      ``,
      `The tradeoff is that **${standard.displayName}** usually keeps the monthly premium lower.`,
    ].join('\n');
  }

  if (asksAboutKaiser && kaiser && session.userState && isKaiserEligibleState(session.userState)) {
    return [
      `**Yes** — in ${session.userState}, **${kaiser.displayName}** is the lowest out-of-pocket option overall.`,
      ``,
      `It has the lowest deductible (${kaiser.deductible}) and the lowest out-of-pocket max (${kaiser.outOfPocketMax}) among the medical plans available there.`,
      ``,
      enhanced && standard
        ? `If you are comparing only the HSA plans, **${enhanced.displayName}** is still lower than **${standard.displayName}**.`
        : `If you want, I can also compare the remaining HSA options directly.`,
    ].join('\n');
  }

  return null;
}

export function buildMedicalPlanDetailAnswer(
  query: string,
  session: Session,
  options?: { benefitsPackage?: AmerivetBenefitsPackage },
): string | null {
  const queryLower = query.toLowerCase();
  const noPregnancyOverride = hasExplicitNoPregnancyOverride(queryLower);
  const benefitsPackage = options?.benefitsPackage ?? getAmerivetBenefitsPackage();
  const summaries = availableMedicalSummaries(session);
  const plansFromQuery = inferPlansFromQuery(queryLower, session);
  const summary = inferPlanFromQuery(queryLower, session);
  const coverageTier = getCoverageTierForQuery(query, session);

  if (/\b(coverage\s+tier|coverage\s+tiers|what'?s\s+a\s+coverage\s+tier|what\s+is\s+a\s+coverage\s+tier|tier\b)\b/i.test(queryLower)) {
    return buildCoverageTierExplanation(query, session);
  }

  if (/\b(what'?s\s+a?\s+copay|what\s+does\s+copay\s+mean|define\s+copay|what\s+is\s+a?\s+copay)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('copay');
  }

  if (/\b(what\s+does\s+ppo\s+(?:mean|stand\s+for)|what'?s\s+(?:a\s+)?ppo|what\s+is\s+(?:a\s+)?ppo|define\s+ppo)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('ppo');
  }

  if (/\b(what\s+does\s+hmo\s+(?:mean|stand\s+for)|what'?s\s+(?:an?\s+)?hmo|what\s+is\s+(?:an?\s+)?hmo|define\s+hmo)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('hmo');
  }

  if (/\b(what'?s\s+bcbstx|what\s+is\s+bcbstx|what\s+does\s+bcbstx\s+(?:mean|stand\s+for)|define\s+bcbstx|what\s+is\s+blue\s+cross\s+blue\s+shield\s+of\s+texas)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('bcbstx');
  }

  if (/\b(what\s+does\s+primary\s+care\s+mean|what\s+is\s+primary\s+care|what\s+is\s+a\s+pcp|what\s+does\s+pcp\s+mean)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('primary_care');
  }

  if (/\b(what\s+does\s+specialist\s+mean|what\s+is\s+a\s+specialist|what\s+is\s+specialty\s+care)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('specialist');
  }

  if (/\b(is\s+(?:a\s+)?therap(?:ist|y)\s+(?:a\s+)?specialist|does\s+(?:a\s+)?therap(?:ist|y)\s+count\s+as\s+specialist(?:\s+care)?|would\s+(?:a\s+)?therap(?:ist|y)\s+be\s+specialist(?:\s+care)?)\b/i.test(queryLower)) {
    return [
      `Usually yes — therapy visits are generally closer to **specialist / behavioral-health care** than to primary care for cost-sharing purposes.`,
      ``,
      `In AmeriVet's current summaries, the safest grounded proxy when there is not a separate therapy copay line is the **specialist** cost line for the plan.`,
      ``,
      `If you want, I can compare the medical plans specifically on therapy / specialist cost-sharing next.`,
    ].join('\n');
  }

  if (/\b(what\s+does\s+urgent\s+care\s+mean|what\s+is\s+urgent\s+care)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('urgent_care');
  }

  if (/\b(what\s+does\s+emergency\s+room\s+mean|what\s+is\s+an?\s+er|what\s+is\s+the\s+er)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('emergency_room');
  }

  if (/\b(what'?s\s+a?\s+deductible|what\s+does\s+deductible\s+mean|define\s+deductible|what\s+is\s+the\s+deductible)\b/i.test(queryLower)
    && !/\bstandard|enhanced|kaiser|plan\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('deductible');
  }

  if (/\b(what'?s\s+coinsurance|what\s+does\s+coinsurance\s+mean|define\s+coinsurance|what\s+is\s+coinsurance)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('coinsurance');
  }

  if (/\b(what'?s\s+an?\s+out[- ]of[- ]pocket\s+max|what\s+does\s+out[- ]of[- ]pocket\s+max\s+mean|define\s+out[- ]of[- ]pocket\s+max|what\s+is\s+an?\s+out[- ]of[- ]pocket\s+max)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('out_of_pocket_max');
  }

  if (/\b(what\s+does\s+in[- ]network\s+mean|what\s+does\s+out[- ]of[- ]network\s+mean|what\s+does\s+in[- ]network\s+versus\s+out[- ]of[- ]network\s+mean|difference\s+between\s+in[- ]network\s+and\s+out[- ]of[- ]network|what\s+is\s+in[- ]network|what\s+is\s+out[- ]of[- ]network)\b/i.test(queryLower)
    && plansFromQuery.length !== 1) {
    return buildMedicalTermExplanation('network');
  }

  if (/\b(what\s+does\s+prescription\s+coverage\s+mean|how\s+do\s+prescriptions\s+work|what\s+does\s+rx\s+mean|what\s+does\s+drug\s+coverage\s+mean)\b/i.test(queryLower)) {
    return buildMedicalTermExplanation('prescriptions');
  }

  if (/\b(compare(?:\s+the)?\s+plan\s+tradeoffs?|plan\s+tradeoffs?|tradeoffs?|differences?\s+between\s+the\s+plans|compare\s+the\s+plans|talk\s+through\s+why\s+one\s+option\s+fits\s+better|which\s+option\s+fits\s+better)\b/i.test(queryLower)) {
    return buildTradeoffComparison(query, session);
  }

  if (
    /\b(which\s+one\s+has\s+the\s+lower|which\s+plan\s+has\s+the\s+lower|lower)\b/i.test(queryLower)
    && /\bdeductible\b/i.test(queryLower)
    && /\b(out[- ]of[- ]pocket|oop)\b/i.test(queryLower)
    && plansFromQuery.length !== 1
  ) {
    return buildAccumulatorComparisonAnswer(session);
  }

  const lowestOopConfirmation = buildLowestOopConfirmationAnswer(queryLower, session);
  if (lowestOopConfirmation) {
    return lowestOopConfirmation;
  }

  if (
    /\b(lowest\s+out[- ]of[- ]pocket|lowest\s+oop|lower\s+out[- ]of[- ]pocket|lower\s+oop)\b/i.test(queryLower)
    && plansFromQuery.length !== 1
  ) {
    return buildLowestOutOfPocketAnswer(queryLower, session);
  }

  if (!noPregnancyOverride && /\b(my wife is pregnant|i'?m pregnant|we(?:'re| are) expecting)\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    return [
      `If pregnancy is already expected, maternity coverage and overall medical cost exposure deserve closer attention than they would for a routine low-use year.`,
      ``,
      buildServiceComparison(summaries, 'Maternity coverage', (plan) => plan.maternity),
      '',
      pricingUtils.compareMaternityCosts(coverageTier, session.userState),
    ].join('\n');
  }

  const isConfirmationFollowUp = /^\s*so\b/i.test(queryLower) && /\$[\d,]+/.test(queryLower);
  if (!noPregnancyOverride && !isConfirmationFollowUp && /\b(maternity|pregnan\w*|delivery|prenatal|postnatal|baby|birth)\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    return [
      buildServiceComparison(summaries, 'Maternity coverage', (plan) => plan.maternity),
      '',
      pricingUtils.compareMaternityCosts(coverageTier, session.userState),
    ].join('\n');
  }

  if (/\b(physical\s+therapy|therapy|therapist|pt|outpatient\s+therapy|mental\s+health)\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    if (/\b(cost|costs|what\s+would\s+i\s+pay|what\s+will\s+that\s+cost|what\s+are\s+my\s+costs|copay|copays|specialist)\b/i.test(queryLower)) {
      return [
        `For therapy-related care, the safest grounded comparison is the plan's therapy line where it exists, plus the specialist cost line when a separate therapy copay is not listed.`,
        ``,
        buildTherapyComparison(summaries, queryLower),
      ].join('\n');
    }
    return buildTherapyComparison(summaries, queryLower);
  }

  if (/\b(primary\s+care|pcp|doctor\s+visit|office\s+visit|specialist|urgent\s+care|emergency\s+room|er|copay|copays)\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    if (/\bprimary\s+care|pcp|doctor\s+visit|office\s+visit\b/i.test(queryLower)) {
      return buildServiceComparison(summaries, 'Primary care', (plan) => plan.primaryCare);
    }
    if (/\bspecialist\b/i.test(queryLower)) {
      return buildServiceComparison(summaries, 'Specialist care', (plan) => plan.specialist);
    }
    if (/\burgent\s+care\b/i.test(queryLower)) {
      return buildServiceComparison(summaries, 'Urgent care', (plan) => plan.urgentCare);
    }
    if (/\b(emergency\s+room|er)\b/i.test(queryLower)) {
      return buildServiceComparison(summaries, 'Emergency room care', (plan) => plan.emergencyRoom);
    }
    return buildCopayComparison(summaries);
  }

  if (/\b(in[- ]network|in network)\b/i.test(queryLower) && /\b(out[- ]of[- ]network|out of network)\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    const lines = ['Here is the in-network versus out-of-network comparison across the available medical plans:', ''];
    for (const plan of summaries) {
      lines.push(`- **${plan.displayName}**: in-network ${plan.inNetworkCoinsurance}; out-of-network ${plan.outOfNetworkCoinsurance || 'I do not have a separate out-of-network line item in the current summary, so I do not want to guess.'}`);
    }
    return lines.join('\n');
  }

  if (/\b(in[- ]network|in network)\b/i.test(queryLower) && /\b(coinsurance|cost[- ]sharing|coverage|difference|versus|vs\.?)\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    return buildServiceComparison(summaries, 'In-network cost sharing', (plan) => plan.inNetworkCoinsurance);
  }

  if (/\b(out[- ]of[- ]network|out of network)\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    return buildServiceComparison(summaries, 'Out-of-network cost sharing', (plan) => plan.outOfNetworkCoinsurance);
  }

  if (/\b(network|ppo|hmo)\b/i.test(queryLower) && !/\bcoinsurance\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    return buildServiceComparison(summaries, 'Network design', (plan) => plan.network);
  }

  if (/\b(rx|prescriptions?|drugs?|generic|brand|specialty)\b/i.test(queryLower) && plansFromQuery.length !== 1) {
    return buildServiceComparison(summaries, 'Prescription coverage', (plan) => {
      const rx = plan.prescriptionDrugs;
      if (!rx) return 'I do not have the prescription drug tier details in the current summary, so I do not want to guess.';
      if (/\bgeneric\b/i.test(queryLower) && rx.generic) return `generic prescriptions are ${rx.generic}`;
      if (/\b(preferred\s+brand|brand)\b/i.test(queryLower) && rx.preferredBrand) return `preferred brand prescriptions are ${rx.preferredBrand}`;
      if (/\b(non[- ]preferred)\b/i.test(queryLower) && rx.nonPreferredBrand) return `non-preferred brand prescriptions are ${rx.nonPreferredBrand}`;
      if (/\bspecialty\b/i.test(queryLower) && rx.specialty) return `specialty prescriptions are ${rx.specialty}`;
      return rx.note || 'I do not have the prescription drug tier details in the current summary, so I do not want to guess.';
    });
  }

  if (/\b(what\s+does\s+(?:the\s+)?(?:standard|enhanced|kaiser)\s+plan\s+cover|what\s+does\s+this\s+plan\s+cover|what(?:\s+kind\s+of)?\s+coverage\s+(?:do\s+we\s+get|is\s+available)|what\s+is\s+covered|what(?:\s+all)?\s+does\s+it\s+cover)\b/i.test(queryLower)) {
    if (plansFromQuery.length > 1 || /\b(two\s+different\s+plans|different\s+plans|both\s+plans)\b/i.test(queryLower)) {
      return buildCoverageComparisonAnswer(summaries, coverageTier);
    }
    if (summary) {
      return buildPlanCoverageAnswer(summary, coverageTier);
    }
  }

  if (!summary) return null;
  const plan = getCatalogPlan(summary, benefitsPackage);

  if (/\b(more\s+info|more\s+detail|details|summary|tell\s+me\s+about|show\s+me|overview)\b/i.test(queryLower)) {
    return `${buildPlanOverview(summary, benefitsPackage)}\n\nIf you want, I can also drill into a specific part of the plan like specialist visits, coinsurance, prescriptions, maternity, or therapy coverage.`;
  }

  if (/\b(primary\s+care|pcp|doctor\s+visit|office\s+visit)\b/i.test(queryLower)) {
    return `${summary.displayName}: primary care is ${summary.primaryCare}.`;
  }

  if (/\b(virtual\s+visits?|telehealth(?:\s+visits?)?|telemedicine|virtual\s+care)\b/i.test(queryLower)) {
    const virtualVisit = plan?.coverage?.copays?.virtualVisit;
    if (virtualVisit !== undefined) {
      return virtualVisit === 0
        ? `${summary.displayName}: virtual visits are handled as deductible-first / no separate flat copay is listed in the current AmeriVet source data.`
        : `${summary.displayName}: virtual visits have a $${virtualVisit} copay in the current AmeriVet source data.`;
    }
    return `${summary.displayName}: I do not have a separate virtual-visit copay line in the current summary, so I do not want to guess.`;
  }

  if (/\b(specialist)\b/i.test(queryLower)) {
    return `${summary.displayName}: specialist care is ${summary.specialist}.`;
  }

  if (/\bcopay|copays\b/i.test(queryLower)) {
    return [
      `${summary.displayName} point-of-service cost sharing:`,
      ``,
      ...buildCopayDetail(summary, plan),
      '',
      `- ${coverageTier} premium: ${plan ? formatCoverageTierPremium(plan, coverageTier) : 'I do not want to guess without the plan catalog row.'}`,
    ].filter(Boolean).join('\n');
  }

  if (/\b(urgent\s+care)\b/i.test(queryLower)) {
    return summary.urgentCare
      ? `${summary.displayName}: urgent care is ${summary.urgentCare}.`
      : `${summary.displayName}: I do not have a separate urgent care line item in my current summary, so I do not want to guess.`;
  }

  if (/\b(emergency\s+room|er)\b/i.test(queryLower)) {
    return summary.emergencyRoom
      ? `${summary.displayName}: emergency room care is ${summary.emergencyRoom}.`
      : `${summary.displayName}: I do not have a separate emergency room line item in my current summary, so I do not want to guess.`;
  }

  if (/\b(in[- ]network|in network)\b/i.test(queryLower) && /\b(coinsurance|cost[- ]sharing|coverage)\b/i.test(queryLower)) {
    return `${summary.displayName}: in-network coinsurance is ${summary.inNetworkCoinsurance}.\n\n${buildNetworkPracticalNote(summary, plan)}`;
  }

  if (/\b(out[- ]of[- ]network|out of network)\b/i.test(queryLower) && /\b(coinsurance|cost[- ]sharing|coverage)\b/i.test(queryLower)) {
    return summary.outOfNetworkCoinsurance
      ? `${summary.displayName}: out-of-network coverage is ${summary.outOfNetworkCoinsurance}.\n\n${buildNetworkPracticalNote(summary, plan)}`
      : `${summary.displayName}: I do not have a separate out-of-network line item in my current summary, so I do not want to guess.`;
  }

  if (/\b(network|ppo|hmo)\b/i.test(queryLower) && !/\bcoinsurance\b/i.test(queryLower)) {
    return `${summary.displayName} uses the ${summary.network}.\n\n${buildNetworkPracticalNote(summary, plan)}`;
  }

  if (/\b(deductible)\b/i.test(queryLower)) {
    return `${summary.displayName}: deductible is ${summary.deductible}.`;
  }

  if (/\b(cost|costs|what would i pay|what are my costs|if i use)\b/i.test(queryLower)
    && !/\b(rx|prescriptions?|drugs?|generic|brand|specialty)\b/i.test(queryLower)) {
    return [
      `${summary.displayName} practical cost summary:`,
      ``,
      `- Network: ${summary.network}`,
      `- Deductible: ${summary.deductible}`,
      `- Out-of-pocket max: ${summary.outOfPocketMax}`,
      `- Primary care: ${summary.primaryCare}`,
      `- Specialist: ${summary.specialist}`,
      `- In-network coinsurance: ${summary.inNetworkCoinsurance}`,
      summary.outOfNetworkCoinsurance ? `- Out-of-network coinsurance: ${summary.outOfNetworkCoinsurance}` : '',
      plan ? `- ${coverageTier} premium: ${formatCoverageTierPremium(plan, coverageTier)}` : '',
      ``,
      `If you want, I can also compare this plan against the other AmeriVet medical options on maternity, prescriptions, network access, or total cost exposure.`,
    ].filter(Boolean).join('\n');
  }

  if (/\b(out[- ]of[- ]pocket|oop\s*max|max(?:imum)?\s*out[- ]of[- ]pocket)\b/i.test(queryLower)) {
    return `${summary.displayName}: out-of-pocket max is ${summary.outOfPocketMax}.`;
  }

  if (/\b(preventive)\b/i.test(queryLower)) {
    return `${summary.displayName}: preventive care is ${summary.preventiveCare}.`;
  }

  if (/\b(physical\s+therapy|therapy|therapist|pt|outpatient\s+therapy)\b/i.test(queryLower)) {
    return summary.physicalTherapy
      ? `${summary.displayName}: ${summary.physicalTherapy}.`
      : `${summary.displayName}: I do not have a separate physical therapy line item in my current summary, so I do not want to guess.`;
  }

  if (/\b(maternity|pregnan\w*|delivery|prenatal|postnatal|baby|birth)\b/i.test(queryLower)) {
    return summary.maternity
      ? `${summary.displayName}: ${summary.maternity}.\n\nPractical note: pregnancy-related care still runs through the plan deductible / out-of-pocket structure, so the stronger-protection plan is often easier to justify when you already expect maternity-related use.`
      : `${summary.displayName}: I do not have a dedicated maternity line item in my current summary, so I do not want to guess.`;
  }

  if (/\b(rx|prescriptions?|drugs?|generic|brand|specialty)\b/i.test(queryLower)) {
    const rx = summary.prescriptionDrugs;
    if (!rx) return `${summary.displayName}: I do not have the prescription drug tier details in my current summary, so I do not want to guess.`;

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
    return `${summary.displayName}: ${rx.note || 'I do not have the prescription drug tier details in my current summary, so I do not want to guess.'}`;
  }

  return null;
}
