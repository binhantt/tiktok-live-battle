import { MotionTimeline } from '../../client/src/game/motion-timeline';
import { reduceBattleState } from '../../client/src/lib/battle-state';
import { BattleSnapshot, CharacterStateDto, CharacterMovePayload } from '../../client/src/types/game.types';

const character: CharacterStateDto = {
  id: 'fighter-1', sessionId: 'session-1', ownerId: 'viewer-1', username: 'Viewer',
  faction: 'police', type: 'normal', hp: 100, maxHp: 100, damage: 14, speed: 105,
  level: 1, kills: 0, x: 100, y: 200, vx: 105, vy: 0, facing: 'right', animState: 'run', status: 'alive',
};
const snapshot: BattleSnapshot = {
  roundDurationSeconds: 180, roundBreakSeconds: 5, roundEndsAt: 181000, nextRoundStartsAt: null,
  version: 1, tickRate: 20, sessionId: 'session-1', streamerUsername: 'Streamer', status: 'live', tick: 20,
  timestamp: 1000, arenaWidth: 1920, arenaHeight: 1080, roundNumber: 1, roundStatus: 'fighting',
  hostageState: 'captured', policeScore: 3, smugglerScore: 0, targetScore: 100, policeWins: 0,
  smugglerWins: 0, totalSpawned: 1, totalKills: 0, characters: [character],
};
const move: CharacterMovePayload = {
  roundDurationSeconds: 180, roundBreakSeconds: 5, roundEndsAt: 181000, nextRoundStartsAt: null,
  version: 1, sessionId: 'session-1', tickRate: 20, tick: 21, timestamp: 1050,
  roundNumber: 1, roundStatus: 'fighting', hostageState: 'captured', policeScore: 5, smugglerScore: 0,
  targetScore: 100, policeWins: 0, smugglerWins: 0,
  characters: [{ id: character.id, x: 105, y: 200, vx: 105, vy: 0, hp: 80, facing: 'right', animState: 'run' }],
};

describe('Server-timed motion', () => {
  it.each([30, 60, 144])('preserves 105 pixels/second at %s FPS', (fps) => {
    const motion = new MotionTimeline();
    for (let tick = 0; tick <= 20; tick++) motion.push({ timestamp: tick * 50, x: tick * 5.25, y: 200 });
    for (let frame = 0; frame <= fps; frame++) {
      expect(motion.at(frame * 1000 / fps)?.x).toBeCloseTo(frame * 105 / fps, 5);
    }
  });

  it('stops at the last authoritative position during packet loss', () => {
    const motion = new MotionTimeline();
    motion.push({ timestamp: 1000, x: 100, y: 200 });
    motion.push({ timestamp: 1050, x: 105, y: 200 });
    expect(motion.at(9000)).toEqual({ x: 105, y: 200 });
  });

  it('ignores out-of-order samples and tolerates equal timestamps', () => {
    const motion = new MotionTimeline();
    motion.push({ timestamp: 1000, x: 100, y: 200 });
    motion.push({ timestamp: 1050, x: 105, y: 200 });
    motion.push({ timestamp: 900, x: 0, y: 0 });
    motion.push({ timestamp: 1050, x: 110, y: 210 });
    expect(motion.at(1025)).toEqual({ x: 105, y: 205 });
  });
});

describe('Shared battle state', () => {
  it('updates scores, position and HP on the same server event', () => {
    const state = reduceBattleState(snapshot, { name: 'character:move', payload: move });
    expect(state?.policeScore).toBe(5);
    expect(state?.characters[0]).toMatchObject({ ...character, ...move.characters[0] });
  });

  it('does not rewind live movement when a cached snapshot arrives late', () => {
    const state = reduceBattleState(snapshot, { name: 'character:move', payload: move });
    expect(reduceBattleState(state, { name: 'battle:snapshot', payload: snapshot })).toBe(state);
    expect(reduceBattleState(state, { name: 'character:move', payload: { ...move, timestamp: 900 } })).toBe(state);
  });

  it('recovers a missed spawn on the next full snapshot', () => {
    const missing = { ...snapshot, characters: [] };
    expect(reduceBattleState(missing, { name: 'battle:snapshot', payload: { ...snapshot, timestamp: 1100 } })?.characters).toEqual([character]);
  });

  it('removes fighters missing from the authoritative move list', () => {
    expect(reduceBattleState(snapshot, { name: 'character:move', payload: { ...move, characters: [] } })?.characters).toEqual([]);
  });

  it('accepts a restarted engine with a lower tick and newer timestamp', () => {
    expect(reduceBattleState(snapshot, { name: 'battle:snapshot', payload: { ...snapshot, timestamp: 2000, tick: 0 } })?.tick).toBe(0);
  });

  it('restores a winning banner from a snapshot and clears it for the next round', () => {
    const won = reduceBattleState(snapshot, { name: 'battle:snapshot', payload: { ...snapshot, timestamp: 1100, roundStatus: 'police_won', hostageState: 'rescued' } });
    expect(won?.roundStatus).toBe('police_won');
    expect(reduceBattleState(won, { name: 'battle:snapshot', payload: { ...snapshot, timestamp: 1200, roundNumber: 2, characters: [] } })?.roundStatus).toBe('fighting');
  });

  it('rejects movement from a different session', () => {
    expect(reduceBattleState(snapshot, { name: 'character:move', payload: { ...move, sessionId: 'old-session' } })).toBe(snapshot);
  });
});
