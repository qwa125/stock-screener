import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import * as express from 'express';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { HttpStatusInterceptor } from '@/interceptors/http-status.interceptor';
import { GemScreenerService } from '@/modules/gem-screener/gem-screener.service';

// ═════════════════════════════════════════════════
// 全市场Sina数据缓存（后台定时刷新）
// 避免每次请求都去抓取Sina（Render US→中国网络慢）
// ═════════════════════════════════════════════════
let sinaCache: any[] = [];
let sinaCacheReady = false;

async function refreshSinaCache() {
  const MAX_PAGES = 15;  // hs_a
  const CYB_PAGES = 6;   // cyb
  const FETCH_TIMEOUT = 15000; // 15s per page
  const MAX_RETRIES = 2;       // 每页最多重试2次
  const RETRY_DELAY = 2000;    // 重试间隔2s

  const allPages: { node: string; page: number }[] = [];
  for (let p = 1; p <= MAX_PAGES; p++) allPages.push({ node: 'hs_a', page: p });
  for (let p = 1; p <= CYB_PAGES; p++) allPages.push({ node: 'cyb', page: p });

  const results = await Promise.all(allPages.map(async ({ node, page }) => {
    const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=100&sort=changepercent&asc=0&node=${node}`;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        const text = await resp.text();
        const data = JSON.parse(text);
        if (Array.isArray(data) && data.length > 0) return data;
        return [];
      } catch {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
      }
    }
    return []; // 重试耗尽也返回空
  }));

  const seenCodes = new Set<string>();
  const allData: any[] = [];
  for (const arr of results) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const code = String(item.code || '');
      if (!code || seenCodes.has(code)) continue;
      seenCodes.add(code);
      allData.push(item);
    }
  }
  sinaCache = allData;
  sinaCacheReady = true;
}

// 启动后台缓存刷新
// 首次延迟500ms启动（等app启动完成），之后每5分钟刷新
setTimeout(() => {
  refreshSinaCache();
  setInterval(refreshSinaCache, 300000); // 5分钟
}, 500);

function parsePort(): number {
  // 自定义 SERVER_PORT 环境变量优先（本地开发使用 3000）
  if (process.env.SERVER_PORT) {
    const port = parseInt(process.env.SERVER_PORT, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  // Render 云平台 PORT 环境变量
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  // 命令行参数 -p
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('-p');
  if (portIndex !== -1 && args[portIndex + 1]) {
    const port = parseInt(args[portIndex + 1], 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  return 3000;
}

// 全局未捕获异常处理，防止进程意外退出
process.on('uncaughtException', (err) => {
  console.error(`[FATAL] uncaughtException: ${err.message}`, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[FATAL] unhandledRejection:`, reason);
});

// ═══════════════════════════════════════════════════════
// 新浪全市场数据后台缓存（3分钟刷新一次）
// ═══════════════════════════════════════════════════════
let sinaMarketCache: any[] = [];
let sinaMarketLoading = false;
let sinaMarketLastFetch = 0;
const SINA_CACHE_TTL = 3 * 60 * 1000; // 3分钟

async function fetchSinaPage(node: string, page: number): Promise<any[]> {
  const url =
    `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=100&sort=changepercent&asc=0&node=${node}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const text = await resp.text();
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return []; // 超时或网络错误返回空
  }
}

async function refreshSinaMarketCache(): Promise<void> {
  if (sinaMarketLoading) return;
  sinaMarketLoading = true;
  const start = Date.now();
  try {
    const allPages: { node: string; page: number }[] = [];
    for (let p = 1; p <= 15; p++) allPages.push({ node: 'hs_a', page: p });
    for (let p = 1; p <= 6; p++) allPages.push({ node: 'cyb', page: p });

    const results = await Promise.all(
      allPages.map(({ node, page }) => fetchSinaPage(node, page)),
    );

    const seenCodes = new Set<string>();
    const merged: any[] = [];
    for (const arr of results) {
      for (const item of arr) {
        const code = String(item.code || '');
        if (!code || seenCodes.has(code)) continue;
        seenCodes.add(code);
        merged.push(item);
      }
    }
    if (merged.length > 0) {
      // 只在新数据非空时才更新缓存，避免网络全挂时清空缓存
      merged.sort((a, b) => (b.changepercent || 0) - (a.changepercent || 0));
      sinaMarketCache = merged;
      sinaMarketLastFetch = Date.now();
      console.log(`[SinaCache] ${merged.length} stocks (${Date.now() - start}ms)`);
    } else {
      console.warn(`[SinaCache] empty result, cache preserved (${sinaMarketCache.length} stocks)`);
    }
  } catch (e) {
    console.error(`[SinaCache] refresh error: ${e.message}`);
  } finally {
    sinaMarketLoading = false;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });
  // ══════════════════════════════════════════════
  // 新浪股票列表代理中间件 (绕过 NestJS 全局守卫)
  // 浏览器无法直接调用 Sina API (无 CORS), 通过后端中转
  // ══════════════════════════════════════════════
  app.use('/api/stock/sina-list', (req, res) => {
    const page = (req.query.page as string) || '1';
    const num = (req.query.num as string) || '100';
    const node = (req.query.node as string) || 'sh_a';
    const sinaUrl =
      `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${num}&sort=symbol&asc=1&node=${node}`;
    https.get(sinaUrl, { timeout: 15000 }, (sinaRes) => {
      let body = '';
      sinaRes.on('data', (chunk) => (body += chunk));
      sinaRes.on('end', () => {
        try {
          const data = JSON.parse(body);
          res.json({ code: 200, data, msg: 'ok' });
        } catch {
          res.status(502).json({ code: 502, data: null, msg: '解析新浪API返回数据失败' });
        }
      });
    }).on('error', (err) => {
      res.status(502).json({ code: 502, data: null, msg: '请求新浪API失败: ' + err.message });
    });
  });
  // ══════════════════════════════════════════════
  // 全市场Sina扫描聚合端点 (绕过全局守卫)
  // 后端内部并行抓取21页数据，前端只需1次请求
  // ══════════════════════════════════════════════
  app.use('/api/gem/full-sina-scan', async (req, res) => {
    if (!sinaCacheReady || sinaCache.length === 0) {
      // 缓存未就绪，尝试等待一轮刷新（最多10秒）
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (sinaCacheReady && sinaCache.length > 0) break;
      }
    }
    if (sinaCache.length > 0) {
      res.json({ code: 200, msg: 'success', data: sinaCache });
    } else {
      res.json({ code: 200, msg: '缓存尚在加载', data: [] });
    }
  });
  // ══════════════════════════════════════════════
  // 缓存重分析端点 (绕过全局守卫)
  // 用 Express 中间件直接处理，避免被 NestJS AccessLimitGuard 拦截
  // ══════════════════════════════════════════════
    const gemSvc = app.get(GemScreenerService);
  app.use('/api/gem/rescan', async (req, res, next) => {
    // Express 中间件挂载路径是前缀匹配，/api/gem/rescan 会匹配 /api/gem/rescan-batch
    // 用 req.originalUrl 做精确检查，确保只处理精确路径
    if (req.originalUrl !== '/api/gem/rescan') return next();
    try {
      // 如果缓存数据太少（<30只），异步触发全量重新扫描
      const curCache = gemSvc['cache']?.data || [];
      const curMainCache = gemSvc['mainBoardCache']?.data || [];
      if (curCache.length < 30 || curMainCache.length < 30) {
        gemSvc['scanTopGem'](true).catch(() => {});
        gemSvc['scanTopMainBoard'](true).catch(() => {});
        console.log('rescan: cache too small, async refresh triggered');
      }
      const results = await gemSvc.rescanMarket();
      res.json({ code: 200, msg: 'ok', data: results });
    } catch (e) {
      res.status(500).json({ code: 500, msg: '重扫失败: ' + (e.message || e), data: [] });
    }
  });
  app.setGlobalPrefix('api');
  // 托管 H5 前端静态文件
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // 全局拦截器：统一将 POST 请求的 201 状态码改为 200
  app.useGlobalInterceptors(new HttpStatusInterceptor());
  // 1. 开启优雅关闭 Hooks (关键!)
  app.enableShutdownHooks();

  // 2. 解析端口
  const port = parsePort();
  try {
    await app.listen(port);
    console.log(`Server running on http://localhost:${port}`);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ 端口 \({port} 被占用! 请运行 'npx kill-port \){port}' 然后重试。`);
      process.exit(1);
    } else {
      throw err;
    }
  }
  console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();

