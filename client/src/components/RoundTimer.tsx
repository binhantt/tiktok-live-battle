import React, { useEffect, useState } from 'react';
import { BattleSnapshot } from '../types/game.types';
import { roundClock } from '../lib/round-clock';

export function RoundTimer({ state, connected }: { state: BattleSnapshot | null; connected: boolean }) {
  const [localOffset, setLocalOffset] = useState(0);

  useEffect(() => {
    setLocalOffset(0);
    const start = performance.now();
    const timer = setInterval(() => {
      setLocalOffset(performance.now() - start);
    }, 250);
    return () => clearInterval(timer);
  }, [state?.timestamp]);

  const currentRefTime = (state?.timestamp ?? Date.now()) + localOffset;
  const clock = roundClock(state, connected, currentRefTime);

  return (
    <div className={`round-timer ${clock.urgent ? 'round-timer--urgent' : ''}`}>
      <span>{clock.label}</span>
      <strong role="timer" aria-label={clock.label}>
        {clock.text}
      </strong>
    </div>
  );
}
