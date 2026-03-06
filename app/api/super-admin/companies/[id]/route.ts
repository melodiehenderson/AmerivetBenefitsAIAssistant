export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { type NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth/unified-auth';
import { SuperAdminService } from '@/lib/services/super-admin.service';
import { logger, logError } from '@/lib/logger';
import { z } from 'zod';
import { updateCompanySchema } from '@/lib/validation/schemas';

const superAdminService = new SuperAdminService();

// PUT /api/super-admin/companies/[id] - Update a company
export const PUT = requireSuperAdmin(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const validated = updateCompanySchema.parse(body);
      const company = await superAdminService.updateCompany(id, validated);
      return NextResponse.json({
        message: 'Company updated successfully',
        company
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.issues },
          { status: 400 },
        );
      }
      logError('Error updating company:', error as Error);
      return NextResponse.json(
        { error: 'Failed to update company' },
        { status: 500 },
      );
    }
  },
);

// DELETE /api/super-admin/companies/[id] - Delete a company
export const DELETE = requireSuperAdmin(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      await superAdminService.deleteCompany(id);
      return NextResponse.json({
        message: 'Company and all associated data deleted successfully',
      });
    } catch (error) {
      logError('Error deleting company:', error as Error);
      return NextResponse.json(
        { error: 'Failed to delete company' },
        { status: 500 },
      );
    }
  },
);
