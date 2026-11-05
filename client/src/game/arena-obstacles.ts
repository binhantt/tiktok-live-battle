export interface Obstacle {
  id: string;
  type: 'barrier' | 'bunker' | 'crate' | 'rock';
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  label?: string;
}

export type ObjectiveState = 'neutral' | 'police' | 'smuggler';

export interface HostageUnit {
  id: number; // 1, 2, 3
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

export interface CaptureZone {
  id: string;
  name: string;
  icon: string;
  x: number;
  y: number;
  radius: number;
  hostageId: number;
  control: ObjectiveState;
  progress: number;
  bonusPerSec: number;
}

export const CAPTURE_ZONES_CONFIG: Array<Omit<CaptureZone, 'control' | 'progress'>> = [
  {
    id: 'zone_north',
    name: 'Khu Tranh Chấp 1 (Con Tin #1)',
    icon: '1️⃣',
    x: 960,
    y: 200,
    radius: 100,
    hostageId: 1,
    bonusPerSec: 1,
  },
  {
    id: 'zone_center',
    name: 'Khu Tranh Chấp 2 (Con Tin #2)',
    icon: '2️⃣',
    x: 960,
    y: 540,
    radius: 110,
    hostageId: 2,
    bonusPerSec: 2,
  },
  {
    id: 'zone_south',
    name: 'Khu Tranh Chấp 3 (Con Tin #3)',
    icon: '3️⃣',
    x: 960,
    y: 880,
    radius: 100,
    hostageId: 3,
    bonusPerSec: 1,
  },
];

export const INITIAL_HOSTAGES: HostageUnit[] = [
  {
    id: 1,
    name: 'Con Tin Số 1',
    x: 960,
    y: 200,
    vx: 0,
    vy: 0,
    state: 'captured',
    carrierFaction: null,
    zoneId: 'zone_north',
  },
  {
    id: 2,
    name: 'Con Tin Số 2',
    x: 960,
    y: 540,
    vx: 0,
    vy: 0,
    state: 'captured',
    carrierFaction: null,
    zoneId: 'zone_center',
  },
  {
    id: 3,
    name: 'Con Tin Số 3',
    x: 960,
    y: 880,
    vx: 0,
    vy: 0,
    state: 'captured',
    carrierFaction: null,
    zoneId: 'zone_south',
  },
];

export const ARENA_OBSTACLES: Obstacle[] = [];
