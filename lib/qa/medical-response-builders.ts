import pricingUtils from '@/lib/rag/pricing-utils';

export type PricingRow = ReturnType<typeof pricingUtils.buildPerPaycheckBreakdown>[number];

type TwoPlanComparisonArgs = {
  coverageTier: string;
  payPeriods: number;
  row1: PricingRow;
  row2: PricingRow;
  noPricingMode: boolean;
};

export function buildTwoPlanComparisonMessage({ coverageTier, payPeriods, row1, row2, noPricingMode }: TwoPlanComparisonArgs): string {
  let msg = `Here's a side-by-side comparison for **${coverageTier}** coverage:\n\n`;

  msg += `| | **${row1.plan}** | **${row2.plan}** |\n`;
  msg += `|---|---|---|\n`;

  if (!noPricingMode) {
    msg += `| Monthly premium | $${pricingUtils.formatMoney(row1.perMonth)} | $${pricingUtils.formatMoney(row2.perMonth)} |\n`;
    msg += `| Per paycheck (${payPeriods}/yr) | $${pricingUtils.formatMoney(row1.perPaycheck)} | $${pricingUtils.formatMoney(row2.perPaycheck)} |\n`;
    msg += `| Annual premium | $${pricingUtils.formatMoney(row1.annually)} | $${pricingUtils.formatMoney(row2.annually)} |\n`;
  } else {
    msg += `| Network type | HDHP (HSA-eligible) | Enhanced PPO |\n`;
    msg += `| Deductible | Higher deductible | Lower deductible |\n`;
    msg += `| Out-of-pocket max | Lower after deductible | Higher cap |\n`;
  }

  msg += `\n**Key differences:**\n`;
  msg += `- **Standard HSA** pairs with a Health Savings Account (HSA) - pre-tax savings you control.\n`;
  msg += `- **Enhanced HSA** has lower deductibles and richer coverage, better for frequent healthcare users.\n`;

  if (!noPricingMode) {
    const diff = Math.abs(row2.perMonth - row1.perMonth);
    msg += `- Premium difference: **$${pricingUtils.formatMoney(diff)}/month** for ${row2.perMonth > row1.perMonth ? `${row2.plan} costs more` : `${row1.plan} costs more`}.\n`;
  }

  msg += `\nWould you like a total annual cost estimate factoring in expected healthcare usage?`;
  return msg;
}

type PlanPricingArgs = {
  matchedRow: PricingRow;
  coverageTier: string;
  payPeriods: number;
  noPricingMode: boolean;
};

export function buildPlanPricingMessage({ matchedRow, coverageTier, payPeriods, noPricingMode }: PlanPricingArgs): string {
  if (noPricingMode) {
    return `Here are the coverage details for **${matchedRow.plan}** (${coverageTier}). Pricing is currently off - say "show pricing" to re-enable cost display.\n\nWould you like to compare this plan with others, or see a different coverage tier?`;
  }

  return [
    `Here's the pricing for **${matchedRow.plan}** (${coverageTier}):`,
    '',
    `- **$${pricingUtils.formatMoney(matchedRow.perMonth)}/month** ($${pricingUtils.formatMoney(matchedRow.annually)}/year)`,
    `- Per paycheck (${payPeriods} pay periods): $${pricingUtils.formatMoney(matchedRow.perPaycheck)}`,
    '',
    `Would you like to compare this with other plans, or see pricing for a different coverage tier?`,
  ].join('\n');
}

type MedicalComparisonArgs = {
  coverageTier: string;
  filtered: PricingRow[];
  hasHiddenKaiser: boolean;
  noPricingMode: boolean;
};

export function buildMedicalComparisonMessage({ coverageTier, filtered, hasHiddenKaiser, noPricingMode }: MedicalComparisonArgs): string {
  let msg = `Here are the available medical plans for the ${coverageTier} tier:\n\n`;

  for (const row of filtered) {
    if (noPricingMode) {
      msg += `- **${row.plan}** (${row.provider})\n`;
    } else {
      msg += `- ${row.plan} (${row.provider}): $${pricingUtils.formatMoney(row.perMonth)}/month ($${pricingUtils.formatMoney(row.annually)}/year)\n`;
    }
  }

  if (hasHiddenKaiser) {
    msg += `\nNote: Kaiser Standard HMO is available only in California, Georgia, Washington, and Oregon.\n`;
  }

  msg += `\nWould you like more detail on any plan, a different coverage tier, or to move on to Dental/Vision?`;
  return msg;
}

type AllPlansEstimateArgs = {
  coverageTier: string;
  payPeriods: number;
  regionFilteredRows: PricingRow[];
  noPricingMode: boolean;
  hasUserState: boolean;
  enrollmentPortalUrl: string;
};

export function buildAllPlansEstimateMessage({ coverageTier, payPeriods, regionFilteredRows, noPricingMode, hasUserState, enrollmentPortalUrl }: AllPlansEstimateArgs): string {
  const medicalRows = regionFilteredRows.filter((row) => !/dental|vision/i.test(row.plan) && row.provider !== 'VSP');
  const nonMedicalRows = regionFilteredRows.filter((row) => /dental|vision/i.test(row.plan) || row.provider === 'VSP');
  const nonMedicalMonthly = Number(nonMedicalRows.reduce((sum, row) => sum + row.perMonth, 0).toFixed(2));
  const cheapestMed = medicalRows.reduce((min, row) => row.perMonth < min.perMonth ? row : min, medicalRows[0]);
  const priciestMed = medicalRows.reduce((max, row) => row.perMonth > max.perMonth ? row : max, medicalRows[0]);
  const minMonthly = Number((cheapestMed.perMonth + nonMedicalMonthly).toFixed(2));
  const maxMonthly = Number((priciestMed.perMonth + nonMedicalMonthly).toFixed(2));
  const minPerPay = Number(((minMonthly * 12) / payPeriods).toFixed(2));
  const maxPerPay = Number(((maxMonthly * 12) / payPeriods).toFixed(2));

  let msg: string;
  if (noPricingMode) {
    msg = `You can only enroll in **one** medical plan. Here are your options at the **${coverageTier}** tier (pricing hidden - say "show pricing" to re-enable):\n\n`;
    msg += `**Medical options (choose one):**\n`;
    for (const row of medicalRows) {
      msg += `- **${row.plan}** (${row.provider})\n`;
    }
    msg += `\n**Plus these standard benefits:**\n`;
    for (const row of nonMedicalRows) {
      msg += `- **${row.plan}** (${row.provider})\n`;
    }
    msg += `\nFor exact deductions during enrollment, visit Workday: ${enrollmentPortalUrl}`;
    return msg;
  }

  msg = `Great question! You can only enroll in **one** medical plan, so your total deduction depends on which one you choose. Here's the range for all benefits at the **${coverageTier}** tier:\n\n`;
  msg += `**Estimated total: $${pricingUtils.formatMoney(minPerPay)} - $${pricingUtils.formatMoney(maxPerPay)} per paycheck** ($${pricingUtils.formatMoney(minMonthly)} - $${pricingUtils.formatMoney(maxMonthly)}/month)\n\n`;
  msg += `**Medical options (choose one):**\n`;
  for (const row of medicalRows) {
    msg += `- ${row.plan}: $${pricingUtils.formatMoney(row.perPaycheck)} per paycheck ($${pricingUtils.formatMoney(row.perMonth)}/month)\n`;
  }
  msg += `\n**Plus these standard benefits:**\n`;
  for (const row of nonMedicalRows) {
    msg += `- ${row.plan}: $${pricingUtils.formatMoney(row.perPaycheck)} per paycheck ($${pricingUtils.formatMoney(row.perMonth)}/month)\n`;
  }
  msg += `\n**Important:** Voluntary benefits (Life/Disability/Critical Illness/Accident) are age-banded and not included above. Check Workday for your personalized voluntary rates.\n`;
  if (!hasUserState) {
    msg += `\nNote: Some plans are region-limited (for example, Kaiser availability depends on your state). If you share your state, I can filter to only the plans available to you.\n`;
  }
  msg += `\nFor your exact payroll deductions during enrollment, please verify in Workday: ${enrollmentPortalUrl}`;
  return msg;
}

type PerPaycheckArgs = {
  filtered: PricingRow[];
  coverageTier: string;
  payPeriods: number;
  wantsNonMedical: boolean;
  noPricingMode: boolean;
  hasUserState: boolean;
  enrollmentPortalUrl: string;
};

export function buildPerPaycheckMessage({ filtered, coverageTier, payPeriods, wantsNonMedical, noPricingMode, hasUserState, enrollmentPortalUrl }: PerPaycheckArgs): string {
  const benefitLabel = wantsNonMedical ? 'benefit' : 'medical plan';
  let msg: string;

  if (noPricingMode) {
    msg = `Here are the available **${benefitLabel}s** for **${coverageTier}** coverage. Pricing is currently off - say "show pricing" to re-enable cost display.\n`;
    for (const row of filtered) {
      msg += `- **${row.plan}** (${row.provider})\n`;
    }
  } else {
    msg = `Here are the estimated **${benefitLabel}** premiums for **${coverageTier}** (based on ${payPeriods} pay periods/year):\n`;
    for (const row of filtered) {
      msg += `- ${row.plan}: $${pricingUtils.formatMoney(row.perPaycheck)} per paycheck ($${pricingUtils.formatMoney(row.perMonth)}/month, $${pricingUtils.formatMoney(row.annually)}/year)\n`;
    }
  }

  if (!hasUserState) {
    msg += `\nNote: Some plans are region-limited (for example, Kaiser availability depends on your state). If you share your state, I can filter to only the plans available to you.`;
  }

  msg += `\nFor your exact payroll deductions during enrollment, please verify in Workday: ${enrollmentPortalUrl}`;
  return msg;
}
