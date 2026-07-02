import { OnModuleInit } from '@nestjs/common';
import { GemScreenerService } from './gem-screener.service';
export interface MarketState {
    status: 'premarket' | 'trading' | 'lunch' | 'closed';
    lastScanTime: number;
    lastScanCount: number;
    lockUntil: number;
    nextScanTime: number;
}
export declare class GemScreenerScheduler implements OnModuleInit {
    private readonly gemService;
    private readonly logger;
    private state;
    private STATE_FILE;
    private watchedCodes;
    private _cacheLoaded;
    private _allStocks;
    private _gemCacheData;
    private _mainCacheData;
    constructor(gemService: GemScreenerService);
    onModuleInit(): Promise<void>;
    private _preloadCache;
    private _bjNow;
    private _bjDayOfWeek;
    private _bjMinutes;
    private _isTradingDay;
    private _isInSession;
    private _isLunch;
    private _isPreMarket;
    private _isScanWindow;
    private _isAfterMarket;
    private _nextTradingDayOpen;
    private loadState;
    private saveState;
    private _updateNextScanTime;
    morningFirstScan(): Promise<void>;
    periodicScan(): Promise<void>;
    lunchScanAndLock(): Promise<void>;
    afternoonOpen(): Promise<void>;
    marketClose(): Promise<void>;
    getState(): MarketState;
    getWatchedCodes(): string[];
}
