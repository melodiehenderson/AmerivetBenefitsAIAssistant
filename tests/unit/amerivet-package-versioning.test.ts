import { describe, expect, it } from 'vitest';

import { buildCategoryExplorationResponse, buildDentalVisionComparisonResponse } from '@/lib/qa/category-response-builders';
import { buildKaiserUnavailableFallback, buildPpoClarificationForState } from '@/lib/qa/medical-helpers';
import pricingUtils, { getDentalPlanDetails } from '@/lib/rag/pricing-utils';
import type { Session } from '@/lib/rag/session-store';
import {
  createAmerivetBenefitsPackage,
  getAmerivetCatalogForPrompt,
  getAmerivetBenefitsPackage,
  getBCGEmployerGuidanceRules,
  isKaiserEligibleForState,
  listAmerivetBenefitsPackageIds,
} from '@/lib/data/amerivet-package';
import { findBCGEmployerGuidanceRule } from '@/lib/data/bcg-employer-guidance';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    step: 'active_chat',
    context: {},
    userName: 'Guest',
    hasCollectedName: true,
    userAge: 34,
    userState: 'TX',
    noPricingMode: false,
    ...overrides,
  };
}

function makeFixturePackage() {
  const current = getAmerivetBenefitsPackage();

  return createAmerivetBenefitsPackage({
    ...current,
    packageId: 'amerivet-2026-open-enrollment-fixture',
    displayName: 'AmeriVet Benefits 2026-2027 Fixture',
    catalog: {
      ...current.catalog,
      openEnrollment: {
        ...current.catalog.openEnrollment,
        year: '2026-2027',
        startDate: '2026-10-15',
        endDate: '2026-10-30',
        effectiveDate: '2027-01-01',
      },
      medicalPlans: current.catalog.medicalPlans.map((plan) =>
        plan.name === 'Standard HSA'
          ? {
              ...plan,
              tiers: {
                ...plan.tiers,
                employeeOnly: 99.99,
              },
            }
          : plan,
      ),
      dentalPlan: {
        ...current.catalog.dentalPlan,
        name: 'AmeriVet Dental Core',
        tiers: {
          ...current.catalog.dentalPlan.tiers,
          employeeOnly: 33.33,
        },
      },
      visionPlan: {
        ...current.catalog.visionPlan,
        name: 'AmeriVet Vision Core',
        tiers: {
          ...current.catalog.visionPlan.tiers,
          employeeOnly: 16.16,
        },
      },
    },
    kaiserAvailableStateCodes: ['CA', 'GA', 'TX', 'WA'],
  });
}

function makeRenamedMedicalFixturePackage() {
  const current = getAmerivetBenefitsPackage();

  return createAmerivetBenefitsPackage({
    ...current,
    packageId: 'amerivet-2026-renamed-medical-fixture',
    displayName: 'AmeriVet Benefits 2026 Renamed Medical Fixture',
    catalog: {
      ...current.catalog,
      medicalPlans: current.catalog.medicalPlans.map((plan) => {
        if (plan.id === 'bcbstx-standard-hsa') {
          return { ...plan, name: 'AmeriVet Saver HDHP' };
        }
        if (plan.id === 'bcbstx-enhanced-hsa') {
          return { ...plan, name: 'AmeriVet Shield HDHP' };
        }
        if (plan.id === 'kaiser-standard-hmo') {
          return { ...plan, name: 'AmeriVet Coordinated Care HMO' };
        }
        return plan;
      }),
    },
  });
}

describe('amerivet package versioning seam', () => {
  it('keeps the current AmeriVet package registered by default', () => {
    expect(listAmerivetBenefitsPackageIds()).toContain('amerivet-2024-2025');
    expect(getAmerivetBenefitsPackage().packageId).toBe('amerivet-2024-2025');
  });

  it('lets pricing helpers run against a fixture package without touching the default catalog', () => {
    const fixture = makeFixturePackage();
    const rows = pricingUtils.buildPerPaycheckBreakdown('Employee Only', 26, { benefitsPackage: fixture });

    expect(rows.find((row) => row.plan === 'Standard HSA')?.perMonth).toBe(99.99);
    expect(rows.some((row) => row.plan === 'AmeriVet Dental Core')).toBe(true);
    expect(rows.some((row) => row.plan === 'AmeriVet Vision Core')).toBe(true);
  });

  it('lets routine-plan answers follow a swapped package fixture', () => {
    const fixture = makeFixturePackage();

    const dentalAnswer = buildCategoryExplorationResponse({
      queryLower: 'dental please',
      session: makeSession(),
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: 'https://example.com/workday',
      hrPhone: '888-217-4728',
      benefitsPackage: fixture,
    });

    expect(dentalAnswer).toContain('AmeriVet Dental Core');
    expect(dentalAnswer).toContain('$33.33/month');

    const comparison = buildDentalVisionComparisonResponse(makeSession(), { benefitsPackage: fixture });
    expect(comparison).toContain('AmeriVet Dental Core');
    expect(comparison).toContain('AmeriVet Vision Core');

    const dentalDetails = getDentalPlanDetails({ benefitsPackage: fixture });
    expect(dentalDetails.name).toBe('AmeriVet Dental Core');
  });

  it('builds the prompt catalog from the active package fixture instead of the default catalog', () => {
    const fixture = makeFixturePackage();
    const promptCatalog = getAmerivetCatalogForPrompt('TX', fixture);

    expect(promptCatalog).toContain('AMERIVET BENEFITS CATALOG (2026-2027)');
    expect(promptCatalog).toContain('AmeriVet Dental Core');
    expect(promptCatalog).toContain('AmeriVet Vision Core');
    expect(promptCatalog).toContain('Open: 2026-10-15 – 2026-10-30');
  });

  it('lets package state availability change medical filtering without mutating the default package', () => {
    const fixture = makeFixturePackage();
    expect(isKaiserEligibleForState('TX', fixture)).toBe(true);
    expect(isKaiserEligibleForState('TX')).toBe(false);

    const response = buildCategoryExplorationResponse({
      queryLower: 'tell me about medical',
      session: makeSession({ userState: 'TX' }),
      coverageTier: 'Employee Only',
      enrollmentPortalUrl: 'https://example.com/workday',
      hrPhone: '888-217-4728',
      benefitsPackage: fixture,
    });

    expect(response).toContain('Kaiser Standard HMO');
    expect(response).not.toContain('only available in CA, GA, WA, and OR');
  });

  it('uses fixture medical plan names in shared PPO and Kaiser fallback copy', () => {
    const fixture = makeRenamedMedicalFixturePackage();
    const ppoAnswer = buildPpoClarificationForState('GA', { benefitsPackage: fixture });
    const redirect = buildKaiserUnavailableFallback(makeSession({ userState: 'NY' }), 'redirect', { benefitsPackage: fixture });

    expect(ppoAnswer).toContain('AmeriVet Saver HDHP');
    expect(ppoAnswer).toContain('AmeriVet Shield HDHP');
    expect(ppoAnswer).toContain('AmeriVet Coordinated Care HMO in GA');
    expect(redirect).toContain('AmeriVet Saver HDHP');
    expect(redirect).toContain('AmeriVet Shield HDHP');
    expect(redirect).not.toContain('Standard HSA');
    expect(redirect).not.toContain('Enhanced HSA');
  });

  it('registers structured employer guidance rules alongside the active AmeriVet package', () => {
    const rules = getBCGEmployerGuidanceRules();
    const splitRule = rules.find((rule) => rule.id === 'life-default-term-whole-split');

    expect(splitRule?.allocation.primaryPlan).toBe('voluntary_term_life');
    expect(splitRule?.allocation.primaryPercent).toBe(80);
    expect(splitRule?.allocation.secondaryPlan).toBe('whole_life');
    expect(splitRule?.allocation.secondaryPercent).toBe(20);
  });

  it('matches the life split guidance rule only for term-versus-whole decision questions', () => {
    const match = findBCGEmployerGuidanceRule(
      'Life Insurance',
      'What split do you recommend between whole life and voluntary term life?',
    );
    const bothMatch = findBCGEmployerGuidanceRule(
      'Life Insurance',
      'Do I need both voluntary term life and whole life?',
    );
    const noMatch = findBCGEmployerGuidanceRule(
      'Life Insurance',
      'What life insurance options do I have?',
    );

    expect(match?.id).toBe('life-default-term-whole-split');
    expect(bothMatch?.id).toBe('life-default-term-whole-split');
    expect(noMatch).toBeNull();
  });
});
