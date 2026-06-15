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
var AuthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const access_limit_guard_1 = require("../../guards/access-limit.guard");
const fs_1 = require("fs");
let AuthController = AuthController_1 = class AuthController {
    constructor() {
        this.logger = new common_1.Logger(AuthController_1.name);
        this.REGISTRY_FILE = '/tmp/device-registry.json';
    }
    getStatus() {
        return { ok: true };
    }
    getMaxSlots() {
        let registered = 0;
        let maxSlots = 10;
        try {
            if ((0, fs_1.existsSync)(this.REGISTRY_FILE)) {
                const raw = (0, fs_1.readFileSync)(this.REGISTRY_FILE, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    if (typeof parsed.maxSlots === 'number')
                        maxSlots = parsed.maxSlots;
                    if (parsed.devices && typeof parsed.devices === 'object') {
                        registered = Object.keys(parsed.devices).length;
                    }
                }
                else if (Array.isArray(parsed)) {
                    registered = parsed.length;
                }
            }
        }
        catch { }
        return { maxSlots, registered };
    }
    setMaxSlots(body) {
        const slots = Math.max(1, Math.min(100, Math.round(body.maxSlots)));
        let data = {};
        try {
            if ((0, fs_1.existsSync)(this.REGISTRY_FILE)) {
                const raw = (0, fs_1.readFileSync)(this.REGISTRY_FILE, 'utf-8');
                data = JSON.parse(raw);
            }
        }
        catch { }
        if (typeof data !== 'object' || Array.isArray(data)) {
            data = { devices: {} };
        }
        data.maxSlots = slots;
        (0, fs_1.writeFileSync)(this.REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf-8');
        this.logger.log(`🔐 设备限额已更新为 ${slots}`);
        return { ok: true, maxSlots: slots };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AuthController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Get)('max-slots'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AuthController.prototype, "getMaxSlots", null);
__decorate([
    (0, common_1.Put)('max-slots'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], AuthController.prototype, "setMaxSlots", null);
exports.AuthController = AuthController = AuthController_1 = __decorate([
    (0, access_limit_guard_1.SkipAccessLimit)(),
    (0, common_1.Controller)('auth')
], AuthController);
