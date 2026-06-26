"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var StockService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockService = void 0;
const common_1 = require("@nestjs/common");
const formula_engine_1 = require("./formula-engine");
const bai_san_jiao_1 = require("./bai-san-jiao");
const bai_ling_xing_1 = require("./bai-ling-xing");
const bai_xing_1 = require("./bai-xing");
const xing_xing_1 = require("./xing-xing");
const data_fetcher_service_1 = require("./data-fetcher.service");
const rule_engine_1 = require("./rule-engine");
const fs_1 = require("fs");
const node_path_1 = require("node:path");
const trading_suggestion_1 = require("../../utils/trading-suggestion");
function calculateMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push(data[i]);
        }
        else {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++)
                sum += data[j];
            result.push(sum / period);
        }
    }
    return result;
}
let StockService = StockService_1 = class StockService {
    constructor(dataFetcher) {
        this.dataFetcher = dataFetcher;
        this.logger = new common_1.Logger(StockService_1.name);
        this.ANALYSIS_CACHE_FILE = '/tmp/stock-analysis-cache.json';
        this.BUNDLED_ANALYSIS_CACHE = (0, node_path_1.join)(__dirname, '..', '..', '..', 'assets', 'stock-analysis-cache.json');
        this.analysisCache = new Map();
        this.loadAnalysisCache();
    }
    loadAnalysisCache() {
        try {
            const raw = (0, fs_1.readFileSync)(this.ANALYSIS_CACHE_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                for (const [code, result] of Object.entries(parsed)) {
                    this.analysisCache.set(code, result);
                }
                this.logger.log(`📦 加载分析缓存 ${this.analysisCache.size} 只股票`);
                return;
            }
        }
        catch { }
        try {
            if ((0, fs_1.existsSync)(this.BUNDLED_ANALYSIS_CACHE)) {
                const raw = (0, fs_1.readFileSync)(this.BUNDLED_ANALYSIS_CACHE, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    for (const [code, result] of Object.entries(parsed)) {
                        this.analysisCache.set(code, result);
                    }
                    this.logger.log(`📦 从部署包加载分析缓存 ${this.analysisCache.size} 只股票`);
                }
            }
        }
        catch (err) {
            this.logger.warn(`⚠️ 分析缓存加载失败: ${err.message}`);
        }
    }
    saveAnalysisCache() {
        try {
            const obj = {};
            this.analysisCache.forEach((v, k) => { obj[k] = v; });
            fs_1.promises.writeFile(this.ANALYSIS_CACHE_FILE, JSON.stringify(obj), 'utf-8').catch(() => { });
        }
        catch { }
    }
    getCachedAnalysis(stockCode) {
        return this.analysisCache.get(stockCode) || null;
    }
    async preCacheAnalysis(stockCode) {
        if (this.analysisCache.has(stockCode))
            return;
        try {
            this.logger.log(`📦 预缓存分析: ${stockCode}`);
            const result = await this.analyzeStock(stockCode);
            this.analysisCache.set(stockCode, result);
            this.saveAnalysisCache();
            this.logger.log(`✅ 预缓存分析完成: ${stockCode}`);
        }
        catch (err) {
            this.logger.warn(`⚠️ 预缓存分析失败 ${stockCode}: ${err.message}`);
        }
    }
    async preCacheAnalysisBatch(codes, concurrency = 3) {
        const toCache = codes.filter(c => !this.analysisCache.has(c));
        if (toCache.length === 0)
            return;
        this.logger.log(`📦 批量预缓存分析: ${toCache.length} 只股票`);
        for (let i = 0; i < toCache.length; i += concurrency) {
            const batch = toCache.slice(i, i + concurrency);
            await Promise.all(batch.map(c => this.preCacheAnalysis(c).catch(() => { })));
        }
        this.saveAnalysisCache();
        this.logger.log(`✅ 批量预缓存完成: ${this.analysisCache.size} 只`);
    }
    async searchStock(query) {
        return this.dataFetcher.searchStock(query);
    }
    computeBacktestStats(closePrices) {
        const len = closePrices.length;
        if (len < 40)
            return null;
        const ma5 = calculateMA(closePrices, 5);
        const ma10 = calculateMA(closePrices, 10);
        const ma20 = calculateMA(closePrices, 20);
        const patternOccurrences = [];
        for (let i = 21; i < len - 10; i++) {
            if (ma5[i] > ma10[i] && ma10[i] > ma20[i] &&
                closePrices[i] > ma5[i] && closePrices[i - 1] <= (ma5[i - 1] || 0)) {
                patternOccurrences.push(i);
            }
        }
        if (patternOccurrences.length < 5)
            return null;
        const up3Count = patternOccurrences.filter(idx => closePrices[idx + 3] > closePrices[idx]).length;
        const up5Count = patternOccurrences.filter(idx => closePrices[idx + 5] > closePrices[idx]).length;
        const up10Count = patternOccurrences.filter(idx => closePrices[idx + 10] > closePrices[idx]).length;
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
    async analyzeStock(query) {
        const pureCode = query.replace(/^(sh|sz|SH|SZ)/, '').trim();
        const cached = this.getCachedAnalysis(pureCode);
        if (cached) {
            this.logger.log(`📦 命中分析缓存: ${pureCode}`);
            return cached;
        }
        const stocks = await this.dataFetcher.searchStock(query);
        if (!stocks || stocks.length === 0) {
            throw new Error(`未找到股票: ${query}`);
        }
        const stock = stocks[0];
        const cachedByCode = this.getCachedAnalysis(stock.code);
        if (cachedByCode) {
            this.logger.log(`📦 命中分析缓存: ${stock.code} (from keyword: ${query})`);
            return cachedByCode;
        }
        const realTime = await this.dataFetcher.fetchRealTimeQuote(stock.code);
        if (realTime) {
            stock.name = realTime.name;
            this.logger.log(`腾讯行情: ${stock.name} 当前价=${realTime.price}`);
        }
        const klines = await this.dataFetcher.getKLineData(stock.code, stock.market);
        this.logger.log(`获取到 ${klines.length} 条K线数据`);
        const isNewStock = klines.length < 60;
        let newStockWarning = null;
        if (isNewStock) {
            newStockWarning = {
                name: `⚠️ 新股预警`,
                type: 'warning',
                description: `上市不足60个交易日（仅${klines.length}天），技术分析参考价值有限`
            };
        }
        const engine = new formula_engine_1.FormulaEngine({
            open: klines.map(k => k.open),
            close: klines.map(k => k.close),
            high: klines.map(k => k.high),
            low: klines.map(k => k.low),
            volume: klines.map(k => k.volume),
            amount: klines.map(k => k.amount),
        });
        const baiSanJiaoResult = (0, bai_san_jiao_1.calcBaiSanJiao)(engine);
        const baiLingXingResult = (0, bai_ling_xing_1.calcBaiLingXing)(engine);
        const baiXingResult = (0, bai_xing_1.calcBaiXing)(engine);
        const xingXingResult = (0, xing_xing_1.calcXingXing)(engine);
        const hhv2 = engine.HHV(engine.HIGH, 2);
        const llv2 = engine.LLV(engine.LOW, 2);
        const lastHhv2 = hhv2[hhv2.length - 1];
        const lastLlv2 = llv2[llv2.length - 1];
        const concentrationDisplay = lastHhv2 + lastLlv2 > 0
            ? parseFloat(((lastHhv2 - lastLlv2) / (lastHhv2 + lastLlv2) * 200).toFixed(2))
            : 0;
        const formulaResult = {
            ...baiSanJiaoResult,
            ...baiLingXingResult,
            ...baiXingResult,
            ...xingXingResult,
            concentrationDisplay,
        };
        const signals = (0, rule_engine_1.generateSignals)({ formula: formulaResult });
        if (newStockWarning) {
            signals.push(newStockWarning);
        }
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
        const backtestStats = this.computeBacktestStats(closePrices);
        const isMockData = !!klines._isMock;
        const usesRealKline = klines.length > 100 && klines.length >= 480 && !isMockData;
        const changePercent = realTime?.changePercent ?? 0;
        const high = realTime?.high;
        const low = realTime?.low;
        const closeArr = closePrices;
        const volumeArr = klines.map(k => k.volume);
        const highArr = klines.map(k => k.high);
        const lowArr = klines.map(k => k.low);
        const lastPrice = currentPrice ?? closePrices[closePrices.length - 1];
        const high60 = Math.max(...highArr.slice(-60));
        const low60 = Math.min(...lowArr.slice(-60));
        const pricePos = high60 > low60 ? ((lastPrice - low60) / (high60 - low60)) * 100 : 50;
        const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma5_1dAgo = closeArr.length > 6 ? closeArr.slice(-6, -1).reduce((a, b) => a + b, 0) / 5 : ma5;
        const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ma10_1dAgo = closeArr.length > 11 ? closeArr.slice(-11, -1).reduce((a, b) => a + b, 0) / 10 : ma10;
        const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const ma5Up = ma5 > ma5_1dAgo;
        const ma10Up = ma10 > ma10_1dAgo;
        let trendState = 1;
        if (ma5 > ma10 && ma10 > ma20 && ma5Up && ma10Up)
            trendState = 3;
        else if (ma5 > ma10 && ma5Up)
            trendState = 2;
        else if (ma5 < ma10 && ma10 < ma20)
            trendState = 0;
        let macdDiff = 0, macdDea = 0, isGoldenCross = false;
        try {
            const ema12 = closeArr.reduce((s, v, i) => i === 0 ? v : s + (v - s) * 2 / 13, 0);
            const ema26 = closeArr.reduce((s, v, i) => i === 0 ? v : s + (v - s) * 2 / 27, 0);
            macdDiff = ema12 - ema26;
            const deaArr = closeArr.reduce((arr, v, i) => {
                const prev = arr.length ? arr[arr.length - 1] : 0;
                arr.push(i === 0 ? (closeArr[0]) : prev + (((ema12 - ema26) - prev) * 2 / 9));
                return arr;
            }, []);
            macdDea = deaArr[deaArr.length - 1] || 0;
            isGoldenCross = macdDiff > macdDea;
        }
        catch { }
        const stockInput = {
            pricePosition: pricePos,
            trendState,
            trendStrength: formulaResult?.trendStrength ?? 0,
            diff: macdDiff,
            dea: macdDea,
            shortBuy: formulaResult?.shortBuy ?? false,
            strictBuy: formulaResult?.strictBuy ?? false,
            jiaCang: formulaResult?.jiaCang ?? false,
            shortSell: formulaResult?.shortSell ?? false,
            strongSell: formulaResult?.strongSell ?? false,
            safe: formulaResult?.safe ?? false,
            macdGoldenCross: isGoldenCross,
            macdDeathCross: false,
            baiXiaoDays: formulaResult?.baiXiaoDays ?? 0,
            baiBu: !!formulaResult?.baiBu,
            baiBuDays: formulaResult?.baiBuDays ?? 0,
            baiCoverTrend: formulaResult?.baiCoverTrend ?? 'stable',
            baiXiao: !!formulaResult?.baiXiao,
            volumeStructure: formulaResult?.volumeStructure ?? 0,
            ma5Up, ma10Up,
        };
        const stockSuggestion = (0, trading_suggestion_1.getTradingSuggestion)(stockInput);
        const suggestion = stockSuggestion.suggestion;
        const prediction = stockSuggestion.prediction || '';
        const reason = stockSuggestion.reason || '';
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
};
exports.StockService = StockService;
exports.StockService = StockService = StockService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [data_fetcher_service_1.DataFetcherService])
], StockService);
