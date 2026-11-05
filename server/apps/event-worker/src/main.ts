import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { EventWorkerModule } from './event-worker.module';

async function bootstrap() {
  const logger = new Logger('EventWorker');
  const app = await NestFactory.create(EventWorkerModule);
  const port = Number(process.env.WORKER_PORT || 3003);
  await app.listen(port);
  logger.log(`Event Worker service listening on http://localhost:${port}`);
}
bootstrap();
