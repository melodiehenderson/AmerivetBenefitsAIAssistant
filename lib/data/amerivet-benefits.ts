import {
  getAllPlans,
  getPlansByRegion as getPlansByRegionCatalog,
  calculateTierMonthly,
  type BenefitPlan,
  type BenefitTier,
} from './amerivet';

export const AMERIVET_BENEFIT_PLANS = getAllPlans();

export const getPlansByType = (
  type: string,
): BenefitPlan[] =>
  AMERIVET_BENEFIT_PLANS.filter((plan) => plan.type === type);

export const getPlansByRegion = (
  region: string,
): BenefitPlan[] => getPlansByRegionCatalog(region);

export const calculateEmployeeCost = (
  planId: string,
  tier: BenefitTier = 'employeeOnly',
) => calculateTierMonthly(planId, tier) ?? 0;
