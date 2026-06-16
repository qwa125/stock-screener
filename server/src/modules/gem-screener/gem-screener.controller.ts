import { Controller, Get, Post, Body, Query, HttpCode, Logger } from '@nestjs/common';
import { GemScreenerService } from './gem-screener.service';
import * as iconv from 'iconv-lite';

@Controller('gem')
export class GemScreenerController {
  private readonly logger = new Logger(GemScreenerController.name);
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

  /**
   * 重仓买入专区: 从全市场(创业板+主板+热点板块)缓存 + 全局重仓买入扫描中筛选出 "重仓买入" 级别的股票
   * GET /api/gem/top/heavy-buy
   */
  @Get('top/heavy-buy')
  async getHeavyBuy() {
    // 先尝试从缓存获取
    const all = await this.gemScreener.getAllOpportunities();
    const cachedHeavyBuy = all.filter(s => s.suggestion === '重仓买入');
    
    if (cachedHeavyBuy.length >= 3) {
      return { code: 200, msg: 'success', data: { opportunities: cachedHeavyBuy.slice(0, 3), timestamp: Date.now() } };
    }

    // 缓存不足3只 → 启动全局重仓买入扫描（全行业280成分股 + 已知机会股）
    this.logger.log('🔍 缓存重仓买入不足3只，启动全局扫描...');
    const globalHeavyBuy = await this.gemScreener.scanGlobalHeavyBuy();
    return { code: 200, msg: 'success', data: { opportunities: globalHeavyBuy.slice(0, 3), timestamp: Date.now() } };
  }

  /**
   * 动态行业板块热度排行Top10（基于实时成分股涨跌幅均值）
   * GET /api/gem/industry-sectors/top10
   */
  @Get('industry-sectors/top10')
  @HttpCode(200)
  async getIndustrySectorsTop10() {
    const result = await this.gemScreener.getIndustrySectorTop10();
    return { code: 200, msg: 'success', data: result };
  }

  /**
   * 强制全量扫描并生成初始缓存种子文件
   * POST /api/gem/seed-cache
   */
  @Post('seed-cache')
  @HttpCode(200)
  async seedCache() {
    const result = await this.gemScreener.generateSeedCache();
    return { code: 200, msg: 'success', data: result };
  }
}