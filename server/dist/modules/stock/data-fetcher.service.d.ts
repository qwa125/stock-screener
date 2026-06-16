import { KLine, StockInfo } from './types';
export declare class DataFetcherService {
    private readonly logger;
    private readonly EASTMONEY_KLINE_URL;
    private readonly EASTMONEY_SEARCH_URL;
    private readonly TENCENT_QUOTE_URL;
    private klineCache;
    private readonly KLINE_CACHE_TTL;
    preloadKline(code: string, klines: KLine[]): void;
    private stockListCache;
    getAllStocks(): Promise<StockInfo[]>;
    private getHotStockList;
    searchStock(keyword: string): Promise<StockInfo[]>;
    private searchEastMoney;
    getKLineData(code: string, market?: number): Promise<KLine[]>;
    fetchRealTimeQuote(code: string, market?: number): Promise<StockInfo & {
        price?: number;
        lastClose?: number;
        high?: number;
        low?: number;
        changePercent?: number;
    } | null>;
    private fallbackSearch;
    private generateMockKLine;
    private getMarketPrefix;
    private detectMarket;
}
