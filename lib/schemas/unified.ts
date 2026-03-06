/**
 * Unified Schema System
 * Single source of truth for all data models across the application
 */

import { z } from 'zod';

// Base document schema for all entities
export const baseDocumentSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive().default(1),
});

// User roles enum
export const userRoleSchema = z.enum([
  'super-admin',
  'platform-admin', 
  'company-admin',
  'hr-admin',
  'employee',
  'contractor'
]);

// User status enum
export const userStatusSchema = z.enum([
  'active',
  'inactive', 
  'suspended',
  'pending'
]);

// Company status enum
export const companyStatusSchema = z.enum([
  'active',
  'inactive',
  'suspended',
  'trial'
]);

// Unified User Schema
export const userSchema = baseDocumentSchema.extend({
  // Core identity
  email: z.string().email('Invalid email address'),
  displayName: z.string().min(1, 'Display name is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  
  // Authentication & Authorization
  roles: z.array(userRoleSchema).min(1, 'At least one role is required'),
  status: userStatusSchema.default('active'),
  companyId: z.string().min(1, 'Company ID is required'),
  
  // Profile information
  phoneNumber: z.string().optional(),
  photoURL: z.string().url().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  hireDate: z.string().datetime().optional(),
  location: z.string().optional(),
  
  // System fields
  lastLoginAt: z.string().datetime().optional(),
  emailVerified: z.boolean().default(false),
  onboardingCompleted: z.boolean().default(false),
  onboardingProgress: z.number().min(0).max(100).default(0),
  
  // Benefits & Preferences
  benefitsInterests: z.array(z.string()).default([]),
  benefitsSelections: z.record(z.string(), z.any()).optional(),
  preferences: z.object({
    notifications: z.boolean().default(true),
    language: z.string().default('en'),
    timezone: z.string().default('UTC'),
    theme: z.enum(['light', 'dark', 'auto']).default('auto'),
    chatModel: z.string().default('gpt-3.5-turbo'),
  }).default(() => ({
    notifications: true,
    language: 'en',
    timezone: 'UTC',
    theme: 'auto' as const,
    chatModel: 'gpt-3.5-turbo',
  })),
  
  // Metadata
  metadata: z.record(z.string(), z.any()).optional(),
});

// Unified Company Schema
export const companySchema = baseDocumentSchema.extend({
  name: z.string().min(1, 'Company name is required'),
  status: companyStatusSchema.default('active'),
  
  // Contact information
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().default('US'),
  }).optional(),
  
  // Configuration
  settings: z.object({
    branding: z.object({
      logo: z.string().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      fontFamily: z.string().optional(),
    }).optional(),
    features: z.object({
      sso: z.boolean().default(false),
      analytics: z.boolean().default(true),
      documentUpload: z.boolean().default(true),
      benefitsComparison: z.boolean().default(true),
      adminPortal: z.boolean().default(true),
    }).default(() => ({
      sso: false,
      analytics: true,
      documentUpload: true,
      benefitsComparison: true,
      adminPortal: true,
    })),
    workday: z.object({
      tenantId: z.string().optional(),
      ssoConfig: z.object({
        issuer: z.string().optional(),
        ssoUrl: z.string().optional(),
        certificate: z.string().optional(),
        jwksUrl: z.string().optional(),
      }).optional(),
    }).optional(),
  }).default(() => ({
    features: {
      sso: false,
      analytics: true,
      documentUpload: true,
      benefitsComparison: true,
      adminPortal: true,
    },
  })),
  
  // Benefits data
  benefitsData: z.object({
    openEnrollment: z.object({
      year: z.string(),
      startDate: z.string().datetime(),
      endDate: z.string().datetime(),
      effectiveDate: z.string().datetime(),
    }).optional(),
    plans: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      provider: z.string(),
      coverageYear: z.object({
        start: z.string().datetime(),
        end: z.string().datetime(),
      }),
      premiums: z.object({
        employee: z.object({
          monthly: z.number(),
          biweekly: z.number(),
        }),
        employer: z.object({
          monthly: z.number(),
          biweekly: z.number(),
        }).optional(),
      }),
      coverage: z.any().optional(),
      features: z.array(z.string()).default([]),
      exclusions: z.array(z.string()).default([]),
    })).default([]),
  }).optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.any()).optional(),
});

// Benefit Plan Schema
export const benefitPlanSchema = baseDocumentSchema.extend({
  name: z.string().min(1, 'Benefit plan name is required'),
  description: z.string().optional(),
  type: z.enum(['health', 'dental', 'vision', '401k', 'hsa', 'other']),
  provider: z.string().min(1, 'Provider name is required'),
  companyId: z.string().min(1, 'Company ID is required'),
  
  // Coverage details
  coverageTier: z.array(z.object({
    name: z.string(),
    cost: z.number().positive(),
    description: z.string().optional(),
  })).min(1, 'At least one coverage tier is required'),
  
  // Eligibility
  eligibility: z.object({
    employeeType: z.enum(['full-time', 'part-time', 'contractor', 'all']),
    minHoursPerWeek: z.number().min(0).optional(),
    regions: z.array(z.string()).min(1, 'At least one region is required'),
    waitingPeriod: z.string().optional(),
  }),
  
  // Enrollment periods
  openEnrollmentStart: z.string().datetime(),
  openEnrollmentEnd: z.string().datetime(),
  effectiveDate: z.string().datetime(),
  
  // Status
  isActive: z.boolean().default(true),
  
  // Metadata
  metadata: z.record(z.string(), z.any()).optional(),
});

// Document Schema
export const documentSchema = baseDocumentSchema.extend({
  title: z.string().min(1, 'Document title is required'),
  fileName: z.string().min(1, 'File name is required'),
  fileType: z.string().min(1, 'File type is required'),
  fileSize: z.number().min(0, 'File size must be positive'),
  companyId: z.string().min(1, 'Company ID is required'),
  uploadedBy: z.string().min(1, 'Uploader ID is required'),
  
  // Storage
  storagePath: z.string().optional(),
  storageUrl: z.string().url().optional(),
  
  // Processing
  documentType: z.enum(['benefits_guide', 'policy', 'form', 'other']).default('benefits_guide'),
  status: z.enum(['pending', 'processing', 'processed', 'error']).default('pending'),
  chunkCount: z.number().optional(),
  ragProcessed: z.boolean().default(false),
  error: z.string().optional(),
  
  // Content
  content: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).default([]),
  
  // Metadata
  metadata: z.record(z.string(), z.any()).optional(),
});

// Conversation Schema
export const conversationSchema = baseDocumentSchema.extend({
  userId: z.string().min(1, 'User ID is required'),
  companyId: z.string().min(1, 'Company ID is required'),
  title: z.string().optional(),
  
  // Messages
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.string().datetime(),
    metadata: z.record(z.string(), z.any()).optional(),
  })).default([]),
  
  // Status
  status: z.enum(['active', 'archived', 'deleted']).default('active'),
  
  // Analytics
  messageCount: z.number().int().min(0).default(0),
  lastMessageAt: z.string().datetime().optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.any()).optional(),
});

// FAQ Schema
export const faqSchema = baseDocumentSchema.extend({
  question: z.string().min(1, 'Question is required'),
  answer: z.string().min(1, 'Answer is required'),
  companyId: z.string().min(1, 'Company ID is required'),
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  viewCount: z.number().int().min(0).default(0),
  helpfulCount: z.number().int().min(0).default(0),
  notHelpfulCount: z.number().int().min(0).default(0),
  
  // Metadata
  metadata: z.record(z.string(), z.any()).optional(),
});

// Type exports
export type User = z.infer<typeof userSchema>;
export type Company = z.infer<typeof companySchema>;
export type BenefitPlan = z.infer<typeof benefitPlanSchema>;
export type Document = z.infer<typeof documentSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type FAQ = z.infer<typeof faqSchema>;

// Input schemas for API validation
export const createUserSchema = userSchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const updateUserSchema = userSchema.partial().omit({ 
  id: true, 
  createdAt: true 
});

export const createCompanySchema = companySchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const updateCompanySchema = companySchema.partial().omit({ 
  id: true, 
  createdAt: true 
});

export const createBenefitPlanSchema = benefitPlanSchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const updateBenefitPlanSchema = benefitPlanSchema.partial().omit({ 
  id: true, 
  createdAt: true 
});

export const createDocumentSchema = documentSchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const updateDocumentSchema = documentSchema.partial().omit({ 
  id: true, 
  createdAt: true 
});

export const createConversationSchema = conversationSchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const updateConversationSchema = conversationSchema.partial().omit({ 
  id: true, 
  createdAt: true 
});

export const createFaqSchema = faqSchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const updateFaqSchema = faqSchema.partial().omit({ 
  id: true, 
  createdAt: true 
});
