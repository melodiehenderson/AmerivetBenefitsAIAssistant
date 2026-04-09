type ScopeGuardArgs = {
  enrollmentPortalUrl: string;
  hrPhone: string;
};

export function buildScopeGuardResponse(query: string, args: ScopeGuardArgs): string | null {
  const lower = query.toLowerCase();

  if (/\b(password|passcode|credential|credentials)\b/i.test(lower) || (/\b(log\s*in|login|sign\s*in|enroll)\b/i.test(lower) && /\bfor\s+me\b/i.test(lower))) {
    return `I cannot process credentials or log into accounts for you. Please use Workday directly at ${args.enrollmentPortalUrl} or contact AmeriVet HR/Benefits at ${args.hrPhone} for enrollment help.`;
  }

  if (/\b(legal\s+advice|lawsuit|sue|attorney|lawyer)\b/i.test(lower)) {
    return 'I cannot provide legal advice. Please review your official plan documents and consult qualified legal counsel.';
  }

  if (/\b(diagnose|diagnosis|what\s+treatment|which\s+treatment|take\s+this\s+medication|medical\s+advice)\b/i.test(lower)) {
    return 'I cannot provide medical diagnosis or treatment advice. I can explain your benefits coverage, plan rules, and network options.';
  }

  if (/\b(miracle\s+cure|unapproved\s+treatment|experimental\s+cure)\b/i.test(lower)) {
    return 'I cannot provide information on treatments that are not approved or recognized by standard medical practice. For covered-care questions, please review the plan documents or speak with a medical professional.';
  }

  if ((/\b(dr\.?|doctor|clinic|provider)\b/i.test(lower) && /\b(guaranteed|guarantee|cover|covered|coverage)\b/i.test(lower)) || /\bcontrovers/i.test(lower)) {
    return 'I cannot recommend or verify coverage for specific providers. To check in-network status, please use the official provider directory for BCBSTX or Kaiser Permanente.';
  }

  if (/\b(poem|dragons|homework|essay|story)\b/i.test(lower)) {
    return 'I can help with AmeriVet benefits questions, including medical, dental, vision, life, disability, and HSA/FSA topics.';
  }

  return null;
}
