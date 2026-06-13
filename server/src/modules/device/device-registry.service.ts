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
  /** 默认最多允许 5 个不同设备访问 */
  private readonly maxUsers: number;
  private registry: DeviceEntry[] = [];

  constructor() {
    const envMax = parseInt(process.env.MAX_USERS || '', 10);
    this.maxUsers = !isNaN(envMax) && envMax > 0 ? envMax : 5;
    this.loadRegistry();
    this.logger.log(`🔐 设备注册表已加载，最多允许 ${this.maxUsers} 个设备`);
  }

  private loadRegistry(): void {
    try {
      if (existsSync(this.REGISTRY_FILE)) {
        const raw = readFileSync(this.REGISTRY_FILE, 'utf-8');
        this.registry = JSON.parse(raw) as DeviceEntry[];
        this.logger.log(`📋 已加载 ${this.registry.length} 个已注册设备`);
      }
    } catch { /* ignore */ }
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

  /** 检查设备是否允许访问 */
  tryRegister(ip: string, ua: string): { allowed: boolean; message?: string } {
    const fingerprint = this.createFingerprint(ip, ua);

    // 已注册 → 更新最后访问时间
    const existing = this.registry.find(e => e.fingerprint === fingerprint);
    if (existing) {
      existing.lastSeen = Date.now();
      this.saveRegistry();
      return { allowed: true };
    }

    // 新设备 → 检查是否超限
    if (this.registry.length >= this.maxUsers) {
      return {
        allowed: false,
        message: `访问受限：最多允许 ${this.maxUsers} 个不同设备访问，当前已满。请联系管理员扩容。`,
      };
    }

    // 注册新设备
    this.registry.push({
      fingerprint,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
    });
    this.saveRegistry();
    this.logger.log(`📱 新设备注册 (${this.registry.length}/${this.maxUsers}): ${ip}`);
    return { allowed: true };
  }

  /** 获取已注册设备数 */
  get registeredCount(): number {
    return this.registry.length;
  }

  /** 获取最大允许用户数 */
  get maxAllowed(): number {
    return this.maxUsers;
  }
}