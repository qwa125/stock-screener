import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface DeviceEntry {
  fingerprint: string;
  firstSeen: number;
  lastSeen: number;
  remark?: string;
}

@Injectable()
export class DeviceRegistryService {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private readonly REGISTRY_FILE = '/tmp/device-registry.json';
  /** 环境变量默认值（作为后备） */
  private readonly envMaxUsers: number;
  /** 运行时名额（由后台API动态设置，优先级最高） */
  private runtimeMaxSlots: number | null = null;
  /** 已注册设备列表 */
  private registry: DeviceEntry[] = [];

  constructor() {
    const envMax = parseInt(process.env.MAX_USERS || '', 10);
    this.envMaxUsers = !isNaN(envMax) && envMax > 0 ? envMax : 10;
    this.loadRegistry();
    this.logger.log(`🔐 设备注册表已加载，环境变量 ${this.envMaxUsers}，运行时 ${this.runtimeMaxSlots ?? '未设置'}，有效限额 ${this.effectiveMax}`);
  }

  private loadRegistry(): void {
    try {
      if (!existsSync(this.REGISTRY_FILE)) return;

      const raw = readFileSync(this.REGISTRY_FILE, 'utf-8');
      const parsed = JSON.parse(raw);

      // 对象格式 { maxSlots, devices: { id: {fingerprint, registeredAt, lastSeen} } }
      // 由 AccessControlService 写入，包含运行时名额
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof parsed.maxSlots === 'number') {
          this.runtimeMaxSlots = parsed.maxSlots;
        }
        // 将对象格式的设备列表转为数组格式
        if (parsed.devices && typeof parsed.devices === 'object') {
          this.registry = Object.values(parsed.devices).map((d: any) => ({
            fingerprint: typeof d.fingerprint === 'string'
              ? d.fingerprint
              : (d.fingerprint ? JSON.stringify(d.fingerprint) : 'unknown'),
            firstSeen: d.registeredAt || d.firstSeen || Date.now(),
            lastSeen: d.lastSeen || Date.now(),
          }));
        }
      } else if (Array.isArray(parsed)) {
        // 数组格式（兼容旧版）
        this.registry = parsed as DeviceEntry[];
      }

      this.logger.log(`📋 已加载 ${this.registry.length} 个已注册设备，运行时名额: ${this.runtimeMaxSlots ?? '未设置'}`);
    } catch (e) {
      this.logger.warn(`⚠️ 注册表文件解析失败: ${e.message}`);
    }
  }

  /** 有效限额：运行时名额优先，无则回退环境变量 */
  private get effectiveMax(): number {
    return this.runtimeMaxSlots ?? this.envMaxUsers;
  }

  private saveRegistry(): void {
    try {
      writeFileSync(this.REGISTRY_FILE, JSON.stringify(this.registry, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  /** 生成设备指纹（基于手机型号，同一手机不同浏览器计1个名额） */
  private createFingerprint(_ip: string, ua: string): string {
    // Android 设备：提取 "Android X; 手机型号（去掉Build/...）" → 不同浏览器生成相同指纹
    const androidMatch = ua.match(/Android\s+\d+[.\d]*\s*;\s*([^;)]+)/i);
    if (androidMatch) {
      let model = androidMatch[1].trim();
      // 去掉 Build/... 后缀，只保留手机型号
      model = model.replace(/\s*Build\/.*/i, '').trim();
      return `ANDROID-${model}`;
    }

    // iPhone/iPad：提取型号标识
    const iphoneMatch = ua.match(/iPhone\s*\d+[,\d]*/i);
    if (iphoneMatch) return `IPHONE-${iphoneMatch[0]}`;
    const ipadMatch = ua.match(/iPad\s*\d+[,\d]*/i);
    if (ipadMatch) return `IPAD-${ipadMatch[0]}`;

    // 桌面端：保留 UA 前 80 字符作为区分
    return ua.substring(0, 80);
  }

  /** 从文件重新加载运行时名额（由后台 API set-slots 动态写入） */
  private reloadRuntimeSlots(): void {
    try {
      if (existsSync(this.REGISTRY_FILE)) {
        const raw = readFileSync(this.REGISTRY_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.maxSlots === 'number') {
          this.runtimeMaxSlots = parsed.maxSlots;
        }
      }
    } catch { /* ignore */ }
  }

  /** 检查设备是否允许访问 */
  tryRegister(ip: string, ua: string): { allowed: boolean; message?: string } {
    // 每次请求重新读运行时名额（后台 set-slots 写入文件后会即时生效）
    this.reloadRuntimeSlots();

    const fingerprint = this.createFingerprint(ip, ua);

    // 已注册 → 更新最后访问时间
    const existing = this.registry.find(e => e.fingerprint === fingerprint);
    if (existing) {
      existing.lastSeen = Date.now();
      this.saveRegistry();
      return { allowed: true };
    }

    const limit = this.effectiveMax;

    // 新设备 → 检查是否超限
    if (this.registry.length >= limit) {
      return {
        allowed: false,
        message: `访问受限：最多允许 ${limit} 个不同设备访问，当前已满。请联系管理员扩容。`,
      };
    }

    // 注册新设备
    this.registry.push({
      fingerprint,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
    });
    this.saveRegistry();
    this.logger.log(`📱 新设备注册 (${this.registry.length}/${limit}): ${ua.substring(0, 40)}`);
    return { allowed: true };
  }

  /** 获取已注册设备数 */
  get registeredCount(): number {
    return this.registry.length;
  }

  /** 获取有效最大允许用户数（实时：运行时 > 环境变量） */
  get maxAllowed(): number {
    return this.effectiveMax;
  }

  /** 运行时动态设置设备限额（写入文件持久化，供 reloadRuntimeSlots 读取） */
  setMaxSlots(value: number): void {
    this.runtimeMaxSlots = Math.max(1, Math.min(100, Math.round(value)));
    // 持久化到文件，确保重启/重新加载后仍保留
    try {
      const raw = existsSync(this.REGISTRY_FILE) ? readFileSync(this.REGISTRY_FILE, 'utf-8') : '{}';
      const data = JSON.parse(raw);
      const obj = typeof data === 'object' && !Array.isArray(data) ? data : { devices: {} };
      obj.maxSlots = this.runtimeMaxSlots;
      writeFileSync(this.REGISTRY_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch { /* ignore */ }
    this.logger.log(`🔐 运行时设备限额已更新为 ${this.runtimeMaxSlots}`);
  }

  /** 从 UA/指纹 提取可读设备名 */
  private extractDisplayName(ua: string): string {
    // 新指纹格式: ANDROID-手机型号 / IPHONE-型号 / IPAD-型号
    if (ua.startsWith('ANDROID-')) return `${ua.replace('ANDROID-', '')} 📱`;
    if (ua.startsWith('IPHONE-')) return `${ua.replace('IPHONE-', '')} 📱`;
    if (ua.startsWith('IPAD-')) return `${ua.replace('IPAD-', '')} 📱`;

    // 旧格式兼容：从完整 UA 解析（已存储的老数据）
    let name = '未知设备';
    const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
    if (/iPhone/.test(ua)) {
      const m = ua.match(/iPhone\s*\d+[,\d]*/i);
      name = m ? m[0] : 'iPhone';
    } else if (/iPad/.test(ua)) {
      const m = ua.match(/iPad\s*\d+[,\d]*/i);
      name = m ? m[0] : 'iPad';
    } else if (/Android/.test(ua)) {
      const m = ua.match(/Android\s+\d+[.\d]*\s*;\s*([^;)]+)/i);
      name = m ? m[1].trim() : 'Android';
    } else if (/Windows/.test(ua)) {
      const m = ua.match(/Windows NT [\d.]+/);
      name = m ? m[0] : 'Windows';
    } else if (/Mac OS X/.test(ua)) {
      name = 'macOS';
    } else if (/Linux/.test(ua)) name = 'Linux';
    // 浏览器名
    if (/Edg\//.test(ua)) name += ' · Edge';
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
      displayName: this.extractDisplayName(d.fingerprint),
      remark: d.remark || '',
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
    }));
  }

  /** 更新设备备注 */
  updateRemark(index: number, remark: string): boolean {
    if (index < 0 || index >= this.registry.length) return false;
    this.registry[index].remark = remark.trim();
    this.saveRegistry();
    this.logger.log(`✏️ 设备 #${index} 备注已更新: "${remark.trim()}"`);
    return true;
  }

  /** 删除指定设备（按索引） */
  removeDevice(index: number): boolean {
    if (index < 0 || index >= this.registry.length) return false;
    const removed = this.registry.splice(index, 1)[0];
    this.saveRegistry();
    this.logger.log(`🗑️ 已删除设备 #${index}: ${removed.fingerprint}, 剩余 ${this.registry.length} 个`);
    return true;
  }

  /** 清空所有已注册设备 */
  clearDevices(): void {
    const count = this.registry.length;
    this.registry = [];
    this.saveRegistry();
    this.logger.log(`🧹 已清空全部 ${count} 个已注册设备`);
  }
}