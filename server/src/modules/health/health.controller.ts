import { Controller, Get, HttpCode } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  @HttpCode(200)
  async health() {
    return { code: 200, msg: 'success', data: { status: 'ok', timestamp: Date.now() } };
  }
}