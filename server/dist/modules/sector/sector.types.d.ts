export interface SectorKLine {
    date: string;
    close: number;
}
export interface LeadingStock {
    code: string;
    name: string;
    price: number;
    changePercent: number;
    weight: number;
    priceIncrease?: number;
    pricePosition?: number;
    mainForceInflow?: number;
    score?: number;
    baiXiaoDays?: number;
    diff?: number;
    dea?: number;
    isGoldenCross?: boolean;
    buySignal?: string;
}
export interface SectorRankItem {
    code: string;
    name: string;
    price: number;
    changePercent: number;
    changeAmount: number;
    leadingStocks: LeadingStock[];
    opportunityStocks: LeadingStock[];
}
export interface SectorHotResponse {
    month1: SectorRankItem[];
    bestDay: SectorRankItem[];
    quarter1: SectorRankItem[];
    halfYear: SectorRankItem[];
    year1: SectorRankItem[];
    updateTime: string;
    timestamp: number;
}
