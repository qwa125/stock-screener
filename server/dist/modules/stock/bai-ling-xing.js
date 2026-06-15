"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcBaiLingXing = calcBaiLingXing;
const types_1 = require("./types");
function calcBaiLingXing(engine) {
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
        是否新低[i] = L[i] <= 动态低点[i] && barCount[i] > N;
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
    const std30 = engine.STD(C, 30);
    const ma30 = engine.MA(C, 30);
    const 价格波动率 = [];
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
    const ma20 = engine.MA(C, 20);
    const ma10 = engine.MA(C, 10);
    const ma5 = engine.MA(C, 5);
    const 洗盘特征 = [];
    for (let i = 0; i < engine.length; i++) {
        洗盘特征[i] =
            (趋势状态[i] >= types_1.TrendState.UP_MILD) &&
                (C[i] < O[i]) &&
                (V[i] > VOL_MA60[i] * 1.2) &&
                (C[i] > ma10[i] * 0.98) &&
                (C[i] > L[i]) &&
                !位置_极端风险区[i] &&
                ((C[i] > engine.REF(C, 1)[i]) ||
                    (C[i] > ma5[i] && (C[i] - L[i]) > (H[i] - C[i])) ||
                    (C[i] > ma10[i] && V[i] > VOL_MA60[i] * 1.5) ||
                    (engine.REF(C, 1)[i] > ma10[i] && L[i] <= ma10[i] && C[i] > ma10[i] && (C[i] - L[i]) > (O[i] - C[i]) * 1.5));
    }
    const 主力吸筹 = [];
    const 主力出货 = [];
    for (let i = 0; i < engine.length; i++) {
        主力吸筹[i] =
            V[i] > VOL_MA60[i] * 1.8 &&
                C[i] > O[i] * 1.02 &&
                (C[i] - L[i]) / (H[i] - L[i] + 0.00001) > 0.7 &&
                (H[i] - L[i]) > ma20[i] * 0.01;
        主力出货[i] =
            V[i] > VOL_MA60[i] * 1.5 &&
                V[i] > engine.REF(V, 1)[i] &&
                C[i] < O[i] &&
                (C[i] < ma5[i] || (H[i] - C[i]) > (C[i] - O[i]) * 1.5) &&
                (H[i] - C[i]) / (H[i] - L[i] + 0.00001) > 0.6 &&
                (H[i] - L[i]) > ma20[i] * 0.01 &&
                !(趋势状态[i] >= types_1.TrendState.UP_MILD && 洗盘特征[i]);
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
        短线买4[i] = 中形态[i] && engine.COUNT(L.map((v, idx) => v <= 中位价格[idx] * 1.01), 2)[i] >= 1 && engine.CROSS(C, 价格通道上轨)[i];
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
        短线卖4[i] = 中形态[i] && C[i] > 价格通道上轨[i] * 1.02 && V[i] > engine.REF(engine.MA(V, 5), 1)[i] * 1.2;
        短线卖5[i] = 高位形态[i] && H[i] >= 价格通道上轨[i] * 0.99 && C[i] < 价格通道上轨[i] && V[i] > VOL_MA20[i] * 1.8;
        短线卖6[i] = 高位形态[i] && C[i] > 价格通道上轨[i] * 1.03 && V[i] > VOL_MA20[i] * 2.0;
        短线卖7[i] = 位置_中位区[i] && (压力回撤[i] || 量价背离[i]) && V[i] > VOL_MA20[i];
        短线卖8[i] = 位置_高位警戒区[i] && 破位下跌[i];
        短线卖9[i] = 位置_极端风险区[i] && engine.COUNT(C.map((v, idx) => v < engine.REF(C, 1)[idx]), 3)[i] >= 2;
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
        洗盘信号[i] = (主力出货[i] && 趋势状态[i] >= types_1.TrendState.UP_MILD && (位置_低位区[i] || 位置_中位区[i])) ||
            (主力出货[i] && 趋势状态[i] >= types_1.TrendState.UP_MILD && 洗盘特征[i]);
        观望区出货[i] = 主力出货[i] && 趋势状态[i] === types_1.TrendState.SIDEWAYS;
        紧急出货[i] = 主力出货[i] && (位置_高位警戒区[i] || 位置_高风险区[i] || 位置_极端风险区[i]) &&
            !(趋势状态[i] >= types_1.TrendState.UP_MILD && 洗盘特征[i]) &&
            C[i] < ma5[i] * 0.98 &&
            C[i] < ma10[i] * 0.98;
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
    const 洗盘后反转买点 = [];
    const ref洗盘信号 = engine.REF(洗盘信号, 1);
    for (let i = 0; i < engine.length; i++) {
        洗盘后反转买点[i] = !!(洗盘信号[i] && !ref洗盘信号[i] && C[i] > ma5[i] && V[i] > engine.REF(V, 1)[i] * 1.2 && V[i] < engine.REF(V, 1)[i] * 2.0);
    }
    const 严格买入信号 = [];
    for (let i = 0; i < engine.length; i++) {
        严格买入信号[i] = (短线买入[i] || 洗盘后反转买点[i]) && !主力出货[i] && !超高位风险[i];
    }
    const 主升中位出货 = [];
    const 洗盘确认 = [];
    const 真实出货 = [];
    for (let i = 0; i < engine.length; i++) {
        主升中位出货[i] = 位置_中位区[i] && 趋势状态[i] === types_1.TrendState.UP_STRONG && 主力出货[i];
        洗盘确认[i] = 主升中位出货[i] && (V[i] < VOL_MA60[i] * 1.5 || (C[i] - L[i]) / (H[i] - L[i]) < 0.3);
        真实出货[i] = 主升中位出货[i] && V[i] > VOL_MA60[i] * 2.0 && (H[i] - C[i]) > (C[i] - O[i]) * 1.5;
    }
    const lastIdx = engine.length - 1;
    return {
        buySignalDiamond: 严格买入信号[lastIdx],
        xiPanFanZhuanBuy: 洗盘后反转买点[lastIdx],
        zhuShengZhongWeiChuHuo: 主升中位出货[lastIdx],
        zhenShiChuHuo: 真实出货[lastIdx],
        xiPanQueRen: 洗盘确认[lastIdx],
    };
}
