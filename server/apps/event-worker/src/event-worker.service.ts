import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import {
  BattleSpawnCommand,
  FactionType,
  GiftEventModel,
  NormalizedTikTokEvent,
  REDIS_CHANNELS,
  REDIS_GROUPS,
  REDIS_KEYS,
  REDIS_STREAMS,
  RedisService,
  SystemSettingsModel,
  TikTokUserModel,
} from '@app/shared';
import {
  parseFactionFromComment,
  resolveGiftCharacterTier,
  isBombComment,
  isObstacleComment,
  isBuilderComment,
  parseCharacterClassFromComment,
} from './event-rules.helper';

@Injectable()
export class EventWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventWorkerService.name);
  private streamReader!: Redis;
  private running = false;
  private processedCount = 0;
  private skippedDuplicateCount = 0;
  private autoFactionToggle = false;

  constructor(
    private readonly redisService: RedisService,
    @InjectModel(TikTokUserModel.name) private readonly userModel: Model<TikTokUserModel>,
    @InjectModel(GiftEventModel.name) private readonly giftEventModel: Model<GiftEventModel>,
    @InjectModel(SystemSettingsModel.name)
    private readonly settingsModel: Model<SystemSettingsModel>,
  ) {}

  async onModuleInit() {
    await this.redisService.ensureConsumerGroup(
      REDIS_STREAMS.TIKTOK_EVENTS,
      REDIS_GROUPS.EVENT_WORKERS,
    );
    this.streamReader = this.redisService.createDedicatedClient();
    this.running = true;
    this.consumeLoop().catch((err) =>
      this.logger.error(`EventWorker consumeLoop crashed: ${err.message}`),
    );
  }

  getMetrics() {
    return {
      running: this.running,
      processedCount: this.processedCount,
      skippedDuplicateCount: this.skippedDuplicateCount,
    };
  }

  private async getLikesPerSpawn(): Promise<number> {
    const doc = await this.settingsModel.findOne({ key: 'default' }).lean().exec();
    if (doc?.likesPerSpawn && doc.likesPerSpawn > 0) {
      return doc.likesPerSpawn;
    }
    return Number(process.env.LIKES_PER_SPAWN || 10);
  }

  private async resolveUserFaction(
    tiktokUserId: string,
    explicitFaction?: FactionType,
  ): Promise<FactionType> {
    const redisKey = `${REDIS_KEYS.USER_FACTION_PREFIX}${tiktokUserId}`;
    if (explicitFaction === 'police' || explicitFaction === 'smuggler') {
      await this.redisService.getClient().set(redisKey, explicitFaction, 'EX', 86400);
      return explicitFaction;
    }

    const cached = await this.redisService.getClient().get(redisKey);
    if (cached === 'police' || cached === 'smuggler') {
      return cached;
    }

    const existingUser = await this.userModel.findOne({ tiktokUserId }).lean().exec();
    if (existingUser?.faction === 'police' || existingUser?.faction === 'smuggler') {
      await this.redisService.getClient().set(redisKey, existingUser.faction, 'EX', 86400);
      return existingUser.faction;
    }

    // Auto-balance if user taps screen before commenting 1 or 2
    this.autoFactionToggle = !this.autoFactionToggle;
    const assigned: FactionType = this.autoFactionToggle ? 'police' : 'smuggler';
    await this.redisService.getClient().set(redisKey, assigned, 'EX', 86400);
    return assigned;
  }

  private async consumeLoop() {
    const consumerName = `worker-${process.pid}`;
    while (this.running) {
      try {
        const res = (await (this.streamReader as any).xreadgroup(
          'GROUP',
          REDIS_GROUPS.EVENT_WORKERS,
          consumerName,
          'COUNT',
          25,
          'BLOCK',
          2000,
          'STREAMS',
          REDIS_STREAMS.TIKTOK_EVENTS,
          '>',
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!res) continue;

        for (const [, entries] of res) {
          for (const [messageId, fields] of entries) {
            const dataIdx = fields.indexOf('data');
            const rawJson = dataIdx >= 0 ? fields[dataIdx + 1] : null;
            if (rawJson) {
              try {
                const event = JSON.parse(rawJson) as NormalizedTikTokEvent;
                await this.processEvent(event);
              } catch (err) {
                this.logger.error(`Error processing event ${messageId}: ${(err as Error).message}`);
              }
            }
            await this.redisService.xack(
              REDIS_STREAMS.TIKTOK_EVENTS,
              REDIS_GROUPS.EVENT_WORKERS,
              messageId,
            );
          }
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.warn(`Redis stream read error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async processEvent(event: NormalizedTikTokEvent): Promise<void> {
    // An interim streak and its final update can share the same event key.
    if (event.type === 'gift' && event.repeatEnd === false) return;
    const idempKey = `${REDIS_KEYS.EVENT_IDEMPOTENCY_PREFIX}${event.eventKey}`;
    const isFirstTime = await this.redisService.claimIdempotencyKey(idempKey, 3600);
    if (!isFirstTime) {
      this.skippedDuplicateCount += 1;
      return;
    }

    this.processedCount += 1;

    // 1. Handle Chat: check if user chooses Faction 1 (Police) or Faction 2 (Smuggler)
    if (event.type === 'chat' && event.comment) {
      const chosenFaction = parseFactionFromComment(event.comment);
      if (chosenFaction) {
        const faction = await this.resolveUserFaction(event.tiktokUserId, chosenFaction);
        await this.userModel.updateOne(
          { tiktokUserId: event.tiktokUserId },
          {
            $set: {
              username: event.username,
              faction,
              ...(event.avatarUrl ? { avatarUrl: event.avatarUrl } : {}),
            },
          },
          { upsert: true },
        );

        const joinCmd: BattleSpawnCommand = {
          commandId: randomUUID(),
          type: 'JOIN_FACTION',
          sessionId: event.sessionId,
          ownerId: event.tiktokUserId,
          username: event.username,
          avatarUrl: event.avatarUrl,
          faction,
          characterType: 'normal',
          count: 1,
          bonusPoints: 3,
          message: event.comment,
          timestamp: Date.now(),
        };
        await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, joinCmd);
        return;
      }

      if (isBombComment(event.comment)) {
        const faction = await this.resolveUserFaction(event.tiktokUserId, event.faction);
        const bombCmd: BattleSpawnCommand = {
          commandId: randomUUID(),
          type: 'DEPLOY_BOMB',
          sessionId: event.sessionId,
          ownerId: event.tiktokUserId,
          username: event.username,
          avatarUrl: event.avatarUrl,
          faction,
          message: event.comment,
          timestamp: Date.now(),
        };
        await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, bombCmd);
        return;
      }

      if (isObstacleComment(event.comment)) {
        const faction = await this.resolveUserFaction(event.tiktokUserId, event.faction);
        const obsCmd: BattleSpawnCommand = {
          commandId: randomUUID(),
          type: 'DEPLOY_OBSTACLE',
          sessionId: event.sessionId,
          ownerId: event.tiktokUserId,
          username: event.username,
          avatarUrl: event.avatarUrl,
          faction,
          obstacleType: 'sandbag',
          message: event.comment,
          timestamp: Date.now(),
        };
        await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, obsCmd);
        return;
      }

      if (isBuilderComment(event.comment)) {
        const faction = await this.resolveUserFaction(event.tiktokUserId, event.faction);
        const builderCmd: BattleSpawnCommand = {
          commandId: randomUUID(),
          type: 'SPAWN_CHARACTER',
          sessionId: event.sessionId,
          ownerId: event.tiktokUserId,
          username: event.username,
          avatarUrl: event.avatarUrl,
          faction,
          characterType: 'rare',
          characterClass: 'builder',
          count: 1,
          message: 'Triệu hồi Công Binh sửa pháo đài! 🔨',
          timestamp: Date.now(),
        };
        await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, builderCmd);
        return;
      }

      const matchedUnit = parseCharacterClassFromComment(event.comment);
      if (matchedUnit) {
        const faction = await this.resolveUserFaction(event.tiktokUserId, event.faction);
        const spawnCmd: BattleSpawnCommand = {
          commandId: randomUUID(),
          type: 'SPAWN_CHARACTER',
          sessionId: event.sessionId,
          ownerId: event.tiktokUserId,
          username: event.username,
          avatarUrl: event.avatarUrl,
          faction,
          characterType: matchedUnit.tier || 'normal',
          characterClass: matchedUnit.characterClass,
          count: 1,
          message: `Triệu hồi ${matchedUnit.characterClass.toUpperCase()}! ⚔️`,
          timestamp: Date.now(),
        };
        await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, spawnCmd);
        return;
      }

      const faction = await this.resolveUserFaction(event.tiktokUserId, event.faction);
      const cmd: BattleSpawnCommand = {
        commandId: randomUUID(),
        type: 'CHAT_BUBBLE',
        sessionId: event.sessionId,
        ownerId: event.tiktokUserId,
        username: event.username,
        avatarUrl: event.avatarUrl,
        faction,
        message: event.comment,
        timestamp: Date.now(),
      };
      await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, cmd);
      return;
    }

    // 2. Handle Like (Tap screen): accumulate likes for user's faction, buff faction score & spawn fighter
    if (event.type === 'like') {
      const faction = await this.resolveUserFaction(event.tiktokUserId, event.faction);
      const likeCount = Math.max(1, Math.min(500, Number(event.likeCount || 1)));
      const likesPerSpawn = await this.getLikesPerSpawn();
      const bufferKey = `${REDIS_KEYS.USER_LIKE_BUFFER_PREFIX}${event.sessionId}:${event.tiktokUserId}`;

      const { spawnsToTrigger } = await this.redisService.accumulateLikes(
        bufferKey,
        likeCount,
        likesPerSpawn,
      );

      await this.userModel.updateOne(
        { tiktokUserId: event.tiktokUserId },
        {
          $set: {
            username: event.username,
            faction,
            ...(event.avatarUrl ? { avatarUrl: event.avatarUrl } : {}),
          },
          $inc: {
            totalLikes: likeCount,
            totalPoints: likeCount,
          },
        },
        { upsert: true },
      );

      const cappedSpawns = Math.min(5, spawnsToTrigger);
      if (cappedSpawns > 0) {
        const cmd: BattleSpawnCommand = {
          commandId: randomUUID(),
          type: 'SPAWN_CHARACTER',
          sessionId: event.sessionId,
          ownerId: event.tiktokUserId,
          username: event.username,
          avatarUrl: event.avatarUrl,
          faction,
          characterType: 'normal',
          count: cappedSpawns,
          bonusPoints: cappedSpawns * 4,
          timestamp: Date.now(),
        };
        await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, cmd);
      } else {
        // Even small taps (<10 likes) add +1 score push to the faction
        const buffCmd: BattleSpawnCommand = {
          commandId: randomUUID(),
          type: 'BUFF_FACTION',
          sessionId: event.sessionId,
          ownerId: event.tiktokUserId,
          username: event.username,
          faction,
          bonusPoints: Math.max(1, Math.floor(likeCount / 3)),
          timestamp: Date.now(),
        };
        await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, buffCmd);
      }
      return;
    }

    // 3. Handle Gift: spawn rare/legendary fighter for user's faction + big score push
    if (event.type === 'gift') {
      const faction = await this.resolveUserFaction(event.tiktokUserId, event.faction);
      const repeatCount = Number(event.repeatCount || 1);
      const quantity = Number.isSafeInteger(repeatCount) && repeatCount > 0 ? repeatCount : 1;
      const tier = resolveGiftCharacterTier(event.diamondCount || 1);

      try {
        await this.giftEventModel.create({
          sessionId: event.sessionId,
          eventKey: event.eventKey,
          tiktokUserId: event.tiktokUserId,
          username: event.username,
          avatarUrl: event.avatarUrl,
          giftId: event.giftId || '0',
          giftName: event.giftName || 'Gift',
          quantity,
          diamondCount: event.diamondCount || 1,
          processed: true,
        });
      } catch (err: any) {
        if (err?.code === 11000) {
          this.skippedDuplicateCount += 1;
          return;
        }
        throw err;
      }

      await this.userModel.updateOne(
        { tiktokUserId: event.tiktokUserId },
        {
          $set: {
            username: event.username,
            faction,
            ...(event.avatarUrl ? { avatarUrl: event.avatarUrl } : {}),
          },
          $inc: {
            totalGifts: quantity,
            totalPoints: quantity * 10,
          },
        },
        { upsert: true },
      );

      await this.redisService.publish(REDIS_CHANNELS.GAME_EVENTS, {
        event: 'donation:updated',
        payload: { version: 1, timestamp: Date.now() },
      });

      const bonusPerUnit =
        tier === 'mythic' ? 50 : tier === 'legendary' ? 25 : tier === 'epic' ? 18 : tier === 'rare' ? 12 : 6;
      const gameplayQuantity = Math.min(10, quantity);
      const cmd: BattleSpawnCommand = {
        commandId: randomUUID(),
        type: 'SPAWN_CHARACTER',
        sessionId: event.sessionId,
        ownerId: event.tiktokUserId,
        username: event.username,
        avatarUrl: event.avatarUrl,
        faction,
        characterType: tier,
        count: gameplayQuantity,
        bonusPoints: gameplayQuantity * bonusPerUnit,
        giftName: event.giftName,
        diamondCount: event.diamondCount,
        timestamp: Date.now(),
      };
      await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, cmd);
    }
  }

  onModuleDestroy() {
    this.running = false;
  }
}
