import { GemScreenerService } from './gem-screener.service';
export declare class GemScreenerController {
    private readonly gemScreener;
    private readonly logger;
    constructor(gemScreener: GemScreenerService);
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
            opportunities: import("./gem-screener.service").OpportunityStock[];
            timestamp: number;
        };
    }>;
    getTopMainBoard(force?: string): Promise<{
        code: number;
        msg: string;
        data: {
            opportunities: import("./gem-screener.service").OpportunityStock[];
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
}
