import {
  amerivetBenefits2024_2025,
  KAISER_AVAILABLE_STATE_CODES,
  STATE_ABBREV_TO_NAME,
  type AmerivetBenefitsCatalog,
  type BenefitPlan,
} from '@/lib/data/amerivet';

export interface AmerivetBenefitsPackage {
  packageId: string;
  employerKey: 'amerivet';
  displayName: string;
  catalog: AmerivetBenefitsCatalog;
  kaiserAvailableStateCodes: readonly string[];
  stateAbbrevToName: Readonly<Record<string, string>>;
}

export const DEFAULT_AMERIVET_PACKAGE_ID = 'amerivet-2024-2025';

const DEFAULT_AMERIVET_PACKAGE: AmerivetBenefitsPackage = {
  packageId: DEFAULT_AMERIVET_PACKAGE_ID,
  employerKey: 'amerivet',
  displayName: 'AmeriVet Benefits 2024-2025',
  catalog: amerivetBenefits2024_2025,
  kaiserAvailableStateCodes: KAISER_AVAILABLE_STATE_CODES,
  stateAbbrevToName: STATE_ABBREV_TO_NAME,
};

const AMERIVET_PACKAGES: Record<string, AmerivetBenefitsPackage> = {
  [DEFAULT_AMERIVET_PACKAGE_ID]: DEFAULT_AMERIVET_PACKAGE,
};

const KAISER_DISPLAY_ORDER = ['CA', 'GA', 'WA', 'OR'] as const;

function sortStateCodesForDisplay(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized = codes
    .map((code) => code.toUpperCase())
    .filter((code) => {
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    });

  const preferred = KAISER_DISPLAY_ORDER.filter((code) => normalized.includes(code));
  const remainder = normalized
    .filter((code) => !preferred.includes(code as (typeof KAISER_DISPLAY_ORDER)[number]))
    .sort();

  return [...preferred, ...remainder];
}

function formatHumanList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function createAmerivetBenefitsPackage(
  definition: AmerivetBenefitsPackage,
): AmerivetBenefitsPackage {
  return definition;
}

export function listAmerivetBenefitsPackageIds(): string[] {
  return Object.keys(AMERIVET_PACKAGES);
}

export function getAmerivetBenefitsPackage(packageId?: string | null): AmerivetBenefitsPackage {
  const resolvedId = packageId || process.env.AMERIVET_BENEFITS_PACKAGE_ID || DEFAULT_AMERIVET_PACKAGE_ID;
  return AMERIVET_PACKAGES[resolvedId] || DEFAULT_AMERIVET_PACKAGE;
}

export function getAllAmerivetBenefitPlans(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): BenefitPlan[] {
  const { catalog } = benefitsPackage;
  return [
    ...catalog.medicalPlans,
    catalog.dentalPlan,
    catalog.visionPlan,
    ...catalog.voluntaryPlans,
  ];
}

export function isKaiserEligibleForState(
  stateCode?: string | null,
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): boolean {
  return !!stateCode && benefitsPackage.kaiserAvailableStateCodes.includes(stateCode.toUpperCase());
}

export function getKaiserAvailabilityCopy(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): {
  stateCodes: string[];
  codeList: string;
  codeSlashList: string;
  stateNames: string[];
  nameList: string;
  nameAndCodeList: string;
} {
  const stateCodes = sortStateCodesForDisplay(benefitsPackage.kaiserAvailableStateCodes);
  const stateNames = stateCodes.map((code) => benefitsPackage.stateAbbrevToName[code] || code);
  const nameAndCode = stateCodes.map((code, index) => `${stateNames[index]} (${code})`);

  return {
    stateCodes,
    codeList: formatHumanList(stateCodes),
    codeSlashList: stateCodes.join('/'),
    stateNames,
    nameList: formatHumanList(stateNames),
    nameAndCodeList: formatHumanList(nameAndCode),
  };
}
