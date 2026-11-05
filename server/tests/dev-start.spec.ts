const { planServices } = require('../scripts/start-dev.cjs');

describe('Development startup port checks', () => {
  const names: Record<number, string> = { 3000: 'api-gateway', 3002: 'tiktok-connector', 3003: 'event-worker', 3004: 'battle-engine' };
  const health = jest.fn(async (url: string) => ({ ok: true, json: async () => ({ ok: true, service: names[Number(new URL(url).port)] }) }));

  beforeEach(() => health.mockClear());

  it('starts all services when the ports are available', async () => {
    const plan = await planServices({}, async () => false, health);
    expect(plan.map((service: any) => service.running)).toEqual([false, false, false, false]);
    expect(health).not.toHaveBeenCalled();
  });

  it('reuses healthy services instead of starting duplicate engines', async () => {
    const plan = await planServices({}, async () => true, health);
    expect(plan.every((service: any) => service.running)).toBe(true);
    expect(health).toHaveBeenCalledTimes(4);
  });

  it('starts only the services which are missing', async () => {
    const plan = await planServices({}, async (port: number) => port === 3004, health);
    expect(plan.filter((service: any) => !service.running).map((service: any) => service.project)).toEqual(['api-gateway', 'tiktok-connector', 'event-worker']);
  });

  it('rejects a port occupied by a different application', async () => {
    await expect(planServices({}, async () => true, async () => ({ ok: true, json: async () => ({ ok: true, service: 'another-app' }) }))).rejects.toThrow('ứng dụng khác');
  });

  it('rejects a listening service which cannot answer health checks', async () => {
    await expect(planServices({}, async () => true, async () => { throw new Error('timeout'); })).rejects.toThrow('ứng dụng khác');
  });

  it('respects configured ports and refuses duplicate port settings', async () => {
    const plan = await planServices({ API_PORT: '3100' }, async () => false, health);
    expect(plan[0].port).toBe(3100);
    await expect(planServices({ API_PORT: '3004' })).rejects.toThrow('khác nhau');
    await expect(planServices({ BATTLE_PORT: 'invalid' })).rejects.toThrow('65535');
  });
});
