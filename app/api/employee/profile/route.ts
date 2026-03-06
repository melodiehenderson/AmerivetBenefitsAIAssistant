export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/unified-auth';
import { USER_ROLES } from '@/lib/constants/roles';
import { getContainer } from '@/lib/azure/cosmos-db';
import { userMetadataSchema } from '@/lib/schemas/user';
import { userService } from '@/lib/services/user.service';
import { logger, logError } from '@/lib/logger';
import { z } from 'zod';

const updateProfileSchema = userMetadataSchema.pick({
  department: true,
  startDate: true,
});

// GET /api/employee/profile - Get employee profile
export const GET = withAuth(USER_ROLES.EMPLOYEE)(
  async (request: NextRequest) => {
    try {
      // Extract user information from headers
      const userId = request.headers.get('x-user-id')!;
      
      const profile = await userService.getUserFromFirestore(userId);

      if (!profile) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      return NextResponse.json(profile);
    } catch (error) {
      logError('Error fetching profile:', error);
      return NextResponse.json(
        { error: 'Failed to fetch profile' },
        { status: 500 },
      );
    }
  },
);

// PATCH /api/employee/profile - Update employee profile
export const PATCH = withAuth(USER_ROLES.EMPLOYEE)(
  async (request: NextRequest) => {
    try {
      // Extract user information from headers
      const userId = request.headers.get('x-user-id')!;
      
      const body = await request.json();
      const validated = updateProfileSchema.parse(body);

      await userService.updateUserMetadata(userId, validated);

      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.issues },
          { status: 400 },
        );
      }

      logError('Error updating profile:', error);
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 },
      );
    }
  },
);

