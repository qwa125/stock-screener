import { GemScreenerService } from './gem-screener.service';
import { GemScreenerScheduler } from './gem-screener.scheduler';
import { StockService } from '../stock/stock.service';
import { Response } from 'express';
export declare class GemScreenerController {
    private readonly gemScreener;
    private readonly scheduler;
    private readonly stockService;
    private readonly logger;
    private readonly klineProxyCache;
    constructor(gemScreener: GemScreenerService, scheduler: GemScreenerScheduler, stockService: StockService);
    getMarketState(): Promise<{
        code: number;
        msg: string;
        data: {
            beijingTime: string;
            lockUntilStr: string | null;
            nextScanStr: string | null;
            status: "premarket" | "trading" | "lunch" | "closed";
            lastScanTime: number;
            lastScanCount: number;
            lockUntil: number;
            nextScanTime: number;
        };
    }>;
    priceStream(res: Response): Promise<void>;
    ping(): Promise<{
        code: number;
        msg: string;
        timestamp: number;
    }>;
    getWatchedCodes(): Promise<{
        code: number;
        msg: string;
        data: {
            codes: string[];
        };
    }>;
    tencentProxy(body: {
        q: string;
    }): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: {
            text: string;
        };
    }>;
    refreshWithData(body: {
        stocks: any[];
    }): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: import("./gem-screener.service").OpportunityStock[];
            timestamp: number;
        };
    }>;
    refreshMainBoard(body: {
        stocks: any[];
    }): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: import("./gem-screener.service").OpportunityStock[];
            timestamp: number;
        };
    }>;
    refreshSector(body: {
        stocks: any[];
    }): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: import("./gem-screener.service").OpportunityStock[];
            timestamp: number;
        };
    }>;
    refreshHeavyBuy(body: {
        stocks: any[];
    }): Promise<any>;
    getOpportunities(): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: import("./gem-screener.service").OpportunityStock[];
            timestamp: number;
        };
    }>;
    getMainBoard(): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: import("./gem-screener.service").OpportunityStock[];
            timestamp: number;
        };
    }>;
    getTopGem(force?: string): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: any[];
            timestamp: number;
        };
    }>;
    getTopMainBoard(force?: string): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: any[];
            timestamp: number;
        };
    }>;
    getCacheAll(): Promise<{
        code: number;
        msg: string;
        data: {
            total: number;
            stocks: import("./gem-screener.service").OpportunityStock[];
        };
    }>;
    getCombinedTop(force?: string): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: any[];
            timestamp: number;
        };
    }>;
    getTopOpportunities(force?: string): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: import("./gem-screener.service").OpportunityStock[];
            timestamp: number;
        };
    }>;
    getTopSector(force?: string): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: import("./gem-screener.service").OpportunityStock[];
            timestamp: number;
        };
    }>;
    getHeavyBuy(): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: any[];
            timestamp: number;
        };
    }>;
    getIndustrySectorsTop10(): Promise<{
        code: number;
        msg: string;
        data: any;
    }>;
    seedCache(): Promise<{
        code: number;
        msg: string;
        data: {
            success: boolean;
            files: string[];
            error?: undefined;
        } | {
            success: boolean;
            error: any;
            files?: undefined;
        };
    }>;
    private readHeavyBuyCache;
    private mergeWithHeavyBuy;
    searchStock(keyword: string): Promise<{
        code: number;
        msg: string;
        data: any;
    } | {
        code: number;
        msg: any;
        data: never[];
    }>;
    cacheData(body: {
        stocks: {
            code: string;
            name: string;
            price: number;
            changePercent: number;
            high?: number;
            low?: number;
            klines: any[];
        }[];
    }): Promise<{
        code: number;
        msg: string;
        data: never[];
    } | {
        code: number;
        msg: string;
        data: {
            total: number;
        };
    }>;
    getScanResult(): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: any[];
            timestamp: number;
        };
    }>;
    rescanMarket(): Promise<{
        code: number;
        msg: string;
        data: any[];
        updatedAt: number;
        cloudSnapshotUrl: string;
    } | {
        code: number;
        msg: any;
        data: never[];
        updatedAt?: undefined;
        cloudSnapshotUrl?: undefined;
    }>;
    updateUpgraded(body: {
        list?: any[];
    }): Promise<{
        code: number;
        msg: string;
        data: never[];
    } | {
        code: number;
        msg: any;
        data: number;
    }>;
    getUpgradedSnapshot(): Promise<{
        code: number;
        msg: string;
        data: any[];
        updatedAt: number;
    }>;
    getCloudSnapshotUrl(): Promise<{
        code: number;
        msg: string;
        data: {
            url: string;
            timestamp: number;
            count: number;
        };
    }>;
    refreshAll(body: {
        stocks: any[];
    }): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: any;
            timestamp: number;
        };
    }>;
    syncSellState(body: {
        sellStates: {
            code: string;
            suggestion: string;
        }[];
    }): Promise<{
        code: number;
        msg: any;
    }>;
    syncCache(body: {
        stocks: any[];
    }): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: {
            count: number;
        };
    }>;
    rescanBatch(body: {
        codes: string[];
        names?: string[];
    }): Promise<{
        code: number;
        msg: string;
        data: any[];
    }>;
    proxyStockList(node: string, page: string, num: string, sort?: string, asc?: string): Promise<{
        code: number;
        msg: string;
        data: never[];
    }>;
    proxyEastMoneyList(node: string, page: string, num: string): Promise<{
        code: number;
        msg: string;
        data: never[];
    }>;
    proxySearch(query: string, count?: string): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: never[];
    }>;
    proxySinaUS(code: string): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: string;
    }>;
    proxyKLine(code: string): Promise<{
        code: number;
        msg: string;
        data: null;
        cached?: undefined;
        age?: undefined;
    } | {
        code: number;
        msg: string;
        data: any[];
        cached: boolean;
        age: number;
    } | {
        code: number;
        msg: string;
        data: null;
        cached: boolean;
        age?: undefined;
    }>;
    proxyStockDetail(code: string): Promise<{
        code: number;
        msg: string;
        data: null;
    } | {
        code: number;
        msg: string;
        data: {
            volumeRatio: number;
            auctionVolume: number;
            auctionAmount: number;
            auctionUnmatched: number;
            auctionDirection: number;
        };
    }>;
    recalcCache(): Promise<{
        code: number;
        msg: string;
        data: {
            total: number;
            updated: number;
        };
    }>;
    analyzeWithKLine(body: {
        code: string;
        name?: string;
        kline: any[];
        mainForceInflow?: number;
        price?: number;
        changePercent?: number;
    }): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: any[];
    } | {
        code: number;
        msg: string;
        data: null;
    }>;
    intradayAnalyze(body: {
        code: string;
        kline: any[];
        price?: number;
    }): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: any;
    }>;
    backtest(): Promise<{
        code: number;
        msg: string;
        data: any;
    } | {
        code: number;
        msg: any;
        data?: undefined;
    }>;
    backtestForecast(): Promise<{
        code: number;
        msg: string;
        data: any;
    } | {
        code: number;
        msg: any;
        data?: undefined;
    }>;
    clearCache(): Promise<{
        code: number;
        msg: string;
    }>;
    technicalAnalysis(code: string): Promise<{
        code: number;
        msg: string;
        data: any;
    } | {
        code: number;
        msg: any;
        data: null;
    }>;
    intradayAnalysis(code: string): Promise<{
        code: number;
        msg: string;
        data: any;
    } | {
        code: number;
        msg: any;
        data: null;
    }>;
    auctionTrend(code: string): Promise<{
        code: number;
        msg: string;
        data: any;
    } | {
        code: number;
        msg: any;
        data: null;
    }>;
}
