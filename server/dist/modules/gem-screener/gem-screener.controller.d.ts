import { GemScreenerService } from './gem-screener.service';
import { GemScreenerScheduler } from './gem-screener.scheduler';
import { Response } from 'express';
export declare class GemScreenerController {
    private readonly gemScreener;
    private readonly scheduler;
    private readonly logger;
    constructor(gemScreener: GemScreenerService, scheduler: GemScreenerScheduler);
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
        data: {
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
        };
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
        data: import("./gem-screener.service").OpportunityStock[];
    } | {
        code: number;
        msg: any;
        data: never[];
    }>;
    rescanMarket(): Promise<{
        code: number;
        msg: string;
        data: import("./gem-screener.service").OpportunityStock[];
    } | {
        code: number;
        msg: any;
        data: never[];
    }>;
    refreshAll(body: {
        stocks: any[];
    }): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: any[];
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
        data: any;
    }>;
    proxyEastMoneyList(node: string, page: string, num: string): Promise<{
        code: number;
        msg: string;
        data: any;
    }>;
    proxySearch(query: string): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: any;
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
    proxyKLine(code: string, market: string): Promise<{
        code: number;
        msg: string;
        data: any;
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
    }): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: import("./gem-screener.service").OpportunityStock[];
    } | {
        code: number;
        msg: string;
        data: {
            code: string;
            name: string;
            suggestion: string;
            score: number;
        }[];
    } | {
        code: number;
        msg: string;
        data: null;
    }>;
}
