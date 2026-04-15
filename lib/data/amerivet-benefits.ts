import {
  getAllAmerivetBenefitPlans,
  getAmerivetBenefitsPackage,
  getAmerivetPlansByRegion as getPlansByRegionCatalog,
  calculateAmerivetTierMonthly,
  type AmerivetBenefitsPackage,
} from './amerivet-package';
import type { BenefitPlan, BenefitTier } from './amerivet';

export type LegacyCoverageTierInput =
  | BenefitTier
  | 'employee'
  | 'employee+spouse'
  | 'employee+children'
  | 'employee+family';

function resolveBenefitsPackage(
  benefitsPackage?: AmerivetBenefitsPackage,
): AmerivetBenefitsPackage {
  return benefitsPackage ?? getAmerivetBenefitsPackage();
}

function normalizeCoverageTier(tier: LegacyCoverageTierInput): BenefitTier {
  switch (tier) {
    case 'employee':
      return 'employeeOnly';
    case 'employee+spouse':
      return 'employeeSpouse';
    case 'employee+children':
      return 'employeeChildren';
    case 'employee+family':
      return 'employeeFamily';
    default:
      return tier;
  }
}

const DEFAULT_AMERIVET_PACKAGE = resolveBenefitsPackage();

export const AMERIVET_BENEFITS_PACKAGE = DEFAULT_AMERIVET_PACKAGE;
export const AMERIVET_BENEFITS_CATALOG = DEFAULT_AMERIVET_PACKAGE.catalog;
export const AMERIVET_BENEFIT_PLANS = getAllAmerivetBenefitPlans(DEFAULT_AMERIVET_PACKAGE);
export const AMERIVET_MEDICAL_PLANS = DEFAULT_AMERIVET_PACKAGE.catalog.medicalPlans;
export const AMERIVET_KAISER_AVAILABLE_STATE_CODES = [
  ...DEFAULT_AMERIVET_PACKAGE.kaiserAvailableStateCodes,
];

export const getPlansByType = (
  type: string,
  benefitsPackage?: AmerivetBenefitsPackage,
): BenefitPlan[] =>
  getAllAmerivetBenefitPlans(resolveBenefitsPackage(benefitsPackage)).filter(
    (plan) => plan.type === type,
  );

export const getPlansByRegion = (
  region: string,
  benefitsPackage?: AmerivetBenefitsPackage,
): BenefitPlan[] => getPlansByRegionCatalog(region, resolveBenefitsPackage(benefitsPackage));

export const calculateEmployeeCost = (
  planId: string,
  tier: LegacyCoverageTierInput = 'employeeOnly',
  benefitsPackage?: AmerivetBenefitsPackage,
) =>
  calculateAmerivetTierMonthly(
    planId,
    normalizeCoverageTier(tier),
    resolveBenefitsPackage(benefitsPackage),
  ) ?? 0;
