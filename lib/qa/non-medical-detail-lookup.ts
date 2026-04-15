import type { Session } from '@/lib/rag/session-store';
import { getAmerivetBenefitsPackage } from '@/lib/data/amerivet-package';
import {
  AMERIVET_EMPLOYER_GUIDANCE_RULES,
  findAmerivetEmployerGuidanceRule,
} from '@/lib/data/amerivet-employer-guidance';

const ENROLLMENT_PORTAL_URL = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.html';

function getLifePlans() {
  const lifePlans = getAmerivetBenefitsPackage().catalog.voluntaryPlans.filter((plan) => plan.voluntaryType === 'life');
  return {
    basic: lifePlans.find((plan) => /basic life/i.test(plan.name)),
    term: lifePlans.find((plan) => /term life/i.test(plan.name)),
    whole: lifePlans.find((plan) => /whole life/i.test(plan.name)),
  };
}

function isPureVoluntaryTermAmountQuestion(queryLower: string): boolean {
  return /\b(how\s+much\s+should\s+i\s+get|how\s+much\s+coverage\s+should\s+i\s+get|help\s+me\s+decide\s+how\s+much|help\s+me\s+determine\s+how\s+much|help\s+me\s+figure\s+out\s+how\s+much|decide\s+how\s+much|determine\s+how\s+much|figure\s+out\s+how\s+much)\b/i.test(queryLower)
    && /\b(voluntary\s+term(?:\s+life)?|term\s+life)\b/i.test(queryLower)
    && !/\b(whole\s+life|permanent|perm)\b/i.test(queryLower);
}

function resolveEmployerLifeSplitGuidanceRule(query: string, session: Session) {
  const lower = query.toLowerCase();
  if (isPureVoluntaryTermAmountQuestion(lower)) return null;

  const explicitRule = findAmerivetEmployerGuidanceRule('Life Insurance', query);
  if (explicitRule) return explicitRule;

  const messageHistory = (session.messages || [])
    .map((message) => message.content.toLowerCase())
    .join('\n');
  const lastBot = (session.lastBotMessage || '').toLowerCase();
  const combined = `${messageHistory}\n${lastBot}\n${lower}`;
  const sessionHasDependents = Boolean(session.familyDetails?.hasSpouse)
    || Boolean((session.familyDetails?.numChildren || 0) > 0)
    || /employee\s+\+\s+(spouse|child|family)/i.test(session.coverageTierLock || '');
  const lastBotDiscussedLifeMix = /\blife insurance options:|voluntary term life|whole life|basic life|useful next life-insurance step|how much protection is worth paying|how much life insurance to add|default split|my practical take\b|other people rely on your income|included base benefit\b/i.test(lastBot);
  const asksProductDecision = /\b(which\s+one\s+should\s+i\s+get|which\s+ones\s+should\s+i\s+get|which\s+should\s+i\s+get|what\s+do\s+you\s+recommend|how\s+much\s+would\s+you\s+recommend|what\s+amount\s+would\s+you\s+recommend|how\s+much\s+of\s+each\s+would\s+you\s+recommend|help\s+me\s+with\s+that|help\s+me\s+decide|what\s+should\s+i\s+think\s+about|should\s+i\s+pay\s+for\s+more|how\s+much\s+should\s+i\s+get|how\s+much\s+coverage\s+should\s+i\s+get|how\s+much\s+protection\s+is\s+worth\s+paying|which\s+of\s+those\s+should\s+i\s+get)\b/i.test(lower);
  const mentionsExtraLifeChoice = /\b(voluntary\s+term(?:\s+life)?|whole\s+life|permanent|more\s+than\s+just\s+(?:the\s+)?basic|extra\s+life|additional\s+life|also\s+want\s+(?:voluntary\s+)?term(?:\s+life)?|want\s+(?:voluntary\s+)?term(?:\s+life)?|beyond\s+(?:the\s+)?basic|should\s+i\s+get\s+voluntary(?:\s+term(?:\s+life)?)?\s+and\s+(?:whole\s+)?life|should\s+i\s+get\s+whole\s+life\s+or\s+(?:voluntary\s+)?term(?:\s+life)?)\b/i.test(combined);
  const familyContext = sessionHasDependents || /\b(wife|husband|spouse|partner|kids?|children|family|dependents?)\b/i.test(combined);
  const incomeProtectionContext = /\b(other\s+people\s+rely\s+on\s+your\s+income|family\s+relies\s+on\s+your\s+income|depend(?:s)?\s+on\s+your\s+income|income\s+replacement|household\s+protection|more\s+than\s+just\s+(?:the\s+)?basic\s+life|base\s+benefit\s+isn'?t\s+enough)\b/i.test(combined);

  if (lastBotDiscussedLifeMix && asksProductDecision && (mentionsExtraLifeChoice || familyContext || incomeProtectionContext)) {
    return AMERIVET_EMPLOYER_GUIDANCE_RULES.find((rule) =>
      rule.topic === 'Life Insurance' && rule.intentFamily === 'life_split_term_vs_whole',
    ) || null;
  }

  return null;
}

function buildEmployerLifeSplitGuidanceReply(query: string, session: Session): string | null {
  const rule = resolveEmployerLifeSplitGuidanceRule(query, session);
  if (!rule) return null;

  const { basic, term, whole } = getLifePlans();
  const lower = query.toLowerCase();
  const primaryLabel = rule.allocation.primaryPlan === 'voluntary_term_life'
    ? (term?.name || 'Voluntary Term Life')
    : (whole?.name || 'Whole Life');
  const secondaryLabel = rule.allocation.secondaryPlan === 'whole_life'
    ? (whole?.name || 'Whole Life')
    : (term?.name || 'Voluntary Term Life');
  const asksAmountOrProtectionDecision = /\b(how\s+much\s+should\s+i\s+get|how\s+much\s+coverage\s+should\s+i\s+get|how\s+much\s+would\s+you\s+recommend|what\s+amount\s+would\s+you\s+recommend|how\s+much\s+of\s+each\s+would\s+you\s+recommend|how\s+much\s+protection\s+is\s+worth\s+paying|which\s+of\s+those\s+should\s+i\s+get|which\s+ones\s+should\s+i\s+get|which\s+should\s+i\s+get|what\s+do\s+you\s+recommend)\b/i.test(lower);
  const intro = asksAmountOrProtectionDecision
    ? `If you are asking how I would structure extra life coverage once the included base benefit is not enough, AmeriVet's current employer guidance is **${rule.recommendationLabel}**.`
    : `If you want a blended default between permanent coverage and extra term coverage, AmeriVet's current employer guidance is **${rule.recommendationLabel}**.`;
  const closing = asksAmountOrProtectionDecision
    ? `So my practical answer is: keep **${basic?.name || 'Basic Life'}** as the base, add **${primaryLabel}** as the main extra layer if other people rely on your income, and only add a smaller **${secondaryLabel}** slice if you also want permanent whole-life coverage.`
    : `So if you want me to lead the default split, I would usually start there and only move off it if you want almost all pure term protection or you care much more about permanent whole-life features.`;

  return [
    intro,
    ``,
    `What that means in practice:`,
    `- Keep **${basic?.name || 'Basic Life'}** as the included base layer`,
    `- Put the larger share into **${primaryLabel}** for the main income-replacement layer`,
    `- Keep the smaller share in **${secondaryLabel}** if you want some permanent cash-value coverage on top`,
    ``,
    closing,
  ].join('\n');
}

export function isNonMedicalDetailQuestion(topic: string, query: string): boolean {
  if (!topic || !query) return false;
  const lower = query.toLowerCase();
  const costQuestion = /\b(how\s+much|cost|costs|price|prices|rate|rates|premium|premiums)\b/i.test(lower);

  if (topic === 'Life Insurance') {
    return /\b(portable|guaranteed issue|cash value|whole life|term life|voluntary term(?:\s+life)?|basic life|voluntary life|age[- ]banded|rates? locked|coverage amount|how much life insurance|how much can i get|how much should i get|how much coverage should i get|help me decide how much|help me determine how much|help me figure out how much|decide how much|determine how much|figure out how much|if i do nothing|what life insurance do i get|included life|included coverage|default life|automatic coverage|automatically enrolled|already included|included by default|get automatically|without having to pay more|without paying more|without extra cost|1x|5x salary|spouse coverage|partner coverage|dependent child coverage|family coverage|cover my spouse|cover my partner|cover my wife|cover my husband|cover my family|cover my kids|cover my children|cover my dependents|which one should i get|which ones should i get|which should i get|should i pay for more|what should i think about)\b/i.test(lower)
      || costQuestion;
  }

  if (topic === 'Disability') {
    return /\b(short[- ]term\s+disability|long[- ]term\s+disability|std|ltd|waiting periods?|percentages?|maximum benefits?|max benefits?|paycheck|income protection|how does disability work)\b/i.test(lower)
      || costQuestion;
  }

  if (topic === 'Critical Illness') {
    return /\b(lump sum|serious diagnosis|diagnosis|what does it pay for|what is it for|what is it not|cash benefit|heart attack|stroke|cancer)\b/i.test(lower)
      || costQuestion;
  }

  if (topic === 'Accident/AD&D') {
    return /\b(what\s+is\s+accident(?:\/ad&d|\/ad\/d)?|what\s+is\s+ad&d|what\s+is\s+ad\/d|what\s+does\s+ad&d\s+mean|what\s+does\s+ad\/d\s+mean|difference between accident and ad&d|difference between accident and ad\/d|accidental death|loss of life|loss of limb|accidental injury|what does it pay for|what is it for|what is it not)\b/i.test(lower)
      || costQuestion;
  }

  return false;
}

export function buildNonMedicalDetailAnswer(topic: string, query: string, session: Session): string | null {
  const lower = query.toLowerCase();
  const { basic, term, whole } = getLifePlans();
  const costQuestion = /\b(how\s+much|cost|costs|price|prices|rate|rates|premium|premiums)\b/i.test(lower);
  const asksAboutLife = /\b(life(?:\s+insurance)?|term life|voluntary term(?:\s+life)?|whole life|basic life|voluntary life)\b/i.test(lower);
  const asksAboutDisability = /\b(disability|short[- ]term|long[- ]term|std|ltd)\b/i.test(lower);

  if (costQuestion && asksAboutLife && asksAboutDisability) {
    return [
      `At a high level:`,
      `- **Basic Life & AD&D** is employer-paid, so that base layer does not add an employee premium`,
      `- **Voluntary Term Life** is employee-paid and age-banded, so the exact cost depends on your age and election amount in Workday`,
      `- **Whole Life** is employee-paid, with rates locked at your enrollment age`,
      `- **Disability** is also an employee-paid optional benefit, and the current AmeriVet summary does not list the exact premium inline`,
      ``,
      `So I can tell you which pieces are employer-paid versus employee-paid, but for the exact combined premium for life plus disability, the right source is Workday.`,
    ].join('\n');
  }

  if (topic === 'Life Insurance') {
    const employerSplitGuidance = buildEmployerLifeSplitGuidanceReply(query, session);
    if (employerSplitGuidance) {
      return employerSplitGuidance;
    }

    if ((/\b(if i do nothing|what life insurance do i get|included life|included coverage|default life|automatic coverage|automatically enrolled|already included|included by default|get automatically|without having to pay more|without paying more|without extra cost)\b/i.test(lower) && /\b(life|coverage|insurance|plans?)\b/i.test(lower)) || /\bemployer-paid basic life\b/i.test(lower)) {
      return [
        `If you do nothing, AmeriVet still gives you **${basic?.name || 'Basic Life & AD&D'}** as the included base layer.`,
        ``,
        `What that means in practice:`,
        `- it is **employer-paid**`,
        `- the current summary lists it as a **$25,000** flat life benefit`,
        `- all benefits-eligible employees are automatically enrolled in that base coverage`,
        ``,
        `So the real follow-up decision is whether that included amount feels sufficient, or whether you want to add **${term?.name || 'Voluntary Term Life'}** or **${whole?.name || 'Whole Life'}** on top.`,
      ].join('\n');
    }

    if (/\b(portable|portability)\b/i.test(lower)) {
      return [
        `Portable means you may be able to keep that life coverage after leaving AmeriVet instead of losing it automatically when employment ends, subject to the carrier's conversion or portability rules.`,
        ``,
        `In AmeriVet's current package:`,
        `- ${term?.name || 'Voluntary Term Life'} is described as portable`,
        `- ${whole?.name || 'Whole Life'} is also described as portable`,
        `- ${basic?.name || 'Basic Life'} is employer-paid core coverage and is not the one described as portable in the summary`,
        ``,
        `So the practical takeaway is that portability matters more for the extra voluntary life choices than for the employer-paid base benefit.`,
      ].join('\n');
    }

    if (/\bguaranteed issue\b/i.test(lower)) {
      return [
        `Guaranteed issue means there is an amount you can elect during open enrollment without going through full medical underwriting.`,
        ``,
        `In AmeriVet's current summary for ${term?.name || 'Voluntary Term Life'}, guaranteed issue is listed up to $150,000 during open enrollment.`,
        ``,
        `The practical point is that guaranteed issue makes it easier to add term life without extra health questions, at least up to the stated limit.`,
      ].join('\n');
    }

    if (/\bcash value\b/i.test(lower)) {
      return [
        `Cash value is the savings-like component that builds inside a permanent life policy over time.`,
        ``,
        `In AmeriVet's package, that applies to ${whole?.name || 'Whole Life'}, not to the employer-paid basic life benefit or the voluntary term life option.`,
        ``,
        `So if you care about permanent coverage plus an accumulating value component, whole life is the life option that fits that description.`,
      ].join('\n');
    }

    if (/\b(age[- ]banded|rates? locked|enrollment age)\b/i.test(lower)) {
      return [
        `Age-banded means the voluntary term life rate is tied to your age bracket rather than staying flat forever.`,
        ``,
        `AmeriVet's current summaries also say ${whole?.name || 'Whole Life'} has rates locked at your enrollment age, which is different from the age-banded term life structure.`,
        ``,
        `So the practical distinction is: term life is the age-banded option, while whole life is the one described as having rates locked at enrollment age.`,
      ].join('\n');
    }

    if (/\b(spouse coverage|partner coverage|dependent child coverage|family coverage|cover my spouse|cover my partner|cover my wife|cover my husband|cover my family|cover my kids|cover my children|cover my dependents)\b/i.test(lower)) {
      return [
        `For family members, the practical distinction is that the employer-paid basic life benefit is the employee's base coverage, while the voluntary term life option is the one whose summary explicitly says spouse and dependent child coverage are available.`,
        ``,
        `So if you are asking about covering a spouse, husband, wife, kids, or family members more broadly, voluntary term life is the most relevant life-insurance option in the current AmeriVet summary.`,
      ].join('\n');
    }

    if (/\b(how much life insurance|how much can i get|coverage amount|1x|5x salary)\b/i.test(lower)) {
      return [
        `Here is the practical difference across AmeriVet's life-insurance amounts:`,
        ``,
        `- ${basic?.name || 'Basic Life'} is the employer-paid base benefit, and the current summary lists it at $25,000`,
        `- ${term?.name || 'Voluntary Term Life'} is the employee-paid extra layer, and the current summary says coverage can be 1x to 5x annual salary up to $500,000`,
        `- ${term?.name || 'Voluntary Term Life'} is also the life option whose summary says spouse and dependent child coverage are available`,
        `- ${whole?.name || 'Whole Life'} is the permanent option with cash value, so the practical decision there is more about permanent coverage than maximizing the term amount`,
        ``,
        `So if your question is how much extra life insurance you can get through AmeriVet, the main expandable amount is the voluntary term life option rather than the employer-paid basic life benefit.`,
      ].join('\n');
    }

    if (/\b(how much should i get|how much coverage should i get|help me decide how much|help me determine how much|help me figure out how much|decide how much|determine how much|figure out how much)\b/i.test(lower) || /\bhow\s+much\b[\w\s]{0,80}\bshould\s+i\s+get\b/i.test(lower)) {
      return [
        `The practical way I would decide how much life insurance to add is this:`,
        ``,
        `- treat **${basic?.name || 'Basic Life'}** as the included starting point, not the finished answer if other people rely on your income`,
        `- use **${term?.name || 'Voluntary Term Life'}** as the first extra layer when the goal is more straightforward household protection`,
        `- use **${whole?.name || 'Whole Life'}** only if you specifically want permanent coverage plus the cash-value design, not just more income replacement`,
        `- the more your household depends on your paycheck, debts, or childcare costs, the less likely that the included **$25,000** base benefit is enough by itself`,
        ``,
        `So my practical take is: if other people rely on your income, start by tightening up **voluntary term life** before worrying about whole life. I can also help you think through whether the included base benefit sounds clearly too small for your situation.`,
      ].join('\n');
    }

    if (/\b(voluntary term(?:\s+life)?|term life)\b/i.test(lower)) {
      return [
        `Here is the practical takeaway on **${term?.name || 'Voluntary Term Life'}**:`,
        ``,
        `- It is the extra employee-paid term coverage on top of AmeriVet's employer-paid basic life benefit`,
        `- The summary describes it as **age-banded**, so the exact price depends on your age bracket and election amount in Workday`,
        `- The current summary also says spouse and dependent child coverage are available`,
        `- It is described as portable if you leave AmeriVet`,
        ``,
        `So the short version is that voluntary term life is usually the cleaner extra protection option when you want more life coverage without moving into whole-life cash-value design.`,
      ].join('\n');
    }

    if (costQuestion) {
      return [
        `For life-insurance cost, the practical split is:`,
        ``,
        `- **${basic?.name || 'Basic Life & AD&D'}** is employer-paid, so that base life benefit does not add an employee premium`,
        `- **${term?.name || 'Voluntary Term Life'}** is employee-paid and age-banded, so the exact price depends on your age and how much coverage you elect in Workday`,
        `- **${whole?.name || 'Whole Life'}** is also employee-paid, and its rates are described as locked at your enrollment age`,
        ``,
        `So I can tell you the structure confidently, but for your exact life-insurance premium, Workday is the right source.`,
      ].join('\n');
    }

    if (/\b(whole life|term life|voluntary term(?:\s+life)?|basic life|voluntary life|difference|versus|vs\.?)\b/i.test(lower)) {
      return [
        `Here is the practical difference across AmeriVet's life insurance options:`,
        ``,
        `- ${basic?.name || 'Basic Life'} is the employer-paid base life and AD&D benefit`,
        `- ${term?.name || 'Voluntary Term Life'} is the extra employee-paid term coverage that is age-banded and can also cover spouse or dependent children`,
        `- ${whole?.name || 'Whole Life'} is the permanent option with cash value and rates locked at enrollment age`,
        ``,
        `So the short version is: basic life is the included base layer, voluntary term is usually the cleaner extra-income-protection option, and whole life is the permanent cash-value option.`,
      ].join('\n');
    }
  }

  if (topic === 'Disability') {
    if (costQuestion) {
      return [
        `For disability cost, the current AmeriVet summary does **not** list the exact premium inline, so I do not want to guess.`,
        ``,
        `What I can say confidently is:`,
        `- Disability is an optional employee-paid protection benefit`,
        `- It is meant to protect part of your income if illness or injury keeps you from working`,
        `- The exact rate and any payroll deduction are the details to confirm in Workday`,
        ``,
        `So the grounded answer is: disability does cost extra, but the exact premium needs to come from Workday rather than me inventing a number.`,
      ].join('\n');
    }

    if (/\b(short[- ]term(?:\s+disability)?|std)\b/i.test(lower) && /\b(long[- ]term(?:\s+disability)?|ltd)\b/i.test(lower)) {
      return [
        `Short-term disability and long-term disability are both income-protection benefits, but they solve different time horizons.`,
        ``,
        `- Short-term disability helps with temporary time away from work`,
        `- Long-term disability matters when the disability lasts longer and the work interruption is not brief`,
        `- In the current AmeriVet summary, the exact waiting periods, percentages, and maximum benefits still depend on the actual plan documents in Workday`,
        ``,
        `So the practical point is that short-term bridges the earlier phase, while long-term protects the paycheck if the work disruption lasts longer than expected.`,
      ].join('\n');
    }

    if (/\b(waiting periods?|percentages?|maximum benefits?|max benefits?)\b/i.test(lower)) {
      return [
        `I can keep this grounded in the AmeriVet package, and the current summary does not list the exact disability waiting periods, replacement percentages, or maximum benefits inline.`,
        ``,
        `What it does say is:`,
        `- Short-Term Disability helps with temporary time away from work`,
        `- Long-Term Disability helps if the disability lasts longer`,
        `- The exact waiting periods, percentages, and maximum benefits depend on the actual plan documents in Workday`,
        ``,
        `So I do not want to guess at those numbers, but I can still help explain when disability is worth prioritizing.`,
      ].join('\n');
    }

    if (/\b(paycheck|income protection|how does disability work)\b/i.test(lower)) {
      return [
        `Disability is really paycheck protection.`,
        ``,
        `The point is not to replace your medical plan — it is to protect part of your income if illness or injury keeps you from working.`,
        ``,
        `That is why disability often matters sooner than people expect for a household that depends on your ongoing paycheck.`,
      ].join('\n');
    }
  }

  if (topic === 'Critical Illness') {
    if (costQuestion) {
      return [
        `For critical illness pricing, I do **not** have a grounded flat-rate premium in the current AmeriVet summary, so I do not want to invent a ballpark.`,
        ``,
        `What I can say confidently is:`,
        `- Critical illness is an optional employee-paid supplemental benefit`,
        `- The exact payroll deduction is the part to confirm in Workday: ${ENROLLMENT_PORTAL_URL}`,
        `- I would use Workday for the real price rather than guess at a number here`,
        ``,
        `If you want, I can still help you decide whether critical illness is worth pricing out for your situation before you go check it.`,
      ].join('\n');
    }

    if (/\b(lump sum|cash benefit|what does it pay for|what is it for|serious diagnosis|diagnosis|heart attack|stroke|cancer)\b/i.test(lower)) {
      return [
        `Critical illness is meant to provide a lump-sum style cash benefit if you are diagnosed with a covered serious condition, such as a heart attack, stroke, or certain cancers.`,
        ``,
        `In practical terms, it is meant to help with the financial ripple effects around a diagnosis, like travel, childcare, or household bills, not just the doctor bill itself.`,
        ``,
        `So the practical use case is diagnosis-related cash support on top of your medical coverage, not routine care.`,
      ].join('\n');
    }

    if (/\bwhat is it not\b/i.test(lower)) {
      return [
        `What critical illness is not:`,
        ``,
        `- It is not a replacement for your medical plan`,
        `- It is not designed for routine care or everyday doctor visits`,
        `- It is not the same thing as disability, because it is tied to covered diagnoses rather than inability to work`,
      ].join('\n');
    }
  }

  if (topic === 'Accident/AD&D') {
    if (costQuestion) {
      return [
        `For accident coverage pricing, I do **not** have a grounded flat-rate premium in the current AmeriVet summary, so I do not want to invent a ballpark.`,
        ``,
        `What I can say confidently is:`,
        `- Accident/AD&D is an optional employee-paid supplemental benefit`,
        `- The exact payroll deduction is the part to confirm in Workday: ${ENROLLMENT_PORTAL_URL}`,
        `- I would use Workday for the real price rather than guess at a number here`,
        ``,
        `If you want, I can still help you decide whether accident coverage is worth pricing out for your situation before you go check it.`,
      ].join('\n');
    }

    if (/\bwhat\s+is\s+accident(?:\/ad&d|\/ad\/d)?|what\s+is\s+ad&d|what\s+is\s+ad\/d\b/i.test(lower)) {
      return [
        `Accident/AD&D coverage is another supplemental option. It generally pays benefits after covered accidental injuries, and AD&D adds benefits for severe accidental loss of life or limb.`,
        ``,
        `People often look at it when:`,
        `- They want extra protection beyond their medical plan`,
        `- They have an active household or dependents`,
        `- They want cash help after an accidental injury`,
        ``,
        `What it is not:`,
        `- It does not replace your medical plan`,
        `- It is not meant for routine care or everyday doctor visits`,
        `- It is not the diagnosis-focused benefit — that is closer to critical illness`,
      ].join('\n');
    }

    if (/\b(what\s+does\s+ad&d\s+mean|what\s+does\s+ad\/d\s+mean|difference between accident and ad&d|difference between accident and ad\/d|accidental death|loss of life|loss of limb)\b/i.test(lower)) {
      return [
        `Accident coverage and AD&D travel together in this benefit, but they are not exactly the same thing.`,
        ``,
        `- The accident side is about covered accidental injuries`,
        `- The AD&D side adds benefits for severe accidental loss of life or limb`,
        ``,
        `So the practical meaning of AD&D is that it is the more severe accidental-loss component layered on top of the broader accidental-injury protection.`,
      ].join('\n');
    }

    if (/\b(what does it pay for|what is it for|accidental injury)\b/i.test(lower)) {
      return [
        `Accident/AD&D is for accidental-injury scenarios, not routine medical use.`,
        ``,
        `In practical terms, people add it when they want extra cash support if an accidental injury happens even though they already have medical coverage in place.`,
        ``,
        `So it is more about the financial shock after a covered accident than about everyday doctor bills.`,
      ].join('\n');
    }

    if (/\bwhat is it not\b/i.test(lower)) {
      return [
        `What Accident/AD&D is not:`,
        ``,
        `- It is not a replacement for your medical plan`,
        `- It is not designed for routine care or ordinary office visits`,
        `- It is not the diagnosis-focused benefit — that is closer to the critical illness use case`,
      ].join('\n');
    }
  }

  return null;
}
