import { Injectable, Logger } from '@nestjs/common';
import { FormulaEngine } from './formula-engine';
import { calcBaiSanJiao } from './bai-san-jiao';
import { calcBaiLingXing } from './bai-ling-xing';
import { calcBaiXing } from './bai-xing';
import { calcXingXing } from './xing-xing';
import { DataFetcherService } from './data-fetcher.service';
import { generateSignals } from './rule-engine';
import { StockInfo, BacktestStats, SignalEntry } from './types';
import { promises as fs, existsSync, readFileSync } from 'fs';
import { join } from 'node:path';

/** 简便MA计算 */
function calculateMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(data[i]); // 不足周期直接用当前值
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(sum / period);
    }
  }
  return result;
}

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);
  private readonly ANALYSIS_CACHE_FILE = '/tmp/stock-analysis-cache.json';
  private readonly BUNDLED_ANALYSIS_CACHE = join(__dirname, '..', '..', '..', 'assets', 'stock-analysis-cache.json');
  /** code → analysis result */
  private analysisCache: Map<string, any> = new Map();

  constructor(private readonly dataFetcher: DataFetcherService) {
    this.loadAnalysisCache();
  }

  // ---------------------------------------------------------------------------
  // 分析结果缓存管理
  // ---------------------------------------------------------------------------
  private loadAnalysisCache(): void {
    try {
      // 尝试本地 /tmp 缓存
      const raw = readFileSync(this.ANALYSIS_CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [code, result] of Object.entries(parsed)) {
          this.analysisCache.set(code, result);
        }
        this.logger.log(`📦 加载分析缓存 ${this.analysisCache.size} 只股票`);
        return;
      }
    } catch { /* 无 /tmp 缓存 */ }

    // 回退：部署包内置缓存
    try {
      if (existsSync(this.BUNDLED_ANALYSIS_CACHE)) {
        const raw = readFileSync(this.BUNDLED_ANALYSIS_CACHE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [code, result] of Object.entries(parsed)) {
            this.analysisCache.set(code, result);
          }
          this.logger.log(`📦 从部署包加载分析缓存 ${this.analysisCache.size} 只股票`);
        }
      }
    } catch (err) {
      this.logger.warn(`⚠️ 分析缓存加载失败: ${err.message}`);
    }
  }

  private saveAnalysisCache(): void {
    try {
      const obj: Record<string, any> = {};
      this.analysisCache.forEach((v, k) => { obj[k] = v; });
      fs.writeFile(this.ANALYSIS_CACHE_FILE, JSON.stringify(obj), 'utf-8').catch(() => {});
    } catch { /* ignore */ }
  }

  /** 检查是否有缓存的股票分析结果 */
  getCachedAnalysis(stockCode: string): any | null {
    return this.analysisCache.get(stockCode) || null;
  }

  /** 预缓存单只股票的分析结果 */
  async preCacheAnalysis(stockCode: string): Promise<void> {
    if (this.analysisCache.has(stockCode)) return; // 已有缓存
    try {
      this.logger.log(`📦 预缓存分析: ${stockCode}`);
      const result = await this.analyzeStock(stockCode);
      this.analysisCache.set(stockCode, result);
      this.saveAnalysisCache();
      this.logger.log(`✅ 预缓存分析完成: ${stockCode}`);
    } catch (err) {
      this.logger.warn(`⚠️ 预缓存分析失败 ${stockCode}: ${err.message}`);
    }
  }

  /** 批量预缓存分析 */
  async preCacheAnalysisBatch(codes: string[], concurrency = 3): Promise<void> {
    const toCache = codes.filter(c => !this.analysisCache.has(c));
    if (toCache.length === 0) return;
    this.logger.log(`📦 批量预缓存分析: ${toCache.length} 只股票`);
    for (let i = 0; i < toCache.length; i += concurrency) {
      const batch = toCache.slice(i, i + concurrency);
      await Promise.all(batch.map(c => this.preCacheAnalysis(c).catch(() => {})));
    }
    this.saveAnalysisCache();
    this.logger.log(`✅ 批量预缓存完成: ${this.analysisCache.size} 只`);
  }

  /**
   * 搜索股票（支持代码、名称、拼音首字母）
   */
  async searchStock(query: string): Promise<StockInfo[]> {
    return this.dataFetcher.searchStock(query);
  }

  /**
   * 计算历史回测统计
   * 对已出现的形态信号，统计历史上N日后的涨跌概率
   */
  computeBacktestStats(closePrices: number[]): BacktestStats | null {
    const len = closePrices.length;
    if (len < 40) return null;

    // 计算均线
    const ma5 = calculateMA(closePrices, 5);
    const ma10 = calculateMA(closePrices, 10);
    const ma20 = calculateMA(closePrices, 20);

    // 扫描两种最常见形态的统计
    // 形态A: 突破5日线 + 均线多头排列
    const patternOccurrences: number[] = []; // 每次出现的收盘价
    for (let i = 21; i < len - 10; i++) {
      if (ma5[i] > ma10[i] && ma10[i] > ma20[i] &&
          closePrices[i] > ma5[i] && closePrices[i - 1] <= (ma5[i - 1] || 0)) {
        patternOccurrences.push(i);
      }
    }

    if (patternOccurrences.length < 5) return null;

    // 统计N日后上涨概率
    const up3Count = patternOccurrences.filter(idx => closePrices[idx + 3] > closePrices[idx]).length;
    const up5Count = patternOccurrences.filter(idx => closePrices[idx + 5] > closePrices[idx]).length;
    const up10Count = patternOccurrences.filter(idx => closePrices[idx + 10] > closePrices[idx]).length;

    // 计算盈亏比（5日后收益）
    const returns = patternOccurrences
      .filter(idx => idx + 5 < len)
      .map(idx => (closePrices[idx + 5] - closePrices[idx]) / closePrices[idx]);
    const avgWin = returns.filter(r => r > 0).reduce((s, r) => s + r, 0) / Math.max(returns.filter(r => r > 0).length, 1);
    const avgLoss = returns.filter(r => r <= 0).reduce((s, r) => s + r, 0) / Math.max(returns.filter(r => r <= 0).length, 1);

    const total = patternOccurrences.length;

    return {
      patternName: '突破5日线+均线多头排列',
      totalOccurrences: total,
      upProbability: [
        { days: 3, probability: parseFloat((up3Count / total * 100).toFixed(1)), avgReturn: parseFloat((returns.filter((_, i) => i < up3Count).reduce((s, r) => s + r, 0) / total * 100).toFixed(2)) },
        { days: 5, probability: parseFloat((up5Count / total * 100).toFixed(1)), avgReturn: parseFloat((returns.filter((_, i) => i < up5Count).reduce((s, r) => s + r, 0) / total * 100).toFixed(2)) },
        { days: 10, probability: parseFloat((up10Count / total * 100).toFixed(1)), avgReturn: parseFloat((returns.reduce((s, r) => s + r, 0) / total * 100).toFixed(2)) },
      ],
      profitLossRatio: parseFloat((Math.abs(avgWin / Math.max(avgLoss, 0.001))).toFixed(2)),
      maxDrawdown: 0,
    };
  }

  /**
   * 分析单只股票 - 返回技术指标+中性信号+回测统计
   * 不含任何"买入/卖出/持有"等投资建议
   */
  async analyzeStock(query: string) {
    // 提取纯股票代码用于缓存查找
    const pureCode = query.replace(/^(sh|sz|SH|SZ)/, '').trim();
    const cached = this.getCachedAnalysis(pureCode);
    if (cached) {
      this.logger.log(`📦 命中分析缓存: ${pureCode}`);
      return cached;
    }

    // 1. 搜索并确认股票
    const stocks = await this.dataFetcher.searchStock(query);
    if (!stocks || stocks.length === 0) {
      throw new Error(`未找到股票: ${query}`);
    }
    const stock = stocks[0];

    // 2. 获取实时行情
    const realTime = await this.dataFetcher.fetchRealTimeQuote(stock.code);
    if (realTime) {
      stock.name = realTime.name;
      this.logger.log(`腾讯行情: ${stock.name} 当前价=${realTime.price}`);
    }

    // 3. 获取日K线数据
    const klines = await this.dataFetcher.getKLineData(stock.code, stock.market);
    this.logger.log(`获取到 ${klines.length} 条K线数据`);

    // 4. 创建公式引擎
    const engine = new FormulaEngine({
      open: klines.map(k => k.open),
      close: klines.map(k => k.close),
      high: klines.map(k => k.high),
      low: klines.map(k => k.low),
      volume: klines.map(k => k.volume),
      amount: klines.map(k => k.amount),
    });

    // 5. 计算四套公式
    const baiSanJiaoResult = calcBaiSanJiao(engine);
    const baiLingXingResult = calcBaiLingXing(engine);
    const baiXingResult = calcBaiXing(engine);
    const xingXingResult = calcXingXing(engine);

    // 6. 计算集中度90标准展示值
    const hhv2 = engine.HHV(engine.HIGH, 2);
    const llv2 = engine.LLV(engine.LOW, 2);
    const lastHhv2 = hhv2[hhv2.length - 1];
    const lastLlv2 = llv2[llv2.length - 1];
    const concentrationDisplay = lastHhv2 + lastLlv2 > 0
      ? parseFloat(((lastHhv2 - lastLlv2) / (lastHhv2 + lastLlv2) * 200).toFixed(2))
      : 0;

    // 7. 合并结果
    const formulaResult = {
      ...baiSanJiaoResult,
      ...baiLingXingResult,
      ...baiXingResult,
      ...xingXingResult,
      concentrationDisplay,
    };

    // 8. 生成中性信号列表
    const signals: SignalEntry[] = generateSignals({ formula: formulaResult });

    // 9. 60日线偏离提醒（仅做数据展示，非建议）
    const closePrices = klines.map(k => k.close);
    const ma60Val = calculateMA(closePrices, 60);
    const lastMa60 = ma60Val[ma60Val.length - 1];
    const currentPrice = realTime?.price ?? klines[klines.length - 1]?.close ?? 0;
    if (lastMa60 > 0 && currentPrice > 0) {
      const deviation = (currentPrice - lastMa60) / lastMa60;
      if (deviation > 0.25) {
        signals.push({
          name: `远离60日线${(deviation * 100).toFixed(0)}%`,
          type: 'negative',
          description: '近期涨幅较大'
        });
      }
    }

    // 10. 计算回测统计
    const backtestStats = this.computeBacktestStats(closePrices);

    // 11. 判断是否使用真实K线（避免缓存模拟数据）
    const isMockData = !!(klines as any)._isMock;
    const usesRealKline = klines.length > 100 && klines.length >= 480 && !isMockData;

    // 12. 价格数据
    const changePercent = realTime?.changePercent ?? 0;
    const high = realTime?.high;
    const low = realTime?.low;

    // 13. 如果使用真实K线数据，动态缓存结果（避免模拟数据污染缓存）
    if (usesRealKline) {
      const cacheEntry = {
        stock, currentPrice, changePercent, high, low,
        klineCount: klines.length,
        formula: formulaResult,
        signals,
        backtestStats,
      };
      this.analysisCache.set(pureCode, cacheEntry);
      this.saveAnalysisCache();
    }

    return {
      stock,
      currentPrice,
      changePercent,
      high,
      low,
      klineCount: klines.length,
      formula: formulaResult,
      signals,
      backtestStats,
    };
  }
}