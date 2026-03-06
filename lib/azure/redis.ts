import type Redis from 'ioredis';
import { isBuild } from '@/lib/runtime/is-build';
import { DISABLE_AZURE } from '@/lib/runtime/feature-flags';
import { getRedisConfig } from './config';
import { logger } from '@/lib/logger';

let redis: Redis | null = null;

export async function getRedis(): Promise<Redis | null> {
  if (isBuild || DISABLE_AZURE) return null;
  if (redis) return redis;
  
  const redisConfig = getRedisConfig();
  if (!redisConfig.host || !redisConfig.password) {
    logger.warn('Redis not configured, falling back to in-memory cache', {});
    return null;
  }

  const { default: RedisClass } = await import('ioredis');
  redis = new RedisClass({
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    tls: redisConfig.tls,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  redis.on('connect', () => {
    logger.info('Connected to Azure Cache for Redis', {
      host: redisConfig.host,
      port: redisConfig.port
    });
  });

  redis.on('error', (error) => {
    logger.error('Redis connection error', {
      host: redisConfig.host,
      port: redisConfig.port
    }, error as Error);
  });

  redis.on('close', () => {
    logger.warn('Redis connection closed', {
      host: redisConfig.host,
      port: redisConfig.port
    });
  });
  
  return redis;
}

// Redis service class
export class RedisService {
  private async requireClient(): Promise<Redis> {
    const client = await getRedis();
    if (!client) throw new Error('Redis client not available');
    return client;
  }

  async get(key: string): Promise<string | null> {
    const client = await getRedis();
    if (!client) return null;
    try {
      const value = await client.get(key);
      logger.debug('Redis GET operation', { key, found: value !== null });
      return value;
    } catch (error) {
      logger.error('Redis GET operation failed', { key }, error as Error);
      throw error;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = await getRedis();
    if (!client) {
      logger.warn('Redis SET skipped - no client available', { key });
      return; // Silent return, let filesystem fallback handle it
    }
    try {
      if (ttlSeconds) {
        await client.setex(key, ttlSeconds, value);
      } else {
        await client.set(key, value);
      }
      logger.debug('Redis SET operation', { key, ttlSeconds });
    } catch (error) {
      logger.error('Redis SET operation failed', { key, ttlSeconds }, error as Error);
      throw error;
    }
  }

  async del(key: string): Promise<number> {
    const client = await getRedis();
    if (!client) {
      logger.warn('Redis DEL skipped - no client available', { key });
      return 0;
    }
    try {
      const result = await client.del(key);
      logger.debug('Redis DEL operation', { key, deletedCount: result });
      return result;
    } catch (error) {
      logger.error('Redis DEL operation failed', { key }, error as Error);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    const client = await getRedis();
    if (!client) return false;
    try {
      const result = await client.exists(key);
      logger.debug('Redis EXISTS operation', { key, exists: result === 1 });
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS operation failed', { key }, error as Error);
      throw error;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const client = await getRedis();
    if (!client) return false;
    try {
      const result = await client.expire(key, ttlSeconds);
      logger.debug('Redis EXPIRE operation', { key, ttlSeconds, success: result === 1 });
      return result === 1;
    } catch (error) {
      logger.error('Redis EXPIRE operation failed', { key, ttlSeconds }, error as Error);
      throw error;
    }
  }

  async ttl(key: string): Promise<number> {
    const client = await getRedis();
    if (!client) return -2; // Key doesn't exist
    try {
      const result = await client.ttl(key);
      logger.debug('Redis TTL operation', { key, ttl: result });
      return result;
    } catch (error) {
      logger.error('Redis TTL operation failed', { key }, error as Error);
      throw error;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    const client = await getRedis();
    if (!client) return [];
    try {
      const result = await client.keys(pattern);
      logger.debug('Redis KEYS operation', { pattern, count: result.length });
      return result;
    } catch (error) {
      logger.error('Redis KEYS operation failed', { pattern }, error as Error);
      throw error;
    }
  }

  async flushdb(): Promise<void> {
    const client = await getRedis();
    if (!client) return;
    try {
      await client.flushdb();
      logger.info('Redis database flushed', {});
    } catch (error) {
      logger.error('Redis FLUSHDB operation failed', {}, error as Error);
      throw error;
    }
  }

  async info(section?: string): Promise<string> {
    const client = await getRedis();
    if (!client) return 'Redis not available';
    try {
      const result = await client.info(section || '');
      logger.debug('Redis INFO operation', { section });
      return result;
    } catch (error) {
      logger.error('Redis INFO operation failed', { section }, error as Error);
      throw error;
    }
  }

  async ping(): Promise<string> {
    const client = await getRedis();
    if (!client) return 'Redis not available';
    try {
      const result = await client.ping();
      logger.debug('Redis PING operation', { response: result });
      return result;
    } catch (error) {
      logger.error('Redis PING operation failed', {}, error as Error);
      throw error;
    }
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    const client = await getRedis();
    if (!client) return null;
    try {
      const result = await client.hget(key, field);
      logger.debug('Redis HGET operation', { key, field, found: result !== null });
      return result;
    } catch (error) {
      logger.error('Redis HGET operation failed', { key, field }, error as Error);
      throw error;
    }
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    try {
      const client = await this.requireClient();
      const result = await client.hset(key, field, value);
      logger.debug('Redis HSET operation', { key, field, result });
      return result;
    } catch (error) {
      logger.error('Redis HSET operation failed', { key, field }, error as Error);
      throw error;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      const client = await this.requireClient();
      const result = await client.hgetall(key);
      logger.debug('Redis HGETALL operation', { key, fieldCount: Object.keys(result).length });
      return result;
    } catch (error) {
      logger.error('Redis HGETALL operation failed', { key }, error as Error);
      throw error;
    }
  }

  async hdel(key: string, field: string): Promise<number> {
    try {
      const client = await this.requireClient();
      const result = await client.hdel(key, field);
      logger.debug('Redis HDEL operation', { key, field, deletedCount: result });
      return result;
    } catch (error) {
      logger.error('Redis HDEL operation failed', { key, field }, error as Error);
      throw error;
    }
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    try {
      const client = await this.requireClient();
      const result = await client.lpush(key, ...values);
      logger.debug('Redis LPUSH operation', { key, valueCount: values.length, newLength: result });
      return result;
    } catch (error) {
      logger.error('Redis LPUSH operation failed', { key, valueCount: values.length }, error as Error);
      throw error;
    }
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    try {
      const client = await this.requireClient();
      const result = await client.rpush(key, ...values);
      logger.debug('Redis RPUSH operation', { key, valueCount: values.length, newLength: result });
      return result;
    } catch (error) {
      logger.error('Redis RPUSH operation failed', { key, valueCount: values.length }, error as Error);
      throw error;
    }
  }

  async lpop(key: string): Promise<string | null> {
    try {
      const client = await this.requireClient();
      const result = await client.lpop(key);
      logger.debug('Redis LPOP operation', { key, popped: result });
      return result;
    } catch (error) {
      logger.error('Redis LPOP operation failed', { key }, error as Error);
      throw error;
    }
  }

  async rpop(key: string): Promise<string | null> {
    try {
      const client = await this.requireClient();
      const result = await client.rpop(key);
      logger.debug('Redis RPOP operation', { key, popped: result });
      return result;
    } catch (error) {
      logger.error('Redis RPOP operation failed', { key }, error as Error);
      throw error;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      const client = await this.requireClient();
      const result = await client.lrange(key, start, stop);
      logger.debug('Redis LRANGE operation', { key, start, stop, count: result.length });
      return result;
    } catch (error) {
      logger.error('Redis LRANGE operation failed', { key, start, stop }, error as Error);
      throw error;
    }
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    try {
      const client = await this.requireClient();
      const result = await client.sadd(key, ...members);
      logger.debug('Redis SADD operation', { key, memberCount: members.length, addedCount: result });
      return result;
    } catch (error) {
      logger.error('Redis SADD operation failed', { key, memberCount: members.length }, error as Error);
      throw error;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      const client = await this.requireClient();
      const result = await client.smembers(key);
      logger.debug('Redis SMEMBERS operation', { key, memberCount: result.length });
      return result;
    } catch (error) {
      logger.error('Redis SMEMBERS operation failed', { key }, error as Error);
      throw error;
    }
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    try {
      const client = await this.requireClient();
      const result = await client.srem(key, ...members);
      logger.debug('Redis SREM operation', { key, memberCount: members.length, removedCount: result });
      return result;
    } catch (error) {
      logger.error('Redis SREM operation failed', { key, memberCount: members.length }, error as Error);
      throw error;
    }
  }

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    try {
      const client = await this.requireClient();
      const result = await client.zadd(key, score, member);
      logger.debug('Redis ZADD operation', { key, score, member, result });
      return result;
    } catch (error) {
      logger.error('Redis ZADD operation failed', { key, score, member }, error as Error);
      throw error;
    }
  }

  async zrange(key: string, start: number, stop: number, withScores: boolean = false): Promise<string[]> {
    try {
      const client = await this.requireClient();
      const result = withScores 
        ? await client.zrange(key, start, stop, 'WITHSCORES')
        : await client.zrange(key, start, stop);
      logger.debug('Redis ZRANGE operation', { key, start, stop, withScores, count: result.length });
      return result;
    } catch (error) {
      logger.error('Redis ZRANGE operation failed', { key, start, stop, withScores }, error as Error);
      throw error;
    }
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    try {
      const client = await this.requireClient();
      const result = await client.zrem(key, ...members);
      logger.debug('Redis ZREM operation', { key, memberCount: members.length, removedCount: result });
      return result;
    } catch (error) {
      logger.error('Redis ZREM operation failed', { key, memberCount: members.length }, error as Error);
      throw error;
    }
  }

  // Close connection
  async disconnect(): Promise<void> {
    try {
      const client = await this.requireClient();
      await client.disconnect();
      logger.info('Redis connection disconnected', {});
    } catch (error) {
      logger.error('Failed to disconnect Redis', {}, error as Error);
      throw error;
    }
  }
}

// Create Redis service instance (singleton)
export const redisService = new RedisService();

// Export getter for advanced operations
export async function getRedisClient(): Promise<Redis> {
  const client = await getRedis();
  if (!client) throw new Error('Redis client not available');
  return client;
}
