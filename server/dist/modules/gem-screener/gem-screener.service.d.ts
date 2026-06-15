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
    isGoldenCross?: boolean;
    suggestion?: string;
}
export declare class GemScreenerService implements OnApplicationBootstrap {
    private readonly dataFetcher;
    private readonly stockService;
    private readonly logger;
    private readonly CACHE_TTL;
    private readonly STALE_TTL;
    private readonly REFRESH_INTERVAL;
    private readonly CACHE_FILE;
    private readonly BUNDLED_GEM_CACHE;
    private readonly BATCH_SIZE;
    private readonly POSITION_THRESHOLD;
    private readonly RELAXED_POSITION;
    private readonly TENANT_BATCH;
    private readonly MIN_GAIN_PCT;
    private readonly MAX_MARKET_CAP;
    private readonly MIN_MARKET_CAP;
    private cache;
    private refreshPromise;
    private mainBoardCache;
    private mainBoardRefreshPromise;
    private sectorCache;
    private readonly MAIN_BOARD_CACHE;
    private readonly BUNDLED_MAIN_BOARD_CACHE;
    private prevGEMResults;
    private prevMainBoardResults;
    private lastScanAt;
    private readonly SCAN_INTERVAL;
    private marketHoursBeganAt;
    constructor(dataFetcher: DataFetcherService, stockService: StockService);
    private isFrozenSchedule;
    private updateMarketHoursBeganAt;
    private loadCacheFromDisk;
    private loadMainBoardCacheFromDisk;
    private saveCacheToDisk;
    getOpportunities(): Promise<{
        opportunities: OpportunityStock[];
        timestamp: number;
    }>;
    private triggerRefresh;
    private refreshCache;
    onApplicationBootstrap(): Promise<void>;
    calcCustomMACD(kline: KLine[]): {
        diff: number[];
        dea: number[];
        currentDiff: number;
        currentDea: number;
        isGoldenCross: boolean;
        goldenCrossDays: number;
        isDeathCross: boolean;
    };
    private calcCorrection;
    private scanAllStocks;
    checkOpportunity(s: StockCandidate): Promise<OpportunityStock | null>;
    checkOpportunityRelaxed(s: StockCandidate): Promise<OpportunityStock | null>;
    private fetchGEMCandidates;
    private parseSinaBatch;
    private fetchMainBoardCandidates;
    scanMainBoardStocks(): Promise<OpportunityStock[]>;
    getMainBoardOpportunities(): Promise<{
        opportunities: OpportunityStock[];
        timestamp: number;
    }>;
    private saveMainBoardCacheToDisk;
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
    private quickAnalyze;
    triggerAnalysisPreCacheFromCache(): void;
    private triggerAnalysisPreCache;
}
