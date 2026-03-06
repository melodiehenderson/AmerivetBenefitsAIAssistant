import { logger } from '@/lib/logger';
import { getClient } from '@/lib/azure/cosmos';

const isBuild = () => process.env.NEXT_PHASE === 'phase-production-build';

export interface User {
  id: string;
  email: string;
  name: string;
  companyId?: string;
  role: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

class UserService {
  private container: any = null;

  private async ensureInitialized() {
    if (isBuild()) return;
    if (this.container) return;
    
    const client = await getClient();
    if (!client) return;
    
    this.container = client.database('BenefitsDB').container('users');
  }

  async getUserById(id: string): Promise<User | null> {
    await this.ensureInitialized();
    try {
      const { resource } = await this.container.item(id).read();
      return resource || null;
    } catch (error) {
      if ((error as any).code === 404) {
        return null;
      }
      logger.error({ error, userId: id }, 'Error fetching user');
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    await this.ensureInitialized();
    try {
      const query = 'SELECT * FROM c WHERE c.email = @email';
      const { resources } = await this.container.items.query({
        query,
        parameters: [{ name: '@email', value: email }]
      }).fetchAll();

      return resources[0] || null;
    } catch (error) {
      logger.error({ error, email }, 'Error fetching user by email');
      throw error;
    }
  }

  async createUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    await this.ensureInitialized();
    try {
      const user: User = {
        ...userData,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const { resource } = await this.container.items.create(user);
      return resource!;
    } catch (error) {
      logger.error({ error, userData }, 'Error creating user');
      throw error;
    }
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    await this.ensureInitialized();
    try {
      const existingUser = await this.getUserById(id);
      if (!existingUser) {
        throw new Error('User not found');
      }

      const updatedUser: User = {
        ...existingUser,
        ...updates,
        updatedAt: new Date()
      };

      const { resource } = await this.container.item(id).replace(updatedUser);
      return resource!;
    } catch (error) {
      logger.error({ error, userId: id, updates }, 'Error updating user');
      throw error;
    }
  }

  async deleteUser(id: string): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.container.item(id).delete();
    } catch (error) {
      logger.error({ error, userId: id }, 'Error deleting user');
      throw error;
    }
  }

  async getUsersByCompany(companyId: string): Promise<User[]> {
    await this.ensureInitialized();
    try {
      const query = 'SELECT * FROM c WHERE c.companyId = @companyId AND c.isActive = true';
      const { resources } = await this.container.items.query({
        query,
        parameters: [{ name: '@companyId', value: companyId }]
      }).fetchAll();

      return resources;
    } catch (error) {
      logger.error({ error, companyId }, 'Error fetching users by company');
      throw error;
    }
  }

  async listUsers(options: { companyId: string; limit?: number; offset?: number }): Promise<User[]> {
    try {
      const query = 'SELECT * FROM c WHERE c.companyId = @companyId AND c.isActive = true ORDER BY c.createdAt DESC';
      const { resources } = await this.container.items.query({
        query,
        parameters: [{ name: '@companyId', value: options.companyId }]
      }).fetchAll();

      return resources.slice(options.offset || 0, (options.offset || 0) + (options.limit || 50));
    } catch (error) {
      logger.error({ error, options }, 'Error listing users');
      return [];
    }
  }

  async assignUserToCompany(userId: string, companyId: string): Promise<void> {
    try {
      await this.updateUser(userId, { companyId });
      logger.info({ userId, companyId }, 'User assigned to company');
    } catch (error) {
      logger.error({ error, userId, companyId }, 'Failed to assign user to company');
      throw error;
    }
  }

  async updateUserRole(userId: string, role: string): Promise<void> {
    try {
      await this.updateUser(userId, { role });
      logger.info({ userId, role }, 'User role updated');
    } catch (error) {
      logger.error({ error, userId, role }, 'Failed to update user role');
      throw error;
    }
  }
}

export const userService = new UserService();
