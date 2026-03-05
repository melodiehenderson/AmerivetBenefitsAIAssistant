// Quick regex test against actual user inputs from the transcript
const queries = [
  { label: "Q1-HSA+FSA", q: "I'm enrolling in the Standard HSA plan. My spouse has a general-purpose Healthcare FSA through their own employer. Can I still contribute to my HSA?" },
  { label: "Q2-Marriage", q: "I got married in August. I want to add my spouse to my Medical plan. How many days do I have to do this, and will my deductible reset to $0 for the family?" },
  { label: "Q3-STDpay", q: "I'm going on maternity leave. I have Short-Term Disability (STD) and FMLA. If my salary is $5,000/month and STD pays 60%, how much will I get paid during my 6th week of leave" },
  { label: "Q4-STDpreex", q: "I just switched to full-time today and I'm already 7 months pregnant. Does the Short-Term Disability plan have a 'pre-existing condition' clause that will deny my maternity claim" },
  { label: "Q5-Allstate", q: "I want to buy Term Life insurance through Allstate. How much does it cost for a 45-year-old" },
  { label: "Q6-PPOcompare", q: "I am 45 in Oregon. I have a spouse and 3 kids. Compare the monthly cost of the Standard HSA vs. the PPO for 'Employee + Family'." },
  { label: "Q7-DentalNoPricing", q: "Explain the difference between the Dental DPPO and DHMO plans, but do not include any pricing or dollar signs in your answer" },
  { label: "Q8-DentalRepeat", q: "difference" },
];

for (const { label, q } of queries) {
  const lower = q.toLowerCase();
  console.log(`\n=== ${label} ===`);
  console.log(`  Input: "${q.slice(0, 80)}..."`);

  // spouseGeneralFsaConflictIntent
  const fsa = /\bhsa\b/i.test(lower) && /\bspouse\b/i.test(lower) && /\b(general\s*[- ]?purpose\s*fsa|health\s*(care)?\s*fsa|medical\s*fsa|fsa)\b/i.test(lower);
  if (fsa) console.log("  ✅ spouseGeneralFsaConflictIntent → HSA+FSA intercept");

  // marriageWindowQuestion
  const marriage = /\b(married|marriage|got\s+married)\b/i.test(lower) && /\b(add\s+my\s+spouse|add\s+spouse|how\s+many\s+days|deadline|window|deductible\s+reset|reset\s+to\s+0)\b/i.test(lower);
  if (marriage) console.log("  ✅ marriageWindowQuestion → Marriage QLE intercept");

  // stdPayQuestion
  const stdPay = /\b(maternity\s+leave|leave)\b/i.test(lower) && /\b(std|short\s*[- ]?term\s+disability)\b/i.test(lower) && /\b(60%|sixty\s*percent|salary|paid|get\s+paid|week\s*\d+|6th\s+week|sixth\s+week)\b/i.test(lower);
  if (stdPay) console.log("  ✅ stdPayQuestion → STD pay intercept");

  // stdPreexistingQuestion
  const stdPreex = /\b(std|short\s*[- ]?term\s+disability)\b/i.test(lower) && /\bpre-?existing|deny\s+my\s+maternity\s+claim|already\s+\d+\s*months\s+pregnant\b/i.test(lower);
  if (stdPreex) console.log("  ✅ stdPreexistingQuestion → STD pre-existing intercept");

  // allstateTermQuestion
  const allstate = /\b(allstate)\b/i.test(lower) && /\b(term\s+life)\b/i.test(lower);
  if (allstate) console.log("  ✅ allstateTermQuestion → Allstate term life intercept");

  // asksPPOPlan
  const asksPPO = /\b(?:ppo\s*plan|the\s*ppo|ppo\s*option|ppo\s*medical|medical\s*ppo)\b/i.test(lower) && !/dental/i.test(lower);
  if (asksPPO) console.log("  ✅ asksPPOPlan → PPO clarification intercept");

  // familyTierSignal
  const family = /\b(spouse\s*(?:and|\+|&)\s*(?:\d+\s*)?child|family\s*of\s*[3-9]|wife\s*and\s*(?:\d+\s*)?kid|husband\s*and\s*(?:\d+\s*)?kid|partner\s*and\s*(?:\d+\s*)?child|(?:my|our)\s*(?:whole\s*)?family|spouse.*children|children.*spouse)\b/i.test(lower);
  if (family) console.log("  ✅ familyTierSignal → Employee + Family tier lock");

  // noPricing (FIXED: trailing \b removed, now matches "do not include", "no pricing", etc.)
  const noPricing = /(?:\bno\s*pric|\bno\s*rates?\b|\bno\s*costs?\b|\bno\s*dollar|\bcoverage\s*only\b|\bfeatures?\s*only\b|\bwithout\s*(?:any\s*)?(?:pric|cost|dollar|rate)|\bskip\s*pric|(?:\bdon'?t|\bdo\s+not)\s*(?:show|include|need|list|mention)\s*(?:any\s*)?(?:the\s*)?(?:cost|pric|rate|premium|dollar))/i.test(lower);
  if (noPricing) console.log("  ✅ noPricing → Session noPricingMode activated");

  // detectIntentDomain
  const hasPolicy = /\b(can\s+i|am\s+i|eligible|qualif(?:y|ied)|how\s+many\s+days|deadline|window|qle|qualifying\s+life\s+event|special\s+enrollment|filing\s+order|what\s+order|step\s*by\s*step|fmla|std|short\s*[- ]?term\s+disability|pre-?existing|clause|deny|denied|deductible\s+reset|effective\s+date)\b/i.test(lower);
  const hasPricing = /\b(how\s+much|cost|price|premium|deduct(?:ed|ion)|per\s*pay(?:check|period)|monthly|annual|compare\s+cost|estimate|projection|oop|out\s+of\s+pocket)\b/i.test(lower);
  const domain = hasPolicy && !hasPricing ? 'policy' : hasPricing ? 'pricing' : 'general';
  console.log(`  Intent domain: ${domain} (hasPolicy=${hasPolicy}, hasPricing=${hasPricing})`);

  // buildCategoryExplorationResponse skip check (FIXED: added difference/compare/explain/dhmo)
  const skipExploration = /per[\s-]*pay(?:check|period)?|deduct(?:ion|ed)|enroll\s+in\s+all|total\s+cost|how\s+much\s+would|maternity|pregnan|orthodont|braces|recommend|which\s+plan\s+should|qle|qualifying\s+life\s+event|how\s+many\s+days|deadline|window|fmla|short\s*[- ]?term\s+disability|pre-?existing|clause|can\s+i|d(?:ifference|ppo)\s*(?:vs?\.?|versus|between|and|compared)|compare|explain\s*(?:the)?\s*difference|dhmo/i.test(lower);
  console.log(`  Would skip buildCategoryExplorationResponse: ${skipExploration}`);

  // isTopic (from classifyInput)
  const isTopic = /medical|dental|vision|life|disability|hsa|ppo|hmo|coverage|plan|benefits|enroll|cost|price|insurance|critical|accident|injury|voluntary|help|select|choose|premium|claim|supplemental|accidental/i.test(lower);
  console.log(`  isTopic: ${isTopic}`);

  // What actually would have matched?
  const dentalDhmo = /\bdhmo\b/i.test(lower);
  const dentalComparison = /\bdental\b/i.test(lower) && /\b(difference|compare|versus|vs\.?|between)\b/i.test(lower);
  if (dentalDhmo) console.log("  ✅ dentalDhmoAsked → DHMO clarification intercept");
  if (dentalComparison && !dentalDhmo) console.log("  ✅ dentalComparisonAsked → dental comparison intercept");
  const intercepted = fsa || marriage || stdPay || stdPreex || allstate || asksPPO || dentalDhmo || dentalComparison;
  if (!intercepted && !noPricing) console.log("  ❌ NO INTERCEPT MATCHED — falls through to LLM");
  if (noPricing && !intercepted) console.log("  ⚡ noPricing active; falls through to LLM with pricing stripped");
  if (noPricing && intercepted) console.log("  ⚡ noPricing active + intercept will strip pricing from response");
}
