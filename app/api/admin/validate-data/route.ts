/**
 * Data Validation API Endpoint
 * GET /api/admin/validate-data
 * Validates that company data is loaded and accessible in Cosmos DB efficiently
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/unified-auth';
import { getContainer } from '@/lib/azure/cosmos-db';
import { logger } from '@/lib/logger';

interface ValidationResult {
  container: string;
  status: 'success' | 'warning' | 'error';
  count: number;
  sampleId?: string;
  issues: string[];
}

async function validateContainer(
  containerName: string,
  companyId: string
): Promise<ValidationResult> {
  try {
    const container = await getContainer(containerName);
    
    // 1. OPTIMIZED: Get Count Only (Low RU cost)
    // "SELECT VALUE COUNT(1)" returns just a number, not documents.
    const countQuery = {
      query: 'SELECT VALUE COUNT(1) FROM c WHERE c.companyId = @companyId',
      parameters: [{ name: '@companyId', value: companyId }],
    };
    
    // 2. OPTIMIZED: Get One Sample ID (Low RU cost)
    // We only need 1 ID to prove data exists, not the whole object.
    const sampleQuery = {
      query: 'SELECT TOP 1 c.id FROM c WHERE c.companyId = @companyId',
      parameters: [{ name: '@companyId', value: companyId }],
    };

    // Run queries in parallel for this container
    const [countResponse, sampleResponse] = await Promise.all([
      container.items.query(countQuery).fetchAll(),
      container.items.query(sampleQuery).fetchAll()
    ]);

    const count = countResponse.resources[0] || 0;
    const sampleId = sampleResponse.resources[0]?.id;

    return {
      container: containerName,
      status: count > 0 ? 'success' : 'warning',
      count,
      sampleId,
      issues: count === 0 ? [`No data found in ${containerName} for ${companyId}`] : [],
    };
  } catch (error) {
    logger.error(`Failed to validate ${containerName}`, error as Error);
    return {
      container: containerName,
      status: 'error',
      count: 0,
      issues: [`Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}

export const GET = requireCompanyAdmin(async (req: NextRequest, { user }) => {
  const startTime = Date.now();
  // Use the admin's actual company ID, or fallback to 'amerivet' if hardcoding is required
  const targetCompanyId = user.companyId || 'amerivet';

  try {
    logger.info('Starting data validation', { userId: user.id, companyId: targetCompanyId });

    const containers = [
      'Users',
      'Companies',
      'Benefits',
      'Documents',
      'FAQs',
      'DocumentChunks',
      'Conversations',
    ];

    // 3. OPTIMIZED: Parallel Execution
    // Check all containers simultaneously instead of waiting for one to finish before starting the next.
    const validationPromises = containers.map(name => validateContainer(name, targetCompanyId));
    const results = await Promise.all(validationPromises);

    // Calculate summary statistics
    const successCount = results.filter(r => r.status === 'success').length;
    const warningCount = results.filter(r => r.status === 'warning').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const totalRecords = results.reduce((sum, r) => sum + r.count, 0);

    const summary = {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      totalContainers: results.length,
      successCount,
      warningCount,
      errorCount,
      totalRecords,
      targetCompanyId,
      overallStatus: errorCount === 0 
        ? (warningCount === 0 ? 'operational' : 'warnings') 
        : 'errors',
    };

    const allIssues = results.flatMap(r => r.issues);

    logger.info('Data validation completed', { summary });

    return NextResponse.json({
      success: errorCount === 0,
      summary,
      results,
      issues: allIssues,
      message: errorCount === 0 
        ? '✅ Data integrity check passed successfully'
        : '❌ Data integrity issues detected',
    });

  } catch (error) {
    logger.error('Data validation endpoint failed', error as Error);
    return NextResponse.json(
      {
        success: false,
        error: 'Data validation critical failure',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
});