import { Response } from 'express';
import { StockService } from './stock.service';
export declare class StockController {
    private readonly stockService;
    private readonly logger;
    constructor(stockService: StockService);
    download(res: Response): void;
    downloadMiniapp(res: Response): void;
    sinaList(page?: string, num?: string, node?: string): Promise<{
        code: number;
        msg: string;
        data: any[];
    } | {
        code: number;
        msg: any;
        data: never[];
    }>;
    quote(code: string): Promise<{
        code: number;
        msg: string;
        data: null;
    } | {
        code: number;
        msg: string;
        data: {
            code: string;
            name: string;
            price: number;
            trade: number;
            open: number;
            high: number;
            low: number;
            yClose: number;
            change: number;
            changePercent: number;
        };
    }>;
    search(query: string): Promise<{
        code: number;
        msg: string;
        data: import("./types").StockInfo[];
    }>;
    analyze(query: string): Promise<{
        code: number;
        msg: string;
        data: any;
    } | {
        code: number;
        msg: any;
        data: null;
    }>;
}
