export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { protectAdminEndpoint } from '@/lib/middleware/auth';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/azure/cosmos';

// GET /api/admin/users
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // 1. Rate Limiting
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) return rateLimitResponse;

    // 2. Auth & Role Check
    const { user, error } = await protectAdminEndpoint(request);
    if (error || !user) return error!;

    // 3. Parse Query Parameters (Pagination & Search)
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20'))); // Cap at 100
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status');

    logger.info('API Request: List Users', { userId: user.id, page, limit });

    // 4. Construct DB Query (The Optimized Part)
    // We determine the target Company ID effectively.
    // If Super Admin AND no company filter provided -> Query All (Careful!)
    // Otherwise -> Enforce User's Company ID
    let targetCompanyId = user.companyId;
    
    if (user.roles.includes('super-admin') && searchParams.get('companyId')) {
       targetCompanyId = searchParams.get('companyId')!;
    }

    const repositories = await getRepositories();

    // 5. Execute Efficient Query
    // Note: repositories.users.query() should accept SQL-like parameters
    // Query: "SELECT * FROM c WHERE c.companyId = @companyId ..."
    const querySpec = {
      query: `
        SELECT * FROM c 
        WHERE c.companyId = @companyId
        ${status ? 'AND c.status = @status' : ''}
        ${search ? 'AND (CONTAINS(c.displayName, @search, true) OR CONTAINS(c.email, @search, true))' : ''}
        ORDER BY c.createdAt DESC
        OFFSET @offset LIMIT @limit
      `,
      parameters: [
        { name: '@companyId', value: targetCompanyId },
        { name: '@status', value: status },
        { name: '@search', value: search },
        { name: '@offset', value: (page - 1) * limit },
        { name: '@limit', value: limit }
      ].filter(p => p.value !== undefined && p.value !== '')
    };

    // Parallelize "Get Data" and "Get Total Count" for UI pagination
    const [users, countResult] = await Promise.all([
      repositories.users.query(querySpec),
      repositories.users.count(targetCompanyId, { search, status }) // Optimized count query
    ]);

    // 6. Safe Mapping
    const safeUsers = users.map((u: any) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      roles: u.roles,
      status: u.status,
      createdAt: u.createdAt,
      lastActive: u.lastActive
    }));

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/admin/users', 200, duration, { count: safeUsers.length });

    return NextResponse.json({
      success: true,
      data: {
        users: safeUsers,
        pagination: {
          total: countResult,
          page,
          limit,
          pages: Math.ceil(countResult / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Users list error', { path: '/api/admin/users' }, error as Error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve users' },
      { status: 500 }
    );
  }
}