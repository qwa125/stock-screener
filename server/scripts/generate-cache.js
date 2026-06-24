/**
 * Build-time cache generator
 * Fetches A-stock K-line + names from Sina API and generates cache files
 * Run: node scripts/generate-cache.js
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// ─── 正确的A股代码列表 ───
function generateAllCodes() {
  const codes = [];
  // 深市主板 000001-000999
  for (let i = 1; i <= 999; i++) codes.push('sz' + String(i).padStart(6, '0'));
  // 中小板 002001-002999
  for (let i = 2001; i <= 2999; i++) codes.push('sz' + String(i).padStart(6, '0'));
  // 创业板 300001-300999
  for (let i = 300001; i <= 300999; i++) codes.push('sz' + String(i));
  // 科创板 688001-688999
  for (let i = 688001; i <= 688999; i++) codes.push('sh' + String(i));
  // 主板 600000-609999
  for (let i = 600000; i <= 609999; i++) codes.push('sh' + String(i));
  // 主板 601000-601999
  for (let i = 601000; i <= 601999; i++) codes.push('sh' + String(i));
  // 主板 603000-603999
  for (let i = 603000; i <= 603999; i++) codes.push('sh' + String(i));
  // 主板 605000-605999
  for (let i = 605000; i <= 605999; i++) codes.push('sh' + String(i));
  return codes;
}

const ALL_CODES = generateAllCodes();

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const parts = new URL(url);
    const req = client.request({
      hostname: parts.hostname, path: parts.pathname + parts.search,
      method: 'GET', timeout: 12000,
      headers: opts.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ─── 7因子评分（严格校准版） ───
function calcScore(kline) {
  const closes = kline.map(k => k.close);
  const len = closes.length;
  if (len < 20) return null;
  const latest = closes[len - 1];
  const prev = closes[len - 2];
  const chg = prev > 0 ? (latest - prev) / prev * 100 : 0;
  const ma5 = kline.map(k => k.ma5);
  const ma10 = kline.map(k => k.ma10);
  const ma5v = ma5[len - 1];
  const ma10v = ma10[len - 1];
  const isGoldenCross = ma5v > ma10v;
  const ma5Trend = ma5.length >= 4 ? ma5[len - 1] - ma5[len - 4] : 0;
  const ma10Trend = ma10.length >= 4 ? ma10[len - 1] - ma10[len - 4] : 0;

  // 价格位置
  const recent20 = closes.slice(-20);
  const max20 = Math.max(...recent20);
  const min20 = Math.min(...recent20);
  const range20 = max20 - min20;
  const pricePos = range20 > 0 ? (latest - min20) / range20 * 100 : 50;
  const recent60 = closes.slice(-60);
  const max60 = Math.max(...recent60);
  const min60 = Math.min(...recent60);
  const range60 = max60 - min60;
  const pricePos60 = range60 > 0 ? (latest - min60) / range60 * 100 : 50;
  const kValue = pricePos;
  const dValue = pricePos60;
  const jValue = 3 * kValue - 2 * dValue;

  // MACD
  function ema(arr, period, smooth) {
    const r = [arr[0]];
    for (let i = 1; i < arr.length; i++) r.push(arr[i] * smooth + r[i-1] * (1 - smooth));
    return r;
  }
  const ema12 = ema(closes, 12, 2/13);
  const ema26 = ema(closes, 26, 2/27);
  const diffs = ema12.map((v, i) => v - ema26[i]);
  const dea = ema(diffs, 9, 0.2);
  const macd = diffs[len - 1] - dea[len - 1];
  const macdPrev = diffs[len - 2] - dea[len - 2];
  const macdTrend = macd - macdPrev;

  // 布林带
  const sma20 = recent20.reduce((a, b) => a + b, 0) / 20;
  const variance = recent20.reduce((a, b) => a + (b - sma20) ** 2, 0) / 20;
  const std = Math.sqrt(variance);
  const bbUpper = sma20 + 2 * std;
  const bbLower = sma20 - 2 * std;
  const bbWidth = std > 0 ? (bbUpper - bbLower) / sma20 * 100 : 0;

  // 成交量
  const volumes = kline.map(k => k.vol);
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const latestVol = volumes[len - 1];
  const volRatio = avgVol > 0 ? latestVol / avgVol : 1;

  // ─── 评分系统 (总分100) ───
  let score = 45; // base

  // 1. 价格位置 (15分)
  if (pricePos < 20) score += 13;      // 深度超卖
  else if (pricePos < 33) score += 10; // 超卖
  else if (pricePos < 50) score += 6;  // 偏低
  else if (pricePos < 66) score += 3;  // 中性偏低
  else if (pricePos < 80) score -= 2;  // 偏高
  else score -= 8;                     // 高位

  // 2. KDJ (12分)
  if (kValue < 20 && jValue < 0) score += 10;
  else if (kValue < 30) score += 7;
  else if (kValue < 50) score += 4;
  else if (kValue > 80) score -= 6;
  else if (kValue > 70) score -= 2;

  // 3. MACD (18分)
  if (macd > 0 && macdTrend > 0) score += 15;
  else if (macd > 0) score += 8;
  else if (macd < 0 && macdTrend > 0) score += 5; // 底背离
  else if (macd < 0 && macdTrend < -0.5) score -= 8;
  else if (macd < 0) score -= 3;

  // 4. 布林带 (10分)
  if (latest <= bbLower * 1.01) score += 8;
  else if (latest <= bbLower * 1.03) score += 5;
  else if (latest >= bbUpper * 0.98) score -= 6;
  else if (latest >= bbUpper * 0.95) score -= 2;
  else if (bbWidth < 8) score += 3; // 缩口预示突破

  // 5. K线形态 (15分)
  let candle = 0;
  const c_last = kline[len - 1], c_prev = kline[len - 2];
  const body = Math.abs(c_last.close - c_last.open);
  const lowShadow = Math.min(c_last.close, c_last.open) - c_last.low;
  const upShadow = c_last.high - Math.max(c_last.close, c_last.open);
  if (body > 0 && lowShadow > body * 2 && upShadow < body * 0.4) candle += 5;
  if (c_last.close > c_last.open && c_prev.close < c_prev.open &&
      c_last.close > c_prev.open && c_last.open < c_prev.close) candle += 5;
  if (body < (c_last.high - c_last.low) * 0.12 && lowShadow > body * 2) candle += 4;
  if (len >= 3 && kline[len-1].close > kline[len-1].open &&
      kline[len-2].close > kline[len-2].open &&
      kline[len-3].close > kline[len-3].open) candle += 4;
  // 下跌形态
  if (body > 0 && upShadow > body * 2 && lowShadow < body * 0.4) candle -= 4;
  if (c_last.close < c_last.open && c_prev.close > c_prev.open &&
      c_last.close < c_prev.open) candle -= 4;
  score += Math.max(-8, Math.min(12, candle));

  // 6. 成交量 (12分)
  if (volRatio > 1.8 && chg > 3) score += 10;
  else if (volRatio > 1.3 && chg > 0) score += 6;
  else if (volRatio > 1.5 && chg < -2) score -= 7;
  else if (volRatio > 1.2 && chg < 0) score -= 3;
  else if (volRatio < 0.5) score -= 3;
  else if (volRatio < 0.7) score -= 1;

  // 7. 趋势状态 (18分)
  if (isGoldenCross && ma5Trend > 0 && ma10Trend > 0) score += 16;
  else if (isGoldenCross && ma5Trend > 0) score += 12;
  else if (isGoldenCross && ma5Trend < 0) score += 4;
  else if (!isGoldenCross && ma5Trend > 0) score += 2;  // 即将金叉
  else if (!isGoldenCross && ma10Trend > 0) score -= 3;
  else if (!isGoldenCross && ma5Trend < 0 && ma10Trend < 0) score -= 10;
  else score -= 5;

  // chg惩罚/奖励
  if (chg > 5) score += 5;
  else if (chg > 2) score += 2;
  else if (chg > 0) score += 1;
  else if (chg < -4) score -= 8;
  else if (chg < -2) score -= 4;
  else if (chg < 0) score -= 2;

  score = Math.round(Math.max(5, Math.min(98, score)));

  let suggestion;
  if (score >= 82) suggestion = '重仓买入';
  else if (score >= 72) suggestion = '买入';
  else if (score >= 62) suggestion = '轻仓买入';
  else if (score >= 50) suggestion = '持有';
  else if (score >= 38) suggestion = '减仓';
  else if (score >= 25) suggestion = '卖出';
  else suggestion = '不要介入';

  // 均线死叉强制降级
  if (!isGoldenCross && suggestion === '重仓买入') { suggestion = '买入'; score -= 5; }
  if (!isGoldenCross && suggestion === '买入' && chg < 2) { suggestion = '轻仓买入'; score -= 3; }

  let entryTiming = score + (pricePos < 30 ? 3 : pricePos > 70 ? -8 : 0) + (isGoldenCross ? 5 : -5);
  entryTiming = Math.round(Math.max(3, Math.min(95, entryTiming)));

  return {
    score,
    suggestion,
    entryTiming,
    chg: Math.round(chg * 100) / 100,
    isGoldenCross,
    pricePosition: Math.round(pricePos * 100) / 100,
    ma5: Math.round(ma5v * 100) / 100,
    ma10: Math.round(ma10v * 100) / 100,
  };
}

// ─── 获取K线 ───
async function fetchKLine(code) {
  const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + code + '&scale=240&ma=5,10,20,30,60,120&datalen=120';
  const buf = await fetchUrl(url);
  const raw = buf.toString('utf-8');
  const arr = JSON.parse(raw);
  return arr.map(k => ({
    open: parseFloat(k.open), high: parseFloat(k.high), low: parseFloat(k.low),
    close: parseFloat(k.close), vol: parseInt(k.volume) || 0,
    ma5: k.ma_price5 ? parseFloat(k.ma_price5) : parseFloat(k.close),
    ma10: k.ma_price10 ? parseFloat(k.ma_price10) : parseFloat(k.close),
  }));
}

// ─── 批量名称 ───
async function fetchNames(codes) {
  const result = {};
  const B = 50;
  for (let i = 0; i < codes.length; i += B) {
    const batch = codes.slice(i, i + B);
    try {
      const url = 'https://hq.sinajs.cn/list=' + batch.join(',');
      const buf = await fetchUrl(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });
      const text = iconv.decode(buf, 'gbk');
      for (const line of text.split(';')) {
        const t = line.trim();
        if (!t) continue;
        const quote = t.indexOf('"');
        if (quote === -1) continue;
        const csv = t.substring(quote + 1, t.lastIndexOf('"'));
        const fields = csv.split(',');
        if (fields.length < 6) continue;
        const m = t.match(/hq_str_(sh|sz)(\d{6})/);
        if (!m) continue;
        const code = m[1] + m[2];
        const name = fields[0] || '';
        if (!name) continue;
        result[code] = {
          name,
          currentPrice: parseFloat(fields[3]) || 0,
          yesClose: parseFloat(fields[2]) || 0,
        };
      }
    } catch (e) { /* skip */ }
    if (i % 1000 === 0) {
      console.log(`  Names: ${Math.min(i+B, codes.length)}/${codes.length}, found: ${Object.keys(result).length}`);
    }
  }
  return result;
}

// ─── 主流程 ───
async function main() {
  const totalCodes = ALL_CODES.length;
  console.log('Total codes to check: ' + totalCodes);

  console.log('\nStep 1: Fetch stock names...');
  const names = await fetchNames(ALL_CODES);
  const validCodes = Object.keys(names).filter(c => names[c].name);
  console.log('Valid stocks: ' + validCodes.length);

  console.log('\nStep 2: Fetch K-line and analyze...');
  const gemResults = [];
  const mainResults = [];
  let processed = 0;

  const B = 6;
  for (let i = 0; i < validCodes.length; i += B) {
    const batch = validCodes.slice(i, i + B);
    const batchResults = await Promise.allSettled(
      batch.map(async (code) => {
        const prefix = code.substring(0, 2);
        try {
          const kline = await fetchKLine(code);
          if (!kline || kline.length < 20) return null;
          const analysis = calcScore(kline);
          if (!analysis) return null;
          const info = names[code];
          return {
            code: code.substring(2),
            name: info.name,
            currentPrice: info.currentPrice,
            changePercent: analysis.chg,
            priceIncrease: Math.round((info.currentPrice - info.yesClose) * 100) / 100,
            mainForceInflow: 0,
            pricePosition: analysis.pricePosition,
            capitalRank: 0,
            baiXiaoDays: 0,
            score: analysis.score,
            suggestion: analysis.suggestion,
            entryTiming: analysis.entryTiming,
            safetyScore: 50,
            isGoldenCross: analysis.isGoldenCross,
            diff: 0,
            dea: 0,
            ma5: analysis.ma5,
            ma10: analysis.ma10,
            buySignal: analysis.isGoldenCross ? (analysis.score >= 72 ? '均线多头' : '') : '',
            price: info.currentPrice,
            _prefix: prefix,
          };
        } catch (e) {
          return null;
        }
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        const v = r.value;
        if (v._prefix === 'sz') { delete v._prefix; gemResults.push(v); }
        else { delete v._prefix; mainResults.push(v); }
      }
    }

    processed += B;
    if (processed % 400 === 0) {
      console.log(`  ${processed}/${validCodes.length} | Gem: ${gemResults.length} | Main: ${mainResults.length}`);
    }
  }

  // Sort by score desc
  gemResults.sort((a, b) => b.score - a.score);
  mainResults.sort((a, b) => b.score - a.score);

  console.log('\n✅ Results:');
  console.log('  SZ: ' + gemResults.length);
  console.log('  SH: ' + mainResults.length);

  const all = [...gemResults, ...mainResults];
  const buy = all.filter(s => ['重仓买入', '买入'].includes(s.suggestion));
  const lightBuy = all.filter(s => s.suggestion === '轻仓买入');

  console.log('\n📊 Distribution:');
  console.log('  重仓买入+买入: ' + buy.length);
  console.log('  轻仓买入: ' + lightBuy.length);
  console.log('  持有: ' + all.filter(s => s.suggestion === '持有').length);
  console.log('  减仓: ' + all.filter(s => s.suggestion === '减仓').length);
  console.log('  卖出+不要介入: ' + all.filter(s => ['卖出','不要介入'].includes(s.suggestion)).length);

  // Score distribution
  const dist = {};
  for (const s of all) {
    const k = s.suggestion;
    dist[k] = (dist[k] || 0) + 1;
  }
  console.log('\n📊 By suggestion:');
  for (const [k, v] of Object.entries(dist)) console.log('  ' + k + ': ' + v);

  console.log('\n⭐ Top buy signals:');
  buy.slice(0, 20).forEach(s => {
    console.log(`  ${s.code} ${s.name} 评分:${s.score} ${s.suggestion} chg:${s.changePercent}% 金叉:${s.isGoldenCross}`);
  });

  // Check specific stocks
  console.log('\n🔍 Key stocks:');
  for (const code of ['603283', '002378', '603124', '300750', '600519', '000001']) {
    const s = all.find(x => x.code === code);
    if (s) console.log(`  ${code} ${s.name} | ${s.suggestion} | 评分:${s.score} | chg:${s.changePercent}% | MA5:${s.ma5} MA10:${s.ma10} 金叉:${s.isGoldenCross}`);
    else console.log(`  ${code} NOT FOUND`);
  }

  // Save
  const now = Date.now();
  const gemCache = { data: gemResults, timestamp: now };
  const mainCache = { data: mainResults, timestamp: now };

  fs.writeFileSync('/tmp/gem-cache.json', JSON.stringify(gemCache));
  fs.writeFileSync('/tmp/main-board-cache.json', JSON.stringify(mainCache));

  const assetsDir = path.join(__dirname, '..', 'assets');
  fs.writeFileSync(path.join(assetsDir, 'gem-cache.json'), JSON.stringify(gemCache));
  fs.writeFileSync(path.join(assetsDir, 'main-board-cache.json'), JSON.stringify(mainCache));

  console.log('\n✅ Cache saved!');
  console.log('  gem-cache.json: ' + gemResults.length + ' stocks');
  console.log('  main-board-cache.json: ' + mainResults.length + ' stocks');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });