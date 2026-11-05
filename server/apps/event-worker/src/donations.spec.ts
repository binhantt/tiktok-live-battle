import { EventWorkerService } from './event-worker.service';
import { NormalizedTikTokEvent } from '@app/shared';

describe('Donation records and leaderboard notifications', () => {
  const gift: NormalizedTikTokEvent = {
    eventId: 'gift-1', eventKey: 'combo-1:12', type: 'gift', sessionId: 'test-session',
    tiktokUserId: 'donor-1', username: 'NguoiTangQua', faction: 'police', timestamp: 1000,
    giftId: 'rose', giftName: 'Rose', diamondCount: 2, repeatCount: 12, repeatEnd: true,
  };
  const setup = () => {
    const redis = {
      claimIdempotencyKey: jest.fn().mockResolvedValue(true),
      getClient: jest.fn().mockReturnValue({ set: jest.fn().mockResolvedValue('OK') }),
      publish: jest.fn().mockResolvedValue(1), xadd: jest.fn().mockResolvedValue('1-0'),
    };
    const users = { updateOne: jest.fn().mockResolvedValue({}) };
    const gifts = { create: jest.fn().mockResolvedValue({}) };
    return { redis, users, gifts, service: new EventWorkerService(redis as any, users as any, gifts as any, {} as any) };
  };

  it('records every donated gift even when gameplay spawns are capped', async () => {
    const { service, gifts, users, redis } = setup();
    await service.processEvent(gift);
    expect(gifts.create).toHaveBeenCalledWith(expect.objectContaining({ username: 'NguoiTangQua', quantity: 12, diamondCount: 2 }));
    expect(users.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $inc: { totalGifts: 12, totalPoints: 120 } }), expect.anything());
    expect(redis.xadd).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ count: 10 }));
    expect(redis.publish).toHaveBeenCalledWith(expect.any(String), { event: 'donation:updated', payload: { version: 1, timestamp: expect.any(Number) } });
  });

  it('counts a streak once and does not claim the final event key during interim updates', async () => {
    const { service, redis, gifts } = setup();
    await service.processEvent({ ...gift, repeatEnd: false });
    expect(redis.claimIdempotencyKey).not.toHaveBeenCalled();
    await service.processEvent(gift);
    redis.claimIdempotencyKey.mockResolvedValue(false);
    await service.processEvent(gift);
    expect(gifts.create).toHaveBeenCalledTimes(1);
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  it('does not announce a donation already present in the gift ledger', async () => {
    const { service, redis, gifts, users } = setup();
    gifts.create.mockRejectedValue({ code: 11000 });
    await service.processEvent(gift);
    expect(users.updateOne).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });
});
