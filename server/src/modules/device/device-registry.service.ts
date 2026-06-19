import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseClient } from '@/storage/database/supabase-client';

interface DeviceEntry {
  fingerprint: string;
  ua: string;
  firstSeen: number;
  lastSeen: number;
  remark?: string;
}

/** Supabase 行原始结构 */
interface AccessDeviceRow {
  id: string;
  ua: string | null;
  display_name: string | null;
  first_seen: string;
  last_seen: string;
  remark: string | null;
}

@Injectable()
export class DeviceRegistryService {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private readonly supabase = getSupabaseClient();
  /** 环境变量默认值（作为后备） */
  private readonly envMaxUsers: number;
  /** 运行时名额（由后台API动态设置，优先级最高） */
  private runtimeMaxSlots: number | null = null;
  /** 已注册设备列表（内存缓存，启动时从 Supabase 加载） */
  private registry: DeviceEntry[] = [];

  constructor() {
    const envMax = parseInt(process.env.MAX_USERS || '', 10);
    this.envMaxUsers = !isNaN(envMax) && envMax > 0 ? envMax : 3;
    this.initializeRegistry();
    this.logger.log(`🔐 设备注册表初始化完成，环境变量 ${this.envMaxUsers}，运行时 ${this.runtimeMaxSlots ?? '未设置'}`);
  }

  /** 从 Supabase 加载注册表，同时恢复运行时名额 */
  private async initializeRegistry(): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('access_devices')
        .select('*')
        .order('first_seen', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        this.registry = (data as AccessDeviceRow[]).map(row => ({
          fingerprint: row.id,
          ua: row.ua || '',
          firstSeen: new Date(row.first_seen).getTime(),
          lastSeen: new Date(row.last_seen).getTime(),
          remark: row.remark || '',
        }));
      }
      this.logger.log(`📋 已从数据库加载 ${this.registry.length} 个已注册设备`);
    } catch (e: any) {
      this.logger.warn(`⚠️ 从数据库加载注册表失败，将使用空注册表: ${e.message}`);
    }
  }

  /** 有效限额：运行时名额优先，无则回退环境变量 */
  private get effectiveMax(): number {
    return this.runtimeMaxSlots ?? this.envMaxUsers;
  }

  /** 同步当前注册表到 Supabase */
  private async syncToSupabase(): Promise<void> {
    try {
      // 全量替换：先删全部，再批量插入
      const { error: delErr } = await this.supabase
        .from('access_devices')
        .delete()
        .neq('id', '__never__');
      if (delErr) throw delErr;

      if (this.registry.length === 0) return;

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
      if (insErr) throw insErr;
    } catch (e: any) {
      this.logger.warn(`⚠️ 同步注册表到数据库失败: ${e.message}`);
    }
  }

  /** 将单条设备记录 upsert 到 Supabase */
  private async upsertDevice(device: DeviceEntry): Promise<void> {
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
      if (error) throw error;
    } catch (e: any) {
      this.logger.warn(`⚠️ 写入设备到数据库失败: ${e.message}`);
      // 回退：全量同步
      await this.syncToSupabase();
    }
  }

  /** 从 Supabase 删除一条设备记录 */
  private async deleteDeviceFromDB(fingerprint: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('access_devices')
        .delete()
        .eq('id', fingerprint);
      if (error) throw error;
    } catch (e: any) {
      this.logger.warn(`⚠️ 从数据库删除设备失败: ${e.message}`);
    }
  }

  /** 通过前端设备 ID 注册/续签设备（浏览器 localStorage 持久化，最优先） */
  async touchDevice(deviceId: string, ua: string): Promise<{ allowed: boolean; message?: string }> {
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

    const entry: DeviceEntry = {
      fingerprint: deviceId,
      ua,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
    };
    this.registry.push(entry);
    await this.upsertDevice(entry);
    this.logger.log(`📱 新设备注册 (${this.registry.length}/${limit}): ID=${deviceId.slice(0,12)}… UA=${ua.substring(0, 40)}`);
    return { allowed: true };
  }

  /** 检查设备是否允许访问（基于 IP+UA 的后备方案） */
  async tryRegister(ip: string, ua: string): Promise<{ allowed: boolean; message?: string }> {
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

  /** 生成设备指纹（基于浏览器 UA） */
  private createFingerprint(_ip: string, ua: string): string {
    return `${ua}`;
  }

  /** 获取已注册设备数 */
  get registeredCount(): number {
    return this.registry.length;
  }

  /** 获取有效最大允许用户数 */
  get maxAllowed(): number {
    return this.effectiveMax;
  }

  /** 运行时动态设置设备限额（持久化到 Supabase） */
  async setMaxSlots(value: number): Promise<void> {
    this.runtimeMaxSlots = Math.max(1, Math.min(100, Math.round(value)));
    // 存入 config 表或环境变量（保持兼容，存到数据库 metadata）
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
    } catch { /* ignore */ }
    this.logger.log(`🔐 运行时设备限额已更新为 ${this.runtimeMaxSlots}`);
  }

  /** 从 UA 提取可读设备名 */
  private extractDisplayName(ua: string): string {
    if (!ua) return '未知设备';
    let name = '未识别';
    const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
    if (/iPhone/.test(ua)) {
      const m = ua.match(/iPhone\s*\d+[,\d]*/i);
      name = m ? m[0] : 'iPhone';
    } else if (/iPad/.test(ua)) {
      const m = ua.match(/iPad\s*\d+[,\d]*/i);
      name = m ? m[0] : 'iPad';
    } else if (/Android/.test(ua)) {
      const m = ua.match(/Android\s+\d+[.\d]*\s*;\s*([^;)]+)/i);
      if (m) {
        name = m[1].trim().replace(/\s*Build\/.*/i, '').trim();
      } else {
        const v = ua.match(/Android\s+[\d.]+/);
        name = v ? v[0] : 'Android';
      }
    } else if (/Windows/.test(ua)) {
      const m = ua.match(/Windows NT [\d.]+/);
      name = m ? m[0] : 'Windows';
    } else if (/Mac OS X/.test(ua)) {
      name = 'macOS';
    } else if (/Linux/.test(ua)) name = 'Linux';
    if (/MicroMessenger/i.test(ua)) name += ' · 微信';
    else if (/MQQBrowser/i.test(ua)) name += ' · QQ浏览器';
    else if (/UCBrowser/i.test(ua)) name += ' · UC';
    else if (/Edg\//.test(ua)) name += ' · Edge';
    else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) name += ' · Chrome';
    else if (/Firefox\//.test(ua)) name += ' · Firefox';
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) name += ' · Safari';
    if (isMobile) name += ' 📱';
    return name;
  }

  /** 获取所有已注册设备列表 */
  getDevices(): Array<{ index: number; fingerprint: string; displayName: string; remark: string; firstSeen: number; lastSeen: number }> {
    return this.registry.map((d, i) => ({
      index: i,
      fingerprint: d.fingerprint,
      displayName: this.extractDisplayName(d.ua),
      remark: d.remark || '',
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
    }));
  }

  /** 更新设备备注 */
  async updateRemark(index: number, remark: string): Promise<boolean> {
    if (index < 0 || index >= this.registry.length) return false;
    this.registry[index].remark = remark.trim();
    await this.upsertDevice(this.registry[index]);
    this.logger.log(`✏️ 设备 #${index} 备注已更新: "${remark.trim()}"`);
    return true;
  }

  /** 删除指定设备 */
  async removeDevice(index: number): Promise<boolean> {
    if (index < 0 || index >= this.registry.length) return false;
    const removed = this.registry.splice(index, 1)[0];
    await this.deleteDeviceFromDB(removed.fingerprint);
    this.logger.log(`🗑️ 已删除设备 #${index}: ${removed.fingerprint}, 剩余 ${this.registry.length} 个`);
    return true;
  }

  /** 清空所有已注册设备 */
  async clearDevices(): Promise<void> {
    const count = this.registry.length;
    this.registry = [];
    try {
      const { error } = await this.supabase
        .from('access_devices')
        .delete()
        .neq('id', '__never__');
      if (error) throw error;
    } catch (e: any) {
      this.logger.warn(`⚠️ 清空数据库设备失败: ${e.message}`);
    }
    this.logger.log(`🧹 已清空全部 ${count} 个已注册设备`);
  }
}