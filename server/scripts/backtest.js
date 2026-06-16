/**
 * 交易建议回测脚本
 * 
 * 从腾讯API采集多只股票的历史K线数据，
 * 模拟 applySuggestionRule 对每个历史日期的判断，
 * 测试不同参数组合下的建议效果（胜率、收益等），
 * 输出最优参数。
 */

const https = require('https');
const http = require('http');

// ============================================================
// 1. K线数据采集
// ============================================================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(`JSON parse error: ${data.substring(0,100)}`)); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

/** 从腾讯拉取某只股票的K线数据 */
async function fetchKLine(code, market = 'sz') {
  const url = `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${market}${code},day,,,300,qfq`;
  try {
    const data = await fetchJSON(url);
    const klines = data?.data?.[`${market}${code}`]?.qfqday;
    if (!klines || klines.length < 10) return null;
    return klines.map(k => ({
      date: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4], volume: +k[5]
    }));
  } catch(e) { return null; }
}

// ============================================================
// 2. 指标计算
// ============================================================

function calcMA(arr, period) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += arr[j];
    result.push(sum / period);
  }
  return result;
}

function calcMACD(closes) {
  const ema12 = [closes[0]];
  const ema26 = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema12.push(ema12[i-1] * 11/13 + closes[i] * 2/13);
    ema26.push(ema26[i-1] * 25/27 + closes[i] * 2/27);
  }
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = [dif[0]];
  for (let i = 1; i < dif.length; i++) dea.push(dea[i-1] * 8/10 + dif[i] * 2/10);
  const macd = dif.map((v, i) => 2 * (v - dea[i]));
  return { dif, dea, macd };
}

/** 计算斜率的简化方法: 线性回归 */
function calcSlope(values, period) {
  const result = new Array(values.length).fill(0);
  if (values.length < period) return result;
  for (let i = period - 1; i < values.length; i++) {
    const y = values.slice(i - period + 1, i + 1);
    const xSum = period * (period - 1) / 2;
    const ySum = y.reduce((a, b) => a + b, 0);
    let xySum = 0, x2Sum = 0;
    for (let j = 0; j < period; j++) {
      xySum += j * y[j];
      x2Sum += j * j;
    }
    const slope = (period * xySum - xSum * ySum) / (period * x2Sum - xSum * xSum);
    result[i] = slope;
  }
  return result;
}

/** RSI计算 */
function calcRSI(closes, period = 6) {
  const result = new Array(closes.length).fill(50);
  for (let i = period; i < closes.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j-1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ============================================================
// 3. 建议规则（完整版，支持参数化）
// ============================================================

/**
 * 对单个日期的数据进行建议判断
 * @param {Object} params 参数配置
 * @param {Object} data 该日期的技术指标数据
 * @returns {string|null} 建议或null(无信号)
 */
function applySuggestionRule(params, data) {
  const {
    // 价位区阈值
    P_LOW = 25,      // 低位区上限
    P_MID_LOW = 45,  // 中低位区上限
    P_MID = 55,      // 中位区上限
    P_MID_HIGH = 75, // 中高位区上限
    // 趋势要求
    T_重仓 = 1,       // 重仓买入最低trend
    T_买入 = 0,       // 买入最低trend
    T_轻仓 = 1,       // 轻仓买入最低trend
    T_买入_中低位 = 2, // 中低位区买入最低trend
    // 其他
    STRONG_BUY_MODE = 'standard', // strongBuy模式: standard|strict|loose
  } = params;

  // 解构数据
  const {
    pricePos,           // 价格位置 0-100
    trendState,         // 0=下跌,1=横盘,2=上升(ma5>ma10),3=强上升(ma5>ma10>ma20)
    hasGoldenCross,     // MACD金叉
    volumeBullish,      // 量能偏多
    macdBullish,        // MACD偏多
    hasBuySignal,       // 有白消买点信号
    baiXiaoDays,        // 白消天数
    hasQiangShiHuiCai,  // 强势回踩
    hasJiaCang,         // 加仓信号
    hasStrongSell,      // 强卖出信号
    hasNormalSell,      // 普通卖出信号
    longDecline,        // 长期下跌
    ma5SlopeUp,         // ma5向上
    ma10SlopeUp,        // ma10向上
    closeAboveMa10,     // 收盘价>ma10
    ma20SlopeUp,        // ma20向上
    hasVolume,          // 当日有成交量
    closeMa5,           // 收盘价 vs ma5
    closeMa20,          // 收盘价 vs ma20
  } = data;

  // 确定价位区
  let zone;
  if (pricePos < P_LOW) zone = '低位区';
  else if (pricePos < P_MID_LOW) zone = '中低位区';
  else if (pricePos < P_MID) zone = '中位区';
  else if (pricePos < P_MID_HIGH) zone = '中高位区';
  else zone = '高位区';

  // 强买入信号 (strongBuy)
  const goldenCrossVolume = hasGoldenCross && volumeBullish;
  const days3 = baiXiaoDays >= 3;
  const buyVolume = (hasBuySignal || hasQiangShiHuiCai) && volumeBullish;
  
  let strongBuy;
  if (STRONG_BUY_MODE === 'strict') {
    strongBuy = goldenCrossVolume || (days3 && hasBuySignal);
  } else if (STRONG_BUY_MODE === 'loose') {
    strongBuy = goldenCrossVolume || days3 || buyVolume || (hasBuySignal && hasJiaCang);
  } else { // standard
    strongBuy = goldenCrossVolume || days3 || buyVolume;
  }

  const normalBuy = hasBuySignal || hasQiangShiHuiCai;

  // ---- 根据价位区+趋势状态给出建议 ----
  let suggestion;

  if (zone === '低位区') {
    // 超跌/底部区域, 最佳机会
    if (trendState >= T_重仓 && strongBuy) suggestion = '重仓买入';
    else if (trendState >= T_重仓 && normalBuy) suggestion = '重仓买入'; // 低位+短线上拐+买点=重仓
    else if (trendState >= T_买入 && normalBuy) suggestion = '买入';
    else if (trendState === 0 && strongBuy) suggestion = '轻仓买入';
    else if (trendState === 0 && normalBuy) suggestion = '观望';
    else if (longDecline && trendState === 1 && !hasGoldenCross && !hasVolume) suggestion = '不要介入';
    else if (trendState >= 1) suggestion = '持有';
    else suggestion = '观望';

  } else if (zone === '中低位区') {
    // 底部企稳区域
    if (trendState >= T_买入_中低位 && strongBuy) suggestion = '买入';
    else if (trendState >= T_买入_中低位 && normalBuy) suggestion = '轻仓买入';
    else if (trendState >= 1 && strongBuy) suggestion = '买入';
    else if (trendState >= 1 && normalBuy) suggestion = '轻仓买入';
    else if (trendState >= T_轻仓 && normalBuy) suggestion = '轻仓买入';
    else if (trendState >= 1) suggestion = '持有';
    else suggestion = '持有';

  } else if (zone === '中位区') {
    // 中性区域
    if (trendState >= 2 && strongBuy) suggestion = '买入';
    else if (trendState >= 2 && normalBuy) suggestion = '轻仓买入';
    else if (trendState >= 2) suggestion = '持有';
    else if (trendState >= 1 && strongBuy) suggestion = '持有';
    else if (trendState >= 1 && normalBuy) suggestion = '持有';
    else if (trendState === 0 && hasStrongSell) suggestion = '减仓';
    else if (trendState === 0) suggestion = '持有';
    else suggestion = '持有';

  } else if (zone === '中高位区') {
    // 偏高风险
    if (trendState >= 2 && strongBuy) suggestion = '轻仓买入';
    else if (trendState >= 2 && normalBuy) suggestion = '持有';
    else if (trendState >= 2) suggestion = '持有';
    else if (trendState >= 1 && strongBuy) suggestion = '持有';
    else if (trendState >= 1) suggestion = '减仓';
    else if (trendState === 0 && hasStrongSell) suggestion = '清仓';
    else if (trendState === 0) suggestion = '卖出';
    else suggestion = '持有';

  } else { // 高位区
    if (trendState >= 3 && strongBuy) suggestion = '轻仓买入';
    else if (trendState >= 2 && strongBuy) suggestion = '轻仓买入';
    else if (trendState >= 2) suggestion = '持有';
    else if (trendState >= 1 && strongBuy) suggestion = '持有';
    else if (trendState >= 1) suggestion = '减仓';
    else if (hasStrongSell || hasNormalSell) suggestion = '清仓';
    else if (trendState === 0) suggestion = '卖出';
    else suggestion = '持有';
  }

  return suggestion;
}

// ============================================================
// 4. 对单只股票进行回测
// ============================================================

function backtestStock(klines, params) {
  if (!klines || klines.length < 100) return [];

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  // 计算指标
  const ma5 = calcMA(closes, 5);
  const ma10 = calcMA(closes, 10);
  const ma20 = calcMA(closes, 20);
  const { dif, dea, macd: macdHist } = calcMACD(closes);
  const rsi6 = calcRSI(closes, 6);
  const ma5Slope = calcSlope(closes, 5); // 用close代替ma5斜率
  const ma10Slope = calcSlope(closes, 10);
  const ma20Slope = calcSlope(closes, 10);

  // 计算均价vol (20天)
  const avgVol20 = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < 20) { avgVol20.push(null); continue; }
    let sum = 0;
    for (let j = i - 20; j < i; j++) sum += volumes[j];
    avgVol20.push(sum / 20);
  }

  // 近期均量 (5天)
  const avgVol5 = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < 5) { avgVol5.push(null); continue; }
    let sum = 0;
    for (let j = i - 5; j < i; j++) sum += volumes[j];
    avgVol5.push(sum / 5);
  }

  const signals = [];

  // 从第100天开始滑动窗口（确保有足够数据计算所有指标）
  for (let i = 100; i < klines.length; i++) {
    // --- 取60日数据计算pricePosition ---
    const startIdx = Math.max(0, i - 59);
    const windowHighs = highs.slice(startIdx, i + 1);
    const windowLows = lows.slice(startIdx, i + 1);
    const periodHigh = Math.max(...windowHighs);
    const periodLow = Math.min(...windowLows);
    const pricePos = periodHigh > periodLow
      ? ((closes[i] - periodLow) / (periodHigh - periodLow)) * 100
      : 50;

    // --- 趋势状态 ---
    let trendState;
    if (ma5[i] !== null && ma10[i] !== null && ma20[i] !== null) {
      if (ma5[i] > ma10[i] && ma10[i] > ma20[i]) trendState = 3; // 强上升
      else if (ma5[i] > ma10[i] && ma10[i] <= ma20[i]) trendState = 2; // 上升中
      else if (ma5[i] <= ma10[i] && ma10[i] > ma20[i]) trendState = 1; // 横盘
      else trendState = 0; // 下跌
    } else {
      trendState = 0;
    }

    // --- 简化trendState ---
    // 0=下跌(ma5<=ma10), 1=横盘(ma5>ma10但ma10<=ma20), 2=上升(ma5>ma10), 3=强上升(ma5>ma10>ma20)
    // 重新精确定义
    if (ma5[i] !== null && ma10[i] !== null && ma20[i] !== null) {
      if (ma5[i] > ma10[i] && ma10[i] > ma20[i]) trendState = 3;
      else if (ma5[i] > ma10[i] && ma10[i] <= ma20[i]) trendState = 2;
      else if (ma5[i] > ma10[i]) trendState = 2; // ma5上升但ma10不一定
      else if (ma5[i] <= ma10[i] && ma5[i] > ma20[i]) trendState = 1;
      else if (ma5[i] <= ma10[i] && ma10[i] > ma20[i]) trendState = 1;
      else trendState = 0;
    }

    // 简化: ma5 > ma10 = 2, ma5 <= ma10 = 0
    if (ma5[i] !== null && ma10[i] !== null) {
      trendState = ma5[i] > ma10[i] ? 2 : 0;
      // ma5 > ma10 > ma20 = 3
      if (ma5[i] > ma10[i] && ma10[i] > ma20[i]) trendState = 3;
    }

    // --- MACD ---
    const hasGoldenCross = i > 0 && dif[i] !== undefined && dea[i] !== undefined && dif[i-1] <= dea[i-1] && dif[i] > dea[i];
    const hasDeathCross = i > 0 && dif[i] !== undefined && dea[i] !== undefined && dif[i-1] >= dea[i-1] && dif[i] < dea[i];
    const macdBullish = dif[i] !== undefined && dea[i] !== undefined && dif[i] >= dea[i];
    const curMacdHist = macdHist[i] !== undefined ? macdHist[i] : 0;

    // --- 量能 ---
    const volBullish = volumes[i] > (avgVol20[i] || 0) * 1.2;
    const vol20 = avgVol20[i] || 0;

    // --- 斜率 ---
    const ma5Up = ma5Slope[i] > 0;
    const ma10Up = ma10Slope[i] > 0;
    const ma20Up = ma20Slope[i] > 0;
    const closeAboveMa10 = closes[i] > (ma10[i] || 99999);

    // --- 长期下跌判断 ---
    const longDecline = pricePos < 30 && trendState === 0;

    // --- 构建信号数据 ---
    const signalData = {
      pricePos: Math.round(pricePos * 10) / 10,
      trendState,
      hasGoldenCross,
      hasDeathCross,
      volumeBullish: volBullish,
      macdBullish,
      baiXiaoDays: 0, // 前端推送的数据，无法从K线推算，默认为0
      hasBuySignal: hasGoldenCross || (volBullish && curMacdHist > 0),
      hasQiangShiHuiCai: false,
      hasJiaCang: false,
      hasStrongSell: hasDeathCross,
      hasNormalSell: trendState === 0 && volBullish === false,
      longDecline,
      ma5SlopeUp: ma5Up,
      ma10SlopeUp: ma10Up,
      closeAboveMa10,
      ma20SlopeUp: ma20Up,
      hasVolume: volumes[i] > 0,
      closeMa5: closes[i] > (ma5[i] || 0),
      closeMa20: closes[i] > (ma20[i] || 0),
    };

    // --- 应用建议规则 ---
    const suggestion = applySuggestionRule(params, signalData);
    if (!suggestion) continue;

    // 只记录买入类信号
    const buySignals = ['重仓买入', '买入', '轻仓买入'];
    if (!buySignals.includes(suggestion)) continue;

    // --- 计算未来收益 (1日, 3日, 5日, 10日) ---
    const lookAhead = [1, 3, 5, 10];
    const returns = {};
    for (const days of lookAhead) {
      const targetIdx = i + days;
      if (targetIdx < klines.length) {
        returns[`r${days}d`] = (klines[targetIdx].close - closes[i]) / closes[i] * 100;
      } else {
        returns[`r${days}d`] = null;
      }
    }

    signals.push({
      date: klines[i].date,
      price: closes[i],
      suggestion,
      pricePos: signalData.pricePos,
      returns,
    });
  }

  return signals;
}

// ============================================================
// 5. 参数组合
// ============================================================

const PARAM_SETS = [
  // [名称, 参数]
  ['方案A(原版): 低位25+趋势2', {
    P_LOW: 25, P_MID_LOW: 45, P_MID: 55, P_MID_HIGH: 75,
    T_重仓: 2, T_买入: 0, T_轻仓: 0, T_买入_中低位: 2,
    STRONG_BUY_MODE: 'standard',
  }],
  ['方案B(用户建议): 低位25+趋势1', {
    P_LOW: 25, P_MID_LOW: 45, P_MID: 55, P_MID_HIGH: 75,
    T_重仓: 1, T_买入: 0, T_轻仓: 0, T_买入_中低位: 2,
    STRONG_BUY_MODE: 'standard',
  }],
  ['方案C: 低位35+趋势1', {
    P_LOW: 35, P_MID_LOW: 50, P_MID: 60, P_MID_HIGH: 75,
    T_重仓: 1, T_买入: 0, T_轻仓: 0, T_买入_中低位: 2,
    STRONG_BUY_MODE: 'standard',
  }],
  ['方案D: 低位25+趋势1+严格信号', {
    P_LOW: 25, P_MID_LOW: 45, P_MID: 55, P_MID_HIGH: 75,
    T_重仓: 1, T_买入: 0, T_轻仓: 0, T_买入_中低位: 2,
    STRONG_BUY_MODE: 'strict',
  }],
  ['方案E: 低位25+趋势1+宽松信号', {
    P_LOW: 25, P_MID_LOW: 45, P_MID: 55, P_MID_HIGH: 75,
    T_重仓: 1, T_买入: 0, T_轻仓: 0, T_买入_中低位: 2,
    STRONG_BUY_MODE: 'loose',
  }],
  ['方案F: 低位20+趋势1', {
    P_LOW: 20, P_MID_LOW: 40, P_MID: 55, P_MID_HIGH: 75,
    T_重仓: 1, T_买入: 0, T_轻仓: 0, T_买入_中低位: 2,
    STRONG_BUY_MODE: 'standard',
  }],
  ['方案G: 中低位区分层+趋势1', {
    P_LOW: 25, P_MID_LOW: 40, P_MID: 60, P_MID_HIGH: 75,
    T_重仓: 1, T_买入: 0, T_轻仓: 0, T_买入_中低位: 2,
    STRONG_BUY_MODE: 'standard',
  }],
];

// ============================================================
// 6. 统计函数
// ============================================================

function aggregateResults(allSignals) {
  if (allSignals.length === 0) return null;

  const groups = {};
  for (const s of allSignals) {
    if (!groups[s.suggestion]) groups[s.suggestion] = [];
    groups[s.suggestion].push(s);
  }

  const result = [];
  for (const [suggestion, signals] of Object.entries(groups)) {
    const stats = {};
    for (const days of [1, 3, 5, 10]) {
      const key = `r${days}d`;
      const vals = signals.map(s => s.returns[key]).filter(v => v !== null);
      if (vals.length === 0) continue;
      
      const winCount = vals.filter(v => v > 0).length;
      const winRate = winCount / vals.length * 100;
      const avgReturn = vals.reduce((a, b) => a + b, 0) / vals.length;
      const maxReturn = Math.max(...vals);
      const minReturn = Math.min(...vals);
      const std = Math.sqrt(vals.reduce((sum, v) => sum + (v - avgReturn) ** 2, 0) / vals.length);
      const sharpe = std > 0 ? avgReturn / std : 0;

      stats[`${days}日`] = {
        count: vals.length,
        winRate: winRate.toFixed(1) + '%',
        avgReturn: avgReturn.toFixed(2) + '%',
        maxReturn: maxReturn.toFixed(2) + '%',
        minReturn: minReturn.toFixed(2) + '%',
        sharpe: sharpe.toFixed(2),
      };
    }
    result.push({ suggestion, signalCount: signals.length, stats });
  }

  return result;
}

// ============================================================
// 7. 主流程
// ============================================================

const TEST_STOCKS = [
  { code: '300001', market: 'sz' },  // 特锐德
  { code: '300059', market: 'sz' },  // 东方财富
  { code: '300750', market: 'sz' },  // 宁德时代
  { code: '300124', market: 'sz' },  // 汇川技术
  { code: '300274', market: 'sz' },  // 阳光电源
  { code: '300308', market: 'sz' },  // 中际旭创
  { code: '600519', market: 'sh' },  // 贵州茅台
  { code: '600036', market: 'sh' },  // 招商银行
  { code: '601318', market: 'sh' },  // 中国平安
  { code: '600900', market: 'sh' },  // 长江电力
  { code: '688981', market: 'sh' },  // 中芯国际
  { code: '000001', market: 'sz' },  // 平安银行
  { code: '000333', market: 'sz' },  // 美的集团
  { code: '002415', market: 'sz' },  // 海康威视
  { code: '002475', market: 'sz' },  // 立讯精密
  { code: '601012', market: 'sh' },  // 隆基绿能
  { code: '600887', market: 'sh' },  // 伊利股份
  { code: '000858', market: 'sz' },  // 五粮液
  { code: '002594', market: 'sz' },  // 比亚迪
  { code: '600030', market: 'sh' },  // 中信证券
];

async function main() {
  console.log('========================================');
  console.log('  交易建议回测系统 v1.0');
  console.log('========================================\n');

  // Step 1: 采集K线数据
  console.log('📡 采集K线数据中...');
  const allKlines = {};
  let fetched = 0;
  for (const s of TEST_STOCKS) {
    const klines = await fetchKLine(s.code, s.market);
    if (klines && klines.length > 80) {
      allKlines[`${s.market}${s.code}`] = klines;
      fetched++;
      process.stdout.write(`  ✓ ${s.market}${s.code} (${klines.length}根K线)\n`);
    } else {
      process.stdout.write(`  ✗ ${s.market}${s.code} (数据不足)\n`);
    }
    // 限流，避免被腾讯封
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n✅ 成功采集 ${fetched}/${TEST_STOCKS.length} 只股票\n`);

  if (fetched === 0) {
    console.log('❌ 没有采集到任何K线数据，无法回测');
    return;
  }

  // Step 2: 对每套参数运行回测
  console.log('🔬 开始回测...\n');

  const allResults = [];

  for (const [name, params] of PARAM_SETS) {
    console.log(`━━━ ${name} ━━━`);

    let totalSignals = 0;
    const stockStats = {};

    for (const [stockId, klines] of Object.entries(allKlines)) {
      const signals = backtestStock(klines, params);
      
      if (signals.length === 0) continue;

      totalSignals += signals.length;

      // 按类型统计
      for (const s of signals) {
        const rets = [];
        for (const d of [1, 3, 5, 10]) {
          rets.push(s.returns[`r${d}d`] !== null ? s.returns[`r${d}d`] : 0);
        }
        if (!stockStats[s.suggestion]) stockStats[s.suggestion] = { count: 0, returns: [] };
        stockStats[s.suggestion].count++;
        stockStats[s.suggestion].returns.push(...rets);
      }
    }

    console.log(`  总信号: ${totalSignals} 次`);
    
    if (Object.keys(stockStats).length > 0) {
      for (const [sug, st] of Object.entries(stockStats)) {
        const avgRets = {};
        for (const d of [1, 3, 5, 10]) {
          const vals = st.returns.filter((v, i) => i % 4 === [1, 3, 5, 10].indexOf(d));
          // 简化: 按每4个一组计算各日期的收益
        }
        console.log(`  ${sug}: ${st.count}次`);
      }
    }

    // 全量信号统计分析
    const allSignals = [];
    for (const [stockId, klines] of Object.entries(allKlines)) {
      const signals = backtestStock(klines, params);
      allSignals.push(...signals);
    }

    const stats = aggregateResults(allSignals);
    
    if (stats) {
      for (const row of stats) {
        console.log(`  [${row.suggestion}] ${row.signalCount}次信号`);
        for (const [period, s] of Object.entries(row.stats)) {
          console.log(`    ${period}: 胜率=${s.winRate} 均收益=${s.avgReturn} 最大=${s.maxReturn} 最小=${s.minReturn} 夏普=${s.sharpe}`);
        }
      }
    }
    console.log();

    // 保存综合评分
    if (stats) {
      let score = 0;
      let totalWeight = 0;
      for (const row of stats) {
        if (row.suggestion === '重仓买入') {
          for (const [period, s] of Object.entries(row.stats)) {
            score += parseFloat(s.winRate) * 3; // 重仓权重3倍
            totalWeight += 3;
          }
        } else if (row.suggestion === '买入') {
          for (const [period, s] of Object.entries(row.stats)) {
            score += parseFloat(s.winRate) * 2;
            totalWeight += 2;
          }
        } else if (row.suggestion === '轻仓买入') {
          for (const [period, s] of Object.entries(row.stats)) {
            score += parseFloat(s.winRate) * 1;
            totalWeight += 1;
          }
        }
      }
      const avgScore = totalWeight > 0 ? (score / totalWeight).toFixed(1) : 'N/A';
      allResults.push({ name, totalSignals, score: avgScore, stats });
    }
  }

  // Step 3: 输出结果对比
  console.log('\n========================================');
  console.log('  🏆 参数方案综合排名');
  console.log('========================================\n');
  
  allResults.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

  for (const [i, r] of allResults.entries()) {
    console.log(`#${i + 1}. ${r.name}`);
    console.log(`   信号数: ${r.totalSignals} | 综合评分: ${r.score}`);
    console.log();
  }

  console.log('========================================');
  console.log('  📊 最优方案详细统计');
  console.log('========================================\n');

  if (allResults.length > 0) {
    const best = allResults[0];
    console.log(`最优方案: ${best.name}`);
    for (const row of best.stats) {
      console.log(`\n[${row.suggestion}] ${row.signalCount}次`);
      for (const [period, s] of Object.entries(row.stats)) {
        console.log(`  ${period}: 胜率=${s.winRate} 均收益=${s.avgReturn} 夏普率=${s.sharpe}`);
      }
    }
  }
}

main().catch(e => console.error('回测异常:', e));