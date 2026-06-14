export declare function isTradingDay(): boolean;
export declare function isLunchBreak(): boolean;
export declare function isMarketOpen(): boolean;
export declare function isAfterMarketClose(): boolean;
export declare function getAfterMarketTTL(): number;
export declare function getMarketOpenTTL(): number;
export declare function getCacheTTL(staleTTL?: number): {
    ttl: number;
    staleTTL: number;
    canRefresh: boolean;
};
export declare function getNextOpenTime(): number;
