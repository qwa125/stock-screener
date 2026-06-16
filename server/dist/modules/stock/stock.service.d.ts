import { DataFetcherService } from './data-fetcher.service';
import { StockInfo, BacktestStats } from './types';
export declare class StockService {
    private readonly dataFetcher;
    private readonly logger;
    private readonly ANALYSIS_CACHE_FILE;
    private readonly BUNDLED_ANALYSIS_CACHE;
    private analysisCache;
    constructor(dataFetcher: DataFetcherService);
    private loadAnalysisCache;
    private saveAnalysisCache;
    getCachedAnalysis(stockCode: string): any | null;
    preCacheAnalysis(stockCode: string): Promise<void>;
    preCacheAnalysisBatch(codes: string[], concurrency?: number): Promise<void>;
    searchStock(query: string): Promise<StockInfo[]>;
    computeBacktestStats(closePrices: number[]): BacktestStats | null;
    analyzeStock(query: string): Promise<any>;
}
