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
const fs = require("fs");
const path = require("path");
let GemScreenerScheduler = GemScreenerScheduler_1 = class GemScreenerScheduler {
    constructor(gemService) {
        this.gemService = gemService;
        this.logger = new common_1.Logger(GemScreenerScheduler_1.name);
        this.state = {
            status: 'closed',
            lastScanTime: 0,
            lastScanCount: 0,
            lockUntil: 0,
            nextScanTime: 0,
        };
        this.STATE_FILE = '/tmp/market-state.json';
        this.isScanning = false;
        this.watchedCodes = [];
    }
    async onModuleInit() {
        this.loadState();
        this.logger.log(`📅 市场调度器启动 | 状态:${this.state.status} | 锁止到:${this.state.lockUntil ? new Date(this.state.lockUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '无'}`);
        this._updateNextScanTime();
        this.saveState();
    }
    _bjNow() {
        const now = new Date();
        const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        return bj;
    }
    _bjDayOfWeek() { return this._bjNow().getUTCDay(); }
    _bjMinutes() {
        const bj = this._bjNow();
        return bj.getUTCHours() * 60 + bj.getUTCMinutes();
    }
    _isTradingDay() {
        const dow = this._bjDayOfWeek();
        return dow >= 1 && dow <= 5;
    }
    _isInSession() {
        const min = this._bjMinutes();
        return min >= 540 && min < 900;
    }
    _isLunch() {
        const min = this._bjMinutes();
        return min >= 690 && min < 780;
    }
    _isPreMarket() {
        const min = this._bjMinutes();
        return min >= 540 && min < 565;
    }
    _isScanWindow() {
        if (!this._isTradingDay())
            return false;
        const min = this._bjMinutes();
        return (min >= 565 && min < 690) || (min >= 780 && min < 900);
    }
    _isAfterMarket() {
        if (!this._isTradingDay())
            return false;
        return this._bjMinutes() >= 900;
    }
    _nextTradingDayOpen() {
        const bj = this._bjNow();
        let daysToAdd = 1;
        while (true) {
            const next = new Date(bj.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            const dow = next.getUTCDay();
            if (dow >= 1 && dow <= 5) {
                next.setUTCHours(1, 25, 0, 0);
                return next;
            }
            daysToAdd++;
        }
    }
    loadState() {
        try {
            if (fs.existsSync(this.STATE_FILE)) {
                const raw = fs.readFileSync(this.STATE_FILE, 'utf-8');
                this.state = JSON.parse(raw);
                this.logger.log('📂 加载市场状态: ' + this.state.status);
            }
        }
        catch (e) {
            this.logger.warn('⚠️ 无法加载市场状态文件，使用默认状态');
        }
    }
    saveState() {
        try {
            const dir = path.dirname(this.STATE_FILE);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.STATE_FILE, JSON.stringify(this.state, null, 2));
        }
        catch (e) {
        }
    }
    _updateNextScanTime() {
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
        const nextMin = Math.ceil((min + 1) / 10) * 10;
        const nextHourBJ = Math.floor(nextMin / 60);
        const nextM = nextMin % 60;
        const utcHour = (nextHourBJ - 8 + 24) % 24;
        now.setUTCHours(utcHour, nextM, 0, 0);
        this.state.nextScanTime = now.getTime();
    }
    async doScan(label) {
        if (this.isScanning) {
            this.logger.log(`⏳ [${label}] 上一轮扫描尚未完成，跳过`);
            return;
        }
        this.isScanning = true;
        this.state.lastScanTime = Date.now();
        this.logger.log(`🚀 [${label}] 开始扫描`);
        try {
            const gemCache = JSON.parse(fs.readFileSync('./assets/gem-cache.json', 'utf-8'));
            const mainCache = JSON.parse(fs.readFileSync('./assets/main-board-cache.json', 'utf-8'));
            const allStocks = [...(gemCache.data || []), ...(mainCache.data || [])];
            const buySignals = allStocks.filter(s => ['重仓买入', '买入', '轻仓买入'].includes(s.suggestion));
            this.state.lastScanCount = allStocks.length;
            this.watchedCodes = buySignals.map(s => s.code);
            const tmpDir = '/tmp';
            fs.writeFileSync(path.join(tmpDir, 'gem-cache.json'), JSON.stringify(gemCache));
            fs.writeFileSync(path.join(tmpDir, 'main-board-cache.json'), JSON.stringify(mainCache));
            fs.writeFileSync(path.join(tmpDir, 'watched-codes.json'), JSON.stringify({
                codes: this.watchedCodes,
                timestamp: Date.now()
            }));
            this.logger.log(`✅ [${label}] 完成: ${allStocks.length}只, 其中买入信号${buySignals.length}只`);
            this._updateNextScanTime();
            this.saveState();
        }
        catch (error) {
            this.logger.error(`❌ [${label}] 扫描异常: ${error.message}`);
            this._updateNextScanTime();
            this.saveState();
        }
        finally {
            this.isScanning = false;
        }
    }
    async morningFirstScan() {
        if (!this._isTradingDay())
            return;
        this.state.status = 'trading';
        this.state.lockUntil = 0;
        this.saveState();
        await this.doScan('9:25 首次开盘扫描');
    }
    async periodicScan() {
        if (!this._isTradingDay())
            return;
        if (this._isPreMarket()) {
            this.state.status = 'premarket';
            this._updateNextScanTime();
            this.saveState();
            return;
        }
        if (this._isLunch()) {
            this.state.status = 'lunch';
            this._updateNextScanTime();
            this.saveState();
            return;
        }
        if (!this._isScanWindow()) {
            return;
        }
        if (this.state.lockUntil > Date.now()) {
            return;
        }
        this.state.status = 'trading';
        this.state.lockUntil = 0;
        this.saveState();
        await this.doScan('每10分钟扫描');
    }
    async lunchScanAndLock() {
        if (!this._isTradingDay())
            return;
        this.state.status = 'lunch';
        this.saveState();
        await this.doScan('11:30 午间扫描');
        const bj = this._bjNow();
        bj.setUTCHours(5, 0, 0, 0);
        this.state.lockUntil = bj.getTime();
        this.saveState();
        const lockTime = new Date(bj.getTime()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        this.logger.log(`🔒 午间锁定到 ${lockTime}`);
    }
    async afternoonOpen() {
        if (!this._isTradingDay())
            return;
        this.state.status = 'trading';
        this.state.lockUntil = 0;
        this.saveState();
        await this.doScan('13:00 午后开盘扫描');
    }
    async marketClose() {
        if (!this._isTradingDay())
            return;
        this.state.status = 'closed';
        await this.doScan('15:00 收盘扫描');
        const nextOpen = this._nextTradingDayOpen();
        this.state.lockUntil = nextOpen.getTime();
        this.saveState();
        const lockStr = nextOpen.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        this.logger.log(`🔒 收盘锁定到 ${lockStr}`);
    }
    getState() {
        if (this.state.lockUntil > 0 && this._isTradingDay()) {
            const now = Date.now();
            const inScanWindow = this._isScanWindow();
            const shouldUnlock = now > this.state.lockUntil || inScanWindow;
            if (shouldUnlock) {
                if (!this._isLunch()) {
                    this.state.status = inScanWindow ? 'trading' : this._isAfterMarket() ? 'closed' : this._isPreMarket() ? 'premarket' : 'trading';
                    this.state.lockUntil = 0;
                    this.saveState();
                }
            }
        }
        return { ...this.state };
    }
    getWatchedCodes() {
        return [...this.watchedCodes];
    }
};
exports.GemScreenerScheduler = GemScreenerScheduler;
__decorate([
    (0, schedule_1.Cron)('25 9 * * 1-5', { timeZone: 'Asia/Shanghai' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerScheduler.prototype, "morningFirstScan", null);
__decorate([
    (0, schedule_1.Cron)('*/10 9-15 * * 1-5', { timeZone: 'Asia/Shanghai' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerScheduler.prototype, "periodicScan", null);
__decorate([
    (0, schedule_1.Cron)('30 11 * * 1-5', { timeZone: 'Asia/Shanghai' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerScheduler.prototype, "lunchScanAndLock", null);
__decorate([
    (0, schedule_1.Cron)('0 13 * * 1-5', { timeZone: 'Asia/Shanghai' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerScheduler.prototype, "afternoonOpen", null);
__decorate([
    (0, schedule_1.Cron)('0 15 * * 1-5', { timeZone: 'Asia/Shanghai' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerScheduler.prototype, "marketClose", null);
exports.GemScreenerScheduler = GemScreenerScheduler = GemScreenerScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [gem_screener_service_1.GemScreenerService])
], GemScreenerScheduler);
