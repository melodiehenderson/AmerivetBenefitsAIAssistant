export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth/unified-auth';
import { companyService } from '@/lib/services/company-service';
import { logger, logError } from '@/lib/logger';

export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    // Extract user info from headers (set by withAdminAuth middleware)
    const userId = request.headers.get('x-user-id');
    const userEmail = request.headers.get('x-user-email');
    const userCompanyId = request.headers.get('x-company-id');

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');

    const companies = await companyService.getCompanies({
      page,
      limit,
      adminId: userId || undefined
    });

    return NextResponse.json({ companies });

  } catch (error) {
    logError('Error fetching companies', error as Error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    // Extract user info from headers (set by withAdminAuth middleware)
    const userId = request.headers.get('x-user-id');
    const userEmail = request.headers.get('x-user-email');
    const userCompanyId = request.headers.get('x-company-id');
    
    const body = await request.json();

    const company = await companyService.createCompany({
      ...body,
      createdBy: userId
    });

    return NextResponse.json({ company }, { status: 201 });

  } catch (error) {
    logError('Error creating company', error as Error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

