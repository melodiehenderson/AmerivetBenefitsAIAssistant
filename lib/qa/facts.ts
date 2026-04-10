export const KAISER_STATE_CODES = ['CA', 'GA', 'OR', 'WA'] as const;
export const KAISER_STATE_SET = new Set<string>(KAISER_STATE_CODES);

export const KAISER_STATES_WITH_CODES = 'California (CA), Georgia (GA), Washington (WA), and Oregon (OR)';
export const KAISER_STATES_PLAIN = 'California, Georgia, Washington, and Oregon';
export const KAISER_ELIGIBILITY_SHORT = 'CA, GA, WA, and OR';

export const RIGHTWAY_NOT_AMERIVET_MESSAGE =
  'Rightway is not an AmeriVet benefits resource and is not part of the AmeriVet benefits package.';
export const RIGHTWAY_BANNED_ENTITY_STATEMENT =
  '"Rightway" / "RightWay" / "Right Way" — NOT an AmeriVet carrier or resource.';
export const DHMO_BANNED_ENTITY_STATEMENT =
  '"DHMO" — AmeriVet does NOT offer a DHMO dental plan. Only BCBSTX Dental PPO.';
export const PPO_BANNED_ENTITY_STATEMENT =
  '"PPO" as a medical plan name — AmeriVet medical plans are "Standard HSA" and "Enhanced HSA" (they use BCBSTX PPO network, but the plans are NOT called "PPO").';
export const INVALID_PHONE_BANNED_ENTITY_STATEMENT =
  'Phone number (305) 851-7310 — this is NOT an AmeriVet number.';

export const CARRIER_LOCK_LINES = [
  'UNUM     = Basic Life & AD&D, Voluntary Term Life, Short-Term Disability, Long-Term Disability ONLY.',
  'ALLSTATE = Group Whole Life (Permanent), Accident Insurance, Critical Illness ONLY.',
  'BCBSTX   = Medical (Standard HSA, Enhanced HSA) and Dental PPO ONLY.',
  'VSP      = Vision ONLY.',
  `KAISER   = Medical HMO — ${KAISER_ELIGIBILITY_SHORT} ONLY. NEVER mention in any other state.`,
  'RIGHTWAY = NOT an AmeriVet carrier. NEVER mention Rightway in any response under any circumstances.',
] as const;

export function isKaiserStateCode(state?: string | null): boolean {
  return !!state && KAISER_STATE_SET.has(state.toUpperCase());
}

export function buildKaiserAvailabilityStatement(): string {
  return `Kaiser HMO is only available in ${KAISER_STATES_WITH_CODES} through AmeriVet.`;
}

export function buildKaiserUnavailableStateStatement(stateCode: string): string {
  return `${buildKaiserAvailabilityStatement()} It is not available in ${stateCode}.`;
}

export function buildCarrierLockBlock(): string {
  return CARRIER_LOCK_LINES.join('\n');
}
