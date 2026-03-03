// lib/services/text-processor.ts
import { logger } from '@/lib/logger';

interface TokenizationResult {
  tokens: string[];
  tokenCount: number;
  wordCount: number;
  characterCount: number;
  processingTime: number;
}

interface TextAnalysisResult {
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  keywords: string[];
  entities: string[];
  categories: string[];
  processingTime: number;
}

export class TextProcessor {
  private stopWords: Set<string> = new Set();
  private benefitKeywords: Set<string> = new Set();
  private medicalTerms: Set<string> = new Set();
  constructor() {
    this.initializeDictionaries();
  }

  private initializeDictionaries() {
    // Common stop words
    this.stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall', 'this', 'that',
      'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
    ]);

    // Benefits-related keywords
    this.benefitKeywords = new Set([
      'hsa', 'hmo', 'ppo', 'deductible', 'premium', 'copay', 'coverage', 'benefits', 'insurance',
      'health', 'dental', 'vision', 'prescription', 'pharmacy', 'doctor', 'hospital', 'emergency',
      'preventive', 'annual', 'monthly', 'cost', 'price', 'plan', 'enrollment', 'open enrollment',
      'kaiser', 'amerivet', 'network', 'provider', 'claim', 'reimbursement', 'out-of-pocket'
    ]);

    // Medical terms
    this.medicalTerms = new Set([
      'chronic', 'acute', 'condition', 'diagnosis', 'treatment', 'therapy', 'medication', 'prescription',
      'surgery', 'procedure', 'specialist', 'primary care', 'urgent care', 'emergency room', 'hospitalization',
      'rehabilitation', 'physical therapy', 'mental health', 'counseling', 'therapy', 'wellness'
    ]);
  }

  tokenizeText(text: string): TokenizationResult {
    const startTime = Date.now();
    
    try {
      // Clean and normalize text
      const cleanedText = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      // Split into tokens
      const tokens = cleanedText.split(' ')
        .filter(token => token.length > 0 && !this.stopWords.has(token));

      const processingTime = Date.now() - startTime;

      return {
        tokens,
        tokenCount: tokens.length,
        wordCount: cleanedText.split(' ').length,
        characterCount: text.length,
        processingTime,
      };
    } catch (error) {
      logger.error('Tokenization failed', { error });
      return {
        tokens: [],
        tokenCount: 0,
        wordCount: 0,
        characterCount: text.length,
        processingTime: 0,
      };
    }
  }

  analyzeText(text: string): TextAnalysisResult {
    const startTime = Date.now();
    
    try {
      const tokenization = this.tokenizeText(text);
      const sentiment = this.analyzeSentiment(text);
      const keywords = this.extractKeywords(tokenization.tokens);
      const entities = this.extractEntities(text);
      const categories = this.categorizeText(text, keywords);

      return {
        sentiment: sentiment.sentiment,
            confidence: sentiment.confidence,
            keywords,
            entities,
            categories,
            processingTime: Date.now() - startTime,
          };
        } catch (error) {
          logger.error('Text analysis failed', { error });
          return {
            sentiment: 'neutral',
            confidence: 0.5,
            keywords: [],
            entities: [],
            categories: [],
            processingTime: 0,
          };
        }
      }

  private analyzeSentiment(text: string): { sentiment: 'positive' | 'negative' | 'neutral'; confidence: number } {
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'helpful', 'clear', 'easy', 'love', 'like'];
    const negativeWords = ['bad', 'terrible', 'awful', 'confusing', 'difficult', 'hate', 'dislike', 'problem', 'issue', 'wrong'];

    const lowerText = text.toLowerCase();
    let positiveScore = 0;
    let negativeScore = 0;

    positiveWords.forEach(word => {
      if (lowerText.includes(word)) positiveScore++;
    });

    negativeWords.forEach(word => {
      if (lowerText.includes(word)) negativeScore++;
    });

    const totalScore = positiveScore + negativeScore;
    if (totalScore === 0) {
      return { sentiment: 'neutral', confidence: 0.5 };
    }

    const positiveRatio = positiveScore / totalScore;
    const negativeRatio = negativeScore / totalScore;

    if (positiveRatio > 0.6) {
      return { sentiment: 'positive', confidence: positiveRatio };
    } else if (negativeRatio > 0.6) {
      return { sentiment: 'negative', confidence: negativeRatio };
    } else {
      return { sentiment: 'neutral', confidence: 0.5 };
    }
  }

  private extractKeywords(tokens: string[]): string[] {
    const keywordCounts: { [key: string]: number } = {};
    
    tokens.forEach(token => {
      if (this.benefitKeywords.has(token) || this.medicalTerms.has(token)) {
        keywordCounts[token] = (keywordCounts[token] || 0) + 1;
      }
    });

    return Object.entries(keywordCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([keyword]) => keyword);
  }

  private extractEntities(text: string): string[] {
    const entities: string[] = [];
    
    // Extract numbers (ages, costs, etc.)
    const numbers = text.match(/\b\d+\b/g);
    if (numbers) {
      entities.push(...numbers.map(n => `number:${n}`));
    }

    // Extract dollar amounts
    const dollarAmounts = text.match(/\$\d+(?:,\d{3})*(?:\.\d{2})?/g);
    if (dollarAmounts) {
      entities.push(...dollarAmounts.map(a => `cost:${a}`));
    }

    // Extract plan names
    const planNames = text.match(/\b(?:hsa|hmo|ppo|kaiser|amerivet)\b/gi);
    if (planNames) {
      entities.push(...planNames.map(p => `plan:${p.toLowerCase()}`));
    }

    return entities;
  }

  private categorizeText(text: string, keywords: string[]): string[] {
    const categories: string[] = [];
    const lowerText = text.toLowerCase();

    if (keywords.some(k => ['hsa', 'hmo', 'ppo'].includes(k))) {
      categories.push('plan_inquiry');
    }

    if (keywords.some(k => ['cost', 'price', 'premium', 'deductible'].includes(k))) {
      categories.push('cost_related');
    }

    if (keywords.some(k => ['coverage', 'benefits', 'insurance'].includes(k))) {
      categories.push('coverage_inquiry');
    }

    if (keywords.some(k => ['doctor', 'provider', 'network'].includes(k))) {
      categories.push('provider_related');
    }

    if (keywords.some(k => ['enrollment', 'signup', 'register'].includes(k))) {
      categories.push('enrollment_related');
    }

    if (lowerText.includes('compare') || lowerText.includes('difference')) {
      categories.push('comparison_request');
    }

    if (lowerText.includes('recommend') || lowerText.includes('suggest')) {
      categories.push('recommendation_request');
    }

    return categories.length > 0 ? categories : ['general_inquiry'];
  }

  // Advanced text processing methods
  preprocessForML(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractFeatures(text: string): { [key: string]: number } {
    const tokenization = this.tokenizeText(text);
    const analysis = this.analyzeText(text);
    
    return {
      wordCount: tokenization.wordCount,
      tokenCount: tokenization.tokenCount,
      characterCount: tokenization.characterCount,
      benefitKeywordCount: analysis.keywords.filter(k => this.benefitKeywords.has(k)).length,
      medicalTermCount: analysis.keywords.filter(k => this.medicalTerms.has(k)).length,
      entityCount: analysis.entities.length,
      categoryCount: analysis.categories.length,
      isPositive: analysis.sentiment === 'positive' ? 1 : 0,
      isNegative: analysis.sentiment === 'negative' ? 1 : 0,
      isNeutral: analysis.sentiment === 'neutral' ? 1 : 0,
    };
  }

  calculateTextSimilarity(text1: string, text2: string): number {
    const tokens1 = this.tokenizeText(text1).tokens;
    const tokens2 = this.tokenizeText(text2).tokens;
    
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }
}

export const textProcessor = new TextProcessor();
