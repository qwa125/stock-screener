import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as fs from 'fs/promises';

interface DeviceRecord {
  registeredAt: number;
  lastSeen: number;
  fingerprint: Record<string, any>;
}

interface DeviceRegistry {
  maxSlots: number;
  devices: Record<string, DeviceRecord>;
}

@Injectable()
export class AccessControlService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccessControlService.name);
  private readonly REGISTRY_FILE: string;

  constructor() {
    this.REGISTRY_FILE = process.env.DEVICE_REGISTRY_PATH
      || '/tmp/device-registry.json';
  }
  private registry: DeviceRegistry = { maxSlots: 20, devices: {} };

  async onApplicationBootstrap() {
    // Step 1: 尝试从环境变量 DEVICE_REGISTRY 恢复（base64 编码 JSON）
    const envRegistry = process.env.DEVICE_REGISTRY;
    if (envRegistry) {
      try {
        const decoded = JSON.parse(Buffer.from(envRegistry, 'base64').toString('utf-8'));
        if (decoded && decoded.devices) {
          this.registry = decoded;
          this.logger.log(`📋 从环境变量恢复注册表, 已用 ${this.getUsedSlots()}/${this.registry.maxSlots} 个名额`);
        }
      } catch {
        this.logger.warn('⚠️ 环境变量 DEVICE_REGISTRY 解析失败, 忽略');
      }
    }

    // Step 2: 尝试从文件恢复（文件覆盖环境变量，因为文件可能更新更及时）
    try {
      const raw = await fs.readFile(this.REGISTRY_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.devices) {
        this.registry = parsed;
        this.logger.log(`📋 从磁盘文件恢复注册表, 已用 ${this.getUsedSlots()}/${this.registry.maxSlots} 个名额`);
      }
    } catch {
      this.logger.log('📋 无本地注册表文件');
    }
  }

  private async saveRegistry() {
    try {
      await fs.writeFile(this.REGISTRY_FILE, JSON.stringify(this.registry, null, 2), 'utf-8');
    } catch (err) {
      this.logger.warn(`⚠️ 注册表写入失败: ${err.message}`);
    }
  }

  /** 导出注册表为 base64 编码（用于跨部署迁移） */
  exportRegistryAsBase64(): string {
    return Buffer.from(JSON.stringify(this.registry)).toString('base64');
  }

  getMaxSlots(): number {
    return this.registry.maxSlots;
  }

  getUsedSlots(): number {
    return Object.keys(this.registry.devices).length;
  }

  /** 设置最大名额 */
  async setMaxSlots(n: number): Promise<void> {
    this.registry.maxSlots = n;
    await this.saveRegistry();
  }

  /** 检查设备是否已注册 */
  isDeviceRegistered(deviceId: string): boolean {
    return !!this.registry.devices[deviceId];
  }

  /** 检查是否有空闲名额 */
  hasAvailableSlot(): boolean {
    return this.getUsedSlots() < this.registry.maxSlots;
  }

  /** 注册新设备 */
  async registerDevice(deviceId: string, fingerprint: Record<string, any>): Promise<{ success: boolean; reason?: string }> {
    // 已注册 → 更新最后访问时间, 不消耗额外名额
    if (this.registry.devices[deviceId]) {
      this.registry.devices[deviceId].lastSeen = Date.now();
      await this.saveRegistry();
      return { success: true };
    }

    // 名额已满
    if (!this.hasAvailableSlot()) {
      return { success: false, reason: '名额已满, 请联系管理员扩容' };
    }

    // 新设备注册
    this.registry.devices[deviceId] = {
      registeredAt: Date.now(),
      lastSeen: Date.now(),
      fingerprint,
    };
    await this.saveRegistry();
    this.logger.log(`✅ 新设备注册成功 [${deviceId.slice(0, 8)}...], 已用 ${this.getUsedSlots()}/${this.registry.maxSlots}`);
    return { success: true };
  }

  /** 重置注册表（清空所有设备） */
  async resetRegistry(): Promise<void> {
    this.registry.devices = {};
    await this.saveRegistry();
    this.logger.log(`🔄 注册表已重置, 当前名额 ${this.registry.maxSlots}, 0/${this.registry.maxSlots} 已用`);
  }

  /** 获取注册表状态 */
  getStatus(deviceId?: string): {
    allowed: boolean;
    usedSlots: number;
    maxSlots: number;
    registered: boolean;
  } {
    const registered = deviceId ? this.isDeviceRegistered(deviceId) : false;
    return {
      allowed: registered || this.hasAvailableSlot(),
      usedSlots: this.getUsedSlots(),
      maxSlots: this.registry.maxSlots,
      registered,
    };
  }
}