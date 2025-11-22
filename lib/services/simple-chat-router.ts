/**
 * Simple Chat Router - Streamlined for MVP
 * Handles basic chat functionality without complex ML dependencies
 */

import { logger } from '@/lib/logger';
import { simpleRAGSystem } from '@/lib/ai/simple-rag';
import type { BenefitPlan } from '@/lib/data/amerivet';
import { getPlansByRegion } from '@/lib/data/amerivet-benefits';

type ChatContext = {
  state?: string;
  division?: string;
};

interface ChatResponse {
  content: string;
  responseType: 'simple' | 'benefits' | 'error';
  confidence: number;
  timestamp: Date;
}

const ENROLLMENT_URL = 'https://amerivetaibot.bcgenrolls.com/subdomain/login';

export class SimpleChatRouter {
  private static readonly MEDICAL_TRANSITION =
    "Now that we've covered medical, do you want to look at Dental, Vision, or other plans?";
  private static readonly DIVISION_PLAN_MAP: Record<string, string[]> = {
    operations: ['bcbstx-standard-hsa', 'bcbstx-enhanced-hsa', 'bcbstx-dental', 'vsp-vision-plus', 'unum-basic-life'],
    corporate: ['bcbstx-enhanced-hsa', 'kaiser-standard-hmo', 'bcbstx-dental', 'vsp-vision-plus', 'unum-basic-life'],
    retail: ['kaiser-standard-hmo', 'bcbstx-standard-hsa', 'bcbstx-dental', 'vsp-vision-plus', 'unum-basic-life']
  };

  constructor() {}

  async routeMessage(message: string, context?: ChatContext, attachments?: any[]): Promise<ChatResponse> {
    try {
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
    const response = `${contextIntro}Critical Illness, Life, and both Short-Term and Long-Term Disability products are age-rated. I can't quote or estimate exact costs because they depend on your age bracket. Please check the enrollment platform for the precise premium tied to your profile.`;

    return {
      content: this.appendFinalCTA(response),
      responseType: 'benefits',
      confidence: 0.75,
      timestamp: new Date()
    };
  }

  private handleOtherPlansQuestion(context?: ChatContext): ChatResponse {
    const contextIntro = this.buildContextIntro(context);
    const eligible = this.getEligibleBenefits(context);
    let response = `${contextIntro}Here's our Ancillary Coverage Menu (no medical plans are listed here):\n\n`;

    const categories = new Set<string>();
    eligible.ancillary.forEach(plan => {
      if (plan.voluntaryType) {
        categories.add(plan.voluntaryType);
      } else {
        categories.add(plan.name);
      }
    });

    if (categories.size === 0) {
      response += '- No ancillary plans found for your eligibility.\n';
    } else {
      categories.forEach(option => {
        response += `- ${option}\n`;
      });
    }

    response += '\nWhich of these would you like to explore next?';
    response += '\nLet me know if you want a recommendation for any of these categories.';

    return {
      content: this.appendFinalCTA(response),
      responseType: 'benefits',
      confidence: 0.85,
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
    const link = process.env.ENROLLMENT_URL || ENROLLMENT_URL;
    return `${base}\n\nReady to make your official selections? [**Log in to Enroll Here**](${link})`;
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
    const monthlyFormatted = this.formatCurrency(monthly);
    const annualFormatted = this.formatCurrency(monthly * 12);
    return `$${monthlyFormatted}/month ($${annualFormatted}/year)`;
  }

  private formatCurrency(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
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
