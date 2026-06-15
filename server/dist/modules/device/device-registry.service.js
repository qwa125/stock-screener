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
        this.envMaxUsers = !isNaN(envMax) && envMax > 0 ? envMax : 10;
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
    createFingerprint(_ip, ua) {
        const androidMatch = ua.match(/Android\s+\d+[.\d]*\s*;\s*([^;)]+)/i);
        if (androidMatch)
            return `ANDROID-${androidMatch[1].trim()}`;
        const iphoneMatch = ua.match(/iPhone\s*\d+[,\d]*/i);
        if (iphoneMatch)
            return `IPHONE-${iphoneMatch[0]}`;
        const ipadMatch = ua.match(/iPad\s*\d+[,\d]*/i);
        if (ipadMatch)
            return `IPAD-${ipadMatch[0]}`;
        return ua.substring(0, 80);
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
        this.logger.log(`📱 新设备注册 (${this.registry.length}/${limit}): ${ua.substring(0, 40)}`);
        return { allowed: true };
    }
    get registeredCount() {
        return this.registry.length;
    }
    get maxAllowed() {
        return this.effectiveMax;
    }
    setMaxSlots(value) {
        this.runtimeMaxSlots = Math.max(1, Math.min(100, Math.round(value)));
        try {
            const raw = (0, fs_1.existsSync)(this.REGISTRY_FILE) ? (0, fs_1.readFileSync)(this.REGISTRY_FILE, 'utf-8') : '{}';
            const data = JSON.parse(raw);
            const obj = typeof data === 'object' && !Array.isArray(data) ? data : { devices: {} };
            obj.maxSlots = this.runtimeMaxSlots;
            (0, fs_1.writeFileSync)(this.REGISTRY_FILE, JSON.stringify(obj, null, 2), 'utf-8');
        }
        catch { }
        this.logger.log(`🔐 运行时设备限额已更新为 ${this.runtimeMaxSlots}`);
    }
    extractDisplayName(ua) {
        if (ua.startsWith('ANDROID-'))
            return `${ua.replace('ANDROID-', '')} 📱`;
        if (ua.startsWith('IPHONE-'))
            return `${ua.replace('IPHONE-', '')} 📱`;
        if (ua.startsWith('IPAD-'))
            return `${ua.replace('IPAD-', '')} 📱`;
        let name = '未知设备';
        const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
        if (/iPhone/.test(ua)) {
            const m = ua.match(/iPhone\s*\d+[,\d]*/i);
            name = m ? m[0] : 'iPhone';
        }
        else if (/iPad/.test(ua)) {
            const m = ua.match(/iPad\s*\d+[,\d]*/i);
            name = m ? m[0] : 'iPad';
        }
        else if (/Android/.test(ua)) {
            const m = ua.match(/Android\s+\d+[.\d]*\s*;\s*([^;)]+)/i);
            name = m ? m[1].trim() : 'Android';
        }
        else if (/Windows/.test(ua)) {
            const m = ua.match(/Windows NT [\d.]+/);
            name = m ? m[0] : 'Windows';
        }
        else if (/Mac OS X/.test(ua)) {
            name = 'macOS';
        }
        else if (/Linux/.test(ua))
            name = 'Linux';
        if (/Edg\//.test(ua))
            name += ' · Edge';
        else if (/Chrome\//.test(ua) && !/Edg\//.test(ua))
            name += ' · Chrome';
        else if (/Firefox\//.test(ua))
            name += ' · Firefox';
        else if (/Safari\//.test(ua) && !/Chrome\//.test(ua))
            name += ' · Safari';
        if (isMobile)
            name += ' 📱';
        return name;
    }
    getDevices() {
        return this.registry.map((d, i) => ({
            index: i,
            fingerprint: d.fingerprint,
            displayName: this.extractDisplayName(d.fingerprint),
            remark: d.remark || '',
            firstSeen: d.firstSeen,
            lastSeen: d.lastSeen,
        }));
    }
    updateRemark(index, remark) {
        if (index < 0 || index >= this.registry.length)
            return false;
        this.registry[index].remark = remark.trim();
        this.saveRegistry();
        this.logger.log(`✏️ 设备 #${index} 备注已更新: "${remark.trim()}"`);
        return true;
    }
    removeDevice(index) {
        if (index < 0 || index >= this.registry.length)
            return false;
        const removed = this.registry.splice(index, 1)[0];
        this.saveRegistry();
        this.logger.log(`🗑️ 已删除设备 #${index}: ${removed.fingerprint}, 剩余 ${this.registry.length} 个`);
        return true;
    }
    clearDevices() {
        const count = this.registry.length;
        this.registry = [];
        this.saveRegistry();
        this.logger.log(`🧹 已清空全部 ${count} 个已注册设备`);
    }
};
exports.DeviceRegistryService = DeviceRegistryService;
exports.DeviceRegistryService = DeviceRegistryService = DeviceRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], DeviceRegistryService);
