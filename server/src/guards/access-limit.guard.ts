import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeviceRegistryService } from '@/modules/device/device-registry.service';

/** 标记路由是否跳过访问限制 */
export const SKIP_ACCESS_LIMIT = 'skip_access_limit';
export const SkipAccessLimit = () => Reflect.metadata(SKIP_ACCESS_LIMIT, true);

@Injectable()
export class AccessLimitGuard implements CanActivate {
  constructor(
    private readonly deviceRegistry: DeviceRegistryService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // 检查是否标记为跳过
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ACCESS_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || request.headers['x-real-ip']
      || request.ip
      || 'unknown';
    const ua = request.headers['user-agent'] || 'unknown';

    const result = this.deviceRegistry.tryRegister(ip, ua);
    if (!result.allowed) {
      throw new HttpException(
        { code: 429, msg: result.message, data: null },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}