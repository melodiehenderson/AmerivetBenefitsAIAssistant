/**
 * Azure Search Health Check Endpoint
 * Provides real-time diagnostics for search functionality
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    status: 'unknown',
    checks: {},
  };

  try {
    // Get configuration
    const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const apiKey = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
    const indexName = process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'chunks_prod_v1';

    diagnostics.config = {
      endpoint: endpoint ? endpoint.substring(0, 40) + '...' : 'MISSING',
      apiKey: apiKey ? 'SET (' + apiKey.substring(0, 8) + '...)' : 'MISSING',
      indexName,
    };

    if (!endpoint || !apiKey) {
      diagnostics.status = 'unhealthy';
      diagnostics.error = 'Missing Azure Search credentials';
      return NextResponse.json(diagnostics, { status: 500 });
    }

    // Initialize client
    const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));

    // CHECK 1: Document Count
    try {
      const countStart = Date.now();
      const countResult = await client.search('*', { 
        top: 0, 
        includeTotalCount: true,
        queryType: 'simple',
      });
      const totalDocs = countResult.count || 0;
      diagnostics.checks.documentCount = {
        status: totalDocs > 0 ? 'healthy' : 'warning',
        count: totalDocs,
        latencyMs: Date.now() - countStart,
        message: totalDocs === 0 ? 'Index is empty!' : `Index contains ${totalDocs} documents`,
      };
    } catch (error) {
      diagnostics.checks.documentCount = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // CHECK 2: Sample Query (unfiltered)
    try {
      const queryStart = Date.now();
      const sampleResult = await client.search('benefits', { 
        top: 3,
        select: ['chunk_id', 'company_id', 'content'],
        queryType: 'simple',
      });
      
      const docs = [];
      for await (const result of sampleResult.results) {
        docs.push({
          id: result.document.chunk_id,
          company_id: result.document.company_id,
          score: result.score,
          contentPreview: typeof result.document.content === 'string' 
            ? result.document.content.substring(0, 100) + '...'
            : 'N/A',
        });
      }

      diagnostics.checks.sampleQuery = {
        status: docs.length > 0 ? 'healthy' : 'warning',
        query: 'benefits',
        resultsCount: docs.length,
        latencyMs: Date.now() - queryStart,
        sampleDocs: docs,
        message: docs.length === 0 ? 'Query returned no results' : 'Query successful',
      };
    } catch (error) {
      diagnostics.checks.sampleQuery = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // CHECK 3: Company ID Distribution
    try {
      const companyStart = Date.now();
      const companyResult = await client.search('*', {
        top: 100,
        select: ['company_id'],
        queryType: 'simple',
      });

      const companies = new Map<string, number>();
      for await (const result of companyResult.results) {
        const companyId = result.document.company_id;
        companies.set(companyId, (companies.get(companyId) || 0) + 1);
      }

      const distribution = Array.from(companies.entries()).map(([id, count]) => ({
        companyId: id,
        documentCount: count,
      }));

      diagnostics.checks.companyDistribution = {
        status: companies.size > 0 ? 'healthy' : 'warning',
        uniqueCompanies: companies.size,
        distribution,
        latencyMs: Date.now() - companyStart,
        message: companies.size === 0 ? 'No company IDs found' : `Found ${companies.size} unique company ID(s)`,
      };
    } catch (error) {
      diagnostics.checks.companyDistribution = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // CHECK 4: Filtered Query (company-specific)
    try {
      const filteredStart = Date.now();
      const filteredResult = await client.search('benefits', {
        top: 3,
        filter: "company_id eq 'amerivet'",
        select: ['chunk_id', 'company_id'],
        queryType: 'simple',
      });

      const filteredDocs = [];
      for await (const result of filteredResult.results) {
        filteredDocs.push({
          id: result.document.chunk_id,
          company_id: result.document.company_id,
          score: result.score,
        });
      }

      diagnostics.checks.filteredQuery = {
        status: filteredDocs.length > 0 ? 'healthy' : 'critical',
        filter: "company_id eq 'amerivet'",
        resultsCount: filteredDocs.length,
        latencyMs: Date.now() - filteredStart,
        sampleDocs: filteredDocs,
        message: filteredDocs.length === 0 
          ? '🔴 CRITICAL: No documents for company "amerivet"! This explains zero-results in chat.'
          : 'Filtered query successful',
      };
    } catch (error) {
      diagnostics.checks.filteredQuery = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Determine overall status
    const statuses = Object.values(diagnostics.checks).map((check: any) => check.status);
    if (statuses.includes('unhealthy') || statuses.includes('critical')) {
      diagnostics.status = 'unhealthy';
    } else if (statuses.includes('warning')) {
      diagnostics.status = 'degraded';
    } else {
      diagnostics.status = 'healthy';
    }

    diagnostics.totalLatencyMs = Date.now() - startTime;

    return NextResponse.json(diagnostics, {
      status: diagnostics.status === 'healthy' ? 200 : 503,
    });

  } catch (error) {
    diagnostics.status = 'unhealthy';
    diagnostics.error = error instanceof Error ? error.message : 'Unknown error';
    diagnostics.totalLatencyMs = Date.now() - startTime;

    return NextResponse.json(diagnostics, { status: 500 });
  }
}
