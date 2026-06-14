"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSignals = generateSignals;
const types_1 = require("./types");
function generateSignals(input) {
    const { formula } = input;
    const f = formula;
    const signals = [];
    const isBaiXiao = f.baiXiao && !f.baiBu;
    const isBaiBu = f.baiBu;
    const hongZhu = f.diff > f.dea;
    if (f.trendState === types_1.TrendState.UP_STRONG) {
        signals.push({ name: '主升浪趋势', type: 'positive', description: `趋势强度${f.trendStrength.toFixed(1)}` });
    }
    else if (f.trendState === types_1.TrendState.UP_MILD) {
        signals.push({ name: '上升趋势', type: 'positive', description: `趋势强度${f.trendStrength.toFixed(1)}` });
    }
    else if (f.trendState === types_1.TrendState.SIDEWAYS) {
        signals.push({ name: '横盘震荡', type: 'neutral' });
    }
    else {
        signals.push({ name: '下降趋势', type: 'negative', description: `趋势强度${f.trendStrength.toFixed(1)}` });
    }
    if (isBaiXiao) {
        if (f.baiXiaoDays <= 3) {
            signals.push({ name: '可介入区初期', type: 'positive', description: `第${f.baiXiaoDays}天` });
        }
        else if (f.baiXiaoDays <= 6) {
            signals.push({ name: '可介入区持续', type: 'positive', description: `第${f.baiXiaoDays}天` });
        }
        else {
            signals.push({ name: '可介入区延长', type: 'neutral', description: `第${f.baiXiaoDays}天` });
        }
    }
    else if (isBaiBu) {
        signals.push({ name: '观望区', type: 'neutral' });
    }
    if (hongZhu && f.diff > 0) {
        signals.push({ name: 'DIFF>DEA红柱', type: 'positive', description: `DIFF=${f.diff.toFixed(2)} DEA=${f.dea.toFixed(2)}` });
    }
    else if (!hongZhu && f.diff > 0) {
        signals.push({ name: 'DIFF<DEA', type: 'negative', description: `DIFF=${f.diff.toFixed(2)} DEA=${f.dea.toFixed(2)}` });
    }
    else {
        signals.push({ name: 'DIFF<0', type: 'negative', description: `DIFF=${f.diff.toFixed(2)}` });
    }
    if (f.breakLifeLine) {
        signals.push({ name: '突破生命线', type: 'positive', description: `生命线=${f.lifeLine.toFixed(2)}` });
    }
    if (f.breakStrongLine) {
        signals.push({ name: '突破强势线', type: 'positive', description: `强势线P=3.0` });
    }
    if (f.breakBigBullLine) {
        signals.push({ name: '突破大牛线', type: 'positive', description: `大牛线P=6.0` });
    }
    signals.push({ name: `价格位置${f.pricePosition.toFixed(0)}%`, type: 'neutral', description: f.positionZone });
    if (f.diBuBuy) {
        signals.push({ name: '主力建仓', type: 'positive', description: `集中度${f.concentration.toFixed(0)}` });
    }
    if (f.gaoWeiHuiDiaoBuy) {
        signals.push({ name: '企稳信号', type: 'positive' });
    }
    if (f.zhuLiShiPan) {
        signals.push({ name: '主力试盘', type: 'positive' });
    }
    if (f.jiaCang) {
        signals.push({ name: '加仓信号', type: 'positive' });
    }
    if (f.baiXiaoBuy1) {
        signals.push({ name: '启动买点', type: 'positive' });
    }
    if (f.baiXiaoBuy2) {
        signals.push({ name: '横盘突破', type: 'positive' });
    }
    if (f.qiangShiHuiCai) {
        signals.push({ name: '强势回踩', type: 'positive' });
    }
    if (f.shortBuy && !f.shortSell) {
        signals.push({ name: '短线触发', type: 'positive' });
    }
    if (f.shortSell && !f.shortBuy) {
        signals.push({ name: '短线风险', type: 'negative' });
    }
    if (f.zhuLiXiChou) {
        signals.push({ name: '主力吸筹', type: 'positive', description: `集中度${f.concentration.toFixed(0)}` });
    }
    if (f.zhuLiChuHuo) {
        signals.push({ name: '主力出货', type: 'negative' });
    }
    if (f.strongSell) {
        signals.push({ name: '强化卖出', type: 'negative' });
    }
    if (f.buySignalDiamond) {
        signals.push({ name: '买入信号', type: 'positive' });
    }
    if (f.zhuShengZhongWeiChuHuo) {
        signals.push({ name: '中位出货', type: 'negative' });
    }
    if (f.zhenShiChuHuo) {
        signals.push({ name: '真实出货', type: 'negative' });
    }
    if (f.xiPanQueRen) {
        signals.push({ name: '洗盘确认', type: 'neutral' });
    }
    if (f.jiGouHuoYueDu >= 15) {
        signals.push({ name: '机构活跃度高', type: 'positive', description: `${f.jiGouHuoYueDu.toFixed(1)}` });
    }
    else if (f.jiGouHuoYueDu >= 12) {
        signals.push({ name: '机构活跃度中等', type: 'neutral', description: `${f.jiGouHuoYueDu.toFixed(1)}` });
    }
    else if (f.jiGouHuoYueDu >= 8) {
        signals.push({ name: '机构活跃度偏低', type: 'negative', description: `${f.jiGouHuoYueDu.toFixed(1)}` });
    }
    else {
        signals.push({ name: '机构活跃度低', type: 'negative', description: `${f.jiGouHuoYueDu.toFixed(1)}` });
    }
    if (f.gaoKaiDiZouQingCang) {
        signals.push({ name: '高开低走', type: 'negative' });
    }
    if (f.baoLiangFuGaiQingCang) {
        signals.push({ name: '爆量覆盖', type: 'negative' });
    }
    if (f.po5RiXian) {
        signals.push({ name: '跌破5日线', type: 'negative' });
    }
    if (f.yinDiePoWei) {
        signals.push({ name: '阴跌破位', type: 'negative' });
    }
    if (f.xiPanHuoMian) {
        signals.push({ name: '洗盘豁免', type: 'neutral' });
    }
    if (f.safe) {
        signals.push({ name: '安全信号', type: 'positive' });
    }
    if (f.xiPanSignal) {
        signals.push({ name: '洗盘信号', type: 'neutral' });
    }
    const seen = new Set();
    return signals.filter(s => {
        const key = s.name;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
