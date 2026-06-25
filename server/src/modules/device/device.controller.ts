import { Controller, Post, Get, Body, Query, Logger, Headers, HttpException, HttpStatus } from '@nestjs/common'
import { DeviceRegistryService } from './device-registry.service'
import { SkipAccessLimit } from '@/guards/access-limit.guard'

@Controller('device')
export class DeviceController {
  private readonly logger = new Logger(DeviceController.name)

  constructor(private readonly deviceRegistry: DeviceRegistryService) {}

  /** 设备注册：前端页面加载时调用，不限制访问，仅用于记录设备 */
  @Post('register')
  @SkipAccessLimit()
  async register(
    @Headers('x-device-id') deviceId: string,
    @Headers('user-agent') ua: string,
    @Headers('x-admin-token') adminToken?: string,
  ) {
    if (!deviceId) {
      return { code: 400, msg: '缺少设备ID' }
    }
    const isAdmin = adminToken === (process.env.ADMIN_TOKEN || 'admin2025')
    try {
      const result = await this.deviceRegistry.touchDevice(deviceId, ua || 'unknown', isAdmin)
      this.logger.log(`设备注册: ${deviceId.slice(0, 20)} | 允许: ${result.allowed}${isAdmin ? ' [管理员]' : ''}`)
      if (!result.allowed) {
        throw new HttpException(
          { code: 429, msg: result.message || '名额已满' },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      return { code: 200, msg: 'ok' }
    } catch (e) {
      // HttpException 直接透传（保持 HTTP 429 状态码）
      if (e instanceof HttpException) throw e
      this.logger.warn(`设备注册异常: ${(e as Error).message}`)
      throw new HttpException({ code: 500, msg: '设备注册失败' }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /** 获取当前限额配置 */
  @Get('settings')
  @SkipAccessLimit()
  async getSettings() {
    const maxSlots = await this.deviceRegistry.getEffectiveMaxSlots()
    return {
      code: 200,
      data: { maxSlots }
    }
  }

  /** 设置设备限额（需要管理权限） */
  @Post('set-slots')
  @SkipAccessLimit()
  async setSlots(@Body() body: { maxSlots: number }) {
    if (!body.maxSlots || body.maxSlots < 1 || !Number.isInteger(body.maxSlots)) {
      return { code: 400, msg: '无效名额数，请传入正整数' }
    }
    const result = await this.deviceRegistry.setMaxSlots(body.maxSlots)
    return { code: 200, msg: `设备限额已设为 ${body.maxSlots}`, data: result }
  }

  /** 获取设备列表 */
  @Get('list')
  @SkipAccessLimit()
  async listDevices() {
    const devices = await this.deviceRegistry.getDevices()
    return {
      code: 200,
      data: {
        maxSlots: await this.deviceRegistry.getEffectiveMaxSlots(),
        usedSlots: devices.length,
        devices: devices.map((d, i) => ({
          index: i,
          fingerprint: d.fingerprint.slice(0, 16) + '...',
          displayName: d.displayName,
          firstSeen: new Date(d.firstSeen).toLocaleString(),
          lastSeen: new Date(d.lastSeen).toLocaleString(),
        })),
      },
    }
  }

  /** 删除指定设备 */
  @Post('remove')
  @SkipAccessLimit()
  async removeDevice(@Body() body: { index: number }) {
    try {
      await this.deviceRegistry.removeDevice(body.index)
      return { code: 200, msg: '设备已移除' }
    } catch (e) {
      return { code: 400, msg: (e as Error).message }
    }
  }

  /** 重置所有设备 */
  @Post('reset')
  @SkipAccessLimit()
  async resetDevices() {
    await this.deviceRegistry.removeAllDevices()
    return { code: 200, msg: '所有设备已清空' }
  }
}