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
const fs = require("fs");
const path = require("path");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin2025';
const postgres = require('postgres');
let DeviceRegistryService = DeviceRegistryService_1 = class DeviceRegistryService {
    constructor() {
        this.logger = new common_1.Logger(DeviceRegistryService_1.name);
        this.registry = [];
        this.maxSlots = parseInt(process.env.MAX_SLOTS || process.env.DEFAULT_MAX_SLOTS || '100', 10);
        this.registryLoaded = false;
        this.pgSql = null;
        this.filePath = path.resolve(process.cwd(), '.device_registry.json');
        this.settingsPath = '/tmp/device-settings.json';
    }
    async onModuleInit() {
        this.logger.log('⚙️ DeviceRegistryService 启动中...');
        await this.initPostgres();
        if (this.pgSql) {
            await this.createPGTables();
        }
        await this.loadSettingsFromDB();
        if (this.pgSql) {
            await this.loadRegistryFromPG();
        }
        else {
            this.loadFromFile();
        }
        this.registryLoaded = true;
        this.logger.log(`⚙️ 设备限额: ${this.maxSlots}, 已注册设备: ${this.registry.length}${this.pgSql ? ' (PostgreSQL)' : ' (文件)'}`);
    }
    async initPostgres() {
        try {
            const url = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
            if (!url) {
                this.logger.warn('DATABASE_URL 未设置，跳过 PostgreSQL');
                return null;
            }
            if (!/^postgres(ql)?:\/\//.test(url)) {
                this.logger.warn(`DATABASE_URL 格式无效，跳过 PostgreSQL: ${url.slice(0, 20)}...`);
                return null;
            }
            this.pgSql = postgres(url, { max: 2, idle_timeout: 10, connect_timeout: 10, ssl: { rejectUnauthorized: false } });
            await this.pgSql `SELECT 1`;
            this.logger.log('✅ DeviceRegistry 连接 PostgreSQL 成功');
            return this.pgSql;
        }
        catch (e) {
            this.logger.warn(`DeviceRegistry PostgreSQL 连接失败: ${e.message}`);
            this.pgSql = null;
            return null;
        }
    }
    async createPGTables() {
        const sql = this.pgSql;
        if (!sql)
            return false;
        try {
            await sql `
        CREATE TABLE IF NOT EXISTS public.device_access_devices (
          id TEXT PRIMARY KEY,
          ua TEXT NOT NULL DEFAULT '',
          display_name TEXT NOT NULL DEFAULT '',
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
            await sql `
        CREATE TABLE IF NOT EXISTS public.device_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT ''
        )
      `;
            await sql `
        INSERT INTO public.device_settings (key, value) VALUES ('max_slots', '100')
        ON CONFLICT (key) DO NOTHING
      `;
            this.logger.log('✅ PostgreSQL 设备表创建/确认成功');
            return true;
        }
        catch (e) {
            this.logger.warn(`PostgreSQL 创建表失败: ${e.message}`);
            return false;
        }
    }
    saveToFile() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.registry, null, 2), 'utf-8');
        }
        catch (e) {
        }
    }
    loadFromFile() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data) && data.length > 0) {
                    this.registry = data;
                    this.logger.log(`从文件加载了 ${this.registry.length} 个设备`);
                }
            }
        }
        catch (e) {
            this.logger.warn(`文件加载设备失败: ${e.message}`);
        }
    }
    async loadSettingsFromDB() {
        let loaded = false;
        if (this.pgSql) {
            try {
                const rows = await this.pgSql `
          SELECT value FROM public.device_settings WHERE key = 'max_slots' LIMIT 1
        `;
                if (rows && rows.length > 0) {
                    const val = parseInt(rows[0].value, 10);
                    if (val > 0) {
                        this.maxSlots = val;
                        this.logger.log(`⚙️ 从 PostgreSQL 加载: 设备限额 ${this.maxSlots}`);
                        loaded = true;
                    }
                }
            }
            catch (e) {
                this.logger.warn(`PostgreSQL 加载设置失败: ${e.message}`);
            }
        }
        if (!loaded) {
            const tmpSettingsPath = '/tmp/device_registry_settings.json';
            const projectSettingsPath = path.resolve(process.cwd(), '.device_registry.settings.json');
            for (const fp of [tmpSettingsPath, projectSettingsPath, this.settingsPath]) {
                try {
                    if (fs.existsSync(fp)) {
                        const raw = fs.readFileSync(fp, 'utf-8');
                        const data = JSON.parse(raw);
                        if (typeof data.maxSlots === 'number' && data.maxSlots > 0) {
                            this.maxSlots = data.maxSlots;
                            this.logger.log(`⚙️ 从文件加载(兜底): 设备限额 ${this.maxSlots} (${fp})`);
                            loaded = true;
                            break;
                        }
                    }
                }
                catch (e) {
                    this.logger.warn(`设置文件加载失败 (${fp}): ${e.message}`);
                }
            }
        }
        if (!loaded) {
            const envVal = process.env.DEFAULT_MAX_SLOTS || process.env.MAX_SLOTS;
            if (envVal) {
                const parsed = parseInt(envVal, 10);
                if (parsed > 0) {
                    this.maxSlots = parsed;
                    this.logger.log(`⚙️ 从环境变量加载: 设备限额 ${this.maxSlots}`);
                    loaded = true;
                }
            }
        }
        if (!loaded) {
            const repoDefaultsPath = path.resolve(process.cwd(), 'default-settings.json');
            try {
                if (fs.existsSync(repoDefaultsPath)) {
                    const raw = fs.readFileSync(repoDefaultsPath, 'utf-8');
                    const data = JSON.parse(raw);
                    if (typeof data.maxSlots === 'number' && data.maxSlots > 0) {
                        this.maxSlots = data.maxSlots;
                        this.logger.log(`⚙️ 从仓库默认设置文件加载: 设备限额 ${this.maxSlots}`);
                        loaded = true;
                    }
                }
            }
            catch (e) {
                this.logger.warn(`仓库默认设置文件加载失败: ${e.message}`);
            }
        }
        if (!loaded) {
            this.logger.log(`⚙️ 未找到已持久化的设备限额，使用默认值: ${this.maxSlots}`);
        }
    }
    async saveSettingsToDB() {
        if (this.pgSql) {
            try {
                await this.pgSql `
          INSERT INTO public.device_settings (key, value) 
          VALUES ('max_slots', ${String(this.maxSlots)})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `;
                this.logger.log(`⚙️ 设备限额已持久化到 PostgreSQL: ${this.maxSlots}`);
            }
            catch (e) {
                this.logger.warn(`PostgreSQL 写入设置异常: ${e.message}`);
            }
        }
        const tmpSettingsPath = '/tmp/device_registry_settings.json';
        const projectSettingsPath = path.resolve(process.cwd(), '.device_registry.settings.json');
        try {
            fs.writeFileSync(tmpSettingsPath, JSON.stringify({ maxSlots: this.maxSlots }), 'utf-8');
            fs.writeFileSync(projectSettingsPath, JSON.stringify({ maxSlots: this.maxSlots }), 'utf-8');
        }
        catch (e) {
            this.logger.warn(`设置文件写入失败: ${e.message}`);
        }
    }
    async ensureLoaded() {
        if (this.registryLoaded)
            return;
        await this.loadSettingsFromDB();
        if (this.pgSql) {
            await this.loadRegistryFromPG();
        }
        else {
            this.loadFromFile();
        }
        this.registryLoaded = true;
    }
    async loadRegistryFromPG() {
        if (!this.pgSql)
            return;
        try {
            const rows = await this.pgSql `
        SELECT * FROM public.device_access_devices ORDER BY first_seen ASC
      `;
            if (rows && rows.length > 0) {
                this.registry = rows.map((r) => ({
                    fingerprint: r.id,
                    ua: r.ua || '',
                    displayName: r.display_name || '',
                    firstSeen: new Date(r.first_seen).getTime(),
                    lastSeen: new Date(r.last_seen).getTime(),
                }));
                this.logger.log(`从 PostgreSQL 加载了 ${this.registry.length} 个设备`);
            }
        }
        catch (e) {
            this.logger.warn(`PostgreSQL 加载设备失败: ${e.message}`);
        }
    }
    async touchDevice(deviceId, ua, isAdmin = false) {
        await this.ensureLoaded();
        const now = new Date().toISOString();
        const displayName = isAdmin ? '👑 管理员'
            : ua.includes('iPhone') ? 'iPhone · Safari 📱'
                : ua.includes('MicroMessenger') ? '微信浏览器 💬'
                    : ua.includes('Chrome') ? 'Chrome 🌐'
                        : ua.includes('Safari') && !ua.includes('Chrome') ? 'Safari 🧭'
                            : '未识别';
        const limit = this.getEffectiveMax();
        const existing = this.registry.find(e => e.fingerprint === deviceId);
        if (existing) {
            existing.lastSeen = Date.now();
            if (existing.isAdmin)
                return { allowed: true };
            const nonAdminDevices = this.registry.filter(d => !d.isAdmin).sort((a, b) => a.firstSeen - b.firstSeen);
            const rank = nonAdminDevices.findIndex(e => e.fingerprint === deviceId);
            if (rank >= limit) {
                return { allowed: false, message: `设备限额 ${limit} 台，请先移除不常用设备` };
            }
            if (this.pgSql) {
                await this.pgSql `
          UPDATE public.device_access_devices SET last_seen = ${now}, ua = ${ua} WHERE id = ${deviceId}
        `.catch(() => { });
            }
            return { allowed: true };
        }
        if (isAdmin) {
            this.registry.push({ fingerprint: deviceId, ua, displayName, firstSeen: Date.now(), lastSeen: Date.now(), isAdmin: true });
            this.logger.log(`👑 管理员设备注册: ${deviceId.slice(0, 20)} (不计入名额)`);
            if (this.pgSql) {
                await this.pgSql `
          INSERT INTO public.device_access_devices (id, ua, display_name, first_seen, last_seen) 
          VALUES (${deviceId}, ${ua}, ${displayName + '(管理员)'}, ${now}, ${now})
          ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen
        `.catch(() => { });
            }
            this.saveToFile();
            return { allowed: true };
        }
        const nonAdminCount = this.registry.filter(d => !d.isAdmin).length;
        if (nonAdminCount >= limit) {
            return { allowed: false, message: `最多允许 ${limit} 个不同设备访问` };
        }
        this.registry.push({ fingerprint: deviceId, ua, displayName, firstSeen: Date.now(), lastSeen: Date.now() });
        this.logger.log(`📱 新设备注册: ${deviceId.slice(0, 20)} (${this.registry.length}/${limit})`);
        if (this.pgSql) {
            await this.pgSql `
        INSERT INTO public.device_access_devices (id, ua, display_name, first_seen, last_seen) 
        VALUES (${deviceId}, ${ua}, ${displayName}, ${now}, ${now})
        ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen, ua = EXCLUDED.ua
      `.catch(() => { });
        }
        this.saveToFile();
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
        if (this.pgSql) {
            await this.pgSql `
        INSERT INTO public.device_access_devices (id, ua, display_name, first_seen, last_seen) 
        VALUES (${fingerprint}, ${ua}, '未识别', ${new Date().toISOString()}, ${new Date().toISOString()})
        ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen
      `.catch(() => { });
        }
        this.saveToFile();
        return { allowed: true };
    }
    async getDevices() {
        await this.ensureLoaded();
        return [...this.registry];
    }
    async registeredCount() {
        await this.ensureLoaded();
        return this.registry.length;
    }
    get maxAllowed() {
        return this.maxSlots;
    }
    async getEffectiveMaxSlots() {
        await this.ensureLoaded();
        return this.maxSlots;
    }
    async setMaxSlots(value) {
        this.maxSlots = value;
        await this.saveSettingsToDB();
        this.logger.log(`⚙️ 设备限额已改为: ${value}`);
        return { success: true, maxSlots: value };
    }
    async removeDevice(index) {
        await this.ensureLoaded();
        if (index < 0 || index >= this.registry.length) {
            throw new Error(`设备索引 ${index} 不存在`);
        }
        const device = this.registry[index];
        this.registry.splice(index, 1);
        if (this.pgSql) {
            await this.pgSql `DELETE FROM public.device_access_devices WHERE id = ${device.fingerprint}`.catch(() => { });
        }
        this.saveToFile();
        return { success: true };
    }
    async removeAllDevices() {
        await this.ensureLoaded();
        this.registry = [];
        if (this.pgSql) {
            await this.pgSql `DELETE FROM public.device_access_devices`.catch(() => { });
        }
        this.saveToFile();
        return { success: true };
    }
    async updateRemark(index, remark) {
        await this.ensureLoaded();
        if (index < 0 || index >= this.registry.length) {
            this.logger.warn(`❌ 改名失败：设备索引 ${index} 不存在，当前共 ${this.registry.length} 台`);
            throw new Error(`设备索引 ${index} 不存在`);
        }
        const device = this.registry[index];
        const oldName = device.displayName;
        device.displayName = remark;
        if (this.pgSql) {
            try {
                await this.pgSql `
          UPDATE public.device_access_devices SET display_name = ${remark} WHERE id = ${device.fingerprint}
        `;
                this.logger.log(`✅ PostgreSQL 改名成功: ${oldName} → ${remark} (${device.fingerprint})`);
            }
            catch (e) {
                this.logger.error(`❌ PostgreSQL 改名失败: ${e.message}`);
            }
        }
        else {
            this.logger.warn(`⚠️ 数据库不可用，仅内存中改名: ${oldName} → ${remark}`);
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
