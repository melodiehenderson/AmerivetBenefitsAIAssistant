import {
  amerivetBenefits2024_2025,
  KAISER_AVAILABLE_STATE_CODES,
  STATE_ABBREV_TO_NAME,
  type AmerivetBenefitsCatalog,
  type BenefitPlan,
  type BenefitTier,
} from '@/lib/data/amerivet';
import {
  AMERIVET_EMPLOYER_GUIDANCE_RULES,
  type AmerivetEmployerGuidanceRule,
} from '@/lib/data/amerivet-employer-guidance';

export interface AmerivetBenefitsPackage {
  packageId: string;
  employerKey: 'amerivet';
  displayName: string;
  catalog: AmerivetBenefitsCatalog;
  employerGuidanceRules: readonly AmerivetEmployerGuidanceRule[];
  kaiserAvailableStateCodes: readonly string[];
  stateAbbrevToName: Readonly<Record<string, string>>;
}

export const DEFAULT_AMERIVET_PACKAGE_ID = 'amerivet-2024-2025';

const DEFAULT_AMERIVET_PACKAGE: AmerivetBenefitsPackage = {
  packageId: DEFAULT_AMERIVET_PACKAGE_ID,
  employerKey: 'amerivet',
  displayName: 'AmeriVet Benefits 2024-2025',
  catalog: amerivetBenefits2024_2025,
  employerGuidanceRules: AMERIVET_EMPLOYER_GUIDANCE_RULES,
  kaiserAvailableStateCodes: KAISER_AVAILABLE_STATE_CODES,
  stateAbbrevToName: STATE_ABBREV_TO_NAME,
};

const AMERIVET_PACKAGES: Record<string, AmerivetBenefitsPackage> = {
  [DEFAULT_AMERIVET_PACKAGE_ID]: DEFAULT_AMERIVET_PACKAGE,
};

const KAISER_DISPLAY_ORDER = ['CA', 'GA', 'WA', 'OR'] as const;

function sortStateCodesForDisplay(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized = codes
    .map((code) => code.toUpperCase())
    .filter((code) => {
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    });

  const preferred = KAISER_DISPLAY_ORDER.filter((code) => normalized.includes(code));
  const remainder = normalized
    .filter((code) => !preferred.includes(code as (typeof KAISER_DISPLAY_ORDER)[number]))
    .sort();

  return [...preferred, ...remainder];
}

function formatHumanList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function createAmerivetBenefitsPackage(
  definition: AmerivetBenefitsPackage,
): AmerivetBenefitsPackage {
  return definition;
}

export function listAmerivetBenefitsPackageIds(): string[] {
  return Object.keys(AMERIVET_PACKAGES);
}

export function getAmerivetBenefitsPackage(packageId?: string | null): AmerivetBenefitsPackage {
  const resolvedId = packageId || process.env.AMERIVET_BENEFITS_PACKAGE_ID || DEFAULT_AMERIVET_PACKAGE_ID;
  return AMERIVET_PACKAGES[resolvedId] || DEFAULT_AMERIVET_PACKAGE;
}

export function getAllAmerivetBenefitPlans(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): BenefitPlan[] {
  const { catalog } = benefitsPackage;
  return [
    ...catalog.medicalPlans,
    catalog.dentalPlan,
    catalog.visionPlan,
    ...catalog.voluntaryPlans,
  ];
}

export function getAmerivetEmployerGuidanceRules(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): readonly AmerivetEmployerGuidanceRule[] {
  return benefitsPackage.employerGuidanceRules;
}

export function getAmerivetPlanById(
  planId: string,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): BenefitPlan | undefined {
  return getAllAmerivetBenefitPlans(benefitsPackage).find((plan) => plan.id === planId);
}

export function getAmerivetPlansByRegion(
  region: string,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): BenefitPlan[] {
  const { catalog, stateAbbrevToName } = benefitsPackage;
  const normalizedRegion = region.toLowerCase();
  const expandedName = stateAbbrevToName[region.toUpperCase()] ?? region;
  const directMatches =
    catalog.regionalPlans[region] ??
    catalog.regionalPlans[expandedName] ??
    [];

  return getAllAmerivetBenefitPlans(benefitsPackage).filter((plan) => {
    if (directMatches.includes(plan.id)) {
      return true;
    }

    const regions = plan.regionalAvailability.map((entry) => entry.toLowerCase());
    if (regions.includes('nationwide')) {
      return true;
    }

    return regions.includes(normalizedRegion) || regions.includes(expandedName.toLowerCase());
  });
}

export function isEligibleForAmerivetPlan(
  planId: string,
  employeeType: 'full-time' | 'part-time',
  hoursWorked: number,
  region: string,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): boolean {
  const plan = getAmerivetPlanById(planId, benefitsPackage);
  if (!plan) {
    return false;
  }

  const partTimeHours = benefitsPackage.catalog.eligibility.partTimeHours;
  const meetsHours = employeeType === 'full-time'
    ? hoursWorked >= Math.max(30, plan.eligibility.minHours)
    : hoursWorked >= Math.max(partTimeHours, plan.eligibility.minHours);

  if (!meetsHours) {
    return false;
  }

  const normalizedRegion = region.toLowerCase();
  const availableRegions = plan.regionalAvailability.map((entry) => entry.toLowerCase());

  if (availableRegions.includes('nationwide')) {
    return true;
  }

  return availableRegions.includes(normalizedRegion);
}

export function listAmerivetPlanTypes(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): string[] {
  return Array.from(new Set(getAllAmerivetBenefitPlans(benefitsPackage).map((plan) => plan.type)));
}

export function listAmerivetProviders(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): string[] {
  return Array.from(new Set(getAllAmerivetBenefitPlans(benefitsPackage).map((plan) => plan.provider)));
}

export function calculateAmerivetTierMonthly(
  planId: string,
  tier: BenefitTier,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): number | undefined {
  return getAmerivetPlanById(planId, benefitsPackage)?.tiers[tier];
}

export function isKaiserEligibleForState(
  stateCode?: string | null,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): boolean {
  return !!stateCode && benefitsPackage.kaiserAvailableStateCodes.includes(stateCode.toUpperCase());
}

export function getKaiserAvailabilityCopy(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): {
  stateCodes: string[];
  codeList: string;
  codeSlashList: string;
  stateNames: string[];
  nameList: string;
  nameAndCodeList: string;
} {
  const stateCodes = sortStateCodesForDisplay(benefitsPackage.kaiserAvailableStateCodes);
  const stateNames = stateCodes.map((code) => benefitsPackage.stateAbbrevToName[code] || code);
  const nameAndCode = stateCodes.map((code, index) => `${stateNames[index]} (${code})`);

  return {
    stateCodes,
    codeList: formatHumanList(stateCodes),
    codeSlashList: stateCodes.join('/'),
    stateNames,
    nameList: formatHumanList(stateNames),
    nameAndCodeList: formatHumanList(nameAndCode),
  };
}

export function getAmerivetCatalogForPrompt(
  stateCode?: string | null,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): string {
  const { catalog } = benefitsPackage;
  const availablePlans = getAmerivetPlansByRegion(stateCode ?? 'nationwide', benefitsPackage);
  const biweekly = (monthly: number) => `$${((monthly * 12) / 26).toFixed(2)}`;

  const lines: string[] = [
    `=== AMERIVET BENEFITS CATALOG (${catalog.openEnrollment.year}) — IMMUTABLE LOOKUP TABLE ===`,
    `Respond ONLY with plans listed here. Plans not listed DO NOT EXIST for AmeriVet employees.`,
    `NOT IN CATALOG (decline politely if asked): pet insurance, legal insurance, ID theft protection,`,
    `  gym membership, wellness reimbursement, student loan repayment, long-term care, cancer-only plans.`,
    '',
    '── CARRIER LOCK (immutable — never re-assign a carrier to a different plan type) ──',
    '  UNUM       = Basic Life & AD&D, Voluntary Term Life, Short-Term Disability, Long-Term Disability ONLY.',
    '  ALLSTATE   = Group Whole Life (Permanent), Accident Insurance, Critical Illness ONLY.',
    '  BCBSTX     = Medical plans (Standard HSA, Enhanced HSA) and Dental PPO ONLY.',
    '  VSP        = Vision plan ONLY.',
    '  KAISER     = Medical HMO — California, Oregon, Washington ONLY. NEVER mention in any other state.',
    '  RIGHTWAY   — NOT an AmeriVet carrier. NEVER mention Rightway in any response.',
    '',
  ];

  const medicalPlans = availablePlans.filter((plan) => plan.type === 'medical');
  if (medicalPlans.length) {
    lines.push('── MEDICAL PLANS ──────────────────────────────────────────────────────────');
    for (const plan of medicalPlans) {
      lines.push(`[${plan.id}] ${plan.name} | Provider: ${plan.provider}`);
      lines.push(`  Premiums: Employee $${plan.tiers.employeeOnly}/mo (${biweekly(plan.tiers.employeeOnly)}/bi-wk) | +Spouse $${plan.tiers.employeeSpouse}/mo | +Child $${plan.tiers.employeeChildren}/mo | Family $${plan.tiers.employeeFamily}/mo`);
      lines.push(`  Deductible: $${plan.benefits.deductible} | OOP Max: $${plan.benefits.outOfPocketMax} | Coinsurance: ${plan.benefits.coinsurance * 100}%`);
      lines.push(`  Key features: ${plan.features.slice(0, 3).join(' | ')}`);
      if (plan.limitations.length) lines.push(`  Limitations: ${plan.limitations[0]}`);
      lines.push('');
    }
  }

  const dentalPlan = catalog.dentalPlan;
  lines.push('── DENTAL PLAN ─────────────────────────────────────────────────────────────');
  lines.push(`[${dentalPlan.id}] ${dentalPlan.name} | Provider: ${dentalPlan.provider}`);
  lines.push(`  Premiums: Employee $${dentalPlan.tiers.employeeOnly}/mo | +Spouse $${dentalPlan.tiers.employeeSpouse}/mo | +Child $${dentalPlan.tiers.employeeChildren}/mo | Family $${dentalPlan.tiers.employeeFamily}/mo`);
  lines.push(`  Deductible: $${dentalPlan.benefits.deductible}/individual | Annual Max: $${dentalPlan.benefits.outOfPocketMax}`);
  lines.push(`  Key features: ${dentalPlan.features.join(' | ')}`);
  lines.push('');

  const visionPlan = catalog.visionPlan;
  lines.push('── VISION PLAN ─────────────────────────────────────────────────────────────');
  lines.push(`[${visionPlan.id}] ${visionPlan.name} | Provider: ${visionPlan.provider}`);
  lines.push(`  Premiums: Employee $${visionPlan.tiers.employeeOnly}/mo | +Spouse $${visionPlan.tiers.employeeSpouse}/mo | +Child $${visionPlan.tiers.employeeChildren}/mo | Family $${visionPlan.tiers.employeeFamily}/mo`);
  lines.push(`  Key features: ${visionPlan.features.join(' | ')}`);
  lines.push('');

  const voluntaryPlans = availablePlans.filter((plan) => plan.type === 'voluntary');
  if (voluntaryPlans.length) {
    lines.push('── VOLUNTARY / LIFE & DISABILITY ───────────────────────────────────────────');
    for (const plan of voluntaryPlans) {
      lines.push(`[${plan.id}] ${plan.name} | Provider: ${plan.provider}`);
      lines.push(`  Premiums: Employee $${plan.tiers.employeeOnly}/mo | +Spouse $${plan.tiers.employeeSpouse}/mo | Family $${plan.tiers.employeeFamily}/mo`);
      lines.push(`  Key features: ${plan.features.join(' | ')}`);
      lines.push('');
    }
  }

  lines.push('── SPECIAL ACCOUNTS ────────────────────────────────────────────────────────');
  lines.push(`HSA: Employer contributes $${catalog.specialCoverage.hsa.employerContribution}/yr`);
  lines.push(`Commuter: $${catalog.specialCoverage.commuter.monthlyBenefit}/mo benefit`);
  lines.push('');

  lines.push('── ENROLLMENT WINDOW ───────────────────────────────────────────────────────');
  lines.push(`Open: ${catalog.openEnrollment.startDate} – ${catalog.openEnrollment.endDate} | Effective: ${catalog.openEnrollment.effectiveDate}`);
  lines.push(`Eligibility: Full-time ≥${catalog.eligibility.fullTimeHours}h/wk. Coverage ${catalog.eligibility.coverageEffective}`);
  lines.push(`Dependents: Spouse=${catalog.eligibility.dependents.spouse} | Children: ${catalog.eligibility.dependents.children}`);

  return lines.join('\n');
}
