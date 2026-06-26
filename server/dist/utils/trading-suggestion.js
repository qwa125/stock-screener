"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSuggestion = getSuggestion;
exports.getTradingSuggestion = getTradingSuggestion;
const ACTION_COLORS = {
    '重仓买入': 'bg-red-600',
    '买入': 'bg-emerald-500',
    '轻仓买入': 'bg-amber-500',
    '持有': 'bg-yellow-500',
    '减仓': 'bg-orange-500',
    '卖出': 'bg-rose-600',
    '不要介入': 'bg-gray-500',
};
const ACTION_REASONS = {
    '重仓买入': ['出现白消启动/强势回踩+主升信号(重仓级别)', '预计将继续强势上攻(重仓买入)'],
    '买入': ['出现横盘突破/强势回踩+主升信号(买入级别)', '预计将继续上攻(买入)'],
    '轻仓买入': ['白布阶段出现建仓/企稳/试盘/加仓信号(轻仓级别)', '预计震荡上行(轻仓买入)'],
    '持有': ['10日线往上，趋势向好', '预计将维持现有趋势(持有)'],
    '减仓': ['白消阶段出现主力出货信号', '注意回调风险(减仓)'],
    '卖出': ['出现清仓/爆量覆盖/破线/紧急清仓/空信号', '主力出货，后市看跌(卖出)'],
    '不要介入': ['10日线往下，均线空头压制', '预计继续探底(不要介入)'],
};
function makeResult(suggestion, signalComb) {
    const [reason, prediction] = ACTION_REASONS[suggestion] || ['', ''];
    return { suggestion, signalComb, color: ACTION_COLORS[suggestion] || 'bg-gray-500', reason, prediction };
}
function getSuggestion(f) {
    const buyRisePoints = f.zhongWeiZhuSheng || f.zhongGaoWeiZhuSheng || f.gaoFengXianZhuSheng || f.jiaCang;
    const anyRisePoints = buyRisePoints || f.zhenDangMaiDian;
    const jiGouActiveBreak = f.jiGouActive >= 12 && f.firstBreakMA5 && f.ma5Up && f.ma10Up;
    if (f.qingCang || f.baoLiangFuGai || f.po5RiXian)
        return makeResult('卖出', '清仓/爆量覆盖/破5日线');
    if (f.jinJiQingCang)
        return makeResult('卖出', '紧急清仓');
    if (f.kong)
        return makeResult('卖出', '空');
    if (f.baiXiaoDays > 0 && f.zhuLiChuHuo)
        return makeResult('减仓', '白消+主力出货');
    if (f.baiXiaoDays >= 1 && f.baiXiaoDays <= 6) {
        if (f.baiXiaoStart && anyRisePoints)
            return makeResult('重仓买入', '白消启动+主升/加仓(重仓)');
        if (f.qiangShiHuiCai && anyRisePoints)
            return makeResult('重仓买入', '强势回踩+主升/加仓(重仓)');
        if (f.qiangShiHuiCaiLast3 && anyRisePoints)
            return makeResult('重仓买入', '强势回踩->主升/加仓(重仓)');
        if (f.baiXiaoStartLast3 && anyRisePoints)
            return makeResult('重仓买入', '白消启动->主升/加仓(重仓)');
        if (buyRisePoints)
            return makeResult('重仓买入', '主升/加仓(重仓)');
        if (f.qiangShiHuiCai)
            return makeResult('重仓买入', '强势回踩(重仓)');
        if (f.baiXiaoStart)
            return makeResult('重仓买入', '白消启动(重仓)');
        if (jiGouActiveBreak)
            return makeResult('重仓买入', '机构突破均线(重仓)');
    }
    if (f.baiXiaoDays >= 7) {
        if (f.hengPo && anyRisePoints)
            return makeResult('买入', '横盘突破+主升(买入)');
        if (f.hengPoLast3 && anyRisePoints)
            return makeResult('买入', '横盘突破->主升(买入)');
        if (f.qiangShiHuiCai && anyRisePoints)
            return makeResult('买入', '强势回踩+主升(买入)');
        if (f.qiangShiHuiCaiLast3 && anyRisePoints)
            return makeResult('买入', '强势回踩->主升(买入)');
        if (f.hengPo)
            return makeResult('买入', '横盘突破(买入)');
        if (jiGouActiveBreak)
            return makeResult('买入', '机构突破均线(买入)');
    }
    if (f.baiBu) {
        if (jiGouActiveBreak)
            return makeResult('轻仓买入', '白布+机构突破均线(轻仓)');
        if (f.diBuBuy || f.gaoWeiHuiDiao || f.zhuLiShiPan || f.jiaCang) {
            const parts = ['白布'];
            if (f.diBuBuy)
                parts.push('主力建仓');
            if (f.gaoWeiHuiDiao)
                parts.push('企稳');
            if (f.zhuLiShiPan)
                parts.push('主力试盘');
            if (f.jiaCang)
                parts.push('加仓');
            return makeResult('轻仓买入', parts.join('+'));
        }
    }
    if (f.ma10Up)
        return makeResult('持有', '10日线往上');
    return makeResult('不要介入', '10日线往下');
}
function getTradingSuggestion(input) {
    return getSuggestion({
        baiXiaoDays: input.baiXiaoDays ?? 0,
        baiBu: !!input.baiBu,
        baiXiaoStart: !!input.baiXiaoStart,
        qiangShiHuiCai: !!input.qiangShiHuiCai,
        hengPo: !!input.hengPo,
        zhenDangMaiDian: !!input.zhenDangMaiDian,
        zhongWeiZhuSheng: !!input.zhongWeiZhuSheng,
        zhongGaoWeiZhuSheng: !!input.zhongGaoWeiZhuSheng,
        gaoFengXianZhuSheng: !!input.gaoFengXianZhuSheng,
        jiaCang: !!input.jiaCang,
        diBuBuy: !!input.diBuBuy,
        zhuLiShiPan: !!input.zhuLiShiPan,
        gaoWeiHuiDiao: !!input.gaoWeiHuiDiao,
        chengLi: !!input.chengLi,
        jiGouActive: input.jiGouActive ?? 0,
        firstBreakMA5: !!input.firstBreakMA5,
        ma5Up: !!input.ma5Up,
        ma10Up: !!input.ma10Up,
        qingCang: !!input.qingCang,
        baoLiangFuGai: !!input.baoLiangFuGai,
        po5RiXian: !!input.po5RiXian,
        jinJiQingCang: !!input.jinJiQingCang,
        kong: !!input.kong,
        zhuLiChuHuo: !!input.zhuLiChuHuo,
        qiangShiHuiCaiLast3: !!input.qiangShiHuiCaiLast3,
        hengPoLast3: !!input.hengPoLast3,
        baiXiaoStartLast3: !!input.baiXiaoStartLast3,
    });
}
