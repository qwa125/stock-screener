import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GemScreenerService } from './gem-screener.service';

@Injectable()
export class GemScreenerScheduler implements OnModuleInit {
  private readonly logger = new Logger(GemScreenerScheduler.name);
  private lastAutoScanDate = '';
  private isScanning = false;
  private isFirstBoot = true;

  constructor(private readonly gemService: GemScreenerService) {}

  /**
   * 启动时立即检查是否需要扫描（处理Render冷启动唤醒）
   * 用于：Render休眠后被请求唤醒 → 判断如果在交易时间内 → 立即扫描
   */
  async onModuleInit() {
    this.logger.log('🚀 服务启动，等待首次10分钟定时任务触发扫描');
    // 启动时不做自动扫描，避免Render海外服务器访问Tencent API超时导致进程不稳定
    // 所有扫描由每10分钟的Cron任务驱动
  }

  /**
   * 判断当前是否为北京时间交易时段 (周一至周五 9:00-15:00)
   */
  private _isTradingHours(): boolean {
    const now = new Date();
    const beijingOffset = 8 * 60;
    const utcMs = now.getTime();
    const beijingMs = utcMs + beijingOffset * 60 * 1000;
    const bj = new Date(beijingMs);
    const dayOfWeek = bj.getUTCDay();
    const hour = bj.getUTCHours();
    const minute = bj.getUTCMinutes();
    
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    const totalMinutes = hour * 60 + minute;
    return totalMinutes >= 540 && totalMinutes < 900;
  }

  /**
   * 北京时间 9:00-15:00，每10分钟自动扫描一次
   * 周末不扫描
   * 15:00后到次日9:00不扫描
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoScan() {
    if (this.isScanning) {
      this.logger.log('⏳ 上一轮扫描尚未完成，跳过本轮');
      return;
    }

    // ─── 判断当前是否为可扫描时间 ───
    if (!this._isTradingHours()) {
      const now = new Date();
      const bjHour = (now.getUTCHours() + 8) % 24;
      const bjMin = now.getUTCMinutes();
      this.logger.log(`⏰ 非交易时间 (${bjHour}:${String(bjMin).padStart(2,'0')})，跳过扫描`);
      return;
    }

    // 首次启动标记清除
    this.isFirstBoot = false;

    // ─── 执行全市场自动扫描 ───
    this.isScanning = true;
    this.logger.log(`🚀 [定时扫描] 开始全市场自动扫描 ${new Date().toISOString()}`);

    try {
      // 步骤1: 扫描创业板
      this.logger.log('  扫描创业板...');
      const gemResults = await this.gemService['scanAllStocks']();
      if (gemResults && gemResults.length > 0) {
        this.logger.log(`  ✅ 创业板: ${gemResults.length} 只机会`);
      } else {
        this.logger.warn('  ⚠️ 创业板扫描无结果');
      }

      // 步骤2: 扫描主板
      this.logger.log('  扫描主板...');
      const mainResults = await this.gemService['scanMainBoardStocks']();
      if (mainResults && mainResults.length > 0) {
        this.logger.log(`  ✅ 主板: ${mainResults.length} 只机会`);
      } else {
        this.logger.warn('  ⚠️ 主板扫描无结果');
      }

      // 步骤3: 合并全市场结果到 sectorCache
      const allResults = [
        ...(gemResults || []),
        ...(mainResults || [])
      ];
      // 去重 by code
      const codeMap = new Map<string, any>();
      for (const s of allResults) {
        if (s.code && s.code.length > 6) {
          const shortCode = s.code.replace(/^(sh|sz)/, '');
          if (!codeMap.has(shortCode)) codeMap.set(shortCode, s);
        } else if (s.code) {
          if (!codeMap.has(s.code)) codeMap.set(s.code, s);
        }
      }
      const merged = Array.from(codeMap.values());
      
      // 按分数排序取前10
      merged.sort((a, b) => (b.score || 0) - (a.score || 0));
      const top10 = merged.slice(0, 10);
      
      (this.gemService as any)['sectorCache'] = {
        data: top10,
        timestamp: Date.now(),
      };

      // 更新 heavy-buy 缓存
      const getAll = await this.gemService['getAllOpportunities']();
      const heavyBuyStocks = (Array.isArray(getAll) ? getAll : []).filter(
        (s: any) => s.suggestion === '重仓买入'
      ).slice(0, 5);
      
      (this.gemService as any)['heavyBuyCache'] = {
        data: heavyBuyStocks,
        timestamp: Date.now(),
      };

      // 写入磁盘缓存（可选）
      try {
        const fs = require('fs');
        const path = require('path');
        const cacheDir = '/tmp';
        fs.writeFileSync(path.join(cacheDir, 'sector-opportunities-cache.json'), JSON.stringify({
          data: top10,
          timestamp: Date.now()
        }));
        fs.writeFileSync(path.join(cacheDir, 'gem-opportunities-cache.json'), JSON.stringify({
          data: gemResults || [],
          timestamp: Date.now()
        }));
        fs.writeFileSync(path.join(cacheDir, 'main-board-opportunities-cache.json'), JSON.stringify({
          data: mainResults || [],
          timestamp: Date.now()
        }));
      } catch (fsErr) {
        // 无法写入磁盘缓存不影响主流程
      }

      this.logger.log(`✅ [定时扫描] 完成！创业板${gemResults?.length || 0}只 + 主板${mainResults?.length || 0}只, 融合前10`);
    } catch (error) {
      this.logger.error(`❌ [定时扫描] 扫描异常: ${error.message}`);
    } finally {
      this.isScanning = false;
    }
  }
}