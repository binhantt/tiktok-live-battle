import { loginEntryUrl, storeTikTokLogin, takeTikTokLogin } from '../../client/src/lib/tiktok-login';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

describe('TikTok callback browser binding', () => {
  const first = { state: 'first-state', flowToken: 'first-proof' };
  const second = { state: 'second-state', flowToken: 'second-proof' };

  it('starts a fresh login on the configured callback origin rather than the current hostname', () => {
    expect(loginEntryUrl('http://127.0.0.1:5173/admin')).toBe('http://127.0.0.1:5173/admin?tiktok_login=1');
    expect(loginEntryUrl('https://app.example.test/admin')).toBe('https://app.example.test/admin?tiktok_login=1');
    expect(() => loginEntryUrl('javascript:alert(1)')).toThrow();
  });

  it('finds a matching flow when TikTok returns to a different tab', () => {
    const shared = storage();
    storeTikTokLogin(first, storage(), shared, 1000);
    expect(takeTikTokLogin(first.state, storage(), shared, 2000)).toMatchObject(first);
    expect(takeTikTokLogin(first.state, storage(), shared, 2000)).toBeNull();
  });

  it('keeps concurrent login attempts separate and does not discard another tab on mismatch', () => {
    const session = storage(); const shared = storage();
    storeTikTokLogin(first, session, shared, 1000);
    storeTikTokLogin(second, session, shared, 1000);
    expect(takeTikTokLogin('unrelated-state', session, shared, 2000)).toBeNull();
    expect(takeTikTokLogin(first.state, session, shared, 2000)).toMatchObject(first);
    expect(takeTikTokLogin(second.state, session, shared, 2000)).toMatchObject(second);
  });

  it('expires browser proofs after ten minutes', () => {
    const session = storage(); const shared = storage();
    storeTikTokLogin(first, session, shared, 1000);
    expect(takeTikTokLogin(first.state, session, shared, 601000)).toBeNull();
  });

  it('can finish an already-started login from the previous client version', () => {
    const session = storage();
    session.setItem('tiktok_oauth_pending', JSON.stringify(first));
    expect(takeTikTokLogin(first.state, session, storage())).toMatchObject(first);
  });

  it('stops before leaving the site when both browser stores are blocked', () => {
    const blocked = { ...storage(), setItem: () => { throw new Error('blocked'); } };
    expect(() => storeTikTokLogin(first, blocked, blocked)).toThrow('chặn lưu phiên');
  });
});
