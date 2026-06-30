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
const iconv = require("iconv-lite");
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
        try {
            const url = 'https://push2.eastmoney.com/api/qt/clist/get?cb=&pn=1&pz=5000&po=1&np=1&fields=f12,f14&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
                signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
                const text = await res.text();
                const data = JSON.parse(text);
                const list = (data?.data?.diff || []).map((item) => ({
                    code: String(item.f12).padStart(6, '0'),
                    name: item.f14 || '',
                    market: 0,
                })).filter((s) => s.name);
                this.stockListCache = list;
                this.logger.log(`加载全部A股列表: ${list.length}只`);
                return list;
            }
        }
        catch (e) {
            this.logger.warn(`获取全部A股列表失败: ${e.message}`);
        }
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
        try {
            const url = `${this.EASTMONEY_SEARCH_URL}?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E14A9C61B0D6E303FC9C19`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Referer: 'https://quote.eastmoney.com/',
                },
                signal: AbortSignal.timeout(8000),
            });
            if (response.ok) {
                const data = await response.json();
                const list = data?.QuotationCodeTable?.Data || [];
                const results = list
                    .filter((item) => item.Code && item.Name)
                    .map((item) => ({
                    code: String(item.Code).padStart(6, '0'),
                    name: item.Name,
                    market: item.MarketType === 1 ? 1 : 0,
                }));
                if (results.length > 0)
                    return results;
            }
        }
        catch (e) {
            this.logger.warn(`搜索接口不可用，降级: ${e.message}`);
        }
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
        const mkt = market ?? this.detectMarket(code);
        const prefix = this.getMarketPrefix(mkt);
        try {
            const response = await fetch(`${this.TENCENT_QUOTE_URL}=${prefix}${code}`, {
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok)
                return null;
            const buffer = await response.arrayBuffer();
            const text = iconv.decode(Buffer.from(buffer), 'gbk');
            const match = text.match(/"(.*)"/);
            if (!match)
                return null;
            const fields = match[1].split('~');
            if (fields.length < 40)
                return null;
            return {
                code: fields[2] || code,
                name: fields[1] || `股票${code}`,
                market: this.detectMarket(code),
                price: parseFloat(fields[3]) || undefined,
                lastClose: parseFloat(fields[4]) || undefined,
                high: parseFloat(fields[33]) || undefined,
                low: parseFloat(fields[34]) || undefined,
                changePercent: parseFloat(fields[32]) || undefined,
            };
        }
        catch (e) {
            this.logger.warn(`腾讯实时行情不可用: ${e.message}`);
            return null;
        }
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
