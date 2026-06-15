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
  private readonly POSITION_THRESHOLD = 75;
  private readonly RELAXED_POSITION = 82;
  // Tencent API 批量查询 GEM 股票 (替代被屏蔽的 EastMoney push2)
  private readonly TENANT_BATCH = 500;       // 每批查询数
  private readonly MIN_GAIN_PCT = 0.3;
  private readonly MAX_MARKET_CAP = 500_0000_0000; // 500亿, 排除超大市值
  private readonly MIN_MARKET_CAP = 20_0000_0000;  // 20亿, 排除小盘庄股

  private cache: CacheEntry | null = null;
  private refreshPromise: Promise<void> | null = null;
  private mainBoardCache: CacheEntry | null = null;
  private mainBoardRefreshPromise: Promise<void> | null = null;
  private sectorCache: CacheEntry | null = null;
  private readonly MAIN_BOARD_CACHE = '/tmp/main-board-opportunities-cache.json';
  private readonly BUNDLED_MAIN_BOARD_CACHE = join(__dirname, '..', '..', '..', 'assets', 'main-board-cache.json');

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
  private async loadCacheFromDisk() {
    try {
      const raw = await fs.readFile(this.CACHE_FILE, 'utf-8');
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

  private async loadMainBoardCacheFromDisk() {
    try {
      const raw = await fs.readFile(this.MAIN_BOARD_CACHE, 'utf-8');
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
    const marketOpen = isMarketOpen();

    // 盘后/周末: 缓存永不过期, 直接返回缓存 (如有)
    if (!marketOpen && this.cache) {
      this.triggerAnalysisPreCache(this.cache.data);
      return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
    }

    // 盘中: 正常 stale-while-revalidate
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      this.triggerAnalysisPreCache(this.cache.data);
      return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
    }
    if (this.cache && Date.now() - this.cache.timestamp < this.STALE_TTL) {
      this.triggerAnalysisPreCache(this.cache.data);
      this.triggerRefresh();
      return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
    }
    if (this.cache) {
      this.triggerAnalysisPreCache(this.cache.data);
      this.triggerRefresh();
      return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
    }

    // 无任何缓存 → 即使盘后也尝试首次加载（避免首次部署永远没数据）
    this.logger.log('📦 首次加载或缓存已清空, 尝试获取数据...');
    if (!marketOpen) {
      // 盘后首次部署: 直接同步加载一次
      try {
        const opportunities = await this.scanAllStocks();
        this.cache = { data: opportunities, timestamp: Date.now() };
        this.saveCacheToDisk();
        return { opportunities, timestamp: this.cache.timestamp };
      } catch (err) {
        this.logger.error(`❌ 首次加载失败: ${err.message}`);
        return { opportunities: [], timestamp: Date.now() };
      }
    }
    // 盘中: 后台异步刷新
    this.triggerRefresh();
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
    this.triggerRefresh();
    // 主板机会区 - 尝试从磁盘恢复缓存，无缓存则触发扫描
    try {
      const raw = await fs.readFile(this.MAIN_BOARD_CACHE, 'utf-8');
      const parsed = JSON.parse(raw);
      this.mainBoardCache = { data: parsed.data, timestamp: parsed.timestamp };
      this.logger.log(`📦 主板机会区: 从磁盘恢复缓存, ${this.mainBoardCache.data.length} 只`);
    } catch { /* 首次部署, 无磁盘缓存 */ }
    if (!this.mainBoardCache) {
      this.logger.log('📦 主板机会区: 无缓存, 启动后台扫描...');
      // 后台扫描，不阻塞启动
      this.mainBoardRefreshPromise = this.scanMainBoardStocks().then(data => {
        this.mainBoardCache = { data, timestamp: Date.now() };
        this.saveMainBoardCacheToDisk();
        this.logger.log(`✅ 主板机会区: 扫描完成, ${data.length} 只`);
      }).catch(err => {
        this.logger.error(`❌ 主板机会区: 扫描失败: ${err}`);
      });
    }
    // 启动后预缓存分析结果
    this.triggerAnalysisPreCacheFromCache();
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

    results.sort((a, b) => b.score - a.score);
    const finalResults = results.slice(0, 10);
    // 后台预缓存分析结果（不阻塞）
    this.stockService.preCacheAnalysisBatch(finalResults.map(s => s.code)).catch(() => {});
    return finalResults;
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

    // ---------- MACD 检查 (用户自定义公式) ----------
    const macdResult = this.calcCustomMACD(kline);

    // 金叉天数 <= 15 天, 非金叉也放行（DIFF接近DEA也算）
    const isGoldenCross = macdResult.isGoldenCross;
    const isApproaching = !isGoldenCross && macdResult.currentDiff > macdResult.currentDea * 0.95;
    if (!isGoldenCross && !isApproaching) return null;

    // 排除银行保险股
    const excludeKeywords = ['银行', '保险', '农商', '兴业银', '中国人寿', '中国平安', '中国人保', '中国太保', '新华保险'];
    for (const kw of excludeKeywords) {
      if (s.name.includes(kw)) return null;
    }

    const goldenCrossDays = macdResult.goldenCrossDays || 15;

    // ---------- 趋势二次确认 ----------
    const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = len >= 20 ? closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;

    // ① MA5 > MA10（短线趋势向上, 需有足够差距）
    if (ma5 <= ma10 * 1.001) return null;

    // ② MA5 斜率向上
    if (len >= 8) {
      const ma5_3d = closeArr.slice(-8, -3).reduce((a, b) => a + b, 0) / 5;
      if (ma5 <= ma5_3d) return null;
    }

    // ③ MA10 斜率向上或走平（中短线趋势确认）
    if (len >= 15) {
      const ma10_5d = closeArr.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;
      if (ma10 <= ma10_5d) return null;
    }

    // ④ 收盘价在 MA10 之上
    if (closeArr[len - 1] <= ma10) return null;

    // ⑤ MA20 走平或向上（中长期趋势确认）
    if (len >= 30) {
      const ma20_10d = closeArr.slice(-30, -10).reduce((a, b) => a + b, 0) / 20;
      if (ma20 < ma20_10d) return null;
    }

    // ⑥ 收盘价在 MA5 之上（必须站在5日线上方）
    if (closeArr[len - 1] <= ma5) return null;

    // ⑦ 回踩确认形态检测
    let isPullbackRecovery = false;
    if (len >= 6) {
      const ma5_yest = closeArr.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
      if (closeArr[len - 2] < ma5_yest * 0.99) {
        // 昨日跌破MA5 → 检测是否为"回踩确认"形态
        const ma20_arr: number[] = [];
        for (let i = Math.max(0, len - 20); i < len; i++) ma20_arr.push(closeArr[i]);
        const ma20_recent = ma20_arr.length >= 20
          ? ma20_arr.slice(-20).reduce((a, b) => a + b, 0) / 20
          : ma20_arr.reduce((a, b) => a + b, 0) / ma20_arr.length;

        isPullbackRecovery =
          closeArr[len - 1] >= ma5 &&                // 今日收复MA5
          closeArr[len - 1] > closeArr[len - 2] &&   // 今日上涨
          Math.min(...closeArr.slice(-5)) > ma20_recent * 0.97; // 回踩未破MA20

        if (!isPullbackRecovery) return null;
      }
    }

    // ---------- 价格位置 ----------
    const highs = kline.map(k => k.high);
    const lows = kline.map(k => k.low);
    const periodHigh = Math.max(...highs.slice(-60));
    const periodLow = Math.min(...lows.slice(-60));
    const pricePosition = periodHigh > periodLow
      ? ((closeArr[len - 1] - periodLow) / (periodHigh - periodLow)) * 100
      : 50;

    if (pricePosition >= this.POSITION_THRESHOLD && !isPullbackRecovery && !hasQiangShiHuiCai) return null;

    // ---------- 涨幅检查 (对所有通过股票都计算, 仅金叉股限制涨幅过快) ----------
    let priceIncrease = 0;
    const lookbackDays = Math.max(1, goldenCrossDays || 15);
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
    if (isBaiXiaoBuy && (isPullbackRecovery || hasQiangShiHuiCai)) {
      buySignal = '白消启动回踩';
    } else if (isBaiXiaoBuy) {
      buySignal = '白消启动突破';
    } else if (hasQiangShiHuiCai) {
      buySignal = '强势回踩';
    } else if (isBaiXiaoActive && bxDays >= 3) {
      buySignal = '白消蓄力';
    } else if (isPullbackRecovery) {
      buySignal = '回踩确认';
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
    const hasBuySignalR = isBaiXiaoBuy || hasQiangShiHuiCai || isPullbackRecovery;
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
      if (trendStateR >= 2 && hasBuySignalR) suggestionR = '轻仓买入';
      else if (trendStateR === 0) suggestionR = '持有';
      else suggestionR = '持有';
    } else {
      if (longDeclineR && trendStateR === 1 && !macdBullishR && !volumeBullishR) {
        suggestionR = '不要介入';
      } else if (trendStateR === 1 && macdBullishR && volumeBullishR) {
        suggestionR = '买入';
      } else if (trendStateR === 0) {
        suggestionR = hasBuySignalR ? '轻仓买入' : '观望';
      } else if (trendStateR >= 2) {
        suggestionR = (trendStateR >= 3 && hasBuySignalR) ? '重仓买入' : '买入';
      } else {
        suggestionR = hasBuySignalR ? '持有' : '观望';
      }
    }

    // 排除负面建议
    const NEGATIVE_SUGGESTIONS = ['减仓', '卖出', '清仓', '不要介入'];
    if (NEGATIVE_SUGGESTIONS.includes(suggestionR)) return null;

    return {
      capitalRank: 0,
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

    const goldenCrossDays = isGoldenCross ? macdResult.goldenCrossDays : 1;

    // ---------- 趋势二次确认 ----------
    const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = len >= 20 ? closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;

    if (ma5 <= ma10 * 1.001) return null;

    if (len >= 8) {
      const ma5_3d = closeArr.slice(-8, -3).reduce((a, b) => a + b, 0) / 5;
      if (ma5 <= ma5_3d) return null;
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
      if (trendStateR >= 2 && hasBuySignalR) suggestionR = '轻仓买入';
      else if (trendStateR === 0) suggestionR = '持有';
      else suggestionR = '持有';
    } else {
      if (longDeclineR && trendStateR === 1 && !macdBullishR && !volumeBullishR) {
        suggestionR = '不要介入';
      } else if (trendStateR === 1 && macdBullishR && volumeBullishR) {
        suggestionR = '买入';
      } else if (trendStateR === 0) {
        suggestionR = hasBuySignalR ? '轻仓买入' : '观望';
      } else if (trendStateR >= 2) {
        suggestionR = (trendStateR >= 3 && hasBuySignalR) ? '重仓买入' : '买入';
      } else {
        suggestionR = hasBuySignalR ? '持有' : '观望';
      }
    }

    // 排除负面建议：减仓/卖出/清仓/不要介入 → 不入机会区
    const NEGATIVE_SUGGESTIONS = ['减仓', '卖出', '清仓', '不要介入'];
    if (NEGATIVE_SUGGESTIONS.includes(suggestionR)) return null;

    return {
      capitalRank: 0,
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
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const buf = await res.arrayBuffer();
        const raw = iconv.decode(Buffer.from(buf), 'gbk');
        const lines = raw.split('\n').filter(l => l.trim());
        for (const line of lines) {
          // 格式: v_sz300001="51~name~code~price~yclose~...~";
          const match = line.match(/v_sz\d+="(.+?)";?\s*$/);
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

    // 分批查询
    for (let b = 0; b < allCodes.length; b += this.TENANT_BATCH) {
      const batch = allCodes.slice(b, b + this.TENANT_BATCH);
      const url = `https://qt.gtimg.cn/q=${batch.join(',')}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const buf = await res.arrayBuffer();
        const raw = iconv.decode(Buffer.from(buf), 'gbk');
        const lines = raw.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const match = line.match(/v_(?:sh|sz)\d+="(.+?)";?\s*$/);
          if (!match) continue;
          const fields = match[1].split('~');
          const code = fields[2] || '';
          if (code.startsWith('300') || code.startsWith('301')) continue; // 排除创业板
          if (code.startsWith('688') || code.startsWith('689')) continue; // 排除科创板
          const curPrice = parseFloat(fields[3]);
          const yestClose = parseFloat(fields[4]);
          const changePct = yestClose > 0 ? ((curPrice - yestClose) / yestClose) * 100 : 0;
          if (changePct < this.MIN_GAIN_PCT) continue;
          const name = fields[1] || '';
          if (name.includes('ST') || name.includes('*ST') || name.includes('退')) continue; // 排除ST/退市/爆雷股
          const marketCap = parseFloat(fields[37]) || 0;
          if (marketCap > 0 && marketCap > this.MAX_MARKET_CAP) continue; // 排除超大市值
          if (marketCap > 0 && marketCap < this.MIN_MARKET_CAP) continue;  // 排除小盘庄股
          const volumeShares = parseFloat(fields[6]) || 0;
          const amount = volumeShares * curPrice;
          candidates.push({
            code,
            name,
            inflow: Math.round(amount),
            changePercent: Math.round(changePct * 100) / 100,
            currentPrice: curPrice,
            marketCap,
          });
        }
      } catch (err) {
        this.logger.warn(`⚠️ 主板行情批 ${b / this.TENANT_BATCH + 1} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    candidates.sort((a, b) => b.changePercent - a.changePercent);
    this.logger.log(`📡 主板: 获取 ${candidates.length} 只上涨, 全量扫描`);
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

    results.sort((a, b) => b.score - a.score);
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
    const ttl = getOpportunityTTL();
    if (!force && this.sectorCache && (Date.now() - this.sectorCache.timestamp < ttl)) {
      return { opportunities: this.sectorCache.data, timestamp: this.sectorCache.timestamp };
    }
    try {
      const http = require('http');
      const sectorData = await new Promise<any>((resolve, reject) => {
        http.get('http://localhost:3000/api/sector/hot', (res: any) => {
          let body = '';
          res.on('data', (chunk: string) => body += chunk);
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('parse fail')); } });
        }).on('error', reject);
      });
      const sectors: any[] = sectorData?.data?.month1 ?? sectorData?.month1 ?? [];
      if (!sectors.length) {
        return { opportunities: [], timestamp: Date.now() };
      }
      // 取涨幅前10的板块
      const topSectors = sectors
        .filter((s: any) => s.changePercent !== undefined)
        .sort((a: any, b: any) => b.changePercent - a.changePercent)
        .slice(0, 10);

      const oppStocks: Array<{ code: string; name: string; sectorName: string }> = [];
      for (const sector of topSectors) {
        const stocks = sector.opportunityStocks ?? sector.leadingStocks ?? [];
        for (const s of stocks) {
          oppStocks.push({ code: s.code, name: s.name, sectorName: sector.name });
        }
      }

      const results: OpportunityStock[] = [];
      await Promise.all(oppStocks.slice(0, 30).map(async (s) => {
        try {
          const stock = await this.quickAnalyze(s.code, s.name);
          if (stock) {
            (stock as any).sectorName = s.sectorName;
            results.push(stock);
          }
        } catch {}
      }));

      const ORDER: Record<string, number> = {
        '重仓买入': 0, '买入': 1, '轻仓买入': 2, '准备买入': 3,
        '持有': 4, '观望': 5, '减仓': 6, '卖出': 7, '清仓': 8,
      };
      results.sort((a, b) => {
        const pa = ORDER[a.suggestion ?? ''] ?? 99;
        const pb = ORDER[b.suggestion ?? ''] ?? 99;
        return pa !== pb ? pa - pb : (b.score ?? 0) - (a.score ?? 0);
      });
      const top = results.slice(0, 10);
      this.sectorCache = { data: top, timestamp: Date.now() };
      return { opportunities: top, timestamp: this.sectorCache.timestamp };
    } catch (e) {
      return { opportunities: [], timestamp: Date.now() };
    }
  }

  async scanTopGem(force = false): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    const ttl = getOpportunityTTL();
    // 缓存过期 或 缓存数据没有 suggestion（旧格式迁移）→ 触发重新扫描
    const cacheStale = this.cache?.data?.length && this.cache.data.every(s => !s.suggestion);
    if (!force && this.cache && (Date.now() - this.cache.timestamp < ttl) && !cacheStale) {
      this.triggerAnalysisPreCache(this.cache.data);
      return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
    }
    if (cacheStale) this.logger.log('🔄 缓存数据缺少 suggestion 字段, 强制重新扫描');
    const data = await this.scanTopFromCandidates(async () => this.fetchGEMCandidates(), 10);
    this.cache = { data, timestamp: Date.now() };
    return { opportunities: data, timestamp: this.cache.timestamp };
  }

  /**
   * 扫描主板Top10机会股
   */
  async scanTopMainBoard(force = false): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    const ttl = getOpportunityTTL();
    // 缓存过期 或 缓存数据没有 suggestion（旧格式迁移）→ 触发重新扫描
    const cacheStale = this.mainBoardCache?.data?.length && this.mainBoardCache.data.every(s => !s.suggestion);
    if (!force && this.mainBoardCache && (Date.now() - this.mainBoardCache.timestamp < ttl) && !cacheStale) {
      this.triggerAnalysisPreCache(this.mainBoardCache.data);
      return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
    }
    if (cacheStale) this.logger.log('🔄 主板缓存缺少 suggestion 字段, 强制重新扫描');
    const data = await this.scanTopFromCandidates(async () => this.fetchMainBoardCandidates(), 10);
    this.mainBoardCache = { data, timestamp: Date.now() };
    return { opportunities: data, timestamp: this.mainBoardCache.timestamp };
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
      return pa !== pb ? pa - pb : (b.score ?? 0) - (a.score ?? 0);
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
      return pa !== pb ? pa - pb : (b.score ?? 0) - (a.score ?? 0);
    });
    return results.slice(0, topN);
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

    // 排除预测文本包含负面关键词的（即使 action 为正，但预测偏弱就不应入选）
    const NEGATIVE_PREDICTION_KEYWORDS = ['偏弱', '探底', '风险较大', '风险大', '回落', '震荡', '注意风险'];
    if (NEGATIVE_PREDICTION_KEYWORDS.some(kw => predictionText.includes(kw))) return null;

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
}