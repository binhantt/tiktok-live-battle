import { Controller, Get } from '@nestjs/common';
import { BattleEngineService } from './battle-engine.service';

@Controller()
export class BattleEngineController {
  constructor(private readonly battleService: BattleEngineService) {}

  @Get('health')
  health() {
    const snap = this.battleService.getSnapshot();
    return {
      service: 'battle-engine',
      ok: true,
      tick: snap.tick,
      activeCharacters: snap.characters.length,
      totalSpawned: snap.totalSpawned,
      totalKills: snap.totalKills,
    };
  }
}
