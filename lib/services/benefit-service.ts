import { logger } from '@/lib/logger';
import { getClient } from '@/lib/azure/cosmos';
import { BenefitPlan, BenefitEnrollment } from '@/lib/schemas/benefits';

const isBuild = () => process.env.NEXT_PHASE === 'phase-production-build';

class BenefitService {
  private plansContainer: any = null;
  private enrollmentsContainer: any = null;

  private async ensureInitialized() {
    if (isBuild()) return;
    if (this.plansContainer && this.enrollmentsContainer) return;
    
    const client = await getClient();
    if (!client) return;
    
    this.plansContainer = client.database('BenefitsDB').container('benefit_plans');
    this.enrollmentsContainer = client.database('BenefitsDB').container('benefit_enrollments');
  }

  async getBenefitPlans(companyId: string): Promise<BenefitPlan[]> {
    await this.ensureInitialized();
    try {
      const query = 'SELECT * FROM c WHERE c.companyId = @companyId AND c.isActive = true';
      const { resources } = await this.plansContainer.items.query({
        query,
        parameters: [{ name: '@companyId', value: companyId }]
      }).fetchAll();

      return resources;
    } catch (error) {
      logger.error({ error, companyId }, 'Error fetching benefit plans');
      return [];
    }
  }

  async getTotalBenefitPlansCount(): Promise<number> {
    await this.ensureInitialized();
    try {
      const query = 'SELECT VALUE COUNT(1) FROM c WHERE c.isActive = true';
      const { resources } = await this.plansContainer.items.query({
        query,
        parameters: []
      }).fetchAll();

      return resources[0] || 0;
    } catch (error) {
      logger.error({ error }, 'Error fetching total benefit plans count');
      return 0;
    }
  }

  async getBenefitPlan(planId: string): Promise<BenefitPlan | null> {
    await this.ensureInitialized();
    try {
      const { resource } = await this.plansContainer.item(planId).read();
      return resource || null;
    } catch (error) {
      if ((error as any).code === 404) {
        return null;
      }
      logger.error({ error, planId }, 'Error fetching benefit plan');
      throw error;
    }
  }

  async createBenefitPlan(plan: Omit<BenefitPlan, 'id'>): Promise<BenefitPlan> {
    await this.ensureInitialized();
    try {
      const newPlan: BenefitPlan = {
        ...plan,
        id: crypto.randomUUID()
      };

      const { resource } = await this.plansContainer.items.create(newPlan);
      return resource!;
    } catch (error) {
      logger.error({ error, plan }, 'Error creating benefit plan');
      throw error;
    }
  }

  async updateBenefitPlan(planId: string, updates: Partial<BenefitPlan>): Promise<BenefitPlan> {
    await this.ensureInitialized();
    try {
      const existingPlan = await this.getBenefitPlan(planId);
      if (!existingPlan) {
        throw new Error('Benefit plan not found');
      }

      const updatedPlan: BenefitPlan = {
        ...existingPlan,
        ...updates
      };

      const { resource } = await this.plansContainer.item(planId).replace(updatedPlan);
      return resource!;
    } catch (error) {
      logger.error({ error, planId, updates }, 'Error updating benefit plan');
      throw error;
    }
  }

  async deleteBenefitPlan(planId: string): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.plansContainer.item(planId).delete();
    } catch (error) {
      logger.error({ error, planId }, 'Error deleting benefit plan');
      throw error;
    }
  }

  async enrollInBenefit(enrollment: BenefitEnrollment): Promise<string> {
    await this.ensureInitialized();
    try {
      const enrollmentRecord = {
        id: crypto.randomUUID(),
        ...enrollment,
        enrolledAt: new Date().toISOString(),
        status: 'active'
      };

      await this.enrollmentsContainer.items.create(enrollmentRecord);
      logger.info({ enrollmentId: enrollmentRecord.id, planId: enrollment.planId }, 'Benefit enrollment created');
      return enrollmentRecord.id;
    } catch (error) {
      logger.error({ error, enrollment }, 'Error enrolling in benefit');
      throw error;
    }
  }

  async getEmployeeEnrollments(employeeId: string): Promise<any[]> {
    await this.ensureInitialized();
    try {
      const query = 'SELECT * FROM c WHERE c.employeeId = @employeeId';
      const { resources } = await this.enrollmentsContainer.items.query({
        query,
        parameters: [{ name: '@employeeId', value: employeeId }]
      }).fetchAll();

      return resources;
    } catch (error) {
      logger.error({ error, employeeId }, 'Error fetching employee enrollments');
      return [];
    }
  }

  async cancelEnrollment(employeeId: string, enrollmentId: string): Promise<void> {
    await this.ensureInitialized();
    try {
      const query = 'SELECT * FROM c WHERE c.id = @enrollmentId AND c.employeeId = @employeeId';
      const { resources } = await this.enrollmentsContainer.items.query({
        query,
        parameters: [
          { name: '@enrollmentId', value: enrollmentId },
          { name: '@employeeId', value: employeeId }
        ]
      }).fetchAll();

      if (resources.length === 0) {
        throw new Error('Enrollment not found or access denied');
      }

      const enrollment = resources[0];
      await this.enrollmentsContainer.item(enrollmentId, enrollment.employeeId).delete();
      
      logger.info({ enrollmentId, employeeId }, 'Benefit enrollment cancelled');
    } catch (error) {
      logger.error({ error, enrollmentId, employeeId }, 'Error cancelling enrollment');
      throw error;
    }
  }

  async compareBenefitPlans(planIds: string[], criteria: string[]): Promise<any> {
    await this.ensureInitialized();
    try {
      const plans = await Promise.all(planIds.map(id => this.getBenefitPlan(id)));
      const validPlans = plans.filter(plan => plan !== null) as BenefitPlan[];

      if (validPlans.length === 0) {
        return {
          plans: [],
          comparison: {},
          summary: 'No valid plans found for comparison'
        };
      }

      // Implement comprehensive comparison logic based on criteria
      const comparison: any = {};
      
      // Cost comparison
      if (criteria.includes('cost') || criteria.length === 0) {
        comparison.cost = {
          monthly: validPlans.map(plan => ({
            id: plan.id,
            name: plan.name,
            monthlyCost: plan.monthlyCost ?? plan.monthlyPremium ?? 0,
            annualCost: (plan.monthlyCost ?? plan.monthlyPremium ?? 0) * 12,
            costPerEmployee: plan.monthlyCost ?? plan.monthlyPremium ?? 0
          })),
          summary: this.generateCostSummary(validPlans)
        };
      }

      // Coverage comparison
      if (criteria.includes('coverage') || criteria.length === 0) {
        comparison.coverage = {
          medical: validPlans.map(plan => ({
            id: plan.id,
            name: plan.name,
            coveragePercentage: plan.coveragePercentage ?? 0,
            deductible: plan.deductible ?? plan.annualDeductible ?? 0,
            outOfPocketMax: plan.outOfPocketMax ?? 0
          })),
          summary: this.generateCoverageSummary(validPlans)
        };
      }

      // Benefits comparison
      if (criteria.includes('benefits') || criteria.length === 0) {
        comparison.benefits = {
          included: validPlans.map(plan => ({
            id: plan.id,
            name: plan.name,
            benefits: plan.benefits ?? [],
            features: plan.features || []
          })),
          summary: this.generateBenefitsSummary(validPlans)
        };
      }

      // Network comparison
      if (criteria.includes('network') || criteria.length === 0) {
        comparison.network = {
          providers: validPlans.map(plan => ({
            id: plan.id,
            name: plan.name,
            networkSize: plan.networkSize ?? 'Standard',
            providerCount: plan.providerCount ?? 0
          })),
          summary: this.generateNetworkSummary(validPlans)
        };
      }

      // Overall recommendation
      const recommendation = this.generateRecommendation(validPlans, criteria);

      return {
        plans: validPlans,
        comparison,
        recommendation,
        criteria: criteria.length > 0 ? criteria : ['cost', 'coverage', 'benefits', 'network']
      };
    } catch (error) {
      logger.error({ error, planIds, criteria }, 'Error comparing benefit plans');
      throw error;
    }
  }

  private generateCostSummary(plans: BenefitPlan[]): string {
    const costs = plans.map(p => p.monthlyCost ?? p.monthlyPremium ?? 0);
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const avgCost = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
    
    const cheapestPlan = plans.find(p => (p.monthlyCost ?? p.monthlyPremium ?? 0) === minCost);
    const mostExpensivePlan = plans.find(p => (p.monthlyCost ?? p.monthlyPremium ?? 0) === maxCost);
    
    return `Cost ranges from $${minCost}/month (${cheapestPlan?.name}) to $${maxCost}/month (${mostExpensivePlan?.name}), with an average of $${avgCost.toFixed(2)}/month.`;
  }

  private generateCoverageSummary(plans: BenefitPlan[]): string {
    const coverages = plans.map(p => p.coveragePercentage ?? 0);
    const minCoverage = Math.min(...coverages);
    const maxCoverage = Math.max(...coverages);
    
    const bestCoveragePlan = plans.find(p => p.coveragePercentage === maxCoverage);
    
    return `Coverage ranges from ${minCoverage}% to ${maxCoverage}% (${bestCoveragePlan?.name}). Higher coverage typically means lower out-of-pocket costs.`;
  }

  private generateBenefitsSummary(plans: BenefitPlan[]): string {
    const allBenefits = new Set();
    plans.forEach(plan => {
      if (plan.benefits) {
        plan.benefits.forEach(benefit => allBenefits.add(benefit));
      }
    });
    
    const commonBenefits = Array.from(allBenefits).filter(benefit => 
      plans.every(plan => plan.benefits?.includes(benefit as string))
    );
    
    return `All plans include: ${commonBenefits.join(', ')}. ${plans.length} unique benefit combinations available.`;
  }

  private generateNetworkSummary(plans: BenefitPlan[]): string {
    const networks = plans.map(p => p.networkSize || 'Standard');
    const uniqueNetworks = [...new Set(networks)];
    
    return `Network options include: ${uniqueNetworks.join(', ')}. Consider provider availability in your area.`;
  }

  private generateRecommendation(plans: BenefitPlan[], criteria: string[]): any {
    if (plans.length === 1) {
      return {
        type: 'single_option',
        message: 'Only one plan available for comparison.',
        recommendedPlan: plans[0].id
      };
    }

    // Score plans based on criteria
    const scoredPlans = plans.map(plan => {
      let score = 0;
      const factors = [];

      if (criteria.includes('cost') || criteria.length === 0) {
        // Lower cost = higher score
        const costs = plans.map(p => p.monthlyCost ?? 0);
        const maxCost = costs.length ? Math.max(...costs) : 0;
        const planCost = plan.monthlyCost ?? 0;
        const costScore = maxCost > 0 ? ((maxCost - planCost) / maxCost) * 100 : 0;
        score += costScore * 0.3;
        factors.push(`Cost: ${costScore.toFixed(1)}/100`);
      }

      if (criteria.includes('coverage') || criteria.length === 0) {
        // Higher coverage = higher score
        const coverageScore = plan.coveragePercentage || 0;
        score += coverageScore * 0.4;
        factors.push(`Coverage: ${coverageScore}%`);
      }

      if (criteria.includes('benefits') || criteria.length === 0) {
        // More benefits = higher score
        const benefitCount = plan.benefits?.length || 0;
        const maxBenefits = Math.max(...plans.map(p => p.benefits?.length || 0));
        const benefitScore = maxBenefits > 0 ? (benefitCount / maxBenefits) * 100 : 0;
        score += benefitScore * 0.2;
        factors.push(`Benefits: ${benefitScore.toFixed(1)}/100`);
      }

      if (criteria.includes('network') || criteria.length === 0) {
        // Larger network = higher score
        const networkScore = (plan.networkSize || 0) >= 1000 ? 100 : ((plan.networkSize || 0) >= 500 ? 70 : 50);
        score += networkScore * 0.1;
        factors.push(`Network: ${networkScore}/100`);
      }

      return {
        plan,
        score: Math.round(score),
        factors
      };
    });

    // Sort by score (highest first)
    scoredPlans.sort((a, b) => b.score - a.score);
    
    const bestPlan = scoredPlans[0];
    const secondBest = scoredPlans[1];

    return {
      type: 'comparison',
      recommendedPlan: bestPlan.plan.id,
      score: bestPlan.score,
      factors: bestPlan.factors,
      message: `Based on your criteria, ${bestPlan.plan.name} scores highest (${bestPlan.score}/100). ${secondBest ? `Alternative: ${secondBest.plan.name} (${secondBest.score}/100).` : ''}`,
      allScores: scoredPlans.map(sp => ({
        planId: sp.plan.id,
        planName: sp.plan.name,
        score: sp.score,
        factors: sp.factors
      }))
    };
  }
}

export const benefitService = new BenefitService();
