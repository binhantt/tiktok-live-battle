import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule, SharedDatabaseModule } from '@app/shared';
import { BattleEngineService } from './battle-engine.service';
import { BattleEngineController } from './battle-engine.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    RedisModule,
    SharedDatabaseModule,
  ],
  controllers: [BattleEngineController],
  providers: [BattleEngineService],
})
export class BattleEngineModule {}
