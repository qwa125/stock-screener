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
const supabase_client_1 = require("../../storage/database/supabase-client");
let DeviceRegistryService = DeviceRegistryService_1 = class DeviceRegistryService {
    constructor() {
        this.logger = new common_1.Logger(DeviceRegistryService_1.name);
        this.supabase = (0, supabase_client_1.getSupabaseClient)();
        this.runtimeMaxSlots = null;
        this.registry = [];
        const envMax = parseInt(process.env.MAX_USERS || '', 10);
        this.envMaxUsers = !isNaN(envMax) && envMax > 0 ? envMax : 3;
        this.initializeRegistry();
        this.logger.log(`🔐 设备注册表初始化完成，环境变量 ${this.envMaxUsers}，运行时 ${this.runtimeMaxSlots ?? '未设置'}`);
    }
    async initializeRegistry() {
        try {
            const { data, error } = await this.supabase
                .from('access_devices')
                .select('*')
                .order('first_seen', { ascending: true });
            if (error)
                throw error;
            if (data && data.length > 0) {
                this.registry = data.map(row => ({
                    fingerprint: row.id,
                    ua: row.ua || '',
                    firstSeen: new Date(row.first_seen).getTime(),
                    lastSeen: new Date(row.last_seen).getTime(),
                    remark: row.remark || '',
                }));
            }
            this.logger.log(`📋 已从数据库加载 ${this.registry.length} 个已注册设备`);
        }
        catch (e) {
            this.logger.warn(`⚠️ 从数据库加载注册表失败，将使用空注册表: ${e.message}`);
        }
    }
    get effectiveMax() {
        return this.runtimeMaxSlots ?? this.envMaxUsers;
    }
    async syncToSupabase() {
        try {
            const { error: delErr } = await this.supabase
                .from('access_devices')
                .delete()
                .neq('id', '__never__');
            if (delErr)
                throw delErr;
            if (this.registry.length === 0)
                return;
            const rows = this.registry.map(d => ({
                id: d.fingerprint,
                ua: d.ua || null,
                display_name: d.remark || null,
                first_seen: new Date(d.firstSeen).toISOString(),
                last_seen: new Date(d.lastSeen).toISOString(),
                remark: d.remark || null,
            }));
            const { error: insErr } = await this.supabase
                .from('access_devices')
                .insert(rows);
            if (insErr)
                throw insErr;
        }
        catch (e) {
            this.logger.warn(`⚠️ 同步注册表到数据库失败: ${e.message}`);
        }
    }
    async upsertDevice(device) {
        try {
            const { error } = await this.supabase
                .from('access_devices')
                .upsert({
                id: device.fingerprint,
                ua: device.ua || null,
                display_name: device.remark || null,
                first_seen: new Date(device.firstSeen).toISOString(),
                last_seen: new Date(device.lastSeen).toISOString(),
                remark: device.remark || null,
            });
            if (error)
                throw error;
        }
        catch (e) {
            this.logger.warn(`⚠️ 写入设备到数据库失败: ${e.message}`);
            await this.syncToSupabase();
        }
    }
    async deleteDeviceFromDB(fingerprint) {
        try {
            const { error } = await this.supabase
                .from('access_devices')
                .delete()
                .eq('id', fingerprint);
            if (error)
                throw error;
        }
        catch (e) {
            this.logger.warn(`⚠️ 从数据库删除设备失败: ${e.message}`);
        }
    }
    async touchDevice(deviceId, ua) {
        const existing = this.registry.find(e => e.fingerprint === deviceId);
        if (existing) {
            existing.lastSeen = Date.now();
            await this.upsertDevice(existing);
            return { allowed: true };
        }
        const limit = this.effectiveMax;
        if (this.registry.length >= limit) {
            return {
                allowed: false,
                message: `访问受限：最多允许 ${limit} 个不同设备访问，当前已满。请联系管理员扩容。`,
            };
        }
        const entry = {
            fingerprint: deviceId,
            ua,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
        };
        this.registry.push(entry);
        await this.upsertDevice(entry);
        this.logger.log(`📱 新设备注册 (${this.registry.length}/${limit}): ID=${deviceId.slice(0, 12)}… UA=${ua.substring(0, 40)}`);
        return { allowed: true };
    }
    async tryRegister(ip, ua) {
        const fingerprint = this.createFingerprint(ip, ua);
        const existing = this.registry.find(e => e.fingerprint === fingerprint);
        if (existing) {
            existing.lastSeen = Date.now();
            await this.upsertDevice(existing);
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
            ua,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
        });
        this.logger.log(`📱 新设备注册 (${this.registry.length}/${limit}): IP=${ip}, UA=${ua.substring(0, 40)}`);
        return { allowed: true };
    }
    createFingerprint(_ip, ua) {
        return `${ua}`;
    }
    get registeredCount() {
        return this.registry.length;
    }
    get maxAllowed() {
        return this.effectiveMax;
    }
    async setMaxSlots(value) {
        this.runtimeMaxSlots = Math.max(1, Math.min(100, Math.round(value)));
        try {
            await this.supabase
                .from('access_devices')
                .upsert({
                id: '__config__',
                ua: null,
                display_name: `maxSlots=${this.runtimeMaxSlots}`,
                first_seen: new Date().toISOString(),
                last_seen: new Date().toISOString(),
                remark: `maxSlots=${this.runtimeMaxSlots}`,
            });
        }
        catch { }
        this.logger.log(`🔐 运行时设备限额已更新为 ${this.runtimeMaxSlots}`);
    }
    extractDisplayName(ua) {
        if (!ua)
            return '未知设备';
        let name = '未识别';
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
            if (m) {
                name = m[1].trim().replace(/\s*Build\/.*/i, '').trim();
            }
            else {
                const v = ua.match(/Android\s+[\d.]+/);
                name = v ? v[0] : 'Android';
            }
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
        if (/MicroMessenger/i.test(ua))
            name += ' · 微信';
        else if (/MQQBrowser/i.test(ua))
            name += ' · QQ浏览器';
        else if (/UCBrowser/i.test(ua))
            name += ' · UC';
        else if (/Edg\//.test(ua))
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
            displayName: this.extractDisplayName(d.ua),
            remark: d.remark || '',
            firstSeen: d.firstSeen,
            lastSeen: d.lastSeen,
        }));
    }
    async updateRemark(index, remark) {
        if (index < 0 || index >= this.registry.length)
            return false;
        this.registry[index].remark = remark.trim();
        await this.upsertDevice(this.registry[index]);
        this.logger.log(`✏️ 设备 #${index} 备注已更新: "${remark.trim()}"`);
        return true;
    }
    async removeDevice(index) {
        if (index < 0 || index >= this.registry.length)
            return false;
        const removed = this.registry.splice(index, 1)[0];
        await this.deleteDeviceFromDB(removed.fingerprint);
        this.logger.log(`🗑️ 已删除设备 #${index}: ${removed.fingerprint}, 剩余 ${this.registry.length} 个`);
        return true;
    }
    async clearDevices() {
        const count = this.registry.length;
        this.registry = [];
        try {
            const { error } = await this.supabase
                .from('access_devices')
                .delete()
                .neq('id', '__never__');
            if (error)
                throw error;
        }
        catch (e) {
            this.logger.warn(`⚠️ 清空数据库设备失败: ${e.message}`);
        }
        this.logger.log(`🧹 已清空全部 ${count} 个已注册设备`);
    }
};
exports.DeviceRegistryService = DeviceRegistryService;
exports.DeviceRegistryService = DeviceRegistryService = DeviceRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], DeviceRegistryService);
