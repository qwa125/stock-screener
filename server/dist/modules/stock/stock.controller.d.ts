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
        data: never[];
    }>;
    quote(code: string): Promise<{
        code: number;
        msg: string;
        data: null;
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
