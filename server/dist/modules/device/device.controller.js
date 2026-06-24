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
var DeviceController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceController = void 0;
const common_1 = require("@nestjs/common");
const device_registry_service_1 = require("./device-registry.service");
const access_limit_guard_1 = require("../../guards/access-limit.guard");
let DeviceController = DeviceController_1 = class DeviceController {
    constructor(deviceRegistry) {
        this.deviceRegistry = deviceRegistry;
        this.logger = new common_1.Logger(DeviceController_1.name);
    }
    async register(deviceId, ua) {
        if (!deviceId) {
            return { code: 400, msg: '缺少设备ID' };
        }
        try {
            const result = await this.deviceRegistry.touchDevice(deviceId, ua || 'unknown');
            this.logger.log(`设备注册: ${deviceId.slice(0, 20)} | 允许: ${result.allowed}`);
            return { code: result.allowed ? 200 : 429, msg: result.message || 'ok' };
        }
        catch (e) {
            this.logger.warn(`设备注册异常: ${e.message}`);
            return { code: 200, msg: 'ok' };
        }
    }
    async getSettings() {
        return {
            code: 200,
            data: { maxSlots: this.deviceRegistry.maxAllowed }
        };
    }
    async setSlots(body) {
        if (!body.maxSlots || body.maxSlots < 1 || !Number.isInteger(body.maxSlots)) {
            return { code: 400, msg: '无效名额数，请传入正整数' };
        }
        const result = await this.deviceRegistry.setMaxSlots(body.maxSlots);
        return { code: 200, msg: `设备限额已设为 ${body.maxSlots}`, data: result };
    }
    async listDevices() {
        const devices = await this.deviceRegistry.getDevices();
        return {
            code: 200,
            data: {
                maxSlots: this.deviceRegistry.maxAllowed,
                usedSlots: devices.length,
                devices: devices.map((d, i) => ({
                    index: i,
                    fingerprint: d.fingerprint.slice(0, 16) + '...',
                    displayName: d.displayName,
                    firstSeen: new Date(d.firstSeen).toLocaleString(),
                    lastSeen: new Date(d.lastSeen).toLocaleString(),
                })),
            },
        };
    }
    async removeDevice(body) {
        try {
            await this.deviceRegistry.removeDevice(body.index);
            return { code: 200, msg: '设备已移除' };
        }
        catch (e) {
            return { code: 400, msg: e.message };
        }
    }
    async resetDevices() {
        await this.deviceRegistry.removeAllDevices();
        return { code: 200, msg: '所有设备已清空' };
    }
};
exports.DeviceController = DeviceController;
__decorate([
    (0, common_1.Post)('register'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Headers)('x-device-id')),
    __param(1, (0, common_1.Headers)('user-agent')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "register", null);
__decorate([
    (0, common_1.Get)('settings'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "getSettings", null);
__decorate([
    (0, common_1.Post)('set-slots'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "setSlots", null);
__decorate([
    (0, common_1.Get)('list'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "listDevices", null);
__decorate([
    (0, common_1.Post)('remove'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "removeDevice", null);
__decorate([
    (0, common_1.Post)('reset'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "resetDevices", null);
exports.DeviceController = DeviceController = DeviceController_1 = __decorate([
    (0, common_1.Controller)('device'),
    __metadata("design:paramtypes", [device_registry_service_1.DeviceRegistryService])
], DeviceController);
