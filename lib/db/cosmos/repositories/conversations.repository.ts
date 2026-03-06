/**
 * Conversations Repository
 * High-performance conversation storage with quality tracking
 * 
 * Best Practices:
 * - Optimized for high-volume writes (5000 RU/s autoscale)
 * - TTL-based automatic cleanup (1 year retention)
 * - Quality metrics integration
 * - Efficient querying with proper indexing
 */

import { CosmosContainers } from '../client';
import { CosmosOperations, buildQuery, PaginatedResult } from '../operations';
import { ConversationQuality } from '@/types/rag';
import { v4 as uuidv4 } from 'uuid';

/**
 * Conversation document matching Cosmos schema
 */
export interface ConversationDocument {
  id: string;
  companyId: string;
  userId: string;
  userName?: string;
  sessionId: string;
  messages: ConversationMessage[];
  quality?: ConversationQuality;
  metadata: {
    userAgent?: string;
    ipAddress?: string;
    tier: 'L1' | 'L2' | 'L3';
    escalated: boolean;
    resolved: boolean;
    tags: string[];
  };
  startedAt: string;
  lastMessageAt: string;
  endedAt?: string;
  ttl?: number; // Auto-delete after 1 year (31536000 seconds)
  _etag?: string;
  _ts?: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    responseTime?: number;
    tokensUsed?: number;
    cost?: number;
    citations?: string[];
  };
}

/**
 * Conversations Repository
 */
export class ConversationsRepository {
  private static _container: any = null;
  private static TTL_ONE_YEAR = 31536000; // seconds
  
  private static get container() {
    if (!this._container) {
      this._container = CosmosContainers.conversations;
    }
    return this._container;
  }

  /**
   * Create new conversation
   */
  static async createConversation(input: {
    companyId: string;
    userId: string;
    userName?: string;
    sessionId: string;
    tier: 'L1' | 'L2' | 'L3';
    userAgent?: string;
    ipAddress?: string;
  }): Promise<ConversationDocument> {
    const now = new Date().toISOString();
    const conversation: ConversationDocument = {
      id: uuidv4(),
      companyId: input.companyId,
      userId: input.userId,
      userName: input.userName,
      sessionId: input.sessionId,
      messages: [],
      metadata: {
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        tier: input.tier,
        escalated: false,
        resolved: false,
        tags: [],
      },
      startedAt: now,
      lastMessageAt: now,
      ttl: this.TTL_ONE_YEAR,
    };

    return await CosmosOperations.create(
      this.container,
      conversation,
      input.companyId
    );
  }

  /**
   * Add message to conversation
   */
  static async addMessage(
    id: string,
    companyId: string,
    message: ConversationMessage
  ): Promise<ConversationDocument> {
    const conversation = await this.getConversation(id, companyId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const updated: Partial<ConversationDocument> = {
      ...conversation,
      messages: [...conversation.messages, message],
      lastMessageAt: message.timestamp,
    };

    return await CosmosOperations.update(
      this.container,
      id,
      companyId,
      updated,
      conversation._etag
    );
  }

  /**
   * Update conversation quality metrics
   */
  static async updateQuality(
    id: string,
    companyId: string,
    quality: ConversationQuality
  ): Promise<ConversationDocument> {
    const conversation = await this.getConversation(id, companyId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const updated: Partial<ConversationDocument> = {
      ...conversation,
      quality,
      metadata: {
        ...conversation.metadata,
        resolved: (quality as any).resolved,
        escalated: (quality as any).escalated,
      },
    };

    return await CosmosOperations.update(
      this.container,
      id,
      companyId,
      updated
    );
  }

  /**
   * Get conversation by ID
   */
  static async getConversation(
    id: string,
    companyId: string
  ): Promise<ConversationDocument | null> {
    return await CosmosOperations.read<ConversationDocument>(
      this.container,
      id,
      companyId
    );
  }

  /**
   * Get user conversations with pagination
   */
  static async getUserConversations(
    companyId: string,
    userId: string,
    options: {
      maxItemCount?: number;
      continuationToken?: string;
    } = {}
  ): Promise<PaginatedResult<ConversationDocument>> {
    const query = `
      SELECT * FROM c 
      WHERE c.companyId = @companyId 
      AND c.userId = @userId 
      ORDER BY c.lastMessageAt DESC
    `;

    return await CosmosOperations.query<ConversationDocument>(
      this.container,
      buildQuery(query, { companyId, userId }),
      {
        maxItemCount: options.maxItemCount || 20,
        continuationToken: options.continuationToken,
        partitionKey: companyId,
      }
    );
  }

  /**
   * Get recent conversations for analytics
   */
  static async getRecentConversations(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<ConversationDocument[]> {
    const query = `
      SELECT * FROM c 
      WHERE c.companyId = @companyId 
      AND c.startedAt >= @startDate 
      AND c.startedAt <= @endDate
      ORDER BY c.startedAt DESC
    `;

    const result = await CosmosOperations.query<ConversationDocument>(
      this.container,
      buildQuery(query, { companyId, startDate, endDate }),
      { partitionKey: companyId, maxItemCount: 1000 }
    );

    return result.items;
  }

  /**
   * Get quality metrics summary
   */
  static async getQualityMetrics(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<{
    totalConversations: number;
    averageResponseTime: number;
    averageGroundingScore: number;
    resolutionRate: number;
    escalationRate: number;
    averageSatisfaction: number;
  }> {
    const conversations = await this.getRecentConversations(
      companyId,
      startDate,
      endDate
    );

    const withQuality = conversations.filter((c) => c.quality);
    
    if (withQuality.length === 0) {
      return {
        totalConversations: 0,
        averageResponseTime: 0,
        averageGroundingScore: 0,
        resolutionRate: 0,
        escalationRate: 0,
        averageSatisfaction: 0,
      };
    }

    const sum = withQuality.reduce(
      (acc, c) => {
        const q = c.quality! as any;
        return {
          responseTime: acc.responseTime + q.responseTime,
          groundingScore: acc.groundingScore + q.groundingScore,
          resolved: acc.resolved + (q.resolved ? 1 : 0),
          escalated: acc.escalated + (q.escalated ? 1 : 0),
          satisfaction: acc.satisfaction + (q.userSatisfaction?.csat || 0),
        };
      },
      { responseTime: 0, groundingScore: 0, resolved: 0, escalated: 0, satisfaction: 0 }
    );

    return {
      totalConversations: conversations.length,
      averageResponseTime: sum.responseTime / withQuality.length,
      averageGroundingScore: sum.groundingScore / withQuality.length,
      resolutionRate: (sum.resolved / withQuality.length) * 100,
      escalationRate: (sum.escalated / withQuality.length) * 100,
      averageSatisfaction: sum.satisfaction / withQuality.length,
    };
  }

  /**
   * End conversation
   */
  static async endConversation(
    id: string,
    companyId: string
  ): Promise<ConversationDocument> {
    const conversation = await this.getConversation(id, companyId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const updated: Partial<ConversationDocument> = {
      ...conversation,
      endedAt: new Date().toISOString(),
    };

    return await CosmosOperations.update(
      this.container,
      id,
      companyId,
      updated
    );
  }
}
