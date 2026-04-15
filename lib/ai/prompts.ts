// lib/ai/prompts.ts
import type { ArtifactKind } from '@/components/artifact';
import { getAmerivetPackageCopySnapshot } from '@/lib/data/amerivet-package-copy';
import {
  getAmerivetBenefitsPackage,
  type AmerivetBenefitsPackage,
} from '@/lib/data/amerivet-package';

// Define Geo type locally
interface Geo {
  latitude?: string;
  longitude?: string;
  city?: string;
  country?: string;
  region?: string;
}

export const artifactsPrompt = `
Artifacts is a special user interface mode that helps users with writing, editing, and other content creation tasks. When artifact is open, it is on the right side of the screen, while the conversation is on the left side. When creating or updating documents, changes are reflected in real-time on the artifacts and visible to the user.
...
`;

function buildOpenEnrollmentCopy(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): string {
  const snapshot = getAmerivetPackageCopySnapshot(benefitsPackage);
  const { openEnrollment, specialCoverage } = snapshot;

  return [
    `- Open Enrollment: ${openEnrollment.year} (${openEnrollment.startDate} to ${openEnrollment.endDate})`,
    `- Most benefits effective: ${openEnrollment.effectiveDate}`,
    `- HSA effective: ${specialCoverage.hsa.effectiveDate}`,
    `- Commuter effective: ${specialCoverage.commuter.effectiveDate}`,
  ].join('\n');
}

export function getBenefitsAdvisorPrompt(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): string {
  const snapshot = getAmerivetPackageCopySnapshot(benefitsPackage);
  const { catalog } = benefitsPackage;
  const medicalPlanList = snapshot.medicalPlanBullets
    .map((line, index) => `${index + 1}. ${line}`)
    .join('\n');
  const lifeLine = snapshot.lifePlanNames.length
    ? snapshot.lifePlanNames.join(', ')
    : 'Basic Life & AD&D';
  const disabilityLine = snapshot.disabilityPlanNames.length
    ? snapshot.disabilityPlanNames.join(', ')
    : 'Disability benefits';

  return `You are a knowledgeable and friendly benefits advisor AI assistant for Amerivet employees. You have access to comprehensive information about Amerivet's benefits plans, including medical, dental, vision, life insurance, and disability coverage.

Key Information about Amerivet Benefits:
${buildOpenEnrollmentCopy(benefitsPackage)}
- Eligibility: Full-time employees (${catalog.eligibility.fullTimeHours}+ hours/week)
- Coverage effective: ${catalog.eligibility.coverageEffective}

Medical Plans Available:
${medicalPlanList}

Dental: ${snapshot.dentalPlanBullet}
Vision: ${snapshot.visionPlanBullet}
Life Insurance: ${lifeLine}
Disability: ${disabilityLine}

You can help employees:
- Compare different benefit plans
- Calculate costs and contributions
- Understand eligibility requirements
- Explain coverage details and exclusions
- Navigate enrollment processes
- Answer questions about specific benefits

Always provide accurate, helpful information and guide employees to make informed decisions about their benefits.`;
}

export const benefitsAdvisorPrompt = getBenefitsAdvisorPrompt();

// THIS IS THE FIX: Exporting the constant that the chat API needs.
export function getChatSystemPrompt(
  benefitsPackage: AmerivetBenefitsPackage = getAmerivetBenefitsPackage(),
): string {
  const snapshot = getAmerivetPackageCopySnapshot(benefitsPackage);
  const { catalog } = benefitsPackage;
  const medicalLines = snapshot.medicalPlanBullets.map((line) => `- ${line}`).join('\n');

  return `You are an expert Benefits Assistant AI helping Amerivet employees understand and manage their benefits.

You have access to comprehensive information about ${snapshot.displayName}, including:

MEDICAL PLANS:
${medicalLines}

OTHER BENEFITS:
- Dental: ${snapshot.dentalPlanBullet}
- Vision: ${snapshot.visionPlanBullet}
- Life Insurance: ${snapshot.lifePlanNames.join(', ')}
- Disability: ${snapshot.disabilityPlanNames.join(', ')}

ELIGIBILITY:
- Full-time employees (${catalog.eligibility.fullTimeHours}+ hours/week)
- Coverage effective ${catalog.eligibility.coverageEffective}
- Dependents: spouse=${catalog.eligibility.dependents.spouse ? 'yes' : 'no'}, domestic partner=${catalog.eligibility.dependents.domesticPartner ? 'yes' : 'no'}, children=${catalog.eligibility.dependents.children}

You can help employees compare plans, calculate costs, understand coverage, and navigate enrollment. Always provide accurate, helpful information specific to Amerivet's benefits.`;
}

export const CHAT_SYSTEM_PROMPT = getChatSystemPrompt();

export const regularPrompt = benefitsAdvisorPrompt;

export interface RequestHints {
  latitude: Geo['latitude'];
  longitude: Geo['longitude'];
  city: Geo['city'];
  country: Geo['country'];
}

export const getRequestPromptFromHints = (requestHints: RequestHints) => `\
About the origin of user's request:
- lat: ${requestHints.latitude}
- lon: ${requestHints.longitude}
- city: ${requestHints.city}
- country: ${requestHints.country}
`;

export const systemPrompt = ({
  selectedChatModel,
  requestHints,
}: {
  selectedChatModel: string;
  requestHints: RequestHints;
}) => {
  const requestPrompt = getRequestPromptFromHints(requestHints);
  const advisorPrompt = getBenefitsAdvisorPrompt();

  if (selectedChatModel === 'chat-model-reasoning') {
    return `${advisorPrompt}\n\n${requestPrompt}`;
  } else {
    return `${advisorPrompt}\n\n${requestPrompt}\n\n${artifactsPrompt}`;
  }
};

export const codePrompt = `
You are a Python code generator that creates self-contained, executable code snippets...
`;

export const sheetPrompt = `
You are a spreadsheet creation assistant...
`;

export const updateDocumentPrompt = (
  currentContent: string | null,
  type: ArtifactKind,
) =>
  type === 'text'
    ? `\
Improve the following contents of the document based on the given prompt.

${currentContent}
`
    : type === 'code'
      ? `\
Improve the following code snippet based on the given prompt.

${currentContent}
`
      : type === 'sheet'
        ? `\
Improve the following spreadsheet based on the given prompt.

${currentContent}
`
        : '';
