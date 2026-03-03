export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/unified-auth';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/azure/cosmos';
import { emailService } from '@/lib/services/email.service';
import { z } from 'zod';

const bulkActionSchema = z.object({
  action: z.enum(['activate', 'deactivate', 'send_email', 'export', 'delete']),
  employeeIds: z.array(z.string()).min(1, 'At least one employee must be selected'),
  companyId: z.string().min(1, 'Company ID is required'),
  emailType: z.enum(['welcome', 'reminder', 'notification']).optional(),
  emailSubject: z.string().optional(),
  emailMessage: z.string().optional(),
});

export const POST = requireCompanyAdmin(async (request: NextRequest) => {
  const startTime = Date.now();
  try {
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) return rateLimitResponse;

    const userId = request.headers.get('x-user-id')!;
    const headerCompanyId = request.headers.get('x-company-id')!; // Use this for security check if needed

    const body = await request.json();
    const validatedData = bulkActionSchema.parse(body);

    const { action, employeeIds, companyId, emailType, emailSubject, emailMessage } = validatedData;

    logger.info('Bulk action initiated', {
      userId,
      companyId,
      action,
      employeeCount: employeeIds.length
    });

    const repositories = await getRepositories();
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
      data: undefined as string | undefined // Used for export
    };

    switch (action) {
      case 'activate':
        await handleBulkActivate(employeeIds, companyId, repositories, results);
        break;
      case 'deactivate':
        await handleBulkDeactivate(employeeIds, companyId, repositories, results);
        break;
      case 'send_email':
        await handleBulkEmail(employeeIds, companyId, emailType!, emailSubject, emailMessage, repositories, results);
        break;
      case 'export':
        await handleBulkExport(employeeIds, companyId, repositories, results);
        break;
      case 'delete':
        await handleBulkDelete(employeeIds, companyId, repositories, results);
        break;
      default:
        return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/admin/bulk-actions', 200, duration, {
      userId,
      companyId,
      action,
      results: { ...results, data: results.data ? '[CSV CONTENT]' : undefined } // Don't log full CSV
    });

    return NextResponse.json({
      success: true,
      message: `Bulk ${action} completed`,
      results
    });

  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.issues },
        { status: 400 }
      );
    }

    logger.error('Bulk action error', {
      path: request.nextUrl.pathname,
      method: request.method,
      duration
    }, error as Error);

    return NextResponse.json(
      { success: false, error: 'Failed to process bulk action' },
      { status: 500 }
    );
  }
});

// ============================================================================
// BULK HANDLERS (Optimized with Promise.all)
// ============================================================================

async function handleBulkActivate(
  employeeIds: string[],
  companyId: string,
  repositories: any,
  results: { success: number; failed: number; errors: string[] }
) {
  const promises = employeeIds.map(async (employeeId) => {
    try {
      await repositories.users.update(employeeId, {
        isActive: true,
        updatedAt: new Date()
      }, companyId);
      return { success: true };
    } catch (error) {
      return { success: false, id: employeeId, error: (error as Error).message };
    }
  });

  const outcomes = await Promise.all(promises);
  outcomes.forEach(o => {
    if (o.success) results.success++;
    else {
      results.failed++;
      results.errors.push(`Failed to activate ${o.id}: ${o.error}`);
    }
  });
}

async function handleBulkDeactivate(
  employeeIds: string[],
  companyId: string,
  repositories: any,
  results: { success: number; failed: number; errors: string[] }
) {
  const promises = employeeIds.map(async (employeeId) => {
    try {
      await repositories.users.update(employeeId, {
        isActive: false,
        updatedAt: new Date()
      }, companyId);
      return { success: true };
    } catch (error) {
      return { success: false, id: employeeId, error: (error as Error).message };
    }
  });

  const outcomes = await Promise.all(promises);
  outcomes.forEach(o => {
    if (o.success) results.success++;
    else {
      results.failed++;
      results.errors.push(`Failed to deactivate ${o.id}: ${o.error}`);
    }
  });
}

async function handleBulkEmail(
  employeeIds: string[],
  companyId: string,
  emailType: string,
  emailSubject: string | undefined,
  emailMessage: string | undefined,
  repositories: any,
  results: { success: number; failed: number; errors: string[] }
) {
  const subject = emailSubject || `Welcome to ${companyId} Benefits Assistant`;
  const message = emailMessage || `Welcome to your company's benefits assistant!`;

  const promises = employeeIds.map(async (employeeId) => {
    try {
      const employee = await repositories.users.getById(employeeId, companyId);
      if (!employee || !employee.email) {
        return { success: false, id: employeeId, error: 'Employee not found or no email' };
      }

      await emailService.sendEmail({
        to: employee.email,
        subject,
        textContent: message
      });

      return { success: true };
    } catch (error) {
      return { success: false, id: employeeId, error: (error as Error).message };
    }
  });

  const outcomes = await Promise.all(promises);
  outcomes.forEach(o => {
    if (o.success) results.success++;
    else {
      results.failed++;
      results.errors.push(`Failed to email ${o.id}: ${o.error}`);
    }
  });
}

async function handleBulkExport(
  employeeIds: string[],
  companyId: string,
  repositories: any,
  results: { success: number; failed: number; errors: string[]; data?: string }
) {
  try {
    // Fetch all requested employees in parallel
    const promises = employeeIds.map(id => repositories.users.getById(id, companyId));
    const employees = (await Promise.all(promises)).filter(e => e !== null);

    if (employees.length === 0) {
      results.errors.push('No valid employees found to export');
      return;
    }

    // Convert to CSV
    results.data = convertEmployeesToCSV(employees);
    results.success = employees.length;
    results.failed = employeeIds.length - employees.length;

  } catch (error) {
    results.failed = employeeIds.length;
    results.errors.push(`Export failed: ${(error as Error).message}`);
  }
}

async function handleBulkDelete(
  employeeIds: string[],
  companyId: string,
  repositories: any,
  results: { success: number; failed: number; errors: string[] }
) {
  const promises = employeeIds.map(async (employeeId) => {
    try {
      await repositories.users.delete(employeeId, companyId);
      return { success: true };
    } catch (error) {
      return { success: false, id: employeeId, error: (error as Error).message };
    }
  });

  const outcomes = await Promise.all(promises);
  outcomes.forEach(o => {
    if (o.success) results.success++;
    else {
      results.failed++;
      results.errors.push(`Failed to delete ${o.id}: ${o.error}`);
    }
  });
}

// Helper: CSV Generator
function convertEmployeesToCSV(employees: any[]): string {
  if (employees.length === 0) return '';

  const headers = ['ID', 'Name', 'Email', 'Role', 'Status', 'Department', 'Created At'];
  const rows = employees.map(emp => [
    emp.id,
    emp.displayName || emp.name || '',
    emp.email,
    emp.role,
    emp.isActive ? 'Active' : 'Inactive',
    emp.department || 'N/A',
    emp.createdAt ? new Date(emp.createdAt).toISOString() : ''
  ]);

  return [headers, ...rows]
    .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}