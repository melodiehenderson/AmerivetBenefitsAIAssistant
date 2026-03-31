import { z } from 'zod';

export const benefitTierSchema = z.enum([
  'employeeOnly',
  'employeeSpouse',
  'employeeChildren',
  'employeeFamily',
]);

export const benefitPremiumBreakdownSchema = z.object({
  employee: z.object({
    monthly: z.number(),
    biweekly: z.number(),
  }),
  employer: z
    .object({
      monthly: z.number(),
      biweekly: z.number(),
    })
    .optional(),
});

export const benefitPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  type: z.enum(['medical', 'dental', 'vision', 'voluntary']),
  description: z.string().optional(),
  regionalAvailability: z.array(z.string()),
  premiums: benefitPremiumBreakdownSchema,
  tiers: z.record(benefitTierSchema, z.number()),
  benefits: z.object({
    deductible: z.number(),
    outOfPocketMax: z.number(),
    coinsurance: z.number(),
    description: z.string().optional(),
  }),
  features: z.array(z.string()),
  limitations: z.array(z.string()),
  eligibility: z.object({
    employeeType: z.enum(['full-time', 'part-time', 'all']),
    minHours: z.number(),
  }),
  coverage: z
    .object({
      deductibles: z.record(z.string(), z.number()).optional(),
      coinsurance: z.record(z.string(), z.number()).optional(),
      copays: z.record(z.string(), z.number()).optional(),
      outOfPocketMax: z.number().optional(),
    })
    .optional(),
  voluntaryType: z.enum(['life', 'disability', 'supplemental']).optional(),
});

export const amerivetBenefitsCatalogSchema = z.object({
  medicalPlans: z.array(benefitPlanSchema),
  dentalPlan: benefitPlanSchema,
  visionPlan: benefitPlanSchema,
  voluntaryPlans: z.array(benefitPlanSchema),
  regionalPlans: z.record(z.string(), z.array(z.string())),
  openEnrollment: z.object({
    year: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    effectiveDate: z.string(),
  }),
  eligibility: z.object({
    fullTimeHours: z.number(),
    partTimeHours: z.number(),
    coverageEffective: z.string(),
    dependents: z.object({
      spouse: z.boolean(),
      domesticPartner: z.boolean(),
      children: z.string(),
    }),
  }),
  specialCoverage: z.object({
    hsa: z.object({
      effectiveDate: z.string(),
      employerContribution: z.union([
        z.number(),
        z.record(z.string(), z.number()),
      ]),
    }),
    commuter: z.object({
      effectiveDate: z.string(),
      monthlyBenefit: z.number(),
    }),
  }),
});

export type AmerivetBenefitsCatalog = z.infer<typeof amerivetBenefitsCatalogSchema>;
