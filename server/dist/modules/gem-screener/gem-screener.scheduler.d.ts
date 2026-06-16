import { GemScreenerService } from './gem-screener.service';
export declare class GemScreenerScheduler {
    private readonly gemService;
    private readonly logger;
    private lastAutoScanDate;
    private isScanning;
    constructor(gemService: GemScreenerService);
    autoScan(): Promise<void>;
}
