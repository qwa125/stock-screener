import { Body, Controller, Get, Logger, Put } from '@nestjs/common';
import { SkipAccessLimit } from '../../guards/access-limit.guard';
import { existsSync, readFileSync, writeFileSync } from 'fs';

@SkipAccessLimit()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly REGISTRY_FILE = '/tmp/device-registry.json';

  @Get('status')
  getStatus(): { ok: boolean } {
    return { ok: true };
  }

  /** 获取当前设备限额 */
  @Get('max-slots')
  getMaxSlots(): { maxSlots: number; registered: number } {
    let registered = 0;
    let maxSlots = 10;
    try {
      if (existsSync(this.REGISTRY_FILE)) {
        const raw = readFileSync(this.REGISTRY_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (typeof parsed.maxSlots === 'number') maxSlots = parsed.maxSlots;
          if (parsed.devices && typeof parsed.devices === 'object') {
            registered = Object.keys(parsed.devices).length;
          }
        } else if (Array.isArray(parsed)) {
          registered = parsed.length;
        }
      }
    } catch { /* ignore */ }
    return { maxSlots, registered };
  }

  /** 设置设备限额（立即生效，无需重启） */
  @Put('max-slots')
  setMaxSlots(@Body() body: { maxSlots: number }): { ok: boolean; maxSlots: number } {
    const slots = Math.max(1, Math.min(100, Math.round(body.maxSlots)));
    let data: any = {};
    try {
      if (existsSync(this.REGISTRY_FILE)) {
        const raw = readFileSync(this.REGISTRY_FILE, 'utf-8');
        data = JSON.parse(raw);
      }
    } catch { /* ignore */ }

    if (typeof data !== 'object' || Array.isArray(data)) {
      data = { devices: {} };
    }
    data.maxSlots = slots;

    writeFileSync(this.REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf-8');
    this.logger.log(`🔐 设备限额已更新为 ${slots}`);
    return { ok: true, maxSlots: slots };
  }
}