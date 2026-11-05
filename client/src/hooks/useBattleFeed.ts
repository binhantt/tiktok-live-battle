import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { BattleSnapshot, ConnectorStatusDto, DonorLeaderboardPayload } from '../types/game.types';
import { API_BASE, apiRequest } from '../lib/api';
import { BattleEvent, BattleEvents, reduceBattleState } from '../lib/battle-state';

export function useBattleFeed(onEvent?: (event: BattleEvent) => void) {
  const [battleState, setBattleState] = useState<BattleSnapshot | null>(null);
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatusDto | null>(null);
  const [connected, setConnected] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [donors, setDonors] = useState<DonorLeaderboardPayload | null>(null);
  const [donorsError, setDonorsError] = useState(false);
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;
  const stateRef = useRef<BattleSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    let lastTickAt = 0;
    const socket = io(API_BASE, { transports: ['websocket', 'polling'], reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
    const refreshConnector = () => apiRequest<ConnectorStatusDto>('/tiktok/status')
      .then((status) => { if (active) setConnectorStatus(status); }).catch(() => {});
    let donorRequest: Promise<void> | null = null;
    let donorRefreshPending = false;
    const refreshDonors = () => {
      if (!active) return;
      if (donorRequest) { donorRefreshPending = true; return; }
      donorRequest = apiRequest<DonorLeaderboardPayload>('/battle/donors')
        .then((data) => { if (active) { setDonors(data); setDonorsError(false); } })
        .catch(() => { if (active) setDonorsError(true); })
        .finally(() => {
          donorRequest = null;
          if (donorRefreshPending) { donorRefreshPending = false; refreshDonors(); }
        });
    };
    refreshDonors();

    socket.on('connect', () => {
      lastTickAt = 0;
      stateRef.current = null;
      setBattleState(null);
      setFresh(false);
      setConnected(true);
      socket.emit('battle:request-snapshot');
      void refreshConnector();
      refreshDonors();
    });
    const offline = () => { lastTickAt = 0; setConnected(false); setFresh(false); };
    socket.on('disconnect', offline);
    socket.on('connect_error', offline);

    function listen(name: keyof BattleEvents) {
      socket.on(name, (payload: BattleEvents[keyof BattleEvents]) => {
        const event = { name, payload } as BattleEvent;
        if (event.name === 'donation:updated') { refreshDonors(); return; }
        if (event.name === 'connector:status') {
          setConnectorStatus(event.payload);
          return;
        }
        if (event.name === 'character:attack' || event.name === 'bomb:exploded') {
          callbackRef.current?.(event);
          return;
        }
        const next = reduceBattleState(stateRef.current, event);
        if (next === stateRef.current) return;
        stateRef.current = next;
        setBattleState(next);
        if (name === 'character:move') {
          lastTickAt = performance.now();
          setFresh(true);
        }
        callbackRef.current?.(event);
      });
    }
    (['battle:snapshot', 'character:move', 'character:spawn', 'character:attack', 'character:damage', 'character:death', 'bomb:exploded', 'round:result', 'connector:status', 'donation:updated'] as const).forEach(listen);
    const timer = window.setInterval(() => {
      setFresh(lastTickAt > 0 && performance.now() - lastTickAt < 2000);
    }, 500);
    // Repair missed spawns/deaths and restore the complete state after tab suspension.
    const syncTimer = window.setInterval(() => {
      if (socket.connected) socket.emit('battle:request-snapshot');
      void refreshConnector();
      refreshDonors();
    }, 3000);
    const resync = () => { if (!document.hidden && socket.connected) socket.emit('battle:request-snapshot'); };
    document.addEventListener('visibilitychange', resync);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearInterval(syncTimer);
      document.removeEventListener('visibilitychange', resync);
      socket.disconnect();
    };
  }, []);

  return { battleState, stateRef, connectorStatus, connected, fresh, donors, donorsError };
}
