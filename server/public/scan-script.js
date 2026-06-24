/**
 * 🚀 全量缓存扫描脚本
 * 
 * 使用方式：打开 https://stock-screener-54nd.onrender.com
 * 按 F12 → Console → 粘贴本脚本 → 回车
 * 
 * 脚本会：
 * 1. 从缓存获取所有股票代码
 * 2. 从前端（国内网络）拉取实时K线
 * 3. 推送到后端分析
 * 4. 分析结果自动更新缓存 → 机会列表立刻同步
 */

(async function fullScan() {
  console.log('%c🚀 全量缓存扫描开始...', 'font-size:18px;font-weight:bold;color:#1890ff');
  
  // Step 1: 获取所有缓存股票
  console.log('📦 获取缓存股票列表...');
  const cacheRes = await fetch('/api/gem/cache-all');
  const cacheData = await cacheRes.json();
  const stocks = cacheData.data?.stocks || [];
  console.log(`✅ 共 ${stocks.length} 只缓存股票`);
  
  if (stocks.length === 0) {
    console.error('❌ 未获取到缓存股票');
    return;
  }

  // Step 2: 扫描参数
  const CONCURRENCY = 6;      // 并行数
  const TIMEOUT_MS = 12000;   // K线超时
  const PROGRESS_INTERVAL = 50;
  
  let scanned = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let results = { 重仓买入: 0, 买入: 0, 轻仓买入: 0, 持有: 0, 减仓: 0, 观望: 0, 卖出: 0, 不要介入: 0 };

  // Step 3: 单只股票处理
  async function processStock(stock, index) {
    const code = stock.code;
    const name = stock.name || code;
    
    // 判断市场前缀
    let prefix = '';
    if (code.startsWith('6') || code.startsWith('9')) prefix = 'sh';
    else if (code.startsWith('0') || code.startsWith('3')) prefix = 'sz';
    else if (code.startsWith('4') || code.startsWith('8')) prefix = 'bj';
    else prefix = code.length === 6 ? (code.startsWith('6') ? 'sh' : 'sz') : '';
    
    // 东方财富 secid
    const emSecId = code.startsWith('6') ? `1.${code}` : `0.${code}`;
    
    // 尝试获取K线: 东方财富 → 腾讯 → 新浪
    let kline = null;
    let klineSource = '';
    
    // 1) 东方财富
    try {
      const ekUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get2?secid=${emSecId}&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=120`;
      const ekRes = await Promise.race([
        fetch(ekUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
      ]);
      const ekData = await ekRes.json();
      if (ekData?.data?.klines?.length > 20) {
        kline = ekData.data.klines.map(line => {
          const parts = line.split(',');
          return { day: parts[0], open: parseFloat(parts[1]), close: parseFloat(parts[2]), high: parseFloat(parts[3]), low: parseFloat(parts[4]), volume: parseFloat(parts[5]), amount: parseFloat(parts[6] || 0) };
        });
        klineSource = '东方财富';
      }
    } catch(e) { /* 继续 */ }
    
    // 2) 腾讯 (备选)
    if (!kline) {
      try {
        const tqUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${code},day,,,120,qfq`;
        const tqRes = await Promise.race([
          fetch(tqUrl),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
        ]);
        const tqData = await tqRes.json();
        const tqKline = tqData?.data?.[prefix + code]?.day || tqData?.data?.[prefix + code]?.qfqday || [];
        if (tqKline.length > 20) {
          kline = tqKline.map(item => ({
            day: item[0], open: parseFloat(item[1]), close: parseFloat(item[2]),
            high: parseFloat(item[3]), low: parseFloat(item[4]), volume: parseFloat(item[5])
          }));
          klineSource = '腾讯';
        }
      } catch(e) { /* 继续 */ }
    }
    
    // 3) 新浪 (最后备选)
    if (!kline) {
      try {
        const sinaUrl = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${prefix}${code}&scale=240&ma=no&datalen=120`;
        const sinaRes = await Promise.race([
          fetch(sinaUrl),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
        ]);
        const sinaData = await sinaRes.json();
        if (Array.isArray(sinaData) && sinaData.length > 20) {
          kline = sinaData.map(item => ({
            day: item.day, open: parseFloat(item.open), close: parseFloat(item.close),
            high: parseFloat(item.high), low: parseFloat(item.low), volume: parseFloat(item.volume)
          }));
          klineSource = '新浪';
        }
      } catch(e) { /* 继续 */ }
    }
    
    if (!kline) {
      skipped++;
      if (index % PROGRESS_INTERVAL === 0) printProgress();
      return null;
    }
    
    // 发送分析
    try {
      const ar = await fetch('/api/gem/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, kline })
      });
      const ad = await ar.json();
      const opp = Array.isArray(ad.data) ? ad.data[0] : ad.data;
      if (opp && opp.suggestion) {
        results[opp.suggestion] = (results[opp.suggestion] || 0) + 1;
        success++;
        if (index % PROGRESS_INTERVAL === 0) printProgress();
        return opp;
      }
      failed++;
    } catch(e) {
      failed++;
    }
    if (index % PROGRESS_INTERVAL === 0) printProgress();
    return null;
  }

  function printProgress() {
    const pct = Math.round(scanned / stocks.length * 100);
    const bar = '█'.repeat(Math.floor(pct/5)) + '░'.repeat(20 - Math.floor(pct/5));
    console.log(`\n[${bar}] ${pct}% | 已扫: ${scanned}/${stocks.length} | ✅${success} ❌${failed} ⏭${skipped}`);
    console.log('  信号分布:', Object.entries(results).filter(([_,v]) => v > 0).map(([k,v]) => `${k}=${v}`).join('  '));
  }

  // Step 4: 分批并行处理
  const total = stocks.length;
  console.log(`\n📡 开始扫描 ${total} 只，并行 ${CONCURRENCY}...\n`);
  
  const startTime = Date.now();
  
  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((s, idx) => processStock(s, i + idx)));
    scanned += batch.length;
  }

  // Step 5: 结果汇总
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('\n' + '='.repeat(50));
  console.log(`%c✅ 全量扫描完成！`, 'font-size:18px;font-weight:bold;color:#52c41a');
  console.log(`   耗时: ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
  console.log(`   成功: ${success}  失败: ${failed}  跳过: ${skipped}`);
  console.log(`\n📊 信号分布:`);
  for (const [signal, count] of Object.entries(results)) {
    if (count > 0) console.log(`   ${signal}: ${count}`);
  }
  
  // 显示不要介入
  const noEntry = Object.entries(results).filter(([k]) => ['不要介入', '卖出'].includes(k));
  if (noEntry.length > 0) {
    console.log(`\n%c⚠️ 需要关注的信号:`, 'font-size:16px;font-weight:bold;color:#f5222d');
    for (const [k, v] of noEntry) {
      console.log(`   ${k}: ${v}`);
    }
  }
  
  console.log(`\n💡 提示: 刷新页面即可看到更新后的机会列表！`);
  return results;
})();