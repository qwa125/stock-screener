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
exports.SectorController = void 0;
const common_1 = require("@nestjs/common");
const sector_service_1 = require("./sector.service");
const access_limit_guard_1 = require("../../guards/access-limit.guard");
let SectorController = class SectorController {
    constructor(sectorService) {
        this.sectorService = sectorService;
    }
    async getHotSectors() {
        const data = await this.sectorService.getHotSectors();
        return { code: 200, msg: 'success', data };
    }
};
exports.SectorController = SectorController;
__decorate([
    (0, common_1.Get)('hot'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SectorController.prototype, "getHotSectors", null);
exports.SectorController = SectorController = __decorate([
    (0, common_1.Controller)('sector'),
    __metadata("design:paramtypes", [sector_service_1.SectorService])
], SectorController);
