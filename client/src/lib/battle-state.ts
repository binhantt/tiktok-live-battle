import {
  BattleSnapshot, CharacterAttackPayload, CharacterDamagePayload, CharacterDeathPayload, CharacterMovePayload,
  CharacterSpawnPayload, ConnectorStatusDto, RoundResultPayload, BombExplodedPayload,
} from '../types/game.types';

export interface BattleEvents {
  'battle:snapshot': BattleSnapshot;
  'character:move': CharacterMovePayload;
  'character:spawn': CharacterSpawnPayload;
  'character:attack': CharacterAttackPayload;
  'character:damage': CharacterDamagePayload;
  'character:death': CharacterDeathPayload;
  'bomb:exploded': BombExplodedPayload;
  'round:result': RoundResultPayload;
  'connector:status': ConnectorStatusDto;
  'donation:updated': { version: number; timestamp: number };
}

export type BattleEvent = { [K in keyof BattleEvents]: { name: K; payload: BattleEvents[K] } }[keyof BattleEvents];

// Both screens derive their state from the same authoritative event contracts.
export function reduceBattleState(state: BattleSnapshot | null, event: BattleEvent): BattleSnapshot | null {
  if (event.name === 'battle:snapshot') {
    const next = event.payload;
    if (state && next.sessionId === state.sessionId && next.timestamp < state.timestamp) return state;
    return next;
  }
  if (!state) return state;
  switch (event.name) {
    case 'character:move': {
      const next = event.payload;
      if (next.sessionId !== state.sessionId || next.timestamp < state.timestamp) return state;
      const moves = new Map(next.characters.map((item) => [item.id, item]));
      return {
        ...state, ...next,
        characters: state.characters.filter((char) => moves.has(char.id)).map((char) => ({ ...char, ...moves.get(char.id) })),
        captureZones: next.captureZones ?? state.captureZones,
        hostages: next.hostages ?? state.hostages,
        rescuedCount: next.rescuedCount ?? state.rescuedCount,
        bombs: next.bombs ?? state.bombs,
        dynamicObstacles: next.dynamicObstacles ?? state.dynamicObstacles,
      };
    }
    case 'character:spawn':
      if (event.payload.character.sessionId !== state.sessionId) return state;
      if (state.characters.some((char) => char.id === event.payload.character.id)) return state;
      return { ...state, totalSpawned: state.totalSpawned + 1, characters: [...state.characters, event.payload.character] };
    case 'character:damage':
      return { ...state, characters: state.characters.map((char) => char.id === event.payload.characterId
        ? { ...char, hp: event.payload.remainingHp, maxHp: event.payload.maxHp } : char) };
    case 'character:death':
      return { ...state, totalKills: state.totalKills + 1, characters: state.characters.filter((char) => char.id !== event.payload.characterId) };
    case 'round:result':
      if (event.payload.timestamp < state.timestamp || event.payload.roundNumber < state.roundNumber) return state;
      return { ...state, ...event.payload, roundStatus: event.payload.winnerFaction === 'police' ? 'police_won' : event.payload.winnerFaction === 'smuggler' ? 'smuggler_won' : 'draw' };
    default:
      return state;
  }
}
