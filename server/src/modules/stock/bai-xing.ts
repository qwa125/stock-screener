/**
 * 白☆公式计算
 * 翻译自用户的同名同花顺指标代码
 * 包含DIFF/DEA/生命线/压力线及各种买卖点
 */
import { FormulaEngine } from './formula-engine';
import { FormulaResult, TrendState } from './types';

export function calcBaiXing(engine: FormulaEngine): Pick<FormulaResult,
  'diff' | 'dea' | 'lifeLine' | 'pressure' | 'baiXiao' | 'baiXiaoDays' | 'baiBu' | 'baiBuDays' | 'baiCoverTrend' |
  'diBuBuy' | 'gaoWeiHuiDiaoBuy' | 'zhuLiShiPan' | 'jiaCang' |
  'gaoKaiDiZouQingCang' | 'baoLiangFuGaiQingCang' | 'po5RiXian' | 'yinDiePoWei' |
  'baiXiaoPureDays' | 'baiXiaoBuy1' | 'baiXiaoBuy2' | 'qiangShiHuiCai' | 'qiangZhiFuGai' | 'xiPanHuoMian' | 'safe' | 'baiBuArray' | 'baiXiaoArray' |
  'hengPanTuPo' | 'qiWen' | 'tiaoJianChengLi' | 'kong'
> {
  const C = engine.CLOSE;
  const H = engine.HIGH;
  const L = engine.LOW;
  const V = engine.VOL;
  const O = engine.OPEN;

  // ===== 均线系统 =====
  const MA3 = engine.MA(C, 3);
  const MA5 = engine.MA(C, 5);
  const MA8 = engine.MA(C, 8);
  const MA13 = engine.MA(C, 13);
  const MA21 = engine.MA(C, 21);
  const MA34 = engine.MA(C, 34);

  const 均线: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    均线[i] = (MA3[i] + MA5[i] + MA8[i] + MA13[i] + MA21[i] + MA34[i] * 0.5) / 5.5;
  }

  const XMA3 = engine.XMA(C, 3);
  const XMA5 = engine.XMA(C, 5);
  const XMA8 = engine.XMA(C, 8);
  const XMA13 = engine.XMA(C, 13);
  const XMA21 = engine.XMA(C, 21);

  const 均线XMA: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    均线XMA[i] = (XMA3[i] + XMA5[i] + XMA8[i] + XMA13[i] + XMA21[i]) / 5;
  }

  // ===== 修正强度计算 =====
  const 修正强度: number[] = new Array(engine.length).fill(0);
  const MA5V = engine.MA(V, 5);
  const MA20C = engine.MA(C, 20);
  const refC1 = engine.REF(C, 1);

  for (let i = 0; i < engine.length; i++) {
    const 高开幅度 = Math.max(0, (O[i] / refC1[i] - 1.03) * 100);
    const 当日跌幅 = (O[i] - C[i]) / O[i] * 100;
    const 放量比 = V[i] / MA5V[i];
    const 振幅比 = (H[i] - L[i]) / MA20C[i] * 100;

    let 强度 = 0;
    if (高开幅度 > 0 && C[i] < O[i]) {
      强度 += 高开幅度 * 0.05 + 当日跌幅 * 0.1;
      if (放量比 > 1.2) 强度 += (放量比 - 1.2) * 0.25;
      if (振幅比 > 5) 强度 += (振幅比 - 5) * 0.02;
    }

    // 豁免：当日跌幅>=7且缩量
    const 豁免 = 当日跌幅 >= 7 && V[i] < MA5V[i] * 1.2;
    if (豁免) 强度 = 0;

    修正强度[i] = Math.min(强度, 0.5);
  }

  // 修正值
  const 修正值: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    修正值[i] = 修正强度[i] * (H[i] - L[i]);
  }

  // ===== DIFF / DEA / 生命线 =====
  // DIFF = 均线XMA * 2 - 均线 - 修正值
  const DIFF: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    DIFF[i] = 均线XMA[i] * 2 - 均线[i] - 修正值[i];
  }

  // DEA = 均线
  const DEA: number[] = [...均线];

  // 生命线 = EMA(XMA(C,6), 18)
  const H1 = engine.XMA(C, 6);
  const 生命线 = engine.EMA(H1, 18);

  // ===== 压力线 =====
  const DYN_arr: number[] = [];
  const refHHV20_1 = engine.REF(engine.HHV(C, 20), 1);
  const MA2 = engine.MA(refHHV20_1, 2);

  for (let i = 0; i < engine.length; i++) {
    DYN_arr[i] = MA2[i];
  }

  // 中期压力: 默认保持前值，仅当DYN创20日新高/新低时更新
  const 中期压力: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    if (i === 0) {
      中期压力[i] = DYN_arr[i];
    } else {
      // 默认保持前值
      中期压力[i] = 中期压力[i - 1];
      // 检查DYN是否创20日新高或新低
      const start = Math.max(0, i - 19);
      let isHHV = true, isLLV = true;
      for (let j = start; j <= i; j++) {
        if (DYN_arr[j] > DYN_arr[i]) isHHV = false;
        if (DYN_arr[j] < DYN_arr[i]) isLLV = false;
      }
      if (isHHV || isLLV) {
        中期压力[i] = DYN_arr[i];
      }
    }
  }

  // 短期压力 = EMA(HHV(H,10), 2)
  const 短期压力 = engine.EMA(engine.HHV(H, 10), 2);

  const 压力: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    压力[i] = Math.min(中期压力[i], 短期压力[i]);
  }

  // ===== 乖离率与涨幅衰减 =====
  const 乖离率: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    乖离率[i] = (C[i] - MA20C[i]) / MA20C[i] * 100;
  }

  const refC2 = engine.REF(C, 2);
  const 涨幅衰减: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    const todayChange = i > 0 ? (C[i] - refC1[i]) / refC1[i] * 100 : 0;
    const yesterdayChange = i > 1 ? (refC1[i] - refC2[i]) / refC2[i] * 100 : 0;
    涨幅衰减[i] = todayChange < yesterdayChange * 0.85;
  }

  // ===== 强制覆盖条件 =====
  const 强制覆盖: boolean[] = [];
  const refV1 = engine.REF(V, 1);

  for (let i = 0; i < engine.length; i++) {
    const cond1 = 乖离率[i] > 60 && V[i] > refV1[i] * 1.2 && 涨幅衰减[i];
    const cond2 = 乖离率[i] > 25 && (
      (H[i] > refC1[i] * 1.05 && C[i] < H[i] * 0.98) ||
      (O[i] > refC1[i] * 1.03 && C[i] < O[i]) ||
      ((H[i] - Math.max(C[i], O[i])) / H[i] * 100 > 4) ||
      (乖离率[i] > 25 && (C[i] - refC1[i]) / refC1[i] * 100 > 3 && V[i] < MA5V[i] * 0.9) ||
      (乖离率[i] > 25 && (C[i] - refC1[i]) / refC1[i] * 100 < 3 && (C[i] - refC1[i]) / refC1[i] * 100 > 0 && V[i] > MA5V[i] * 2) ||
      (乖离率[i] > 25 && V[i] > refV1[i] * 1.2 && 涨幅衰减[i] && (C[i] - refC1[i]) / refC1[i] * 100 > 0) ||
      (乖离率[i] > 25 && (C[i] - refC1[i]) / refC1[i] * 100 > 9 && V[i] > MA5V[i] * 2)
    ) && (DIFF[i] < DEA[i] || C[i] < MA5[i]);

    强制覆盖[i] = cond1 || cond2;
  }

  // ===== 洗盘豁免条件 =====
  const 洗盘短期趋势 = engine.EMA(C, 12);
  const ref洗盘短期趋势5 = engine.REF(洗盘短期趋势, 5);
  const 洗盘趋势强度: number[] = [];
  const 洗盘趋势状态: TrendState[] = [];

  for (let i = 0; i < engine.length; i++) {
    洗盘趋势强度[i] = (洗盘短期趋势[i] - ref洗盘短期趋势5[i]) / (ref洗盘短期趋势5[i] + 0.00001) * 100;
    if (洗盘趋势强度[i] > 7) 洗盘趋势状态[i] = TrendState.UP_STRONG;
    else if (洗盘趋势强度[i] > 4) 洗盘趋势状态[i] = TrendState.UP_MILD;
    else if (洗盘趋势强度[i] > 0) 洗盘趋势状态[i] = TrendState.SIDEWAYS;
    else 洗盘趋势状态[i] = TrendState.DOWN;
  }

  const VOL_MA60_洗盘 = engine.MA(V, 60);
  const MA10C = engine.MA(C, 10);

  const 洗盘豁免: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    const cond = i > 0 ?
      乖离率[i] < 25 &&
      (压力[i] <= DIFF[i]) &&
      洗盘趋势状态[i] >= TrendState.UP_MILD &&
      C[i] < O[i] &&
      V[i] > VOL_MA60_洗盘[i] * 1.5 &&
      (C[i] - L[i]) / (H[i] - L[i] + 0.00001) < 0.4 &&
      C[i] > MA10C[i] * 0.98
      : false;
    洗盘豁免[i] = cond;
  }

  // ===== 覆盖中 =====
  const 覆盖中: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    覆盖中[i] = (压力[i] > DIFF[i]) || 强制覆盖[i];
  }

  // ===== 白消/白布状态 =====
  const 白消状态: boolean[] = [];
  const 白消天数: number[] = [];
  const 白消纯天数: number[] = []; // 纯按 压力<=DIFF 统计，忽略强制覆盖
  for (let i = 0; i < engine.length; i++) {
    白消状态[i] = 压力[i] <= DIFF[i] && !强制覆盖[i];
    if (i === 0) {
      白消天数[i] = 白消状态[i] ? 1 : 0;
    } else {
      白消天数[i] = 白消状态[i] ? 白消天数[i - 1] + 1 : 0;
    }
    // 纯天数：只看 压力<=DIFF，不看强制覆盖
    const 纯状态 = 压力[i] <= DIFF[i];
    白消纯天数[i] = i === 0 ? (纯状态 ? 1 : 0) : (纯状态 ? 白消纯天数[i - 1] + 1 : 0);
  }

  // ===== 白布天数(连续覆盖中) =====
  const 白布天数: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    白布天数[i] = i === 0
      ? (覆盖中[i] ? 1 : 0)
      : (覆盖中[i] ? 白布天数[i - 1] + 1 : 0);
  }

  // ===== DIFF止跌 / 前日DIFF下降 / DIFF高于/低于生命线 =====
  const DIFF止跌: boolean[] = [];
  const 前日DIFF下降: boolean[] = [];
  const DIFF低于生命线: boolean[] = [];
  const DIFF高于生命线: boolean[] = [];

  for (let i = 0; i < engine.length; i++) {
    DIFF止跌[i] = i > 0 ? DIFF[i] >= DIFF[i - 1] : true;
    前日DIFF下降[i] = i > 1 ? DIFF[i - 1] < DIFF[i - 2] : false;
    DIFF低于生命线[i] = DIFF[i] < 生命线[i];
    DIFF高于生命线[i] = DIFF[i] > 生命线[i];
  }

  // ===== BS_指标王 / BS_立桩量 / BS_条件成立 =====
  const LLV8 = engine.LLV(L, 8);
  const HHV8 = engine.HHV(H, 8);

  // BS_指标王: CROSS(SMA(RSV,3,1), SMA(SMA(RSV,3,1),3,1)) AND SMA(RSV,3,1) < 20
  // RSV = (C-LLV(L,8))/(HHV(H,8)-LLV(L,8))*100
  const RSV: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    RSV[i] = (C[i] - LLV8[i]) / (HHV8[i] - LLV8[i] + 0.00001) * 100;
  }

  const SMA_RSV_3_1 = engine.SMA(RSV, 3, 1);
  const SMA_SMA_RSV = engine.SMA(SMA_RSV_3_1, 3, 1);
  const cross指标王 = engine.CROSS(SMA_RSV_3_1, SMA_SMA_RSV);

  const BS_指标王: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    BS_指标王[i] = cross指标王[i] && SMA_RSV_3_1[i] < 20;
  }

  // BS_TJ1 / BS_立桩量
  const BS_VAR1: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    let sum = 0;
    let count = 0;
    const weights = [8, 7, 6, 5, 4, 3, 2, 1];
    for (let j = 0; j < 8; j++) {
      const idx = i - j;
      if (idx >= 0) {
        sum += weights[j] * BS_AAA(C, H, L, O)[idx];
        count++;
      }
    }
    BS_VAR1[i] = count > 0 ? sum / (count * 36 / 8) : 0;
  }

  // 立桩量
  const HHV5 = engine.HHV(V, 5);
  const BS_TJ1: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    BS_TJ1[i] = V[i] === HHV5[i] && V[i] > 1.5 * refV1[i] && C[i] > BS_VAR1[i];
  }
  const BS_立桩量 = engine.FILTER(BS_TJ1, 5);

  // 条件成立
  const BS_条件成立: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    const bars = engine.BARSLAST(BS_立桩量)[i];
    const cond = (bars === 1 && C[i] > (i > 0 ? L[i - 1] : L[i])) ||
      (bars === 2 && C[i] > (i > 1 ? L[i - 2] : L[i])) ||
      (bars === 3 && C[i] > (i > 2 ? L[i - 3] : L[i]));
    const cond2 = (bars === 1 && C[i] > (i > 0 ? H[i - 1] : H[i])) ||
      (bars === 2 && C[i] > (i > 1 ? H[i - 2] : H[i])) ||
      (bars === 3 && C[i] > (i > 2 ? H[i - 3] : H[i]));
    BS_条件成立[i] = cond && cond2;
  }
  const BS_条件成立_filtered = engine.FILTER(BS_条件成立, 3);

  // ===== 底部买点 =====
  const 底部买点: boolean[] = [];
  const MA60 = engine.MA(C, 60);
  for (let i = 0; i < engine.length; i++) {
    底部买点[i] = 覆盖中[i] && DIFF低于生命线[i] &&
      (BS_指标王[i] || BS_条件成立_filtered[i]) &&
      C[i] > MA5[i] && V[i] > refV1[i] && C[i] > O[i] && DIFF止跌[i] &&
      (i >= 10 ? (MA60[i] >= MA60[i - 5] && MA60[i - 5] >= MA60[i - 10]) : true);
  }

  // ===== 高位回调买点 =====
  const 高位回调买点: boolean[] = [];
  const refC大于O1 = engine.REF(C.map((v, idx) => v > O[idx]), 1);
  const refDIFF止跌1 = engine.REF(DIFF止跌, 1);
  for (let i = 0; i < engine.length; i++) {
    高位回调买点[i] = !!(覆盖中[i] && DIFF高于生命线[i] && DIFF止跌[i] && 前日DIFF下降[i] &&
      C[i] > MA5[i] && V[i] >= MA5V[i] * 0.5 && C[i] > O[i] &&
      refC大于O1[i] && refDIFF止跌1[i] && V[i] > refV1[i]);
  }

  // ===== 主力试盘 =====
  const 主力试盘: boolean[] = [];
  const barsLastDIFF低于生命线 = engine.BARSLAST(DIFF.map((v, idx) => v <= 生命线[idx]));
  for (let i = 0; i < engine.length; i++) {
    const cond1 = DIFF[i] > 生命线[i] && C[i] > MA5[i] && C[i] > MA10C[i] &&
      V[i] > refV1[i] * 1.5 && C[i] > O[i] &&
      (C[i] - L[i]) / (H[i] - L[i] + 0.00001) > 0.8 &&
      barsLastDIFF低于生命线[i] >= 3 &&
      覆盖中[i] && DIFF止跌[i];
    const cond2 = DIFF[i] > 生命线[i] && C[i] > MA5[i] && C[i] > MA10C[i] &&
      V[i] > refV1[i] * 1.5 && C[i] > O[i] &&
      (C[i] - L[i]) / (H[i] - L[i] + 0.00001) > 0.8 &&
      (i > 0 ? 覆盖中[i - 1] : false) && !覆盖中[i];
    主力试盘[i] = cond1 || cond2;
  }

  // ===== 加仓信号 =====
  const crossMA3_MA9 = engine.CROSS(MA3, engine.MA(C, 9));
  const 加仓信号: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    const cond1 = crossMA3_MA9[i] && C[i] >= refC1[i] && C[i] > O[i] &&
      barsLastDIFF低于生命线[i] >= 3 && 覆盖中[i] && DIFF止跌[i] &&
      C[i] > MA5[i] && C[i] > MA10C[i];
    const cond2 = crossMA3_MA9[i] && C[i] >= refC1[i] && C[i] > O[i] &&
      白消状态[i] && 白消天数[i] >= 4;
    加仓信号[i] = cond1 || cond2;
  }

  // ===== 清仓信号 =====
  // 首次破位
  const 首次破位: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    首次破位[i] = (i > 0 ? 压力[i - 1] <= DIFF[i - 1] : false) && 覆盖中[i];
  }

  // 高开低走清仓
  const 高开低走清仓: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    高开低走清仓[i] = 首次破位[i] && O[i] > refC1[i] * 1.03 && C[i] < O[i] &&
      (C[i] - L[i]) / (H[i] - L[i] + 0.00001) < 0.4 && !洗盘豁免[i];
  }

  // 爆量覆盖清仓
  const 爆量覆盖清仓: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    爆量覆盖清仓[i] = 首次破位[i] && V[i] > MA5V[i] * 2 && !洗盘豁免[i];
  }

  // 持续白布
  const 持续白布 = (arr: boolean[]): boolean[] => arr;
  const 本次白布开始 = engine.BARSLAST(覆盖中.map(v => !v));

  // 破5日线条件
  const 破5日线条件: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    破5日线条件[i] = 覆盖中[i] && !洗盘豁免[i] &&
      ((C[i] < MA5[i] * 0.98 && C[i] < O[i]) || C[i] < MA10C[i]);
  }

  // 白布破5日线(首次)
  const 白布破5日线: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    白布破5日线[i] = 破5日线条件[i] && engine.COUNT(破5日线条件, 本次白布开始[i] + 1)[i] === 1;
  }

  // 阴跌破位
  const 阴跌破位: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    const countCond = engine.COUNT(
      覆盖中.map((v, idx) => v && C[idx] < MA5[idx] && C[idx] > MA5[idx] * 0.98 && C[idx] < (idx > 0 ? refC1[idx] : C[idx])),
      3
    )[i];
    阴跌破位[i] = countCond >= 3 && C[i] < MA10C[i] &&
      engine.COUNT(
        覆盖中.map((v, idx) => v && C[idx] < MA5[idx] && C[idx] > MA5[idx] * 0.98 && C[idx] < (idx > 0 ? refC1[idx] : C[idx])),
        3
      ).map((v, idx) => v >= 3 && C[idx] < MA10C[idx])[i];
    // 简化：改为使用filter
    if (阴跌破位[i]) {
      // 检查是否为首次
      const firstCond = engine.COUNT(
        覆盖中.map((v, idx) => v && C[idx] < MA5[idx] && C[idx] > MA5[idx] * 0.98 && C[idx] < (idx > 0 ? refC1[idx] : C[idx])),
        3
      );
      阴跌破位[i] = 阴跌破位[i] && engine.COUNT(
        firstCond.map((v, idx) => v >= 3 && C[idx] < MA10C[idx]),
        本次白布开始[i] + 1
      )[i] === 1;
    }
  }

  // ===== 白消买点1/2 =====
  const 白消涨幅: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    白消涨幅[i] = 白消天数[i] > 0 ?
      (C[i] - C[Math.max(0, i - 白消天数[i] + 1)]) / C[Math.max(0, i - 白消天数[i] + 1)] * 100 : 0;
  }

  const 白消买点1: boolean[] = [];
  const 白消买点2: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    白消买点1[i] = 白消状态[i] && 白消天数[i] >= 4 && 白消天数[i] <= 6 &&
      白消涨幅[i] < 15 && C[i] > O[i] && V[i] > refV1[i] && V[i] > MA5V[i];

    白消买点2[i] = 白消状态[i] && 白消天数[i] > 6 && 白消涨幅[i] < 8 &&
      (i > 白消天数[i] ? (engine.HHV(C, 白消天数[i])[i] - engine.LLV(C, 白消天数[i])[i]) < engine.LLV(C, 白消天数[i])[i] * 0.08 : false) &&
      (i > 0 ? engine.REF(V, 1)[i] < MA5V[i] * 0.8 : false) &&
      V[i] > MA5V[i] && C[i] > O[i] && DIFF[i] > 生命线[i];
  }

  // ===== 强势回踩买点 =====
  const 强势回踩买点: boolean[] = [];
  for (let i = 0; i < engine.length; i++) {
    const cond回踩1 = L[i] <= MA5[i] * 1.02 && C[i] > MA5[i] && V[i] < MA5V[i] * 0.8;
    const cond回踩2 = L[i] <= MA5[i] * 0.97 && C[i] > MA5[i] && (C[i] - L[i]) / (H[i] - L[i] + 0.00001) > 0.6;
    const cond回踩3 = L[i] <= MA10C[i] * 1.01 && C[i] > MA5[i] && DIFF[i] > 生命线[i];
    const count回踩 = engine.COUNT(
      覆盖中.map((v, idx) => (cond回踩1 || cond回踩2 || cond回踩3)),
      2
    )[i];

    强势回踩买点[i] = 白消状态[i] && 洗盘趋势状态[i] >= TrendState.UP_MILD &&
      count回踩 >= 1 && C[i] > MA5[i] && DIFF止跌[i];
  }

  // ===== 安全指标 =====
  const 暗盘 = engine.SUM(V.map((v, idx) => {
    const amt = engine.AMOUNT[idx];
    const hl6 = (H[idx] - L[idx]) * 6 - Math.abs(C[idx] - O[idx]);
    const VAR1 = hl6 !== 0 ? amt / hl6 : 0;
    if (C[idx] > O[idx]) {
      return VAR1 * (H[idx] - L[idx]);
    } else if (C[idx] < O[idx]) {
      return -VAR1 * (H[idx] - L[idx]);
    }
    return 0;
  }), engine.length); // 累计取最新值

  const ref暗盘1 = engine.REF(暗盘, 1);

  const 安全: number[] = [];
  for (let i = 0; i < engine.length; i++) {
    if (ref暗盘1[i] > 0) {
      安全[i] = 暗盘[i] >= 0 ? 1 : (暗盘[i] >= -ref暗盘1[i] * 0.3 ? 1 : 0);
    } else if (ref暗盘1[i] < 0) {
      安全[i] = 暗盘[i] >= 0 ? 1 : (暗盘[i] >= ref暗盘1[i] * 0.5 ? 1 : 0);
    } else {
      安全[i] = 1;
    }
  }

  const lastIdx = engine.length - 1;
  return {
    diff: DIFF[lastIdx],
    dea: DEA[lastIdx],
    lifeLine: 生命线[lastIdx],
    pressure: 压力[lastIdx],
    baiXiao: 白消状态[lastIdx],
    baiXiaoDays: 白消天数[lastIdx],
    baiXiaoPureDays: 白消纯天数[lastIdx],
    baiBu: 覆盖中[lastIdx],
    baiBuDays: 白布天数[lastIdx],
    // XMA平移补偿：检测最近3根K线的覆盖状态变化趋势
    // 覆盖趋势: [lastIdx-2 → lastIdx-1 → lastIdx] 的变化方向
    baiCoverTrend: (() => {
      const a = lastIdx - 2 >= 0 ? 覆盖中[lastIdx - 2] : 覆盖中[lastIdx];
      const b = 覆盖中[lastIdx - 1];
      const c = 覆盖中[lastIdx];
      // ↓(出白布): [true,false,false] 或 [true,true,false] → 白消恢复期
      if (a && !c) return 'exiting';
      // ↑(进白布): [false,true,true] 或 [false,false,true] → 白布出现期
      if (!a && c) return 'entering';
      // 稳定
      return 'stable';
    })(),
    diBuBuy: 底部买点[lastIdx],
    gaoWeiHuiDiaoBuy: 高位回调买点[lastIdx],
    zhuLiShiPan: 主力试盘[lastIdx],
    jiaCang: 加仓信号[lastIdx],
    gaoKaiDiZouQingCang: 高开低走清仓[lastIdx],
    baoLiangFuGaiQingCang: 爆量覆盖清仓[lastIdx],
    po5RiXian: 白布破5日线[lastIdx],
    yinDiePoWei: 阴跌破位[lastIdx],
    baiXiaoBuy1: 白消买点1[lastIdx],
    baiXiaoBuy2: 白消买点2[lastIdx],
    qiangShiHuiCai: 强势回踩买点[lastIdx],
    qiangZhiFuGai: 强制覆盖[lastIdx],
    xiPanHuoMian: 洗盘豁免[lastIdx],
    safe: 安全[lastIdx] === 1,
    hengPanTuPo: 白消买点2[lastIdx],
    qiWen: 高位回调买点[lastIdx],
    tiaoJianChengLi: BS_条件成立_filtered[lastIdx],
    kong: false,
    baiBuArray: 覆盖中,
    baiXiaoArray: 白消状态,
  };
}

/** 辅助函数: BS_AAA */
function BS_AAA(C: number[], H: number[], L: number[], O: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < C.length; i++) {
    result[i] = (3 * C[i] + H[i] + L[i] + O[i]) / 6;
  }
  return result;
}