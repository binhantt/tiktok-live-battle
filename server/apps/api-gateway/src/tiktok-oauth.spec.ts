import { createHash } from 'crypto';
import { TikTokOAuthService } from './tiktok-oauth.service';

describe('TikTok local Login Kit', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const setup = () => {
    const pending = new Map<string, any>();
    const redis = {
      setJson: jest.fn(async (key, value) => { pending.set(key, value); }),
      getJson: jest.fn(async (key) => pending.get(key) || null),
      getClient: () => ({ getdel: jest.fn(async (key) => { const value = pending.get(key); pending.delete(key); return value ? JSON.stringify(value) : null; }) }),
    };
    return { service: new TikTokOAuthService(redis as any), redis, pending };
  };
  beforeEach(() => {
    process.env.TIKTOK_CLIENT_KEY = 'test-client-key';
    process.env.TIKTOK_CLIENT_SECRET = 'test-client-secret';
    process.env.TIKTOK_LOGIN_PLATFORM = 'desktop';
    process.env.TIKTOK_REDIRECT_URI = 'http://127.0.0.1:5173/admin';
    global.fetch = jest.fn() as any;
  });
  afterEach(() => { process.env = { ...originalEnv }; global.fetch = originalFetch; });

  it('generates a different state and hex SHA256 PKCE challenge for every attempt', async () => {
    const { service, pending } = setup();
    const first = await service.createAuthorization();
    const second = await service.createAuthorization();
    const url = new URL(first.url!);
    const saved = [...pending.values()][0];
    expect(first.csrfState).not.toBe(second.csrfState);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(saved.codeVerifier).digest('hex'));
    expect(saved.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(JSON.stringify(first)).not.toContain('test-client-secret');
    expect(JSON.stringify(first)).not.toContain(saved.codeVerifier);
  });

  it('validates platform-specific redirect requirements', async () => {
    const { service } = setup();
    process.env.TIKTOK_LOGIN_PLATFORM = 'web';
    expect((await service.createAuthorization()).configured).toBe(false);
    process.env.TIKTOK_REDIRECT_URI = 'https://example.test/admin';
    const web = await service.createAuthorization();
    expect(web.configured).toBe(true);
    expect(new URL(web.url!).searchParams.has('code_challenge')).toBe(false);
    process.env.TIKTOK_LOGIN_PLATFORM = 'desktop';
    expect((await service.createAuthorization()).configured).toBe(false);
  });

  it('rejects expired or wrong-browser callbacks before contacting TikTok', async () => {
    const { service, pending } = setup();
    const login = await service.createAuthorization();
    await expect(service.completeAuthorization({ code: 'code', state: login.csrfState, flowToken: 'wrong-token' })).rejects.toThrow('không khớp');
    pending.clear();
    await expect(service.completeAuthorization({ code: 'code', state: login.csrfState, flowToken: login.flowToken })).rejects.toThrow('hết hạn');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the saved redirect and PKCE verifier, returns a profile, and blocks callback replay', async () => {
    const { service, pending } = setup();
    const login = await service.createAuthorization();
    const saved = [...pending.values()][0];
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'private-token', open_id: 'owner-1', scope: 'user.info.basic,user.info.profile' }) });
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: { open_id: 'owner-1', username: 'viewer', display_name: 'Viewer' } }, error: { code: 'ok' } }) });
    const body = { code: 'authorization-code', state: login.csrfState, flowToken: login.flowToken, redirectUri: 'https://other.test' };
    const result = await service.completeAuthorization(body);
    expect(result).toMatchObject({ ok: true, user: { username: 'viewer', openId: 'owner-1' } });
    const tokenBody = (fetch as jest.Mock).mock.calls[0][1].body as URLSearchParams;
    expect(tokenBody.get('code_verifier')).toBe(saved.codeVerifier);
    expect(tokenBody.get('redirect_uri')).toBe('http://127.0.0.1:5173/admin');
    expect(JSON.stringify(result)).not.toContain('private-token');
    await expect(service.completeAuthorization(body)).rejects.toThrow('hết hạn');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not substitute a display name for a LIVE username when the profile scope was denied', async () => {
    const { service } = setup();
    const login = await service.createAuthorization();
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'private-token', open_id: 'owner-1', scope: 'user.info.basic' }) });
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: { open_id: 'owner-1', display_name: 'Tên hiển thị có dấu' } } }) });
    const result = await service.completeAuthorization({ code: 'code', state: login.csrfState, flowToken: login.flowToken });
    expect(result).toMatchObject({ ok: true, user: { displayName: 'Tên hiển thị có dấu', username: undefined } });
    expect((fetch as jest.Mock).mock.calls[1][0]).not.toContain(',username');
  });

  it('keeps login disabled until both credentials have been configured', async () => {
    const { service } = setup();
    delete process.env.TIKTOK_CLIENT_SECRET;
    expect(await service.createAuthorization()).toMatchObject({ configured: false, url: null });
  });
});
