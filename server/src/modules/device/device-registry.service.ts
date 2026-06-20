import { Injectable, Logger } from '@nestjs/common'
import { getSupabaseClient } from '@/storage/database/supabase-client'
import * as fs from 'fs'
import * as path from 'path'
import * as pg from 'pg'
import type { DeviceRegistryEntry } from './device-registry.types'

@Injectable()
export class DeviceRegistryService {
  private readonly logger = new Logger(DeviceRegistryService.name)
  private registry: DeviceRegistryEntry[] = []
  private maxSlots = 3
  private registryLoaded = false
  private supabase = this.initSupabase()
  private readonly filePath = path.resolve(process.cwd(), '.device_registry.json')

  private initSupabase() {
    try {
      const client = getSupabaseClient()
      if (client) return client
    } catch {
      this.logger.warn('Supabase未配置，使用JSON文件持久化设备列表')
    }
    return null
  }

  private async ensureTable() {
    const url = process.env.COZE_SUPABASE_URL || process.env.SUPABASE_URL || ''
    const pwd = process.env.SUPABASE_DB_PASSWORD || ''
    if (!url || !pwd) {
      this.logger.warn('缺少SUPABASE_DB_PASSWORD，无法自动创建表')
      return false
    }
    try {
      const ref = new URL(url).hostname.split('.')[0]
      // 尝试多种 pooler 连接方式
      const poolerHosts = [
        `aws-0-ap-southeast-1.pooler.supabase.com`, // 新加坡 pooler
        `aws-0-ap-northeast-1.pooler.supabase.com`, // 东京 pooler（兜底）
        `${ref}.pooler.supabase.com`,               // 新格式 pooler
      ]
      let lastError: Error | null = null
      for (const host of poolerHosts) {
        try {
          const client = new pg.Client({
            host,
            port: 6543,
            user: `postgres.${ref}`,
            password: pwd,
            database: 'postgres',
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000,
          })
          await client.connect()
          await client.query(`
            CREATE TABLE IF NOT EXISTS public.access_devices (
              id TEXT PRIMARY KEY,
              ua TEXT NOT NULL DEFAULT '',
              display_name TEXT NOT NULL DEFAULT '',
              first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `)
          await client.query(`
            CREATE INDEX IF NOT EXISTS idx_access_devices_first_seen ON public.access_devices (first_seen)
          `)
          // 刷新 PostgREST schema 缓存
          await client.query(`NOTIFY pgrst, 'reload schema'`)
          await client.end()
          this.logger.log(`通过 ${host} 自动创建/确认 access_devices 表成功`)
          // 等待缓存刷新
          await new Promise(r => setTimeout(r, 3000))
          return true
        } catch (e) {
          lastError = e as Error
          this.logger.warn(`pooler ${host} 连接失败: ${(e as Error).message}`)
        }
      }
      throw lastError || new Error('所有 pooler 连接均失败')
    } catch (e) {
      this.logger.warn(`自动创建表失败: ${(e as Error).message}`)
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

  private async ensureLoaded() {
    if (this.registryLoaded) return
    await this.loadRegistry()
    if (!this.supabase) {
      this.loadFromFile()
    }
    this.registryLoaded = true
  }

  private async loadRegistry() {
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
        const created = await this.ensureTable()
        if (created) {
          // 重试一次
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
            return // ← 关键：重试成功就保留 supabase 连接，不设为 null
          }
        }
      }
      this.logger.warn('Supabase 不可用，降级到文件存储')
      this.supabase = null
    }
  }

  async touchDevice(deviceId: string, ua: string): Promise<{ allowed: boolean; message?: string }> {
    await this.ensureLoaded()
    const now = new Date().toISOString()
    const displayName = ua.includes('iPhone') ? 'iPhone · Safari 📱'
      : ua.includes('MicroMessenger') ? '微信浏览器 💬'
      : ua.includes('Chrome') ? 'Chrome 🌐'
      : ua.includes('Firefox') ? 'Firefox 🦊'
      : ua.includes('Safari') && !ua.includes('Chrome') ? 'Safari 🧭'
      : '未识别'
    const limit = this.getEffectiveMax()

    // 先检查是否已存在
    const existing = this.registry.find(e => e.fingerprint === deviceId)
    if (existing) {
      existing.lastSeen = Date.now()
      const supabase = await this.getOrInitSupabase()
      if (supabase) {
        await supabase
          .from('access_devices')
          .update({ last_seen: now, ua, display_name: displayName })
          .eq('id', deviceId)
      }
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
    // 同时写入 Supabase 持久化
    const supabase = await this.getOrInitSupabase()
    if (supabase) {
      const { error } = await supabase
        .from('access_devices')
        .insert({ id: fingerprint, ua, display_name: '未识别' })
      if (error) this.logger.warn(`Supabase插入失败(tryRegister): ${error.message}`)
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

  async setMaxSlots(value: number) {
    this.maxSlots = value
    return { success: true, maxSlots: value }
  }

  async removeDevice(index: number) {
    await this.ensureLoaded()
    if (index < 0 || index >= this.registry.length) {
      throw new Error(`设备索引 ${index} 不存在`)
    }
    const device = this.registry[index]
    this.registry.splice(index, 1)
    if (this.supabase) {
      await this.supabase.from('access_devices').delete().eq('id', device.fingerprint)
    }
    this.saveToFile()
    return { success: true }
  }

  async removeAllDevices() {
    await this.ensureLoaded()
    this.registry = []
    if (this.supabase) {
      await this.supabase.from('access_devices').delete().neq('id', '0')
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

  /** 如果 supabase 连接已丢失则尝试重新初始化 */
  private async getOrInitSupabase() {
    if (this.supabase) return this.supabase
    this.supabase = this.initSupabase()
    if (this.supabase) {
      try {
        await this.supabase.from('access_devices').select('id').limit(1)
        // 连接恢复后，将内存中已有的设备全量同步到 Supabase
        await this.syncRegistryToSupabase()
      } catch {
        this.supabase = null
      }
    }
    return this.supabase
  }

  /** 将内存中所有设备写入 Supabase（用于连接恢复后的全量同步） */
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