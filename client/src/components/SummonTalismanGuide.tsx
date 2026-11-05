import React, { useState } from 'react';
import { SUMMON_TALISMANS, SummonTalisman } from '../lib/talisman-registry';

interface Props {
  activeTalismanId?: string | null;
  compact?: boolean;
}

export const SummonTalismanGuide: React.FC<Props> = ({ activeTalismanId, compact = false }) => {
  const [collapsed, setCollapsed] = useState(compact);

  return (
    <aside
      className={`talisman-guide ${compact ? 'talisman-guide--overlay' : 'card'}`}
      aria-label="Bảng phù triệu hồi tự động"
    >
      <div className="talisman-header">
        <div className="talisman-title-group">
          <span className="talisman-eyebrow">🔮 {compact ? 'PHÙ TRIỆU HỒI' : 'TỰ ĐỘNG NHẬN DIỆN'}</span>
          {!compact && <h2 className="talisman-title">Bảng Phù Triệu Hồi</h2>}
        </div>
        <button
          type="button"
          className="talisman-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Mở rộng bảng phù' : 'Thu gọn bảng phù'}
        >
          {collapsed ? '📜 Xem Phù' : '✕'}
        </button>
      </div>

      {!collapsed && (
        <>
          {!compact && (
            <p className="talisman-subtext">
              Hệ thống tự động kích hoạt Phù & triệu hồi quân theo quà / tim / comment:
            </p>
          )}
          <div className="talisman-grid">
            {SUMMON_TALISMANS.map((t: SummonTalisman) => {
              const isActive = activeTalismanId === t.id;
              return (
                <div
                  key={t.id}
                  className={`talisman-card talisman-tier-${t.tier} ${isActive ? 'talisman-card--active' : ''}`}
                  style={{
                    borderColor: t.accentColor,
                    boxShadow: isActive ? `0 0 16px ${t.accentColor}` : undefined,
                  }}
                >
                  <div className="talisman-top">
                    <span className="talisman-icon">{t.symbol}</span>
                    <span className="talisman-name">{t.name}</span>
                    <span className="talisman-trigger">{t.triggerDesc}</span>
                  </div>
                  <div className="talisman-summons">
                    <div className="talisman-faction police-summon">
                      <span className="unit-icon">{t.policeSummon.icon}</span>
                      <span className="unit-name">{t.policeSummon.unitName}</span>
                    </div>
                    <span className="vs-divider">⚔️</span>
                    <div className="talisman-faction smuggler-summon">
                      <span className="unit-icon">{t.smugglerSummon.icon}</span>
                      <span className="unit-name">{t.smugglerSummon.unitName}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
};
