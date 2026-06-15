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
var GemScreenerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GemScreenerService = void 0;
const common_1 = require("@nestjs/common");
const bai_xing_1 = require("../stock/bai-xing");
const formula_engine_1 = require("../stock/formula-engine");
const bai_san_jiao_1 = require("../stock/bai-san-jiao");
const bai_ling_xing_1 = require("../stock/bai-ling-xing");
const xing_xing_1 = require("../stock/xing-xing");
const fs_1 = require("fs");
const node_path_1 = require("node:path");
const iconv = require("iconv-lite");
const data_fetcher_service_1 = require("../stock/data-fetcher.service");
const stock_service_1 = require("../stock/stock.service");
const market_time_1 = require("../../utils/market-time");
const trading_suggestion_1 = require("../../utils/trading-suggestion");
const MARKET_OPEN_TTL = 5 * 60 * 1000;
const FROZEN_TTL = 365 * 24 * 60 * 60 * 1000;
function getOpportunityTTL() {
    return (0, market_time_1.isMarketOpen)() ? MARKET_OPEN_TTL : FROZEN_TTL;
}
let GemScreenerService = GemScreenerService_1 = class GemScreenerService {
    constructor(dataFetcher, stockService) {
        this.dataFetcher = dataFetcher;
        this.stockService = stockService;
        this.logger = new common_1.Logger(GemScreenerService_1.name);
        this.CACHE_TTL = 3 * 60 * 1000;
        this.STALE_TTL = 30 * 60 * 1000;
        this.REFRESH_INTERVAL = 5 * 60 * 1000;
        this.CACHE_FILE = '/tmp/gem-opportunities-cache.json';
        this.BUNDLED_GEM_CACHE = (0, node_path_1.join)(__dirname, '..', '..', '..', 'assets', 'gem-cache.json');
        this.BATCH_SIZE = 20;
        this.POSITION_THRESHOLD = 75;
        this.RELAXED_POSITION = 82;
        this.TENANT_BATCH = 500;
        this.MIN_GAIN_PCT = 0.3;
        this.MAX_MARKET_CAP = 500_0000_0000;
        this.MIN_MARKET_CAP = 20_0000_0000;
        this.cache = null;
        this.refreshPromise = null;
        this.mainBoardCache = null;
        this.mainBoardRefreshPromise = null;
        this.sectorCache = null;
        this.MAIN_BOARD_CACHE = '/tmp/main-board-opportunities-cache.json';
        this.BUNDLED_MAIN_BOARD_CACHE = (0, node_path_1.join)(__dirname, '..', '..', '..', 'assets', 'main-board-cache.json');
        this.prevGEMResults = [];
        this.prevMainBoardResults = [];
        this.lastScanAt = 0;
        this.SCAN_INTERVAL = 5 * 60 * 1000;
        this.marketHoursBeganAt = 0;
        this.updateMarketHoursBeganAt();
        this.loadCacheFromDisk();
        this.loadMainBoardCacheFromDisk();
    }
    isFrozenSchedule() {
        const now = new Date();
        const dow = now.getDay();
        if (dow === 0 || dow === 6)
            return true;
        const t = now.getHours() * 60 + now.getMinutes();
        return t >= 900 || t < 555;
    }
    updateMarketHoursBeganAt() {
        const now = new Date();
        const today915 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 15, 0, 0);
        if (now.getTime() >= today915.getTime() && now.getHours() * 60 + now.getMinutes() < 900) {
            this.marketHoursBeganAt = today915.getTime();
        }
        else {
            this.marketHoursBeganAt = 0;
        }
    }
    async loadCacheFromDisk() {
        try {
            const raw = await fs_1.promises.readFile(this.CACHE_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.data && Array.isArray(parsed.data)) {
                const limitedData = parsed.data.slice(0, 10);
                this.cache = { ...parsed, data: limitedData };
                this.logger.log(`📦 创业板加载缓存成功, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleTimeString()}`);
                return;
            }
        }
        catch {
            this.logger.log('📦 无创业板本地缓存');
        }
        try {
            if ((0, fs_1.existsSync)(this.BUNDLED_GEM_CACHE)) {
                const raw = (0, fs_1.readFileSync)(this.BUNDLED_GEM_CACHE, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && parsed.data && Array.isArray(parsed.data)) {
                    const limitedData = parsed.data.slice(0, 10);
                    this.cache = { ...parsed, data: limitedData };
                    this.logger.log(`📦 从部署包恢复创业板缓存, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleString('zh-CN')}`);
                }
            }
        }
        catch (err) {
            this.logger.warn(`⚠️ 创业板部署包缓存加载失败: ${err.message}`);
        }
    }
    async loadMainBoardCacheFromDisk() {
        try {
            const raw = await fs_1.promises.readFile(this.MAIN_BOARD_CACHE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.data && Array.isArray(parsed.data)) {
                const limitedData = parsed.data.slice(0, 10);
                this.mainBoardCache = { ...parsed, data: limitedData };
                this.logger.log(`📦 主板加载缓存成功, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleTimeString()}`);
                return;
            }
        }
        catch {
            this.logger.log('📦 无主板本地缓存');
        }
        try {
            if ((0, fs_1.existsSync)(this.BUNDLED_MAIN_BOARD_CACHE)) {
                const raw = (0, fs_1.readFileSync)(this.BUNDLED_MAIN_BOARD_CACHE, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && parsed.data && Array.isArray(parsed.data)) {
                    const limitedData = parsed.data.slice(0, 10);
                    this.mainBoardCache = { ...parsed, data: limitedData };
                    this.logger.log(`📦 从部署包恢复主板缓存, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleString('zh-CN')}`);
                }
            }
        }
        catch (err) {
            this.logger.warn(`⚠️ 主板部署包缓存加载失败: ${err.message}`);
        }
    }
    async saveCacheToDisk() {
        try {
            await fs_1.promises.writeFile(this.CACHE_FILE, JSON.stringify(this.cache), 'utf-8');
        }
        catch (err) {
            this.logger.warn(`⚠️ 缓存写入失败: ${err.message}`);
        }
    }
    async getOpportunities() {
        const marketOpen = (0, market_time_1.isMarketOpen)();
        if (!marketOpen && this.cache) {
            this.triggerAnalysisPreCache(this.cache.data);
            return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
        }
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
        this.logger.log('📦 首次加载或缓存已清空, 尝试获取数据...');
        if (!marketOpen) {
            try {
                const opportunities = await this.scanAllStocks();
                this.cache = { data: opportunities, timestamp: Date.now() };
                this.saveCacheToDisk();
                return { opportunities, timestamp: this.cache.timestamp };
            }
            catch (err) {
                this.logger.error(`❌ 首次加载失败: ${err.message}`);
                return { opportunities: [], timestamp: Date.now() };
            }
        }
        this.triggerRefresh();
        return { opportunities: [], timestamp: Date.now() };
    }
    triggerRefresh() {
        if (!(0, market_time_1.isMarketOpen)()) {
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
    async refreshCache() {
        try {
            this.logger.log('🔄 创业板机会扫描中...');
            const prevResults = this.cache?.data || [];
            const opportunities = await this.scanAllStocks();
            let finalResults = opportunities;
            if ((0, market_time_1.isMarketOpen)() && prevResults.length > 0 && opportunities.length > 0) {
                const prevCodes = new Set(prevResults.map(s => s.code));
                const merged = opportunities.filter(s => prevCodes.has(s.code));
                if (merged.length > 0) {
                    finalResults = merged;
                    this.logger.log(`  🔄 交叠保留: ${merged.length}/${opportunities.length} 只`);
                }
                else {
                    this.logger.log(`  🔄 无交叠, 使用最新 ${opportunities.length} 只`);
                }
            }
            if (finalResults.length > 0 || !this.cache) {
                this.cache = { data: finalResults, timestamp: Date.now() };
                this.saveCacheToDisk();
                this.logger.log(`✅ 创业板机会扫描完成, 最终 ${finalResults.length} 只`);
            }
            else {
                this.logger.log(`📊 扫描完成, 未找到符合条件的股票`);
                this.cache = { data: finalResults, timestamp: Date.now() };
                this.saveCacheToDisk();
            }
        }
        catch (err) {
            this.logger.error(`❌ 扫描失败: ${err.message}, 30秒后重试`);
            if (!this.cache) {
                setTimeout(() => this.triggerRefresh(), 30000);
            }
        }
    }
    async onApplicationBootstrap() {
        this.triggerRefresh();
        try {
            const raw = await fs_1.promises.readFile(this.MAIN_BOARD_CACHE, 'utf-8');
            const parsed = JSON.parse(raw);
            this.mainBoardCache = { data: parsed.data, timestamp: parsed.timestamp };
            this.logger.log(`📦 主板机会区: 从磁盘恢复缓存, ${this.mainBoardCache.data.length} 只`);
        }
        catch { }
        if (!this.mainBoardCache) {
            this.logger.log('📦 主板机会区: 无缓存, 启动后台扫描...');
            this.mainBoardRefreshPromise = this.scanMainBoardStocks().then(data => {
                this.mainBoardCache = { data, timestamp: Date.now() };
                this.saveMainBoardCacheToDisk();
                this.logger.log(`✅ 主板机会区: 扫描完成, ${data.length} 只`);
            }).catch(err => {
                this.logger.error(`❌ 主板机会区: 扫描失败: ${err}`);
            });
        }
        this.triggerAnalysisPreCacheFromCache();
        setInterval(() => {
            if ((0, market_time_1.isMarketOpen)()) {
                this.logger.log('⏰ 15分钟定时刷新触发');
                this.triggerRefresh();
            }
        }, 15 * 60 * 1000);
    }
    calcCustomMACD(kline) {
        const closes = kline.map(k => k.close);
        const len = closes.length;
        if (len < 35) {
            return { diff: [], dea: [], currentDiff: 0, currentDea: 0, isGoldenCross: false, goldenCrossDays: 0, isDeathCross: false };
        }
        const avgLine = [];
        for (let i = 33; i < len; i++) {
            const ma3 = closes.slice(i - 2, i + 1).reduce((a, b) => a + b, 0) / 3;
            const ma5 = closes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5;
            const ma8 = closes.slice(i - 7, i + 1).reduce((a, b) => a + b, 0) / 8;
            const ma13 = closes.slice(i - 12, i + 1).reduce((a, b) => a + b, 0) / 13;
            const ma21 = closes.slice(i - 20, i + 1).reduce((a, b) => a + b, 0) / 21;
            const ma34 = closes.slice(i - 33, i + 1).reduce((a, b) => a + b, 0) / 34;
            avgLine.push((ma3 + ma5 + ma8 + ma13 + ma21 + ma34 * 0.5) / 5.5);
        }
        const dea = [...avgLine];
        const xma = [];
        const initSum = avgLine.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
        xma.push(initSum);
        for (let i = 1; i < avgLine.length; i++) {
            xma.push(avgLine[i] * (2 / 6) + xma[i - 1] * (4 / 6));
        }
        const diff = [];
        for (let i = 0; i < avgLine.length; i++) {
            const klineIdx = i + 33;
            const correction = this.calcCorrection(kline, klineIdx);
            diff.push(xma[i] * 2 - avgLine[i] - correction);
        }
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
            }
            else {
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
            }
            else {
                break;
            }
        }
        return { diff, dea, currentDiff, currentDea, isGoldenCross, goldenCrossDays, isDeathCross };
    }
    calcCorrection(kline, index) {
        if (index === 0)
            return 0;
        const k = kline[index];
        const prev = kline[index - 1];
        if (!k || !prev)
            return 0;
        const openGapPct = ((k.open - prev.close) / prev.close) * 100;
        const dailyChangePct = ((k.close - k.open) / k.open) * 100;
        if (openGapPct <= 0 || k.close >= k.open)
            return 0;
        let correctionStrength = 0;
        correctionStrength += openGapPct * 0.05 + Math.abs(dailyChangePct) * 0.1;
        if (index >= 4) {
            const avgVol = kline.slice(index - 4, index + 1).reduce((a, b) => a + b.volume, 0) / 5;
            const volRatio = k.volume / avgVol;
            if (volRatio > 1.2) {
                correctionStrength += (volRatio - 1.2) * 0.25;
            }
        }
        const amplitude = ((k.high - k.low) / k.low) * 100;
        if (amplitude > 5) {
            correctionStrength += (amplitude - 5) * 0.02;
        }
        if (index >= 4) {
            const avgVol = kline.slice(index - 4, index + 1).reduce((a, b) => a + b.volume, 0) / 5;
            const dailyDropFromPrev = ((k.close - prev.close) / prev.close) * 100;
            if (dailyDropFromPrev <= -7 && k.volume < avgVol * 1.2) {
                correctionStrength = 0;
            }
        }
        correctionStrength = Math.min(correctionStrength, 0.5);
        return correctionStrength * (k.high - k.low);
    }
    async scanAllStocks() {
        const combined = await this.fetchGEMCandidates();
        if (combined.length === 0) {
            this.logger.warn('⚠️ 候选池为空, 无创业板股票数据 (腾讯行情无数据)');
            return [];
        }
        this.logger.log(`📊 候选池: ${combined.length} 只 (腾讯行情)`);
        combined.sort((a, b) => b.inflow - a.inflow);
        const results = [];
        for (let i = 0; i < combined.length; i += this.BATCH_SIZE) {
            const batch = combined.slice(i, i + this.BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(s => this.checkOpportunity(s).catch(() => null)));
            for (const r of batchResults) {
                if (r)
                    results.push(r);
            }
            if (results.length > 0 && i % 100 === 0) {
                this.logger.log(`  ✓ 已检查 ${Math.min(i + this.BATCH_SIZE, combined.length)}/${combined.length}`);
            }
        }
        if (results.length <= 3) {
            this.logger.log(`  📊 结果较少(${results.length}), 放宽位置阈值至 ${this.RELAXED_POSITION} 再扫...`);
            for (let i = 0; i < combined.length; i += this.BATCH_SIZE) {
                const batch = combined.slice(i, i + this.BATCH_SIZE);
                const batchResults = await Promise.all(batch.map(s => this.checkOpportunityRelaxed(s).catch(() => null)));
                for (const r of batchResults) {
                    if (r && !results.find(ex => ex.code === r.code)) {
                        results.push(r);
                    }
                }
            }
        }
        results.sort((a, b) => b.score - a.score);
        const finalResults = results.slice(0, 10);
        this.stockService.preCacheAnalysisBatch(finalResults.map(s => s.code)).catch(() => { });
        return finalResults;
    }
    async checkOpportunity(s) {
        const kline = await this.dataFetcher.getKLineData(s.code);
        if (!kline || kline.length < 60)
            return null;
        const closeArr = kline.map(k => k.close);
        const len = closeArr.length;
        if (len < 35)
            return null;
        const klineO = kline.map(k => k.open);
        const klineH = kline.map(k => k.high);
        const klineL = kline.map(k => k.low);
        const klineV = kline.map(k => k.volume || 0);
        const klineAmt = kline.map(k => k.amount || 0);
        const engine = new formula_engine_1.FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: klineV, amount: klineAmt });
        const bx = (0, bai_xing_1.calcBaiXing)(engine);
        const isBaiXiaoActive = bx.baiXiao || bx.baiBu || false;
        const bxDays = bx.baiXiaoDays || 0;
        const isBaiXiaoBuy = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai);
        const hasQiangShiHuiCai = !!bx.qiangShiHuiCai;
        const macdResult = this.calcCustomMACD(kline);
        const isGoldenCross = macdResult.isGoldenCross;
        const isApproaching = !isGoldenCross && macdResult.currentDiff > macdResult.currentDea * 0.95;
        if (!isGoldenCross && !isApproaching)
            return null;
        const excludeKeywords = ['银行', '保险', '农商', '兴业银', '中国人寿', '中国平安', '中国人保', '中国太保', '新华保险'];
        for (const kw of excludeKeywords) {
            if (s.name.includes(kw))
                return null;
        }
        const goldenCrossDays = macdResult.goldenCrossDays || 15;
        const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ma20 = len >= 20 ? closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;
        if (ma5 <= ma10 * 1.001)
            return null;
        if (len >= 8) {
            const ma5_3d = closeArr.slice(-8, -3).reduce((a, b) => a + b, 0) / 5;
            if (ma5 <= ma5_3d)
                return null;
        }
        if (len >= 15) {
            const ma10_5d = closeArr.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;
            if (ma10 <= ma10_5d)
                return null;
        }
        if (closeArr[len - 1] <= ma10)
            return null;
        if (len >= 30) {
            const ma20_10d = closeArr.slice(-30, -10).reduce((a, b) => a + b, 0) / 20;
            if (ma20 < ma20_10d)
                return null;
        }
        if (closeArr[len - 1] <= ma5)
            return null;
        let isPullbackRecovery = false;
        if (len >= 6) {
            const ma5_yest = closeArr.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
            if (closeArr[len - 2] < ma5_yest * 0.99) {
                const ma20_arr = [];
                for (let i = Math.max(0, len - 20); i < len; i++)
                    ma20_arr.push(closeArr[i]);
                const ma20_recent = ma20_arr.length >= 20
                    ? ma20_arr.slice(-20).reduce((a, b) => a + b, 0) / 20
                    : ma20_arr.reduce((a, b) => a + b, 0) / ma20_arr.length;
                isPullbackRecovery =
                    closeArr[len - 1] >= ma5 &&
                        closeArr[len - 1] > closeArr[len - 2] &&
                        Math.min(...closeArr.slice(-5)) > ma20_recent * 0.97;
                if (!isPullbackRecovery)
                    return null;
            }
        }
        const highs = kline.map(k => k.high);
        const lows = kline.map(k => k.low);
        const periodHigh = Math.max(...highs.slice(-60));
        const periodLow = Math.min(...lows.slice(-60));
        const pricePosition = periodHigh > periodLow
            ? ((closeArr[len - 1] - periodLow) / (periodHigh - periodLow)) * 100
            : 50;
        if (pricePosition >= this.POSITION_THRESHOLD && !isPullbackRecovery && !hasQiangShiHuiCai)
            return null;
        let priceIncrease = 0;
        const lookbackDays = Math.max(1, goldenCrossDays || 15);
        const closeIdx = len - 1;
        const triggerIdx = closeIdx - lookbackDays;
        const triggerClose = triggerIdx >= 0 ? kline[triggerIdx].close : kline[0].close;
        const currentClose = kline[closeIdx].close;
        priceIncrease = ((currentClose - triggerClose) / triggerClose) * 100;
        if (isGoldenCross && priceIncrease > 25)
            return null;
        const inflowScore = Math.min(s.inflow / 100000000, 1);
        const incScore = priceIncrease > 0 ? Math.min(priceIncrease / 15, 1) : 0;
        const positionScore = 1 - pricePosition / 100;
        const gcScore = isGoldenCross ? 0.4 : 0.15;
        const capScore = s.marketCap ? Math.max(0, 1 - Math.max(0, s.marketCap - 5_000_000_000) / 45_000_000_000) : 0.3;
        const score = inflowScore * 0.35 + incScore * 0.25 + positionScore * 0.20 + gcScore * 0.10 + capScore * 0.10;
        let buySignal = '';
        if (isBaiXiaoBuy && (isPullbackRecovery || hasQiangShiHuiCai)) {
            buySignal = '白消启动回踩';
        }
        else if (isBaiXiaoBuy) {
            buySignal = '白消启动突破';
        }
        else if (hasQiangShiHuiCai) {
            buySignal = '强势回踩';
        }
        else if (isBaiXiaoActive && bxDays >= 3) {
            buySignal = '白消蓄力';
        }
        else if (isPullbackRecovery) {
            buySignal = '回踩确认';
        }
        else {
            buySignal = '突破上涨';
        }
        const macdBullishR = macdResult.currentDiff > macdResult.currentDea;
        let trendStateR = 1;
        if (ma5 > ma10 * 1.02 && ma10 > ma20 * 1.01) {
            trendStateR = 3;
        }
        else if (ma5 > ma10 && ma10 > ma20) {
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
            if (trendStateR === 0)
                suggestionR = hasBuySignalR ? '持有' : '清仓';
            else if (trendStateR === 1)
                suggestionR = hasBuySignalR && macdBullishR ? '持有' : (!macdBullishR ? '卖出' : '减仓');
            else
                suggestionR = hasBuySignalR ? '轻仓买入' : '持有';
        }
        else if (zoneR.includes('中高位')) {
            if (trendStateR === 0)
                suggestionR = hasBuySignalR ? '持有' : '减仓';
            else if (trendStateR >= 2)
                suggestionR = hasBuySignalR ? '轻仓买入' : '持有';
            else
                suggestionR = hasBuySignalR ? '持有' : '持有';
        }
        else if (zoneR.includes('中位') && !zoneR.includes('低') && !zoneR.includes('高')) {
            if (trendStateR >= 2)
                suggestionR = hasBuySignalR ? '买入' : '轻仓买入';
            else if (trendStateR === 0)
                suggestionR = hasBuySignalR ? '持有' : '减仓';
            else
                suggestionR = hasBuySignalR ? '持有' : '持有';
        }
        else if (zoneR.includes('中低位')) {
            if (trendStateR >= 2 && hasBuySignalR)
                suggestionR = '轻仓买入';
            else if (trendStateR === 0)
                suggestionR = '持有';
            else
                suggestionR = '持有';
        }
        else {
            if (longDeclineR && trendStateR === 1 && !macdBullishR && !volumeBullishR) {
                suggestionR = '不要介入';
            }
            else if (trendStateR === 1 && macdBullishR && volumeBullishR) {
                suggestionR = '买入';
            }
            else if (trendStateR === 0) {
                suggestionR = hasBuySignalR ? '轻仓买入' : '观望';
            }
            else if (trendStateR >= 2) {
                suggestionR = (trendStateR >= 3 && hasBuySignalR) ? '重仓买入' : '买入';
            }
            else {
                suggestionR = hasBuySignalR ? '持有' : '观望';
            }
        }
        const NEGATIVE_SUGGESTIONS = ['减仓', '卖出', '清仓', '不要介入'];
        if (NEGATIVE_SUGGESTIONS.includes(suggestionR))
            return null;
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
    async checkOpportunityRelaxed(s) {
        const kline = await this.dataFetcher.getKLineData(s.code);
        if (!kline || kline.length < 60)
            return null;
        const closeArr = kline.map(k => k.close);
        const len = closeArr.length;
        if (len < 35)
            return null;
        const klineO = kline.map(k => k.open);
        const klineH = kline.map(k => k.high);
        const klineL = kline.map(k => k.low);
        const klineV = kline.map(k => k.volume || 0);
        const klineAmt = kline.map(k => k.amount || 0);
        const engine = new formula_engine_1.FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: klineV, amount: klineAmt });
        const bx = (0, bai_xing_1.calcBaiXing)(engine);
        const isBaiXiaoActive = bx.baiXiao || bx.baiBu || false;
        const bxDays = bx.baiXiaoDays || 0;
        const isBaiXiaoBuy = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai);
        const hasQiangShiHuiCai = !!bx.qiangShiHuiCai;
        const macdResult = this.calcCustomMACD(kline);
        const isGoldenCross = macdResult.isGoldenCross;
        const isApproaching = !isGoldenCross && macdResult.currentDiff > macdResult.currentDea * 0.95;
        if (!isGoldenCross && !isApproaching)
            return null;
        const excludeKeywords = ['银行', '保险', '农商', '兴业银', '中国人寿', '中国平安', '中国人保', '中国太保', '新华保险'];
        for (const kw of excludeKeywords) {
            if (s.name.includes(kw))
                return null;
        }
        const goldenCrossDays = isGoldenCross ? macdResult.goldenCrossDays : 1;
        const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ma20 = len >= 20 ? closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;
        if (ma5 <= ma10 * 1.001)
            return null;
        if (len >= 8) {
            const ma5_3d = closeArr.slice(-8, -3).reduce((a, b) => a + b, 0) / 5;
            if (ma5 <= ma5_3d)
                return null;
        }
        if (len >= 15) {
            const ma10_5d = closeArr.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;
            if (ma10 <= ma10_5d)
                return null;
        }
        if (closeArr[len - 1] <= ma10)
            return null;
        if (len >= 30) {
            const ma20_10d = closeArr.slice(-30, -10).reduce((a, b) => a + b, 0) / 20;
            if (ma20 < ma20_10d)
                return null;
        }
        const highs = kline.map(k => k.high);
        const lows = kline.map(k => k.low);
        const periodHigh = Math.max(...highs.slice(-60));
        const periodLow = Math.min(...lows.slice(-60));
        const pricePosition = periodHigh > periodLow
            ? ((closeArr[len - 1] - periodLow) / (periodHigh - periodLow)) * 100
            : 50;
        if (pricePosition >= this.RELAXED_POSITION)
            return null;
        let priceIncrease = 0;
        const lookbackDays = Math.max(1, isGoldenCross && goldenCrossDays > 1 ? goldenCrossDays : 15);
        const closeIdx = len - 1;
        const triggerIdx = closeIdx - lookbackDays;
        const triggerClose = triggerIdx >= 0 ? kline[triggerIdx].close : kline[0].close;
        const currentClose = kline[closeIdx].close;
        priceIncrease = ((currentClose - triggerClose) / triggerClose) * 100;
        if (isGoldenCross && priceIncrease > 25)
            return null;
        const inflowScore = Math.min(s.inflow / 100000000, 1);
        const incScore = priceIncrease > 0 ? Math.min(priceIncrease / 15, 1) : 0;
        const positionScore = 1 - pricePosition / 100;
        const gcScore = isGoldenCross ? 0.4 : 0.15;
        const capScore = s.marketCap ? Math.max(0, 1 - Math.max(0, s.marketCap - 5_000_000_000) / 45_000_000_000) : 0.3;
        const score = inflowScore * 0.35 + incScore * 0.25 + positionScore * 0.20 + gcScore * 0.10 + capScore * 0.10;
        let buySignal = '';
        if (isBaiXiaoBuy && hasQiangShiHuiCai) {
            buySignal = '白消启动回踩';
        }
        else if (isBaiXiaoBuy) {
            buySignal = '白消启动';
        }
        else if (hasQiangShiHuiCai) {
            buySignal = '强势回踩';
        }
        else if (isBaiXiaoActive && bxDays >= 3) {
            buySignal = '白消蓄力';
        }
        else {
            buySignal = '突破上涨';
        }
        const macdBullishR = macdResult.currentDiff > macdResult.currentDea;
        let trendStateR = 1;
        if (ma5 > ma10 * 1.02 && ma10 > ma20 * 1.01) {
            trendStateR = 3;
        }
        else if (ma5 > ma10 && ma10 > ma20) {
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
            if (trendStateR === 0)
                suggestionR = hasBuySignalR ? '持有' : '清仓';
            else if (trendStateR === 1)
                suggestionR = hasBuySignalR && macdBullishR ? '持有' : (!macdBullishR ? '卖出' : '减仓');
            else
                suggestionR = hasBuySignalR ? '轻仓买入' : '持有';
        }
        else if (zoneR.includes('中高位')) {
            if (trendStateR === 0)
                suggestionR = hasBuySignalR ? '持有' : '减仓';
            else if (trendStateR >= 2)
                suggestionR = hasBuySignalR ? '轻仓买入' : '持有';
            else
                suggestionR = hasBuySignalR ? '持有' : '持有';
        }
        else if (zoneR.includes('中位') && !zoneR.includes('低') && !zoneR.includes('高')) {
            if (trendStateR >= 2)
                suggestionR = hasBuySignalR ? '买入' : '轻仓买入';
            else if (trendStateR === 0)
                suggestionR = hasBuySignalR ? '持有' : '减仓';
            else
                suggestionR = hasBuySignalR ? '持有' : '持有';
        }
        else if (zoneR.includes('中低位')) {
            if (trendStateR >= 2 && hasBuySignalR)
                suggestionR = '轻仓买入';
            else if (trendStateR === 0)
                suggestionR = '持有';
            else
                suggestionR = '持有';
        }
        else {
            if (longDeclineR && trendStateR === 1 && !macdBullishR && !volumeBullishR) {
                suggestionR = '不要介入';
            }
            else if (trendStateR === 1 && macdBullishR && volumeBullishR) {
                suggestionR = '买入';
            }
            else if (trendStateR === 0) {
                suggestionR = hasBuySignalR ? '轻仓买入' : '观望';
            }
            else if (trendStateR >= 2) {
                suggestionR = (trendStateR >= 3 && hasBuySignalR) ? '重仓买入' : '买入';
            }
            else {
                suggestionR = hasBuySignalR ? '持有' : '观望';
            }
        }
        const NEGATIVE_SUGGESTIONS = ['减仓', '卖出', '清仓', '不要介入'];
        if (NEGATIVE_SUGGESTIONS.includes(suggestionR))
            return null;
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
    async fetchGEMCandidates() {
        const candidates = [];
        const allCodes = [];
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
                    const match = line.match(/v_sz\d+="(.+?)";?\s*$/);
                    if (!match)
                        continue;
                    const fields = match[1].split('~');
                    const code = fields[2] || '';
                    if (!code.startsWith('300') && !code.startsWith('301'))
                        continue;
                    const curPrice = parseFloat(fields[3]);
                    const yestClose = parseFloat(fields[4]);
                    const changePct = yestClose > 0 ? ((curPrice - yestClose) / yestClose) * 100 : 0;
                    if (changePct < this.MIN_GAIN_PCT)
                        continue;
                    const volumeShares = parseFloat(fields[6]) || 0;
                    const amount = volumeShares * curPrice;
                    candidates.push({
                        code,
                        name: fields[1] || '',
                        inflow: Math.round(amount),
                        changePercent: Math.round(changePct * 100) / 100,
                        currentPrice: curPrice,
                    });
                }
            }
            catch (err) {
                this.logger.warn(`⚠️ 腾讯行情批 ${b / this.TENANT_BATCH + 1} 失败: ${err.message}`);
            }
        }
        candidates.sort((a, b) => b.changePercent - a.changePercent);
        this.logger.log(`📡 腾讯行情: 获取 ${candidates.length} 只上涨GEM, 全量扫描`);
        return candidates;
    }
    async fetchMainBoardCandidates() {
        const candidates = [];
        const shCodes = [];
        for (let i = 0; i <= 5999; i++) {
            shCodes.push(`sh60${String(i).padStart(4, '0')}`);
        }
        const szCodes = [];
        for (const prefix of ['000', '001', '002']) {
            for (let i = 0; i <= 999; i++) {
                szCodes.push(`sz${prefix}${String(i).padStart(3, '0')}`);
            }
        }
        const allCodes = [...shCodes, ...szCodes];
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
                    if (!match)
                        continue;
                    const fields = match[1].split('~');
                    const code = fields[2] || '';
                    if (code.startsWith('300') || code.startsWith('301'))
                        continue;
                    if (code.startsWith('688') || code.startsWith('689'))
                        continue;
                    const curPrice = parseFloat(fields[3]);
                    const yestClose = parseFloat(fields[4]);
                    const changePct = yestClose > 0 ? ((curPrice - yestClose) / yestClose) * 100 : 0;
                    if (changePct < this.MIN_GAIN_PCT)
                        continue;
                    const name = fields[1] || '';
                    if (name.includes('ST') || name.includes('*ST') || name.includes('退'))
                        continue;
                    const marketCap = parseFloat(fields[37]) || 0;
                    if (marketCap > 0 && marketCap > this.MAX_MARKET_CAP)
                        continue;
                    if (marketCap > 0 && marketCap < this.MIN_MARKET_CAP)
                        continue;
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
            }
            catch (err) {
                this.logger.warn(`⚠️ 主板行情批 ${b / this.TENANT_BATCH + 1} 失败: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        candidates.sort((a, b) => b.changePercent - a.changePercent);
        this.logger.log(`📡 主板: 获取 ${candidates.length} 只上涨, 全量扫描`);
        return candidates;
    }
    async scanMainBoardStocks() {
        const candidates = await this.fetchMainBoardCandidates();
        this.logger.log(`🔍 主板分析: ${candidates.length} 只候选股 (使用创业板相同模板)`);
        if (candidates.length === 0) {
            this.logger.warn('⚠️ 主板候选池为空');
            return [];
        }
        candidates.sort((a, b) => b.inflow - a.inflow);
        const results = [];
        for (let i = 0; i < candidates.length; i += this.BATCH_SIZE) {
            const batch = candidates.slice(i, i + this.BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(s => this.checkOpportunity(s).catch(() => null)));
            for (const r of batchResults) {
                if (r)
                    results.push(r);
            }
            if (results.length > 0 && i % 100 === 0) {
                this.logger.log(`  ✓ 已检查 ${Math.min(i + this.BATCH_SIZE, candidates.length)}/${candidates.length}`);
            }
        }
        if (results.length <= 3) {
            this.logger.log(`  📊 主板结果较少(${results.length}), 放宽位置阈值至 ${this.RELAXED_POSITION} 再扫...`);
            for (let i = 0; i < candidates.length; i += this.BATCH_SIZE) {
                const batch = candidates.slice(i, i + this.BATCH_SIZE);
                const batchResults = await Promise.all(batch.map(s => this.checkOpportunityRelaxed(s).catch(() => null)));
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
        this.stockService.preCacheAnalysisBatch(finalResults.map(s => s.code)).catch(() => { });
        return finalResults;
    }
    async getMainBoardOpportunities() {
        const marketOpen = (0, market_time_1.isMarketOpen)();
        if (!marketOpen && this.mainBoardCache) {
            return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
        }
        if (!marketOpen && !this.mainBoardCache) {
            this.logger.log('📦 主板机会区: 首次部署/无缓存, 加载一次');
            const data = await this.scanMainBoardStocks();
            this.mainBoardCache = { data, timestamp: Date.now() };
            this.saveMainBoardCacheToDisk();
            return { opportunities: data, timestamp: Date.now() };
        }
        const useTTL = marketOpen ? this.REFRESH_INTERVAL : this.CACHE_TTL;
        if (this.mainBoardCache && Date.now() - this.mainBoardCache.timestamp < useTTL) {
            return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
        }
        if (this.mainBoardCache && !this.mainBoardRefreshPromise) {
            const prevData = this.mainBoardCache.data;
            this.mainBoardRefreshPromise = this.scanMainBoardStocks().then(data => {
                let finalResults = data;
                if (marketOpen && prevData.length > 0 && data.length > 0) {
                    const prevCodes = new Set(prevData.map(s => s.code));
                    const merged = data.filter(s => prevCodes.has(s.code));
                    if (merged.length > 0) {
                        finalResults = merged;
                        this.logger.log(`  🔄 主板交叠保留: ${merged.length}/${data.length} 只`);
                    }
                    else {
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
        if (this.mainBoardRefreshPromise) {
            await this.mainBoardRefreshPromise;
            if (this.mainBoardCache)
                return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
        }
        const data = await this.scanMainBoardStocks();
        this.mainBoardCache = { data, timestamp: Date.now() };
        this.saveMainBoardCacheToDisk();
        return { opportunities: data, timestamp: Date.now() };
    }
    async saveMainBoardCacheToDisk() {
        try {
            await fs_1.promises.writeFile(this.MAIN_BOARD_CACHE, JSON.stringify(this.mainBoardCache), 'utf8');
        }
        catch { }
    }
    async getAllOpportunities() {
        const results = [];
        if (this.cache?.data?.length)
            results.push(...this.cache.data);
        if (this.mainBoardCache?.data?.length)
            results.push(...this.mainBoardCache.data);
        return results;
    }
    async computeFullSuggestion(code) {
        try {
            const raw = await this.dataFetcher.getKLineData(code);
            if (!raw?.length || raw.length < 60)
                return null;
            const name = raw[0]?.name ?? '';
            const klineV = raw.slice(-120);
            const closeArr = klineV.map((k) => Number(k.close));
            const volumeArr = klineV.map((k) => Number(k.volume));
            const highArr = klineV.map((k) => Number(k.high));
            const lowArr = klineV.map((k) => Number(k.low));
            const price = closeArr[closeArr.length - 1];
            const high60 = Math.max(...highArr.slice(-60));
            const low60 = Math.min(...lowArr.slice(-60));
            const pricePos = ((price - low60) / (high60 - low60)) * 100;
            const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
            const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const macdR = this.calcCustomMACD(klineV);
            const diff = Array.isArray(macdR?.diff) ? macdR.diff[macdR.diff.length - 1] : (macdR?.diff ?? 0);
            const dea = Array.isArray(macdR?.dea) ? macdR.dea[macdR.dea.length - 1] : (macdR?.dea ?? 0);
            const ma5Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 6];
            const ma10Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 11];
            let trendState = 1;
            if (ma5 > ma10 && ma10 > ma20 && ma5Up && ma10Up)
                trendState = 3;
            else if (ma5 > ma10 && ma5Up)
                trendState = 2;
            else if (ma5 < ma10 && ma10 < ma20)
                trendState = 0;
            const klineO = klineV.map((k) => Number(k.open));
            const klineH = klineV.map((k) => Number(k.high));
            const klineL = klineV.map((k) => Number(k.low));
            const klineA = klineV.map((k) => Number(k.amount ?? 0));
            const engine = new formula_engine_1.FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: volumeArr, amount: klineA });
            const baiXing = (0, bai_xing_1.calcBaiXing)(engine);
            const sanJiao = (0, bai_san_jiao_1.calcBaiSanJiao)(engine);
            const lingXing = (0, bai_ling_xing_1.calcBaiLingXing)(engine);
            const xingX = (0, xing_xing_1.calcXingXing)(engine);
            const isGoldenCross = macdR?.isGoldenCross ?? false;
            const cfsInput = {
                pricePosition: pricePos,
                trendState,
                trendStrength: baiXing?.trendStrength ?? sanJiao?.trendStrength ?? 0,
                diff, dea,
                shortBuy: lingXing?.shortBuy ?? false,
                strictBuy: sanJiao?.strictBuy ?? false,
                jiaCang: sanJiao?.jiaCang ?? false,
                shortSell: xingX?.shortSell ?? false,
                strongSell: xingX?.strongSell ?? false,
                safe: baiXing?.safe ?? false,
                macdGoldenCross: isGoldenCross,
                macdDeathCross: false,
                baiXiaoDays: baiXing?.baiXiaoDays ?? 0,
                volumeStructure: sanJiao?.volumeStructure ?? 0,
            };
            const cfsResult = (0, trading_suggestion_1.getTradingSuggestion)(cfsInput);
            const suggestion = cfsResult.action;
            const BASE = {
                '重仓买入': 100, '买入': 80, '轻仓买入': 65, '准备买入': 55, '持有': 40,
            };
            let score = BASE[suggestion] ?? 30;
            if (pricePos < 30)
                score += 15;
            else if (pricePos < 50)
                score += 8;
            if (closeArr[closeArr.length - 1] > closeArr[closeArr.length - 5])
                score += 5;
            else
                score -= 5;
            return { suggestion, score, name };
        }
        catch (e) {
            return null;
        }
    }
    async scanSectorOpportunities(force = false) {
        const ttl = getOpportunityTTL();
        if (!force && this.sectorCache && (Date.now() - this.sectorCache.timestamp < ttl)) {
            return { opportunities: this.sectorCache.data, timestamp: this.sectorCache.timestamp };
        }
        try {
            const http = require('http');
            const sectorData = await new Promise((resolve, reject) => {
                http.get('http://localhost:3000/api/sector/hot', (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => { try {
                        resolve(JSON.parse(body));
                    }
                    catch {
                        reject(new Error('parse fail'));
                    } });
                }).on('error', reject);
            });
            const sectors = sectorData?.data?.month1 ?? sectorData?.month1 ?? [];
            if (!sectors.length) {
                return { opportunities: [], timestamp: Date.now() };
            }
            const topSectors = sectors
                .filter((s) => s.changePercent !== undefined)
                .sort((a, b) => b.changePercent - a.changePercent)
                .slice(0, 10);
            const oppStocks = [];
            for (const sector of topSectors) {
                const stocks = sector.opportunityStocks ?? sector.leadingStocks ?? [];
                for (const s of stocks) {
                    oppStocks.push({ code: s.code, name: s.name, sectorName: sector.name });
                }
            }
            const results = [];
            await Promise.all(oppStocks.slice(0, 30).map(async (s) => {
                try {
                    const stock = await this.quickAnalyze(s.code, s.name);
                    if (stock) {
                        stock.sectorName = s.sectorName;
                        results.push(stock);
                    }
                }
                catch { }
            }));
            const ORDER = {
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
        }
        catch (e) {
            return { opportunities: [], timestamp: Date.now() };
        }
    }
    async scanTopGem(force = false) {
        const ttl = getOpportunityTTL();
        const cacheStale = this.cache?.data?.length && this.cache.data.every(s => !s.suggestion);
        if (!force && this.cache && (Date.now() - this.cache.timestamp < ttl) && !cacheStale) {
            this.triggerAnalysisPreCache(this.cache.data);
            return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
        }
        if (cacheStale)
            this.logger.log('🔄 缓存数据缺少 suggestion 字段, 强制重新扫描');
        const data = await this.scanTopFromCandidates(async () => this.fetchGEMCandidates(), 10);
        this.cache = { data, timestamp: Date.now() };
        return { opportunities: data, timestamp: this.cache.timestamp };
    }
    async scanTopMainBoard(force = false) {
        const ttl = getOpportunityTTL();
        const cacheStale = this.mainBoardCache?.data?.length && this.mainBoardCache.data.every(s => !s.suggestion);
        if (!force && this.mainBoardCache && (Date.now() - this.mainBoardCache.timestamp < ttl) && !cacheStale) {
            this.triggerAnalysisPreCache(this.mainBoardCache.data);
            return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
        }
        if (cacheStale)
            this.logger.log('🔄 主板缓存缺少 suggestion 字段, 强制重新扫描');
        const data = await this.scanTopFromCandidates(async () => this.fetchMainBoardCandidates(), 10);
        this.mainBoardCache = { data, timestamp: Date.now() };
        return { opportunities: data, timestamp: this.mainBoardCache.timestamp };
    }
    async scanTopOpportunities(force = false) {
        const gem = await this.scanTopGem(force);
        const main = await this.scanTopMainBoard(force);
        const combined = [...gem.opportunities, ...main.opportunities];
        const ORDER = {
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
    async scanTopFromCandidates(fetchFn, topN) {
        const candidates = [];
        try {
            const c = await fetchFn();
            if (c?.length)
                candidates.push(...c);
        }
        catch { }
        if (candidates.length === 0)
            return [];
        const results = [];
        const BATCH_SIZE = 20;
        let analyzed = 0;
        for (let i = 0; i < candidates.length && analyzed < Math.max(topN * 3, 60); i += BATCH_SIZE) {
            const batch = candidates.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (c) => {
                try {
                    const stock = await this.quickAnalyze(c.code, c.name);
                    if (stock) {
                        results.push(stock);
                        analyzed++;
                    }
                }
                catch { }
            }));
        }
        const ORDER = {
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
    async quickAnalyze(code, name) {
        const raw = await this.dataFetcher.getKLineData(code);
        if (!raw?.length || raw.length < 60)
            return null;
        const klineV = raw.slice(-120);
        const closeArr = klineV.map((k) => Number(k.close));
        const volumeArr = klineV.map((k) => Number(k.volume));
        const highArr = klineV.map((k) => Number(k.high));
        const lowArr = klineV.map((k) => Number(k.low));
        const price = closeArr[closeArr.length - 1];
        const high60 = Math.max(...highArr.slice(-60));
        const low60 = Math.min(...lowArr.slice(-60));
        const pricePos = ((price - low60) / (high60 - low60)) * 100;
        const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const macdR = this.calcCustomMACD(klineV);
        const diff = Array.isArray(macdR?.diff) ? macdR.diff[macdR.diff.length - 1] : (macdR?.diff ?? 0);
        const dea = Array.isArray(macdR?.dea) ? macdR.dea[macdR.dea.length - 1] : (macdR?.dea ?? 0);
        const ma5Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 6];
        const ma10Up = closeArr[closeArr.length - 1] > closeArr[closeArr.length - 11];
        let trendState = 1;
        if (ma5 > ma10 && ma10 > ma20 && ma5Up && ma10Up)
            trendState = 3;
        else if (ma5 > ma10 && ma5Up)
            trendState = 2;
        else if (ma5 < ma10 && ma10 < ma20)
            trendState = 0;
        const klineO = klineV.map((k) => Number(k.open));
        const klineH = klineV.map((k) => Number(k.high));
        const klineL = klineV.map((k) => Number(k.low));
        const klineA = klineV.map((k) => Number(k.amount ?? 0));
        const engine = new formula_engine_1.FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: volumeArr, amount: klineA });
        const baiXing = (0, bai_xing_1.calcBaiXing)(engine);
        const sanJiao = (0, bai_san_jiao_1.calcBaiSanJiao)(engine);
        const lingXing = (0, bai_ling_xing_1.calcBaiLingXing)(engine);
        const xingX = (0, xing_xing_1.calcXingXing)(engine);
        const formulaInput = {
            pricePosition: pricePos,
            trendState,
            trendStrength: baiXing?.trendStrength ?? sanJiao?.trendStrength ?? 0,
            diff,
            dea,
            shortBuy: lingXing?.shortBuy ?? false,
            strictBuy: sanJiao?.strictBuy ?? false,
            jiaCang: sanJiao?.jiaCang ?? false,
            shortSell: xingX?.shortSell ?? false,
            strongSell: xingX?.strongSell ?? false,
            safe: baiXing?.safe ?? false,
            macdGoldenCross: macdR?.isGoldenCross ?? false,
            macdDeathCross: false,
            baiXiaoDays: baiXing?.baiXiaoDays ?? 0,
            volumeStructure: sanJiao?.volumeStructure ?? 0,
        };
        const isGoldenCross = macdR?.isGoldenCross ?? false;
        const result = (0, trading_suggestion_1.getTradingSuggestion)(formulaInput);
        const suggestion = result.action;
        const predictionText = result.prediction || '';
        const reasonText = result.reason || '';
        const NEGATIVE = ['减仓', '卖出', '清仓', '不要介入', '观望'];
        if (NEGATIVE.includes(suggestion))
            return null;
        const NEGATIVE_PREDICTION_KEYWORDS = ['偏弱', '探底', '风险较大', '风险大', '注意风险'];
        if (NEGATIVE_PREDICTION_KEYWORDS.some(kw => predictionText.includes(kw)))
            return null;
        const rawFull = raw;
        const fullCloseArr = rawFull.map((k) => Number(k.close));
        const fullVolumeArr = rawFull.map((k) => Number(k.volume));
        const fullHighArr = rawFull.map((k) => Number(k.high));
        const fullLowArr = rawFull.map((k) => Number(k.low));
        const fullOpenArr = rawFull.map((k) => Number(k.open));
        const fullAmountArr = rawFull.map((k) => Number(k.amount ?? 0));
        const fullEngine = new formula_engine_1.FormulaEngine({
            open: fullOpenArr, close: fullCloseArr, high: fullHighArr,
            low: fullLowArr, volume: fullVolumeArr, amount: fullAmountArr,
        });
        const fullBaiXing = (0, bai_xing_1.calcBaiXing)(fullEngine);
        const fullSanJiao = (0, bai_san_jiao_1.calcBaiSanJiao)(fullEngine);
        const fullLingXing = (0, bai_ling_xing_1.calcBaiLingXing)(fullEngine);
        const fullXingXing = (0, xing_xing_1.calcXingXing)(fullEngine);
        const szEma12 = fullCloseArr.reduce((s, v, i) => i === 0 ? v : s + (v - s) * 2 / 13, 0);
        const szEma26 = fullCloseArr.reduce((s, v, i) => i === 0 ? v : s + (v - s) * 2 / 27, 0);
        const fullDiffV = szEma12 - szEma26;
        const szDeaArr = fullCloseArr.reduce((arr, v, i) => {
            const prev = arr.length ? arr[arr.length - 1] : 0;
            arr.push(i === 0 ? fullCloseArr[0] : prev + (((szEma12 - szEma26) - prev) * 2 / 9));
            return arr;
        }, []);
        const fullDeaV = szDeaArr[szDeaArr.length - 1] || 0;
        const fullIsGoldenCross = fullDiffV > fullDeaV;
        const crossInput = {
            pricePosition: pricePos,
            trendState,
            trendStrength: fullBaiXing?.trendStrength ?? fullSanJiao?.trendStrength ?? 0,
            diff: fullDiffV,
            dea: fullDeaV,
            shortBuy: fullLingXing?.shortBuy ?? false,
            strictBuy: fullSanJiao?.strictBuy ?? false,
            jiaCang: fullSanJiao?.jiaCang ?? false,
            shortSell: fullXingXing?.shortSell ?? false,
            strongSell: fullXingXing?.strongSell ?? false,
            safe: fullBaiXing?.safe ?? false,
            macdGoldenCross: fullIsGoldenCross,
            macdDeathCross: fullDiffV < fullDeaV,
            baiXiaoDays: fullBaiXing?.baiXiaoDays ?? 0,
            volumeStructure: fullSanJiao?.volumeStructure ?? 0,
        };
        const crossResult = (0, trading_suggestion_1.getTradingSuggestion)(crossInput);
        const crossSuggestion = crossResult.action;
        const NEGATIVE_CROSS = ['观望', '减仓', '卖出', '清仓', '不要介入'];
        if (NEGATIVE_CROSS.includes(crossSuggestion))
            return null;
        const priceIncrease = ((price - closeArr[closeArr.length - 20]) / closeArr[closeArr.length - 20]) * 100;
        const changePct = ((price - closeArr[closeArr.length - 2]) / closeArr[closeArr.length - 2]) * 100;
        const BASE = {
            '重仓买入': 100, '买入': 80, '轻仓买入': 65, '准备买入': 55, '持有': 40,
        };
        let score = BASE[suggestion] ?? 30;
        if (pricePos < 30)
            score += 15;
        else if (pricePos < 50)
            score += 8;
        if (closeArr[closeArr.length - 1] > closeArr[closeArr.length - 5])
            score += 5;
        else
            score -= 5;
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
        const cachedStocks = [];
        if (this.cache?.data)
            cachedStocks.push(...this.cache.data.map(s => s.code));
        if (this.mainBoardCache?.data)
            cachedStocks.push(...this.mainBoardCache.data.map(s => s.code));
        if (cachedStocks.length > 0) {
            this.stockService.preCacheAnalysisBatch(cachedStocks).catch(() => { });
        }
    }
    triggerAnalysisPreCache(stocks) {
        if (stocks.length > 0) {
            this.stockService.preCacheAnalysisBatch(stocks.map(s => s.code)).catch(() => { });
        }
    }
};
exports.GemScreenerService = GemScreenerService;
exports.GemScreenerService = GemScreenerService = GemScreenerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [data_fetcher_service_1.DataFetcherService,
        stock_service_1.StockService])
], GemScreenerService);
