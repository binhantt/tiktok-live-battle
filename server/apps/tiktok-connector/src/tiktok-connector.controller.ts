import { Body, Controller, Get, Post } from '@nestjs/common';
import { TikTokConnectorService } from './tiktok-connector.service';

@Controller()
export class TikTokConnectorController {
  constructor(private readonly connectorService: TikTokConnectorService) {}

  @Get('health')
  health() {
    return {
      service: 'tiktok-connector',
      ok: true,
      status: this.connectorService.getStatus(),
    };
  }

  @Post('check-live')
  async checkLive(
    @Body() body: { username: string; sessionId?: string; sessionCookie?: string },
  ) {
    if (!body?.username) {
      return { isLive: false, username: '', message: 'Vui lòng cung cấp username.' };
    }
    return this.connectorService.checkIsLive(body.username, body.sessionCookie || body.sessionId);
  }
}
