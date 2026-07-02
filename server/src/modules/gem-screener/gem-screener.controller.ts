import { Controller, Get, Post, Body, Query, HttpCode, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SkipAccessLimit } from '@/guards/access-limit.guard';
import { GemScreenerService } from './gem-screener.service';
import { GemScreenerScheduler } from './gem-screener.scheduler';
import { StockService } from '../stock/stock.service';
import INDUSTRY_SECTORS, { CONCEPT_SECTORS } from '../../industry-sectors/data';

@Controller('gem')
export class GemScreenerController {
  private readonly logger = new Logger(GemScreenerController.name);
  private readonly klineProxyCache = new Map<string, { data: any[]; timestamp: number }>();
  private klineDiskRestored = false;
  private _forceMode = false; // 强制分析模式（跳过缓存，11:30/15:00全量重算）
  private readonly adminKey = process.env.ADMIN_KEY || 'admin123'; // 管理员密码
  private _analyzeBusy = false; // 分析队列锁
  private _analyzeQueue: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

  constructor(
    private readonly gemScreener: GemScreenerService,
    private readonly scheduler: GemScreenerScheduler,
    private readonly stockService: StockService,
  ) {}

  /**
   * 管理员验证
   * POST /api/gem/verify-admin
   */
  @Post('verify-admin')
  async verifyAdmin(@Body() body: { key?: string }) {
    const verified = body.key === this.adminKey;
    return { code: 200, msg: 'success', data: { verified } };
  }

  /**
   * 市场状态（交易/午休/收盘/盘前）
   * GET /api/gem/market-state
   */
  @Get('market-state')
  async getMarketState() {
    const state = this.scheduler.getState();
    const bjNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const bjStr = bjNow.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return {
      code: 200,
      msg: 'success',
      data: {
        ...state,
        beijingTime: bjStr,
        lockUntilStr: state.lockUntil
          ? new Date(state.lockUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          : null,
        nextScanStr: state.nextScanTime
          ? new Date(state.nextScanTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          : null,
      },
    };
  }

  /**
   * 实时股价流（SSE）：每秒推送关注股票的最新价/涨幅
   * GET /api/gem/price-stream
   */
  @Get('price-stream')
  async priceStream(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const codes = this.scheduler.getWatchedCodes();
    if (codes.length === 0) {
      res.write(`data: ${JSON.stringify({ error: 'no watched stocks' })}\n\n`);
      res.end();
      return;
    }

    this.logger.log(`📡 SSE 实时价格流开启: ${codes.length} 只关注股票`);

    let closed = false;
    res.on('close', () => { closed = true; });

    setInterval(async () => {
      if (closed) { return; }
      const state = this.scheduler.getState();
      if (state.status === 'closed' || state.status === 'premarket' || state.status === 'lunch') {
        res.write(`data: ${JSON.stringify({ marketStatus: state.status, prices: [] })}\n\n`);
        return;
      }
      try {
        // 后端不主动调外部API，实时价格由前端直连推送到后端
        if (!closed) {
          res.write(`data: ${JSON.stringify({ marketStatus: 'trading', prices: [], timestamp: Date.now() })}\n\n`);
        }
      } catch (e: any) {
        if (!closed) {
          res.write(`data: ${JSON.stringify({ marketStatus: 'error', error: e.message })}\n\n`);
        }
      }
    }, 2000);
  }

  /**
   * 保活ping（配合外部监控，防止Render休眠）
   */
  @Get('ping')
  @SkipAccessLimit()
  async ping() {
    return { code: 200, msg: 'pong', timestamp: Date.now() };
  }

  /**
   * 获取当前关注的股票代码列表
   */
  @Get('watched-codes')
  async getWatchedCodes() {
    return { code: 200, msg: 'success', data: { codes: this.scheduler.getWatchedCodes() } };
  }

  /**
   * 代理腾讯股票行情API
   */
  @Post('tencent-proxy')
  @SkipAccessLimit()
  @HttpCode(200)
  async tencentProxy(@Body() body: { q: string }) {
    if (!body.q) return { code: 400, msg: 'missing q parameter' };
    // 后端不主动调外部API
    return { code: 200, msg: 'success', data: { text: '' } };
  }

  @Post('refresh')
  @SkipAccessLimit()
  @HttpCode(200)
  async refreshWithData(@Body() body: { stocks: any[] }) {
    const opportunities = await this.gemScreener.scanWithFrontendData(body.stocks);
    return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
  }

  @Post('refresh-main-board')
  @SkipAccessLimit()
  @HttpCode(200)
  async refreshMainBoard(@Body() body: { stocks: any[] }) {
    const opportunities = await this.gemScreener.scanWithFrontendMainBoardData(body.stocks);
    return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
  }

  @Post('refresh-sector')
  @SkipAccessLimit()
  @HttpCode(200)
  async refreshSector(@Body() body: { stocks: any[] }) {
    const opportunities = await this.gemScreener.scanWithFrontendSectorData(body.stocks);
    return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
  }

  @Post('refresh-heavy-buy')
  @SkipAccessLimit()
  async refreshHeavyBuy(@Body() body: { stocks: any[] }): Promise<any> {
    try {
      const stocks = body?.stocks || [];
      if (stocks.length === 0) {
        return { code: 400, msg: 'no stocks data', data: { opportunities: [] } };
      }
      this.logger.log(`📥 接收到重仓买入推送: ${stocks.length} 只`);
      const results = await this.gemScreener.scanWithFrontendHeavyBuyData(stocks);
      return { code: 200, msg: 'success', data: { opportunities: results } };
    } catch (e) {
      this.logger.error(`❌ 重仓买入分析失败: ${e.message}`);
      return { code: 500, msg: e.message, data: { opportunities: [] } };
    }
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
    const heavyBuyGEM = this.readHeavyBuyCache().filter(s =>
      s.code && (s.code.startsWith('300') || s.code.startsWith('301'))
    );
    const merged = this.mergeWithHeavyBuy(result.opportunities, heavyBuyGEM);
    return { code: 200, msg: 'success', data: { opportunities: merged, timestamp: result.timestamp } };
  }

  @Get('top/main-board')
  async getTopMainBoard(@Query('force') force?: string) {
    const result = await this.gemScreener.scanTopMainBoard(force === 'true');
    const heavyBuyMain = this.readHeavyBuyCache().filter(s =>
      s.code && !s.code.startsWith('30')
    );
    const merged = this.mergeWithHeavyBuy(result.opportunities, heavyBuyMain);
    return { code: 200, msg: 'success', data: { opportunities: merged, timestamp: result.timestamp } };
  }

  @Get('cache-all')
  @SkipAccessLimit()
  async getCacheAll() {
    const gem = this.gemScreener.getCacheAll();
    return { code: 200, msg: 'success', data: { total: gem.length, stocks: gem } };
  }

  @Get('top/combined')
  async getCombinedTop(@Query('force') force?: string) {
    const [gemResult, mainResult] = await Promise.all([
      this.gemScreener.scanTopGem(force === 'true'),
      this.gemScreener.scanTopMainBoard(force === 'true'),
    ]);
    const heavyBuyAll = this.readHeavyBuyCache();
    const gemMerged = this.mergeWithHeavyBuy(gemResult.opportunities, heavyBuyAll.filter(s => s.code && (s.code.startsWith('300') || s.code.startsWith('301'))));
    const mainMerged = this.mergeWithHeavyBuy(mainResult.opportunities, heavyBuyAll.filter(s => s.code && !s.code.startsWith('30')));
    const all = [...gemMerged, ...mainMerged];
    const seen = new Set<string>();
    const deduped = all.filter(s => { if (seen.has(s.code)) return false; seen.add(s.code); return true; });
    GemScreenerService.sortStocks(deduped);
    // 机会区只展示"重仓买入"和"买入"
    const sorted = deduped.filter(s => s.suggestion === '重仓买入' || s.suggestion === '买入');
    for (const s of sorted) {
      if (s.chipConcentration90 === undefined) {
        s.chipConcentration90 = 50;
        s.chipPeakPosition = 'mid';
        s.chipPattern = 'dispersed';
      }
      if (s.signalCombination === undefined) s.signalCombination = '';
      if (s.jiGouActiveScore === undefined) s.jiGouActiveScore = 0;
      // 强制确保 forecast1_2Day 存在，兼容旧缓存/部署包残留数据
      if (!s.forecast1_2Day || typeof s.forecast1_2Day === 'string') {
        try {
          s.forecast1_2Day = GemScreenerService.computeTechnicalForecast({
            entryTiming: s.entryTiming ?? 0,
            isGoldenCross: s.isGoldenCross ?? false,
            ma5: s.ma5 ?? 0,
            ma10: s.ma10 ?? 0,
            pricePosition: s.pricePosition ?? 50,
            mainForceInflow: s.mainForceInflow ?? 0,
            jiGouActiveScore: s.jiGouActiveScore ?? 0,
          });
        } catch { /* ignore */ }
      }
    }
    return { code: 200, msg: 'success', data: { opportunities: sorted, timestamp: Date.now() } };
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

  @Get('top/heavy-buy')
  async getHeavyBuy() {
    const all = await this.gemScreener.getAllOpportunities();
    const cachedHeavyBuy = all.filter(s => s.suggestion === '重仓买入');
    if (cachedHeavyBuy.length >= 3) {
      return { code: 200, msg: 'success', data: { opportunities: cachedHeavyBuy.slice(0, 3), timestamp: Date.now() } };
    }
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
    this.gemScreener.scanGlobalHeavyBuy().catch(e => {
      this.logger.warn('后台全局重仓扫描失败: ' + e.message);
    });
    return { code: 200, msg: 'success', data: { opportunities: [], timestamp: Date.now() } };
  }

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
    try {
      const ALL_SECTORS = [...INDUSTRY_SECTORS, ...CONCEPT_SECTORS];
      const fallbackSectors = ALL_SECTORS.map((s, i) => ({
        rank: 0,
        name: s.name,
        avgChangePercent: 0,
        totalStocks: s.codes.length,
        upStocks: 0,
        stocks: s.codes.slice(0, 10).map(code => ({ code, name: '', price: 0, changePercent: 0 })),
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

  @Post('seed-cache')
  @SkipAccessLimit()
  @HttpCode(200)
  async seedCache() {
    const result = await this.gemScreener.generateSeedCache();
    return { code: 200, msg: 'success', data: result };
  }

  private readHeavyBuyCache(): any[] {
    try {
      const paths = [join(process.cwd(), 'assets', 'heavy-buy-cache.json')];
      for (const p of paths) {
        if (existsSync(p)) {
          const raw = readFileSync(p, 'utf-8');
          const data = JSON.parse(raw);
          if (data && data.data && data.data.length > 0) {
            return data.data.map(s => ({ ...s, suggestion: '重仓买入', suggestText: '🔥 重仓买入' }));
          }
        }
      }
    } catch (e) {
      this.logger.error('读取重仓买入缓存失败: ' + e.message);
    }
    return [];
  }

  private mergeWithHeavyBuy(opportunities: any[], heavyBuy: any[]): any[] {
    const heavyCodes = new Set(heavyBuy.map(s => s.code));
    const uniqueOpps = opportunities.filter(s => !heavyCodes.has(s.code));
    const merged = [...heavyBuy, ...uniqueOpps].sort((a, b) => (b.score || 0) - (a.score || 0));
    return merged;
  }

  @Get('search')
  async searchStock(@Query('q') keyword: string) {
    if (!keyword || keyword.trim().length === 0) {
      return { code: 400, msg: '请输入搜索关键词', data: [] };
    }
    try {
      const results = await this.gemScreener.searchStocks(keyword.trim());
      return { code: 200, msg: 'ok', data: results };
    } catch (e) {
      this.logger.error(`搜索失败: ${e.message}`);
      return { code: 500, msg: e.message, data: [] };
    }
  }

  /**
   * 接收前端拉取的原始股票数据+K线，缓存并分析
   * POST /api/gem/cache-data
   */
  @Post('cache-data')
  @SkipAccessLimit()
  @HttpCode(200)
  async cacheData(@Body() body: { stocks: { code: string; name: string; price: number; changePercent: number; high?: number; low?: number; klines: any[] }[] }) {
    try {
      const stocks = body?.stocks || [];
      if (!stocks.length) return { code: 400, msg: 'empty stocks', data: [] };

      const results: any[] = [];
      for (const s of stocks) {
        try {
          if (!s.klines || s.klines.length < 20) continue;
          const normalKlines = s.klines.map(k => ({
            open: k.open ?? k[1] ?? 0,
            close: k.close ?? k[2] ?? 0,
            high: k.high ?? k[3] ?? 0,
            low: k.low ?? k[4] ?? 0,
            volume: k.volume ?? k[5] ?? 0,
            amount: k.amount ?? k[6] ?? 0,
          }));
          const result = await this.stockService.analyzeFromRawData({
            code: s.code,
            name: s.name,
            currentPrice: s.price,
            changePercent: s.changePercent,
            high: s.high,
            low: s.low,
            kline: normalKlines,
          });
          results.push(result);
        } catch (e) {
          this.logger.warn(`分析失败: ${s.code} ${s.name} - ${(e as Error).message}`);
        }
      }

      // 排序：优选的信号在前
      const SIGNAL_ORDER: Record<string, number> = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '减仓': 4, '卖出': 5, '不要介入': 6 };
      results.sort((a, b) => {
        const ao = SIGNAL_ORDER[a.suggestion ?? '持有'] ?? 9;
        const bo = SIGNAL_ORDER[b.suggestion ?? '持有'] ?? 9;
        if (ao !== bo) return ao - bo;
        return (b.score ?? 0) - (a.score ?? 0);
      });

      // 写入缓存
      this.gemScreener.updateCache('scan', results);

      this.logger.log(`📥 前端数据缓存+分析完成: ${results.length} 只`);
      return { code: 200, msg: 'success', data: { total: results.length } };
    } catch (e) {
      this.logger.error(`缓存数据失败: ${(e as Error).message}`);
      return { code: 500, msg: (e as Error).message, data: [] };
    }
  }

  /**
   * 读取分析后的扫描结果
   * GET /api/gem/scan-result
   */
  @Get('scan-result')
  @SkipAccessLimit()
  async getScanResult() {
    // 优先返回升级快照（精确信号），其次返回旧版scanCache
    const snap = this.gemScreener.getUpgradedSnapshot();
    if (snap?.list?.length) {
          const sortedOps = snap?.list?.length ? GemScreenerService.sortStocks([...snap.list]) : [];
    return { code: 200, msg: 'success', data: { opportunities: sortedOps, timestamp: snap.timestamp } };
    }
    const cached = this.gemScreener.getCache('scan');
    return { code: 200, msg: 'success', data: { opportunities: cached, timestamp: Date.now() } };
  }

  @Get('rescan')
  @SkipAccessLimit()
  async rescanMarket() {
    try {
      // 优先使用 Step③ 快照（精确的 Sina 实时升级结果，覆盖主缓存）
      const snap = this.gemScreener.getUpgradedSnapshot();
      let data: any[] = [];
      let updatedAt = 0;
      if (snap?.list?.length) {
        data = snap.list;
        updatedAt = snap.timestamp;
        this.logger.log(`📤 rescan返回快照: ${data.length}只, timestamp=${updatedAt}`);
      } else {
        // 无快照时回退到主缓存（K线分析结果）
        data = this.gemScreener.getCacheAll();
        updatedAt = this.gemScreener.getCacheTimestamp();
        this.logger.log(`📤 rescan返回主缓存: ${data.length}只, timestamp=${updatedAt}`);
      }

                  // ─── 从主缓存合并完整分析字段 ───
      const opMap = new Map<string, any>((this.gemScreener as any).opportunityStocks?.map((s: any) => [s.code, s]) || []);
      for (const item of data) {
        const full = opMap.get(item.code);
        if (full) {
          if (item.priceIncrease === undefined) item.priceIncrease = full.priceIncrease;
          if (item.mainForceInflow === undefined) item.mainForceInflow = full.mainForceInflow;
          if (item.volumeRatio === undefined) item.volumeRatio = full.volumeRatio;
          if (item.safetyScore === undefined) item.safetyScore = full.safetyScore;
          if (item.pricePosition === undefined) item.pricePosition = full.pricePosition;
          if (item.score === undefined) item.score = full.score;
          if (item.entryTiming === undefined) item.entryTiming = full.entryTiming;
          if (item.sectorName === undefined) item.sectorName = full.sectorName;
          if (item.jiGouActiveScore === undefined) item.jiGouActiveScore = full.jiGouActiveScore;
        }
      }

      // 日志：输出信号分布
      const sigDist: Record<string, number> = {};
      for (const s of data) { sigDist[s.suggestion] = (sigDist[s.suggestion] || 0) + 1; }
      this.logger.log(`📤 rescan信号分布: ${JSON.stringify(sigDist)}`);

      return {
        code: 200, msg: 'ok', data, updatedAt,
        cloudSnapshotUrl: this.gemScreener.cloudSnapshotUrl || '',
      };
    } catch (e) {
      this.logger.error(`读取缓存失败: ${e.message}`);
      return { code: 500, msg: e.message, data: [] };
    }
  }

  @Post('update-upgraded')
  @SkipAccessLimit()
  async updateUpgraded(@Body() body: { list?: any[] }) {
    try {
      const list = body?.list || [];
      if (!list.length) return { code: 200, msg: 'empty', data: [] };
      // debug: 查看升级信号分布
      const sigCount: Record<string, number> = {};
      for (const s of list) { const sig = s.suggestion || '无'; sigCount[sig] = (sigCount[sig] || 0) + 1; }
      this.logger.log(`📦 Step③收到升级信号: ${list.length}只, 分布=${JSON.stringify(sigCount)}, 前5=${list.slice(0,5).map(s => s.code + '-' + s.suggestion).join(',')}`);
      this.gemScreener.updateUpgradedCache(list);
      const sortedList = GemScreenerService.sortStocks([...list]);
      this.gemScreener.updateUpgradedCache(sortedList);
      this.gemScreener.setUpgradedSnapshot(sortedList);
      // debug: 验证关键股票写入结果
      const debugCodes = ['300260', '300749', '300088', '300321', '001335', '002456'];
      const allData = this.gemScreener.getCacheAll();
      if (allData?.length) {
        const debugInfo = debugCodes.map(c => {
          const s = allData.find(x => x.code === c);
          return s ? `${c}-${s.name}-${s.suggestion}-${s.currentPrice}` : `${c}-未找到`;
        }).join(' | ');
        this.logger.log(`📦 Step③写入后验证: 缓存共${allData.length}只, 关键股=${debugInfo}`);
      }
      return { code: 200, msg: `updated ${list.length} stocks`, data: list.length };
    } catch (e) {
      this.logger.error(`更新升级缓存失败: ${e.message}`);
      return { code: 500, msg: e.message, data: 0 };
    }
  }

  @Get('upgraded-snapshot')
  @SkipAccessLimit()
  async getUpgradedSnapshot() {
    const data = this.gemScreener.getUpgradedSnapshot();
        const sortedList = data?.list?.length ? GemScreenerService.sortStocks([...data.list]) : [];
    return { code: 200, msg: 'ok', data: sortedList, updatedAt: data?.timestamp || 0 };
  }

  /** 获取 TOS 云快照 URL（Render 休眠时前端也能直接读取） */
  @Get('cloud-snapshot-url')
  @SkipAccessLimit()
  async getCloudSnapshotUrl() {
    const url = this.gemScreener.cloudSnapshotUrl || '';
    const snap = this.gemScreener.getUpgradedSnapshot();
    return { code: 200, msg: 'ok', data: { url, timestamp: snap?.timestamp || 0, count: snap?.list?.length || 0 } };
  }

  @Post('refresh-all')
  @SkipAccessLimit()
  @HttpCode(200)
  async refreshAll(@Body() body: { stocks: any[] }) {
    const opportunities = await this.gemScreener.scanAllWithFrontendData(body.stocks);
    return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
  }

  @Post('sync-sell-state')
  @SkipAccessLimit()
  @HttpCode(200)
  async syncSellState(@Body() body: { sellStates: { code: string; suggestion: string }[] }) {
    try {
      this.gemScreener.syncSellStateFromFrontend(body.sellStates || []);
      return { code: 200, msg: 'success' };
    } catch (e) {
      return { code: 500, msg: e.message };
    }
  }

  @Post('sync-cache')
  @SkipAccessLimit()
  @HttpCode(200)
  async syncCache(@Body() body: { stocks: any[] }) {
    if (!body.stocks || !body.stocks.length) {
      return { code: 400, msg: '无数据' };
    }
    const count = await this.gemScreener.syncUpgradedCache(body.stocks);
    return { code: 200, msg: `同步 ${count} 只`, data: { count } };
  }

  @Post('rescan-batch')
  @SkipAccessLimit()
  @HttpCode(200)
  async rescanBatch(@Body() body: { codes: string[]; names?: string[] }) {
    if (!body.codes || !body.codes.length) {
      return { code: 400, msg: '请提供股票代码列表', data: [] };
    }
    this.logger.log(`批量分析: ${body.codes.length} 只股票`);
    const results: any[] = [];
    for (let i = 0; i < body.codes.length; i++) {
      const code = body.codes[i];
      const name = body.names?.[i] || '';
      try {
        const opp = await Promise.race([
          this.gemScreener.quickAnalyze(code, name, true),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 10000))
        ]);
        if (opp) results.push(opp);
      } catch {}
    }
    const PRIORITY: Record<string, number> = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '减仓': 4, '卖出': 5, '不要介入': 6 };
    results.sort((a, b) => {
      const pa = PRIORITY[a.suggestion || '持有'] ?? 9;
      const pb = PRIORITY[b.suggestion || '持有'] ?? 9;
      if (pa !== pb) return pa - pb;
      return (b.score || 0) - (a.score || 0);
    });
    this.logger.log(`批量分析完成: ${results.length} 只有效结果`);
    return { code: 200, msg: 'ok', data: results };
  }

  @Get('proxy/stock-list')
  @SkipAccessLimit()
  async proxyStockList(
    @Query('node') node: string,
    @Query('page') page: string,
    @Query('num') num: string,
    @Query('sort') sort?: string,
    @Query('asc') asc?: string,
  ) {
    // 后端不主动调外部API
    return { code: 200, msg: 'success', data: [] };
  }

  @Get('proxy/eastmoney-list')
  @SkipAccessLimit()
  async proxyEastMoneyList(
    @Query('node') node: string,
    @Query('page') page: string,
    @Query('num') num: string,
  ) {
    // 后端不主动调外部API
    return { code: 200, msg: 'success', data: [] };
  }

  @Get('proxy/search')
  @SkipAccessLimit()
  async proxySearch(@Query('q') query: string, @Query('count') count?: string) {
    if (!query || !query.trim()) {
      return { code: 400, msg: '缺少搜索关键词' };
    }
    // 后端不主动调外部API
    return { code: 200, msg: 'success', data: [] };
  }

  @Get('proxy/sina-us')
  @SkipAccessLimit()
  async proxySinaUS(@Query('code') code: string) {
    if (!code || !code.trim()) {
      return { code: 400, msg: '缺少股票代码' };
    }
    // 后端不主动调外部API
    return { code: 200, msg: 'success', data: '' };
  }

  /**
   * 代理东方财富K线数据（仅数据通道，不做分析）
   * 前端同源调用，解决浏览器跨域问题
   */
  @Get('proxy/kline')
  @SkipAccessLimit()
  async proxyKLine(@Query('code') code: string) {
    if (!code) return { code: 400, msg: '缺少股票代码', data: null };
    // 首次请求时从磁盘或 PG 恢复 K-line 缓存
    if (!this.klineDiskRestored) {
      const disk = await this.gemScreener.loadKlineCacheFromDisk();
      let loaded = 0;
      for (const [c, v] of disk) {
        if (!this.klineProxyCache.has(c)) {
          this.klineProxyCache.set(c, { data: v.data, timestamp: v.ts });
          loaded++;
        }
      }
      this.logger.log(`📦 磁盘 K-line 缓存恢复: ${loaded} 只`);
      // 如果磁盘不够多，尝试从 PG 补充（Render 重启后磁盘消失，PG 保留）
      if (loaded < 50 && this.gemScreener.klineDbCache && this.gemScreener.klineDbCache.size > 50) {
        let pgLoaded = 0;
        for (const [c, v] of this.gemScreener.klineDbCache) {
          if (!this.klineProxyCache.has(c) && v?.data?.length >= 10) {
            this.klineProxyCache.set(c, { data: v.data, timestamp: v.ts });
            pgLoaded++;
          }
        }
        this.logger.log(`📦 PostgreSQL K-line 缓存恢复: ${pgLoaded} 只`);
      }
      this.klineDiskRestored = true;
    }
    const cached = this.klineProxyCache.get(code);
    if (cached && cached.data && cached.data.length >= 5) {
      const age = Date.now() - cached.timestamp;
      const ageMin = Math.round(age / 1000 / 60);
      // 4小时TTL：日K线盘中不会变化（今天的日K线收盘才有），
      // 不需要盘中频繁刷新。隔天重启/首次拉取时缓存必过期。
      if (age < 10 * 60 * 1000) {
        return { code: 200, msg: `代理K线(缓存${ageMin}分钟前)`, data: cached.data, cached: true, age: ageMin };
      }
      // 缓存过期但有存量数据 → 只拉1根最新K线合并
      this.logger.log(`📦 K线增量刷新: ${code}`);
      const latestBar = await this._fetchTencentKline(code, 1);
      if (latestBar && latestBar.length > 0) {
        const newBar = latestBar[latestBar.length - 1];
        const merged = [...cached.data];
        const lastCached = merged[merged.length - 1];
        if (lastCached && lastCached.day === newBar.day) {
          merged[merged.length - 1] = newBar; // 同一天→替换（盘中更新）
        } else {
          merged.push(newBar); // 新的一天→追加
          if (merged.length > 125) merged.splice(0, merged.length - 120);
        }
        this.klineProxyCache.set(code, { data: merged, timestamp: Date.now() });
        return { code: 200, msg: '代理K线(增量刷新)', data: merged, cached: false };
      }
      // 增量失败，回退用老缓存
      this.klineProxyCache.set(code, { data: cached.data, timestamp: Date.now() });
      return { code: 200, msg: '代理K线(增量失败回退)', data: cached.data, cached: true };
    }
    // 无缓存 → 从腾讯API实时拉取
    const tencentResult = await this._fetchTencentKline(code);
    if (tencentResult) {
      this.klineProxyCache.set(code, { data: tencentResult, timestamp: Date.now() });
      this.logger.log(`✅ K线代理拉取成功: ${code} (${tencentResult.length}条)`);
      return { code: 200, msg: '代理K线成功', data: tencentResult, cached: false };
    }
    return { code: 200, msg: '无缓存K线数据', data: null, cached: false };
  }

  private async _fetchTencentKline(code: string, count: number = 120): Promise<any[] | null> {
    try {
      const prefix = code.startsWith('6') ? 'sh' : 'sz';
      const url = `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${code},day,,,${count},qfq`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok && res.status !== 0) return null;
      const json = await res.json();
      const tk = json?.data?.[prefix + code];
      if (!tk?.qfqday || tk.qfqday.length < Math.min(count, 5) || tk.qfqday.length < 1) return null;
      return tk.qfqday.map((l: any) => ({
        day: l[0], open: parseFloat(l[1]) || 0, close: parseFloat(l[2]) || 0,
        high: parseFloat(l[3]) || 0, low: parseFloat(l[4]) || 0,
        volume: parseFloat(l[5]) || 0,
        amount: (parseFloat(l[5]) || 0) * ((parseFloat(l[1]) + parseFloat(l[2])) / 2 || 0) * 100
      }));
    } catch {
      return null;
    }
  }

  /**
   * 批量查询 K-line 缓存状态（哪些股票有缓存、各多少条、最后更新）
   * GET /api/gem/kline-cache-status?codes=300001,300002,...
   */
  @Get('kline-cache-status')
  @SkipAccessLimit()
  async getKlineCacheStatus(@Query('codes') codes: string) {
    const codeList = (codes || '').split(',').map(c => c.trim()).filter(Boolean);
    if (!codeList.length) return { code: 400, msg: '缺少股票代码列表' };
    const result: Record<string, { cached: boolean; count: number; age: number }> = {};
    const now = Date.now();
    for (const code of codeList) {
      const cached = this.klineProxyCache.get(code);
      result[code] = cached && cached.data?.length >= 5
        ? { cached: true, count: cached.data.length, age: Math.round((now - cached.timestamp) / 1000 / 60) }
        : { cached: false, count: 0, age: 0 };
    }
    return { code: 200, msg: 'success', data: result };
  }

  /**
   * 批量查询K线缓存（POST，无URL长度限制）
   * POST /api/gem/kline-cache-check
   * Body: { codes: string[] }
   */
  @Post('kline-cache-check')
  @SkipAccessLimit()
  @HttpCode(200)
  async klineCacheCheck(@Body() body: { codes?: string[] }) {
    const codeList = (body?.codes || []).filter(Boolean);
    if (!codeList.length) return { code: 400, msg: '缺少股票代码列表', data: null };
    const now = Date.now();
    const cached: Record<string, { count: number; age: number }> = {};
    const missing: string[] = [];
    for (const code of codeList) {
      const cachedEntry = this.klineProxyCache.get(code);
      if (cachedEntry && cachedEntry.data?.length >= 10) {
        cached[code] = { count: cachedEntry.data.length, age: Math.round((now - cachedEntry.timestamp) / 1000 / 60) };
      } else {
        missing.push(code);
      }
    }
    this.logger.log(`📊 K线缓存检查: ${Object.keys(cached).length}只已缓存, ${missing.length}只缺失`);
    return { code: 200, msg: 'success', data: { cached, missing } };
  }

  /**
   * 批量加载K线缓存数据（供前端预热本地缓存）
   * POST /api/gem/kline-cache-bulk
   * Body: { codes: string[] }
   */
  @Post('kline-cache-bulk')
  @SkipAccessLimit()
  @HttpCode(200)
  async getKlineCacheBulk(@Body() body: { codes?: string[] }) {
    const codeList = (body?.codes || []).filter(Boolean);
    if (!codeList.length) return { code: 200, msg: '没有请求码', data: {} };
    const now = Date.now();
    const result: Record<string, any> = {};
    let hit = 0;
    for (const code of codeList) {
      const cached = this.klineProxyCache.get(code);
      if (cached && cached.data && cached.data.length >= 10) {
        result[code] = {
          data: cached.data,
          age: Math.round((now - cached.timestamp) / 1000 / 60)
        };
        hit++;
      }
    }
    return { code: 200, msg: `缓存命中 ${hit}/${codeList.length}`, data: result };
  }

  /**
   * 代理腾讯1分钟K线（日内分析用）
   */
  @Get('proxy/minkline')
  @SkipAccessLimit()
  async proxyMinKLine(@Query('code') code: string) {
    if (!code) return { code: 400, msg: '缺少股票代码', data: null };
    try {
      const prefix = code.startsWith('6') ? 'sh' : 'sz';
      const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${prefix}${code},m1,,240`;
      this.logger.log(`🌐 分钟K线代理拉取腾讯: ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok || res.status === 0) {
        const text = await res.text();
        const clean = text.replace(/^var\s+\S+\s*=\s*/, '').replace(/;$/, '');
        const json = JSON.parse(clean);
        const tk = json?.data?.[prefix + code];
        if (tk?.m1 && tk.m1.length >= 48) {
          const data = tk.m1.map((l: any) => ({
            time: l[0], open: parseFloat(l[1]) || 0, close: parseFloat(l[2]) || 0,
            high: parseFloat(l[3]) || 0, low: parseFloat(l[4]) || 0,
            volume: parseFloat(l[5]) || 0, amount: 0
          }));
          this.logger.log(`✅ 分钟K线代理拉取成功: ${code} (${data.length}条)`);
          return { code: 200, msg: '代理分钟K线成功', data, cached: false };
        }
      }
      this.logger.warn(`⚠️ 分钟K线代理无数据: ${code}`);
    } catch (e: any) {
      this.logger.error(`❌ 分钟K线代理失败: ${code} ${e.message || e}`);
    }
    return { code: 200, msg: '分钟K线无数据', data: null, cached: false };
  }

  /**
   * 代理个股详情（含集合竞价数据）
   * 返回：成交量、量比、集合竞价成交量/未匹配量/方向等
   */
  @Get('proxy/stock-detail')
  @SkipAccessLimit()
  async proxyStockDetail(@Query('code') code: string) {
    if (!code) return { code: 400, msg: '缺少股票代码', data: null };
    // 后端不主动调外部API
    return { code: 200, msg: 'success', data: { volumeRatio: 0, auctionVolume: 0, auctionAmount: 0, auctionUnmatched: 0, auctionDirection: 0 } };
  }

  /** 只重算缓存信号，不调外部API */
  @Post('recalc')
  @SkipAccessLimit()
  async recalcCache() {
    const result = await this.gemScreener.recalcCacheSignals();
    return { code: 200, msg: '缓存信号重算完成', data: result };
  }

  @Post('analyze')
  @SkipAccessLimit()
  async analyzeWithKLine(@Body() body: { code: string; name?: string; kline: any[]; mainForceInflow?: number; price?: number; changePercent?: number }) {
    if (!body.code) {
      return { code: 400, msg: '缺少股票代码' };
    }
    // 无K线时直接创建基础记录入缓存（浏览器无法从中国外拉取K线时降级使用）
    if (!body.kline || !Array.isArray(body.kline) || body.kline.length < 5) {
      const fallbackOpp = { code: body.code, name: body.name || '', suggestion: '持有', score: 5, entryTiming: 0, currentPrice: body.price || 0, changePercent: body.changePercent || 0, pricePosition: 0, priceIncrease: 0, mainForceInflow: 0, baiXiaoDays: 0, capitalRank: 0, safetyScore: 0, trade: body.price || 0, price: body.price || 0, changepercent: body.changePercent || 0, inflow: 0, timestamp: Date.now() };
      this.gemScreener.updateSingleStockInCache(fallbackOpp).catch(() => {});
      return { code: 200, msg: '已缓存基础数据（无K线）', data: [fallbackOpp] };
    }
    try {
      const klineData = body.kline.map((item: any) => ({
        date: item.day || item.date,
        open: parseFloat(item.open) || 0,
        close: parseFloat(item.close) || 0,
        high: parseFloat(item.high) || 0,
        low: parseFloat(item.low) || 0,
        volume: parseFloat(item.volume) || 0,
        amount: item.amount || 0,
      }));
      // 缓存原始K线（备选代理用，仅腾讯挂了才走）
      if (body.code && klineData.length >= 5) {
        this.klineProxyCache.set(body.code, { data: klineData, timestamp: Date.now() });
        // 内存优化：单只120根K线 ≈ 10KB, 1200只 ≈ 12MB，控制在 1200 以内
        if (this.klineProxyCache.size > 1200) {
          const entries = [...this.klineProxyCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
          entries.slice(0, entries.length - 600).forEach(([k]) => this.klineProxyCache.delete(k));
        }
      }
      // ─── 分析结果缓存：K线日期相同且无极端涨跌幅时跳过 quickAnalyze（80行CPU密集计算） ───
      // force=true时跳过缓存（11:30/15:00强制完整分析）
      const cachedResult = this._forceMode ? null : this.gemScreener.isCacheValid(body.code, klineData, body.changePercent);
      if (cachedResult) {
        // 用前端最新价格更新（盘中价格实时变动）
        if (body.price !== undefined) cachedResult.currentPrice = body.price;
        if (body.changePercent !== undefined) cachedResult.changePercent = body.changePercent;
        // 更新入内存缓存，供机会列表展示
        this.gemScreener.updateSingleStockInCache(cachedResult).catch(e => this.logger.warn(`更新缓存失败: ${e.message}`));
        return { code: 200, msg: 'success(cached)', data: [cachedResult] };
      }
      let opp = await this.gemScreener.quickAnalyze(body.code, body.name, false, klineData, body.mainForceInflow);
      if (!opp) {
        opp = await this.gemScreener.quickAnalyze(body.code, body.name, true, klineData, body.mainForceInflow);
      }
      if (opp) {
        // 缓存分析结果（下次同日期扫描直接跳过，省去80行CPU密集计算）
        this.gemScreener.setAnalysisCache(body.code, opp, klineData);
        // 应用信号重算，与机会列表保持一致
        this.gemScreener.recalculateSuggestions([opp]);
        // 写回缓存，机会列表自动同步
        this.gemScreener.updateSingleStockInCache(opp).catch(e => this.logger.warn(`更新缓存失败: ${e.message}`));
        return { code: 200, msg: 'success', data: [opp] };
      }
      // 即使分析失败也尝试用空信号更新缓存（避免旧数据残留）
      const fallbackOpp = { code: body.code, name: body.name || '', suggestion: '持有', score: 0, entryTiming: 0, currentPrice: 0, changePercent: 0, pricePosition: 0, priceIncrease: 0, mainForceInflow: 0, baiXiaoDays: 0, capitalRank: 0, safetyScore: 0 };
      this.gemScreener.updateSingleStockInCache(fallbackOpp).catch(() => {});
      return { code: 200, msg: '分析完成', data: [{ code: body.code, name: body.name || '', suggestion: '持有', score: 0 }] };
    } catch (e) {
      this.logger.error(`K线分析失败: ${(e as Error).message}`);
      return { code: 500, msg: `K线分析失败: ${e.message}`, data: null };
    }
  }

  @Post('analyze-batch')
  @SkipAccessLimit()
  async analyzeBatch(@Body() body: { stocks: Array<{ code: string; name?: string; kline: any[]; price?: number; changePercent?: number; gapPercent?: number }>; force?: boolean }) {
    const stocks = body.stocks || [];
    if (stocks.length === 0) return { code: 200, msg: 'empty batch', data: [] };
    // ─── 已有扫描在进行中 → 直接跳过，不排队（防多人11:30/15:00同时触发） ───
    if (this._analyzeBusy) {
      this.logger.warn(`⏳ analyze-batch 跳过：已有扫描在进行中`);
      return { code: 200, msg: '扫描正在进行中，请稍候...', data: null };
    }
    this._analyzeBusy = true; // 锁住，后续请求排队
    try {
      const results: any[] = [];
      // force=true → 跳过分析缓存，强制完整分析（用于11:30/15:00全量重算）
      this._forceMode = body.force === true;
      if (this._forceMode) this.logger.log('🔁 强制完整分析模式（跳过缓存）');
    // 3并发处理，0.1CPU下需要实测是否卡崩
    // 每60只让出事件循环一次，让其他HTTP请求能插队
    let done = 0;
    while (done < stocks.length) {
      const batch = stocks.slice(done, done + 3);
      done += 3;
      await Promise.all(batch.map(async (s) => {
        try {
          const r = await this.analyzeWithKLine({
            code: s.code, name: s.name,
            kline: s.kline, price: s.price,
            changePercent: s.changePercent,
          });
          if (r?.data) results.push(...r.data);
        } catch (e) {
          this.logger.warn(`[analyze-batch] ${s.code} 分析失败: ${(e as Error).message}`);
        }
      }));
      // 每批（3只）就让出一次事件循环，其他用户请求不超时502
    }
    const wasForced = this._forceMode;
    this._forceMode = false; // 恢复缓存模式
    // 仅强制扫描（11:30/15:00）才持久化K线+分析缓存到磁盘，避免 OOM
    // 轻量扫描只更新内存，磁盘缓存由强制扫描统一写入
    if (wasForced) {
      // 批次结束时统一持久化K线缓存到磁盘（一次性写入，避免竞争条件）
      if (this.klineProxyCache.size > 0) {
        const mapForPersist = new Map<string, { data: any[]; ts: number }>();
        for (const [k, v] of this.klineProxyCache) {
          if (v?.data?.length >= 5) mapForPersist.set(k, { data: v.data, ts: v.timestamp });
        }
        await this.gemScreener.persistFullKlineCache(mapForPersist);
      }
      // 仅15:00收盘后强制扫描才写到PG（10分钟扫描不写PG，减少无谓写入）
      if (wasForced) {
        const h = new Date().getHours(), m = new Date().getMinutes();
        if (h >= 14 && m >= 55) {
          // 15:00附近 → 从腾讯重新拉取120根完整K线（确认最后收盘数据）→ 写入PG
          this.logger.log('📦 15:00 收盘后重新拉取完整120根K线，准备写入PG...');
          let refreshed = 0;
          const pgMap = new Map<string, { data: any[]; ts: number }>();
          for (const [code] of this.klineProxyCache) {
            try {
              const fresh = await this._fetchTencentKline(code, 120);
              if (fresh && fresh.length >= 10) {
                pgMap.set(code, { data: fresh, ts: Date.now() });
                this.klineProxyCache.set(code, { data: fresh, timestamp: Date.now() });
                refreshed++;
                if (refreshed % 20 === 0) await new Promise(r => setTimeout(r, 0));
              }
            } catch {}
          }
          this.logger.log(`📦 15:00 收盘K线写入PG: ${refreshed}只`);
          if (pgMap.size > 0) await this.gemScreener.saveKlineCacheToPg(pgMap);
        } else {
          this.logger.log('📦 11:30 强制扫描完成，K线存磁盘跳过PG（留到15:00统一写PG）');
        }
      }
      // 持久化分析结果缓存到磁盘（下次扫描直接返回，省去80行CPU密集计算）
      await this.gemScreener.saveAnalysisCache();
    }
    return { code: 200, msg: `batch完成 ${results.length} 只`, data: results };
    } catch (e) {
      this.logger.error(`[analyze-batch] 异常: ${(e as Error).message}`);
      return { code: 500, msg: `分析失败: ${(e as Error).message}`, data: null };
    } finally {
      // ─── 释放锁 ───
      this._analyzeBusy = false;
    }
  }

  @Post('intraday-analyze')
  @SkipAccessLimit()
  async intradayAnalyze(@Body() body: { code: string; kline: any[]; price?: number }) {
    if (!body.code) return { code: 400, msg: '缺少股票代码' };
    if (!body.kline || !Array.isArray(body.kline) || body.kline.length < 5) {
      return { code: 200, msg: '分钟K线数据不足（需≥5条）', data: { status: '数据不足', reason: '分钟K线数据不足5条', currentPrice: body.price || 0, suggestions: [] } };
    }
    try {
      const result = await this.gemScreener.doIntradayAnalysis(body.code, body.kline);
      return { code: 200, msg: 'success', data: result };
    } catch (e) {
      this.logger.error(`日内分析失败: ${(e as Error).message}`);
      return { code: 500, msg: `日内分析失败: ${e.message}`, data: null };
    }
  }


  @Get('backtest')
  @SkipAccessLimit()
  async backtest() {
    try {
      const result = await this.gemScreener.runBacktest();
      return { code: 200, msg: 'success', data: result };
    } catch (e) {
      return { code: 500, msg: e.message };
    }
  }

  @Get('backtest-forecast')
  @SkipAccessLimit()
  async backtestForecast() {
    try {
      const result = await this.gemScreener.runForecastBacktest();
      return { code: 200, msg: 'success', data: result };
    } catch (e) {
      return { code: 500, msg: e.message };
    }
  }

  @Get('clear-cache')
  @SkipAccessLimit()
  async clearCache() {
    this.gemScreener.clearCache();
    return { code: 200, msg: '缓存已清空，可重新搜索或扫描覆盖' };
  }

  /**
   * 技术指标分析：MACD/KDJ/布林带/RSI/量比 → 最佳介入价
   * GET /api/gem/technical-analysis?code=300750
   */
  @Get('technical-analysis')
  @SkipAccessLimit()
  async technicalAnalysis(@Query('code') code: string) {
    if (!code) return { code: 400, msg: '缺少股票代码', data: null };
    try {
      const result = await this.gemScreener.technicalAnalysis(code);
      return { code: 200, msg: 'success', data: result };
    } catch (e) {
      this.logger.warn(`技术指标分析失败 ${code}: ${(e as Error).message}`);
      return { code: 500, msg: e.message, data: null };
    }
  }

  /**
   * 日内介入参考：分时MACD(40,120,40) + 主力/散户指标 → 最佳买卖点
   * GET /api/gem/intraday-analysis?code=603200
   */
  @Get('intraday-analysis')
  @SkipAccessLimit()
  async intradayAnalysis(@Query('code') code: string) {
    if (!code) return { code: 400, msg: '缺少股票代码', data: null };
    try {
      const result = await this.gemScreener.intradayAnalysis(code);
      return { code: 200, msg: 'success', data: result };
    } catch (e) {
      this.logger.warn(`日内分析失败 ${code}: ${(e as Error).message}`);
      return { code: 500, msg: e.message, data: null };
    }
  }

  /**
   * 集合竞价走势数据（9:15-9:25 tick级价位曲线）
   * GET /api/gem/auction-trend?code=603200
   */
  @Get('auction-trend')
  @SkipAccessLimit()
  async auctionTrend(@Query('code') code: string) {
    if (!code) return { code: 400, msg: '缺少股票代码', data: null };
    try {
      const data = await this.gemScreener.fetchAuctionTrend(code);
      return { code: 200, msg: 'success', data };
    } catch (e) {
      this.logger.warn(`获取竞价走势失败 ${code}: ${(e as Error).message}`);
      return { code: 500, msg: e.message, data: null };
    }
  }
}