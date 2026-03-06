import { describe, it, expect, beforeEach } from 'vitest';
import {
  storeRefreshToken,
  verifyRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  clearAllTokens,
} from '../lib/auth/refresh-tokens';

const userId = 'user123';

describe('Refresh token flows', () => {
  beforeEach(async () => {
    await clearAllTokens();
  });

  it('rotates refresh tokens', async () => {
    const oldToken = 'old-token';
    const newToken = 'new-token';
    const companyId = 'amerivet';
    await storeRefreshToken(userId, companyId, oldToken, 60);
    const valid = await verifyRefreshToken(oldToken);
    expect(valid).not.toBeNull();
    const rotated = await rotateRefreshToken(oldToken, newToken, userId, 60);
    expect(rotated).toBe(true);
    const oldCheck = await verifyRefreshToken(oldToken);
    expect(oldCheck).toBeNull();
    const newCheck = await verifyRefreshToken(newToken);
    expect(newCheck?.userId).toBe(userId);
  });

  it('revokes refresh tokens', async () => {
    const token = 'temp-token';
    const companyId = 'amerivet';
    await storeRefreshToken(userId, companyId, token, 60);
    await revokeRefreshToken(token);
    const check = await verifyRefreshToken(token);
    expect(check).toBeNull();
  });
});
