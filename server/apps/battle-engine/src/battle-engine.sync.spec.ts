import { BattleEngineService } from './battle-engine.service';

describe('Battle engine synchronization', () => {
  const makeEngine = () => {
    const redis = {
      ensureConsumerGroup: jest.fn().mockResolvedValue(undefined),
      createDedicatedClient: jest.fn().mockReturnValue({}),
      setJson: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = {
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'session-1', totalSpawned: 0, totalKills: 0 }) }),
    };
    const settings = { findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => null }) }) };
    const engine = new BattleEngineService(redis as any, {} as any, sessions as any, {} as any, settings as any);
    return { engine, redis };
  };

  afterEach(() => jest.useRealTimers());

  it('publishes session and server tick rate with movement', async () => {
    const { engine, redis } = makeEngine();
    await (engine as any).stepTick();
    const event = redis.publish.mock.calls[0][1];
    expect(event.event).toBe('character:move');
    expect(event.payload).toMatchObject({ sessionId: engine.getSnapshot().sessionId, tickRate: engine.getSnapshot().tickRate, tick: 1 });
  });

  it('broadcasts a complete recovery snapshot every ten ticks', async () => {
    const { engine, redis } = makeEngine();
    for (let tick = 0; tick < 10; tick++) await (engine as any).stepTick();
    const snapshots = redis.publish.mock.calls.map((call) => call[1]).filter((event) => event.event === 'battle:snapshot');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].payload).toMatchObject({ tick: 10, characters: [], roundStatus: 'fighting', tickRate: engine.getSnapshot().tickRate });
    expect(snapshots[0].payload.landscapeSlowZones).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'mud', x: 2880, slowFactor: 0.55 }),
    ]));
    expect(redis.setJson).toHaveBeenCalledTimes(1);
  });

  it('deploys temporary obstacles in the battle lane without evicting fortifications', () => {
    jest.useFakeTimers({ now: 0 });
    const { engine } = makeEngine();
    (engine as any).spawnLaneGates();
    for (let i = 1; i <= 16; i++) {
      jest.setSystemTime(i);
      engine.deployObstacle({ faction: 'police', type: 'sandbag' });
    }
    const obstacles = engine.getSnapshot().dynamicObstacles ?? [];
    expect(obstacles.filter((obstacle) => obstacle.structureRole)).toHaveLength(6);
    const temporary = obstacles.filter((obstacle) => obstacle.id.startsWith('dyn_obs_'));
    expect(temporary).toHaveLength(9);
    for (const obstacle of temporary) {
      expect(obstacle.x).toBeGreaterThanOrEqual(3045);
      expect(obstacle.x).toBeLessThanOrEqual(3135);
      expect(obstacle.y + obstacle.height / 2).toBeGreaterThanOrEqual(778);
      expect(obstacle.y + obstacle.height / 2).toBeLessThanOrEqual(818);
    }
  });

  it('does not overlap asynchronous ticks when Redis is slow', async () => {
    jest.useFakeTimers();
    const { engine } = makeEngine();
    jest.spyOn(engine as any, 'consumeCommandsLoop').mockResolvedValue(undefined);
    let finishTick!: () => void;
    const step = jest.spyOn(engine as any, 'stepTick').mockImplementation(() => new Promise<void>((resolve) => { finishTick = resolve; }));
    await engine.onModuleInit();
    try {
      await jest.advanceTimersByTimeAsync(250);
      expect(step).toHaveBeenCalledTimes(1);
      finishTick();
      await jest.advanceTimersByTimeAsync(100);
      expect(step).toHaveBeenCalledTimes(2);
      finishTick();
    } finally {
      engine.onModuleDestroy();
    }
  });
});
