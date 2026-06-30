import { Injectable, Logger } from '@nestjs/common';
import * as iconv from 'iconv-lite';
import { KLine, StockInfo } from './types';

/** 数据获取服务 - 优先从腾讯/东方财富获取真实数据，失败时使用基于真实价格的模拟数据 */
@Injectable()
export class DataFetcherService {
  private readonly logger = new Logger(DataFetcherService.name);
  private readonly EASTMONEY_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
  private readonly EASTMONEY_SEARCH_URL = 'https://searchadapter.eastmoney.com/api/suggest/get';
  private readonly TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/q';
  // 股票K线缓存，避免板块扫描时重复拉取
  private klineCache = new Map<string, { data: KLine[]; timestamp: number }>();
  private readonly KLINE_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

  /** 接受前端预加载的K线数据（Render美国服务器无法直接调通中国API时使用） */
  preloadKline(code: string, klines: KLine[]): void {
    this.klineCache.set(code, { data: klines, timestamp: Date.now() });
  }
  private stockListCache: StockInfo[] | null = null;

  /** 获取全部A股列表（纯前端推送，后端不直接调用API） */
  async getAllStocks(): Promise<StockInfo[]> {
    if (this.stockListCache) return this.stockListCache;
    this.logger.warn('后端不直接调用外部API获取股票列表，请前端推送');
    this.stockListCache = [];
    return [];
    const fallback = this.getHotStockList();
    this.stockListCache = fallback;
    return fallback;
  }

  private getHotStockList(): StockInfo[] {
    const codes = [
      '000001', '000002', '000333', '000651', '000858',
      '002415', '002594', '300750', '600000', '600036',
      '600519', '600690', '600887', '600900', '601012',
      '601166', '601318', '601398', '601857', '601899',
      '601939', '603259', '688981',
    ];
    return codes.map(code => ({
      code, name: '',
      market: code.startsWith('6') || code.startsWith('9') ? 1 : 0,
    }));
  }

  /**
   * 搜索股票（支持代码或名称）
   * 优先腾讯实时行情获取名称，降级到本地映射
   */
  async searchStock(keyword: string): Promise<StockInfo[]> {
    const isCode = /^\d{6}$/.test(keyword.trim());

    if (isCode) {
      // 代码搜索：快速返回 fallback，不等待外部API
      // 从 Render US 调用中国 API 经常超时，直接走本地映射更快
      return this.fallbackSearch(keyword.trim());
    }

    // 尝试东方财富搜索
    const eastRes = await this.searchEastMoney(keyword);
    if (eastRes.length > 0) return eastRes;

    // 降级：本地映射或推断
    return this.fallbackSearch(keyword);
  }

  /** 东方财富股票搜索（禁用外部API） */
  private async searchEastMoney(keyword: string): Promise<StockInfo[]> {
    this.logger.warn(`后端跳过外部搜索: ${keyword}`);
    return [];
  }

  /**
   * 根据股票代码获取K线数据
   * 优先新浪日K线接口获取真实数据，降级到模拟数据
   */
  async getKLineData(code: string, market?: number): Promise<KLine[]> {
    // 检查缓存（前端扫描时已预存真实K线数据，走缓存即可）
    const cached = this.klineCache.get(code);
    if (cached && Date.now() - cached.timestamp < this.KLINE_CACHE_TTL) {
      return cached.data;
    }

    // 没有缓存时返回空数组，不跨境调用外部API（Render海外服务器被东财/新浪拦截）
    this.logger.warn(`K线数据未缓存: ${code}，跳过外部API调用`);
    return [];
  }

  /**
   * 从腾讯获取实时行情数据（注意：腾讯API使用GBK编码）
   */
  async fetchRealTimeQuote(code: string, market?: number): Promise<StockInfo & { price?: number; lastClose?: number; high?: number; low?: number; changePercent?: number } | null> {
    this.logger.warn(`[data-fetcher] 跳过外部行情API，数据由前端推送`);
    return null;
        }

  /** 降级搜索 */
  private fallbackSearch(keyword: string): StockInfo[] {
    const isCode = /^\d{6}$/.test(keyword.trim());
    if (isCode) {
      return [{
        code: keyword.trim(),
        name: `股票${keyword}`,
        market: this.detectMarket(keyword.trim()),
      }];
    }
    const nameMap: Record<string, string> = {
      '茅台': '600519', '贵州茅台': '600519',
      '平安': '601318', '中国平安': '601318',
      '招商银行': '600036', '宁德时代': '300750',
      '比亚迪': '002594', '五粮液': '000858',
      '恒瑞医药': '600276', '药明康德': '603259',
      '美的': '000333', '格力': '000651',
      '盈方微': '000670',
    };
    const code = nameMap[keyword.trim()];
    if (code) {
      return [{ code, name: keyword.trim(), market: this.detectMarket(code) }];
    }
    return [{ code: '600000', name: keyword, market: 1 }];
  }

  /** 基于真实价格生成模拟K线 */
  private generateMockKLine(_code: string, currentPrice?: number, lastClose?: number): KLine[] {
    const result: KLine[] = [];
    const totalDays = 500;

    // 使用真实价格或默认价格
    const targetPrice = currentPrice || (100 + Math.random() * 50);

    // 使用正弦波模拟：价格围绕目标价波动，确保有合理的高/低点范围
    // 振幅为目标价的 ±20%~35%，避免极端位置（≥90%）
    const amplitude = targetPrice * (0.20 + Math.random() * 0.15);
    const cycles = 2.5 + Math.random() * 1.5; // 2.5~4个完整周期

    const baseDate = new Date('2024-01-01');

    for (let i = 0; i < totalDays; i++) {
      // 正弦波 + 随机噪声
      const phase = Math.PI * 2 * i / totalDays * cycles;
      const sineComponent = Math.sin(phase) * amplitude;
      const noise = (Math.random() - 0.5) * amplitude * 0.12;

      // 最后5天逐渐消除波动，收敛到目标价
      let convergeFactor = 0;
      let remain = 0;
      if (i > totalDays - 5) {
        remain = totalDays - i;
        convergeFactor = 1 - remain / 5; // 0% → 80%
      }
      const currentSine = sineComponent * (1 - convergeFactor);
      const currentNoise = noise * (1 - convergeFactor);

      let close = targetPrice + currentSine + currentNoise;
      close = Math.max(close, 0.5);

      // 生成OHLC
      const volatility = Math.max(close * 0.02, 0.01);
      const open = close * (1 + (Math.random() - 0.5) * 0.02);
      const high = Math.max(open, close) + Math.random() * volatility * 0.8;
      const low = Math.min(open, close) - Math.random() * volatility * 0.8;

      const baseVolume = 2000000 + Math.random() * 8000000;
      const volume = baseVolume * (1 + Math.sin(phase) * 0.5);
      const amount = volume * (open + close) / 2;

      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      while (date.getDay() === 0 || date.getDay() === 6) {
        date.setDate(date.getDate() + 1);
      }

      result.push({
        date: date.toISOString().split('T')[0],
        open: Math.round(open * 100) / 100,
        close: Math.round(close * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        volume: Math.round(volume),
        amount: Math.round(amount),
      });
    }

    return result;
  }

  /** 获取市场前缀 */
  private getMarketPrefix(market: number): string {
    if (market === 2) return 'bj';
    return market === 1 ? 'sh' : 'sz';
  }

  /** 检测股票市场代码
   *  0=深圳(000/001/002/003/300/301/159), 1=上海(6/5/68/9), 2=北京(4/8)
   */
  private detectMarket(code: string): number {
    // 北京证券交易所: 4xxxxx, 8xxxxx
    if (code.startsWith('4') || code.startsWith('8')) return 2;
    // 上海: 6xxxxx, 5xxxxx(ETF), 68xxxx(科创板), 9xxxxx
    if (code.startsWith('6') || code.startsWith('9') || code.startsWith('5')) return 1;
    // 深圳: 0xxxxx, 00xxxx, 3xxxxx, 30xxxx(创业板)
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('1')) return 0;
    return 0;
  }
}