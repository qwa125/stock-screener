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
        return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
    }
    async getTopMainBoard(force) {
        const result = await this.gemScreener.scanTopMainBoard(force === 'true');
        return { code: 200, msg: 'success', data: { opportunities: result.opportunities, timestamp: result.timestamp } };
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
        this.logger.log('🔍 缓存重仓买入不足3只，启动全局扫描...');
        const globalHeavyBuy = await this.gemScreener.scanGlobalHeavyBuy();
        return { code: 200, msg: 'success', data: { opportunities: globalHeavyBuy.slice(0, 3), timestamp: Date.now() } };
    }
    async getIndustrySectorsTop10() {
        const result = await this.gemScreener.getIndustrySectorTop10();
        return { code: 200, msg: 'success', data: result };
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
exports.GemScreenerController = GemScreenerController = GemScreenerController_1 = __decorate([
    (0, common_1.Controller)('gem'),
    __metadata("design:paramtypes", [gem_screener_service_1.GemScreenerService])
], GemScreenerController);
