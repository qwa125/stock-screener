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
import { pinyin } from 'pinyin-pro';
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
  turnoverRate?: number;
  volumeRatio?: number;
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
  ma5?: number;       // 5日均线价
  ma10?: number;      // 10日均线价
  isGoldenCross?: boolean;
  /** 服务端计算的交易建议，与详情页完全一致 */
  suggestion?: string;
  /** 最佳介入时机评分 (0-100)，越高越好 */
  entryTiming: number;
  /** 安全系数评分 (0-100)，越高越安全 */
  safetyScore: number;
  /** 白消白布信号组合说明 */
  signalCombination?: string;
  /** 卖出信号说明 */
  sellSignal?: string;
  /** 机构活跃度评分 */
  jiGouActiveScore?: number;
  /** 筹码集中度(0-100, 越低越集中) */
  chipConcentration90?: number;
  /** 筹码峰位: low=下方支撑, mid=当前附近, high=上方压力 */
  chipPeakPosition?: 'low' | 'mid' | 'high';
  /** 筹码形态: single_peak=单峰集中, double_peak=双峰, dispersed=分散 */
  chipPattern?: 'single_peak' | 'double_peak' | 'dispersed';
  /** 独立趋势预测 */
  trendPrediction?: {
    direction: string;
    score: number;
    reason: string;
    details: Record<string, any>;
  };
  /** 评分系统未来1-2日预测: 多因子评分对未来短期走势的预测判断 */
  forecast1_2Day?: {
    direction: string;    // 强烈看涨|看涨|震荡偏强|方向不明|震荡偏弱|看跌
    confidence: string;   // 高|中|低|--
    detail: string;       // 预测依据说明
  };
}

@Injectable()
export class GemScreenerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GemScreenerService.name);
  private readonly CACHE_TTL = 3 * 60 * 1000;
  private readonly STALE_TTL = 30 * 60 * 1000;
  private readonly REFRESH_INTERVAL = 5 * 60 * 1000; // 盘中每5分钟全量扫描
  private readonly CACHE_FILE = '/tmp/gem-opportunities-cache.json';
  private readonly SELL_STATE_FILE = '/tmp/sell-state-cache.json';
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
    '重仓买入': 1, '买入': 2, '轻仓买入': 3,
    '持有': 4, '减仓': 5, '卖出': 6, '不要介入': 7,
  };

  private cache: CacheEntry | null = null;
  private refreshPromise: Promise<void> | null = null;
  private mainBoardCache: CacheEntry | null = null;
  private sellStateCache = new Map<string, { suggestion: string; timestamp: number }>();
  private soldOutStocks = new Set<string>();
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

  // ─── 卖出锁定持久化 ───

  constructor(
    private readonly dataFetcher: DataFetcherService,
    private readonly stockService: StockService,
  ) {
    this.updateMarketHoursBeganAt();
    this.loadCacheFromDisk();
    this.loadMainBoardCacheFromDisk();
    this.loadSectorCacheFromDisk();
    this.loadSellStateCache();
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
        const limitedData = parsed.data; // 全量保留，不截断
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
          const limitedData = parsed.data // 全量保留，不截断;
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
        const limitedData = parsed.data // 全量保留，不截断;
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
          const limitedData = parsed.data // 全量保留，不截断;
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
        const limitedData = parsed.data // 全量保留，不截断;
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
          const limitedData = parsed.data // 全量保留，不截断;
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

  // ─── 卖出锁定持久化 ───
  private loadSellStateCache() {
    try {
      if (existsSync(this.SELL_STATE_FILE)) {
        const raw = readFileSync(this.SELL_STATE_FILE, 'utf-8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const item of arr) {
            this.sellStateCache.set(item.code, { suggestion: item.suggestion, timestamp: item.timestamp });
          }
        }
        // 清理旧的减仓锁定（减仓不触发锁定，只有卖出才锁定）
        for (const [code, val] of this.sellStateCache.entries()) {
          if (val.suggestion === '减仓') {
            this.sellStateCache.delete(code);
          }
        }
        this.logger.log(`📂 加载卖出锁定: ${this.sellStateCache.size} 只`);
      }
    } catch (err) {
      this.logger.warn(`⚠️ 卖出锁定文件读取失败: ${err.message}`);
    }
  }

  private async saveSellStateCache() {
    try {
      const arr = Array.from(this.sellStateCache.entries()).map(([code, val]) => ({
        code, suggestion: val.suggestion, timestamp: val.timestamp
      }));
      await fs.writeFile(this.SELL_STATE_FILE, JSON.stringify(arr), 'utf-8');
    } catch (err) {
      this.logger.warn(`⚠️ 卖出锁定写入失败: ${err.message}`);
    }
  }

  /**
   * 从前端同步卖出锁定状态（前端在doFullRescan中检测到暴跌等卖点后推送）
   */
  syncSellStateFromFrontend(sellStates: { code: string; suggestion: string }[]) {
    const now = Date.now();
    for (const item of sellStates) {
      if (['卖出'].includes(item.suggestion)) {
        this.sellStateCache.set(item.code, { suggestion: item.suggestion, timestamp: now });
      }
    }
    this.saveSellStateCache();
    this.logger.log(`📝 前端同步卖出锁定: ${sellStates.length} 条`);
  }

  // ---------------------------------------------------------------------------
  // 公开 API
  // ---------------------------------------------------------------------------
  async getOpportunities(): Promise<{ opportunities: OpportunityStock[]; timestamp: number }> {
    // Render美国服务器调不通中国API(腾讯/东方财富)，不发起任何主动扫描
    // 仅返回磁盘缓存的旧数据，由前端浏览器从中国拉数据POST到 /api/gem/refresh
    // 合并 GEM + 主板缓存，确保全量股票都返回，不遗漏卖出/减仓/不要介入信号
    const allData: OpportunityStock[] = [];
    let latestTs = 0;

    if (this.cache && this.cache.data?.length > 0) {
      allData.push(...this.cache.data);
      if (this.cache.timestamp > latestTs) latestTs = this.cache.timestamp;
    }
    if (this.mainBoardCache && this.mainBoardCache.data?.length > 0) {
      // 去重：避免同一只股票出现在两个缓存中
      const gemCodes = new Set<string>();
      for (const s of this.cache?.data || []) gemCodes.add(s.code);
      for (const s of this.mainBoardCache.data) {
        if (!gemCodes.has(s.code)) allData.push(s);
      }
      if (this.mainBoardCache.timestamp > latestTs) latestTs = this.mainBoardCache.timestamp;
    }

    if (allData.length > 0) {
      // 旧缓存升级：给旧格式数据补上 signalCombination / jiGouActiveScore
      this.upgradeCacheFields(allData);
      this.addForecastToCache(allData);
      // 注意：不能在Render上调用triggerAnalysisPreCache，腾讯API会超时导致进程卡死
      // 重新生成缓存建议（与服务器算法一致，确保搜索和主列表结果匹配）
      this.recalculateSuggestions(allData);

      // ─── 卖出锁定 + 趋势预测 ───
      const now = Date.now();
      for (const s of allData) {
        // 卖出锁定：检查 sellStateCache
        const sellEntry = this.sellStateCache.get(s.code);
        if (sellEntry) {
          // recalculateSuggestions 已在上方运行，s.suggestion 为最新结果
          // 检查是否出现真实买入信号 → 自动解除锁定（不考时间，只靠信号）
          const hasBuySignal =
            ['重仓买入', '买入'].includes(s.suggestion || '') &&
            s.isGoldenCross === true &&
            (s.entryTiming ?? 0) >= 50;
          if (hasBuySignal) {
            // 🎯 出现真实买入信号，自动解除卖出锁定
            this.sellStateCache.delete(s.code);
            this.logger.log(`🔓 ${s.name}(${s.code}) 出现买入信号，自动解除卖出锁定`);
          } else {
            // 🔒 卖出锁定生效：覆盖为不要介入
            s.suggestion = '不要介入';
            s.trendPrediction = { direction: '方向不明', score: 30, reason: '卖出锁定中', details: {} };
            continue;
          }
        }

        // 简化趋势预测（无K线，用缓存字段推断）
        s.trendPrediction = this.calcSimpleTrendPrediction(s);
      }

      // 持久化 sellStateCache
      this.saveSellStateCache();

      return { opportunities: allData, timestamp: latestTs };
    }
    return { opportunities: [], timestamp: Date.now() };
  }

  // 旧缓存字段升级：新后端代码新增了 signalCombination / jiGouActiveScore，
  // 旧缓存中没有，从现有字段推导补充
  private addForecastToCache(data: OpportunityStock[]) {
    if (!data || data.length === 0) return;
    for (const s of data) {
      // 无论是否已有预测，都重新计算（确保格式统一为对象，兼容旧缓存的JSON字符串）
      s.forecast1_2Day = GemScreenerService.computeTechnicalForecast({
        entryTiming: s.entryTiming ?? 0,
        isGoldenCross: s.isGoldenCross ?? false,
        ma5: s.ma5 ?? 0,
        ma10: s.ma10 ?? 0,
        pricePosition: s.pricePosition ?? 50,
        mainForceInflow: s.mainForceInflow ?? 0,
        jiGouActiveScore: s.jiGouActiveScore ?? 0,
      });
    }
  }

  private upgradeCacheFields(data: OpportunityStock[]) {
    if (!data || data.length === 0) return;
    // 已有新字段则跳过
    if (data[0].chipConcentration90 !== undefined) return;
    for (const s of data) {
      // 根据 suggestion 推导 signalCombination
      const sig = s.suggestion || '';
      const pos = s.pricePosition || 0;
      const gc = s.isGoldenCross;
      const ok = s.entryTiming && s.entryTiming >= 60 ? '强' : '弱';
      if (sig === '重仓买入') {
        s.signalCombination = pos < 25 ? '白消信号+低位' : '白消信号+强势';
      } else if (sig === '买入') {
        s.signalCombination = pos < 45 ? '白消信号+中低位' : '白消信号+趋势';
      } else if (sig === '轻仓买入') {
        s.signalCombination = '白消信号';
      } else {
        s.signalCombination = '';
      }
      // 推导 jiGouActiveScore
      s.jiGouActiveScore = s.jiGouActiveScore ?? Math.round(((s.entryTiming || 0) / 100 * 20) * 100) / 100;
      // 推导芯片筹码字段（旧缓存缺失）
      s.chipConcentration90 = s.chipConcentration90 ?? 50;
      s.chipPeakPosition = s.chipPeakPosition ?? 'mid';
          s.chipPattern = s.chipPattern ?? 'dispersed';
    }
  }

  /** 重新生成缓存建议，与服务器分析算法保持一致 */
  recalculateSuggestions(data: OpportunityStock[]) {
    for (const s of data) {
      // 已有信号（来自 signalRule 的白布+清仓/紧急清仓/主力出货等）→ 不覆盖
      if (s.suggestion) continue;

      // 暴跌 → 卖出（兜底，正常情况下signalRule已处理）
      if (s.changePercent <= -5) {
        s.suggestion = '卖出';
        s.score = Math.min(s.score, 35);
        continue;
      }

      // 大幅下跌 + 死叉 → 减仓（兜底）
      if (s.changePercent <= -3 && !s.isGoldenCross) {
        s.suggestion = '减仓';
        s.score = Math.min(s.score, 45);
        continue;
      }

      // 下跌趋势(MA5 < MA10)没信号 → 不要介入
      if ((s.ma5 ?? 0) < (s.ma10 ?? 0)) {
        s.suggestion = '不要介入';
        s.score = Math.min(s.score, 30);
        continue;
      }

      // 上涨趋势没信号 → 持有
      s.suggestion = '持有';
    }
  }

  /** 不调外部API，只对已有缓存重算信号并写回磁盘 */
  async recalcCacheSignals(): Promise<{ total: number; updated: number }> {
    let total = 0;
    const allData: OpportunityStock[] = [];
    if (this.cache?.data) { allData.push(...this.cache.data); total += this.cache.data.length; }
    if (this.mainBoardCache?.data) { allData.push(...this.mainBoardCache.data); total += this.mainBoardCache.data.length; }
    this.recalculateSuggestions(allData);
    // 写回磁盘
    if (this.cache?.data) await this.saveCacheToDisk();
    if (this.mainBoardCache?.data) await this.saveMainBoardCacheToDisk();
    this.logger.log(`✅ 缓存信号重算完成: ${total}只`);
    return { total, updated: total };
  }

  /** 获取全量缓存 */
  getCacheAll(): OpportunityStock[] {
    const all: OpportunityStock[] = [];
    if (this.cache?.data) all.push(...this.cache.data);
    if (this.mainBoardCache?.data) all.push(...this.mainBoardCache.data);
    // 去重 (以 code 为准)
    const seen = new Set<string>();
    return all.filter(s => {
      if (seen.has(s.code)) return false;
      seen.add(s.code);
      return true;
    });
  }

  /** 单只股票分析后更新缓存：搜索/分析接口调用后写回，机会列表自动同步 */
  async updateSingleStockInCache(opp: OpportunityStock): Promise<void> {
    const code = opp.code;
    // 尝试更新 GEM 缓存
    let found = false;
    if (this.cache?.data) {
      const idx = this.cache.data.findIndex(s => s.code === code);
      if (idx >= 0) {
        this.cache.data[idx] = { ...this.cache.data[idx], ...opp };
        found = true;
      }
    }
    // 尝试更新主板缓存
    if (!found && this.mainBoardCache?.data) {
      const idx = this.mainBoardCache.data.findIndex(s => s.code === code);
      if (idx >= 0) {
        this.mainBoardCache.data[idx] = { ...this.mainBoardCache.data[idx], ...opp };
        found = true;
      }
    }
    // 都不在缓存中则忽略（新股票，没在机会列表里）
    if (found) {
      await this.saveCacheToDisk();
      await this.saveMainBoardCacheToDisk();
      this.logger.log(`📝 缓存已更新: ${opp.code} ${opp.name} 信号=${opp.suggestion} 评分=${opp.score}`);
    }
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
    // 加载卖出状态持久缓存
    await this.loadSellStateCache();

    }

  // ---------------------------------------------------------------------------
  // KDJ 计算 (RSV=9日, K/D平滑3, J=3K-2D)
  // ---------------------------------------------------------------------------
  calcKDJ(kline: KLine[]): { k: number; d: number; j: number; trend: 'up' | 'down' | 'flat'; prevJ: number; jUp: boolean } {
    const high = kline.map(k => k.high);
    const low = kline.map(k => k.low);
    const close = kline.map(k => k.close);
    const len = close.length;
    if (len < 15) return { k: 50, d: 50, j: 50, trend: 'flat', prevJ: 50, jUp: false };

    const rsvArr: number[] = [];
    for (let i = 8; i < len; i++) {
      const h9 = Math.max(...high.slice(i - 8, i + 1));
      const l9 = Math.min(...low.slice(i - 8, i + 1));
      const rsv = h9 > l9 ? ((close[i] - l9) / (h9 - l9)) * 100 : 50;
      rsvArr.push(rsv);
    }

    // K/D smoothing
    const kArr: number[] = [50];
    const dArr: number[] = [50];
    for (let i = 0; i < rsvArr.length; i++) {
      const kVal = (2 / 3) * (kArr[i] || 50) + (1 / 3) * rsvArr[i];
      const dVal = (2 / 3) * (dArr[i] || 50) + (1 / 3) * kVal;
      kArr.push(kVal);
      dArr.push(dVal);
    }
    const k = kArr[kArr.length - 1];
    const d = dArr[dArr.length - 1];
    const j = 3 * k - 2 * d;
    const prevK = kArr.length > 2 ? kArr[kArr.length - 2] : 50;
    const prevD = dArr.length > 2 ? dArr[dArr.length - 2] : 50;
    const prevJ = 3 * prevK - 2 * prevD;
    const jUp = j > prevJ;
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (jUp && k > d) trend = 'up';
    else if (!jUp && k < d) trend = 'down';
    return { k, d, j, trend, prevJ, jUp };
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
    if (len < 20) {
      return { diff: [], dea: [], currentDiff: 0, currentDea: 0, isGoldenCross: false, goldenCrossDays: 0, isDeathCross: false };
    }

    // ---------- 自适应均线: 短K线用可用数据计算 (除数随实际长度调整) ----------
    const avgLine: number[] = [];
    for (let i = Math.min(33, Math.floor(len / 2)); i < len; i++) {
      const ma3  = closes.slice(Math.max(0, i - 2),  i + 1).reduce((a, b) => a + b, 0) / Math.min(3, i + 1);
      const ma5  = closes.slice(Math.max(0, i - 4),  i + 1).reduce((a, b) => a + b, 0) / Math.min(5, i + 1);
      const ma8  = closes.slice(Math.max(0, i - 7),  i + 1).reduce((a, b) => a + b, 0) / Math.min(8, i + 1);
      const ma13 = closes.slice(Math.max(0, i - 12), i + 1).reduce((a, b) => a + b, 0) / Math.min(13, i + 1);
      const ma21 = closes.slice(Math.max(0, i - 20), i + 1).reduce((a, b) => a + b, 0) / Math.min(21, i + 1);
      const ma34Count = Math.min(34, i + 1);
      const ma34 = closes.slice(Math.max(0, i - ma34Count + 1), i + 1).reduce((a, b) => a + b, 0) / ma34Count;
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
   * 简化趋势预测（无K线时使用缓存字段推断）
   */
  private calcSimpleTrendPrediction(s: OpportunityStock): any {
    // 使用缓存数据推断趋势方向
    const direction = s.trendPrediction?.direction || '方向不明';
    const score = s.trendPrediction?.score || 50;
    const reason = s.trendPrediction?.reason || '缓存数据推断';
    return { direction, score, reason, details: {} };
  }

  /**
   * 独立趋势预测（7因子评分），不依赖当前信号
   * 只要有K线数据就能独立计算，不受任何信号锁影响
   */
  calcTrendPrediction(kline: any[], result?: any): any {
    try {
      if (!kline || kline.length < 30) {
        return { direction: '方向不明', score: 0, reason: 'K线数据不足(需≥30天)', signals: [] };
      }

      const closes = kline.slice(-120).map((k: any) => Number(k.close));
      const highs = kline.slice(-120).map((k: any) => Number(k.high));
      const lows = kline.slice(-120).map((k: any) => Number(k.low));
      const volumes = kline.slice(-120).map((k: any) => Number(k.volume) || 0);
      const price = closes[closes.length - 1];
      const signals: string[] = [];
      let totalScore = 0;

      // ① 价格位置 (20分) - 20日相对位置
      const last20 = closes.slice(-20);
      const min20 = Math.min(...last20);
      const max20 = Math.max(...last20);
      const pos20 = ((price - min20) / (max20 - min20)) * 100;
      if (pos20 < 20) { totalScore += 18; signals.push('超卖区间(20日低位)'); }
      else if (pos20 < 35) { totalScore += 14; signals.push('偏低位'); }
      else if (pos20 > 80) { totalScore += 2; signals.push('超买区间(20日高位)'); }
      else if (pos20 > 65) { totalScore += 6; signals.push('偏高位置'); }
      else { totalScore += 10; signals.push('中位震荡'); }

      // ② MACD动量 (20分) - 底背离检测
      const ema12 = closes.reduce((a: number, c: number, i: number) => i === 0 ? c : a * 11 / 13 + c * 2 / 13, 0);
      const ema26 = closes.reduce((a: number, c: number, i: number) => i === 0 ? c : a * 25 / 27 + c * 2 / 27, 0);
      const dif = ema12 - ema26;
      const macdBar = closes.slice(-12).map((_: any, i: number, arr: number[]) => {
        if (i < 11) return 0;
        const e12 = arr.slice(i - 11, i + 1).reduce((a: number, c: number) => a * 11 / 13 + c * 2 / 13, 0);
        const e26 = arr.slice(i - 25, i + 1).reduce((a: number, c: number) => a * 25 / 27 + c * 2 / 27, 0);
        return e12 - e26;
      });
      const lastBars = macdBar.slice(-5);
      const barRising = lastBars.length >= 2 && lastBars[lastBars.length - 1] > lastBars[0];
      // 底背离检测：价格新低但MACD不创新低
      const recentLows = closes.slice(-10);
      const recentMacdBars = macdBar.slice(-10);
      const priceLow = Math.min(...recentLows);
      const priceLowIdx = recentLows.indexOf(priceLow);
      const macdLowAtPriceLow = recentMacdBars[priceLowIdx];
      const macdNow = recentMacdBars[recentMacdBars.length - 1];
      const divergence = priceLow < recentLows[recentLows.length - 1] && macdNow > macdLowAtPriceLow;
      if (divergence) { totalScore += 18; signals.push('MACD底背离(强烈反转信号)'); }
      else if (barRising && dif > 0) { totalScore += 14; signals.push('MACD柱上升+正值'); }
      else if (dif > 0) { totalScore += 10; signals.push('MACD正值'); }
      else if (barRising) { totalScore += 8; signals.push('MACD柱上升(负值收窄)'); }
      else { totalScore += 4; signals.push('MACD负值走弱'); }

      // ③ K线形态 (15分)
      const last3Closes = closes.slice(-3);
      const last3Lows = lows.slice(-3);
      const last3Highs = highs.slice(-3);
      const l1 = last3Closes[last3Closes.length - 1], l2 = last3Closes[last3Closes.length - 2], l3 = last3Closes[last3Closes.length - 3];
      const h1 = last3Highs[last3Highs.length - 1], h3 = last3Highs[last3Highs.length - 3];
      const lo1 = last3Lows[last3Lows.length - 1], lo3 = last3Lows[last3Lows.length - 3];
      // 锤子线：下影线长，实体小
      const hammer = lo1 < l1 * 0.97 && h1 < l1 * 1.03;
      // 启明星：大阴→小实体→大阳
      const morningStar = l3 < l2 * 0.95 && Math.abs(l2 - l1) < 0.3 && l1 > l2 * 1.02;
      // 看涨吞没：今日阳线完全覆盖昨日阴线
      const bullishEngulf = l1 > l2 && l1 > h3 && l3 > l2;
      // 低位十字星
      const crossStar = Math.abs(closes[closes.length - 1] - (lows[lows.length - 1] + highs[highs.length - 1]) / 2) < 0.1;
      if (morningStar) { totalScore += 15; signals.push('启明星(强烈反弹信号)'); }
      else if (bullishEngulf) { totalScore += 13; signals.push('看涨吞没'); }
      else if (hammer) { totalScore += 11; signals.push('锤子线(探底回升)'); }
      else if (crossStar) { totalScore += 9; signals.push('低位十字星(变盘信号)'); }
      else if (l1 > l2) { totalScore += 7; signals.push('阳线收盘'); }
      else { totalScore += 3; signals.push('阴线收盘'); }

      // ④ 成交量 (10分)
      const avgVol20 = volumes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      const avgVol5 = volumes.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
      const lastVol = volumes[volumes.length - 1];
      if (l1 > l2 && lastVol > avgVol5 * 1.5) { totalScore += 10; signals.push('放量上涨'); }
      else if (l1 > l2 && lastVol > avgVol5) { totalScore += 8; signals.push('温和放量上涨'); }
      else if (l1 < l2 && lastVol < avgVol20 * 0.7) { totalScore += 7; signals.push('缩量下跌(卖压衰竭)'); }
      else if (l1 < l2 && lastVol > avgVol5 * 1.3) { totalScore += 3; signals.push('放量下跌'); }
      else { totalScore += 5; signals.push('成交量中性'); }

      // ⑤ 趋势状态 (10分) - 均线排列
      const ma5 = closes.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
      const ma10 = closes.slice(-10).reduce((a: number, b: number) => a + b, 0) / 10;
      const ma20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      if (ma5 > ma10 && ma10 > ma20) { totalScore += 10; signals.push('均线多头排列'); }
      else if (ma5 > ma10) { totalScore += 7; signals.push('短期均线上行'); }
      else if (ma5 < ma10 && ma10 < ma20) { totalScore += 3; signals.push('均线空头排列'); }
      else { totalScore += 5; signals.push('均线交叉整理'); }

      // ⑥ KDJ J值 (15分)
      const rsv9 = (price - Math.min(...lows.slice(-9))) / (Math.max(...highs.slice(-9)) - Math.min(...lows.slice(-9))) * 100 || 50;
      const kVal = rsv9;  // 简化K值
      const dVal = kVal * 2 / 3 + 50 / 3;  // 简化D值
      const jVal = 3 * kVal - 2 * dVal;
      if (jVal < 20) { totalScore += 14; signals.push('KDJ超卖(J<20)'); }
      else if (jVal < 40) { totalScore += 11; signals.push('KDJ偏低'); }
      else if (jVal > 80) { totalScore += 4; signals.push('KDJ超买(J>80)'); }
      else if (jVal > 60) { totalScore += 7; signals.push('KDJ偏高'); }
      else { totalScore += 9; signals.push('KDJ中性'); }

      // ⑦ 布林带 (10分)
      const bbMa20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      const bbStd = Math.sqrt(closes.slice(-20).reduce((a: number, b: number) => a + Math.pow(b - bbMa20, 2), 0) / 20);
      const bbUpper = bbMa20 + 2 * bbStd;
      const bbLower = bbMa20 - 2 * bbStd;
      if (price <= bbLower * 1.01) { totalScore += 10; signals.push('触及布林下轨(超卖反弹)'); }
      else if (price <= bbLower * 1.05) { totalScore += 8; signals.push('接近布林下轨'); }
      else if (price >= bbUpper * 0.99) { totalScore += 3; signals.push('触及布林上轨(压力)'); }
      else if (price >= bbUpper * 0.95) { totalScore += 5; signals.push('接近布林上轨'); }
      else { totalScore += 7; signals.push('布林中轨附近'); }

      // 综合方向判断
      let direction: string;
      if (totalScore >= 85) direction = '强烈看涨';
      else if (totalScore >= 70) direction = '看涨';
      else if (totalScore >= 55) direction = '震荡偏强';
      else if (totalScore >= 40) direction = '方向不明';
      else if (totalScore >= 25) direction = '震荡偏弱';
      else if (totalScore >= 15) direction = '看跌';
      else direction = '强烈看跌';

      return {
        direction,
        score: Math.max(-100, Math.min(100, totalScore)),
        reason: signals.join('；') || '无明显信号',
        signals,
      };
    } catch (e) {
      return { direction: '方向不明', score: 0, reason: '计算异常', signals: [] };
    }
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
    if (results.length <= 10) {
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
    const finalResults = results.slice(0, 30);
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
    const finalResults = deduped.slice(0, 30);
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
    const finalResults = dedupedMain.slice(0, 30);
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
    const finalResults = dedupedSector.slice(0, 30);
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
      this.logger.log('  ⏳ 正在全量扫描创业板(300xxx)...');
      try {
        await Promise.race([
          this['scanAllStocks'](),
          new Promise((_, rej) => setTimeout(() => rej(new Error('扫描超时')), 180000))
        ]);
      } catch (scanErr) {
        this.logger.warn(`  创业板扫描异常: ${scanErr.message}，使用当前缓存`);
      }

      this.logger.log('  ⏳ 正在全量扫描主板(000xxx+002xxx+600xxx+603xxx+605xxx等)...');
      try {
        await Promise.race([
          this['scanMainBoardStocks'](),
          new Promise((_, rej) => setTimeout(() => rej(new Error('扫描超时')), 180000))
        ]);
      } catch (scanErr) {
        this.logger.warn(`  主板扫描异常: ${scanErr.message}，使用当前缓存`);
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
  // ═══════════════════════════════════════════════════════════════════════════
  // 多因子评分引擎：14项因子综合评分 → 映射标签
  // ═══════════════════════════════════════════════════════════════════════════
  private calcMultiScore(s: StockCandidate, kline: KLine[]): {
    score: number; factorCount: number; maxScore: number; detail: string;
    factors: { name: string; met: boolean; points: number }[];
    trendState: number; pricePosition: number; priceIncrease: number; isGoldenCross: boolean;
    bxDays: number; bx: any; buySignal: string;
    signals: any; sanJiao: any; lingXing: any; engine: any;
    hasStrongSell: boolean; hasChuHuo: boolean;
    ma5: number; ma10: number; ma20: number; ma60: number;
    macd: any; kdj: any; volumeRatio: number; volatility20d: number;
    chip: any; closeArr: number[]; openArr: number[];
  } | null {
    const closeArr = kline.map(k => k.close);
    const len = closeArr.length;
    if (len < 20) return null;

    const highArr = kline.map(k => k.high);
    const lowArr = kline.map(k => k.low);
    const volArr = kline.map(k => k.volume || 0);
    const amtArr = kline.map(k => k.amount || 0);
    const openArr = kline.map(k => k.open);
    const currentClose = closeArr[len - 1];

    // 排除ST/银行保险
    if (/^(\*)?ST/.test(s.name)) return null;
    const excludeKeywords = ['银行', '保险', '农商', '兴业银', '中国人寿', '中国平安', '中国人保', '中国太保', '新华保险'];
    for (const kw of excludeKeywords) { if (s.name.includes(kw)) return null; }

    // ---------- 计算所有指标 ----------
    // 1. MACD
    const macd = this.calcCustomMACD(kline);
    // 2. KDJ
    const kdj = this.calcKDJ(kline);
    // 3. 均线
    const ma5 = len >= 5 ? closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5 : closeArr.reduce((a, b) => a + b, 0) / len;
    const ma10 = len >= 10 ? closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10 : closeArr.reduce((a, b) => a + b, 0) / len;
    const ma20 = len >= 20 ? closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;
    const ma60 = len >= 60 ? closeArr.slice(-60).reduce((a, b) => a + b, 0) / 60 : ma20;
    // 4. BOLL
    const bollMid = ma20;
    const bollStd = len >= 20 ? Math.sqrt(closeArr.slice(-20).reduce((s, c) => s + (c - bollMid) ** 2, 0) / 20) : 0;
    const bollUpper = bollMid + 2 * bollStd;
    const bollLower = bollMid - 2 * bollStd;
    // 5. 趋势状态
    let trendState = 1;
    if (ma5 > ma10 * 1.02 && ma10 > ma20 * 1.01) trendState = 3;
    else if (ma5 > ma10 && ma10 > ma20) trendState = 2;
    else if (ma5 <= ma10) trendState = 0;
    // 6. 价格位置（60日）
    const periodHigh = Math.max(...highArr.slice(-60));
    const periodLow = Math.min(...lowArr.slice(-60));
    const pricePosition = periodHigh > periodLow ? ((currentClose - periodLow) / (periodHigh - periodLow)) * 100 : 50;
    // 7. 涨幅检查
    const goldenCrossDays = macd.goldenCrossDays || 15;
    const lookbackDays = Math.max(1, goldenCrossDays);
    const triggerIdx = len - 1 - lookbackDays;
    const triggerClose = triggerIdx >= 0 ? kline[triggerIdx].close : kline[0].close;
    const priceIncrease = ((currentClose - triggerClose) / triggerClose) * 100;
    // 8. 量比
    const avgVol30 = volArr.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, volArr.length);
    const avgVol5 = volArr.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, volArr.length);
    const volumeRatio = avgVol30 > 0 ? avgVol5 / avgVol30 : 1;
    // 9. 3日涨幅
    const close3dAgo = len >= 4 ? closeArr[len - 4] : closeArr[0];
    const chg3d = ((currentClose - close3dAgo) / close3dAgo) * 100;
    // 10. 20日波动率
    const returns20: number[] = [];
    for (let i = len - 20; i < len && i > 0; i++) {
      returns20.push((closeArr[i] - closeArr[i - 1]) / closeArr[i - 1]);
    }
    const meanR = returns20.length > 0 ? returns20.reduce((a, b) => a + b, 0) / returns20.length : 0;
    const variance20 = returns20.length > 0 ? returns20.reduce((s, r) => s + (r - meanR) ** 2, 0) / returns20.length : 0;
    const volatility20d = Math.sqrt(variance20) * 100 * Math.sqrt(252); // 年化波动率%
    // 11. 白消 + 白三角 + 白菱形
    const engine = new FormulaEngine({ open: openArr, close: closeArr, high: highArr, low: lowArr, volume: volArr, amount: amtArr });
    const bx = calcBaiXing(engine);
    const sanJiao = calcBaiSanJiao(engine);
    const lingXing = calcBaiLingXing(engine);
    const bxDays = bx.baiXiaoDays || 0;
    const isBaiXiaoBuy = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai);
    const hasBaiXiaoSignal = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai || bx.diBuBuy || bx.zhuLiShiPan || bx.jiaCang);
    // 12. 筹码分析
    const chip = this.calcChipAnalysis(closeArr, highArr, lowArr, volArr, currentClose);
    const chipConcentration90 = chip.concentration90;

    // ---------- 14项因子判定 ----------
    const factors: { name: string; met: boolean; points: number }[] = [];

    // F1: 白消买点 (3分) — 有信号即可，不限天数（主升/回踩都算）
    const f1 = hasBaiXiaoSignal;
    factors.push({ name: '白消买点', met: f1, points: f1 ? 3 : 0 });

    // F2: 集中度90<40% (1分)
    const f2 = chipConcentration90 < 40;
    factors.push({ name: '集中度<40%', met: f2, points: f2 ? 1 : 0 });

    // F3: KDJ上移 (1分)
    const f3 = kdj.jUp && kdj.j > kdj.k;
    factors.push({ name: 'KDJ上移', met: f3, points: f3 ? 1 : 0 });

    // F4: MACD金叉/多头 (1分)
    const f4 = macd.currentDiff > macd.currentDea;
    factors.push({ name: 'MACD多头', met: f4, points: f4 ? 1 : 0 });

    // F5: DEA>0 (1分)
    const f5 = macd.currentDea > 0;
    factors.push({ name: 'DEA>0', met: f5, points: f5 ? 1 : 0 });

    // F6: 股价>MA20 (1分)
    const f6 = currentClose > ma20;
    factors.push({ name: '站上MA20', met: f6, points: f6 ? 1 : 0 });

    // F7: 距MA60涨幅<25% (1分)
    const distMa60 = ma60 > 0 ? ((currentClose - ma60) / ma60) * 100 : 0;
    const f7 = distMa60 < 25;
    factors.push({ name: '距MA60<25%', met: f7, points: f7 ? 1 : 0 });

    // F8: BOLL高于中轨 (1分)
    const f8 = currentClose > bollMid;
    factors.push({ name: 'BOLL中轨上', met: f8, points: f8 ? 1 : 0 });

    // F9: 主力资金净流入≥2000万 (1分)
    const f9 = s.inflow >= 20_000_000;
    factors.push({ name: '主力流入≥2000万', met: f9, points: f9 ? 1 : 0 });

    // F10: 3日涨幅>0%且<10% (1分)
    const f10 = chg3d > 0 && chg3d < 10;
    factors.push({ name: '3日涨幅0-10%', met: f10, points: f10 ? 1 : 0 });

    // F11: 20日波动率>25% (年化, 1分)
    const f11 = volatility20d > 25;
    factors.push({ name: '20日波动率>25%', met: f11, points: f11 ? 1 : 0 });

    // F12: 换手率>1% (来自前端, 1分)
    const f12 = (s as any).turnoverRate > 1;
    factors.push({ name: '换手率>1%', met: f12, points: f12 ? 1 : 0 });

    // F13: 量比>0.8 (来自成交量估算, 1分)
    const f13 = volumeRatio > 0.8;
    factors.push({ name: '量比>0.8', met: f13, points: f13 ? 1 : 0 });

    // F14: 均线多头排列MA5>MA10>MA20 (2分)
    const f14 = ma5 > ma10 && ma10 > ma20;
    factors.push({ name: '均线多头', met: f14, points: f14 ? 2 : 0 });

    // 统计总分
    let totalScore = factors.reduce((s, f) => s + f.points, 0);
    const maxScore = 3 + 1*11 + 2; // 16

    // 限制涨幅过快的金叉股
    if (macd.isGoldenCross && priceIncrease > 25) totalScore = Math.min(totalScore, 3);

    // 买点信号 (基于白消/白三角/白菱形综合)
    let buySignal = '';
    // 加仓也算主升信号
    const hasMainRise = trendState >= 2 
      || (sanJiao.bestBuyPoints || []).some(p => p.includes('主升'))
      || !!bx.jiaCang;
    const hasZhenDang = (sanJiao.bestBuyPoints || []).includes('震荡买点');
    const hengPo = !!bx.baiXiaoBuy2; // 横盘突破
    const hasJiGouActive = (bx as any).jiGouHuoYueDu >= 12;
    const firstBreakMA5 = currentClose > ma5 && (len >= 2 ? closeArr[len-2] <= (len >= 6 ? closeArr.slice(len-6, len-1).reduce((a,b)=>a+b,0)/5 : ma5) : true);
    const ma5NotDown = ma5 >= (len >= 6 ? closeArr.slice(len-6, len-1).reduce((a,b)=>a+b,0)/5 : ma5);
    const ma10NotDown = ma10 >= (len >= 11 ? closeArr.slice(len-11, len-1).reduce((a,b)=>a+b,0)/10 : ma10);
    const hasStrongSell = !!(bx.gaoKaiDiZouQingCang || bx.baoLiangFuGaiQingCang || bx.po5RiXian || bx.yinDiePoWei);
    const hasChuHuo = !!(sanJiao.zhuLiChuHuo || lingXing.zhuShengZhongWeiChuHuo || lingXing.zhenShiChuHuo);
    
    // 时间窗口标志(近3个交易日出现过)
    const qiangShiHuiCaiLast3 = [len-2, len-3, len-4].some(i => i >= 0 && !!(bx.qiangShiHuiCai as any)?.[i]);
    const hengPoLast3 = [len-2, len-3, len-4].some(i => i >= 0 && !!(bx.baiXiaoBuy2 as any)?.[i]);
    
    // 构建信号对象
    const signals = {
      baiXiaoStart: !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2),
      qiangShiHuiCai: !!bx.qiangShiHuiCai,
      jiaCang: !!bx.jiaCang,
      diBuBuy: !!bx.diBuBuy,
      zhuLiShiPan: !!bx.zhuLiShiPan,
      gaoWeiHuiDiao: !!bx.gaoWeiHuiDiaoBuy,
      hengPo, hasMainRise, hasZhenDang,
      baiXiaoDays: bxDays, baiXiao: !!bx.baiXiao, baiBu: !!bx.baiBu,
      jiGouActive: hasJiGouActive, jiGouHuoYueDu: (bx as any).jiGouHuoYueDu || 0,
      firstBreakMA5, ma5NotDown, ma10NotDown,
      lingXingBuy: !!lingXing.buySignalDiamond,
      xiPanFanZhuan: !!lingXing.xiPanFanZhuanBuy,
      qiangShiHuiCaiLast3, hengPoLast3,
    };
    
    // 生成可读信号描述
    const signalParts: string[] = [];
    if (signals.baiXiaoStart) signalParts.push('白消启动');
    if (signals.qiangShiHuiCai) signalParts.push('强势回踩');
    if (signals.jiaCang) signalParts.push('★加仓');
    if (signals.hengPo) signalParts.push('横盘突破');
    if (signals.diBuBuy) signalParts.push('主力建仓');
    if (signals.zhuLiShiPan) signalParts.push('主力试盘');
    if (signals.gaoWeiHuiDiao) signalParts.push('企稳');
    if (signals.hasMainRise) signalParts.push('主升');
    if (signals.hasZhenDang) signalParts.push('震荡买点');
    if (signals.jiGouActive) signalParts.push('机构活跃');
    if (signals.lingXingBuy) signalParts.push('菱形买入');
    if (signals.xiPanFanZhuan) signalParts.push('洗盘反转');
    buySignal = signalParts.length > 0 ? signalParts.join('+') : '技术面观察';

    // 详细信息
    const detail = factors.filter(f => f.met).map(f => f.name).join('+');

    return {
      score: totalScore, factorCount: factors.filter(f => f.met).length, maxScore, detail,
      factors, trendState, pricePosition, priceIncrease, isGoldenCross: macd.isGoldenCross,
      bxDays, bx, buySignal, signals, sanJiao, lingXing, engine,
      hasStrongSell, hasChuHuo,
      ma5, ma10, ma20, ma60, macd, kdj, volumeRatio, volatility20d, chip, closeArr, openArr,
    };
  }

  /**
   * ═══ 多因子 → 建议标签 (仅用于无BaiXiao信号的股票) ═══
   */
  private scoreToSuggestion(score: number): string {
    if (score >= 9) return '买入';
    if (score >= 6) return '轻仓买入';
    if (score >= 3) return '持有';
    return '不要介入';
  }

  /**
   * ═══ 宽松版多因子 → 建议标签 ═══
   */
  private scoreToSuggestionRelaxed(score: number): string {
    if (score >= 7) return '买入';
    if (score >= 4) return '轻仓买入';
    if (score >= 2) return '持有';
    return '不要介入';
  }

  /**
   * ═══ 信号组合规则引擎 ═══
   * 根据用户定义的信号组合规则，确定买卖建议标签
   * 返回: { suggestion: string | null, signalComb: string } | null
   */
private determineBySignalRule(signals: any, bx: any, result: any, bhResult?: any): { suggestion: string; signalComb: string } | null {
    const {
      baiXiaoStart, qiangShiHuiCai, jiaCang, diBuBuy, zhuLiShiPan, gaoWeiHuiDiao,
      hengPo, hasMainRise, hasZhenDang, baiXiaoDays, baiXiao, baiBu,
      jiGouActive, firstBreakMA5, ma5NotDown, ma10NotDown,
      lingXingBuy, xiPanFanZhuan, qiangShiHuiCaiLast3, hengPoLast3,
    } = signals;
    const trendState: number = result.trendState;
    const priceIncrease: number = result.priceIncrease;
    const pricePosition: number = result.pricePosition;
    const closeArr: number[] = result.closeArr;
    const ma20: number = result.ma20;
    const ma60: number = result.ma60;

    // ═══ 安全过滤：白布+卖出信号 ═══
    const hasStrongSell = result.hasStrongSell;
    const hasChuHuo = result.hasChuHuo;
    const sj = (result as any).sanJiao || {};
    const lx = (result as any).lingXing || {};

    if (baiBu && hasStrongSell) return { suggestion: '卖出', signalComb: '白布+清仓/爆量覆盖/破5日线' };
    if (baiBu && hasChuHuo) return { suggestion: '卖出', signalComb: '白布+出货' };
    if (baiBu && (sj.shortSell || lx.shortSell)) return { suggestion: '卖出', signalComb: '白布+紧急清仓' };
    if (baiBu && (sj.strongSell || lx.strongSell)) return { suggestion: '卖出', signalComb: '白布+空' };
    if (!baiBu && hasChuHuo && (baiXiaoStart || baiXiao)) return { suggestion: '减仓', signalComb: '白消+出货(减仓)' };

    if (priceIncrease > 60) return null;

    const jiGouActiveBreak = jiGouActive && firstBreakMA5 && ma5NotDown && ma10NotDown;

    // ═══════════ 轻仓买入（白布条件下） ═══════════
    if (baiBu) {
      if (jiGouActiveBreak)
        return { suggestion: '轻仓买入', signalComb: '白布+机构活跃+突破MA5' };
      if (diBuBuy || zhuLiShiPan || gaoWeiHuiDiao || jiaCang) {
        const parts: string[] = ['白布'];
        if (diBuBuy) parts.push('主力建仓');
        if (zhuLiShiPan) parts.push('主力试盘');
        if (gaoWeiHuiDiao) parts.push('企稳');
        if (jiaCang) parts.push('★加仓');
        return { suggestion: '轻仓买入', signalComb: parts.join('+') };
      }
      return null;
    }

    // ═══════════ 白消状态 ═══════════
    if (baiXiao) {
      if (hasChuHuo) return { suggestion: '减仓', signalComb: '白消+出货' };

      // ─── 重仓买入（白消第1-6天） ───
      if (baiXiaoDays <= 6) {
        // c1: 强势回踩后3日内出现任意主升
        if (qiangShiHuiCaiLast3 && hasMainRise)
          return { suggestion: '重仓买入', signalComb: '强势回踩→主升' };
        // c2: 白消启动后3日内出现任意主升
        if ((baiXiaoStart || baiXiaoDays <= 4) && hasMainRise)
          return { suggestion: '重仓买入', signalComb: '白消启动+主升' };
        // c3: 白消启动后3日内出现强势回踩
        if ((baiXiaoStart || baiXiaoDays <= 4) && qiangShiHuiCai)
          return { suggestion: '重仓买入', signalComb: '白消启动+强势回踩' };
        // c4: 强势回踩+加仓同时
        if (qiangShiHuiCai && jiaCang)
          return { suggestion: '重仓买入', signalComb: '强势回踩+★加仓' };
        // c5: 白消启动+加仓同时
        if (baiXiaoStart && jiaCang)
          return { suggestion: '重仓买入', signalComb: '白消启动+★加仓' };
        // c6: 任意主升单独
        if (hasMainRise)
          return { suggestion: '重仓买入', signalComb: '主升' };
        // c7: 强势回踩单独
        if (qiangShiHuiCai)
          return { suggestion: '重仓买入', signalComb: '强势回踩' };
        // c8: 白消启动单独
        if (baiXiaoStart)
          return { suggestion: '重仓买入', signalComb: '白消启动' };
        // c9: 机构活跃+突破MA5+MA不下
        if (jiGouActiveBreak)
          return { suggestion: '重仓买入', signalComb: '机构活跃+突破MA5' };
        if (baiXiaoDays >= 4)
          return { suggestion: '持有', signalComb: `白消第${baiXiaoDays}天(待观察)` };
        return { suggestion: '持有', signalComb: `白消第${baiXiaoDays}天` };
      }

      // ─── 买入（白消第6天以上） ───
      if (baiXiaoDays >= 6) {
        if (hengPo && hasMainRise)
          return { suggestion: '买入', signalComb: '横盘突破+主升' };
        if (hengPo && qiangShiHuiCai)
          return { suggestion: '买入', signalComb: '横盘突破+强势回踩' };
        if (hengPoLast3 && hasMainRise && !hengPo)
          return { suggestion: '买入', signalComb: '横盘突破→主升' };
        if (hengPoLast3 && qiangShiHuiCai && !hengPo)
          return { suggestion: '买入', signalComb: '横盘突破→强势回踩' };
        if (qiangShiHuiCaiLast3 && hasMainRise)
          return { suggestion: '买入', signalComb: '强势回踩→主升' };
        if (hengPo)
          return { suggestion: '买入', signalComb: '横盘突破' };
        if (jiGouActiveBreak)
          return { suggestion: '买入', signalComb: '机构活跃+突破MA5' };
        return { suggestion: '持有', signalComb: `白消第${baiXiaoDays}天` };
      }
    }

    return null;
  }


  async checkOpportunity(s: StockCandidate, prevSuggestion?: string | null): Promise<OpportunityStock | null> {
    const kline = await this.dataFetcher.getKLineData(s.code);
    if (!kline || kline.length < 20) return null;

    const result = this.calcMultiScore(s, kline);
    if (!result) return null;

    const { signals, bx, score, pricePosition, priceIncrease, detail } = result;

    // ═══ 一级: 信号组合规则 (买入信号主来源) ═══
    const ruleResult = this.determineBySignalRule(signals, bx, result);
    if (ruleResult) {
      const sug = ruleResult.suggestion;
      const buySignals = ['重仓买入', '买入', '轻仓买入'];

      if (buySignals.includes(sug)) {
        if (pricePosition >= 95) return null; // 过高的位置过滤(仅对买入信号)
        // ═══ 评分系统仅用于未来1-2日预测(独立字段forecast1_2Day) ═══
        // 评分系统不改信号，信号由determineBySignalRule独立产生
        // 前端见BUY_SELL架构: 后端卖信号100%尊重,后端买信号结合forecast1_2Day+实时升级
        return this.buildResult(s, kline, result, sug, ruleResult.signalComb);
      }

      // 非买入信号(卖出/减仓/持有)直接返回（不过滤高位）
      return this.buildResult(s, kline, result, sug, ruleResult.signalComb);
    }

    // ═══ 无信号规则匹配 → 不靠评分单独产生买入信号 ═══
    return null;
  }

  async checkOpportunityRelaxed(s: StockCandidate, prevSuggestion?: string | null): Promise<OpportunityStock | null> {
    const kline = await this.dataFetcher.getKLineData(s.code);
    if (!kline || kline.length < 20) return null;

    const result = this.calcMultiScore(s, kline);
    if (!result) return null;

    const { signals, bx, score, priceIncrease, pricePosition, detail } = result;

    // ═══ 一级: 信号组合规则 (与标准模式相同) ═══
    const ruleResult = this.determineBySignalRule(signals, bx, result);
    if (ruleResult) {
      const sug = ruleResult.suggestion;
      const buySignals = ['重仓买入', '买入', '轻仓买入'];

      if (buySignals.includes(sug)) {
        if (pricePosition >= 97) return null; // 过高的位置过滤(仅对买入信号)
        // 宽松版同样: 评分系统仅用于预测字段,不改信号
        return this.buildResult(s, kline, result, sug, ruleResult.signalComb);
      }

      // 非买入信号(卖出/减仓/持有)直接返回（不过滤高位）
      return this.buildResult(s, kline, result, sug, ruleResult.signalComb);
    }

    // ═══ 二级: 多因子宽松模式（评分预测为买入信号兜底） ═══
    const forecast = this.calcScoreForecast(score, signals, '轻仓买入', result.trendState, result.isGoldenCross, result.pricePosition, result.volumeRatio, s.inflow);
    const dir = forecast.direction;
    if ((dir === '强烈看涨' || dir === '看涨') && pricePosition < 95) {
      return this.buildResult(s, kline, result, '轻仓买入', '评分预测' + dir + '|' + forecast.confidence + '%');
    }
    if (dir === '震荡偏强' && pricePosition < 90 && bx.baiXiaoDays > 0) {
      return this.buildResult(s, kline, result, '轻仓买入', '白消+评分预测' + dir);
    }

    return null;
  }

  /** 统一构建结果对象 */
  private buildResult(
    s: StockCandidate, kline: KLine[], result: any,
    suggestion: string, signalCombination?: string
  ): OpportunityStock | null {
    const entryTiming = this.calcEntryTiming(
      result.pricePosition, result.trendState,
      kline.map(k=>k.close), kline.map(k=>k.high), kline.map(k=>k.low),
      kline.map(k=>k.volume || 0), result.isGoldenCross
    );
    const safetyScore = this.calcSafetyScore(
      kline.map(k=>k.close), kline.map(k=>k.high), kline.map(k=>k.low),
      kline.map(k=>k.volume || 0), result.pricePosition, result.trendState
    );
    return {
      capitalRank: 0,
      entryTiming: Math.round(entryTiming * 100) / 100,
      safetyScore: Math.round(safetyScore * 100) / 100,
      code: s.code, name: s.name,
      mainForceInflow: s.inflow,
      baiXiaoDays: result.bxDays,
      buySignal: result.buySignal,
      currentPrice: s.currentPrice, changePercent: s.changePercent,
      pricePosition: Math.round(result.pricePosition * 100) / 100,
      priceIncrease: Math.round(result.priceIncrease * 100) / 100,
      score: result.score,
      diff: Math.round(result.macd.currentDiff * 10000) / 10000,
      dea: Math.round(result.macd.currentDea * 10000) / 10000,
      ma5: Math.round(result.ma5 * 100) / 100,
      ma10: Math.round(result.ma10 * 100) / 100,
      isGoldenCross: result.isGoldenCross,
      suggestion,
      signalCombination: signalCombination || result.detail,
      jiGouActiveScore: Math.round(result.volumeRatio * 6 * 100) / 100,
      trendPrediction: this.calcTrendPrediction(kline, result),
      // ═══ 共享技术面预测：与addForecastToCache/quickAnalyze完全统一 ═══
      forecast1_2Day: GemScreenerService.computeTechnicalForecast({
        entryTiming,
        isGoldenCross: result.isGoldenCross,
        ma5: result.ma5,
        ma10: result.ma10,
        pricePosition: result.pricePosition,
        mainForceInflow: s.inflow ?? 0,
        jiGouActiveScore: Math.round(result.volumeRatio * 6 * 100) / 100,
      }),
    };
  }

  // ═══ 共享技术面预测：addForecastToCache与quickAnalyze共用同一算法 ═══
  static computeTechnicalForecast(params: {
    entryTiming: number; isGoldenCross: boolean; ma5: number; ma10: number;
    pricePosition: number; mainForceInflow: number; jiGouActiveScore: number;
  }): { direction: string; confidence: string; detail: string } {
    const { entryTiming: et, isGoldenCross: gc, ma5, ma10, pricePosition: pos, mainForceInflow: mf, jiGouActiveScore: jiScore } = params;
    const downtrend = ma5 > 0 && ma10 > 0 && ma5 < ma10;
    const overbought = pos >= 85;
    const mfStrongOut = mf < -3;
    const mfOut = mf < -1;
    const mfStrongIn = mf > 5;
    const mfIn = mf > 2;
    const volDead = jiScore < 3;
    const volState = jiScore >= 10 ? '放量' : jiScore >= 5 ? '平量' : jiScore >= 2 ? '缩量' : '极度缩量';
    // 下跌趋势类
    if (downtrend && mfStrongOut && et < 50)
      return { direction: '下跌趋势', confidence: '高', detail: `均线空头(MA5=${ma5.toFixed(2)}下穿MA10=${ma10.toFixed(2)})+${volState}+主力大幅出逃(${mf.toFixed(1)}亿)+介入时机差(${et}),资金与趋势同步向下,未来1-2日继续探底概率极大,坚决不介入` };
    if (downtrend && et < 45)
      return { direction: '下跌趋势', confidence: '高', detail: `均线空头(MA5=${ma5.toFixed(2)}下穿MA10=${ma10.toFixed(2)})+${volState}${mfOut?`+主力流出(${mf.toFixed(1)}亿)`:''}+介入时机差(${et}),短期空方主导,未来1-2日继续震荡探底概率大,不宜抄底` };
    if (downtrend && et < 55)
      return { direction: '震荡偏弱', confidence: '中', detail: `均线空头排列(MA5下穿MA10)+${volState}${mfOut?`+主力流出(${mf.toFixed(1)}亿)`:''},介入时机中性(${et}),下跌节奏放缓但未企稳,未来1-2日低位震荡为主,等待均线走平再观察` };
    if (!gc && mfStrongOut)
      return { direction: '看跌', confidence: '高', detail: `MACD死叉+${volState}+主力大幅出逃(${mf.toFixed(1)}亿),资金加速撤离,短期动能在快速减弱,未来1-2日大概率继续回调,下方支撑位是关键` };
    if (!gc && et < 40)
      return { direction: '看跌', confidence: '中', detail: `MACD死叉+${volState}+介入时机差(${et})${mfOut?`+主力流出(${mf.toFixed(1)}亿)`:''},短期动能偏弱,未来1-2日大概率延续回调,关注下方支撑位` };
    if (overbought && et < 50)
      return { direction: '回调风险', confidence: '中', detail: `价格已处于高位(位置${Math.round(pos)}%)+${volState}${mfStrongOut?`+主力明显出逃(${mf.toFixed(1)}亿)`:mfOut?`+主力流出(${mf.toFixed(1)}亿)`:''},介入时机不足(${et}),获利盘抛压增大,未来1-2日注意冲高回落` };
    // 中性震荡类
    if (et < 45 && volDead)
      return { direction: '震荡', confidence: '低', detail: `介入时机差(${et})+${volState}(活跃度${jiScore}),无人交易无方向,均线${downtrend?'空头':'方向不明'},未来1-2日大概率横盘等待方向,不参与` };
    if (et < 45)
      return { direction: '震荡', confidence: '低', detail: `介入时机差(${et})+${volState}${mfOut?`+主力流出(${mf.toFixed(1)}亿)`:''},均线${downtrend?'空头排列':'方向不明'},未来1-2日大概率横盘整理,等待方向选择` };
    if (et < 55 && !gc)
      return { direction: '震荡偏弱', confidence: '低', detail: `介入时机一般(${et})+${volState}+MACD未金叉${mfOut?`+主力流出(${mf.toFixed(1)}亿)`:''},趋势动能偏弱,未来1-2日延续弱势震荡,突破需量能配合` };
    if (et < 55)
      return { direction: '震荡偏强', confidence: '低', detail: `介入时机中性偏可(${et})+${volState}+MACD金叉向上${mfIn?`+主力流入(${mf.toFixed(1)}亿)`:''},多方略有优势,未来1-2日震荡中偏多运行` };
    // 上涨趋势类
    if (et >= 65 && gc && pos < 65 && mfStrongIn)
      return { direction: '强烈看涨', confidence: '高', detail: `主力大幅进场(${mf.toFixed(1)}亿)+${volState}+MACD金叉确认+介入时机极佳(${et})+位置适中(${Math.round(pos)}%),资金+趋势+位置共振向上,未来1-2日大概率强势上攻,积极关注` };
    if (et >= 65 && gc && pos < 65)
      return { direction: '强烈看涨', confidence: '高', detail: `介入时机极佳(${et})+${volState}+MACD金叉确认+位置适中(${Math.round(pos)}%)${mfIn?`+主力流入(${mf.toFixed(1)}亿)`:''},趋势共振向上,未来1-2日大概率延续升势,积极关注` };
    if (et >= 60)
      return { direction: '看涨', confidence: '高', detail: `介入时机良好(${et})+${volState}+MACD金叉向上${mfIn?`+主力流入(${mf.toFixed(1)}亿)`:''},短期趋势偏多,未来1-2日有望继续震荡走高,逢低关注` };
    return { direction: '看涨', confidence: '中', detail: `介入时机可参与(${et})+${volState}+MACD金叉向上${mfIn?`+主力流入(${mf.toFixed(1)}亿)`:''},趋势偏多,未来1-2日大概率震荡偏多运行,可适当关注` };
  }

  // ═══ 多因子评分 → 未来1-2日预测 ═══
  // 基于 calcMultiScore 的 7 因子评分(0-16分)+趋势/金叉/位置+成交量过滤，
  // 提供高胜率的方向性判断
  private calcScoreForecast(
    score: number, signals: any, suggestion: string,
    trendState: number = 0, isGoldenCross: boolean = false,
    pricePosition: number = 50, volumeRatio: number = 0.5,
    mainForceInflow: number = 0
  ): { direction: string; confidence: string; detail: string } {
    const isBuySignal = ['轻仓买入','买入','重仓买入'].includes(suggestion);
    const isSellSignal = ['减仓','卖出','不要介入'].includes(suggestion);
    const baiBu = signals?.baiBu || signals?.hasBaiBu || false;
    const baiXiao = signals?.baiXiao || signals?.hasBaiXiao || false;
    const jiGouActive = signals?.jiGouActive || signals?.hasJiGouActive || false;
    const macdGoldenCross = signals?.macdGoldenCross || isGoldenCross;
    const zhuLiChuHuo = signals?.zhuLiChuHuo || false;
    const uptrend = trendState >= 2; // MA5>MA10>MA20
    const mf = mainForceInflow ?? 0;
    const mfStrongOut = mf < -3;
    const mfOut = mf < -1;
    const mfStrongIn = mf > 5;
    const mfIn = mf > 2;
    const volState = volumeRatio > 1.5 ? '放量' : volumeRatio > 0.8 ? '平量' : volumeRatio > 0.4 ? '缩量' : '极度缩量';

    // ═══ 纯技术面独立预测，不受买卖信号影响 ═══

    // ═══ 强烈看涨 — 高胜率+高赔率 ═══
    // 要求: 评分高 + 买入信号 + 机构活跃 + MACD金叉 + 趋势向上 + 价格不过高 + 成交量有效
    if (score >= 12 && jiGouActive && macdGoldenCross && uptrend && pricePosition < 70 && volumeRatio > 0.6) {
      return {
        direction: '强烈看涨', confidence: '高',
        detail: `综合评分${score}分,机构活跃,${volState}(量比${volumeRatio.toFixed(2)}),MACD金叉,均线多头排列(趋势值${trendState}),位置${Math.round(pricePosition)}%${mfStrongIn?`+主力大幅进场${mf.toFixed(1)}亿`:mfIn?`+主力流入${mf.toFixed(1)}亿`:''}。多指标共振向上+资金面配合,未来1-2日上涨概率高,有望继续走强突破`
      };
    }
    // ═══ 次强版 — 评分高+买信号+趋势向上（个别条件略弱） ═══
    if (score >= 10 && macdGoldenCross && uptrend && pricePosition < 75 && volumeRatio > 0.5) {
      return {
        direction: '看涨', confidence: '高',
        detail: `综合评分${score}分,MACD金叉,均线多头(趋势值${trendState}),位置${Math.round(pricePosition)}%,${volState}(量比${volumeRatio.toFixed(2)})${mfIn?`+主力流入${mf.toFixed(1)}亿`:''}。趋势向好,未来1-2日震荡偏多运行`
      };
    }
    // ═══ 评分高+买信号，但部分条件不满足（谨慎偏多） ═══
    if (score >= 12) {
      return {
        direction: '看涨', confidence: '中',
        detail: `综合评分${score}分较高,但趋势(值${trendState})或位置(${Math.round(pricePosition)}%)或${volState}(量比${volumeRatio.toFixed(2)})不够理想${mfOut?`+主力流出${mf.toFixed(1)}亿`:''},未来1-2日偏多但介入需等确认`
      };
    }
    if (score >= 9 && isBuySignal && pricePosition < 80) {
      return {
        direction: '震荡偏强', confidence: '中',
        detail: `综合评分${score}分,有买入信号加持,位置${Math.round(pricePosition)}%适中,${volState}(量比${volumeRatio.toFixed(2)})${mfIn?`+主力流入${mf.toFixed(1)}亿`:''}。短期多空平衡偏多,未来1-2日有望在震荡中逐步走高`
      };
    }
    if (score >= 9 && isBuySignal) {
      return {
        direction: '震荡', confidence: '低',
        detail: `综合评分${score}分有买入信号,但位置偏高(${Math.round(pricePosition)}%)${mfOut?`+主力流出${mf.toFixed(1)}亿`:''},${volState}(量比${volumeRatio.toFixed(2)}),上方空间有限且获利盘较多,未来1-2日方向不明确`
      };
    }
    if (score >= 9 && isSellSignal) {
      return {
        direction: '震荡', confidence: '低',
        detail: `综合评分${score}分尚可但叠加卖出信号,${volState}(量比${volumeRatio.toFixed(2)})${mfStrongOut?`+主力大幅出逃${mf.toFixed(1)}亿`:''},多空分歧明显。未来1-2日方向不明朗,需等待信号明朗再决定`
      };
    }
    if (score >= 6 && isBuySignal && pricePosition < 85) {
      return {
        direction: '震荡偏强', confidence: '低',
        detail: `综合评分${score}分一般但有买入信号,位置${Math.round(pricePosition)}%尚可,${volState}(量比${volumeRatio.toFixed(2)})${mfIn?`+主力流入${mf.toFixed(1)}亿`:''}。短期有反弹预期但力度存疑,未来1-2日窄幅震荡偏多`
      };
    }
    if (score >= 6 && !isBuySignal) {
      return {
        direction: '震荡', confidence: '低',
        detail: `综合评分${score}分偏低,无明显买卖信号指引。均线${uptrend?'多头':'空头或黏合'},${volState}(量比${volumeRatio.toFixed(2)})${mfOut?`+主力流出${mf.toFixed(1)}亿`:''},未来1-2日大概率延续震荡`
      };
    }
    if (score < 6 && (baiXiao || jiGouActive)) {
      return {
        direction: '震荡偏弱', confidence: '低',
        detail: `综合评分${score}分偏低,技术面整体偏弱,${volState}(量比${volumeRatio.toFixed(2)}),虽有${baiXiao?'白消信号':'机构活跃'}${mfStrongOut?`但主力大幅出逃${mf.toFixed(1)}亿`:''},难以支撑反转。未来1-2日有继续调整压力`
      };
    }
    if (score < 6) {
      return {
        direction: '看跌', confidence: '高',
        detail: `综合评分仅${score}分,MACD${macdGoldenCross?'金叉':'死叉或未金叉'},趋势值${trendState},${volState}(量比${volumeRatio.toFixed(2)})${mfStrongOut?`+主力大幅出逃${mf.toFixed(1)}亿`:mfOut?`+主力流出${mf.toFixed(1)}亿`:''}。各指标偏空共振,未来1-2日回调风险较大,不宜介入`
      };
    }
    return { direction: '方向不明', confidence: '--', detail: '综合信号不明确,各指标无法形成一致性判断' };
  }

  // ===========================================================================
  // 最佳介入时机评分（Level 2 排序）
  // 核心逻辑:
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

  // ===========================================================================
  // 筹码分布分析（从K线量价估算）
  // 输出: 集中度90, 峰位, 单峰/双峰/分散
  // ===========================================================================
    /**
   * 信号连续性规则（买入必须持续）
   * 重仓买入→次/次日必须维持重仓买入; 买入→必须维持买入以上; 轻仓买入→至少持有
   */
  private applySignalContinuity(
    currentSuggestion: string,
    prevSuggestion: string | undefined | null,
    pricePosition: number,
    trendState: number,
  ): { suggestion: string; changed: boolean } {
    if (!prevSuggestion || prevSuggestion === '观望' || prevSuggestion === '不要介入' || prevSuggestion === '持有') {
      return { suggestion: currentSuggestion, changed: false };
    }

    const PRIORITY = ['重仓买入', '买入', '轻仓买入', '持有', '卖出', '不要介入'];
    const prevIdx = PRIORITY.indexOf(prevSuggestion);
    const curIdx = PRIORITY.indexOf(currentSuggestion);
    if (prevIdx === -1 || curIdx === -1) return { suggestion: currentSuggestion, changed: false };

    // ─── 买入信号必须有持续性 ───
    // 重仓买入（index 0）→ 次日必须维持重仓买入（主升浪已开启，不会突然反转）
    if (prevIdx === 0) {
      if (curIdx > 1) {
        // 即便今日信号变弱，也必须维持重仓买入
        return { suggestion: '重仓买入', changed: true };
      }
    }
    // 买入（index 1）→ 次日至少维持买入（不会突然降到轻仓买入以下）
    if (prevIdx === 1) {
      if (curIdx > 2) {
        // 至少维持买入
        return { suggestion: '买入', changed: true };
      }
    }
    // 轻仓买入（index 2）→ 次日至少维持轻仓买入或持有
    if (prevIdx === 2) {
      if (curIdx > 3) {
        return { suggestion: '持有', changed: true };
      }
    }

    return { suggestion: currentSuggestion, changed: false };
  }

  private calcChipAnalysis(
    closeArr: number[],
    highArr: number[],
    lowArr: number[],
    volumeArr: number[],
    currentPrice: number,
  ): { concentration90: number; peakPosition: 'low' | 'mid' | 'high'; pattern: 'single_peak' | 'double_peak' | 'dispersed' } {
    const len = closeArr.length;
    if (len < 20) return { concentration90: 50, peakPosition: 'mid', pattern: 'dispersed' };

    // 取近60天数据
    const N = Math.min(60, len);
    const c = closeArr.slice(-N);
    const h = highArr.slice(-N);
    const l = lowArr.slice(-N);
    const v = volumeArr.slice(-N);

    // 价格区间
    const minPrice = Math.min(...l);
    const maxPrice = Math.max(...h);
    const range = maxPrice - minPrice;
    if (range < 0.01) return { concentration90: 95, peakPosition: 'mid', pattern: 'single_peak' };

    // 分20个价格区间
    const BINS = 20;
    const binSize = range / BINS;
    const bins = new Array(BINS).fill(0);

    // 将每日成交量分配到价格区间（按当日 high-low 范围线性分配）
    for (let i = 0; i < N; i++) {
      const dayLow = l[i];
      const dayHigh = h[i];
      const dayVol = v[i];
      const dayRange = dayHigh - dayLow;
      if (dayRange < 0.01) continue;

      const startBin = Math.max(0, Math.floor((dayLow - minPrice) / binSize));
      const endBin = Math.min(BINS - 1, Math.floor((dayHigh - minPrice) / binSize));

      if (startBin === endBin) {
        bins[startBin] += dayVol;
      } else {
        // 线性分配成交量到每个触及的价格区间
        const totalSteps = endBin - startBin + 1;
        const volPerBin = dayVol / totalSteps;
        for (let b = startBin; b <= endBin; b++) {
          bins[b] += volPerBin;
        }
      }
    }

    // 找出峰值（局部最大值）
    const totalVol = bins.reduce((a, b) => a + b, 0);
    const peaks: number[] = [];
    for (let i = 1; i < BINS - 1; i++) {
      if (bins[i] > bins[i - 1] && bins[i] > bins[i + 1] && bins[i] > totalVol * 0.05) {
        peaks.push(i);
      }
    }
    // 如果没找到峰值，取最高bin
    if (peaks.length === 0) {
      const maxIdx = bins.indexOf(Math.max(...bins));
      peaks.push(maxIdx);
    }

    // 集中度90: 找到包含90%成交量的最小区间
    const sortedBins = [...bins].sort((a, b) => b - a);
    let cumVol = 0;
    let binsNeeded = 0;
    for (const vol of sortedBins) {
      cumVol += vol;
      binsNeeded++;
      if (cumVol >= totalVol * 0.9) break;
    }
    const concentration90 = Math.round((binsNeeded / BINS) * 100);

    // 峰位: 主峰对应的价格相对于当前价格的位置
    const mainPeakIdx = peaks[0];
    const peakPrice = minPrice + (mainPeakIdx + 0.5) * binSize;
    const pricePositionPct = (currentPrice - minPrice) / range;
    let peakPosition: 'low' | 'mid' | 'high';
    if (peakPrice < currentPrice * 0.85) {
      peakPosition = 'low';  // 峰在下方（支撑位）
    } else if (peakPrice > currentPrice * 1.15) {
      peakPosition = 'high'; // 峰在上方（压力位）
    } else {
      peakPosition = 'mid';  // 峰在当前价附近
    }

    // 形态: 单峰/双峰/分散
    let pattern: 'single_peak' | 'double_peak' | 'dispersed';
    if (peaks.length >= 3) {
      pattern = 'dispersed';
    } else if (peaks.length >= 2) {
      // 双峰：检查两峰是否足够分离
      const gap = Math.abs(peaks[0] - peaks[1]) * binSize / range;
      pattern = gap > 0.2 ? 'double_peak' : 'single_peak';
    } else {
      pattern = 'single_peak';
    }

    return { concentration90, peakPosition, pattern };
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
    const finalResults = results.slice(0, 30);
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
      if (!raw?.length || raw.length < 20) return null;
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
      else if (ma5 < ma10) trendState = 0; // ma5<ma10即为短期走弱（即使ma20未拐头）

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
        '重仓买入': 100, '买入': 80, '轻仓买入': 65, '持有': 40,
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
      this.upgradeCacheFields(this.cache.data);
      this.addForecastToCache(this.cache.data);
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
      this.upgradeCacheFields(this.mainBoardCache.data);
      this.addForecastToCache(this.mainBoardCache.data);
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
      '重仓买入': 0, '买入': 1, '轻仓买入': 2,
      '减仓': 3, '持有': 4, '卖出': 5, '不要介入': 6,
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
      '重仓买入': 0, '买入': 1, '轻仓买入': 2,
      '减仓': 3, '持有': 4, '卖出': 5, '不要介入': 6,
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

  // ===========================================================================
  // 筹码分布分析（静态版本，用于 quickAnalyze）
  // ===========================================================================
  private static calcChipAnalysis(
    closeArr: number[],
    highArr: number[],
    lowArr: number[],
    volumeArr: number[],
    currentPrice: number,
  ): { concentration90: number; peakPosition: 'low' | 'mid' | 'high'; pattern: 'single_peak' | 'double_peak' | 'dispersed' } {
    const len = closeArr.length;
    if (len < 20) return { concentration90: 50, peakPosition: 'mid', pattern: 'dispersed' };

    const N = Math.min(60, len);
    const c = closeArr.slice(-N);
    const h = highArr.slice(-N);
    const l = lowArr.slice(-N);
    const v = volumeArr.slice(-N);

    const minPrice = Math.min(...l);
    const maxPrice = Math.max(...h);
    const range = maxPrice - minPrice;
    if (range < 0.01) return { concentration90: 95, peakPosition: 'mid', pattern: 'single_peak' };

    const BINS = 20;
    const binSize = range / BINS;
    const bins = new Array(BINS).fill(0);

    for (let i = 0; i < N; i++) {
      const dayLow = l[i];
      const dayHigh = h[i];
      const dayVol = v[i];
      const dayRange = dayHigh - dayLow;
      if (dayRange < 0.01) continue;

      const startBin = Math.max(0, Math.floor((dayLow - minPrice) / binSize));
      const endBin = Math.min(BINS - 1, Math.floor((dayHigh - minPrice) / binSize));

      if (startBin === endBin) {
        bins[startBin] += dayVol;
      } else {
        const totalSteps = endBin - startBin + 1;
        const volPerBin = dayVol / totalSteps;
        for (let b = startBin; b <= endBin; b++) {
          bins[b] += volPerBin;
        }
      }
    }

    const totalVol = bins.reduce((a: number, b: number) => a + b, 0);
    const peaks: number[] = [];
    for (let i = 1; i < BINS - 1; i++) {
      if (bins[i] > bins[i - 1] && bins[i] > bins[i + 1] && bins[i] > totalVol * 0.05) {
        peaks.push(i);
      }
    }
    if (peaks.length === 0) {
      const maxIdx = bins.indexOf(Math.max(...bins));
      peaks.push(maxIdx);
    }

    const sortedBins = [...bins].sort((a: number, b: number) => b - a);
    let cumVol = 0;
    let binsNeeded = 0;
    for (const vol of sortedBins) {
      cumVol += vol;
      binsNeeded++;
      if (cumVol >= totalVol * 0.9) break;
    }
    const concentration90 = Math.round((binsNeeded / BINS) * 100);

    const mainPeakIdx = peaks[0];
    const peakPrice = minPrice + (mainPeakIdx + 0.5) * binSize;
    let peakPosition: 'low' | 'mid' | 'high';
    if (peakPrice < currentPrice * 0.85) {
      peakPosition = 'low';
    } else if (peakPrice > currentPrice * 1.15) {
      peakPosition = 'high';
    } else {
      peakPosition = 'mid';
    }

    let pattern: 'single_peak' | 'double_peak' | 'dispersed';
    if (peaks.length >= 3) {
      pattern = 'dispersed';
    } else if (peaks.length >= 2) {
      const gap = Math.abs(peaks[0] - peaks[1]) * binSize / range;
      pattern = gap > 0.2 ? 'double_peak' : 'single_peak';
    } else {
      pattern = 'single_peak';
    }

    return { concentration90, peakPosition, pattern };
  }

  async quickAnalyze(code: string, name?: string, keepAll?: boolean, rawKline?: any[], frontendMainForce?: number): Promise<OpportunityStock | null> {
    const raw: any[] = rawKline || await this.dataFetcher.getKLineData(code) as any;
    if (!raw?.length || raw.length < 5) return null;

    const klineV: any[] = raw.slice(-120);
    const closeArr: number[] = klineV.map((k: any) => Number(k.close));
    const volumeArr: number[] = klineV.map((k: any) => Number(k.volume));
    const highArr: number[] = klineV.map((k: any) => Number(k.high));
    const lowArr: number[] = klineV.map((k: any) => Number(k.low));
    const price = closeArr[closeArr.length - 1];
    const high60 = Math.max(...highArr.slice(-60));
    const low60 = Math.min(...lowArr.slice(-60));
    const pricePos = ((price - low60) / (high60 - low60)) * 100;
    const n = closeArr.length;
    const ma5 = closeArr.slice(-5).reduce((a: number, b: number) => a + b, 0) / Math.min(5, n);
    const ma10 = closeArr.slice(-10).reduce((a: number, b: number) => a + b, 0) / Math.min(10, n);
    const ma20 = closeArr.slice(-20).reduce((a: number, b: number) => a + b, 0) / Math.min(20, n);
    const macdR: any = this.calcCustomMACD(klineV);
    const diff = Array.isArray(macdR?.diff) ? macdR.diff[macdR.diff.length - 1] : (macdR?.diff ?? 0);
    const dea = Array.isArray(macdR?.dea) ? macdR.dea[macdR.dea.length - 1] : (macdR?.dea ?? 0);

    const ma5Up = closeArr.length > 5 && closeArr[closeArr.length - 1] > closeArr[closeArr.length - 6];
    const ma10Up = closeArr.length > 10 && closeArr[closeArr.length - 1] > closeArr[closeArr.length - 11];
    let trendState = 1;
    if (ma5 > ma10 && ma10 > ma20 && ma5Up && ma10Up) trendState = 3;
    else if (ma5 > ma10 && ma5Up) trendState = 2;
    else if (ma5 < ma10 && ma10 < ma20) trendState = 0;
    else if (ma5 < ma10) trendState = 0; // ma5<ma10即为短期走弱（即使ma20未拐头）

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
    let suggestion = result.action;
    const predictionText = result.prediction || '';
    const reasonText = result.reason || '';

    // ─── 白布卖出信号检测（覆盖getTradingSuggestion，与determineBySignalRule一致）───
    const baiBuIdx = engine.length - 1;
    const baiBuState = !!(baiXing as any)?.覆盖中?.[baiBuIdx];
    const hasStrongSell = !!(
      (baiXing as any)?.高开低走清仓?.[baiBuIdx] ||
      (baiXing as any)?.爆量覆盖清仓?.[baiBuIdx] ||
      (baiXing as any)?.白布破5日线?.[baiBuIdx] ||
      (baiXing as any)?.阴跌破位?.[baiBuIdx]
    );
    const hasChuHuo = !!(
      (sanJiao as any)?.zhuLiChuHuo ||
      (lingXing as any)?.zhuShengZhongWeiChuHuo ||
      (lingXing as any)?.zhenShiChuHuo
    );
    if (baiBuState && (hasStrongSell || hasChuHuo || (sanJiao as any)?.shortSell || (lingXing as any)?.shortSell || (sanJiao as any)?.strongSell || (lingXing as any)?.strongSell)) {
      suggestion = '卖出';
      this.logger.log(`🔴 [白布卖出] ${name}(${code}) 白布+强卖出信号，覆盖getTradingSuggestion结果`);
    }

    // ─── 下跌趋势(MA5<MA10)兜底：getTradingSuggestion可能返回持有，下跌趋势一律不要介入 ───
    if (suggestion !== '卖出' && ma5 < ma10) {
      suggestion = '不要介入';
    }

    const NEGATIVE = ['减仓', '不要介入'];
    // 卖出信号：不直接返回null，先记录锁定，后续会以"不要介入"展示
    if (suggestion === '卖出') {
      this.sellStateCache.set(code, { suggestion, timestamp: Date.now() });
      this.logger.log(`🔒 [实时分析] ${name}(${code}) 触发${suggestion}信号，已锁定`);
    }
    if (!keepAll && NEGATIVE.includes(suggestion)) return null;

    // 排除预测文本严重负面关键词的
    const NEGATIVE_PREDICTION_KEYWORDS = ['偏弱', '探底', '风险较大', '风险大', '注意风险'];
    if (!keepAll && NEGATIVE_PREDICTION_KEYWORDS.some(kw => predictionText.includes(kw))) return null;

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

    // 交叉验证：只排除明确负面的（卖出/不要介入）
    const NEGATIVE_CROSS = ['卖出', '不要介入'];
    if (!keepAll && NEGATIVE_CROSS.includes(crossSuggestion)) return null;

    const priceIncrease = ((price - closeArr[closeArr.length - 20]) / closeArr[closeArr.length - 20]) * 100;
    const changePct = ((price - closeArr[closeArr.length - 2]) / closeArr[closeArr.length - 2]) * 100;

    const BASE: Record<string, number> = {
      '重仓买入': 100, '买入': 80, '轻仓买入': 65, '持有': 40,
    };
    let score = BASE[suggestion] ?? 30;
    if (pricePos < 30) score += 15;
    else if (pricePos < 50) score += 8;
    if (closeArr[closeArr.length - 1] > closeArr[closeArr.length - 5]) score += 5;
    else score -= 5;

    // === 筹码分布分析 ===
    const chip = GemScreenerService.calcChipAnalysis(closeArr, highArr, lowArr, volumeArr, price);
    const chipConcentration90 = chip.concentration90;
    const chipPeakPosition = chip.peakPosition;
    const chipPattern = chip.pattern;

    // 筹码修正：分散+峰高位+未企稳 → 降级
    let finalSuggestion = suggestion;
    const chipDowngrade = chipPattern === 'dispersed' && chipPeakPosition === 'high' && pricePos < 30;
    const chipRisk = chipConcentration90 > 40 && chipPeakPosition === 'high' && pricePos < 25;
    if (chipDowngrade || chipRisk) {
      if (finalSuggestion === '重仓买入') finalSuggestion = '买入';
      else if (finalSuggestion === '买入') finalSuggestion = '轻仓买入';
      else if (finalSuggestion === '轻仓买入') finalSuggestion = '不要介入';
    }
    // 筹码集中+峰在下方+低位企稳 → 升级
    if (chipPattern === 'single_peak' && chipPeakPosition === 'low' && pricePos > 15 && pricePos < 45 && trendState >= 1) {
      if (finalSuggestion === '买入') finalSuggestion = '重仓买入';
      else if (finalSuggestion === '轻仓买入') finalSuggestion = '买入';
    }

    // === 计算最佳介入时机和安全系数 ===
    const entryTiming = GemScreenerService.calcEntryTiming(
      pricePos, trendState, closeArr, isGoldenCross, volumeArr,
    );
    const safetyScore = GemScreenerService.calcSafetyScore(
      closeArr, highArr, lowArr, pricePos, changePct,
    );

    // 估算主力资金净流入（基于量价比）
      const avgVol5 = volumeArr.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
      const avgVol20 = volumeArr.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      const volRatio = avgVol5 / (avgVol20 || 1);
      const inflowBase = (volRatio - 1) * price * avgVol5 / 10000000;
      const mainForceInflow = frontendMainForce !== undefined ? frontendMainForce : Math.round(Math.max(Math.min(inflowBase, 20), -10) * 10) / 10;

      // ─── 卖出锁定检查（实时分析也受锁定约束）───
      const sellEntry = this.sellStateCache.get(code);
      if (sellEntry) {
        const hasBuySignal = ['重仓买入', '买入'].includes(finalSuggestion) && isGoldenCross && (entryTiming ?? 0) >= 50;
        if (hasBuySignal) {
          this.sellStateCache.delete(code);
          this.logger.log(`🔓 [实时分析] ${name}(${code}) 出现买入信号，自动解除卖出锁定`);
        } else {
          finalSuggestion = '不要介入';
        }
      }

      // ═══ 共享技术面预测：与机会区缓存使用同一算法 ═══
      const forecast1_2Day = GemScreenerService.computeTechnicalForecast({
        entryTiming,
        isGoldenCross: fullIsGoldenCross,
        ma5: ma5, // 已在函数顶部从 closeArr 计算的5日均线
        ma10: ma10,
        pricePosition: pricePos,
        mainForceInflow,
        jiGouActiveScore: Math.round(Math.min(Math.max(volRatio, 0) * 6, 20) * 100) / 100,
      });

      return {
        code, name: name ?? '',
        currentPrice: price,
        changePercent: Math.round(changePct * 100) / 100,
        priceIncrease: Math.round(priceIncrease * 100) / 100,
        mainForceInflow,
      pricePosition: Math.round(pricePos),
      forecast1_2Day,
      capitalRank: 0,
      baiXiaoDays: 0,
      score,
      suggestion: finalSuggestion,
      entryTiming,
      safetyScore,
      isGoldenCross,
      diff,
      dea,
      buySignal: !!(baiXing?.baiXiao || sanJiao?.jiaCang || lingXing?.shortBuy) ? '有信号' : '',
      chipConcentration90,
      chipPeakPosition,
      chipPattern,
      signalCombination: result.reason || '',
      // 均线值（供前端三重卖点检测）
      ma5: Math.round(ma5 * 100) / 100,
      ma10: Math.round(ma10 * 100) / 100,
      // 机构活跃度 = 基于成交量比率的评分 (0-20)
      jiGouActiveScore: Math.round(Math.min((volumeArr.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5 / (volumeArr.slice(-60).reduce((a: number, b: number) => a + b, 0) / 60 || 1)) * 6, 20) * 100) / 100,
    };
  }

  /**
   * 缓存搜索：根据关键词搜索已缓存股票/ETF/可转债
   * 注：不再调外部 API，纯缓存查询。前端实时分析走 POST /api/gem/analyze
   */
  async searchStocks(keyword: string): Promise<OpportunityStock[]> {
    const results: OpportunityStock[] = [];
    try {
      const allCached = [...(this.cache?.data || []), ...(this.mainBoardCache?.data || [])];
      // 去重
      const seen = new Set<string>();
      const deduped = allCached.filter(s => {
        const key = s.code;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const kw = keyword.toLowerCase().trim();
      const matched = deduped.filter(s => {
        // 代码匹配
        if ((s.code || '').toLowerCase().includes(kw)) return true;
        // 名称文字匹配
        if ((s.name || '').toLowerCase().includes(kw)) return true;
        // 拼音首字母匹配（如"zgsy"→"中国石油"）
        try {
          const py = pinyin(s.name || '', { pattern: 'first', toneType: 'none' }).replace(/\s+/g, '');
          if (py.includes(kw)) return true;
        } catch (_) {}
        return false;
      }).slice(0, 15);
      if (matched.length === 0) return results;
      // 应用信号重算，与机会列表保持一致
      this.recalculateSuggestions(matched);
      // ─── 搜索结果应用卖出锁定 ───
      for (const r of matched) {
        const sellEntry = this.sellStateCache.get(r.code);
        if (sellEntry) {
          const hasBuySignal =
            ['重仓买入', '买入'].includes(r.suggestion || '') &&
            r.isGoldenCross === true &&
            (r.entryTiming ?? 0) >= 50;
          if (hasBuySignal) {
            this.sellStateCache.delete(r.code);
            this.logger.log(`🔓 [搜索] ${r.name}(${r.code}) 出现买入信号，自动解除卖出锁定`);
          } else {
            r.suggestion = '不要介入';
            r.trendPrediction = { direction: '方向不明', score: 30, reason: '卖出锁定中', details: {} };
          }
        }
      }
      // 刷新搜索结果的未来1-2天预测，与机会区保持一致
      this.addForecastToCache(matched);
      results.push(...matched);
    } catch (e) {
      this.logger.error(`缓存搜索失败: ${(e as Error).message}`);
    }
    return results;
  }

  /**
   * 服务端全市场重新扫描：从 Sina API 获取股票列表 → 筛选活跃股 → 全量分析 → 缓存结果
   */
  async rescanMarket(): Promise<OpportunityStock[]> {
    const now = Date.now();
    this.logger.log('开始按新标准重新评估缓存的个股...');

    try {
      // 收集所有已缓存的个股
      const allCached: OpportunityStock[] = [];
      if (this.cache?.data) allCached.push(...this.cache.data);
      if (this.mainBoardCache?.data) allCached.push(...this.mainBoardCache.data);
      const seenCodes = new Set<string>();
      const uniqueStocks: OpportunityStock[] = [];
      for (const s of allCached) {
        if (s.code && !seenCodes.has(s.code)) { seenCodes.add(s.code); uniqueStocks.push(s); }
      }
      this.logger.log(`收集到 ${uniqueStocks.length} 只缓存的个股，应用新标准重新评估`);

      // 对每只缓存个股应用三层体系 + 筹码修正
      const updated: OpportunityStock[] = [];
      for (const s of uniqueStocks) {
        try {
          const pp = s.pricePosition ?? 50;
          const goldenCross = s.isGoldenCross ?? false;
          const jiGou = s.jiGouActiveScore ?? 0;
          const chipConc = s.chipConcentration90 ?? 50;
          const chipPeak = s.chipPeakPosition ?? 'mid';
          const chipPat = s.chipPattern ?? 'dispersed';

          // 根据缓存数据推断趋势状态
          let trendState = 1;
          if (pp > 55 && goldenCross) trendState = 3;
          else if (pp > 40) trendState = 2;
          else if (pp < 25) trendState = 0;

          // ─── 先检查卖出锁定 ───
          const sellEntry = this.sellStateCache.get(s.code);
          if (sellEntry) {
            // 检查是否出现真实买入信号 → 自动解除锁定
            const canUnlock = (s.suggestion && ['重仓买入', '买入'].includes(s.suggestion)) && goldenCross === true && pp >= 50;
            if (canUnlock) {
              this.sellStateCache.delete(s.code);
              this.logger.log(`🔓 [重扫] ${s.name}(${s.code}) 出现买入信号，自动解除卖出锁定`);
              // 解锁后走正常信号逻辑
            } else {
              // 🔒 卖出锁定生效：不要介入
              updated.push({
                ...s,
                suggestion: '不要介入',
                score: Math.min(s.score ?? 50, 30),
              });
              continue;
            }
          }

          // ─── 已有卖出信号(卖出/减仓/不要介入) → 保留并上锁 ───
          const SELL_SIGS = ['卖出', '减仓', '不要介入'];
          let newSuggestion: string;
          if (s.suggestion && SELL_SIGS.includes(s.suggestion)) {
            newSuggestion = s.suggestion ?? '持有';
            if (newSuggestion === '卖出') {
              this.sellStateCache.set(s.code, { suggestion: newSuggestion, timestamp: Date.now() });
            }
            // 跳过评分逻辑，直接到更新
          } else {
            // ─── 无信号 / 买入信号 → 趋势兜底 ───
            const isBaiXiaoActive = (s.baiXiaoDays ?? 0) > 0 || (s.buySignal?.includes('信号'));
            const baiXiaoDays = s.baiXiaoDays ?? 0;

            if (trendState >= 2 && goldenCross && isBaiXiaoActive && jiGou >= 10 && pp >= 15 && pp <= 45) {
              if (jiGou >= 14 && pp >= 20) newSuggestion = '重仓买入';
              else if (jiGou >= 10 || baiXiaoDays >= 4) newSuggestion = '买入';
              else newSuggestion = '轻仓买入';
            } else if (trendState >= 1 && goldenCross && pp > 10 && pp < 50) {
              if (baiXiaoDays >= 6) newSuggestion = '买入';
              else if (pp >= 25) newSuggestion = '轻仓买入';
              else newSuggestion = '持有';
            } else if (trendState >= 1 && pp > 15) {
              newSuggestion = '持有';
            } else {
              newSuggestion = '持有';
            }

            // 筹码修正
            const chipDowngrade = chipPat === 'dispersed' && chipPeak === 'high' && pp < 30;
            const chipRisk = chipConc > 40 && chipPeak === 'high' && pp < 25;
            if (chipDowngrade || chipRisk) {
              if (newSuggestion === '重仓买入') newSuggestion = '买入';
              else if (newSuggestion === '买入') newSuggestion = '轻仓买入';
              else if (newSuggestion === '轻仓买入') newSuggestion = '持有';
            }
            if (chipPat === 'single_peak' && chipPeak === 'low' && pp > 15 && pp < 45 && trendState >= 1) {
              if (newSuggestion === '买入') newSuggestion = '重仓买入';
              else if (newSuggestion === '轻仓买入') newSuggestion = '买入';
            }

            // 入场时机对齐
            const entry = s.entryTiming ?? 50;
            const PRIORITY_LIST = ['重仓买入', '买入', '轻仓买入', '持有', '卖出', '不要介入'];
            const sugIdx2 = PRIORITY_LIST.indexOf(newSuggestion);
            if (sugIdx2 >= 0 && entry >= 65 && sugIdx2 > 1) {
              newSuggestion = sugIdx2 <= 2 ? PRIORITY_LIST[sugIdx2 - 1] : '轻仓买入';
            } else if (sugIdx2 >= 0 && entry < 35 && sugIdx2 <= 1) {
              newSuggestion = PRIORITY_LIST[sugIdx2 + 1];
            }
          }

            // ─── 下跌趋势(MA5<MA10)兜底：下降趋势不持有不买入 ───
      if (!['重仓买入', '买入'].includes(newSuggestion) && (s.ma5 ?? 0) < (s.ma10 ?? 0)) {
        newSuggestion = '不要介入';
      }

      // 更新评分
          const BASE: Record<string, number> = {
            '重仓买入': 100, '买入': 80, '轻仓买入': 65, '持有': 40,
          };
          let newScore = BASE[newSuggestion] ?? 30;
          if (pp < 30) newScore += 15;
          else if (pp < 50) newScore += 8;
          if (goldenCross) newScore += 10;
          if (jiGou >= 12) newScore += 8;
          if (chipConc <= 25) newScore += 10;

          updated.push({
            ...s,
            suggestion: newSuggestion,
            score: newScore,
            chipConcentration90: s.chipConcentration90 ?? 50,
            chipPeakPosition: s.chipPeakPosition ?? 'mid',
            chipPattern: s.chipPattern ?? 'dispersed',
            jiGouActiveScore: s.jiGouActiveScore ?? Math.round(((s.entryTiming || 0) / 100 * 20) * 100) / 100,
          });
        } catch (e) {
          updated.push(s); // keep original on error
        }
      }

      // 排序：信号优先级 → 评分
      const PRIORITY: Record<string, number> = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '减仓': 4, '卖出': 5, '不要介入': 6 };
      updated.sort((a, b) => {
        const pa = PRIORITY[a.suggestion || '不要介入'] ?? 9;
        const pb = PRIORITY[b.suggestion || '不要介入'] ?? 9;
        if (pa !== pb) return pa - pb;
        return (b.score || 0) - (a.score || 0);
      });

      // 保留全部排序结果到缓存（含卖出/不要介入），不丢弃任何股票
      this.cache = { data: updated, timestamp: now };
      try { require('fs').writeFileSync(this.CACHE_FILE, JSON.stringify(this.cache), 'utf-8'); } catch {}

      // ─── 为结果添加简化趋势预测 + 未来1-2日预测 ───
      for (const stock of updated) {
        if (!stock.trendPrediction) {
          stock.trendPrediction = this.calcSimpleTrendPrediction(stock);
        }
      }
      this.addForecastToCache(updated);

      // 持久化卖出锁定状态
      await this.saveSellStateCache();
      this.logger.log(`重新评估完成：${updated.length} 只, 信号: ${updated.map(s=>s.suggestion).join(',')}`);
    } catch (e) {
      this.logger.error(`重新评估失败: ${(e as Error).message}`);
    }
    const BUY_ONLY = ['重仓买入', '买入', '轻仓买入'];
    return (this.cache?.data || []).filter(r => BUY_ONLY.includes(r.suggestion ?? '')).slice(0, 200);
  }

  /** 内部辅助：获取所有缓存股票（买入+持有+卖出全部返回，供前端搜索/详情使用） */

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

  async scanAllWithFrontendData(
    stocks: { code: string; name: string; price: number; changePercent: number; inflow: number; klines: any[] }[]
  ): Promise<any[]> {
    const results: any[] = [];
    for (const s of stocks) {
      if (s.klines && s.klines.length >= 20) {
        this.dataFetcher.preloadKline(s.code, s.klines);
      }
    }
    for (const s of stocks) {
      try {
        const candidate: any = {
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
          const candidate: any = {
            code: s.code, name: s.name, inflow: s.inflow,
            changePercent: s.changePercent, currentPrice: s.price,
          };
          const result = await this.checkOpportunityRelaxed(candidate);
          if (result && !results.find((ex: any) => ex.code === result.code)) results.push(result);
        } catch {}
      }
    }
    results.sort((a: any, b: any) => {
      const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
      const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
      return pa !== pb ? pa - pb
        : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
        : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
    });
    // 卖出锁定状态机: 卖出后保持不要介入直到出现买入信号
    const SELL_LOCK = ['卖出'];
    const BUY_SIGNALS = ['重仓买入', '买入', '轻仓买入'];
    for (const r of results) {
      const code = r.code;
      if (r.suggestion && BUY_SIGNALS.includes(r.suggestion)) {
        // 出现买入信号 → 解除锁定
        this.soldOutStocks.delete(code);
      } else if (r.suggestion && SELL_LOCK.includes(r.suggestion)) {
        // 卖出/减仓 → 加入锁定
        this.soldOutStocks.add(code);
      } else if (!BUY_SIGNALS.includes(r.suggestion ?? '')) {
        // 非买入信号 → 检查是否在锁定中
        if (this.soldOutStocks.has(code)) {
          r.suggestion = '不要介入';
        }
      }
    }
    const BUY_ONLY = ['重仓买入', '买入', '轻仓买入'];
    const buyResults = results.filter(r => BUY_ONLY.includes(r.suggestion ?? ''));
    const finalResults = buyResults.slice(0, 30);
    this.cache = { data: finalResults, timestamp: Date.now() };
    this.saveCacheToDisk();
    this.logger.log('\u2705 \u5168\u5e02\u573a\u626b\u63cf\u5b8c\u6210, Top' + finalResults.length + ' \u53ea');
    return finalResults;
  }

  // ─── 回测: 评分系统预测能力验证 ────────────────────────────
  async runBacktest(): Promise<any> {
    const allCodes: string[] = [];
    try {
      for (const p of [join(process.cwd(), 'assets', 'gem-cache.json'), join(process.cwd(), 'assets', 'main-board-cache.json')]) {
        if (existsSync(p)) {
          const raw = JSON.parse(readFileSync(p, 'utf-8'));
          const stocks = raw?.data || raw?.stocks || raw;
          if (Array.isArray(stocks)) stocks.forEach((s: any) => { if (s.code && !allCodes.includes(s.code)) allCodes.push(s.code); });
        }
      }
    } catch {}
    const sample = allCodes.slice(0, 20);
    this.logger.log("\u56de\u5f52\u9a8c\u8bc1: \u62bd\u53d6 " + sample.length + " \u53ea\u80a1\u7968\uff0c\u6b65\u8fdb\u6d4b\u8bd5\u8bc4\u5206\u7684\u9884\u6d4b\u80fd\u529b");

    // \u6bcf\u6761\u8bb0\u5f55: { score, ret1d, ret2d }
    const records: { score: number; ret1d: number; ret2d: number }[] = [];
    let processed = 0, totalDays = 0;

    for (const code of sample) {
      try {
        const kline = await this.dataFetcher.getKLineData(code);
        if (!kline || kline.length < 150) continue;
        processed++;

        // \u4ece day=120 \u5f00\u59cb, \u6bcf\u5929\u4e3a\u4e00\u4e2a\u6d4b\u8bd5\u70b9
        for (let day = 100; day < kline.length - 2; day += 5) {
          const slice = kline.slice(0, day + 1);
          const now = kline[day];
          const next1 = kline[day + 1];
          const next2 = kline[day + 2];
          if (!now?.close || !next1?.close || !next2?.close) continue;
          
          const result = this.calcMultiScore({ code, name: '' } as any, slice);
          if (!result) continue;
          const score = result.score;

          // \u672a\u67651-2\u65e5\u6da8\u8dcc\u5e45
          const ret1d = (next1.close - now.close) / now.close * 100;
          const ret2d = (next2.close - now.close) / now.close * 100;
          records.push({ score, ret1d, ret2d });
          totalDays++;
        }
      } catch {}
    }

    // \u6309\u8bc4\u5206\u5206\u7ec4
    const groups: Record<string, { scores: number[]; ret1ds: number[]; ret2ds: number[] }> = {};
    const ranges = [
      { label: "0-3",  min: 0, max: 3 },
      { label: "4-5",  min: 4, max: 5 },
      { label: "6-7",  min: 6, max: 7 },
      { label: "8-9",  min: 8, max: 9 },
      { label: "10-11", min: 10, max: 11 },
      { label: "12-16", min: 12, max: 16 },
    ];
    for (const r of ranges) groups[r.label] = { scores: [], ret1ds: [], ret2ds: [] };
    for (const rec of records) {
      for (const r of ranges) {
        if (rec.score >= r.min && rec.score <= r.max) {
          groups[r.label].scores.push(rec.score);
          groups[r.label].ret1ds.push(rec.ret1d);
          groups[r.label].ret2ds.push(rec.ret2d);
          break;
        }
      }
    }

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const winRate = (arr: number[]) => arr.length > 0 ? arr.filter(x => x > 0).length / arr.length * 100 : 0;

    const resultGroups = ranges.map(r => {
      const g = groups[r.label];
      const n = g.scores.length;
      const avg1d = parseFloat(avg(g.ret1ds).toFixed(2));
      const avg2d = parseFloat(avg(g.ret2ds).toFixed(2));
      const w1 = parseFloat(winRate(g.ret1ds).toFixed(1));
      const w2 = parseFloat(winRate(g.ret2ds).toFixed(1));
      return {
        range: r.label,
        count: n,
        avgScore: n > 0 ? parseFloat((g.scores.reduce((a,b) => a+b, 0) / n).toFixed(1)) : 0,
        avgRet1D: avg1d > 0 ? "+" + avg1d + "%" : avg1d + "%",
        avgRet2D: avg2d > 0 ? "+" + avg2d + "%" : avg2d + "%",
        winRate1D: w1 + "%",
        winRate2D: w2 + "%",
        _score: avg1d * n + avg2d * n * 0.5,
      };
    });
    resultGroups.sort((a, b) => b._score - a._score);

    this.logger.log("\u2705 \u56de\u5f52\u5b8c\u6210: " + processed + "/" + sample.length + " \u53ea\u6709\u6548K\u7ebf, " + totalDays + " \u4e2a\u6d4b\u8bd5\u70b9");
    return {
      summary: "\u56de\u5f52\u9a8c\u8bc1: " + processed + "/" + sample.length + " \u53ea\uff0c\u5171" + totalDays + "\u4e2a\u65e5\u7ebf\u6d4b\u8bd5\u70b9",
      method: "\u6b65\u8fdb: \u4ece120\u65e5\u7ebf\u5f00\u59cb\uff0c\u6bcf3\u65e5\u4e3a1\u4e2a\u6d4b\u8bd5\u70b9\uff0c\u5f53\u524d\u8bc4\u5206 VS \u672a\u67651-2\u65e5\u771f\u5b9e\u6da8\u8dcc",
      groups: resultGroups,
      bestGroup: resultGroups[0],
    };
  }
  /**
   * 评分预测过滤器回测: 测试不同过滤器组合对强烈看涨胜率的影响
   */
  async runForecastBacktest(): Promise<any> {
    const allCodes: string[] = [];
    try {
      for (const p of [join(process.cwd(), 'assets', 'gem-cache.json'), join(process.cwd(), 'assets', 'main-board-cache.json')]) {
        if (existsSync(p)) {
          const raw = JSON.parse(readFileSync(p, 'utf-8'));
          const stocks = raw?.data || raw?.stocks || raw;
          if (Array.isArray(stocks)) stocks.forEach((s: any) => { if (s.code && !allCodes.includes(s.code)) allCodes.push(s.code); });
        }
      }
    } catch {}
    const sample = allCodes.slice(0, 25);
    this.logger.log(`=== 评分预测过滤器回测: 抽取 ${sample.length} 只股票 ===`);

    // 每个测试点记录: { score, ret1d, ret2d, isGoldenCross, trendState, pricePosition, volumeRatio, jiGouActive }
    const records: any[] = [];
    let processed = 0, totalDays = 0;

    for (const code of sample) {
      try {
        const kline = await this.dataFetcher.getKLineData(code);
        if (!kline || kline.length < 150) continue;
        processed++;
        for (let day = 100; day < kline.length - 2; day += 5) {
          const slice = kline.slice(0, day + 1);
          const now = kline[day];
          const next1 = kline[day + 1];
          const next2 = kline[day + 2];
          if (!now?.close || !next1?.close || !next2?.close) continue;
          const result = this.calcMultiScore({ code, name: '' } as any, slice);
          if (!result) continue;
          const ret1d = (next1.close - now.close) / now.close * 100;
          const ret2d = (next2.close - now.close) / now.close * 100;
          records.push({
            score: result.score,
            ret1d,
            ret2d,
            isGoldenCross: result.isGoldenCross || false,
            trendState: result.trendState || 0,
            pricePosition: result.pricePosition || 50,
            volumeRatio: result.volumeRatio || 0.5,
            jiGouActive: (result.signals?.jiGouActive) || false,
            baiXiaoDays: result.signals?.baiXiaoDays || 0,
            baiBu: result.signals?.baiBu || false,
          });
          totalDays++;
        }
      } catch {}
    }

    // 定义要测试的过滤器组合
    // 每个组合: { label, filterFn } - filterFn takes a record and returns true if it's a "强烈看涨" signal
    const configs: { label: string; filter: (r: any) => boolean }[] = [
      { label: 'A.基准: score>=12', filter: r => r.score >= 12 },
      { label: 'B.基准: score>=10', filter: r => r.score >= 10 },
      { label: 'C.基准: score>=8', filter: r => r.score >= 8 },
      { label: 'D.评分>=12+金叉', filter: r => r.score >= 12 && r.isGoldenCross },
      { label: 'E.评分>=12+趋势>=2', filter: r => r.score >= 12 && r.trendState >= 2 },
      { label: 'F.评分>=12+位置<70', filter: r => r.score >= 12 && r.pricePosition < 70 },
      { label: 'G.评分>=12+金叉+趋势>=2', filter: r => r.score >= 12 && r.isGoldenCross && r.trendState >= 2 },
      { label: 'H.评分>=12+金叉+趋势>=2+位置<70', filter: r => r.score >= 12 && r.isGoldenCross && r.trendState >= 2 && r.pricePosition < 70 },
      { label: 'I.评分>=12+金叉+趋势>=2+位置<70+量比>0.6', filter: r => r.score >= 12 && r.isGoldenCross && r.trendState >= 2 && r.pricePosition < 70 && r.volumeRatio > 0.6 },
      { label: 'J.评分>=10+金叉+趋势>=2+位置<80', filter: r => r.score >= 10 && r.isGoldenCross && r.trendState >= 2 && r.pricePosition < 80 },
      { label: 'K.评分>=10+金叉+趋势>=1+位置<80+量比>0.6', filter: r => r.score >= 10 && r.isGoldenCross && r.trendState >= 1 && r.pricePosition < 80 && r.volumeRatio > 0.6 },
      { label: 'L.评分>=8+金叉+趋势>=2+位置<75', filter: r => r.score >= 8 && r.isGoldenCross && r.trendState >= 2 && r.pricePosition < 75 },
      { label: 'M.评分>=14', filter: r => r.score >= 14 },
      { label: 'N.评分>=12+金叉+机构活跃', filter: r => r.score >= 12 && r.isGoldenCross && r.jiGouActive },
    ];

    const results: any[] = [];
    for (const cfg of configs) {
      const matched = records.filter(cfg.filter);
      const n = matched.length;
      if (n < 3) {
        results.push({ config: cfg.label, count: n, avgRet1D: 'N/A(样本不足)', winRate1D: 'N/A', avgRet2D: 'N/A', winRate2D: 'N/A', score: 0 });
        continue;
      }
      const avg1d = matched.reduce((s, r) => s + r.ret1d, 0) / n;
      const avg2d = matched.reduce((s, r) => s + r.ret2d, 0) / n;
      const w1 = matched.filter(r => r.ret1d > 0).length / n * 100;
      const w2 = matched.filter(r => r.ret2d > 0).length / n * 100;
      const fmtRet = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
      results.push({
        config: cfg.label,
        count: n,
        pct: (n / records.length * 100).toFixed(1) + '%',
        avgRet1D: fmtRet(avg1d),
        winRate1D: w1.toFixed(1) + '%',
        avgRet2D: fmtRet(avg2d),
        winRate2D: w2.toFixed(1) + '%',
        _score: avg1d * 0.6 + avg2d * 0.3 + (w1 / 100) * 0.1,
      });
    }
    results.sort((a, b) => b._score - a._score);

    // 额外: 分析评分6-8分区域(高胜率区间)
    const midRecords = records.filter(r => r.score >= 6 && r.score <= 8 && r.isGoldenCross);
    const midAvg1d = midRecords.length > 0 ? midRecords.reduce((s, r) => s + r.ret1d, 0) / midRecords.length : 0;
    const midWin1 = midRecords.length > 0 ? midRecords.filter(r => r.ret1d > 0).length / midRecords.length * 100 : 0;

    this.logger.log(`✅ 评分预测回测完成: ${processed}/${sample.length}只有效, ${totalDays}个测试点`);
    return {
      summary: `评分预测过滤器回测: ${processed}/${sample.length}只股票, ${totalDays}个测试点`,
      records: `每个记录含 score/ret1d/ret2d/isGoldenCross/trendState/pricePosition/volumeRatio`,
      totalRecords: records.length,
      combinations: results,
      bestConfig: results[0] || { config: '无足够数据' },
      midRangeInfo: {
        desc: '评分6-8+金叉(高胜率稳定区间)',
        count: midRecords.length,
        avgRet1D: midRecords.length > 0 ? (midAvg1d > 0 ? '+' : '') + midAvg1d.toFixed(2) + '%' : 'N/A',
        winRate1D: midRecords.length > 0 ? midWin1.toFixed(1) + '%' : 'N/A',
      },
    };
  }

}
