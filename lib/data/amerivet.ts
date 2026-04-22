export type BenefitTier = 'employeeOnly' | 'employeeSpouse' | 'employeeChildren' | 'employeeFamily';

export interface BenefitPremiumBreakdown {
  employee: {
    monthly: number;
    biweekly: number;
  };
  employer?: {
    monthly: number;
    biweekly: number;
  };
}

export interface BenefitPlan {
  id: string;
  name: string;
  provider: string;
  type: 'medical' | 'dental' | 'vision' | 'voluntary';
  description?: string;
  regionalAvailability: string[];
  premiums: BenefitPremiumBreakdown;
  tiers: Record<BenefitTier, number>;
  benefits: {
    deductible: number;
    outOfPocketMax: number;
    coinsurance: number;
    description?: string;
  };
  features: string[];
  limitations: string[];
  eligibility: {
    employeeType: 'full-time' | 'part-time' | 'all';
    minHours: number;
  };
  coverage?: {
    deductibles?: Record<string, number>;
    coinsurance?: Record<string, number>;
    copays?: Record<string, number>;
    outOfPocketMax?: number;
  };
  voluntaryType?: 'life' | 'disability' | 'supplemental';
}

export interface AmerivetBenefitsCatalog {
  medicalPlans: BenefitPlan[];
  dentalPlan: BenefitPlan;
  visionPlan: BenefitPlan;
  voluntaryPlans: BenefitPlan[];
  regionalPlans: Record<string, string[]>;
  openEnrollment: {
    year: string;
    startDate: string;
    endDate: string;
    effectiveDate: string;
  };
  eligibility: {
    fullTimeHours: number;
    partTimeHours: number;
    coverageEffective: string;
    dependents: {
      spouse: boolean;
      domesticPartner: boolean;
      children: string;
    };
  };
  specialCoverage: {
    hsa: {
      effectiveDate: string;
      employerContribution: number | Record<string, number>;
    };
    commuter: {
      effectiveDate: string;
      monthlyBenefit: number;
    };
  };
}

export const KAISER_AVAILABLE_STATE_CODES = ['CA', 'GA', 'OR', 'WA'] as const;

const biweekly = (monthly: number) => Number(((monthly * 12) / 26).toFixed(2));

const createPlan = (plan: BenefitPlan): BenefitPlan => plan;

export const amerivetBenefits2024_2025: AmerivetBenefitsCatalog = {
  medicalPlans: [
    createPlan({
      id: 'bcbstx-standard-hsa',
      name: 'Standard HSA',
      provider: 'BCBSTX',
      type: 'medical',
      description: 'High-deductible health plan with HSA compatibility.',
      regionalAvailability: ['nationwide'],
      premiums: {
        employee: { monthly: 86.84, biweekly: biweekly(86.84) },
        employer: { monthly: 520.0, biweekly: biweekly(520.0) },
      },
      tiers: {
        employeeOnly: 86.84,
        employeeSpouse: 210.52,
        employeeChildren: 190.31,
        employeeFamily: 321.45,
      },
      benefits: {
        deductible: 3500,
        outOfPocketMax: 6500,
        coinsurance: 0.2,
        description: 'Covers preventive care at 100% and includes nationwide PPO network.',
      },
      coverage: {
        deductibles: {
          individual: 3500,
          family: 7000,
        },
        coinsurance: {
          inNetwork: 0.2,
          outOfNetwork: 0.4,
        },
        copays: {
          primaryCare: 0,
          specialist: 0,
          virtualVisit: 0,
        },
        outOfPocketMax: 6500,
      },
      features: [
        'HSA eligible plan',
        'Nationwide PPO network',
        'Telehealth visits included',
        'Preventive care covered at 100%',
      ],
      limitations: [
        'Higher deductible before plan pays',
        'Out-of-network coverage limited to 60%',
      ],
      eligibility: {
        employeeType: 'full-time',
        minHours: 30,
      },
    }),
    createPlan({
      id: 'bcbstx-enhanced-hsa',
      name: 'Enhanced HSA',
      provider: 'BCBSTX',
      type: 'medical',
      description: 'Enhanced coverage with richer employer contributions.',
      regionalAvailability: ['nationwide'],
      premiums: {
        employee: { monthly: 160.36, biweekly: biweekly(160.36) },
        employer: { monthly: 540.0, biweekly: biweekly(540.0) },
      },
      tiers: {
        employeeOnly: 160.36,
        employeeSpouse: 295.42,
        employeeChildren: 275.1,
        employeeFamily: 412.37,
      },
      benefits: {
        deductible: 2500,
        outOfPocketMax: 5500,
        coinsurance: 0.15,
        description: 'Lower deductible with enhanced employer HSA contribution.',
      },
      coverage: {
        deductibles: {
          individual: 2500,
          family: 5000,
        },
        coinsurance: {
          inNetwork: 0.15,
          outOfNetwork: 0.4,
        },
        copays: {
          primaryCare: 20,
          specialist: 40,
          urgentCare: 75,
        },
        outOfPocketMax: 5500,
      },
      features: [
        'Enhanced HSA contribution',
        'Nationwide provider access',
        'Includes access to Centers of Excellence',
      ],
      limitations: [
        'Out-of-network deductible applies separately',
      ],
      eligibility: {
        employeeType: 'full-time',
        minHours: 30,
      },
    }),
    createPlan({
      id: 'kaiser-standard-hmo',
      name: 'Kaiser Standard HMO',
      provider: 'Kaiser',
      type: 'medical',
      description: 'HMO plan with low copays and integrated care available in California, Georgia, Washington, and Oregon.',
      regionalAvailability: ['California', 'Georgia', 'Washington', 'Oregon'],
      premiums: {
        employee: { monthly: 142.17, biweekly: biweekly(142.17) },
        employer: { monthly: 515.0, biweekly: biweekly(515.0) },
      },
      tiers: {
        employeeOnly: 142.17,
        employeeSpouse: 268.45,
        employeeChildren: 245.92,
        employeeFamily: 386.12,
      },
      benefits: {
        deductible: 1000,
        outOfPocketMax: 4500,
        coinsurance: 0.1,
        description: 'Integrated HMO with Kaiser facilities across California, Georgia, Washington, and Oregon.',
      },
      coverage: {
        deductibles: {
          individual: 1000,
          family: 2000,
        },
        coinsurance: {
          inNetwork: 0.1,
        },
        copays: {
          primaryCare: 20,
          specialist: 45,
          emergencyRoom: 250,
        },
        outOfPocketMax: 4500,
      },
      features: [
        'Integrated Kaiser network',
        'Low copays for office visits',
        'Care team coordination',
      ],
      limitations: [
        'No out-of-network coverage except emergencies',
        'Available only in California, Georgia, Washington, and Oregon service areas',
      ],
      eligibility: {
        employeeType: 'full-time',
        minHours: 30,
      },
    }),
  ],
  dentalPlan: createPlan({
    id: 'bcbstx-dental',
    name: 'BCBSTX Dental PPO',
    provider: 'BCBSTX',
    type: 'dental',
    description: 'Comprehensive PPO dental coverage with orthodontia rider.',
    regionalAvailability: ['nationwide'],
    premiums: {
      employee: { monthly: 28.9, biweekly: biweekly(28.9) },
    },
    tiers: {
      employeeOnly: 28.9,
      employeeSpouse: 57.12,
      employeeChildren: 72.45,
      employeeFamily: 113.93,
    },
    benefits: {
      deductible: 50,
      outOfPocketMax: 1500,
      coinsurance: 0.2,
      description: 'Includes preventive care and major services coverage.',
    },
    coverage: {
      deductibles: {
        individual: 50,
        family: 150,
      },
      coinsurance: {
        preventive: 0,
        basic: 0.2,
        major: 0.5,
      },
      copays: {
        orthodontia: 500,
      },
      outOfPocketMax: 1500,
    },
    features: [
      'Preventive care covered at 100%',
      'Orthodontia coverage available',
      'Nationwide PPO network',
    ],
    limitations: [
      'Waiting period for major services is 6 months',
    ],
    eligibility: {
      employeeType: 'all',
      minHours: 20,
    },
  }),
  visionPlan: createPlan({
    id: 'vsp-vision-plus',
    name: 'VSP Vision Plus',
    provider: 'VSP',
    type: 'vision',
    description: 'Premium vision coverage with allowance for frames and contacts.',
    regionalAvailability: ['nationwide'],
    premiums: {
      employee: { monthly: 12.4, biweekly: biweekly(12.4) },
    },
    tiers: {
      employeeOnly: 12.4,
      employeeSpouse: 22.6,
      employeeChildren: 20.1,
      employeeFamily: 31.5,
    },
    benefits: {
      deductible: 0,
      outOfPocketMax: 0,
      coinsurance: 0,
      description: 'Eye exams every 12 months with generous frame allowance.',
    },
    coverage: {
      copays: {
        exam: 10,
        lenses: 25,
      },
    },
    features: [
      '$200 frame allowance (every 12 months)',
      '$130 contact lens allowance (in lieu of glasses, per benefit period)',
      'LASIK discounts available through VSP network',
    ],
    limitations: [
      'Frame allowance every 12 months',
    ],
    eligibility: {
      employeeType: 'all',
      minHours: 20,
    },
  }),
  voluntaryPlans: [
    // ── UNUM: Basic Life & AD&D (Employer-Paid) ─────────────────────────────
    createPlan({
      id: 'unum-basic-life',
      name: 'Unum Basic Life & AD&D',
      provider: 'Unum',
      type: 'voluntary',
      description: 'Employer-paid basic life and AD&D coverage — $25,000 flat benefit.',
      regionalAvailability: ['nationwide'],
      premiums: {
        employee: { monthly: 0, biweekly: 0 },          // Employer-paid
        employer: { monthly: 15.75, biweekly: biweekly(15.75) },
      },
      tiers: {
        employeeOnly: 0,
        employeeSpouse: 0,
        employeeChildren: 0,
        employeeFamily: 0,
      },
      benefits: {
        deductible: 0,
        outOfPocketMax: 0,
        coinsurance: 0,
        description: '$25,000 employer-paid basic life and accidental death & dismemberment.',
      },
      features: [
        '$25,000 flat life benefit — employer-paid',
        'Includes Accidental Death & Dismemberment (AD&D)',
        'All benefits-eligible employees automatically enrolled',
      ],
      limitations: [
        'Coverage amount is a flat $25,000 — not salary-based',
      ],
      eligibility: {
        employeeType: 'all',
        minHours: 20,
      },
      voluntaryType: 'life',
    }),
    // ── UNUM: Voluntary Term Life ────────────────────────────────────────────
    createPlan({
      id: 'unum-voluntary-life',
      name: 'Unum Voluntary Term Life',
      provider: 'Unum',
      type: 'voluntary',
      description: 'Employee-paid voluntary term life insurance — age-banded rates.',
      regionalAvailability: ['nationwide'],
      premiums: {
        employee: { monthly: 0, biweekly: 0 },          // Age-banded; placeholder
      },
      tiers: {
        employeeOnly: 0,
        employeeSpouse: 0,
        employeeChildren: 0,
        employeeFamily: 0,
      },
      benefits: {
        deductible: 0,
        outOfPocketMax: 0,
        coinsurance: 0,
        description: 'Voluntary term life: 1x–5x salary up to $500,000. Spouse and child coverage available.',
      },
      features: [
        'Coverage: 1x to 5x annual salary (up to $500,000)',
        'Guaranteed Issue: up to $150,000 during open enrollment',
        'Spouse and dependent child coverage available',
        'Portable — can continue coverage after leaving AmeriVet',
      ],
      limitations: [
        'Age-banded pricing — rates increase with age',
        'Evidence of insurability required above guaranteed issue amount',
      ],
      eligibility: {
        employeeType: 'all',
        minHours: 20,
      },
      voluntaryType: 'life',
    }),
    // ── ALLSTATE: Whole Life (Permanent) ─────────────────────────────────────
    createPlan({
      id: 'allstate-whole-life',
      name: 'Allstate Whole Life',
      provider: 'Allstate',
      type: 'voluntary',
      description: 'Permanent whole life insurance with cash value — rates locked at enrollment age.',
      regionalAvailability: ['nationwide'],
      premiums: {
        employee: { monthly: 0, biweekly: 0 },          // Age-banded; placeholder
      },
      tiers: {
        employeeOnly: 0,
        employeeSpouse: 0,
        employeeChildren: 0,
        employeeFamily: 0,
      },
      benefits: {
        deductible: 0,
        outOfPocketMax: 0,
        coinsurance: 0,
        description: 'Permanent whole life insurance that builds cash value over time.',
      },
      features: [
        'Permanent coverage — does not expire as long as premiums are paid',
        'Builds cash value over time (tax-deferred growth)',
        'Rates locked at your enrollment age',
        'Portable — you keep the policy if you leave AmeriVet',
      ],
      limitations: [
        'Age-banded pricing — locked at enrollment age',
        'Higher premium than term life for equivalent face value',
      ],
      eligibility: {
        employeeType: 'all',
        minHours: 20,
      },
      voluntaryType: 'life',
    }),
  ],
  regionalPlans: {
    California: ['kaiser-standard-hmo'],
    Georgia: ['kaiser-standard-hmo'],
    Oregon: ['kaiser-standard-hmo'],
    Washington: ['kaiser-standard-hmo'],
    nationwide: ['bcbstx-standard-hsa', 'bcbstx-enhanced-hsa', 'bcbstx-dental', 'vsp-vision-plus', 'unum-basic-life', 'unum-voluntary-life', 'allstate-whole-life'],
  },
  openEnrollment: {
    year: '2024-2025',
    startDate: '2024-09-15',
    endDate: '2024-09-30',
    effectiveDate: '2024-10-01',
  },
  eligibility: {
    fullTimeHours: 30,
    partTimeHours: 20,
    coverageEffective: 'Coverage begins on the first of the month following 30 days of employment.',
    dependents: {
      spouse: true,
      domesticPartner: true,
      children: 'Eligible through age 26 regardless of student status.',
    },
  },
  specialCoverage: {
    hsa: {
      effectiveDate: '2025-01-01',
      employerContribution: {
        "Employee Only": 750,
        "Employee + Spouse": 1000,
        "Employee + Child(ren)": 1000,
        "Employee + Family": 1250,
      },
    },
    commuter: {
      effectiveDate: '2025-01-01',
      monthlyBenefit: 300,
    },
  },
};


// --- Zod validation for catalog integrity ---
import { amerivetBenefitsCatalogSchema } from '@/lib/validation/benefit-catalog-schema';

// Validate at runtime (throws if invalid)
amerivetBenefitsCatalogSchema.parse(amerivetBenefits2024_2025);

const allPlans = [
  ...amerivetBenefits2024_2025.medicalPlans,
  amerivetBenefits2024_2025.dentalPlan,
  amerivetBenefits2024_2025.visionPlan,
  ...amerivetBenefits2024_2025.voluntaryPlans,
];

export function getPlanById(planId: string): BenefitPlan | undefined {
  return allPlans.find(plan => plan.id === planId);
}

export const STATE_ABBREV_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

export function getPlansByRegion(region: string): BenefitPlan[] {
  const normalizedRegion = region.toLowerCase();
  // Expand 2-letter abbreviation to full state name for regionalPlans key lookup
  const expandedName = STATE_ABBREV_TO_NAME[region.toUpperCase()] ?? region;
  const directMatches =
    amerivetBenefits2024_2025.regionalPlans[region] ??
    amerivetBenefits2024_2025.regionalPlans[expandedName] ??
    [];
  return allPlans.filter(plan => {
    if (directMatches.includes(plan.id)) {
      return true;
    }

    const regions = plan.regionalAvailability.map(r => r.toLowerCase());
    if (regions.includes('nationwide')) {
      return true;
    }

    // Match against the raw region code or the expanded full state name
    return regions.includes(normalizedRegion) || regions.includes(expandedName.toLowerCase());
  });
}

export function isEligibleForPlan(
  planId: string,
  employeeType: 'full-time' | 'part-time',
  hoursWorked: number,
  region: string,
): boolean {
  const plan = getPlanById(planId);
  if (!plan) {
    return false;
  }

  const meetsHours = employeeType === 'full-time'
    ? hoursWorked >= Math.max(30, plan.eligibility.minHours)
    : hoursWorked >= Math.max(amerivetBenefits2024_2025.eligibility.partTimeHours, plan.eligibility.minHours);

  if (!meetsHours) {
    return false;
  }

  const normalizedRegion = region.toLowerCase();
  const availableRegions = plan.regionalAvailability.map(r => r.toLowerCase());

  if (availableRegions.includes('nationwide')) {
    return true;
  }

  return availableRegions.includes(normalizedRegion);
}

export function getAllPlans(): BenefitPlan[] {
  return [...allPlans];
}

export function listPlanTypes(): string[] {
  return Array.from(new Set(allPlans.map(plan => plan.type)));
}

export function listProviders(): string[] {
  return Array.from(new Set(allPlans.map(plan => plan.provider)));
}

export function calculateTierMonthly(planId: string, tier: BenefitTier): number | undefined {
  const plan = getPlanById(planId);
  if (!plan) {
    return undefined;
  }
  return plan.tiers[tier];
}

// =============================================================================
// PROMPT SERIALISER — Immutable Truth Table for LLM grounding
// =============================================================================

/**
 * Serialises the AmeriVet benefit catalog into a compact, LLM-readable string
 * that acts as an immutable lookup table inside the system prompt.
 *
 * - Only plans available in `stateCode` (or nationwide) are included.
 * - A "NOT IN CATALOG" block lists common benefits AmeriVet does NOT offer,
 *   giving the LLM an explicit decline list instead of hallucinating.
 *
 * @param stateCode  2-letter US state code (e.g. "IL"). Pass null for nationwide only.
 */
export function getCatalogForPrompt(stateCode?: string | null): string {
  const catalog = amerivetBenefits2024_2025;
  const availablePlans = getPlansByRegion(stateCode ?? 'nationwide');
  const biw = (m: number) => `$${((m * 12) / 26).toFixed(2)}`;

  const lines: string[] = [
    `=== AMERIVET BENEFITS CATALOG (${catalog.openEnrollment.year}) — IMMUTABLE LOOKUP TABLE ===`,
    `Respond ONLY with plans listed here. Plans not listed DO NOT EXIST for AmeriVet employees.`,
    `NOT IN CATALOG (decline politely if asked): pet insurance, legal insurance, ID theft protection,`,
    `  gym membership, wellness reimbursement, student loan repayment, long-term care, cancer-only plans.`,
    '',
    '── CARRIER LOCK (immutable — never re-assign a carrier to a different plan type) ──',
    '  UNUM       = Basic Life & AD&D, Voluntary Term Life, Short-Term Disability, Long-Term Disability ONLY.',
    '  ALLSTATE   = Group Whole Life (Permanent), Accident Insurance, Critical Illness ONLY.',
    '  BCBSTX     = Medical plans (Standard HSA, Enhanced HSA) and Dental PPO ONLY.',
    '  VSP        = Vision plan ONLY.',
    '  KAISER     = Medical HMO — California, Oregon, Washington ONLY. NEVER mention in any other state.',
    '  RIGHTWAY   — NOT an AmeriVet carrier. NEVER mention Rightway in any response.',
    '',
  ];

  // ── Medical ────────────────────────────────────────────────────────────────
  const medPlans = availablePlans.filter(p => p.type === 'medical');
  if (medPlans.length) {
    lines.push('── MEDICAL PLANS ──────────────────────────────────────────────────────────');
    for (const p of medPlans) {
      lines.push(`[${p.id}] ${p.name} | Provider: ${p.provider}`);
      lines.push(`  Premiums: Employee $${p.tiers.employeeOnly}/mo (${biw(p.tiers.employeeOnly)}/bi-wk) | +Spouse $${p.tiers.employeeSpouse}/mo | +Child $${p.tiers.employeeChildren}/mo | Family $${p.tiers.employeeFamily}/mo`);
      lines.push(`  Deductible: $${p.benefits.deductible} | OOP Max: $${p.benefits.outOfPocketMax} | Coinsurance: ${p.benefits.coinsurance * 100}%`);
      lines.push(`  Key features: ${p.features.slice(0, 3).join(' | ')}`);
      if (p.limitations.length) lines.push(`  Limitations: ${p.limitations[0]}`);
      lines.push('');
    }
  }

  // ── Dental ─────────────────────────────────────────────────────────────────
  const d = catalog.dentalPlan;
  lines.push('── DENTAL PLAN ─────────────────────────────────────────────────────────────');
  lines.push(`[${d.id}] ${d.name} | Provider: ${d.provider}`);
  lines.push(`  Premiums: Employee $${d.tiers.employeeOnly}/mo | +Spouse $${d.tiers.employeeSpouse}/mo | +Child $${d.tiers.employeeChildren}/mo | Family $${d.tiers.employeeFamily}/mo`);
  lines.push(`  Deductible: $${d.benefits.deductible}/individual | Annual Max: $${d.benefits.outOfPocketMax}`);
  lines.push(`  Key features: ${d.features.join(' | ')}`);
  lines.push('');

  // ── Vision ─────────────────────────────────────────────────────────────────
  const v = catalog.visionPlan;
  lines.push('── VISION PLAN ─────────────────────────────────────────────────────────────');
  lines.push(`[${v.id}] ${v.name} | Provider: ${v.provider}`);
  lines.push(`  Premiums: Employee $${v.tiers.employeeOnly}/mo | +Spouse $${v.tiers.employeeSpouse}/mo | +Child $${v.tiers.employeeChildren}/mo | Family $${v.tiers.employeeFamily}/mo`);
  lines.push(`  Key features: ${v.features.join(' | ')}`);
  lines.push('');

  // ── Voluntary / Life ───────────────────────────────────────────────────────
  const volPlans = availablePlans.filter(p => p.type === 'voluntary');
  if (volPlans.length) {
    lines.push('── VOLUNTARY / LIFE & DISABILITY ───────────────────────────────────────────');
    for (const p of volPlans) {
      lines.push(`[${p.id}] ${p.name} | Provider: ${p.provider}`);
      lines.push(`  Premiums: Employee $${p.tiers.employeeOnly}/mo | +Spouse $${p.tiers.employeeSpouse}/mo | Family $${p.tiers.employeeFamily}/mo`);
      lines.push(`  Key features: ${p.features.join(' | ')}`);
      lines.push('');
    }
  }

  // ── Special Accounts ───────────────────────────────────────────────────────
  lines.push('── SPECIAL ACCOUNTS ────────────────────────────────────────────────────────');
  lines.push(`HSA: Employer contributes $${catalog.specialCoverage.hsa.employerContribution}/yr`);
  lines.push(`Commuter: $${catalog.specialCoverage.commuter.monthlyBenefit}/mo benefit`);
  lines.push('');

  // ── Enrollment Window ──────────────────────────────────────────────────────
  lines.push('── ENROLLMENT WINDOW ───────────────────────────────────────────────────────');
  lines.push(`Open: ${catalog.openEnrollment.startDate} – ${catalog.openEnrollment.endDate} | Effective: ${catalog.openEnrollment.effectiveDate}`);
  lines.push(`Eligibility: Full-time ≥${catalog.eligibility.fullTimeHours}h/wk. Coverage ${catalog.eligibility.coverageEffective}`);
  lines.push(`Dependents: Spouse=${catalog.eligibility.dependents.spouse} | Children: ${catalog.eligibility.dependents.children}`);

  return lines.join('\n');
}
