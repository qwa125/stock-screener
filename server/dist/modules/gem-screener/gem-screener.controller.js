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
const iconv = require("iconv-lite");
const fs_1 = require("fs");
const path_1 = require("path");
const data_1 = require("../../industry-sectors/data");
let GemScreenerController = GemScreenerController_1 = class GemScreenerController {
    constructor(gemScreener, scheduler) {
        this.gemScreener = gemScreener;
        this.scheduler = scheduler;
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
                const BATCH = 30;
                const allPrices = [];
                const codeCopy = [...codes];
                for (let i = 0; i < codeCopy.length; i += BATCH) {
                    const batch = codeCopy.slice(i, i + BATCH);
                    const q = batch.map(c => (c.startsWith('6') ? 'sh' : 'sz') + c).join(',');
                    const url = `https://qt.gtimg.cn/q=${q}`;
                    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
                    const buf = Buffer.from(await resp.arrayBuffer());
                    const txt = buf.toString('utf-8');
                    for (const line of txt.split(';')) {
                        if (!line.trim() || !line.includes('='))
                            continue;
                        const parts = line.split('~');
                        if (parts.length >= 7) {
                            const fullCode = line.match(/v_([a-z]+_\w+)/)?.[1] || '';
                            const shortCode = fullCode.replace(/^(sh|sz|sh)/, '');
                            allPrices.push({
                                code: shortCode,
                                name: parts[1] || '',
                                price: parseFloat(parts[3]) || 0,
                                changePercent: parseFloat(parts[parts.length < 10 ? 4 : 5]) || 0,
                                high: parseFloat(parts[33]) || 0,
                                low: parseFloat(parts[34]) || 0,
                                volume: parts[6] || '0',
                            });
                        }
                    }
                }
                if (!closed) {
                    res.write(`data: ${JSON.stringify({ marketStatus: 'trading', prices: allPrices, timestamp: Date.now() })}\n\n`);
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
        const url = 'https://qt.gtimg.cn/q=' + encodeURIComponent(body.q);
        const res = await fetch(url);
        const buf = Buffer.from(await res.arrayBuffer());
        const txt = iconv.decode(buf, 'gbk');
        return { code: 200, msg: 'success', data: { text: txt } };
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
        const signalOrder = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '观望': 4 };
        const sorted = deduped
            .filter(s => s.suggestion && ['重仓买入', '买入', '轻仓买入', '持有', '观望'].includes(s.suggestion))
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
    async rescanMarket() {
        try {
            const results = await this.gemScreener.rescanMarket();
            return { code: 200, msg: 'ok', data: results };
        }
        catch (e) {
            this.logger.error(`重扫失败: ${e.message}`);
            return { code: 500, msg: e.message, data: [] };
        }
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
        const PRIORITY = { '重仓买入': 0, '买入': 1, '轻仓买入': 2, '持有': 3, '观望': 4 };
        results.sort((a, b) => {
            const pa = PRIORITY[a.suggestion || '观望'] ?? 9;
            const pb = PRIORITY[b.suggestion || '观望'] ?? 9;
            if (pa !== pb)
                return pa - pb;
            return (b.score || 0) - (a.score || 0);
        });
        this.logger.log(`批量分析完成: ${results.length} 只有效结果`);
        return { code: 200, msg: 'ok', data: results.slice(0, 30) };
    }
    async proxyStockList(node, page, num, sort, asc) {
        try {
            const nodes = ['hs_a', 'cyb', 'gem'];
            const safeNode = node && nodes.includes(node) ? node : 'hs_a';
            const safePage = parseInt(page || '1', 10);
            const safeNum = Math.min(parseInt(num || '80', 10), 100);
            const safeSort = sort || 'amount';
            const safeAsc = asc || '0';
            const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${safePage}&num=${safeNum}&sort=${safeSort}&asc=${safeAsc}&node=${safeNode}`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
            const text = await resp.text();
            let data;
            try {
                data = JSON.parse(text);
            }
            catch {
                data = [];
            }
            return { code: 200, msg: 'success', data };
        }
        catch (e) {
            this.logger.error(`代理新浪股票列表失败: ${e.message}`);
            return { code: 500, msg: '新浪API请求失败', data: [] };
        }
    }
    async proxyEastMoneyList(node, page, num) {
        try {
            const fsMap = {
                hs_a: 'm:0+t:6',
                cyb: 'm:0+t:80',
                gem: 'm:0+t:80',
                all: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81',
            };
            const safeNode = node && fsMap[node] ? node : 'hs_a';
            const safePage = parseInt(page || '1', 10);
            const safeNum = Math.min(parseInt(num || '100', 10), safeNode === 'all' ? 5000 : 200);
            const url = `https://push2.eastmoney.com/api/qt/clist/get?fltt=2&fields=f12,f14,f2,f3,f62,f184,f15,f16,f17,f18,f20&pn=${safePage}&pz=${safeNum}&po=1&np=1&fid=f3&fs=${fsMap[safeNode]}&ut=bd1d9ddb04089700cf9c27f6f7426281`;
            const resp = await fetch(url, {
                signal: AbortSignal.timeout(15000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Referer: 'https://quote.eastmoney.com/',
                },
            });
            const json = await resp.json();
            const data = (json?.data?.diff || []).map((item) => ({
                symbol: String(item.f12 || ''),
                name: item.f14 || '',
                trade: item.f2,
                changePercent: item.f3,
                inflow: item.f62,
                inflowAmount: item.f184,
                high: item.f15,
                low: item.f16,
                open: item.f17,
                prevClose: item.f18,
                marketCap: item.f20,
            }));
            return { code: 200, msg: 'success', data };
        }
        catch (e) {
            this.logger.error(`代理东方财富列表失败: ${e.message}`);
            return { code: 500, msg: '东方财富API请求失败', data: [] };
        }
    }
    async proxySearch(query) {
        if (!query || !query.trim()) {
            return { code: 400, msg: '缺少搜索关键词' };
        }
        try {
            const url = `https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query.trim())}&type=14&token=D43BF722C8E14A9C61B0D6E303FC9C19`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
            const data = await resp.json();
            const results = data?.QuotationCodeTable?.Data || [];
            return { code: 200, msg: 'success', data: results };
        }
        catch (e) {
            this.logger.error(`代理搜索失败: ${e.message}`);
            return { code: 500, msg: '搜索请求失败', data: [] };
        }
    }
    async proxySinaUS(code) {
        if (!code || !code.trim()) {
            return { code: 400, msg: '缺少股票代码' };
        }
        try {
            const url = `https://hq.sinajs.cn/list=gb_${encodeURIComponent(code.trim().toLowerCase())}`;
            const resp = await fetch(url, {
                headers: { Referer: 'https://finance.sina.com.cn' },
                signal: AbortSignal.timeout(10000)
            });
            const buf = await resp.arrayBuffer();
            const txt = new TextDecoder('gb18030').decode(buf);
            return { code: 200, msg: 'success', data: txt };
        }
        catch (e) {
            this.logger.error(`代理新浪美股失败: ${e.message}`);
            return { code: 500, msg: '新浪美股API请求失败', data: '' };
        }
    }
    async proxyKLine(code, market) {
        if (!code)
            return { code: 400, msg: '缺少股票代码', data: [] };
        const secId = (market || (code.startsWith('6') ? '1.' : '0.')) + code;
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get2?secid=${secId}&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=500`;
        try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
            const json = await resp.json();
            const klines = json?.data?.klines;
            if (klines && klines.length > 0) {
                const data = klines.map((l) => {
                    const p = l.split(',');
                    return { day: p[0], open: parseFloat(p[1]), close: parseFloat(p[2]), high: parseFloat(p[3]), low: parseFloat(p[4]), volume: parseFloat(p[5]), amount: parseFloat(p[6]) || 0 };
                });
                return { code: 200, msg: 'success', data };
            }
            const prefix = market || (code.startsWith('6') ? 'sh' : 'sz');
            const tkUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${code},day,,,120,qfq`;
            const tkResp = await fetch(tkUrl, { signal: AbortSignal.timeout(8000) });
            const tkJson = await tkResp.json();
            const tkArr = tkJson?.data?.[code]?.day || tkJson?.data?.[prefix + code]?.qfqday || tkJson?.data?.[code]?.qfqday;
            if (tkArr && tkArr.length > 0) {
                const data = tkArr.map((l) => {
                    if (Array.isArray(l))
                        return { day: l[0], open: parseFloat(l[1]), close: parseFloat(l[2]), high: parseFloat(l[3]), low: parseFloat(l[4]), volume: parseFloat(l[5]) };
                    const d = String(l).split(' ');
                    return { day: d[0], open: parseFloat(d[1]), close: parseFloat(d[2]), high: parseFloat(d[3]), low: parseFloat(d[4]), volume: parseFloat(d[5]) };
                });
                return { code: 200, msg: 'success', data };
            }
            return { code: 404, msg: '未找到K线数据', data: [] };
        }
        catch (e) {
            this.logger.warn(`代理K线失败 ${code}: ${e.message}`);
            try {
                const prefix = market || (code.startsWith('6') ? 'sh' : 'sz');
                const tkUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${code},day,,,120,qfq`;
                const tkResp = await fetch(tkUrl, { signal: AbortSignal.timeout(8000) });
                const tkJson = await tkResp.json();
                const tkArr = tkJson?.data?.[code]?.day || tkJson?.data?.[prefix + code]?.qfqday || tkJson?.data?.[code]?.qfqday;
                if (tkArr && tkArr.length > 0) {
                    const data = tkArr.map((l) => {
                        if (Array.isArray(l))
                            return { day: l[0], open: parseFloat(l[1]), close: parseFloat(l[2]), high: parseFloat(l[3]), low: parseFloat(l[4]), volume: parseFloat(l[5]) };
                        const d = String(l).split(' ');
                        return { day: d[0], open: parseFloat(d[1]), close: parseFloat(d[2]), high: parseFloat(d[3]), low: parseFloat(d[4]), volume: parseFloat(d[5]) };
                    });
                    return { code: 200, msg: 'success', data };
                }
            }
            catch (e2) { }
            return { code: 500, msg: '所有K线源均不可用', data: [] };
        }
    }
    async analyzeWithKLine(body) {
        if (!body.code || !body.kline || !Array.isArray(body.kline)) {
            return { code: 400, msg: '缺少股票代码或K线数据' };
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
                return { code: 200, msg: 'success', data: [opp] };
            }
            return { code: 200, msg: '分析完成', data: [{ code: body.code, name: body.name || '', suggestion: '观望', score: 0 }] };
        }
        catch (e) {
            this.logger.error(`K线分析失败: ${e.message}`);
            return { code: 500, msg: `K线分析失败: ${e.message}`, data: null };
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
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshWithData", null);
__decorate([
    (0, common_1.Post)('refresh-main-board'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshMainBoard", null);
__decorate([
    (0, common_1.Post)('refresh-sector'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshSector", null);
__decorate([
    (0, common_1.Post)('refresh-heavy-buy'),
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
    (0, common_1.Get)('rescan'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "rescanMarket", null);
__decorate([
    (0, common_1.Post)('refresh-all'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshAll", null);
__decorate([
    (0, common_1.Post)('sync-sell-state'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "syncSellState", null);
__decorate([
    (0, common_1.Post)('rescan-batch'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "rescanBatch", null);
__decorate([
    (0, common_1.Get)('proxy/stock-list'),
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
    __param(0, (0, common_1.Query)('node')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('num')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "proxyEastMoneyList", null);
__decorate([
    (0, common_1.Get)('proxy/search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "proxySearch", null);
__decorate([
    (0, common_1.Get)('proxy/sina-us'),
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
    (0, common_1.Post)('analyze'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "analyzeWithKLine", null);
exports.GemScreenerController = GemScreenerController = GemScreenerController_1 = __decorate([
    (0, common_1.Controller)('gem'),
    __metadata("design:paramtypes", [gem_screener_service_1.GemScreenerService,
        gem_screener_scheduler_1.GemScreenerScheduler])
], GemScreenerController);
