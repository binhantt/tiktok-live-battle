import { BattleSnapshot } from '../types/game.types';

export function roundClock(
  state: BattleSnapshot | null,
  connected: boolean,
  currentTimeMs?: number,
) {
  const fighting = state?.roundStatus === 'fighting';
  const deadline = fighting ? state?.roundEndsAt : state?.nextRoundStartsAt;

  // Nếu truyền currentTimeMs thì dùng currentTimeMs, còn mặc định dùng state.timestamp (hoặc fallback Date.now())
  const refTime =
    typeof currentTimeMs === 'number'
      ? currentTimeMs
      : typeof state?.timestamp === 'number'
        ? state.timestamp
        : Date.now();

  const seconds =
    state && connected && typeof deadline === 'number'
      ? Math.max(0, Math.ceil((deadline - refTime) / 1000))
      : null;

  return {
    text:
      seconds === null
        ? '--:--'
        : `${Math.floor(seconds / 60)
            .toString()
            .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`,
    label: fighting ? 'Thời gian còn lại' : 'Hiệp mới sau',
    urgent: fighting && seconds !== null && seconds <= 10,
    seconds,
  };
}
