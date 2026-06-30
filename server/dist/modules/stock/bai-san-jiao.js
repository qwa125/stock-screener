"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcBaiSanJiao = calcBaiSanJiao;
const types_1 = require("./types");
function calcBaiSanJiao(engine) {
    const N = 500;
    const C = engine.CLOSE;
    const H = engine.HIGH;
    const L = engine.LOW;
    const V = engine.VOL;
    const O = engine.OPEN;
    const 动态低点 = engine.LLV(L, N);
    const barCount = engine.BARSCOUNT();
    const 是否新低 = [];
    for (let i = 0; i < engine.length; i++) {
        是否新低[i] = L[i] <= 动态低点[i];
    }
    const 真实高点 = engine.HHV(H, Math.round(N * 0.7));
    const ref动态低点 = engine.REF(动态低点, 1);
    const 真实低点 = [];
    for (let i = 0; i < engine.length; i++) {
        真实低点[i] = 是否新低[i] ? L[i] : ref动态低点[i];
    }
    const 股价相对位置 = [];
    for (let i = 0; i < engine.length; i++) {
        股价相对位置[i] = (C[i] - 真实低点[i]) / (真实高点[i] - 真实低点[i] + 0.00001) * 100;
    }
    const 股价位置 = engine.EMA(股价相对位置, 3);
    const VOL_MA5 = engine.MA(V, 5);
    const VOL_MA20 = engine.MA(V, 20);
    const VOL_MA60 = engine.MA(V, 60);
    const 短期趋势 = engine.EMA(C, 12);
    const 中期趋势 = engine.EMA(C, 50);
    const 价格通道上轨 = engine.HHV(H, 20);
    const 价格通道下轨 = engine.LLV(L, 20);
    const 中位价格 = [];
    for (let i = 0; i < engine.length; i++) {
        中位价格[i] = (价格通道上轨[i] + 价格通道下轨[i]) / 2;
    }
    const 价格波动率 = [];
    const std30 = engine.STD(C, 30);
    const ma30 = engine.MA(C, 30);
    for (let i = 0; i < engine.length; i++) {
        价格波动率[i] = std30[i] / (ma30[i] + 0.00001);
    }
    const 集中度替代 = [];
    for (let i = 0; i < engine.length; i++) {
        集中度替代[i] = 100 - (价格波动率[i] * 100);
    }
    const ifYang = [];
    const ifYin = [];
    for (let i = 0; i < engine.length; i++) {
        ifYang[i] = C[i] > O[i] ? V[i] : 0;
        ifYin[i] = C[i] < O[i] ? V[i] : 0;
    }
    const sumYang = engine.SUM(ifYang, 3);
    const sumYin = engine.SUM(ifYin, 3);
    const 量能结构 = [];
    for (let i = 0; i < engine.length; i++) {
        量能结构[i] = sumYin[i] / (sumYang[i] + 0.00001) * 100;
    }
    const ref短期趋势5 = engine.REF(短期趋势, 5);
    const 趋势强度 = [];
    for (let i = 0; i < engine.length; i++) {
        趋势强度[i] = (短期趋势[i] - ref短期趋势5[i]) / (ref短期趋势5[i] + 0.00001) * 100;
    }
    const 趋势状态 = [];
    for (let i = 0; i < engine.length; i++) {
        if (趋势强度[i] > 7)
            趋势状态[i] = types_1.TrendState.UP_STRONG;
        else if (趋势强度[i] > 4)
            趋势状态[i] = types_1.TrendState.UP_MILD;
        else if (趋势强度[i] > 0)
            趋势状态[i] = types_1.TrendState.SIDEWAYS;
        else
            趋势状态[i] = types_1.TrendState.DOWN;
    }
    const 位置_低位区 = [];
    const 位置_中位区 = [];
    const 位置_高位警戒区 = [];
    const 位置_高风险区 = [];
    const 位置_极端风险区 = [];
    for (let i = 0; i < engine.length; i++) {
        位置_低位区[i] = 股价位置[i] < 30 || (是否新低[i] && 股价位置[i] < 45);
        位置_中位区[i] = 股价位置[i] >= 30 && 股价位置[i] < 65;
        位置_高位警戒区[i] = 股价位置[i] >= 65 && 股价位置[i] < 85;
        位置_高风险区[i] = 股价位置[i] >= 85 && 股价位置[i] < 90;
        位置_极端风险区[i] = 股价位置[i] >= 90;
    }
    const 底形态 = [];
    const 中形态 = [];
    const 高位形态 = [];
    const 高危形态 = [];
    const 超高危形态 = [];
    for (let i = 0; i < engine.length; i++) {
        底形态[i] = 位置_低位区[i] && 集中度替代[i] > 82;
        中形态[i] = 位置_中位区[i] && 集中度替代[i] > 75;
        高位形态[i] = 位置_高位警戒区[i] && 集中度替代[i] > 78;
        高危形态[i] = 位置_高风险区[i] && 集中度替代[i] > 80;
        超高危形态[i] = 位置_极端风险区[i] && 集中度替代[i] > 82;
    }
    const 主力吸筹 = [];
    const 主力出货 = [];
    const ma20 = engine.MA(C, 20);
    for (let i = 0; i < engine.length; i++) {
        主力吸筹[i] =
            V[i] > VOL_MA60[i] * 1.8 &&
                C[i] > O[i] * 1.02 &&
                (C[i] - L[i]) / (H[i] - L[i] + 0.00001) > 0.7 &&
                (H[i] - L[i]) > ma20[i] * 0.01;
        主力出货[i] =
            V[i] > VOL_MA60[i] * 1.8 &&
                C[i] < O[i] * 0.98 &&
                (H[i] - C[i]) / (H[i] - L[i] + 0.00001) > 0.6 &&
                (H[i] - L[i]) > ma20[i] * 0.01;
    }
    const cross1 = engine.CROSS(C, engine.REF(H, 1));
    const 短线买1 = [];
    const 短线买2 = [];
    const 短线买3 = [];
    const 短线买4 = [];
    const 短线买5 = [];
    const 短线买6 = [];
    const 短线买7 = [];
    const 短线买8 = [];
    const 短线买9 = [];
    for (let i = 0; i < engine.length; i++) {
        短线买1[i] = 底形态[i] && L[i] <= 价格通道下轨[i] * 1.01 && cross1[i] && V[i] > engine.REF(V, 1)[i] * 1.3;
        短线买2[i] = 底形态[i] && L[i] <= 中位价格[i] * 1.01 && C[i] > 中位价格[i] && V[i] > VOL_MA5[i];
        短线买3[i] = 中形态[i] && engine.REF(L, 1)[i] <= 价格通道下轨[i] && C[i] > 价格通道下轨[i] && V[i] > engine.REF(V, 1)[i] * 1.5;
        短线买4[i] = 中形态[i] && engine.COUNT(engine.MIN(L, 中位价格.map(v => v * 1.01)).map((v, idx) => L[idx] <= 中位价格[idx] * 1.01), 2)[i] >= 1 && engine.CROSS(C, 价格通道上轨)[i];
        短线买5[i] = 高位形态[i] && C[i] > 中位价格[i] && C[i] < 价格通道上轨[i] && V[i] > VOL_MA20[i] * 1.2;
        短线买6[i] = 高位形态[i] && C[i] > 价格通道下轨[i] && C[i] < 价格通道上轨[i] && V[i] > engine.REF(engine.MA(V, 5), 1)[i];
        短线买7[i] = 高危形态[i] && 主力吸筹[i] && C[i] > 中位价格[i] * 1.02 && V[i] > VOL_MA60[i] * 1.5;
        短线买8[i] = 高危形态[i] && 主力吸筹[i] && C[i] > 中位价格[i] && V[i] > VOL_MA60[i] * 1.8;
        短线买9[i] = 超高危形态[i] && 主力吸筹[i] && C[i] > 中位价格[i] * 1.03 && V[i] > VOL_MA60[i] * 2.0;
    }
    const 短线买入 = [];
    for (let i = 0; i < engine.length; i++) {
        短线买入[i] = 短线买1[i] || 短线买2[i] || 短线买3[i] || 短线买4[i] || 短线买5[i] ||
            短线买6[i] || 短线买7[i] || 短线买8[i] || 短线买9[i];
    }
    const 压力回撤 = [];
    const 量价背离 = [];
    const 破位下跌 = [];
    const ma5 = engine.MA(C, 5);
    for (let i = 0; i < engine.length; i++) {
        压力回撤[i] = C[i] < O[i] && H[i] > (engine.REF(H, 1)[i]) && (H[i] - C[i]) / C[i] > 0.015;
        量价背离[i] = C[i] > (engine.REF(C, 1)[i]) && V[i] < (engine.REF(V, 1)[i]) * 0.8;
        破位下跌[i] = C[i] < ma5[i] && C[i] < (engine.REF(L, 1)[i]);
    }
    const 短线卖1 = [];
    const 短线卖2 = [];
    const 短线卖3 = [];
    const 短线卖4 = [];
    const 短线卖5 = [];
    const 短线卖6 = [];
    const 短线卖7 = [];
    const 短线卖8 = [];
    const 短线卖9 = [];
    const 短线卖10 = [];
    const 短线卖11 = [];
    const 短线卖12 = [];
    const 短线卖13 = [];
    const 短线卖14 = [];
    for (let i = 0; i < engine.length; i++) {
        短线卖1[i] = 底形态[i] && H[i] >= 价格通道上轨[i] * 0.99 && C[i] < O[i] * 0.99 && V[i] > VOL_MA5[i] * 1.3;
        短线卖2[i] = 底形态[i] && H[i] >= 价格通道上轨[i] * 0.99 && C[i] < 中位价格[i] && V[i] > VOL_MA20[i] * 1.2;
        短线卖3[i] = 中形态[i] && C[i] > 价格通道上轨[i] * 1.02 && V[i] > VOL_MA20[i] * 1.5;
        短线卖4[i] = 中形态[i] && C[i] > 价格通道上轨[i] * 1.02 && V[i] > (engine.REF(engine.MA(V, 5), 1)[i]) * 1.2;
        短线卖5[i] = 高位形态[i] && H[i] >= 价格通道上轨[i] * 0.99 && C[i] < 价格通道上轨[i] && V[i] > VOL_MA20[i] * 1.8;
        短线卖6[i] = 高位形态[i] && C[i] > 价格通道上轨[i] * 1.03 && V[i] > VOL_MA20[i] * 2.0;
        短线卖7[i] = 位置_中位区[i] && (压力回撤[i] || 量价背离[i]) && V[i] > VOL_MA20[i];
        短线卖8[i] = 位置_高位警戒区[i] && 破位下跌[i];
        短线卖9[i] = 位置_极端风险区[i] && engine.COUNT(C.map((v, idx) => v < (engine.REF(C, 1)[idx])), 3)[i] >= 2;
        短线卖10[i] = 位置_高风险区[i] && 主力出货[i];
        短线卖11[i] = 位置_极端风险区[i] && (量价背离[i] || 破位下跌[i]);
        短线卖12[i] = 位置_高风险区[i] && C[i] > 价格通道上轨[i] * 1.05 && V[i] > VOL_MA60[i] * 2.0;
        短线卖13[i] = 位置_极端风险区[i] && 主力出货[i];
        短线卖14[i] = 位置_极端风险区[i] && 量能结构[i] > 70;
    }
    const 高位预警 = [];
    for (let i = 0; i < engine.length; i++) {
        高位预警[i] = 位置_高位警戒区[i] && ((C[i] < O[i] && H[i] > (engine.REF(H, 1)[i])) ||
            (C[i] < (engine.REF(C, 1)[i]) && V[i] > VOL_MA20[i] * 1.8));
    }
    const 洗盘信号 = [];
    const 观望区出货 = [];
    const 紧急出货 = [];
    for (let i = 0; i < engine.length; i++) {
        洗盘信号[i] = 主力出货[i] && 趋势状态[i] >= types_1.TrendState.UP_MILD && (位置_低位区[i] || 位置_中位区[i]);
        观望区出货[i] = 主力出货[i] && 趋势状态[i] === types_1.TrendState.SIDEWAYS;
        紧急出货[i] = 主力出货[i] && (位置_高位警戒区[i] || 位置_高风险区[i] || 位置_极端风险区[i]);
    }
    const 短线卖出 = [];
    const 超高位风险 = [];
    for (let i = 0; i < engine.length; i++) {
        短线卖出[i] = 短线卖1[i] || 短线卖2[i] || 短线卖3[i] || 短线卖4[i] || 短线卖5[i] ||
            短线卖6[i] || 短线卖7[i] || 短线卖8[i] || 短线卖9[i] || 短线卖10[i] ||
            短线卖11[i] || 短线卖12[i] || 短线卖13[i] || 短线卖14[i] ||
            高位预警[i] || 观望区出货[i] || 紧急出货[i];
        超高位风险[i] = 短线卖13[i] || 短线卖14[i];
    }
    const 最近卖出 = engine.BARSLAST(短线卖出);
    const 卖出后冷却 = [];
    const 趋势反转确认 = [];
    const 量价齐升 = [];
    const 趋势强化信号 = [];
    const 冷却期趋势买点 = [];
    const 冷却期后趋势买点 = [];
    for (let i = 0; i < engine.length; i++) {
        卖出后冷却[i] = 最近卖出[i] <= 3 && 最近卖出[i] > 0;
        趋势反转确认[i] = engine.CROSS(短期趋势, 中期趋势)[i] && V[i] > VOL_MA20[i];
        量价齐升[i] = C[i] > (engine.REF(H, 1)[i]) && V[i] > (engine.REF(V, 1)[i]) * 1.3;
        趋势强化信号[i] = 趋势状态[i] >= types_1.TrendState.UP_MILD && 集中度替代[i] > 75 && V[i] > VOL_MA5[i] * 1.2;
        冷却期趋势买点[i] = 卖出后冷却[i] && (趋势反转确认[i] || 量价齐升[i] || 趋势强化信号[i]);
        冷却期后趋势买点[i] = 最近卖出[i] > 3 && 趋势状态[i] >= types_1.TrendState.UP_MILD && V[i] > VOL_MA5[i] * 1.2 &&
            (C[i] > 中位价格[i] || engine.CROSS(C, 价格通道上轨)[i]);
    }
    const 严格买入信号 = [];
    const 强化卖出信号 = [];
    for (let i = 0; i < engine.length; i++) {
        严格买入信号[i] = (短线买入[i] || 冷却期趋势买点[i] || 冷却期后趋势买点[i]) &&
            !主力出货[i] && !超高位风险[i];
        强化卖出信号[i] = 短线卖出[i] || 主力出货[i] || 超高位风险[i];
    }
    const 同现信号 = [];
    let 冲突 = null;
    const lastIdx = engine.length - 1;
    for (let i = 0; i < engine.length; i++) {
        同现信号[i] = 严格买入信号[i] && 强化卖出信号[i];
    }
    if (同现信号[lastIdx]) {
        if (趋势状态[lastIdx] >= types_1.TrendState.UP_MILD && 洗盘信号[lastIdx]) {
            冲突 = '冲突-洗盘期逢低加仓';
        }
        else if (趋势状态[lastIdx] === types_1.TrendState.SIDEWAYS) {
            冲突 = '冲突-震荡期观望';
        }
        else if (趋势状态[lastIdx] === types_1.TrendState.DOWN) {
            冲突 = '冲突-下降期放弃';
        }
        else if (位置_低位区[lastIdx]) {
            冲突 = '冲突-低位优先买入';
        }
        else if (位置_中位区[lastIdx]) {
            冲突 = '冲突-中位控制仓位';
        }
        else if (位置_高位警戒区[lastIdx]) {
            冲突 = '冲突-高位建议观望';
        }
        else if (位置_高风险区[lastIdx]) {
            冲突 = '冲突-风险区应卖出';
        }
        else if (位置_极端风险区[lastIdx]) {
            冲突 = '冲突-极端区必卖出';
        }
    }
    const 买点_高位震荡 = [];
    const 买点_中位主升 = [];
    const 买点_中转高主升 = [];
    const 买点_高转风险主升 = [];
    for (let i = 0; i < engine.length; i++) {
        买点_高位震荡[i] = 位置_高位警戒区[i] && 趋势状态[i] === types_1.TrendState.SIDEWAYS && 短线买入[i];
        买点_中位主升[i] = 位置_中位区[i] && 趋势状态[i] === types_1.TrendState.UP_STRONG && 严格买入信号[i] && 主力吸筹[i];
        买点_中转高主升[i] = (i > 0 ? 位置_中位区[i - 1] : false) && 位置_高位警戒区[i] && 趋势状态[i] === types_1.TrendState.UP_STRONG && 严格买入信号[i] && 主力吸筹[i];
        买点_高转风险主升[i] = (i > 0 ? 位置_高位警戒区[i - 1] : false) && (位置_高风险区[i] || 位置_极端风险区[i]) && 趋势状态[i] === types_1.TrendState.UP_STRONG && 严格买入信号[i] && 主力吸筹[i];
    }
    const bestBuyPoints = [];
    if (买点_高位震荡[lastIdx])
        bestBuyPoints.push('震荡买点');
    if (买点_中位主升[lastIdx])
        bestBuyPoints.push('中位主升');
    if (买点_中转高主升[lastIdx])
        bestBuyPoints.push('中→高主升');
    if (买点_高转风险主升[lastIdx])
        bestBuyPoints.push('高→风险主升');
    return {
        pricePosition: 股价位置[lastIdx],
        positionZone: 位置_极端风险区[lastIdx] ? types_1.PositionZone.EXTREME_RISK :
            位置_高风险区[lastIdx] ? types_1.PositionZone.HIGH_RISK :
                位置_高位警戒区[lastIdx] ? types_1.PositionZone.HIGH_ALERT :
                    位置_中位区[lastIdx] ? types_1.PositionZone.MID :
                        types_1.PositionZone.LOW,
        trendState: 趋势状态[lastIdx],
        trendStrength: 趋势强度[lastIdx],
        concentration: 集中度替代[lastIdx],
        volumeStructure: 量能结构[lastIdx],
        shortBuy: 短线买入[lastIdx],
        shortSell: 短线卖出[lastIdx],
        strictBuy: 严格买入信号[lastIdx],
        strongSell: 强化卖出信号[lastIdx],
        zhuLiXiChou: 主力吸筹[lastIdx],
        zhuLiChuHuo: 主力出货[lastIdx],
        xiPanSignal: 洗盘信号[lastIdx],
        coolingAfterSell: 卖出后冷却[lastIdx],
        coolingTrendBuy: 冷却期趋势买点[lastIdx],
        zhenDangMaiDian: 买点_高位震荡[lastIdx],
        zhongWeiZhuSheng: 买点_中位主升[lastIdx],
        zhongGaoWeiZhuSheng: 买点_中转高主升[lastIdx],
        gaoFengXianZhuSheng: 买点_高转风险主升[lastIdx],
        bestBuyPoints,
        conflict: 冲突,
    };
}
