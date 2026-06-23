import { Controller, Post, Headers, Logger } from '@nestjs/common'
import { DeviceRegistryService } from './device-registry.service'
import { SkipAccessLimit } from '@/guards/access-limit.guard'

@Controller('device')
@SkipAccessLimit()
export class DeviceController {
  private readonly logger = new Logger(DeviceController.name)

  constructor(private readonly deviceRegistry: DeviceRegistryService) {}

  /** 设备注册：前端页面加载时调用，不限制访问，仅用于记录设备 */
  @Post('register')
  async register(
    @Headers('x-device-id') deviceId: string,
    @Headers('user-agent') ua: string,
  ) {
    if (!deviceId) {
      return { code: 400, msg: '缺少设备ID' }
    }
    try {
      const result = await this.deviceRegistry.touchDevice(deviceId, ua || 'unknown')
      this.logger.log(`设备注册: ${deviceId.slice(0, 20)} | 允许: ${result.allowed}`)
      return { code: result.allowed ? 200 : 429, msg: result.message || 'ok' }
    } catch (e) {
      this.logger.warn(`设备注册异常: ${(e as Error).message}`)
      return { code: 200, msg: 'ok' } // 不阻塞用户
    }
  }
}