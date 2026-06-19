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
const data_1 = require("../../industry-sectors/data");
const ALL_SECTORS = [...data_1.default, ...data_1.CONCEPT_SECTORS];
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
        this.POSITION_THRESHOLD = 92;
        this.RELAXED_POSITION = 90;
        this.TENANT_BATCH = 500;
        this.MIN_GAIN_PCT = 0.3;
        this.MAX_MARKET_CAP = 500_0000_0000;
        this.MIN_MARKET_CAP = 20_0000_0000;
        this.SUGGESTION_PRIORITY = {
            '重仓买入': 1, '买入🏆': 2, '轻仓买入': 3, '准备买入': 4,
            '持有': 5, '减仓': 6, '观望': 7, '卖出': 8, '清仓': 9, '不要介入': 10,
        };
        this.cache = null;
        this.refreshPromise = null;
        this.mainBoardCache = null;
        this.mainBoardRefreshPromise = null;
        this.sectorCache = null;
        this.MAIN_BOARD_CACHE = '/tmp/main-board-opportunities-cache.json';
        this.BUNDLED_MAIN_BOARD_CACHE = (0, node_path_1.join)(__dirname, '..', '..', '..', 'assets', 'main-board-cache.json');
        this.SECTOR_CACHE = '/tmp/sector-opportunities-cache.json';
        this.BUNDLED_SECTOR_CACHE = (0, node_path_1.join)(__dirname, '..', '..', '..', 'assets', 'sector-cache.json');
        this.prevGEMResults = [];
        this.prevMainBoardResults = [];
        this.lastScanAt = 0;
        this.SCAN_INTERVAL = 5 * 60 * 1000;
        this.marketHoursBeganAt = 0;
        this.updateMarketHoursBeganAt();
        this.loadCacheFromDisk();
        this.loadMainBoardCacheFromDisk();
        this.loadSectorCacheFromDisk();
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
    loadCacheFromDisk() {
        try {
            const raw = (0, fs_1.readFileSync)(this.CACHE_FILE, 'utf-8');
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
    loadMainBoardCacheFromDisk() {
        try {
            const raw = (0, fs_1.readFileSync)(this.MAIN_BOARD_CACHE, 'utf-8');
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
    loadSectorCacheFromDisk() {
        try {
            const raw = (0, fs_1.readFileSync)(this.SECTOR_CACHE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.data && Array.isArray(parsed.data)) {
                const limitedData = parsed.data.slice(0, 10);
                this.sectorCache = { ...parsed, data: limitedData };
                this.logger.log(`📦 板块加载缓存成功, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleTimeString()}`);
                return;
            }
        }
        catch {
            this.logger.log('📦 无板块本地缓存');
        }
        try {
            if ((0, fs_1.existsSync)(this.BUNDLED_SECTOR_CACHE)) {
                const raw = (0, fs_1.readFileSync)(this.BUNDLED_SECTOR_CACHE, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && parsed.data && Array.isArray(parsed.data)) {
                    const limitedData = parsed.data.slice(0, 10);
                    this.sectorCache = { ...parsed, data: limitedData };
                    this.logger.log(`📦 从部署包恢复板块缓存, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleString('zh-CN')}`);
                }
            }
        }
        catch (err) {
            this.logger.warn(`⚠️ 板块部署包缓存加载失败: ${err.message}`);
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
        if (this.cache) {
            this.upgradeCacheFields(this.cache.data);
            this.triggerAnalysisPreCache(this.cache.data);
            return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
        }
        return { opportunities: [], timestamp: Date.now() };
    }
    upgradeCacheFields(data) {
        if (!data || data.length === 0)
            return;
        if (data[0].chipConcentration90 !== undefined)
            return;
        for (const s of data) {
            const sig = s.suggestion || '';
            const pos = s.pricePosition || 0;
            const gc = s.isGoldenCross;
            const ok = s.entryTiming && s.entryTiming >= 60 ? '强' : '弱';
            if (sig === '重仓买入') {
                s.signalCombination = pos < 25 ? '白消信号+低位' : '白消信号+强势';
            }
            else if (sig === '买入') {
                s.signalCombination = pos < 45 ? '白消信号+中低位' : '白消信号+趋势';
            }
            else if (sig === '轻仓买入') {
                s.signalCombination = '白消信号';
            }
            else {
                s.signalCombination = '';
            }
            s.jiGouActiveScore = s.jiGouActiveScore ?? Math.round(((s.entryTiming || 0) / 100 * 20) * 100) / 100;
            s.chipConcentration90 = s.chipConcentration90 ?? 50;
            s.chipPeakPosition = s.chipPeakPosition ?? 'mid';
            s.chipPattern = s.chipPattern ?? 'dispersed';
        }
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
        this.logger.log('📦 创业板: 启动跳过自动扫描, 等待前端推送数据触发引擎分析');
        try {
            const raw = await fs_1.promises.readFile(this.MAIN_BOARD_CACHE, 'utf-8');
            const parsed = JSON.parse(raw);
            this.mainBoardCache = { data: parsed.data, timestamp: parsed.timestamp };
            this.logger.log(`📦 主板机会区: 从磁盘恢复缓存, ${this.mainBoardCache.data.length} 只`);
        }
        catch { }
        if (!this.mainBoardCache || this.mainBoardCache.data.length === 0) {
            this.logger.log('📦 主板机会区: 无缓存, 等待前端推送数据');
        }
    }
    calcCustomMACD(kline) {
        const closes = kline.map(k => k.close);
        const len = closes.length;
        if (len < 20) {
            return { diff: [], dea: [], currentDiff: 0, currentDea: 0, isGoldenCross: false, goldenCrossDays: 0, isDeathCross: false };
        }
        const avgLine = [];
        for (let i = Math.min(33, Math.floor(len / 2)); i < len; i++) {
            const ma3 = closes.slice(Math.max(0, i - 2), i + 1).reduce((a, b) => a + b, 0) / Math.min(3, i + 1);
            const ma5 = closes.slice(Math.max(0, i - 4), i + 1).reduce((a, b) => a + b, 0) / Math.min(5, i + 1);
            const ma8 = closes.slice(Math.max(0, i - 7), i + 1).reduce((a, b) => a + b, 0) / Math.min(8, i + 1);
            const ma13 = closes.slice(Math.max(0, i - 12), i + 1).reduce((a, b) => a + b, 0) / Math.min(13, i + 1);
            const ma21 = closes.slice(Math.max(0, i - 20), i + 1).reduce((a, b) => a + b, 0) / Math.min(21, i + 1);
            const ma34Count = Math.min(34, i + 1);
            const ma34 = closes.slice(Math.max(0, i - ma34Count + 1), i + 1).reduce((a, b) => a + b, 0) / ma34Count;
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
        results.sort((a, b) => {
            const pa = this.SUGGESTION_PRIORITY[a.suggestion ?? ''] ?? 99;
            const pb = this.SUGGESTION_PRIORITY[b.suggestion ?? ''] ?? 99;
            return pa !== pb ? pa - pb
                : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
                    : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
                        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
        });
        const finalResults = results.slice(0, 10);
        this.stockService.preCacheAnalysisBatch(finalResults.map(s => s.code)).catch(() => { });
        return finalResults;
    }
    async scanWithFrontendData(stocks) {
        const results = [];
        for (const s of stocks) {
            if (s.klines && s.klines.length >= 20) {
                this.dataFetcher.preloadKline(s.code, s.klines);
            }
        }
        for (const s of stocks) {
            try {
                const candidate = {
                    code: s.code,
                    name: s.name,
                    inflow: s.inflow,
                    changePercent: s.changePercent,
                    currentPrice: s.price,
                };
                const result = await this.checkOpportunity(candidate);
                if (result)
                    results.push(result);
            }
            catch { }
        }
        if (results.length <= 3) {
            for (const s of stocks) {
                try {
                    const candidate = {
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
                }
                catch { }
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
        const existing = this.cache?.data || [];
        const merged = [...existing, ...results];
        const seen = new Set();
        const deduped = merged.filter(r => { if (seen.has(r.code))
            return false; seen.add(r.code); return true; });
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
    async scanWithFrontendMainBoardData(stocks) {
        const results = [];
        for (const s of stocks) {
            if (s.klines && s.klines.length >= 20) {
                this.dataFetcher.preloadKline(s.code, s.klines);
            }
        }
        for (const s of stocks) {
            try {
                const candidate = {
                    code: s.code, name: s.name, inflow: s.inflow,
                    changePercent: s.changePercent, currentPrice: s.price,
                };
                const result = await this.checkOpportunity(candidate);
                if (result)
                    results.push(result);
            }
            catch { }
        }
        if (results.length <= 3) {
            for (const s of stocks) {
                try {
                    const candidate = {
                        code: s.code, name: s.name, inflow: s.inflow,
                        changePercent: s.changePercent, currentPrice: s.price,
                    };
                    const result = await this.checkOpportunityRelaxed(candidate);
                    if (result && !results.find(ex => ex.code === result.code))
                        results.push(result);
                }
                catch { }
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
        const seenMain = new Set();
        const dedupedMain = mergedMain.filter(r => { if (seenMain.has(r.code))
            return false; seenMain.add(r.code); return true; });
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
    async scanWithFrontendSectorData(stocks) {
        const results = [];
        for (const s of stocks) {
            if (s.klines && s.klines.length >= 20) {
                this.dataFetcher.preloadKline(s.code, s.klines);
            }
        }
        for (const s of stocks) {
            try {
                const candidate = {
                    code: s.code, name: s.name, inflow: s.inflow ?? 0,
                    changePercent: s.changePercent ?? 0, currentPrice: s.price ?? 0,
                };
                const result = await this.checkOpportunity(candidate);
                if (result) {
                    result.sectorName = s.sectorName;
                    results.push(result);
                }
            }
            catch { }
        }
        if (results.length <= 3) {
            for (const s of stocks) {
                try {
                    const candidate = {
                        code: s.code, name: s.name, inflow: s.inflow ?? 0,
                        changePercent: s.changePercent ?? 0, currentPrice: s.price ?? 0,
                    };
                    const result = await this.checkOpportunityRelaxed(candidate);
                    if (result && !results.find(ex => ex.code === result.code)) {
                        result.sectorName = s.sectorName;
                        results.push(result);
                    }
                }
                catch { }
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
        const seenSector = new Set();
        const dedupedSector = mergedSector.filter(r => { if (seenSector.has(r.code))
            return false; seenSector.add(r.code); return true; });
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
        try {
            await fs_1.promises.writeFile(this.SECTOR_CACHE, JSON.stringify(this.sectorCache));
        }
        catch { }
        this.logger.log(`✅ 前端板块数据推送完成, 累加合并后 ${finalResults.length} 只`);
        return finalResults;
    }
    async scanWithFrontendHeavyBuyData(stocks) {
        const results = [];
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
            }
            catch { }
        }
        results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const top = results.slice(0, 10);
        this.logger.log(`✅ 重仓买入分析完成: ${top.length} 只`);
        return top;
    }
    async generateSeedCache() {
        const assetDir = (0, node_path_1.join)(__dirname, '..', '..', '..', 'assets');
        this.logger.log(`📦 开始生成种子缓存到 ${assetDir}`);
        try {
            await fs_1.promises.mkdir(assetDir, { recursive: true });
            this.logger.log('  ⏳ 正在全量扫描创业板...');
            try {
                await Promise.race([
                    this['scanAllStocks'](),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('扫描超时')), 120000))
                ]);
            }
            catch (scanErr) {
                this.logger.warn(`  创业板扫描异常: ${scanErr.message}，使用当前缓存`);
            }
            this.logger.log('  ⏳ 正在扫描重仓买入...');
            try {
                await Promise.race([
                    this['scanGlobalHeavyBuy'](),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('扫描超时')), 60000))
                ]);
            }
            catch (scanErr) {
                this.logger.warn(`  重仓买入扫描异常: ${scanErr.message}，使用当前缓存`);
            }
            if (this.cache) {
                this.cache.timestamp = Date.now();
            }
            if (this.cache && this.cache.data?.length > 0) {
                const gemPath = (0, node_path_1.join)(assetDir, 'gem-cache.json');
                await fs_1.promises.writeFile(gemPath, JSON.stringify(this.cache, null, 2));
                this.logger.log(`  ✅ GEM缓存: ${this.cache.data.length} 只`);
            }
            for (const [cacheFile, tmpFile] of [
                ['main-board-cache.json', 'main-board-opportunities-cache.json'],
                ['sector-cache.json', 'sector-opportunities-cache.json'],
                ['heavy-buy-cache.json', 'heavy-buy-cache.json'],
            ]) {
                const tmpPath = (0, node_path_1.join)('/tmp', tmpFile);
                try {
                    const content = await fs_1.promises.readFile(tmpPath, 'utf-8');
                    const parsed = JSON.parse(content);
                    parsed.timestamp = Date.now();
                    await fs_1.promises.writeFile((0, node_path_1.join)(assetDir, cacheFile), JSON.stringify(parsed, null, 2));
                    this.logger.log(`  ✅ ${cacheFile}: ${parsed.data?.length || 0} 只`);
                }
                catch {
                    this.logger.warn(`  ⚠️ ${cacheFile} 跳过（无缓存文件）`);
                }
            }
            return { success: true, files: ['gem-cache.json', 'main-board-cache.json', 'sector-cache.json', 'heavy-buy-cache.json'] };
        }
        catch (err) {
            this.logger.error(`❌ 种子缓存生成失败: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
    async enrichWithMainForceFlow(results) {
        if (results.length === 0)
            return;
        const BATCH = 50;
        for (let i = 0; i < results.length; i += BATCH) {
            const batch = results.slice(i, i + BATCH);
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
                const data = await res.json();
                if (!data?.data?.diff)
                    continue;
                for (const item of data.data.diff) {
                    const code = String(item.f12);
                    const mainForce = item.f62;
                    if (mainForce !== undefined && mainForce !== null) {
                        const target = results.find(r => r.code === code);
                        if (target) {
                            target.mainForceInflow = Math.round(mainForce);
                        }
                    }
                }
            }
            catch (err) {
                this.logger.warn(`⚠️ 东方财富主力资金获取失败: ${err.message}`);
            }
        }
    }
    async checkOpportunity(s, prevSuggestion) {
        const kline = await this.dataFetcher.getKLineData(s.code);
        if (!kline || kline.length < 20)
            return null;
        const closeArr = kline.map(k => k.close);
        const len = closeArr.length;
        if (len < 20)
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
        if (macdResult.currentDiff < macdResult.currentDea)
            return null;
        const excludeKeywords = ['银行', '保险', '农商', '兴业银', '中国人寿', '中国平安', '中国人保', '中国太保', '新华保险'];
        for (const kw of excludeKeywords) {
            if (s.name.includes(kw))
                return null;
        }
        if (/^(\*)?ST/.test(s.name))
            return null;
        const goldenCrossDays = macdResult.goldenCrossDays || 15;
        const hasAnyBaiXiaoSignal = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai ||
            bx.diBuBuy || bx.gaoWeiHuiDiaoBuy || bx.zhuLiShiPan || bx.jiaCang);
        if (!hasAnyBaiXiaoSignal)
            return null;
        const highs = kline.map(k => k.high);
        const lows = kline.map(k => k.low);
        const periodHigh = Math.max(...highs.slice(-60));
        const periodLow = Math.min(...lows.slice(-60));
        const pricePosition = periodHigh > periodLow
            ? ((closeArr[len - 1] - periodLow) / (periodHigh - periodLow)) * 100
            : 50;
        const isLowPosition = pricePosition < 25;
        const hasStrongSignal = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.jiaCang);
        if (pricePosition >= this.POSITION_THRESHOLD && !isLowPosition && !hasStrongSignal)
            return null;
        const closeIdx = len - 1;
        const lookbackDays = Math.max(1, goldenCrossDays || 15);
        const triggerIdx = closeIdx - lookbackDays;
        const triggerClose = triggerIdx >= 0 ? kline[triggerIdx].close : kline[0].close;
        const currentClose = kline[closeIdx].close;
        const priceIncrease = ((currentClose - triggerClose) / triggerClose) * 100;
        if (isGoldenCross && priceIncrease > 25)
            return null;
        const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
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
            buySignal = '白消启动突破';
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
        else if (ma5 <= ma10) {
            trendStateR = 0;
        }
        const trendStrengthR = ((ma5 / ma10 - 1) * 100);
        const avgVolR = klineV.slice(-30).reduce((a, b) => a + b, 0) / 30;
        const recentVolR = klineV.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const volumeRatio = recentVolR / avgVolR;
        const volumeBullishR = volumeRatio > 1.1;
        const zhuShengSignal = trendStateR >= 2 && macdBullishR;
        const recent20High = Math.max(...highs.slice(-20));
        const recent20Low = Math.min(...lows.slice(-20));
        const rangePct = (recent20High - recent20Low) / (recent20Low || 1) * 100;
        const isSideways = rangePct < 12;
        const hengPanBreakout = isSideways && closeArr[len - 1] >= recent20High * 0.995 && volumeRatio > 1.3;
        const zhenDangBuy = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2);
        const jiGouActive = Math.min(volumeRatio * 6, 20);
        const prevClose = len > 1 ? closeArr[len - 2] : closeArr[0];
        const firstBreakMA5 = prevClose <= ma5 * 1.005 && closeArr[len - 1] > ma5;
        const baiBuSellSignals = [];
        if (bx.gaoKaiDiZouQingCang)
            baiBuSellSignals.push('高开低走清仓');
        if (bx.baoLiangFuGaiQingCang)
            baiBuSellSignals.push('爆量覆盖清仓');
        if (bx.po5RiXian)
            baiBuSellSignals.push('破5日线');
        if (bx.yinDiePoWei)
            baiBuSellSignals.push('阴跌破位');
        const hasSellSignal = baiBuSellSignals.length > 0;
        let sellSignal = '';
        let suggestionR = '观望';
        let signalCombination = '';
        const isBaiBu = !!bx.baiBu;
        if (isBaiBu && hasSellSignal && jiGouActive >= 12 && firstBreakMA5) {
            suggestionR = '卖出';
            sellSignal = baiBuSellSignals.join('+');
            signalCombination = '白布区域:' + sellSignal;
        }
        if (!sellSignal) {
            const hasBaiXiaoBuy = isBaiXiaoBuy;
            const hasQSHC = hasQiangShiHuiCai;
            const hasJiaCang = !!bx.jiaCang;
            const hasZhuSheng = zhuShengSignal;
            const hasZhenDang = zhenDangBuy;
            const hasHengPan = hengPanBreakout;
            const activeHigh = jiGouActive >= 12;
            if (bxDays >= 4 && bxDays <= 6 && activeHigh && hasBaiXiaoBuy && (hasZhuSheng || hasQSHC || hasJiaCang)) {
                suggestionR = '重仓买入';
                signalCombination = '白消4-6天+机构活跃+主升';
            }
            else if (bxDays >= 4 && bxDays <= 6 && activeHigh && (hasBaiXiaoBuy || (hasQSHC && hasJiaCang))) {
                suggestionR = '重仓买入';
                signalCombination = '白消4-6天+机构活跃';
            }
            else if (bxDays >= 4 && bxDays <= 6 && hasBaiXiaoBuy && hasZhuSheng && hasJiaCang) {
                suggestionR = '重仓买入';
                signalCombination = '白消启动+主升+加仓';
            }
            else if (bxDays > 6 && activeHigh && hasHengPan && hasZhuSheng) {
                suggestionR = '买入';
                signalCombination = '白消6天+横盘突破+主升';
            }
            else if (bxDays > 6 && hasHengPan) {
                suggestionR = '买入';
                signalCombination = '白消6天+横盘突破';
            }
            else if (bxDays > 6 && hasQSHC && hasZhuSheng) {
                suggestionR = '买入';
                signalCombination = '白消6天+强势回踩+主升';
            }
            else if (bxDays > 6 && activeHigh && hasBaiXiaoBuy) {
                suggestionR = '买入';
                signalCombination = '白消6天+机构活跃';
            }
            else if (bxDays >= 4 && bxDays <= 6 && hasBaiXiaoBuy && hasZhenDang) {
                suggestionR = '买入';
                signalCombination = '白消启动+震荡买点';
            }
            else if (bxDays >= 4 && bxDays <= 6 && hasQSHC && hasZhuSheng) {
                suggestionR = '买入';
                signalCombination = '白消启动+强势回踩+主升';
            }
            else if (hasQSHC && hasZhuSheng) {
                suggestionR = '轻仓买入';
                signalCombination = '强势回踩+主升';
            }
            else if (hasQSHC) {
                suggestionR = '轻仓买入';
                signalCombination = '强势回踩';
            }
            else if (hasBaiXiaoBuy) {
                suggestionR = '轻仓买入';
                signalCombination = '白消启动';
            }
            else if (hasZhuSheng) {
                suggestionR = '轻仓买入';
                signalCombination = '主升信号';
            }
            else if (hasZhenDang) {
                suggestionR = '轻仓买入';
                signalCombination = '震荡买点';
            }
            else if (bxDays >= 4 && hasBaiXiaoBuy) {
                suggestionR = '轻仓买入';
                signalCombination = '白消信号';
            }
        }
        if (isBaiBu && hasSellSignal) {
            if (bx.baoLiangFuGaiQingCang || bx.po5RiXian) {
                suggestionR = '清仓';
                sellSignal = baiBuSellSignals.join('+');
                signalCombination = '白布:' + sellSignal;
            }
            else if (bx.gaoKaiDiZouQingCang || bx.yinDiePoWei) {
                suggestionR = '卖出';
                sellSignal = baiBuSellSignals.join('+');
                signalCombination = '白布:' + sellSignal;
            }
            else {
                suggestionR = '减仓';
                sellSignal = baiBuSellSignals.join('+');
                signalCombination = '白布:' + sellSignal;
            }
        }
        if (suggestionR === '观望') {
            if (trendStateR >= 2 && ma5 > ma10) {
                suggestionR = '持有';
                signalCombination = '趋势向上+均线多头';
            }
            else if (trendStateR === 0 || (ma5 < ma10 && !macdBullishR)) {
                suggestionR = '不要介入';
                signalCombination = '趋势向下';
            }
        }
        const NOT_BUY = ['观望', '减仓', '卖出', '清仓', '不要介入'];
        if (NOT_BUY.includes(suggestionR))
            return null;
        if (sellSignal)
            return null;
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
            signalCombination,
            jiGouActiveScore: Math.round(jiGouActive * 100) / 100,
        };
    }
    async checkOpportunityRelaxed(s, prevSuggestion) {
        const kline = await this.dataFetcher.getKLineData(s.code);
        if (!kline || kline.length < 20)
            return null;
        const closeArr = kline.map(k => k.close);
        const len = closeArr.length;
        if (len < 20)
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
        if (/^(\*)?ST/.test(s.name))
            return null;
        const goldenCrossDays = isGoldenCross ? macdResult.goldenCrossDays : 1;
        const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ma20 = len >= 20 ? closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;
        if (ma5 <= ma10 * 1.001)
            return null;
        if (len >= 8) {
            const ma5_3d = closeArr.slice(-8, -3).reduce((a, b) => a + b, 0) / 5;
            if (ma5 < ma5_3d)
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
        const volumeRatio = recentVolR / avgVolR;
        const volumeBullishR = volumeRatio > 1.1;
        const zhuShengSignal = trendStateR >= 2 && macdBullishR;
        const recent20High = Math.max(...highs.slice(-20));
        const recent20Low = Math.min(...lows.slice(-20));
        const rangePct = (recent20High - recent20Low) / (recent20Low || 1) * 100;
        const isSideways = rangePct < 12;
        const hengPanBreakout = isSideways && closeArr[len - 1] >= recent20High * 0.995 && volumeRatio > 1.3;
        const zhenDangBuy = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2);
        const jiGouActive = Math.min(volumeRatio * 6, 20);
        const prevClose = len > 1 ? closeArr[len - 2] : closeArr[0];
        const firstBreakMA5 = prevClose <= ma5 * 1.005 && closeArr[len - 1] > ma5;
        const baiBuSellSignals = [];
        if (bx.gaoKaiDiZouQingCang)
            baiBuSellSignals.push('高开低走清仓');
        if (bx.baoLiangFuGaiQingCang)
            baiBuSellSignals.push('爆量覆盖清仓');
        if (bx.po5RiXian)
            baiBuSellSignals.push('破5日线');
        if (bx.yinDiePoWei)
            baiBuSellSignals.push('阴跌破位');
        const hasSellSignal = baiBuSellSignals.length > 0;
        let sellSignal = '';
        let suggestionR = '观望';
        let signalCombination = '';
        const isBaiBu = !!bx.baiBu;
        if (isBaiBu && hasSellSignal && jiGouActive >= 12 && firstBreakMA5) {
            if (bx.baoLiangFuGaiQingCang || bx.po5RiXian) {
                suggestionR = '清仓';
                sellSignal = baiBuSellSignals.join('+');
                signalCombination = '白布清仓:' + sellSignal;
            }
            else if (bx.gaoKaiDiZouQingCang || bx.yinDiePoWei) {
                suggestionR = '卖出';
                sellSignal = baiBuSellSignals.join('+');
                signalCombination = '白布卖出:' + sellSignal;
            }
            else {
                suggestionR = '减仓';
                sellSignal = baiBuSellSignals.join('+');
                signalCombination = '白布减仓:' + sellSignal;
            }
        }
        if (!sellSignal) {
            const hasBaiXiaoBuy = isBaiXiaoBuy;
            const hasQSHC = hasQiangShiHuiCai;
            const hasJiaCang = !!bx.jiaCang;
            const hasZhuSheng = zhuShengSignal;
            const hasZhenDang = zhenDangBuy;
            const hasHengPan = hengPanBreakout;
            if (bxDays >= 4 && bxDays <= 6) {
                const activeHigh = jiGouActive >= 12;
                if (activeHigh && hasBaiXiaoBuy && (hasZhuSheng || hasQSHC || hasJiaCang)) {
                    suggestionR = '重仓买入';
                    signalCombination = '白消4-6天+机构活跃+主升';
                }
                else if (activeHigh && (hasBaiXiaoBuy || (hasQSHC && hasJiaCang))) {
                    suggestionR = '重仓买入';
                    signalCombination = '白消4-6天+机构活跃';
                }
                else if (hasBaiXiaoBuy && hasZhuSheng && hasJiaCang) {
                    suggestionR = '重仓买入';
                    signalCombination = '白消启动+主升+加仓';
                }
                else if (bxDays > 6 && activeHigh && hasHengPan && hasZhuSheng) {
                    suggestionR = '买入';
                    signalCombination = '白消6天+横盘突破+主升';
                }
                else if (bxDays > 6 && hasHengPan) {
                    suggestionR = '买入';
                    signalCombination = '白消6天+横盘突破';
                }
                else if (bxDays > 6 && hasQSHC && hasZhuSheng) {
                    suggestionR = '买入';
                    signalCombination = '白消6天+强势回踩+主升';
                }
                else if (bxDays > 6 && activeHigh && hasBaiXiaoBuy) {
                    suggestionR = '买入';
                    signalCombination = '白消6天+机构活跃';
                }
                else if (hasBaiXiaoBuy && hasZhenDang) {
                    suggestionR = '买入';
                    signalCombination = '白消启动+震荡买点';
                }
                else if (hasQSHC && hasZhuSheng) {
                    suggestionR = '买入';
                    signalCombination = '强势回踩+主升';
                }
                else if (hasBaiXiaoBuy && hasQSHC) {
                    suggestionR = '买入';
                    signalCombination = '白消启动+强势回踩';
                }
                else if (hasQSHC && hasJiaCang) {
                    suggestionR = '买入';
                    signalCombination = '强势回踩+加仓';
                }
                else if (hasBaiXiaoBuy && hasJiaCang) {
                    suggestionR = '买入';
                    signalCombination = '白消启动+加仓';
                }
                else if (hasBaiXiaoBuy) {
                    suggestionR = '轻仓买入';
                    signalCombination = '白消启动';
                }
                else if (hasQSHC) {
                    suggestionR = '轻仓买入';
                    signalCombination = '强势回踩';
                }
                else if (hasZhuSheng) {
                    suggestionR = '轻仓买入';
                    signalCombination = '主升信号';
                }
                else if (hasZhenDang) {
                    suggestionR = '轻仓买入';
                    signalCombination = '震荡买点';
                }
            }
            else if (bxDays > 6) {
                const activeHigh = jiGouActive >= 12;
                if (activeHigh && hasHengPan && hasZhuSheng) {
                    suggestionR = '买入';
                    signalCombination = '白消6天+横盘突破+主升';
                }
                else if (hasHengPan) {
                    suggestionR = '买入';
                    signalCombination = '白消6天+横盘突破';
                }
                else if (hasQSHC && hasZhuSheng) {
                    suggestionR = '买入';
                    signalCombination = '强势回踩+主升';
                }
            }
            if (suggestionR === '观望' && (hasBaiXiaoBuy || hasQSHC || hasZhenDang)) {
                const zoneR = pricePosition < 25 ? '低位区' : pricePosition < 45 ? '中低位区' : pricePosition < 55 ? '中位区' : pricePosition < 75 ? '中高位区' : '高位区';
                if (zoneR.includes('低位') && trendStateR >= 1) {
                    suggestionR = '重仓买入';
                    signalCombination = '白消信号+低位';
                }
                else if (zoneR.includes('低位') || zoneR.includes('中低位')) {
                    suggestionR = '买入';
                    signalCombination = '白消信号+中低位';
                }
                else if (trendStateR >= 2) {
                    suggestionR = '轻仓买入';
                    signalCombination = '白消信号+趋势';
                }
                else {
                    suggestionR = '轻仓买入';
                    signalCombination = '白消信号';
                }
            }
            if (suggestionR === '观望') {
                if (trendStateR >= 2 && ma5 > ma10) {
                    suggestionR = '持有';
                    signalCombination = '趋势向上+均线多头';
                }
                else if (ma5 < ma10 && !macdBullishR) {
                    suggestionR = '不要介入';
                    signalCombination = '趋势向下';
                }
            }
            const NOT_BUY = ['观望', '减仓', '卖出', '清仓', '不要介入'];
            if (NOT_BUY.includes(suggestionR))
                return null;
            if (sellSignal)
                return null;
            const chip = this.calcChipAnalysis(closeArr, klineH, klineL, klineV, currentClose);
            const chipConcentration90 = chip.concentration90;
            const chipPeakPosition = chip.peakPosition;
            const chipPattern = chip.pattern;
            const chipDowngrade = chipPattern === 'dispersed' && chipPeakPosition === 'high' && pricePosition < 30;
            const chipRisk = chipConcentration90 > 40 && chipPeakPosition === 'high' && pricePosition < 25;
            if (chipDowngrade || chipRisk) {
                if (suggestionR === '重仓买入') {
                    suggestionR = '买入';
                    signalCombination = (signalCombination || '') + '|筹码分散降级';
                }
                else if (suggestionR === '买入') {
                    suggestionR = '轻仓买入';
                    signalCombination = (signalCombination || '') + '|筹码承压降级';
                }
                else if (suggestionR === '轻仓买入') {
                    suggestionR = '不要介入';
                    signalCombination = (signalCombination || '') + '|筹码结构差';
                }
            }
            if (chipPattern === 'single_peak' && chipPeakPosition === 'low' && pricePosition > 15 && pricePosition < 45 && trendStateR >= 1) {
                if (suggestionR === '买入') {
                    suggestionR = '重仓买入';
                    signalCombination = (signalCombination || '') + '|筹码集中支撑';
                }
                else if (suggestionR === '轻仓买入') {
                    suggestionR = '买入';
                    signalCombination = (signalCombination || '') + '|筹码集中支撑';
                }
            }
            const contResult = this.applySignalContinuity(suggestionR, prevSuggestion, pricePosition, trendStateR);
            if (contResult.changed) {
                suggestionR = contResult.suggestion;
                signalCombination = (signalCombination || '') + '|信号延续:' + suggestionR;
            }
            const entryTiming = this.calcEntryTiming(pricePosition, trendStateR, closeArr, klineH, klineL, klineV, isGoldenCross);
            const safetyScore = this.calcSafetyScore(closeArr, klineH, klineL, klineV, pricePosition, trendStateR);
            const TIMING_ORDER = ['重仓买入', '买入', '轻仓买入', '持有', '观望', '不要介入'];
            const sugIdx = TIMING_ORDER.indexOf(suggestionR);
            if (sugIdx >= 0 && entryTiming >= 65 && sugIdx > 1) {
                const upgrade = sugIdx <= 2 ? TIMING_ORDER[sugIdx - 1] : '轻仓买入';
                if (upgrade !== suggestionR) {
                    suggestionR = upgrade;
                    signalCombination = (signalCombination || '') + '|入场对齐↑' + suggestionR;
                }
            }
            else if (sugIdx >= 0 && entryTiming < 35 && sugIdx <= 1) {
                suggestionR = TIMING_ORDER[sugIdx + 1];
                signalCombination = (signalCombination || '') + '|入场对齐↓' + suggestionR;
            }
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
                signalCombination,
                jiGouActiveScore: 0,
                chipConcentration90,
                chipPeakPosition,
                chipPattern,
            };
        }
        return null;
    }
    calcEntryTiming(pricePosition, trendState, closeArr, highArr, lowArr, volumeArr, macdGoldenCross) {
        const len = closeArr.length;
        if (len < 10)
            return 50;
        let timing = 50;
        const currentPrice = closeArr[len - 1];
        if (pricePosition >= 28 && pricePosition <= 55) {
            const periodHigh60 = Math.max(...closeArr.slice(-60));
            const periodLow60 = Math.min(...closeArr.slice(-60));
            const prevDistanceFromHigh = (periodHigh60 - currentPrice) / (periodHigh60 - periodLow60 || 1);
            if (prevDistanceFromHigh > 0.3) {
                const recent10 = closeArr.slice(-10);
                const mean = recent10.reduce((a, b) => a + b, 0) / 10;
                const variance = recent10.reduce((sum, v) => sum + (v - mean) ** 2, 0) / 10;
                const std = Math.sqrt(variance);
                const volatility = std / mean;
                if (volatility < 0.025) {
                    timing += 25;
                }
                if (trendState >= 2)
                    timing += 15;
                if (macdGoldenCross)
                    timing += 10;
                if (volatility < 0.025 && trendState >= 2)
                    timing += 5;
            }
        }
        if (pricePosition >= 75 && trendState >= 2) {
            timing += 20;
            const recentHigh20 = Math.max(...closeArr.slice(-20, -1));
            if (currentPrice >= recentHigh20 * 0.98) {
                timing += 15;
            }
            if (macdGoldenCross)
                timing += 10;
            if (trendState >= 3)
                timing += 5;
        }
        if (pricePosition >= 15 && pricePosition < 28 && trendState >= 2) {
            timing += 15;
            if (macdGoldenCross)
                timing += 10;
            const avgVol30 = volumeArr.slice(-30).reduce((a, b) => a + b, 0) / 30;
            const recentVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
            if (recentVol5 > avgVol30 * 1.3)
                timing += 10;
        }
        return Math.min(Math.max(timing, 0), 100);
    }
    calcSafetyScore(closeArr, highArr, lowArr, volumeArr, pricePosition, trendState) {
        const len = closeArr.length;
        if (len < 20)
            return 50;
        let safety = 55;
        const recent20 = closeArr.slice(-20);
        const dailyReturns = [];
        for (let i = 1; i < recent20.length; i++) {
            dailyReturns.push((recent20[i] - recent20[i - 1]) / recent20[i - 1]);
        }
        const meanRet = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        const varRet = dailyReturns.reduce((sum, v) => sum + (v - meanRet) ** 2, 0) / dailyReturns.length;
        const volStd = Math.sqrt(varRet);
        const annualizedVol = volStd * Math.sqrt(252);
        if (annualizedVol < 0.35) {
            safety += 20;
        }
        else if (annualizedVol < 0.50) {
            safety += 10;
        }
        else if (annualizedVol > 0.70) {
            safety -= 15;
        }
        const lastReturn = Math.abs(dailyReturns[dailyReturns.length - 1] || 0);
        if (lastReturn > 0.12) {
            safety -= 20;
        }
        else if (lastReturn > 0.08) {
            safety -= 10;
        }
        let consecutiveBigUp = 0;
        for (let i = dailyReturns.length - 1; i >= 0; i--) {
            if (dailyReturns[i] > 0.05)
                consecutiveBigUp++;
            else
                break;
        }
        if (consecutiveBigUp >= 3)
            safety -= 15;
        else if (consecutiveBigUp >= 2)
            safety -= 5;
        if (pricePosition > 92)
            safety -= 10;
        else if (pricePosition > 80)
            safety -= 5;
        else if (pricePosition < 15)
            safety -= 5;
        if (trendState >= 2 && pricePosition < 70) {
            safety += 10;
        }
        const avgVol20 = volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const lastVol = volumeArr[volumeArr.length - 1] || 0;
        if (lastVol > avgVol20 * 2 && dailyReturns[dailyReturns.length - 1] < 0) {
            safety -= 10;
        }
        return Math.min(Math.max(safety, 0), 100);
    }
    applySignalContinuity(currentSuggestion, prevSuggestion, pricePosition, trendState) {
        if (!prevSuggestion || prevSuggestion === '观望' || prevSuggestion === '不要介入' || prevSuggestion === '持有') {
            return { suggestion: currentSuggestion, changed: false };
        }
        const PRIORITY = ['重仓买入', '买入', '轻仓买入', '持有', '观望', '不要介入', '减仓', '卖出', '清仓'];
        const prevIdx = PRIORITY.indexOf(prevSuggestion);
        const curIdx = PRIORITY.indexOf(currentSuggestion);
        if (prevIdx === -1 || curIdx === -1)
            return { suggestion: currentSuggestion, changed: false };
        if (prevIdx === 0) {
            if (curIdx > 1) {
                return { suggestion: '重仓买入', changed: true };
            }
        }
        if (prevIdx === 1) {
            if (curIdx > 2) {
                return { suggestion: '买入', changed: true };
            }
        }
        if (prevIdx === 2) {
            if (curIdx > 3) {
                return { suggestion: '持有', changed: true };
            }
        }
        return { suggestion: currentSuggestion, changed: false };
    }
    calcChipAnalysis(closeArr, highArr, lowArr, volumeArr, currentPrice) {
        const len = closeArr.length;
        if (len < 20)
            return { concentration90: 50, peakPosition: 'mid', pattern: 'dispersed' };
        const N = Math.min(60, len);
        const c = closeArr.slice(-N);
        const h = highArr.slice(-N);
        const l = lowArr.slice(-N);
        const v = volumeArr.slice(-N);
        const minPrice = Math.min(...l);
        const maxPrice = Math.max(...h);
        const range = maxPrice - minPrice;
        if (range < 0.01)
            return { concentration90: 95, peakPosition: 'mid', pattern: 'single_peak' };
        const BINS = 20;
        const binSize = range / BINS;
        const bins = new Array(BINS).fill(0);
        for (let i = 0; i < N; i++) {
            const dayLow = l[i];
            const dayHigh = h[i];
            const dayVol = v[i];
            const dayRange = dayHigh - dayLow;
            if (dayRange < 0.01)
                continue;
            const startBin = Math.max(0, Math.floor((dayLow - minPrice) / binSize));
            const endBin = Math.min(BINS - 1, Math.floor((dayHigh - minPrice) / binSize));
            if (startBin === endBin) {
                bins[startBin] += dayVol;
            }
            else {
                const totalSteps = endBin - startBin + 1;
                const volPerBin = dayVol / totalSteps;
                for (let b = startBin; b <= endBin; b++) {
                    bins[b] += volPerBin;
                }
            }
        }
        const totalVol = bins.reduce((a, b) => a + b, 0);
        const peaks = [];
        for (let i = 1; i < BINS - 1; i++) {
            if (bins[i] > bins[i - 1] && bins[i] > bins[i + 1] && bins[i] > totalVol * 0.05) {
                peaks.push(i);
            }
        }
        if (peaks.length === 0) {
            const maxIdx = bins.indexOf(Math.max(...bins));
            peaks.push(maxIdx);
        }
        const sortedBins = [...bins].sort((a, b) => b - a);
        let cumVol = 0;
        let binsNeeded = 0;
        for (const vol of sortedBins) {
            cumVol += vol;
            binsNeeded++;
            if (cumVol >= totalVol * 0.9)
                break;
        }
        const concentration90 = Math.round((binsNeeded / BINS) * 100);
        const mainPeakIdx = peaks[0];
        const peakPrice = minPrice + (mainPeakIdx + 0.5) * binSize;
        const pricePositionPct = (currentPrice - minPrice) / range;
        let peakPosition;
        if (peakPrice < currentPrice * 0.85) {
            peakPosition = 'low';
        }
        else if (peakPrice > currentPrice * 1.15) {
            peakPosition = 'high';
        }
        else {
            peakPosition = 'mid';
        }
        let pattern;
        if (peaks.length >= 3) {
            pattern = 'dispersed';
        }
        else if (peaks.length >= 2) {
            const gap = Math.abs(peaks[0] - peaks[1]) * binSize / range;
            pattern = gap > 0.2 ? 'double_peak' : 'single_peak';
        }
        else {
            pattern = 'single_peak';
        }
        return { concentration90, peakPosition, pattern };
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
                const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
                const buf = await res.arrayBuffer();
                const raw = iconv.decode(Buffer.from(buf), 'gbk');
                const lines = raw.split('\n').filter(l => l.trim());
                for (const line of lines) {
                    const match = line.match(/v_sz\d+="(.+?)";?\s*/);
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
    parseSinaBatch(lines) {
        const result = [];
        for (const line of lines) {
            const match = line.match(/var hq_str_(sh|sz)(\d+)="(.+)";?\s*/);
            if (!match)
                continue;
            const prefix = match[1];
            const codeStr = match[2];
            const rawFields = match[3];
            const fields = rawFields.split(',');
            const code = `${prefix.toUpperCase()}${codeStr}`;
            if (code.startsWith('SH300') || code.startsWith('SZ300') || code.startsWith('SZ301'))
                continue;
            if (code.startsWith('SH688') || code.startsWith('SZ688'))
                continue;
            if (!fields[2] || fields[2] === '0.00')
                continue;
            const name = fields[0]?.trim() || '';
            if (name.includes('ST') || name.includes('*ST') || name.includes('退'))
                continue;
            const yestClose = parseFloat(fields[2]);
            const curPrice = parseFloat(fields[3]);
            const changePct = yestClose > 0 ? ((curPrice - yestClose) / yestClose) * 100 : 0;
            if (changePct < this.MIN_GAIN_PCT)
                continue;
            const volumeShares = parseFloat(fields[8]) || 0;
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
        let tencentFailures = 0;
        for (let b = 0; b < allCodes.length; b += this.TENANT_BATCH) {
            const batch = allCodes.slice(b, b + this.TENANT_BATCH);
            const batchIdx = b / this.TENANT_BATCH + 1;
            let batchSuccess = false;
            try {
                const url = `https://qt.gtimg.cn/q=${batch.join(',')}`;
                const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
                const buf = await res.arrayBuffer();
                const raw = iconv.decode(Buffer.from(buf), 'gbk');
                const lines = raw.split('\n').filter(l => l.trim());
                for (const line of lines) {
                    const match = line.match(/v_(?:sh|sz)\d+="(.+?)";?\s*/);
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
                    const marketCap = parseInt(fields[45]) || 0;
                    const marketCapInYuan = marketCap * 100_000_000;
                    if (marketCapInYuan > 0 && marketCapInYuan > this.MAX_MARKET_CAP)
                        continue;
                    if (marketCapInYuan > 0 && marketCapInYuan < this.MIN_MARKET_CAP)
                        continue;
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
            }
            catch (err) {
                tencentFailures++;
                this.logger.warn(`⚠️ 主板行情批 ${batchIdx} 腾讯失败, 切换新浪: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (!batchSuccess) {
                try {
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
                }
                catch (sinaErr) {
                    this.logger.warn(`⚠️ 主板行情批 ${batchIdx} 新浪也失败: ${sinaErr instanceof Error ? sinaErr.message : String(sinaErr)}`);
                }
            }
            if (batchIdx % 5 === 0) {
                await new Promise(r => setTimeout(r, 200));
            }
        }
        candidates.sort((a, b) => b.changePercent - a.changePercent);
        this.logger.log(`📡 主板: 获取 ${candidates.length} 只上涨 (腾讯失败 ${tencentFailures} 批, 新浪降级)`);
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
        if (this.sectorCache?.data?.length)
            results.push(...this.sectorCache.data);
        return results;
    }
    async computeFullSuggestion(code) {
        try {
            const raw = await this.dataFetcher.getKLineData(code);
            if (!raw?.length || raw.length < 20)
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
        if (this.sectorCache && this.sectorCache.data?.length) {
            return { opportunities: this.sectorCache.data, timestamp: this.sectorCache.timestamp };
        }
        this.logger.log('📦 板块无缓存数据，返回空');
        return { opportunities: [], timestamp: Date.now() };
    }
    async scanTopGem(force = false) {
        if (this.cache && this.cache.data?.length) {
            this.upgradeCacheFields(this.cache.data);
            return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
        }
        this.logger.log('📦 无缓存数据，触发异步扫描...');
        this.triggerRefresh();
        return { opportunities: [], timestamp: Date.now() };
    }
    async scanTopMainBoard(force = false) {
        if (this.mainBoardCache && this.mainBoardCache.data?.length) {
            this.upgradeCacheFields(this.mainBoardCache.data);
            return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
        }
        this.logger.log('📦 主板无缓存数据，触发异步扫描...');
        this.triggerRefresh();
        return { opportunities: [], timestamp: Date.now() };
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
            return pa !== pb ? pa - pb
                : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
                    : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
                        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
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
            return pa !== pb ? pa - pb
                : (b.entryTiming ?? 0) !== (a.entryTiming ?? 0) ? (b.entryTiming ?? 0) - (a.entryTiming ?? 0)
                    : (b.safetyScore ?? 0) !== (a.safetyScore ?? 0) ? (b.safetyScore ?? 0) - (a.safetyScore ?? 0)
                        : (b.mainForceInflow ?? 0) - (a.mainForceInflow ?? 0);
        });
        return results.slice(0, topN);
    }
    static calcEntryTiming(pricePos, trendState, closeArr, macdGoldenCross, volumeArr) {
        let score = 45;
        if (pricePos >= 25 && pricePos <= 55) {
            const periodHigh = Math.max(...closeArr);
            const currentPrice = closeArr[closeArr.length - 1];
            const pulledBack = currentPrice <= periodHigh * 0.88;
            if (pulledBack) {
                const recentCloses = closeArr.slice(-10);
                const mean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
                const variance = recentCloses.reduce((s, v) => s + (v - mean) ** 2, 0) / recentCloses.length;
                const std = Math.sqrt(variance);
                const volatility = std / mean;
                if (volatility < 0.035 && trendState >= 1) {
                    score += 28;
                }
                if (trendState >= 2)
                    score += 12;
                if (macdGoldenCross)
                    score += 10;
                const avgVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
                const avgVol20 = volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
                if (avgVol5 > avgVol20 * 1.1)
                    score += 8;
            }
        }
        if (pricePos >= 72) {
            const currentPrice = closeArr[closeArr.length - 1];
            const periodHigh = Math.max(...closeArr.slice(-60));
            const nearHigh = currentPrice >= periodHigh * 0.97;
            if (trendState >= 2 && (macdGoldenCross || nearHigh)) {
                score += 25;
            }
            if (trendState === 3)
                score += 10;
            if (nearHigh) {
                const prevHigh = Math.max(...closeArr.slice(-60, -1));
                if (currentPrice > prevHigh)
                    score += 15;
            }
            const avgVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const avgVol20 = volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
            if (avgVol5 > avgVol20 * 1.15)
                score += 8;
        }
        if (pricePos > 55 && pricePos < 72 && trendState >= 2 && macdGoldenCross) {
            score += 10;
        }
        return Math.min(Math.max(Math.round(score), 0), 100);
    }
    static calcSafetyScore(closeArr, highArr, lowArr, pricePos, changePercent) {
        let score = 55;
        const returns = [];
        const lookback = Math.min(closeArr.length, 20);
        for (let i = 1; i < lookback; i++) {
            returns.push((closeArr[i] - closeArr[i - 1]) / closeArr[i - 1]);
        }
        const retMean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const retVariance = returns.reduce((s, v) => s + (v - retMean) ** 2, 0) / returns.length;
        const vol = Math.sqrt(retVariance);
        if (vol < 0.025)
            score += 18;
        else if (vol < 0.035)
            score += 10;
        else if (vol < 0.05)
            score += 3;
        else if (vol < 0.07)
            score -= 8;
        else
            score -= 20;
        const absChange = Math.abs(changePercent);
        if (absChange > 15)
            score -= 20;
        else if (absChange > 10)
            score -= 12;
        else if (absChange > 7)
            score -= 5;
        else if (absChange < 3)
            score += 5;
        if (pricePos > 92)
            score -= 10;
        else if (pricePos > 85)
            score -= 5;
        else if (pricePos < 12)
            score -= 8;
        else if (pricePos < 20)
            score -= 3;
        const recentHigh = Math.max(...closeArr.slice(-10));
        const currentPrice = closeArr[closeArr.length - 1];
        const drawdown = (recentHigh - currentPrice) / recentHigh;
        if (drawdown > 0.08)
            score -= 8;
        else if (drawdown > 0.05)
            score -= 3;
        const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
        if (ma5 > ma10 && ma10 > ma20)
            score += 8;
        if (closeArr[closeArr.length - 1] > ma5)
            score += 5;
        return Math.min(Math.max(Math.round(score), 0), 100);
    }
    static calcChipAnalysis(closeArr, highArr, lowArr, volumeArr, currentPrice) {
        const len = closeArr.length;
        if (len < 20)
            return { concentration90: 50, peakPosition: 'mid', pattern: 'dispersed' };
        const N = Math.min(60, len);
        const c = closeArr.slice(-N);
        const h = highArr.slice(-N);
        const l = lowArr.slice(-N);
        const v = volumeArr.slice(-N);
        const minPrice = Math.min(...l);
        const maxPrice = Math.max(...h);
        const range = maxPrice - minPrice;
        if (range < 0.01)
            return { concentration90: 95, peakPosition: 'mid', pattern: 'single_peak' };
        const BINS = 20;
        const binSize = range / BINS;
        const bins = new Array(BINS).fill(0);
        for (let i = 0; i < N; i++) {
            const dayLow = l[i];
            const dayHigh = h[i];
            const dayVol = v[i];
            const dayRange = dayHigh - dayLow;
            if (dayRange < 0.01)
                continue;
            const startBin = Math.max(0, Math.floor((dayLow - minPrice) / binSize));
            const endBin = Math.min(BINS - 1, Math.floor((dayHigh - minPrice) / binSize));
            if (startBin === endBin) {
                bins[startBin] += dayVol;
            }
            else {
                const totalSteps = endBin - startBin + 1;
                const volPerBin = dayVol / totalSteps;
                for (let b = startBin; b <= endBin; b++) {
                    bins[b] += volPerBin;
                }
            }
        }
        const totalVol = bins.reduce((a, b) => a + b, 0);
        const peaks = [];
        for (let i = 1; i < BINS - 1; i++) {
            if (bins[i] > bins[i - 1] && bins[i] > bins[i + 1] && bins[i] > totalVol * 0.05) {
                peaks.push(i);
            }
        }
        if (peaks.length === 0) {
            const maxIdx = bins.indexOf(Math.max(...bins));
            peaks.push(maxIdx);
        }
        const sortedBins = [...bins].sort((a, b) => b - a);
        let cumVol = 0;
        let binsNeeded = 0;
        for (const vol of sortedBins) {
            cumVol += vol;
            binsNeeded++;
            if (cumVol >= totalVol * 0.9)
                break;
        }
        const concentration90 = Math.round((binsNeeded / BINS) * 100);
        const mainPeakIdx = peaks[0];
        const peakPrice = minPrice + (mainPeakIdx + 0.5) * binSize;
        let peakPosition;
        if (peakPrice < currentPrice * 0.85) {
            peakPosition = 'low';
        }
        else if (peakPrice > currentPrice * 1.15) {
            peakPosition = 'high';
        }
        else {
            peakPosition = 'mid';
        }
        let pattern;
        if (peaks.length >= 3) {
            pattern = 'dispersed';
        }
        else if (peaks.length >= 2) {
            const gap = Math.abs(peaks[0] - peaks[1]) * binSize / range;
            pattern = gap > 0.2 ? 'double_peak' : 'single_peak';
        }
        else {
            pattern = 'single_peak';
        }
        return { concentration90, peakPosition, pattern };
    }
    async quickAnalyze(code, name, keepAll, rawKline, frontendMainForce) {
        const raw = rawKline || await this.dataFetcher.getKLineData(code);
        if (!raw?.length || raw.length < 20)
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
        if (!keepAll && NEGATIVE.includes(suggestion))
            return null;
        const NEGATIVE_PREDICTION_KEYWORDS = ['偏弱', '探底', '风险较大', '风险大', '注意风险'];
        if (!keepAll && NEGATIVE_PREDICTION_KEYWORDS.some(kw => predictionText.includes(kw)))
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
        if (!keepAll && NEGATIVE_CROSS.includes(crossSuggestion))
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
        const chip = GemScreenerService_1.calcChipAnalysis(closeArr, highArr, lowArr, volumeArr, price);
        const chipConcentration90 = chip.concentration90;
        const chipPeakPosition = chip.peakPosition;
        const chipPattern = chip.pattern;
        let finalSuggestion = suggestion;
        const chipDowngrade = chipPattern === 'dispersed' && chipPeakPosition === 'high' && pricePos < 30;
        const chipRisk = chipConcentration90 > 40 && chipPeakPosition === 'high' && pricePos < 25;
        if (chipDowngrade || chipRisk) {
            if (finalSuggestion === '重仓买入')
                finalSuggestion = '买入';
            else if (finalSuggestion === '买入')
                finalSuggestion = '轻仓买入';
            else if (finalSuggestion === '轻仓买入')
                finalSuggestion = '不要介入';
        }
        if (chipPattern === 'single_peak' && chipPeakPosition === 'low' && pricePos > 15 && pricePos < 45 && trendState >= 1) {
            if (finalSuggestion === '买入')
                finalSuggestion = '重仓买入';
            else if (finalSuggestion === '轻仓买入')
                finalSuggestion = '买入';
        }
        const entryTiming = GemScreenerService_1.calcEntryTiming(pricePos, trendState, closeArr, isGoldenCross, volumeArr);
        const safetyScore = GemScreenerService_1.calcSafetyScore(closeArr, highArr, lowArr, pricePos, changePct);
        const avgVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const avgVol20 = volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const volRatio = avgVol5 / (avgVol20 || 1);
        const inflowBase = (volRatio - 1) * price * avgVol5 / 10000000;
        const mainForceInflow = frontendMainForce !== undefined ? frontendMainForce : Math.round(Math.max(Math.min(inflowBase, 20), -10) * 10) / 10;
        return {
            code, name: name ?? '',
            currentPrice: price,
            changePercent: Math.round(changePct * 100) / 100,
            priceIncrease: Math.round(priceIncrease * 100) / 100,
            mainForceInflow,
            pricePosition: Math.round(pricePos),
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
            jiGouActiveScore: Math.round(Math.min((volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5 / (volumeArr.slice(-60).reduce((a, b) => a + b, 0) / 60 || 1)) * 6, 20) * 100) / 100,
        };
    }
    async searchStocks(keyword) {
        const results = [];
        try {
            const stocks = await this.dataFetcher.searchStock(keyword);
            if (!stocks || stocks.length === 0)
                return results;
            const maxResults = Math.min(stocks.length, 5);
            for (let i = 0; i < maxResults; i++) {
                const s = stocks[i];
                try {
                    const opp = await Promise.race([
                        this.quickAnalyze(s.code, s.name),
                        new Promise(r => setTimeout(() => r('TIMEOUT'), 28000))
                    ]);
                    if (opp && opp !== 'TIMEOUT' && opp.suggestion) {
                        opp.name = s.name;
                        results.push(opp);
                    }
                    else {
                        this.logger.warn(`⌛ 搜索 ${s.code}(${s.name}) 无完整分析结果 (${opp === 'TIMEOUT' ? '超时28s' : 'null'})，返回基础信息`);
                        results.push({
                            code: s.code,
                            name: s.name,
                            price: 0,
                            suggestion: '持有',
                            score: 0,
                            pricePosition: 50,
                            changePercent: 0,
                            entryTiming: 0,
                            capitalRank: 0,
                            mainForceInflow: 0,
                            baiXiaoDays: 0,
                            currentPrice: 0,
                            jiGouActiveScore: 0,
                            isGoldenCross: false,
                            priceIncrease: 0,
                            safetyScore: 50,
                        });
                    }
                }
                catch (e) {
                    this.logger.warn(`搜索分析 ${s.code}(${s.name}) 失败: ${e.message}`);
                }
            }
        }
        catch (e) {
            this.logger.error(`搜索失败: ${e.message}`);
        }
        return results;
    }
    async rescanMarket() {
        const now = Date.now();
        this.logger.log('开始按新标准重新评估缓存的个股...');
        try {
            const allCached = [];
            if (this.cache?.data)
                allCached.push(...this.cache.data);
            if (this.mainBoardCache?.data)
                allCached.push(...this.mainBoardCache.data);
            const seenCodes = new Set();
            const uniqueStocks = [];
            for (const s of allCached) {
                if (s.code && !seenCodes.has(s.code)) {
                    seenCodes.add(s.code);
                    uniqueStocks.push(s);
                }
            }
            this.logger.log(`收集到 ${uniqueStocks.length} 只缓存的个股，应用新标准重新评估`);
            const updated = [];
            for (const s of uniqueStocks) {
                try {
                    const pp = s.pricePosition ?? 50;
                    const goldenCross = s.isGoldenCross ?? false;
                    const jiGou = s.jiGouActiveScore ?? 0;
                    const chipConc = s.chipConcentration90 ?? 50;
                    const chipPeak = s.chipPeakPosition ?? 'mid';
                    const chipPat = s.chipPattern ?? 'dispersed';
                    let trendState = 1;
                    if (pp > 55 && goldenCross)
                        trendState = 3;
                    else if (pp > 40)
                        trendState = 2;
                    else if (pp < 25)
                        trendState = 0;
                    let newSuggestion = s.suggestion || '观望';
                    const isBaiXiaoActive = (s.baiXiaoDays ?? 0) > 0 || (s.buySignal?.includes('信号'));
                    const baiXiaoDays = s.baiXiaoDays ?? 0;
                    if (trendState >= 2 && goldenCross && isBaiXiaoActive && jiGou >= 10 && pp >= 15 && pp <= 45) {
                        if (jiGou >= 14 && pp >= 20)
                            newSuggestion = '重仓买入';
                        else if (jiGou >= 10 || baiXiaoDays >= 4)
                            newSuggestion = '买入';
                        else
                            newSuggestion = '轻仓买入';
                    }
                    else if (trendState >= 1 && goldenCross && pp > 10 && pp < 50) {
                        if (baiXiaoDays >= 6)
                            newSuggestion = '买入';
                        else if (pp >= 25)
                            newSuggestion = '轻仓买入';
                        else
                            newSuggestion = '持有';
                    }
                    else if (trendState >= 1 && pp > 15) {
                        newSuggestion = '持有';
                    }
                    else {
                        newSuggestion = '观望';
                    }
                    const chipDowngrade = chipPat === 'dispersed' && chipPeak === 'high' && pp < 30;
                    const chipRisk = chipConc > 40 && chipPeak === 'high' && pp < 25;
                    if (chipDowngrade || chipRisk) {
                        if (newSuggestion === '重仓买入')
                            newSuggestion = '买入';
                        else if (newSuggestion === '买入')
                            newSuggestion = '轻仓买入';
                        else if (newSuggestion === '轻仓买入')
                            newSuggestion = '观望';
                    }
                    if (chipPat === 'single_peak' && chipPeak === 'low' && pp > 15 && pp < 45 && trendState >= 1) {
                        if (newSuggestion === '买入')
                            newSuggestion = '重仓买入';
                        else if (newSuggestion === '轻仓买入')
                            newSuggestion = '买入';
                    }
                    const oldSug = s.suggestion;
                    const PRIORITY = ['重仓买入', '买入', '轻仓买入', '持有', '观望', '不要介入'];
                    const oldIdx = PRIORITY.indexOf(oldSug || '');
                    const newIdx = PRIORITY.indexOf(newSuggestion);
                    if (oldIdx >= 0 && newIdx >= 0) {
                        if (oldIdx === 0 && newIdx > 1) {
                            newSuggestion = '重仓买入';
                        }
                        else if (oldIdx === 1 && newIdx > 2) {
                            newSuggestion = '买入';
                        }
                        else if (oldIdx === 2 && newIdx > 3) {
                            newSuggestion = '持有';
                        }
                    }
                    const entry = s.entryTiming ?? 50;
                    const sugIdx2 = PRIORITY.indexOf(newSuggestion);
                    if (sugIdx2 >= 0 && entry >= 65 && sugIdx2 > 1) {
                        newSuggestion = sugIdx2 <= 2 ? PRIORITY[sugIdx2 - 1] : '轻仓买入';
                    }
                    else if (sugIdx2 >= 0 && entry < 35 && sugIdx2 <= 1) {
                        newSuggestion = PRIORITY[sugIdx2 + 1];
                    }
                    const BASE = {
                        '重仓买入': 100, '买入': 80, '轻仓买入': 65, '持有': 40, '观望': 25,
                    };
                    let newScore = BASE[newSuggestion] ?? 30;
                    if (pp < 30)
                        newScore += 15;
                    else if (pp < 50)
                        newScore += 8;
                    if (goldenCross)
                        newScore += 10;
                    if (jiGou >= 12)
                        newScore += 8;
                    if (chipConc <= 25)
                        newScore += 10;
                    updated.push({
                        ...s,
                        suggestion: newSuggestion,
                        score: newScore,
                        chipConcentration90: s.chipConcentration90 ?? 50,
                        chipPeakPosition: s.chipPeakPosition ?? 'mid',
                        chipPattern: s.chipPattern ?? 'dispersed',
                        jiGouActiveScore: s.jiGouActiveScore ?? Math.round(((s.entryTiming || 0) / 100 * 20) * 100) / 100,
                    });
                }
                catch (e) {
                    updated.push(s);
                }
            }
            const PRIORITY = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '观望': 4 };
            updated.sort((a, b) => {
                const pa = PRIORITY[a.suggestion || '观望'] ?? 9;
                const pb = PRIORITY[b.suggestion || '观望'] ?? 9;
                if (pa !== pb)
                    return pa - pb;
                return (b.score || 0) - (a.score || 0);
            });
            const top20 = updated.slice(0, 20);
            this.cache = { data: top20, timestamp: now };
            try {
                require('fs').writeFileSync(this.CACHE_FILE, JSON.stringify(this.cache), 'utf-8');
            }
            catch { }
            this.logger.log(`重新评估完成：${top20.length} 只, 信号: ${top20.map(s => s.suggestion).join(',')}`);
        }
        catch (e) {
            this.logger.error(`重新评估失败: ${e.message}`);
        }
        return (this.cache?.data || []).slice(0, 20);
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
    async scanGlobalHeavyBuy() {
        this.logger.log('🔍 [全局重仓买入] 开始扫描...');
        try {
            const allCodes = [];
            const codeToSectorName = new Map();
            for (const sector of ALL_SECTORS) {
                for (const code of sector.codes) {
                    if (!allCodes.includes(code)) {
                        allCodes.push(code);
                        codeToSectorName.set(code, sector.name);
                    }
                }
            }
            const cachedCodes = [
                ...(this.cache?.data?.map(s => s.code.replace(/^(sh|sz)/, '')) ?? []),
                ...(this.mainBoardCache?.data?.map(s => s.code.replace(/^(sh|sz)/, '')) ?? []),
                ...(this.sectorCache?.data?.map(s => s.code.replace(/^(sh|sz)/, '')) ?? []),
            ];
            for (const c of cachedCodes) {
                if (c && !allCodes.includes(c))
                    allCodes.push(c);
            }
            this.logger.log(`🔍 共收集 ${allCodes.length} 只候选股票`);
            const heavyBuyResults = [];
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
                            if (/^(\*)?ST/.test(name) || /银行|保险/.test(name))
                                continue;
                            if (changePct < 0 || price < 2)
                                continue;
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
                            }
                            catch (klineErr) {
                            }
                        }
                        catch (parseErr) {
                        }
                    }
                }
                catch (batchErr) {
                    this.logger.warn(`  ⚠️ 批次 ${i}-${i + BATCH} 获取失败: ${batchErr.message}`);
                }
            }
            heavyBuyResults.sort((a, b) => (b.score || 0) - (a.score || 0));
            this.logger.log(`✅ [全局重仓买入] 完成, 发现 ${heavyBuyResults.length} 只`);
            return heavyBuyResults.slice(0, 3);
        }
        catch (error) {
            this.logger.error(`❌ [全局重仓买入] 异常: ${error.message}`);
            return [];
        }
    }
    async getIndustrySectorTop10() {
        const allCodes = [];
        const codeToSector = new Map();
        for (const sec of ALL_SECTORS) {
            for (const code of sec.codes) {
                codeToSector.set(code, sec.name);
                if (!allCodes.includes(code))
                    allCodes.push(code);
            }
        }
        this.logger.log(`📊 获取行业板块实时热度: ${ALL_SECTORS.length}个板块(含概念), ${allCodes.length}只成分股`);
        const quoteMap = new Map();
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
                    if (!cm || !cm[2])
                        continue;
                    const parts = cm[2].split('~');
                    const code = cm[1].replace(/^(sh|sz)/, '');
                    const name = parts[1] || '';
                    if (!code || !name || /^\d+$/.test(name))
                        continue;
                    const price = parseFloat(parts[3]) || 0;
                    const changePercent = parseFloat(parts[32]) || 0;
                    quoteMap.set(code, { name, price, changePercent });
                }
            }
            catch (e) {
                this.logger.warn(`腾讯行情批次失败: ${e.message}`);
            }
        }
        this.logger.log(`📊 获取到 ${quoteMap.size}/${allCodes.length} 只行情数据`);
        const sectorMap = new Map();
        for (const sec of ALL_SECTORS) {
            let totalChange = 0;
            let count = 0;
            let upCount = 0;
            const stocks = [];
            for (const code of sec.codes) {
                const q = quoteMap.get(code);
                if (q && q.price > 0) {
                    totalChange += q.changePercent;
                    count++;
                    if (q.changePercent > 0)
                        upCount++;
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
    async scanAllWithFrontendData(stocks) {
        const results = [];
        for (const s of stocks) {
            if (s.klines && s.klines.length >= 20) {
                this.dataFetcher.preloadKline(s.code, s.klines);
            }
        }
        for (const s of stocks) {
            try {
                const candidate = {
                    code: s.code, name: s.name, inflow: s.inflow,
                    changePercent: s.changePercent, currentPrice: s.price,
                };
                const result = await this.checkOpportunity(candidate);
                if (result)
                    results.push(result);
            }
            catch { }
        }
        if (results.length <= 3) {
            for (const s of stocks) {
                try {
                    const candidate = {
                        code: s.code, name: s.name, inflow: s.inflow,
                        changePercent: s.changePercent, currentPrice: s.price,
                    };
                    const result = await this.checkOpportunityRelaxed(candidate);
                    if (result && !results.find((ex) => ex.code === result.code))
                        results.push(result);
                }
                catch { }
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
        const finalResults = results.slice(0, 20);
        this.cache = { data: finalResults, timestamp: Date.now() };
        this.saveCacheToDisk();
        this.logger.log('\u2705 \u5168\u5e02\u573a\u626b\u63cf\u5b8c\u6210, Top' + finalResults.length + ' \u53ea');
        return finalResults;
    }
};
exports.GemScreenerService = GemScreenerService;
exports.GemScreenerService = GemScreenerService = GemScreenerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [data_fetcher_service_1.DataFetcherService,
        stock_service_1.StockService])
], GemScreenerService);
