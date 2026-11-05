import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly subClient: Redis;
  private readonly extraClients: Redis[] = [];
  private readonly handlers = new Map<string, Array<(data: any) => void>>();
  private subscriptionConnection?: Promise<void>;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // The subscriber connection must not issue INFO after entering Pub/Sub mode.
    this.subClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      disableClientInfo: true,
      lazyConnect: true,
    });

    this.client.on('error', (err) => this.logger.error(`Redis Client Error: ${err.message}`));
    this.subClient.on('error', (err) => this.logger.error(`Redis SubClient Error: ${err.message}`));

    this.subClient.on('message', (channel, message) => {
      const channelHandlers = this.handlers.get(channel);
      if (!channelHandlers?.length) return;
      try {
        const parsed = JSON.parse(message);
        for (const fn of channelHandlers) {
          fn(parsed);
        }
      } catch (err) {
        this.logger.warn(`Failed to parse pubsub message on ${channel}: ${(err as Error).message}`);
      }
    });
  }

  getClient(): Redis {
    return this.client;
  }

  createDedicatedClient(): Redis {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const dedicated = new Redis(redisUrl, { maxRetriesPerRequest: null });
    dedicated.on('error', (err) => this.logger.error(`Redis Dedicated Error: ${err.message}`));
    this.extraClients.push(dedicated);
    return dedicated;
  }

  async xadd(stream: string, payload: Record<string, any>, maxLen = 10000): Promise<string | null> {
    const serialized = JSON.stringify(payload);
    return this.client.xadd(stream, 'MAXLEN', '~', String(maxLen), '*', 'data', serialized);
  }

  async ensureConsumerGroup(stream: string, group: string): Promise<void> {
    try {
      await this.client.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
      this.logger.log(`Created Redis consumer group ${group} on ${stream}`);
    } catch (err: any) {
      if (!err?.message?.includes('BUSYGROUP')) {
        throw err;
      }
    }
  }

  async xack(stream: string, group: string, id: string): Promise<number> {
    return this.client.xack(stream, group, id);
  }

  async publish(channel: string, payload: any): Promise<number> {
    return this.client.publish(channel, JSON.stringify(payload));
  }

  async subscribe<T = any>(channel: string, handler: (data: T) => void): Promise<void> {
    this.subscriptionConnection ??= this.subClient.connect();
    await this.subscriptionConnection;
    const existing = this.handlers.get(channel) || [];
    if (existing.length === 0) {
      this.handlers.set(channel, existing);
    }
    existing.push(handler);
    if (existing.length === 1) {
      try {
        await this.subClient.subscribe(channel);
      } catch (error) {
        this.handlers.delete(channel);
        throw error;
      }
    }
  }

  async setJson(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, raw, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, raw);
    }
  }

  async getJson<T = any>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async claimIdempotencyKey(key: string, ttlSeconds = 3600): Promise<boolean> {
    const res = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  /**
   * Atomically adds `likeCount` to a user's buffered likes and returns
   * `{ spawnsToTrigger, remainder }` based on `likesPerSpawn`.
   */
  async accumulateLikes(
    bufferKey: string,
    likeCount: number,
    likesPerSpawn: number,
  ): Promise<{ spawnsToTrigger: number; remainder: number }> {
    const lua = `
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      local added = tonumber(ARGV[1])
      local threshold = tonumber(ARGV[2])
      local total = current + added
      local spawns = math.floor(total / threshold)
      local rem = total % threshold
      redis.call('SET', KEYS[1], tostring(rem), 'EX', 86400)
      return { spawns, rem }
    `;
    const result = (await this.client.eval(
      lua,
      1,
      bufferKey,
      String(Math.max(1, likeCount)),
      String(Math.max(1, likesPerSpawn)),
    )) as [number, number];
    return {
      spawnsToTrigger: Number(result[0] || 0),
      remainder: Number(result[1] || 0),
    };
  }

  async onModuleDestroy() {
    for (const c of this.extraClients) {
      await c.quit().catch(() => undefined);
    }
    await this.subClient.quit().catch(() => undefined);
    await this.client.quit().catch(() => undefined);
  }
}
