/**
 * Unit Tests for Simple Chat Router Enhancements
 * Tests for Issues #3, #4, #5 fixes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SimpleChatRouter } from '../../lib/services/simple-chat-router';
import {
  createAmerivetBenefitsPackage,
  getAmerivetBenefitsPackage,
} from '../../lib/data/amerivet-package';

describe('SimpleChatRouter - Enhanced Handlers', () => {
  let router: SimpleChatRouter;

  function makeFixturePackage() {
    const current = getAmerivetBenefitsPackage();

    return createAmerivetBenefitsPackage({
      ...current,
      packageId: 'amerivet-simple-router-fixture',
      catalog: {
        ...current.catalog,
        dentalPlan: {
          ...current.catalog.dentalPlan,
          name: 'AmeriVet Dental Core',
        },
        visionPlan: {
          ...current.catalog.visionPlan,
          name: 'AmeriVet Vision Core',
        },
      },
    });
  }

  beforeEach(() => {
    router = new SimpleChatRouter();
  });

  describe('Issue #3: All Benefits Question Handler', () => {
    it('should detect "all benefits" question', () => {
      const testCases = [
        'I want to enroll in all benefits',
        'How much for everything?',
        'Total cost per paycheck for all plans',
        'Combined cost for all benefits',
        'I want all the benefits'
      ];

      testCases.forEach(testCase => {
        const result = (router as any).isAllBenefitsQuestion(testCase.toLowerCase());
        expect(result).toBe(true);
      });
    });

    it('should handle all benefits question with context', async () => {
      const context = {
        state: 'Texas',
        division: 'Operations'
      };

      const response = await (router as any).handleAllBenefitsQuestion(context);
      
      expect(response.content).toContain('Total Benefits Cost Summary');
      expect(response.content).toContain('medical');
      expect(response.content).toContain('dental');
      expect(response.content).toContain('vision');
      expect(response.content).toMatch(/\$[\d,]+\.?\d*\/month/);
      expect(response.content).toMatch(/\$[\d,]+\.?\d*\/year/);
      expect(response.content).toContain('per paycheck');
    });

    it('uses an injected package fixture instead of the default package names', async () => {
      const routerWithFixture = new SimpleChatRouter(makeFixturePackage());
      const response = await (routerWithFixture as any).handleBenefitsQuestion('show me benefits', {
        state: 'CA',
      });

      expect(response.content).toContain('AmeriVet Dental Core');
      expect(response.content).toContain('AmeriVet Vision Core');
    });
  });

  describe('Issue #4: Cost Projection Question Handler', () => {
    it('should detect cost projection question', () => {
      const testCases = [
        'Help me calculate healthcare costs for next year',
        'What are my projected costs?',
        'Estimate costs for moderate usage',
        'Family4+ moderate usage Kaiser network',
        'High usage healthcare estimate'
      ];

      testCases.forEach(testCase => {
        const result = (router as any).isCostProjectionQuestion(testCase.toLowerCase());
        expect(result).toBe(true);
      });
    });

    it('should handle cost projection question', async () => {
      const context = {
        state: 'California',
        division: 'Corporate'
      };

      const response = await (router as any).handleCostProjectionQuestion(context);
      
      expect(response.content).toContain('Projected Healthcare Costs');
      expect(response.content).toContain('usage');
      expect(response.content).toMatch(/low|moderate|high/);
    });

    it('should extract usage level from context', () => {
      // Set up history with usage mention
      (router as any).conversationHistory = [
        { role: 'user', content: 'I have high healthcare usage with frequent doctor visits' }
      ];

      const usageLevel = (router as any).extractUsageLevel();
      expect(usageLevel).toBe('high');
    });

    it('should extract coverage tier from context', () => {
      const testCases = [
        { message: 'I need family4+ coverage', expected: 'Employee + Family' },
        { message: 'Employee + spouse plan', expected: 'Employee + Spouse' },
        { message: 'Just me and my kids', expected: 'Employee + Child(ren)' },
        { message: 'Single, just me', expected: 'Employee Only' }
      ];

      testCases.forEach(({ message, expected }) => {
        (router as any).conversationHistory = [
          { role: 'user', content: message }
        ];

        const tier = (router as any).extractCoverageTier();
        expect(tier).toBe(expected);
      });
    });

    it('should extract network preference from context', () => {
      const testCases = [
        { message: 'I prefer Kaiser network', expected: 'Kaiser' },
        { message: 'Looking for PPO plans', expected: 'PPO' },
        { message: 'HMO options available?', expected: 'HMO' },
        { message: 'HSA high deductible plan', expected: 'HSA' }
      ];

      testCases.forEach(({ message, expected }) => {
        (router as any).conversationHistory = [
          { role: 'user', content: message }
        ];

        const network = (router as any).extractNetworkPreference();
        expect(network).toBe(expected);
      });
    });
  });

  describe('Issue #5: Maternity Question Handler', () => {
    it('should detect maternity question', () => {
      const testCases = [
        'I am planning to have a baby',
        'Which plan covers pregnancy?',
        'Maternity coverage comparison',
        'Prenatal care benefits',
        'What about OB-GYN coverage?'
      ];

      testCases.forEach(testCase => {
        const result = (router as any).isMaternityQuestion(testCase.toLowerCase());
        expect(result).toBe(true);
      });
    });

    it('should handle maternity question with detailed comparison', async () => {
      const context = {
        state: 'Texas',
        division: 'Operations'
      };

      const response = await (router as any).handleMaternityQuestion(context);
      
      expect(response.content).toContain('Maternity Coverage Comparison');
      expect(response.content).toContain('plan');
      expect(response.content).toContain('out-of-pocket');
      expect(response.content).toContain('deductible');
      expect(response.content).toContain('premium');
    });
  });

  describe('Context Extraction Utilities', () => {
    describe('extractUsageLevel', () => {
      it('should detect high usage from explicit mentions', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'I have high healthcare usage' }
        ];
        expect((router as any).extractUsageLevel()).toBe('high');
      });

      it('should detect low usage from explicit mentions', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'I need minimal coverage, very healthy' }
        ];
        expect((router as any).extractUsageLevel()).toBe('low');
      });

      it('should detect moderate usage as default', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: "I'm not sure what my usage will be" }
        ];
        expect((router as any).extractUsageLevel()).toBe('moderate');
      });

      it('should infer high usage from context clues', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'I need surgery next month' }
        ];
        expect((router as any).extractUsageLevel()).toBe('high');
      });

      it('should infer low usage from preventive care mentions', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'Just routine checkups and preventive care' }
        ];
        expect((router as any).extractUsageLevel()).toBe('low');
      });
    });

    describe('extractCoverageTier', () => {
      it('should detect employee only', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'I am single, just need employee only coverage' }
        ];
        expect((router as any).extractCoverageTier()).toBe('Employee Only');
      });

      it('should detect employee + spouse', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'I need coverage for me and my spouse' }
        ];
        expect((router as any).extractCoverageTier()).toBe('Employee + Spouse');
      });

      it('should detect employee + children', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'Just me and my kids need coverage' }
        ];
        expect((router as any).extractCoverageTier()).toBe('Employee + Child(ren)');
      });

      it('should detect employee + family', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'Family4+ coverage please' }
        ];
        expect((router as any).extractCoverageTier()).toBe('Employee + Family');
      });
    });

    describe('extractNetworkPreference', () => {
      it('should detect Kaiser preference', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'I prefer Kaiser network' }
        ];
        expect((router as any).extractNetworkPreference()).toBe('Kaiser');
      });

      it('should detect PPO preference', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'Looking for PPO options' }
        ];
        expect((router as any).extractNetworkPreference()).toBe('PPO');
      });

      it('should detect HSA preference', () => {
        (router as any).conversationHistory = [
          { role: 'user', content: 'HSA high deductible plan' }
        ];
        expect((router as any).extractNetworkPreference()).toBe('HSA');
      });
    });
  });
});
