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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var GemScreenerController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GemScreenerController = void 0;
const common_1 = require("@nestjs/common");
const access_limit_guard_1 = require("../../guards/access-limit.guard");
const gem_screener_service_1 = require("./gem-screener.service");
const gem_screener_scheduler_1 = require("./gem-screener.scheduler");
const stock_service_1 = require("../stock/stock.service");
const fs_1 = require("fs");
const path_1 = require("path");
const data_1 = require("../../industry-sectors/data");
let GemScreenerController = GemScreenerController_1 = class GemScreenerController {
    constructor(gemScreener, scheduler, stockService) {
        this.gemScreener = gemScreener;
        this.scheduler = scheduler;
        this.stockService = stockService;
        this.logger = new common_1.Logger(GemScreenerController_1.name);
    }
    async getMarketState() {
        const state = this.scheduler.getState();
        const bjNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
        const bjStr = bjNow.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return {
            code: 200,
            msg: 'success',
            data: {
                ...state,
                beijingTime: bjStr,
                lockUntilStr: state.lockUntil
                    ? new Date(state.lockUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                    : null,
                nextScanStr: state.nextScanTime
                    ? new Date(state.nextScanTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                    : null,
            },
        };
    }
    async priceStream(res) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        const codes = this.scheduler.getWatchedCodes();
        if (codes.length === 0) {
            res.write(`data: ${JSON.stringify({ error: 'no watched stocks' })}\n\n`);
            res.end();
            return;
        }
        this.logger.log(`📡 SSE 实时价格流开启: ${codes.length} 只关注股票`);
        let closed = false;
        res.on('close', () => { closed = true; });
        setInterval(async () => {
            if (closed) {
                return;
            }
            const state = this.scheduler.getState();
            if (state.status === 'closed' || state.status === 'premarket' || state.status === 'lunch') {
                res.write(`data: ${JSON.stringify({ marketStatus: state.status, prices: [] })}\n\n`);
                return;
            }
            try {
                if (!closed) {
                    res.write(`data: ${JSON.stringify({ marketStatus: 'trading', prices: [], timestamp: Date.now() })}\n\n`);
                }
            }
            catch (e) {
                if (!closed) {
                    res.write(`data: ${JSON.stringify({ marketStatus: 'error', error: e.message })}\n\n`);
                }
            }
        }, 2000);
    }
    async getWatchedCodes() {
        return { code: 200, msg: 'success', data: { codes: this.scheduler.getWatchedCodes() } };
    }
    async tencentProxy(body) {
        if (!body.q)
            return { code: 400, msg: 'missing q parameter' };
        return { code: 200, msg: 'success', data: { text: '' } };
    }
    async refreshWithData(body) {
        const opportunities = await this.gemScreener.scanWithFrontendData(body.stocks);
        return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
    }
    async refreshMainBoard(body) {
        const opportunities = await this.gemScreener.scanWithFrontendMainBoardData(body.stocks);
        return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
    }
    async refreshSector(body) {
        const opportunities = await this.gemScreener.scanWithFrontendSectorData(body.stocks);
        return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
    }
    async refreshHeavyBuy(body) {
        try {
            const stocks = body?.stocks || [];
            if (stocks.length === 0) {
                return { code: 400, msg: 'no stocks data', data: { opportunities: [] } };
            }
            this.logger.log(`📥 接收到重仓买入推送: ${stocks.length} 只`);
            const results = await this.gemScreener.scanWithFrontendHeavyBuyData(stocks);
            return { code: 200, msg: 'success', data: { opportunities: results } };
        }
        catch (e) {
            this.logger.error(`❌ 重仓买入分析失败: ${e.message}`);
            return { code: 500, msg: e.message, data: { opportunities: [] } };
        }
    }
    async getOpportunities() {
        const { opportunities, timestamp } = await this.gemScreener.getOpportunities();
        return { code: 200, msg: 'success', data: { opportunities, timestamp } };
    }
    async getMainBoard() {
        const { opportunities, timestamp } = await this.gemScreener.getMainBoardOpportunities();
        return { code: 200, msg: 'success', data: { opportunities, timestamp } };
    }
    async getTopGem(force) {
        const result = await this.gemScreener.scanTopGem(force === 'true');
        const heavyBuyGEM = this.readHeavyBuyCache().filter(s => s.code && (s.code.startsWith('300') || s.code.startsWith('301')));
        const merged = this.mergeWithHeavyBuy(result.opportunities, heavyBuyGEM);
        return { code: 200, msg: 'success', data: { opportunities: merged.slice(0, 10), timestamp: result.timestamp } };
    }
    async getTopMainBoard(force) {
        const result = await this.gemScreener.scanTopMainBoard(force === 'true');
        const heavyBuyMain = this.readHeavyBuyCache().filter(s => s.code && !s.code.startsWith('30'));
        const merged = this.mergeWithHeavyBuy(result.opportunities, heavyBuyMain);
        return { code: 200, msg: 'success', data: { opportunities: merged.slice(0, 10), timestamp: result.timestamp } };
    }
    async getCacheAll() {
        const gem = this.gemScreener.getCacheAll();
        return { code: 200, msg: 'success', data: { total: gem.length, stocks: gem } };
    }
    async getCombinedTop(force) {
        const [gemResult, mainResult] = await Promise.all([
            this.gemScreener.scanTopGem(force === 'true'),
            this.gemScreener.scanTopMainBoard(force === 'true'),
        ]);
        const heavyBuyAll = this.readHeavyBuyCache();
        const gemMerged = this.mergeWithHeavyBuy(gemResult.opportunities, heavyBuyAll.filter(s => s.code && (s.code.startsWith('300') || s.code.startsWith('301'))));
        const mainMerged = this.mergeWithHeavyBuy(mainResult.opportunities, heavyBuyAll.filter(s => s.code && !s.code.startsWith('30')));
        const all = [...gemMerged, ...mainMerged];
        const seen = new Set();
        const deduped = all.filter(s => { if (seen.has(s.code))
            return false; seen.add(s.code); return true; });
        const signalOrder = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '减仓': 4, '卖出': 5, '不要介入': 6 };
        const sorted = deduped
            .filter(s => s.suggestion && ['重仓买入', '买入', '轻仓买入', '持有', '减仓', '卖出', '不要介入'].includes(s.suggestion))
            .sort((a, b) => {
            const ao = signalOrder[a.suggestion] ?? 9;
            const bo = signalOrder[b.suggestion] ?? 9;
            if (ao !== bo)
                return ao - bo;
            const entryA = a.entryTiming ?? 0;
            const entryB = b.entryTiming ?? 0;
            if (entryB !== entryA)
                return entryB - entryA;
            const mfA = a.mainForceInflow ?? 0;
            const mfB = b.mainForceInflow ?? 0;
            return mfB - mfA;
        })
            .slice(0, 30);
        for (const s of sorted) {
            if (s.chipConcentration90 === undefined) {
                s.chipConcentration90 = 50;
                s.chipPeakPosition = 'mid';
                s.chipPattern = 'dispersed';
            }
            if (s.signalCombination === undefined)
                s.signalCombination = '';
            if (s.jiGouActiveScore === undefined)
                s.jiGouActiveScore = 0;
            if (!s.forecast1_2Day || typeof s.forecast1_2Day === 'string') {
                try {
                    s.forecast1_2Day = gem_screener_service_1.GemScreenerService.computeTechnicalForecast({
                        entryTiming: s.entryTiming ?? 0,
                        isGoldenCross: s.isGoldenCross ?? false,
                        ma5: s.ma5 ?? 0,
                        ma10: s.ma10 ?? 0,
                        pricePosition: s.pricePosition ?? 50,
                        mainForceInflow: s.mainForceInflow ?? 0,
                        jiGouActiveScore: s.jiGouActiveScore ?? 0,
                    });
                }
                catch { }
            }
        }
        return { code: 200, msg: 'success', data: { opportunities: sorted, timestamp: Date.now() } };
    }
    async getTopOpportunities(force) {
        const result = await this.gemScreener.scanTopOpportunities(force === 'true');
        return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
    }
    async getTopSector(force) {
        const result = await this.gemScreener.scanSectorOpportunities(force === 'true');
        return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
    }
    async getHeavyBuy() {
        const all = await this.gemScreener.getAllOpportunities();
        const cachedHeavyBuy = all.filter(s => s.suggestion === '重仓买入');
        if (cachedHeavyBuy.length >= 3) {
            return { code: 200, msg: 'success', data: { opportunities: cachedHeavyBuy.slice(0, 3), timestamp: Date.now() } };
        }
        try {
            const paths = [
                (0, path_1.join)(__dirname, '..', '..', '..', 'assets', 'heavy-buy-cache.json'),
                (0, path_1.join)(process.cwd(), 'assets', 'heavy-buy-cache.json'),
            ];
            for (const p of paths) {
                if ((0, fs_1.existsSync)(p)) {
                    const raw = (0, fs_1.readFileSync)(p, 'utf-8');
                    const parsed = JSON.parse(raw);
                    const seedData = parsed.data || parsed.opportunities || parsed;
                    if (Array.isArray(seedData) && seedData.length > 0) {
                        this.logger.log(`✅ 使用种子缓存: ${seedData.length} 只重仓买入`);
                        return { code: 200, msg: 'success', data: { opportunities: seedData.slice(0, 3), timestamp: Date.now() } };
                    }
                }
            }
        }
        catch (e) {
            this.logger.warn('读取重仓买入种子缓存失败: ' + e.message);
        }
        this.gemScreener.scanGlobalHeavyBuy().catch(e => {
            this.logger.warn('后台全局重仓扫描失败: ' + e.message);
        });
        return { code: 200, msg: 'success', data: { opportunities: [], timestamp: Date.now() } };
    }
    async getIndustrySectorsTop10() {
        try {
            const result = await this.gemScreener.getIndustrySectorTop10();
            if (result && result.sectors && result.sectors.length > 0) {
                return { code: 200, msg: 'success', data: result };
            }
        }
        catch (e) {
            this.logger.warn('实时行业板块排行失败: ' + e.message);
        }
        try {
            const ALL_SECTORS = [...data_1.default, ...data_1.CONCEPT_SECTORS];
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
        }
        catch (e) {
            this.logger.error('ALL_SECTORS降级失败: ' + e.message);
        }
        return { code: 200, msg: 'success', data: { sectors: [], timestamp: Date.now() } };
    }
    async seedCache() {
        const result = await this.gemScreener.generateSeedCache();
        return { code: 200, msg: 'success', data: result };
    }
    readHeavyBuyCache() {
        try {
            const paths = [(0, path_1.join)(process.cwd(), 'assets', 'heavy-buy-cache.json')];
            for (const p of paths) {
                if ((0, fs_1.existsSync)(p)) {
                    const raw = (0, fs_1.readFileSync)(p, 'utf-8');
                    const data = JSON.parse(raw);
                    if (data && data.data && data.data.length > 0) {
                        return data.data.map(s => ({ ...s, suggestion: '重仓买入', suggestText: '🔥 重仓买入' }));
                    }
                }
            }
        }
        catch (e) {
            this.logger.error('读取重仓买入缓存失败: ' + e.message);
        }
        return [];
    }
    mergeWithHeavyBuy(opportunities, heavyBuy) {
        const heavyCodes = new Set(heavyBuy.map(s => s.code));
        const uniqueOpps = opportunities.filter(s => !heavyCodes.has(s.code));
        const merged = [...heavyBuy, ...uniqueOpps].sort((a, b) => (b.score || 0) - (a.score || 0));
        return merged;
    }
    async searchStock(keyword) {
        if (!keyword || keyword.trim().length === 0) {
            return { code: 400, msg: '请输入搜索关键词', data: [] };
        }
        try {
            const results = await this.gemScreener.searchStocks(keyword.trim());
            return { code: 200, msg: 'ok', data: results };
        }
        catch (e) {
            this.logger.error(`搜索失败: ${e.message}`);
            return { code: 500, msg: e.message, data: [] };
        }
    }
    async cacheData(body) {
        try {
            const stocks = body?.stocks || [];
            if (!stocks.length)
                return { code: 400, msg: 'empty stocks', data: [] };
            const results = [];
            for (const s of stocks) {
                try {
                    if (!s.klines || s.klines.length < 20)
                        continue;
                    const normalKlines = s.klines.map(k => ({
                        open: k.open ?? k[1] ?? 0,
                        close: k.close ?? k[2] ?? 0,
                        high: k.high ?? k[3] ?? 0,
                        low: k.low ?? k[4] ?? 0,
                        volume: k.volume ?? k[5] ?? 0,
                        amount: k.amount ?? k[6] ?? 0,
                    }));
                    const result = await this.stockService.analyzeFromRawData({
                        code: s.code,
                        name: s.name,
                        currentPrice: s.price,
                        changePercent: s.changePercent,
                        high: s.high,
                        low: s.low,
                        kline: normalKlines,
                    });
                    results.push(result);
                }
                catch (e) {
                    this.logger.warn(`分析失败: ${s.code} ${s.name} - ${e.message}`);
                }
            }
            const SIGNAL_ORDER = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '减仓': 4, '卖出': 5, '不要介入': 6 };
            results.sort((a, b) => {
                const ao = SIGNAL_ORDER[a.suggestion ?? '持有'] ?? 9;
                const bo = SIGNAL_ORDER[b.suggestion ?? '持有'] ?? 9;
                if (ao !== bo)
                    return ao - bo;
                return (b.score ?? 0) - (a.score ?? 0);
            });
            this.gemScreener.updateCache('scan', results);
            this.logger.log(`📥 前端数据缓存+分析完成: ${results.length} 只`);
            return { code: 200, msg: 'success', data: { total: results.length } };
        }
        catch (e) {
            this.logger.error(`缓存数据失败: ${e.message}`);
            return { code: 500, msg: e.message, data: [] };
        }
    }
    async getScanResult() {
        const cached = this.gemScreener.getCache('scan');
        return { code: 200, msg: 'success', data: { opportunities: cached, timestamp: Date.now() } };
    }
    async rescanMarket() {
        try {
            const snap = this.gemScreener.getUpgradedSnapshot();
            let data = [];
            let updatedAt = 0;
            if (snap?.list?.length) {
                data = snap.list;
                updatedAt = snap.timestamp;
                this.logger.log(`📤 rescan返回快照: ${data.length}只, timestamp=${updatedAt}`);
            }
            else {
                data = this.gemScreener.getCacheAll();
                updatedAt = this.gemScreener.getCacheTimestamp();
                this.logger.log(`📤 rescan返回主缓存: ${data.length}只, timestamp=${updatedAt}`);
            }
            const PRI_ORDER = {
                '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3,
                '减仓': 4, '卖出': 5, '不要介入': 6,
            };
            data.sort((a, b) => {
                const pa = PRI_ORDER[a.suggestion] ?? 9;
                const pb = PRI_ORDER[b.suggestion] ?? 9;
                if (pa !== pb)
                    return pa - pb;
                const ea = a.entryTiming || 0;
                const eb = b.entryTiming || 0;
                if (eb !== ea)
                    return eb - ea;
                const calcIntradayScore = (s) => {
                    const hi = s.intradayHigh || 0, lo = s.intradayLow || 0, p = s.currentPrice || 0;
                    if (!hi || !lo || hi <= lo)
                        return 1;
                    const pos = ((p - lo) / (hi - lo)) * 100;
                    return pos < 25 ? 3 : pos < 50 ? 2 : pos < 75 ? 1 : 0;
                };
                const ia = calcIntradayScore(a), ib = calcIntradayScore(b);
                if (ia !== ib)
                    return ib - ia;
                const sa = a.score || 0;
                const sb = b.score || 0;
                if (sb !== sa)
                    return sb - sa;
                return (b.changePercent || 0) - (a.changePercent || 0);
            });
            return {
                code: 200, msg: 'ok', data, updatedAt,
                cloudSnapshotUrl: this.gemScreener.cloudSnapshotUrl || '',
            };
        }
        catch (e) {
            this.logger.error(`读取缓存失败: ${e.message}`);
            return { code: 500, msg: e.message, data: [] };
        }
    }
    async updateUpgraded(body) {
        try {
            const list = body?.list || [];
            if (!list.length)
                return { code: 200, msg: 'empty', data: [] };
            const sigCount = {};
            for (const s of list) {
                const sig = s.suggestion || '无';
                sigCount[sig] = (sigCount[sig] || 0) + 1;
            }
            this.logger.log(`📦 Step③收到升级信号: ${list.length}只, 分布=${JSON.stringify(sigCount)}, 前5=${list.slice(0, 5).map(s => s.code + '-' + s.suggestion).join(',')}`);
            this.gemScreener.updateUpgradedCache(list);
            this.gemScreener.setUpgradedSnapshot(list);
            const debugCodes = ['300260', '300749', '300088', '300321', '001335', '002456'];
            const allData = this.gemScreener.getCacheAll();
            if (allData?.length) {
                const debugInfo = debugCodes.map(c => {
                    const s = allData.find(x => x.code === c);
                    return s ? `${c}-${s.name}-${s.suggestion}-${s.currentPrice}` : `${c}-未找到`;
                }).join(' | ');
                this.logger.log(`📦 Step③写入后验证: 缓存共${allData.length}只, 关键股=${debugInfo}`);
            }
            return { code: 200, msg: `updated ${list.length} stocks`, data: list.length };
        }
        catch (e) {
            this.logger.error(`更新升级缓存失败: ${e.message}`);
            return { code: 500, msg: e.message, data: 0 };
        }
    }
    async getUpgradedSnapshot() {
        const data = this.gemScreener.getUpgradedSnapshot();
        return { code: 200, msg: 'ok', data: data?.list || [], updatedAt: data?.timestamp || 0 };
    }
    async getCloudSnapshotUrl() {
        const url = this.gemScreener.cloudSnapshotUrl || '';
        const snap = this.gemScreener.getUpgradedSnapshot();
        return { code: 200, msg: 'ok', data: { url, timestamp: snap?.timestamp || 0, count: snap?.list?.length || 0 } };
    }
    async refreshAll(body) {
        const opportunities = await this.gemScreener.scanAllWithFrontendData(body.stocks);
        return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
    }
    async syncSellState(body) {
        try {
            this.gemScreener.syncSellStateFromFrontend(body.sellStates || []);
            return { code: 200, msg: 'success' };
        }
        catch (e) {
            return { code: 500, msg: e.message };
        }
    }
    async syncCache(body) {
        if (!body.stocks || !body.stocks.length) {
            return { code: 400, msg: '无数据' };
        }
        const count = await this.gemScreener.syncUpgradedCache(body.stocks);
        return { code: 200, msg: `同步 ${count} 只`, data: { count } };
    }
    async rescanBatch(body) {
        if (!body.codes || !body.codes.length) {
            return { code: 400, msg: '请提供股票代码列表', data: [] };
        }
        this.logger.log(`批量分析: ${body.codes.length} 只股票`);
        const results = [];
        for (let i = 0; i < body.codes.length; i++) {
            const code = body.codes[i];
            const name = body.names?.[i] || '';
            try {
                const opp = await Promise.race([
                    this.gemScreener.quickAnalyze(code, name, true),
                    new Promise(resolve => setTimeout(() => resolve(null), 10000))
                ]);
                if (opp)
                    results.push(opp);
            }
            catch { }
        }
        const PRIORITY = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '减仓': 4, '卖出': 5, '不要介入': 6 };
        results.sort((a, b) => {
            const pa = PRIORITY[a.suggestion || '持有'] ?? 9;
            const pb = PRIORITY[b.suggestion || '持有'] ?? 9;
            if (pa !== pb)
                return pa - pb;
            return (b.score || 0) - (a.score || 0);
        });
        this.logger.log(`批量分析完成: ${results.length} 只有效结果`);
        return { code: 200, msg: 'ok', data: results.slice(0, 30) };
    }
    async proxyStockList(node, page, num, sort, asc) {
        return { code: 200, msg: 'success', data: [] };
    }
    async proxyEastMoneyList(node, page, num) {
        return { code: 200, msg: 'success', data: [] };
    }
    async proxySearch(query, count) {
        if (!query || !query.trim()) {
            return { code: 400, msg: '缺少搜索关键词' };
        }
        return { code: 200, msg: 'success', data: [] };
    }
    async proxySinaUS(code) {
        if (!code || !code.trim()) {
            return { code: 400, msg: '缺少股票代码' };
        }
        return { code: 200, msg: 'success', data: '' };
    }
    async proxyKLine(code, market) {
        if (!code)
            return { code: 400, msg: '缺少股票代码', data: [] };
        return { code: 200, msg: 'success', data: [] };
    }
    async proxyStockDetail(code) {
        if (!code)
            return { code: 400, msg: '缺少股票代码', data: null };
        return { code: 200, msg: 'success', data: { volumeRatio: 0, auctionVolume: 0, auctionAmount: 0, auctionUnmatched: 0, auctionDirection: 0 } };
    }
    async recalcCache() {
        const result = await this.gemScreener.recalcCacheSignals();
        return { code: 200, msg: '缓存信号重算完成', data: result };
    }
    async analyzeWithKLine(body) {
        if (!body.code) {
            return { code: 400, msg: '缺少股票代码' };
        }
        if (!body.kline || !Array.isArray(body.kline) || body.kline.length < 5) {
            const fallbackOpp = { code: body.code, name: body.name || '', suggestion: '持有', score: 5, entryTiming: 0, currentPrice: body.price || 0, changePercent: body.changePercent || 0, pricePosition: 0, priceIncrease: 0, mainForceInflow: 0, baiXiaoDays: 0, capitalRank: 0, safetyScore: 0, trade: body.price || 0, price: body.price || 0, changepercent: body.changePercent || 0, inflow: 0, timestamp: Date.now() };
            this.gemScreener.updateSingleStockInCache(fallbackOpp).catch(() => { });
            return { code: 200, msg: '已缓存基础数据（无K线）', data: [fallbackOpp] };
        }
        try {
            const klineData = body.kline.map((item) => ({
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
                this.gemScreener.recalculateSuggestions([opp]);
                this.gemScreener.updateSingleStockInCache(opp).catch(e => this.logger.warn(`更新缓存失败: ${e.message}`));
                return { code: 200, msg: 'success', data: [opp] };
            }
            const fallbackOpp = { code: body.code, name: body.name || '', suggestion: '持有', score: 0, entryTiming: 0, currentPrice: 0, changePercent: 0, pricePosition: 0, priceIncrease: 0, mainForceInflow: 0, baiXiaoDays: 0, capitalRank: 0, safetyScore: 0 };
            this.gemScreener.updateSingleStockInCache(fallbackOpp).catch(() => { });
            return { code: 200, msg: '分析完成', data: [{ code: body.code, name: body.name || '', suggestion: '持有', score: 0 }] };
        }
        catch (e) {
            this.logger.error(`K线分析失败: ${e.message}`);
            return { code: 500, msg: `K线分析失败: ${e.message}`, data: null };
        }
    }
    async intradayAnalyze(body) {
        if (!body.code)
            return { code: 400, msg: '缺少股票代码' };
        if (!body.kline || !Array.isArray(body.kline) || body.kline.length < 50) {
            return { code: 200, msg: '分钟K线数据不足', data: { status: '数据不足', suggestions: [] } };
        }
        try {
            const result = await this.gemScreener.doIntradayAnalysis(body.code, body.kline);
            return { code: 200, msg: 'success', data: result };
        }
        catch (e) {
            this.logger.error(`日内分析失败: ${e.message}`);
            return { code: 500, msg: `日内分析失败: ${e.message}`, data: null };
        }
    }
    async backtest() {
        try {
            const result = await this.gemScreener.runBacktest();
            return { code: 200, msg: 'success', data: result };
        }
        catch (e) {
            return { code: 500, msg: e.message };
        }
    }
    async backtestForecast() {
        try {
            const result = await this.gemScreener.runForecastBacktest();
            return { code: 200, msg: 'success', data: result };
        }
        catch (e) {
            return { code: 500, msg: e.message };
        }
    }
    async clearCache() {
        this.gemScreener.clearCache();
        return { code: 200, msg: '缓存已清空，可重新搜索或扫描覆盖' };
    }
    async technicalAnalysis(code) {
        if (!code)
            return { code: 400, msg: '缺少股票代码', data: null };
        try {
            const result = await this.gemScreener.technicalAnalysis(code);
            return { code: 200, msg: 'success', data: result };
        }
        catch (e) {
            this.logger.warn(`技术指标分析失败 ${code}: ${e.message}`);
            return { code: 500, msg: e.message, data: null };
        }
    }
    async intradayAnalysis(code) {
        if (!code)
            return { code: 400, msg: '缺少股票代码', data: null };
        try {
            const result = await this.gemScreener.intradayAnalysis(code);
            return { code: 200, msg: 'success', data: result };
        }
        catch (e) {
            this.logger.warn(`日内分析失败 ${code}: ${e.message}`);
            return { code: 500, msg: e.message, data: null };
        }
    }
    async auctionTrend(code) {
        if (!code)
            return { code: 400, msg: '缺少股票代码', data: null };
        try {
            const data = await this.gemScreener.fetchAuctionTrend(code);
            return { code: 200, msg: 'success', data };
        }
        catch (e) {
            this.logger.warn(`获取竞价走势失败 ${code}: ${e.message}`);
            return { code: 500, msg: e.message, data: null };
        }
    }
};
exports.GemScreenerController = GemScreenerController;
__decorate([
    (0, common_1.Get)('market-state'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getMarketState", null);
__decorate([
    (0, common_1.Get)('price-stream'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "priceStream", null);
__decorate([
    (0, common_1.Get)('watched-codes'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getWatchedCodes", null);
__decorate([
    (0, common_1.Post)('tencent-proxy'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "tencentProxy", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshWithData", null);
__decorate([
    (0, common_1.Post)('refresh-main-board'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshMainBoard", null);
__decorate([
    (0, common_1.Post)('refresh-sector'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshSector", null);
__decorate([
    (0, common_1.Post)('refresh-heavy-buy'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshHeavyBuy", null);
__decorate([
    (0, common_1.Get)('opportunities'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getOpportunities", null);
__decorate([
    (0, common_1.Get)('main-board'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getMainBoard", null);
__decorate([
    (0, common_1.Get)('top/gem'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopGem", null);
__decorate([
    (0, common_1.Get)('top/main-board'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopMainBoard", null);
__decorate([
    (0, common_1.Get)('cache-all'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getCacheAll", null);
__decorate([
    (0, common_1.Get)('top/combined'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getCombinedTop", null);
__decorate([
    (0, common_1.Get)('top/opportunities'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopOpportunities", null);
__decorate([
    (0, common_1.Get)('top/sector'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopSector", null);
__decorate([
    (0, common_1.Get)('top/heavy-buy'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getHeavyBuy", null);
__decorate([
    (0, common_1.Get)('industry-sectors/top10'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getIndustrySectorsTop10", null);
__decorate([
    (0, common_1.Post)('seed-cache'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "seedCache", null);
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "searchStock", null);
__decorate([
    (0, common_1.Post)('cache-data'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "cacheData", null);
__decorate([
    (0, common_1.Get)('scan-result'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getScanResult", null);
__decorate([
    (0, common_1.Get)('rescan'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "rescanMarket", null);
__decorate([
    (0, common_1.Post)('update-upgraded'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "updateUpgraded", null);
__decorate([
    (0, common_1.Get)('upgraded-snapshot'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getUpgradedSnapshot", null);
__decorate([
    (0, common_1.Get)('cloud-snapshot-url'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getCloudSnapshotUrl", null);
__decorate([
    (0, common_1.Post)('refresh-all'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshAll", null);
__decorate([
    (0, common_1.Post)('sync-sell-state'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "syncSellState", null);
__decorate([
    (0, common_1.Post)('sync-cache'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "syncCache", null);
__decorate([
    (0, common_1.Post)('rescan-batch'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "rescanBatch", null);
__decorate([
    (0, common_1.Get)('proxy/stock-list'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('node')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('num')),
    __param(3, (0, common_1.Query)('sort')),
    __param(4, (0, common_1.Query)('asc')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "proxyStockList", null);
__decorate([
    (0, common_1.Get)('proxy/eastmoney-list'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('node')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('num')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "proxyEastMoneyList", null);
__decorate([
    (0, common_1.Get)('proxy/search'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('q')),
    __param(1, (0, common_1.Query)('count')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "proxySearch", null);
__decorate([
    (0, common_1.Get)('proxy/sina-us'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "proxySinaUS", null);
__decorate([
    (0, common_1.Get)('proxy/kline'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "proxyKLine", null);
__decorate([
    (0, common_1.Get)('proxy/stock-detail'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "proxyStockDetail", null);
__decorate([
    (0, common_1.Post)('recalc'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "recalcCache", null);
__decorate([
    (0, common_1.Post)('analyze'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "analyzeWithKLine", null);
__decorate([
    (0, common_1.Post)('intraday-analyze'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "intradayAnalyze", null);
__decorate([
    (0, common_1.Get)('backtest'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "backtest", null);
__decorate([
    (0, common_1.Get)('backtest-forecast'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "backtestForecast", null);
__decorate([
    (0, common_1.Get)('clear-cache'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "clearCache", null);
__decorate([
    (0, common_1.Get)('technical-analysis'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "technicalAnalysis", null);
__decorate([
    (0, common_1.Get)('intraday-analysis'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "intradayAnalysis", null);
__decorate([
    (0, common_1.Get)('auction-trend'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Query)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "auctionTrend", null);
exports.GemScreenerController = GemScreenerController = GemScreenerController_1 = __decorate([
    (0, common_1.Controller)('gem'),
    __metadata("design:paramtypes", [gem_screener_service_1.GemScreenerService,
        gem_screener_scheduler_1.GemScreenerScheduler,
        stock_service_1.StockService])
], GemScreenerController);
