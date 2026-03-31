// lib/data/irs-limits-2026.ts
// Source: IRS Rev. Proc. 2025-19
// These are deterministic constants — never let LLM source these

export const IRS_2026 = {
  HSA_SELF_ONLY: 4300,
  HSA_FAMILY: 8550,
  HSA_CATCHUP_ADDITIONAL: 1000,
  HSA_CATCHUP_AGE: 55,
  FSA_GENERAL_MAX: 3300,
  FSA_LIMITED_MAX: 3300,
  FSA_ROLLOVER_MAX: 660,
  DEPENDENT_CARE_FSA_MAX: 5000,
} as const;

export type IRS2026Keys = keyof typeof IRS_2026;
