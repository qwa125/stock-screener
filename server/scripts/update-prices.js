// 直接用腾讯最新行情更新缓存中的价格
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function fetchTencent(codes) {
  return new Promise((resolve, reject) => {
    const url = `https://qt.gtimg.cn/q=${codes.join(',')}`;
    https.get(url, { timeout: 15000 }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = execSync('iconv -f GBK -t UTF-8', { input: buf }).toString();
        const lines = text.trim().split('\n');
        const stocks = {};
        for (const line of lines) {
          const parts = line.split('~');
          if (parts.length < 7) continue;
          const code = parts[2];
          const name = parts[1];
          const price = parseFloat(parts[3]) || 0;
          const yesterdayClose = parseFloat(parts[4]) || 0;
          const changePercent = yesterdayClose > 0 ? ((price - yesterdayClose) / yesterdayClose * 100) : 0;
          stocks[code] = { name, price: Math.round(price * 100) / 100, changePercent: Math.round(changePercent * 100) / 100 };
        }
        resolve(stocks);
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const files = ['gem-cache.json', 'main-board-cache.json', 'sector-cache.json', 'heavy-buy-cache.json'];
  
  // Collect all stock codes
  const allCodes = [];
  const fileData = {};
  for (const f of files) {
    const fp = path.join(assetsDir, f);
    if (!fs.existsSync(fp)) { console.log(`❌ ${f} not found`); continue; }
    const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    fileData[f] = d;
    const items = d.data || [];
    for (const s of items) {
      const prefix = s.code.startsWith('6') || s.code.startsWith('5') ? 'sh' : 'sz';
      allCodes.push(prefix + s.code);
    }
  }
  
  console.log(`📡 共 ${allCodes.length} 只股票待查`);
  
  // Fetch in batches
  const batchSize = 30;
  const allPrices = {};
  for (let i = 0; i < allCodes.length; i += batchSize) {
    const batch = allCodes.slice(i, i + batchSize);
    try {
      const prices = await fetchTencent(batch);
      Object.assign(allPrices, prices);
      process.stdout.write(`✅ ${i + batchSize}/${allCodes.length} 完成\n`);
    } catch (e) {
      console.error(`❌ 批次${i}失败:`, e.message);
    }
  }
  
  // Update cache files
  const ts = Date.now();
  for (const f of files) {
    if (!fileData[f]) continue;
    const d = fileData[f];
    const items = d.data || [];
    let updated = 0;
    for (const s of items) {
      const codeKey = s.code;
      const price = allPrices[codeKey];
      if (price) {
        s.currentPrice = price.price;
        s.changePercent = price.changePercent;
        // Also update old field names
        s.price = price.price;
        updated++;
      }
    }
    d.timestamp = ts;
    fs.writeFileSync(path.join(assetsDir, f), JSON.stringify(d, null, 2), 'utf-8');
    console.log(`✅ ${f}: ${items.length} 只, ${updated} 只价格已更新`);
  }
  
  // Industry sectors - update timestamp
  const sectorFile = path.join(assetsDir, 'industry-sectors-cache.json');
  if (fs.existsSync(sectorFile)) {
    const sd = JSON.parse(fs.readFileSync(sectorFile, 'utf-8'));
    sd.timestamp = ts;
    fs.writeFileSync(sectorFile, JSON.stringify(sd, null, 2), 'utf-8');
    console.log('✅ industry-sectors-cache.json: 时间戳已更新');
  }
  
  console.log(`\n🎉 全部完成! 时间戳: ${new Date(ts).toLocaleString('zh-CN')}`);
}

main().catch(e => console.error('FATAL:', e));