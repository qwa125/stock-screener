import { Controller, Get, Post, Body, Query, HttpCode, Logger } from '@nestjs/common';
import { SkipAccessLimit } from '@/guards/access-limit.guard';
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
  @SkipAccessLimit()
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


  @Post('refresh-heavy-buy')
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

  
  /**
   * 合并主板+创业板最优前20: 按信号优先级(重仓买入>买入>轻仓买入)排序
   * GET /api/gem/top/combined
   */
  @Get('top/combined')
  async getCombinedTop(@Query('force') force?: string) {
    const [gemResult, mainResult] = await Promise.all([
      this.gemScreener.scanTopGem(force === 'true'),
      this.gemScreener.scanTopMainBoard(force === 'true'),
    ]);
    // 合并并合并重仓买入
    const heavyBuyAll = this.readHeavyBuyCache();
    const gemMerged = this.mergeWithHeavyBuy(gemResult.opportunities, heavyBuyAll.filter(s => s.code && (s.code.startsWith('300') || s.code.startsWith('301'))));
    const mainMerged = this.mergeWithHeavyBuy(mainResult.opportunities, heavyBuyAll.filter(s => s.code && !s.code.startsWith('30')));
    // 合并并去重（同一只股票可能同时出现在两个缓存中）
    const all = [...gemMerged, ...mainMerged];
    const seen = new Set<string>();
    const deduped = all.filter(s => { if (seen.has(s.code)) return false; seen.add(s.code); return true; });
    // 按信号排序: 重仓买入 > 买入 > 轻仓买入 > 持有 > 观望
    // 同信号内按入场时机(高→低)排序，再按主力资金流入(高→低)排序
    const signalOrder: Record<string, number> = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '观望': 4 };
    const sorted = deduped
      .filter(s => s.suggestion && ['重仓买入', '买入', '轻仓买入', '持有', '观望'].includes(s.suggestion))
      .sort((a, b) => {
        const ao = signalOrder[a.suggestion] ?? 9;
        const bo = signalOrder[b.suggestion] ?? 9;
        if (ao !== bo) return ao - bo;
        // 第二排序：入场时机(高→低)
        const entryA = a.entryTiming ?? 0;
        const entryB = b.entryTiming ?? 0;
        if (entryB !== entryA) return entryB - entryA;
        // 第三排序：主力资金流入(高→低)
        const mfA = a.mainForceInflow ?? 0;
        const mfB = b.mainForceInflow ?? 0;
        return mfB - mfA;
      })
      .slice(0, 20);
    // 给每只个股补充筹码字段（兼容旧缓存缺失场景）
    for (const s of sorted) {
      if (s.chipConcentration90 === undefined) {
        s.chipConcentration90 = 50;
        s.chipPeakPosition = 'mid';
        s.chipPattern = 'dispersed';
      }
      if (s.signalCombination === undefined) s.signalCombination = '';
      if (s.jiGouActiveScore === undefined) s.jiGouActiveScore = 0;
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
            return data.data.map(s => ({ ...s, suggestion: '重仓买入', suggestText: '🔥 重仓买入' }));
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

  /**
   * 全市场搜索(含股票/ETF/可转债)，实时获取K线分析
   * GET /api/gem/search?q=300052 or ?q=中青宝
   */
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

  @Get('rescan')
  @SkipAccessLimit()
  async rescanMarket() {
    try {
      const results = await this.gemScreener.rescanMarket();
      return { code: 200, msg: 'ok', data: results };
    } catch (e) {
      this.logger.error(`重扫失败: ${e.message}`);
      return { code: 500, msg: e.message, data: [] };
    }
  }

  @Post('refresh-all')
  @HttpCode(200)
  async refreshAll(@Body() body: { stocks: any[] }) {
    const opportunities = await this.gemScreener.scanAllWithFrontendData(body.stocks);
    return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
  }

  @Post('rescan-batch')
  @HttpCode(200)
  async rescanBatch(@Body() body: { codes: string[]; names?: string[] }) {
    if (!body.codes || !body.codes.length) {
      return { code: 400, msg: '请提供股票代码列表', data: [] };
    }
    this.logger.log(`批量分析: ${body.codes.length} 只股票`);
    const results: any[] = [];
    // 顺序分析，每只带超时（从Render到中国API不稳定，超时快速跳过）
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
    // 按信号排序
    const PRIORITY: Record<string, number> = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '观望': 4 };
    results.sort((a, b) => {
      const pa = PRIORITY[a.suggestion || '观望'] ?? 9;
      const pb = PRIORITY[b.suggestion || '观望'] ?? 9;
      if (pa !== pb) return pa - pb;
      return (b.score || 0) - (a.score || 0);
    });
    this.logger.log(`批量分析完成: ${results.length} 只有效结果`);
    return { code: 200, msg: 'ok', data: results.slice(0, 20) };
  }

  /**
   * 代理新浪全市场股票列表（解决前端跨域问题）
   * GET /api/gem/proxy/stock-list?node=cyb&page=1&num=80&sort=changepercent
   * node: cyb(创业板) / hs_a(沪深A股主板) / gem(创业板)
   * sort: changepercent(涨跌幅) / amount(成交额) / price(股价) / turnover(换手率) — 默认 amount
   * asc: 0(降序) / 1(升序) — 默认 0(降序)
   */
  @Get('proxy/stock-list')
  async proxyStockList(
    @Query('node') node: string,
    @Query('page') page: string,
    @Query('num') num: string,
    @Query('sort') sort?: string,
    @Query('asc') asc?: string,
  ) {
    try {
      const nodes = ['hs_a', 'cyb', 'gem'];
      const safeNode = node && nodes.includes(node) ? node : 'hs_a';
      const safePage = parseInt(page || '1', 10);
      const safeNum = Math.min(parseInt(num || '80', 10), 100);
      const safeSort = sort || 'amount';
      const safeAsc = asc || '0';
      const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${safePage}&num=${safeNum}&sort=${safeSort}&asc=${safeAsc}&node=${safeNode}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = []; }
      return { code: 200, msg: 'success', data };
    } catch (e) {
      this.logger.error(`代理新浪股票列表失败: ${(e as Error).message}`);
      return { code: 500, msg: '新浪API请求失败', data: [] };
    }
  }

  /**
   * 代理东方财富全市场股票列表（涨跌幅排序）
   * GET /api/gem/proxy/eastmoney-list?node=hs_a&page=1&num=100
   * node: hs_a(主板) / cyb(创业板) / gem(创业板)
   */
  @Get('proxy/eastmoney-list')
  async proxyEastMoneyList(
    @Query('node') node: string,
    @Query('page') page: string,
    @Query('num') num: string,
  ) {
    try {
      const fsMap: Record<string, string> = {
        hs_a: 'm:0+t:6',       // 纯沪深主板（不再混创业板）
        cyb: 'm:0+t:80',       // 创业板+科创板
        gem: 'm:0+t:80',
        all: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81', // 全市场（沪主板+科创板+深主板+中小板+创业板）
      };
      const safeNode = node && fsMap[node] ? node : 'hs_a';
      const safePage = parseInt(page || '1', 10);
      const safeNum = Math.min(parseInt(num || '100', 10), safeNode === 'all' ? 5000 : 200);
      const url = `https://push2.eastmoney.com/api/qt/clist/get?fltt=2&fields=f12,f14,f2,f3,f62,f184,f15,f16,f17,f18,f20&pn=${safePage}&pz=${safeNum}&po=1&np=1&fid=f3&fs=${fsMap[safeNode]}&ut=bd1d9ddb04089700cf9c27f6f7426281`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://quote.eastmoney.com/',
        },
      });
      const json = await resp.json();
      const data = (json?.data?.diff || []).map((item: any) => ({
        symbol: String(item.f12 || ''),
        name: item.f14 || '',
        trade: item.f2,
        changePercent: item.f3,
        inflow: item.f62,          // 主力净流入
        inflowAmount: item.f184,   // 流入总额
        high: item.f15,
        low: item.f16,
        open: item.f17,
        prevClose: item.f18,
        marketCap: item.f20,       // 总市值
      }));
      return { code: 200, msg: 'success', data };
    } catch (e) {
      this.logger.error(`代理东方财富列表失败: ${(e as Error).message}`);
      return { code: 500, msg: '东方财富API请求失败', data: [] };
    }
  }

  /**
   * 代理东方财富搜索API - 支持名称和代码搜索全A股
   * GET /api/gem/proxy/search?q=朗科科技
   */
  @Get('proxy/search')
  async proxySearch(@Query('q') query: string) {
    if (!query || !query.trim()) {
      return { code: 400, msg: '缺少搜索关键词' };
    }
    try {
      const url = `https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query.trim())}&type=14&token=D43BF722C8E14A9C61B0D6E303FC9C19`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await resp.json();
      const results = data?.QuotationCodeTable?.Data || [];
      return { code: 200, msg: 'success', data: results };
    } catch (e) {
      this.logger.error(`代理搜索失败: ${(e as Error).message}`);
      return { code: 500, msg: '搜索请求失败', data: [] };
    }
  }

  /**
   * 代理新浪美股/港股实时行情（解决前端跨域问题）
   * GET /api/gem/proxy/sina-us?code=aapl
   */
  @Get('proxy/sina-us')
  async proxySinaUS(@Query('code') code: string) {
    if (!code || !code.trim()) {
      return { code: 400, msg: '缺少股票代码' };
    }
    try {
      const url = `https://hq.sinajs.cn/list=gb_${encodeURIComponent(code.trim().toLowerCase())}`;
      const resp = await fetch(url, {
        headers: { Referer: 'https://finance.sina.com.cn' },
        signal: AbortSignal.timeout(10000)
      });
      const buf = await resp.arrayBuffer();
      const txt = new TextDecoder('gb18030').decode(buf);
      return { code: 200, msg: 'success', data: txt };
    } catch (e) {
      this.logger.error(`代理新浪美股失败: ${(e as Error).message}`);
      return { code: 500, msg: '新浪美股API请求失败', data: '' };
    }
  }

  @Post('analyze')
  async analyzeWithKLine(@Body() body: { code: string; name?: string; kline: any[]; mainForceInflow?: number }) {
    if (!body.code || !body.kline || !Array.isArray(body.kline)) {
      return { code: 400, msg: '缺少股票代码或K线数据' };
    }
    try {
      // 转换K线数据格式（Sina API返回day字段，quickAnalyze需要date字段）
      const klineData = body.kline.map((item: any) => ({
        date: item.day || item.date,
        open: parseFloat(item.open) || 0,
        close: parseFloat(item.close) || 0,
        high: parseFloat(item.high) || 0,
        low: parseFloat(item.low) || 0,
        volume: parseFloat(item.volume) || 0,
        amount: item.amount || 0,
      }));
      let opp = await this.gemScreener.quickAnalyze(body.code, body.name, false, klineData, body.mainForceInflow);
      if (!opp) {
        opp = await this.gemScreener.quickAnalyze(body.code, body.name, true, klineData, body.mainForceInflow);
      }
      if (opp) {
        return { code: 200, msg: 'success', data: [opp] };
      }
      return { code: 200, msg: '分析完成但无有效信号', data: [] };
    } catch (e) {
      this.logger.error(`K线分析失败: ${(e as Error).message}`);
      return { code: 500, msg: '分析失败', data: [] };
    }
  }

}