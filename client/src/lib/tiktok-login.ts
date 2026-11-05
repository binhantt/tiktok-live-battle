interface LoginStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingTikTokLogin { state: string; flowToken: string; expiresAt?: number }
const prefix = 'tiktok_oauth_pending:';
const legacyKey = 'tiktok_oauth_pending';

export function loginEntryUrl(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Địa chỉ đăng nhập TikTok không hợp lệ.');
  url.searchParams.set('tiktok_login', '1');
  return url.href;
}

export function storeTikTokLogin(login: PendingTikTokLogin, session: LoginStorage, shared: LoginStorage, now = Date.now()) {
  const value = JSON.stringify({ ...login, expiresAt: now + 600000 });
  let saved = false;
  for (const storage of [session, shared]) {
    try { storage.setItem(`${prefix}${login.state}`, value); saved = true; } catch {}
  }
  if (!saved) throw new Error('Trình duyệt đang chặn lưu phiên. Cho phép dữ liệu trang web rồi thử đăng nhập lại.');
}

export function takeTikTokLogin(state: string | null, session: LoginStorage, shared: LoginStorage, now = Date.now()): PendingTikTokLogin | null {
  if (!state) return null;
  let pending: PendingTikTokLogin | null = null;
  const key = `${prefix}${state}`;
  for (const [storage, item] of [[session, key], [shared, key], [session, legacyKey]] as const) {
    try {
      const value = JSON.parse(storage.getItem(item) || 'null');
      const validExpiry = typeof value?.expiresAt === 'number' && value.expiresAt > now;
      const legacyAttempt = item === legacyKey && value?.expiresAt === undefined;
      if (value?.state === state && typeof value.flowToken === 'string' && (validExpiry || legacyAttempt)) {
        pending = value;
        break;
      }
    } catch {}
  }
  // Delete this attempt only; another tab may be completing a different login.
  for (const storage of [session, shared]) { try { storage.removeItem(key); } catch {} }
  try {
    if (JSON.parse(session.getItem(legacyKey) || 'null')?.state === state) session.removeItem(legacyKey);
  } catch {}
  return pending;
}
