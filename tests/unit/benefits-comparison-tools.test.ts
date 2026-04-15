import { describe, expect, it } from 'vitest';

import { createBenefitsComparisonTools } from '@/lib/ai/tools/benefits-comparison';
import {
  createAmerivetBenefitsPackage,
  getAmerivetBenefitsPackage,
} from '@/lib/data/amerivet-package';

describe('benefits comparison tools', () => {
  it('supports legacy coverage tiers when calculating total cost', async () => {
    const result = await createBenefitsComparisonTools().calculateTotalCost.execute({
      selectedPlans: [
        { planId: 'bcbstx-standard-hsa', coverageTier: 'employee' },
        { planId: 'bcbstx-dental', coverageTier: 'employee+family' },
      ],
    });

    expect(result.costs).toHaveLength(2);
    expect(result.costs[0].monthlyCost).toBe(86.84);
    expect(result.costs[1].monthlyCost).toBe(113.93);
  });

  it('can compare plans against a fixture package without using the default catalog', async () => {
    const current = getAmerivetBenefitsPackage();
    const fixturePackage = createAmerivetBenefitsPackage({
      ...current,
      packageId: 'amerivet-benefits-tools-fixture',
      displayName: 'AmeriVet Benefits Tools Fixture',
      catalog: {
        ...current.catalog,
        medicalPlans: current.catalog.medicalPlans.map((plan) =>
          plan.id === 'bcbstx-standard-hsa'
            ? {
                ...plan,
                name: 'Standard HSA Fixture',
                tiers: {
                  ...plan.tiers,
                  employeeFamily: 410.5,
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

    const tools = createBenefitsComparisonTools({ benefitsPackage: fixturePackage });
    const result = await tools.comparePlans.execute({
      planIds: ['bcbstx-standard-hsa', 'kaiser-standard-hmo'],
      coverageTier: 'employee+family',
      region: 'Texas',
    });

    expect(result.totalPlans).toBe(2);
    expect(result.comparison.map((plan) => plan.name)).toContain('Standard HSA Fixture');
    expect(result.comparison.find((plan) => plan.id === 'bcbstx-standard-hsa')?.monthlyCost).toBe(410.5);
    expect(result.comparison.some((plan) => plan.provider === 'Kaiser')).toBe(true);
  });

  it('uses package-backed open enrollment and eligibility metadata', async () => {
    const current = getAmerivetBenefitsPackage();
    const fixturePackage = createAmerivetBenefitsPackage({
      ...current,
      packageId: 'amerivet-benefits-tools-open-enrollment-fixture',
      displayName: 'AmeriVet Benefits Tools OE Fixture',
      catalog: {
        ...current.catalog,
        openEnrollment: {
          year: '2026-2027',
          startDate: '2026-10-10',
          endDate: '2026-10-25',
          effectiveDate: '2026-11-01',
        },
        eligibility: {
          ...current.catalog.eligibility,
          fullTimeHours: 32,
          coverageEffective: 'Coverage begins on the first of the month after 45 days of employment.',
        },
        specialCoverage: {
          ...current.catalog.specialCoverage,
          hsa: {
            ...current.catalog.specialCoverage.hsa,
            effectiveDate: '2027-01-01',
          },
          commuter: {
            ...current.catalog.specialCoverage.commuter,
            effectiveDate: '2026-11-01',
          },
        },
      },
    });

    const tools = createBenefitsComparisonTools({ benefitsPackage: fixturePackage });
    const openEnrollment = await tools.getOpenEnrollmentInfo.execute();
    const eligibility = await tools.getEligibilityInfo.execute({
      employeeType: 'full-time',
      hoursPerWeek: 31,
    });

    expect(openEnrollment.year).toBe('2026-2027');
    expect(openEnrollment.startDate).toBe('2026-10-10');
    expect(openEnrollment.endDate).toBe('2026-10-25');
    expect(openEnrollment.effectiveDate).toBe('2026-11-01');
    expect(openEnrollment.specialEffectiveDates.hsa).toBe('2027-01-01');
    expect(openEnrollment.specialEffectiveDates.commuter).toBe('2026-11-01');
    expect(openEnrollment.status).toContain('AmeriVet Benefits Tools OE Fixture');

    expect(eligibility.isEligible).toBe(false);
    expect(eligibility.waitingPeriod).toBe(
      'Coverage begins on the first of the month after 45 days of employment.',
    );
    expect(eligibility.dependentEligibility.children).toBe(
      'Eligible through age 26 regardless of student status.',
    );
  });
});
