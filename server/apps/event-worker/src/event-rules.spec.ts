import {
  calculateGiftComboDelta,
  calculateLikesSpawn,
  parseFactionFromComment,
  resolveGiftCharacterTier,
} from './event-rules.helper';

describe('Event Rules Helper (2-Faction Police vs Smuggler)', () => {
  describe('calculateLikesSpawn', () => {
    it('accumulates likes below threshold without spawning', () => {
      const res = calculateLikesSpawn(3, 5, 10);
      expect(res.spawnsToTrigger).toBe(0);
      expect(res.newRemainder).toBe(8);
    });

    it('spawns 1 character when total likes reach 10', () => {
      const res = calculateLikesSpawn(6, 4, 10);
      expect(res.spawnsToTrigger).toBe(1);
      expect(res.newRemainder).toBe(0);
    });

    it('handles grouped TikTok like events (e.g. 27 likes in one event)', () => {
      const res = calculateLikesSpawn(0, 27, 10);
      expect(res.spawnsToTrigger).toBe(2);
      expect(res.newRemainder).toBe(7);
    });

    it('caps burst spawns to prevent infinite spawning on massive like spikes', () => {
      const res = calculateLikesSpawn(0, 500, 10, 5);
      expect(res.spawnsToTrigger).toBe(5);
      expect(res.newRemainder).toBe(0);
    });
  });

  describe('parseFactionFromComment', () => {
    it('selects police faction when user comments 1 or cong an', () => {
      expect(parseFactionFromComment('1')).toBe('police');
      expect(parseFactionFromComment('1 chọn công an')).toBe('police');
      expect(parseFactionFromComment('phe 1')).toBe('police');
    });

    it('selects smuggler faction when user comments 2 or buon lau', () => {
      expect(parseFactionFromComment('2')).toBe('smuggler');
      expect(parseFactionFromComment('2 vào phe buôn lậu')).toBe('smuggler');
      expect(parseFactionFromComment('phe 2')).toBe('smuggler');
    });

    it('returns null for normal chat comments', () => {
      expect(parseFactionFromComment('chào mọi người')).toBeNull();
    });
  });

  describe('resolveGiftCharacterTier', () => {
    it('maps diamond count to normal, rare, epic, legendary and mythic', () => {
      expect(resolveGiftCharacterTier(1)).toBe('normal');
      expect(resolveGiftCharacterTier(10)).toBe('rare');
      expect(resolveGiftCharacterTier(50)).toBe('epic');
      expect(resolveGiftCharacterTier(200)).toBe('legendary');
      expect(resolveGiftCharacterTier(1000)).toBe('mythic');
    });
  });

  describe('calculateGiftComboDelta', () => {
    it('calculates only the newly added combo count to prevent duplicate rewards', () => {
      expect(calculateGiftComboDelta(0, 3)).toBe(3);
      expect(calculateGiftComboDelta(3, 5)).toBe(2);
      expect(calculateGiftComboDelta(5, 5)).toBe(0);
    });
  });
});
