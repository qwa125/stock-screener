import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GemScreenerService } from './gem-screener.service';
import * as fs from 'fs';
import * as path from 'path';

export interface MarketState {
  status: 'premarket' | 'trading' | 'lunch' | 'closed';
  lastScanTime: number;
  lastScanCount: number;
  lockUntil: number;
  nextScanTime: number;
}

@Injectable()
export class GemScreenerScheduler implements OnModuleInit {
  private readonly logger = new Logger(GemScreenerScheduler.name);
  private state: MarketState = {
    status: 'closed',
    lastScanTime: 0,
    lastScanCount: 0,
    lockUntil: 0,
    nextScanTime: 0,
  };
  private STATE_FILE = '/tmp/market-state.json';
  private isScanning = false;
  // 上次完整扫描的"买入"股票代码列表（用于实时价格推送）
  private watchedCodes: string[] = [];
  // 缓存：assets全市场数据（只读一次，避免重复IO）
  private _cacheLoaded = false;
  private _allStocks: any[] = [];
  private _gemCacheData: any = null;
  private _mainCacheData: any = null;

  constructor(private readonly gemService: GemScreenerService) {}

  async onModuleInit() {
    this.loadState();
    this.logger.log(`📅 市场调度器启动 | 状态:${this.state.status} | 锁止到:${this.state.lockUntil ? new Date(this.state.lockUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '无'}`);
    // 初始化nextScanTime
    this._updateNextScanTime();
    this.saveState();
    // 预热加载全市场缓存（只读一次，避免定时器重复IO导致OOM）
    this._preloadCache();
  }

  /** 预热加载全市场股票缓存（启动时只读一次） */
  private _preloadCache() {
    try {
      const gemPath = './assets/gem-cache.json';
      const mainPath = './assets/main-board-cache.json';
      let gemArr: any[] = [];
      let mainArr: any[] = [];
      if (fs.existsSync(gemPath)) {
        const raw = JSON.parse(fs.readFileSync(gemPath, 'utf-8'));
        gemArr = raw?.data || [];
        this.logger.log(`✅ 加载gem-cache: ${gemArr.length} 只`);
      }
      if (fs.existsSync(mainPath)) {
        const raw = JSON.parse(fs.readFileSync(mainPath, 'utf-8'));
        mainArr = raw?.data || [];
        this.logger.log(`✅ 加载main-board-cache: ${mainArr.length} 只`);
      }
      this._gemCacheData = gemArr;
      this._mainCacheData = mainArr;
      this._allStocks = [...gemArr, ...mainArr];
      this._cacheLoaded = true;
      this.logger.log(`📊 全市场缓存共 ${this._allStocks.length} 只股票`);
    } catch (e) {
      this.logger.warn('⚠️ 预热加载缓存失败: ' + e.message);
    }
  }

  // ===================== 北京时间判断 =====================

  /** 当前北京时间（毫秒精度） */
  private _bjNow(): Date {
    const now = new Date();
    const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return bj;
  }

  /** 北京时间 星期几 1=周一 5=周五 */
  private _bjDayOfWeek(): number { return this._bjNow().getUTCDay(); }

  /** 北京时间 分钟数 (0-1439) */
  private _bjMinutes(): number {
    const bj = this._bjNow();
    return bj.getUTCHours() * 60 + bj.getUTCMinutes();
  }

  /** 是否是交易日 (周一至周五) */
  private _isTradingDay(): boolean {
    const dow = this._bjDayOfWeek();
    return dow >= 1 && dow <= 5;
  }

  /** 是否是交易时段 9:00-15:00 (含盘前) */
  private _isInSession(): boolean {
    const min = this._bjMinutes();
    return min >= 540 && min < 900; // 9:00 - 15:00
  }

  /** 是否午休 11:30-13:00 */
  private _isLunch(): boolean {
    const min = this._bjMinutes();
    return min >= 690 && min < 780; // 11:30 - 13:00
  }

  /** 盘前准备 9:00-9:25 */
  private _isPreMarket(): boolean {
    const min = this._bjMinutes();
    return min >= 540 && min < 565; // 9:00 - 9:25
  }

  /** 可扫描时段（排除午休和盘前） */
  private _isScanWindow(): boolean {
    if (!this._isTradingDay()) return false;
    const min = this._bjMinutes();
    // 9:25-11:30 或 13:00-15:00
    return (min >= 565 && min < 690) || (min >= 780 && min < 900);
  }

  /** 是否收盘后（15:00后） */
  private _isAfterMarket(): boolean {
    if (!this._isTradingDay()) return false;
    return this._bjMinutes() >= 900;
  }

  /** 下个交易日的开盘时间（北京时间） */
  private _nextTradingDayOpen(): Date {
    const bj = this._bjNow();
    let daysToAdd = 1;
    while (true) {
      const next = new Date(bj.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      const dow = next.getUTCDay();
      if (dow >= 1 && dow <= 5) {
        // 设为 9:25 Beijing time
        next.setUTCHours(1, 25, 0, 0); // 9:25 Beijing = 1:25 UTC
        return next;
      }
      daysToAdd++;
    }
  }

  // ===================== 状态持久化 =====================

  private loadState() {
    try {
      if (fs.existsSync(this.STATE_FILE)) {
        const raw = fs.readFileSync(this.STATE_FILE, 'utf-8');
        this.state = JSON.parse(raw);
        this.logger.log('📂 加载市场状态: ' + this.state.status);
      }
    } catch (e) {
      this.logger.warn('⚠️ 无法加载市场状态文件，使用默认状态');
    }
  }

  private saveState() {
    try {
      const dir = path.dirname(this.STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (e) {
      // ignore
    }
  }

  /** 更新下次扫描时间 */
  private _updateNextScanTime() {
    const min = this._bjMinutes();
    const now = this._bjNow();
    const base = now.getTime();

    if (!this._isTradingDay()) {
      this.state.nextScanTime = this._nextTradingDayOpen().getTime();
      return;
    }

    if (this._isAfterMarket()) {
      this.state.nextScanTime = this._nextTradingDayOpen().getTime();
      return;
    }

    // 在交易时间内：下一次10分钟整点
    const nextMin = Math.ceil((min + 1) / 10) * 10;
    const nextHourBJ = Math.floor(nextMin / 60);
    const nextM = nextMin % 60;
    // 北京时间 → UTC
    const utcHour = (nextHourBJ - 8 + 24) % 24;
    now.setUTCHours(utcHour, nextM, 0, 0);
    this.state.nextScanTime = now.getTime();
  }

  // ===================== 扫描执行 =====================

  private async doScan(label: string) {
    if (this.isScanning) {
      this.logger.log(`⏳ [${label}] 上一轮扫描尚未完成，跳过`);
      return;
    }

    this.isScanning = true;
    this.state.lastScanTime = Date.now();
    this.logger.log(`🚀 [${label}] 开始扫描`);

    try {
      // 使用启动时预加载的全市场缓存（不重复读盘，不写 /tmp 耗内存）
      if (!this._cacheLoaded) this._preloadCache();
      const allStocks = this._allStocks || [];
      
      // 过滤买入信号
      const buySignals = allStocks.filter(s => 
        ['重仓买入', '买入', '轻仓买入'].includes(s.suggestion)
      );
      
      this.state.lastScanCount = allStocks.length;
      this.watchedCodes = buySignals.map(s => s.code);

      this.logger.log(`✅ [${label}] 完成: ${allStocks.length}只, 其中买入信号${buySignals.length}只`);
      
      // 更新状态
      this._updateNextScanTime();
      this.saveState();

    } catch (error: any) {
      this.logger.error(`❌ [${label}] 扫描异常: ${error.message}`);
      this._updateNextScanTime();
      this.saveState();
    } finally {
      this.isScanning = false;
    }
  }

  // ===================== Cron 定时任务 (北京时间) =====================

  /** 9:25 - 首次扫描并解锁（覆盖昨天收盘数据） */
  @Cron('25 9 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async morningFirstScan() {
    if (!this._isTradingDay()) return;
    this.state.status = 'trading';
    this.state.lockUntil = 0;
    this.saveState();
    await this.doScan('9:25 首次开盘扫描');
  }

  /** 每10分钟扫描 (9:40-11:30, 13:00-15:00) */
  @Cron('*/10 9-15 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async periodicScan() {
    if (!this._isTradingDay()) return;
    
    // 盘前 9:00-9:25 跳过
    if (this._isPreMarket()) {
      this.state.status = 'premarket';
      this._updateNextScanTime();
      this.saveState();
      return;
    }

    // 午休 11:30-13:00 跳过
    if (this._isLunch()) {
      this.state.status = 'lunch';
      this._updateNextScanTime();
      this.saveState();
      return;
    }

    // 非交易时间跳过
    if (!this._isScanWindow()) {
      return;
    }

    // 已锁定（收盘后）跳过
    if (this.state.lockUntil > Date.now()) {
      return;
    }

    this.state.status = 'trading';
    this.state.lockUntil = 0;
    this.saveState();
    await this.doScan('每10分钟扫描');
  }

  /** 11:30 - 午间收盘扫描+锁定 */
  @Cron('30 11 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async lunchScanAndLock() {
    if (!this._isTradingDay()) return;
    
    this.state.status = 'lunch';
    this.saveState();
    await this.doScan('11:30 午间扫描');

    // 锁定到13:00
    const bj = this._bjNow();
    bj.setUTCHours(5, 0, 0, 0); // 13:00 Beijing = 5:00 UTC
    this.state.lockUntil = bj.getTime();
    this.saveState();
    
    const lockTime = new Date(bj.getTime()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    this.logger.log(`🔒 午间锁定到 ${lockTime}`);
  }

  /** 13:00 - 午后开盘扫描+解锁 */
  @Cron('0 13 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async afternoonOpen() {
    if (!this._isTradingDay()) return;
    
    this.state.status = 'trading';
    this.state.lockUntil = 0;
    this.saveState();
    await this.doScan('13:00 午后开盘扫描');
  }

  /** 15:00 - 收盘扫描+锁定到下一交易日 */
  @Cron('0 15 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async marketClose() {
    if (!this._isTradingDay()) return;

    this.state.status = 'closed';
    await this.doScan('15:00 收盘扫描');

    // 锁定到下一交易日9:25
    const nextOpen = this._nextTradingDayOpen();
    this.state.lockUntil = nextOpen.getTime();
    this.saveState();

    const lockStr = nextOpen.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    this.logger.log(`🔒 收盘锁定到 ${lockStr}`);
  }

  // ===================== 公开 API =====================

  getState(): MarketState {
    // 动态检查：如果锁已过期或已进入交易时段，自动恢复
    if (this.state.lockUntil > 0 && this._isTradingDay()) {
      const now = Date.now();
      const inScanWindow = this._isScanWindow();
      const shouldUnlock = now > this.state.lockUntil || inScanWindow;
      if (shouldUnlock) {
        // 午休期间不解锁（11:30-13:00）
        if (!this._isLunch()) {
          this.state.status = inScanWindow ? 'trading' : this._isAfterMarket() ? 'closed' : this._isPreMarket() ? 'premarket' : 'trading';
          this.state.lockUntil = 0;
          this.saveState();
        }
      }
    }
    return { ...this.state };
  }

  /** 获取当前关注的股票代码列表（买入信号） */
  getWatchedCodes(): string[] {
    return [...this.watchedCodes];
  }
}