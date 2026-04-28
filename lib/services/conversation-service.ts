import { logger } from '@/lib/logger';
import { getContainer, CONVERSATIONS_CONTAINER } from '@/lib/azure/cosmos-db';
import { Container } from '@azure/cosmos';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface Conversation {
  id: string;
  userId: string;
  companyId: string;
  messages: Message[];
  messageCount: number;       // total message turns (user + assistant)
  escalationCount: number;    // times counselor escalation was triggered
  timestamp: number;          // epoch ms — updatedAt in numeric form (used by analytics queries)
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

class ConversationService {
  private container: Container | null = null;

  private get db(): Container {
    if (!this.container) throw new Error('Container not initialized');
    return this.container;
  }

  private async ensureInitialized() {
    if (this.container) return;
    // Use cosmos-db.ts getContainer() so this service writes to the same
    // BenefitsChat.Conversations container that the analytics API reads from.
    this.container = await getContainer(CONVERSATIONS_CONTAINER);
  }

  async addMessage(conversationId: string, message: Message): Promise<void> {
    await this.ensureInitialized();
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      conversation.messages.push(message);
      conversation.messageCount = (conversation.messageCount ?? 0) + 1;
      const now = new Date();
      conversation.timestamp = now.getTime();
      conversation.updatedAt = now;

      await this.db.item(conversationId, conversationId).replace(conversation);
    } catch (error) {
      logger.error('Error adding message to conversation', { error, conversationId, messageId: message.id }, error as Error);
      throw error;
    }
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    await this.ensureInitialized();
    try {
      const { resource } = await this.db.item(conversationId).read();
      return resource || null;
    } catch (error) {
      if ((error as any).code === 404) {
        return null;
      }
      logger.error({ error, conversationId }, 'Error fetching conversation');
      throw error;
    }
  }

  async createConversation(userId: string, companyId: string, id?: string): Promise<Conversation> {
    await this.ensureInitialized();
    try {
      const now = new Date();
      const conversation: Conversation = {
        id: id ?? crypto.randomUUID(),
        userId,
        companyId,
        messages: [],
        messageCount: 0,
        escalationCount: 0,
        timestamp: now.getTime(),
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      const { resource } = await this.db.items.create(conversation);
      return resource!;
    } catch (error) {
      logger.error({ error, userId, companyId }, 'Error creating conversation');
      throw error;
    }
  }

  /**
   * Gets an existing conversation by ID, or creates a new one if not found.
   * Used by the qa-v2 route to ensure a Cosmos record exists for every session.
   */
  async getOrCreateForSession(sessionId: string, userId: string, companyId: string): Promise<Conversation> {
    await this.ensureInitialized();
    const existing = await this.getConversation(sessionId);
    if (existing) return existing;
    return this.createConversation(userId, companyId, sessionId);
  }

  /**
   * Increments messageCount and refreshes timestamp + optional topic metadata.
   * delta: number of message turns added this round (typically 2: user + assistant).
   */
  async incrementMessageCount(
    conversationId: string,
    delta: number,
    topicPatch?: Record<string, any>,
  ): Promise<void> {
    await this.ensureInitialized();
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) return;
      const now = new Date();
      conversation.messageCount = (conversation.messageCount ?? 0) + delta;
      conversation.timestamp = now.getTime();
      conversation.updatedAt = now;
      if (topicPatch) {
        conversation.metadata = { ...(conversation.metadata ?? {}), ...topicPatch };
      }
      await this.db.item(conversationId, conversationId).replace(conversation);
    } catch (error) {
      logger.error('Error incrementing message count', { error, conversationId }, error as Error);
      // non-fatal — analytics will just be stale
    }
  }

  /**
   * Increments escalationCount for a conversation.
   * Called when the engine emits intercept: 'counselor-escalation-v2'.
   */
  async recordEscalation(conversationId: string): Promise<void> {
    await this.ensureInitialized();
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) return;
      conversation.escalationCount = (conversation.escalationCount ?? 0) + 1;
      conversation.updatedAt = new Date();
      await this.db.item(conversationId, conversationId).replace(conversation);
    } catch (error) {
      logger.error('Error recording escalation', { error, conversationId }, error as Error);
    }
  }

  async getUserConversations(userId: string, companyId: string): Promise<Conversation[]> {
    await this.ensureInitialized();
    try {
      const query = 'SELECT * FROM c WHERE c.userId = @userId AND c.companyId = @companyId ORDER BY c.updatedAt DESC';
      const { resources } = await this.db.items.query({
        query,
        parameters: [
          { name: '@userId', value: userId },
          { name: '@companyId', value: companyId }
        ]
      }).fetchAll();

      return resources;
    } catch (error) {
      logger.error({ error, userId, companyId }, 'Error fetching user conversations');
      return [];
    }
  }

  async patchMetadata(conversationId: string, patch: Record<string, any>): Promise<Conversation> {
    await this.ensureInitialized();
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    conversation.metadata = {
      ...(conversation.metadata ?? {}),
      ...patch
    };
    conversation.updatedAt = new Date();

    const { resource } = await this.db.item(conversationId, conversationId).replace(conversation);
    return resource!;
  }
}

export const conversationService = new ConversationService();
