import { Controller, Post, Get, Body, Query, Headers, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { DeviceRegistryService } from '@/modules/device/device-registry.service';
import { AccessControlService } from './access-control.service';

@Controller('access')
export class AccessControlController {
  constructor(
    private readonly service: AccessControlService,
    private readonly deviceRegistry: DeviceRegistryService,
  ) {}

  /** 设备注册/续签 — 2dfdbc9 模式：HTTP 429 表示名额满 */
  @Post('register')
  @HttpCode(200)
  async register(
    @Headers('x-device-id') deviceId: string,
    @Headers('x-admin-token') adminToken?: string,
    @Headers('user-agent') ua?: string,
  ) {
    if (!deviceId) {
      return { code: 400, msg: '缺少 x-device-id 头' };
    }
    const expectedAdminToken = process.env.ADMIN_TOKEN || 'admin2025';
    const isAdmin = typeof adminToken === 'string' && adminToken === expectedAdminToken;
    // 使用 DeviceRegistryService（PG 持久化）注册设备，冷启动不丢失
    const result = await this.deviceRegistry.allowDevice(
      deviceId,
      ua || 'unknown',
      isAdmin ? '设备(管理员)' : '设备',
      isAdmin,
    );
    if (!result.allowed) {
      throw new HttpException(
        { code: 429, msg: result.message || '名额已满，请联系管理员增加设备访问名额', data: null },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // 同步到 AccessControlService（向后兼容）
    await this.service.registerDevice(deviceId, {}, isAdmin);
    return {
      code: 200,
      msg: '注册成功',
      data: {
        registered: true,
        maxSlots: await this.deviceRegistry.getEffectiveMaxSlots(),
        usedSlots: await this.deviceRegistry.registeredCount(),
      },
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
        maxSlots: await this.deviceRegistry.getEffectiveMaxSlots(),
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

  /** (管理员) 重置注册表 */
  @Get('reset')
  async reset() {
    await this.service.resetRegistry();
    return { code: 200, msg: '注册表已清空，所有设备需重新注册' };
  }

  /** 导出注册表为 base64（部署迁移用：粘贴到 cloudbaserc.json 的 DEVICE_REGISTRY 环境变量） */
  @Get('export')
  async exportRegistry() {
    const base64 = this.service.exportRegistryAsBase64();
    const used = this.service.getUsedSlots();
    const max = await this.deviceRegistry.getEffectiveMaxSlots();
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
    const devices = Object.entries(this.service['registry'].devices).map(([id, rec]: [string, any]) => ({
      deviceId: id.slice(0, 16) + '...',
      registeredAt: new Date(rec.registeredAt).toLocaleString(),
      lastSeen: new Date(rec.lastSeen).toLocaleString(),
    }));
    return {
      code: 200,
      data: {
        maxSlots: await this.deviceRegistry.getEffectiveMaxSlots(),
        usedSlots: this.service.getUsedSlots(),
        devices,
      },
    };
  }
}