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

import { getTradingSuggestion } from '../../utils/trading-suggestion';

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

  /**
   * 从前端提供的原始数据直接分析（不经过内部数据获取）
   * 用于前端直连国内API后发送数据到后端缓存的场景
   */
  async analyzeFromRawData(params: {
    code: string;
    name: string;
    currentPrice: number;
    changePercent: number;
    high?: number;
    low?: number;
    kline: Array<{ open: number; close: number; high: number; low: number; volume: number; amount?: number }>;
  }) {
    const { code, name, currentPrice, changePercent, high, low, kline } = params;

    // 1. 创建公式引擎
    const engine = new FormulaEngine({
      open: kline.map(k => k.open),
      close: kline.map(k => k.close),
      high: kline.map(k => k.high),
      low: kline.map(k => k.low),
      volume: kline.map(k => k.volume),
      amount: kline.map(k => k.amount ?? 0),
    });

    // 2. 计算四套公式
    const baiSanJiaoResult = calcBaiSanJiao(engine);
    const baiLingXingResult = calcBaiLingXing(engine);
    const baiXingResult = calcBaiXing(engine);
    const xingXingResult = calcXingXing(engine);

    // 3. 计算集中度90
    const hhv2 = engine.HHV(engine.HIGH, 2);
    const llv2 = engine.LLV(engine.LOW, 2);
    const lastHhv2 = hhv2[hhv2.length - 1];
    const lastLlv2 = llv2[llv2.length - 1];
    const concentrationDisplay = lastHhv2 + lastLlv2 > 0
      ? parseFloat(((lastHhv2 - lastLlv2) / (lastHhv2 + lastLlv2) * 200).toFixed(2))
      : 0;

    // 4. 合并结果
    const formulaResult = {
      ...baiSanJiaoResult,
      ...baiLingXingResult,
      ...baiXingResult,
      ...xingXingResult,
      concentrationDisplay,
    } as any;

    // 5. 信号列表
    const signals: SignalEntry[] = generateSignals({ formula: formulaResult });

    // 6. 均线数据
    const closePrices = kline.map(k => k.close);
    const ma5 = closePrices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closePrices.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma5Up = closePrices[closePrices.length - 1] > closePrices[closePrices.length - 6];
    const ma10Up = closePrices[closePrices.length - 1] > closePrices[closePrices.length - 11];
    const pricePos = formulaResult.pricePosition ?? 50;

    // 7. 交易建议
    const stockInput: any = {
      baiXiao: !!(formulaResult as any)?.baiXiao,
      baiXiaoDays: (formulaResult as any)?.baiXiaoDays ?? 0,
      baiBu: !!(formulaResult as any)?.baiBu,
      baiBuDays: (formulaResult as any)?.baiBuDays ?? 0,
      baiXiaoBuy1: !!(formulaResult as any)?.baiXiaoBuy1,
      baiXiaoBuy2: !!(formulaResult as any)?.baiXiaoBuy2,
      qiangShiHuiCai: !!(formulaResult as any)?.qiangShiHuiCai,
      hengPanTuPo: !!(formulaResult as any)?.hengPanTuPo,
      shortBuy: !!((formulaResult as any)?.shortBuy),
      strictBuy: !!((formulaResult as any)?.strictBuy),
      zhenDangMaiDian: !!(formulaResult as any)?.zhenDangMaiDian,
      zhongWeiZhuSheng: !!(formulaResult as any)?.zhongWeiZhuSheng,
      zhongGaoWeiZhuSheng: !!(formulaResult as any)?.zhongGaoWeiZhuSheng,
      gaoFengXianZhuSheng: !!(formulaResult as any)?.gaoFengXianZhuSheng,
      jiaCang: !!(formulaResult as any)?.jiaCang,
      diBuBuy: !!(formulaResult as any)?.diBuBuy,
      zhuLiShiPan: !!(formulaResult as any)?.zhuLiShiPan,
      qiWen: !!(formulaResult as any)?.qiWen,
      tiaoJianChengLi: !!(formulaResult as any)?.tiaoJianChengLi,
      zhuLiChuHuo: !!(formulaResult as any)?.zhuLiChuHuo,
      jinJiChuHuo: !!formulaResult?.jinJiChuHuo,
      gaoKaiDiZouQingCang: !!(formulaResult as any)?.gaoKaiDiZouQingCang,
      baoLiangFuGaiQingCang: !!(formulaResult as any)?.baoLiangFuGaiQingCang,
      po5RiXian: !!(formulaResult as any)?.po5RiXian,
      qiangZhiFuGai: !!(formulaResult as any)?.qiangZhiFuGai,
      yinDiePoWei: !!(formulaResult as any)?.yinDiePoWei,
      jiGouActiveScore: (formulaResult as any)?.jiGouHuoYueDu ?? 0,
      ma5,
      ma10,
      currentPrice,
      ma5Up,
      ma10Up,
      pricePosition: pricePos,
      trendState: (formulaResult as any)?.trendState ?? 1,
    };
    const suggestion = getTradingSuggestion(stockInput);

    // 8. 返回结果
    const result = {
      code,
      name,
      currentPrice,
      changePercent,
      high,
      low,
      klineCount: kline.length,
      formula: formulaResult,
      signals,
      suggestion: suggestion.action,
      reason: suggestion.reason,
      score: suggestion.score,
      entryTiming: suggestion.entryTiming,
      ma5,
      ma10,
      ma5Up,
      ma10Up,
      pricePosition: pricePos,
      baiXiaoDays: (formulaResult as any)?.baiXiaoDays ?? 0,
      baiBu: !!(formulaResult as any)?.baiBu,
      jiGouActiveScore: (formulaResult as any)?.jiGouHuoYueDu ?? 0,
      isGoldenCross: ((formulaResult as any)?.diff ?? 0) > ((formulaResult as any)?.dea ?? 0),
    };
    return result;
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

    // 如果是非数字查询（如 twgf），此处会走搜索流程
    // 搜索后会用 stock.code 再次尝试命中缓存（见下方步骤 1.5）

    // 1. 搜索并确认股票
    const stocks = await this.dataFetcher.searchStock(query);
    if (!stocks || stocks.length === 0) {
      throw new Error(`未找到股票: ${query}`);
    }
    const stock = stocks[0];

    // 1.5 用股票代码再次尝试命中缓存（解决 twgf→600438 缓存key不一致问题）
    const cachedByCode = this.getCachedAnalysis(stock.code);
    if (cachedByCode) {
      this.logger.log(`📦 命中分析缓存: ${stock.code} (from keyword: ${query})`);
      return cachedByCode;
    }

    // 2. 获取实时行情
    const realTime = await this.dataFetcher.fetchRealTimeQuote(stock.code);
    if (realTime) {
      stock.name = realTime.name;
      this.logger.log(`腾讯行情: ${stock.name} 当前价=${realTime.price}`);
    }

    // 3. 获取日K线数据
    const klines = await this.dataFetcher.getKLineData(stock.code, stock.market);
    this.logger.log(`获取到 ${klines.length} 条K线数据`);

    // 3.5 新股提醒：不足60个交易日时追加警示
    const isNewStock = klines.length < 60;
    let newStockWarning: SignalEntry | null = null;
    if (isNewStock) {
      newStockWarning = {
        name: `⚠️ 新股预警`,
        type: 'warning',
        description: `上市不足60个交易日（仅${klines.length}天），技术分析参考价值有限`
      };
    }

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
    } as any;

    // 8. 生成中性信号列表
    const signals: SignalEntry[] = generateSignals({ formula: formulaResult });

    // 新股预警追加到信号列表
    if (newStockWarning) {
      signals.push(newStockWarning);
    }

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

    // 13. 计算交易建议（与quickAnalyze保持一致）
    const closeArr = closePrices;
    const volumeArr = klines.map(k => k.volume);
    const highArr = klines.map(k => k.high);
    const lowArr = klines.map(k => k.low);
    const lastPrice = currentPrice ?? closePrices[closePrices.length - 1];
    const high60 = Math.max(...highArr.slice(-60));
    const low60 = Math.min(...lowArr.slice(-60));
    const pricePos = high60 > low60 ? ((lastPrice - low60) / (high60 - low60)) * 100 : 50;
    const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const ma5Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 6];
    const ma10Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 11];
    let trendState = 1;
    if (ma5 > ma10 && ma10 > ma20 && ma5Up && ma10Up) trendState = 3;
    else if (ma5 > ma10 && ma5Up) trendState = 2;
    else if (ma5 < ma10 && ma10 < ma20) trendState = 0;

    // 计算MACD
    let macdDiff = 0, macdDea = 0, isGoldenCross = false;
    try {
      const ema12 = closeArr.reduce((s, v, i) => i === 0 ? v : s + (v - s) * 2 / 13, 0);
      const ema26 = closeArr.reduce((s, v, i) => i === 0 ? v : s + (v - s) * 2 / 27, 0);
      macdDiff = ema12 - ema26;
      const deaArr: number[] = closeArr.reduce((arr: number[], v, i) => {
        const prev = arr.length ? arr[arr.length - 1] : 0;
        arr.push(i === 0 ? (closeArr[0]) : prev + ( ((ema12 - ema26) - prev) * 2 / 9 ));
        return arr;
      }, []);
      macdDea = deaArr[deaArr.length - 1] || 0;
      isGoldenCross = macdDiff > macdDea;
    } catch {}

    // 使用共享的 getTradingSuggestion 算法（与前端和机会区一致）
    const stockInput: any = {
      baiXiao: !!(formulaResult as any)?.baiXiao,
      baiXiaoDays: (formulaResult as any)?.baiXiaoDays ?? 0,
      baiBu: !!(formulaResult as any)?.baiBu,
      baiBuDays: (formulaResult as any)?.baiBuDays ?? 0,
      baiXiaoBuy1: !!(formulaResult as any)?.baiXiaoBuy1,
      baiXiaoBuy2: !!(formulaResult as any)?.baiXiaoBuy2,
      qiangShiHuiCai: !!(formulaResult as any)?.qiangShiHuiCai,
      hengPanTuPo: !!(formulaResult as any)?.hengPanTuPo,
      shortBuy: !!((formulaResult as any)?.shortBuy),
      strictBuy: !!((formulaResult as any)?.strictBuy),
      zhenDangMaiDian: !!(formulaResult as any)?.zhenDangMaiDian,
      zhongWeiZhuSheng: !!(formulaResult as any)?.zhongWeiZhuSheng,
      zhongGaoWeiZhuSheng: !!(formulaResult as any)?.zhongGaoWeiZhuSheng,
      gaoFengXianZhuSheng: !!(formulaResult as any)?.gaoFengXianZhuSheng,
      jiaCang: !!((formulaResult as any)?.jiaCang),
      diBuBuy: !!((formulaResult as any)?.diBuBuy),
      zhuLiShiPan: !!((formulaResult as any)?.zhuLiShiPan),
      qiWen: !!((formulaResult as any)?.qiWen),
      tiaoJianChengLi: !!((formulaResult as any)?.tiaoJianChengLi),
      zhuLiChuHuo: !!((formulaResult as any)?.zhuLiChuHuo),
      gaoKaiDiZouQingCang: !!((formulaResult as any)?.gaoKaiDiZouQingCang),
      baoLiangFuGaiQingCang: !!((formulaResult as any)?.baoLiangFuGaiQingCang),
      po5RiXian: !!((formulaResult as any)?.po5RiXian),
      qiangZhiFuGai: !!((formulaResult as any)?.qiangZhiFuGai),
      yinDiePoWei: !!((formulaResult as any)?.yinDiePoWei),
      jiGouActiveScore: (formulaResult as any)?.jiGouHuoYueDu ?? 0,
      ma5,
      ma10,
      currentPrice: currentPrice ?? closePrices[closePrices.length - 1],
      ma5Up: closeArr[closeArr.length - 1] > closeArr[closeArr.length - 6],
      ma10Up: closeArr[closeArr.length - 1] > closeArr[closeArr.length - 11],
      pricePosition: pricePos,
      trendState,
    };
    const stockSuggestion = getTradingSuggestion(stockInput);
    const suggestion = stockSuggestion.action;
    const reason = stockSuggestion.reason || '';
    const score = stockSuggestion.score || 0;
    const prediction = '';

    // 14. 如果使用真实K线数据，动态缓存结果（避免模拟数据污染缓存）
    if (usesRealKline) {
      const cacheEntry = {
        stock, currentPrice, changePercent, high, low,
        klineCount: klines.length,
        formula: formulaResult,
        signals,
        backtestStats,
        suggestion,
        prediction,
        reason,
      };
      this.analysisCache.set(stock.code, cacheEntry);
      this.saveAnalysisCache();
    }

    return {
      stock,
      currentPrice,
      changePercent,
      high,
      low,
      klineCount: klines.length,
      isNewStock,
      formula: formulaResult,
      signals,
      backtestStats,
      suggestion,
      prediction,
      reason,
    };
  }
}