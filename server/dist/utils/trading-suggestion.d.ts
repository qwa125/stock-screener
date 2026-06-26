export interface SuggestionResult {
    action: string;
    color: string;
    reason: string;
    prediction: string;
}
export interface SuggestionInput {
    pricePosition: number;
    trendState: number;
    trendStrength?: number;
    diff: number;
    dea: number;
    shortBuy?: boolean;
    strictBuy?: boolean;
    jiaCang?: boolean;
    shortSell?: boolean;
    strongSell?: boolean;
    safe?: boolean;
    macdGoldenCross?: boolean;
    macdDeathCross?: boolean;
    baiBu?: boolean;
    baiXiao?: boolean;
    baiXiaoDays?: number;
    baiBuDays?: number;
    baiCoverTrend?: 'exiting' | 'entering' | 'stable';
    volumeStructure?: number;
}
export declare function getTradingSuggestion(f: SuggestionInput): SuggestionResult;
