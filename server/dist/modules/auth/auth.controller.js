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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const auth_service_1 = require("./auth.service");
const access_limit_guard_1 = require("../../guards/access-limit.guard");
const device_registry_service_1 = require("../device/device-registry.service");
let AuthController = class AuthController {
    constructor(auth, deviceRegistry) {
        this.auth = auth;
        this.deviceRegistry = deviceRegistry;
    }
    async register(body) {
        if (!body.username || body.username.length < 2) {
            return { code: 400, msg: '用户名至少 2 个字符' };
        }
        if (!body.password || body.password.length < 4) {
            return { code: 400, msg: '密码至少 4 个字符' };
        }
        try {
            const result = await this.auth.register(body.username, body.password);
            return { code: 200, msg: '注册成功，赠送 7 天试用', data: result };
        }
        catch (e) {
            return { code: 409, msg: e.message || '注册失败' };
        }
    }
    async login(body) {
        try {
            const result = await this.auth.login(body.username, body.password);
            return { code: 200, msg: '登录成功', data: result };
        }
        catch (e) {
            return { code: 401, msg: e.message || '登录失败' };
        }
    }
    async me(auth) {
        if (!auth || !auth.startsWith('Bearer ')) {
            return { code: 401, msg: '未登录', data: { isExpired: true, daysLeft: 0 } };
        }
        const token = auth.slice(7);
        const payload = this.auth.verifyToken(token);
        if (!payload) {
            return { code: 401, msg: '登录已过期，请重新登录', data: { isExpired: true, daysLeft: 0 } };
        }
        const status = await this.auth.getUserStatus(payload.userId);
        if (!status) {
            return { code: 401, msg: '用户不存在', data: { isExpired: true, daysLeft: 0 } };
        }
        return { code: 200, msg: status.isExpired ? '已过期' : '有效', data: status };
    }
    async extend(body) {
        if (!body.username || !body.days || body.days < 1) {
            return { code: 400, msg: '请提供用户名和有效天数' };
        }
        try {
            const result = await this.auth.extendSubscription(body.username, body.days);
            return { code: 200, msg: `已为 ${body.username} 延长 ${body.days} 天`, data: result };
        }
        catch (e) {
            return { code: 404, msg: e.message };
        }
    }
    async setExpiry(body) {
        if (!body.username || !body.expiryDate) {
            return { code: 400, msg: '请提供用户名和到期日期' };
        }
        try {
            const result = await this.auth.setExpiryDate(body.username, body.expiryDate);
            return { code: 200, msg: `已设置 ${body.username} 到期日为 ${body.expiryDate}`, data: result };
        }
        catch (e) {
            return { code: 404, msg: e.message };
        }
    }
    getMaxSlots() {
        return {
            maxSlots: this.deviceRegistry.maxAllowed,
            registered: this.deviceRegistry.registeredCount,
        };
    }
    async setMaxSlots(body) {
        const slots = Math.max(1, Math.min(100, Math.round(body.maxSlots)));
        await this.deviceRegistry.setMaxSlots(slots);
        return { ok: true, maxSlots: slots };
    }
    async getDevices() {
        const devices = (await this.deviceRegistry.getDevices()).map(d => ({
            ...d,
            firstSeenStr: new Date(d.firstSeen).toLocaleString('zh-CN'),
            lastSeenStr: new Date(d.lastSeen).toLocaleString('zh-CN'),
        }));
        return { code: 200, data: { devices, total: devices.length } };
    }
    async removeDevice(index) {
        const idx = parseInt(index, 10);
        const ok = await this.deviceRegistry.removeDevice(idx);
        if (!ok) {
            return { code: 404, msg: `设备 #${idx} 不存在` };
        }
        return { code: 200, msg: `已删除设备 #${idx}`, data: { registered: this.deviceRegistry.registeredCount } };
    }
    async updateRemark(index, body) {
        const idx = parseInt(index, 10);
        const ok = await this.deviceRegistry.updateRemark(idx, body.remark || '');
        if (!ok) {
            return { code: 404, msg: `设备 #${idx} 不存在` };
        }
        return { code: 200, msg: '备注已更新' };
    }
    async clearDevices() {
        await this.deviceRegistry.removeAllDevices();
        return { code: 200, msg: '已清空全部设备注册', data: { registered: 0 } };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Headers)('authorization')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
__decorate([
    (0, common_1.Post)('extend'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "extend", null);
__decorate([
    (0, common_1.Post)('set-expiry'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "setExpiry", null);
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
    __metadata("design:returntype", Promise)
], AuthController.prototype, "setMaxSlots", null);
__decorate([
    (0, common_1.Get)('devices'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getDevices", null);
__decorate([
    (0, common_1.Delete)('devices/:index'),
    __param(0, (0, common_1.Param)('index')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "removeDevice", null);
__decorate([
    (0, common_1.Put)('devices/:index/remark'),
    __param(0, (0, common_1.Param)('index')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "updateRemark", null);
__decorate([
    (0, common_1.Delete)('devices'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "clearDevices", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    (0, access_limit_guard_1.SkipAccessLimit)(),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        device_registry_service_1.DeviceRegistryService])
], AuthController);
