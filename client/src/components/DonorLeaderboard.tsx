import React from 'react';
import { DonorLeaderboardPayload } from '../types/game.types';

interface Props {
  leaderboard: DonorLeaderboardPayload | null;
  error: boolean;
  compact?: boolean;
}

const numbers = new Intl.NumberFormat('vi-VN');

export function DonorLeaderboard({ leaderboard, error, compact = false }: Props) {
  const entries = leaderboard?.entries.slice(0, compact ? 4 : 10) ?? [];
  return (
    <section className={`donor-leaderboard ${compact ? 'donor-leaderboard--overlay' : 'card'}`} aria-label="Bảng xếp hạng người donate">
      <div className="donor-heading">
        <div>
          <span className="eyebrow">🏆 TOP DONATE</span>
          {!compact && <h2>Vinh danh người tặng quà</h2>}
        </div>
        {!compact && <span className="donor-gem" aria-hidden="true">◆</span>}
      </div>
      {!compact && <p className="donor-description">Xếp hạng theo tổng kim cương tích lũy</p>}
      {entries.length > 0 ? (
        <ol className="donor-list">
          {entries.map((entry, index) => (
            <li key={entry.tiktokUserId} className={`donor-row donor-rank-${index + 1}`}>
              <span className="donor-rank" aria-label={`Hạng ${index + 1}`}>{index < 3 ? ['🥇', '🥈', '🥉'][index] : index + 1}</span>
              <span className="donor-avatar" aria-hidden="true">
                <span>{Array.from(entry.username.replace(/^@/, ''))[0]?.toUpperCase() || '?'}</span>
                {entry.avatarUrl && <img src={entry.avatarUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
              </span>
              <div className="donor-identity">
                <strong className="donor-name" title={entry.username}>@{entry.username.replace(/^@/, '')}</strong>
                {!compact && <span>{numbers.format(entry.totalGifts)} quà{entry.faction ? ` · ${entry.faction === 'police' ? 'FA' : 'Cơm Chó'}` : ''}</span>}
              </div>
              <span className="donor-total" title={`${numbers.format(entry.totalDiamonds)} kim cương`}><strong>{numbers.format(entry.totalDiamonds)}</strong><span>💎</span></span>
            </li>
          ))}
        </ol>
      ) : <p className="donor-empty">{error ? 'Lỗi kết nối' : !leaderboard ? 'Đang tải…' : 'Chưa có donate'}</p>}
      {error && entries.length > 0 && !compact && <p className="donor-description" role="status">Đang kết nối lại để cập nhật thứ hạng…</p>}
    </section>
  );
}
