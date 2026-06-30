"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DataFetcherService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataFetcherService = void 0;
const common_1 = require("@nestjs/common");
let DataFetcherService = DataFetcherService_1 = class DataFetcherService {
    constructor() {
        this.logger = new common_1.Logger(DataFetcherService_1.name);
        this.EASTMONEY_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
        this.EASTMONEY_SEARCH_URL = 'https://searchadapter.eastmoney.com/api/suggest/get';
        this.TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/q';
        this.klineCache = new Map();
        this.KLINE_CACHE_TTL = 10 * 60 * 1000;
        this.stockListCache = null;
    }
    preloadKline(code, klines) {
        this.klineCache.set(code, { data: klines, timestamp: Date.now() });
    }
    async getAllStocks() {
        if (this.stockListCache)
            return this.stockListCache;
        this.logger.warn('后端不直接调用外部API获取股票列表，请前端推送');
        this.stockListCache = [];
        return [];
        const fallback = this.getHotStockList();
        this.stockListCache = fallback;
        return fallback;
    }
    getHotStockList() {
        const codes = [
            '000001', '000002', '000333', '000651', '000858',
            '002415', '002594', '300750', '600000', '600036',
            '600519', '600690', '600887', '600900', '601012',
            '601166', '601318', '601398', '601857', '601899',
            '601939', '603259', '688981',
        ];
        return codes.map(code => ({
            code, name: '',
            market: code.startsWith('6') || code.startsWith('9') ? 1 : 0,
        }));
    }
    async searchStock(keyword) {
        const isCode = /^\d{6}$/.test(keyword.trim());
        if (isCode) {
            return this.fallbackSearch(keyword.trim());
        }
        const eastRes = await this.searchEastMoney(keyword);
        if (eastRes.length > 0)
            return eastRes;
        return this.fallbackSearch(keyword);
    }
    async searchEastMoney(keyword) {
        this.logger.warn(`后端跳过外部搜索: ${keyword}`);
        return [];
    }
    async getKLineData(code, market) {
        const cached = this.klineCache.get(code);
        if (cached && Date.now() - cached.timestamp < this.KLINE_CACHE_TTL) {
            return cached.data;
        }
        this.logger.warn(`K线数据未缓存: ${code}，跳过外部API调用`);
        return [];
    }
    async fetchRealTimeQuote(code, market) {
        this.logger.warn(`[data-fetcher] 跳过外部行情API，数据由前端推送`);
        return null;
    }
    fallbackSearch(keyword) {
        const isCode = /^\d{6}$/.test(keyword.trim());
        if (isCode) {
            return [{
                    code: keyword.trim(),
                    name: `股票${keyword}`,
                    market: this.detectMarket(keyword.trim()),
                }];
        }
        const nameMap = {
            '茅台': '600519', '贵州茅台': '600519',
            '平安': '601318', '中国平安': '601318',
            '招商银行': '600036', '宁德时代': '300750',
            '比亚迪': '002594', '五粮液': '000858',
            '恒瑞医药': '600276', '药明康德': '603259',
            '美的': '000333', '格力': '000651',
            '盈方微': '000670',
        };
        const code = nameMap[keyword.trim()];
        if (code) {
            return [{ code, name: keyword.trim(), market: this.detectMarket(code) }];
        }
        return [{ code: '600000', name: keyword, market: 1 }];
    }
    generateMockKLine(_code, currentPrice, lastClose) {
        const result = [];
        const totalDays = 500;
        const targetPrice = currentPrice || (100 + Math.random() * 50);
        const amplitude = targetPrice * (0.20 + Math.random() * 0.15);
        const cycles = 2.5 + Math.random() * 1.5;
        const baseDate = new Date('2024-01-01');
        for (let i = 0; i < totalDays; i++) {
            const phase = Math.PI * 2 * i / totalDays * cycles;
            const sineComponent = Math.sin(phase) * amplitude;
            const noise = (Math.random() - 0.5) * amplitude * 0.12;
            let convergeFactor = 0;
            let remain = 0;
            if (i > totalDays - 5) {
                remain = totalDays - i;
                convergeFactor = 1 - remain / 5;
            }
            const currentSine = sineComponent * (1 - convergeFactor);
            const currentNoise = noise * (1 - convergeFactor);
            let close = targetPrice + currentSine + currentNoise;
            close = Math.max(close, 0.5);
            const volatility = Math.max(close * 0.02, 0.01);
            const open = close * (1 + (Math.random() - 0.5) * 0.02);
            const high = Math.max(open, close) + Math.random() * volatility * 0.8;
            const low = Math.min(open, close) - Math.random() * volatility * 0.8;
            const baseVolume = 2000000 + Math.random() * 8000000;
            const volume = baseVolume * (1 + Math.sin(phase) * 0.5);
            const amount = volume * (open + close) / 2;
            const date = new Date(baseDate);
            date.setDate(date.getDate() + i);
            while (date.getDay() === 0 || date.getDay() === 6) {
                date.setDate(date.getDate() + 1);
            }
            result.push({
                date: date.toISOString().split('T')[0],
                open: Math.round(open * 100) / 100,
                close: Math.round(close * 100) / 100,
                high: Math.round(high * 100) / 100,
                low: Math.round(low * 100) / 100,
                volume: Math.round(volume),
                amount: Math.round(amount),
            });
        }
        return result;
    }
    getMarketPrefix(market) {
        if (market === 2)
            return 'bj';
        return market === 1 ? 'sh' : 'sz';
    }
    detectMarket(code) {
        if (code.startsWith('4') || code.startsWith('8'))
            return 2;
        if (code.startsWith('6') || code.startsWith('9') || code.startsWith('5'))
            return 1;
        if (code.startsWith('0') || code.startsWith('3') || code.startsWith('1'))
            return 0;
        return 0;
    }
};
exports.DataFetcherService = DataFetcherService;
exports.DataFetcherService = DataFetcherService = DataFetcherService_1 = __decorate([
    (0, common_1.Injectable)()
], DataFetcherService);
