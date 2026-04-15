import { describe, expect, it } from 'vitest';

import { getBenefitsAdvisorPrompt, getChatSystemPrompt } from '@/lib/ai/prompts';
import { getAmerivetPackageCopySnapshot } from '@/lib/data/amerivet-package-copy';
import {
  createAmerivetBenefitsPackage,
  getAmerivetBenefitsPackage,
} from '@/lib/data/amerivet-package';

function makeFixturePackage() {
  const current = getAmerivetBenefitsPackage();

  return createAmerivetBenefitsPackage({
    ...current,
    packageId: 'amerivet-copy-fixture',
    displayName: 'AmeriVet Benefits 2026-2027 Fixture',
    catalog: {
      ...current.catalog,
      openEnrollment: {
        year: '2026-2027',
        startDate: '2026-10-10',
        endDate: '2026-10-25',
        effectiveDate: '2026-11-01',
      },
      medicalPlans: current.catalog.medicalPlans.map((plan) =>
        plan.id === 'bcbstx-standard-hsa'
          ? {
              ...plan,
              name: 'Standard HSA Fixture',
            }
          : plan,
      ),
      visionPlan: {
        ...current.catalog.visionPlan,
        name: 'AmeriVet Vision Core',
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
}

describe('amerivet package copy seam', () => {
  it('builds prompt-friendly copy from the active package fixture', () => {
    const fixture = makeFixturePackage();
    const snapshot = getAmerivetPackageCopySnapshot(fixture);

    expect(snapshot.displayName).toBe('AmeriVet Benefits 2026-2027 Fixture');
    expect(snapshot.openEnrollment.year).toBe('2026-2027');
    expect(snapshot.medicalPlanNames).toContain('Standard HSA Fixture');
    expect(snapshot.visionPlanName).toBe('AmeriVet Vision Core');
    expect(snapshot.hsaReferencePlan?.name).toBe('Standard HSA Fixture');
    expect(snapshot.hsaReferencePlan?.annualPremium).toBeGreaterThan(0);
  });

  it('renders advisor and chat prompts from package-backed facts instead of stale hardcoded copy', () => {
    const fixture = makeFixturePackage();
    const advisorPrompt = getBenefitsAdvisorPrompt(fixture);
    const chatPrompt = getChatSystemPrompt(fixture);

    expect(advisorPrompt).toContain('Open Enrollment: 2026-2027 (2026-10-10 to 2026-10-25)');
    expect(advisorPrompt).toContain('Standard HSA Fixture');
    expect(advisorPrompt).toContain('AmeriVet Vision Core');
    expect(advisorPrompt).not.toContain('BCBSTX PPO');
    expect(advisorPrompt).not.toContain('Kaiser Enhanced HMO');

    expect(chatPrompt).toContain('AmeriVet Benefits 2026-2027 Fixture');
    expect(chatPrompt).toContain('Standard HSA Fixture');
    expect(chatPrompt).toContain('AmeriVet Vision Core');
    expect(chatPrompt).not.toContain('EyeMed');
    expect(chatPrompt).not.toContain('2024-2025 benefits plans');
  });
});
