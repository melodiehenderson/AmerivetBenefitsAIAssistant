/**
 * Simple Chat Router - Streamlined for MVP
 * Handles basic chat functionality without complex ML dependencies
 */

import { logger } from '@/lib/logger';
import { simpleRAGSystem } from '@/lib/ai/simple-rag';
import type { BenefitPlan } from '@/lib/data/amerivet';
import { getPlansByRegion } from '@/lib/data/amerivet-benefits';
import { compareMaternityCosts, estimateCostProjection } from '@/lib/rag/pricing-utils';

type ChatContext = {
  state?: string;
  division?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

interface ChatResponse {
  content: string;
  responseType: 'simple' | 'benefits' | 'error';
  confidence: number;
  timestamp: Date;
}

const ENROLLMENT_URL = process.env.ENROLLMENT_PORTAL_URL || 'https://wd5.myworkday.com/amerivet/login.htmld';

export class SimpleChatRouter {
  private static readonly MEDICAL_TRANSITION =
    "Now that we've covered medical, do you want to look at Dental, Vision, or other plans?";
  private static readonly DIVISION_PLAN_MAP: Record<string, string[]> = {
    operations: ['bcbstx-standard-hsa', 'bcbstx-enhanced-hsa', 'bcbstx-dental', 'vsp-vision-plus', 'unum-basic-life'],
    corporate: ['bcbstx-enhanced-hsa', 'kaiser-standard-hmo', 'bcbstx-dental', 'vsp-vision-plus', 'unum-basic-life'],
    retail: ['kaiser-standard-hmo', 'bcbstx-standard-hsa', 'bcbstx-dental', 'vsp-vision-plus', 'unum-basic-life']
  };

  constructor() {}

  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  async routeMessage(message: string, context?: ChatContext, attachments?: any[]): Promise<ChatResponse> {
    try {
      // Store conversation history for context extraction
      if (context?.history) {
        this.conversationHistory = context.history;
      }
      
      const normalizedMessage = message.toLowerCase();

      if (attachments && attachments.length > 0) {
        return this.handleDocumentAnalysis(message, attachments, context);
      }

      if (this.isAgeBandedCostQuestion(normalizedMessage)) {
        return this.handleAgeBandedCostQuestion(context);
      }

      if (this.isOtherPlansQuestion(normalizedMessage)) {
        return this.handleOtherPlansQuestion(context);
      }

      if (this.isBenefitsQuestion(normalizedMessage)) {
        return this.handleBenefitsQuestion(normalizedMessage, context);
      }

      if (this.isComparisonQuestion(normalizedMessage)) {
        return this.handleComparisonQuestion(normalizedMessage, context);
      }

      if (this.isCostQuestion(normalizedMessage)) {
        return this.handleCostQuestion(context);
      }

      if (this.isAllBenefitsQuestion(normalizedMessage)) {
        return this.handleAllBenefitsQuestion(context);
      }

      if (this.isCostProjectionQuestion(normalizedMessage)) {
        return this.handleCostProjectionQuestion(context);
      }

      if (this.isMaternityQuestion(normalizedMessage)) {
        return this.handleMaternityQuestion(context);
      }

      return this.getDefaultResponse(context);
    } catch (error) {
      logger.error('Error in SimpleChatRouter', { error, message });
      return {
        content: "I'm sorry, I encountered an error processing your request. Please try again.",
        responseType: 'error',
        confidence: 0,
        timestamp: new Date()
      };
    }
  }

  private isBenefitsQuestion(message: string): boolean {
    const keywords = ['health', 'dental', 'vision', 'insurance', 'benefits', 'coverage'];
    return keywords.some(keyword => message.includes(keyword));
  }

  private isComparisonQuestion(message: string): boolean {
    const keywords = ['compare', 'difference', 'vs', 'versus', 'better', 'which'];
    return keywords.some(keyword => message.includes(keyword));
  }

  private isCostQuestion(message: string): boolean {
    const keywords = ['cost', 'price', 'expensive', 'cheap', 'afford', 'budget'];
    return keywords.some(keyword => message.includes(keyword));
  }

  private isOtherPlansQuestion(message: string): boolean {
    const keywords = ['other plans', 'ancillary', 'voluntary', 'additional coverage', 'more plans'];
    return keywords.some(keyword => message.includes(keyword));
  }

  private isAgeBandedCostQuestion(message: string): boolean {
    const keywords = [
      'critical illness',
      'life insurance',
      'short-term disability',
      'long-term disability',
      'std',
      'ltd'
    ];
    return keywords.some(keyword => message.includes(keyword));
  }

  private isAllBenefitsQuestion(message: string): boolean {
    const patterns = [
      /all(\s+the)?\s+benefits/i,
      /everything/i,
      /total.*deduct/i,
      /per paycheck.*all/i,
      /enroll.*all/i,
      /combined.*cost/i,
      /total.*cost/i
    ];
    return patterns.some(pattern => pattern.test(message));
  }

  private isCostProjectionQuestion(message: string): boolean {
    const patterns = [
      /projected.*cost/i,
      /next year/i,
      /estimate.*cost/i,
      /calculate.*healthcare/i,
      /usage.*level/i,
      /moderate.*usage/i,
      /high.*usage/i,
      /low.*usage/i,
      /family[0-9]*\+/i
    ];
    return patterns.some(pattern => pattern.test(message));
  }

  private isMaternityQuestion(message: string): boolean {
    const patterns = [
      /maternity/i,
      /pregnant/i,
      /pregnancy/i,
      /baby/i,
      /newborn/i,
      /expecting/i,
      /prenatal/i,
      /postnatal/i,
      /delivery/i,
      /ob[- ]?gyn/i
    ];
    return patterns.some(pattern => pattern.test(message));
  }

  private handleBenefitsQuestion(message: string, context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
    const eligible = this.getEligibleBenefits(context);
    let response = `${contextIntro}Here's information about your eligible medical, dental, and vision plans:\n\n`;

    response += '**Medical Plans:**\n';
    if (eligible.medical.length === 0) {
      response += '- No medical plans found for your eligibility. Please verify your state/division.\n';
    } else {
      eligible.medical.forEach(plan => {
        response += `- ${plan.name}: ${this.formatMonthlyYearly(this.getEmployeeOnlyMonthly(plan))} - ${plan.description ?? 'Comprehensive coverage'}\n`;
      });
    }

    response += '\n**Dental Plans:**\n';
    if (eligible.dental.length === 0) {
      response += '- No dental plans found for your eligibility.\n';
    } else {
      eligible.dental.forEach(plan => {
        response += `- ${plan.name}: ${this.formatMonthlyYearly(this.getEmployeeOnlyMonthly(plan))} - ${plan.description ?? 'Dental coverage'}\n`;
      });
    }

    response += '\n**Vision Plans:**\n';
    if (eligible.vision.length === 0) {
      response += '- No vision plans found for your eligibility.\n';
    } else {
      eligible.vision.forEach(plan => {
        response += `- ${plan.name}: ${this.formatMonthlyYearly(this.getEmployeeOnlyMonthly(plan))} - ${plan.description ?? 'Vision coverage'}\n`;
      });
    }

    return {
      content: this.buildMedicalResponse(response, message),
      responseType: 'benefits',
      confidence: 0.9,
      timestamp: new Date()
    };
  }

  private handleComparisonQuestion(message: string, context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
    const eligible = this.getEligibleBenefits(context);
    let response = `${contextIntro}**Plan Comparison Guide - Side-by-Side Analysis**\n\n`;

    response += '**Medical Options:**\n';
    const [primary, secondary] = eligible.medical;
    if (primary) {
      response += `- ${primary.name}: ${this.formatMonthlyYearly(this.getEmployeeOnlyMonthly(primary))}\n`;
    }
    if (secondary) {
      response += `- ${secondary.name}: ${this.formatMonthlyYearly(this.getEmployeeOnlyMonthly(secondary))}\n`;
    }
    response += '\n**Key Differences to consider:**\n';
    response += '- Network access and regional availability\n';
    response += '- Deductible vs copay structure\n';
    response += '- HSA eligibility (for high deductible options)\n';

    return {
      content: this.buildMedicalResponse(response, message),
      responseType: 'benefits',
      confidence: 0.8,
      timestamp: new Date()
    };
  }

  private handleCostQuestion(context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
    const eligible = this.getEligibleBenefits(context);
    const medicalPrimary = eligible.medical[0];
    const medicalSecondary = eligible.medical[1] ?? eligible.medical[0];
    const dentalPrimary = eligible.dental[0];
    const dentalSecondary = eligible.dental[1] ?? eligible.dental[0];
    const visionPrimary = eligible.vision[0];

    const primaryTotal = (medicalPrimary ? this.getEmployeeOnlyMonthly(medicalPrimary) : 0) +
      (dentalPrimary ? this.getEmployeeOnlyMonthly(dentalPrimary) : 0) +
      (visionPrimary ? this.getEmployeeOnlyMonthly(visionPrimary) : 0);

    const secondaryTotal = (medicalSecondary ? this.getEmployeeOnlyMonthly(medicalSecondary) : 0) +
      (dentalSecondary ? this.getEmployeeOnlyMonthly(dentalSecondary) : 0) +
      (visionPrimary ? this.getEmployeeOnlyMonthly(visionPrimary) : 0);

    let response = `${contextIntro}**Medical Plan Cost Comparison Tool:**\n\n`;
    response += '**Monthly Premiums:**\n';
    eligible.medical.forEach(plan => {
      response += `- ${plan.name}: ${this.formatMonthlyYearly(this.getEmployeeOnlyMonthly(plan))}\n`;
    });
    eligible.dental.forEach(plan => {
      response += `- ${plan.name}: ${this.formatMonthlyYearly(this.getEmployeeOnlyMonthly(plan))}\n`;
    });
    eligible.vision.forEach(plan => {
      response += `- ${plan.name}: ${this.formatMonthlyYearly(this.getEmployeeOnlyMonthly(plan))}\n`;
    });

    response += '\n**Total Monthly Costs:**\n';
    if (medicalPrimary) {
      const combo = [medicalPrimary?.name, dentalPrimary?.name, visionPrimary?.name].filter(Boolean).join(' + ');
      response += `- Primary Package: ${this.formatMonthlyYearly(primaryTotal)} (${combo})\n`;
    }
    if (medicalSecondary && medicalSecondary !== medicalPrimary) {
      const combo = [medicalSecondary?.name, dentalSecondary?.name, visionPrimary?.name].filter(Boolean).join(' + ');
      response += `- Alternative Package: ${this.formatMonthlyYearly(secondaryTotal)} (${combo})\n`;
    }

    response += '\nWould you like me to calculate costs for your specific situation?';

    return {
      content: this.appendFinalCTA(response),
      responseType: 'benefits',
      confidence: 0.9,
      timestamp: new Date()
    };
  }

  private handleAgeBandedCostQuestion(context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
      const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || ENROLLMENT_URL;

      // Kevin's exact "Safe Path" language (Sprint 3.1)
      const response = `${contextIntro}This is an age-rated product, which means the cost depends on your specific age bracket. I can't give you an exact quote here.\n\n**Your best bet is to log into your [benefits enrollment system](${enrollmentUrl})** to see your actual cost. It will show you the precise premium based on your age.\n\nWould you like to know more about what this coverage includes, or shall we look at other benefit options?`;

    return {
        content: response,
      responseType: 'benefits',
        confidence: 0.9,
      timestamp: new Date()
    };
  }

  private handleAllBenefitsQuestion(context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
    const eligible = this.getEligibleBenefits(context);
    const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || ENROLLMENT_URL;

    // Calculate total monthly cost for all core benefits (medical + dental + vision)
    const medicalPrimary = eligible.medical[0];
    const dentalPrimary = eligible.dental[0];
    const visionPrimary = eligible.vision[0];

    const medicalMonthly = medicalPrimary ? this.getEmployeeOnlyMonthly(medicalPrimary) : 0;
    const dentalMonthly = dentalPrimary ? this.getEmployeeOnlyMonthly(dentalPrimary) : 0;
    const visionMonthly = visionPrimary ? this.getEmployeeOnlyMonthly(visionPrimary) : 0;
    const totalMonthly = medicalMonthly + dentalMonthly + visionMonthly;
    const totalAnnual = totalMonthly * 12;
    const totalPerPaycheck = Math.round((totalAnnual / 24) * 100) / 100;

    let response = `${contextIntro}**Total Benefits Cost Summary**\n\n`;
    response += "Here's what you'd pay if you enrolled in **all core benefits** (medical + dental + vision):\n\n";
    response += "**Monthly Premium Breakdown:**\n";
    if (medicalPrimary) {
      response += `• ${medicalPrimary.name}: ${this.formatMonthlyYearly(medicalMonthly)}\n`;
    } else {
      response += "• Medical: No plans available for your eligibility\n";
    }
    if (dentalPrimary) {
      response += `• ${dentalPrimary.name}: ${this.formatMonthlyYearly(dentalMonthly)}\n`;
    }
    if (visionPrimary) {
      response += `• ${visionPrimary.name}: ${this.formatMonthlyYearly(visionMonthly)}\n`;
    }

    response += `\n**Total Cost:**\n`;
    response += `• **$${totalMonthly.toFixed(2)}/month** ($${totalAnnual.toLocaleString('en-US', { minimumFractionDigits: 2 })}/year)\n`;
    response += `• **$${totalPerPaycheck.toFixed(2)} per paycheck** (biweekly, 24 pay periods)\n\n`;

    response += `**Note:** This includes core medical, dental, and vision plans. Voluntary benefits (Critical Illness, Accident, Life Insurance, Disability) have separate premiums based on your age and coverage selections.\n\n`;

    response += `**Ready to enroll?** You can make your official selections here: [Benefits Enrollment Portal](${enrollmentUrl})\n\n`;

    response += `Would you like me to break down the costs for specific plans or explain what each covers?`;

    return {
      content: response,
      responseType: 'benefits',
      confidence: 0.95,
      timestamp: new Date()
    };
  }

  private handleCostProjectionQuestion(context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
    const enrollmentUrl = process.env.ENROLLMENT_PORTAL_URL || ENROLLMENT_URL;

    // Extract usage level from typical patterns
    const usageLevel = this.extractUsageLevel();
    const coverageTier = this.extractCoverageTier();
    const network = this.extractNetworkPreference();

    const projection = estimateCostProjection({
      coverageTier: coverageTier || 'Employee Only',
      usage: usageLevel,
      network: network ?? undefined,
      state: context?.state,
      age: undefined // Would need to extract from conversation metadata
    });

    let response = `${contextIntro}**Projected Healthcare Costs for Next Year**\n\n`;
    response += `Based on **${usageLevel} usage** assumptions`;
    if (network) {
      response += ` and **${network} network**`;
    }
    if (context?.state) {
      response += ` in **${context.state}**`;
    }
    response += `:\n\n`;
    response += projection;
    response += `\n\n**Note:** These are rough estimates. Actual costs depend on your specific healthcare needs and claims.\n\n`;
    response += `For personalized enrollment, visit: [Benefits Enrollment Portal](${enrollmentUrl})`;

    return {
      content: response,
      responseType: 'benefits',
      confidence: 0.85,
      timestamp: new Date()
    };
  }

  private extractUsageLevel(): 'low' | 'moderate' | 'high' {
    // Extract usage level from conversation context
    const message = this.getLastUserMessage();
    const messageLower = message.toLowerCase();
    
    if (messageLower.includes('high') || messageLower.includes('heavy') || messageLower.includes('frequent')) {
      return 'high';
    }
    if (messageLower.includes('low') || messageLower.includes('light') || messageLower.includes('minimal') || messageLower.includes('healthy')) {
      return 'low';
    }
    if (messageLower.includes('moderate') || messageLower.includes('average') || messageLower.includes('normal')) {
      return 'moderate';
    }
    
    // Infer from context clues
    if (messageLower.includes('surgery') || messageLower.includes('procedure') || messageLower.includes('chronic')) {
      return 'high';
    }
    if (messageLower.includes('checkup') || messageLower.includes('routine') || messageLower.includes('preventive')) {
      return 'low';
    }
    
    return 'moderate'; // Default
  }

  private extractCoverageTier(): string | null {
    const message = this.getLastUserMessage();
    const messageLower = message.toLowerCase();
    
    // Check for family size indicators
    const familyPatterns = [
      /family[0-9]*\+?/i,
      /employee\s*[\+&]\s*family/i,
      /spouse\s*[\+&]\s*children/i,
      /spouse\s*[\+&]\s*kids?/i,
    ];
    
    const spousePatterns = [
      /employee\s*[\+&]\s*spouse/i,
      /just\s*me\s*and\s*(my\s*)?spouse/i,
      /me\s*and\s*(my\s*)?spouse/i,
      /spouse\s*plan/i,
      /couple/i
    ];
    
    const childPatterns = [
      /employee\s*[\+&]\s*child/i,
      /single\s*parent/i,
      /just\s*me\s*and\s*(my\s*)?kids?/i,
      /just\s*me\s*and\s*(my\s*)?children/i
    ];

    // Most specific first (spouse/children), then broader family.
    if (spousePatterns.some(p => p.test(message))) {
      return 'Employee + Spouse';
    }
    if (childPatterns.some(p => p.test(message)) || messageLower.includes('dependents')) {
      return 'Employee + Child(ren)';
    }
    
    if (familyPatterns.some(p => p.test(message))) {
      // Try to extract number
      const numMatch = message.match(/family([0-9]+)/i);
      if (numMatch) {
        const num = parseInt(numMatch[1]);
        if (num >= 4) return 'Employee + Family';
        if (num >= 2) return 'Employee + Child(ren)';
      }
      return 'Employee + Family';
    }
    
    // Check for single/employee only
    if (messageLower.includes('single') || messageLower.includes('just me') || messageLower.includes('employee only')) {
      return 'Employee Only';
    }
    
    return null;
  }

  private extractNetworkPreference(): string | null {
    const message = this.getLastUserMessage();
    const messageLower = message.toLowerCase();
    
    if (messageLower.includes('kaiser')) {
      return 'Kaiser';
    }
    if (messageLower.includes('ppo')) {
      return 'PPO';
    }
    if (messageLower.includes('hmo')) {
      return 'HMO';
    }
    if (messageLower.includes('hsa') || messageLower.includes('hdhp')) {
      return 'HSA';
    }
    
    return null;
  }

  private getLastUserMessage(): string {
    // Try to get from conversation history if available
    if (this.conversationHistory && this.conversationHistory.length > 0) {
      // Find last user message
      for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
        if (this.conversationHistory[i].role === 'user') {
          return this.conversationHistory[i].content;
        }
      }
    }
    return '';
  }

  private handleMaternityQuestion(context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
    const coverageTier = context?.division ? 'Employee + Family' : 'Employee Only';
    
    const maternityComparison = compareMaternityCosts(coverageTier);

    let response = `${contextIntro}**Maternity Coverage Comparison**\n\n`;
    response += "Great question! Planning for a baby is exciting, and choosing the right plan can save you thousands.\n\n";
    response += maternityComparison;

    return {
      content: response,
      responseType: 'benefits',
      confidence: 0.9,
      timestamp: new Date()
    };
  }

  private handleOtherPlansQuestion(context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
      const userName = 'there';
    
      // Fix medical loop bug - show ancillary plans only (Sprint 1.2)
      let response = `${contextIntro}Great question! Beyond medical, dental, and vision, here are the **voluntary/ancillary benefits** you can add:\n\n`;
    
      response += `**Financial Protection:**\n• Critical Illness Insurance - Cash payout if diagnosed with cancer, heart attack, stroke, etc.\n• Accident Insurance - Covers injuries from accidents (fractures, burns, etc.)\n• Hospital Indemnity - Pays you cash for hospital stays\n\n**Income Protection:**\n• Life Insurance (Term Life) - Financial protection for your family\n• Short-Term Disability (STD) - Income replacement if you can't work\n• Long-Term Disability (LTD) - Extended income protection\n\n**Savings & Retirement:**\n• Health Savings Account (HSA) - Tax-free medical savings (if eligible)\n• 401(k) Retirement Plan - Build your retirement savings\n\n`;
    
      response += `Which of these interests you most? I can explain how any of these work and whether they're a good fit for your situation!`;

    return {
        content: response,
      responseType: 'benefits',
        confidence: 0.95,
      timestamp: new Date()
    };
  }

  private async handleDocumentAnalysis(message: string, attachments: any[], context?: ChatContext): Promise<ChatResponse> {
    try {
      const searchResults = await simpleRAGSystem.searchDocuments(message);

      let response = `**Document Analysis Complete**\n\n`;
      response += "I've received your document(s). Here's what I found:\n\n";
      response += '**Document Summary:**\n';
      response += `- ${attachments.length} file(s) uploaded\n`;
      response += '- Document type: Benefits information\n';
      response += '- Key topics: Health insurance, coverage details\n\n';

      if (searchResults.length > 0) {
      response += '**Relevant Information Found:**\n';
      response += searchResults
        .slice(0, 3)
        .map(
          (result, index) =>
              `${index + 1}. **${result.document.title}** (${(result.score * 100).toFixed(0)}% match)\n   ${result.matchedText
                .replace(/\s+/g, ' ')
                .substring(0, 150)}...`
          )
          .join('\n\n');
        response += '\n\n';
      }

      response += '**Next Steps:**\n';
      response += '- I can help you understand specific sections\n';
      response += '- Compare this with other plans\n';
      response += '- Calculate costs based on this information\n\n';
      response += 'What would you like to know about your benefits document?';

      return {
        content: this.appendFinalCTA(`${this.buildContextIntro(context)}${response}`),
        responseType: 'benefits',
        confidence: 0.7,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error in document analysis', { error, message });
      return this.getDefaultResponse(context);
    }
  }

  private getDefaultResponse(context?: ChatContext): ChatResponse {
    const response = `Hello! I'm your Virtual Benefits Assistant. I'm not the enrollment platform, but I can walk you through your benefits and help you understand what affects your coverage.\n\n- **Plan Information** - Learn about health, dental, and vision plans\n- **Cost Calculations** - Use the Medical Plan Cost Comparison Tool to compare monthly vs annual commitments\n- **Plan Comparisons** - See how one option stacks up against another\n- **Document Analysis** - Upload and analyze benefit documents\n\nTell me what you need help understanding.`;

    return {
      content: this.appendFinalCTA(response),
      responseType: 'simple',
      confidence: 0.8,
      timestamp: new Date()
    };
  }

  private buildMedicalResponse(base: string, message: string): string {
    const crossSell = this.getCrossSellSuggestion(message);
    let response = base;
    if (crossSell) {
      response += `\n\n${crossSell}`;
    }

    response += '\n\nDo you want my recommendation? Which one do you want?';
    response += `\n\n${SimpleChatRouter.MEDICAL_TRANSITION}`;

    return this.appendFinalCTA(response);
  }

  private buildContextIntro(context?: ChatContext): string {
    if (!context) {
      return '';
    }

    const parts: string[] = [];
    if (context.state) {
      parts.push(`state: ${context.state}`);
    }
    if (context.division) {
      parts.push(`division: ${context.division}`);
    }

    if (!parts.length) {
      return '';
    }

    return `Based on ${parts.join(' and ')}, here's how the options stack up for you:\n\n`;
  }

  private appendFinalCTA(base: string): string {
    const link =
      process.env.ENROLLMENT_PORTAL_URL ||
      process.env.NEXT_PUBLIC_ENROLLMENT_URL ||
      process.env.ENROLLMENT_URL ||
      ENROLLMENT_URL;
    return `${base}\n\nReady to make your official selections? Enroll here: ${link}`;
  }

  private getCrossSellSuggestion(message: string): string | null {
    const triggers = ['hsa', 'hdhp', 'high deductible', 'health savings'];
    const normalized = message.toLowerCase();
    if (!triggers.some(trigger => normalized.includes(trigger))) {
      return null;
    }

    return 'Since you are reviewing HSA/HDHP medical options, consider Accident, Critical Illness, and Hospital Indemnity. They pay cash, offset the high deductible, and are commonly paired with HSA plans.';
  }

  private formatMonthlyYearly(monthly: number): string {
    const monthlyRounded = Math.round(monthly * 100) / 100;
    const annualRounded = Math.round(monthly * 12 * 100) / 100;
    const monthlyFormatted = monthlyRounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const annualFormatted = annualRounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `$${monthlyFormatted}/month ($${annualFormatted}/year)`;
  }

  private formatCurrency(value: number): string {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private getEligibleBenefits(context?: ChatContext): {
    medical: BenefitPlan[];
    dental: BenefitPlan[];
    vision: BenefitPlan[];
    ancillary: BenefitPlan[];
  } {
    const region = (context?.state || 'nationwide').trim();
    const division = context?.division?.trim().toLowerCase();
    const divisionAllowList = division ? SimpleChatRouter.DIVISION_PLAN_MAP[division] : undefined;
    const plans = getPlansByRegion(region).filter(plan => {
      if (!divisionAllowList) return true;
      return divisionAllowList.includes(plan.id);
    });

    const medical = plans.filter(plan => plan.type === 'medical');
    const dental = plans.filter(plan => plan.type === 'dental');
    const vision = plans.filter(plan => plan.type === 'vision');
    const ancillary = plans.filter(plan => plan.type === 'voluntary');

    return { medical, dental, vision, ancillary };
  }

  private getEmployeeOnlyMonthly(plan: BenefitPlan): number {
    return plan.tiers.employeeOnly ?? 0;
  }
}

// Export singleton instance
export const simpleChatRouter = new SimpleChatRouter();
