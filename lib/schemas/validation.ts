/**
 * Schema Validation System
 * Centralized validation for all data models
 */

import { z } from 'zod';
import { userSchema, companySchema, documentSchema } from './unified';

// Validation middleware
export function validateSchema<T>(schema: z.ZodSchema<T>) {
  return (data: unknown): { success: true; data: T } | { success: false; error: string } => {
    try {
      const validatedData = schema.parse(data);
      return { success: true, data: validatedData };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = error.issues
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        return { success: false, error: errorMessage };
      }
      return { success: false, error: 'Validation failed' };
    }
  };
}

// User validation
export const validateUser = validateSchema(userSchema);
export const validateCompany = validateSchema(companySchema);
export const validateDocument = validateSchema(documentSchema);

// API request validation
export const validateAPIRequest = <T>(schema: z.ZodSchema<T>) => {
  return (data: unknown): T => {
    const result = validateSchema(schema)(data);
    if (!result.success) {
      throw new Error(`Validation error: ${result.error}`);
    }
    return result.data;
  };
};

// Common validation schemas
export const paginationSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const searchSchema = z.object({
  query: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  ...paginationSchema.shape
});

export const fileUploadSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().positive(),
  category: z.string().optional().default('benefits'),
  tags: z.array(z.string()).optional().default([])
});

// Export validation functions
export const validatePagination = validateSchema(paginationSchema);
export const validateSearch = validateSchema(searchSchema);
export const validateFileUpload = validateSchema(fileUploadSchema);
