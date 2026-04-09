import type { Session } from '@/lib/rag/session-store';

export function buildStdPreexistingGuidance(): string {
  return [
    'This depends on your specific STD policy language and effective-date history.',
    'Many STD contracts include pre-existing condition provisions and look-back/look-forward windows, and timing of full-time eligibility can matter.',
    '',
    "I can't safely approve or deny the claim outcome here.",
    'The right next step is to check your UNUM STD certificate/SPD clause for pre-existing conditions and confirm your effective date with HR/Benefits immediately.',
  ].join('\n');
}

export function buildAllstateTermLifeCorrection(): string {
  return [
    "Quick carrier correction: AmeriVet's Term Life insurance is provided by UNUM, not Allstate.",
    'Allstate covers only Whole Life (permanent, cash-value) for AmeriVet employees.',
    '',
    "Here's the full life insurance lineup:",
    '- UNUM Basic Life & AD&D - $25,000 employer-paid, $0 cost to you',
    '- UNUM Voluntary Term Life - employee can elect 1x-5x salary (age-banded pricing; add spouse/child coverage available)',
    '- Allstate Whole Life - permanent coverage with cash-value accumulation; employee-paid',
    '',
    'Term Life pricing through UNUM is age-banded and set during enrollment in Workday.',
    'Would you like to know the coverage multiples available, or how to add a spouse/dependent to your Term Life?',
  ].join('\n');
}

export function buildAuthorityResolutionMessage(): string {
  return [
    'For conflicting benefit terms, the Summary Plan Description (SPD) / official plan document is the controlling source in most employer plans.',
    '',
    'Use this tie-break order:',
    '1) SPD / official plan document',
    '2) Carrier certificate of coverage',
    '3) Enrollment summaries/SBC or marketing summaries',
    '',
    'If two official docs conflict, escalate to HR/Benefits for a written determination before relying on age-limit rules.',
  ].join('\n');
}

export function buildQleFilingOrderMessage(session: Session): string {
  const stateNote = session.lastDetectedLocationChange
    ? `I updated your location to ${session.lastDetectedLocationChange.to} (from ${session.lastDetectedLocationChange.from}) for this guidance.\n\n`
    : '';

  return `${stateNote}For marriage/job-status/pregnancy scenarios, the safest filing order is:
1) File the marriage QLE first (add spouse/update dependents).
2) File the employment-status change event next (part-time/full-time, eligibility status).
3) File the birth/adoption event after delivery/adoption date.
4) Upload supporting documents at each step and confirm effective dates in Workday.

Most plans require QLE actions within a limited window (commonly 30 days, sometimes 31/60 by plan/event), so check your SPD and Workday event deadlines immediately.`;
}

export function buildLiveSupportMessage(session: Session, hrPhone: string, enrollmentPortalUrl: string): string {
  const nameRef = session.userName && session.userName !== 'Guest' ? session.userName : 'there';
  return `I understand you'd like to speak with someone directly, ${nameRef}. You can reach AmeriVet's HR/Benefits team at ${hrPhone} for personalized assistance. You can also visit the enrollment portal at ${enrollmentPortalUrl} for self-service options.\n\nIs there anything else I can help you with in the meantime?`;
}

export function buildAccidentPlanNamesMessage(hrPhone: string): string {
  return `There are two accident policy options: Accident Plan 1 and Accident Plan 2. Plan 1 typically has a higher premium with more comprehensive benefits, while Plan 2 has a lower premium but lower benefit limits. Refer to the Accident Insurance summary for exact details, or contact HR at ${hrPhone}.`;
}

export function buildStdLeavePayTimeline(lowerQuery: string): string {
  const salaryMatch = lowerQuery.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{4,6})\s*\/?\s*month/);
  const salary = salaryMatch ? Number(salaryMatch[1].replace(/,/g, '')) : null;
  const stdMonthly = salary ? (salary * 0.6).toFixed(2) : null;
  const mathLine = stdMonthly
    ? `With a salary of $${salary?.toLocaleString()}/month, UNUM STD pays $${stdMonthly}/month during the STD-active weeks (once the 2-week elimination period is satisfied).`
    : 'Share your monthly salary if you want a precise dollar calculation.';

  return [
    'Leave Pay Timeline - Maternity / FMLA + UNUM STD:',
    '',
    '- Weeks 1-2 (Elimination Period): STD benefit is not yet active. Use PTO or this period may be unpaid, depending on your employer leave policy.',
    '- Weeks 3-6 (STD Active - UNUM): UNUM pays 60% of your pre-disability base earnings. FMLA runs concurrently, providing job protection.',
    '- Weeks 7-8 (if physician-certified): STD may continue through week 8 for vaginal delivery or week 10 for C-section, subject to claim approval.',
    '- FMLA (all 12 weeks): Job-protected leave - FMLA does NOT supply pay on its own; income comes from STD and any PTO coordination.',
    '',
    'Key distinctions:',
    '- STD = income replacement (60% of base pay via UNUM).',
    '- FMLA = job protection (federal law, concurrent with STD, unpaid on its own).',
    '- Medical out-of-pocket costs (deductible, OOP max) are a separate question from leave pay.',
    '',
    mathLine,
    '',
    'Verify elimination period, claim approval timeline, and PTO coordination in your UNUM STD certificate/SPD and Workday.',
  ].join('\n');
}

export function buildParentalLeavePlan(enrollmentPortalUrl: string, hrPhone: string): string {
  return `Here is a step-by-step parental leave plan for AmeriVet employees:

Step 1 - Short-Term Disability (STD) via Unum
- STD covers disability from delivery itself (childbirth is a covered disability event).
- Standard benefit: 60% of weekly salary after the elimination period (typically 7 days for illness).
- Duration: up to 13 weeks from the qualifying disability date.
- File your STD claim with Unum before your due date. Unum will coordinate with your OB to confirm delivery date and disability period.

Step 2 - FMLA (Federal Family and Medical Leave Act)
- FMLA provides up to 12 weeks of job-protected, unpaid leave per year.
- Runs concurrently with STD, not consecutively - they overlap during the STD period.
- Eligibility: 12 months of employment and 1,250 hours worked in the past 12 months at a covered employer.
- File FMLA paperwork with HR at least 30 days before your expected leave date when possible.

Step 3 - Company / Employer Paid Leave (if applicable)
- Check your offer letter and HR handbook for any employer-paid parental leave benefit beyond STD.
- Employer-paid leave may stack before or after STD/FMLA - clarify with HR which runs first.
- PTO/vacation can typically be used to top up pay during any unpaid FMLA weeks.

Pay overlap edge cases:
- STD + FMLA overlap: You receive STD pay (60% salary) while FMLA job protection runs at the same time.
- If employer leave and STD overlap: most plans offset - you receive the higher of the two, not both added together. Confirm with Unum and HR.
- PTO coordination: some plans require you to exhaust PTO before STD begins. Check your STD certificate.
- Return-to-work: after FMLA expires, additional leave (bonding, non-medical) is at employer discretion and is unpaid unless a separate policy applies.

Recommended filing order: (1) Notify HR and file FMLA paperwork, (2) File STD claim with Unum, (3) Confirm any company leave policy with HR, (4) Coordinate PTO usage with payroll.

For your specific plan details and to file claims, visit Workday: ${enrollmentPortalUrl} or call HR at ${hrPhone}.`;
}
