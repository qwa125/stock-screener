"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var GemScreenerScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GemScreenerScheduler = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const gem_screener_service_1 = require("./gem-screener.service");
let GemScreenerScheduler = GemScreenerScheduler_1 = class GemScreenerScheduler {
    constructor(gemService) {
        this.gemService = gemService;
        this.logger = new common_1.Logger(GemScreenerScheduler_1.name);
        this.lastAutoScanDate = '';
        this.isScanning = false;
        this.isFirstBoot = true;
    }
    async onModuleInit() {
        this.logger.log('🚀 服务启动，等待首次10分钟定时任务触发扫描');
    }
    _isTradingHours() {
        const now = new Date();
        const beijingOffset = 8 * 60;
        const utcMs = now.getTime();
        const beijingMs = utcMs + beijingOffset * 60 * 1000;
        const bj = new Date(beijingMs);
        const dayOfWeek = bj.getUTCDay();
        const hour = bj.getUTCHours();
        const minute = bj.getUTCMinutes();
        if (dayOfWeek === 0 || dayOfWeek === 6)
            return false;
        const totalMinutes = hour * 60 + minute;
        return totalMinutes >= 540 && totalMinutes < 900;
    }
    async autoScan() {
        if (this.isScanning) {
            this.logger.log('⏳ 上一轮扫描尚未完成，跳过本轮');
            return;
        }
        if (!this._isTradingHours()) {
            const now = new Date();
            const bjHour = (now.getUTCHours() + 8) % 24;
            const bjMin = now.getUTCMinutes();
            this.logger.log(`⏰ 非交易时间 (${bjHour}:${String(bjMin).padStart(2, '0')})，跳过扫描`);
            return;
        }
        this.isFirstBoot = false;
        this.isScanning = true;
        this.logger.log(`🚀 [定时扫描] 开始全市场自动扫描 ${new Date().toISOString()}`);
        try {
            this.logger.log('  扫描创业板...');
            const gemResults = await this.gemService['scanAllStocks']();
            if (gemResults && gemResults.length > 0) {
                this.logger.log(`  ✅ 创业板: ${gemResults.length} 只机会`);
            }
            else {
                this.logger.warn('  ⚠️ 创业板扫描无结果');
            }
            this.logger.log('  扫描主板...');
            const mainResults = await this.gemService['scanMainBoardStocks']();
            if (mainResults && mainResults.length > 0) {
                this.logger.log(`  ✅ 主板: ${mainResults.length} 只机会`);
            }
            else {
                this.logger.warn('  ⚠️ 主板扫描无结果');
            }
            const allResults = [
                ...(gemResults || []),
                ...(mainResults || [])
            ];
            const codeMap = new Map();
            for (const s of allResults) {
                if (s.code && s.code.length > 6) {
                    const shortCode = s.code.replace(/^(sh|sz)/, '');
                    if (!codeMap.has(shortCode))
                        codeMap.set(shortCode, s);
                }
                else if (s.code) {
                    if (!codeMap.has(s.code))
                        codeMap.set(s.code, s);
                }
            }
            const merged = Array.from(codeMap.values());
            merged.sort((a, b) => (b.score || 0) - (a.score || 0));
            const top10 = merged.slice(0, 10);
            this.gemService['sectorCache'] = {
                data: top10,
                timestamp: Date.now(),
            };
            const getAll = await this.gemService['getAllOpportunities']();
            const heavyBuyStocks = (Array.isArray(getAll) ? getAll : []).filter((s) => s.suggestion === '重仓买入').slice(0, 5);
            this.gemService['heavyBuyCache'] = {
                data: heavyBuyStocks,
                timestamp: Date.now(),
            };
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
            }
            catch (fsErr) {
            }
            this.logger.log(`✅ [定时扫描] 完成！创业板${gemResults?.length || 0}只 + 主板${mainResults?.length || 0}只, 融合前10`);
        }
        catch (error) {
            this.logger.error(`❌ [定时扫描] 扫描异常: ${error.message}`);
        }
        finally {
            this.isScanning = false;
        }
    }
};
exports.GemScreenerScheduler = GemScreenerScheduler;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_10_MINUTES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerScheduler.prototype, "autoScan", null);
exports.GemScreenerScheduler = GemScreenerScheduler = GemScreenerScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [gem_screener_service_1.GemScreenerService])
], GemScreenerScheduler);
