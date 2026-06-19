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
var AccessLimitGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessLimitGuard = exports.SkipAccessLimit = exports.SKIP_ACCESS_LIMIT = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const device_registry_service_1 = require("../modules/device/device-registry.service");
const auth_service_1 = require("../modules/auth/auth.service");
exports.SKIP_ACCESS_LIMIT = 'skip_access_limit';
const SkipAccessLimit = () => Reflect.metadata(exports.SKIP_ACCESS_LIMIT, true);
exports.SkipAccessLimit = SkipAccessLimit;
let AccessLimitGuard = AccessLimitGuard_1 = class AccessLimitGuard {
    constructor(deviceRegistry, auth, reflector) {
        this.deviceRegistry = deviceRegistry;
        this.auth = auth;
        this.reflector = reflector;
        this.logger = new common_1.Logger(AccessLimitGuard_1.name);
    }
    async canActivate(context) {
        const skip = this.reflector.getAllAndOverride(exports.SKIP_ACCESS_LIMIT, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (skip)
            return true;
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            const payload = this.auth.verifyToken(token);
            if (!payload) {
                return true;
            }
            void this.auth.getUserStatus(payload.userId).then((status) => {
                if (status && status.isExpired) {
                    this.logger.warn(`⛔ 用户 ${payload.username} 已过期`);
                }
            });
            if (new Date(payload.expiresAt).getTime() < Date.now()) {
                throw new common_1.HttpException({ code: 403, msg: '您的试用/订阅已过期，请续费', data: { isExpired: true, daysLeft: 0 } }, common_1.HttpStatus.FORBIDDEN);
            }
            request.user = payload;
            return true;
        }
        const deviceId = request.headers['x-device-id'];
        if (deviceId) {
            const result = await this.deviceRegistry.touchDevice(deviceId, request.headers['user-agent'] || 'unknown');
            if (!result.allowed) {
                throw new common_1.HttpException({ code: 429, msg: result.message, data: null }, common_1.HttpStatus.TOO_MANY_REQUESTS);
            }
            return true;
        }
        const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || request.headers['x-real-ip']
            || request.ip
            || 'unknown';
        const ua = request.headers['user-agent'] || 'unknown';
        const result = await this.deviceRegistry.tryRegister(ip, ua);
        if (!result.allowed) {
            throw new common_1.HttpException({ code: 429, msg: result.message, data: null }, common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        return true;
    }
};
exports.AccessLimitGuard = AccessLimitGuard;
exports.AccessLimitGuard = AccessLimitGuard = AccessLimitGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [device_registry_service_1.DeviceRegistryService,
        auth_service_1.AuthService,
        core_1.Reflector])
], AccessLimitGuard);
