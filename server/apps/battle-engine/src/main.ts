import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { BattleEngineModule } from './battle-engine.module';

async function bootstrap() {
  const logger = new Logger('BattleEngine');
  const app = await NestFactory.create(BattleEngineModule);
  const port = Number(process.env.BATTLE_PORT || 3004);
  await app.listen(port, '0.0.0.0');
  logger.log(`Battle Engine service listening on http://0.0.0.0:${port}`);
}
bootstrap();
