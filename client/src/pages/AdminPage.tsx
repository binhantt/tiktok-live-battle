import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBattleFeed } from '../hooks/useBattleFeed';
import { apiRequest } from '../lib/api';
import { DonorLeaderboard } from '../components/DonorLeaderboard';
import { RoundTimer } from '../components/RoundTimer';
import { RoundTimingSettings } from '../components/RoundTimingSettings';
import { SummonTalismanGuide } from '../components/SummonTalismanGuide';
import { loginEntryUrl, storeTikTokLogin, takeTikTokLogin } from '../lib/tiktok-login';

export const AdminPage: React.FC = () => {
  const { battleState, connectorStatus, connected, fresh, donors, donorsError } = useBattleFeed();
  const [searchParams, setSearchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [simViewer, setSimViewer] = useState('ChiếnThần_TikTok');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authConfigured, setAuthConfigured] = useState<boolean>(false);
  const [authMessage, setAuthMessage] = useState('Đang kiểm tra cấu hình đăng nhập…');
  const callbackCode = useRef<string | null>(null);
  const [loggedInUser, setLoggedInUser] = useState<{
    displayName?: string;
    username?: string;
    avatarUrl?: string;
  } | null>(() => {
    try { const saved = localStorage.getItem('tiktok_admin_user'); return saved ? JSON.parse(saved) : null; }
    catch { return null; }
  });

  const [quickUsername, setQuickUsername] = useState('');
  const [sessionCookie, setSessionCookie] = useState(() => localStorage.getItem('tiktok_session_cookie') || '');
  const [liveCheckResult, setLiveCheckResult] = useState<{
    isLive?: boolean;
    message?: string;
    title?: string;
    viewerCount?: number;
    roomId?: string;
  } | null>(null);
  const [checkingLive, setCheckingLive] = useState(false);

  const overlayUrl = `${window.location.origin}/overlay`;
  const ready = connected && fresh;
  const police = battleState?.characters.filter((char) => char.faction === 'police').length ?? 0;
  const smugglers = battleState?.characters.filter((char) => char.faction === 'smuggler').length ?? 0;

  const connectForUser = (targetUsername: string, cookie?: string) => {
    const clean = targetUsername.trim().replace(/^@+/, '');
    if (!clean) return;
    const effectiveCookie = cookie ?? sessionCookie;
    void runAction(
      () =>
        apiRequest('/tiktok/connect', {
          method: 'POST',
          body: JSON.stringify({
            username: clean,
            sessionId: effectiveCookie,
            sessionCookie: effectiveCookie,
          }),
        }),
      `Đã kích hoạt bắt sự kiện Like & Donate cho tài khoản @${clean}!`
    );
  };

  const handleQuickLogin = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = quickUsername.trim().replace(/^@+/, '');
    if (!clean) return;
    const user = {
      username: clean,
      displayName: `@${clean}`,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(clean)}&background=fe2c55&color=fff`,
    };
    setLoggedInUser(user);
    localStorage.setItem('tiktok_admin_user', JSON.stringify(user));
    setUsername(clean);
    connectForUser(clean);
  };

  const handleCheckLive = async () => {
    const clean = (username || loggedInUser?.username || '').trim().replace(/^@+/, '');
    if (!clean) {
      setMessage({ text: 'Vui lòng nhập tên tài khoản TikTok (username) để kiểm tra.', error: true });
      return;
    }
    setCheckingLive(true);
    setLiveCheckResult(null);
    try {
      const res = await apiRequest<{
        isLive: boolean;
        message: string;
        title?: string;
        viewerCount?: number;
        roomId?: string;
      }>('/tiktok/check-live', {
        method: 'POST',
        body: JSON.stringify({ username: clean, sessionId: sessionCookie, sessionCookie }),
      });
      setLiveCheckResult(res);
      setMessage({ text: res.message, error: !res.isLive });
    } catch (err: any) {
      const errMsg = err?.message || 'Không thể kiểm tra trạng thái LIVE.';
      setLiveCheckResult({ isLive: false, message: errMsg });
      setMessage({ text: errMsg, error: true });
    } finally {
      setCheckingLive(false);
    }
  };

  const handleConnectLive = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = (username || loggedInUser?.username || '').trim().replace(/^@+/, '');
    if (!clean) return;
    if (sessionCookie) {
      localStorage.setItem('tiktok_session_cookie', sessionCookie);
    }
    void runAction(
      () =>
        apiRequest('/tiktok/connect', {
          method: 'POST',
          body: JSON.stringify({ username: clean, sessionId: sessionCookie, sessionCookie }),
        }),
      `Đã gửi yêu cầu kết nối @${clean}. Hệ thống sẽ tự động bắt quà Donate, Tim và Bình luận!`
    );
  };

  useEffect(() => {
    const code = searchParams.get('code');
    const providerError = searchParams.get('error');
    if (code || providerError) {
      if (code && callbackCode.current === code) return;
      callbackCode.current = code;
      const state = searchParams.get('state');
      const nextParams = new URLSearchParams(searchParams);
      ['code', 'state', 'scopes', 'error', 'error_description'].forEach((key) => nextParams.delete(key));
      setSearchParams(nextParams, { replace: true });
      const pending = takeTikTokLogin(state, sessionStorage, localStorage);
      if (providerError) { setMessage({ text: 'TikTok chưa cấp quyền đăng nhập. Bạn có thể bấm đăng nhập để thử lại.', error: true }); return; }
      if (!pending?.state || !pending.flowToken || pending.state !== state) {
        setMessage({ text: 'Phiên đăng nhập cũ đã hết hạn hoặc được mở từ trình duyệt khác. Bấm Đăng nhập bằng TikTok để tạo phiên mới.', error: true });
        return;
      }

      setBusy(true);
      setMessage({ text: 'Đang xác thực tài khoản TikTok OAuth...', error: false });
      apiRequest<{ ok: boolean; user?: any; message?: string }>('/tiktok/oauth-callback', {
        method: 'POST',
        signal: AbortSignal.timeout(35000),
        body: JSON.stringify({ code, state, flowToken: pending.flowToken }),
      })
        .then((res) => {
          if (res.ok && res.user) {
            setLoggedInUser(res.user);
            localStorage.setItem('tiktok_admin_user', JSON.stringify(res.user));
            if (res.user.username) {
              setUsername(res.user.username);
              connectForUser(res.user.username);
            }
            setMessage({
              text: `Đã đăng nhập TikTok: @${res.user.username || res.user.displayName}! Hệ thống đang tự động bắt sự kiện Like & Donate...`,
              error: false,
            });
          } else {
            setMessage({ text: res.message || 'Đăng nhập TikTok thất bại', error: true });
          }
        })
        .catch((e) => setMessage({ text: e.message, error: true }))
        .finally(() => setBusy(false));
      return;
    }
    let active = true;
    const autoLogin = searchParams.get('tiktok_login') === '1';
    if (autoLogin) setBusy(true);
    apiRequest<{ configured: boolean; url: string | null; csrfState?: string; flowToken?: string; redirectUri?: string; message?: string }>('/tiktok/auth-url')
      .then((res) => {
        if (!active) return;
        setAuthConfigured(res.configured);
        setAuthMessage(res.message || 'Xác minh tài khoản TikTok qua Login Kit. Kết nối LIVE ở mục bên dưới.');
        const entry = res.redirectUri ? loginEntryUrl(res.redirectUri) : null;
        // Always enter through the callback's own origin, even when the user
        // started at localhost, a LAN address, or opened the link in a new tab.
        setAuthUrl(entry);
        if (autoLogin && res.configured && entry && res.url && res.csrfState && res.flowToken) {
          const target = new URL(entry);
          if (window.location.origin !== target.origin || window.location.pathname !== target.pathname) {
            window.location.replace(entry);
            return;
          }
          storeTikTokLogin({ state: res.csrfState, flowToken: res.flowToken }, sessionStorage, localStorage);
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('tiktok_login');
          window.history.replaceState(window.history.state, '', cleanUrl.href);
          window.location.replace(res.url);
        } else if (autoLogin) {
          setBusy(false);
          setMessage({ text: res.message || 'Chưa chuẩn bị được phiên đăng nhập. Kiểm tra cấu hình server rồi thử lại.', error: true });
        }
      })
      .catch((error) => {
        if (!active) return;
        setBusy(false);
        setAuthMessage('Chưa liên lạc được với server để chuẩn bị đăng nhập.');
        if (autoLogin) setMessage({ text: error instanceof Error ? error.message : 'Không tạo được phiên đăng nhập.', error: true });
      });
    return () => { active = false; };
  }, [searchParams, setSearchParams]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try { await action(); setMessage({ text: success, error: false }); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Không thể liên lạc với server.', error: true }); }
    finally { setBusy(false); }
  };

  const triggerTestEvent = (payload: Record<string, unknown>) => {
    const viewer = simViewer.trim() || 'Viewer';
    void runAction(() => apiRequest('/admin/test-event', {
      method: 'POST', body: JSON.stringify({ tiktokUserId: `user_${viewer.toLowerCase()}`, username: viewer, ...payload }),
    }), `Đã gửi sự kiện ${payload.type} cho @${viewer}. Đang chờ server xử lý.`);
  };

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="brand"><span className="brand-mark">⚔</span><div><span className="eyebrow">TIKTOK LIVE / CONTROL ROOM</span><h1>Đấu trường trực tiếp</h1></div></div>
        <div className="header-actions">
          <span className={`connection-pill ${ready ? 'is-live' : ''}`}><span className={`hud-dot ${ready ? 'online' : 'offline'}`} />{!connected ? 'Server chưa kết nối' : !fresh ? 'Chờ battle engine' : 'Đang đồng bộ'}</span>
          <Link to="/overlay" target="_blank" rel="noreferrer" className="btn btn-primary">Mở overlay ↗</Link>
        </div>
      </header>
      {message && <div role={message.error ? 'alert' : 'status'} className={`alert-banner ${message.error ? 'alert-error' : ''}`}>{message.text}</div>}
      <div className="scoreboard">
        <div className="score-side police-score"><span className="eyebrow">PHE 01 / HỘI ĐỘC THÂN (FA) 💔</span><strong>{battleState ? battleState.policeScore : '—'}<small> / {battleState?.targetScore ?? 100}</small></strong><span>{police} quân · {battleState?.policeWins ?? 0} hiệp thắng</span></div>
        <div className="score-center"><span className="eyebrow">HIỆP {battleState?.roundNumber ?? '—'}</span><RoundTimer state={battleState} connected={ready} /><span>{!ready ? 'Chờ đồng bộ' : battleState?.roundStatus === 'fighting' ? 'Đang giao chiến' : battleState?.roundStatus === 'draw' ? 'Hai phe hòa nhau' : 'Chuẩn bị hiệp mới'}</span></div>
        <div className="score-side smuggler-score"><span className="eyebrow">PHE 02 / TEAM PHÁT CƠM CHÓ 👩‍❤️‍👨</span><strong>{battleState ? battleState.smugglerScore : '—'}<small> / {battleState?.targetScore ?? 100}</small></strong><span>{smugglers} quân · {battleState?.smugglerWins ?? 0} hiệp thắng</span></div>
      </div>
      <div className="control-layout">
        <main className="main-column">
          <section className="card arena-card">
            <div className="section-heading"><div><span className="eyebrow">LIVE PREVIEW</span><h2>Trận đấu đang diễn ra</h2></div><span className="subtle">{ready ? `${battleState?.tickRate ?? '—'} ticks/s · Tick ${battleState?.tick ?? 0}` : 'Chờ tín hiệu server'}</span></div>
            <div className="arena-preview"><iframe src="/overlay" title="Xem trước trận đấu trực tiếp" />{!ready && <div className="preview-status"><strong>{connected ? 'Đang chờ battle engine' : 'Đang kết nối server…'}</strong><span>Trận đấu sẽ xuất hiện khi server sẵn sàng.</span></div>}</div>
            <div className="arena-footer"><span>⚔️ FA Đại Chiến Cơm Chó</span><span>{battleState?.characters.length ?? 0} quân trên sân</span></div>
          </section>
          <section className="card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">🔮 HỆ THỐNG PHÙ TRIỆU HỒI TỰ ĐỘNG</span>
                <h2>Kích Hoạt Phù Chú & Triệu Hồi Chiến Trường</h2>
              </div>
            </div>
            <p className="help-text">
              Hệ thống không còn chia phân vùng thủ công: mọi tương tác (tim, quà, chat) tự động nhận diện Phù tương ứng và xuất hiện trận pháp triệu hồi trên đấu trường!
            </p>
            <label className="field-label" htmlFor="viewer">Tên người xem giả lập</label>
            <div className="form-row"><input id="viewer" value={simViewer} onChange={(event) => setSimViewer(event.target.value)} placeholder="Tên người xem" /></div>
            <fieldset disabled={busy || !ready} className="test-controls">
              <div className="faction-controls">
                <h3><span className="team-dot blue" />💔 Hội Độc Thân (FA)</h3>
                <button className="btn btn-primary" onClick={() => triggerTestEvent({ type: 'chat', comment: '1' })}>
                  💬 Tham gia phe FA (Chat "1")
                </button>
                <button className="btn btn-primary" onClick={() => triggerTestEvent({ type: 'like', likeCount: 10, faction: 'police' })}>
                  📜 Phù Tiên Phong (Thánh Ế · Thả 10 Tim)
                </button>
                <button className="btn btn-secondary" onClick={() => triggerTestEvent({ type: 'gift', faction: 'police', giftId: '5001', giftName: 'Hoa Hồng Đỏ', repeatCount: 1, diamondCount: 10 })}>
                  🛡️ Phù Thiết Giáp (Hiệp Sĩ Độc Thân · 10💎)
                </button>
                <button className="btn btn-purple" onClick={() => triggerTestEvent({ type: 'gift', faction: 'police', giftId: '5879', giftName: 'Xe SWAT', repeatCount: 1, diamondCount: 60 })}>
                  ⚔️ Phù Chiến Xa (Pháp Sư Cắt Duyên · 60💎)
                </button>
                <button className="btn btn-gold" onClick={() => triggerTestEvent({ type: 'gift', faction: 'police', giftId: '8888', giftName: 'Tên Lửa Siêu Thanh', repeatCount: 1, diamondCount: 199 })}>
                  ⚡ Phù Thần Tướng (Đại Tướng Bất Cần Yêu · 199💎)
                </button>
                <button className="btn btn-mythic" onClick={() => triggerTestEvent({ type: 'gift', faction: 'police', giftId: '9999', giftName: 'Tàu Thiết Giáp', repeatCount: 1, diamondCount: 600 })}>
                  🐉 Phù Thần Thoại (Chúa Tể FA Diệt Cơm Chó · 600💎)
                </button>
              </div>
              <div className="faction-controls">
                <h3><span className="team-dot red" />👩‍❤️‍👨 Team Phát Cơm Chó</h3>
                <button className="btn btn-accent" onClick={() => triggerTestEvent({ type: 'chat', comment: '2' })}>
                  💬 Tham gia phe Cơm Chó (Chat "2")
                </button>
                <button className="btn btn-accent" onClick={() => triggerTestEvent({ type: 'like', likeCount: 10, faction: 'smuggler' })}>
                  📜 Phù Tiên Phong (Cặp Đôi Gà Bông · Thả 10 Tim)
                </button>
                <button className="btn btn-secondary" onClick={() => triggerTestEvent({ type: 'gift', faction: 'smuggler', giftId: '5002', giftName: 'Bánh Donut', repeatCount: 1, diamondCount: 10 })}>
                  🛡️ Phù Thiết Giáp (Chiến Thần Tỏ Tình · 10💎)
                </button>
                <button className="btn btn-purple" onClick={() => triggerTestEvent({ type: 'gift', faction: 'smuggler', giftId: '5880', giftName: 'Sát Thủ Quỷ', repeatCount: 1, diamondCount: 60 })}>
                  ⚔️ Phù Chiến Xa (Cặp Đôi Bắn Tim · 60💎)
                </button>
                <button className="btn btn-gold" onClick={() => triggerTestEvent({ type: 'gift', faction: 'smuggler', giftId: '8889', giftName: 'Thiên Nga Vàng', repeatCount: 1, diamondCount: 199 })}>
                  ⚡ Phù Thần Tướng (Bá Vương Cơm Chó · 199💎)
                </button>
                <button className="btn btn-mythic" onClick={() => triggerTestEvent({ type: 'gift', faction: 'smuggler', giftId: '9998', giftName: 'Đại Ca Mafia', repeatCount: 1, diamondCount: 600 })}>
                  🐉 Phù Thần Thoại (Cặp Đôi Thần Thoại · 600💎)
                </button>
              </div>
            </fieldset>
            <p className="help-text">Người xem chỉ cần tặng quà hoặc thả tim, hệ thống tự kích hoạt Phù Triệu Hồi tương ứng ngay lập tức.</p>
          </section>
          <section className="card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">CHIẾN THUẬT & TRANG BỊ</span>
                <h2>💣 Đặt Bom & Dựng Chướng Ngại Vật</h2>
              </div>
            </div>
            <p className="help-text">
              Khán giả có thể bình luận <b>"bom"</b> để kích hoạt mìn/bom nổ AoE hất văng quân địch, hoặc gõ <b>"rao"</b> để dựng chướng ngại vật cản đường! Admin có thể kích hoạt trực tiếp bên dưới:
            </p>
            <fieldset disabled={busy || !ready} className="test-controls">
              <div className="faction-controls">
                <h3><span className="team-dot blue" />Vũ Khí Phe 1 (Hội Độc Thân)</h3>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void runAction(() => apiRequest('/battle/deploy-bomb', { method: 'POST', body: JSON.stringify({ faction: 'police', placedBy: simViewer || 'Hội Độc Thân' }) }), 'Đã kích hoạt đặt 1 quả Bom Tách Đôi Chia Tay cho Hội Độc Thân!')}
                >
                  💣 Đặt Bom Chia Tay (Nổ AoE -85 HP)
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void runAction(() => apiRequest('/battle/deploy-obstacle', { method: 'POST', body: JSON.stringify({ faction: 'police', type: 'sandbag' }) }), 'Đã dựng 1 Rào Chắn Độc Thân cho Phe 1!')}
                >
                  🚧 Dựng Rào Chắn Độc Thân
                </button>
              </div>
              <div className="faction-controls">
                <h3><span className="team-dot red" />Vũ Khí Phe 2 (Phát Cơm Chó)</h3>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => void runAction(() => apiRequest('/battle/deploy-bomb', { method: 'POST', body: JSON.stringify({ faction: 'smuggler', placedBy: simViewer || 'Phát Cơm Chó' }) }), 'Đã kích hoạt đặt 1 quả Bom Rải Thính cho Phe Cơm Chó!')}
                >
                  💣 Đặt Bom Rải Thính (Nổ AoE -85 HP)
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void runAction(() => apiRequest('/battle/deploy-obstacle', { method: 'POST', body: JSON.stringify({ faction: 'smuggler', type: 'barbwire' }) }), 'Đã giăng 1 Rào Cơm Chó cho Phe 2!')}
                >
                  ⚔️ Giăng Rào Gai Thép
                </button>
              </div>
            </fieldset>
          </section>
        </main>
        <aside className="side-column">
          <section className="card">
            <span className="eyebrow">TÀI KHOẢN TIKTOK</span>
            <h2>{loggedInUser ? 'Tài Khoản Đang Phát LIVE' : 'Đăng nhập TikTok'}</h2>

            {loggedInUser ? (
              <div>
                <div className="tiktok-profile">
                  {loggedInUser.avatarUrl && (
                    <img
                      src={loggedInUser.avatarUrl}
                      alt={loggedInUser.displayName || 'TikTok'}
                      className="tiktok-avatar"
                    />
                  )}
                  <div className="tiktok-info">
                    <strong>{loggedInUser.displayName || 'Streamer'}</strong>
                    <span>@{loggedInUser.username || 'user'}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                    onClick={() => {
                      setLoggedInUser(null);
                      localStorage.removeItem('tiktok_admin_user');
                    }}
                  >
                    Đổi tài khoản
                  </button>
                </div>

                {/* BẢNG TỰ ĐỘNG BẮT SỰ KIỆN CỦA TÀI KHOẢN TIKTOK NÀY */}
                <div
                  style={{
                    marginTop: '12px',
                    padding: '12px',
                    background: 'rgba(15, 23, 42, 0.75)',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}
                  >
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>
                      TRẠNG THÁI BẮT SỰ KIỆN
                    </span>
                    <span
                      className={`live-status ${
                        connectorStatus?.connected && connectorStatus?.isLive
                          ? 'badge-ok'
                          : connectorStatus?.connected
                          ? 'badge-ok'
                          : 'badge-warn'
                      }`}
                      style={{ padding: '2px 8px', fontSize: '0.75rem', margin: 0 }}
                    >
                      {connectorStatus?.connected && connectorStatus?.isLive
                        ? '🟢 ĐANG LIVE & BẮT SỰ KIỆN'
                        : connectorStatus?.connected
                        ? '🟡 ĐÃ KẾT NỐI'
                        : '○ CHƯA BẮT SỰ KIỆN'}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.82rem', color: '#cbd5e1', lineHeight: '1.6' }}>
                    <div>
                      ❤️ <b>Khán giả Thả Tim (Like):</b>{' '}
                      {connectorStatus?.connected ? (
                        <span style={{ color: '#4ade80' }}>Đang nhận diện tự động</span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Chưa kết nối</span>
                      )}
                    </div>
                    <div>
                      🎁 <b>Khán giả Donate (Quà tặng):</b>{' '}
                      {connectorStatus?.connected ? (
                        <span style={{ color: '#4ade80' }}>Đang nhận diện tự động & kích hoạt Phù</span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Chưa kết nối</span>
                      )}
                    </div>
                    <div>
                      💬 <b>Bình luận (1/2, bom, rào):</b>{' '}
                      {connectorStatus?.connected ? (
                        <span style={{ color: '#4ade80' }}>Đang nhận diện tự động</span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Chưa kết nối</span>
                      )}
                    </div>
                  </div>

                  {connectorStatus?.connected && (
                    <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#38bdf8' }}>
                      Kênh kết nối: <b>@{connectorStatus.username}</b>
                      {connectorStatus.roomId && ` · Phòng: ${connectorStatus.roomId}`}
                      {connectorStatus.viewerCount !== undefined && ` · ${connectorStatus.viewerCount} người xem`}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ flex: 1, fontSize: '0.82rem' }}
                      disabled={busy}
                      onClick={() => connectForUser(loggedInUser.username!)}
                    >
                      {connectorStatus?.connected ? '🔄 Đồng bộ lại sự kiện' : '📡 Bắt sự kiện kênh này ngay'}
                    </button>
                    {connectorStatus?.connected && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ fontSize: '0.82rem' }}
                        disabled={busy}
                        onClick={() =>
                          void runAction(
                            () => apiRequest('/tiktok/disconnect', { method: 'POST' }),
                            'Đã ngắt kết nối bắt sự kiện.',
                          )
                        }
                      >
                        Ngắt
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <form onSubmit={handleQuickLogin} style={{ marginBottom: '14px' }}>
                  <label className="field-label" htmlFor="quick-username">
                    Đăng nhập nhanh kênh TikTok của bạn
                  </label>
                  <div className="form-row">
                    <input
                      id="quick-username"
                      value={quickUsername}
                      onChange={(event) => setQuickUsername(event.target.value)}
                      placeholder="@username kênh TikTok (Ví dụ: my_tiktok)"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: '6px' }}
                    disabled={busy || !quickUsername.trim()}
                  >
                    🚀 Đăng nhập & Bắt sự kiện Like/Donate ngay
                  </button>
                </form>

                {authConfigured && authUrl && (
                  <div style={{ borderTop: '1px solid #334155', paddingTop: '10px' }}>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Hoặc đăng nhập OAuth:</span>
                    <a
                      href={authUrl}
                      className="btn btn-secondary tiktok-login-btn"
                      onClick={(event) => {
                        if (busy) event.preventDefault();
                      }}
                    >
                      🎵 Đăng nhập bằng TikTok OAuth
                    </a>
                  </div>
                )}
              </div>
            )}
          </section>

          <SummonTalismanGuide />
          <RoundTimingSettings connected={connected} />
          <DonorLeaderboard leaderboard={donors} error={donorsError} />
          <section className="card">
            <span className="eyebrow">NGUỒN PHÁT TIKTOK</span>
            <h2>Kết nối TikTok LIVE & Bắt Donate</h2>

            <div
              className={`live-status ${
                connectorStatus?.connected && connectorStatus?.isLive
                  ? 'badge-ok'
                  : connectorStatus?.connected
                  ? 'badge-ok'
                  : 'badge-warn'
              }`}
            >
              {connectorStatus?.connected && connectorStatus?.isLive
                ? `● ĐANG LIVE: @${connectorStatus.username || 'streamer'} (Phòng: ${connectorStatus.roomId || '—'} · ${connectorStatus.viewerCount ?? 0} người xem)`
                : connectorStatus?.connected
                ? `● Đã kết nối Webcast @${connectorStatus?.username}`
                : '○ Chưa kết nối LIVE'}
            </div>

            {connectorStatus?.connected && (
              <div
                style={{
                  background: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid #22c55e',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '14px',
                  fontSize: '0.85rem',
                  color: '#4ade80',
                }}
              >
                🎉 <b>Đang kích hoạt chế độ bắt sự kiện Donate tự động!</b>
                <br />Mỗi khi có khán giả tặng quà (Hoa Hồng, Donut, Tên Lửa...), hệ thống sẽ tự động nhận diện và triệu hồi chiến binh tương ứng lên sàn đấu.
              </div>
            )}

            <form onSubmit={handleConnectLive}>
              <label className="field-label" htmlFor="tiktok-username">
                Tài khoản TikTok (Username)
                {loggedInUser?.username && loggedInUser.username !== username && (
                  <button
                    type="button"
                    style={{
                      marginLeft: '10px',
                      fontSize: '0.75rem',
                      padding: '2px 8px',
                      background: '#3b82f6',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setUsername(loggedInUser.username!)}
                  >
                    Dùng @{loggedInUser.username}
                  </button>
                )}
              </label>
              <div className="form-row">
                <input
                  id="tiktok-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="@username (Ví dụ: streamer123)"
                  required
                />
              </div>

              <label className="field-label" htmlFor="tiktok-session">
                Session ID / Cookie (Tùy chọn - Khuyên dùng)
              </label>
              <div className="form-row">
                <input
                  id="tiktok-session"
                  value={sessionCookie}
                  onChange={(event) => setSessionCookie(event.target.value)}
                  placeholder="Paste sessionid cookie để giữ kết nối ổn định & bypass giới hạn"
                />
              </div>
              <p className="help-text" style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '-6px' }}>
                💡 <b>Lấy cookie sessionid:</b> Đăng nhập tiktok.com -&gt; F12 -&gt; Tab Application -&gt; Cookies -&gt; Copy giá trị của dòng <code>sessionid</code>.
              </p>

              <div className="form-row" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || checkingLive || !username.trim()}
                  onClick={handleCheckLive}
                >
                  {checkingLive ? 'Đang kiểm tra…' : '🔍 Kiểm tra LIVE'}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || !connected || !username.trim()}
                >
                  📡 Kết nối & Bắt Donate
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy || !connected}
                  onClick={() =>
                    void runAction(
                      () => apiRequest('/tiktok/disconnect', { method: 'POST' }),
                      'Đã yêu cầu ngắt kết nối TikTok LIVE.',
                    )
                  }
                >
                  Ngắt
                </button>
              </div>
            </form>

            {liveCheckResult && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  border: liveCheckResult.isLive ? '1px solid #22c55e' : '1px solid #f59e0b',
                  background: liveCheckResult.isLive ? 'rgba(34, 197, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  color: liveCheckResult.isLive ? '#4ade80' : '#fbbf24',
                }}
              >
                <b>{liveCheckResult.isLive ? '🟢 Trạng thái: ĐANG PHÁT LIVE' : '⚠️ Trạng thái: CHƯA PHÁT LIVE (OFFLINE)'}</b>
                <div>{liveCheckResult.message}</div>
                {liveCheckResult.title && <div>Tiêu đề: <i>"{liveCheckResult.title}"</i></div>}
                {liveCheckResult.viewerCount !== undefined && <div>Số người xem: <b>{liveCheckResult.viewerCount}</b></div>}
              </div>
            )}

            <dl className="detail-list" style={{ marginTop: '12px' }}>
              <div><dt>Kênh</dt><dd>{connectorStatus?.username ? `@${connectorStatus.username}` : 'Chưa chọn'}</dd></div>
              <div><dt>Phòng LIVE (Room ID)</dt><dd>{connectorStatus?.roomId || '—'}</dd></div>
              <div><dt>Số kết nối lại</dt><dd>{connectorStatus?.reconnectAttempts ?? 0} lần</dd></div>
            </dl>
            {connectorStatus?.lastError && <p className="error-text" role="alert">{connectorStatus.lastError}</p>}
          </section>
          <section className="card">
            <span className="eyebrow">BROWSER SOURCE (OBS)</span><h2>Đưa lên OBS Studio / TikTok Studio</h2>
            <p className="help-text">
              Nền overlay đã được thiết lập <b>hoàn toàn trong suốt (bg = none)</b>, không che camera hoặc game stream của bạn.
            </p>
            <label className="field-label" htmlFor="overlay-url">Đường dẫn Overlay</label>
            <input id="overlay-url" className="url-input" readOnly value={overlayUrl} onFocus={(event) => event.target.select()} />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              <button className="btn btn-primary" onClick={() => void runAction(() => navigator.clipboard.writeText(overlayUrl), 'Đã sao chép link Overlay chuẩn (Trong suốt)!')}>
                📋 Sao chép Link Chuẩn (Nền trong suốt)
              </button>
              <button className="btn btn-secondary" onClick={() => void runAction(() => navigator.clipboard.writeText(`${overlayUrl}?clean=1`), 'Đã sao chép link Clean (Ẩn Donate & Phù)!')}>
                ✨ Sao chép Link Gọn (Ẩn Donate & Bảng Phù: ?clean=1)
              </button>
              <button className="btn btn-secondary" onClick={() => void runAction(() => navigator.clipboard.writeText(`${overlayUrl}?noHud=1`), 'Đã sao chép link Tối giản (Chỉ hiện game: ?noHud=1)!')}>
                🎯 Sao chép Link Siêu Tối Giản (Không HUD: ?noHud=1)
              </button>
            </div>

            <p className="help-text" style={{ marginTop: '12px', fontSize: '0.82rem', color: '#94a3b8' }}>
              💡 <b>Phím tắt trực tiếp trên Overlay:</b> Bấm phím <code>D</code> để ẩn/hiện Top Donate, <code>T</code> ẩn/hiện Bảng Phù, <code>P</code> ẩn/hiện PK Bar, <code>O</code> ẩn/hiện tất cả. Hoặc bấm trực tiếp nút <code>✕</code> trên từng bảng!
            </p>
            <dl className="detail-list"><div><dt>Kích thước</dt><dd>1920 × 1080</dd></div><div><dt>Nền (Background)</dt><dd style={{ color: '#4ade80' }}>Trong suốt (None / Transparent)</dd></div></dl>
          </section>
          <section className="card instructions"><span className="eyebrow">CÁCH CHƠI</span><h2>Hai phe, một mục tiêu</h2><p><b className="blue-text">Bình luận 1</b> để cùng Công An giải cứu con tin.</p><p><b className="red-text">Bình luận 2</b> để cùng Buôn Lậu chiếm giữ khu vực.</p><p>Thả tim, tặng quà để tăng sức mạnh. Phe đầu tiên đạt {battleState?.targetScore ?? 100} điểm thắng hiệp.</p></section>
        </aside>
      </div>
    </div>
  );
};
