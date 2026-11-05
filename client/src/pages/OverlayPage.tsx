import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { BattleScene } from '../game/BattleScene';
import { useBattleFeed } from '../hooks/useBattleFeed';
import { DonorLeaderboard } from '../components/DonorLeaderboard';
import { RoundTimer } from '../components/RoundTimer';
import { SummonTalismanGuide } from '../components/SummonTalismanGuide';
import { SummonDock } from '../components/SummonDock';
import { resolveTalismanForEvent } from '../lib/talisman-registry';

export const OverlayPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  const [activeTalismanId, setActiveTalismanId] = useState<string | null>(null);
  const talismanTimeoutRef = useRef<number | null>(null);

  const triggerTalismanPulse = (talismanId: string) => {
    setActiveTalismanId(talismanId);
    if (talismanTimeoutRef.current) clearTimeout(talismanTimeoutRef.current);
    talismanTimeoutRef.current = window.setTimeout(() => {
      setActiveTalismanId(null);
    }, 2500);
  };

  const { battleState, stateRef, connected, fresh, donors, donorsError } = useBattleFeed((event) => {
    const scene = sceneRef.current;
    if (!scene) return;
    switch (event.name) {
      case 'battle:snapshot':
        scene.applySnapshot(event.payload);
        break;
      case 'character:spawn': {
        scene.handleCharacterSpawn(event.payload);
        const talisman = resolveTalismanForEvent({ tier: event.payload.character.type });
        triggerTalismanPulse(talisman.id);
        break;
      }
      case 'character:move':
        scene.handleCharacterMove(event.payload);
        break;
      case 'character:attack':
        scene.handleCharacterAttack(event.payload);
        break;
      case 'character:damage':
        scene.handleCharacterDamage(event.payload);
        break;
      case 'character:death':
        scene.handleCharacterDeath(event.payload);
        break;
      case 'bomb:exploded':
        scene.handleBombExploded(event.payload);
        triggerTalismanPulse('talisman_bomb');
        break;
      case 'round:result':
        scene.handleRoundResult(event.payload);
        break;
    }
  });

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const scene = new BattleScene((readyScene) => {
      if (disposed) return;
      sceneRef.current = readyScene;
      if (stateRef.current) readyScene.applySnapshot(stateRef.current);
    });
    let game: Phaser.Game | undefined;
    const bootFrame = window.requestAnimationFrame(() => {
      if (disposed || !containerRef.current) return;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current,
        width: 1920,
        height: 1080,
        pixelArt: true,
        transparent: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [scene],
      });
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(bootFrame);
      if (talismanTimeoutRef.current) window.clearTimeout(talismanTimeoutRef.current);
      sceneRef.current = null;
      game?.destroy(true);
    };
  }, [stateRef]);

  // Hỗ trợ tham số URL & Phím tắt để streamer tùy biến ẩn/hiện overlay trên OBS:
  // ?clean=1: Ẩn Top Donate & Bảng Phù
  // ?noHud=1 hoặc ?hideAll=1: Ẩn sạch toàn bộ overlay, chỉ để lại nhân vật chiến đấu
  // ?noDonate=1: Ẩn Top Donate
  // ?noTalisman=1: Ẩn Bảng Phù
  // ?summon=1: Hiện khay điều khiển triệu hồi thủ công
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const isClean = searchParams.get('clean') === '1' || searchParams.get('clean') === 'true';
  const isNoHud = searchParams.get('noHud') === '1' || searchParams.get('noHud') === 'true' || searchParams.get('hideAll') === '1';
  const summonControlsEnabled = !isClean && !isNoHud
    && searchParams.get('summon') === '1' && searchParams.get('noSummon') !== '1';

  const [showDonate, setShowDonate] = useState(!isClean && !isNoHud && searchParams.get('noDonate') !== '1');
  const [showTalisman, setShowTalisman] = useState(false);
  const [showSummonDock, setShowSummonDock] = useState(summonControlsEnabled);
  const [showPkBar, setShowPkBar] = useState(!isNoHud && searchParams.get('noPk') !== '1');
  const toggleAll = () => {
    const show = !(showPkBar || showDonate || showTalisman || showSummonDock);
    setShowPkBar(show);
    setShowDonate(show);
    setShowTalisman(show);
    setShowSummonDock(show && summonControlsEnabled);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === 'h' || key === 'p') setShowPkBar((prev) => !prev);
      if (key === 'd') setShowDonate((prev) => !prev);
      if (key === 't') setShowTalisman((prev) => !prev);
      if (key === 's' && summonControlsEnabled) setShowSummonDock((prev) => !prev);
      if (key === 'o') toggleAll();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPkBar, showDonate, showTalisman, showSummonDock, summonControlsEnabled]);

  const policeScore = battleState?.policeScore ?? 0;
  const smugglerScore = battleState?.smugglerScore ?? 0;
  const totalScore = policeScore + smugglerScore;
  const policePct = totalScore > 0 ? (policeScore / totalScore) * 100 : 50;
  const smugglerPct = totalScore > 0 ? (smugglerScore / totalScore) * 100 : 50;
  const winner = battleState?.roundStatus === 'police_won' ? 'police'
    : battleState?.roundStatus === 'smuggler_won' ? 'smuggler' : battleState?.roundStatus === 'draw' ? 'draw' : null;

  return (
    <div className="overlay-root">
      {showPkBar && (
        <header className="battle-score-strip" aria-label="Tỉ số trận đấu">
          <div className="battle-score-team battle-score-team--blue">
            <div><span>FA</span><strong>{policeScore.toLocaleString()}</strong></div>
            <div className="battle-score-meter"><i style={{ width: policePct + '%' }} /></div>
          </div>
          <div className="battle-score-center">
            <span>HIỆP {battleState?.roundNumber ?? '—'}</span>
            <RoundTimer state={battleState} connected={connected && fresh} />
          </div>
          <div className="battle-score-team battle-score-team--red">
            <div><strong>{smugglerScore.toLocaleString()}</strong><span>CƠM CHÓ</span></div>
            <div className="battle-score-meter"><i style={{ width: smugglerPct + '%' }} /></div>
          </div>
        </header>
      )}
      {winner && <div className={`victory-banner banner-${winner}`}>
        {winner === 'police'
          ? '💔 HỘI FA CHIẾN THẮNG! 🎉'
          : winner === 'smuggler'
            ? '👩‍❤️‍👨 CƠM CHÓ CHIẾN THẮNG! 💖'
            : '⏱ HAI PHE HÒA NHAU!'}
      </div>}
      <div ref={containerRef} className="phaser-canvas-holder" />

      {/* Bảng Top Donate (có nút tắt nhanh và phím tắt 'D') */}
      {showDonate && (
        <div>
          <DonorLeaderboard leaderboard={donors} error={donorsError} compact />
          <button
            type="button"
            className="overlay-widget-close-btn overlay-widget-close-btn--left"
            onClick={() => setShowDonate(false)}
            title="Ẩn bảng Top Donate (Bấm phím 'D' để bật lại)"
            aria-label="Ẩn Top Donate"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bảng Phù Triệu Hồi (có nút tắt nhanh và phím tắt 'T') */}
      {showTalisman && (
        <div>
          <SummonTalismanGuide activeTalismanId={activeTalismanId} compact />
          <button
            type="button"
            className="overlay-widget-close-btn overlay-widget-close-btn--right"
            onClick={() => setShowTalisman(false)}
            title="Ẩn Bảng Phù Triệu Hồi (Bấm phím 'T' để bật lại)"
            aria-label="Ẩn Bảng Phù"
          >
            ✕
          </button>
        </div>
      )}

      {/* Khay Triệu Hồi Quân Trực Tiếp (có nút tắt nhanh và phím tắt 'S') */}
      {summonControlsEnabled && showSummonDock && <SummonDock />}

      {!isNoHud && (
        <nav className="battle-overlay-tools" aria-label="Tùy chọn overlay">
          <button type="button" aria-pressed={showPkBar} onClick={() => setShowPkBar(!showPkBar)}>Điểm (H)</button>
          {summonControlsEnabled && <button type="button" aria-pressed={showSummonDock} onClick={() => setShowSummonDock(!showSummonDock)}>Triệu hồi (S)</button>}
          <button type="button" aria-pressed={showDonate} onClick={() => setShowDonate(!showDonate)}>Donate (D)</button>
          <button type="button" aria-pressed={showTalisman} onClick={() => setShowTalisman(!showTalisman)}>Phù (T)</button>
          <button type="button" onClick={toggleAll}>{showPkBar || showDonate || showTalisman || showSummonDock ? 'Ẩn Tất Cả (O)' : 'Hiện HUD (O)'}</button>
        </nav>
      )}
    </div>
  );
};
