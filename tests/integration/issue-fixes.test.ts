/**
 * Integration Tests for All 7 Issue Fixes
 * End-to-end tests verifying the fixes work correctly
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('7 Issue Fixes - Integration Tests', () => {
  
  describe('Issue #1: Inconsistent Premium Figures', () => {
    it('should format premiums consistently with 2 decimal places', async () => {
      const { simpleChatRouter } = await import('../../lib/services/simple-chat-router');
      
      const response = await (simpleChatRouter as any).handleCostQuestion({
        state: 'Texas',
        division: 'Operations'
      });
      
      // Check for consistent format: $X.XX/month ($Y.YY/year)
      const premiumRegex = /\$[\d,]+\.\d{2}\/month \(\$[\d,]+\.\d{2}\/year\)/g;
      const matches = response.content.match(premiumRegex);
      
      expect(matches).toBeTruthy();
      expect(matches!.length).toBeGreaterThan(0);
      
      // Verify no inconsistent formats
      const inconsistentFormat1 = /\$[\d,]+\/month \(\$[\d,]+\/year\)/; // No decimals
      const inconsistentFormat2 = /\$[\d,]+\.\d{1}\/month/; // Only 1 decimal
      expect(response.content).not.toMatch(inconsistentFormat1);
      expect(response.content).not.toMatch(inconsistentFormat2);
    });
  });

  describe('Issue #2: Wrong Benefit Category', () => {
    it('should filter chunks by medical category', async () => {
      const { filterChunksByCategory } = await import('../../lib/rag/hybrid-retrieval');
      
      // Mock chunks with mixed categories
      const mockChunks = [
        {
          id: '0',
          docId: 'doc0',
          companyId: 'test',
          sectionPath: '',
          content: 'Health plan summary: in-network deductible and coinsurance details',
          title: 'Medical Plan Summary',
          position: 0,
          windowStart: 0,
          windowEnd: 100,
          metadata: { category: 'Medical' },
          createdAt: new Date(),
          score: 0.95
        },
        {
          id: '1',
          docId: 'doc1',
          companyId: 'test',
          sectionPath: '',
          content: 'Medical plan with PPO network and deductible',
          title: 'Medical Benefits',
          position: 0,
          windowStart: 0,
          windowEnd: 100,
          metadata: { category: 'Medical' },
          createdAt: new Date(),
          score: 0.9
        },
        {
          id: '1b',
          docId: 'doc1b',
          companyId: 'test',
          sectionPath: '',
          content: 'PPO network coverage with copay and deductible information',
          title: 'Medical Network Details',
          position: 0,
          windowStart: 0,
          windowEnd: 100,
          metadata: { category: 'Medical' },
          createdAt: new Date(),
          score: 0.85
        },
        {
          id: '2',
          docId: 'doc2',
          companyId: 'test',
          sectionPath: '',
          content: 'Dental coverage including orthodontics and braces',
          title: 'Dental Benefits',
          position: 0,
          windowStart: 0,
          windowEnd: 100,
          metadata: { category: 'Dental' },
          createdAt: new Date(),
          score: 0.8
        },
        {
          id: '3',
          docId: 'doc3',
          companyId: 'test',
          sectionPath: '',
          content: 'Life insurance beneficiary and death benefit',
          title: 'Life Insurance',
          position: 0,
          windowStart: 0,
          windowEnd: 100,
          metadata: { category: 'Life' },
          createdAt: new Date(),
          score: 0.7
        }
      ];
      
      const filtered = filterChunksByCategory(mockChunks, 'Medical');
      
      // Should keep only medical-related chunks
      expect(filtered.length).toBeLessThanOrEqual(mockChunks.length);
      filtered.forEach(chunk => {
        const content = (chunk.content + ' ' + chunk.title).toLowerCase();
        const isMedicalRelated = 
          content.includes('medical') || 
          content.includes('ppo') || 
          content.includes('deductible');
        expect(isMedicalRelated).toBe(true);
      });
    });
  });

  describe('Issue #3: Total Deduction Calculation', () => {
    it('should calculate total cost for all benefits', async () => {
      const { simpleChatRouter } = await import('../../lib/services/simple-chat-router');
      
      const response = await (simpleChatRouter as any).handleAllBenefitsQuestion({
        state: 'Texas',
        division: 'Operations'
      });
      
      expect(response.content).toContain('Total Benefits Cost Summary');
      expect(response.content).toMatch(/\$[\d,]+\.?\d*\/month/);
      expect(response.content).toMatch(/\$[\d,]+\.?\d*\/year/);
      expect(response.content).toMatch(/\$[\d,]+\.?\d* per paycheck/);
      
      // Should mention all core benefits
      expect(response.content).toMatch(/medical/i);
      expect(response.content).toMatch(/dental/i);
      expect(response.content).toMatch(/vision/i);
    });
  });

  describe('Issue #4: Advanced Cost Modeling', () => {
    it('should provide cost projection for usage scenarios', async () => {
      const { simpleChatRouter } = await import('../../lib/services/simple-chat-router');
      
      const response = await (simpleChatRouter as any).handleCostProjectionQuestion({
        state: 'California',
        division: 'Corporate'
      });
      
      expect(response.content).toContain('Projected Healthcare Costs');
      expect(response.content).toMatch(/low|moderate|high/);
      expect(response.content).toContain('usage');
    });

    it('should estimate costs for different usage levels', async () => {
      const { estimateCostProjection } = await import('../../lib/rag/pricing-utils');
      
      const lowUsage = estimateCostProjection({
        coverageTier: 'Employee Only',
        usage: 'low'
      });
      
      const highUsage = estimateCostProjection({
        coverageTier: 'Employee Only',
        usage: 'high'
      });
      
      expect(lowUsage).toContain('low');
      expect(highUsage).toContain('high');
    });
  });

  describe('Issue #5: Maternity Recommendation', () => {
    it('should provide detailed maternity cost comparison', async () => {
      const { simpleChatRouter } = await import('../../lib/services/simple-chat-router');
      
      const response = await (simpleChatRouter as any).handleMaternityQuestion({
        state: 'Texas',
        division: 'Operations'
      });
      
      expect(response.content).toContain('Maternity Coverage Comparison');
      expect(response.content).toContain('out-of-pocket');
      expect(response.content).toContain('deductible');
      expect(response.content).toContain('coinsurance');
      expect(response.content).toContain('premium');
      expect(response.content).toMatch(/\$[\d,]+/);
    });

    it('should include plan-specific maternity details', async () => {
      const { compareMaternityCosts } = await import('../../lib/rag/pricing-utils');
      
      const comparison = compareMaternityCosts('Employee + Family');
      
      expect(comparison).toContain('Standard HSA');
      expect(comparison).toContain('Enhanced HSA');
      expect(comparison).toContain('Kaiser Standard HMO');
      expect(comparison.toLowerCase()).toContain('prenatal');
      expect(comparison.toLowerCase()).toContain('postnatal');
    });
  });

  describe('Issue #6: Geographic Inconsistency', () => {
    it('should enforce state consistency in responses', async () => {
      const { ensureStateConsistency } = await import('../../lib/rag/pricing-utils');
      
      const response = ensureStateConsistency(
        'In Indiana, the plan costs $100. Indiana has many options. Indiana is great.',
        'TX'
      );
      
      // Should replace Indiana mentions with Texas
      expect(response).not.toContain('Indiana');
      expect(response).toContain('Texas');
    });

    it('should clean repeated phrases', async () => {
      const { cleanRepeatedPhrases } = await import('../../lib/rag/pricing-utils');
      
      const cleaned = cleanRepeatedPhrases('The plan is great, great, and great for you');
      
      expect(cleaned).not.toContain('great, great');
      expect(cleaned).toContain('great');
    });
  });

  describe('Issue #7: Orthodontics Inconsistency', () => {
    it('should validate chunk presence for orthodontics claims', async () => {
      const { validateChunkPresenceForClaims } = await import('../../lib/rag/validation-pipeline');
      
      // Answer mentions orthodontics but chunks don't
      const answer = 'Yes, the plan covers orthodontics with $1500 lifetime maximum.';
      const chunks = [
        {
          id: '1',
          docId: 'doc1',
          companyId: 'test',
          sectionPath: '',
          content: 'Medical plan with PPO network',
          title: 'Medical Benefits',
          position: 0,
          windowStart: 0,
          windowEnd: 100,
          metadata: {},
          createdAt: new Date(),
          score: 0.9
        }
      ];
      
      const result = validateChunkPresenceForClaims(answer, chunks);
      
      expect(result.valid).toBe(false);
      expect(result.ungroundedClaims).toContain('orthodontics');
      expect(result.sanitizedAnswer).not.toContain('orthodontics');
    });

    it('should pass validation when chunks support the claim', async () => {
      const { validateChunkPresenceForClaims } = await import('../../lib/rag/validation-pipeline');
      
      const answer = 'Yes, the plan covers orthodontics.';
      const chunks = [
        {
          id: '1',
          docId: 'doc1',
          companyId: 'test',
          sectionPath: '',
          content: 'Dental plan includes orthodontics coverage with braces',
          title: 'Dental Benefits',
          position: 0,
          windowStart: 0,
          windowEnd: 100,
          metadata: {},
          createdAt: new Date(),
          score: 0.9
        }
      ];
      
      const result = validateChunkPresenceForClaims(answer, chunks);
      
      expect(result.valid).toBe(true);
      expect(result.ungroundedClaims.length).toBe(0);
    });
  });

  describe('End-to-End Scenarios', () => {
    it('should handle complete user journey', async () => {
      const { simpleChatRouter } = await import('../../lib/services/simple-chat-router');
      
      // Scenario 1: User asks about all benefits cost
      const allBenefitsResponse = await (simpleChatRouter as any).handleAllBenefitsQuestion({
        state: 'Texas',
        division: 'Operations',
        history: []
      });
      expect(allBenefitsResponse.content).toContain('Total Benefits Cost Summary');
      
      // Scenario 2: User asks about maternity
      const maternityResponse = await (simpleChatRouter as any).handleMaternityQuestion({
        state: 'Texas',
        division: 'Operations',
        history: [{ role: 'user', content: 'I am planning to have a baby' }]
      });
      expect(maternityResponse.content).toContain('Maternity');
      
      // Scenario 3: User asks about cost projection
      const projectionResponse = await (simpleChatRouter as any).handleCostProjectionQuestion({
        state: 'California',
        division: 'Corporate',
        history: [{ role: 'user', content: 'Family4+ moderate usage next year' }]
      });
      expect(projectionResponse.content).toContain('Projected');
    });
  });
});
