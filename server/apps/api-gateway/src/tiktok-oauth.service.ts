import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { RedisService } from '@app/shared';

interface PendingLogin {
  clientKey: string;
  redirectUri: string;
  bindingHash: string;
  codeVerifier?: string;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const prefix = 'oauth:tiktok:pending:';

@Injectable()
export class TikTokOAuthService {
  constructor(private readonly redis: RedisService) {}

  private configuration() {
    const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
    if (!clientKey || !clientSecret || clientKey.startsWith('your_') || clientSecret.startsWith('your_')) {
      throw new BadRequestException('Điền Client Key và Client Secret trong .env trên máy rồi khởi động lại server.');
    }
    const platform = process.env.TIKTOK_LOGIN_PLATFORM || 'desktop';
    if (platform !== 'desktop' && platform !== 'web') throw new BadRequestException('TIKTOK_LOGIN_PLATFORM phải là desktop hoặc web.');
    let redirect: URL;
    try { redirect = new URL(process.env.TIKTOK_REDIRECT_URI || 'http://127.0.0.1:5173/admin'); }
    catch { throw new BadRequestException('TIKTOK_REDIRECT_URI không hợp lệ.'); }
    if (redirect.search || redirect.hash || redirect.username || redirect.password) throw new BadRequestException('Redirect URI phải cố định, không có query, fragment hoặc thông tin đăng nhập.');
    if (platform === 'desktop') {
      if (!['localhost', '127.0.0.1'].includes(redirect.hostname) || !['http:', 'https:'].includes(redirect.protocol) || !redirect.port) {
        throw new BadRequestException('Desktop cần Redirect URI localhost hoặc 127.0.0.1 có cổng, ví dụ http://localhost:5173/admin.');
      }
    } else if (redirect.protocol !== 'https:') throw new BadRequestException('Login Kit Web yêu cầu Redirect URI HTTPS.');
    const scopes = (process.env.TIKTOK_LOGIN_SCOPES || 'user.info.basic').split(',').map((scope) => scope.trim()).filter(Boolean);
    if (!scopes.includes('user.info.basic') || scopes.some((scope) => !['user.info.basic', 'user.info.profile'].includes(scope))) {
      throw new BadRequestException('TIKTOK_LOGIN_SCOPES cần user.info.basic; có thể thêm user.info.profile để lấy @username.');
    }
    return { clientKey, clientSecret, platform, redirectUri: redirect.href, scope: scopes.join(',') };
  }

  async createAuthorization() {
    let config: ReturnType<TikTokOAuthService['configuration']>;
    try { config = this.configuration(); }
    catch (error) { return { configured: false, url: null, message: (error as Error).message }; }
    const state = randomBytes(32).toString('hex');
    const flowToken = randomBytes(32).toString('base64url');
    const codeVerifier = config.platform === 'desktop' ? randomBytes(48).toString('base64url') : undefined;
    await this.redis.setJson(`${prefix}${state}`, {
      clientKey: config.clientKey, redirectUri: config.redirectUri, bindingHash: hash(flowToken), codeVerifier,
    } satisfies PendingLogin, 600);
    const parameters = new URLSearchParams({
      client_key: config.clientKey, scope: config.scope, response_type: 'code',
      redirect_uri: config.redirectUri, state,
    });
    // TikTok Desktop specifies a hex-encoded SHA256 challenge.
    if (codeVerifier) { parameters.set('code_challenge', hash(codeVerifier)); parameters.set('code_challenge_method', 'S256'); }
    return { configured: true, url: `https://www.tiktok.com/v2/auth/authorize/?${parameters}`, csrfState: state, flowToken, redirectUri: config.redirectUri, platform: config.platform };
  }

  async completeAuthorization(body: { code?: string; state?: string; flowToken?: string }) {
    const config = this.configuration();
    if (!body || typeof body.code !== 'string' || !body.code || typeof body.state !== 'string' || !/^[a-f0-9]{64}$/.test(body.state) || typeof body.flowToken !== 'string' || body.flowToken.length > 128) {
      throw new BadRequestException('Phiên đăng nhập không hợp lệ. Bấm Đăng nhập bằng TikTok để bắt đầu lại.');
    }
    const key = `${prefix}${body.state}`;
    const pending = await this.redis.getJson<PendingLogin>(key);
    if (!pending || !timingSafeEqual(Buffer.from(hash(body.flowToken), 'hex'), Buffer.from(pending.bindingHash, 'hex')) || pending.clientKey !== config.clientKey || pending.redirectUri !== config.redirectUri) {
      throw new BadRequestException('Phiên đăng nhập đã hết hạn hoặc không khớp trình duyệt. Vui lòng đăng nhập lại.');
    }
    // GETDEL makes an authorization attempt single-use, even with concurrent callbacks.
    if (!await this.redis.getClient().getdel(key)) throw new BadRequestException('Phiên đăng nhập đã được sử dụng.');
    const parameters = new URLSearchParams({
      client_key: config.clientKey, client_secret: config.clientSecret, code: body.code,
      grant_type: 'authorization_code', redirect_uri: pending.redirectUri,
    });
    if (pending.codeVerifier) parameters.set('code_verifier', pending.codeVerifier);
    try {
      const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
        body: parameters, signal: AbortSignal.timeout(15000),
      });
      const token = await response.json() as { access_token?: string; open_id?: string; scope?: string };
      if (!response.ok || !token.access_token || !token.open_id) throw new Error('TikTok từ chối đổi mã đăng nhập. Kiểm tra Client Secret, Redirect URI và tài khoản Sandbox.');
      const fields = ['open_id', 'avatar_url', 'display_name'];
      if (token.scope?.split(',').includes('user.info.profile')) fields.push('username');
      const profileResponse = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields.join(',')}`, {
        headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000),
      });
      const profile = await profileResponse.json() as { data?: { user?: { open_id?: string; username?: string; display_name?: string; avatar_url?: string } }; error?: { code?: string } };
      if (!profileResponse.ok || (profile.error?.code && profile.error.code !== 'ok') || !profile.data?.user?.open_id) throw new Error('Chưa lấy được hồ sơ TikTok. Kiểm tra quyền user.info.basic trong Sandbox.');
      const user = profile.data.user;
      return { ok: true, user: { openId: user.open_id, username: user.username, displayName: user.display_name, avatarUrl: user.avatar_url } };
    } catch (error) {
      return { ok: false, message: error instanceof Error && error.name === 'Error' ? error.message : 'Không liên lạc được với TikTok. Bấm đăng nhập để thử lại.' };
    }
  }
}
