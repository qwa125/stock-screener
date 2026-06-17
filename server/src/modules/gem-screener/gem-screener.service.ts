import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { calcBaiXing } from '../stock/bai-xing';
import { FormulaEngine } from '../stock/formula-engine';
import { calcBaiSanJiao } from '../stock/bai-san-jiao';
import { calcBaiLingXing } from '../stock/bai-ling-xing';
import { calcXingXing } from '../stock/xing-xing';
import { promises as fs, existsSync, readFileSync } from 'fs';
import { join } from 'node:path';
import * as iconv from 'iconv-lite';
import { DataFetcherService } from '../stock/data-fetcher.service';
import { StockService } from '../stock/stock.service';
import { KLine } from '../stock/types';
import { isMarketOpen, isTradingDay } from '../../utils/market-time';
import { getTradingSuggestion } from '../../utils/trading-suggestion';
import INDUSTRY_SECTORS, { CONCEPT_SECTORS } from '../../industry-sectors/data';

// 合并申万行业 + 热点概念板块
const ALL_SECTORS = [...INDUSTRY_SECTORS, ...CONCEPT_SECTORS];

interface CacheEntry {
  data: OpportunityStock[];
  timestamp: number;
}

/** 交易时段缓存TTL：5分钟 */
const MARKET_OPEN_TTL = 5 * 60 * 1000;
/** 盘后/休息缓存TTL：冻结（365天） */
const FROZEN_TTL = 365 * 24 * 60 * 60 * 1000;

/** 根据当前时间获取合适的缓存TTL */
function getOpportunityTTL(): number {
  return isMarketOpen() ? MARKET_OPEN_TTL : FROZEN_TTL;
}

export interface StockCandidate {
  code: string;
  name: string;
  inflow: number;
  changePercent: number;
  currentPrice: number;
  marketCap?: number;
}

export interface OpportunityStock {
  capitalRank: number;
  code: string;
  name: string;
  mainForceInflow: number;
  baiXiaoDays: number;
  buySignal?: string;
  currentPrice: number;
  changePercent: number;
  pricePosition: number;
  priceIncrease: number;
  score: number;
  diff?: number;
  dea?: number;
  isGoldenCross?: boolean;
  /** 服务端计算的交易建议，与详情页完全一致 */
  suggestion?: string;
  /** 最佳介入时机评分 (0-100)，越高越好 */
  entryTiming: number;
  /** 安全系数评分 (0-100)，越高越安全 */
  safetyScore: number;
}

@Injectable()
export class GemScreenerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GemScreenerService.name);
  private readonly CACHE_TTL = 3 * 60 * 1000;
  private readonly STALE_TTL = 30 * 60 * 1000;
  private readonly REFRESH_INTERVAL = 5 * 60 * 1000; // 盘中每5分钟全量扫描
  private readonly CACHE_FILE = '/tmp/gem-opportunities-cache.json';
  private readonly BUNDLED_GEM_CACHE = join(__dirname, '..', '..', '..', 'assets', 'gem-cache.json');
  private readonly BATCH_SIZE = 20;
  private readonly POSITION_THRESHOLD = 92;
  private readonly RELAXED_POSITION = 90;
  // Tencent API 批量查询 GEM 股票 (替代被屏蔽的 EastMoney push2)
  private readonly TENANT_BATCH = 500;       // 每批查询数
  private readonly MIN_GAIN_PCT = 0.3;
  private readonly MAX_MARKET_CAP = 500_0000_0000; // 500亿, 排除超大市值
  private readonly MIN_MARKET_CAP = 20_0000_0000;  // 20亿, 排除小盘庄股
  /** 建议优先级: 越小越优先 */
  private readonly SUGGESTION_PRIORITY: Record<string, number> = {
    '重仓买入': 1, '买入': 2, '轻仓买入': 3, '准备买入': 4,
    '持有': 5, '减仓': 6, '观望': 7, '卖出': 8, '清仓': 9, '不要介入': 10,
  };

  private cache: CacheEntry | null = null;
  private refreshPromise: Promise<void> | null = null;
  private mainBoardCache: CacheEntry | null = null;
  private mainBoardRefreshPromise: Promise<void> | null = null;
  private sectorCache: CacheEntry | null = null;
  private readonly MAIN_BOARD_CACHE = '/tmp/main-board-opportunities-cache.json';
  private readonly BUNDLED_MAIN_BOARD_CACHE = join(__dirname, '..', '..', '..', 'assets', 'main-board-cache.json');
  private readonly SECTOR_CACHE = '/tmp/sector-opportunities-cache.json';
  private readonly BUNDLED_SECTOR_CACHE = join(__dirname, '..', '..', '..', 'assets', 'sector-cache.json');

  // 扫描排班 / 交叠保留
  private prevGEMResults: OpportunityStock[] = [];       // 上一次GEM扫描结果 (用于5分钟交叠)
  private prevMainBoardResults: OpportunityStock[] = []; // 上一次主板扫描结果
  private lastScanAt: number = 0;                        // 最近一次全量扫描时间戳
  private readonly SCAN_INTERVAL = 5 * 60 * 1000;        // 5分钟间隔
  private marketHoursBeganAt: number = 0;                // 本交易日 9:15 时间戳

  constructor(
    private readonly dataFetcher: DataFetcherService,
    private readonly stockService: StockService,
  ) {
    this.updateMarketHoursBeganAt();
    this.loadCacheFromDisk();
    this.loadMainBoardCacheFromDisk();
    this.loadSectorCacheFromDisk();
  }

  // ---------------------------------------------------------------------------
  // 扫描排班: 判断当前处于"冻结时段"还是"盘中时段"
  // ---------------------------------------------------------------------------
  private isFrozenSchedule(): boolean {
    const now = new Date();
    const dow = now.getDay();                // 0=Sun,6=Sat
    if (dow === 0 || dow === 6) return true; // 周末全天冻结
    const t = now.getHours() * 60 + now.getMinutes();
    // 15:00(900) ~ 次日 9:15(555) → 冻结
    return t >= 900 || t < 555;
  }

  private updateMarketHoursBeganAt(): void {
    const now = new Date();
    const today915 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 15, 0, 0);
    if (now.getTime() >= today915.getTime() && now.getHours() * 60 + now.getMinutes() < 900) {
      // 当前在盘中时段, 记录本日9:15
      this.marketHoursBeganAt = today915.getTime();
    } else {
      // 当前不在盘中时段, 置0
      this.marketHoursBeganAt = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // 启动时从磁盘加载上次缓存, 确保首页秒开
  // ---------------------------------------------------------------------------
  private loadCacheFromDisk() {
    try {
      const raw = readFileSync(this.CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data && Array.isArray(parsed.data)) {
        const limitedData = parsed.data.slice(0, 10);
        this.cache = { ...parsed, data: limitedData };
        this.logger.log(`📦 创业板加载缓存成功, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleTimeString()}`);
        return;
      }
    } catch {
      this.logger.log('📦 无创业板本地缓存');
    }
    // 回退：从部署包内置 assets/gem-cache.json 恢复（首次部署用）
    try {
      if (existsSync(this.BUNDLED_GEM_CACHE)) {
        const raw = readFileSync(this.BUNDLED_GEM_CACHE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.data && Array.isArray(parsed.data)) {
          const limitedData = parsed.data.slice(0, 10);
          this.cache = { ...parsed, data: limitedData };
          this.logger.log(`📦 从部署包恢复创业板缓存, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleString('zh-CN')}`);
        }
      }
    } catch (err) {
      this.logger.warn(`⚠️ 创业板部署包缓存加载失败: ${err.message}`);
    }
  }

  private loadMainBoardCacheFromDisk() {
    try {
      const raw = readFileSync(this.MAIN_BOARD_CACHE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data && Array.isArray(parsed.data)) {
        const limitedData = parsed.data.slice(0, 10);
        this.mainBoardCache = { ...parsed, data: limitedData };
        this.logger.log(`📦 主板加载缓存成功, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleTimeString()}`);
        return;
      }
    } catch {
      this.logger.log('📦 无主板本地缓存');
    }
    // 回退：从部署包内置 assets/main-board-cache.json 恢复（首次部署用）
    try {
      if (existsSync(this.BUNDLED_MAIN_BOARD_CACHE)) {
        const raw = readFileSync(this.BUNDLED_MAIN_BOARD_CACHE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.data && Array.isArray(parsed.data)) {
          const limitedData = parsed.data.slice(0, 10);
          this.mainBoardCache = { ...parsed, data: limitedData };
          this.logger.log(`📦 从部署包恢复主板缓存, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleString('zh-CN')}`);
        }
      }
    } catch (err) {
      this.logger.warn(`⚠️ 主板部署包缓存加载失败: ${err.message}`);
    }
  }

  private loadSectorCacheFromDisk() {
    try {
      const raw = readFileSync(this.SECTOR_CACHE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data && Array.isArray(parsed.data)) {
        const limitedData = parsed.data.slice(0, 10);
        this.sectorCache = { ...parsed, data: limitedData };
        this.logger.log(`📦 板块加载缓存成功, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleTimeString()}`);
        return;
      }
    } catch {
      this.logger.log('📦 无板块本地缓存');
    }
    // 回退：从部署包内置 assets/sector-cache.json 恢复
    try {
      if (existsSync(this.BUNDLED_SECTOR_CACHE)) {
        const raw = readFileSync(this.BUNDLED_SECTOR_CACHE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.data && Array.isArray(parsed.data)) {
          const limitedData = parsed.data.slice(0, 10);
          this.sectorCache = { ...parsed, data: limitedData };
          this.logger.log(`📦 从部署包恢复板块缓存, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleString('zh-CN')}`);
        }
      }
    } catch (err) {
      this.logger.warn(`⚠️ 板块部署包缓存加载失败: ${err.message}`);
    }
  }

  private async saveCacheToDisk() {
    try {
      await fs.writeFile(this.CACHE_FILE, JSON.stringify(this.cache), 'utf-8');
    } catch (err) {
      this.logger.warn(`⚠️ 缓存写入失败: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 公开 API
  // ---------------------------------------------------------------------------
  async getOpportunities(): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    // Render美国服务器调不通中国API(腾讯/东方财富)，不发起任何主动扫描
    // 仅返回磁盘缓存的旧数据，由前端浏览器从中国拉数据POST到 /api/gem/refresh
    if (this.cache) {
      this.triggerAnalysisPreCache(this.cache.data);
      return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
    }
    return { opportunities: [], timestamp: Date.now() };
  }

  private triggerRefresh() {
    // 盘后/周末不刷新, 保留收盘数据
    if (!isMarketOpen()) {
      if (this.cache) {
        this.logger.log(`⏸️ 盘后/周末模式, 跳过刷新 (缓存时间 ${new Date(this.cache.timestamp).toLocaleString()})`);
      }
      return;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshCache().finally(() => {
        this.refreshPromise = null;
      });
    }
  }

  private async refreshCache(): Promise<void> {
    try {
      this.logger.log('🔄 创业板机会扫描中...');
      // 保存前次结果用于交易时段的交叠保留
      const prevResults = this.cache?.data || [];
      const opportunities = await this.scanAllStocks();
      // 交易时段交叠保留: 新结果 ∩ 前次结果 (5分钟间隔扫描)
      let finalResults = opportunities;
      if (isMarketOpen() && prevResults.length > 0 && opportunities.length > 0) {
        const prevCodes = new Set(prevResults.map(s => s.code));
        const merged = opportunities.filter(s => prevCodes.has(s.code));
        if (merged.length > 0) {
          finalResults = merged;
          this.logger.log(`  🔄 交叠保留: ${merged.length}/${opportunities.length} 只`);
        } else {
          this.logger.log(`  🔄 无交叠, 使用最新 ${opportunities.length} 只`);
        }
      }
      if (finalResults.length > 0 || !this.cache) {
        this.cache = { data: finalResults, timestamp: Date.now() };
        this.saveCacheToDisk();
        this.logger.log(`✅ 创业板机会扫描完成, 最终 ${finalResults.length} 只`);
      } else {
        this.logger.log(`📊 扫描完成, 未找到符合条件的股票`);
        this.cache = { data: finalResults, timestamp: Date.now() };
        this.saveCacheToDisk();
      }
    } catch (err) {
      this.logger.error(`❌ 扫描失败: ${err.message}, 30秒后重试`);
      // 失败且缓存为空 → 30秒后重试
      if (!this.cache) {
        setTimeout(() => this.triggerRefresh(), 30000);
      }
    }
  }

  async onApplicationBootstrap() {
    // 不自动触发扫描——Render美国服务器调不通腾讯/东方财富API
    // 启动时仅加载磁盘缓存供前端展示，由前端浏览器从中国拉数据POST到refresh端点
    this.logger.log('📦 创业板: 启动跳过自动扫描, 等待前端推送数据触发引擎分析');
    // 主板机会区 - 尝试从磁盘恢复缓存，无缓存则触发扫描
    try {
      const raw = await fs.readFile(this.MAIN_BOARD_CACHE, 'utf-8');
      const parsed = JSON.parse(raw);
      this.mainBoardCache = { data: parsed.data, timestamp: parsed.timestamp };
      this.logger.log(`📦 主板机会区: 从磁盘恢复缓存, ${this.mainBoardCache.data.length} 只`);
    } catch { /* 首次部署, 无磁盘缓存 */ }
    if (!this.mainBoardCache || this.mainBoardCache.data.length === 0) {
      this.logger.log('📦 主板机会区: 无缓存, 等待前端推送数据');
    }
    // Render海外服务器上不启动预缓存分析（跳过腾讯API调用避免超时/崩溃）
    // 由用户前端页面访问时触发
  }

  // ---------------------------------------------------------------------------
  // 用户自定义 DIFF/DEA 公式
  // 均线 = (MA(C,3) + MA(C,5) + MA(C,8) + MA(C,13) + MA(C,21) + MA(C,34)*0.5) / 5.5
  // DEA = 均线;  DIFF = XMA(均线,5)*2 - 均线 - 修正值
  // ---------------------------------------------------------------------------
  calcCustomMACD(kline: KLine[]): {
    diff: number[];
    dea: number[];
    currentDiff: number;
    currentDea: number;
    isGoldenCross: boolean;
    goldenCrossDays: number;
    isDeathCross: boolean;
  } {
    const closes = kline.map(k => k.close);
    const len = closes.length;
    if (len < 35) {
      return { diff: [], dea: [], currentDiff: 0, currentDea: 0, isGoldenCross: false, goldenCrossDays: 0, isDeathCross: false };
    }

    // ---------- 均线 = (MA(C,3) + MA(C,5) + MA(C,8) + MA(C,13) + MA(C,21) + MA(C,34)*0.5) / 5.5 ----------
    const avgLine: number[] = [];
    for (let i = 33; i < len; i++) {
      const ma3  = closes.slice(i - 2,  i + 1).reduce((a, b) => a + b, 0) / 3;
      const ma5  = closes.slice(i - 4,  i + 1).reduce((a, b) => a + b, 0) / 5;
      const ma8  = closes.slice(i - 7,  i + 1).reduce((a, b) => a + b, 0) / 8;
      const ma13 = closes.slice(i - 12, i + 1).reduce((a, b) => a + b, 0) / 13;
      const ma21 = closes.slice(i - 20, i + 1).reduce((a, b) => a + b, 0) / 21;
      const ma34 = closes.slice(i - 33, i + 1).reduce((a, b) => a + b, 0) / 34;
      avgLine.push((ma3 + ma5 + ma8 + ma13 + ma21 + ma34 * 0.5) / 5.5);
    }

    // DEA = 均线
    const dea = [...avgLine];

    // XMA: 对均线做 5 日 EMA (平滑因子 2/(5+1) = 1/3)
    const xma: number[] = [];
    const initSum = avgLine.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    xma.push(initSum);
    for (let i = 1; i < avgLine.length; i++) {
      xma.push(avgLine[i] * (2 / 6) + xma[i - 1] * (4 / 6));
    }

    // DIFF = XMA * 2 - 均线 - 修正值
    const diff: number[] = [];
    for (let i = 0; i < avgLine.length; i++) {
      const klineIdx = i + 33; // avgLine[0] 对应 kline[33]
      const correction = this.calcCorrection(kline, klineIdx);
      diff.push(xma[i] * 2 - avgLine[i] - correction);
    }

    // ---------- 金叉检测 ----------
    const currentDiff = diff[diff.length - 1];
    const currentDea = dea[dea.length - 1];
    let isGoldenCross = false;
    let goldenCrossDays = 0;

    for (let i = diff.length - 1; i >= 1; i--) {
      if (diff[i] > dea[i]) {
        goldenCrossDays++;
        if (diff[i - 1] <= dea[i - 1]) {
          isGoldenCross = true;
          break;
        }
      } else {
        break;
      }
    }

    let isDeathCross = false;
    for (let i = diff.length - 1; i >= 1; i--) {
      if (diff[i] < dea[i]) {
        if (diff[i - 1] >= dea[i - 1]) {
          isDeathCross = true;
          break;
        }
      } else {
        break;
      }
    }

    return { diff, dea, currentDiff, currentDea, isGoldenCross, goldenCrossDays, isDeathCross };
  }

  /**
   * 用户自定义修正值（仅当日K线高开低走时计算）
   * 修正值 = 修正强度 * (H - L)
   */
  private calcCorrection(kline: KLine[], index: number): number {
    if (index === 0) return 0;
    const k = kline[index];
    const prev = kline[index - 1];
    if (!k || !prev) return 0;

    // 高开幅度 (%) = (open - prev_close) / prev_close * 100
    const openGapPct = ((k.open - prev.close) / prev.close) * 100;

    // 当日跌幅 (从开盘算, %) = (close - open) / open * 100
    const dailyChangePct = ((k.close - k.open) / k.open) * 100;

    // 仅在高开 > 0 且 收盘 < 开盘（高开低走）时计算修正
    if (openGapPct <= 0 || k.close >= k.open) return 0;

    let correctionStrength = 0;
    correctionStrength += openGapPct * 0.05 + Math.abs(dailyChangePct) * 0.1;

    // 放量比 > 1.2
    if (index >= 4) {
      const avgVol = kline.slice(index - 4, index + 1).reduce((a, b) => a + b.volume, 0) / 5;
      const volRatio = k.volume / avgVol;
      if (volRatio > 1.2) {
        correctionStrength += (volRatio - 1.2) * 0.25;
      }
    }

    // 振幅比 > 5
    const amplitude = ((k.high - k.low) / k.low) * 100;
    if (amplitude > 5) {
      correctionStrength += (amplitude - 5) * 0.02;
    }

    // 豁免：当日跌幅 >= 7% AND 缩量 (V < MA(V,5)*1.2)
    if (index >= 4) {
      const avgVol = kline.slice(index - 4, index + 1).reduce((a, b) => a + b.volume, 0) / 5;
      const dailyDropFromPrev = ((k.close - prev.close) / prev.close) * 100;
      if (dailyDropFromPrev <= -7 && k.volume < avgVol * 1.2) {
        correctionStrength = 0;
      }
    }

    correctionStrength = Math.min(correctionStrength, 0.5);

    // 修正值 = 修正强度 * (H - L)
    return correctionStrength * (k.high - k.low);
  }

  // ---------------------------------------------------------------------------
  // 扫描核心
  // ---------------------------------------------------------------------------
  private async scanAllStocks(): Promise<OpportunityStock[]> {
    const combined = await this.fetchGEMCandidates();

    if (combined.length === 0) {
      this.logger.warn('⚠️ 候选池为空, 无创业板股票数据 (腾讯行情无数据)');
      return [];
    }

    this.logger.log(`📊 候选池: ${combined.length} 只 (腾讯行情)`);

    combined.sort((a, b) => b.inflow - a.inflow);

    const results: OpportunityStock[] = [];
    for (let i = 0; i < combined.length; i += this.BATCH_SIZE) {
      const batch = combined.slice(i, i + this.BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(s => this.checkOpportunity(s).catch(() => null))
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
      if (results.length > 0 && i % 100 === 0) {
        this.logger.log(`  ✓ 已检查 ${Math.min(i + this.BATCH_SIZE, combined.length)}/${combined.length}`);
      }
    }

    // 如果结果太少 (<=3), 放宽位置门槛再扫一轮
    if (results.length <= 3) {
      this.logger.log(`  📊 结果较少(${results.length}), 放宽位置阈值至 ${this.RELAXED_POSITION} 再扫...`);
      for (let i = 0; i < combined.length; i += this.BATCH_SIZE) {
        const batch = combined.slice(i, i + this.BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(s => this.checkOpportunityRelaxed(s).catch(() => null))
        );
        for (const r of batchResults) {
          if (r && !results.find(ex => ex.code === r.code)) {
            results.push(r);
          }
        }
      }
    }

    // 主力资金由前端浏览器直连东方财富拉取（从海外服务器不稳）
    // this.enrichWithMainForceFlow(results);

    results.sort((a, b) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
          : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
          : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
          : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    const finalResults = results.slice(0, 10);
    // 后台预缓存分析结果（不阻塞）
    this.stockService.preCacheAnalysisBatch(finalResults.map(s => s.code)).catch(() => {});
    return finalResults;
  }

  /**
   * 接受前端从中国浏览器拉取的真实数据，执行规则引擎扫描
   * 用于解决 Render 美国服务器无法直接访问中国 API 的问题
   */
  async scanWithFrontendData(
    stocks: { code: string; name: string; price: number; changePercent: number; inflow: number; klines: KLine[] }[]
  ): Promise<OpportunityStock[]> {
    const results: OpportunityStock[] = [];
    // 预加载K线数据到缓存
    for (const s of stocks) {
      if (s.klines && s.klines.length >= 20) {
        this.dataFetcher.preloadKline(s.code, s.klines);
      }
    }
    // 逐只检查
    for (const s of stocks) {
      try {
        const candidate: StockCandidate = {
          code: s.code,
          name: s.name,
          inflow: s.inflow,
          changePercent: s.changePercent,
          currentPrice: s.price,
        };
        const result = await this.checkOpportunity(candidate);
        if (result) results.push(result);
      } catch {}
    }
    // 如果结果太少，放宽阈值再扫一轮
    if (results.length <= 3) {
      for (const s of stocks) {
        try {
          const candidate: StockCandidate = {
            code: s.code,
            name: s.name,
            inflow: s.inflow,
            changePercent: s.changePercent,
            currentPrice: s.price,
          };
          const result = await this.checkOpportunityRelaxed(candidate);
          if (result && !results.find(ex => ex.code === result.code)) {
            results.push(result);
          }
        } catch {}
      }
    }
    // 排序
    results.sort((a, b) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
          : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
          : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
          : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    // 合并累加缓存(分批推送时逐批累加)
    const existing = this.cache?.data || [];
    const merged = [...existing, ...results];
    const seen = new Set<string>();
    const deduped = merged.filter(r => { if (seen.has(r.code)) return false; seen.add(r.code); return true; });
    deduped.sort((a, b) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
          : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
          : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
          : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    const finalResults = deduped.slice(0, 10);
    this.cache = { data: finalResults, timestamp: Date.now() };
    this.saveCacheToDisk();
    this.logger.log(`✅ 前端数据扫描完成, 累加合并后 ${finalResults.length} 只`);
    return finalResults;
  }

  /**
   * 前端推送主板数据
   */
  async scanWithFrontendMainBoardData(
    stocks: { code: string; name: string; price: number; changePercent: number; inflow: number; klines: KLine[] }[]
  ): Promise<OpportunityStock[]> {
    const results: OpportunityStock[] = [];
    for (const s of stocks) {
      if (s.klines && s.klines.length >= 20) {
        this.dataFetcher.preloadKline(s.code, s.klines);
      }
    }
    for (const s of stocks) {
      try {
        const candidate: StockCandidate = {
          code: s.code, name: s.name, inflow: s.inflow,
          changePercent: s.changePercent, currentPrice: s.price,
        };
        const result = await this.checkOpportunity(candidate);
        if (result) results.push(result);
      } catch {}
    }
    if (results.length <= 3) {
      for (const s of stocks) {
        try {
          const candidate: StockCandidate = {
            code: s.code, name: s.name, inflow: s.inflow,
            changePercent: s.changePercent, currentPrice: s.price,
          };
          const result = await this.checkOpportunityRelaxed(candidate);
          if (result && !results.find(ex => ex.code === result.code)) results.push(result);
        } catch {}
      }
    }
    results.sort((a, b) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
        : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
        : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    const existingMain = this.mainBoardCache?.data || [];
    const mergedMain = [...existingMain, ...results];
    const seenMain = new Set<string>();
    const dedupedMain = mergedMain.filter(r => { if (seenMain.has(r.code)) return false; seenMain.add(r.code); return true; });
    dedupedMain.sort((a, b) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
        : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
        : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    const finalResults = dedupedMain.slice(0, 10);
    this.mainBoardCache = { data: finalResults, timestamp: Date.now() };
    this.saveMainBoardCacheToDisk();
    this.logger.log(`✅ 前端主板数据推送完成, 累加合并后 ${finalResults.length} 只`);
    return finalResults;
  }

  /**
   * 前端推送板块机会股数据
   */
  async scanWithFrontendSectorData(
    stocks: { code: string; name: string; sectorName: string; price?: number; changePercent?: number; inflow?: number; klines: KLine[] }[]
  ): Promise<OpportunityStock[]> {
    const results: OpportunityStock[] = [];
    for (const s of stocks) {
      if (s.klines && s.klines.length >= 20) {
        this.dataFetcher.preloadKline(s.code, s.klines);
      }
    }
    for (const s of stocks) {
      try {
        const candidate: StockCandidate = {
          code: s.code, name: s.name, inflow: s.inflow ?? 0,
          changePercent: s.changePercent ?? 0, currentPrice: s.price ?? 0,
        };
        const result = await this.checkOpportunity(candidate);
        if (result) {
          (result as any).sectorName = s.sectorName;
          results.push(result);
        }
      } catch {}
    }
    if (results.length <= 3) {
      for (const s of stocks) {
        try {
          const candidate: StockCandidate = {
            code: s.code, name: s.name, inflow: s.inflow ?? 0,
            changePercent: s.changePercent ?? 0, currentPrice: s.price ?? 0,
          };
          const result = await this.checkOpportunityRelaxed(candidate);
          if (result && !results.find(ex => ex.code === result.code)) {
            (result as any).sectorName = s.sectorName;
            results.push(result);
          }
        } catch {}
      }
    }
    results.sort((a, b) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
        : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
        : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    const existingSector = this.sectorCache?.data || [];
    const mergedSector = [...existingSector, ...results];
    const seenSector = new Set<string>();
    const dedupedSector = mergedSector.filter(r => { if (seenSector.has(r.code)) return false; seenSector.add(r.code); return true; });
    dedupedSector.sort((a, b) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
        : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
        : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    const finalResults = dedupedSector.slice(0, 10);
    this.sectorCache = { data: finalResults, timestamp: Date.now() };
    try { await fs.writeFile(this.SECTOR_CACHE, JSON.stringify(this.sectorCache)); } catch {}
    this.logger.log(`✅ 前端板块数据推送完成, 累加合并后 ${finalResults.length} 只`);
    return finalResults;
  }

  /**
   * 生成初始缓存种子文件到 server/assets/，供Render首次部署使用
   */  /**
   * 扫描全市场主板+创业板 → 筛选重仓买入级别
   */
  async scanWithFrontendHeavyBuyData(
    stocks: { code: string; name: string; price?: number; changePercent?: number; klines: KLine[] }[]
  ): Promise<OpportunityStock[]> {
    const results: any[] = [];
    // 预加载K线
    for (const s of stocks) {
      if (s.klines && s.klines.length >= 20) {
        this.dataFetcher.preloadKline(s.code, s.klines);
      }
    }
    for (const s of stocks) {
      try {
        const fullSuggestion = await this.computeFullSuggestion(s.code);
        if (fullSuggestion && fullSuggestion.suggestion === '重仓买入') {
          results.push(fullSuggestion);
        }
      } catch {}
    }
    // 排序：评分降序
    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const top = results.slice(0, 10);
    this.logger.log(`✅ 重仓买入分析完成: ${top.length} 只`);
    return top;
  }


  async generateSeedCache() {
    const assetDir = join(__dirname, '..', '..', '..', 'assets');
    this.logger.log(`📦 开始生成种子缓存到 ${assetDir}`);

    try {
      // 确保目录存在
      await fs.mkdir(assetDir, { recursive: true });

      // 先全量扫描获取最新数据
      this.logger.log('  ⏳ 正在全量扫描创业板...');
      try {
        await Promise.race([
          this['scanAllStocks'](),
          new Promise((_, rej) => setTimeout(() => rej(new Error('扫描超时')), 120000))
        ]);
      } catch (scanErr) {
        this.logger.warn(`  创业板扫描异常: ${scanErr.message}，使用当前缓存`);
      }

      this.logger.log('  ⏳ 正在扫描重仓买入...');
      try {
        await Promise.race([
          this['scanGlobalHeavyBuy'](),
          new Promise((_, rej) => setTimeout(() => rej(new Error('扫描超时')), 60000))
        ]);
      } catch (scanErr) {
        this.logger.warn(`  重仓买入扫描异常: ${scanErr.message}，使用当前缓存`);
      }

      // 更新GEM缓存时间戳
      if (this.cache) { this.cache.timestamp = Date.now(); }

      // 写入GEM缓存
      if (this.cache && this.cache.data?.length > 0) {
        const gemPath = join(assetDir, 'gem-cache.json');
        await fs.writeFile(gemPath, JSON.stringify(this.cache, null, 2));
        this.logger.log(`  ✅ GEM缓存: ${this.cache.data.length} 只`);
      }

      // 从/tmp读取其他缓存文件并写入assets（由其他服务维护）
      for (const [cacheFile, tmpFile] of [
        ['main-board-cache.json', 'main-board-opportunities-cache.json'],
        ['sector-cache.json', 'sector-opportunities-cache.json'],
        ['heavy-buy-cache.json', 'heavy-buy-cache.json'],
      ]) {
        const tmpPath = join('/tmp', tmpFile);
        try {
          const content = await fs.readFile(tmpPath, 'utf-8');
          const parsed = JSON.parse(content);
          parsed.timestamp = Date.now();
          await fs.writeFile(join(assetDir, cacheFile), JSON.stringify(parsed, null, 2));
          this.logger.log(`  ✅ ${cacheFile}: ${parsed.data?.length || 0} 只`);
        } catch {
          this.logger.warn(`  ⚠️ ${cacheFile} 跳过（无缓存文件）`);
        }
      }

      return { success: true, files: ['gem-cache.json', 'main-board-cache.json', 'sector-cache.json', 'heavy-buy-cache.json'] };
    } catch (err) {
      this.logger.error(`❌ 种子缓存生成失败: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ---------------------------------------------------------------------------
  // 东方财富主力资金净流入 (f62)
  // ---------------------------------------------------------------------------
  /**
   * 从东方财富批量拉取真实主力资金净流入数据，替换成交额近似值。
   * f62 = 主力净流入（元），正=净买入，负=净卖出
   */
  private async enrichWithMainForceFlow(results: OpportunityStock[]): Promise<void> {
    if (results.length === 0) return;

    // 分批请求 (东方财富一次最多约80只)
    const BATCH = 50;
    for (let i = 0; i < results.length; i += BATCH) {
      const batch = results.slice(i, i + BATCH);
      // 构建 secid: 6xxxxx → 1.code, 0xxxxx/3xxxxx → 0.code
      const secids = batch.map(r => {
        const mkt = r.code.startsWith('6') ? 1 : 0;
        return `${mkt}.${r.code}`;
      });

      const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids.join(',')}&fields=f12,f14,f62,f184`;

      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: 'https://quote.eastmoney.com/',
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          this.logger.warn(`⚠️ 东方财富主力资金API返回 ${res.status}`);
          continue;
        }

        const data = await res.json() as any;
        if (!data?.data?.diff) continue;

        for (const item of data.data.diff) {
          const code = String(item.f12);
          const mainForce = item.f62; // 主力净流入（元）
          if (mainForce !== undefined && mainForce !== null) {
            const target = results.find(r => r.code === code);
            if (target) {
              target.mainForceInflow = Math.round(mainForce);
            }
          }
        }
      } catch (err) {
        this.logger.warn(`⚠️ 东方财富主力资金获取失败: ${(err as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 个股检查 (严格)
  // ---------------------------------------------------------------------------
  async checkOpportunity(s: StockCandidate): Promise<OpportunityStock | null> {
    const kline = await this.dataFetcher.getKLineData(s.code);
    if (!kline || kline.length < 60) return null;

    const closeArr = kline.map(k => k.close);
    const len = closeArr.length;
    if (len < 35) return null;

    // ---------- 白消启动检测 ----------
    const klineO = kline.map(k => k.open);
    const klineH = kline.map(k => k.high);
    const klineL = kline.map(k => k.low);
    const klineV = kline.map(k => k.volume || 0);
    const klineAmt = kline.map(k => k.amount || 0);
    const engine = new FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: klineV, amount: klineAmt });
    const bx = calcBaiXing(engine);
    const isBaiXiaoActive = bx.baiXiao || bx.baiBu || false;
    const bxDays = bx.baiXiaoDays || 0;
    const isBaiXiaoBuy = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai);
    const hasQiangShiHuiCai = !!bx.qiangShiHuiCai;

    // ---------- MACD 检查: DIFF >= DEA（金叉/接近金叉/已金叉均放行）----------
    const macdResult = this.calcCustomMACD(kline);
    const isGoldenCross = macdResult.isGoldenCross;
    if (macdResult.currentDiff < macdResult.currentDea) return null;

    // 排除银行保险股
    const excludeKeywords = ['银行', '保险', '农商', '兴业银', '中国人寿', '中国平安', '中国人保', '中国太保', '新华保险'];
    for (const kw of excludeKeywords) {
      if (s.name.includes(kw)) return null;
    }

    // 排除ST股
    if (/^(\*)?ST/.test(s.name)) return null;

    const goldenCrossDays = macdResult.goldenCrossDays || 15;

    // ---------- 白消买点信号筛选 ----------
    const hasAnyBaiXiaoSignal = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai ||
      bx.diBuBuy || bx.gaoWeiHuiDiaoBuy || bx.zhuLiShiPan || bx.jiaCang);

    if (!hasAnyBaiXiaoSignal) return null;

    // ---------- 价格位置 ----------
    const highs = kline.map(k => k.high);
    const lows = kline.map(k => k.low);
    const periodHigh = Math.max(...highs.slice(-60));
    const periodLow = Math.min(...lows.slice(-60));
    const pricePosition = periodHigh > periodLow
      ? ((closeArr[len - 1] - periodLow) / (periodHigh - periodLow)) * 100
      : 50;

    const isLowPosition = pricePosition < 25;
    const hasStrongSignal = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.jiaCang);
    if (pricePosition >= this.POSITION_THRESHOLD && !isLowPosition && !hasStrongSignal) return null;

    // ---------- 涨幅检查 (仅金叉股限制涨幅过快) ----------
    const closeIdx = len - 1;
    const lookbackDays = Math.max(1, goldenCrossDays || 15);
    const triggerIdx = closeIdx - lookbackDays;
    const triggerClose = triggerIdx >= 0 ? kline[triggerIdx].close : kline[0].close;
    const currentClose = kline[closeIdx].close;
    const priceIncrease = ((currentClose - triggerClose) / triggerClose) * 100;
    if (isGoldenCross && priceIncrease > 25) return null;

    // ---------- 计算均线(用于评分/建议) ----------
    const ma5  = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;

    // ---------- 综合得分(按优先级: 活跃度 > 涨幅 > 最佳介入点) ----------
    const inflowScore = Math.min(s.inflow / 100000000, 1);
    const incScore = priceIncrease > 0 ? Math.min(priceIncrease / 15, 1) : 0;
    const positionScore = 1 - pricePosition / 100;
    const gcScore = isGoldenCross ? 0.4 : 0.15;
    const capScore = s.marketCap ? Math.max(0, 1 - Math.max(0, s.marketCap - 5_000_000_000) / 45_000_000_000) : 0.3;
    const score = inflowScore * 0.35 + incScore * 0.25 + positionScore * 0.20 + gcScore * 0.10 + capScore * 0.10;

    // ---------- 买点信号类型 ----------
    let buySignal = '';
    if (isBaiXiaoBuy && hasQiangShiHuiCai) {
      buySignal = '白消启动回踩';
    } else if (isBaiXiaoBuy) {
      buySignal = '白消启动突破';
    } else if (hasQiangShiHuiCai) {
      buySignal = '强势回踩';
    } else if (isBaiXiaoActive && bxDays >= 3) {
      buySignal = '白消蓄力';
    } else {
      buySignal = '突破上涨';
    }

    // ---------- 交易建议（与前端 getTradingSuggestion 逻辑保持一致）----------
    const macdBullishR = macdResult.currentDiff > macdResult.currentDea;
    let trendStateR = 1;
    if (ma5 > ma10 * 1.02 && ma10 > ma20 * 1.01) {
      trendStateR = 3;
    } else if (ma5 > ma10 && ma10 > ma20) {
      trendStateR = 2;
    } else if (ma5 <= ma10) {
      trendStateR = 0;
    }
    const trendStrengthR = ((ma5 / ma10 - 1) * 100);
    const avgVolR = klineV.slice(-30).reduce((a, b) => a + b, 0) / 30;
    const recentVolR = klineV.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const volumeBullishR = recentVolR > avgVolR * 1.1;
    const hasBuySignalR = isBaiXiaoBuy || hasQiangShiHuiCai;
    const longDeclineR = pricePosition < 20 && trendStrengthR < -1;

    // 增强买入信号（与 getTradingSuggestion 的 strongBuy 保持一致）
    const strongBuyR = (isGoldenCross && volumeBullishR) || (bxDays >= 3) || (bx.baiXiaoBuy1 && volumeBullishR);
    const strongSellR = !!(bx as any).strongSell;

    const zoneR = pricePosition < 25 ? '低位区' : pricePosition < 45 ? '中低位区' : pricePosition < 55 ? '中位区' : pricePosition < 75 ? '中高位区' : '高位区';

    let suggestionR = '观望';

    // ── 低位区 (<25%) ──
    if (zoneR.includes('低位')) {
      if (longDeclineR && trendStateR <= 1 && !macdBullishR && !volumeBullishR) {
        suggestionR = '不要介入';
      } else if (trendStateR >= 1 && strongBuyR) {
        suggestionR = '重仓买入';
      } else if (trendStateR >= 1 && hasBuySignalR) {
        suggestionR = '买入';
      } else if (trendStateR === 0 && strongBuyR) {
        suggestionR = '轻仓买入';
      } else if (trendStateR >= 1) {
        suggestionR = '持有';
      } else {
        suggestionR = '观望';
      }
    }
    // ── 中低位区 (25-45%) ──
    else if (zoneR.includes('中低位')) {
      if (trendStateR >= 2 && strongBuyR) {
        suggestionR = '买入';
      } else if (trendStateR >= 1 && strongBuyR) {
        suggestionR = '买入';
      } else if (trendStateR >= 2 && hasBuySignalR) {
        suggestionR = '轻仓买入';
      } else if (trendStateR >= 1 && hasBuySignalR) {
        suggestionR = '轻仓买入';
      } else if (trendStateR >= 2) {
        suggestionR = '持有';
      } else {
        suggestionR = '持有';
      }
    }
    // ── 中位区 (45-55%) ──
    else if (zoneR.includes('中位') && !zoneR.includes('低') && !zoneR.includes('高')) {
      if (trendStateR >= 2 && strongBuyR) {
        suggestionR = '买入';
      } else if (trendStateR >= 2 && hasBuySignalR) {
        suggestionR = '轻仓买入';
      } else if (trendStateR >= 2) {
        suggestionR = '持有';
      } else if (trendStateR === 1) {
        suggestionR = '持有';
      } else if (trendStateR === 0 && strongBuyR) {
        suggestionR = '持有';
      } else if (trendStateR === 0) {
        suggestionR = '减仓';
      }
    }
    // ── 中高位区 (55-75%) ──
    else if (zoneR.includes('中高位')) {
      if (trendStateR >= 2 && strongBuyR) {
        suggestionR = '轻仓买入';
      } else if (trendStateR >= 2) {
        suggestionR = '持有';
      } else if (trendStateR === 1 && strongBuyR) {
        suggestionR = '持有';
      } else if (trendStateR === 1) {
        suggestionR = '减仓';
      } else if (trendStateR === 0 && strongSellR) {
        suggestionR = '卖出';
      } else if (trendStateR === 0) {
        suggestionR = '减仓';
      }
    }
    // ── 高位区 (>=75%) ──
    else {
      if (trendStateR === 0 && strongSellR) {
        suggestionR = '清仓';
      } else if (trendStateR === 0) {
        suggestionR = '卖出';
      } else if (trendStateR === 1 && strongBuyR) {
        suggestionR = '持有';
      } else if (trendStateR === 1 && strongSellR) {
        suggestionR = '卖出';
      } else if (trendStateR === 1) {
        suggestionR = '减仓';
      } else if (trendStateR >= 2 && strongBuyR) {
        suggestionR = '轻仓买入';
      } else if (trendStateR >= 2) {
        suggestionR = '持有';
      }
    }

    // 排除负面建议
    const NEGATIVE_SUGGESTIONS = ['减仓', '卖出', '清仓', '不要介入'];
    if (NEGATIVE_SUGGESTIONS.includes(suggestionR)) return null;

    // ---------- 最佳介入时机评分 (entryTiming) ----------
    const entryTiming = this.calcEntryTiming(pricePosition, trendStateR, closeArr, klineH, klineL, klineV, isGoldenCross);
    // ---------- 安全系数评分 (safetyScore) ----------
    const safetyScore = this.calcSafetyScore(closeArr, klineH, klineL, klineV, pricePosition, trendStateR);

    return {
      capitalRank: 0,
      entryTiming: Math.round(entryTiming * 100) / 100,
      safetyScore: Math.round(safetyScore * 100) / 100,
      code: s.code,
      name: s.name,
      mainForceInflow: s.inflow,
      baiXiaoDays: bxDays,
      buySignal,
      currentPrice: s.currentPrice,
      changePercent: s.changePercent,
      pricePosition: Math.round(pricePosition * 100) / 100,
      priceIncrease: Math.round(priceIncrease * 100) / 100,
      score: Math.round(score * 100) / 100,
      diff: Math.round(macdResult.currentDiff * 10000) / 10000,
      dea: Math.round(macdResult.currentDea * 10000) / 10000,
      isGoldenCross,
      suggestion: suggestionR,
    };
  }
  async checkOpportunityRelaxed(s: StockCandidate): Promise<OpportunityStock | null> {
    const kline = await this.dataFetcher.getKLineData(s.code);
    if (!kline || kline.length < 60) return null;

    const closeArr = kline.map(k => k.close);
    const len = closeArr.length;
    if (len < 35) return null;

    // ---------- 白消启动检测 ----------
    const klineO = kline.map(k => k.open);
    const klineH = kline.map(k => k.high);
    const klineL = kline.map(k => k.low);
    const klineV = kline.map(k => k.volume || 0);
    const klineAmt = kline.map(k => k.amount || 0);
    const engine = new FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: klineV, amount: klineAmt });
    const bx = calcBaiXing(engine);
    const isBaiXiaoActive = bx.baiXiao || bx.baiBu || false;
    const bxDays = bx.baiXiaoDays || 0;
    const isBaiXiaoBuy = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai);
    const hasQiangShiHuiCai = !!bx.qiangShiHuiCai;

    // ---------- MACD 检查 (用户自定义公式) ----------
    const macdResult = this.calcCustomMACD(kline);

    const isGoldenCross = macdResult.isGoldenCross;
    const isApproaching = !isGoldenCross && macdResult.currentDiff > macdResult.currentDea * 0.95;
    if (!isGoldenCross && !isApproaching) return null;

    // 排除银行保险股
    const excludeKeywords = ['银行', '保险', '农商', '兴业银', '中国人寿', '中国平安', '中国人保', '中国太保', '新华保险'];
    for (const kw of excludeKeywords) {
      if (s.name.includes(kw)) return null;
    }

    // 排除ST股
    if (/^(\*)?ST/.test(s.name)) return null;

    const goldenCrossDays = isGoldenCross ? macdResult.goldenCrossDays : 1;

    // ---------- 趋势二次确认 ----------
    const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = len >= 20 ? closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;

    if (ma5 <= ma10 * 1.001) return null;

    if (len >= 8) {
      const ma5_3d = closeArr.slice(-8, -3).reduce((a, b) => a + b, 0) / 5;
      if (ma5 < ma5_3d) return null;
    }

    // MA10 斜率向上或走平
    if (len >= 15) {
      const ma10_5d = closeArr.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;
      if (ma10 <= ma10_5d) return null;
    }

    if (closeArr[len - 1] <= ma10) return null;

    // MA20 走平或向上
    if (len >= 30) {
      const ma20_10d = closeArr.slice(-30, -10).reduce((a, b) => a + b, 0) / 20;
      if (ma20 < ma20_10d) return null;
    }

    // ---------- 价格位置 (放宽) ----------
    const highs = kline.map(k => k.high);
    const lows = kline.map(k => k.low);
    const periodHigh = Math.max(...highs.slice(-60));
    const periodLow = Math.min(...lows.slice(-60));
    const pricePosition = periodHigh > periodLow
      ? ((closeArr[len - 1] - periodLow) / (periodHigh - periodLow)) * 100
      : 50;

    if (pricePosition >= this.RELAXED_POSITION) return null;

    // ---------- 涨幅检查 (对所有通过股票都计算, 仅金叉股限制涨幅过快) ----------
    let priceIncrease = 0;
    const lookbackDays = Math.max(1, isGoldenCross && goldenCrossDays > 1 ? goldenCrossDays : 15);
    const closeIdx = len - 1;
    const triggerIdx = closeIdx - lookbackDays;
    const triggerClose = triggerIdx >= 0 ? kline[triggerIdx].close : kline[0].close;
    const currentClose = kline[closeIdx].close;
    priceIncrease = ((currentClose - triggerClose) / triggerClose) * 100;
    if (isGoldenCross && priceIncrease > 25) return null;

    // ---------- 综合得分(按优先级: 活跃度 > 涨幅 > 最佳介入点) ----------
    const inflowScore = Math.min(s.inflow / 100000000, 1);
    const incScore = priceIncrease > 0 ? Math.min(priceIncrease / 15, 1) : 0;
    const positionScore = 1 - pricePosition / 100;
    const gcScore = isGoldenCross ? 0.4 : 0.15;
    const capScore = s.marketCap ? Math.max(0, 1 - Math.max(0, s.marketCap - 5_000_000_000) / 45_000_000_000) : 0.3;
    const score = inflowScore * 0.35 + incScore * 0.25 + positionScore * 0.20 + gcScore * 0.10 + capScore * 0.10;

    // ---------- 买点信号类型 ----------
    let buySignal = '';
    if (isBaiXiaoBuy && hasQiangShiHuiCai) {
      buySignal = '白消启动回踩';
    } else if (isBaiXiaoBuy) {
      buySignal = '白消启动';
    } else if (hasQiangShiHuiCai) {
      buySignal = '强势回踩';
    } else if (isBaiXiaoActive && bxDays >= 3) {
      buySignal = '白消蓄力';
    } else {
      buySignal = '突破上涨';
    }

    // ---------- 交易建议（与前端 getTradingSuggestion 逻辑保持一致）----------
    const macdBullishR = macdResult.currentDiff > macdResult.currentDea;

    let trendStateR = 1;
    if (ma5 > ma10 * 1.02 && ma10 > ma20 * 1.01) {
      trendStateR = 3;
    } else if (ma5 > ma10 && ma10 > ma20) {
      trendStateR = 2;
    }

    const trendStrengthR = ((ma5 / ma10 - 1) * 100);
    const avgVolR = klineV.slice(-30).reduce((a, b) => a + b, 0) / 30;
    const recentVolR = klineV.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const volumeBullishR = recentVolR > avgVolR * 1.1;

    const hasBuySignalR = isBaiXiaoBuy || hasQiangShiHuiCai;
    const longDeclineR = pricePosition < 20 && trendStrengthR < -1;

    const zoneR = pricePosition < 25 ? '低位区' : pricePosition < 45 ? '中低位区' : pricePosition < 55 ? '中位区' : pricePosition < 75 ? '中高位区' : '高位区';

    let suggestionR = '观望';
    if (zoneR.includes('高位')) {
      if (trendStateR === 0) suggestionR = hasBuySignalR ? '持有' : '清仓';
      else if (trendStateR === 1) suggestionR = hasBuySignalR && macdBullishR ? '持有' : (!macdBullishR ? '卖出' : '减仓');
      else suggestionR = hasBuySignalR ? '轻仓买入' : '持有';
    } else if (zoneR.includes('中高位')) {
      if (trendStateR === 0) suggestionR = hasBuySignalR ? '持有' : '减仓';
      else if (trendStateR >= 2) suggestionR = hasBuySignalR ? '轻仓买入' : '持有';
      else suggestionR = hasBuySignalR ? '持有' : '持有';
    } else if (zoneR.includes('中位') && !zoneR.includes('低') && !zoneR.includes('高')) {
      if (trendStateR >= 2) suggestionR = hasBuySignalR ? '买入' : '轻仓买入';
      else if (trendStateR === 0) suggestionR = hasBuySignalR ? '持有' : '减仓';
      else suggestionR = hasBuySignalR ? '持有' : '持有';
    } else if (zoneR.includes('中低位')) {
      if (trendStateR >= 2 && hasBuySignalR) suggestionR = '买入';
      else if (trendStateR >= 1 && hasBuySignalR) suggestionR = '轻仓买入';
      else if (trendStateR === 0 && hasBuySignalR) suggestionR = '持有';
      else suggestionR = '持有';
    } else {
      // 低位区: ma5刚上穿ma10(>=1) + 买点信号 = 重仓买入
      if (trendStateR >= 1 && hasBuySignalR) {
        suggestionR = '重仓买入';
      } else if (trendStateR === 0 && hasBuySignalR) {
        suggestionR = '轻仓买入';
      } else if (trendStateR >= 1 && !hasBuySignalR) {
        suggestionR = '买入';
      } else {
        suggestionR = '观望';
      }
    }

    // 排除负面建议：减仓/卖出/清仓/不要介入 → 不入机会区
    const NEGATIVE_SUGGESTIONS = ['减仓', '卖出', '清仓', '不要介入'];
    if (NEGATIVE_SUGGESTIONS.includes(suggestionR)) return null;

    // ---------- 最佳介入时机 + 安全系数 ----------
    const entryTiming = this.calcEntryTiming(pricePosition, trendStateR, closeArr, klineH, klineL, klineV, isGoldenCross);
    const safetyScore = this.calcSafetyScore(closeArr, klineH, klineL, klineV, pricePosition, trendStateR);

    return {
      capitalRank: 0,
      entryTiming: Math.round(entryTiming * 100) / 100,
      safetyScore: Math.round(safetyScore * 100) / 100,
      code: s.code,
      name: s.name,
      mainForceInflow: s.inflow,
      baiXiaoDays: bxDays,
      buySignal,
      currentPrice: s.currentPrice,
      changePercent: s.changePercent,
      pricePosition: Math.round(pricePosition * 100) / 100,
      priceIncrease: Math.round(priceIncrease * 100) / 100,
      score: Math.round(score * 100) / 100,
      diff: Math.round(macdResult.currentDiff * 10000) / 10000,
      dea: Math.round(macdResult.currentDea * 10000) / 10000,
      isGoldenCross,
      suggestion: suggestionR,
    };

  }

  // ===========================================================================
  // 最佳介入时机评分（Level 2 排序）
  // 核心逻辑:
  //   1. 回调后横盘蓄力→准备二波 (30-55%位置, 缩量横盘, MACD金叉) → 高分
  //   2. 高位强势→即将突破前高 (75%+位置, 趋势强劲, 即将创新高) → 高分
  //   3. 低位刚启动→趋势明确 (15-30%位置, 趋势初成) → 中高分
  // ===========================================================================
  private calcEntryTiming(
    pricePosition: number,
    trendState: number,
    closeArr: number[],
    highArr: number[],
    lowArr: number[],
    volumeArr: number[],
    macdGoldenCross: boolean,
  ): number {
    const len = closeArr.length;
    if (len < 10) return 50;

    let timing = 50;
    const currentPrice = closeArr[len - 1];

    // --- 场景1: 回调后横盘→准备第二波 (最有价值的买点) ---
    if (pricePosition >= 28 && pricePosition <= 55) {
      // 确认之前曾经有过一波上涨 (近60天有较高位置)
      const periodHigh60 = Math.max(...closeArr.slice(-60));
      const periodLow60 = Math.min(...closeArr.slice(-60));
      const prevDistanceFromHigh = (periodHigh60 - currentPrice) / (periodHigh60 - periodLow60 || 1);
      if (prevDistanceFromHigh > 0.3) {
        // 检测横盘(近10天波动率低)
        const recent10 = closeArr.slice(-10);
        const mean = recent10.reduce((a, b) => a + b, 0) / 10;
        const variance = recent10.reduce((sum, v) => sum + (v - mean) ** 2, 0) / 10;
        const std = Math.sqrt(variance);
        const volatility = std / mean;
        if (volatility < 0.025) {
          timing += 25; // 横盘确认
        }
        // 趋势转好
        if (trendState >= 2) timing += 15;
        if (macdGoldenCross) timing += 10;
        if (volatility < 0.025 && trendState >= 2) timing += 5; // 横盘+趋势=最佳
      }
    }

    // --- 场景2: 高位强势→即将突破前高 ---
    if (pricePosition >= 75 && trendState >= 2) {
      timing += 20;
      // 接近前高(近20天最高价的98%以上)
      const recentHigh20 = Math.max(...closeArr.slice(-20, -1));
      if (currentPrice >= recentHigh20 * 0.98) {
        timing += 15; // 即将突破
      }
      if (macdGoldenCross) timing += 10;
      if (trendState >= 3) timing += 5; // 强劲趋势
    }

    // --- 场景3: 中低位刚启动 ---
    if (pricePosition >= 15 && pricePosition < 28 && trendState >= 2) {
      timing += 15;
      if (macdGoldenCross) timing += 10;
      // 底部放量启动
      const avgVol30 = volumeArr.slice(-30).reduce((a, b) => a + b, 0) / 30;
      const recentVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
      if (recentVol5 > avgVol30 * 1.3) timing += 10;
    }

    return Math.min(Math.max(timing, 0), 100);
  }

  // ===========================================================================
  // 安全系数评分（Level 3 排序）
  // 核心逻辑:
  //   低波动(ATR小) + 近期无急涨(避免20cm冲高回落) + 趋势稳定 = 安全
  //   高波动(涨停板急拉) + 位置过高 + 急涨后放量滞涨 = 危险
  // ===========================================================================
  private calcSafetyScore(
    closeArr: number[],
    highArr: number[],
    lowArr: number[],
    volumeArr: number[],
    pricePosition: number,
    trendState: number,
  ): number {
    const len = closeArr.length;
    if (len < 20) return 50;

    let safety = 55; // 基准分

    // --- 1. 波动率检测 (核心安全指标) ---
    const recent20 = closeArr.slice(-20);
    const dailyReturns: number[] = [];
    for (let i = 1; i < recent20.length; i++) {
      dailyReturns.push((recent20[i] - recent20[i - 1]) / recent20[i - 1]);
    }
    const meanRet = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const varRet = dailyReturns.reduce((sum, v) => sum + (v - meanRet) ** 2, 0) / dailyReturns.length;
    const volStd = Math.sqrt(varRet);
    const annualizedVol = volStd * Math.sqrt(252);

    if (annualizedVol < 0.35) {
      safety += 20; // 低波动=非常安全
    } else if (annualizedVol < 0.50) {
      safety += 10; // 中等波动
    } else if (annualizedVol > 0.70) {
      safety -= 15; // 高波动=危险（容易暴涨暴跌）
    }

    // --- 2. 最近涨停/大阳线检测 (20cm风险) ---
    const lastReturn = Math.abs(dailyReturns[dailyReturns.length - 1] || 0);
    if (lastReturn > 0.12) {
      safety -= 20; // 单日涨超12%=很危险(容易次日低开)
    } else if (lastReturn > 0.08) {
      safety -= 10; // 单日8-12%=有风险
    }

    // 连续大涨检测
    let consecutiveBigUp = 0;
    for (let i = dailyReturns.length - 1; i >= 0; i--) {
      if (dailyReturns[i] > 0.05) consecutiveBigUp++;
      else break;
    }
    if (consecutiveBigUp >= 3) safety -= 15;
    else if (consecutiveBigUp >= 2) safety -= 5;

    // --- 3. 价格位置风险评估 ---
    if (pricePosition > 92) safety -= 10; // 太高位=追高风险
    else if (pricePosition > 80) safety -= 5;
    else if (pricePosition < 15) safety -= 5; // 弱势低位=继续跌风险

    // --- 4. 趋势稳定性加分 ---
    if (trendState >= 2 && pricePosition < 70) {
      safety += 10; // 趋势良好但不在极端高位=安全
    }

    // --- 5. 量价关系 ---
    const avgVol20 = volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVol = volumeArr[volumeArr.length - 1] || 0;
    if (lastVol > avgVol20 * 2 && dailyReturns[dailyReturns.length - 1] < 0) {
      safety -= 10; // 放量下跌=危险信号
    }

    return Math.min(Math.max(safety, 0), 100);
  }

  // ---------------------------------------------------------------------------
  // 数据源: 使用腾讯行情 API (qt.gtimg.cn) 替代被屏蔽的 EastMoney push2
  // ---------------------------------------------------------------------------
  private async fetchGEMCandidates(): Promise<StockCandidate[]> {
    const candidates: StockCandidate[] = [];

    // 生成所有可能的 GEM 股票代码 (300001~301499)
    const allCodes: string[] = [];
    for (let prefix of ['300', '301']) {
      for (let i = 1; i <= 999; i++) {
        allCodes.push(`sz${prefix}${String(i).padStart(3, '0')}`);
      }
    }

    this.logger.log(`📡 腾讯行情: 共 ${allCodes.length} 只 GEM 待查, 分 ${Math.ceil(allCodes.length / this.TENANT_BATCH)} 批`);

    for (let b = 0; b < allCodes.length; b += this.TENANT_BATCH) {
      const batch = allCodes.slice(b, b + this.TENANT_BATCH);
      const url = `https://qt.gtimg.cn/q=${batch.join(',')}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const buf = await res.arrayBuffer();
        const raw = iconv.decode(Buffer.from(buf), 'gbk');
        const lines = raw.split('\n').filter(l => l.trim());
        for (const line of lines) {
          // 格式: v_sz300001="51~name~code~price~yclose~...~";
          const match = line.match(/v_sz\d+="(.+?)";?\s*/);
          if (!match) continue;
          const fields = match[1].split('~');
          const code = fields[2] || '';
          if (!code.startsWith('300') && !code.startsWith('301')) continue;
          const curPrice = parseFloat(fields[3]);
          const yestClose = parseFloat(fields[4]);
          // 计算涨幅: (现价 - 昨收) / 昨收 * 100
          const changePct = yestClose > 0 ? ((curPrice - yestClose) / yestClose) * 100 : 0;
          // 只保留上涨的 (涨幅 > MIN_GAIN_PCT)
          if (changePct < this.MIN_GAIN_PCT) continue;
          // 用成交额(元) 作为资金活跃度代理
          const volumeShares = parseFloat(fields[6]) || 0;
          const amount = volumeShares * curPrice; // 近似成交额
          candidates.push({
            code,
            name: fields[1] || '',
            inflow: Math.round(amount),
            changePercent: Math.round(changePct * 100) / 100,
            currentPrice: curPrice,
          });
        }
      } catch (err) {
        this.logger.warn(`⚠️ 腾讯行情批 ${b / this.TENANT_BATCH + 1} 失败: ${err.message}`);
      }
    }

    // 按涨幅排序, 取前 200 只作为候选 (提高扫描速度)
    candidates.sort((a, b) => b.changePercent - a.changePercent);
    this.logger.log(`📡 腾讯行情: 获取 ${candidates.length} 只上涨GEM, 全量扫描`);
    return candidates;
  }

  // ==================== 主板机会区 ====================

  /** 解析批次中的新浪行情数据 */
  private parseSinaBatch(lines: string[]): StockCandidate[] {
    const result: StockCandidate[] = [];
    for (const line of lines) {
      // var hq_str_sh600000="浦发银行,20.10,19.90,20.05,...";
      const match = line.match(/var hq_str_(sh|sz)(\d+)="(.+)";?\s*/);
      if (!match) continue;
      const prefix = match[1];
      const codeStr = match[2];
      const rawFields = match[3];
      const fields = rawFields.split(',');
      const code = `${prefix.toUpperCase()}${codeStr}`;
      if (code.startsWith('SH300') || code.startsWith('SZ300') || code.startsWith('SZ301')) continue;
      if (code.startsWith('SH688') || code.startsWith('SZ688')) continue;
      if (!fields[2] || fields[2] === '0.00') continue; // 无数据
      const name = fields[0]?.trim() || '';
      if (name.includes('ST') || name.includes('*ST') || name.includes('退')) continue;
      const yestClose = parseFloat(fields[2]);
      const curPrice = parseFloat(fields[3]);
      const changePct = yestClose > 0 ? ((curPrice - yestClose) / yestClose) * 100 : 0;
      if (changePct < this.MIN_GAIN_PCT) continue;
      const volumeShares = parseFloat(fields[8]) || 0;
      // 新浪格式没有总市值字段, 跳过市值过滤
      const amount = volumeShares * curPrice;
      result.push({
        code: code.replace(/^(SH|SZ)/, ''),
        name,
        inflow: Math.round(amount),
        changePercent: Math.round(changePct * 100) / 100,
        currentPrice: curPrice,
        marketCap: 0,
      });
    }
    return result;
  }

  /** 批量获取股票实时行情: 先用腾讯, 失败则降级到新浪 */
  private async fetchMainBoardCandidates(): Promise<StockCandidate[]> {
    const candidates: StockCandidate[] = [];

    // 生成主板股票代码 (SH: 60xxxx, SZ: 00xxxx/001xxx/002xxx)
    const shCodes: string[] = [];
    for (let i = 0; i <= 5999; i++) {
      shCodes.push(`sh60${String(i).padStart(4, '0')}`);
    }
    const szCodes: string[] = [];
    for (const prefix of ['000', '001', '002']) {
      for (let i = 0; i <= 999; i++) {
        szCodes.push(`sz${prefix}${String(i).padStart(3, '0')}`);
      }
    }
    const allCodes = [...shCodes, ...szCodes]; // ~9000 只

    let tencentFailures = 0;

    // 分批查询
    for (let b = 0; b < allCodes.length; b += this.TENANT_BATCH) {
      const batch = allCodes.slice(b, b + this.TENANT_BATCH);
      const batchIdx = b / this.TENANT_BATCH + 1;
      let batchSuccess = false;

      // 1) 尝试腾讯行情
      try {
        const url = `https://qt.gtimg.cn/q=${batch.join(',')}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const buf = await res.arrayBuffer();
        const raw = iconv.decode(Buffer.from(buf), 'gbk');
        const lines = raw.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const match = line.match(/v_(?:sh|sz)\d+="(.+?)";?\s*/);
          if (!match) continue;
          const fields = match[1].split('~');
          const code = fields[2] || '';
          if (code.startsWith('300') || code.startsWith('301')) continue;
          if (code.startsWith('688') || code.startsWith('689')) continue;
          const curPrice = parseFloat(fields[3]);
          const yestClose = parseFloat(fields[4]);
          const changePct = yestClose > 0 ? ((curPrice - yestClose) / yestClose) * 100 : 0;
          if (changePct < this.MIN_GAIN_PCT) continue;
          const name = fields[1] || '';
          if (name.includes('ST') || name.includes('*ST') || name.includes('退')) continue;
          const marketCap = parseInt(fields[45]) || 0;
          const marketCapInYuan = marketCap * 100_000_000;
          if (marketCapInYuan > 0 && marketCapInYuan > this.MAX_MARKET_CAP) continue;
          if (marketCapInYuan > 0 && marketCapInYuan < this.MIN_MARKET_CAP) continue;
          const volumeShares = parseFloat(fields[6]) || 0;
          const amount = volumeShares * curPrice;
          candidates.push({
            code, name,
            inflow: Math.round(amount),
            changePercent: Math.round(changePct * 100) / 100,
            currentPrice: curPrice,
            marketCap,
          });
        }
        batchSuccess = true;
      } catch (err) {
        tencentFailures++;
        this.logger.warn(`⚠️ 主板行情批 ${batchIdx} 腾讯失败, 切换新浪: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 2) 腾讯失败则降级到新浪行情
      if (!batchSuccess) {
        try {
          // 新浪使用 hq.sinajs.cn, 代码格式相同 sh600000 / sz000001
          const sinaBatch = batch.map(c => c.toLowerCase());
          const sinaUrl = `https://hq.sinajs.cn/list=${sinaBatch.join(',')}`;
          const sinaRes = await fetch(sinaUrl, {
            signal: AbortSignal.timeout(30000),
            headers: { 'Referer': 'https://finance.sina.com.cn' },
          });
          const sinaText = await sinaRes.text();
          const sinaLines = sinaText.split('\n').filter(l => l.trim());
          const sinaCandidates = this.parseSinaBatch(sinaLines);
          candidates.push(...sinaCandidates);
          if (sinaCandidates.length > 0) {
            this.logger.log(`  新浪降级批 ${batchIdx}: 解析到 ${sinaCandidates.length} 只上涨`);
          }
        } catch (sinaErr) {
          this.logger.warn(`⚠️ 主板行情批 ${batchIdx} 新浪也失败: ${sinaErr instanceof Error ? sinaErr.message : String(sinaErr)}`);
        }
      }

      // 小延迟避免封 IP
      if (batchIdx % 5 === 0) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    candidates.sort((a, b) => b.changePercent - a.changePercent);
    this.logger.log(`📡 主板: 获取 ${candidates.length} 只上涨 (腾讯失败 ${tencentFailures} 批, 新浪降级)`);
    return candidates;
  }

  async scanMainBoardStocks(): Promise<OpportunityStock[]> {
    const candidates = await this.fetchMainBoardCandidates();
    this.logger.log(`🔍 主板分析: ${candidates.length} 只候选股 (使用创业板相同模板)`);

    if (candidates.length === 0) {
      this.logger.warn('⚠️ 主板候选池为空');
      return [];
    }

    candidates.sort((a, b) => b.inflow - a.inflow);

    const results: OpportunityStock[] = [];
    for (let i = 0; i < candidates.length; i += this.BATCH_SIZE) {
      const batch = candidates.slice(i, i + this.BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(s => this.checkOpportunity(s).catch(() => null))
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
      if (results.length > 0 && i % 100 === 0) {
        this.logger.log(`  ✓ 已检查 ${Math.min(i + this.BATCH_SIZE, candidates.length)}/${candidates.length}`);
      }
    }

    // 如果结果太少, 放宽位置门槛再扫一轮
    if (results.length <= 3) {
      this.logger.log(`  📊 主板结果较少(${results.length}), 放宽位置阈值至 ${this.RELAXED_POSITION} 再扫...`);
      for (let i = 0; i < candidates.length; i += this.BATCH_SIZE) {
        const batch = candidates.slice(i, i + this.BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(s => this.checkOpportunityRelaxed(s).catch(() => null))
        );
        for (const r of batchResults) {
          if (r && !results.find(ex => ex.code === r.code)) {
            results.push(r);
          }
        }
      }
    }

    results.sort((a, b) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
          : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
          : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
          : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    this.logger.log(`✅ 主板扫描完成, 共 ${results.length} 只机会股`);
    const finalResults = results.slice(0, 10);
    // 后台预缓存分析结果（不阻塞）
    this.stockService.preCacheAnalysisBatch(finalResults.map(s => s.code)).catch(() => {});
    return finalResults;
  }

  async getMainBoardOpportunities(): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    const marketOpen = isMarketOpen();
    // 盘后/周末/节假日: 有缓存直接返回(冻结)
    if (!marketOpen && this.mainBoardCache) {
      return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
    }
    // 交易时段: 按5分钟间隔判断是否需要刷新
    if (!marketOpen && !this.mainBoardCache) {
      // 无缓存且盘后 → 允许首次加载一次
      this.logger.log('📦 主板机会区: 首次部署/无缓存, 加载一次');
      const data = await this.scanMainBoardStocks();
      this.mainBoardCache = { data, timestamp: Date.now() };
      this.saveMainBoardCacheToDisk();
      return { opportunities: data, timestamp: Date.now() };
    }
    // 交易时段: 每5分钟刷新
    const useTTL = marketOpen ? this.REFRESH_INTERVAL : this.CACHE_TTL;
    if (this.mainBoardCache && Date.now() - this.mainBoardCache.timestamp < useTTL) {
      // 缓存未过期 → 保留上次结果用于交叠
      return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
    }
    // 缓存过期 → 后台刷新, 返回旧缓存(保存前次结果用于交叠)
    if (this.mainBoardCache && !this.mainBoardRefreshPromise) {
      const prevData = this.mainBoardCache.data;
      this.mainBoardRefreshPromise = this.scanMainBoardStocks().then(data => {
        // 交易时段交叠保留
        let finalResults = data;
        if (marketOpen && prevData.length > 0 && data.length > 0) {
          const prevCodes = new Set(prevData.map(s => s.code));
          const merged = data.filter(s => prevCodes.has(s.code));
          if (merged.length > 0) {
            finalResults = merged;
            this.logger.log(`  🔄 主板交叠保留: ${merged.length}/${data.length} 只`);
          } else {
            this.logger.log(`  🔄 主板无交叠, 使用最新 ${data.length} 只`);
          }
        }
        this.mainBoardCache = { data: finalResults, timestamp: Date.now() };
        this.saveMainBoardCacheToDisk();
        this.mainBoardRefreshPromise = null;
      }).catch(err => {
        this.logger.error(`❌ 主板扫描失败: ${err}`);
        this.mainBoardRefreshPromise = null;
      });
      return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
    }
    // 无缓存或刷新中 → 同步等待
    if (this.mainBoardRefreshPromise) {
      await this.mainBoardRefreshPromise;
      if (this.mainBoardCache) return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
    }
    const data = await this.scanMainBoardStocks();
    this.mainBoardCache = { data, timestamp: Date.now() };
    this.saveMainBoardCacheToDisk();
    return { opportunities: data, timestamp: Date.now() };
  }

  private async saveMainBoardCacheToDisk(): Promise<void> {
    try { await fs.writeFile(this.MAIN_BOARD_CACHE, JSON.stringify(this.mainBoardCache), 'utf8'); }
    catch {}
  }

  /**
   * 获取所有机会股（创业板+主板），供板块机会区交叉引用
   */
  async getAllOpportunities(): Promise<OpportunityStock[]> {
    const results: OpportunityStock[] = [];
    if (this.cache?.data?.length) results.push(...this.cache.data);
    if (this.mainBoardCache?.data?.length) results.push(...this.mainBoardCache.data);
    if (this.sectorCache?.data?.length) results.push(...this.sectorCache.data);
    return results;
  }
  /**
   * 统一建议计算（单次股票完整分析），供 quickAnalyze 和外部调用
   * 确保机会区与详细分析的结果一致
   */
  async computeFullSuggestion(code: string): Promise<{ suggestion: string; score: number; name: string } | null> {
    try {
      const raw: any[] = await this.dataFetcher.getKLineData(code) as any;
      if (!raw?.length || raw.length < 60) return null;
      const name = raw[0]?.name ?? '';
      const klineV: any[] = raw.slice(-120);
      const closeArr: number[] = klineV.map((k: any) => Number(k.close));
      const volumeArr: number[] = klineV.map((k: any) => Number(k.volume));
      const highArr: number[] = klineV.map((k: any) => Number(k.high));
      const lowArr: number[] = klineV.map((k: any) => Number(k.low));
      const price = closeArr[closeArr.length - 1];
      const high60 = Math.max(...highArr.slice(-60));
      const low60 = Math.min(...lowArr.slice(-60));
      const pricePos = ((price - low60) / (high60 - low60)) * 100;
      const ma5 = closeArr.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
      const ma10 = closeArr.slice(-10).reduce((a: number, b: number) => a + b, 0) / 10;
      const ma20 = closeArr.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      const macdR: any = this.calcCustomMACD(klineV as any);
      const diff = Array.isArray(macdR?.diff) ? macdR.diff[macdR.diff.length - 1] : (macdR?.diff ?? 0);
      const dea = Array.isArray(macdR?.dea) ? macdR.dea[macdR.dea.length - 1] : (macdR?.dea ?? 0);

      const ma5Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 6];
      const ma10Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 11];
      let trendState = 1;
      if (ma5 > ma10 && ma10 > ma20 && ma5Up && ma10Up) trendState = 3;
      else if (ma5 > ma10 && ma5Up) trendState = 2;
      else if (ma5 < ma10 && ma10 < ma20) trendState = 0;

      const klineO: number[] = klineV.map((k: any) => Number(k.open));
      const klineH: number[] = klineV.map((k: any) => Number(k.high));
      const klineL: number[] = klineV.map((k: any) => Number(k.low));
      const klineA: number[] = klineV.map((k: any) => Number(k.amount ?? 0));
      const engine = new FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: volumeArr, amount: klineA });
      const baiXing: any = calcBaiXing(engine);
      const sanJiao: any = calcBaiSanJiao(engine);
      const lingXing: any = calcBaiLingXing(engine);
      const xingX: any = calcXingXing(engine);

      const isGoldenCross = macdR?.isGoldenCross ?? false;
      const cfsInput: any = {
        pricePosition: pricePos,
        trendState,
        trendStrength: (baiXing as any)?.trendStrength ?? sanJiao?.trendStrength ?? 0,
        diff, dea,
        shortBuy: (lingXing as any)?.shortBuy ?? false,
        strictBuy: (sanJiao as any)?.strictBuy ?? false,
        jiaCang: (sanJiao as any)?.jiaCang ?? false,
        shortSell: (xingX as any)?.shortSell ?? false,
        strongSell: (xingX as any)?.strongSell ?? false,
        safe: (baiXing as any)?.safe ?? false,
        macdGoldenCross: isGoldenCross,
        macdDeathCross: false,
        baiXiaoDays: (baiXing as any)?.baiXiaoDays ?? 0,
        volumeStructure: (sanJiao as any)?.volumeStructure ?? 0,
      };
      const cfsResult = getTradingSuggestion(cfsInput);
      const suggestion = cfsResult.action;

      const BASE: Record<string, number> = {
        '重仓买入': 100, '买入': 80, '轻仓买入': 65, '准备买入': 55, '持有': 40,
      };
      let score = BASE[suggestion] ?? 30;
      if (pricePos < 30) score += 15;
      else if (pricePos < 50) score += 8;
      if (closeArr[closeArr.length - 1] > closeArr[closeArr.length - 5]) score += 5;
      else score -= 5;

      return { suggestion, score, name };
    } catch (e) {
      return null;
    }
  }


  /**
   * 全市场扫描Top10机会股
   * 对所有候选股运行完整公式分析，按交易建议排序，取前10
   */
  /**
   * 扫描创业板Top10机会股
   */

  /**
   * 扫描热点板块中的机会股，取Top10（调用本地sector API获取板块数据）
   */
  async scanSectorOpportunities(force = false): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    // Render美国服务器无法访问中国股票API，始终返回缓存数据
    // 前端浏览器（在中国）通过 POST /api/gem/refresh-sector 推送实时数据更新缓存
    if (this.sectorCache && this.sectorCache.data?.length) {
      return { opportunities: this.sectorCache.data, timestamp: this.sectorCache.timestamp };
    }
    // 完全没有缓存 → 返回空
    this.logger.log('📦 板块无缓存数据，返回空');
    return { opportunities: [], timestamp: Date.now() };
  }

  async scanTopGem(force = false): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    // Render海外服务器无法访问中国股票API，始终返回缓存数据
    // 前端浏览器（在中国）通过 POST /api/gem/refresh 推送实时数据更新缓存
    // 注意：不要在Render上调用 triggerAnalysisPreCache，否则会触发腾讯API超时导致进程崩溃
    if (this.cache && this.cache.data?.length) {
      return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
    }
    // 完全没有缓存 → 触发异步扫描，立即返回空
    this.logger.log('📦 无缓存数据，触发异步扫描...');
    this.triggerRefresh();
    return { opportunities: [], timestamp: Date.now() };
  }

  /**
   * 扫描主板Top10机会股
   */
  async scanTopMainBoard(force = false): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    // Render海外服务器无法访问中国股票API，始终返回缓存数据
    // 前端浏览器（在中国）通过 POST /api/gem/refresh-main-board 推送实时数据更新缓存
    if (this.mainBoardCache && this.mainBoardCache.data?.length) {
      return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
    }
    // 完全没有缓存 → 触发异步扫描，立即返回空
    this.logger.log('📦 主板无缓存数据，触发异步扫描...');
    this.triggerRefresh();
    return { opportunities: [], timestamp: Date.now() };
  }

  /**
   * 扫描全市场Top10机会股（保留，用于单区展示）
   */
  async scanTopOpportunities(force = false): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    const gem = await this.scanTopGem(force);
    const main = await this.scanTopMainBoard(force);
    const combined = [...gem.opportunities, ...main.opportunities];
    const ORDER: Record<string, number> = {
      '重仓买入': 0, '买入': 1, '轻仓买入': 2, '准备买入': 3,
      '持有': 4, '观望': 5, '减仓': 6, '卖出': 7, '清仓': 8,
    };
    combined.sort((a, b) => {
      const pa = ORDER[a.suggestion ?? ''] ?? 99;
      const pb = ORDER[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
        : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
        : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    return { opportunities: combined.slice(0, 10), timestamp: Math.max(gem.timestamp, main.timestamp) };
  }

  private async scanTopFromCandidates(
    fetchFn: () => Promise<StockCandidate[]>,
    topN: number,
  ): Promise<OpportunityStock[]> {
    const candidates: StockCandidate[] = [];
    try { const c = await fetchFn(); if (c?.length) candidates.push(...c); } catch {}
    if (candidates.length === 0) return [];

    const results: OpportunityStock[] = [];
    const BATCH_SIZE = 20;
    let analyzed = 0;

    for (let i = 0; i < candidates.length && analyzed < Math.max(topN * 3, 60); i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (c) => {
        try {
          const stock = await this.quickAnalyze(c.code, c.name);
          if (stock) { results.push(stock); analyzed++; }
        } catch {}
      }));
    }

    const ORDER: Record<string, number> = {
      '重仓买入': 0, '买入': 1, '轻仓买入': 2, '准备买入': 3,
      '持有': 4, '观望': 5, '减仓': 6, '卖出': 7, '清仓': 8,
    };
    results.sort((a, b) => {
      const pa = ORDER[a.suggestion ?? ''] ?? 99;
      const pb = ORDER[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
          : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
          : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
          : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    return results.slice(0, topN);
  }

  /**
   * 计算最佳介入时机评分 (0-100)
   * 场景A: 从高位跌下来横盘调整后准备第二波 → 25-55% 位置 + 趋势转好 + MACD金叉
   * 场景B: 在98%高位, 涨势很好趋势很强要突破前高 → 75%+ 位置 + 强趋势 + 突破形态
   */
  private static calcEntryTiming(
    pricePos: number,
    trendState: number,
    closeArr: number[],
    macdGoldenCross: boolean,
    volumeArr: number[],
  ): number {
    let score = 45; // baseline (中性偏保守)

    // === 场景A: 回调后的第二波启动 (黄金介入点) ===
    // 特征: 股价从高位回调到 25-55% 区间, 横盘整理完毕, 趋势开始转好
    if (pricePos >= 25 && pricePos <= 55) {
      // 检查近期是否从高位回调
      const periodHigh = Math.max(...closeArr);
      const currentPrice = closeArr[closeArr.length - 1];
      const pulledBack = currentPrice <= periodHigh * 0.88;

      if (pulledBack) {
        // 横盘整理特征: 近10日价格波动小 (低标准差)
        const recentCloses = closeArr.slice(-10);
        const mean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
        const variance = recentCloses.reduce((s, v) => s + (v - mean) ** 2, 0) / recentCloses.length;
        const std = Math.sqrt(variance);
        const volatility = std / mean;

        if (volatility < 0.035 && trendState >= 1) {
          score += 28; // 横盘缩量整理完毕
        }
        if (trendState >= 2) score += 12; // 趋势开始转好
        if (macdGoldenCross) score += 10; // MACD金叉确认
        // 量能确认: 近期成交量温和放大
        const avgVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const avgVol20 = volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
        if (avgVol5 > avgVol20 * 1.1) score += 8; // 放量
      }
    }

    // === 场景B: 高位强势突破 (强者恒强) ===
    // 特征: 股价在高位 75%+, 趋势强劲, MACD金叉, 即将突破前高
    if (pricePos >= 72) {
      const currentPrice = closeArr[closeArr.length - 1];
      const periodHigh = Math.max(...closeArr.slice(-60));
      const nearHigh = currentPrice >= periodHigh * 0.97;

      if (trendState >= 2 && (macdGoldenCross || nearHigh)) {
        score += 25; // 强趋势+突破形态
      }
      if (trendState === 3) score += 10; // 主升浪
      if (nearHigh) {
        // 检查是否有效突破(收盘价站上前高)
        const prevHigh = Math.max(...closeArr.slice(-60, -1));
        if (currentPrice > prevHigh) score += 15; // 有效突破
      }
      // 量能确认
      const avgVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const avgVol20 = volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
      if (avgVol5 > avgVol20 * 1.15) score += 8; // 放量突破
    }

    // === 中位区偏多: 有买入信号但位置中等 ===
    if (pricePos > 55 && pricePos < 72 && trendState >= 2 && macdGoldenCross) {
      score += 10;
    }

    return Math.min(Math.max(Math.round(score), 0), 100);
  }

  /**
   * 计算安全系数评分 (0-100)
   * 高安全 = 低波动 + 稳定上涨 + 非极端位置
   * 低安全 = 高波动(20cm大起大落) + 位置极端 + 刚大涨过
   */
  private static calcSafetyScore(
    closeArr: number[],
    highArr: number[],
    lowArr: number[],
    pricePos: number,
    changePercent: number,
  ): number {
    let score = 55; // baseline 略偏安全

    // 1) 波动率评估: 近20日收益率标准差
    const returns: number[] = [];
    const lookback = Math.min(closeArr.length, 20);
    for (let i = 1; i < lookback; i++) {
      returns.push((closeArr[i] - closeArr[i - 1]) / closeArr[i - 1]);
    }
    const retMean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const retVariance = returns.reduce((s, v) => s + (v - retMean) ** 2, 0) / returns.length;
    const vol = Math.sqrt(retVariance);

    // 低波动=安全, 高波动=风险
    if (vol < 0.025) score += 18;      // 非常稳定
    else if (vol < 0.035) score += 10; // 较稳定
    else if (vol < 0.05) score += 3;   // 一般
    else if (vol < 0.07) score -= 8;   // 波动偏大
    else score -= 20;                   // 高波动(20cm大起大落型)

    // 2) 最近一日涨跌幅评估: 刚大涨20cm = 高风险(次日容易回调)
    const absChange = Math.abs(changePercent);
    if (absChange > 15) score -= 20;       // 15%+ 极大概率回调
    else if (absChange > 10) score -= 12;  // 10%+ 高风险
    else if (absChange > 7) score -= 5;    // 7%+ 偏风险
    else if (absChange < 3) score += 5;    // 3%以内小涨 = 安全

    // 3) 位置评估: 极端位置风险更大
    if (pricePos > 92) score -= 10;      // 高位极端, 回调风险
    else if (pricePos > 85) score -= 5;
    else if (pricePos < 12) score -= 8;  // 低位极端, 可能继续跌
    else if (pricePos < 20) score -= 3;

    // 4) 近期回撤检查: 近10日最大回撤
    const recentHigh = Math.max(...closeArr.slice(-10));
    const currentPrice = closeArr[closeArr.length - 1];
    const drawdown = (recentHigh - currentPrice) / recentHigh;
    if (drawdown > 0.08) score -= 8;     // 大幅回撤
    else if (drawdown > 0.05) score -= 3;

    // 5) 趋势保护: 上升趋势中的股票更安全
    const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (ma5 > ma10 && ma10 > ma20) score += 8; // 多头排列 = 安全
    if (closeArr[closeArr.length - 1] > ma5) score += 5; // 站稳5日线

    return Math.min(Math.max(Math.round(score), 0), 100);
  }

  private async quickAnalyze(code: string, name?: string): Promise<OpportunityStock | null> {
    const raw: any[] = await this.dataFetcher.getKLineData(code) as any;
    if (!raw?.length || raw.length < 60) return null;

    const klineV: any[] = raw.slice(-120);
    const closeArr: number[] = klineV.map((k: any) => Number(k.close));
    const volumeArr: number[] = klineV.map((k: any) => Number(k.volume));
    const highArr: number[] = klineV.map((k: any) => Number(k.high));
    const lowArr: number[] = klineV.map((k: any) => Number(k.low));
    const price = closeArr[closeArr.length - 1];
    const high60 = Math.max(...highArr.slice(-60));
    const low60 = Math.min(...lowArr.slice(-60));
    const pricePos = ((price - low60) / (high60 - low60)) * 100;
    const ma5 = closeArr.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
    const ma10 = closeArr.slice(-10).reduce((a: number, b: number) => a + b, 0) / 10;
    const ma20 = closeArr.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
    const macdR: any = this.calcCustomMACD(klineV);
    const diff = Array.isArray(macdR?.diff) ? macdR.diff[macdR.diff.length - 1] : (macdR?.diff ?? 0);
    const dea = Array.isArray(macdR?.dea) ? macdR.dea[macdR.dea.length - 1] : (macdR?.dea ?? 0);

    const ma5Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 6];
    const ma10Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 11];
    let trendState = 1;
    if (ma5 > ma10 && ma10 > ma20 && ma5Up && ma10Up) trendState = 3;
    else if (ma5 > ma10 && ma5Up) trendState = 2;
    else if (ma5 < ma10 && ma10 < ma20) trendState = 0;

    const klineO: number[] = klineV.map((k: any) => Number(k.open));
    const klineH: number[] = klineV.map((k: any) => Number(k.high));
    const klineL: number[] = klineV.map((k: any) => Number(k.low));
    const klineA: number[] = klineV.map((k: any) => Number(k.amount ?? 0));
    const engine = new FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: volumeArr, amount: klineA });
    const baiXing: any = calcBaiXing(engine);
    const sanJiao: any = calcBaiSanJiao(engine);
    const lingXing: any = calcBaiLingXing(engine);
    const xingX: any = calcXingXing(engine);

    const formulaInput: any = {
      pricePosition: pricePos,
      trendState,
      trendStrength: (baiXing as any)?.trendStrength ?? sanJiao?.trendStrength ?? 0,
      diff,
      dea,
      shortBuy: (lingXing as any)?.shortBuy ?? false,
      strictBuy: (sanJiao as any)?.strictBuy ?? false,
      jiaCang: (sanJiao as any)?.jiaCang ?? false,
      shortSell: (xingX as any)?.shortSell ?? false,
      strongSell: (xingX as any)?.strongSell ?? false,
      safe: (baiXing as any)?.safe ?? false,
      macdGoldenCross: macdR?.isGoldenCross ?? false,
      macdDeathCross: false,
      baiXiaoDays: (baiXing as any)?.baiXiaoDays ?? 0,
      volumeStructure: (sanJiao as any)?.volumeStructure ?? 0,
    };

    const isGoldenCross = macdR?.isGoldenCross ?? false;
    const result = getTradingSuggestion(formulaInput);
    const suggestion = result.action;
    const predictionText = result.prediction || '';
    const reasonText = result.reason || '';

    const NEGATIVE = ['减仓', '卖出', '清仓', '不要介入', '观望'];
    if (NEGATIVE.includes(suggestion)) return null;

    // 排除预测文本严重负面关键词的
    const NEGATIVE_PREDICTION_KEYWORDS = ['偏弱', '探底', '风险较大', '风险大', '注意风险'];
    if (NEGATIVE_PREDICTION_KEYWORDS.some(kw => predictionText.includes(kw))) return null;

    // === 交叉验证：用全部K线数据模拟详情页的分析结果 ===
    // 详情页（stock/analyze）使用所有K线 + 简化版MACD（EMA12/EMA26）
    // 可能与 quickAnalyze 的120-bar + calcCustomMACD 结果不同
    // 只排除交叉验证结果为明确负面的（观望/减仓/卖出/清仓/不要介入）
    // 交叉验证为"持有"或买入级别 → 保留（符合"可以更高级但不能更低级"原则）
    const rawFull: any[] = raw;
    const fullCloseArr: number[] = rawFull.map((k: any) => Number(k.close));
    const fullVolumeArr: number[] = rawFull.map((k: any) => Number(k.volume));
    const fullHighArr: number[] = rawFull.map((k: any) => Number(k.high));
    const fullLowArr: number[] = rawFull.map((k: any) => Number(k.low));
    const fullOpenArr: number[] = rawFull.map((k: any) => Number(k.open));
    const fullAmountArr: number[] = rawFull.map((k: any) => Number(k.amount ?? 0));

    const fullEngine = new FormulaEngine({
      open: fullOpenArr, close: fullCloseArr, high: fullHighArr,
      low: fullLowArr, volume: fullVolumeArr, amount: fullAmountArr,
    });
    const fullBaiXing: any = calcBaiXing(fullEngine);
    const fullSanJiao: any = calcBaiSanJiao(fullEngine);
    const fullLingXing: any = calcBaiLingXing(fullEngine);
    const fullXingXing: any = calcXingXing(fullEngine);

    // 简化版MACD（与 stock/analyze 一致）
    const szEma12 = fullCloseArr.reduce((s, v, i) => i === 0 ? v : s + (v - s) * 2 / 13, 0);
    const szEma26 = fullCloseArr.reduce((s, v, i) => i === 0 ? v : s + (v - s) * 2 / 27, 0);
    const fullDiffV = szEma12 - szEma26;
    const szDeaArr: number[] = fullCloseArr.reduce((arr: number[], v, i) => {
      const prev = arr.length ? arr[arr.length - 1] : 0;
      arr.push(i === 0 ? fullCloseArr[0] : prev + (((szEma12 - szEma26) - prev) * 2 / 9));
      return arr;
    }, []);
    const fullDeaV = szDeaArr[szDeaArr.length - 1] || 0;
    const fullIsGoldenCross = fullDiffV > fullDeaV;

    const crossInput: any = {
      pricePosition: pricePos,
      trendState,
      trendStrength: (fullBaiXing as any)?.trendStrength ?? (fullSanJiao as any)?.trendStrength ?? 0,
      diff: fullDiffV,
      dea: fullDeaV,
      shortBuy: (fullLingXing as any)?.shortBuy ?? false,
      strictBuy: (fullSanJiao as any)?.strictBuy ?? false,
      jiaCang: (fullSanJiao as any)?.jiaCang ?? false,
      shortSell: (fullXingXing as any)?.shortSell ?? false,
      strongSell: (fullXingXing as any)?.strongSell ?? false,
      safe: (fullBaiXing as any)?.safe ?? false,
      macdGoldenCross: fullIsGoldenCross,
      macdDeathCross: fullDiffV < fullDeaV,
      baiXiaoDays: (fullBaiXing as any)?.baiXiaoDays ?? 0,
      volumeStructure: (fullSanJiao as any)?.volumeStructure ?? 0,
    };
    const crossResult = getTradingSuggestion(crossInput);
    const crossSuggestion = crossResult.action;

    // 交叉验证：只排除结果明确为负面的（观望/减仓/卖出/清仓/不要介入）
    // "持有"不排除（用户: "选出来是买入，进去是持有也是可以的"）
    const NEGATIVE_CROSS = ['观望', '减仓', '卖出', '清仓', '不要介入'];
    if (NEGATIVE_CROSS.includes(crossSuggestion)) return null;

    const priceIncrease = ((price - closeArr[closeArr.length - 20]) / closeArr[closeArr.length - 20]) * 100;
    const changePct = ((price - closeArr[closeArr.length - 2]) / closeArr[closeArr.length - 2]) * 100;

    const BASE: Record<string, number> = {
      '重仓买入': 100, '买入': 80, '轻仓买入': 65, '准备买入': 55, '持有': 40,
    };
    let score = BASE[suggestion] ?? 30;
    if (pricePos < 30) score += 15;
    else if (pricePos < 50) score += 8;
    if (closeArr[closeArr.length - 1] > closeArr[closeArr.length - 5]) score += 5;
    else score -= 5;

    // === 计算最佳介入时机和安全系数 ===
    const entryTiming = GemScreenerService.calcEntryTiming(
      pricePos, trendState, closeArr, isGoldenCross, volumeArr,
    );
    const safetyScore = GemScreenerService.calcSafetyScore(
      closeArr, highArr, lowArr, pricePos, changePct,
    );

    return {
      code, name: name ?? '',
      currentPrice: price,
      changePercent: Math.round(changePct * 100) / 100,
      priceIncrease: Math.round(priceIncrease * 100) / 100,
      mainForceInflow: 0,
      pricePosition: Math.round(pricePos),
      capitalRank: 0,
      baiXiaoDays: 0,
      score,
      suggestion,
      entryTiming,
      safetyScore,
      isGoldenCross,
      diff,
      dea,
      buySignal: !!(baiXing?.baiXiao || sanJiao?.jiaCang || lingXing?.shortBuy) ? '有信号' : '',
    };
  }

  triggerAnalysisPreCacheFromCache() {
    const cachedStocks: string[] = [];
    if (this.cache?.data) cachedStocks.push(...this.cache.data.map(s => s.code));
    if (this.mainBoardCache?.data) cachedStocks.push(...this.mainBoardCache.data.map(s => s.code));
    if (cachedStocks.length > 0) {
      this.stockService.preCacheAnalysisBatch(cachedStocks).catch(() => {});
    }
  }

  /** 从当前返回的机会股列表触发分析预缓存 */
  private triggerAnalysisPreCache(stocks: OpportunityStock[]) {
    if (stocks.length > 0) {
      this.stockService.preCacheAnalysisBatch(stocks.map(s => s.code)).catch(() => {});
    }
  }

  /**
   * 全局重仓买入扫描: 从全行业成分股(280只) + 已知机会股中扫描"重仓买入"
   * 先获取实时行情过滤正涨幅, 再分析K线
   */
  async scanGlobalHeavyBuy(): Promise<OpportunityStock[]> {
    this.logger.log('🔍 [全局重仓买入] 开始扫描...');
    try {
      // 1. 收集全行业280只成分股code (无前缀)
      const allCodes: string[] = [];
      const codeToSectorName = new Map<string, string>();
      for (const sector of ALL_SECTORS) {
        for (const code of sector.codes) {
          if (!allCodes.includes(code)) {
            allCodes.push(code);
            codeToSectorName.set(code, sector.name);
          }
        }
      }

      // 2. 再加入已缓存的机会股code
      const cachedCodes = [
        ...(this.cache?.data?.map(s => s.code.replace(/^(sh|sz)/,'')) ?? []),
        ...(this.mainBoardCache?.data?.map(s => s.code.replace(/^(sh|sz)/,'')) ?? []),
        ...(this.sectorCache?.data?.map(s => s.code.replace(/^(sh|sz)/,'')) ?? []),
      ];
      for (const c of cachedCodes) {
        if (c && !allCodes.includes(c)) allCodes.push(c);
      }

      this.logger.log(`🔍 共收集 ${allCodes.length} 只候选股票`);

      // 3. 用腾讯API批量获取实时行情，定位正涨幅/好表现的股票
      const heavyBuyResults: OpportunityStock[] = [];
      const BATCH = 100;
      for (let i = 0; i < allCodes.length; i += BATCH) {
        const batch = allCodes.slice(i, i + BATCH);
        const qStr = batch.map(c => (c.startsWith('6') ? 'sh' : 'sz') + c).join(',');
        try {
          const url = 'https://qt.gtimg.cn/q=' + encodeURIComponent(qStr);
          const res = await fetch(url);
          const buf = Buffer.from(await res.arrayBuffer());
          const txt = iconv.decode(buf, 'gbk');
          const lines = txt.split('\n').filter(l => l.includes('~'));
          this.logger.log(`  📊 腾讯API返回 ${lines.length} 条行情`);

          for (const line of lines) {
            try {
              const parts = line.split('~');
              const name = parts[1]?.trim() || '';
              const rawCode = parts[2]?.trim() || '';
              const code = rawCode.startsWith('sh') || rawCode.startsWith('sz') ? rawCode.substring(2) : rawCode;
              const price = parseFloat(parts[3]) || 0;
              const changePct = parseFloat(parts[32]) || 0;

              // 排除ST/银行/保险
              if (/^(\*)?ST/.test(name) || /银行|保险/.test(name)) continue;

              // 只保留涨幅>0且价格>2的股票做进一步K线分析
              if (changePct < 0 || price < 2) continue;

              // 4. 对候选股做完整的K线分析
              try {
                const result = await this.computeFullSuggestion(code);
                if (result && result.suggestion === '重仓买入') {
                  heavyBuyResults.push({
                    code,
                    name,
                    currentPrice: price,
                    changePercent: Math.round(changePct * 100) / 100,
                    priceIncrease: 0,
                    mainForceInflow: 0,
                    pricePosition: 0,
                    capitalRank: 0,
                    baiXiaoDays: 0,
                    score: result.score,
                    suggestion: '重仓买入',
                    entryTiming: 0,
                    safetyScore: 0,
                    isGoldenCross: false,
                    diff: 0,
                    dea: 0,
                    buySignal: '',
                  });
                }
              } catch (klineErr) {
                // K线获取失败，跳过
              }
            } catch (parseErr) {
              // 单行解析失败，跳过
            }
          }
        } catch (batchErr) {
          this.logger.warn(`  ⚠️ 批次 ${i}-${i+BATCH} 获取失败: ${batchErr.message}`);
        }
      }

      // 排序取前3
      heavyBuyResults.sort((a, b) => (b.score || 0) - (a.score || 0));
      this.logger.log(`✅ [全局重仓买入] 完成, 发现 ${heavyBuyResults.length} 只`);
      return heavyBuyResults.slice(0, 3);
    } catch (error) {
      this.logger.error(`❌ [全局重仓买入] 异常: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取实时热门行业板块Top10（基于成分股实时涨跌幅均值排序）
   * 动态计算，非硬编码
   */
  async getIndustrySectorTop10(): Promise<{
    sectors: Array<{
      rank: number;
      name: string;
      avgChangePercent: number;
      totalStocks: number;
      upStocks: number;
      stocks: Array<{ code: string; name: string; price: number; changePercent: number }>;
    }>;
    timestamp: number;
  }> {
    // 收集所有板块成分股
    const allCodes: string[] = [];
    const codeToSector = new Map<string, string>();
    for (const sec of ALL_SECTORS) {
      for (const code of sec.codes) {
        codeToSector.set(code, sec.name);
        if (!allCodes.includes(code)) allCodes.push(code);
      }
    }

    this.logger.log(`📊 获取行业板块实时热度: ${ALL_SECTORS.length}个板块(含概念), ${allCodes.length}只成分股`);

    // 分批获取实时行情（通过腾讯API）
    const quoteMap = new Map<string, { name: string; price: number; changePercent: number }>();
    const BATCH = 80;
    for (let i = 0; i < allCodes.length; i += BATCH) {
      const batch = allCodes.slice(i, i + BATCH);
      const qstr = batch.map(c => (c.startsWith('6') ? 'sh' : 'sz') + c).join(',');
      try {
        const url = 'https://qt.gtimg.cn/q=' + encodeURIComponent(qstr);
        const res = await fetch(url);
        const buf = Buffer.from(await res.arrayBuffer());
        const txt = iconv.decode(buf, 'gbk');
        const lines = txt.trim().split(';');
        for (const line of lines) {
          const cm = line.match(/v_(sh\d+|sz\d+)="(.*)"/);
          if (!cm || !cm[2]) continue;
          const parts = cm[2].split('~');
          const code = cm[1].replace(/^(sh|sz)/, '');
          const name = parts[1] || '';
          if (!code || !name || /^\d+$/.test(name)) continue;
          const price = parseFloat(parts[3]) || 0;
          const changePercent = parseFloat(parts[32]) || 0;
          quoteMap.set(code, { name, price, changePercent });
        }
      } catch (e) {
        this.logger.warn(`腾讯行情批次失败: ${e.message}`);
      }
    }

    this.logger.log(`📊 获取到 ${quoteMap.size}/${allCodes.length} 只行情数据`);

    // 按板块分组计算平均涨幅
    const sectorMap = new Map<string, { totalChange: number; upCount: number; count: number; stocks: Array<{ code: string; name: string; price: number; changePercent: number }> }>();
    for (const sec of ALL_SECTORS) {
      let totalChange = 0;
      let count = 0;
      let upCount = 0;
      const stocks: Array<{ code: string; name: string; price: number; changePercent: number }> = [];
      for (const code of sec.codes) {
        const q = quoteMap.get(code);
        if (q && q.price > 0) {
          totalChange += q.changePercent;
          count++;
          if (q.changePercent > 0) upCount++;
          stocks.push({ code, name: q.name, price: q.price, changePercent: q.changePercent });
        }
      }
      if (count > 0) {
        sectorMap.set(sec.name, {
          totalChange,
          upCount,
          count,
          stocks: stocks.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 5),
        });
      }
    }

    // 排序取Top10
    const sorted = Array.from(sectorMap.entries())
      .map(([name, data]) => ({
        name,
        avgChangePercent: Math.round((data.totalChange / data.count) * 100) / 100,
        totalStocks: data.count,
        upStocks: data.upCount,
        stocks: data.stocks,
      }))
      .sort((a, b) => b.avgChangePercent - a.avgChangePercent)
      .slice(0, 10)
      .map((s, i) => ({ rank: i + 1, ...s }));

    this.logger.log(`📊 行业板块Top10: ${sorted.map(s => `${s.rank}.${s.name}(${s.avgChangePercent}%)`).join(', ')}`);

    return { sectors: sorted, timestamp: Date.now() };
  }
}