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
    baiXiaoDays?: number;
    volumeStructure?: number;
}
export declare function getTradingSuggestion(f: SuggestionInput): SuggestionResult;
