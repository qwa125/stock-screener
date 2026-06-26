/**
 * 技术指标分析工具
 * 计算 MACD、KDJ、布林带、RSI、量比等指标，综合给出最佳介入价位
 */
export interface KLine {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

export interface TechnicalResult {
  /** 当前价格 */
  currentPrice: number;
  /** MACD 指标 */
  macd: { dif: number; dea: number; hist: number };
  /** KDJ 指标 */
  kdj: { k: number; d: number; j: number };
  /** 布林带 */
  bollinger: { upper: number; middle: number; lower: number; bandwidth: number };
  /** RSI(14) */
  rsi: number;
  /** RSI(6) */
  rsi6: number;
  /** 量比（今日量/5日均量） */
  volumeRatio: number;
  /** 综合介入评分 0-100 */
  entryScore: number;
  /** 评分等级 */
  entryLevel: '极佳' | '良好' | '一般' | '不建议';
  /** 最佳介入价 */
  bestEntryPrice: number;
  /** 支撑位 */
  supportLevel: number;
  /** 压力位 */
  resistanceLevel: number;
  /** 详细推理 */
  reasoning: string[];
}

/** EMA 计算 */
function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const k = 2 / (period + 1);
  ema[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

/** SMA 计算 */
function calcSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = data.slice(start, i + 1);
    sma.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return sma;
}

/** 标准差 */
function calcStdDev(data: number[], period: number): number[] {
  const std: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = data.slice(start, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sqDiff = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    std.push(Math.sqrt(sqDiff));
  }
  return std;
}

/** MACD 计算 */
function calcMACD(closes: number[]): { dif: number; dea: number; hist: number } {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const startIdx = ema12.length - ema26.length;
  const dif: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    dif.push(ema12[startIdx + i] - ema26[i]);
  }
  const dea = calcEMA(dif, 9);
  const offset = dif.length - dea.length;
  const lastDif = dif[dif.length - 1];
  const lastDea = dea[dea.length - 1];
  return { dif: lastDif, dea: lastDea, hist: 2 * (lastDif - lastDea) };
}

/** KDJ 计算 */
function calcKDJ(klines: KLine[], n = 9): { k: number; d: number; j: number } {
  let prevK = 50, prevD = 50;
  const len = klines.length;
  for (let i = 0; i < len; i++) {
    const start = Math.max(0, i - n + 1);
    let highest = -Infinity, lowest = Infinity;
    for (let j = start; j <= i; j++) {
      if (klines[j].high > highest) highest = klines[j].high;
      if (klines[j].low < lowest) lowest = klines[j].low;
    }
    const rsv = highest !== lowest
      ? ((klines[i].close - lowest) / (highest - lowest)) * 100
      : 50;
    const k = (2 / 3) * prevK + (1 / 3) * rsv;
    const d = (2 / 3) * prevD + (1 / 3) * k;
    const j = 3 * k - 2 * d;
    prevK = k;
    prevD = d;
  }
  return { k: prevK, d: prevD, j: 3 * prevK - 2 * prevD };
}

/** 布林带计算 */
function calcBollinger(closes: number[], period = 20, multiplier = 2): { upper: number; middle: number; lower: number; bandwidth: number } {
  const sma = calcSMA(closes, period);
  const std = calcStdDev(closes, period);
  const lastIdx = Math.min(sma.length - 1, std.length - 1);
  const middle = sma[lastIdx];
  const sd = std[lastIdx];
  const upper = middle + multiplier * sd;
  const lower = middle - multiplier * sd;
  const bandwidth = middle > 0 ? (upper - lower) / middle : 0;
  return { upper, middle, lower, bandwidth };
}

/** RSI 计算 */
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gain = 0, loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** 量比计算 */
function calcVolumeRatio(klines: KLine[]): number {
  const len = klines.length;
  if (len < 6) return 1;
  const latestVol = klines[len - 1].volume;
  const avgVol = klines.slice(-6, -1).reduce((a, b) => a + b.volume, 0) / 5;
  return avgVol > 0 ? latestVol / avgVol : 1;
}

/** 找支撑位（近期低点密集区） */
function findSupport(klines: KLine[], lookback = 20): number {
  const slice = klines.slice(-lookback);
  const lows = slice.map(k => k.low).sort((a, b) => a - b);
  // 取最低的几个低点的中位数
  const bottom = lows.slice(0, Math.max(3, Math.floor(lows.length * 0.2)));
  return bottom.reduce((a, b) => a + b, 0) / bottom.length;
}

/** 找压力位（近期高点密集区） */
function findResistance(klines: KLine[], lookback = 20): number {
  const slice = klines.slice(-lookback);
  const highs = slice.map(k => k.high).sort((a, b) => b - a);
  const top = highs.slice(0, Math.max(3, Math.floor(highs.length * 0.2)));
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/**
 * 综合技术指标分析，计算最佳介入价
 */
export function analyzeTechnical(klines: KLine[], currentPrice?: number): TechnicalResult {
  if (!klines || klines.length < 30) {
    return {
      currentPrice: currentPrice || 0,
      macd: { dif: 0, dea: 0, hist: 0 },
      kdj: { k: 50, d: 50, j: 50 },
      bollinger: { upper: 0, middle: 0, lower: 0, bandwidth: 0 },
      rsi: 50,
      rsi6: 50,
      volumeRatio: 1,
      entryScore: 50,
      entryLevel: '一般',
      bestEntryPrice: currentPrice || 0,
      supportLevel: 0,
      resistanceLevel: 0,
      reasoning: ['K线数据不足30条，无法进行全面技术分析'],
    };
  }

  const closes = klines.map(k => k.close);
  const price = currentPrice || closes[closes.length - 1];

  // 计算各项指标
  const macd = calcMACD(closes);
  const kdj = calcKDJ(klines);
  const bollinger = calcBollinger(closes);
  const rsi = calcRSI(closes, 14);
  const rsi6 = calcRSI(closes, 6);
  const volRatio = calcVolumeRatio(klines);
  const support = findSupport(klines);
  const resistance = findResistance(klines);

  // 综合评分（每项满分20，总共100）
  let score = 50; // 基准分50
  const reasoning: string[] = [];

  // --- MACD 评分 (满分20) ---
  if (macd.hist > 0) {
    if (macd.dif > 0) {
      score += 15;
      reasoning.push('✅ MACD 多头：DIF/DEA均在零轴上方，红柱放大，趋势强劲');
    } else if (macd.dif > macd.dea) {
      score += 10;
      reasoning.push('✅ MACD 转好：DIF上穿DEA，红柱出现，短期走强');
    } else {
      score += 5;
      reasoning.push('⚠️ MACD 零轴下方金叉，趋势待确认');
    }
  } else if (macd.hist > -0.5) {
    score += 3;
    reasoning.push('⚠️ MACD 绿柱收窄，DIF向DEA收敛，可能即将金叉');
  } else {
    score -= 10;
    reasoning.push('❌ MACD 空头：绿柱放大，DIF/DEA零轴下方走弱');
  }

  // --- KDJ 评分 (满分20) ---
  if (kdj.j < 20) {
    score += 18;
    reasoning.push(`✅ KDJ 超卖区(J=${kdj.j.toFixed(1)}<20)，超跌反弹概率大`);
  } else if (kdj.j < 30) {
    score += 12;
    reasoning.push(`✅ KDJ 偏低(J=${kdj.j.toFixed(1)})，接近超卖区`);
  } else if (kdj.j > 100) {
    score -= 10;
    reasoning.push(`❌ KDJ 严重超买(J=${kdj.j.toFixed(1)}>100)，回调风险大`);
  } else if (kdj.j > 80) {
    score -= 5;
    reasoning.push(`⚠️ KDJ 偏高(J=${kdj.j.toFixed(1)})，超买区注意回调`);
  } else {
    score += 5;
    reasoning.push(`📊 KDJ 中性(J=${kdj.j.toFixed(1)})，无极端信号`);
  }

  // --- 布林带评分 (满分20) ---
  const bbPos = bollinger.upper > bollinger.lower
    ? (price - bollinger.lower) / (bollinger.upper - bollinger.lower)
    : 0.5;
  if (price <= bollinger.lower) {
    score += 18;
    reasoning.push(`✅ 价格已跌破布林下轨(${bollinger.lower.toFixed(2)})，超卖反弹机会`);
  } else if (bbPos < 0.2) {
    score += 12;
    reasoning.push(`✅ 价格处于布林带下轨附近(${(bbPos * 100).toFixed(0)}%分位)，回踩支撑`);
  } else if (bbPos < 0.4) {
    score += 8;
    reasoning.push(`📊 价格在布林中轨下方(${(bbPos * 100).toFixed(0)}%分位)，偏低有安全边际`);
  } else if (bbPos > 0.8) {
    score -= 8;
    reasoning.push(`❌ 价格接近布林上轨(${(bbPos * 100).toFixed(0)}%分位)，追高风险大`);
  } else {
    score += 3;
    reasoning.push(`📊 价格在布林中轨附近(${(bbPos * 100).toFixed(0)}%分位)`);
  }

  // --- RSI 评分 (满分20) ---
  if (rsi < 30) {
    score += 18;
    reasoning.push(`✅ RSI(14)=${rsi.toFixed(1)}<30，严重超卖，反弹概率极高`);
  } else if (rsi < 40) {
    score += 12;
    reasoning.push(`✅ RSI(14)=${rsi.toFixed(1)}，接近超卖区，可逢低介入`);
  } else if (rsi > 70) {
    score -= 8;
    reasoning.push(`❌ RSI(14)=${rsi.toFixed(1)}>70，超买区，不宜追高`);
  } else {
    score += 5;
    reasoning.push(`📊 RSI(14)=${rsi.toFixed(1)}，中性区间`);
  }
  // 短周期RSI加分
  if (rsi6 < 20) {
    score += 5;
    reasoning.push(`✅ RSI(6)=${rsi6.toFixed(1)}，短线严重超卖`);
  } else if (rsi6 < 30) {
    score += 3;
  }

  // --- 成交量评分 (满分20) ---
  if (volRatio > 2 && macd.hist > 0) {
    score += 15;
    reasoning.push(`✅ 量比${volRatio.toFixed(2)}倍，放量上涨，资金进场信号`);
  } else if (volRatio > 1.5) {
    score += 8;
    reasoning.push(`📊 量比${volRatio.toFixed(2)}倍，成交量放大`);
  } else if (volRatio < 0.5) {
    score -= 5;
    reasoning.push(`⚠️ 量比${volRatio.toFixed(2)}倍，缩量明显，动能不足`);
  } else {
    score += 3;
  }

  // 找出最佳介入价
  let bestEntryPrice: number;
  if (bollinger.lower > 0 && price > bollinger.lower * 1.05) {
    // 价格高于下轨5%以上，以下轨为介入参考
    bestEntryPrice = bollinger.lower;
  } else if (support > 0 && price > support * 1.02) {
    // 有支撑位且当前价高于支撑
    bestEntryPrice = support;
  } else {
    // 以当前价下方2%为止损参考
    bestEntryPrice = price * 0.98;
  }

  // 确保最佳介入价不高于当前价的98%（即有安全边际）
  if (bestEntryPrice > price * 0.98) {
    bestEntryPrice = price * 0.98;
  }
  // 不低于当前价的92%（避免挂单差太大）
  if (bestEntryPrice < price * 0.92) {
    bestEntryPrice = price * 0.92;
  }

  // 确定等级
  let entryLevel: TechnicalResult['entryLevel'];
  if (score >= 75) entryLevel = '极佳';
  else if (score >= 55) entryLevel = '良好';
  else if (score >= 35) entryLevel = '一般';
  else entryLevel = '不建议';

  return {
    currentPrice: price,
    macd,
    kdj,
    bollinger,
    rsi: Math.round(rsi * 10) / 10,
    rsi6: Math.round(rsi6 * 10) / 10,
    volumeRatio: Math.round(volRatio * 100) / 100,
    entryScore: Math.min(Math.max(Math.round(score), 0), 100),
    entryLevel,
    bestEntryPrice: Math.round(bestEntryPrice * 100) / 100,
    supportLevel: Math.round(support * 100) / 100,
    resistanceLevel: Math.round(resistance * 100) / 100,
    reasoning,
  };
}