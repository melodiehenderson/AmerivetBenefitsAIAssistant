import { describe, expect, it } from 'vitest';

import {
  AMERIVET_BENEFITS_CATALOG,
  AMERIVET_KAISER_AVAILABLE_STATE_CODES,
  AMERIVET_MEDICAL_PLANS,
  calculateEmployeeCost,
  getPlansByRegion,
  getPlansByType,
} from '@/lib/data/amerivet-benefits';
import {
  createAmerivetBenefitsPackage,
  getAmerivetBenefitsPackage,
} from '@/lib/data/amerivet-package';

describe('amerivet-benefits compatibility layer', () => {
  it('exposes the active package catalog through compatibility exports', () => {
    const benefitsPackage = getAmerivetBenefitsPackage();

    expect(AMERIVET_BENEFITS_CATALOG).toBe(benefitsPackage.catalog);
    expect(AMERIVET_MEDICAL_PLANS.map((plan) => plan.id)).toEqual(
      benefitsPackage.catalog.medicalPlans.map((plan) => plan.id),
    );
    expect(AMERIVET_KAISER_AVAILABLE_STATE_CODES).toEqual([
      ...benefitsPackage.kaiserAvailableStateCodes,
    ]);
  });

  it('accepts legacy coverage tier strings when calculating employee cost', () => {
    expect(calculateEmployeeCost('bcbstx-standard-hsa', 'employee')).toBe(86.84);
    expect(calculateEmployeeCost('bcbstx-standard-hsa', 'employee+family')).toBe(321.45);
  });

  it('can run against a fixture package for region and premium changes', () => {
    const current = getAmerivetBenefitsPackage();
    const fixturePackage = createAmerivetBenefitsPackage({
      ...current,
      packageId: 'amerivet-benefits-compat-fixture',
      displayName: 'AmeriVet Benefits Compatibility Fixture',
      catalog: {
        ...current.catalog,
        medicalPlans: current.catalog.medicalPlans.map((plan) =>
          plan.id === 'bcbstx-standard-hsa'
            ? {
                ...plan,
                tiers: {
                  ...plan.tiers,
                  employeeFamily: 399.99,
                },
              }
            : plan.id === 'kaiser-standard-hmo'
              ? {
                  ...plan,
                  regionalAvailability: [...plan.regionalAvailability, 'Texas'],
                }
              : plan,
        ),
        regionalPlans: {
          ...current.catalog.regionalPlans,
          Texas: ['kaiser-standard-hmo'],
        },
      },
      kaiserAvailableStateCodes: ['CA', 'GA', 'OR', 'TX', 'WA'],
    });

    expect(getPlansByType('medical', fixturePackage).map((plan) => plan.id)).toContain('kaiser-standard-hmo');
    expect(getPlansByRegion('Texas', fixturePackage).some((plan) => plan.provider === 'Kaiser')).toBe(true);
    expect(calculateEmployeeCost('bcbstx-standard-hsa', 'employee+family', fixturePackage)).toBe(399.99);
  });
});
