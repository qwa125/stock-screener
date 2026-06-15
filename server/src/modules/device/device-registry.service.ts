import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface DeviceEntry {
  fingerprint: string;
  firstSeen: number;
  lastSeen: number;
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

  /** 生成设备指纹 */
  private createFingerprint(ip: string, ua: string): string {
    return `${ip}|${ua}`;
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
    this.logger.log(`📱 新设备注册 (${this.registry.length}/${limit}): ${ip}`);
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
}