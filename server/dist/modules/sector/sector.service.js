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
var SectorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SectorService = void 0;
const common_1 = require("@nestjs/common");
const https = require("node:https");
const iconvlite = require("iconv-lite");
const fs_1 = require("fs");
const node_path_1 = require("node:path");
const data_fetcher_service_1 = require("../stock/data-fetcher.service");
const formula_engine_1 = require("../stock/formula-engine");
const market_time_1 = require("../../utils/market-time");
const gem_screener_service_1 = require("../gem-screener/gem-screener.service");
const bai_xing_1 = require("../stock/bai-xing");
const bai_san_jiao_1 = require("../stock/bai-san-jiao");
function getLastMarketCloseTime() {
    const now = new Date();
    const bjNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const day = bjNow.getUTCDay();
    const hours = bjNow.getUTCHours();
    const todayClose = new Date(Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), bjNow.getUTCDate(), 15, 0, 0, 0));
    if (day >= 1 && day <= 5) {
        if (hours > 15 || (hours === 15))
            return todayClose.getTime();
        const prev = new Date(todayClose);
        do {
            prev.setUTCDate(prev.getUTCDate() - 1);
        } while (prev.getUTCDay() === 0 || prev.getUTCDay() === 6);
        prev.setUTCHours(15, 0, 0, 0);
        return prev.getTime();
    }
    const friday = new Date(todayClose);
    friday.setUTCDate(friday.getUTCDate() - (day === 6 ? 1 : 2));
    friday.setUTCHours(15, 0, 0, 0);
    return friday.getTime();
}
const SW_SECTORS = [
    '801012', '801014', '801015', '801016', '801017', '801018', '801032', '801033', '801034', '801036',
    '801037', '801038', '801039', '801043', '801044', '801045', '801051', '801053', '801054', '801055',
    '801056', '801072', '801074', '801076', '801077', '801078', '801081', '801082', '801083', '801084',
    '801085', '801086', '801092', '801093', '801095', '801096', '801101', '801102', '801103', '801104',
    '801111', '801112', '801113', '801114', '801115', '801116', '801124', '801125', '801126', '801127',
    '801128', '801129', '801131', '801132', '801133', '801141', '801142', '801143', '801145', '801151',
    '801992', '801993', '801994', '801995',
];
const SECTOR_NAMES = {
    '801012': '农产品加工', '801014': '饲料', '801015': '渔业', '801016': '种植业', '801017': '养殖业',
    '801018': '动物保健Ⅱ', '801032': '化学纤维', '801033': '化学原料', '801034': '化学制品',
    '801036': '塑料', '801037': '橡胶', '801038': '农化制品', '801039': '非金属材料Ⅱ',
    '801043': '冶钢原料', '801044': '普钢', '801045': '特钢Ⅱ', '801051': '金属新材料',
    '801053': '贵金属', '801054': '小金属', '801055': '工业金属', '801056': '能源金属',
    '801072': '通用设备', '801074': '专用设备', '801076': '轨交设备Ⅱ', '801077': '工程机械',
    '801078': '自动化设备', '801081': '半导体', '801082': '其他电子Ⅱ', '801083': '元件',
    '801084': '光学光电子', '801085': '消费电子', '801086': '电子化学品Ⅱ', '801092': '汽车服务',
    '801093': '汽车零部件', '801095': '乘用车', '801096': '商用车', '801101': '计算机设备',
    '801102': '通信设备', '801103': 'IT服务Ⅱ', '801104': '软件开发', '801111': '白色家电',
    '801112': '黑色家电', '801113': '小家电', '801114': '厨卫电器', '801115': '照明设备Ⅱ',
    '801116': '家电零部件Ⅱ', '801124': '食品加工', '801125': '白酒Ⅱ', '801126': '非白酒',
    '801127': '饮料乳品', '801128': '休闲食品', '801129': '调味发酵品Ⅱ', '801131': '纺织制造',
    '801132': '服装家纺', '801133': '饰品', '801141': '包装印刷', '801142': '家居用品',
    '801143': '造纸', '801145': '文娱用品', '801151': '化学制药', '801152': '生物制品',
    '801153': '医疗器械', '801154': '医药商业', '801155': '中药Ⅱ', '801156': '医疗服务',
    '801161': '电力', '801163': '燃气Ⅱ', '801178': '物流', '801179': '铁路公路',
    '801181': '房地产开发', '801183': '房地产服务', '801191': '多元金融', '801193': '证券Ⅱ',
    '801194': '保险Ⅱ', '801202': '贸易Ⅱ', '801203': '一般零售', '801204': '专业连锁Ⅱ',
    '801206': '互联网电商', '801218': '专业服务', '801219': '酒店餐饮', '801223': '通信服务',
    '801231': '综合Ⅱ', '801711': '水泥', '801712': '玻璃玻纤', '801713': '装修建材',
    '801721': '房屋建设Ⅱ', '801722': '装修装饰Ⅱ', '801723': '基础建设', '801724': '专业工程',
    '801726': '工程咨询服务Ⅱ', '801731': '电机Ⅱ', '801733': '其他电源设备Ⅱ', '801735': '光伏设备',
    '801736': '风电设备', '801737': '电池', '801738': '电网设备', '801741': '航天装备Ⅱ',
    '801742': '航空装备Ⅱ', '801743': '地面兵装Ⅱ', '801744': '航海装备Ⅱ', '801745': '军工电子Ⅱ',
    '801764': '游戏Ⅱ', '801765': '广告营销', '801766': '影视院线', '801767': '数字媒体',
    '801769': '出版', '801782': '国有大型银行Ⅱ', '801783': '股份制银行Ⅱ', '801784': '城商行Ⅱ',
    '801785': '农商行Ⅱ', '801881': '摩托车及其他', '801951': '煤炭开采', '801952': '焦炭Ⅱ',
    '801962': '油服工程', '801963': '炼化及贸易', '801971': '环境治理', '801972': '环保设备Ⅱ',
    '801981': '个护用品', '801982': '化妆品', '801991': '航空机场', '801992': '航运港口',
    '801993': '旅游及景区', '801994': '教育', '801995': '电视广播Ⅱ',
};
const EXCLUDED_SECTORS = new Set(['801782', '801783', '801784', '801785', '801191', '801193', '801194']);
const TRADING_DAYS = {
    month1: 21,
    bestDay: 5,
    quarter1: 63,
    halfYear: 125,
    year1: 250,
};
let SectorService = SectorService_1 = class SectorService {
    constructor(dataFetcher, gemScreener) {
        this.dataFetcher = dataFetcher;
        this.gemScreener = gemScreener;
        this.logger = new common_1.Logger(SectorService_1.name);
        this.agent = new https.Agent({ rejectUnauthorized: false });
        this.cache = null;
        this.loadingPromise = null;
        this.CACHE_TTL = 5 * 60 * 1000;
        this.FROZEN_TTL = 365 * 24 * 60 * 60 * 1000;
        this.CACHE_FILE = '/tmp/sector-cache.json';
        this.refreshing = false;
        this.consCache = new Map();
        this.CONS_CACHE_TTL = 24 * 60 * 60 * 1000;
        this.refreshTimer = null;
    }
    getEffectiveTTL() {
        return (0, market_time_1.isMarketOpen)() ? this.CACHE_TTL : this.FROZEN_TTL;
    }
    saveCacheToDisk() {
        try {
            (0, fs_1.writeFileSync)(this.CACHE_FILE, JSON.stringify(this.cache), 'utf-8');
        }
        catch (err) {
            this.logger.warn(`⚠️ 板块缓存写盘失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    createEmptyResponse() {
        return { month1: [], bestDay: [], quarter1: [], halfYear: [], year1: [], updateTime: '-', timestamp: getLastMarketCloseTime() };
    }
    loadCacheFromDisk() {
        try {
            if ((0, fs_1.existsSync)(this.CACHE_FILE)) {
                const raw = (0, fs_1.readFileSync)(this.CACHE_FILE, 'utf-8');
                this.cache = JSON.parse(raw);
                this.logger.log(`📂 从磁盘恢复板块缓存，更新于 ${new Date(this.cache.timestamp).toLocaleString('zh-CN')}`);
                return;
            }
            const bundledCache = (0, node_path_1.join)(__dirname, '..', '..', '..', 'assets', 'sector-cache.json');
            if ((0, fs_1.existsSync)(bundledCache)) {
                const raw = (0, fs_1.readFileSync)(bundledCache, 'utf-8');
                this.cache = JSON.parse(raw);
                this.logger.log(`📦 从部署包恢复板块缓存，更新于 ${new Date(this.cache.timestamp).toLocaleString('zh-CN')}`);
            }
        }
        catch (err) {
            this.logger.warn(`⚠️ 板块缓存读盘失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async onApplicationBootstrap() {
        this.loadCacheFromDisk();
        if (this.cache) {
            if (!(0, market_time_1.isMarketOpen)()) {
                this.logger.log(`⏸️ 非交易时间，板块数据冻结，使用已有缓存`);
                return;
            }
            this.logger.log('🔄 后台预热板块热点缓存...');
            this.getHotSectors()
                .then(() => this.logger.log('✅ 板块热点缓存预热完成'))
                .catch((err) => this.logger.error(`❌ 板块热点缓存预热失败: ${err instanceof Error ? err.message : String(err)}`));
            return;
        }
        this.logger.log('📦 首次部署/无缓存，后台预热板块数据...');
        this.loadingPromise = this.doRefresh()
            .then((result) => {
            this.cache = { data: result, timestamp: Date.now() };
            this.saveCacheToDisk();
            this.logger.log(`✅ 板块热点缓存预热完成，${result.month1?.length || 0} 个板块`);
        })
            .catch((err) => this.logger.error(`❌ 板块热点预热失败: ${err instanceof Error ? err.message : String(err)}`))
            .finally(() => { this.loadingPromise = null; });
        this.startAutoRefresh();
    }
    startAutoRefresh() {
        if (this.refreshTimer)
            return;
        this.logger.log('⏱️ 启动板块自动刷新定时器（60秒检查间隔）');
        this.refreshTimer = setInterval(async () => {
            if (this.refreshing)
                return;
            if (!(0, market_time_1.isMarketOpen)())
                return;
            if ((0, market_time_1.isAfterMarketClose)())
                return;
            const now = Date.now();
            if (this.cache && now - this.cache.timestamp < this.CACHE_TTL)
                return;
            this.logger.log(`🔄 自动刷新板块数据...`);
            try {
                const result = await this.doRefresh();
                if (this.cache) {
                    const merged = this.mergeSectorData(this.cache.data, result);
                    this.cache = { data: merged, timestamp: now };
                }
                else {
                    this.cache = { data: result, timestamp: now };
                }
                this.saveCacheToDisk();
                this.logger.log(`✅ 自动刷新完成，${result.month1?.length || 0} 个板块`);
            }
            catch (err) {
                this.logger.error(`❌ 自动刷新失败: ${err instanceof Error ? err.message : String(err)}`);
            }
        }, 60_000);
    }
    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
            this.logger.log('⏹️ 板块自动刷新已停止');
        }
    }
    mergeSectorData(oldData, newData) {
        if (!oldData)
            return newData;
        if (!newData)
            return oldData;
        const mergeSectors = (oldList, newList) => {
            const oldMap = new Map();
            for (const item of oldList) {
                oldMap.set(item.name, item);
            }
            for (const item of newList) {
                const existing = oldMap.get(item.name);
                if (!existing) {
                    oldMap.set(item.name, item);
                }
                else {
                    const oldStocks = existing.opportunityStocks || [];
                    const newStocks = item.opportunityStocks || [];
                    const stockMap = new Map();
                    for (const s of oldStocks) {
                        stockMap.set(s.code, s);
                    }
                    for (const s of newStocks) {
                        const existingStock = stockMap.get(s.code);
                        if (!existingStock) {
                            stockMap.set(s.code, s);
                        }
                        else {
                            if ((s.score || 0) > (existingStock.score || 0)) {
                                stockMap.set(s.code, s);
                            }
                        }
                    }
                    const mergedStocks = Array.from(stockMap.values())
                        .sort((a, b) => (b.score || 0) - (a.score || 0))
                        .slice(0, 10);
                    oldMap.set(item.name, { ...existing, opportunityStocks: mergedStocks });
                }
            }
            return Array.from(oldMap.values());
        };
        return {
            month1: mergeSectors(oldData.month1 || [], newData.month1 || []),
            bestDay: newData.bestDay || oldData.bestDay,
            quarter1: mergeSectors(oldData.quarter1 || [], newData.quarter1 || []),
            halfYear: mergeSectors(oldData.halfYear || [], newData.halfYear || []),
            year1: mergeSectors(oldData.year1 || [], newData.year1 || []),
            updateTime: newData.updateTime,
            timestamp: newData.timestamp,
        };
    }
    async getHotSectors() {
        const ttl = this.getEffectiveTTL();
        if (this.cache?.data?.month1?.length) {
            if (!this.refreshing) {
                this.refreshing = true;
                this.doRefresh().then(data => {
                    this.cache = { data, timestamp: Date.now() };
                    this.saveCacheToDisk();
                }).catch(() => { }).finally(() => { this.refreshing = false; });
            }
            return this.cache.data;
        }
        if (this.cache && Date.now() - this.cache.timestamp < ttl) {
            return this.cache.data;
        }
        if (!(0, market_time_1.isMarketOpen)()) {
            const cached = this.cache;
            if (cached) {
                const allOppsEmpty = (cached.data?.month1 || []).every((s) => !(s.opportunityStocks?.length > 0));
                if (allOppsEmpty) {
                    this.logger.log('🔄 机会股为空，非交易时段强制刷新板块数据...');
                    if (!this.refreshing)
                        this.refreshCacheInBackground();
                }
                return cached.data;
            }
            this.loadCacheFromDisk();
            const diskCache = this.cache;
            if (diskCache)
                return diskCache.data;
            if (this.loadingPromise) {
                this.logger.log('⏳ 板块数据预加载中（等待最多10秒）...');
                const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000));
                try {
                    await Promise.race([this.loadingPromise, timeout]);
                    const loaded = this.cache;
                    if (loaded)
                        return loaded.data;
                }
                catch {
                    this.logger.log('⏱️ 预加载超时，返回空数据（后台继续加载）');
                }
            }
            else {
                this.loadingPromise = this.doRefresh()
                    .then(result => {
                    this.cache = { data: result, timestamp: Date.now() };
                    this.saveCacheToDisk();
                    this.logger.log('✅ 板块热点后台加载完成');
                })
                    .catch(err => {
                    this.logger.error(`❌ 板块热点加载失败: ${err instanceof Error ? err.message : String(err)}`);
                });
            }
            const emptyResult = {
                month1: [], bestDay: [], quarter1: [], halfYear: [], year1: [],
                updateTime: this.formatDateTime(new Date()),
                timestamp: getLastMarketCloseTime(),
            };
            this.cache = { data: emptyResult, timestamp: Date.now() };
            return emptyResult;
        }
        if (this.loadingPromise) {
            this.logger.log('⏳ 板块数据首次预热中（等待最多30秒）...');
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30_000));
            try {
                await Promise.race([this.loadingPromise, timeout]);
                const loaded = this.cache;
                if (loaded)
                    return loaded.data;
                this.logger.log('⚠️ 板块数据预热未完成，使用空数据');
            }
            catch {
                this.logger.log('⏱️ 板块数据预加载超时（30秒），返回空数据，后台继续加载');
            }
        }
        if (this.cache && !this.refreshing) {
            this.refreshCacheInBackground();
            return this.cache.data;
        }
        if (!this.cache) {
            const emptyResult = {
                month1: [], bestDay: [], quarter1: [], halfYear: [], year1: [],
                updateTime: this.formatDateTime(new Date()),
                timestamp: getLastMarketCloseTime(),
            };
            this.cache = { data: emptyResult, timestamp: Date.now() };
            if (!this.refreshing)
                this.refreshCacheInBackground();
            return emptyResult;
        }
        this.logger.log('开始获取板块热点数据...');
        return this.doRefresh();
    }
    refreshCacheInBackground() {
        if (this.refreshing)
            return;
        if (!(0, market_time_1.isMarketOpen)()) {
            this.logger.log('⏸️ 非交易时段，跳过板块热点刷新');
            return;
        }
        this.refreshing = true;
        this.logger.log('🔄 后台刷新板块热点缓存...');
        this.doRefresh()
            .then((data) => {
            this.cache = { data, timestamp: Date.now() };
            this.saveCacheToDisk();
            this.logger.log('✅ 后台刷新板块热点缓存完成');
            this.refreshing = false;
        })
            .catch((err) => {
            this.logger.error(`❌ 后台刷新板块热点缓存失败: ${err instanceof Error ? err.message : String(err)}`);
            this.refreshing = false;
        });
    }
    async doRefresh() {
        const klineMap = await this.fetchAllSectorKLines();
        const realtimeMap = await this.fetchRealtimePrices();
        const calcRank = async (days) => {
            const items = [];
            for (const code of SW_SECTORS) {
                if (EXCLUDED_SECTORS.has(code))
                    continue;
                const klines = klineMap.get(code);
                if (!klines || klines.length < days + 2)
                    continue;
                const lastIdx = klines.length - 1;
                const prevIdx = lastIdx - days;
                const current = klines[lastIdx].close;
                const previous = klines[prevIdx].close;
                if (previous === 0)
                    continue;
                const changePercent = ((current - previous) / previous) * 100;
                const realtime = realtimeMap.get(code);
                items.push({
                    code,
                    name: SECTOR_NAMES[code] || code,
                    price: realtime ?? current,
                    changePercent: Math.round(changePercent * 100) / 100,
                    changeAmount: Math.round((current - previous) * 100) / 100,
                    leadingStocks: [],
                    opportunityStocks: [],
                });
            }
            items.sort((a, b) => b.changePercent - a.changePercent);
            const topN = items.slice(0, 30);
            await this.fillLeadingStocks(topN, this.cache?.data);
            const topForResponse = items.slice(0, 10);
            if (this.cache?.data) {
                for (const sector of topForResponse) {
                    const oldSector = this.cache.data.month1.find(o => o.code === sector.code);
                    if (oldSector?.opportunityStocks?.length) {
                        const merged = new Map();
                        for (const s of oldSector.opportunityStocks)
                            merged.set(s.code, s);
                        for (const s of sector.opportunityStocks) {
                            const existing = merged.get(s.code);
                            if (!existing || (existing.score ?? 0) < (s.score ?? 0))
                                merged.set(s.code, s);
                        }
                        sector.opportunityStocks = Array.from(merged.values())
                            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                            .slice(0, 10);
                    }
                }
            }
            return topForResponse;
        };
        return {
            month1: await calcRank(TRADING_DAYS.month1),
            bestDay: await calcRank(TRADING_DAYS.bestDay),
            quarter1: await calcRank(TRADING_DAYS.quarter1),
            halfYear: await calcRank(TRADING_DAYS.halfYear),
            year1: await calcRank(TRADING_DAYS.year1),
            updateTime: this.formatDateTime(new Date()),
            timestamp: getLastMarketCloseTime(),
        };
    }
    async fillLeadingStocks(sectors, _oldData) {
        const promises = sectors.map(async (sector) => {
            try {
                const result = await this.getLeadingStocks(sector.code);
                sector.leadingStocks = result.leading;
                sector.opportunityStocks = result.opportunity;
            }
            catch (err) {
                this.logger.warn(`获取板块 ${sector.code} 龙头股失败: ${err instanceof Error ? err.message : String(err)}`);
                sector.leadingStocks = [];
                sector.opportunityStocks = [];
            }
        });
        await Promise.allSettled(promises);
    }
    async getLeadingStocks(sectorCode) {
        const constituents = await this.getSectorConstituents(sectorCode);
        if (constituents.length === 0)
            return { leading: [], opportunity: [] };
        const quotes = await this.fetchStockQuotes(constituents.slice(0, 20).map(s => s.code));
        const stocksWithQuote = constituents.slice(0, 20).map(stock => {
            const quote = quotes.get(stock.code);
            return { code: stock.code, name: stock.name, price: quote?.price ?? 0, changePercent: quote?.changePercent ?? 0, weight: stock.weight };
        });
        const leading = stocksWithQuote.slice(0, 4).map(s => ({
            code: s.code, name: s.name, price: s.price, changePercent: s.changePercent, weight: s.weight, isGoldenCross: false,
        }));
        const topN = constituents.slice(0, 50);
        const richQuotes = await this.fetchStockQuotes(topN.map(s => s.code));
        const opportunity = [];
        const CONCURRENCY = 10;
        for (let i = 0; i < topN.length; i += CONCURRENCY) {
            const batch = topN.slice(i, i + CONCURRENCY);
            const promises = batch.map(async (stock) => {
                try {
                    const quote = richQuotes.get(stock.code);
                    if (!quote)
                        return null;
                    const candidate = {
                        code: stock.code,
                        name: stock.name,
                        inflow: quote.inflow,
                        changePercent: quote.changePercent,
                        currentPrice: quote.price,
                        marketCap: quote.marketCap,
                    };
                    let result = null;
                    result = await this.gemScreener.checkOpportunity(candidate);
                    if (!result)
                        result = await this.gemScreener.checkOpportunityRelaxed(candidate);
                    if (!result)
                        return null;
                    return {
                        code: result.code, name: result.name, price: result.currentPrice,
                        changePercent: result.changePercent, weight: 0,
                        priceIncrease: result.priceIncrease, pricePosition: result.pricePosition,
                        mainForceInflow: result.mainForceInflow, score: result.score,
                        baiXiaoDays: result.baiXiaoDays, diff: result.diff, dea: result.dea,
                        isGoldenCross: result.isGoldenCross,
                        buySignal: result.buySignal,
                    };
                }
                catch {
                    return null;
                }
            });
            const batchResults = await Promise.allSettled(promises);
            for (const r of batchResults) {
                if (r.status === 'fulfilled' && r.value)
                    opportunity.push(r.value);
            }
        }
        opportunity.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        this.logger.log(`📊 板块 ${sectorCode}: ${Math.min(opportunity.length, 10)} 只机会股`);
        return { leading, opportunity: opportunity.slice(0, 10) };
    }
    async checkBaiXiaoBatch(stocks) {
        const map = new Map();
        const CONCURRENCY = 12;
        for (let i = 0; i < stocks.length; i += CONCURRENCY) {
            const batch = stocks.slice(i, i + CONCURRENCY);
            const promises = batch.map(async (stock) => {
                try {
                    const result = await this.checkSingleBaiXiao(stock.code);
                    map.set(stock.code, result);
                }
                catch {
                    map.set(stock.code, { baiXiao: false, baiXiaoDays: 999, bestBuy: false, isRisk: false });
                }
            });
            await Promise.allSettled(promises);
        }
        return map;
    }
    async checkSingleBaiXiao(code) {
        const klines = await this.dataFetcher.getKLineData(code);
        if (klines.length < 60) {
            return { baiXiao: false, baiXiaoDays: 999, bestBuy: false, isRisk: false };
        }
        const engine = new formula_engine_1.FormulaEngine({
            open: klines.map(k => k.open),
            close: klines.map(k => k.close),
            high: klines.map(k => k.high),
            low: klines.map(k => k.low),
            volume: klines.map(k => k.volume),
            amount: klines.map(k => k.amount),
        });
        const baiSanJiao = (0, bai_san_jiao_1.calcBaiSanJiao)(engine);
        const baiXing = (0, bai_xing_1.calcBaiXing)(engine);
        if (baiXing.baiXiao) {
            this.logger.log(`🔍 ${code} 白消检测: days=${baiXing.baiXiaoDays}`);
        }
        const sellSignals = [
            baiSanJiao.strongSell,
            baiSanJiao.shortSell,
            baiSanJiao.zhuLiChuHuo,
        ].filter(Boolean).length;
        const isRisk = sellSignals >= 2 || !!baiSanJiao.strongSell;
        return {
            baiXiao: baiXing.baiXiao || false,
            baiXiaoDays: baiXing.baiXiaoDays || (baiXing.baiXiaoPureDays || 999),
            bestBuy: (baiXing.baiXiaoBuy1 || baiXing.baiXiaoBuy2 || false) || false,
            isRisk,
        };
    }
    async getSectorConstituents(code) {
        const cached = this.consCache.get(code);
        if (cached && Date.now() - cached.timestamp < this.CONS_CACHE_TTL) {
            return cached.stocks;
        }
        try {
            const url = `https://www.swsresearch.com/institute-sw/api/index_publish/details/component_stocks/?swindexcode=${code}&page=1&page_size=10000`;
            const json = await this.httpsGetJson(url);
            const results = json?.data?.results || [];
            const stocks = results.map((item) => ({
                code: String(item.stockcode).trim().padStart(6, '0'),
                name: String(item.stockname || '').trim(),
                weight: parseFloat(item.newweight) || 0,
            })).filter(s => s.code && s.name);
            stocks.sort((a, b) => b.weight - a.weight);
            this.consCache.set(code, { stocks, timestamp: Date.now() });
            this.logger.log(`板块 ${code} 成分股加载完成: ${stocks.length}只`);
            return stocks;
        }
        catch (err) {
            this.logger.error(`获取板块 ${code} 成分股失败: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    async fetchStockQuotes(codes) {
        const map = new Map();
        if (codes.length === 0)
            return map;
        try {
            const BATCH_SIZE = 50;
            for (let i = 0; i < codes.length; i += BATCH_SIZE) {
                const batch = codes.slice(i, i + BATCH_SIZE);
                const symbols = batch.map(code => {
                    if (code.startsWith('6') || code.startsWith('9'))
                        return `sh${code}`;
                    return `sz${code}`;
                }).join(',');
                const url = `https://qt.gtimg.cn/q=${symbols}`;
                const raw = await this.httpsGetText(url);
                for (const code of batch) {
                    const prefix = code.startsWith('6') || code.startsWith('9') ? 'sh' : 'sz';
                    const regex = new RegExp(`v_${prefix}${code}="([^"]+)"`);
                    const match = raw.match(regex);
                    if (match) {
                        const fields = match[1].split('~');
                        const name = fields[1] || '';
                        const price = parseFloat(fields[3]) || 0;
                        const yesterdayClose = parseFloat(fields[4]) || 0;
                        const changePercent = yesterdayClose > 0 ? Math.round(((price - yesterdayClose) / yesterdayClose) * 10000) / 100 : 0;
                        const volumeShares = parseFloat(fields[6]) || 0;
                        const inflow = Math.round(volumeShares * price);
                        const marketCap = parseFloat(fields[37]) || 0;
                        map.set(code, { price, changePercent, inflow, marketCap });
                    }
                }
            }
        }
        catch (err) {
            this.logger.error(`获取股票行情失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        return map;
    }
    formatDateTime(date) {
        const y = date.getFullYear();
        const M = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${y}年${M}月${d}日 ${h}:${m}`;
    }
    httpsGetJson(url, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, { agent: this.agent, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.swsresearch.com/' } }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch (e) {
                        reject(new Error(`JSON解析失败: ${data.slice(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                reject(new Error(`请求超时 (${timeoutMs}ms)`));
            });
        });
    }
    httpsGetText(url, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, { agent: this.agent, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.swsresearch.com/' } }, (res) => {
                const chunks = [];
                res.on('data', (chunk) => { chunks.push(chunk); });
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    const text = iconvlite.decode(buffer, 'gbk');
                    resolve(text);
                });
            });
            req.on('error', reject);
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                reject(new Error(`请求超时 (${timeoutMs}ms)`));
            });
        });
    }
    async fetchAllSectorKLines() {
        const map = new Map();
        for (let i = 0; i < SW_SECTORS.length; i += 30) {
            const batch = SW_SECTORS.slice(i, i + 30);
            const promises = batch.map(code => this.fetchSectorKLine(code));
            const results = await Promise.allSettled(promises);
            for (let j = 0; j < results.length; j++) {
                const code = batch[j];
                const result = results[j];
                if (result.status === 'fulfilled' && result.value.length > 0) {
                    map.set(code, result.value);
                }
            }
        }
        return map;
    }
    async fetchSectorKLine(code) {
        try {
            const url = `https://www.swsresearch.com/institute-sw/api/index_publish/trend/?swindexcode=${code}&period=DAY`;
            const json = await this.httpsGetJson(url);
            const rawList = Array.isArray(json) ? json : (json?.data || []);
            return rawList.map((item) => ({
                date: item.bargaindate,
                close: item.closeindex,
            }));
        }
        catch (err) {
            this.logger.error(`获取板块 ${code} K线失败: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    async fetchRealtimePrices() {
        const map = new Map();
        try {
            const url = 'https://www.swsresearch.com/institute-sw/api/index_publish/current/?page=1&page_size=50&indextype=一级行业';
            const json = await this.httpsGetJson(url);
            const results = json?.data?.results || [];
            for (const item of results) {
                const code = String(item.swindexcode).trim();
                const price = parseFloat(item.l3);
                if (code && !isNaN(price)) {
                    map.set(code, price);
                }
            }
        }
        catch (err) {
            this.logger.error(`获取板块实时行情失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        return map;
    }
    async checkMoneyFlowBatch(codes) {
        const flowMap = new Map();
        const BATCH_SIZE = 5;
        for (let i = 0; i < codes.length; i += BATCH_SIZE) {
            const batch = codes.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(code => this.getSingleMoneyFlow(code)));
            for (let j = 0; j < results.length; j++) {
                const code = batch[j];
                const result = results[j];
                if (result.status === 'fulfilled' && result.value !== null) {
                    flowMap.set(code, result.value);
                }
            }
        }
        return flowMap;
    }
    async getSingleMoneyFlow(code) {
        try {
            const market = code.startsWith('6') || code.startsWith('9') ? '1' : '0';
            const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=${market}.${code}&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59&klt=1&lmt=1`;
            const json = await this.httpsGetJson(url);
            const klines = json?.data?.klines || [];
            if (klines.length === 0)
                return null;
            const parts = klines[0].split(',');
            const mainForce = parseFloat(parts[1]);
            if (isNaN(mainForce))
                return null;
            return mainForce;
        }
        catch (err) {
            this.logger.warn(`获取 ${code} 资金流向失败: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
};
exports.SectorService = SectorService;
exports.SectorService = SectorService = SectorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [data_fetcher_service_1.DataFetcherService,
        gem_screener_service_1.GemScreenerService])
], SectorService);
