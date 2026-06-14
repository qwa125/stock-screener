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
exports.AccessLimitGuard = exports.SkipAccessLimit = exports.SKIP_ACCESS_LIMIT = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const device_registry_service_1 = require("../modules/device/device-registry.service");
exports.SKIP_ACCESS_LIMIT = 'skip_access_limit';
const SkipAccessLimit = () => Reflect.metadata(exports.SKIP_ACCESS_LIMIT, true);
exports.SkipAccessLimit = SkipAccessLimit;
let AccessLimitGuard = class AccessLimitGuard {
    constructor(deviceRegistry, reflector) {
        this.deviceRegistry = deviceRegistry;
        this.reflector = reflector;
    }
    canActivate(context) {
        const skip = this.reflector.getAllAndOverride(exports.SKIP_ACCESS_LIMIT, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (skip)
            return true;
        const request = context.switchToHttp().getRequest();
        const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || request.headers['x-real-ip']
            || request.ip
            || 'unknown';
        const ua = request.headers['user-agent'] || 'unknown';
        const result = this.deviceRegistry.tryRegister(ip, ua);
        if (!result.allowed) {
            throw new common_1.HttpException({ code: 429, msg: result.message, data: null }, common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        return true;
    }
};
exports.AccessLimitGuard = AccessLimitGuard;
exports.AccessLimitGuard = AccessLimitGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [device_registry_service_1.DeviceRegistryService,
        core_1.Reflector])
], AccessLimitGuard);
