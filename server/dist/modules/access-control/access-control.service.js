"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AccessControlService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessControlService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs/promises"));
let AccessControlService = AccessControlService_1 = class AccessControlService {
    constructor() {
        this.logger = new common_1.Logger(AccessControlService_1.name);
        this.REGISTRY_FILE = process.env.DEVICE_REGISTRY_PATH
            || '/tmp/device-registry.json';
        const maxFromEnv = parseInt(process.env.MAX_SLOTS || '', 10);
        this.registry = { maxSlots: (maxFromEnv > 0) ? maxFromEnv : 2, devices: {} };
    }
    async onApplicationBootstrap() {
        const envRegistry = process.env.DEVICE_REGISTRY;
        if (envRegistry) {
            try {
                const decoded = JSON.parse(Buffer.from(envRegistry, 'base64').toString('utf-8'));
                if (decoded && decoded.devices) {
                    this.registry = decoded;
                    this.logger.log(`📋 从环境变量恢复注册表, 已用 ${this.getUsedSlots()}/${this.registry.maxSlots} 个名额`);
                }
            }
            catch {
                this.logger.warn('⚠️ 环境变量 DEVICE_REGISTRY 解析失败, 忽略');
            }
        }
        try {
            const raw = await fs.readFile(this.REGISTRY_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.devices) {
                this.registry = parsed;
                this.logger.log(`📋 从磁盘文件恢复注册表, 已用 ${this.getUsedSlots()}/${this.registry.maxSlots} 个名额`);
            }
        }
        catch {
            this.logger.log('📋 无本地注册表文件');
        }
    }
    async saveRegistry() {
        try {
            await fs.writeFile(this.REGISTRY_FILE, JSON.stringify(this.registry, null, 2), 'utf-8');
        }
        catch (err) {
            this.logger.warn(`⚠️ 注册表写入失败: ${err.message}`);
        }
    }
    exportRegistryAsBase64() {
        return Buffer.from(JSON.stringify(this.registry)).toString('base64');
    }
    getMaxSlots() {
        return this.registry.maxSlots;
    }
    getUsedSlots() {
        return Object.values(this.registry.devices).filter(d => !d.isAdmin).length;
    }
    async setMaxSlots(n) {
        this.registry.maxSlots = n;
        await this.saveRegistry();
    }
    isDeviceRegistered(deviceId) {
        return !!this.registry.devices[deviceId];
    }
    hasAvailableSlot() {
        return this.getUsedSlots() < this.registry.maxSlots;
    }
    async registerDevice(deviceId, fingerprint, isAdmin = false) {
        if (this.registry.devices[deviceId]) {
            this.registry.devices[deviceId].lastSeen = Date.now();
            await this.saveRegistry();
            return { success: true };
        }
        if (isAdmin) {
            this.registry.devices[deviceId] = {
                registeredAt: Date.now(),
                lastSeen: Date.now(),
                fingerprint,
                isAdmin: true,
            };
            await this.saveRegistry();
            this.logger.log(`✅ 管理员设备注册成功 [${deviceId.slice(0, 8)}...], 不占名额`);
            return { success: true, isAdmin: true };
        }
        if (!this.hasAvailableSlot()) {
            return { success: false, reason: '名额已满, 请联系管理员扩容' };
        }
        this.registry.devices[deviceId] = {
            registeredAt: Date.now(),
            lastSeen: Date.now(),
            fingerprint,
        };
        await this.saveRegistry();
        this.logger.log(`✅ 新设备注册成功 [${deviceId.slice(0, 8)}...], 已用 ${this.getUsedSlots()}/${this.registry.maxSlots}`);
        return { success: true };
    }
    async resetRegistry() {
        this.registry.devices = {};
        await this.saveRegistry();
        this.logger.log(`🔄 注册表已重置, 当前名额 ${this.registry.maxSlots}, 0/${this.registry.maxSlots} 已用`);
    }
    getStatus(deviceId) {
        const registered = deviceId ? this.isDeviceRegistered(deviceId) : false;
        return {
            allowed: registered || this.hasAvailableSlot(),
            usedSlots: this.getUsedSlots(),
            maxSlots: this.registry.maxSlots,
            registered,
        };
    }
};
exports.AccessControlService = AccessControlService;
exports.AccessControlService = AccessControlService = AccessControlService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], AccessControlService);
