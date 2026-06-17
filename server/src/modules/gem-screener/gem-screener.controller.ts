import { Controller, Get, Post, Body, Query, HttpCode, Logger } from '@nestjs/common';
import { GemScreenerService } from './gem-screener.service';
import * as iconv from 'iconv-lite';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import INDUSTRY_SECTORS, { CONCEPT_SECTORS } from '../../industry-sectors/data';

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
    // 合并重仓买入中GEM股(300/301开头)，按评分排序，重仓买入排最前面
    const heavyBuyGEM = this.readHeavyBuyCache().filter(s =>
      s.code && (s.code.startsWith('300') || s.code.startsWith('301'))
    );
    const merged = this.mergeWithHeavyBuy(result.opportunities, heavyBuyGEM);
    return { code: 200, msg: 'success', data: { opportunities: merged.slice(0, 10), timestamp: result.timestamp } };
  }

  @Get('top/main-board')
  async getTopMainBoard(@Query('force') force?: string) {
    const result = await this.gemScreener.scanTopMainBoard(force === 'true');
    // 合并重仓买入中主板股(非300/301开头)，按评分排序
    const heavyBuyMain = this.readHeavyBuyCache().filter(s =>
      s.code && !s.code.startsWith('30')
    );
    const merged = this.mergeWithHeavyBuy(result.opportunities, heavyBuyMain);
    return { code: 200, msg: 'success', data: { opportunities: merged.slice(0, 10), timestamp: result.timestamp } };
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
    // 1. 先尝试从缓存获取
    const all = await this.gemScreener.getAllOpportunities();
    const cachedHeavyBuy = all.filter(s => s.suggestion === '重仓买入');
    if (cachedHeavyBuy.length >= 3) {
      return { code: 200, msg: 'success', data: { opportunities: cachedHeavyBuy.slice(0, 3), timestamp: Date.now() } };
    }

    // 2. 优先读取种子缓存（快速响应，不从Render访问腾讯API）
    try {
      const paths = [
        join(__dirname, '..', '..', '..', 'assets', 'heavy-buy-cache.json'),
        join(process.cwd(), 'assets', 'heavy-buy-cache.json'),
      ];
      for (const p of paths) {
        if (existsSync(p)) {
          const raw = readFileSync(p, 'utf-8');
          const parsed = JSON.parse(raw);
          const seedData = parsed.data || parsed.opportunities || parsed;
          if (Array.isArray(seedData) && seedData.length > 0) {
            this.logger.log(`✅ 使用种子缓存: ${seedData.length} 只重仓买入`);
            return { code: 200, msg: 'success', data: { opportunities: seedData.slice(0, 3), timestamp: Date.now() } };
          }
        }
      }
    } catch (e) {
      this.logger.warn('读取重仓买入种子缓存失败: ' + e.message);
    }

    // 3. 后台异步触发全局扫描（不阻塞返回）
    this.gemScreener.scanGlobalHeavyBuy().catch(e => {
      this.logger.warn('后台全局重仓扫描失败: ' + e.message);
    });

    return { code: 200, msg: 'success', data: { opportunities: [], timestamp: Date.now() } };
  }

  /**
   * 动态行业板块热度排行Top10（基于实时成分股涨跌幅均值）
   * GET /api/gem/industry-sectors/top10
   */
  @Get('industry-sectors/top10')
  @HttpCode(200)
  async getIndustrySectorsTop10() {
    try {
      const result = await this.gemScreener.getIndustrySectorTop10();
      if (result && result.sectors && result.sectors.length > 0) {
        return { code: 200, msg: 'success', data: result };
      }
    } catch (e) {
      this.logger.warn('实时行业板块排行失败: ' + e.message);
    }
    // 降级: 使用ALL_SECTORS内置数据（始终包含概念板块）
    try {
      const ALL_SECTORS = [...INDUSTRY_SECTORS, ...CONCEPT_SECTORS];
      const fallbackSectors = ALL_SECTORS.map((s, i) => ({
        rank: 0,
        name: s.name,
        avgChangePercent: 0,
        totalStocks: s.codes.length,
        upStocks: 0,
        stocks: s.codes.slice(0, 5).map(code => ({ code, name: '', price: 0, changePercent: 0 })),
      }));
      fallbackSectors.sort((a, b) => a.name.localeCompare(b.name));
      fallbackSectors.forEach((s, i) => { s.rank = i + 1; });
      this.logger.log(`✅ 使用内置ALL_SECTORS降级: ${fallbackSectors.length} 个板块(含概念)`);
      return { code: 200, msg: 'success', data: { sectors: fallbackSectors, timestamp: Date.now() } };
    } catch (e) {
      this.logger.error('ALL_SECTORS降级失败: ' + e.message);
    }
    return { code: 200, msg: 'success', data: { sectors: [], timestamp: Date.now() } };
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

  /**
   * 读取重仓买入缓存
   */
  private readHeavyBuyCache(): any[] {
    try {
      const paths = [
        join(process.cwd(), 'assets', 'heavy-buy-cache.json'),
      ];
      for (const p of paths) {
        if (existsSync(p)) {
          const raw = readFileSync(p, 'utf-8');
          const data = JSON.parse(raw);
          if (data && data.data && data.data.length > 0) {
            return data.data.map(s => ({ ...s, suggestion: '🔥 重仓买入', suggestText: '🔥 重仓买入' }));
          }
        }
      }
    } catch (e) {
      this.logger.error('读取重仓买入缓存失败: ' + e.message);
    }
    return [];
  }

  /**
   * 合并机会股与重仓买入，按评分排序（重仓买入排最前面）
   */
  private mergeWithHeavyBuy(opportunities: any[], heavyBuy: any[]): any[] {
    const heavyCodes = new Set(heavyBuy.map(s => s.code));
    // 从机会股中排除已出现在重仓买入的(避免重复)
    const uniqueOpps = opportunities.filter(s => !heavyCodes.has(s.code));
    // 合并,按评分降序
    const merged = [...heavyBuy, ...uniqueOpps].sort((a, b) => (b.score || 0) - (a.score || 0));
    return merged;
  }
}