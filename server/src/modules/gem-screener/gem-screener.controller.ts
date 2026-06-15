import { Controller, Get } from '@nestjs/common';
import { GemScreenerService } from './gem-screener.service';

@Controller('gem')
export class GemScreenerController {
  constructor(private readonly gemScreener: GemScreenerService) {}

  @Get('opportunities')
  async getOpportunities() {
    const { opportunities, timestamp } = await this.gemScreener.getOpportunities();
    return { code: 200, msg: 'success', data: { opportunities, timestamp } };
  }

  @Get('main-board')
  async getMainBoard() {
    const { opportunities, timestamp } = await this.gemScreener.getMainBoardOpportunities();
    return { code: 200, msg: 'success', data: { opportunities, timestamp } };
  }

  @Get('top/gem')
  async getTopGem() {
    const result = await this.gemScreener.scanTopGem();
    return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
  }

  @Get('top/main-board')
  async getTopMainBoard() {
    const result = await this.gemScreener.scanTopMainBoard();
    return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
  }

  @Get('top/opportunities')
  async getTopOpportunities() {
    const result = await this.gemScreener.scanTopOpportunities();
    return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
  }

  @Get('top/sector')
  async getTopSector() {
    const result = await this.gemScreener.scanSectorOpportunities();
    return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
  }
}