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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var GemScreenerController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GemScreenerController = void 0;
const common_1 = require("@nestjs/common");
const gem_screener_service_1 = require("./gem-screener.service");
const iconv = require("iconv-lite");
const fs_1 = require("fs");
const path_1 = require("path");
const data_1 = require("../../industry-sectors/data");
let GemScreenerController = GemScreenerController_1 = class GemScreenerController {
    constructor(gemScreener) {
        this.gemScreener = gemScreener;
        this.logger = new common_1.Logger(GemScreenerController_1.name);
    }
    async tencentProxy(body) {
        if (!body.q)
            return { code: 400, msg: 'missing q parameter' };
        const url = 'https://qt.gtimg.cn/q=' + encodeURIComponent(body.q);
        const res = await fetch(url);
        const buf = Buffer.from(await res.arrayBuffer());
        const txt = iconv.decode(buf, 'gbk');
        return { code: 200, msg: 'success', data: { text: txt } };
    }
    async refreshWithData(body) {
        const opportunities = await this.gemScreener.scanWithFrontendData(body.stocks);
        return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
    }
    async refreshMainBoard(body) {
        const opportunities = await this.gemScreener.scanWithFrontendMainBoardData(body.stocks);
        return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
    }
    async refreshSector(body) {
        const opportunities = await this.gemScreener.scanWithFrontendSectorData(body.stocks);
        return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
    }
    async refreshHeavyBuy(body) {
        try {
            const stocks = body?.stocks || [];
            if (stocks.length === 0) {
                return { code: 400, msg: 'no stocks data', data: { opportunities: [] } };
            }
            this.logger.log(`📥 接收到重仓买入推送: ${stocks.length} 只`);
            const results = await this.gemScreener.scanWithFrontendHeavyBuyData(stocks);
            return { code: 200, msg: 'success', data: { opportunities: results } };
        }
        catch (e) {
            this.logger.error(`❌ 重仓买入分析失败: ${e.message}`);
            return { code: 500, msg: e.message, data: { opportunities: [] } };
        }
    }
    async getOpportunities() {
        const { opportunities, timestamp } = await this.gemScreener.getOpportunities();
        return { code: 200, msg: 'success', data: { opportunities, timestamp } };
    }
    async getMainBoard() {
        const { opportunities, timestamp } = await this.gemScreener.getMainBoardOpportunities();
        return { code: 200, msg: 'success', data: { opportunities, timestamp } };
    }
    async getTopGem(force) {
        const result = await this.gemScreener.scanTopGem(force === 'true');
        const heavyBuyGEM = this.readHeavyBuyCache().filter(s => s.code && (s.code.startsWith('300') || s.code.startsWith('301')));
        const merged = this.mergeWithHeavyBuy(result.opportunities, heavyBuyGEM);
        return { code: 200, msg: 'success', data: { opportunities: merged.slice(0, 10), timestamp: result.timestamp } };
    }
    async getTopMainBoard(force) {
        const result = await this.gemScreener.scanTopMainBoard(force === 'true');
        const heavyBuyMain = this.readHeavyBuyCache().filter(s => s.code && !s.code.startsWith('30'));
        const merged = this.mergeWithHeavyBuy(result.opportunities, heavyBuyMain);
        return { code: 200, msg: 'success', data: { opportunities: merged.slice(0, 10), timestamp: result.timestamp } };
    }
    async getCombinedTop(force) {
        const [gemResult, mainResult] = await Promise.all([
            this.gemScreener.scanTopGem(force === 'true'),
            this.gemScreener.scanTopMainBoard(force === 'true'),
        ]);
        const heavyBuyAll = this.readHeavyBuyCache();
        const gemMerged = this.mergeWithHeavyBuy(gemResult.opportunities, heavyBuyAll.filter(s => s.code && (s.code.startsWith('300') || s.code.startsWith('301'))));
        const mainMerged = this.mergeWithHeavyBuy(mainResult.opportunities, heavyBuyAll.filter(s => s.code && !s.code.startsWith('30')));
        const all = [...gemMerged, ...mainMerged];
        const signalOrder = { '重仓买入': 0, '买入': 1, '轻仓买入': 2 };
        const sorted = all
            .filter(s => s.suggestion && ['重仓买入', '买入', '轻仓买入'].includes(s.suggestion))
            .sort((a, b) => {
            const ao = signalOrder[a.suggestion] ?? 9;
            const bo = signalOrder[b.suggestion] ?? 9;
            if (ao !== bo)
                return ao - bo;
            return (a.pricePosition ?? 100) - (b.pricePosition ?? 100);
        })
            .slice(0, 20);
        for (const s of sorted) {
            if (s.chipConcentration90 === undefined) {
                s.chipConcentration90 = 50;
                s.chipPeakPosition = 'mid';
                s.chipPattern = 'dispersed';
            }
            if (s.signalCombination === undefined)
                s.signalCombination = '';
            if (s.jiGouActiveScore === undefined)
                s.jiGouActiveScore = 0;
        }
        return { code: 200, msg: 'success', data: { opportunities: sorted, timestamp: Date.now() } };
    }
    async getTopOpportunities(force) {
        const result = await this.gemScreener.scanTopOpportunities(force === 'true');
        return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
    }
    async getTopSector(force) {
        const result = await this.gemScreener.scanSectorOpportunities(force === 'true');
        return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
    }
    async getHeavyBuy() {
        const all = await this.gemScreener.getAllOpportunities();
        const cachedHeavyBuy = all.filter(s => s.suggestion === '重仓买入');
        if (cachedHeavyBuy.length >= 3) {
            return { code: 200, msg: 'success', data: { opportunities: cachedHeavyBuy.slice(0, 3), timestamp: Date.now() } };
        }
        try {
            const paths = [
                (0, path_1.join)(__dirname, '..', '..', '..', 'assets', 'heavy-buy-cache.json'),
                (0, path_1.join)(process.cwd(), 'assets', 'heavy-buy-cache.json'),
            ];
            for (const p of paths) {
                if ((0, fs_1.existsSync)(p)) {
                    const raw = (0, fs_1.readFileSync)(p, 'utf-8');
                    const parsed = JSON.parse(raw);
                    const seedData = parsed.data || parsed.opportunities || parsed;
                    if (Array.isArray(seedData) && seedData.length > 0) {
                        this.logger.log(`✅ 使用种子缓存: ${seedData.length} 只重仓买入`);
                        return { code: 200, msg: 'success', data: { opportunities: seedData.slice(0, 3), timestamp: Date.now() } };
                    }
                }
            }
        }
        catch (e) {
            this.logger.warn('读取重仓买入种子缓存失败: ' + e.message);
        }
        this.gemScreener.scanGlobalHeavyBuy().catch(e => {
            this.logger.warn('后台全局重仓扫描失败: ' + e.message);
        });
        return { code: 200, msg: 'success', data: { opportunities: [], timestamp: Date.now() } };
    }
    async getIndustrySectorsTop10() {
        try {
            const result = await this.gemScreener.getIndustrySectorTop10();
            if (result && result.sectors && result.sectors.length > 0) {
                return { code: 200, msg: 'success', data: result };
            }
        }
        catch (e) {
            this.logger.warn('实时行业板块排行失败: ' + e.message);
        }
        try {
            const ALL_SECTORS = [...data_1.default, ...data_1.CONCEPT_SECTORS];
            const fallbackSectors = ALL_SECTORS.map((s, i) => ({
                rank: 0,
                name: s.name,
                avgChangePercent: 0,
                totalStocks: s.codes.length,
                upStocks: 0,
                stocks: s.codes.slice(0, 10).map(code => ({ code, name: '', price: 0, changePercent: 0 })),
            }));
            fallbackSectors.sort((a, b) => a.name.localeCompare(b.name));
            fallbackSectors.forEach((s, i) => { s.rank = i + 1; });
            this.logger.log(`✅ 使用内置ALL_SECTORS降级: ${fallbackSectors.length} 个板块(含概念)`);
            return { code: 200, msg: 'success', data: { sectors: fallbackSectors, timestamp: Date.now() } };
        }
        catch (e) {
            this.logger.error('ALL_SECTORS降级失败: ' + e.message);
        }
        return { code: 200, msg: 'success', data: { sectors: [], timestamp: Date.now() } };
    }
    async seedCache() {
        const result = await this.gemScreener.generateSeedCache();
        return { code: 200, msg: 'success', data: result };
    }
    readHeavyBuyCache() {
        try {
            const paths = [
                (0, path_1.join)(process.cwd(), 'assets', 'heavy-buy-cache.json'),
            ];
            for (const p of paths) {
                if ((0, fs_1.existsSync)(p)) {
                    const raw = (0, fs_1.readFileSync)(p, 'utf-8');
                    const data = JSON.parse(raw);
                    if (data && data.data && data.data.length > 0) {
                        return data.data.map(s => ({ ...s, suggestion: '重仓买入', suggestText: '🔥 重仓买入' }));
                    }
                }
            }
        }
        catch (e) {
            this.logger.error('读取重仓买入缓存失败: ' + e.message);
        }
        return [];
    }
    mergeWithHeavyBuy(opportunities, heavyBuy) {
        const heavyCodes = new Set(heavyBuy.map(s => s.code));
        const uniqueOpps = opportunities.filter(s => !heavyCodes.has(s.code));
        const merged = [...heavyBuy, ...uniqueOpps].sort((a, b) => (b.score || 0) - (a.score || 0));
        return merged;
    }
    async searchStock(keyword) {
        if (!keyword || keyword.trim().length === 0) {
            return { code: 400, msg: '请输入搜索关键词', data: [] };
        }
        try {
            const results = await this.gemScreener.searchStocks(keyword.trim());
            return { code: 200, msg: 'ok', data: results };
        }
        catch (e) {
            this.logger.error(`搜索失败: ${e.message}`);
            return { code: 500, msg: e.message, data: [] };
        }
    }
    async refreshAll(body) {
        const opportunities = await this.gemScreener.scanAllWithFrontendData(body.stocks);
        return { code: 200, msg: 'success', data: { opportunities, timestamp: Date.now() } };
    }
};
exports.GemScreenerController = GemScreenerController;
__decorate([
    (0, common_1.Post)('tencent-proxy'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "tencentProxy", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshWithData", null);
__decorate([
    (0, common_1.Post)('refresh-main-board'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshMainBoard", null);
__decorate([
    (0, common_1.Post)('refresh-sector'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshSector", null);
__decorate([
    (0, common_1.Post)('refresh-heavy-buy'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshHeavyBuy", null);
__decorate([
    (0, common_1.Get)('opportunities'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getOpportunities", null);
__decorate([
    (0, common_1.Get)('main-board'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getMainBoard", null);
__decorate([
    (0, common_1.Get)('top/gem'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopGem", null);
__decorate([
    (0, common_1.Get)('top/main-board'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopMainBoard", null);
__decorate([
    (0, common_1.Get)('top/combined'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getCombinedTop", null);
__decorate([
    (0, common_1.Get)('top/opportunities'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopOpportunities", null);
__decorate([
    (0, common_1.Get)('top/sector'),
    __param(0, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopSector", null);
__decorate([
    (0, common_1.Get)('top/heavy-buy'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getHeavyBuy", null);
__decorate([
    (0, common_1.Get)('industry-sectors/top10'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getIndustrySectorsTop10", null);
__decorate([
    (0, common_1.Post)('seed-cache'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "seedCache", null);
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "searchStock", null);
__decorate([
    (0, common_1.Post)('refresh-all'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "refreshAll", null);
exports.GemScreenerController = GemScreenerController = GemScreenerController_1 = __decorate([
    (0, common_1.Controller)('gem'),
    __metadata("design:paramtypes", [gem_screener_service_1.GemScreenerService])
], GemScreenerController);
