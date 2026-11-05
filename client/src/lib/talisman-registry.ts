export interface TalismanSummonTarget {
  unitName: string;
  classTitle: string;
  icon: string;
  color: string;
}

export interface SummonTalisman {
  id: string;
  name: string;
  symbol: string;
  tier: 'normal' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'bomb';
  triggerDesc: string;
  policeSummon: TalismanSummonTarget;
  smugglerSummon: TalismanSummonTarget;
  accentColor: string;
  bgGlow: string;
  borderHex: number;
}

export const SUMMON_TALISMANS: SummonTalisman[] = [
  {
    id: 'talisman_normal',
    name: 'Phù Tiên Phong',
    symbol: '📜',
    tier: 'normal',
    triggerDesc: 'Thả 10 Tim hoặc Chat 1 / 2',
    policeSummon: {
      unitName: 'Thánh Ế Tiên Phong',
      classTitle: 'Độc Thân Vui Tính',
      icon: '💔',
      color: '#38bdf8',
    },
    smugglerSummon: {
      unitName: 'Cặp Đôi Gà Bông',
      classTitle: 'Tập Sự Phát Cơm',
      icon: '💖',
      color: '#f43f5e',
    },
    accentColor: '#38bdf8',
    bgGlow: 'rgba(56, 189, 248, 0.22)',
    borderHex: 0x38bdf8,
  },
  {
    id: 'talisman_rare',
    name: 'Phù Thiết Giáp',
    symbol: '🛡️',
    tier: 'rare',
    triggerDesc: 'Quà 5💎 - 29💎 (Hoa Hồng, Donut)',
    policeSummon: {
      unitName: 'Hiệp Sĩ Độc Thân',
      classTitle: 'Khiên Kháng Thính',
      icon: '🛡️',
      color: '#0ea5e9',
    },
    smugglerSummon: {
      unitName: 'Chiến Thần Tỏ Tình',
      classTitle: 'Rải Đường Ngọt Ngào',
      icon: '🌹',
      color: '#fb7185',
    },
    accentColor: '#0ea5e9',
    bgGlow: 'rgba(14, 165, 233, 0.28)',
    borderHex: 0x0ea5e9,
  },
  {
    id: 'talisman_epic',
    name: 'Phù Chiến Xa',
    symbol: '⚔️',
    tier: 'epic',
    triggerDesc: 'Quà 30💎 - 99💎 (Xe SWAT, Kính Mát)',
    policeSummon: {
      unitName: 'Pháp Sư Cắt Duyên',
      classTitle: 'Bùa Chú Giải Tán',
      icon: '🧙‍♂️',
      color: '#c084fc',
    },
    smugglerSummon: {
      unitName: 'Cặp Đôi Bắn Tim',
      classTitle: 'Cơm Chó Toàn Diện',
      icon: '👩‍❤️‍👨',
      color: '#f472b6',
    },
    accentColor: '#c084fc',
    bgGlow: 'rgba(192, 132, 252, 0.32)',
    borderHex: 0xc084fc,
  },
  {
    id: 'talisman_legendary',
    name: 'Phù Siêu Thần Tướng',
    symbol: '⚡',
    tier: 'legendary',
    triggerDesc: 'Quà 100💎 - 499💎 (Tên Lửa, Thiên Nga)',
    policeSummon: {
      unitName: 'Đại Tướng Bất Cần Yêu',
      classTitle: 'Miễn Nhiễm Tình Yêu',
      icon: '⚡',
      color: '#facc15',
    },
    smugglerSummon: {
      unitName: 'Bá Vương Cơm Chó',
      classTitle: 'Tình Nồng Cháy Bỏng',
      icon: '💍',
      color: '#f59e0b',
    },
    accentColor: '#facc15',
    bgGlow: 'rgba(250, 204, 21, 0.35)',
    borderHex: 0xfacc15,
  },
  {
    id: 'talisman_mythic',
    name: 'Phù Thần Thoại Diệt Thế',
    symbol: '🐉',
    tier: 'mythic',
    triggerDesc: 'Quà 500💎+ (Sư Tử, Tàu Vũ Trụ)',
    policeSummon: {
      unitName: 'Chúa Tể FA Diệt Cơm Chó',
      classTitle: 'Phá Tan Mọi Cặp Đôi',
      icon: '👑',
      color: '#22d3ee',
    },
    smugglerSummon: {
      unitName: 'Cặp Đôi Thần Thoại',
      classTitle: 'Cơm Chó Hủy Diệt FA',
      icon: '💘',
      color: '#ff007f',
    },
    accentColor: '#ff007f',
    bgGlow: 'rgba(255, 0, 127, 0.42)',
    borderHex: 0xff007f,
  },
  {
    id: 'talisman_bomb',
    name: 'Phù Hỏa Lôi',
    symbol: '💣',
    tier: 'bomb',
    triggerDesc: 'Bình luận "bom" / "c4"',
    policeSummon: {
      unitName: 'Bom Tách Đôi Chia Tay',
      classTitle: 'Sát Thương Cắt Duyên',
      icon: '💔',
      color: '#ef4444',
    },
    smugglerSummon: {
      unitName: 'Bom Rải Thính Sát Thương',
      classTitle: 'Sát Thương Bắn Tim',
      icon: '💥',
      color: '#f43f5e',
    },
    accentColor: '#ef4444',
    bgGlow: 'rgba(239, 68, 68, 0.35)',
    borderHex: 0xef4444,
  },
];

/**
 * Tự động phân tích và nhận diện Phù triệu hồi từ dữ liệu event / character
 */
export function resolveTalismanForEvent(event: {
  type?: string;
  diamondCount?: number;
  comment?: string;
  tier?: string;
  giftName?: string;
}): SummonTalisman {
  if (event.comment && /bom|bomb|min|mìn|c4|nổ/i.test(event.comment)) {
    return SUMMON_TALISMANS.find((t) => t.id === 'talisman_bomb')!;
  }

  const tier = event.tier;
  if (tier === 'mythic') return SUMMON_TALISMANS.find((t) => t.tier === 'mythic')!;
  if (tier === 'legendary') return SUMMON_TALISMANS.find((t) => t.tier === 'legendary')!;
  if (tier === 'epic') return SUMMON_TALISMANS.find((t) => t.tier === 'epic')!;
  if (tier === 'rare') return SUMMON_TALISMANS.find((t) => t.tier === 'rare')!;

  const diamonds = event.diamondCount ?? 0;
  if (diamonds >= 500) return SUMMON_TALISMANS.find((t) => t.tier === 'mythic')!;
  if (diamonds >= 100) return SUMMON_TALISMANS.find((t) => t.tier === 'legendary')!;
  if (diamonds >= 30) return SUMMON_TALISMANS.find((t) => t.tier === 'epic')!;
  if (diamonds >= 5) return SUMMON_TALISMANS.find((t) => t.tier === 'rare')!;

  return SUMMON_TALISMANS.find((t) => t.tier === 'normal')!;
}
