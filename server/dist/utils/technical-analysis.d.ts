export interface KLine {
    date: string;
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    amount: number;
}
export interface TechnicalResult {
    currentPrice: number;
    macd: {
        dif: number;
        dea: number;
        hist: number;
    };
    kdj: {
        k: number;
        d: number;
        j: number;
    };
    bollinger: {
        upper: number;
        middle: number;
        lower: number;
        bandwidth: number;
    };
    rsi: number;
    rsi6: number;
    volumeRatio: number;
    entryScore: number;
    entryLevel: '极佳' | '良好' | '一般' | '不建议';
    bestEntryPrice: number;
    supportLevel: number;
    resistanceLevel: number;
    reasoning: string[];
}
export declare function analyzeTechnical(klines: KLine[], currentPrice?: number): TechnicalResult;
