import { CharacterClass, CharacterTier, FactionType } from '@app/shared';

export interface LikeRuleResult {
  spawnsToTrigger: number;
  newRemainder: number;
}

/**
 * Pure calculation for viewer like accumulation and character spawn count.
 * Caps spawns per single event burst to `maxSpawnsPerBurst` to prevent infinite spawn storms.
 */
export function calculateLikesSpawn(
  currentBufferedLikes: number,
  incomingLikeCount: number,
  likesPerSpawn: number,
  maxSpawnsPerBurst = 5,
): LikeRuleResult {
  const safeThreshold = Math.max(1, Math.floor(likesPerSpawn));
  const safeIncoming = Math.max(0, Math.floor(incomingLikeCount));
  const total = Math.max(0, Math.floor(currentBufferedLikes)) + safeIncoming;
  const rawSpawns = Math.floor(total / safeThreshold);
  const spawnsToTrigger = Math.min(maxSpawnsPerBurst, rawSpawns);
  const newRemainder = total % safeThreshold;
  return { spawnsToTrigger, newRemainder };
}

/**
 * Maps gift diamond value to character tier.
 * Diamond càng cao thì nhân vật càng mạnh:
 * - >= 500: mythic (Thần Thoại, siêu to khổng lồ)
 * - >= 100: legendary (Huyền Thoại)
 * - >= 30: epic (Sử Thi)
 * - >= 5: rare (Hiếm)
 * - < 5: normal (Phổ thông)
 */
export function resolveGiftCharacterTier(diamondCount = 1): CharacterTier {
  if (diamondCount >= 500) return 'mythic';
  if (diamondCount >= 100) return 'legendary';
  if (diamondCount >= 30) return 'epic';
  if (diamondCount >= 5) return 'rare';
  return 'normal';
}

/**
 * Calculates incremental gift combo delta so combo events only process the newly added quantity.
 */
export function calculateGiftComboDelta(previousProcessedCount: number, currentRepeatCount: number): number {
  const prev = Math.max(0, Math.floor(previousProcessedCount));
  const curr = Math.max(1, Math.floor(currentRepeatCount));
  return Math.max(0, curr - prev);
}

/**
 * Parses viewer comment to choose faction:
 * - "1", "phe 1", "cong an", "canh sat", "police" -> 'police'
 * - "2", "phe 2", "buon lau", "toi pham", "smuggler" -> 'smuggler'
 */
export function parseFactionFromComment(comment?: string): FactionType | null {
  if (!comment) return null;
  const normalized = comment.trim().toLowerCase();
  if (
    normalized === '1' ||
    normalized.startsWith('1 ') ||
    normalized.includes('phe 1') ||
    normalized.includes('công an') ||
    normalized.includes('cong an') ||
    normalized.includes('cảnh sát') ||
    normalized.includes('canh sat')
  ) {
    return 'police';
  }
  if (
    normalized === '2' ||
    normalized.startsWith('2 ') ||
    normalized.includes('phe 2') ||
    normalized.includes('buôn lậu') ||
    normalized.includes('buon lau') ||
    normalized.includes('nội tạng') ||
    normalized.includes('noi tang')
  ) {
    return 'smuggler';
  }
  return null;
}

export function isBombComment(comment?: string): boolean {
  if (!comment) return false;
  const n = comment.trim().toLowerCase();
  return (
    n.includes('bom') ||
    n.includes('bomb') ||
    n.includes('mìn') ||
    n.includes('min') ||
    n.includes('c4') ||
    n.includes('nổ') ||
    n.includes('qua bom') ||
    n.includes('quang bom')
  );
}

export function isObstacleComment(comment?: string): boolean {
  if (!comment) return false;
  const n = comment.trim().toLowerCase();
  return (
    n.includes('rào') ||
    n.includes('rao') ||
    n.includes('tường') ||
    n.includes('tuong') ||
    n.includes('vật cản') ||
    n.includes('vat can') ||
    n.includes('chướng ngại') ||
    n.includes('chuong ngai') ||
    n.includes('barie') ||
    n.includes('barrier') ||
    n.includes('bao cat') ||
    n.includes('bao cát')
  );
}

export function isBuilderComment(comment?: string): boolean {
  if (!comment) return false;
  const n = comment.trim().toLowerCase();
  return (
    n.includes('sua') ||
    n.includes('sửa') ||
    n.includes('cong binh') ||
    n.includes('công binh') ||
    n.includes('builder') ||
    n.includes('thợ') ||
    n.includes('tho') ||
    n.includes('búa') ||
    n.includes('bua') ||
    n.includes('gia co') ||
    n.includes('gia cố')
  );
}

export function parseCharacterClassFromComment(comment?: string): { characterClass: CharacterClass; tier?: CharacterTier } | null {
  if (!comment) return null;
  const n = comment.trim().toLowerCase();
  if (isBuilderComment(comment)) {
    return { characterClass: 'builder', tier: 'rare' };
  }
  if (n.includes('rong') || n.includes('rồng') || n.includes('dragon') || n.includes('boss') || n.includes('trum') || n.includes('trùm')) {
    return { characterClass: 'boss', tier: 'mythic' };
  }
  if (n.includes('ky binh') || n.includes('kỵ binh') || n.includes('ngua') || n.includes('ngựa') || n.includes('cavalry') || n.includes('xung phong')) {
    return { characterClass: 'cavalry', tier: 'epic' };
  }
  if (n.includes('phap su') || n.includes('pháp sư') || n.includes('mage') || n.includes('phep') || n.includes('phép') || n.includes('truong') || n.includes('trượng')) {
    return { characterClass: 'mage', tier: 'epic' };
  }
  if (n.includes('cung') || n.includes('archer') || n.includes('ban') || n.includes('bắn') || n.includes('ky cung') || n.includes('kỵ cung')) {
    return { characterClass: 'archer', tier: 'rare' };
  }
  if (n.includes('khien') || n.includes('khiên') || n.includes('tank') || n.includes('defender') || n.includes('do') || n.includes('đỡ') || n.includes('giap') || n.includes('giáp')) {
    return { characterClass: 'defender', tier: 'rare' };
  }
  if (n.includes('kiem') || n.includes('kiếm') || n.includes('warrior') || n.includes('chem') || n.includes('chém') || n.includes('linh') || n.includes('lính') || n.includes('trieu hoi') || n.includes('triệu hồi') || n.includes('danh') || n.includes('đánh') || n.includes('ra quan') || n.includes('ra quân')) {
    return { characterClass: 'warrior', tier: 'normal' };
  }
  return null;
}
