import { roundClock } from '../../client/src/lib/round-clock';
import { BattleSnapshot } from '../../client/src/types/game.types';

describe('Server-based round clock', () => {
  const state = { timestamp: 100000, roundEndsAt: 280000, nextRoundStartsAt: null, roundStatus: 'fighting' } as BattleSnapshot;
  it('formats time from server timestamps rather than the local system clock', () => {
    expect(roundClock(state, true).text).toBe('03:00');
    expect(roundClock({ ...state, timestamp: 270001 }, true)).toMatchObject({ text: '00:10', urgent: true });
  });
  it('shows a break countdown after a draw', () => {
    expect(roundClock({ ...state, roundStatus: 'draw', roundEndsAt: null, nextRoundStartsAt: 105000 }, true)).toMatchObject({ text: '00:05', label: 'Hiệp mới sau', urgent: false });
  });
  it('never shows negative time or claims synchronization when offline', () => {
    expect(roundClock({ ...state, timestamp: 999999 }, true).text).toBe('00:00');
    expect(roundClock(state, false).text).toBe('--:--');
    expect(roundClock(null, true).text).toBe('--:--');
  });
});
