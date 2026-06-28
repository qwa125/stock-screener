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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessControlController = void 0;
const common_1 = require("@nestjs/common");
const access_control_service_1 = require("./access-control.service");
const device_registry_service_1 = require("../device/device-registry.service");
const access_limit_guard_1 = require("../../guards/access-limit.guard");
let AccessControlController = class AccessControlController {
    constructor(service, deviceRegistry) {
        this.service = service;
        this.deviceRegistry = deviceRegistry;
    }
    async register(body) {
        const result = await this.service.registerDevice(body.deviceId, body.fingerprint || {});
        return {
            code: result.success ? 200 : 403,
            msg: result.success ? '注册成功' : (result.reason || '访问被拒绝'),
            data: this.service.getStatus(body.deviceId),
        };
    }
    async status(deviceId) {
        const acStatus = this.service.getStatus(deviceId);
        return {
            code: 200,
            msg: 'ok',
            data: {
                ...acStatus,
                maxSlots: await this.deviceRegistry.getEffectiveMaxSlots(),
                usedSlots: await this.deviceRegistry.registeredCount(),
            },
        };
    }
    async setSlotsPost(body) {
        return this.setSlots(body.maxSlots);
    }
    async setSlotsGet(maxSlots) {
        return this.setSlots(Number(maxSlots));
    }
    async setSlots(maxSlots) {
        if (!maxSlots || maxSlots < 1 || !Number.isInteger(maxSlots)) {
            return { code: 400, msg: '无效名额数，请传入整数，如 ?maxSlots=30' };
        }
        await this.service.setMaxSlots(maxSlots);
        await this.deviceRegistry.setMaxSlots(maxSlots);
        return { code: 200, msg: `名额已设为 ${maxSlots}` };
    }
    async reset() {
        await this.service.resetRegistry();
        return { code: 200, msg: '注册表已清空，所有设备需重新注册' };
    }
    async exportRegistry() {
        const base64 = this.service.exportRegistryAsBase64();
        const used = this.service.getUsedSlots();
        const max = await this.deviceRegistry.getEffectiveMaxSlots();
        this.service['logger'].log(`📤 注册表导出: ${used}/${max} 设备, base64(${base64.length}字符)`);
        return {
            code: 200,
            data: {
                base64,
                usedSlots: used,
                maxSlots: max,
                hint: '将此 base64 字符串设为 cloudbaserc.json 中 envParams.DEVICE_REGISTRY，下次部署自动恢复注册表',
            },
        };
    }
    async listDevices() {
        const devices = Object.entries(this.service['registry'].devices).map(([id, rec]) => ({
            deviceId: id.slice(0, 16) + '...',
            registeredAt: new Date(rec.registeredAt).toLocaleString(),
            lastSeen: new Date(rec.lastSeen).toLocaleString(),
        }));
        return {
            code: 200,
            data: {
                maxSlots: await this.deviceRegistry.getEffectiveMaxSlots(),
                usedSlots: this.service.getUsedSlots(),
                devices,
            },
        };
    }
};
exports.AccessControlController = AccessControlController;
__decorate([
    (0, common_1.Post)('register'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccessControlController.prototype, "register", null);
__decorate([
    (0, common_1.Get)('status'),
    __param(0, (0, common_1.Query)('deviceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AccessControlController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('set-slots'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccessControlController.prototype, "setSlotsPost", null);
__decorate([
    (0, common_1.Get)('set-slots'),
    __param(0, (0, common_1.Query)('maxSlots')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AccessControlController.prototype, "setSlotsGet", null);
__decorate([
    (0, common_1.Get)('reset'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AccessControlController.prototype, "reset", null);
__decorate([
    (0, common_1.Get)('export'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AccessControlController.prototype, "exportRegistry", null);
__decorate([
    (0, common_1.Get)('admin/devices'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AccessControlController.prototype, "listDevices", null);
exports.AccessControlController = AccessControlController = __decorate([
    (0, common_1.Controller)('access'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:paramtypes", [access_control_service_1.AccessControlService,
        device_registry_service_1.DeviceRegistryService])
], AccessControlController);
