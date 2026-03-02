/**
 * Analytics Tracking for User Satisfaction
 * Track user interactions and satisfaction metrics
 */

import { logger } from '@/lib/logger';

export interface AnalyticsEvent {
  eventType: 'chat_response' | 'satisfaction_rating' | 'escalation' | 'feature_usage';
  userId: string;
  conversationId: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface ChatResponseMetadata {
  model: 'simple' | 'smart' | 'rag';
  latencyMs: number;
  responseLength: number;
  chunksUsed?: number;
  validationPassed?: boolean;
  ungroundedClaims?: string[];
  topic?: string;
  intent?: string;
}

export interface SatisfactionRating {
  rating: 1 | 2 | 3 | 4 | 5; // 1=Very Dissatisfied, 5=Very Satisfied
  feedback?: string;
  tags?: string[];
}

/**
 * Analytics Tracker for monitoring user satisfaction and system performance
 */
export class AnalyticsTracker {
  private static instance: AnalyticsTracker;
  private queue: AnalyticsEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Start periodic flush
    this.startPeriodicFlush();
  }

  public static getInstance(): AnalyticsTracker {
    if (!AnalyticsTracker.instance) {
      AnalyticsTracker.instance = new AnalyticsTracker();
    }
    return AnalyticsTracker.instance;
  }

  /**
   * Track chat response event
   */
  public trackChatResponse(
    userId: string,
    conversationId: string,
    message: string,
    response: string,
    metadata: ChatResponseMetadata
  ): void {
    const event: AnalyticsEvent = {
      eventType: 'chat_response',
      userId,
      conversationId,
      timestamp: new Date(),
      metadata: {
        message,
        response,
        ...metadata,
        responseLength: response.length
      }
    };

    this.queueEvent(event);
    logger.info('Chat response tracked', { userId, conversationId, model: metadata.model });
  }

  /**
   * Track satisfaction rating
   */
  public trackSatisfaction(
    userId: string,
    conversationId: string,
    rating: SatisfactionRating
  ): void {
    const event: AnalyticsEvent = {
      eventType: 'satisfaction_rating',
      userId,
      conversationId,
      timestamp: new Date(),
      metadata: rating
    };

    this.queueEvent(event);
    logger.info('Satisfaction rating tracked', { userId, conversationId, rating: rating.rating });
  }

  /**
   * Track escalation (user requested human help)
   */
  public trackEscalation(
    userId: string,
    conversationId: string,
    reason: string
  ): void {
    const event: AnalyticsEvent = {
      eventType: 'escalation',
      userId,
      conversationId,
      timestamp: new Date(),
      metadata: { reason }
    };

    this.queueEvent(event);
    logger.warn('Escalation tracked', { userId, conversationId, reason });
  }

  /**
   * Track feature usage
   */
  public trackFeatureUsage(
    userId: string,
    conversationId: string,
    feature: 'cost_calculator' | 'plan_comparison' | 'maternity_comparison' | 'cost_projection',
    metadata?: Record<string, any>
  ): void {
    const event: AnalyticsEvent = {
      eventType: 'feature_usage',
      userId,
      conversationId,
      timestamp: new Date(),
      metadata: { feature, ...metadata }
    };

    this.queueEvent(event);
    logger.info('Feature usage tracked', { userId, conversationId, feature });
  }

  /**
   * Calculate satisfaction metrics
   */
  public async calculateMetrics(
    conversationId: string
  ): Promise<{
    averageRating: number;
    totalResponses: number;
    escalationRate: number;
    averageLatencyMs: number;
  }> {
    // In production, this would query from database/analytics service
    // For now, return placeholder metrics
    return {
      averageRating: 0,
      totalResponses: 0,
      escalationRate: 0,
      averageLatencyMs: 0
    };
  }

  /**
   * Export analytics data
   */
  public async exportAnalytics(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    // In production, this would export from database
    // For now, return placeholder
    return JSON.stringify({ startDate, endDate, events: this.queue });
  }

  private queueEvent(event: AnalyticsEvent): void {
    this.queue.push(event);
    
    // Flush if queue gets too large
    if (this.queue.length >= 100) {
      this.flushEvents();
    }
  }

  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flushEvents();
    }, 60000); // Flush every minute
  }

  private flushEvents(): void {
    if (this.queue.length === 0) return;

    const eventsToFlush = [...this.queue];
    this.queue = [];

    // In production, send to analytics service (e.g., Segment, Mixpanel, custom endpoint)
    logger.debug('Flushing analytics events', { count: eventsToFlush.length });
    
    // Example: Send to analytics endpoint
    // fetch('/api/analytics/track', {
    //   method: 'POST',
    //   body: JSON.stringify(eventsToFlush)
    // });
  }

  public stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flushEvents(); // Final flush
  }
}

/**
 * Enhanced chat response tracker with issue-specific metrics
 */
export function trackEnhancedChatResponse(
  userId: string,
  conversationId: string,
  message: string,
  response: string,
  model: 'simple' | 'smart' | 'rag',
  latencyMs: number,
  issueFixes?: {
    issue1_pricingConsistent?: boolean;
    issue2_categoryFiltered?: boolean;
    issue3_allBenefitsCalculated?: boolean;
    issue4_costProjected?: boolean;
    issue5_maternityDetailed?: boolean;
    issue6_stateConsistent?: boolean;
    issue7_validationPassed?: boolean;
  }
): void {
  const tracker = AnalyticsTracker.getInstance();
  
  tracker.trackChatResponse(userId, conversationId, message, response, {
    model,
    latencyMs,
    responseLength: response.length,
    topic: detectTopic(message),
    intent: detectIntent(message)
  });

  // Track which issue fixes were applied
  if (issueFixes) {
    logger.info('Issue fixes applied', {
      conversationId,
      ...issueFixes
    });
  }
}

/**
 * Detect topic from user message
 */
function detectTopic(message: string): string {
  const lower = message.toLowerCase();
  
  if (lower.includes('maternity') || lower.includes('pregnant') || lower.includes('baby')) {
    return 'maternity';
  }
  if (lower.includes('cost') || lower.includes('price') || lower.includes('premium')) {
    return 'cost';
  }
  if (lower.includes('all benefits') || lower.includes('everything')) {
    return 'all_benefits';
  }
  if (lower.includes('medical')) {
    return 'medical';
  }
  if (lower.includes('dental')) {
    return 'dental';
  }
  if (lower.includes('vision')) {
    return 'vision';
  }
  
  return 'general';
}

/**
 * Detect intent from user message
 */
function detectIntent(message: string): string {
  const lower = message.toLowerCase();
  
  if (lower.includes('compare')) {
    return 'comparison';
  }
  if (lower.includes('recommend') || lower.includes('suggest')) {
    return 'recommendation';
  }
  if (lower.includes('calculate') || lower.includes('estimate')) {
    return 'calculation';
  }
  if (lower.includes('enroll') || lower.includes('sign up')) {
    return 'enrollment';
  }
  
  return 'information';
}

export default {
  AnalyticsTracker,
  trackEnhancedChatResponse,
  detectTopic,
  detectIntent
};
