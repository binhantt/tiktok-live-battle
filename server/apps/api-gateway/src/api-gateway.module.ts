import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule, SharedDatabaseModule } from '@app/shared';
import { ApiGatewayController } from './api-gateway.controller';
import { SocketGateway } from './socket.gateway';
import { TikTokOAuthService } from './tiktok-oauth.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    RedisModule,
    SharedDatabaseModule,
  ],
  controllers: [ApiGatewayController],
  providers: [SocketGateway, TikTokOAuthService],
})
export class ApiGatewayModule {}
