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
const technical_analysis_1 = require("../../utils/technical-analysis");
const pinyin_pro_1 = require("pinyin-pro");
const data_1 = require("../../industry-sectors/data");
const postgres = require('postgres');
const ALL_SECTORS = [...data_1.default, ...data_1.CONCEPT_SECTORS];
const MARKET_OPEN_TTL = 5 * 60 * 1000;
const FROZEN_TTL = 365 * 24 * 60 * 60 * 1000;
function getOpportunityTTL() {
    return (0, market_time_1.isMarketOpen)() ? MARKET_OPEN_TTL : FROZEN_TTL;
}
let GemScreenerService = GemScreenerService_1 = class GemScreenerService {
    updateCache(type, data) {
        if (type === 'scan') {
            this.scanCache = data;
        }
    }
    getCache(type) {
        return type === 'scan' ? (this.scanCache || []) : [];
    }
    get pgSql() {
        if (this._pgSql)
            return this._pgSql;
        const url = process.env.DATABASE_URL;
        if (!url)
            return null;
        try {
            this._pgSql = postgres(url, { max: 2, idle_timeout: 10, connect_timeout: 5 });
            this.logger.log('🗄️  PostgreSQL 连接已建立（缓存可跨重启持久化）');
        }
        catch (e) {
            this.logger.warn(`⚠️ PostgreSQL 连接失败，缓存仅在内存/磁盘: ${e.message}`);
            this._pgSql = null;
        }
        return this._pgSql;
    }
    async ensurePgTable() {
        try {
            const sql = this.pgSql;
            if (!sql)
                return false;
            await sql `CREATE TABLE IF NOT EXISTS stock_scan_cache (
        cache_key VARCHAR(100) PRIMARY KEY,
        cache_value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`;
            return true;
        }
        catch {
            return false;
        }
    }
    async saveCacheToPg(key, data) {
        try {
            const sql = this.pgSql;
            if (!sql)
                return;
            const json = JSON.stringify(data);
            await sql `
        INSERT INTO stock_scan_cache (cache_key, cache_value)
        VALUES (${key}, ${json}::jsonb)
        ON CONFLICT (cache_key)
        DO UPDATE SET cache_value = EXCLUDED.cache_value, updated_at = NOW()
      `;
        }
        catch (e) {
            this.logger.warn(`⚠️ PostgreSQL 写入失败(cache_key=${key}): ${e.message}`);
        }
    }
    async loadCacheFromPg(key) {
        try {
            const sql = this.pgSql;
            if (!sql)
                return null;
            const rows = await sql `SELECT cache_value FROM stock_scan_cache WHERE cache_key = ${key}`;
            if (rows && rows.length > 0) {
                const raw = rows[0].cache_value;
                if (typeof raw === 'string')
                    return JSON.parse(raw);
                return raw;
            }
        }
        catch (e) {
            this.logger.warn(`⚠️ PostgreSQL 读取失败(cache_key=${key}): ${e.message}`);
        }
        return null;
    }
    constructor(dataFetcher, stockService) {
        this.dataFetcher = dataFetcher;
        this.stockService = stockService;
        this.logger = new common_1.Logger(GemScreenerService_1.name);
        this.CACHE_TTL = 3 * 60 * 1000;
        this.STALE_TTL = 30 * 60 * 1000;
        this.REFRESH_INTERVAL = 5 * 60 * 1000;
        this.CACHE_FILE = '/tmp/gem-opportunities-cache.json';
        this.SELL_STATE_FILE = '/tmp/sell-state-cache.json';
        this.BUNDLED_GEM_CACHE = (0, node_path_1.join)(__dirname, '..', '..', '..', 'assets', 'gem-cache.json');
        this.BATCH_SIZE = 20;
        this.POSITION_THRESHOLD = 92;
        this.RELAXED_POSITION = 90;
        this.TENANT_BATCH = 500;
        this.MIN_GAIN_PCT = 0.3;
        this.MAX_MARKET_CAP = 500_0000_0000;
        this.MIN_MARKET_CAP = 20_0000_0000;
        this.SUGGESTION_PRIORITY = {
            '重仓买入': 1, '买入': 2, '轻仓买入': 3,
            '持有': 4, '减仓': 5, '卖出': 6, '不要介入': 7,
        };
        this.cache = null;
        this.refreshPromise = null;
        this.mainBoardCache = null;
        this.sellStateCache = new Map();
        this.scanCache = null;
        this.soldOutStocks = new Set();
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
        this._pgSql = null;
        this.updateMarketHoursBeganAt();
        this.loadCacheFromDisk();
        this.loadMainBoardCacheFromDisk();
        this.loadSectorCacheFromDisk();
        this.loadSellStateCache();
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
                const limitedData = parsed.data;
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
                    const limitedData = parsed.data;
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
                const limitedData = parsed.data;
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
                    const limitedData = parsed.data;
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
                const limitedData = parsed.data;
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
                    const limitedData = parsed.data;
                    this.sectorCache = { ...parsed, data: limitedData };
                    this.logger.log(`📦 从部署包恢复板块缓存, ${limitedData.length} 只, 缓存时间 ${new Date(parsed.timestamp).toLocaleString('zh-CN')}`);
                }
            }
        }
        catch (err) {
            this.logger.warn(`⚠️ 板块部署包缓存加载失败: ${err.message}`);
        }
    }
    async clearCache() {
        this.cache = { data: [], timestamp: 0 };
        this.mainBoardCache = { data: [], timestamp: 0 };
        const files = [this.CACHE_FILE, this.MAIN_BOARD_CACHE];
        for (const p of files) {
            try {
                if ((0, fs_1.existsSync)(p))
                    (0, fs_1.unlinkSync)(p);
            }
            catch { }
        }
        this.logger.log('🧹 缓存已清空');
    }
    async saveCacheToDisk() {
        try {
            await fs_1.promises.writeFile(this.CACHE_FILE, JSON.stringify(this.cache), 'utf-8');
        }
        catch (err) {
            this.logger.warn(`⚠️ GEM缓存写入失败: ${err.message}`);
        }
        if (this.cache?.data?.length) {
            await this.saveCacheToPg('gem', this.cache);
        }
    }
    async saveMainBoardCacheToDisk() {
        try {
            await fs_1.promises.writeFile(this.MAIN_BOARD_CACHE, JSON.stringify(this.mainBoardCache), 'utf-8');
        }
        catch (err) {
            this.logger.warn(`⚠️ 主板缓存写入失败: ${err.message}`);
        }
        if (this.mainBoardCache?.data?.length) {
            await this.saveCacheToPg('main_board', this.mainBoardCache);
        }
    }
    loadSellStateCache() {
        try {
            if ((0, fs_1.existsSync)(this.SELL_STATE_FILE)) {
                const raw = (0, fs_1.readFileSync)(this.SELL_STATE_FILE, 'utf-8');
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    for (const item of arr) {
                        this.sellStateCache.set(item.code, { suggestion: item.suggestion, timestamp: item.timestamp });
                    }
                }
                for (const [code, val] of this.sellStateCache.entries()) {
                    if (val.suggestion === '减仓') {
                        this.sellStateCache.delete(code);
                    }
                }
                this.logger.log(`📂 加载卖出锁定: ${this.sellStateCache.size} 只`);
            }
        }
        catch (err) {
            this.logger.warn(`⚠️ 卖出锁定文件读取失败: ${err.message}`);
        }
    }
    async saveSellStateCache() {
        try {
            const arr = Array.from(this.sellStateCache.entries()).map(([code, val]) => ({
                code, suggestion: val.suggestion, timestamp: val.timestamp
            }));
            await fs_1.promises.writeFile(this.SELL_STATE_FILE, JSON.stringify(arr), 'utf-8');
        }
        catch (err) {
            this.logger.warn(`⚠️ 卖出锁定写入失败: ${err.message}`);
        }
    }
    syncSellStateFromFrontend(sellStates) {
        const now = Date.now();
        for (const item of sellStates) {
            if (['卖出'].includes(item.suggestion)) {
                this.sellStateCache.set(item.code, { suggestion: item.suggestion, timestamp: now });
            }
        }
        this.saveSellStateCache();
        this.logger.log(`📝 前端同步卖出锁定: ${sellStates.length} 条`);
    }
    async getOpportunities() {
        const allData = [];
        let latestTs = 0;
        if (this.cache && this.cache.data?.length > 0) {
            allData.push(...this.cache.data);
            if (this.cache.timestamp > latestTs)
                latestTs = this.cache.timestamp;
        }
        if (this.mainBoardCache && this.mainBoardCache.data?.length > 0) {
            const gemCodes = new Set();
            for (const s of this.cache?.data || [])
                gemCodes.add(s.code);
            for (const s of this.mainBoardCache.data) {
                if (!gemCodes.has(s.code))
                    allData.push(s);
            }
            if (this.mainBoardCache.timestamp > latestTs)
                latestTs = this.mainBoardCache.timestamp;
        }
        if (allData.length > 0) {
            this.upgradeCacheFields(allData);
            this.addForecastToCache(allData);
            this.recalculateSuggestions(allData);
            const now = Date.now();
            for (const s of allData) {
                const sellEntry = this.sellStateCache.get(s.code);
                if (sellEntry) {
                    const hasBuySignal = ['重仓买入', '买入'].includes(s.suggestion || '') &&
                        s.isGoldenCross === true &&
                        (s.entryTiming ?? 0) >= 50;
                    if (hasBuySignal) {
                        this.sellStateCache.delete(s.code);
                        this.logger.log(`🔓 ${s.name}(${s.code}) 出现买入信号，自动解除卖出锁定`);
                    }
                    else {
                        s.suggestion = '不要介入';
                        s.trendPrediction = { direction: '方向不明', score: 30, reason: '卖出锁定中', details: {} };
                        continue;
                    }
                }
                s.trendPrediction = this.calcSimpleTrendPrediction(s);
            }
            this.saveSellStateCache();
            return { opportunities: allData, timestamp: latestTs };
        }
        return { opportunities: [], timestamp: Date.now() };
    }
    addForecastToCache(data) {
        if (!data || data.length === 0)
            return;
        for (const s of data) {
            s.forecast1_2Day = GemScreenerService_1.computeTechnicalForecast({
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
    recalculateSuggestions(data) {
        for (const s of data) {
            if (['重仓买入', '买入', '轻仓买入'].includes(s.suggestion || ''))
                continue;
            if (['卖出', '不要介入'].includes(s.suggestion || ''))
                continue;
            if (s.changePercent <= -5) {
                s.suggestion = '卖出';
                s.score = Math.min(s.score, 35);
                continue;
            }
            if (s.changePercent <= -3 && !s.isGoldenCross) {
                s.suggestion = '减仓';
                s.score = Math.min(s.score, 45);
                continue;
            }
            if ((s.ma5 ?? 0) < (s.ma10 ?? 0) && (s.changePercent ?? 0) <= 0) {
                s.suggestion = '不要介入';
                s.score = Math.min(s.score, 30);
                continue;
            }
            s.suggestion = '持有';
        }
    }
    async recalcCacheSignals() {
        let total = 0;
        const allData = [];
        if (this.cache?.data) {
            allData.push(...this.cache.data);
            total += this.cache.data.length;
        }
        if (this.mainBoardCache?.data) {
            allData.push(...this.mainBoardCache.data);
            total += this.mainBoardCache.data.length;
        }
        this.recalculateSuggestions(allData);
        if (this.cache?.data)
            await this.saveCacheToDisk();
        if (this.mainBoardCache?.data)
            await this.saveMainBoardCacheToDisk();
        this.logger.log(`✅ 缓存信号重算完成: ${total}只`);
        return { total, updated: total };
    }
    getCacheAll() {
        const all = [];
        if (this.cache?.data)
            all.push(...this.cache.data);
        if (this.mainBoardCache?.data)
            all.push(...this.mainBoardCache.data);
        const seen = new Set();
        return all.filter(s => {
            if (seen.has(s.code))
                return false;
            seen.add(s.code);
            if (/^68[89]/.test(s.code))
                return false;
            return true;
        });
    }
    updateUpgradedCache(list) {
        if (!list?.length)
            return;
        const map = new Map();
        for (const s of list)
            if (s?.code)
                map.set(s.code, s);
        if (this.mainBoardCache?.data?.length) {
            let changed = false;
            for (let i = 0; i < this.mainBoardCache.data.length; i++) {
                const item = this.mainBoardCache.data[i];
                const upgraded = map.get(item.code);
                if (upgraded && upgraded.suggestion && upgraded.suggestion !== item.suggestion) {
                    item.suggestion = upgraded.suggestion;
                    if (upgraded.score !== undefined)
                        item.score = upgraded.score;
                    if (upgraded.entryTiming !== undefined)
                        item.entryTiming = upgraded.entryTiming;
                    changed = true;
                }
            }
            if (changed)
                this.saveMainBoardCacheToDisk().catch(() => { });
        }
        if (this.cache?.data?.length) {
            let changed = false;
            for (let i = 0; i < this.cache.data.length; i++) {
                const item = this.cache.data[i];
                const upgraded = map.get(item.code);
                if (upgraded && upgraded.suggestion && upgraded.suggestion !== item.suggestion) {
                    item.suggestion = upgraded.suggestion;
                    if (upgraded.score !== undefined)
                        item.score = upgraded.score;
                    if (upgraded.entryTiming !== undefined)
                        item.entryTiming = upgraded.entryTiming;
                    changed = true;
                }
            }
            if (changed)
                this.saveCacheToDisk().catch(() => { });
        }
        this.logger.log(`前端升级信号已回写: ${list.length}只`);
    }
    async updateSingleStockInCache(opp) {
        const code = opp.code;
        const isMainBoardStock = /^60/.test(code) || /^00/.test(code);
        const isGEMStock = /^30/.test(code);
        if (!this.cache) {
            this.cache = { data: [], timestamp: Date.now() };
        }
        {
            const idx = this.cache.data.findIndex(s => s.code === code);
            if (idx >= 0) {
                this.cache.data[idx] = { ...this.cache.data[idx], ...opp };
                await this.saveCacheToDisk();
                this.logger.log(`📝 缓存已更新(GEM): ${opp.code} ${opp.name} 信号=${opp.suggestion} 评分=${opp.score}`);
                return;
            }
            if (isGEMStock) {
                this.cache.data.push(opp);
                await this.saveCacheToDisk();
                this.logger.log(`🆕 新加入GEM缓存: ${opp.code} ${opp.name} 信号=${opp.suggestion}`);
                return;
            }
        }
        if (!this.mainBoardCache) {
            this.mainBoardCache = { data: [], timestamp: Date.now() };
        }
        {
            const idx = this.mainBoardCache.data.findIndex(s => s.code === code);
            if (idx >= 0) {
                this.mainBoardCache.data[idx] = { ...this.mainBoardCache.data[idx], ...opp };
                await this.saveMainBoardCacheToDisk();
                this.logger.log(`📝 缓存已更新(主板): ${opp.code} ${opp.name} 信号=${opp.suggestion} 评分=${opp.score}`);
                return;
            }
            if (isMainBoardStock) {
                this.mainBoardCache.data.push(opp);
                await this.saveMainBoardCacheToDisk();
                this.logger.log(`🆕 新加入主板缓存: ${opp.code} ${opp.name} 信号=${opp.suggestion}`);
                return;
            }
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
        await this.loadSellStateCache();
        await this.ensurePgTable();
        const pgGem = await this.loadCacheFromPg('gem');
        if (pgGem && pgGem.data && pgGem.data.length > 0) {
            if (!this.cache || this.cache.data.length === 0) {
                this.cache = pgGem;
                this.logger.log(`✅ PostgreSQL 创业板缓存恢复: ${pgGem.data.length} 只`);
            }
            try {
                await fs_1.promises.writeFile(this.CACHE_FILE, JSON.stringify(pgGem), 'utf-8');
            }
            catch { }
        }
        const pgMain = await this.loadCacheFromPg('main_board');
        if (pgMain && pgMain.data && pgMain.data.length > 0) {
            if (!this.mainBoardCache || this.mainBoardCache.data.length === 0) {
                this.mainBoardCache = pgMain;
                this.logger.log(`✅ PostgreSQL 主板缓存恢复: ${pgMain.data.length} 只`);
            }
            try {
                await fs_1.promises.writeFile(this.MAIN_BOARD_CACHE, JSON.stringify(pgMain), 'utf-8');
            }
            catch { }
        }
        this.logger.log(`🚀 缓存就绪: 创业板 ${this.cache?.data?.length ?? 0} 只, 主板 ${this.mainBoardCache?.data?.length ?? 0} 只`);
    }
    calcKDJ(kline) {
        const high = kline.map(k => k.high);
        const low = kline.map(k => k.low);
        const close = kline.map(k => k.close);
        const len = close.length;
        if (len < 15)
            return { k: 50, d: 50, j: 50, trend: 'flat', prevJ: 50, jUp: false };
        const rsvArr = [];
        for (let i = 8; i < len; i++) {
            const h9 = Math.max(...high.slice(i - 8, i + 1));
            const l9 = Math.min(...low.slice(i - 8, i + 1));
            const rsv = h9 > l9 ? ((close[i] - l9) / (h9 - l9)) * 100 : 50;
            rsvArr.push(rsv);
        }
        const kArr = [50];
        const dArr = [50];
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
        let trend = 'flat';
        if (jUp && k > d)
            trend = 'up';
        else if (!jUp && k < d)
            trend = 'down';
        return { k, d, j, trend, prevJ, jUp };
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
    calcSimpleTrendPrediction(s) {
        const direction = s.trendPrediction?.direction || '方向不明';
        const score = s.trendPrediction?.score || 50;
        const reason = s.trendPrediction?.reason || '缓存数据推断';
        return { direction, score, reason, details: {} };
    }
    calcTrendPrediction(kline, result) {
        try {
            if (!kline || kline.length < 30) {
                return { direction: '方向不明', score: 0, reason: 'K线数据不足(需≥30天)', signals: [] };
            }
            const closes = kline.slice(-120).map((k) => Number(k.close));
            const highs = kline.slice(-120).map((k) => Number(k.high));
            const lows = kline.slice(-120).map((k) => Number(k.low));
            const volumes = kline.slice(-120).map((k) => Number(k.volume) || 0);
            const price = closes[closes.length - 1];
            const signals = [];
            let totalScore = 0;
            const last20 = closes.slice(-20);
            const min20 = Math.min(...last20);
            const max20 = Math.max(...last20);
            const pos20 = ((price - min20) / (max20 - min20)) * 100;
            if (pos20 < 20) {
                totalScore += 18;
                signals.push('超卖区间(20日低位)');
            }
            else if (pos20 < 35) {
                totalScore += 14;
                signals.push('偏低位');
            }
            else if (pos20 > 80) {
                totalScore += 2;
                signals.push('超买区间(20日高位)');
            }
            else if (pos20 > 65) {
                totalScore += 6;
                signals.push('偏高位置');
            }
            else {
                totalScore += 10;
                signals.push('中位震荡');
            }
            const ema12 = closes.reduce((a, c, i) => i === 0 ? c : a * 11 / 13 + c * 2 / 13, 0);
            const ema26 = closes.reduce((a, c, i) => i === 0 ? c : a * 25 / 27 + c * 2 / 27, 0);
            const dif = ema12 - ema26;
            const macdBar = closes.slice(-12).map((_, i, arr) => {
                if (i < 11)
                    return 0;
                const e12 = arr.slice(i - 11, i + 1).reduce((a, c) => a * 11 / 13 + c * 2 / 13, 0);
                const e26 = arr.slice(i - 25, i + 1).reduce((a, c) => a * 25 / 27 + c * 2 / 27, 0);
                return e12 - e26;
            });
            const lastBars = macdBar.slice(-5);
            const barRising = lastBars.length >= 2 && lastBars[lastBars.length - 1] > lastBars[0];
            const recentLows = closes.slice(-10);
            const recentMacdBars = macdBar.slice(-10);
            const priceLow = Math.min(...recentLows);
            const priceLowIdx = recentLows.indexOf(priceLow);
            const macdLowAtPriceLow = recentMacdBars[priceLowIdx];
            const macdNow = recentMacdBars[recentMacdBars.length - 1];
            const divergence = priceLow < recentLows[recentLows.length - 1] && macdNow > macdLowAtPriceLow;
            if (divergence) {
                totalScore += 18;
                signals.push('MACD底背离(强烈反转信号)');
            }
            else if (barRising && dif > 0) {
                totalScore += 14;
                signals.push('MACD柱上升+正值');
            }
            else if (dif > 0) {
                totalScore += 10;
                signals.push('MACD正值');
            }
            else if (barRising) {
                totalScore += 8;
                signals.push('MACD柱上升(负值收窄)');
            }
            else {
                totalScore += 4;
                signals.push('MACD负值走弱');
            }
            const last3Closes = closes.slice(-3);
            const last3Lows = lows.slice(-3);
            const last3Highs = highs.slice(-3);
            const l1 = last3Closes[last3Closes.length - 1], l2 = last3Closes[last3Closes.length - 2], l3 = last3Closes[last3Closes.length - 3];
            const h1 = last3Highs[last3Highs.length - 1], h3 = last3Highs[last3Highs.length - 3];
            const lo1 = last3Lows[last3Lows.length - 1], lo3 = last3Lows[last3Lows.length - 3];
            const hammer = lo1 < l1 * 0.97 && h1 < l1 * 1.03;
            const morningStar = l3 < l2 * 0.95 && Math.abs(l2 - l1) < 0.3 && l1 > l2 * 1.02;
            const bullishEngulf = l1 > l2 && l1 > h3 && l3 > l2;
            const crossStar = Math.abs(closes[closes.length - 1] - (lows[lows.length - 1] + highs[highs.length - 1]) / 2) < 0.1;
            if (morningStar) {
                totalScore += 15;
                signals.push('启明星(强烈反弹信号)');
            }
            else if (bullishEngulf) {
                totalScore += 13;
                signals.push('看涨吞没');
            }
            else if (hammer) {
                totalScore += 11;
                signals.push('锤子线(探底回升)');
            }
            else if (crossStar) {
                totalScore += 9;
                signals.push('低位十字星(变盘信号)');
            }
            else if (l1 > l2) {
                totalScore += 7;
                signals.push('阳线收盘');
            }
            else {
                totalScore += 3;
                signals.push('阴线收盘');
            }
            const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const avgVol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const lastVol = volumes[volumes.length - 1];
            if (l1 > l2 && lastVol > avgVol5 * 1.5) {
                totalScore += 10;
                signals.push('放量上涨');
            }
            else if (l1 > l2 && lastVol > avgVol5) {
                totalScore += 8;
                signals.push('温和放量上涨');
            }
            else if (l1 < l2 && lastVol < avgVol20 * 0.7) {
                totalScore += 7;
                signals.push('缩量下跌(卖压衰竭)');
            }
            else if (l1 < l2 && lastVol > avgVol5 * 1.3) {
                totalScore += 3;
                signals.push('放量下跌');
            }
            else {
                totalScore += 5;
                signals.push('成交量中性');
            }
            const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
            const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            if (ma5 > ma10 && ma10 > ma20) {
                totalScore += 10;
                signals.push('均线多头排列');
            }
            else if (ma5 > ma10) {
                totalScore += 7;
                signals.push('短期均线上行');
            }
            else if (ma5 < ma10 && ma10 < ma20) {
                totalScore += 3;
                signals.push('均线空头排列');
            }
            else {
                totalScore += 5;
                signals.push('均线交叉整理');
            }
            const rsv9 = (price - Math.min(...lows.slice(-9))) / (Math.max(...highs.slice(-9)) - Math.min(...lows.slice(-9))) * 100 || 50;
            const kVal = rsv9;
            const dVal = kVal * 2 / 3 + 50 / 3;
            const jVal = 3 * kVal - 2 * dVal;
            if (jVal < 20) {
                totalScore += 14;
                signals.push('KDJ超卖(J<20)');
            }
            else if (jVal < 40) {
                totalScore += 11;
                signals.push('KDJ偏低');
            }
            else if (jVal > 80) {
                totalScore += 4;
                signals.push('KDJ超买(J>80)');
            }
            else if (jVal > 60) {
                totalScore += 7;
                signals.push('KDJ偏高');
            }
            else {
                totalScore += 9;
                signals.push('KDJ中性');
            }
            const bbMa20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const bbStd = Math.sqrt(closes.slice(-20).reduce((a, b) => a + Math.pow(b - bbMa20, 2), 0) / 20);
            const bbUpper = bbMa20 + 2 * bbStd;
            const bbLower = bbMa20 - 2 * bbStd;
            if (price <= bbLower * 1.01) {
                totalScore += 10;
                signals.push('触及布林下轨(超卖反弹)');
            }
            else if (price <= bbLower * 1.05) {
                totalScore += 8;
                signals.push('接近布林下轨');
            }
            else if (price >= bbUpper * 0.99) {
                totalScore += 3;
                signals.push('触及布林上轨(压力)');
            }
            else if (price >= bbUpper * 0.95) {
                totalScore += 5;
                signals.push('接近布林上轨');
            }
            else {
                totalScore += 7;
                signals.push('布林中轨附近');
            }
            let direction;
            if (totalScore >= 85)
                direction = '强烈看涨';
            else if (totalScore >= 70)
                direction = '看涨';
            else if (totalScore >= 55)
                direction = '震荡偏强';
            else if (totalScore >= 40)
                direction = '方向不明';
            else if (totalScore >= 25)
                direction = '震荡偏弱';
            else if (totalScore >= 15)
                direction = '看跌';
            else
                direction = '强烈看跌';
            return {
                direction,
                score: Math.max(-100, Math.min(100, totalScore)),
                reason: signals.join('；') || '无明显信号',
                signals,
            };
        }
        catch (e) {
            return { direction: '方向不明', score: 0, reason: '计算异常', signals: [] };
        }
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
        if (results.length <= 10) {
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
        const finalResults = results.slice(0, 30);
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
        this.cache = { data: deduped, timestamp: Date.now() };
        this.saveCacheToDisk();
        this.logger.log(`✅ 前端数据扫描完成, 全量存储 ${deduped.length} 只`);
        return deduped;
    }
    async scanWithFrontendMainBoardData(stocks) {
        const results = [];
        const filteredStocks = stocks.filter(s => /^(60|00|30)/.test(s.code));
        for (const s of filteredStocks) {
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
        const finalResults = dedupedMain;
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
        const finalResults = dedupedSector.slice(0, 30);
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
            this.logger.log('  ⏳ 正在全量扫描创业板(300xxx)...');
            try {
                await Promise.race([
                    this['scanAllStocks'](),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('扫描超时')), 180000))
                ]);
            }
            catch (scanErr) {
                this.logger.warn(`  创业板扫描异常: ${scanErr.message}，使用当前缓存`);
            }
            this.logger.log('  ⏳ 正在全量扫描主板(000xxx+002xxx+600xxx+603xxx+605xxx等)...');
            try {
                await Promise.race([
                    this['scanMainBoardStocks'](),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('扫描超时')), 180000))
                ]);
            }
            catch (scanErr) {
                this.logger.warn(`  主板扫描异常: ${scanErr.message}，使用当前缓存`);
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
    calcMultiScore(s, kline) {
        const closeArr = kline.map(k => k.close);
        const len = closeArr.length;
        if (len < 20)
            return null;
        const highArr = kline.map(k => k.high);
        const lowArr = kline.map(k => k.low);
        const volArr = kline.map(k => k.volume || 0);
        const amtArr = kline.map(k => k.amount || 0);
        const openArr = kline.map(k => k.open);
        const currentClose = closeArr[len - 1];
        if (/^(\*)?ST/.test(s.name))
            return null;
        const excludeKeywords = ['银行', '保险', '农商', '兴业银', '中国人寿', '中国平安', '中国人保', '中国太保', '新华保险'];
        for (const kw of excludeKeywords) {
            if (s.name.includes(kw))
                return null;
        }
        const macd = this.calcCustomMACD(kline);
        const kdj = this.calcKDJ(kline);
        const ma5 = len >= 5 ? closeArr.slice(-5).reduce((a, b) => a + b, 0) / 5 : closeArr.reduce((a, b) => a + b, 0) / len;
        const ma10 = len >= 10 ? closeArr.slice(-10).reduce((a, b) => a + b, 0) / 10 : closeArr.reduce((a, b) => a + b, 0) / len;
        const ma20 = len >= 20 ? closeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;
        const ma60 = len >= 60 ? closeArr.slice(-60).reduce((a, b) => a + b, 0) / 60 : ma20;
        const bollMid = ma20;
        const bollStd = len >= 20 ? Math.sqrt(closeArr.slice(-20).reduce((s, c) => s + (c - bollMid) ** 2, 0) / 20) : 0;
        const bollUpper = bollMid + 2 * bollStd;
        const bollLower = bollMid - 2 * bollStd;
        let trendState = 1;
        if (ma5 > ma10 * 1.02 && ma10 > ma20 * 1.01)
            trendState = 3;
        else if (ma5 > ma10 && ma10 > ma20)
            trendState = 2;
        else if (ma5 <= ma10)
            trendState = 0;
        const periodHigh = Math.max(...highArr.slice(-60));
        const periodLow = Math.min(...lowArr.slice(-60));
        const pricePosition = periodHigh > periodLow ? ((currentClose - periodLow) / (periodHigh - periodLow)) * 100 : 50;
        const goldenCrossDays = macd.goldenCrossDays || 15;
        const lookbackDays = Math.max(1, goldenCrossDays);
        const triggerIdx = len - 1 - lookbackDays;
        const triggerClose = triggerIdx >= 0 ? kline[triggerIdx].close : kline[0].close;
        const priceIncrease = ((currentClose - triggerClose) / triggerClose) * 100;
        const avgVol30 = volArr.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, volArr.length);
        const avgVol5 = volArr.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, volArr.length);
        const volumeRatio = avgVol30 > 0 ? avgVol5 / avgVol30 : 1;
        const close3dAgo = len >= 4 ? closeArr[len - 4] : closeArr[0];
        const chg3d = ((currentClose - close3dAgo) / close3dAgo) * 100;
        const returns20 = [];
        for (let i = len - 20; i < len && i > 0; i++) {
            returns20.push((closeArr[i] - closeArr[i - 1]) / closeArr[i - 1]);
        }
        const meanR = returns20.length > 0 ? returns20.reduce((a, b) => a + b, 0) / returns20.length : 0;
        const variance20 = returns20.length > 0 ? returns20.reduce((s, r) => s + (r - meanR) ** 2, 0) / returns20.length : 0;
        const volatility20d = Math.sqrt(variance20) * 100 * Math.sqrt(252);
        const engine = new formula_engine_1.FormulaEngine({ open: openArr, close: closeArr, high: highArr, low: lowArr, volume: volArr, amount: amtArr });
        const bx = (0, bai_xing_1.calcBaiXing)(engine);
        const sanJiao = (0, bai_san_jiao_1.calcBaiSanJiao)(engine);
        const lingXing = (0, bai_ling_xing_1.calcBaiLingXing)(engine);
        const xingXing = (0, xing_xing_1.calcXingXing)(engine);
        const bxDays = bx.baiXiaoDays || 0;
        const isBaiXiaoBuy = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai);
        const hasBaiXiaoSignal = !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2 || bx.qiangShiHuiCai || bx.diBuBuy || bx.zhuLiShiPan || bx.jiaCang);
        const chip = this.calcChipAnalysis(closeArr, highArr, lowArr, volArr, currentClose);
        const chipConcentration90 = chip.concentration90;
        const factors = [];
        const f1 = hasBaiXiaoSignal;
        factors.push({ name: '白消买点', met: f1, points: f1 ? 3 : 0 });
        const f2 = chipConcentration90 < 40;
        factors.push({ name: '集中度<40%', met: f2, points: f2 ? 1 : 0 });
        const f3 = kdj.jUp && kdj.j > kdj.k;
        factors.push({ name: 'KDJ上移', met: f3, points: f3 ? 1 : 0 });
        const f4 = macd.currentDiff > macd.currentDea;
        factors.push({ name: 'MACD多头', met: f4, points: f4 ? 1 : 0 });
        const f5 = macd.currentDea > 0;
        factors.push({ name: 'DEA>0', met: f5, points: f5 ? 1 : 0 });
        const f6 = currentClose > ma20;
        factors.push({ name: '站上MA20', met: f6, points: f6 ? 1 : 0 });
        const distMa60 = ma60 > 0 ? ((currentClose - ma60) / ma60) * 100 : 0;
        const f7 = distMa60 < 25;
        factors.push({ name: '距MA60<25%', met: f7, points: f7 ? 1 : 0 });
        const f8 = currentClose > bollMid;
        factors.push({ name: 'BOLL中轨上', met: f8, points: f8 ? 1 : 0 });
        const f9 = s.inflow >= 20_000_000;
        factors.push({ name: '主力流入≥2000万', met: f9, points: f9 ? 1 : 0 });
        const f10 = chg3d > 0 && chg3d < 10;
        factors.push({ name: '3日涨幅0-10%', met: f10, points: f10 ? 1 : 0 });
        const f11 = volatility20d > 25;
        factors.push({ name: '20日波动率>25%', met: f11, points: f11 ? 1 : 0 });
        const f12 = s.turnoverRate > 1;
        factors.push({ name: '换手率>1%', met: f12, points: f12 ? 1 : 0 });
        const f13 = volumeRatio > 0.8;
        factors.push({ name: '量比>0.8', met: f13, points: f13 ? 1 : 0 });
        const f14 = ma5 > ma10 && ma10 > ma20;
        factors.push({ name: '均线多头', met: f14, points: f14 ? 2 : 0 });
        let totalScore = factors.reduce((s, f) => s + f.points, 0);
        const maxScore = 3 + 1 * 11 + 2;
        if (macd.isGoldenCross && priceIncrease > 25)
            totalScore = Math.min(totalScore, 3);
        let buySignal = '';
        const hasMainRise = trendState >= 2
            || (sanJiao.bestBuyPoints || []).some(p => p.includes('主升'))
            || !!bx.jiaCang;
        const hasZhenDang = (sanJiao.bestBuyPoints || []).includes('震荡买点');
        const hengPo = !!bx.baiXiaoBuy2;
        const hasJiGouActive = xingXing.jiGouHuoYueDu >= 12;
        const firstBreakMA5 = currentClose > ma5 && (len >= 2 ? closeArr[len - 2] <= (len >= 6 ? closeArr.slice(len - 6, len - 1).reduce((a, b) => a + b, 0) / 5 : ma5) : true);
        const ma5NotDown = ma5 >= (len >= 6 ? closeArr.slice(len - 6, len - 1).reduce((a, b) => a + b, 0) / 5 : ma5);
        const ma10NotDown = ma10 >= (len >= 11 ? closeArr.slice(len - 11, len - 1).reduce((a, b) => a + b, 0) / 10 : ma10);
        const hasStrongSell = !!(bx.gaoKaiDiZouQingCang || bx.baoLiangFuGaiQingCang || bx.po5RiXian || bx.yinDiePoWei);
        const hasChuHuo = !!(sanJiao.zhuLiChuHuo || lingXing.zhuShengZhongWeiChuHuo || lingXing.zhenShiChuHuo);
        const qiangShiHuiCaiLast3 = [len - 2, len - 3, len - 4].some(i => i >= 0 && !!bx.qiangShiHuiCai?.[i]);
        const hengPoLast3 = [len - 2, len - 3, len - 4].some(i => i >= 0 && !!bx.baiXiaoBuy2?.[i]);
        const signals = {
            baiXiaoStart: !!(bx.baiXiaoBuy1 || bx.baiXiaoBuy2),
            qiangShiHuiCai: !!bx.qiangShiHuiCai,
            jiaCang: !!bx.jiaCang,
            diBuBuy: !!bx.diBuBuy,
            zhuLiShiPan: !!bx.zhuLiShiPan,
            gaoWeiHuiDiao: !!bx.gaoWeiHuiDiaoBuy,
            hengPo, hasMainRise, hasZhenDang,
            baiXiaoDays: bxDays, baiXiao: !!bx.baiXiao, baiBu: !!bx.baiBu,
            jiGouActive: hasJiGouActive, jiGouHuoYueDu: xingXing.jiGouHuoYueDu || 0,
            firstBreakMA5, ma5NotDown, ma10NotDown,
            lingXingBuy: !!lingXing.buySignalDiamond,
            xiPanFanZhuan: !!lingXing.xiPanFanZhuanBuy,
            qiangShiHuiCaiLast3, hengPoLast3,
        };
        const signalParts = [];
        if (signals.baiXiaoStart)
            signalParts.push('白消启动');
        if (signals.qiangShiHuiCai)
            signalParts.push('强势回踩');
        if (signals.jiaCang)
            signalParts.push('★加仓');
        if (signals.hengPo)
            signalParts.push('横盘突破');
        if (signals.diBuBuy)
            signalParts.push('主力建仓');
        if (signals.zhuLiShiPan)
            signalParts.push('主力试盘');
        if (signals.gaoWeiHuiDiao)
            signalParts.push('企稳');
        if (signals.hasMainRise)
            signalParts.push('主升');
        if (signals.hasZhenDang)
            signalParts.push('震荡买点');
        if (signals.jiGouActive)
            signalParts.push('机构活跃');
        if (signals.lingXingBuy)
            signalParts.push('菱形买入');
        if (signals.xiPanFanZhuan)
            signalParts.push('洗盘反转');
        buySignal = signalParts.length > 0 ? signalParts.join('+') : '技术面观察';
        const detail = factors.filter(f => f.met).map(f => f.name).join('+');
        return {
            score: totalScore, factorCount: factors.filter(f => f.met).length, maxScore, detail,
            factors, trendState, pricePosition, priceIncrease, isGoldenCross: macd.isGoldenCross,
            bxDays, bx, buySignal, signals, sanJiao, lingXing, engine,
            hasStrongSell, hasChuHuo,
            ma5, ma10, ma20, ma60, macd, kdj, volumeRatio, volatility20d, chip, closeArr, openArr,
        };
    }
    scoreToSuggestion(score) {
        if (score >= 9)
            return '买入';
        if (score >= 6)
            return '轻仓买入';
        if (score >= 3)
            return '持有';
        return '不要介入';
    }
    scoreToSuggestionRelaxed(score) {
        if (score >= 7)
            return '买入';
        if (score >= 4)
            return '轻仓买入';
        if (score >= 2)
            return '持有';
        return '不要介入';
    }
    determineBySignalRule(signals, bx, result, bhResult) {
        const { baiXiaoStart, qiangShiHuiCai, jiaCang, diBuBuy, zhuLiShiPan, gaoWeiHuiDiao, hengPo, hasMainRise, hasZhenDang, baiXiaoDays, baiXiao, baiBu, jiGouActive, firstBreakMA5, ma5NotDown, ma10NotDown, lingXingBuy, xiPanFanZhuan, qiangShiHuiCaiLast3, hengPoLast3, } = signals;
        const trendState = result.trendState;
        const priceIncrease = result.priceIncrease;
        const pricePosition = result.pricePosition;
        const closeArr = result.closeArr;
        const ma20 = result.ma20;
        const ma60 = result.ma60;
        const hasStrongSell = result.hasStrongSell;
        const hasChuHuo = result.hasChuHuo;
        const sj = result.sanJiao || {};
        const lx = result.lingXing || {};
        if (baiBu && hasStrongSell)
            return { suggestion: '卖出', signalComb: '白布+清仓/爆量覆盖/破5日线' };
        if (baiBu && hasChuHuo)
            return { suggestion: '卖出', signalComb: '白布+出货' };
        if (baiBu && sj.shortSell)
            return { suggestion: '卖出', signalComb: '白布+紧急清仓' };
        if (baiBu && sj.strongSell)
            return { suggestion: '卖出', signalComb: '白布+空' };
        if (!baiBu && hasChuHuo && (baiXiaoStart || baiXiao))
            return { suggestion: '减仓', signalComb: '白消+出货(减仓)' };
        if (priceIncrease > 60)
            return null;
        const jiGouActiveBreak = jiGouActive && firstBreakMA5 && ma5NotDown && ma10NotDown;
        if (baiBu) {
            if (jiGouActiveBreak)
                return { suggestion: '轻仓买入', signalComb: '白布+机构活跃+突破MA5' };
            if (diBuBuy || zhuLiShiPan || gaoWeiHuiDiao || jiaCang) {
                const parts = ['白布'];
                if (diBuBuy)
                    parts.push('主力建仓');
                if (zhuLiShiPan)
                    parts.push('主力试盘');
                if (gaoWeiHuiDiao)
                    parts.push('企稳');
                if (jiaCang)
                    parts.push('★加仓');
                return { suggestion: '轻仓买入', signalComb: parts.join('+') };
            }
            return null;
        }
        if (baiXiao) {
            if (hasChuHuo)
                return { suggestion: '减仓', signalComb: '白消+出货' };
            if (baiXiaoDays <= 6) {
                if (qiangShiHuiCaiLast3 && hasMainRise)
                    return { suggestion: '重仓买入', signalComb: '强势回踩→主升' };
                if ((baiXiaoStart || baiXiaoDays <= 4) && hasMainRise)
                    return { suggestion: '重仓买入', signalComb: '白消启动+主升' };
                if ((baiXiaoStart || baiXiaoDays <= 4) && qiangShiHuiCai)
                    return { suggestion: '重仓买入', signalComb: '白消启动+强势回踩' };
                if (qiangShiHuiCai && jiaCang)
                    return { suggestion: '重仓买入', signalComb: '强势回踩+★加仓' };
                if (baiXiaoStart && jiaCang)
                    return { suggestion: '重仓买入', signalComb: '白消启动+★加仓' };
                if (hasMainRise)
                    return { suggestion: '重仓买入', signalComb: '主升' };
                if (qiangShiHuiCai)
                    return { suggestion: '重仓买入', signalComb: '强势回踩' };
                if (baiXiaoStart)
                    return { suggestion: '重仓买入', signalComb: '白消启动' };
                if (jiGouActiveBreak)
                    return { suggestion: '重仓买入', signalComb: '机构活跃+突破MA5' };
                if (baiXiaoDays >= 4)
                    return { suggestion: '持有', signalComb: `白消第${baiXiaoDays}天(待观察)` };
                return { suggestion: '持有', signalComb: `白消第${baiXiaoDays}天` };
            }
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
    async checkOpportunity(s, prevSuggestion) {
        const kline = await this.dataFetcher.getKLineData(s.code);
        if (!kline || kline.length < 20)
            return null;
        const result = this.calcMultiScore(s, kline);
        if (!result)
            return null;
        const { signals, bx, score, pricePosition, priceIncrease, detail } = result;
        const ruleResult = this.determineBySignalRule(signals, bx, result);
        if (ruleResult) {
            const sug = ruleResult.suggestion;
            const buySignals = ['重仓买入', '买入', '轻仓买入'];
            if (buySignals.includes(sug)) {
                if (pricePosition >= 95)
                    return null;
                return this.buildResult(s, kline, result, sug, ruleResult.signalComb);
            }
            return this.buildResult(s, kline, result, sug, ruleResult.signalComb);
        }
        return null;
    }
    async checkOpportunityRelaxed(s, prevSuggestion) {
        const kline = await this.dataFetcher.getKLineData(s.code);
        if (!kline || kline.length < 20)
            return null;
        const result = this.calcMultiScore(s, kline);
        if (!result)
            return null;
        const { signals, bx, score, priceIncrease, pricePosition, detail } = result;
        const ruleResult = this.determineBySignalRule(signals, bx, result);
        if (ruleResult) {
            const sug = ruleResult.suggestion;
            const buySignals = ['重仓买入', '买入', '轻仓买入'];
            if (buySignals.includes(sug)) {
                if (pricePosition >= 97)
                    return null;
                return this.buildResult(s, kline, result, sug, ruleResult.signalComb);
            }
            return this.buildResult(s, kline, result, sug, ruleResult.signalComb);
        }
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
    buildResult(s, kline, result, suggestion, signalCombination) {
        const entryTiming = this.calcEntryTiming(result.pricePosition, result.trendState, kline.map(k => k.close), kline.map(k => k.high), kline.map(k => k.low), kline.map(k => k.volume || 0), result.isGoldenCross);
        const safetyScore = this.calcSafetyScore(kline.map(k => k.close), kline.map(k => k.high), kline.map(k => k.low), kline.map(k => k.volume || 0), result.pricePosition, result.trendState);
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
            jiGouActiveScore: Math.round((result.signals?.jiGouHuoYueDu || result.volumeRatio * 6) * 100) / 100,
            trendPrediction: this.calcTrendPrediction(kline, result),
            forecast1_2Day: GemScreenerService_1.computeTechnicalForecast({
                entryTiming,
                isGoldenCross: result.isGoldenCross,
                ma5: result.ma5,
                ma10: result.ma10,
                pricePosition: result.pricePosition,
                mainForceInflow: s.inflow ?? 0,
                jiGouActiveScore: Math.round((result.signals?.jiGouHuoYueDu || result.volumeRatio * 6) * 100) / 100,
            }),
        };
    }
    static computeTechnicalForecast(params) {
        const { entryTiming: et, isGoldenCross: gc, ma5, ma10, pricePosition: pos, mainForceInflow: mf, jiGouActiveScore: jiScore } = params;
        const downtrend = ma5 > 0 && ma10 > 0 && ma5 < ma10;
        const overbought = pos >= 85;
        const mfStrongOut = mf < -3;
        const mfOut = mf < -1;
        const mfStrongIn = mf > 5;
        const mfIn = mf > 2;
        const volDead = jiScore < 3;
        const volState = jiScore >= 10 ? '放量' : jiScore >= 5 ? '平量' : jiScore >= 2 ? '缩量' : '极度缩量';
        if (downtrend && mfStrongOut && et < 50)
            return { direction: '下跌趋势', confidence: '高', detail: `均线空头(MA5=${ma5.toFixed(2)}下穿MA10=${ma10.toFixed(2)})+${volState}+主力大幅出逃(${mf.toFixed(1)}亿)+介入时机差(${et}),资金与趋势同步向下,未来1-2日继续探底概率极大,坚决不介入` };
        if (downtrend && et < 45)
            return { direction: '下跌趋势', confidence: '高', detail: `均线空头(MA5=${ma5.toFixed(2)}下穿MA10=${ma10.toFixed(2)})+${volState}${mfOut ? `+主力流出(${mf.toFixed(1)}亿)` : ''}+介入时机差(${et}),短期空方主导,未来1-2日继续震荡探底概率大,不宜抄底` };
        if (downtrend && et < 55)
            return { direction: '震荡偏弱', confidence: '中', detail: `均线空头排列(MA5下穿MA10)+${volState}${mfOut ? `+主力流出(${mf.toFixed(1)}亿)` : ''},介入时机中性(${et}),下跌节奏放缓但未企稳,未来1-2日低位震荡为主,等待均线走平再观察` };
        if (!gc && mfStrongOut)
            return { direction: '看跌', confidence: '高', detail: `MACD死叉+${volState}+主力大幅出逃(${mf.toFixed(1)}亿),资金加速撤离,短期动能在快速减弱,未来1-2日大概率继续回调,下方支撑位是关键` };
        if (!gc && et < 40)
            return { direction: '看跌', confidence: '中', detail: `MACD死叉+${volState}+介入时机差(${et})${mfOut ? `+主力流出(${mf.toFixed(1)}亿)` : ''},短期动能偏弱,未来1-2日大概率延续回调,关注下方支撑位` };
        if (overbought && et < 50)
            return { direction: '回调风险', confidence: '中', detail: `价格已处于高位(位置${Math.round(pos)}%)+${volState}${mfStrongOut ? `+主力明显出逃(${mf.toFixed(1)}亿)` : mfOut ? `+主力流出(${mf.toFixed(1)}亿)` : ''},介入时机不足(${et}),获利盘抛压增大,未来1-2日注意冲高回落` };
        if (et < 45 && volDead)
            return { direction: '震荡', confidence: '低', detail: `介入时机差(${et})+${volState}(活跃度${jiScore}),无人交易无方向,均线${downtrend ? '空头' : '方向不明'},未来1-2日大概率横盘等待方向,不参与` };
        if (et < 45)
            return { direction: '震荡', confidence: '低', detail: `介入时机差(${et})+${volState}${mfOut ? `+主力流出(${mf.toFixed(1)}亿)` : ''},均线${downtrend ? '空头排列' : '方向不明'},未来1-2日大概率横盘整理,等待方向选择` };
        if (et < 55 && !gc)
            return { direction: '震荡偏弱', confidence: '低', detail: `介入时机一般(${et})+${volState}+MACD未金叉${mfOut ? `+主力流出(${mf.toFixed(1)}亿)` : ''},趋势动能偏弱,未来1-2日延续弱势震荡,突破需量能配合` };
        if (et < 55)
            return { direction: '震荡偏强', confidence: '低', detail: `介入时机中性偏可(${et})+${volState}+MACD金叉向上${mfIn ? `+主力流入(${mf.toFixed(1)}亿)` : ''},多方略有优势,未来1-2日震荡中偏多运行` };
        if (et >= 65 && gc && pos < 65 && mfStrongIn)
            return { direction: '强烈看涨', confidence: '高', detail: `主力大幅进场(${mf.toFixed(1)}亿)+${volState}+MACD金叉确认+介入时机极佳(${et})+位置适中(${Math.round(pos)}%),资金+趋势+位置共振向上,未来1-2日大概率强势上攻,积极关注` };
        if (et >= 65 && gc && pos < 65)
            return { direction: '强烈看涨', confidence: '高', detail: `介入时机极佳(${et})+${volState}+MACD金叉确认+位置适中(${Math.round(pos)}%)${mfIn ? `+主力流入(${mf.toFixed(1)}亿)` : ''},趋势共振向上,未来1-2日大概率延续升势,积极关注` };
        if (et >= 60)
            return { direction: '看涨', confidence: '高', detail: `介入时机良好(${et})+${volState}+MACD金叉向上${mfIn ? `+主力流入(${mf.toFixed(1)}亿)` : ''},短期趋势偏多,未来1-2日有望继续震荡走高,逢低关注` };
        return { direction: '看涨', confidence: '中', detail: `介入时机可参与(${et})+${volState}+MACD金叉向上${mfIn ? `+主力流入(${mf.toFixed(1)}亿)` : ''},趋势偏多,未来1-2日大概率震荡偏多运行,可适当关注` };
    }
    calcScoreForecast(score, signals, suggestion, trendState = 0, isGoldenCross = false, pricePosition = 50, volumeRatio = 0.5, mainForceInflow = 0) {
        const isBuySignal = ['轻仓买入', '买入', '重仓买入'].includes(suggestion);
        const isSellSignal = ['减仓', '卖出', '不要介入'].includes(suggestion);
        const baiBu = signals?.baiBu || signals?.hasBaiBu || false;
        const baiXiao = signals?.baiXiao || signals?.hasBaiXiao || false;
        const jiGouActive = signals?.jiGouActive || signals?.hasJiGouActive || false;
        const macdGoldenCross = signals?.macdGoldenCross || isGoldenCross;
        const zhuLiChuHuo = signals?.zhuLiChuHuo || false;
        const uptrend = trendState >= 2;
        const mf = mainForceInflow ?? 0;
        const mfStrongOut = mf < -3;
        const mfOut = mf < -1;
        const mfStrongIn = mf > 5;
        const mfIn = mf > 2;
        const volState = volumeRatio > 1.5 ? '放量' : volumeRatio > 0.8 ? '平量' : volumeRatio > 0.4 ? '缩量' : '极度缩量';
        if (score >= 12 && jiGouActive && macdGoldenCross && uptrend && pricePosition < 70 && volumeRatio > 0.6) {
            return {
                direction: '强烈看涨', confidence: '高',
                detail: `综合评分${score}分,机构活跃,${volState}(量比${volumeRatio.toFixed(2)}),MACD金叉,均线多头排列(趋势值${trendState}),位置${Math.round(pricePosition)}%${mfStrongIn ? `+主力大幅进场${mf.toFixed(1)}亿` : mfIn ? `+主力流入${mf.toFixed(1)}亿` : ''}。多指标共振向上+资金面配合,未来1-2日上涨概率高,有望继续走强突破`
            };
        }
        if (score >= 10 && macdGoldenCross && uptrend && pricePosition < 75 && volumeRatio > 0.5) {
            return {
                direction: '看涨', confidence: '高',
                detail: `综合评分${score}分,MACD金叉,均线多头(趋势值${trendState}),位置${Math.round(pricePosition)}%,${volState}(量比${volumeRatio.toFixed(2)})${mfIn ? `+主力流入${mf.toFixed(1)}亿` : ''}。趋势向好,未来1-2日震荡偏多运行`
            };
        }
        if (score >= 12) {
            return {
                direction: '看涨', confidence: '中',
                detail: `综合评分${score}分较高,但趋势(值${trendState})或位置(${Math.round(pricePosition)}%)或${volState}(量比${volumeRatio.toFixed(2)})不够理想${mfOut ? `+主力流出${mf.toFixed(1)}亿` : ''},未来1-2日偏多但介入需等确认`
            };
        }
        if (score >= 9 && isBuySignal && pricePosition < 80) {
            return {
                direction: '震荡偏强', confidence: '中',
                detail: `综合评分${score}分,有买入信号加持,位置${Math.round(pricePosition)}%适中,${volState}(量比${volumeRatio.toFixed(2)})${mfIn ? `+主力流入${mf.toFixed(1)}亿` : ''}。短期多空平衡偏多,未来1-2日有望在震荡中逐步走高`
            };
        }
        if (score >= 9 && isBuySignal) {
            return {
                direction: '震荡', confidence: '低',
                detail: `综合评分${score}分有买入信号,但位置偏高(${Math.round(pricePosition)}%)${mfOut ? `+主力流出${mf.toFixed(1)}亿` : ''},${volState}(量比${volumeRatio.toFixed(2)}),上方空间有限且获利盘较多,未来1-2日方向不明确`
            };
        }
        if (score >= 9 && isSellSignal) {
            return {
                direction: '震荡', confidence: '低',
                detail: `综合评分${score}分尚可但叠加卖出信号,${volState}(量比${volumeRatio.toFixed(2)})${mfStrongOut ? `+主力大幅出逃${mf.toFixed(1)}亿` : ''},多空分歧明显。未来1-2日方向不明朗,需等待信号明朗再决定`
            };
        }
        if (score >= 6 && isBuySignal && pricePosition < 85) {
            return {
                direction: '震荡偏强', confidence: '低',
                detail: `综合评分${score}分一般但有买入信号,位置${Math.round(pricePosition)}%尚可,${volState}(量比${volumeRatio.toFixed(2)})${mfIn ? `+主力流入${mf.toFixed(1)}亿` : ''}。短期有反弹预期但力度存疑,未来1-2日窄幅震荡偏多`
            };
        }
        if (score >= 6 && !isBuySignal) {
            return {
                direction: '震荡', confidence: '低',
                detail: `综合评分${score}分偏低,无明显买卖信号指引。均线${uptrend ? '多头' : '空头或黏合'},${volState}(量比${volumeRatio.toFixed(2)})${mfOut ? `+主力流出${mf.toFixed(1)}亿` : ''},未来1-2日大概率延续震荡`
            };
        }
        if (score < 6 && (baiXiao || jiGouActive)) {
            return {
                direction: '震荡偏弱', confidence: '低',
                detail: `综合评分${score}分偏低,技术面整体偏弱,${volState}(量比${volumeRatio.toFixed(2)}),虽有${baiXiao ? '白消信号' : '机构活跃'}${mfStrongOut ? `但主力大幅出逃${mf.toFixed(1)}亿` : ''},难以支撑反转。未来1-2日有继续调整压力`
            };
        }
        if (score < 6) {
            return {
                direction: '看跌', confidence: '高',
                detail: `综合评分仅${score}分,MACD${macdGoldenCross ? '金叉' : '死叉或未金叉'},趋势值${trendState},${volState}(量比${volumeRatio.toFixed(2)})${mfStrongOut ? `+主力大幅出逃${mf.toFixed(1)}亿` : mfOut ? `+主力流出${mf.toFixed(1)}亿` : ''}。各指标偏空共振,未来1-2日回调风险较大,不宜介入`
            };
        }
        return { direction: '方向不明', confidence: '--', detail: '综合信号不明确,各指标无法形成一致性判断' };
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
        const PRIORITY = ['重仓买入', '买入', '轻仓买入', '持有', '卖出', '不要介入'];
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
        const finalResults = results.slice(0, 30);
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
            const pricePos = high60 > low60 ? ((price - low60) / (high60 - low60)) * 100 : 50;
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
            else if (ma5 < ma10)
                trendState = 0;
            const klineO = klineV.map((k) => Number(k.open));
            const klineH = klineV.map((k) => Number(k.high));
            const klineL = klineV.map((k) => Number(k.low));
            const klineA = klineV.map((k) => Number(k.amount ?? 0));
            const engine = new formula_engine_1.FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: volumeArr, amount: klineA });
            const baiXing = (0, bai_xing_1.calcBaiXing)(engine);
            const sanJiao = (0, bai_san_jiao_1.calcBaiSanJiao)(engine);
            const lingXing = (0, bai_ling_xing_1.calcBaiLingXing)(engine);
            const isGoldenCross = macdR?.isGoldenCross ?? false;
            const cfsInput = {
                pricePosition: pricePos,
                trendState,
                trendStrength: baiXing?.trendStrength ?? sanJiao?.trendStrength ?? 0,
                diff, dea,
                shortBuy: sanJiao?.shortBuy ?? false,
                strictBuy: sanJiao?.strictBuy ?? false,
                jiaCang: baiXing?.jiaCang ?? false,
                shortSell: sanJiao?.shortSell ?? false,
                strongSell: sanJiao?.strongSell ?? false,
                safe: baiXing?.safe ?? false,
                macdGoldenCross: isGoldenCross,
                macdDeathCross: false,
                baiXiaoDays: baiXing?.baiXiaoDays ?? 0,
                baiBu: !!baiXing?.baiBu,
                baiBuDays: baiXing?.baiBuDays ?? 0,
                baiCoverTrend: baiXing?.baiCoverTrend ?? 'stable',
                baiXiao: !!baiXing?.baiXiao,
                volumeStructure: sanJiao?.volumeStructure ?? 0,
                qiangZhiFuGai: !!baiXing?.qiangZhiFuGai,
            };
            const cfsResult = (0, trading_suggestion_1.getTradingSuggestion)(cfsInput);
            const suggestion = cfsResult.action;
            const BASE = {
                '重仓买入': 100, '买入': 80, '轻仓买入': 65, '持有': 40,
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
            this.addForecastToCache(this.cache.data);
            return { opportunities: this.cache.data, timestamp: this.cache.timestamp };
        }
        this.logger.log('📦 无缓存数据，触发异步扫描...');
        this.triggerRefresh();
        return { opportunities: [], timestamp: Date.now() };
    }
    async scanTopMainBoard(force = false) {
        if (this.mainBoardCache && this.mainBoardCache.data?.length) {
            this.upgradeCacheFields(this.mainBoardCache.data);
            this.addForecastToCache(this.mainBoardCache.data);
            return { opportunities: this.mainBoardCache.data, timestamp: this.mainBoardCache.timestamp };
        }
        this.logger.log('📦 主板无缓存数据，触发异步扫描...');
        this.triggerRefresh();
        return { opportunities: [], timestamp: Date.now() };
    }
    async scanTopOpportunities(force = false) {
        const gem = await this.scanTopGem(force);
        const main = await this.scanTopMainBoard(force);
        let combined = [...gem.opportunities, ...main.opportunities];
        combined = combined.filter(s => !/^68[89]/.test(s.code));
        const ORDER = {
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
        if (!raw?.length || raw.length < 5)
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
        const n = closeArr.length;
        const ma5 = closeArr.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, n);
        const ma10 = closeArr.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, n);
        const ma20 = closeArr.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, n);
        const macdR = this.calcCustomMACD(klineV);
        const diff = Array.isArray(macdR?.diff) ? macdR.diff[macdR.diff.length - 1] : (macdR?.diff ?? 0);
        const dea = Array.isArray(macdR?.dea) ? macdR.dea[macdR.dea.length - 1] : (macdR?.dea ?? 0);
        const ma5_1dAgo2 = closeArr.length > 6 ? closeArr.slice(-6, -1).reduce((a, b) => a + b, 0) / 5 : 0;
        const ma5Up = ma5 >= ma5_1dAgo2 * 0.995;
        const ma10_1dAgo2 = closeArr.length > 11 ? closeArr.slice(-11, -1).reduce((a, b) => a + b, 0) / 10 : 0;
        const ma10Up = ma10 >= ma10_1dAgo2 * 0.995;
        const ma10Down = closeArr.length > 15
            && ma10 < (closeArr.slice(-15, -5).reduce((a, b) => a + b, 0) / 10);
        let trendState = 1;
        if (ma5 > ma10 && ma5Up && ma10Up)
            trendState = 3;
        else if (ma5 > ma10 && ma10Up)
            trendState = 2;
        else if (ma5 > ma10 && ma5Up)
            trendState = 2;
        else if (ma5 < ma10 && ma10 < ma20)
            trendState = 0;
        else if (ma5 < ma10)
            trendState = 0;
        const klineO = klineV.map((k) => Number(k.open));
        const klineH = klineV.map((k) => Number(k.high));
        const klineL = klineV.map((k) => Number(k.low));
        const klineA = klineV.map((k) => Number(k.amount ?? 0));
        const engine = new formula_engine_1.FormulaEngine({ open: klineO, close: closeArr, high: klineH, low: klineL, volume: volumeArr, amount: klineA });
        const baiXing = (0, bai_xing_1.calcBaiXing)(engine);
        const sanJiao = (0, bai_san_jiao_1.calcBaiSanJiao)(engine);
        const lingXing = (0, bai_ling_xing_1.calcBaiLingXing)(engine);
        const baiXiao = baiXing?.baiXiao ?? false;
        const baiXiaoDays = baiXing?.baiXiaoDays ?? 0;
        const qiangZhiFuGai = !!baiXing?.qiangZhiFuGai;
        const formulaInput = {
            pricePosition: pricePos,
            trendState,
            trendStrength: baiXing?.trendStrength ?? sanJiao?.trendStrength ?? 0,
            diff,
            dea,
            shortBuy: sanJiao?.shortBuy ?? false,
            strictBuy: sanJiao?.strictBuy ?? false,
            jiaCang: baiXing?.jiaCang ?? false,
            shortSell: sanJiao?.shortSell ?? false,
            strongSell: sanJiao?.strongSell ?? false,
            safe: baiXing?.safe ?? false,
            macdGoldenCross: macdR?.isGoldenCross ?? false,
            macdDeathCross: false,
            baiXiaoDays: baiXing?.baiXiaoDays ?? 0,
            baiBu: !!baiXing?.baiBu,
            baiBuDays: baiXing?.baiBuDays ?? 0,
            baiCoverTrend: baiXing?.baiCoverTrend ?? 'stable',
            baiXiao: !!baiXiao,
            volumeStructure: sanJiao?.volumeStructure ?? 0,
            qiangZhiFuGai,
        };
        const isGoldenCross = macdR?.isGoldenCross ?? false;
        const result = (0, trading_suggestion_1.getTradingSuggestion)(formulaInput);
        let suggestion = result.action;
        const predictionText = '';
        const reasonText = result.reason || '';
        const ma10_1dAgo = closeArr.length > 11
            ? closeArr.slice(-11, -1).reduce((a, b) => a + b, 0) / 10
            : 0;
        const ma10TurnUp = ma10_1dAgo > 0 && ma10 >= ma10_1dAgo * 0.995;
        if (ma5 < ma10 && ma10Down && !(baiXiao && ma10TurnUp)) {
            suggestion = '不要介入';
        }
        const baiBuState = !!baiXing?.baiBu;
        const hasStrongSell = !!(baiXing?.gaoKaiDiZouQingCang ||
            baiXing?.baoLiangFuGaiQingCang ||
            baiXing?.po5RiXian ||
            baiXing?.yinDiePoWei);
        const hasChuHuo = !!(sanJiao?.zhuLiChuHuo ||
            lingXing?.zhuShengZhongWeiChuHuo ||
            lingXing?.zhenShiChuHuo);
        if (baiBuState && (hasStrongSell || hasChuHuo || sanJiao?.shortSell || sanJiao?.strongSell)) {
            suggestion = '卖出';
            this.logger.log(`🔴 [白布卖出] ${name}(${code}) 白布+强卖出信号，覆盖为卖出`);
        }
        if (suggestion === '不要介入') {
            const ma10Prev5 = closeArr.length > 15
                ? (closeArr.slice(-15, -5).reduce((a, b) => a + b, 0) / 10)
                : 0;
            this.logger.log(`🕵️ [DEBUG 深度洗盘] ${name}(${code}) 检查: ma5=${ma5.toFixed(2)} ma10=${ma10.toFixed(2)} ma10_5dAgo=${ma10Prev5.toFixed(2)} ma10_1dAgo=${ma10_1dAgo.toFixed(2)} ma10TurnUp=${ma10TurnUp} baiBu=${baiBuState} price=${price.toFixed(2)} price>ma5=${price > ma5} volActive=${((volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5) / ((volumeArr.length >= 20 ? volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : 1) || 1) * 6).toFixed(1)}`);
        }
        if ((suggestion === '不要介入' || suggestion === '减仓') && ma5 < ma10) {
            const debugVolActive = (volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5)
                / ((volumeArr.length >= 20 ? volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20 : 1) || 1) * 6;
            this.logger.log(`🕵️ [DEBUG 深度洗盘] ${name}(${code}) 检查: ma5=${ma5.toFixed(2)} ma10=${ma10.toFixed(2)} ma10_1dAgo=${ma10_1dAgo.toFixed(2)} ma10TurnUp=${ma10TurnUp} baiBu=${baiBuState} price=${price.toFixed(2)} price>ma5=${price > ma5} volActive=${debugVolActive.toFixed(1)}`);
            if (ma10TurnUp && price > ma5) {
                const avgVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
                const avgVol20 = volumeArr.length >= 20
                    ? volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20
                    : avgVol5;
                const volActive = Math.round(avgVol5 / (avgVol20 || 1) * 6 * 100) / 100;
                this.logger.log(`🕵️ [DEBUG 深度洗盘] ${name}(${code}) 条件全命中: volActive=${volActive} >7=${volActive > 7}`);
                if (volActive > 7) {
                    suggestion = '轻仓买入';
                    this.logger.log(`✅ [DEBUG 深度洗盘] ${name}(${code}) 设为轻仓买入`);
                    if (this.sellStateCache.has(code)) {
                        this.sellStateCache.delete(code);
                        this.logger.log(`🔓 [深度洗盘] ${name}(${code}) 洗盘结束信号，解除卖出锁定`);
                    }
                }
                else {
                    suggestion = '持有';
                    this.logger.log(`⚠️ [DEBUG 深度洗盘] ${name}(${code}) volActive=${volActive}<=7, 只能设为持有`);
                }
            }
        }
        if (suggestion !== '卖出' && !baiBuState && baiXiao && ma10TurnUp && price > ma5) {
            const avgVol5 = volumeArr.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const avgVol20 = volumeArr.length >= 20
                ? volumeArr.slice(-20).reduce((a, b) => a + b, 0) / 20
                : avgVol5;
            const volRatio = Math.round(avgVol5 / (avgVol20 || 1) * 6 * 100) / 100;
            this.logger.log(`🕵️ [白消恢复期] ${name}(${code}) DIFF>压力 baiXiao=${baiXiao} ma10TurnUp=${ma10TurnUp} price>ma5=${price > ma5} volRatio=${volRatio}`);
            if (volRatio > 7) {
                suggestion = '轻仓买入';
                this.logger.log(`✅ [白消恢复期] ${name}(${code}) 设为轻仓买入`);
            }
            else if (volRatio > 5) {
                suggestion = '持有';
                this.logger.log(`⚠️ [白消恢复期] ${name}(${code}) 量能不足(volRatio=${volRatio})，只能设为持有`);
            }
            else {
                this.logger.log(`ℹ️ [白消恢复期] ${name}(${code}) 量能太低(volRatio=${volRatio})，不改变信号`);
            }
        }
        const NEGATIVE = ['减仓', '不要介入'];
        if (suggestion === '卖出') {
            this.sellStateCache.set(code, { suggestion, timestamp: Date.now() });
            this.logger.log(`🔒 [实时分析] ${name}(${code}) 触发${suggestion}信号，已锁定`);
        }
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
            shortBuy: fullSanJiao?.shortBuy ?? false,
            strictBuy: fullSanJiao?.strictBuy ?? false,
            jiaCang: fullBaiXing?.jiaCang ?? false,
            shortSell: fullSanJiao?.shortSell ?? false,
            strongSell: fullSanJiao?.strongSell ?? false,
            safe: fullBaiXing?.safe ?? false,
            macdGoldenCross: fullIsGoldenCross,
            macdDeathCross: fullDiffV < fullDeaV,
            baiXiaoDays: fullBaiXing?.baiXiaoDays ?? 0,
            baiBu: !!fullBaiXing?.baiBu,
            baiBuDays: fullBaiXing?.baiBuDays ?? 0,
            baiCoverTrend: fullBaiXing?.baiCoverTrend ?? 'stable',
            baiXiao: !!fullBaiXing?.baiXiao,
            volumeStructure: fullSanJiao?.volumeStructure ?? 0,
            qiangZhiFuGai: !!fullBaiXing?.qiangZhiFuGai,
        };
        const crossResult = (0, trading_suggestion_1.getTradingSuggestion)(crossInput);
        const crossSuggestion = crossResult.action;
        const NEGATIVE_CROSS = ['卖出', '不要介入'];
        if (!keepAll && NEGATIVE_CROSS.includes(crossSuggestion))
            return null;
        const priceIncrease = ((price - closeArr[closeArr.length - 20]) / closeArr[closeArr.length - 20]) * 100;
        const changePct = ((price - closeArr[closeArr.length - 2]) / closeArr[closeArr.length - 2]) * 100;
        const BASE = {
            '重仓买入': 100, '买入': 80, '轻仓买入': 65, '持有': 40,
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
            this.logger.log(`🕵️ [DEBUG 筹码降级] ${name}(${code}) 触发: chipPat=${chipPattern} peak=${chipPeakPosition} pp=${pricePos.toFixed(1)} sugerWas=${suggestion} now=${finalSuggestion}`);
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
        const sellEntry = this.sellStateCache.get(code);
        if (sellEntry) {
            const hasBuySignal = ['重仓买入', '买入'].includes(finalSuggestion) && isGoldenCross && (entryTiming ?? 0) >= 50;
            if (hasBuySignal) {
                this.sellStateCache.delete(code);
                this.logger.log(`🔓 [实时分析] ${name}(${code}) 出现买入信号，自动解除卖出锁定`);
            }
            else {
                this.logger.log(`🕵️ [DEBUG 卖出锁] ${name}(${code}) sellLock=卖出锁定, finalSug=${finalSuggestion} gc=${isGoldenCross} et=${entryTiming} → 覆盖为不要介入`);
                finalSuggestion = '不要介入';
            }
        }
        const forecast1_2Day = GemScreenerService_1.computeTechnicalForecast({
            entryTiming,
            isGoldenCross: fullIsGoldenCross,
            ma5: ma5,
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
            baiXiaoDays: baiXing?.baiXiaoDays ?? 0,
            score,
            suggestion: finalSuggestion,
            entryTiming,
            safetyScore,
            isGoldenCross,
            diff,
            dea,
            buySignal: !!(baiXing?.baiXiao || baiXing?.jiaCang || sanJiao?.shortBuy) ? '有信号' : '',
            chipConcentration90,
            chipPeakPosition,
            chipPattern,
            signalCombination: result.reason || '',
            ma5: Math.round(ma5 * 100) / 100,
            ma10: Math.round(ma10 * 100) / 100,
            jiGouActiveScore: Math.round(Math.min(Math.max(volRatio, 0) * 6, 20) * 100) / 100,
            _debug: {
                ma5: Math.round(ma5 * 100) / 100,
                ma10: Math.round(ma10 * 100) / 100,
                ma10_1dAgo: Math.round(ma10_1dAgo * 100) / 100,
                ma5Up,
                ma10Up,
                ma10TurnUp,
                baiXiao: !!baiXiao,
                baiXiaoDays,
                baiBuState: !!baiBuState,
                qiangZhiFuGai,
                ma10Down,
                trendState,
                price: Math.round(price * 100) / 100,
                priceAboveMa5: price > ma5,
                pricePos: Math.round(pricePos),
                volRatio: Math.round(volRatio * 100) / 100,
                volActive: Math.round(Math.min(Math.max(volRatio, 0) * 6, 20) * 100) / 100,
                chipPattern,
                chipPeakPosition,
                chipConcentration90: Math.round(chipConcentration90 * 100) / 100,
                chipDowngrade: chipPattern === 'dispersed' && chipPeakPosition === 'high' && pricePos < 30,
                chipRisk: chipConcentration90 > 40 && chipPeakPosition === 'high' && pricePos < 25,
                sellLocked: !!sellEntry,
                deepWashoutApplied: suggestion === '轻仓买入',
                keepAll,
            },
        };
    }
    async searchStocks(keyword) {
        const results = [];
        try {
            const allCached = [...(this.cache?.data || []), ...(this.mainBoardCache?.data || [])];
            const seen = new Set();
            const deduped = allCached.filter(s => {
                const key = s.code;
                if (seen.has(key))
                    return false;
                seen.add(key);
                return true;
            });
            const kw = keyword.toLowerCase().trim();
            const matched = deduped.filter(s => {
                if ((s.code || '').toLowerCase().includes(kw))
                    return true;
                if ((s.name || '').toLowerCase().includes(kw))
                    return true;
                try {
                    const py = (0, pinyin_pro_1.pinyin)(s.name || '', { pattern: 'first', toneType: 'none' }).replace(/\s+/g, '');
                    if (py.includes(kw))
                        return true;
                }
                catch (_) { }
                return false;
            }).slice(0, 15);
            if (matched.length === 0)
                return results;
            this.recalculateSuggestions(matched);
            for (const r of matched) {
                const sellEntry = this.sellStateCache.get(r.code);
                if (sellEntry) {
                    const hasBuySignal = ['重仓买入', '买入'].includes(r.suggestion || '') &&
                        r.isGoldenCross === true &&
                        (r.entryTiming ?? 0) >= 50;
                    if (hasBuySignal) {
                        this.sellStateCache.delete(r.code);
                        this.logger.log(`🔓 [搜索] ${r.name}(${r.code}) 出现买入信号，自动解除卖出锁定`);
                    }
                    else {
                        r.suggestion = '不要介入';
                        r.trendPrediction = { direction: '方向不明', score: 30, reason: '卖出锁定中', details: {} };
                    }
                }
            }
            this.addForecastToCache(matched);
            results.push(...matched);
        }
        catch (e) {
            this.logger.error(`缓存搜索失败: ${e.message}`);
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
                    const sellEntry = this.sellStateCache.get(s.code);
                    if (sellEntry) {
                        const canUnlock = (s.suggestion && ['重仓买入', '买入'].includes(s.suggestion)) && goldenCross === true && pp >= 50;
                        if (canUnlock) {
                            this.sellStateCache.delete(s.code);
                            this.logger.log(`🔓 [重扫] ${s.name}(${s.code}) 出现买入信号，自动解除卖出锁定`);
                        }
                        else {
                            updated.push({
                                ...s,
                                suggestion: '不要介入',
                                score: Math.min(s.score ?? 50, 30),
                            });
                            continue;
                        }
                    }
                    const SELL_SIGS = ['卖出', '减仓', '不要介入'];
                    let newSuggestion;
                    if (s.suggestion && SELL_SIGS.includes(s.suggestion)) {
                        newSuggestion = s.suggestion ?? '持有';
                        if (newSuggestion === '卖出') {
                            this.sellStateCache.set(s.code, { suggestion: newSuggestion, timestamp: Date.now() });
                        }
                    }
                    else if (s.suggestion && ['重仓买入', '买入', '轻仓买入'].includes(s.suggestion)) {
                        newSuggestion = s.suggestion;
                    }
                    else {
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
                            newSuggestion = '持有';
                        }
                        const chipDowngrade = chipPat === 'dispersed' && chipPeak === 'high' && pp < 30;
                        const chipRisk = chipConc > 40 && chipPeak === 'high' && pp < 25;
                        if (chipDowngrade || chipRisk) {
                            if (newSuggestion === '重仓买入')
                                newSuggestion = '买入';
                            else if (newSuggestion === '买入')
                                newSuggestion = '轻仓买入';
                            else if (newSuggestion === '轻仓买入')
                                newSuggestion = '持有';
                        }
                        if (chipPat === 'single_peak' && chipPeak === 'low' && pp > 15 && pp < 45 && trendState >= 1) {
                            if (newSuggestion === '买入')
                                newSuggestion = '重仓买入';
                            else if (newSuggestion === '轻仓买入')
                                newSuggestion = '买入';
                        }
                        const entry = s.entryTiming ?? 50;
                        const PRIORITY_LIST = ['重仓买入', '买入', '轻仓买入', '持有', '卖出', '不要介入'];
                        const sugIdx2 = PRIORITY_LIST.indexOf(newSuggestion);
                        if (sugIdx2 >= 0 && entry >= 65 && sugIdx2 > 1) {
                            newSuggestion = sugIdx2 <= 2 ? PRIORITY_LIST[sugIdx2 - 1] : '轻仓买入';
                        }
                        else if (sugIdx2 >= 0 && entry < 35 && sugIdx2 <= 1) {
                            newSuggestion = PRIORITY_LIST[sugIdx2 + 1];
                        }
                    }
                    const chg = s.changePercent ?? 0;
                    if (chg >= 9 && !['重仓买入', '买入', '轻仓买入'].includes(newSuggestion)) {
                        newSuggestion = '轻仓买入';
                    }
                    else if (chg >= 6 && !['重仓买入', '买入', '轻仓买入', '减仓', '卖出'].includes(newSuggestion)) {
                        newSuggestion = '轻仓买入';
                    }
                    else if (chg >= 3 && newSuggestion === '不要介入') {
                        newSuggestion = '持有';
                    }
                    if (!['重仓买入', '买入'].includes(newSuggestion) && (s.ma5 ?? 0) < (s.ma10 ?? 0)) {
                        newSuggestion = '不要介入';
                    }
                    const BASE = {
                        '重仓买入': 100, '买入': 80, '轻仓买入': 65, '持有': 40,
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
            const PRIORITY = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '减仓': 4, '卖出': 5, '不要介入': 6 };
            updated.sort((a, b) => {
                const pa = PRIORITY[a.suggestion || '不要介入'] ?? 9;
                const pb = PRIORITY[b.suggestion || '不要介入'] ?? 9;
                if (pa !== pb)
                    return pa - pb;
                return (b.score || 0) - (a.score || 0);
            });
            const gemStocks = updated.filter(s => /^30/.test(s.code));
            const mainBoardStocks = updated.filter(s => /^60/.test(s.code) || /^00/.test(s.code));
            this.cache = { data: gemStocks, timestamp: now };
            this.mainBoardCache = { data: mainBoardStocks, timestamp: now };
            await this.saveCacheToDisk();
            await this.saveMainBoardCacheToDisk();
            for (const stock of updated) {
                if (!stock.trendPrediction) {
                    stock.trendPrediction = this.calcSimpleTrendPrediction(stock);
                }
            }
            this.addForecastToCache(updated);
            await this.saveSellStateCache();
            this.logger.log(`重新评估完成：${updated.length} 只, 信号: ${updated.map(s => s.suggestion).join(',')}`);
        }
        catch (e) {
            this.logger.error(`重新评估失败: ${e.message}`);
        }
        return [...(this.cache?.data || []), ...(this.mainBoardCache?.data || [])];
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
        const SELL_LOCK = ['卖出'];
        const BUY_SIGNALS = ['重仓买入', '买入', '轻仓买入'];
        for (const r of results) {
            const code = r.code;
            if (r.suggestion && BUY_SIGNALS.includes(r.suggestion)) {
                this.soldOutStocks.delete(code);
            }
            else if (r.suggestion && SELL_LOCK.includes(r.suggestion)) {
                this.soldOutStocks.add(code);
            }
            else if (!BUY_SIGNALS.includes(r.suggestion ?? '')) {
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
    async runBacktest() {
        const allCodes = [];
        try {
            for (const p of [(0, node_path_1.join)(process.cwd(), 'assets', 'gem-cache.json'), (0, node_path_1.join)(process.cwd(), 'assets', 'main-board-cache.json')]) {
                if ((0, fs_1.existsSync)(p)) {
                    const raw = JSON.parse((0, fs_1.readFileSync)(p, 'utf-8'));
                    const stocks = raw?.data || raw?.stocks || raw;
                    if (Array.isArray(stocks))
                        stocks.forEach((s) => { if (s.code && !allCodes.includes(s.code))
                            allCodes.push(s.code); });
                }
            }
        }
        catch { }
        const sample = allCodes.slice(0, 20);
        this.logger.log("\u56de\u5f52\u9a8c\u8bc1: \u62bd\u53d6 " + sample.length + " \u53ea\u80a1\u7968\uff0c\u6b65\u8fdb\u6d4b\u8bd5\u8bc4\u5206\u7684\u9884\u6d4b\u80fd\u529b");
        const records = [];
        let processed = 0, totalDays = 0;
        for (const code of sample) {
            try {
                const kline = await this.dataFetcher.getKLineData(code);
                if (!kline || kline.length < 150)
                    continue;
                processed++;
                for (let day = 100; day < kline.length - 2; day += 5) {
                    const slice = kline.slice(0, day + 1);
                    const now = kline[day];
                    const next1 = kline[day + 1];
                    const next2 = kline[day + 2];
                    if (!now?.close || !next1?.close || !next2?.close)
                        continue;
                    const result = this.calcMultiScore({ code, name: '' }, slice);
                    if (!result)
                        continue;
                    const score = result.score;
                    const ret1d = (next1.close - now.close) / now.close * 100;
                    const ret2d = (next2.close - now.close) / now.close * 100;
                    records.push({ score, ret1d, ret2d });
                    totalDays++;
                }
            }
            catch { }
        }
        const groups = {};
        const ranges = [
            { label: "0-3", min: 0, max: 3 },
            { label: "4-5", min: 4, max: 5 },
            { label: "6-7", min: 6, max: 7 },
            { label: "8-9", min: 8, max: 9 },
            { label: "10-11", min: 10, max: 11 },
            { label: "12-16", min: 12, max: 16 },
        ];
        for (const r of ranges)
            groups[r.label] = { scores: [], ret1ds: [], ret2ds: [] };
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
        const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const winRate = (arr) => arr.length > 0 ? arr.filter(x => x > 0).length / arr.length * 100 : 0;
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
                avgScore: n > 0 ? parseFloat((g.scores.reduce((a, b) => a + b, 0) / n).toFixed(1)) : 0,
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
    async runForecastBacktest() {
        const allCodes = [];
        try {
            for (const p of [(0, node_path_1.join)(process.cwd(), 'assets', 'gem-cache.json'), (0, node_path_1.join)(process.cwd(), 'assets', 'main-board-cache.json')]) {
                if ((0, fs_1.existsSync)(p)) {
                    const raw = JSON.parse((0, fs_1.readFileSync)(p, 'utf-8'));
                    const stocks = raw?.data || raw?.stocks || raw;
                    if (Array.isArray(stocks))
                        stocks.forEach((s) => { if (s.code && !allCodes.includes(s.code))
                            allCodes.push(s.code); });
                }
            }
        }
        catch { }
        const sample = allCodes.slice(0, 25);
        this.logger.log(`=== 评分预测过滤器回测: 抽取 ${sample.length} 只股票 ===`);
        const records = [];
        let processed = 0, totalDays = 0;
        for (const code of sample) {
            try {
                const kline = await this.dataFetcher.getKLineData(code);
                if (!kline || kline.length < 150)
                    continue;
                processed++;
                for (let day = 100; day < kline.length - 2; day += 5) {
                    const slice = kline.slice(0, day + 1);
                    const now = kline[day];
                    const next1 = kline[day + 1];
                    const next2 = kline[day + 2];
                    if (!now?.close || !next1?.close || !next2?.close)
                        continue;
                    const result = this.calcMultiScore({ code, name: '' }, slice);
                    if (!result)
                        continue;
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
            }
            catch { }
        }
        const configs = [
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
        const results = [];
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
            const fmtRet = (v) => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
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
    async technicalAnalysis(code) {
        const kline = await this.dataFetcher.getKLineData(code);
        if (!kline || kline.length < 30) {
            return {
                code,
                currentPrice: 0,
                entryScore: 0,
                entryLevel: '数据不足',
                bestEntryPrice: 0,
                reasoning: ['K线数据不足30条，无法进行技术分析'],
                macd: null,
                kdj: null,
                bollinger: null,
                rsi: null,
                volumeRatio: null,
            };
        }
        const taKlines = kline.map(k => ({
            date: String(k.day || k.date || ''),
            open: k.open || 0,
            close: k.close || 0,
            high: k.high || 0,
            low: k.low || 0,
            volume: k.volume || 0,
            amount: k.amount || 0,
        }));
        const currentPrice = taKlines[taKlines.length - 1].close;
        const result = (0, technical_analysis_1.analyzeTechnical)(taKlines, currentPrice);
        return { code, ...result };
    }
};
exports.GemScreenerService = GemScreenerService;
exports.GemScreenerService = GemScreenerService = GemScreenerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [data_fetcher_service_1.DataFetcherService,
        stock_service_1.StockService])
], GemScreenerService);
