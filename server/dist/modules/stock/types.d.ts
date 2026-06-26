export interface KLine {
    date: string;
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    amount: number;
}
export interface StockInfo {
    code: string;
    name: string;
    market: number;
}
export declare enum PositionZone {
    LOW = "\u4F4E\u4F4D\u533A",
    MID = "\u4E2D\u4F4D\u533A",
    HIGH_ALERT = "\u9AD8\u4F4D\u8B66\u6212\u533A",
    HIGH_RISK = "\u9AD8\u98CE\u9669\u533A",
    EXTREME_RISK = "\u6781\u7AEF\u98CE\u9669\u533A"
}
export declare enum TrendState {
    DOWN = 0,
    SIDEWAYS = 1,
    UP_MILD = 2,
    UP_STRONG = 3
}
export interface FormulaResult {
    pricePosition: number;
    positionZone: PositionZone;
    trendState: TrendState;
    trendStrength: number;
    concentration: number;
    concentrationDisplay: number;
    volumeStructure: number;
    shortBuy: boolean;
    shortSell: boolean;
    strictBuy: boolean;
    strongSell: boolean;
    zhuLiXiChou: boolean;
    zhuLiChuHuo: boolean;
    xiPanSignal: boolean;
    coolingAfterSell: boolean;
    coolingTrendBuy: boolean;
    bestBuyPoints: string[];
    conflict: string | null;
    buySignalDiamond: boolean;
    xiPanFanZhuanBuy: boolean;
    zhuShengZhongWeiChuHuo: boolean;
    zhenShiChuHuo: boolean;
    xiPanQueRen: boolean;
    diff: number;
    dea: number;
    lifeLine: number;
    pressure: number;
    baiXiao: boolean;
    baiXiaoDays: number;
    baiXiaoPureDays?: number;
    baiBu: boolean;
    baiBuDays?: number;
    baiCoverTrend?: 'exiting' | 'entering' | 'stable';
    diBuBuy: boolean;
    gaoWeiHuiDiaoBuy: boolean;
    zhuLiShiPan: boolean;
    jiaCang: boolean;
    gaoKaiDiZouQingCang: boolean;
    baoLiangFuGaiQingCang: boolean;
    po5RiXian: boolean;
    yinDiePoWei: boolean;
    baiXiaoBuy1: boolean;
    baiXiaoBuy2: boolean;
    qiangShiHuiCai: boolean;
    qiangZhiFuGai: boolean;
    xiPanHuoMian: boolean;
    safe: boolean;
    jiGouHuoYueDu: number;
    breakLifeLine: boolean;
    breakStrongLine: boolean;
    breakBigBullLine: boolean;
    jiGouHuoYueDuArray?: number[];
    baiBuArray?: boolean[];
    baiXiaoArray?: boolean[];
}
export interface BacktestStats {
    patternName: string;
    totalOccurrences: number;
    upProbability: {
        days: number;
        probability: number;
        avgReturn: number;
    }[];
    profitLossRatio: number;
    maxDrawdown: number;
}
export interface SignalEntry {
    name: string;
    type: 'positive' | 'negative' | 'neutral' | 'warning';
    description?: string;
}
export interface StockAnalysisResult {
    stock: StockInfo;
    currentPrice: number;
    changePercent: number;
    high?: number;
    low?: number;
    klineCount: number;
    formula: FormulaResult;
    signals?: SignalEntry[];
    backtestStats?: BacktestStats;
    suggestion?: string;
}
export interface ScreenerCriteria {
    maxPe?: number;
    minPe?: number;
    minRoe?: number;
    minRevenueGrowth?: number;
    minMarketCap?: number;
    maxMarketCap?: number;
    excludeST?: boolean;
    sectorCode?: string;
}
export interface ScreenerResultItem {
    code: string;
    name: string;
    price: number;
    changePercent: number;
    pe?: number;
    roe?: number;
    marketCap?: number;
    revenueGrowth?: number;
}
