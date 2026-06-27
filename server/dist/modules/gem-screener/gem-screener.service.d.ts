import { OnApplicationBootstrap } from '@nestjs/common';
import { DataFetcherService } from '../stock/data-fetcher.service';
import { StockService } from '../stock/stock.service';
import { KLine } from '../stock/types';
export interface StockCandidate {
    code: string;
    name: string;
    inflow: number;
    changePercent: number;
    currentPrice: number;
    marketCap?: number;
    turnoverRate?: number;
    volumeRatio?: number;
}
export interface OpportunityStock {
    capitalRank: number;
    code: string;
    name: string;
    mainForceInflow: number;
    baiXiaoDays: number;
    buySignal?: string;
    currentPrice: number;
    changePercent: number;
    pricePosition: number;
    priceIncrease: number;
    score: number;
    diff?: number;
    dea?: number;
    ma5?: number;
    ma10?: number;
    isGoldenCross?: boolean;
    suggestion?: string;
    entryTiming: number;
    safetyScore: number;
    signalCombination?: string;
    sellSignal?: string;
    jiGouActiveScore?: number;
    chipConcentration90?: number;
    chipPeakPosition?: 'low' | 'mid' | 'high';
    chipPattern?: 'single_peak' | 'double_peak' | 'dispersed';
    trendPrediction?: {
        direction: string;
        score: number;
        reason: string;
        details: Record<string, any>;
    };
    future_1_2Day_suggestion?: string;
    _debug?: Record<string, any>;
    forecast1_2Day?: {
        direction: string;
        confidence: string;
        detail: string;
    };
}
export declare class GemScreenerService implements OnApplicationBootstrap {
    private readonly dataFetcher;
    private readonly stockService;
    private readonly logger;
    private readonly CACHE_TTL;
    private readonly STALE_TTL;
    private readonly REFRESH_INTERVAL;
    private readonly CACHE_FILE;
    private readonly SELL_STATE_FILE;
    private readonly BUNDLED_GEM_CACHE;
    private readonly BATCH_SIZE;
    private readonly POSITION_THRESHOLD;
    private readonly RELAXED_POSITION;
    private readonly TENANT_BATCH;
    private readonly MIN_GAIN_PCT;
    private readonly MAX_MARKET_CAP;
    private readonly MIN_MARKET_CAP;
    private readonly SUGGESTION_PRIORITY;
    private cache;
    private refreshPromise;
    private mainBoardCache;
    private sellStateCache;
    private scanCache;
    updateCache(type: 'scan', data: any[]): void;
    getCache(type: 'scan'): any[];
    private soldOutStocks;
    private mainBoardRefreshPromise;
    private sectorCache;
    private readonly MAIN_BOARD_CACHE;
    private readonly BUNDLED_MAIN_BOARD_CACHE;
    private readonly SECTOR_CACHE;
    private readonly BUNDLED_SECTOR_CACHE;
    private prevGEMResults;
    private prevMainBoardResults;
    private lastScanAt;
    private readonly SCAN_INTERVAL;
    private marketHoursBeganAt;
    private _pgSql;
    private get pgSql();
    private ensurePgTable;
    private saveCacheToPg;
    private loadCacheFromPg;
    constructor(dataFetcher: DataFetcherService, stockService: StockService);
    private isFrozenSchedule;
    private updateMarketHoursBeganAt;
    private loadCacheFromDisk;
    private loadMainBoardCacheFromDisk;
    private loadSectorCacheFromDisk;
    clearCache(): Promise<void>;
    private saveCacheToDisk;
    private saveMainBoardCacheToDisk;
    private loadSellStateCache;
    private saveSellStateCache;
    syncSellStateFromFrontend(sellStates: {
        code: string;
        suggestion: string;
    }[]): void;
    getOpportunities(): Promise<{
        opportunities: OpportunityStock[];
        timestamp: number;
    }>;
    private addForecastToCache;
    private upgradeCacheFields;
    recalculateSuggestions(data: OpportunityStock[]): void;
    recalcCacheSignals(): Promise<{
        total: number;
        updated: number;
    }>;
    getCacheAll(): OpportunityStock[];
    updateUpgradedCache(list: any[]): void;
    updateSingleStockInCache(opp: OpportunityStock): Promise<void>;
    private triggerRefresh;
    private refreshCache;
    onApplicationBootstrap(): Promise<void>;
    calcKDJ(kline: KLine[]): {
        k: number;
        d: number;
        j: number;
        trend: 'up' | 'down' | 'flat';
        prevJ: number;
        jUp: boolean;
    };
    calcCustomMACD(kline: KLine[]): {
        diff: number[];
        dea: number[];
        currentDiff: number;
        currentDea: number;
        isGoldenCross: boolean;
        goldenCrossDays: number;
        isDeathCross: boolean;
    };
    private calcSimpleTrendPrediction;
    calcTrendPrediction(kline: any[], result?: any): any;
    private calcCorrection;
    private scanAllStocks;
    scanWithFrontendData(stocks: {
        code: string;
        name: string;
        price: number;
        changePercent: number;
        inflow: number;
        klines: KLine[];
    }[]): Promise<OpportunityStock[]>;
    scanWithFrontendMainBoardData(stocks: {
        code: string;
        name: string;
        price: number;
        changePercent: number;
        inflow: number;
        klines: KLine[];
    }[]): Promise<OpportunityStock[]>;
    scanWithFrontendSectorData(stocks: {
        code: string;
        name: string;
        sectorName: string;
        price?: number;
        changePercent?: number;
        inflow?: number;
        klines: KLine[];
    }[]): Promise<OpportunityStock[]>;
    scanWithFrontendHeavyBuyData(stocks: {
        code: string;
        name: string;
        price?: number;
        changePercent?: number;
        klines: KLine[];
    }[]): Promise<OpportunityStock[]>;
    generateSeedCache(): Promise<{
        success: boolean;
        files: string[];
        error?: undefined;
    } | {
        success: boolean;
        error: any;
        files?: undefined;
    }>;
    private enrichWithMainForceFlow;
    private calcMultiScore;
    private scoreToSuggestion;
    private scoreToSuggestionRelaxed;
    private determineBySignalRule;
    checkOpportunity(s: StockCandidate, prevSuggestion?: string | null): Promise<OpportunityStock | null>;
    checkOpportunityRelaxed(s: StockCandidate, prevSuggestion?: string | null): Promise<OpportunityStock | null>;
    private buildResult;
    static computeTechnicalForecast(params: {
        entryTiming: number;
        isGoldenCross: boolean;
        ma5: number;
        ma10: number;
        pricePosition: number;
        mainForceInflow: number;
        jiGouActiveScore: number;
    }): {
        direction: string;
        confidence: string;
        detail: string;
    };
    private calcScoreForecast;
    private calcEntryTiming;
    private calcSafetyScore;
    private applySignalContinuity;
    private calcChipAnalysis;
    private fetchGEMCandidates;
    private parseSinaBatch;
    private fetchMainBoardCandidates;
    scanMainBoardStocks(): Promise<OpportunityStock[]>;
    getMainBoardOpportunities(): Promise<{
        opportunities: OpportunityStock[];
        timestamp: number;
    }>;
    getAllOpportunities(): Promise<OpportunityStock[]>;
    computeFullSuggestion(code: string): Promise<{
        suggestion: string;
        score: number;
        name: string;
    } | null>;
    scanSectorOpportunities(force?: boolean): Promise<{
        opportunities: OpportunityStock[];
        timestamp: number;
    }>;
    scanTopGem(force?: boolean): Promise<{
        opportunities: OpportunityStock[];
        timestamp: number;
    }>;
    scanTopMainBoard(force?: boolean): Promise<{
        opportunities: OpportunityStock[];
        timestamp: number;
    }>;
    scanTopOpportunities(force?: boolean): Promise<{
        opportunities: OpportunityStock[];
        timestamp: number;
    }>;
    private scanTopFromCandidates;
    private static calcEntryTiming;
    private static calcSafetyScore;
    private static calcChipAnalysis;
    quickAnalyze(code: string, name?: string, keepAll?: boolean, rawKline?: any[], frontendMainForce?: number): Promise<OpportunityStock | null>;
    searchStocks(keyword: string): Promise<OpportunityStock[]>;
    rescanMarket(): Promise<OpportunityStock[]>;
    triggerAnalysisPreCacheFromCache(): void;
    private triggerAnalysisPreCache;
    scanGlobalHeavyBuy(): Promise<OpportunityStock[]>;
    getIndustrySectorTop10(): Promise<{
        sectors: Array<{
            rank: number;
            name: string;
            avgChangePercent: number;
            totalStocks: number;
            upStocks: number;
            stocks: Array<{
                code: string;
                name: string;
                price: number;
                changePercent: number;
            }>;
        }>;
        timestamp: number;
    }>;
    scanAllWithFrontendData(stocks: {
        code: string;
        name: string;
        price: number;
        changePercent: number;
        inflow: number;
        klines: any[];
    }[]): Promise<any[]>;
    runBacktest(): Promise<any>;
    runForecastBacktest(): Promise<any>;
    technicalAnalysis(code: string): Promise<any>;
}
