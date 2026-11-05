export type CharacterTier = 'normal' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type CharacterClass =
  | 'brawler'
  | 'gunner'
  | 'tank'
  | 'assassin'
  | 'warrior'
  | 'archer'
  | 'mage'
  | 'defender'
  | 'giant'
  | 'cavalry'
  | 'boss'
  | 'builder';
export type FactionType = 'police' | 'smuggler';
export type RoundStatus = 'fighting' | 'police_won' | 'smuggler_won' | 'draw';
export type HostageState = 'captured' | 'rescued' | 'eliminated';

export interface CharacterStateDto {
  id: string;
  sessionId: string;
  ownerId: string;
  username: string;
  avatarUrl?: string;
  faction: FactionType;
  type: CharacterTier;
  characterClass?: CharacterClass;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  attackRange?: number;
  level: number;
  kills: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 'left' | 'right';
  animState: 'idle' | 'run' | 'attack' | 'hurt' | 'death';
  targetId?: string | null;
  chatBubble?: string;
  status: 'alive' | 'dead';
}

export interface RoundTimingState {
  roundDurationSeconds: number;
  roundBreakSeconds: number;
  roundEndsAt: number | null;
  nextRoundStartsAt: number | null;
}

export type BattlePhase = 1 | 2;

export interface HostageUnitDto {
  id: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: 'captured' | 'rescued' | 'eliminated';
  carrierFaction?: 'police' | 'smuggler' | null;
  zoneId: string;
  policeNearby?: number;
  smugglerNearby?: number;
}

export interface ObjectiveZoneDto {
  id: string;
  name: string;
  control: 'neutral' | 'police' | 'smuggler';
  progress: number;
  hostageId: number;
}

export type BombState = 'armed' | 'detonating' | 'exploded';

export interface BombDto {
  id: string;
  faction: FactionType;
  x: number;
  y: number;
  radius: number;
  damage: number;
  placedBy: string;
  timerMs: number;
  maxTimerMs: number;
  state: BombState;
  createdAt: number;
}

export interface LandscapeSlowZoneDto {
  id: string;
  kind: 'mud' | 'spikes' | 'barricade';
  x: number;
  y: number;
  width: number;
  height: number;
  slowFactor: number;
}

export interface DynamicObstacleDto {
  id: string;
  type: 'barrier' | 'bunker' | 'crate' | 'rock' | 'sandbag' | 'barbwire' | 'gate' | 'tower' | 'citadel' | 'wall';
  faction?: FactionType;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  hp: number;
  maxHp: number;
  createdAt: number;
  durationMs: number;
  shieldUntil?: number;
  isShielded?: boolean;
  tierIndex?: number;
  structureRole?: 'wall' | 'tower' | 'citadel';
  lastSniperShotAt?: number;
}

export interface BombExplodedPayload {
  version: number;
  timestamp: number;
  bombId: string;
  faction: FactionType;
  x: number;
  y: number;
  radius: number;
  damage: number;
  killedCount: number;
}

export interface BattleSnapshot extends RoundTimingState {
  version: number;
  tickRate: number;
  sessionId: string;
  streamerUsername: string;
  status: 'waiting' | 'live' | 'ended';
  tick: number;
  timestamp: number;
  arenaWidth: number;
  arenaHeight: number;
  roundNumber: number;
  battlePhase?: BattlePhase;
  phase1Winner?: FactionType | null;
  roundStatus: RoundStatus;
  hostageState: HostageState;
  policeScore: number;
  smugglerScore: number;
  targetScore: number;
  policeWins: number;
  smugglerWins: number;
  totalSpawned: number;
  totalKills: number;
  characters: CharacterStateDto[];
  landscapeSlowZones?: LandscapeSlowZoneDto[];
  captureZones?: ObjectiveZoneDto[];
  hostages?: HostageUnitDto[];
  rescuedCount?: { police: number; smuggler: number };
  bombs?: BombDto[];
  dynamicObstacles?: DynamicObstacleDto[];
}

export interface CharacterSpawnPayload {
  version: number;
  timestamp: number;
  character: CharacterStateDto;
  reason: 'likes' | 'gift' | 'admin' | 'follow' | 'join_faction';
}

export interface CharacterMoveItem {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 'left' | 'right';
  animState: 'idle' | 'run' | 'attack' | 'hurt' | 'death';
  hp: number;
}

export interface CharacterMovePayload extends RoundTimingState {
  version: number;
  sessionId: string;
  tickRate: number;
  tick: number;
  timestamp: number;
  roundNumber: number;
  battlePhase?: BattlePhase;
  phase1Winner?: FactionType | null;
  roundStatus: RoundStatus;
  hostageState: HostageState;
  policeScore: number;
  smugglerScore: number;
  targetScore: number;
  policeWins: number;
  smugglerWins: number;
  characters: CharacterMoveItem[];
  captureZones?: ObjectiveZoneDto[];
  hostages?: HostageUnitDto[];
  rescuedCount?: { police: number; smuggler: number };
  bombs?: BombDto[];
  dynamicObstacles?: DynamicObstacleDto[];
}

export interface CharacterAttackPayload {
  version: number;
  timestamp: number;
  attackerId: string;
  targetId: string;
  damage: number;
  action?: 'repair';
}

export interface CharacterDamagePayload {
  version: number;
  timestamp: number;
  characterId: string;
  attackerId: string;
  damage: number;
  remainingHp: number;
  maxHp: number;
}

export interface CharacterDeathPayload {
  version: number;
  timestamp: number;
  characterId: string;
  killerId?: string;
  killerUsername?: string;
  killerFaction?: FactionType;
}

export interface RoundResultPayload extends RoundTimingState {
  version: number;
  timestamp: number;
  roundNumber: number;
  winnerFaction: FactionType | null;
  hostageState: HostageState;
  policeScore: number;
  smugglerScore: number;
  policeWins: number;
  smugglerWins: number;
  announcement: string;
}

export interface FactionJoinedPayload {
  version: number;
  timestamp: number;
  tiktokUserId: string;
  username: string;
  faction: FactionType;
}

export interface ConnectorStatusDto {
  connected: boolean;
  username: string | null;
  sessionId: string | null;
  sessionCookie?: string | null;
  reconnectAttempts: number;
  lastConnectedAt?: string;
  lastError?: string;
  mode: 'live' | 'simulated' | 'idle';
  isLive?: boolean;
  roomId?: string;
  roomTitle?: string;
  viewerCount?: number;
}

export interface DonorLeaderboardEntry {
  tiktokUserId: string;
  username: string;
  avatarUrl?: string;
  faction?: FactionType;
  totalDiamonds: number;
  totalGifts: number;
}

export interface DonorLeaderboardPayload {
  version: number;
  timestamp: number;
  entries: DonorLeaderboardEntry[];
}
