import { DataFetcherService } from './data-fetcher.service';
import { StockInfo, BacktestStats, SignalEntry } from './types';
export declare class StockService {
    private readonly dataFetcher;
    private readonly logger;
    private readonly ANALYSIS_CACHE_FILE;
    private readonly BUNDLED_ANALYSIS_CACHE;
    private analysisCache;
    constructor(dataFetcher: DataFetcherService);
    private loadAnalysisCache;
    private saveAnalysisCache;
    analyzeFromRawData(params: {
        code: string;
        name: string;
        currentPrice: number;
        changePercent: number;
        high?: number;
        low?: number;
        kline: Array<{
            open: number;
            close: number;
            high: number;
            low: number;
            volume: number;
            amount?: number;
        }>;
    }): Promise<{
        code: string;
        name: string;
        currentPrice: number;
        changePercent: number;
        high: number | undefined;
        low: number | undefined;
        klineCount: number;
        formula: any;
        signals: SignalEntry[];
        suggestion: "重仓买入" | "买入" | "轻仓买入" | "持有" | "减仓" | "卖出" | "不要介入";
        reason: string;
        score: number;
        entryTiming: number;
        ma5: number;
        ma10: number;
        ma5Up: boolean;
        ma10Up: boolean;
        pricePosition: any;
        baiXiaoDays: any;
        baiBu: boolean;
        jiGouActiveScore: any;
        isGoldenCross: boolean;
    }>;
    getCachedAnalysis(stockCode: string): any | null;
    preCacheAnalysis(stockCode: string): Promise<void>;
    preCacheAnalysisBatch(codes: string[], concurrency?: number): Promise<void>;
    searchStock(query: string): Promise<StockInfo[]>;
    computeBacktestStats(closePrices: number[]): BacktestStats | null;
    analyzeStock(query: string): Promise<any>;
}
