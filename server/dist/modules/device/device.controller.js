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
};
exports.DeviceController = DeviceController;
__decorate([
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Headers)('x-device-id')),
    __param(1, (0, common_1.Headers)('user-agent')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "register", null);
exports.DeviceController = DeviceController = DeviceController_1 = __decorate([
    (0, common_1.Controller)('device'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:paramtypes", [device_registry_service_1.DeviceRegistryService])
], DeviceController);
