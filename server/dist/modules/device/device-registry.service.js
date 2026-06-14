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
var DeviceRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceRegistryService = void 0;
const common_1 = require("@nestjs/common");
const fs_1 = require("fs");
let DeviceRegistryService = DeviceRegistryService_1 = class DeviceRegistryService {
    constructor() {
        this.logger = new common_1.Logger(DeviceRegistryService_1.name);
        this.REGISTRY_FILE = '/tmp/device-registry.json';
        this.runtimeMaxSlots = null;
        this.registry = [];
        const envMax = parseInt(process.env.MAX_USERS || '', 10);
        this.envMaxUsers = !isNaN(envMax) && envMax > 0 ? envMax : 5;
        this.loadRegistry();
        this.logger.log(`🔐 设备注册表已加载，环境变量 ${this.envMaxUsers}，运行时 ${this.runtimeMaxSlots ?? '未设置'}，有效限额 ${this.effectiveMax}`);
    }
    loadRegistry() {
        try {
            if (!(0, fs_1.existsSync)(this.REGISTRY_FILE))
                return;
            const raw = (0, fs_1.readFileSync)(this.REGISTRY_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                if (typeof parsed.maxSlots === 'number') {
                    this.runtimeMaxSlots = parsed.maxSlots;
                }
                if (parsed.devices && typeof parsed.devices === 'object') {
                    this.registry = Object.values(parsed.devices).map((d) => ({
                        fingerprint: typeof d.fingerprint === 'string'
                            ? d.fingerprint
                            : (d.fingerprint ? JSON.stringify(d.fingerprint) : 'unknown'),
                        firstSeen: d.registeredAt || d.firstSeen || Date.now(),
                        lastSeen: d.lastSeen || Date.now(),
                    }));
                }
            }
            else if (Array.isArray(parsed)) {
                this.registry = parsed;
            }
            this.logger.log(`📋 已加载 ${this.registry.length} 个已注册设备，运行时名额: ${this.runtimeMaxSlots ?? '未设置'}`);
        }
        catch (e) {
            this.logger.warn(`⚠️ 注册表文件解析失败: ${e.message}`);
        }
    }
    get effectiveMax() {
        return this.runtimeMaxSlots ?? this.envMaxUsers;
    }
    saveRegistry() {
        try {
            (0, fs_1.writeFileSync)(this.REGISTRY_FILE, JSON.stringify(this.registry, null, 2), 'utf-8');
        }
        catch { }
    }
    createFingerprint(ip, ua) {
        return `${ip}|${ua}`;
    }
    reloadRuntimeSlots() {
        try {
            if ((0, fs_1.existsSync)(this.REGISTRY_FILE)) {
                const raw = (0, fs_1.readFileSync)(this.REGISTRY_FILE, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.maxSlots === 'number') {
                    this.runtimeMaxSlots = parsed.maxSlots;
                }
            }
        }
        catch { }
    }
    tryRegister(ip, ua) {
        this.reloadRuntimeSlots();
        const fingerprint = this.createFingerprint(ip, ua);
        const existing = this.registry.find(e => e.fingerprint === fingerprint);
        if (existing) {
            existing.lastSeen = Date.now();
            this.saveRegistry();
            return { allowed: true };
        }
        const limit = this.effectiveMax;
        if (this.registry.length >= limit) {
            return {
                allowed: false,
                message: `访问受限：最多允许 ${limit} 个不同设备访问，当前已满。请联系管理员扩容。`,
            };
        }
        this.registry.push({
            fingerprint,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
        });
        this.saveRegistry();
        this.logger.log(`📱 新设备注册 (${this.registry.length}/${limit}): ${ip}`);
        return { allowed: true };
    }
    get registeredCount() {
        return this.registry.length;
    }
    get maxAllowed() {
        return this.effectiveMax;
    }
};
exports.DeviceRegistryService = DeviceRegistryService;
exports.DeviceRegistryService = DeviceRegistryService = DeviceRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], DeviceRegistryService);
