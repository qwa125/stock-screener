import { Controller, Post, Get, Body, Query, Headers, HttpCode, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SkipAccessLimit } from '@/guards/access-limit.guard';

@Controller('auth')
@SkipAccessLimit()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 注册（自动赠送 7 天试用） */
  @Post('register')
  async register(@Body() body: { username: string; password: string }) {
    if (!body.username || body.username.length < 2) {
      return { code: 400, msg: '用户名至少 2 个字符' };
    }
    if (!body.password || body.password.length < 4) {
      return { code: 400, msg: '密码至少 4 个字符' };
    }
    try {
      const result = await this.auth.register(body.username, body.password);
      return { code: 200, msg: '注册成功，赠送 7 天试用', data: result };
    } catch (e: any) {
      return { code: 409, msg: e.message || '注册失败' };
    }
  }

  /** 登录 */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { username: string; password: string }) {
    try {
      const result = await this.auth.login(body.username, body.password);
      return { code: 200, msg: '登录成功', data: result };
    } catch (e: any) {
      return { code: 401, msg: e.message || '登录失败' };
    }
  }

  /** 查询当前用户状态 */
  @Get('me')
  async me(@Headers('authorization') auth: string) {
    if (!auth || !auth.startsWith('Bearer ')) {
      return { code: 401, msg: '未登录', data: { isExpired: true, daysLeft: 0 } };
    }
    const token = auth.slice(7);
    const payload = this.auth.verifyToken(token);
    if (!payload) {
      return { code: 401, msg: '登录已过期，请重新登录', data: { isExpired: true, daysLeft: 0 } };
    }
    const status = await this.auth.getUserStatus(payload.userId);
    if (!status) {
      return { code: 401, msg: '用户不存在', data: { isExpired: true, daysLeft: 0 } };
    }
    return { code: 200, msg: status.isExpired ? '已过期' : '有效', data: status };
  }

  /** (管理员) 延长用户订阅 */
  @Post('extend')
  async extend(@Body() body: { username: string; days: number }) {
    if (!body.username || !body.days || body.days < 1) {
      return { code: 400, msg: '请提供用户名和有效天数' };
    }
    try {
      const result = await this.auth.extendSubscription(body.username, body.days);
      return { code: 200, msg: `已为 ${body.username} 延长 ${body.days} 天`, data: result };
    } catch (e: any) {
      return { code: 404, msg: e.message };
    }
  }

  /** (管理员) 精确设置到期日 */
  @Post('set-expiry')
  async setExpiry(@Body() body: { username: string; expiryDate: string }) {
    if (!body.username || !body.expiryDate) {
      return { code: 400, msg: '请提供用户名和到期日期' };
    }
    try {
      const result = await this.auth.setExpiryDate(body.username, body.expiryDate);
      return { code: 200, msg: `已设置 ${body.username} 到期日为 ${body.expiryDate}`, data: result };
    } catch (e: any) {
      return { code: 404, msg: e.message };
    }
  }
}