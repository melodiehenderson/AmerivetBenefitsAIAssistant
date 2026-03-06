import { logger } from '@/lib/logger';
import { getClient } from '@/lib/azure/cosmos';
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
    const client = await getClient();
    if (!client) throw new Error('Cosmos client not available');
    this.container = client.database('BenefitsDB').container('conversations');
  }

  async addMessage(conversationId: string, message: Message): Promise<void> {
    await this.ensureInitialized();
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      conversation.messages.push(message);
      conversation.updatedAt = new Date();

      await this.db.item(conversationId).replace(conversation);
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

  async createConversation(userId: string, companyId: string): Promise<Conversation> {
    await this.ensureInitialized();
    try {
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      userId,
      companyId,
      messages: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

      const { resource } = await this.db.items.create(conversation);
      return resource!;
    } catch (error) {
      logger.error({ error, userId, companyId }, 'Error creating conversation');
      throw error;
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

    const { resource } = await this.db.item(conversationId).replace(conversation);
    return resource!;
  }
}

export const conversationService = new ConversationService();
