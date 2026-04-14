import {
  type BenefitPlan,
  type BenefitTier,
} from './amerivet';
import {
  calculateAmerivetTierMonthly,
  getAllAmerivetBenefitPlans,
  getAmerivetPlansByRegion,
  type AmerivetBenefitsPackage,
} from './amerivet-package';

export const AMERIVET_BENEFIT_PLANS = getAllAmerivetBenefitPlans();

export const getPlansByType = (
  type: string,
  benefitsPackage?: AmerivetBenefitsPackage,
): BenefitPlan[] =>
  getAllAmerivetBenefitPlans(benefitsPackage).filter((plan) => plan.type === type);

export const getPlansByRegion = (
  region: string,
  benefitsPackage?: AmerivetBenefitsPackage,
): BenefitPlan[] => getAmerivetPlansByRegion(region, benefitsPackage);

export const calculateEmployeeCost = (
  planId: string,
  tier: BenefitTier = 'employeeOnly',
  benefitsPackage?: AmerivetBenefitsPackage,
) => calculateAmerivetTierMonthly(planId, tier, benefitsPackage) ?? 0;
