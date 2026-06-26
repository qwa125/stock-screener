export interface UnifiedInput {
    baiXiaoDays: number;
    baiBu: boolean;
    baiXiaoStart: boolean;
    qiangShiHuiCai: boolean;
    hengPo: boolean;
    zhenDangMaiDian: boolean;
    zhongWeiZhuSheng: boolean;
    zhongGaoWeiZhuSheng: boolean;
    gaoFengXianZhuSheng: boolean;
    jiaCang: boolean;
    diBuBuy: boolean;
    zhuLiShiPan: boolean;
    gaoWeiHuiDiao: boolean;
    chengLi: boolean;
    jiGouActive: number;
    firstBreakMA5: boolean;
    ma5Up: boolean;
    ma10Up: boolean;
    qingCang: boolean;
    baoLiangFuGai: boolean;
    po5RiXian: boolean;
    jinJiQingCang: boolean;
    kong: boolean;
    zhuLiChuHuo: boolean;
    qiangShiHuiCaiLast3: boolean;
    hengPoLast3: boolean;
    baiXiaoStartLast3: boolean;
}
export interface SuggestionResult {
    suggestion: string;
    signalComb: string;
    color: string;
    reason: string;
    prediction: string;
}
export declare function getSuggestion(f: UnifiedInput): SuggestionResult;
export declare function getTradingSuggestion(input: any): SuggestionResult;
