import { Controller, Get } from '@nestjs/common';
import { EventWorkerService } from './event-worker.service';

@Controller()
export class EventWorkerController {
  constructor(private readonly workerService: EventWorkerService) {}

  @Get('health')
  health() {
    return {
      service: 'event-worker',
      ok: true,
      metrics: this.workerService.getMetrics(),
    };
  }
}
