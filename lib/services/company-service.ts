import { logger } from '@/lib/logger';
import { getClient } from '@/lib/azure/cosmos';

const isBuild = () => process.env.NEXT_PHASE === 'phase-production-build';

export interface Company {
  id: string;
  name: string;
  domain: string;
  adminId: string;
  settings: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

class CompanyService {
  private container: any = null;

  private async ensureInitialized() {
    if (isBuild()) return;
    if (this.container) return;
    
    const client = await getClient();
    if (!client) return;
    
    this.container = client.database('BenefitsDB').container('companies');
  }

  async getCompanies(options: { page: number; limit: number; adminId?: string }): Promise<Company[]> {
    await this.ensureInitialized();
    try {
      let query = 'SELECT * FROM c WHERE c.isActive = true';
      const parameters: any[] = [];

      if (options.adminId) {
        query += ' AND c.adminId = @adminId';
        parameters.push({ name: '@adminId', value: options.adminId });
      }

      query += ' ORDER BY c.createdAt DESC';

      const { resources } = await this.container.items.query({
        query,
        parameters
      }).fetchAll();

      const offset = (options.page - 1) * options.limit;
      return resources.slice(offset, offset + options.limit);
    } catch (error) {
      logger.error({ error, options }, 'Error fetching companies');
      return [];
    }
  }

  async createCompany(companyData: Omit<Company, 'id' | 'createdAt' | 'updatedAt'>): Promise<Company> {
    await this.ensureInitialized();
    try {
      const company: Company = {
        ...companyData,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const { resource } = await this.container.items.create(company);
      return resource!;
    } catch (error) {
      logger.error({ error, companyData }, 'Error creating company');
      throw error;
    }
  }

  async getCompanyById(id: string): Promise<Company | null> {
    await this.ensureInitialized();
    try {
      const { resource } = await this.container.item(id).read();
      return resource || null;
    } catch (error) {
      if ((error as any).code === 404) {
        return null;
      }
      logger.error({ error, companyId: id }, 'Error fetching company');
      throw error;
    }
  }

  async updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
    await this.ensureInitialized();
    try {
      const existingCompany = await this.getCompanyById(id);
      if (!existingCompany) {
        throw new Error('Company not found');
      }

      const updatedCompany: Company = {
        ...existingCompany,
        ...updates,
        updatedAt: new Date()
      };

      const { resource } = await this.container.item(id).replace(updatedCompany);
      return resource!;
    } catch (error) {
      logger.error({ error, companyId: id, updates }, 'Error updating company');
      throw error;
    }
  }
}

// Lazy singleton to avoid build-time initialization
let _companyService: CompanyService | null = null;
export function getCompanyService(): CompanyService {
  if (!_companyService) {
    _companyService = new CompanyService();
  }
  return _companyService;
}

// Deprecated: use getCompanyService() instead
export const companyService = getCompanyService();
