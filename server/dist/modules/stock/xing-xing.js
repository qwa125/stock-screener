"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcXingXing = calcXingXing;
function calcXingXing(engine) {
    const C = engine.CLOSE;
    const H = engine.HIGH;
    const L = engine.LOW;
    const O = engine.OPEN;
    const V = engine.VOL;
    const X_1 = engine.REF(C, 1);
    const diff = [];
    const absDiff = [];
    for (let i = 0; i < engine.length; i++) {
        diff[i] = Math.max(C[i] - X_1[i], 0);
        absDiff[i] = Math.abs(C[i] - X_1[i]);
    }
    const SMA_diff = engine.SMA(diff, 2, 1);
    const SMA_absDiff = engine.SMA(absDiff, 2, 1);
    const X_2 = [];
    for (let i = 0; i < engine.length; i++) {
        X_2[i] = SMA_diff[i] / (SMA_absDiff[i] + 0.00001) * 100;
    }
    const HHV2 = engine.HHV(H, 2);
    const LLV2 = engine.LLV(L, 2);
    const X_4 = [];
    const X_5 = [];
    const X_6 = [];
    const X_7 = [];
    const X_8 = [];
    const X_9 = [];
    const X_10 = [];
    const X_15 = [];
    const X_16 = [];
    const X_17 = [];
    const refC1 = engine.REF(C, 1);
    for (let i = 0; i < engine.length; i++) {
        X_4[i] = C[i] <= O[i] ? C[i] : O[i];
        X_5[i] = (X_4[i] - L[i]) / (L[i] + 0.00001) * 100;
        X_6[i] = (C[i] - refC1[i]) / (refC1[i] + 0.00001) * 100;
        X_7[i] = (O[i] - refC1[i]) / (refC1[i] + 0.00001) * 100;
        X_8[i] = (C[i] - O[i]) / (O[i] + 0.00001) * 100;
        X_9[i] = C[i] >= O[i] ? C[i] : O[i];
        X_10[i] = (H[i] - X_9[i]) / (X_9[i] + 0.00001) * 100;
        const X_11 = X_10[i];
        const X_12 = X_5[i];
        const X_13 = X_8[i] + X_10[i];
        const X_14 = X_8[i] + X_5[i];
        X_15[i] = X_10[i] + X_5[i];
        X_16[i] = X_6[i];
        X_17[i] = X_7[i];
    }
    const 机构活跃度 = [];
    for (let i = 0; i < engine.length; i++) {
        const maxVal = Math.max(X_15[i], X_16[i], X_8[i] + X_5[i], X_8[i] + X_10[i], X_5[i], X_10[i], X_17[i]);
        机构活跃度[i] = maxVal * 1.2;
    }
    const lastIdx = engine.length - 1;
    const val = 机构活跃度[lastIdx];
    return {
        jiGouHuoYueDu: val,
        jiGouHuoYueDuArray: 机构活跃度,
        breakLifeLine: val >= 1.56,
        breakStrongLine: val >= 3,
        breakBigBullLine: val >= 6,
    };
}
