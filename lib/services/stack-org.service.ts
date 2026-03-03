import { getRepositories } from '@/lib/azure/cosmos';
import { logger } from '@/lib/logger';

export interface Organization {
  id: string;
  name: string;
  domain?: string;
  slug?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export class StackOrgService {
  /**
   * Create a new organization
   */
  async createOrganization(data: {
    name: string;
    domain?: string;
    slug?: string;
    metadata?: Record<string, any>;
  }): Promise<Organization> {
    try {
      const repositories = await getRepositories();
      const orgId = `org_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const organization = {
        id: orgId,
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await repositories.documents.create({
        ...organization,
        type: 'organization'
      } as any);

      // Also create in companies collection for compatibility
      await repositories.companies.create({
        id: orgId,
        name: data.name,
        domain: data.domain,
        slug: data.slug,
        metadata: data.metadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      logger.info({
        orgId,
        name: data.name
      }, 'Organization created successfully');

      return organization;
    } catch (error) {
      logger.error({ data: error }, 'Failed to create organization:');
      throw error;
    }
  }

  /**
   * Get organization by ID
   */
  async getOrganization(orgId: string): Promise<Organization | null> {
    try {
      const repositories = await getRepositories();
      
      // Try organizations collection first
      let doc = await repositories.documents.getById(orgId, 'organizations');

      if (!doc) {
        // Fall back to companies collection
        doc = await repositories.companies.getById(orgId, 'organizations');
      }

      if (!doc) {
        return null;
      }

      return doc as unknown as Organization;
    } catch (error) {
      logger.error({ data: error }, 'Failed to get organization:');
      return null;
    }
  }

  /**
   * Update organization
   */
  async updateOrganization(
    orgId: string,
    updateData: Partial<Organization>
  ): Promise<Organization | null> {
    try {
      const repositories = await getRepositories();
      
      const existingOrg = await this.getOrganization(orgId);
      if (!existingOrg) {
        return null;
      }

      const updatedOrg = {
        ...existingOrg,
        ...updateData,
        id: orgId, // Ensure ID doesn't change
        updatedAt: new Date().toISOString(),
      };

      // Update in both collections
      await repositories.documents.update(orgId, updatedOrg as any, 'organizations');
      await repositories.companies.update(orgId, {
        name: updatedOrg.name,
        domain: updatedOrg.domain,
        slug: updatedOrg.slug,
        metadata: updatedOrg.metadata,
        updatedAt: updatedOrg.updatedAt,
      } as any, 'organizations');

      logger.info({
        orgId,
        updateFields: Object.keys(updateData)
      }, 'Organization updated successfully');

      return updatedOrg;
    } catch (error) {
      logger.error({ data: error }, 'Failed to update organization:');
      throw error;
    }
  }

  /**
   * Delete organization
   */
  async deleteOrganization(orgId: string): Promise<void> {
    try {
      const repositories = await getRepositories();
      
      // Delete from both collections
      await repositories.documents.delete(orgId, 'organizations');
      await repositories.companies.delete(orgId, 'organizations');

      logger.info({ orgId }, 'Organization deleted successfully');
    } catch (error) {
      logger.error({ data: error }, 'Failed to delete organization:');
      throw error;
    }
  }

  /**
   * List all organizations
   */
  async listOrganizations(limit: number = 50): Promise<Organization[]> {
    try {
      const repositories = await getRepositories();
      
      const query = `SELECT * FROM c WHERE c.type = 'organization' ORDER BY c.createdAt DESC`;
      const parameters: any[] = [];
      
      const result = await repositories.documents.query({ query, parameters });
      const items = ((result as any).items ?? result) as any[];

      return items.slice(0, limit);
    } catch (error) {
      logger.error({ data: error }, 'Failed to list organizations:');
      return [];
    }
  }

  /**
   * Get organization by domain
   */
  async getOrganizationByDomain(domain: string): Promise<Organization | null> {
    try {
      const repositories = await getRepositories();
      
      const query = `SELECT * FROM c WHERE c.domain = @domain AND c.type = 'organization'`;
      const parameters = [{ name: '@domain', value: domain }];
      
      const result2 = await repositories.documents.query({ query, parameters });
      const items2 = ((result2 as any).items ?? result2) as any[];

      return items2[0] || null;
    } catch (error) {
      logger.error({ data: error }, 'Failed to get organization by domain:');
      return null;
    }
  }

  /**
   * Get organization by slug
   */
  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    try {
      const repositories = await getRepositories();
      
      const query = `SELECT * FROM c WHERE c.slug = @slug AND c.type = 'organization'`;
      const parameters = [{ name: '@slug', value: slug }];
      
      const result3 = await repositories.documents.query({ query, parameters });
      const items3 = ((result3 as any).items ?? result3) as any[];

      return items3[0] || null;
    } catch (error) {
      logger.error({ data: error }, 'Failed to get organization by slug:');
      return null;
    }
  }
}

// Export singleton instance
export const stackOrgService = new StackOrgService();
