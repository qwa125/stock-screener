import { GemScreenerService } from './gem-screener.service';
export declare class GemScreenerController {
    private readonly gemScreener;
    constructor(gemScreener: GemScreenerService);
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
}
