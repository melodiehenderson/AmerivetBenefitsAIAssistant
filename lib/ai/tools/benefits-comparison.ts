/**
 * Benefits Comparison AI Tools
 * Integrates with real Amerivet benefits data
 */
import {
  AMERIVET_BENEFIT_PLANS,
  calculateEmployeeCost,
  getPlansByRegion,
  getPlansByType,
} from '@/lib/data/amerivet-benefits';
import type { BenefitPlan, BenefitTier } from '@/lib/data/amerivet';
import {
  getAmerivetBenefitsPackage,
  type AmerivetBenefitsPackage,
} from '@/lib/data/amerivet-package';

type LegacyCoverageTierInput =
  | BenefitTier
  | 'employee'
  | 'employee+spouse'
  | 'employee+children'
  | 'employee+family';

type BenefitsComparisonToolOptions = {
  benefitsPackage?: AmerivetBenefitsPackage;
};

function findPlansByIds(
  planIds: string[],
  benefitsPackage?: AmerivetBenefitsPackage,
): BenefitPlan[] {
  const availablePlans = benefitsPackage
    ? getPlansByType('medical', benefitsPackage)
      .concat(getPlansByType('dental', benefitsPackage))
      .concat(getPlansByType('vision', benefitsPackage))
      .concat(getPlansByType('voluntary', benefitsPackage))
    : AMERIVET_BENEFIT_PLANS;

  return planIds
    .map((id) => availablePlans.find((plan) => plan.id === id))
    .filter((plan): plan is BenefitPlan => Boolean(plan));
}

export function createBenefitsComparisonTools(
  options: BenefitsComparisonToolOptions = {},
) {
  const benefitsPackage = options.benefitsPackage;
  const activePackage = benefitsPackage ?? getAmerivetBenefitsPackage();

  return {
    comparePlans: {
      description: 'Compare different benefit plans side by side',
      parameters: {
        type: 'object',
        properties: {
          planIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of plan IDs to compare',
          },
          coverageTier: {
            type: 'string',
            enum: ['employee', 'employee+spouse', 'employee+children', 'employee+family'],
            description: 'Coverage tier for cost calculation',
          },
          region: {
            type: 'string',
            description: 'Employee region (california, oregon, washington, nationwide)',
          },
        },
        required: ['planIds'],
      },
      execute: async ({ planIds, coverageTier = 'employee', region }: {
        planIds: string[];
        coverageTier?: LegacyCoverageTierInput;
        region?: string;
      }) => {
        const plans = findPlansByIds(planIds, benefitsPackage);
        
        if (plans.length === 0) {
          return { error: 'No valid plans found' };
        }

        // Filter by region if specified
        const filteredPlans = region
          ? getPlansByRegion(region, benefitsPackage)
          : plans;
        const availablePlans = filteredPlans.filter(
          (plan) => plan && planIds.includes(plan.id),
        );

        const comparison = availablePlans.map((plan) => {
          if (!plan) return null;
          return {
            id: plan.id,
            name: plan.name,
            type: plan.type,
            provider: plan.provider,
            monthlyCost: calculateEmployeeCost(plan.id, coverageTier, benefitsPackage),
            deductibles: plan.coverage?.deductibles,
            coinsurance: plan.coverage?.coinsurance,
            copays: plan.coverage?.copays,
            outOfPocketMax: plan.coverage?.outOfPocketMax,
            features: plan.features,
            exclusions: (plan as any).exclusions,
            regionalRestrictions: (plan as any).regionalRestrictions,
          };
        }).filter(Boolean) as Array<{
          id: string; name: string; type: string; provider: string;
          monthlyCost: number; deductibles: any; coinsurance: any; copays: any;
          outOfPocketMax: any; features: any; exclusions: any; regionalRestrictions: any;
        }>;

        return {
          comparison,
          coverageTier,
          region,
          totalPlans: comparison.length,
        };
      },
    },

    getPlansByType: {
      description: 'Get all available plans of a specific type',
      parameters: {
        type: 'object',
        properties: {
          planType: {
            type: 'string',
            enum: ['medical', 'dental', 'vision', 'life', 'disability', 'voluntary'],
            description: 'Type of benefit plan',
          },
          region: {
            type: 'string',
            description: 'Employee region for filtering',
          },
        },
        required: ['planType'],
      },
      execute: async ({ planType, region }: { planType: string; region?: string }) => {
        let plans = getPlansByType(
          planType === 'life' || planType === 'disability' ? 'voluntary' : planType,
          benefitsPackage,
        );
        
        if (region) {
          plans = plans.filter((plan) =>
            !(plan as any).regionalRestrictions
            || (plan as any).regionalRestrictions.some((r: string) => r.toLowerCase().includes(region.toLowerCase()))
          );
        }

        return {
          plans: plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            provider: plan.provider,
            monthlyCost: plan.premiums.employee.monthly,
            coverage: plan.coverage,
            features: plan.features,
          })),
          planType,
          region,
          totalPlans: plans.length,
        };
      },
    },

    calculateTotalCost: {
      description: 'Calculate total monthly cost for selected benefit plans',
      parameters: {
        type: 'object',
        properties: {
          selectedPlans: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                planId: { type: 'string' },
                coverageTier: { type: 'string' },
              },
              required: ['planId', 'coverageTier'],
            },
            description: 'Array of selected plans with coverage tiers',
          },
        },
        required: ['selectedPlans'],
      },
      execute: async ({ selectedPlans }: { selectedPlans: Array<{ planId: string; coverageTier: LegacyCoverageTierInput }> }) => {
        const costs = selectedPlans.map(({ planId, coverageTier }) => {
          const plan = findPlansByIds([planId], benefitsPackage)[0];
          if (!plan) return { planId, cost: 0, error: 'Plan not found' };
          
          return {
            planId,
            planName: plan.name,
            coverageTier,
            monthlyCost: calculateEmployeeCost(planId, coverageTier, benefitsPackage),
          };
        });

        const totalMonthlyCost = costs.reduce((sum, cost) => sum + (cost.monthlyCost || 0), 0);
        const totalAnnualCost = totalMonthlyCost * 12;

        return {
          costs,
          totalMonthlyCost,
          totalAnnualCost,
          planCount: selectedPlans.length,
        };
      },
    },

    getEligibilityInfo: {
      description: 'Get eligibility information for benefits',
      parameters: {
        type: 'object',
        properties: {
          employeeType: {
            type: 'string',
            enum: ['full-time', 'part-time'],
            description: 'Employee type',
          },
          hoursPerWeek: {
            type: 'number',
            description: 'Hours worked per week',
          },
        },
        required: ['employeeType', 'hoursPerWeek'],
      },
      execute: async ({ employeeType, hoursPerWeek }: { employeeType: string; hoursPerWeek: number }) => {
        const eligiblePlans = benefitsPackage
          ? getPlansByType('medical', benefitsPackage)
            .concat(getPlansByType('dental', benefitsPackage))
            .concat(getPlansByType('vision', benefitsPackage))
            .concat(getPlansByType('voluntary', benefitsPackage))
          : AMERIVET_BENEFIT_PLANS;
        const { eligibility } = activePackage.catalog;
        const isEligible =
          employeeType === 'full-time' && hoursPerWeek >= eligibility.fullTimeHours;
        const activeEligiblePlans = isEligible ? eligiblePlans : [];
        const voluntaryPlans = eligiblePlans.filter((plan) =>
          plan.type === 'voluntary' && hoursPerWeek >= eligibility.partTimeHours,
        );

        return {
          isEligible,
          employeeType,
          hoursPerWeek,
          eligiblePlans: activeEligiblePlans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            type: plan.type,
          })),
          voluntaryPlans: voluntaryPlans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            type: plan.type,
          })),
          waitingPeriod: eligibility.coverageEffective,
          dependentEligibility: eligibility.dependents,
        };
      },
    },

    getOpenEnrollmentInfo: {
      description: 'Get open enrollment information and deadlines',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const { openEnrollment, specialCoverage } = activePackage.catalog;
        const datesConfirmed = Boolean(openEnrollment.startDate && openEnrollment.endDate);

        return {
          year: openEnrollment.year,
          startDate: openEnrollment.startDate,
          endDate: openEnrollment.endDate,
          effectiveDate: openEnrollment.effectiveDate,
          specialEffectiveDates: {
            hsa: specialCoverage.hsa.effectiveDate,
            commuter: specialCoverage.commuter.effectiveDate,
          },
          status: datesConfirmed
            ? `Open enrollment dates loaded from ${activePackage.displayName}`
            : `Open enrollment dates pending for ${activePackage.displayName}`,
          actionRequired: datesConfirmed
            ? 'Use the active package dates when guiding enrollment decisions.'
            : 'Confirm the active package dates before giving deadline guidance.',
        };
      },
    },
  };
};

export const benefitsComparisonTools = createBenefitsComparisonTools();
