export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { type NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth/unified-auth';
import { z } from 'zod';
import { updateUserSchema } from '@/lib/validation/schemas';
import { getContainer } from '@/lib/azure/cosmos-db';
import { isValidRole, type UserRole } from '@/lib/constants/roles';
import { userService } from '@/lib/services/user-service';

// PUT /api/super-admin/users/[id] - Update a user
export const PUT = requireSuperAdmin(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const validated = updateUserSchema.parse(body);
      const { role, ...metadata } = validated;

      if (role) {
        await userService.updateUserRole(id, role as UserRole);
      }
      if (Object.keys(metadata).length > 0) {
        await userService.updateUser(id, metadata as any);
      }
      const updatedUser = await userService.getUserById(id);
      return NextResponse.json(updatedUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.issues },
          { status: 400 },
        );
      }
      console.error('Error updating user:', error);
      return NextResponse.json(
        { error: 'Failed to update user' },
        { status: 500 },
      );
    }
  },
);

// DELETE /api/super-admin/users/[id] - Delete a user
export const DELETE = requireSuperAdmin(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      await userService.deleteUser(id);
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Error deleting user:', error);
      return NextResponse.json(
        { error: 'Failed to delete user' },
        { status: 500 },
      );
    }
  },
);

export const PATCH = requireSuperAdmin(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const schema = z.object({ type: z.string() });
      const { type } = schema.parse(body);
      if (!isValidRole(type)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }

      await userService.updateUserRole(id, type as UserRole);
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.issues },
          { status: 400 },
        );
      }
      console.error('Error updating user role:', error);
      return NextResponse.json(
        { error: 'Failed to update user role' },
        { status: 500 },
      );
    }
  },
);
