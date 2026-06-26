import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { getSupabaseClient, getSupabaseServiceRoleKey } from '@/storage/database/supabase-client'
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
  private maxSlots = parseInt(process.env.MAX_SLOTS || '3', 10)
  private registryLoaded = false
  private supabase = this.initSupabase()
  private pgSql: any = null
  private readonly filePath = path.resolve(process.cwd(), '.device_registry.json')
  private readonly settingsPath = '/tmp/device-settings.json'

  async onModuleInit() {
    this.logger.log('⚙️ DeviceRegistryService 启动中...')
    // 尝试连接 PostgreSQL
    this.initPostgres()
    if (this.pgSql) {
      await this.createPGTables()
    }
    // 先读取已持久化的设置（PostgreSQL > Supabase > 文件）
    await this.loadSettingsFromDB()
    // 加载设备列表
    await this.loadRegistry()
    if (!this.supabase && !this.pgSql) {
      this.loadFromFile()
    }
    this.registryLoaded = true
    this.logger.log(`⚙️ 设备限额: ${this.maxSlots}, 已注册设备: ${this.registry.length}${this.pgSql ? ' (PostgreSQL)' : this.supabase ? ' (Supabase)' : ' (文件)'}`)
  }

  private initSupabase() {
    try {
      const client = getSupabaseClient()
      if (client) return client
    } catch {
      this.logger.warn('Supabase未配置，使用JSON文件持久化设备列表')
    }
    return null
  }

  private initPostgres() {
    if (this.pgSql) return this.pgSql
    try {
      const url = process.env.DATABASE_URL
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

  /** 创建表（只在首次部署时需要）。使用 Supabase SQL 端点（HTTPS），避免 pg.Client 直连 */
  private async createTablesIfNeeded() {
    const serviceKey = getSupabaseServiceRoleKey()
    if (!serviceKey) {
      this.logger.warn('缺少 SERVICE_ROLE_KEY，无法自动创建表')
      return false
    }
    const supabaseUrl = process.env.COZE_SUPABASE_URL || process.env.SUPABASE_URL || ''
    if (!supabaseUrl) return false
    // 从 Supabase URL 提取项目 ref
    const hostname = new URL(supabaseUrl).hostname
    const parts = hostname.split('.')
    const ref = parts.length >= 4 ? parts[1] : parts[0]

    const sql = `
      CREATE TABLE IF NOT EXISTS public.access_devices (
        id TEXT PRIMARY KEY,
        ua TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_access_devices_first_seen ON public.access_devices (first_seen);
      CREATE TABLE IF NOT EXISTS public.device_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );
      ALTER TABLE public.device_settings DISABLE ROW LEVEL SECURITY;
      INSERT INTO public.device_settings (key, value) VALUES ('max_slots', '3')
        ON CONFLICT (key) DO NOTHING;
    `
    try {
      // Supabase Management API SQL 端点 (HTTPS, 无需 pg.Client)
      const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: sql }),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        this.logger.warn(`Management API 执行SQL失败: ${resp.status} ${errText}`)
        // 兜底: 直接尝试读表来预热 schema 缓存
        await this.warmUpSchema()
        return false
      }
      this.logger.log('通过 Supabase Management API 创建/确认数据表成功')
      // 等待 schema 缓存刷新
      await new Promise(r => setTimeout(r, 3000))
      return true
    } catch (e) {
      this.logger.warn(`自动创建表失败: ${(e as Error).message}`)
      // 兜底: 主动预热 schema 缓存
      await this.warmUpSchema()
      return false
    }
  }

  /** 通过 PostgreSQL 创建设备表（Render PG 持久化） */
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
        INSERT INTO public.device_settings (key, value) VALUES ('max_slots', '3')
        ON CONFLICT (key) DO NOTHING
      `
      this.logger.log('✅ PostgreSQL 设备表创建/确认成功')
      return true
    } catch (e) {
      this.logger.warn(`PostgreSQL 创建表失败: ${(e as Error).message}`)
      return false
    }
  }

  /** 主动预热 PostgREST schema 缓存（避免启动时 3 次重试） */
  private async warmUpSchema() {
    if (!this.supabase) return
    try {
      // 并发查询所有可能用到的表，触发 PostgREST 加载 schema
      await Promise.all([
        this.supabase.from('access_devices').select('id').limit(1),
        this.supabase.from('device_settings').select('key').limit(1),
      ])
      this.logger.log('PostgREST schema 缓存预热完成')
    } catch {
      // 预热失败也无所谓，后续查询会自动重试
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

  /** 从数据库加载设置，优先 PostgreSQL，其次 Supabase */
  private async loadSettingsFromDB() {
    let loaded = false
    // ① 优先从 PostgreSQL 加载
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
    // ② 从 Supabase 加载（兜底）
    if (!loaded && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('access_devices')
          .select('display_name')
          .eq('id', '__settings__')
          .maybeSingle()
        if (!error && data?.display_name?.startsWith('maxSlots:')) {
          const val = parseInt(data.display_name.replace('maxSlots:', ''), 10)
          if (val > 0) {
            this.maxSlots = val
            this.logger.log(`⚙️ 从 Supabase 加载: 设备限额 ${this.maxSlots}`)
            loaded = true
          }
        } else if (error) {
          this.logger.warn(`access_devices读取失败 (${error?.code || error?.message})，尝试创建表...`)
          const created = await this.createTablesIfNeeded()
          if (created) {
            const retry = await this.supabase
              .from('access_devices')
              .select('display_name')
              .eq('id', '__settings__')
              .maybeSingle()
            if (!retry.error && retry.data?.display_name?.startsWith('maxSlots:')) {
              const val = parseInt(retry.data.display_name.replace('maxSlots:', ''), 10)
              if (val > 0) {
                this.maxSlots = val
                loaded = true
              }
            }
          }
        }
      } catch (e) {
        this.logger.warn(`Supabase 加载设置异常: ${(e as Error).message}`)
      }
    }
    // ③ 兜底：从 device_settings 表读取（含 PGRST205 schema 缓存重试）
    if (!loaded && this.supabase) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data, error } = await this.supabase
            .from('device_settings')
            .select('value')
            .eq('key', 'max_slots')
            .maybeSingle()
          if (!error && data) {
            const val = parseInt(data.value, 10)
            if (val > 0) {
              this.maxSlots = val
              this.logger.log(`⚙️ 从数据库加载(device_settings): 设备限额 ${this.maxSlots}`)
              loaded = true
              break
            }
          } else if (error?.code === 'PGRST205') {
            this.logger.warn(`PostgREST schema 缓存未就绪 (第${attempt + 1}次)，等待2秒重试...`)
            await new Promise(r => setTimeout(r, 2000))
            continue
          } else {
            break
          }
        } catch (e) {
          this.logger.warn(`数据库加载设置异常: ${(e as Error).message}`)
          break
        }
      }
    }
    // ③ 兜底：读文件
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
    if (!this.supabase) {
      await this.writeSettingsFileFallback()
      return
    }
    try {
      // ① 写入 access_devices 表
      const { error: err1 } = await this.supabase
        .from('access_devices')
        .upsert({
          id: '__settings__',
          ua: '',
          display_name: `maxSlots:${this.maxSlots}`,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        }, { onConflict: 'id' })
      if (err1) {
        this.logger.warn(`access_devices写入失败: ${err1.message}`)
      } else {
        this.logger.log(`⚙️ 设备限额已持久化到数据库: ${this.maxSlots}`)
      }
      // ② 也尝试写入 device_settings（兼容旧数据）
      const { error: err2 } = await this.supabase
        .from('device_settings')
        .upsert({ key: 'max_slots', value: String(this.maxSlots) }, { onConflict: 'key' })
      if (err2) {
        this.logger.warn(`device_settings写入失败: ${err2.message}（不影响使用）`)
      }
      // ③ 同步写入 PostgreSQL
      if (this.pgSql) {
        await this.pgSql`
          INSERT INTO public.device_device_settings (key, value) 
          VALUES ('max_slots', ${String(this.maxSlots)})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `.catch(() => {/* ignore */})
        this.logger.log(`⚙️ 设备限额已持久化到 PostgreSQL: ${this.maxSlots}`)
      }
    } catch (e) {
      this.logger.warn(`数据库写入设置异常: ${(e as Error).message}，降级到文件`)
      await this.writeSettingsFileFallback()
    }
    await this.writeSettingsFileFallback()
  }

  private async writeSettingsFileFallback() {
    const projectSettingsPath = path.resolve(process.cwd(), '.device_registry.settings.json')
    try {
      fs.writeFileSync(projectSettingsPath, JSON.stringify({ maxSlots: this.maxSlots }), 'utf-8')
    } catch (e) {
      this.logger.warn(`设置文件写入失败 (${projectSettingsPath}): ${(e as Error).message}`)
    }
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify({ maxSlots: this.maxSlots }), 'utf-8')
    } catch {
      // /tmp 不可用时忽略
    }
  }

  private async ensureLoaded() {
    if (this.registryLoaded) return
    await this.loadSettingsFromDB()
    await this.loadRegistry()
    if (!this.supabase) {
      this.loadFromFile()
    }
    this.registryLoaded = true
  }

  private async loadRegistry() {
    // ① 优先从 PostgreSQL 加载
    if (this.pgSql) {
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
          return
        }
      } catch (e) {
        this.logger.warn(`PostgreSQL 加载设备失败: ${(e as Error).message}`)
      }
    }
    // ② 从 Supabase 加载（兜底）
    if (!this.supabase) return
    try {
      const { data, error } = await this.supabase
        .from('access_devices')
        .select('*')
        .order('first_seen', { ascending: true })
      if (error) throw error
      if (data) {
        this.registry = data.map((r: any) => ({
          fingerprint: r.id,
          ua: r.ua || '',
          displayName: r.display_name || '',
          firstSeen: new Date(r.first_seen).getTime(),
          lastSeen: new Date(r.last_seen).getTime(),
        }))
        this.logger.log(`从Supabase加载了 ${this.registry.length} 个设备`)
      }
    } catch (e) {
      const msg = (e as Error).message
      this.logger.warn(`Supabase加载失败: ${msg}`)
      if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('404')) {
        const created = await this.createTablesIfNeeded()
        if (created) {
          const retry = await this.supabase
            .from('access_devices')
            .select('*')
            .order('first_seen', { ascending: true })
          if (!retry.error && retry.data) {
            this.registry = retry.data.map((r: any) => ({
              fingerprint: r.id,
              ua: r.ua || '',
              displayName: r.display_name || '',
              firstSeen: new Date(r.first_seen).getTime(),
              lastSeen: new Date(r.last_seen).getTime(),
            }))
            this.logger.log(`从Supabase加载了 ${this.registry.length} 个设备（建表后重试）`)
            return
          }
        }
      }
      this.logger.warn('Supabase 不可用，降级到文件存储')
      this.supabase = null
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
      // 管理员设备不检查限额
      if (existing.isAdmin) return { allowed: true }
      const now = new Date().toISOString()

      // 即使已存在，也按注册先后（firstSeen）检查是否在限额内
      const sorted = [...this.registry].sort((a, b) => a.firstSeen - b.firstSeen)
      const rank = sorted.findIndex(e => e.fingerprint === deviceId)
      if (rank >= limit) {
        return { allowed: false, message: `设备限额 ${limit} 台，请先移除不常用设备` }
      }

      const supabase = await this.getOrInitSupabase()
      if (supabase) {
        await supabase
          .from('access_devices')
          .update({ last_seen: now, ua })
          .eq('id', deviceId)
      }
      if (this.pgSql) {
        await this.pgSql`
          UPDATE public.device_access_devices SET last_seen = ${now}, ua = ${ua} WHERE id = ${deviceId}
        `.catch(() => {/* ignore */})
      }
      return { allowed: true }
    }

    // 新设备 → 管理员不占名额，直接放行
    if (isAdmin) {
      this.registry.push({ fingerprint: deviceId, ua, displayName, firstSeen: Date.now(), lastSeen: Date.now(), isAdmin: true })
      this.logger.log(`👑 管理员设备注册: ${deviceId.slice(0, 20)} (不计入名额)`)
      const supabase = await this.getOrInitSupabase()
      if (supabase) {
        await supabase.from('access_devices').insert({ id: deviceId, ua, display_name: displayName + '(管理员)' })
      }
      if (this.pgSql) {
        await this.pgSql`
          INSERT INTO public.device_access_devices (id, ua, display_name, first_seen, last_seen) 
          VALUES (${deviceId}, ${ua}, ${displayName + '(管理员)'}, ${new Date().toISOString()}, ${new Date().toISOString()})
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

    const supabase = await this.getOrInitSupabase()
    if (supabase) {
      const { error } = await supabase
        .from('access_devices')
        .insert({ id: deviceId, ua, display_name: displayName })
      if (error) this.logger.warn(`Supabase插入失败: ${error.message}`)
    }
    if (this.pgSql) {
      await this.pgSql`
        INSERT INTO public.device_access_devices (id, ua, display_name, first_seen, last_seen) 
        VALUES (${deviceId}, ${ua}, ${displayName}, ${new Date().toISOString()}, ${new Date().toISOString()})
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
    const supabase = await this.getOrInitSupabase()
    if (supabase) {
      const { error } = await supabase
        .from('access_devices')
        .insert({ id: fingerprint, ua, display_name: '未识别' })
      if (error) this.logger.warn(`Supabase插入失败(tryRegister): ${error.message}`)
    }
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
    const supabase = await this.getOrInitSupabase()
    if (supabase) {
      await supabase.from('access_devices').delete().eq('id', device.fingerprint)
    }
    this.saveToFile()
    return { success: true }
  }

  async removeAllDevices() {
    await this.ensureLoaded()
    this.registry = []
    const supabase = await this.getOrInitSupabase()
    if (supabase) {
      await supabase.from('access_devices').delete().neq('id', '0')
    }
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

    const client = await this.getOrInitSupabase()
    if (client) {
      try {
        const { error } = await client
          .from('access_devices')
          .update({ display_name: remark })
          .eq('id', device.fingerprint)
        if (error) {
          this.logger.error(`❌ Supabase 改名失败: ${error.message}`, { deviceId: device.fingerprint })
        } else {
          this.logger.log(`✅ Supabase 改名成功: ${oldName} → ${remark} (${device.fingerprint})`)
        }
      } catch (e: any) {
        this.logger.error(`❌ Supabase 改名异常: ${e.message}`)
      }
    } else {
      this.logger.warn(`⚠️ Supabase 不可用，仅内存中改名: ${oldName} → ${remark}`)
    }
    return { success: true }
  }

  private getEffectiveMax(): number {
    return this.maxSlots
  }

  private async getOrInitSupabase() {
    if (this.supabase) return this.supabase
    this.supabase = this.initSupabase()
    if (this.supabase) {
      try {
        await this.supabase.from('access_devices').select('id').limit(1)
        await this.syncRegistryToSupabase()
      } catch {
        this.supabase = null
      }
    }
    return this.supabase
  }

  private async syncRegistryToSupabase() {
    if (!this.supabase || this.registry.length === 0) return
    try {
      const { data: existing } = await this.supabase
        .from('access_devices')
        .select('id')
      const existingIds = new Set((existing || []).map((r: any) => r.id))
      for (const device of this.registry) {
        if (existingIds.has(device.fingerprint)) continue
        await this.supabase
          .from('access_devices')
          .insert({
            id: device.fingerprint,
            ua: device.ua,
            display_name: device.displayName,
            first_seen: new Date(device.firstSeen).toISOString(),
            last_seen: new Date(device.lastSeen).toISOString(),
          })
      }
      this.logger.log(`同步了 ${this.registry.length - existingIds.size} 台设备到 Supabase`)
    } catch (e) {
      this.logger.warn(`同步设备到 Supabase 失败: ${(e as Error).message}`)
    }
  }
}