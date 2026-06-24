import { Controller, Get } from '@nestjs/common';
import { SectorService } from './sector.service';
import { SectorHotResponse } from './sector.types';

@Controller('sector')
export class SectorController {
  constructor(private readonly sectorService: SectorService) {}

  @Get('hot')
  async getHotSectors(): Promise<{ code: number; msg: string; data: SectorHotResponse }> {
    const data = await this.sectorService.getHotSectors();
    return { code: 200, msg: 'success', data };
  }
}