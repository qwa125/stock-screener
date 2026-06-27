import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import type { DeviceRegistryEntry } from './device-registry.types'

/** 内置管理员令牌（优先取环境变量） */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin2025'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = require('postgres')

@Injectable()
export class DeviceRegistryService implements OnModuleInit {
  private readonly logger = new Logger(DeviceRegistryService.name)
  private registry: DeviceRegistryEntry[] = []
  private maxSlots = parseInt(process.env.MAX_SLOTS || '100', 10)
  private registryLoaded = false
  private pgSql: any = null
  private readonly filePath = path.resolve(process.cwd(), '.device_registry.json')
  private readonly settingsPath = '/tmp/device-settings.json'

  async onModuleInit() {
    this.logger.log('⚙️ DeviceRegistryService 启动中...')
    // 尝试连接 PostgreSQL
    await this.initPostgres()
    if (this.pgSql) {
      await this.createPGTables()
    }
    // 读取已持久化的设置和列表
    await this.loadSettingsFromDB()
    if (this.pgSql) {
      await this.loadRegistryFromPG()
    } else {
      this.loadFromFile()
    }
    this.registryLoaded = true
    this.logger.log(`⚙️ 设备限额: ${this.maxSlots}, 已注册设备: ${this.registry.length}${this.pgSql ? ' (PostgreSQL)' : ' (文件)'}`)
  }

  private async initPostgres() {
    try {
      const url = process.env.DATABASE_URL || process.env.PGDATABASE_URL
      if (!url) {
        this.logger.warn('DATABASE_URL 未设置，跳过 PostgreSQL')
        return null
      }
      this.pgSql = postgres(url, { max: 2, idle_timeout: 10, connect_timeout: 10 })
      this.logger.log('✅ DeviceRegistry 连接 PostgreSQL 成功')
      return this.pgSql
    } catch (e) {
      this.logger.warn(`DeviceRegistry PostgreSQL 连接失败: ${(e as Error).message}`)
      this.pgSql = null
      return null
    }
  }

  /** 通过 PostgreSQL 创建设备表 */
  private async createPGTables() {
    const sql = this.pgSql
    if (!sql) return false
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS public.device_access_devices (
          id TEXT PRIMARY KEY,
          ua TEXT NOT NULL DEFAULT '',
          display_name TEXT NOT NULL DEFAULT '',
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS public.device_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT ''
        )
      `
      await sql`
        INSERT INTO public.device_settings (key, value) VALUES ('max_slots', '100')
        ON CONFLICT (key) DO NOTHING
      `
      this.logger.log('✅ PostgreSQL 设备表创建/确认成功')
      return true
    } catch (e) {
      this.logger.warn(`PostgreSQL 创建表失败: ${(e as Error).message}`)
      return false
    }
  }

  private saveToFile() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.registry, null, 2), 'utf-8')
    } catch (e) {
      // 文件写入失败不阻止主流程
    }
  }

  private loadFromFile() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const data = JSON.parse(raw)
        if (Array.isArray(data) && data.length > 0) {
          this.registry = data
          this.logger.log(`从文件加载了 ${this.registry.length} 个设备`)
        }
      }
    } catch (e) {
      this.logger.warn(`文件加载设备失败: ${(e as Error).message}`)
    }
  }

  /** 从 PostgreSQL 加载设置 */
  private async loadSettingsFromDB() {
    let loaded = false
    if (this.pgSql) {
      try {
        const rows = await this.pgSql`
          SELECT value FROM public.device_settings WHERE key = 'max_slots' LIMIT 1
        `
        if (rows && rows.length > 0) {
          const val = parseInt(rows[0].value, 10)
          if (val > 0) {
            this.maxSlots = val
            this.logger.log(`⚙️ 从 PostgreSQL 加载: 设备限额 ${this.maxSlots}`)
            loaded = true
          }
        }
      } catch (e) {
        this.logger.warn(`PostgreSQL 加载设置失败: ${(e as Error).message}`)
      }
    }
    // 兜底：读文件
    if (!loaded) {
      const projectSettingsPath = path.resolve(process.cwd(), '.device_registry.settings.json')
      for (const fp of [projectSettingsPath, this.settingsPath]) {
        try {
          if (fs.existsSync(fp)) {
            const raw = fs.readFileSync(fp, 'utf-8')
            const data = JSON.parse(raw)
            if (typeof data.maxSlots === 'number' && data.maxSlots > 0) {
              this.maxSlots = data.maxSlots
              this.logger.log(`⚙️ 从文件加载(兜底): 设备限额 ${this.maxSlots} (${fp})`)
              loaded = true
              break
            }
          }
        } catch (e) {
          this.logger.warn(`设置文件加载失败 (${fp}): ${(e as Error).message}`)
        }
      }
    }
    if (!loaded) {
      this.logger.log(`⚙️ 未找到已持久化的设备限额，使用默认值: ${this.maxSlots}`)
    }
  }

  private async saveSettingsToDB() {
    if (this.pgSql) {
      try {
        await this.pgSql`
          INSERT INTO public.device_settings (key, value) 
          VALUES ('max_slots', ${String(this.maxSlots)})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `
        this.logger.log(`⚙️ 设备限额已持久化到 PostgreSQL: ${this.maxSlots}`)
      } catch (e) {
        this.logger.warn(`PostgreSQL 写入设置异常: ${(e as Error).message}`)
      }
    }
    // 文件兜底
    const projectSettingsPath = path.resolve(process.cwd(), '.device_registry.settings.json')
    try {
      fs.writeFileSync(projectSettingsPath, JSON.stringify({ maxSlots: this.maxSlots }), 'utf-8')
    } catch (e) {
      this.logger.warn(`设置文件写入失败: ${(e as Error).message}`)
    }
  }

  private async ensureLoaded() {
    if (this.registryLoaded) return
    await this.loadSettingsFromDB()
    if (this.pgSql) {
      await this.loadRegistryFromPG()
    } else {
      this.loadFromFile()
    }
    this.registryLoaded = true
  }

  private async loadRegistryFromPG() {
    if (!this.pgSql) return
    try {
      const rows = await this.pgSql`
        SELECT * FROM public.device_access_devices ORDER BY first_seen ASC
      `
      if (rows && rows.length > 0) {
        this.registry = rows.map((r: any) => ({
          fingerprint: r.id,
          ua: r.ua || '',
          displayName: r.display_name || '',
          firstSeen: new Date(r.first_seen).getTime(),
          lastSeen: new Date(r.last_seen).getTime(),
        }))
        this.logger.log(`从 PostgreSQL 加载了 ${this.registry.length} 个设备`)
      }
    } catch (e) {
      this.logger.warn(`PostgreSQL 加载设备失败: ${(e as Error).message}`)
    }
  }

  async touchDevice(deviceId: string, ua: string, isAdmin = false): Promise<{ allowed: boolean; message?: string }> {
    await this.ensureLoaded()
    const now = new Date().toISOString()
    const displayName = isAdmin ? '👑 管理员'
      : ua.includes('iPhone') ? 'iPhone · Safari 📱'
      : ua.includes('MicroMessenger') ? '微信浏览器 💬'
      : ua.includes('Chrome') ? 'Chrome 🌐'
      : ua.includes('Safari') && !ua.includes('Chrome') ? 'Safari 🧭'
      : '未识别'
    const limit = this.getEffectiveMax()

    // 先检查是否已存在
    const existing = this.registry.find(e => e.fingerprint === deviceId)
    if (existing) {
      existing.lastSeen = Date.now()
      if (existing.isAdmin) return { allowed: true }
      // 按注册先后检查是否在限额内
      const sorted = [...this.registry].sort((a, b) => a.firstSeen - b.firstSeen)
      const rank = sorted.findIndex(e => e.fingerprint === deviceId)
      if (rank >= limit) {
        return { allowed: false, message: `设备限额 ${limit} 台，请先移除不常用设备` }
      }
      if (this.pgSql) {
        await this.pgSql`
          UPDATE public.device_access_devices SET last_seen = ${now}, ua = ${ua} WHERE id = ${deviceId}
        `.catch(() => {/* ignore */})
      }
      return { allowed: true }
    }

    // 新设备 → 管理员不占名额
    if (isAdmin) {
      this.registry.push({ fingerprint: deviceId, ua, displayName, firstSeen: Date.now(), lastSeen: Date.now(), isAdmin: true })
      this.logger.log(`👑 管理员设备注册: ${deviceId.slice(0, 20)} (不计入名额)`)
      if (this.pgSql) {
        await this.pgSql`
          INSERT INTO public.device_access_devices (id, ua, display_name, first_seen, last_seen) 
          VALUES (${deviceId}, ${ua}, ${displayName + '(管理员)'}, ${now}, ${now})
          ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen
        `.catch(() => {/* ignore */})
      }
      this.saveToFile()
      return { allowed: true }
    }

    // 新设备 → 检查限额
    if (this.registry.length >= limit) {
      return { allowed: false, message: `最多允许 ${limit} 个不同设备访问` }
    }

    this.registry.push({ fingerprint: deviceId, ua, displayName, firstSeen: Date.now(), lastSeen: Date.now() })
    this.logger.log(`📱 新设备注册: ${deviceId.slice(0, 20)} (${this.registry.length}/${limit})`)

    if (this.pgSql) {
      await this.pgSql`
        INSERT INTO public.device_access_devices (id, ua, display_name, first_seen, last_seen) 
        VALUES (${deviceId}, ${ua}, ${displayName}, ${now}, ${now})
        ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen, ua = EXCLUDED.ua
      `.catch(() => {/* ignore */})
    }
    this.saveToFile()

    return { allowed: true }
  }

  async tryRegister(ip: string, ua: string): Promise<{ allowed: boolean; message?: string }> {
    await this.ensureLoaded()
    const fingerprint = `${ip}|${ua}`
    const existing = this.registry.find(e => e.fingerprint === fingerprint)
    if (existing) {
      existing.lastSeen = Date.now()
      return { allowed: true }
    }
    const limit = this.getEffectiveMax()
    if (this.registry.length >= limit) {
      return { allowed: false, message: `最多允许 ${limit} 个不同设备访问` }
    }
    this.registry.push({ fingerprint, ua, displayName: '未识别', firstSeen: Date.now(), lastSeen: Date.now() })
    this.logger.log(`📱 新设备注册: ${fingerprint.slice(0, 30)} (${this.registry.length}/${limit})`)
    if (this.pgSql) {
      await this.pgSql`
        INSERT INTO public.device_access_devices (id, ua, display_name, first_seen, last_seen) 
        VALUES (${fingerprint}, ${ua}, '未识别', ${new Date().toISOString()}, ${new Date().toISOString()})
        ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen
      `.catch(() => {/* ignore */})
    }
    this.saveToFile()
    return { allowed: true }
  }

  async getDevices(): Promise<DeviceRegistryEntry[]> {
    await this.ensureLoaded()
    return [...this.registry]
  }

  async registeredCount(): Promise<number> {
    await this.ensureLoaded()
    return this.registry.length
  }

  get maxAllowed(): number {
    return this.maxSlots
  }

  async getEffectiveMaxSlots(): Promise<number> {
    await this.ensureLoaded()
    return this.maxSlots
  }

  async setMaxSlots(value: number) {
    this.maxSlots = value
    await this.saveSettingsToDB()
    this.logger.log(`⚙️ 设备限额已改为: ${value}`)
    return { success: true, maxSlots: value }
  }

  async removeDevice(index: number) {
    await this.ensureLoaded()
    if (index < 0 || index >= this.registry.length) {
      throw new Error(`设备索引 ${index} 不存在`)
    }
    const device = this.registry[index]
    this.registry.splice(index, 1)
    if (this.pgSql) {
      await this.pgSql`DELETE FROM public.device_access_devices WHERE id = ${device.fingerprint}`.catch(() => {/* ignore */})
    }
    this.saveToFile()
    return { success: true }
  }

  async removeAllDevices() {
    await this.ensureLoaded()
    this.registry = []
    if (this.pgSql) {
      await this.pgSql`DELETE FROM public.device_access_devices`.catch(() => {/* ignore */})
    }
    this.saveToFile()
    return { success: true }
  }

  async updateRemark(index: number, remark: string) {
    await this.ensureLoaded()
    if (index < 0 || index >= this.registry.length) {
      this.logger.warn(`❌ 改名失败：设备索引 ${index} 不存在，当前共 ${this.registry.length} 台`)
      throw new Error(`设备索引 ${index} 不存在`)
    }
    const device = this.registry[index]
    const oldName = device.displayName
    device.displayName = remark

    if (this.pgSql) {
      try {
        await this.pgSql`
          UPDATE public.device_access_devices SET display_name = ${remark} WHERE id = ${device.fingerprint}
        `
        this.logger.log(`✅ PostgreSQL 改名成功: ${oldName} → ${remark} (${device.fingerprint})`)
      } catch (e: any) {
        this.logger.error(`❌ PostgreSQL 改名失败: ${e.message}`)
      }
    } else {
      this.logger.warn(`⚠️ 数据库不可用，仅内存中改名: ${oldName} → ${remark}`)
    }
    return { success: true }
  }

  private getEffectiveMax(): number {
    return this.maxSlots
  }
}