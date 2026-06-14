import { GemScreenerService } from './gem-screener.service';
export declare class GemScreenerController {
    private readonly gemScreener;
    constructor(gemScreener: GemScreenerService);
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
}
