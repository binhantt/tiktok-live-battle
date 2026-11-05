import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ControlEvent, TikTokLiveConnection, WebcastEvent, UserOfflineError } from 'tiktok-live-connector';
import {
  ConnectorStatusDto,
  NormalizedTikTokEvent,
  REDIS_CHANNELS,
  REDIS_KEYS,
  REDIS_STREAMS,
  RedisService,
} from '@app/shared';
import { randomUUID } from 'crypto';

@Injectable()
export class TikTokConnectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TikTokConnectorService.name);
  private connection: TikTokLiveConnection | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private status: ConnectorStatusDto = {
    connected: false,
    username: null,
    sessionId: null,
    reconnectAttempts: 0,
    mode: 'idle',
    isLive: false,
  };
  private intentionalDisconnect = false;

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    await this.syncStatusToRedis();

    await this.redisService.subscribe<{
      action: 'connect' | 'disconnect' | 'simulate';
      username?: string;
      sessionId?: string;
      sessionCookie?: string;
      event?: Partial<NormalizedTikTokEvent>;
    }>(REDIS_CHANNELS.CONNECTOR_COMMAND, async (cmd) => {
      try {
        if (cmd.action === 'connect' && cmd.username) {
          await this.connectToLive(
            cmd.username,
            cmd.sessionId || `session-${Date.now()}`,
            cmd.sessionCookie,
          );
        } else if (cmd.action === 'disconnect') {
          await this.disconnectFromLive();
        } else if (cmd.action === 'simulate' && cmd.event) {
          await this.emitNormalizedEvent({
            eventId: cmd.event.eventId || randomUUID(),
            eventKey: cmd.event.eventKey || `sim:${Date.now()}:${randomUUID()}`,
            type: cmd.event.type || 'like',
            sessionId: cmd.event.sessionId || this.status.sessionId || 'default-session',
            tiktokUserId: cmd.event.tiktokUserId || 'sim_user_1',
            username: cmd.event.username || 'viewer_demo',
            avatarUrl: cmd.event.avatarUrl,
            timestamp: Date.now(),
            likeCount: cmd.event.likeCount ?? 1,
            comment: cmd.event.comment,
            giftId: cmd.event.giftId,
            giftName: cmd.event.giftName,
            repeatCount: cmd.event.repeatCount,
            repeatEnd: cmd.event.repeatEnd,
            diamondCount: cmd.event.diamondCount,
            simulated: true,
          });
        }
      } catch (err) {
        this.logger.error(`Error handling connector command: ${(err as Error).message}`);
      }
    });

    const autoUsername = process.env.TIKTOK_USERNAME;
    const autoSession = process.env.TIKTOK_SESSION_ID || process.env.TIKTOK_COOKIE;
    if (autoUsername && autoUsername !== 'your_tiktok_username') {
      this.logger.log(`Auto-connecting to configured TIKTOK_USERNAME: ${autoUsername}`);
      await this.connectToLive(autoUsername, `session-${Date.now()}`, autoSession);
    }
  }

  getStatus(): ConnectorStatusDto {
    return this.status;
  }

  private buildConnectionOptions(rawSession?: string) {
    const options: any = {
      processInitialData: false,
      enableExtendedGiftInfo: true,
      fetchRoomInfoOnConnect: true,
    };

    let sessionVal = rawSession?.trim();
    if (sessionVal) {
      let extractedSessionId = sessionVal;
      let ttTargetIdc = 'maliva';

      if (sessionVal.includes('=')) {
        const parts = sessionVal.split(';').map((p) => p.trim());
        for (const part of parts) {
          const [k, v] = part.split('=');
          if (['sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard'].includes(k.trim())) {
            extractedSessionId = v.trim();
          }
          if (k.trim() === 'tt-target-idc') {
            ttTargetIdc = v.trim();
          }
        }
      }

      if (extractedSessionId && !extractedSessionId.startsWith('session-')) {
        options.session = {
          cookie: {
            type: 'cookie',
            value: {
              sessionId: extractedSessionId,
              ttTargetIdc: ttTargetIdc || 'maliva',
            },
          },
        };
      }
    }

    return options;
  }

  async checkIsLive(
    username: string,
    rawSession?: string,
  ): Promise<{
    isLive: boolean;
    username: string;
    roomId?: string;
    title?: string;
    viewerCount?: number;
    message: string;
  }> {
    const cleanUsername = username.replace(/^@/, '').trim();
    if (!cleanUsername) {
      return { isLive: false, username: '', message: 'Vui lòng cung cấp username TikTok.' };
    }

    const options = this.buildConnectionOptions(rawSession);
    const conn = new TikTokLiveConnection(cleanUsername, options);

    try {
      const roomInfo = await conn.fetchRoomInfo();
      const status = roomInfo?.data?.status;
      const isLive = status !== 4 && Boolean(roomInfo?.data?.id_str || conn.roomId);

      if (isLive) {
        const roomData = (roomInfo?.data || {}) as any;
        return {
          isLive: true,
          username: cleanUsername,
          roomId: String(conn.roomId || roomData?.id_str || ''),
          title: String(roomData?.title || 'TikTok LIVE'),
          viewerCount: Number(roomData?.user_count || 0),
          message: `Kênh @${cleanUsername} ĐANG PHÁT TRỰC TIẾP! (Phòng: ${conn.roomId || roomData?.id_str})`,
        };
      }

      return {
        isLive: false,
        username: cleanUsername,
        message: `Kênh @${cleanUsername} hiện đang OFFLINE (Chưa phát LIVE).`,
      };
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      const isOffline =
        msg.includes('not online') ||
        msg.includes('offline') ||
        err instanceof UserOfflineError ||
        err?.name === 'UserOfflineError';

      return {
        isLive: false,
        username: cleanUsername,
        message: isOffline
          ? `Kênh @${cleanUsername} hiện đang OFFLINE (Chưa phát LIVE).`
          : `Không thể kiểm tra: ${err?.message || 'Lỗi kết nối TikTok'}`,
      };
    }
  }

  async connectToLive(
    username: string,
    sessionId: string,
    rawSessionCookie?: string,
  ): Promise<ConnectorStatusDto> {
    this.clearReconnectTimer();
    this.intentionalDisconnect = false;

    if (this.connection) {
      try {
        await this.connection.disconnect();
      } catch {
        // ignore
      }
      this.connection = null;
    }

    const cleanUsername = username.replace(/^@/, '').trim();
    const effectiveSession =
      rawSessionCookie || (sessionId.startsWith('session-') ? undefined : sessionId);

    this.status = {
      ...this.status,
      username: cleanUsername,
      sessionId,
      sessionCookie: effectiveSession || null,
      mode: 'live',
      lastError: undefined,
    };
    await this.syncStatusToRedis();

    try {
      const options = this.buildConnectionOptions(effectiveSession);
      this.connection = new TikTokLiveConnection(cleanUsername, options);

      this.registerConnectionListeners(this.connection, cleanUsername, sessionId);

      const state = await this.connection.connect();
      const roomData = (state.roomInfo?.data || {}) as any;
      this.status.connected = true;
      this.status.isLive = true;
      this.status.roomId = String(state.roomId || '');
      this.status.roomTitle = String(roomData?.title || '');
      this.status.viewerCount = Number(roomData?.user_count || 0);
      this.status.reconnectAttempts = 0;
      this.status.lastConnectedAt = new Date().toISOString();
      this.status.lastError = undefined;
      this.logger.log(
        `🟢 Đã kết nối TikTok LIVE @${cleanUsername} (Phòng: ${state.roomId}) - Sẵn sàng bắt sự kiện Donate & Tương tác!`,
      );
      await this.syncStatusToRedis();
    } catch (err: any) {
      const errMsg = (err as Error).message || 'Failed to connect to TikTok LIVE';
      const isOffline =
        errMsg.toLowerCase().includes('not online') ||
        errMsg.toLowerCase().includes('offline') ||
        err instanceof UserOfflineError ||
        err?.name === 'UserOfflineError';

      this.status.connected = false;
      this.status.isLive = false;
      if (isOffline) {
        this.status.lastError = `Tài khoản @${cleanUsername} hiện CHƯA phát LIVE. Vui lòng mở TikTok LIVE trước khi kết nối!`;
      } else {
        this.status.lastError = errMsg;
      }
      this.logger.warn(`TikTok LIVE connection failed for @${cleanUsername}: ${this.status.lastError}`);
      await this.syncStatusToRedis();
      if (!isOffline) {
        this.scheduleReconnect(cleanUsername, sessionId, rawSessionCookie);
      }
    }

    return this.status;
  }

  private extractUserInfo(data: any) {
    const userObj = data?.user || data;
    const userId = String(userObj?.userId || userObj?.uniqueId || 'unknown');
    const username = String(userObj?.uniqueId || userObj?.nickname || userId);
    const nickname = userObj?.nickname ? String(userObj.nickname) : username;
    const avatarUrl =
      userObj?.profilePicture?.urls?.[0] ||
      userObj?.profilePictureUrl ||
      undefined;
    const msgId = String(data?.common?.msgId || data?.msgId || `${Date.now()}-${Math.random()}`);
    return { userId, username, nickname, avatarUrl, msgId };
  }

  private registerConnectionListeners(
    conn: TikTokLiveConnection,
    username: string,
    sessionId: string,
  ) {
    conn.on(WebcastEvent.LIKE, async (data: any) => {
      const likeCount = Math.max(1, Number(data?.likeCount || 1));
      const { userId, username: uName, nickname, avatarUrl, msgId } = this.extractUserInfo(data);
      await this.emitNormalizedEvent({
        eventId: randomUUID(),
        eventKey: `${sessionId}:like:${userId}:${msgId}`,
        type: 'like',
        sessionId,
        tiktokUserId: userId,
        username: uName,
        nickname,
        avatarUrl,
        timestamp: Date.now(),
        likeCount,
        totalLikeCount: Number(data?.totalLikeCount || 0),
      });
    });

    conn.on(WebcastEvent.GIFT, async (data: any) => {
      const { userId, username: uName, nickname, avatarUrl, msgId } = this.extractUserInfo(data);
      const giftId = String(data?.giftId || data?.giftDetails?.giftId || '0');
      const repeatCount = Math.max(1, Number(data?.repeatCount || 1));
      const groupId = String(data?.groupId || msgId);
      const diamondCount = Number(
        data?.giftDetails?.diamondCount ||
          data?.extendedGiftInfo?.diamond_count ||
          data?.diamondCount ||
          1,
      );
      const giftName = String(
        data?.giftDetails?.giftName ||
          data?.extendedGiftInfo?.name ||
          data?.giftName ||
          `Gift #${giftId}`,
      );

      this.logger.log(
        `🎁 [DONATE] Nhận quà "${giftName}" x${repeatCount} (${diamondCount * repeatCount}💎) từ @${uName}!`,
      );

      await this.emitNormalizedEvent({
        eventId: randomUUID(),
        eventKey: `${sessionId}:gift:${userId}:${giftId}:${groupId}:${repeatCount}`,
        type: 'gift',
        sessionId,
        tiktokUserId: userId,
        username: uName,
        nickname,
        avatarUrl,
        timestamp: Date.now(),
        giftId,
        giftName,
        repeatCount,
        repeatEnd: Boolean(data?.repeatEnd ?? true),
        diamondCount,
      });
    });

    conn.on(WebcastEvent.CHAT, async (data: any) => {
      const { userId, username: uName, nickname, avatarUrl, msgId } = this.extractUserInfo(data);
      await this.emitNormalizedEvent({
        eventId: randomUUID(),
        eventKey: `${sessionId}:chat:${userId}:${msgId}`,
        type: 'chat',
        sessionId,
        tiktokUserId: userId,
        username: uName,
        nickname,
        avatarUrl,
        timestamp: Date.now(),
        comment: String(data?.comment || '').slice(0, 120),
      });
    });

    conn.on(WebcastEvent.FOLLOW, async (data: any) => {
      const { userId, username: uName, nickname, avatarUrl } = this.extractUserInfo(data);
      await this.emitNormalizedEvent({
        eventId: randomUUID(),
        eventKey: `${sessionId}:follow:${userId}`,
        type: 'follow',
        sessionId,
        tiktokUserId: userId,
        username: uName,
        nickname,
        avatarUrl,
        timestamp: Date.now(),
      });
    });

    conn.on(WebcastEvent.MEMBER, async (data: any) => {
      const { userId, username: uName, nickname, avatarUrl, msgId } = this.extractUserInfo(data);
      await this.emitNormalizedEvent({
        eventId: randomUUID(),
        eventKey: `${sessionId}:join:${userId}:${msgId}`,
        type: 'join',
        sessionId,
        tiktokUserId: userId,
        username: uName,
        nickname,
        avatarUrl,
        timestamp: Date.now(),
      });
    });

    conn.on(ControlEvent.DISCONNECTED, async () => {
      this.logger.warn(`Disconnected from TikTok LIVE @${username}`);
      this.status.connected = false;
      this.status.isLive = false;
      await this.syncStatusToRedis();
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect(username, sessionId);
      }
    });

    conn.on(WebcastEvent.STREAM_END, async () => {
      this.logger.log(`TikTok LIVE stream ended for @${username}`);
      this.status.connected = false;
      this.status.isLive = false;
      this.status.mode = 'idle';
      this.status.lastError = 'Phiên LIVE đã kết thúc.';
      await this.syncStatusToRedis();
    });

    conn.on(ControlEvent.ERROR, (err: any) => {
      this.logger.warn(`TikTok connector non-fatal error: ${err?.message || err}`);
    });
  }

  private scheduleReconnect(username: string, sessionId: string, rawSessionCookie?: string) {
    if (this.intentionalDisconnect) return;
    this.clearReconnectTimer();
    this.status.reconnectAttempts += 1;
    const delayMs = Math.min(30000, 1000 * Math.pow(2, Math.min(this.status.reconnectAttempts, 5)));
    this.logger.log(
      `Scheduling reconnect #${this.status.reconnectAttempts} for @${username} in ${delayMs}ms`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.connectToLive(username, sessionId, rawSessionCookie).catch((e) =>
        this.logger.error(`Reconnect error: ${e.message}`),
      );
    }, delayMs);
  }

  async disconnectFromLive(): Promise<ConnectorStatusDto> {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    if (this.connection) {
      try {
        await this.connection.disconnect();
      } catch {
        // ignore
      }
      this.connection = null;
    }
    this.status = {
      connected: false,
      username: null,
      sessionId: null,
      sessionCookie: null,
      reconnectAttempts: 0,
      mode: 'idle',
      isLive: false,
      roomId: undefined,
      roomTitle: undefined,
      viewerCount: undefined,
    };
    await this.syncStatusToRedis();
    return this.status;
  }

  async emitNormalizedEvent(event: NormalizedTikTokEvent): Promise<void> {
    await this.redisService.xadd(REDIS_STREAMS.TIKTOK_EVENTS, event);
  }

  private async syncStatusToRedis() {
    await this.redisService.setJson(REDIS_KEYS.CONNECTOR_STATE, this.status);
    await this.redisService.publish(REDIS_CHANNELS.CONNECTOR_STATUS, this.status);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  onModuleDestroy() {
    this.clearReconnectTimer();
    if (this.connection) {
      this.connection.disconnect().catch(() => undefined);
    }
  }
}
