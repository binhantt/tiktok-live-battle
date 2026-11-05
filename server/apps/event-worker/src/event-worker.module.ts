import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule, SharedDatabaseModule } from '@app/shared';
import { EventWorkerService } from './event-worker.service';
import { EventWorkerController } from './event-worker.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    RedisModule,
    SharedDatabaseModule,
  ],
  controllers: [EventWorkerController],
  providers: [EventWorkerService],
})
export class EventWorkerModule {}
