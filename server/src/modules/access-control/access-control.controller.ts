import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { DeviceRegistryService } from '@/modules/device/device-registry.service';
import { SkipAccessLimit } from '@/guards/access-limit.guard';

@Controller('access')
@SkipAccessLimit()
export class AccessControlController {
  constructor(
    private readonly service: AccessControlService,
    private readonly deviceRegistry: DeviceRegistryService,
  ) {}

  /** 设备注册/续签 */
  @Post('register')
  async register(
    @Body() body: { deviceId: string; fingerprint: Record<string, any> },
  ) {
    const result = await this.service.registerDevice(body.deviceId, body.fingerprint || {});
    return {
      code: result.success ? 200 : 403,
      msg: result.success ? '注册成功' : (result.reason || '访问被拒绝'),
      data: this.service.getStatus(body.deviceId),
    };
  }

  /** 查询当前设备状态（合并 AccessControl + Supabase 持久化数据） */
  @Get('status')
  async status(@Query('deviceId') deviceId?: string) {
    const acStatus = this.service.getStatus(deviceId);
    return {
      code: 200,
      msg: 'ok',
      data: {
        ...acStatus,
        usedSlots: await this.deviceRegistry.registeredCount(),
      },
    };
  }

  /** (管理员) 设置最大名额 — 支持 POST JSON 或 GET query */
  @Post('set-slots')
  async setSlotsPost(@Body() body: { maxSlots: number }) {
    return this.setSlots(body.maxSlots);
  }

  @Get('set-slots')
  async setSlotsGet(@Query('maxSlots') maxSlots: string) {
    return this.setSlots(Number(maxSlots));
  }

  private async setSlots(maxSlots: number) {
    if (!maxSlots || maxSlots < 1 || !Number.isInteger(maxSlots)) {
      return { code: 400, msg: '无效名额数，请传入整数，如 ?maxSlots=30' };
    }
    await this.service.setMaxSlots(maxSlots);
    await this.deviceRegistry.setMaxSlots(maxSlots);
    return { code: 200, msg: `名额已设为 ${maxSlots}` };
  }

  /** (管理员) 重置注册表（同时清除 DeviceRegistry 和 AccessControl 两个注册表） */
  @Get('reset')
  async reset() {
    await this.service.resetRegistry();
    await this.deviceRegistry.removeAllDevices();
    return { code: 200, msg: '注册表已清空，所有设备需重新注册' };
  }

  /** (管理员) 查看 DeviceRegistry 中的设备列表 */
  @Get('device-registry')
  async listDeviceRegistry() {
    const devices = await this.deviceRegistry.getDevices();
    return {
      code: 200,
      data: {
        maxSlots: this.deviceRegistry.maxAllowed,
        usedSlots: devices.length,
        devices: devices.map((d, i) => ({
          index: i,
          fingerprint: d.fingerprint.slice(0, 20) + '...',
          displayName: d.displayName,
          firstSeen: new Date(d.firstSeen).toLocaleString(),
          lastSeen: new Date(d.lastSeen).toLocaleString(),
        })),
      },
    };
  }

  /** 导出注册表为 base64（部署迁移用：粘贴到 cloudbaserc.json 的 DEVICE_REGISTRY 环境变量） */
  @Get('export')
  async exportRegistry() {
    const base64 = this.service.exportRegistryAsBase64();
    const used = this.service.getUsedSlots();
    const max = this.service.getMaxSlots();
    // 同时也输出到日志，方便查看
    this.service['logger'].log(`📤 注册表导出: ${used}/${max} 设备, base64(${base64.length}字符)`);
    return {
      code: 200,
      data: {
        base64,
        usedSlots: used,
        maxSlots: max,
        hint: '将此 base64 字符串设为 cloudbaserc.json 中 envParams.DEVICE_REGISTRY，下次部署自动恢复注册表',
      },
    };
  }

  /** (管理员) 查看注册表概况 */
  @Get('admin/devices')
  async listDevices() {
    const devices = Object.entries(this.service['registry'].devices).map(([id, rec]) => ({
      deviceId: id.slice(0, 16) + '...',
      registeredAt: new Date(rec.registeredAt).toLocaleString(),
      lastSeen: new Date(rec.lastSeen).toLocaleString(),
    }));
    return {
      code: 200,
      data: {
        maxSlots: this.service.getMaxSlots(),
        usedSlots: this.service.getUsedSlots(),
        devices,
      },
    };
  }
}