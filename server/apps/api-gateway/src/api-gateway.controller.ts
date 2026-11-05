import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  BattleSessionModel,
  BattleSnapshot,
  BattleSpawnCommand,
  CharacterModel,
  ConnectorStatusDto,
  DonorLeaderboardEntry,
  DonorLeaderboardPayload,
  FactionType,
  GiftEventModel,
  NormalizedTikTokEvent,
  REDIS_CHANNELS,
  REDIS_KEYS,
  REDIS_STREAMS,
  RedisService,
  SystemSettingsModel,
  TikTokUserModel,
  normalizeRoundTiming,
} from '@app/shared';
import { donorLeaderboardPipeline } from './donor-leaderboard.helper';
import { TikTokOAuthService } from './tiktok-oauth.service';

@Controller('api/v1')
export class ApiGatewayController {
  constructor(
    private readonly redisService: RedisService,
    @InjectModel(TikTokUserModel.name) private readonly userModel: Model<TikTokUserModel>,
    @InjectModel(BattleSessionModel.name) private readonly sessionModel: Model<BattleSessionModel>,
    @InjectModel(CharacterModel.name) private readonly characterModel: Model<CharacterModel>,
    @InjectModel(GiftEventModel.name) private readonly giftEventModel: Model<GiftEventModel>,
    @InjectModel(SystemSettingsModel.name)
    private readonly settingsModel: Model<SystemSettingsModel>,
    private readonly oauth: TikTokOAuthService,
  ) {}

  @Get('health')
  async health() {
    return {
      service: 'api-gateway',
      ok: true,
      timestamp: new Date().toISOString(),
    };
  }

  // ================= TIKTOK API =================

  @Get('tiktok/auth-url')
  getTikTokAuthUrl() {
    return this.oauth.createAuthorization();
  }

  @Post('tiktok/oauth-callback')
  async handleTikTokOAuthCallback(@Body() body: { code?: string; state?: string; flowToken?: string }) {
    const result = await this.oauth.completeAuthorization(body);
    if (result.ok && result.user?.username) {
      await this.redisService.publish(REDIS_CHANNELS.CONNECTOR_COMMAND, {
        action: 'connect',
        username: result.user.username,
        sessionId: `oauth-${result.user.openId || Date.now()}`,
      });
    }
    return result;
  }

  @Post('tiktok/connect')
  async connectTikTok(
    @Body() body: { username: string; sessionId?: string; sessionCookie?: string },
  ) {
    const username = (body?.username || process.env.TIKTOK_USERNAME || '').trim();
    const sessionId = (body?.sessionId || body?.sessionCookie || `session-${Date.now()}`).trim();
    const sessionCookie = (body?.sessionCookie || body?.sessionId || '').trim();
    await this.redisService.publish(REDIS_CHANNELS.CONNECTOR_COMMAND, {
      action: 'connect',
      username,
      sessionId,
      sessionCookie,
    });
    return {
      ok: true,
      message: `Đã yêu cầu kết nối tới TikTok LIVE @${username}`,
      username,
      sessionId,
    };
  }

  @Post('tiktok/check-live')
  async checkTikTokLive(
    @Body() body: { username: string; sessionId?: string; sessionCookie?: string },
  ) {
    const username = (body?.username || process.env.TIKTOK_USERNAME || '').trim();
    if (!username) {
      throw new BadRequestException('Vui lòng cung cấp tên tài khoản TikTok (username).');
    }
    const connectorPort = process.env.CONNECTOR_PORT || 3002;
    try {
      const response = await fetch(`http://127.0.0.1:${connectorPort}/check-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          sessionId: body.sessionId,
          sessionCookie: body.sessionCookie,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `Lỗi kết nối tới connector (HTTP ${response.status})`);
      }
      return await response.json();
    } catch (err: any) {
      return {
        isLive: false,
        username,
        message: err.message || 'Không thể kiểm tra trạng thái LIVE lúc này.',
      };
    }
  }

  @Post('tiktok/disconnect')
  async disconnectTikTok() {
    await this.redisService.publish(REDIS_CHANNELS.CONNECTOR_COMMAND, {
      action: 'disconnect',
    });
    return { ok: true, message: 'Requested disconnect from TikTok LIVE' };
  }

  @Get('tiktok/status')
  async getTikTokStatus(): Promise<ConnectorStatusDto> {
    const state = await this.redisService.getJson<ConnectorStatusDto>(REDIS_KEYS.CONNECTOR_STATE);
    return (
      state || {
        connected: false,
        username: null,
        sessionId: null,
        reconnectAttempts: 0,
        mode: 'idle',
      }
    );
  }

  // ================= BATTLE API =================

  @Post('battle/start')
  async startBattle(@Body() body?: { streamerUsername?: string }) {
    const streamerUsername =
      body?.streamerUsername || process.env.TIKTOK_USERNAME || 'live_arena';
    await this.sessionModel.updateMany(
      { status: 'live' },
      { $set: { status: 'ended', endedAt: new Date() } },
    );
    const session = await this.sessionModel.create({
      streamerUsername,
      status: 'live',
      startedAt: new Date(),
      totalSpawned: 0,
      totalKills: 0,
    });
    return { ok: true, session };
  }

  @Post('battle/stop')
  async stopBattle() {
    await this.sessionModel.updateMany(
      { status: 'live' },
      { $set: { status: 'ended', endedAt: new Date() } },
    );
    return { ok: true };
  }

  @Get('battle/state')
  async getBattleState() {
    const snapshot = await this.redisService.getJson<BattleSnapshot>(REDIS_KEYS.BATTLE_SNAPSHOT);
    return (
      snapshot || {
        version: 1,
        tickRate: Number(process.env.BATTLE_TICK_RATE || 20),
        sessionId: 'default-session',
        streamerUsername: process.env.TIKTOK_USERNAME || 'live_arena',
        status: 'waiting',
        tick: 0,
        timestamp: Date.now(),
        arenaWidth: 1920,
        arenaHeight: 1080,
        roundNumber: 1,
        roundStatus: 'fighting',
        ...normalizeRoundTiming(null),
        roundEndsAt: null,
        nextRoundStartsAt: null,
        hostageState: 'captured',
        policeScore: 0,
        smugglerScore: 0,
        targetScore: 100,
        policeWins: 0,
        smugglerWins: 0,
        totalSpawned: 0,
        totalKills: 0,
        characters: [],
      }
    );
  }

  @Get('battle/leaderboard')
  async getLeaderboard() {
    const users = await this.userModel
      .find()
      .sort({ totalPoints: -1 })
      .limit(20)
      .lean()
      .exec();
    return {
      version: 1,
      timestamp: Date.now(),
      entries: users.map((u) => ({
        tiktokUserId: u.tiktokUserId,
        username: u.username,
        avatarUrl: u.avatarUrl,
        faction: u.faction,
        totalPoints: u.totalPoints,
        totalLikes: u.totalLikes,
        totalGifts: u.totalGifts,
        level: u.level,
      })),
    };
  }

  // ================= CHARACTER API =================

  @Get('battle/donors')
  async getDonorLeaderboard(): Promise<DonorLeaderboardPayload> {
    const entries = await this.giftEventModel.aggregate<DonorLeaderboardEntry>(donorLeaderboardPipeline()).exec();
    return { version: 1, timestamp: Date.now(), entries };
  }

  @Get('characters')
  async getCharacters() {
    const snapshot = await this.redisService.getJson<BattleSnapshot>(REDIS_KEYS.BATTLE_SNAPSHOT);
    if (snapshot?.characters) {
      return snapshot.characters;
    }
    return this.characterModel.find({ status: 'alive' }).limit(100).lean().exec();
  }

  @Get('characters/:id')
  async getCharacterById(@Param('id') id: string) {
    const doc = await this.characterModel.findById(id).lean().exec();
    if (!doc) throw new NotFoundException('Character not found');
    return doc;
  }

  @Post('characters/spawn')
  async manualSpawn(
    @Body()
    body: {
      ownerId?: string;
      username?: string;
      avatarUrl?: string;
      faction?: FactionType;
      characterClass?: any;
      tier?: any;
      type?: any;
      count?: number;
    },
  ) {
    const cmd: BattleSpawnCommand = {
      commandId: randomUUID(),
      type: 'SPAWN_CHARACTER',
      sessionId: 'default-session',
      ownerId: body?.ownerId || `manual_${Date.now()}`,
      username: body?.username || 'Người Triệu Hồi',
      avatarUrl: body?.avatarUrl,
      faction: body?.faction === 'smuggler' ? 'smuggler' : 'police',
      characterType: body?.tier || body?.type || 'normal',
      characterClass: body?.characterClass || 'warrior',
      count: Math.max(1, Math.min(5, Number(body?.count || 1))),
      bonusPoints: 5,
      timestamp: Date.now(),
    };
    await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, cmd);
    return { ok: true, command: cmd };
  }

  @Post('battle/deploy-bomb')
  async deployBomb(
    @Body()
    body: {
      faction?: FactionType;
      x?: number;
      y?: number;
      placedBy?: string;
    },
  ) {
    const faction: FactionType = body?.faction === 'smuggler' ? 'smuggler' : 'police';
    const cmd: BattleSpawnCommand = {
      commandId: randomUUID(),
      type: 'DEPLOY_BOMB',
      sessionId: 'default-session',
      ownerId: `admin_${Date.now()}`,
      username: body?.placedBy || (faction === 'police' ? 'Chỉ Huy SWAT' : 'Trùm Buôn Lậu'),
      faction,
      bombX: body?.x,
      bombY: body?.y,
      timestamp: Date.now(),
    };
    await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, cmd);
    return { ok: true, message: `Deployed bomb for ${faction}`, command: cmd };
  }

  @Post('battle/deploy-obstacle')
  async deployObstacle(
    @Body()
    body: {
      faction?: FactionType;
      type?: 'barrier' | 'sandbag' | 'barbwire' | 'crate';
      x?: number;
      y?: number;
    },
  ) {
    const faction: FactionType = body?.faction === 'smuggler' ? 'smuggler' : 'police';
    const cmd: BattleSpawnCommand = {
      commandId: randomUUID(),
      type: 'DEPLOY_OBSTACLE',
      sessionId: 'default-session',
      ownerId: `admin_${Date.now()}`,
      username: faction === 'police' ? 'Công An' : 'Buôn Lậu',
      faction,
      obstacleType: body?.type || 'sandbag',
      bombX: body?.x,
      bombY: body?.y,
      timestamp: Date.now(),
    };
    await this.redisService.xadd(REDIS_STREAMS.BATTLE_COMMANDS, cmd);
    return { ok: true, message: `Deployed obstacle for ${faction}`, command: cmd };
  }

  // ================= ADMIN API =================

  @Get('admin/settings')
  async getSettings() {
    let settings = await this.settingsModel.findOne({ key: 'default' }).lean().exec();
    if (!settings) {
      settings = (await this.settingsModel.create({
        key: 'default',
        likesPerSpawn: Number(process.env.LIKES_PER_SPAWN || 10),
        maxCharacters: Number(process.env.MAX_CHARACTERS || 100),
        battleTickRate: Number(process.env.BATTLE_TICK_RATE || 20),
        maxLikeRatePerSecond: 50,
      })).toObject();
    }
    return { ...settings, ...normalizeRoundTiming(settings) };
  }

  @Patch('admin/settings')
  async updateSettings(
    @Body()
    body: {
      likesPerSpawn?: number;
      maxCharacters?: number;
      battleTickRate?: number;
      maxLikeRatePerSecond?: number;
      roundDurationSeconds?: number;
      roundBreakSeconds?: number;
    },
  ) {
    if (body.roundDurationSeconds !== undefined && (!Number.isInteger(body.roundDurationSeconds) || body.roundDurationSeconds < 10 || body.roundDurationSeconds > 3600)) {
      throw new BadRequestException('Thời gian hiệp phải là số nguyên từ 10 đến 3600 giây.');
    }
    if (body.roundBreakSeconds !== undefined && (!Number.isInteger(body.roundBreakSeconds) || body.roundBreakSeconds < 0 || body.roundBreakSeconds > 120)) {
      throw new BadRequestException('Thời gian nghỉ phải là số nguyên từ 0 đến 120 giây.');
    }
    const updated = await this.settingsModel
      .findOneAndUpdate(
        { key: 'default' },
        {
          $set: {
            ...(body.roundDurationSeconds !== undefined ? { roundDurationSeconds: body.roundDurationSeconds } : {}),
            ...(body.roundBreakSeconds !== undefined ? { roundBreakSeconds: body.roundBreakSeconds } : {}),
            ...(body.likesPerSpawn !== undefined
              ? { likesPerSpawn: Number(body.likesPerSpawn) }
              : {}),
            ...(body.maxCharacters !== undefined
              ? { maxCharacters: Number(body.maxCharacters) }
              : {}),
            ...(body.battleTickRate !== undefined
              ? { battleTickRate: Number(body.battleTickRate) }
              : {}),
            ...(body.maxLikeRatePerSecond !== undefined
              ? { maxLikeRatePerSecond: Number(body.maxLikeRatePerSecond) }
              : {}),
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();
    const timing = normalizeRoundTiming(updated);
    if (body.roundDurationSeconds !== undefined || body.roundBreakSeconds !== undefined) {
      await this.redisService.publish(REDIS_CHANNELS.BATTLE_SETTINGS, timing);
    }
    return { ...updated, ...timing };
  }

  @Get('admin/events')
  async getRecentEvents() {
    const gifts = await this.giftEventModel
      .find()
      .sort({ createdAt: -1 })
      .limit(30)
      .lean()
      .exec();
    return { gifts };
  }

  @Post('admin/test-event')
  async triggerTestEvent(@Body() body: Partial<NormalizedTikTokEvent>) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_EVENTS !== 'true') {
      throw new ForbiddenException('test-event endpoint is disabled in production');
    }

    const event: NormalizedTikTokEvent = {
      eventId: randomUUID(),
      eventKey: body.eventKey || `test:${Date.now()}:${randomUUID()}`,
      type: body.type || 'like',
      sessionId: body.sessionId || 'default-session',
      tiktokUserId: body.tiktokUserId || 'test_user_01',
      username: body.username || 'TikTok_Tester',
      avatarUrl: body.avatarUrl,
      timestamp: Date.now(),
      likeCount: body.likeCount ?? 10,
      comment: body.comment,
      giftId: body.giftId || '5655',
      giftName: body.giftName || 'Rose',
      repeatCount: body.repeatCount ?? 1,
      repeatEnd: true,
      diamondCount: body.diamondCount ?? 1,
      faction: body.faction,
      simulated: true,
    };

    await this.redisService.xadd(REDIS_STREAMS.TIKTOK_EVENTS, event);
    return { ok: true, event };
  }
}
