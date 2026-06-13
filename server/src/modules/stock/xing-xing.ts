/**
 * ☆★公式计算
 * 翻译自用户的同名同花顺指标代码
 * 主要计算机构活跃度指标
 */
import { FormulaEngine } from './formula-engine';
import { FormulaResult } from './types';

export function calcXingXing(engine: FormulaEngine): Pick<FormulaResult,
  'jiGouHuoYueDu' | 'breakLifeLine' | 'breakStrongLine' | 'breakBigBullLine' | 'jiGouHuoYueDuArray'
> {
  const C = engine.CLOSE;
  const H = engine.HIGH;
  const L = engine.LOW;
  const O = engine.OPEN;
  const V = engine.VOL;

  // ===== 基础计算 =====
  const X_1 = engine.REF(C, 1);

  // X_2 = SMA(MAX(CLOSE-X_1,0),2,1)/SMA(ABS(CLOSE-X_1),2,1)*100
  const diff: number[] = [];
  const absDiff: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    diff[i] = Math.max(C[i] - X_1[i], 0);
    absDiff[i] = Math.abs(C[i] - X_1[i]);
  }
  const SMA_diff = engine.SMA(diff, 2, 1);
  const SMA_absDiff = engine.SMA(absDiff, 2, 1);
  const X_2: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    X_2[i] = SMA_diff[i] / (SMA_absDiff[i] + 0.00001) * 100;
  }

  // 不需要 X_3 的展示值，但算一下
  // X_3 = 100*(HHV(HIGH,2)-CLOSE)/(HHV(HIGH,2)-LLV(LOW,2))
  const HHV2 = engine.HHV(H, 2);
  const LLV2 = engine.LLV(L, 2);

  // ===== 关键变量计算 =====
  const X_4: number[] = [];
  const X_5: number[] = [];
  const X_6: number[] = [];
  const X_7: number[] = [];
  const X_8: number[] = [];
  const X_9: number[] = [];
  const X_10: number[] = [];
  const X_15: number[] = [];
  const X_16: number[] = [];
  const X_17: number[] = [];

  const refC1 = engine.REF(C, 1);

  for (let i = 0; i < engine.length; i++) {
    // X_4 = IF(C<=O, C, O)  --- 即开盘价和收盘价中较小的
    X_4[i] = C[i] <= O[i] ? C[i] : O[i];

    // X_5 = (X_4 - LOW) / LOW * 100
    X_5[i] = (X_4[i] - L[i]) / (L[i] + 0.00001) * 100;

    // X_6 = (CLOSE-REF(CLOSE,1))/REF(CLOSE,1)*100
    X_6[i] = (C[i] - refC1[i]) / (refC1[i] + 0.00001) * 100;

    // X_7 = (OPEN-REF(CLOSE,1))/REF(CLOSE,1)*100
    X_7[i] = (O[i] - refC1[i]) / (refC1[i] + 0.00001) * 100;

    // X_8 = (CLOSE-OPEN)/OPEN*100
    X_8[i] = (C[i] - O[i]) / (O[i] + 0.00001) * 100;

    // X_9 = IF(CLOSE>=OPEN,CLOSE,OPEN)
    X_9[i] = C[i] >= O[i] ? C[i] : O[i];

    // X_10 = (HIGH-X_9)/X_9*100
    X_10[i] = (H[i] - X_9[i]) / (X_9[i] + 0.00001) * 100;

    // X_11 = X_10
    const X_11 = X_10[i];
    const X_12 = X_5[i];

    // X_13 = X_8 + X_10
    const X_13 = X_8[i] + X_10[i];

    // X_14 = X_8 + X_5
    const X_14 = X_8[i] + X_5[i];

    // X_15 = X_10 + X_5
    X_15[i] = X_10[i] + X_5[i];

    // X_16 = X_6
    X_16[i] = X_6[i];
    // X_17 = X_7
    X_17[i] = X_7[i];

    // X_18 = MAX(...)*1.2
  }

  // X_18 = MAX(MAX(...))*1.2
  const 机构活跃度: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    const maxVal = Math.max(
      X_15[i],
      X_16[i],
      X_8[i] + X_5[i],  // X_14
      X_8[i] + X_10[i], // X_13
      X_5[i],            // X_12
      X_10[i],           // X_11
      X_17[i]
    );
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