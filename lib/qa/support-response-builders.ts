export function buildClarifyThenPortalFallback(
  portalUrl: string,
  hrPhone?: string,
): string {
  const supportLine = hrPhone
    ? ` or speak with AmeriVet HR/Benefits at ${hrPhone}`
    : ' or speak with your HR team';

  return [
    "I couldn't verify that in the official AmeriVet benefits documents.",
    "If you'd like, reply with the specific benefit, plan name, or state you're asking about and I'll try again.",
    `For accurate, plan-specific details, please visit your [benefits enrollment portal](${portalUrl})${supportLine}.`,
  ].join(' ');
}

export function buildLiveSupportFallback(
  portalUrl: string,
  hrPhone: string,
): string {
  return `For live support or additional assistance, please contact AmeriVet HR/Benefits at ${hrPhone}. You can also visit the enrollment portal at ${portalUrl} for self-service options.\n\nIs there anything else I can help you with?`;
}
