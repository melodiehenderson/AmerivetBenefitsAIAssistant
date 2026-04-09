/**
 * Semantic Router - Senior Engineer Approach
 * 
 * Classifies user intent BEFORE RAG retrieval to ensure:
 * 1. Only relevant documents are fetched
 * 2. No "Medical Loop" bugs (asking about CI returns Medical docs)
 * 3. Strict category isolation
 */

// ============================================================================
// Intent Categories (Maps to Document Metadata)
// ============================================================================

export type IntentCategory = 
  | 'MEDICAL'           // Medical, Health, PPO, HMO, HDHP
  | 'DENTAL_VISION'     // Dental, Vision, Eye, Teeth
  | 'ANCILLARY'         // Accident, Critical Illness, Hospital Indemnity
  | 'LIFE_DISABILITY'   // Life Insurance, STD, LTD, AD&D
  | 'HSA_FSA'           // Health Savings, Flexible Spending
  | 'COST_CHECK'        // "How much", "cost", "price", "premium"
  | 'ENROLLMENT'        // "How do I enroll", "sign up", "deadline"
  | 'GENERAL'           // Fallback - search all
  | 'COMPARISON';       // "best plan", "compare", "which one"

export interface RouterResult {
  category: IntentCategory;
  confidence: number;
  searchFilters: Record<string, string | string[]>;
  requiresAgeBand: boolean;      // For age-rated products (refuse specific costs)
  triggersHSACrossSell: boolean; // The "Brandon Rule"
  keywords: string[];
}

// ============================================================================
// Keyword-Based Router (Fast, No LLM Required)
// ============================================================================

const INTENT_KEYWORDS: Record<IntentCategory, string[]> = {
  MEDICAL: [
    'medical', 'health', 'ppo', 'hmo', 'hdhp', 'high deductible',
    'doctor', 'hospital', 'urgent care', 'emergency', 'prescription',
    'rx', 'copay', 'coinsurance', 'deductible', 'specialist',
    'in-network', 'out-of-network', 'preventive', 'surgery'
  ],
  DENTAL_VISION: [
    'dental', 'vision', 'teeth', 'eye', 'glasses', 'contacts',
    'orthodontics', 'braces', 'cleaning', 'cavity', 'filling',
    'crown', 'root canal', 'optometrist', 'ophthalmologist',
    'exam', 'frames', 'lenses'
  ],
  ANCILLARY: [
    'accident', 'critical illness', 'hospital indemnity', 'ci',
    'supplemental', 'voluntary', 'injury', 'cancer', 'heart attack',
    'stroke', 'broken bone', 'fracture', 'icu', 'cash benefit'
  ],
  LIFE_DISABILITY: [
    'life insurance', 'life', 'ad&d', 'accidental death', 'beneficiary',
    'death benefit', 'term life', 'whole life', 'disability',
    'std', 'ltd', 'short term disability', 'long term disability',
    'income protection', 'salary replacement'
  ],
  HSA_FSA: [
    'hsa', 'fsa', 'health savings', 'flexible spending', 'hra',
    'tax-free', 'contribution', 'rollover', 'dependent care',
    'healthcare account', 'pre-tax'
  ],
  COST_CHECK: [
    'how much', 'cost', 'price', 'premium', 'rate', 'pay',
    'per month', 'monthly', 'annually', 'per paycheck',
    'what does it cost', 'pricing', 'affordable'
  ],
  ENROLLMENT: [
    'enroll', 'sign up', 'register', 'deadline', 'open enrollment',
    'when can i', 'how do i enroll', 'new hire', 'qualifying event',
    'life event', 'change my benefits'
  ],
  COMPARISON: [
    'best plan', 'compare', 'which one', 'recommend', 'should i',
    'difference between', 'vs', 'better', 'best option',
    'which plan', 'best for me', 'what do you recommend'
  ],
  GENERAL: [] // Fallback
};

// Products that require age-banding (refuse specific costs)
const AGE_BANDED_PRODUCTS = new Set([
  'voluntary life', 'life insurance', 'disability', 'std', 'ltd',
  'critical illness', 'ci', 'ad&d', 'supplemental life'
]);

// Products that trigger HSA cross-sell (Brandon Rule)
const HSA_TRIGGER_KEYWORDS = new Set([
  'hdhp', 'high deductible', 'hsa', 'health savings'
]);

// ============================================================================
// Main Router Function
// ============================================================================

export function routeIntent(query: string): RouterResult {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/);
  
  // Score each category
  const scores: Record<IntentCategory, number> = {
    MEDICAL: 0,
    DENTAL_VISION: 0,
    ANCILLARY: 0,
    LIFE_DISABILITY: 0,
    HSA_FSA: 0,
    COST_CHECK: 0,
    ENROLLMENT: 0,
    COMPARISON: 0,
    GENERAL: 0.1 // Base score
  };
  
  const matchedKeywords: string[] = [];
  
  // Check multi-word phrases first (more specific)
  for (const [category, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (keyword.includes(' ') && lower.includes(keyword)) {
        scores[category as IntentCategory] += 2; // Phrase match = 2 points
        matchedKeywords.push(keyword);
      }
    }
  }
  
  // Check single words
  for (const word of words) {
    for (const [category, keywords] of Object.entries(INTENT_KEYWORDS)) {
      if (keywords.includes(word)) {
        scores[category as IntentCategory] += 1;
        if (!matchedKeywords.includes(word)) {
          matchedKeywords.push(word);
        }
      }
    }
  }
  
  // Find winning category
  let maxScore = 0;
  let winningCategory: IntentCategory = 'GENERAL';
  
  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      winningCategory = category as IntentCategory;
    }
  }

  // COST_CHECK is usually a modifier ("how much") rather than the actual benefit category.
  // If we have any concrete benefit signals, prefer those so retrieval can be filtered.
  if (winningCategory === 'COST_CHECK') {
    const benefitCategories: IntentCategory[] = ['MEDICAL', 'DENTAL_VISION', 'ANCILLARY', 'LIFE_DISABILITY', 'HSA_FSA'];
    let bestBenefit: IntentCategory | null = null;
    let bestBenefitScore = 0;
    for (const cat of benefitCategories) {
      if (scores[cat] > bestBenefitScore) {
        bestBenefitScore = scores[cat];
        bestBenefit = cat;
      }
    }

    const hasCoverageTierCue = /(employee\s*\+\s*(?:child|children|spouse|family)|employee\s*only|per\s*pay(?:check|period)|per\s*pay\b)/i.test(query);
    const hasVoluntaryCue = /(accident|critical illness|hospital indemnity|supplemental|voluntary|ad&d)/i.test(query);
    // Use word boundaries so "healthcare" does not false-match the 'health' stem
    const hasMedicalCue = /\b(ppo|hmo|hdhp|hsa|kaiser|medical|health)\b/i.test(query);

    if (bestBenefit && bestBenefitScore >= 2) {
      winningCategory = bestBenefit;
      maxScore = bestBenefitScore;
    } else if (!hasVoluntaryCue && (hasMedicalCue || hasCoverageTierCue)) {
      // Most "coverage tier + per paycheck" questions are about medical plan premiums.
      winningCategory = 'MEDICAL';
    }
  }
  
  // Calculate confidence (normalized)
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? maxScore / totalScore : 0.1;
  
  // Check for age-banded products
  const requiresAgeBand = matchedKeywords.some(kw => 
    AGE_BANDED_PRODUCTS.has(kw) || 
    Array.from(AGE_BANDED_PRODUCTS).some(p => kw.includes(p))
  );
  
  // Check for HSA cross-sell trigger (Brandon Rule)
  const triggersHSACrossSell = matchedKeywords.some(kw => 
    HSA_TRIGGER_KEYWORDS.has(kw)
  );
  
  // Build search filters based on category
  const searchFilters = buildSearchFilters(winningCategory);
  
  console.log(`[ROUTER] Query: "${query.substring(0, 50)}..." → ${winningCategory} (${(confidence * 100).toFixed(0)}% conf)`);
  console.log(`[ROUTER] Keywords: ${matchedKeywords.join(', ')}`);
  console.log(`[ROUTER] Filters: ${JSON.stringify(searchFilters)}`);
  
  return {
    category: winningCategory,
    confidence,
    searchFilters,
    requiresAgeBand,
    triggersHSACrossSell,
    keywords: matchedKeywords
  };
}

// ============================================================================
// Search Filter Builder (Prevents Medical Loop)
// ============================================================================

function buildSearchFilters(category: IntentCategory): Record<string, string | string[]> {
  switch (category) {
    case 'MEDICAL':
      return { 
        category: 'Medical',
        excludeCategories: ['Dental', 'Vision', 'Life', 'Disability', 'Voluntary']
      };
    
    case 'DENTAL_VISION':
      return { 
        category: ['Dental', 'Vision'],
        excludeCategories: ['Medical', 'Life']
      };
    
    case 'ANCILLARY':
      return { 
        category: ['Voluntary', 'Accident', 'Critical Illness', 'Hospital Indemnity'],
        excludeCategories: ['Medical', 'Dental']
      };
    
    case 'LIFE_DISABILITY':
      return { 
        category: ['Life', 'Disability', 'AD&D', 'STD', 'LTD'],
        excludeCategories: ['Medical']
      };
    
    case 'HSA_FSA':
      return { 
        category: ['Savings', 'HSA', 'FSA'],
        // Also include HDHP medical for context
        includeRelated: ['Medical']
      };
    
    case 'COST_CHECK':
      // Cost questions can span multiple categories - no strict filter
      return {};
    
    case 'ENROLLMENT':
      return { category: 'Enrollment' };
    
    case 'COMPARISON':
      // Comparison needs all options - no strict filter
      return {};
    
    case 'GENERAL':
    default:
      return {};
  }
}

// ============================================================================
// State Gate - Ensures User Has Required Info
// ============================================================================

export interface StateGateResult {
  passed: boolean;
  missingFields: ('state' | 'age' | 'division')[];
  promptMessage: string | null;
}

export function checkStateGate(session: {
  userState?: string | null;
  userAge?: number | null;
  userDivision?: string | null;
}): StateGateResult {
  const missing: ('state' | 'age' | 'division')[] = [];
  
  if (!session.userState) missing.push('state');
  if (!session.userAge) missing.push('age');
  // Division is optional for most queries
  // if (!session.userDivision) missing.push('division');
  
  if (missing.length === 0) {
    return { passed: true, missingFields: [], promptMessage: null };
  }
  
  // Build prompt message
  let promptMessage: string;
  
  if (missing.includes('state') && missing.includes('age')) {
    promptMessage = "Before we explore your benefits, I need to know your **Age** and **State** to show you accurate plan options and pricing. (e.g., \"34 in California\")";
  } else if (missing.includes('state')) {
    promptMessage = "Which **State** do you live in? This helps me find the right plans for you.";
  } else if (missing.includes('age')) {
    promptMessage = "What is your **Age**? This affects your premium rates.";
  } else {
    promptMessage = "I need a bit more information to help you. What's your age and state?";
  }
  
  return { passed: false, missingFields: missing, promptMessage };
}

// ============================================================================
// Post-Processing: Brandon Rule (HSA Cross-Sell)
// ============================================================================

export function applyBrandonRule(
  answer: string, 
  routerResult: RouterResult
): string {
  if (!routerResult.triggersHSACrossSell) {
    return answer;
  }
  
  // Check if answer already mentions accident/CI
  const alreadyMentioned = /accident|critical illness|supplemental/i.test(answer);
  if (alreadyMentioned) {
    return answer;
  }
  
  const crossSellMessage = `

💡 **Pro Tip:** Since you're looking at a High Deductible plan, I highly recommend considering Accident or Critical Illness coverage. These plans pay you cash to help cover that higher deductible if something unexpected happens.`;

  return answer + crossSellMessage;
}

// ============================================================================
// Age-Band Protection (Refuse Specific Costs)
// ============================================================================

export function getAgeBandedResponse(
  category: IntentCategory,
  routerResult: RouterResult
): string | null {
  if (!routerResult.requiresAgeBand) {
    return null;
  }
  
  // Only trigger if asking about cost
  const isCostQuestion = routerResult.category === 'COST_CHECK' || 
    routerResult.keywords.some(k => ['cost', 'price', 'premium', 'rate', 'how much'].includes(k));
  
  if (!isCostQuestion) {
    return null;
  }
  
  return `Since this is an age-rated product, the cost varies based on your exact age and coverage amount you select. 

To see your personalized rate, please log in to the enrollment portal at ${process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.html'} where you can view the exact premium for your age bracket and customize your coverage level.

Would you like me to explain what this coverage includes instead?`;
}
