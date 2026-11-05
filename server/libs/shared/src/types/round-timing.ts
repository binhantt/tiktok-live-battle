export const DEFAULT_ROUND_DURATION_SECONDS = 180;
export const DEFAULT_ROUND_BREAK_SECONDS = 5;

export interface RoundTimingSettings {
  roundDurationSeconds: number;
  roundBreakSeconds: number;
}

export function normalizeRoundTiming(settings: Partial<RoundTimingSettings> | null): RoundTimingSettings {
  const duration = settings?.roundDurationSeconds;
  const pause = settings?.roundBreakSeconds;
  return {
    roundDurationSeconds: typeof duration === 'number' && Number.isInteger(duration) && duration >= 10 && duration <= 3600 ? duration : DEFAULT_ROUND_DURATION_SECONDS,
    roundBreakSeconds: typeof pause === 'number' && Number.isInteger(pause) && pause >= 0 && pause <= 120 ? pause : DEFAULT_ROUND_BREAK_SECONDS,
  };
}
