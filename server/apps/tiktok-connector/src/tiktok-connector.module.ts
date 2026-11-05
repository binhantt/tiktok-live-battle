import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@app/shared';
import { TikTokConnectorService } from './tiktok-connector.service';
import { TikTokConnectorController } from './tiktok-connector.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    RedisModule,
  ],
  controllers: [TikTokConnectorController],
  providers: [TikTokConnectorService],
})
export class TikTokConnectorModule {}
