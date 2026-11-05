import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../lib/api';
import { CharacterClass, CharacterTier, FactionType } from '../types/game.types';

interface UnitDef {
  id: string;
  name: string;
  category: 'all' | 'infantry' | 'defender' | 'ranged' | 'mage' | 'builder' | 'cavalry' | 'boss';
  characterClass: CharacterClass;
  tier: CharacterTier;
  cost: number;
  icon: string;
  tag: string;
  desc: string;
  isBomb?: boolean;
}

const UNITS: UnitDef[] = [
  {
    id: 'warrior',
    name: 'Kiếm Sĩ',
    category: 'infantry',
    characterClass: 'warrior',
    tier: 'normal',
    cost: 100,
    icon: '⚔️',
    tag: 'Bộ Binh',
    desc: 'Cận chiến tốc độ vừa, chém kiếm liên hoàn',
  },
  {
    id: 'defender',
    name: 'Khiên Sĩ',
    category: 'defender',
    characterClass: 'defender',
    tier: 'rare',
    cost: 120,
    icon: '🛡️',
    tag: 'Phòng Thủ',
    desc: 'Giáp dày máu trâu, đỡ đòn cho đồng đội',
  },
  {
    id: 'archer',
    name: 'Cung Thủ',
    category: 'ranged',
    characterClass: 'archer',
    tier: 'rare',
    cost: 130,
    icon: '🏹',
    tag: 'Tầm Xa',
    desc: 'Bắn mưa tên tầm xa, hỗ trợ phía sau',
  },
  {
    id: 'mage',
    name: 'Pháp Sư',
    category: 'mage',
    characterClass: 'mage',
    tier: 'epic',
    cost: 180,
    icon: '🔮',
    tag: 'Phép Thuật',
    desc: 'Bắn cầu ma pháp nổ diện rộng, dame cực lớn',
  },
  {
    id: 'builder',
    name: 'Công Binh',
    category: 'builder',
    characterClass: 'builder',
    tier: 'rare',
    cost: 150,
    icon: '🔨',
    tag: 'Sửa Thành',
    desc: 'Cầm búa phục hồi máu pháo đài & tường thành',
  },
  {
    id: 'bomb_cannon',
    name: 'Pháo Binh',
    category: 'infantry',
    characterClass: 'warrior',
    tier: 'epic',
    cost: 300,
    icon: '💣',
    tag: 'Công Phá',
    desc: 'Đặt bom nổ tung công trình & phòng tuyến địch',
    isBomb: true,
  },
  {
    id: 'cavalry',
    name: 'Kỵ Binh',
    category: 'cavalry',
    characterClass: 'cavalry',
    tier: 'epic',
    cost: 250,
    icon: '🐎',
    tag: 'Đột Phá',
    desc: 'Phi ngựa thần tốc, húc bay phòng tuyến địch',
  },
  {
    id: 'boss_dragon',
    name: 'Rồng Thần',
    category: 'boss',
    characterClass: 'boss',
    tier: 'mythic',
    cost: 1200,
    icon: '🐉',
    tag: 'Thần Thoại',
    desc: 'Chúa tể thần thoại bay trên cao, phun bão lửa thiêu rụi quân địch',
  },
];

interface SummonDockProps {
  onSummonSuccess?: (msg: string) => void;
}

export const SummonDock: React.FC<SummonDockProps> = ({ onSummonSuccess }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [selectedFaction, setSelectedFaction] = useState<FactionType>('police');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [autoSpawn, setAutoSpawn] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const autoSpawnTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (onSummonSuccess) onSummonSuccess(msg);
    window.setTimeout(() => setToastMessage(null), 2500);
  };

  const handleSummon = async (unit: UnitDef) => {
    try {
      if (unit.isBomb) {
        await apiRequest('/battle/deploy-bomb', {
          method: 'POST',
          body: JSON.stringify({
            faction: selectedFaction,
            placedBy: selectedFaction === 'police' ? 'Pháo Binh FA' : 'Pháo Binh Cơm Chó',
          }),
        });
        showToast(`💣 Đã phóng bom phá thành cho ${selectedFaction === 'police' ? 'Phe FA (Xanh)' : 'Phe Cơm Chó (Đỏ)'}!`);
      } else {
        await apiRequest('/characters/spawn', {
          method: 'POST',
          body: JSON.stringify({
            faction: selectedFaction,
            characterClass: unit.characterClass,
            tier: unit.tier,
            username: `Triệu Hồi ${unit.name}`,
            ownerId: `streamer_${Date.now()}`,
          }),
        });
        showToast(`✨ Đã triệu hồi [${unit.name}] phe ${selectedFaction === 'police' ? 'Đội Xanh' : 'Đội Đỏ'}!`);
      }

      setCooldowns((prev) => ({ ...prev, [unit.id]: Date.now() + 600 }));
    } catch (err: any) {
      showToast(`❌ Lỗi triệu hồi: ${err?.message || 'Không kết nối được server'}`);
    }
  };

  // Tự động thả lính liên tục khi bật Auto
  useEffect(() => {
    if (!autoSpawn) {
      if (autoSpawnTimerRef.current) clearInterval(autoSpawnTimerRef.current);
      return;
    }

    const availableUnits: UnitDef[] = UNITS.filter((u) => !u.isBomb);
    autoSpawnTimerRef.current = window.setInterval(async () => {
      const randomUnit = availableUnits[Math.floor(Math.random() * availableUnits.length)];
      const randomFaction: FactionType = Math.random() < 0.5 ? 'police' : 'smuggler';
      try {
        await apiRequest('/characters/spawn', {
          method: 'POST',
          body: JSON.stringify({
            faction: randomFaction,
            characterClass: randomUnit.characterClass,
            tier: randomUnit.tier,
            username: `Auto ${randomUnit.name}`,
            ownerId: `auto_${Date.now()}`,
          }),
        });
      } catch {}
    }, 2800);

    return () => {
      if (autoSpawnTimerRef.current) clearInterval(autoSpawnTimerRef.current);
    };
  }, [autoSpawn]);

  const filteredUnits = selectedCategory === 'all'
    ? UNITS
    : UNITS.filter((u) => u.category === selectedCategory || (selectedCategory === 'all'));

  return (
    <div className="summon-dock-container" aria-label="Bảng Triệu Hồi Chiến Trường">
      {toastMessage && (
        <div className="summon-toast-bubble">
          {toastMessage}
        </div>
      )}

      {/* THANH ĐIỀU KHIỂN CHÍNH (TOP BAR) */}
      <div className="summon-top-toolbar">
        <button
          type="button"
          className={`summon-tool-btn ${autoSpawn ? 'is-active-pulse' : ''}`}
          onClick={() => {
            const next = !autoSpawn;
            setAutoSpawn(next);
            showToast(next ? '🤖 Đã BẬT Tự Động Thả Lính (Auto Spawn)!' : '⏸ Đã TẮT Tự Động Thả Lính!');
          }}
          title="Tự động triệu hồi quân liên tục cho cả 2 phe giao chiến"
        >
          <span className="btn-icon">{autoSpawn ? '⚡' : '⚔️'}</span>
          <span>{autoSpawn ? 'Auto: Đang BẬT' : 'Tự Động (Auto)'}</span>
        </button>

        <button
          type="button"
          className={`summon-tool-btn summon-tool-btn--highlight ${isOpen ? 'is-open' : ''}`}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span className="btn-icon">🛡️</span>
          <span>Triệu Hồi Quân {isOpen ? '▼' : '▲'}</span>
        </button>

        <button
          type="button"
          className="summon-tool-btn"
          onClick={() => handleSummon(UNITS.find((u) => u.id === 'builder')!)}
          title="Triệu hồi ngay 1 Công Binh sửa pháo đài"
        >
          <span className="btn-icon">🔨</span>
          <span>Sửa Thành</span>
        </button>

        <button
          type="button"
          className="summon-tool-btn summon-tool-btn--dragon"
          onClick={() => handleSummon(UNITS.find((u) => u.id === 'boss_dragon')!)}
          title="Triệu hồi ngay Rồng Thần phun lửa"
        >
          <span className="btn-icon">🐉</span>
          <span>Rồng Thần</span>
        </button>

        <button
          type="button"
          className="summon-tool-btn summon-tool-btn--bomb"
          onClick={() => handleSummon(UNITS.find((u) => u.id === 'bomb_cannon')!)}
          title="Thả bom công phá thành lũy"
        >
          <span className="btn-icon">💣</span>
          <span>Thả Bom</span>
        </button>
      </div>

      {/* KHAY TRIỆU HỒI TƯỚNG (DRAWER) */}
      {isOpen && (
        <div className="summon-drawer-panel">
          {/* HÀNG CHỌN PHE & DANH MỤC */}
          <div className="summon-filter-bar">
            {/* CHỌN PHE */}
            <div className="summon-faction-selector">
              <button
                type="button"
                className={`faction-btn faction-btn--blue ${selectedFaction === 'police' ? 'is-selected' : ''}`}
                onClick={() => setSelectedFaction('police')}
              >
                <span className="faction-dot faction-dot--blue" />
                <span>🔵 Phe FA (Đội Xanh)</span>
              </button>
              <button
                type="button"
                className={`faction-btn faction-btn--red ${selectedFaction === 'smuggler' ? 'is-selected' : ''}`}
                onClick={() => setSelectedFaction('smuggler')}
              >
                <span className="faction-dot faction-dot--red" />
                <span>🔴 Phe Cơm Chó (Đội Đỏ)</span>
              </button>
            </div>

            {/* DANH MỤC */}
            <div className="summon-category-pills">
              <button
                type="button"
                className={`cat-pill ${selectedCategory === 'all' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('all')}
              >
                Tất cả
              </button>
              <button
                type="button"
                className={`cat-pill ${selectedCategory === 'infantry' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('infantry')}
              >
                ⚔️ Bộ binh
              </button>
              <button
                type="button"
                className={`cat-pill ${selectedCategory === 'defender' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('defender')}
              >
                🛡️ Khiên sĩ
              </button>
              <button
                type="button"
                className={`cat-pill ${selectedCategory === 'ranged' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('ranged')}
              >
                🏹 Cung thủ
              </button>
              <button
                type="button"
                className={`cat-pill ${selectedCategory === 'mage' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('mage')}
              >
                🔮 Pháp sư
              </button>
              <button
                type="button"
                className={`cat-pill ${selectedCategory === 'builder' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('builder')}
              >
                🔨 Công binh
              </button>
              <button
                type="button"
                className={`cat-pill ${selectedCategory === 'cavalry' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('cavalry')}
              >
                🐎 Kỵ binh
              </button>
              <button
                type="button"
                className={`cat-pill ${selectedCategory === 'boss' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('boss')}
              >
                🐉 Rồng
              </button>
            </div>
          </div>

          {/* DANH SÁCH THẺ BÀI QUÂN LINH */}
          <div className="summon-cards-grid">
            {filteredUnits.map((unit) => {
              const onCd = (cooldowns[unit.id] ?? 0) > Date.now();
              return (
                <button
                  key={unit.id}
                  type="button"
                  disabled={onCd}
                  className={`summon-unit-card summon-unit-card--${unit.tier} ${unit.isBomb ? 'summon-unit-card--bomb' : ''}`}
                  onClick={() => handleSummon(unit)}
                  title={`${unit.desc} - Nhấp để triệu hồi`}
                >
                  <div className="unit-card-header">
                    <span className="unit-tag">{unit.tag}</span>
                    <span className="unit-cost">🟡 {unit.cost}</span>
                  </div>
                  <div className="unit-card-icon">{unit.icon}</div>
                  <div className="unit-card-name">{unit.name}</div>
                  <div className="unit-card-action">Bấm Gọi Quân</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
