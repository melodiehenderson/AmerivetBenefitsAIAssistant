import type { BenefitPlan } from '@/lib/data/amerivet';
import {
  getAmerivetBenefitsPackage,
  getKaiserAvailabilityCopy,
  type AmerivetBenefitsPackage,
} from '@/lib/data/amerivet-package';

export type AmerivetPackageCopySnapshot = {
  displayName: string;
  openEnrollment: AmerivetBenefitsPackage['catalog']['openEnrollment'];
  specialCoverage: AmerivetBenefitsPackage['catalog']['specialCoverage'];
  medicalPlanBullets: string[];
  medicalPlanNames: string[];
  dentalPlanName: string;
  dentalPlanBullet: string;
  visionPlanName: string;
  visionPlanBullet: string;
  lifePlanNames: string[];
  disabilityPlanNames: string[];
  kaiserStateCodeList: string;
  hsaReferencePlan: {
    name: string;
    monthlyPremium: number;
    annualPremium: number;
    deductible: number;
  } | null;
};

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatMonthlyYearly(monthly: number): string {
  return `${formatCurrency(monthly)}/month (${formatCurrency(monthly * 12)}/year)`;
}

function summarizePlan(plan: BenefitPlan): string {
  return `${plan.name} (${plan.provider}) - ${formatMonthlyYearly(plan.premiums.employee.monthly)}`;
}

export function getAmerivetPackageCopySnapshot(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): AmerivetPackageCopySnapshot {
  const { catalog, displayName } = benefitsPackage;
  const kaiserCopy = getKaiserAvailabilityCopy(benefitsPackage);
  const hsaPlan = catalog.medicalPlans.find((plan) => /hsa/i.test(plan.name)) ?? catalog.medicalPlans[0] ?? null;
  const disabilityPlanNames = catalog.voluntaryPlans
    .filter((plan) => plan.voluntaryType === 'disability')
    .map((plan) => plan.name);

  return {
    displayName,
    openEnrollment: catalog.openEnrollment,
    specialCoverage: catalog.specialCoverage,
    medicalPlanBullets: catalog.medicalPlans.map(summarizePlan),
    medicalPlanNames: catalog.medicalPlans.map((plan) => plan.name),
    dentalPlanName: catalog.dentalPlan.name,
    dentalPlanBullet: summarizePlan(catalog.dentalPlan),
    visionPlanName: catalog.visionPlan.name,
    visionPlanBullet: summarizePlan(catalog.visionPlan),
    lifePlanNames: catalog.voluntaryPlans
      .filter((plan) => plan.voluntaryType === 'life')
      .map((plan) => plan.name),
    disabilityPlanNames: disabilityPlanNames.length > 0
      ? disabilityPlanNames
      : ['Short-Term Disability', 'Long-Term Disability'],
    kaiserStateCodeList: kaiserCopy.codeList,
    hsaReferencePlan: hsaPlan
      ? {
          name: hsaPlan.name,
          monthlyPremium: hsaPlan.premiums.employee.monthly,
          annualPremium: Number((hsaPlan.premiums.employee.monthly * 12).toFixed(2)),
          deductible: hsaPlan.benefits.deductible,
        }
      : null,
  };
}
