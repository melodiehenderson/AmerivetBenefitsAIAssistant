import { describe, expect, it } from 'vitest';

import { getAmerivetBenefitsPackage } from '@/lib/data/amerivet-package';
import {
  buildCalculatorPlanPricing,
  getCalculatorPlanMonthlyPremium,
  mapCalculatorCoverageToBenefitTier,
} from '@/lib/utils/medical-cost-calculator';

describe('medical cost calculator helpers', () => {
  const catalog = getAmerivetBenefitsPackage().catalog;
  const standard = catalog.medicalPlans.find((plan) => plan.id === 'bcbstx-standard-hsa')!;

  it('maps coverage selections to canonical benefit tiers', () => {
    expect(mapCalculatorCoverageToBenefitTier('employee-only')).toBe('employeeOnly');
    expect(mapCalculatorCoverageToBenefitTier('employee-spouse')).toBe('employeeSpouse');
    expect(mapCalculatorCoverageToBenefitTier('employee-children')).toBe('employeeChildren');
    expect(mapCalculatorCoverageToBenefitTier('employee-family')).toBe('employeeFamily');
  });

  it('uses actual package premiums for each coverage tier', () => {
    expect(getCalculatorPlanMonthlyPremium(standard, 'employee-only')).toBe(86.84);
    expect(getCalculatorPlanMonthlyPremium(standard, 'employee-spouse')).toBe(210.52);
    expect(getCalculatorPlanMonthlyPremium(standard, 'employee-children')).toBe(190.31);
    expect(getCalculatorPlanMonthlyPremium(standard, 'employee-family')).toBe(321.45);
  });

  it('builds pricing objects that preserve actual package tier amounts', () => {
    const pricing = buildCalculatorPlanPricing(standard);

    expect(pricing.monthlyByCoverage['employee-only']).toBe(86.84);
    expect(pricing.monthlyByCoverage['employee-spouse']).toBe(210.52);
    expect(pricing.monthlyByCoverage['employee-children']).toBe(190.31);
    expect(pricing.monthlyByCoverage['employee-family']).toBe(321.45);
  });
});
