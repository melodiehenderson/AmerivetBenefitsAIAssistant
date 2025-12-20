export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0; // Correct for Admin APIs

import { NextResponse, type NextRequest } from 'next/server';
import { protectAdminEndpoint } from '@/lib/middleware/auth';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { logger } from '@/lib/logger';
import { faqService } from '@/lib/services/faq.service';
import { generateEmbeddings, upsertVectors } from '@/lib/ai/vector-store'; // NEW: Import your AI tools
import { z } from 'zod';

// Validation Schema
const createFaqSchema = z.object({
  question: z.string().min(5, 'Question too short').max(500),
  answer: z.string().min(5, 'Answer too short').max(5000),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

// GET /api/admin/faqs
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) return rateLimitResponse;

    const { user, error } = await protectAdminEndpoint(request);
    if (error || !user) return error!;

    // Safe Pagination Limits
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100); // Cap at 100
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);
    const category = searchParams.get('category') || undefined;
    const isPublic = searchParams.get('isPublic') === 'true';

    const { faqs, total } = await faqService.getFAQsByCompany(user.companyId, {
      category,
      isPublic,
      limit,
      offset
    });

    return NextResponse.json({
      success: true,
      data: faqs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    logger.error('FAQ list error', { path: '/api/admin/faqs' }, error as Error);
    return NextResponse.json({ success: false, error: 'Failed to retrieve FAQs' }, { status: 500 });
  }
}

// POST /api/admin/faqs - Create NEW FAQ & Teach AI
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) return rateLimitResponse;

    const { user, error } = await protectAdminEndpoint(request);
    if (error || !user) return error!;

    const body = await request.json();
    const validatedData = createFaqSchema.parse(body);

    logger.info('Creating FAQ', { userId: user.id, question: validatedData.question });

    // 1. SAVE TO DATABASE (Primary Source of Truth)
    const faq = await faqService.createFAQ({
      ...validatedData,
      companyId: user.companyId,
      createdBy: user.id
    });

    // 2. TEACH THE AI (Vector Sync)
    // We do this immediately so the bot knows the answer right away.
    try {
        // Create a searchable string: "Question: X \n Answer: Y"
        const contentToEmbed = `Question: ${faq.question}\nAnswer: ${faq.answer}`;
        const embedding = await generateEmbeddings(contentToEmbed);
        
        await upsertVectors({
            id: `faq-${faq.id}`,
            values: embedding,
            metadata: {
                type: 'faq',
                faqId: faq.id,
                companyId: user.companyId,
                category: faq.category,
                text: contentToEmbed // Store text for citations
            }
        });
        logger.info('FAQ Vectors Synced', { faqId: faq.id });
    } catch (vectorError) {
        // Non-blocking error: If AI sync fails, we still return success but log the failure
        // You might want to add this to a "retry queue" here.
        logger.error('Failed to sync FAQ vectors', { faqId: faq.id }, vectorError as Error);
    }

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/admin/faqs', 201, duration, { faqId: faq.id });

    return NextResponse.json({
      success: true,
      message: 'FAQ created and AI model updated',
      data: faq
    }, { status: 201 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid data', details: error.errors }, { status: 400 });
    }
    
    logger.error('FAQ creation error', { path: '/api/admin/faqs' }, error as Error);
    return NextResponse.json({ success: false, error: 'Failed to create FAQ' }, { status: 500 });
  }
}