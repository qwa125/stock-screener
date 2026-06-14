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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GemScreenerController = void 0;
const common_1 = require("@nestjs/common");
const gem_screener_service_1 = require("./gem-screener.service");
let GemScreenerController = class GemScreenerController {
    constructor(gemScreener) {
        this.gemScreener = gemScreener;
    }
    async getOpportunities() {
        const { opportunities, timestamp } = await this.gemScreener.getOpportunities();
        return { code: 200, msg: 'success', data: { opportunities, timestamp } };
    }
    async getMainBoard() {
        const { opportunities, timestamp } = await this.gemScreener.getMainBoardOpportunities();
        return { code: 200, msg: 'success', data: { opportunities, timestamp } };
    }
    async getTopGem() {
        const opportunities = await this.gemScreener.scanTopGem();
        return { code: 200, msg: 'success', data: { opportunities } };
    }
    async getTopMainBoard() {
        const opportunities = await this.gemScreener.scanTopMainBoard();
        return { code: 200, msg: 'success', data: { opportunities } };
    }
    async getTopOpportunities() {
        const opportunities = await this.gemScreener.scanTopOpportunities();
        return { code: 200, msg: 'success', data: { opportunities } };
    }
};
exports.GemScreenerController = GemScreenerController;
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
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopGem", null);
__decorate([
    (0, common_1.Get)('top/main-board'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopMainBoard", null);
__decorate([
    (0, common_1.Get)('top/opportunities'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GemScreenerController.prototype, "getTopOpportunities", null);
exports.GemScreenerController = GemScreenerController = __decorate([
    (0, common_1.Controller)('gem'),
    __metadata("design:paramtypes", [gem_screener_service_1.GemScreenerService])
], GemScreenerController);
