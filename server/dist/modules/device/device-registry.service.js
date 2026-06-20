"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DeviceRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceRegistryService = void 0;
const common_1 = require("@nestjs/common");
const supabase_client_1 = require("../../storage/database/supabase-client");
let DeviceRegistryService = DeviceRegistryService_1 = class DeviceRegistryService {
    constructor() {
        this.logger = new common_1.Logger(DeviceRegistryService_1.name);
        this.registry = [];
        this.maxSlots = 3;
        this.registryLoaded = false;
        this.supabase = this.initSupabase();
    }
    initSupabase() {
        try {
            const client = (0, supabase_client_1.getSupabaseClient)();
            if (client)
                return client;
        }
        catch {
            this.logger.warn('Supabase未配置，使用内存模式（重启后设备列表会清空）');
        }
        return null;
    }
    async ensureLoaded() {
        if (this.registryLoaded)
            return;
        await this.loadRegistry();
        this.registryLoaded = true;
    }
    async loadRegistry() {
        if (!this.supabase)
            return;
        try {
            const { data, error } = await this.supabase
                .from('access_devices')
                .select('*')
                .order('first_seen', { ascending: true });
            if (error)
                throw error;
            if (data) {
                this.registry = data.map((r) => ({
                    fingerprint: r.id,
                    ua: r.ua || '',
                    displayName: r.display_name || '',
                    firstSeen: new Date(r.first_seen).getTime(),
                    lastSeen: new Date(r.last_seen).getTime(),
                }));
                this.logger.log(`从Supabase加载了 ${this.registry.length} 个设备`);
            }
        }
        catch (e) {
            this.logger.warn(`Supabase加载失败，使用内存模式: ${e.message}`);
            this.supabase = null;
        }
    }
    async touchDevice(deviceId, ua) {
        await this.ensureLoaded();
        const now = new Date().toISOString();
        const displayName = ua.includes('iPhone') ? 'iPhone · Safari 📱'
            : ua.includes('MicroMessenger') ? '微信浏览器 💬'
                : ua.includes('Chrome') ? 'Chrome 🌐'
                    : ua.includes('Firefox') ? 'Firefox 🦊'
                        : ua.includes('Safari') && !ua.includes('Chrome') ? 'Safari 🧭'
                            : '未识别';
        const limit = this.getEffectiveMax();
        const existing = this.registry.find(e => e.fingerprint === deviceId);
        if (existing) {
            existing.lastSeen = Date.now();
            if (this.supabase) {
                await this.supabase
                    .from('access_devices')
                    .update({ last_seen: now, ua, display_name: displayName })
                    .eq('id', deviceId);
            }
            return { allowed: true };
        }
        if (this.registry.length >= limit) {
            return { allowed: false, message: `最多允许 ${limit} 个不同设备访问` };
        }
        this.registry.push({ fingerprint: deviceId, ua, displayName, firstSeen: Date.now(), lastSeen: Date.now() });
        this.logger.log(`📱 新设备注册: ${deviceId.slice(0, 20)} (${this.registry.length}/${limit})`);
        if (this.supabase) {
            const { error } = await this.supabase
                .from('access_devices')
                .insert({ id: deviceId, ua, display_name: displayName });
            if (error)
                this.logger.warn(`Supabase插入失败: ${error.message}`);
        }
        return { allowed: true };
    }
    async tryRegister(ip, ua) {
        await this.ensureLoaded();
        const fingerprint = `${ip}|${ua}`;
        const existing = this.registry.find(e => e.fingerprint === fingerprint);
        if (existing) {
            existing.lastSeen = Date.now();
            return { allowed: true };
        }
        const limit = this.getEffectiveMax();
        if (this.registry.length >= limit) {
            return { allowed: false, message: `最多允许 ${limit} 个不同设备访问` };
        }
        this.registry.push({ fingerprint, ua, displayName: '未识别', firstSeen: Date.now(), lastSeen: Date.now() });
        this.logger.log(`📱 新设备注册: ${fingerprint.slice(0, 30)} (${this.registry.length}/${limit})`);
        return { allowed: true };
    }
    async getDevices() {
        await this.ensureLoaded();
        return [...this.registry];
    }
    get registeredCount() {
        return this.registry.length;
    }
    get maxAllowed() {
        return this.maxSlots;
    }
    async setMaxSlots(value) {
        this.maxSlots = value;
        return { success: true, maxSlots: value };
    }
    async removeDevice(index) {
        await this.ensureLoaded();
        if (index < 0 || index >= this.registry.length) {
            throw new Error(`设备索引 ${index} 不存在`);
        }
        const device = this.registry[index];
        this.registry.splice(index, 1);
        if (this.supabase) {
            await this.supabase.from('access_devices').delete().eq('id', device.fingerprint);
        }
        return { success: true };
    }
    async removeAllDevices() {
        await this.ensureLoaded();
        this.registry = [];
        if (this.supabase) {
            await this.supabase.from('access_devices').delete().neq('id', '0');
        }
        return { success: true };
    }
    async updateRemark(index, remark) {
        await this.ensureLoaded();
        if (index < 0 || index >= this.registry.length) {
            throw new Error(`设备索引 ${index} 不存在`);
        }
        this.registry[index].displayName = remark;
        if (this.supabase) {
            await this.supabase
                .from('access_devices')
                .update({ display_name: remark })
                .eq('id', this.registry[index].fingerprint);
        }
        return { success: true };
    }
    getEffectiveMax() {
        return this.maxSlots;
    }
};
exports.DeviceRegistryService = DeviceRegistryService;
exports.DeviceRegistryService = DeviceRegistryService = DeviceRegistryService_1 = __decorate([
    (0, common_1.Injectable)()
], DeviceRegistryService);
