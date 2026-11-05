import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { TikTokConnectorModule } from './tiktok-connector.module';

async function bootstrap() {
  const logger = new Logger('TikTokConnector');
  const app = await NestFactory.create(TikTokConnectorModule);
  const port = Number(process.env.CONNECTOR_PORT || 3002);
  await app.listen(port);
  logger.log(`TikTok Connector service listening on http://localhost:${port}`);
}
bootstrap();
