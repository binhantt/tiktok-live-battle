import Redis from 'ioredis';
import { RedisService } from './redis.service';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  on: jest.fn(), connect: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(1), quit: jest.fn().mockResolvedValue('OK'),
})));

describe('Redis Pub/Sub startup', () => {
  beforeEach(() => (Redis as unknown as jest.Mock).mockClear());

  it('uses a dedicated lazy subscriber without INFO or CLIENT initialization commands', () => {
    new RedisService();
    expect(Redis).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      lazyConnect: true, enableReadyCheck: false, disableClientInfo: true,
    }));
  });

  it('connects once before subscribing to multiple channels', async () => {
    const service = new RedisService();
    const subscriber = (Redis as unknown as jest.Mock).mock.results[1].value;
    await Promise.all([service.subscribe('game', jest.fn()), service.subscribe('status', jest.fn())]);
    expect(subscriber.connect).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith('game');
    expect(subscriber.subscribe).toHaveBeenCalledWith('status');
    expect(subscriber.connect.mock.invocationCallOrder[0]).toBeLessThan(subscriber.subscribe.mock.invocationCallOrder[0]);
  });

  it('does not lose a message delivered with the subscription acknowledgement', async () => {
    const service = new RedisService();
    const subscriber = (Redis as unknown as jest.Mock).mock.results[1].value;
    const message = subscriber.on.mock.calls.find(([name]: [string]) => name === 'message')[1];
    subscriber.subscribe.mockImplementation(async () => { message('game', JSON.stringify({ tick: 1 })); return 1; });
    const handler = jest.fn();
    await service.subscribe('game', handler);
    expect(handler).toHaveBeenCalledWith({ tick: 1 });
  });
});
