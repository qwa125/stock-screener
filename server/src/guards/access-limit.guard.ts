import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeviceRegistryService } from '@/modules/device/device-registry.service';
import { AuthService } from '@/modules/auth/auth.service';

/** 标记路由是否跳过访问限制 */
export const SKIP_ACCESS_LIMIT = 'skip_access_limit';
export const SkipAccessLimit = () => Reflect.metadata(SKIP_ACCESS_LIMIT, true);

@Injectable()
export class AccessLimitGuard implements CanActivate {
  private readonly logger = new Logger(AccessLimitGuard.name);

  constructor(
    private readonly deviceRegistry: DeviceRegistryService,
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // 检查是否标记为跳过（如 /api/auth/*、/api/access/*）
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ACCESS_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    // ══════════════════════════════════
    // 有 Bearer token → 按用户订阅检查
    // ══════════════════════════════════
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = this.auth.verifyToken(token);
      if (!payload) {
        // token 无效或过期
        return true; // 放行，让前端自行通过 /me 接口判断
      }
      // 异步查询用户状态
      void this.auth.getUserStatus(payload.userId).then((status) => {
        if (status && status.isExpired) {
          this.logger.warn(`⛔ 用户 ${payload.username} 已过期`);
        }
      });
      // 同步快速判断：如果 token 内嵌的 expiresAt 已过，返回过期
      if (new Date(payload.expiresAt).getTime() < Date.now()) {
        throw new HttpException(
          { code: 403, msg: '您的试用/订阅已过期，请续费', data: { isExpired: true, daysLeft: 0 } },
          HttpStatus.FORBIDDEN,
        );
      }
      // 将用户信息注入 request，供 controller 使用
      request.user = payload;
      return true; // 订阅有效 → 放行
    }

    // ══════════════════════════════════
    // 无 token → 按设备限制检查（兜底）
    // ══════════════════════════════════
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