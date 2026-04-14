import type { BenefitPlan, BenefitTier } from '@/lib/data/amerivet';

export type CalculatorCoverageSelection =
  | 'employee-only'
  | 'employee-spouse'
  | 'employee-children'
  | 'employee-family';

export function mapCalculatorCoverageToBenefitTier(
  coverage: CalculatorCoverageSelection,
): BenefitTier {
  switch (coverage) {
    case 'employee-spouse':
      return 'employeeSpouse';
    case 'employee-children':
      return 'employeeChildren';
    case 'employee-family':
      return 'employeeFamily';
    case 'employee-only':
    default:
      return 'employeeOnly';
  }
}

export function getCalculatorPlanMonthlyPremium(
  plan: BenefitPlan,
  coverage: CalculatorCoverageSelection,
): number {
  return plan.tiers[mapCalculatorCoverageToBenefitTier(coverage)];
}

export function buildCalculatorPlanPricing(plan: BenefitPlan) {
  return {
    label: plan.name,
    monthlyByCoverage: {
      'employee-only': plan.tiers.employeeOnly,
      'employee-spouse': plan.tiers.employeeSpouse,
      'employee-children': plan.tiers.employeeChildren,
      'employee-family': plan.tiers.employeeFamily,
    } satisfies Record<CalculatorCoverageSelection, number>,
    copayVisit: plan.coverage?.copays?.primaryCare ?? 20,
    hospDay: plan.coverage?.deductibles?.individual
      ? Math.round(plan.coverage.deductibles.individual / 5)
      : 200,
    rx: plan.coverage?.copays?.lenses ?? 10,
    surgery: plan.benefits.outOfPocketMax
      ? Math.round(plan.benefits.outOfPocketMax / 13)
      : 500,
  };
}
