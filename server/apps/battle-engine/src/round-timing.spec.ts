import { BattleEngineService } from './battle-engine.service';
import { normalizeRoundTiming } from '@app/shared';

describe('Round deadlines and configuration', () => {
  const makeEngine = () => {
    const redis = { publish: jest.fn().mockResolvedValue(1), setJson: jest.fn().mockResolvedValue(undefined) };
    const engine = new BattleEngineService(redis as any, {} as any, {} as any, {} as any, {} as any);
    return { engine, redis };
  };
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100000); });
  afterEach(() => jest.useRealTimers());

  it('loads defaults for old settings and rejects invalid stored durations', () => {
    expect(normalizeRoundTiming(null)).toEqual({ roundDurationSeconds: 180, roundBreakSeconds: 5 });
    expect(normalizeRoundTiming({ roundDurationSeconds: -1, roundBreakSeconds: Infinity })).toEqual({ roundDurationSeconds: 180, roundBreakSeconds: 5 });
    expect(normalizeRoundTiming({ roundDurationSeconds: 10, roundBreakSeconds: 0 })).toEqual({ roundDurationSeconds: 10, roundBreakSeconds: 0 });
  });

  it.each([
    [20, 10, 'police_won', 1, 0],
    [10, 20, 'smuggler_won', 0, 1],
    [10, 10, 'draw', 0, 0],
    [0, 0, 'draw', 0, 0],
  ])('settles timeout at %s–%s as %s', async (police, smuggler, status, policeWins, smugglerWins) => {
    const { engine, redis } = makeEngine();
    await (engine as any).applyRoundTiming({ roundDurationSeconds: 10, roundBreakSeconds: 5 });
    (engine as any).policeScore = police;
    (engine as any).smugglerScore = smuggler;
    jest.setSystemTime(109999);
    await (engine as any).stepTick();
    expect(engine.getSnapshot().roundStatus).toBe('fighting');
    jest.setSystemTime(110000);
    await (engine as any).stepTick();
    expect(engine.getSnapshot()).toMatchObject({ roundStatus: status, policeWins, smugglerWins, roundEndsAt: null, nextRoundStartsAt: 115000 });
    await (engine as any).stepTick();
    expect(redis.publish.mock.calls.filter((call) => call[1].event === 'round:result')).toHaveLength(1);
    engine.onModuleDestroy();
  });

  it('starts the next round after the configured break with a fresh deadline', async () => {
    const { engine } = makeEngine();
    await (engine as any).applyRoundTiming({ roundDurationSeconds: 60, roundBreakSeconds: 3 });
    jest.setSystemTime(160000);
    await (engine as any).stepTick();
    await jest.advanceTimersByTimeAsync(2999);
    expect(engine.getSnapshot().roundStatus).toBe('draw');
    await jest.advanceTimersByTimeAsync(1);
    expect(engine.getSnapshot()).toMatchObject({ roundNumber: 2, roundStatus: 'fighting', roundEndsAt: 223000, nextRoundStartsAt: null, policeScore: 0, smugglerScore: 0 });
    engine.onModuleDestroy();
  });

  it('restarts the active countdown when the host applies new settings', async () => {
    const { engine, redis } = makeEngine();
    jest.setSystemTime(130000);
    await (engine as any).applyRoundTiming({ roundDurationSeconds: 300, roundBreakSeconds: 8 });
    expect(engine.getSnapshot()).toMatchObject({ roundEndsAt: 430000, roundDurationSeconds: 300, roundBreakSeconds: 8 });
    expect(redis.publish).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ event: 'battle:snapshot' }));
  });

  it('does not accept a late score change after the deadline', async () => {
    const { engine } = makeEngine();
    await (engine as any).applyRoundTiming({ roundDurationSeconds: 10, roundBreakSeconds: 5 });
    (engine as any).policeScore = 20;
    jest.setSystemTime(110001);
    await (engine as any).addFactionScore('smuggler', 100);
    expect(engine.getSnapshot()).toMatchObject({ roundStatus: 'police_won', smugglerScore: 0 });
    engine.onModuleDestroy();
  });
});
