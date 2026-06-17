import { OnModuleInit } from '@nestjs/common';
import { GemScreenerService } from './gem-screener.service';
export declare class GemScreenerScheduler implements OnModuleInit {
    private readonly gemService;
    private readonly logger;
    private lastAutoScanDate;
    private isScanning;
    private isFirstBoot;
    constructor(gemService: GemScreenerService);
    onModuleInit(): Promise<void>;
    private _testTencentApi;
    private _isTradingHours;
    autoScan(): Promise<void>;
}
