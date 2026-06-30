export interface SuggestionInput {
    name?: string;
    code?: string;
    baiXiao: boolean;
    baiXiaoDays: number;
    baiBu: boolean;
    baiBuDays?: number;
    baiXiaoBuy1: boolean;
    baiXiaoBuy2: boolean;
    qiangShiHuiCai: boolean;
    hengPanTuPo: boolean;
    shortBuy: boolean;
    strictBuy: boolean;
    zhenDangMaiDian: boolean;
    zhongWeiZhuSheng: boolean;
    zhongGaoWeiZhuSheng: boolean;
    gaoFengXianZhuSheng: boolean;
    jiaCang: boolean;
    diBuBuy: boolean;
    zhuLiShiPan: boolean;
    qiWen: boolean;
    tiaoJianChengLi: boolean;
    zhuLiChuHuo: boolean;
    gaoKaiDiZouQingCang: boolean;
    baoLiangFuGaiQingCang: boolean;
    po5RiXian: boolean;
    qiangZhiFuGai: boolean;
    yinDiePoWei: boolean;
    jiGouActiveScore: number;
    ma5: number;
    ma10: number;
    currentPrice: number;
    ma5Up?: boolean;
    ma10Up?: boolean;
    pricePosition?: number;
    trendState?: number;
    edgeIncomplete?: number;
    confirmedBaiXiaoDays?: number;
    confirmedBaiBuDays?: number;
}
export interface SuggestionResult {
    action: '重仓买入' | '买入' | '轻仓买入' | '持有' | '减仓' | '卖出' | '不要介入';
    reason: string;
    score: number;
    entryTiming: number;
}
export declare function getTradingSuggestion(input: SuggestionInput): SuggestionResult;
