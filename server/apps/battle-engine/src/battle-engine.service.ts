import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import {
  resolveObstacleCollision,
  CAPTURE_ZONES_CONFIG,
  INITIAL_HOSTAGES,
  CaptureZone,
  HostageUnit,
} from './arena-obstacles';
import {
  BattleSessionModel,
  BattleSnapshot,
  BattleSpawnCommand,
  CharacterAttackPayload,
  CharacterDamagePayload,
  CharacterDeathPayload,
  CharacterModel,
  CharacterMovePayload,
  CharacterSpawnPayload,
  CharacterStateDto,
  CharacterTier,
  CharacterClass,
  FactionJoinedPayload,
  FactionType,
  HostageState,
  BombDto,
  BombExplodedPayload,
  DynamicObstacleDto,
  LandscapeSlowZoneDto,
  REDIS_CHANNELS,
  REDIS_GROUPS,
  REDIS_KEYS,
  REDIS_STREAMS,
  RedisService,
  RoundResultPayload,
  RoundStatus,
  TikTokUserModel,
  SystemSettingsModel,
  RoundTimingSettings,
  RoundTimingState,
  normalizeRoundTiming,
} from '@app/shared';

interface RuntimeCharacter extends CharacterStateDto {
  characterClass: CharacterClass;
  attackRange: number;
  lastAttackAt: number;
  attackCooldownMs: number;
  wanderTargetX: number;
  wanderTargetY: number;
  chatBubbleExpiresAt?: number;
}

@Injectable()
export class BattleEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BattleEngineService.name);
  private streamReader!: Redis;
  private running = false;
  private tickInProgress = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private nextRoundTimer: NodeJS.Timeout | null = null;

  private readonly arenaWidth = 6400;
  private readonly arenaHeight = 1080;
  private readonly hostageX = 3200;
  private readonly hostageY = 780;
  private readonly maxCharacters = Number(process.env.MAX_CHARACTERS || 100);
  private readonly tickRate = Number(process.env.BATTLE_TICK_RATE || 20);

  private sessionId = 'default-session';
  private streamerUsername = process.env.TIKTOK_USERNAME || 'live_arena';
  private status: 'waiting' | 'live' | 'ended' = 'live';
  private tickCount = 0;

  private roundNumber = 1;
  private battlePhase: 1 | 2 = 1; // Bước 1: Chiếm toàn bộ cứ điểm -> Bước 2: Trận quyết chiến giải cứu/hạ gục con tin
  private phase1Winner: FactionType | null = null;
  private roundStatus: RoundStatus = 'fighting';
  private hostageState: HostageState = 'captured';
  private policeScore = 0;
  private smugglerScore = 0;
  private readonly targetScore = 100;
  private policeWins = 0;
  private smugglerWins = 0;
  private roundDurationSeconds = 180;
  private roundBreakSeconds = 5;
  private roundEndsAt: number | null = Date.now() + 180000;
  private nextRoundStartsAt: number | null = null;

  private totalSpawned = 0;
  private totalKills = 0;
  private readonly characters = new Map<string, RuntimeCharacter>();
  private readonly captureZones: CaptureZone[] = CAPTURE_ZONES_CONFIG.map((z) => ({
    ...z,
    control: 'neutral',
    progress: 0,
  }));
  private readonly hostages: HostageUnit[] = INITIAL_HOSTAGES.map((h) => ({ ...h }));
  private currentHostageIndex = 1; // 1 -> 2 -> 3
  private rescuedCount = { police: 0, smuggler: 0 };
  private readonly bombs = new Map<string, BombDto>();
  private readonly dynamicObstacles = new Map<string, DynamicObstacleDto>();

  // Cảnh quan địa hình làm chậm quân lính (Spikes, Mud, Barricades)
  private readonly landscapeSlowZones: LandscapeSlowZoneDto[] = [
    { id: 'spikes_blue_mid', kind: 'spikes', x: 2550, y: 780, width: 280, height: 160, slowFactor: 0.5 },
    { id: 'mud_blue_center', kind: 'mud', x: 2880, y: 790, width: 240, height: 160, slowFactor: 0.55 },
    { id: 'mud_red_center', kind: 'mud', x: 3520, y: 790, width: 240, height: 160, slowFactor: 0.55 },
    { id: 'spikes_red_mid', kind: 'spikes', x: 3850, y: 780, width: 280, height: 160, slowFactor: 0.5 },
    { id: 'barricade_blue_t2', kind: 'barricade', x: 1600, y: 780, width: 200, height: 160, slowFactor: 0.6 },
    { id: 'barricade_red_t2', kind: 'barricade', x: 4800, y: 780, width: 200, height: 160, slowFactor: 0.6 },
  ];

  constructor(
    private readonly redisService: RedisService,
    @InjectModel(CharacterModel.name) private readonly characterModel: Model<CharacterModel>,
    @InjectModel(BattleSessionModel.name) private readonly sessionModel: Model<BattleSessionModel>,
    @InjectModel(TikTokUserModel.name) private readonly userModel: Model<TikTokUserModel>,
    @InjectModel(SystemSettingsModel.name) private readonly settingsModel: Model<SystemSettingsModel>,
  ) {}

  async onModuleInit() {
    await this.redisService.ensureConsumerGroup(
      REDIS_STREAMS.BATTLE_COMMANDS,
      REDIS_GROUPS.BATTLE_ENGINE,
    );
    await this.ensureActiveSession();
    const settings = await this.settingsModel.findOne({ key: 'default' }).lean().exec();
    await this.applyRoundTiming(normalizeRoundTiming(settings));
    await this.redisService.subscribe<RoundTimingSettings>(REDIS_CHANNELS.BATTLE_SETTINGS, (timing) => {
      void this.applyRoundTiming(timing).catch((error) => this.logger.error(`Timing settings error: ${error.message}`));
    });

    this.streamReader = this.redisService.createDedicatedClient();
    this.running = true;

    this.consumeCommandsLoop().catch((err) =>
      this.logger.error(`BattleEngine command loop error: ${err.message}`),
    );

    const intervalMs = Math.max(20, Math.floor(1000 / this.tickRate));
    this.tickTimer = setInterval(() => {
      if (this.tickInProgress) return;
      this.tickInProgress = true;
      this.stepTick()
        .catch((err) => this.logger.error(`Tick error: ${err.message}`))
        .finally(() => { this.tickInProgress = false; });
    }, intervalMs);

    this.spawnLaneGates();
    await this.saveSnapshotToRedis();
    this.logger.log(
      `Battle Engine (2-Faction Police vs Smuggler) running at ${this.tickRate} ticks/sec`,
    );
  }

  private async ensureActiveSession() {
    let session = await this.sessionModel.findOne({ status: 'live' }).exec();
    if (!session) {
      session = await this.sessionModel.create({
        streamerUsername: this.streamerUsername,
        status: 'live',
        startedAt: new Date(),
        totalSpawned: 0,
        totalKills: 0,
      });
    }
    this.sessionId = String(session._id);
    this.totalSpawned = session.totalSpawned || 0;
    this.totalKills = session.totalKills || 0;
  }

  private async consumeCommandsLoop() {
    const consumerName = `battle-${process.pid}`;
    while (this.running) {
      try {
        const res = (await (this.streamReader as any).xreadgroup(
          'GROUP',
          REDIS_GROUPS.BATTLE_ENGINE,
          consumerName,
          'COUNT',
          20,
          'BLOCK',
          1000,
          'STREAMS',
          REDIS_STREAMS.BATTLE_COMMANDS,
          '>',
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!res) continue;

        for (const [, entries] of res) {
          for (const [messageId, fields] of entries) {
            const dataIdx = fields.indexOf('data');
            const rawJson = dataIdx >= 0 ? fields[dataIdx + 1] : null;
            if (rawJson) {
              try {
                const cmd = JSON.parse(rawJson) as BattleSpawnCommand;
                await this.handleCommand(cmd);
              } catch (err) {
                this.logger.error(`Command error ${messageId}: ${(err as Error).message}`);
              }
            }
            await this.redisService.xack(
              REDIS_STREAMS.BATTLE_COMMANDS,
              REDIS_GROUPS.BATTLE_ENGINE,
              messageId,
            );
          }
        }
      } catch (err) {
        if (!this.running) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  async handleCommand(cmd: BattleSpawnCommand) {
    const faction: FactionType = cmd.faction === 'smuggler' ? 'smuggler' : 'police';

    if (cmd.type === 'JOIN_FACTION') {
      const joinedPayload: FactionJoinedPayload = {
        version: 1,
        timestamp: Date.now(),
        tiktokUserId: cmd.ownerId,
        username: cmd.username,
        faction,
      };
      await this.publishGameEvent('faction:joined', joinedPayload);
      await this.addFactionScore(faction, cmd.bonusPoints ?? 3);
      await this.spawnCharacter({
        ownerId: cmd.ownerId,
        username: cmd.username,
        avatarUrl: cmd.avatarUrl,
        faction,
        tier: 'normal',
        reason: 'join_faction',
      });
      return;
    }

    if (cmd.type === 'BUFF_FACTION') {
      await this.addFactionScore(faction, cmd.bonusPoints ?? 1);
      // Slight heal/speed boost to existing alive units of this owner
      for (const char of this.characters.values()) {
        if (char.ownerId === cmd.ownerId && char.status === 'alive') {
          char.hp = Math.min(char.maxHp, char.hp + 8);
        }
      }
      return;
    }

    if (cmd.type === 'SPAWN_CHARACTER') {
      if (cmd.bonusPoints && cmd.bonusPoints > 0) {
        await this.addFactionScore(faction, cmd.bonusPoints);
      }
      const count = Math.max(1, Math.min(5, cmd.count || 1));
      for (let i = 0; i < count; i++) {
        await this.spawnCharacter({
          ownerId: cmd.ownerId,
          username: cmd.username,
          avatarUrl: cmd.avatarUrl,
          faction,
          tier: cmd.characterType || 'normal',
          characterClass: cmd.characterClass,
          reason: cmd.giftName ? 'gift' : 'likes',
        });
      }
      return;
    }

    if (cmd.type === 'DEPLOY_BOMB') {
      this.deployBomb({
        faction,
        placedBy: cmd.username || (faction === 'police' ? 'Công An' : 'Buôn Lậu'),
        x: cmd.bombX,
        y: cmd.bombY,
      });
      return;
    }

    if (cmd.type === 'DEPLOY_OBSTACLE') {
      this.deployObstacle({
        faction,
        type: cmd.obstacleType || 'sandbag',
        x: cmd.bombX,
        y: cmd.bombY,
      });
      return;
    }

    if (cmd.type === 'CHAT_BUBBLE' && cmd.message) {
      for (const char of this.characters.values()) {
        if (char.ownerId === cmd.ownerId && char.status === 'alive') {
          char.chatBubble = cmd.message;
          char.chatBubbleExpiresAt = Date.now() + 5000;
        }
      }
    }
  }

  deployBomb(params: {
    faction: FactionType;
    placedBy: string;
    x?: number;
    y?: number;
    damage?: number;
    radius?: number;
    timerMs?: number;
  }) {
    const activeHostage = this.hostages.find((h) => h.id === this.currentHostageIndex && h.state === 'captured');
    const baseX = activeHostage ? activeHostage.x : 960;
    const baseY = activeHostage ? activeHostage.y : 540;

    const x = params.x ?? (baseX + (params.faction === 'police' ? 65 + Math.random() * 80 : -(65 + Math.random() * 80)));
    const y = params.y ?? this.clamp(baseY + (Math.random() - 0.5) * 140, 160, this.arenaHeight - 160);

    const bomb: BombDto = {
      id: `bomb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      faction: params.faction,
      placedBy: params.placedBy,
      x: Math.round(x),
      y: Math.round(y),
      radius: params.radius || 150,
      damage: params.damage || 85,
      timerMs: params.timerMs || 3500,
      maxTimerMs: params.timerMs || 3500,
      state: 'armed',
      createdAt: Date.now(),
    };

    this.bombs.set(bomb.id, bomb);
    this.logger.log(`💣 ${params.faction === 'police' ? '🚓 CÔNG AN' : '💀 BUÔN LẬU'} ĐÃ ĐẶT BOM tại (${bomb.x}, ${bomb.y}) bởi ${params.placedBy}`);
  }

  deployObstacle(params: {
    faction?: FactionType;
    type?: 'barrier' | 'sandbag' | 'barbwire' | 'crate';
    x?: number;
    y?: number;
    hp?: number;
    durationMs?: number;
    label?: string;
  }) {
    const type = params.type || 'sandbag';
    const height = type === 'barbwire' ? 40 : 50;
    const direction = params.faction === 'smuggler' ? -1 : 1;
    const alive = Array.from(this.characters.values()).filter((char) => char.status === 'alive');
    const center = this.arenaWidth / 2;
    // Match the fight camera's focal point when the command has no coordinates.
    const battleX = alive.length ? alive.reduce((sum, char) => sum + char.x, 0) / alive.length : center;
    const x = params.x ?? this.clamp(battleX - direction * (65 + Math.random() * 90), 120, this.arenaWidth - 120);
    const y = params.y ?? 778 + Math.random() * 40 - height / 2;
    const label = params.label || (type === 'sandbag' ? 'Ụ Cát Phòng Thủ' : type === 'barbwire' ? 'Bẫy Gai Thép' : 'Rào Chắn');

    const obs: DynamicObstacleDto = {
      id: `dyn_obs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      faction: params.faction,
      x: Math.round(x),
      y: Math.round(y),
      width: type === 'barbwire' ? 70 : 60,
      height,
      label,
      hp: params.hp || 120,
      maxHp: params.hp || 120,
      createdAt: Date.now(),
      durationMs: params.durationMs || 45000,
    };

    if (this.dynamicObstacles.size >= 15) {
      const oldestKey = Array.from(this.dynamicObstacles.keys()).find((id) => id.startsWith('dyn_obs_'));
      if (oldestKey) this.dynamicObstacles.delete(oldestKey);
    }

    this.dynamicObstacles.set(obs.id, obs);
    this.logger.log(`🚧 ĐÃ DỰNG ${obs.label} tại (${obs.x}, ${obs.y})`);
  }

  private spawnLaneGates() {
    this.dynamicObstacles.clear();
    const now = Date.now();
    const shieldDurationMs = 30000; // 30 GIÂY ĐẦU HIỆP: KHÔNG THỂ PHÁ TƯỜNG (LÍNH GIAO TRANH)

    // ==================== 1. PHE XANH (POLICE - HỘI FA - BÊN TRÁI) ====================
    // Tầng 1: Tiền đồn phòng tuyến (x: 2000)
    const wallBlue1: DynamicObstacleDto = {
      id: 'wall_blue_1',
      type: 'gate',
      faction: 'police',
      x: 2000,
      y: 730,
      width: 220,
      height: 180,
      label: '🛡️ TIỀN ĐỒN FA (TẦNG 1)',
      hp: 600,
      maxHp: 600,
      createdAt: now,
      durationMs: 86400000,
      shieldUntil: now + shieldDurationMs,
      isShielded: true,
      tierIndex: 1,
      structureRole: 'wall',
    };

    // Tầng 2: Pháo đài trung tuyến (x: 1200)
    const wallBlue2: DynamicObstacleDto = {
      id: 'wall_blue_2',
      type: 'tower',
      faction: 'police',
      x: 1200,
      y: 720,
      width: 260,
      height: 210,
      label: '🏰 PHÁO ĐÀI TRUNG TUYẾN FA (TẦNG 2)',
      hp: 1000,
      maxHp: 1000,
      createdAt: now,
      durationMs: 86400000,
      tierIndex: 2,
      structureRole: 'wall',
    };

    // Tầng 3: Đại bản doanh thành chính (x: 400)
    const citadelBlue: DynamicObstacleDto = {
      id: 'fortress_blue',
      type: 'citadel',
      faction: 'police',
      x: 400,
      y: 700,
      width: 420,
      height: 250,
      label: '👑 ĐẠI BẢN DOANH HỘI FA (TẦNG 3)',
      hp: 2000,
      maxHp: 2000,
      createdAt: now,
      durationMs: 86400000,
      tierIndex: 3,
      structureRole: 'citadel',
    };

    // ==================== 2. PHE ĐỎ (SMUGGLER - CƠM CHÓ - BÊN PHẢI) ====================
    // Tầng 1: Tiền đồn phòng tuyến (x: 4400)
    const wallRed1: DynamicObstacleDto = {
      id: 'wall_red_1',
      type: 'gate',
      faction: 'smuggler',
      x: 4400,
      y: 730,
      width: 220,
      height: 180,
      label: '🛡️ TIỀN ĐỒN CƠM CHÓ (TẦNG 1)',
      hp: 600,
      maxHp: 600,
      createdAt: now,
      durationMs: 86400000,
      shieldUntil: now + shieldDurationMs,
      isShielded: true,
      tierIndex: 1,
      structureRole: 'wall',
    };

    // Tầng 2: Pháo đài trung tuyến (x: 5200)
    const wallRed2: DynamicObstacleDto = {
      id: 'wall_red_2',
      type: 'tower',
      faction: 'smuggler',
      x: 5200,
      y: 720,
      width: 260,
      height: 210,
      label: '🏰 PHÁO ĐÀI TRUNG TUYẾN CƠM CHÓ (TẦNG 2)',
      hp: 1000,
      maxHp: 1000,
      createdAt: now,
      durationMs: 86400000,
      tierIndex: 2,
      structureRole: 'wall',
    };

    // Tầng 3: Đại bản doanh thành chính (x: 6000)
    const citadelRed: DynamicObstacleDto = {
      id: 'fortress_red',
      type: 'citadel',
      faction: 'smuggler',
      x: 6000,
      y: 700,
      width: 420,
      height: 250,
      label: '👑 ĐẠI BẢN DOANH CƠM CHÓ (TẦNG 3)',
      hp: 2000,
      maxHp: 2000,
      createdAt: now,
      durationMs: 86400000,
      tierIndex: 3,
      structureRole: 'citadel',
    };

    const allStructures = [
      wallBlue1, wallBlue2, citadelBlue,
      wallRed1, wallRed2, citadelRed,
    ];
    for (const s of allStructures) {
      this.dynamicObstacles.set(s.id, s);
    }
    this.logger.log('🏰 ĐÃ THIẾT LẬP 3 KHUNG MÀN HÌNH PHÁO ĐÀI CHO 2 PHE VỚI 30S LÁ CHẮN GIAO TRANH!');
  }

  public getActiveEnemyStructure(attackerFaction: FactionType): DynamicObstacleDto | null {
    const targetOrder =
      attackerFaction === 'police'
        ? ['wall_red_1', 'wall_red_2', 'fortress_red']
        : ['wall_blue_1', 'wall_blue_2', 'fortress_blue'];

    for (const id of targetOrder) {
      const s = this.dynamicObstacles.get(id);
      if (s && s.hp > 0) {
        return s;
      }
    }
    return null;
  }

  public getActiveDamagedStructure(faction: FactionType): DynamicObstacleDto | null {
    // Ưu tiên sửa Đại bản doanh (citadel) nếu bị hư hại, sau đó đến các bức tường trung tuyến & tiền đồn
    const structureOrder =
      faction === 'police'
        ? ['fortress_blue', 'wall_blue_2', 'wall_blue_1']
        : ['fortress_red', 'wall_red_2', 'wall_red_1'];

    for (const id of structureOrder) {
      const s = this.dynamicObstacles.get(id);
      if (s && s.hp > 0 && s.hp < s.maxHp) {
        return s;
      }
    }
    return null;
  }

  private async addFactionScore(faction: FactionType, points: number) {
    if (this.roundStatus !== 'fighting' || points <= 0) return;
    if (await this.finishExpiredRound()) return;

    if (faction === 'police') {
      this.policeScore = Math.min(this.targetScore, this.policeScore + points);
    } else {
      this.smugglerScore = Math.min(this.targetScore, this.smugglerScore + points);
    }

    // Hiệp đấu chỉ kết thúc THẮNG/THUA khi một phe cứu được 3 con tin HOẶC bắt được 3 con tin!
  }

  private async finishRound(winnerFaction: FactionType | null) {
    if (this.roundStatus !== 'fighting') return;

    if (winnerFaction === 'police') {
      this.roundStatus = 'police_won';
      this.hostageState = 'rescued';
      this.policeWins += 1;
    } else if (winnerFaction === 'smuggler') {
      this.roundStatus = 'smuggler_won';
      this.hostageState = 'eliminated';
      this.smugglerWins += 1;
    } else {
      this.roundStatus = 'draw';
      this.hostageState = 'captured';
    }
    this.roundEndsAt = null;
    this.nextRoundStartsAt = Date.now() + this.roundBreakSeconds * 1000;

    const announcement =
      winnerFaction === 'police'
        ? '💔 HỘI ĐỘC THÂN CHIẾN THẮNG — ĐÃ ĐẬP TAN ĐỘI HÌNH PHÁT CƠM CHÓ!'
        : winnerFaction === 'smuggler'
          ? '👩‍❤️‍👨 TEAM PHÁT CƠM CHÓ CHIẾN THẮNG — CƠM CHÓ ÁP ĐẢO HỘI ĐỘC THÂN!'
          : '⏱ HẾT GIỜ — HAI PHE BẤT PHÂN THẮNG BẠI!';

    const resultPayload: RoundResultPayload = {
      ...this.getRoundTiming(),
      version: 1,
      timestamp: Date.now(),
      roundNumber: this.roundNumber,
      winnerFaction,
      hostageState: this.hostageState,
      policeScore: this.policeScore,
      smugglerScore: this.smugglerScore,
      policeWins: this.policeWins,
      smugglerWins: this.smugglerWins,
      announcement,
    };

    this.logger.log(`Round #${this.roundNumber} ended: ${announcement}`);
    await this.publishGameEvent('round:result', resultPayload);
    await this.saveSnapshotToRedis();

    if (this.nextRoundTimer) clearTimeout(this.nextRoundTimer);
    this.nextRoundTimer = setTimeout(() => {
      this.startNextRound().catch((e) => this.logger.error(e.message));
    }, Math.max(0, this.nextRoundStartsAt - Date.now()));
  }

  private async startNextRound() {
    this.roundNumber += 1;
    this.battlePhase = 1;
    this.phase1Winner = null;
    this.roundStatus = 'fighting';
    this.hostageState = 'captured';
    this.policeScore = 0;
    this.smugglerScore = 0;
    this.currentHostageIndex = 1;
    this.rescuedCount = { police: 0, smuggler: 0 };
    this.characters.clear();
    this.bombs.clear();
    this.dynamicObstacles.clear();
    for (const z of this.captureZones) {
      z.control = 'neutral';
      z.progress = 0;
    }
    for (let i = 0; i < this.hostages.length; i++) {
      this.hostages[i] = { ...INITIAL_HOSTAGES[i] };
    }
    this.roundEndsAt = Date.now() + this.roundDurationSeconds * 1000;
    this.nextRoundStartsAt = null;
    this.spawnLaneGates();
    await this.saveSnapshotToRedis();
    await this.publishGameEvent('battle:snapshot', this.getSnapshot());
    this.logger.log(`Started Round #${this.roundNumber}`);
  }

  private getStatsForTier(
    tier: CharacterTier,
    forcedClass?: CharacterClass,
  ) {
    let characterClass: CharacterClass = forcedClass || 'warrior';
    if (!forcedClass) {
      if (tier === 'mythic') characterClass = 'boss';
      else if (tier === 'legendary') characterClass = 'giant';
      else if (tier === 'epic') characterClass = Math.random() < 0.5 ? 'mage' : 'cavalry';
      else if (tier === 'rare') {
        const r = Math.random();
        characterClass = r < 0.35 ? 'builder' : (r < 0.68 ? 'archer' : 'defender');
      } else characterClass = Math.random() < 0.15 ? 'builder' : 'warrior';
    }

    let baseHp = 120;
    let baseDmg = 16;
    let baseSpd = 110;
    let baseCooldown = 800;
    let baseRange = 68;

    // Multipliers theo Tier (Donate càng cao nhân vật càng bá)
    let tierMultiplier = 1;
    if (tier === 'mythic') tierMultiplier = 5.5;
    else if (tier === 'legendary') tierMultiplier = 3.5;
    else if (tier === 'epic') tierMultiplier = 2.2;
    else if (tier === 'rare') tierMultiplier = 1.45;

    if (characterClass === 'boss') {
      baseHp *= 2.8;
      baseDmg *= 2.2;
      baseSpd *= 0.95;
      baseCooldown = 700;
      baseRange = 250; // Thở lửa/băng tầm xa
    } else if (characterClass === 'giant') {
      baseHp *= 2.2;
      baseDmg *= 1.7;
      baseSpd *= 0.75; // Khổng lồ đi chậm
      baseCooldown = 900;
      baseRange = 85;
    } else if (characterClass === 'cavalry') {
      baseHp *= 1.4;
      baseDmg *= 1.4;
      baseSpd *= 1.45; // Kỵ sĩ phi nhanh
      baseCooldown = 750;
      baseRange = 80;
    } else if (characterClass === 'mage') {
      baseHp *= 0.9;
      baseDmg *= 1.6;
      baseSpd *= 1.0;
      baseCooldown = 1000;
      baseRange = 220; // Phép thuật tầm xa
    } else if (characterClass === 'builder') {
      baseHp *= 1.35;
      baseDmg *= 0.7; // Công binh chuyên sửa thành
      baseSpd *= 1.2; // Tốc độ cơ động cao để cứu thành lũy
      baseCooldown = 750; // Tần suất gõ búa sửa chữa
      baseRange = 85;
    } else if (characterClass === 'archer' || (characterClass as any) === 'gunner') {
      baseHp *= 0.85;
      baseDmg *= 1.35;
      baseSpd *= 1.05;
      baseCooldown = 950;
      baseRange = 200; // Bắn tên tầm xa
    } else if (characterClass === 'defender' || (characterClass as any) === 'tank') {
      baseHp *= 1.9;
      baseDmg *= 0.85;
      baseSpd *= 0.85;
      baseCooldown = 850;
      baseRange = 65;
    } else {
      // Kiếm sĩ (warrior / brawler)
      baseHp *= 1.1;
      baseDmg *= 1.1;
      baseSpd *= 1.0;
      baseCooldown = 750;
      baseRange = 68;
    }

    const maxHp = Math.round(baseHp * tierMultiplier);
    const damage = Math.round(baseDmg * tierMultiplier);
    const speed = Math.round(baseSpd * (1 + (tierMultiplier - 1) * 0.08));
    const cooldownMs = Math.max(400, Math.round(baseCooldown / (1 + (tierMultiplier - 1) * 0.12)));
    const attackRange = Math.round(baseRange);

    return { maxHp, damage, speed, cooldownMs, attackRange, characterClass };
  }

  async spawnCharacter(params: {
    ownerId: string;
    username: string;
    avatarUrl?: string;
    faction: FactionType;
    tier: CharacterTier;
    characterClass?: CharacterClass;
    reason: 'likes' | 'gift' | 'admin' | 'follow' | 'join_faction';
  }): Promise<CharacterStateDto | null> {
    if (this.characters.size >= this.maxCharacters) {
      let candidateKey: string | null = null;
      for (const [id, c] of this.characters.entries()) {
        if (c.status !== 'alive' || c.hp <= 0) {
          candidateKey = id;
          break;
        }
      }
      if (!candidateKey) {
        candidateKey = this.characters.keys().next().value || null;
      }
      if (candidateKey) {
        this.characters.delete(candidateKey);
      }
    }

    const stats = this.getStatsForTier(params.tier, params.characterClass);
    // Triệu hồi ngẫu nhiên tại 1 trong các pháo đài còn tồn tại của phe mình
    let x: number;
    if (params.faction === 'police') {
      const activeWalls = ['wall_blue_1', 'wall_blue_2', 'fortress_blue']
        .map((id) => this.dynamicObstacles.get(id))
        .filter((s): s is DynamicObstacleDto => !!s && s.hp > 0);
      const chosen = activeWalls[Math.floor(Math.random() * activeWalls.length)];
      const anchorX = chosen ? chosen.x : 400;
      x = Math.floor(anchorX - 50 - Math.random() * 60);
    } else {
      const activeWalls = ['wall_red_1', 'wall_red_2', 'fortress_red']
        .map((id) => this.dynamicObstacles.get(id))
        .filter((s): s is DynamicObstacleDto => !!s && s.hp > 0);
      const chosen = activeWalls[Math.floor(Math.random() * activeWalls.length)];
      const anchorX = chosen ? chosen.x : 6000;
      x = Math.floor(anchorX + 50 + Math.random() * 60);
    }
    const y = Math.floor(750 + Math.random() * 80);

    const createdDoc = await this.characterModel.create({
      sessionId: this.sessionId,
      ownerId: params.ownerId,
      username: params.username,
      avatarUrl: params.avatarUrl,
      faction: params.faction,
      type: params.tier,
      characterClass: stats.characterClass,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      damage: stats.damage,
      speed: stats.speed,
      level: 1,
      kills: 0,
      status: 'alive',
    });

    const charId = String(createdDoc._id);
    const runtimeChar: RuntimeCharacter = {
      id: charId,
      sessionId: this.sessionId,
      ownerId: params.ownerId,
      username: params.username,
      avatarUrl: params.avatarUrl,
      faction: params.faction,
      type: params.tier,
      characterClass: stats.characterClass,
      attackRange: stats.attackRange,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      damage: stats.damage,
      speed: stats.speed,
      level: 1,
      kills: 0,
      x,
      y,
      vx: 0,
      vy: 0,
      facing: params.faction === 'police' ? 'right' : 'left',
      animState: 'idle',
      targetId: null,
      status: 'alive',
      lastAttackAt: 0,
      attackCooldownMs: stats.cooldownMs,
      wanderTargetX: this.hostageX,
      wanderTargetY: this.hostageY,
    };

    this.characters.set(charId, runtimeChar);
    this.totalSpawned += 1;

    await this.sessionModel
      .updateOne({ _id: this.sessionId }, { $inc: { totalSpawned: 1 } })
      .catch(() => undefined);

    const payload: CharacterSpawnPayload = {
      version: 1,
      timestamp: Date.now(),
      character: this.toPublicDto(runtimeChar),
      reason: params.reason,
    };

    await this.publishGameEvent('character:spawn', payload);
    await this.saveSnapshotToRedis();
    return payload.character;
  }

  private async stepTick() {
    this.tickCount += 1;
    const dt = 1 / this.tickRate;
    const now = Date.now();
    await this.finishExpiredRound(now);
    const aliveList = Array.from(this.characters.values()).filter((c) => c.status === 'alive');

    let policeNearHostage = 0;
    let smugglerNearHostage = 0;

    // Cập nhật trạng thái lá chắn bảo vệ 30s của các công trình
    for (const obs of this.dynamicObstacles.values()) {
      if (obs.shieldUntil) {
        obs.isShielded = now < obs.shieldUntil;
      }
    }

    for (const char of aliveList) {
      if (char.chatBubbleExpiresAt && now > char.chatBubbleExpiresAt) {
        char.chatBubble = undefined;
        char.chatBubbleExpiresAt = undefined;
      }

      // ĐẶC THÙ CÔNG BINH (BUILDER): Ưu tiên chạy về sửa chữa và gia cố pháo đài/tường thành phe mình
      if (char.characterClass === 'builder' && this.roundStatus === 'fighting') {
        const damagedStructure = this.getActiveDamagedStructure(char.faction);
        if (damagedStructure) {
          char.targetId = damagedStructure.id;
          const dx = damagedStructure.x - char.x;
          const dy = damagedStructure.y - char.y;
          char.facing = dx >= 0 ? 'right' : 'left';
          const dist = Math.abs(dx);

          // Tính toán tốc độ hiệu dụng khi đi qua cảnh quan làm chậm
          let speedMult = 1.0;
          for (const zone of this.landscapeSlowZones) {
            if (Math.abs(char.x - zone.x) <= zone.width / 2 && Math.abs(char.y - zone.y) <= zone.height / 2) {
              speedMult = Math.min(speedMult, zone.slowFactor);
            }
          }
          const builderSpeed = Math.max(25, Math.round(char.speed * speedMult));

          if (dist > 85) {
            const ux = dx > 0 ? 1 : -1;
            char.vx = Math.round(ux * builderSpeed);
            char.vy = Math.round(this.clamp(dy / 80, -1, 1) * (builderSpeed * 0.4));
            char.x = this.clamp(char.x + char.vx * dt, 80, this.arenaWidth - 80);
            char.y = this.clamp(char.y + char.vy * dt, 740, 840);
            char.animState = 'run';
          } else {
            char.vx = 0;
            char.vy = 0;
            if (now - char.lastAttackAt >= char.attackCooldownMs) {
              char.lastAttackAt = now;
              char.animState = 'attack';
              const heal = Math.min(35, damagedStructure.maxHp - damagedStructure.hp);
              damagedStructure.hp += heal;
              const repairPayload: CharacterAttackPayload = {
                version: 1,
                timestamp: now,
                attackerId: char.id,
                targetId: damagedStructure.id,
                damage: 0,
                action: 'repair',
              };
              await this.publishGameEvent('character:attack', repairPayload);
              if (Math.random() < 0.25) {
                char.chatBubble = 'Đang gia cố thành! 🔨';
                char.chatBubbleExpiresAt = now + 2000;
              }
            } else if (now - char.lastAttackAt > 350) {
              char.animState = 'idle';
            }
          }
          continue; // Hoàn tất lượt sửa chữa của Công Binh
        }
      }

      // 1. Tìm mục tiêu lính địch gần nhất
      let nearestEnemy: RuntimeCharacter | null = null;
      let minDist = Infinity;

      for (const other of aliveList) {
        if (other.id === char.id || other.status !== 'alive') continue;
        if (other.faction === char.faction) continue;
        const dx = other.x - char.x;
        const dy = other.y - char.y;
        const dist = Math.hypot(dx, dy);
        if (dist < minDist) {
          minDist = dist;
          nearestEnemy = other;
        }
      }

      // 2. Tìm công trình phòng tuyến hiện tại của địch cần công phá (Tầng 1 -> 2 -> 3)
      const activeStructure = this.getActiveEnemyStructure(char.faction);
      const attackRange = char.attackRange || 68;

      // Tính toán tốc độ hiệu dụng khi đi qua cảnh quan làm chậm (Landscape Slow Zones)
      let speedMultiplier = 1.0;
      for (const zone of this.landscapeSlowZones) {
        if (Math.abs(char.x - zone.x) <= zone.width / 2 && Math.abs(char.y - zone.y) <= zone.height / 2) {
          speedMultiplier = Math.min(speedMultiplier, zone.slowFactor);
        }
      }
      const effectiveSpeed = Math.max(25, Math.round(char.speed * speedMultiplier));

      // Quy tắc:
      // - Nếu có lính địch gần (minDist <= 280) -> ƯU TIÊN LÍNH ĐÁNH LÍNH
      // - Nếu không có lính địch gần VÀ công trình địch ĐÃ HẾT LÁ CHẮN BẢO VỆ (now >= shieldUntil) -> CÔNG PHÁ CÔNG TRÌNH
      // - Nếu công trình địch CÒN LÁ CHẮN BẢO VỆ (30s) -> KHÔNG THỂ PHÁ TƯỜNG, lính di chuyển ra giữa sân đón đánh lính địch!
      const canAttackStructure =
        activeStructure &&
        (!activeStructure.shieldUntil || now >= activeStructure.shieldUntil);

      const shouldTargetStructure =
        canAttackStructure &&
        (!nearestEnemy || minDist > 280);

      if (shouldTargetStructure && activeStructure && this.roundStatus === 'fighting') {
        char.targetId = activeStructure.id;
        const structHalfH = (activeStructure.height || 100) / 2;
        const targetY = this.clamp(char.y, activeStructure.y - structHalfH + 20, activeStructure.y + structHalfH - 20);
        const dx = activeStructure.x - char.x;
        const dy = targetY - char.y;
        char.facing = dx >= 0 ? 'right' : 'left';
        const dist = Math.abs(dx);

        if (dist > attackRange + 15) {
          const ux = dx > 0 ? 1 : -1;
          char.vx = Math.round(ux * effectiveSpeed);
          char.vy = Math.round(this.clamp(dy / 80, -1, 1) * (effectiveSpeed * 0.4));
          const rawX = this.clamp(char.x + char.vx * dt, 80, this.arenaWidth - 80);
          const rawY = this.clamp(char.y + char.vy * dt, 740, 840);
          char.x = rawX;
          char.y = rawY;
          char.animState = 'run';
        } else {
          char.vx = 0;
          char.vy = 0;
          if (now - char.lastAttackAt >= char.attackCooldownMs) {
            char.lastAttackAt = now;
            char.animState = 'attack';
            activeStructure.hp = Math.max(0, activeStructure.hp - char.damage);

            const attackPayload: CharacterAttackPayload = {
              version: 1,
              timestamp: now,
              attackerId: char.id,
              targetId: activeStructure.id,
              damage: char.damage,
            };
            await this.publishGameEvent('character:attack', attackPayload);

            if (activeStructure.hp <= 0) {
              this.dynamicObstacles.delete(activeStructure.id);
              await this.addFactionScore(char.faction, 35);
              this.logger.log(`💥 ${char.username} (${char.faction}) đã PHÁ HỦY ${activeStructure.label}!`);

              if (activeStructure.structureRole === 'citadel') {
                // Đã phá sập Đại bản doanh -> Chiến thắng ván đấu!
                await this.finishRound(char.faction);
              } else {
                // Pháo đài tiếp theo nhận lá chắn 30s để lính 2 phe giao tranh đợt mới!
                const nextStructure = this.getActiveEnemyStructure(char.faction);
                if (nextStructure) {
                  nextStructure.shieldUntil = now + 30000;
                  nextStructure.isShielded = true;
                  this.logger.log(`🛡️ Kích hoạt 30s lá chắn giao tranh lính cho ${nextStructure.label}!`);
                }
              }
            }
          } else if (now - char.lastAttackAt > 300) {
            char.animState = 'idle';
          }
        }
      } else if (nearestEnemy && this.roundStatus === 'fighting') {
        // Lính đánh lính
        char.targetId = nearestEnemy.id;
        const dx = nearestEnemy.x - char.x;
        const dy = nearestEnemy.y - char.y;
        char.facing = dx >= 0 ? 'right' : 'left';

        if (minDist > attackRange) {
          const ux = dx / minDist;
          const uy = dy / minDist;
          char.vx = Math.round(ux * effectiveSpeed);
          char.vy = Math.round(uy * effectiveSpeed);
          const rawX = this.clamp(char.x + char.vx * dt, 80, this.arenaWidth - 80);
          const rawY = this.clamp(char.y + char.vy * dt, 740, 840);
          char.x = rawX;
          char.y = rawY;
          char.animState = 'run';
        } else {
          char.vx = 0;
          char.vy = 0;
          if (now - char.lastAttackAt >= char.attackCooldownMs) {
            char.lastAttackAt = now;
            char.animState = 'attack';
            await this.performAttack(char, nearestEnemy, now);
          } else if (now - char.lastAttackAt > 300) {
            char.animState = 'idle';
          }
        }
      } else if (this.roundStatus === 'fighting') {
        // Không có địch gần và công trình đang có khiên 30s -> Lính tiến ra trung tâm chiến trường x=3200 để nghênh chiến
        const targetX = 3200;
        const dx = targetX - char.x;
        char.facing = dx >= 0 ? 'right' : 'left';
        if (Math.abs(dx) > 30) {
          char.vx = Math.round((dx > 0 ? 1 : -1) * effectiveSpeed * 0.75);
          char.vy = 0;
          char.x = this.clamp(char.x + char.vx * dt, 80, this.arenaWidth - 80);
          char.animState = 'run';
        } else {
          char.vx = 0;
          char.vy = 0;
          char.animState = 'idle';
        }
      }
    }

    // ---------------------------------------------------------
    // HỆ THỐNG LÍNH BẮN TỈA / PHÁO THỦ PHÒNG THỦ TRÊN TƯỜNG THÀNH
    // ---------------------------------------------------------
    if (this.roundStatus === 'fighting') {
      for (const obs of this.dynamicObstacles.values()) {
        if (obs.hp <= 0 || !obs.faction) continue;

        const isCitadel = obs.structureRole === 'citadel' || obs.id.startsWith('fortress_');
        const sniperRange = isCitadel ? 680 : 450;
        const cooldownMs = isCitadel ? 1200 : 1600;
        const sniperDamage = isCitadel ? 35 : 24;

        if (!obs.lastSniperShotAt) obs.lastSniperShotAt = 0;
        if (now - obs.lastSniperShotAt < cooldownMs) continue;

        // Tìm lính địch gần nhất trong tầm bắn tỉa
        const enemyFaction: FactionType = obs.faction === 'police' ? 'smuggler' : 'police';
        let targetEnemy: RuntimeCharacter | null = null;
        let minEnemyDist = Infinity;

        for (const target of aliveList) {
          if (target.faction === enemyFaction && target.status === 'alive') {
            const dist = Math.abs(target.x - obs.x);
            if (dist <= sniperRange && dist < minEnemyDist) {
              minEnemyDist = dist;
              targetEnemy = target;
            }
          }
        }

        if (targetEnemy) {
          obs.lastSniperShotAt = now;
          targetEnemy.hp = Math.max(0, targetEnemy.hp - sniperDamage);
          targetEnemy.animState = targetEnemy.hp > 0 ? 'hurt' : 'death';

          const damagePayload: CharacterDamagePayload = {
            version: 1,
            timestamp: now,
            characterId: targetEnemy.id,
            attackerId: obs.id,
            damage: sniperDamage,
            remainingHp: targetEnemy.hp,
            maxHp: targetEnemy.maxHp,
          };
          await this.publishGameEvent('character:damage', damagePayload);

          if (targetEnemy.hp === 0) {
            targetEnemy.status = 'dead';
            this.characters.delete(targetEnemy.id);
            this.totalKills += 1;
            const deathPayload: CharacterDeathPayload = {
              version: 1,
              timestamp: now,
              characterId: targetEnemy.id,
              killerId: obs.id,
              killerUsername: `${obs.label} (Pháo Đài Bắn Tỉa)`,
              killerFaction: obs.faction,
            };
            await this.publishGameEvent('character:death', deathPayload);
            await this.addFactionScore(obs.faction, 1);
            this.characterModel
              .updateOne({ _id: targetEnemy.id }, { $set: { hp: 0, status: 'dead' } })
              .catch(() => undefined);
          }
        }
      }
    }

    // Đếm quân số đứng trong từng Cứ điểm Mục tiêu để tính tiến độ chiếm đóng
    for (const zone of this.captureZones) {
      let policeCount = 0;
      let smugglerCount = 0;
      for (const char of aliveList) {
        const d = Math.hypot(char.x - zone.x, char.y - zone.y);
        if (d <= zone.radius) {
          if (char.faction === 'police') policeCount += 1;
          else smugglerCount += 1;
        }
      }

      if (this.roundStatus === 'fighting') {
        const diff = policeCount - smugglerCount;
        if (diff > 0) {
          zone.progress = Math.min(100, zone.progress + diff * 4 * dt * 20);
        } else if (diff < 0) {
          zone.progress = Math.max(-100, zone.progress + diff * 4 * dt * 20);
        }

        // Cập nhật phe kiểm soát cứ điểm
        if (zone.progress >= 50) {
          zone.control = 'police';
        } else if (zone.progress <= -50) {
          zone.control = 'smuggler';
        } else {
          zone.control = 'neutral';
        }

        // Cứ điểm thuộc về phe nào sẽ cộng điểm dồn dập mỗi giây cho phe đó
        if (this.tickCount % this.tickRate === 0) {
          if (zone.control === 'police') {
            await this.addFactionScore('police', zone.bonusPerSec);
          } else if (zone.control === 'smuggler') {
            await this.addFactionScore('smuggler', zone.bonusPerSec);
          }
        }
      }
    }

    // KIỂM TRA ĐIỀU KIỆN CHUYỂN BƯỚC 2:
    // "Phải chiếm toàn bộ khu vực tranh chấp (cả 3 cứ điểm) mới tính chuyển sang Bước 2"
    if (this.roundStatus === 'fighting' && this.battlePhase === 1) {
      const policeControlsAll = this.captureZones.every((z) => z.control === 'police');
      const smugglerControlsAll = this.captureZones.every((z) => z.control === 'smuggler');

      if (policeControlsAll) {
        this.battlePhase = 2;
        this.phase1Winner = 'police';
        this.logger.log(`PHE 1 (CÔNG AN) ĐÃ CHIẾM TOÀN BỘ CỨ ĐIỂM -> KÍCH HOẠT BƯỚC 2: QUYẾT CHIẾN GIẢI CỨU CON TIN!`);
        await this.addFactionScore('police', 15);
      } else if (smugglerControlsAll) {
        this.battlePhase = 2;
        this.phase1Winner = 'smuggler';
        this.logger.log(`PHE 2 (BUÔN LẬU) ĐÃ CHIẾM TOÀN BỘ CỨ ĐIỂM -> KÍCH HOẠT BƯỚC 2: QUYẾT CHIẾN HẠ GỤC CON TIN!`);
        await this.addFactionScore('smuggler', 15);
      }
    }

    // (Đã loại bỏ cơ chế con tin & bom cũ để tối ưu theo yêu cầu công thành 3 tầng pháo đài & tường)

    // XỬ LÝ BOM ĐẾM NGƯỢC VÀ PHÁT NỔ TỰ ĐỘNG
    for (const [bombId, bomb] of this.bombs.entries()) {
      if (bomb.state === 'exploded') {
        this.bombs.delete(bombId);
        continue;
      }

      bomb.timerMs = Math.max(0, bomb.timerMs - dt * 1000);
      const enemyFaction: FactionType = bomb.faction === 'police' ? 'smuggler' : 'police';

      // Kích nổ khi hết thời gian đếm ngược HOẶC khi có kẻ địch giẫm vào phạm vi 50px
      let triggered = bomb.timerMs <= 0;
      if (!triggered) {
        for (const char of aliveList) {
          if (char.faction === enemyFaction) {
            const d = Math.hypot(char.x - bomb.x, char.y - bomb.y);
            if (d <= 50) {
              triggered = true;
              break;
            }
          }
        }
      }

      if (triggered) {
        bomb.state = 'exploded';
        let killedCount = 0;

        // Gây sát thương AoE lên quân địch & hất văng (Knockback)
        for (const char of aliveList) {
          if (char.faction === enemyFaction) {
            const dist = Math.hypot(char.x - bomb.x, char.y - bomb.y);
            if (dist <= bomb.radius) {
              const dmg = Math.round(bomb.damage * (1 - (dist / bomb.radius) * 0.45));
              char.hp = Math.max(0, char.hp - dmg);
              char.animState = char.hp > 0 ? 'hurt' : 'death';

              const angle = Math.atan2(char.y - bomb.y, char.x - bomb.x);
              const push = (1 - dist / bomb.radius) * 70;
              char.x = this.clamp(char.x + Math.cos(angle) * push, 80, this.arenaWidth - 80);
              char.y = this.clamp(char.y + Math.sin(angle) * push, 120, this.arenaHeight - 100);

              if (char.hp === 0) {
                char.status = 'dead';
                this.characters.delete(char.id);
                killedCount++;
                this.totalKills += 1;
                const deathPayload: CharacterDeathPayload = {
                  version: 1,
                  timestamp: now,
                  characterId: char.id,
                  killerId: `bomb_${bomb.faction}`,
                  killerUsername: bomb.placedBy,
                  killerFaction: bomb.faction,
                };
                await this.publishGameEvent('character:death', deathPayload);
                this.characterModel
                  .updateOne({ _id: char.id }, { $set: { hp: 0, status: 'dead' } })
                  .catch(() => undefined);
              }
            }
          }
        }

        // Bom làm nổ sứt mẻ hoặc phá hủy chướng ngại vật xung quanh
        for (const [obsId, obs] of this.dynamicObstacles.entries()) {
          const d = Math.hypot(obs.x - bomb.x, obs.y - bomb.y);
          if (d <= bomb.radius) {
            obs.hp -= 60;
            if (obs.hp <= 0) {
              this.dynamicObstacles.delete(obsId);
            }
          }
        }

        const explodePayload: BombExplodedPayload = {
          version: 1,
          timestamp: now,
          bombId,
          faction: bomb.faction,
          x: bomb.x,
          y: bomb.y,
          radius: bomb.radius,
          damage: bomb.damage,
          killedCount,
        };
        await this.publishGameEvent('bomb:exploded', explodePayload);
        this.logger.log(`💥 BOM NỔ tại (${bomb.x}, ${bomb.y})! Hạ gục ${killedCount} quân địch!`);
      }
    }

    // XỬ LÝ CHƯỚNG NGẠI VẬT HẾT HẠN
    for (const [obsId, obs] of this.dynamicObstacles.entries()) {
      if (now - obs.createdAt >= obs.durationMs) {
        this.dynamicObstacles.delete(obsId);
      }
    }

    const movePayload: CharacterMovePayload = {
      ...this.getRoundTiming(),
      version: 1,
      sessionId: this.sessionId,
      tickRate: this.tickRate,
      tick: this.tickCount,
      timestamp: now,
      roundNumber: this.roundNumber,
      battlePhase: this.battlePhase,
      phase1Winner: this.phase1Winner,
      roundStatus: this.roundStatus,
      hostageState: this.hostageState,
      policeScore: this.policeScore,
      smugglerScore: this.smugglerScore,
      targetScore: this.targetScore,
      policeWins: this.policeWins,
      smugglerWins: this.smugglerWins,
      characters: Array.from(this.characters.values())
        .filter((c) => c.status === 'alive')
        .map((c) => ({
          id: c.id,
          x: Math.round(c.x),
          y: Math.round(c.y),
          vx: c.vx,
          vy: c.vy,
          facing: c.facing,
          animState: c.animState,
          hp: c.hp,
        })),
      captureZones: this.captureZones.map((z) => ({
        id: z.id,
        name: z.name,
        control: z.control,
        progress: Math.round(z.progress),
        hostageId: z.hostageId,
      })),
      hostages: this.hostages.map((h) => ({
        id: h.id,
        name: h.name,
        x: Math.round(h.x),
        y: Math.round(h.y),
        vx: h.vx,
        vy: h.vy,
        state: h.state,
        carrierFaction: h.carrierFaction,
        zoneId: h.zoneId,
        policeNearby: h.policeNearby,
        smugglerNearby: h.smugglerNearby,
      })),
      rescuedCount: { ...this.rescuedCount },
      bombs: Array.from(this.bombs.values()),
      dynamicObstacles: Array.from(this.dynamicObstacles.values()),
    };

    await this.publishGameEvent('character:move', movePayload);

    if (this.tickCount % 10 === 0) {
      await this.saveSnapshotToRedis();
      await this.publishGameEvent('battle:snapshot', this.getSnapshot());
    }
  }

  private async performAttack(attacker: RuntimeCharacter, target: RuntimeCharacter, now: number) {
    if (target.status !== 'alive') return;

    const damage = attacker.damage;
    target.hp = Math.max(0, target.hp - damage);
    target.animState = target.hp > 0 ? 'hurt' : 'death';

    const attackPayload: CharacterAttackPayload = {
      version: 1,
      timestamp: now,
      attackerId: attacker.id,
      targetId: target.id,
      damage,
    };
    await this.publishGameEvent('character:attack', attackPayload);

    const damagePayload: CharacterDamagePayload = {
      version: 1,
      timestamp: now,
      characterId: target.id,
      attackerId: attacker.id,
      damage,
      remainingHp: target.hp,
      maxHp: target.maxHp,
    };
    await this.publishGameEvent('character:damage', damagePayload);

    if (target.hp <= 0) {
      target.status = 'dead';
      this.characters.delete(target.id);
      attacker.kills += 1;
      this.totalKills += 1;

      const deathPayload: CharacterDeathPayload = {
        version: 1,
        timestamp: now,
        characterId: target.id,
        killerId: attacker.id,
        killerUsername: attacker.username,
        killerFaction: attacker.faction,
      };
      await this.publishGameEvent('character:death', deathPayload);

      // Killing an enemy awards +8 points to the killer's faction
      await this.addFactionScore(attacker.faction, 8);

      this.characterModel
        .updateOne({ _id: target.id }, { $set: { hp: 0, status: 'dead' } })
        .catch(() => undefined);
      this.characterModel
        .updateOne({ _id: attacker.id }, { $inc: { kills: 1 } })
        .catch(() => undefined);
      this.userModel
        .updateOne({ tiktokUserId: attacker.ownerId }, { $inc: { totalPoints: 25 } })
        .catch(() => undefined);
      this.sessionModel
        .updateOne({ _id: this.sessionId }, { $inc: { totalKills: 1 } })
        .catch(() => undefined);
    }
  }

  getSnapshot(): BattleSnapshot {
    return {
      ...this.getRoundTiming(),
      version: 1,
      tickRate: this.tickRate,
      sessionId: this.sessionId,
      streamerUsername: this.streamerUsername,
      status: this.status,
      tick: this.tickCount,
      timestamp: Date.now(),
      arenaWidth: this.arenaWidth,
      arenaHeight: this.arenaHeight,
      roundNumber: this.roundNumber,
      battlePhase: this.battlePhase,
      phase1Winner: this.phase1Winner,
      roundStatus: this.roundStatus,
      hostageState: this.hostageState,
      policeScore: this.policeScore,
      smugglerScore: this.smugglerScore,
      targetScore: this.targetScore,
      policeWins: this.policeWins,
      smugglerWins: this.smugglerWins,
      totalSpawned: this.totalSpawned,
      totalKills: this.totalKills,
      characters: Array.from(this.characters.values()).map((c) => this.toPublicDto(c)),
      landscapeSlowZones: this.landscapeSlowZones,
      captureZones: this.captureZones.map((z) => ({
        id: z.id,
        name: z.name,
        control: z.control,
        progress: Math.round(z.progress),
        hostageId: z.hostageId,
      })),
      hostages: this.hostages.map((h) => ({
        id: h.id,
        name: h.name,
        x: Math.round(h.x),
        y: Math.round(h.y),
        vx: h.vx,
        vy: h.vy,
        state: h.state,
        carrierFaction: h.carrierFaction,
        zoneId: h.zoneId,
        policeNearby: h.policeNearby,
        smugglerNearby: h.smugglerNearby,
      })),
      rescuedCount: { ...this.rescuedCount },
      bombs: Array.from(this.bombs.values()),
      dynamicObstacles: Array.from(this.dynamicObstacles.values()),
    };
  }

  private toPublicDto(c: RuntimeCharacter): CharacterStateDto {
    return {
      id: c.id,
      sessionId: c.sessionId,
      ownerId: c.ownerId,
      username: c.username,
      avatarUrl: c.avatarUrl,
      faction: c.faction,
      type: c.type,
      characterClass: c.characterClass,
      attackRange: c.attackRange,
      hp: c.hp,
      maxHp: c.maxHp,
      damage: c.damage,
      speed: c.speed,
      level: c.level,
      kills: c.kills,
      x: Math.round(c.x),
      y: Math.round(c.y),
      vx: c.vx,
      vy: c.vy,
      facing: c.facing,
      animState: c.animState,
      targetId: c.targetId,
      chatBubble: c.chatBubble,
      status: c.status,
    };
  }

  private getRoundTiming(): RoundTimingState {
    return {
      roundDurationSeconds: this.roundDurationSeconds,
      roundBreakSeconds: this.roundBreakSeconds,
      roundEndsAt: this.roundEndsAt,
      nextRoundStartsAt: this.nextRoundStartsAt,
    };
  }

  private async applyRoundTiming(settings: RoundTimingSettings) {
    const timing = normalizeRoundTiming(settings);
    this.roundDurationSeconds = timing.roundDurationSeconds;
    this.roundBreakSeconds = timing.roundBreakSeconds;
    if (this.roundStatus === 'fighting') {
      this.roundEndsAt = Date.now() + timing.roundDurationSeconds * 1000;
    }
    await this.saveSnapshotToRedis();
    await this.publishGameEvent('battle:snapshot', this.getSnapshot());
  }

  private async finishExpiredRound(now = Date.now()): Promise<boolean> {
    if (this.roundStatus !== 'fighting' || this.roundEndsAt === null || now < this.roundEndsAt) return false;
    // Hết giờ hiệp đấu:
    // 1. Ưu tiên phe cứu/hạ được cả 3 con tin (3/3)
    // 2. Nếu hết giờ chưa đủ 3 con tin: So sánh số con tin cứu được, nếu bằng nhau thì so điểm số giữa 2 phe
    let winner: FactionType | null = null;
    if (this.rescuedCount.police >= 3) {
      winner = 'police';
    } else if (this.rescuedCount.smuggler >= 3) {
      winner = 'smuggler';
    } else if (this.rescuedCount.police > this.rescuedCount.smuggler) {
      winner = 'police';
    } else if (this.rescuedCount.smuggler > this.rescuedCount.police) {
      winner = 'smuggler';
    } else if (this.policeScore > this.smugglerScore) {
      winner = 'police';
    } else if (this.smugglerScore > this.policeScore) {
      winner = 'smuggler';
    } else {
      winner = null;
    }
    await this.finishRound(winner);
    return true;
  }

  private async saveSnapshotToRedis() {
    const snapshot = this.getSnapshot();
    await this.redisService.setJson(REDIS_KEYS.BATTLE_SNAPSHOT, snapshot, 3600);
  }

  private async publishGameEvent<K extends keyof import('@app/shared').GameEvents>(
    event: K,
    payload: import('@app/shared').GameEvents[K],
  ) {
    await this.redisService.publish(REDIS_CHANNELS.GAME_EVENTS, { event, payload });
  }

  private clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  onModuleDestroy() {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.nextRoundTimer) {
      clearTimeout(this.nextRoundTimer);
      this.nextRoundTimer = null;
    }
  }
}
