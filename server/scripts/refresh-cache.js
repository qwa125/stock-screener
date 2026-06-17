/**
 * 刷新种子缓存：更新最新价格 + 时间戳
 * 运行: cd server && node scripts/refresh-cache.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ASSETS = path.join(__dirname, '..', 'assets');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 15000 }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(Error('超时')); });
  });
}

async function refreshPrices(stocks) {
  const now = Date.now();
  for (let i = 0; i < stocks.length; i += 100) {
    const batch = stocks.slice(i, i + 100);
    const codes = batch.map(s => (s.code.startsWith('6') ? 'sh' : 'sz') + s.code).join(',');
    try {
      const txt = await fetchUrl(`http://localhost:3000/api/gem/tencent-proxy?codes=${encodeURIComponent(codes)}`);
      for (const line of txt.split('\n').filter(l => l.length > 20)) {
        const p = line.split('~');
        if (p.length < 6) continue;
        const code = p[2], price = parseFloat(p[3]) || 0, prev = parseFloat(p[4]) || price;
        const chg = prev > 0 ? ((price - prev) / prev * 100) : 0;
        const s = stocks.find(x => x.code === code);
        if (s) { s.currentPrice = price; s.changePercent = parseFloat(chg.toFixed(2)); }
      }
    } catch(e) { /* 跳过 */ }
    if ((i + 100) % 300 === 0) process.stdout.write('.');
  }
  return now;
}

async function main() {
  const files = fs.readdirSync(ASSETS).filter(f => f.endsWith('.json') && f !== 'industry-sectors-cache.json');
  
  for (const file of files) {
    const fp = path.join(ASSETS, file);
    console.log(`\n📦 ${file}`);
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const items = raw.data || [];
      if (!items.length) { console.log('  ⚠️ 空'); continue; }
      
      console.log(`  更新 ${items.length} 只价格...`);
      const ts = await refreshPrices(items);
      
      raw.timestamp = ts;
      fs.writeFileSync(fp, JSON.stringify(raw, null, 2));
      console.log(`  ✅ 完成 (${new Date(ts).toLocaleString('zh-CN')})`);
    } catch(e) {
      console.log(`  ❌ ${e.message?.slice(0, 100) || e}`);
    }
  }
  
  // 行业板块
  try {
    const sfp = path.join(ASSETS, 'industry-sectors-cache.json');
    if (fs.existsSync(sfp)) {
      const s = JSON.parse(fs.readFileSync(sfp, 'utf8'));
      s.data.timestamp = Date.now();
      s.refreshedAt = Date.now();
      fs.writeFileSync(sfp, JSON.stringify(s, null, 2));
      console.log('\n📦 industry-sectors-cache.json ✅');
    }
  } catch(e) { console.log(`❌ industry-sectors ${e.message?.slice(0,80)}`); }
  
  console.log('\n=== ✅ 全部完成 ===');
}

main().catch(console.error);