/**
 * Shared password authentication for subdomain deployment
 * Simple authentication system using shared password for demo/testing purposes
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { logger } from '@/lib/logger';

export interface SharedPasswordUser {
  id: string;
  email: string;
  name: string;
  companyId: string;
  roles: string[];
  permissions: string[];
  isSharedPassword: boolean;
}
export interface SharedPasswordAuthResult {
  user: SharedPasswordUser | null;
  error: NextResponse | null;
  isAuthenticated: boolean;
}
export class SharedPasswordAuth {

  private static readonly SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
  
  // Track failed authentication attempts by IP
  private static failedAttempts = new Map<string, { count: number; lastAttempt: number }>();

  /**
   * Hash password using SHA-256
   */
  private static hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  /**
   * Verify password against hash
   */
  private static verifyPassword(password: string, hash: string): boolean {
    const passwordHash = this.hashPassword(password);
    return timingSafeEqual(Buffer.from(passwordHash), Buffer.from(hash));
  }

  /**
   * Authenticate with shared password
   */
  static async authenticateWithPassword(
    request: NextRequest,
    password: string,
    userInfo?: {
      email?: string;
      name?: string;
      companyId?: string;
    }
  ): Promise<SharedPasswordAuthResult> {
    try {
      // Check rate limiting for password attempts
      const rateLimitResult = await this.checkPasswordRateLimit(request);
      if (!rateLimitResult.allowed) {
        return {
          user: null,
          error: NextResponse.json(
            { 
              error: 'Too many password attempts. Please try again later.',
              code: 'RATE_LIMIT_EXCEEDED',
              retryAfter: rateLimitResult.retryAfter
            },
            { status: 429 }
          ),
          isAuthenticated: false,
        };
      }

      // Dual password system: Employee vs Admin — read from env, never hardcoded
      const EMPLOYEE_PASSWORD = (process.env.EMPLOYEE_PASSWORD ?? '').trim();
      const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD ?? '').trim();

      if (!EMPLOYEE_PASSWORD || !ADMIN_PASSWORD) {
        logger.error('EMPLOYEE_PASSWORD or ADMIN_PASSWORD environment variable not set');
        return {
          user: null,
          error: NextResponse.json(
            { error: 'Server configuration error' },
            { status: 500 }
          ),
          isAuthenticated: false,
        };
      }
      
      let userRole: 'employee' | 'admin' | null = null;
      let userPermissions: string[] = [];

      if (password === EMPLOYEE_PASSWORD) {
        userRole = 'employee';
        userPermissions = ['VIEW_BENEFITS', 'USE_CHAT', 'COMPARE_PLANS', 'VIEW_DOCUMENTS'];
      } else if (password === ADMIN_PASSWORD) {
        userRole = 'admin';
        userPermissions = [
          'VIEW_BENEFITS', 'USE_CHAT', 'COMPARE_PLANS', 'VIEW_DOCUMENTS',
          'VIEW_ANALYTICS', 'MANAGE_CONTENT', 'MONITOR_COSTS', 
          'MANAGE_USERS', 'CONFIGURE_SYSTEM', 'VIEW_QUALITY_METRICS'
        ];
      } else {
        // Invalid password
        await this.recordFailedAttempt(request);
        return {
          user: null,
          error: NextResponse.json(
            { error: 'Invalid password' },
            { status: 401 }
          ),
          isAuthenticated: false,
        };
      }

      // Create user session with role-based permissions
      const user: SharedPasswordUser = {
        id: `${userRole}-${Date.now()}`,
        email: userInfo?.email || `${userRole}@amerivet.com`,
        name: userInfo?.name || (userRole === 'admin' ? 'AmeriVet Admin' : 'AmeriVet Employee'),
        companyId: userInfo?.companyId || 'amerivet',
        roles: [userRole],
        permissions: userPermissions,
        isSharedPassword: true,
      };

      // Create session token
      const sessionToken = await this.createSessionToken(user);

      // Set session cookie
      const response = NextResponse.json(
        { 
          success: true, 
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            companyId: user.companyId,
            roles: user.roles,
            permissions: user.permissions,
          }
        },
        { status: 200 }
      );

      response.cookies.set('shared-session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: this.SESSION_DURATION / 1000,
        path: '/',
      });

      // Clear failed attempts on successful login
      await this.clearFailedAttempts(request);

      logger.info('Shared password authentication successful', {
        userId: user.id,
        email: user.email,
        companyId: user.companyId,
      });

      return {
        user,
        error: response,  // Return the response object here for successful auth
        isAuthenticated: true,
      };

    } catch (error) {
      logger.error('Shared password authentication failed', error);
      return {
        user: null,
        error: NextResponse.json(
          { error: 'Authentication failed' },
          { status: 500 }
        ),
        isAuthenticated: false,
      };
    }
  }

  /**
   * Validate session token
   */
  static async validateSession(request: NextRequest): Promise<SharedPasswordAuthResult> {
    try {
      const sessionToken = request.cookies.get('shared-session')?.value;
      
      if (!sessionToken) {
        return {
          user: null,
          error: NextResponse.json(
            { error: 'No session found' },
            { status: 401 }
          ),
          isAuthenticated: false,
        };
      }

      // Verify session token
      const user = await this.verifySessionToken(sessionToken);
      
      if (!user) {
        return {
          user: null,
          error: NextResponse.json(
            { error: 'Invalid or expired session' },
            { status: 401 }
          ),
          isAuthenticated: false,
        };
      }

      return {
        user,
        error: null,
        isAuthenticated: true,
      };

    } catch (error) {
      logger.error('Session validation failed', error);
      return {
        user: null,
        error: NextResponse.json(
          { error: 'Session validation failed' },
          { status: 500 }
        ),
        isAuthenticated: false,
      };
    }
  }

  /**
   * Create session token
   */
  private static async createSessionToken(user: SharedPasswordUser): Promise<string> {
    const payload = {
      userId: user.id,
      email: user.email,
      companyId: user.companyId,
      roles: user.roles,
      permissions: user.permissions,
      isSharedPassword: true,
      exp: Date.now() + this.SESSION_DURATION,
      iat: Date.now(),
    };

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', jwtSecret)
      .update(`${header}.${payloadB64}`)
      .digest('base64url');

    return `${header}.${payloadB64}.${signature}`;
  }

  /**
   * Verify session token
   */
  private static async verifySessionToken(token: string): Promise<SharedPasswordUser | null> {
    try {
      const [header, payload, signature] = token.split('.');
      
      if (!header || !payload || !signature) {
        return null;
      }

      // Verify signature
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return null;
      }
      const expectedSignature = createHmac('sha256', jwtSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return null;
      }

      // Parse payload
      const payloadData = JSON.parse(Buffer.from(payload, 'base64url').toString());
      
      // Check expiration
      if (payloadData.exp < Date.now()) {
        return null;
      }

      return {
        id: payloadData.userId,
        email: payloadData.email,
        name: payloadData.name || payloadData.email,
        companyId: payloadData.companyId,
        roles: payloadData.roles || ['employee'],
        permissions: payloadData.permissions || ['VIEW_BENEFITS'],
        isSharedPassword: true,
      };

    } catch (error) {
      logger.error('Token verification failed', error);
      return null;
    }
  }

  /**
   * Check password attempt rate limiting
   */
  private static async checkPasswordRateLimit(request: NextRequest): Promise<{
    allowed: boolean;
    retryAfter?: number;
  }> {
    const ip = this.getClientIP(request);

    
    // This would typically use Redis, but for simplicity, we'll use a simple in-memory store
    // In production, implement proper Redis-based rate limiting
    const attempts = this.getFailedAttempts(ip);
    
    if (attempts >= this.MAX_ATTEMPTS) {
      const lastAttempt = this.getLastAttemptTime(ip);
      const timeSinceLastAttempt = Date.now() - lastAttempt;
      
      if (timeSinceLastAttempt < this.LOCKOUT_DURATION) {
        return {
          allowed: false,
          retryAfter: Math.ceil((this.LOCKOUT_DURATION - timeSinceLastAttempt) / 1000),
        };
      } else {
        // Reset attempts after lockout period
        this.clearFailedAttempts(request);
      }
    }

    return { allowed: true };
  }

  /**
   * Record failed password attempt
   */
  private static async recordFailedAttempt(request: NextRequest): Promise<void> {
    const ip = this.getClientIP(request);
    this.incrementFailedAttempts(ip);
  }

  /**
   * Clear failed attempts
   */
  private static async clearFailedAttempts(request: NextRequest): Promise<void> {
    const ip = this.getClientIP(request);
    this.resetFailedAttempts(ip);
  }

  /**
   * Get client IP address
   */
  private static getClientIP(request: NextRequest): string {
    return (
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'unknown'
    );
  }

  // Simple in-memory storage for demo purposes
  // In production, use Redis or database


  private static getFailedAttempts(ip: string): number {
    const attempts = this.failedAttempts.get(ip);
    return attempts?.count || 0;
  }

  private static getLastAttemptTime(ip: string): number {
    const attempts = this.failedAttempts.get(ip);
    return attempts?.lastAttempt || 0;
  }

  private static incrementFailedAttempts(ip: string): void {
    const attempts = this.failedAttempts.get(ip) || { count: 0, lastAttempt: 0 };
    attempts.count += 1;
    attempts.lastAttempt = Date.now();
    this.failedAttempts.set(ip, attempts);
  }

  private static resetFailedAttempts(ip: string): void {
    this.failedAttempts.delete(ip);
  }

  /**
   * Logout user
   */
  static logout(): NextResponse {
    const response = NextResponse.json({ success: true });
    response.cookies.delete('shared-session');
    return response;
  }
}
