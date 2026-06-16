import { Controller, Get, Post, Body, Query, HttpCode } from '@nestjs/common';
import { GemScreenerService } from './gem-screener.service';
import * as iconv from 'iconv-lite';

@Controller('gem')
export class GemScreenerController {
  constructor(private readonly gemScreener: GemScreenerService) {}

  /**
   * 代理腾讯股票行情API（前端无法正确处理GBK编码，后端用iconv-lite解码）
   * POST /api/gem/tencent-proxy body: { q: "sz300001,sh600001" }
   */
  @Post('tencent-proxy')
  @HttpCode(200)
  async tencentProxy(@Body() body: { q: string }) {
    if (!body.q) return { code: 400, msg: 'missing q parameter' };
    const url = 'https://qt.gtimg.cn/q=' + encodeURIComponent(body.q);
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const txt = iconv.decode(buf, 'gbk');
    return { code: 200, msg: 'success', data: { text: txt } };
  }

  @Post('refresh')
  @HttpCode(200)
  async refreshWithData(@Body() body: { stocks: any[] }) {
    const opportunities = await this.gemScreener.scanWithFrontendData(body.stocks);
    return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
  }

  @Post('refresh-main-board')
  @HttpCode(200)
  async refreshMainBoard(@Body() body: { stocks: any[] }) {
    const opportunities = await this.gemScreener.scanWithFrontendMainBoardData(body.stocks);
    return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
  }

  @Post('refresh-sector')
  @HttpCode(200)
  async refreshSector(@Body() body: { stocks: any[] }) {
    const opportunities = await this.gemScreener.scanWithFrontendSectorData(body.stocks);
    return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
  }

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
  async getTopGem(@Query('force') force?: string) {
    const result = await this.gemScreener.scanTopGem(force === 'true');
    return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
  }

  @Get('top/main-board')
  async getTopMainBoard(@Query('force') force?: string) {
    const result = await this.gemScreener.scanTopMainBoard(force === 'true');
    return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
  }

  @Get('top/opportunities')
  async getTopOpportunities(@Query('force') force?: string) {
    const result = await this.gemScreener.scanTopOpportunities(force === 'true');
    return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
  }

  @Get('top/sector')
  async getTopSector(@Query('force') force?: string) {
    const result = await this.gemScreener.scanSectorOpportunities(force === 'true');
    return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
  }
}