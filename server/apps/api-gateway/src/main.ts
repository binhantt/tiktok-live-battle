import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ApiGatewayModule } from './api-gateway.module';

async function bootstrap() {
  const logger = new Logger('ApiGateway');
  const app = await NestFactory.create(ApiGatewayModule);
  app.enableCors({
    origin: '*',
    credentials: true,
  });
  const port = Number(process.env.API_PORT || 3000);
  await app.listen(port);
  logger.log(`API Gateway & Socket.IO server listening on http://localhost:${port}`);
}
bootstrap();
