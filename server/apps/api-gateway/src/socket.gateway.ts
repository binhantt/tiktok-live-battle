import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  BattleSnapshot,
  ConnectorStatusDto,
  GameEvents,
  REDIS_CHANNELS,
  REDIS_KEYS,
  RedisService,
  normalizeRoundTiming,
} from '@app/shared';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class SocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(SocketGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    await this.redisService.subscribe<{
      event: keyof GameEvents;
      payload: any;
    }>(REDIS_CHANNELS.GAME_EVENTS, (msg) => {
      if (this.server && msg?.event) {
        this.server.emit(msg.event, msg.payload);
      }
    });
    await this.redisService.subscribe<ConnectorStatusDto>(REDIS_CHANNELS.CONNECTOR_STATUS, (status) => {
      this.server?.emit('connector:status', status);
    });
  }

  afterInit() {
    this.logger.log('Socket.IO Gateway initialized');
  }

  async handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    await this.sendSnapshotToClient(client);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('battle:request-snapshot')
  async handleRequestSnapshot(client: Socket) {
    await this.sendSnapshotToClient(client);
  }

  private async sendSnapshotToClient(client: Socket) {
    const snapshot = await this.redisService.getJson<BattleSnapshot>(REDIS_KEYS.BATTLE_SNAPSHOT);
    if (snapshot) {
      client.emit('battle:snapshot', snapshot);
    } else {
      const emptySnapshot: BattleSnapshot = {
        version: 1,
        tickRate: Number(process.env.BATTLE_TICK_RATE || 20),
        sessionId: 'default-session',
        streamerUsername: process.env.TIKTOK_USERNAME || 'live_arena',
        status: 'waiting',
        tick: 0,
        timestamp: Date.now(),
        arenaWidth: 1920,
        arenaHeight: 1080,
        roundNumber: 1,
        roundStatus: 'fighting',
        ...normalizeRoundTiming(null),
        roundEndsAt: null,
        nextRoundStartsAt: null,
        hostageState: 'captured',
        policeScore: 0,
        smugglerScore: 0,
        targetScore: 100,
        policeWins: 0,
        smugglerWins: 0,
        totalSpawned: 0,
        totalKills: 0,
        characters: [],
      };
      client.emit('battle:snapshot', emptySnapshot);
    }
  }
}
