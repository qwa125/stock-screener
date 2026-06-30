import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const JWT_SECRET = process.env.JWT_SECRET || 'stock-screener-secret-key-2025';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  trial_start: string | null;
  trial_end: string | null;
  subscription_end: string | null;
  is_active: boolean;
  created_at: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private _supabase: any = null;

  private get supabase(): any {
    if (!this._supabase) {
      try {
        this._supabase = getSupabaseClient();
      } catch (e) {
        // 在 Render 等无 Supabase 环境下，auth 功能不可用但不影响其他功能
        this.logger.warn('Supabase 未配置，认证功能不可用');
        throw new Error('认证功能未启用（缺少 Supabase 配置）');
      }
    }
    return this._supabase;
  }

  /** 注册新用户（自动赠送 7 天试用） */
  async register(username: string, password: string): Promise<{ token: string; expiresAt: string; trialDaysLeft: number }> {
    // 检查用户名是否已存在
    const sb = this.supabase;
    const { data: existing } = await sb
      .from('users')
      .select('id')
      .eq('username', username)
      .single();

    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await this.supabase
      .from('users')
      .insert({
        username,
        password_hash: passwordHash,
        trial_start: now.toISOString(),
        trial_end: trialEnd.toISOString(),
        subscription_end: null,
        is_active: true,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`注册失败: ${error?.message}`);
      throw new Error('注册失败，请稍后重试');
    }

    const token = this.generateToken(data.id, username, trialEnd.toISOString());
    this.logger.log(`✅ 新用户注册: ${username}, 7天试用至 ${trialEnd.toISOString()}`);

    return {
      token,
      expiresAt: trialEnd.toISOString(),
      trialDaysLeft: 7,
    };
  }

  /** 用户登录 */
  async login(username: string, password: string): Promise<{ token: string; expiresAt: string; trialDaysLeft: number; username: string }> {
    const { data: user, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('账号已禁用');
    }

    const valid = await bcrypt.compare(password, (user as UserRow).password_hash);
    if (!valid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const expiryDate = this.getEffectiveExpiry(user as UserRow);
    const daysLeft = this.getDaysLeft(expiryDate);
    const token = this.generateToken((user as UserRow).id, username, expiryDate);

    return {
      token,
      expiresAt: expiryDate,
      trialDaysLeft: daysLeft,
      username,
    };
  }

  /** 验证 token，返回用户信息 */
  verifyToken(token: string): { userId: string; username: string; expiresAt: string } | null {
    try {
      return jwt.verify(token, JWT_SECRET) as { userId: string; username: string; expiresAt: string };
    } catch {
      return null;
    }
  }

  /** 查询用户当前状态 (含到期计算) */
  async getUserStatus(userId: string): Promise<{
    username: string;
    isExpired: boolean;
    expiresAt: string;
    daysLeft: number;
    isActive: boolean;
  } | null> {
    const { data: user } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) return null;

    const u = user as UserRow;
    const expiryDate = this.getEffectiveExpiry(u);
    const daysLeft = this.getDaysLeft(expiryDate);

    return {
      username: u.username,
      isExpired: daysLeft <= 0,
      expiresAt: expiryDate,
      daysLeft: Math.max(0, daysLeft),
      isActive: u.is_active,
    };
  }

  /** 管理员：延长用户订阅（叠加） */
  async extendSubscription(username: string, extraDays: number): Promise<{ newExpiry: string; totalDaysLeft: number }> {
    const { data: user } = await this.supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (!user) throw new Error('用户不存在');

    const u = user as UserRow;
    const currentExpiry = this.getEffectiveExpiry(u);
    const currentDate = new Date();
    // 如果已过期，从当前时间开始算；否则在现有到期日上叠加
    const baseDate = new Date(currentExpiry) > currentDate ? new Date(currentExpiry) : currentDate;
    const newExpiry = new Date(baseDate.getTime() + extraDays * 24 * 60 * 60 * 1000);

    await this.supabase
      .from('users')
      .update({ subscription_end: newExpiry.toISOString() })
      .eq('id', u.id);

    const totalDaysLeft = this.getDaysLeft(newExpiry.toISOString());

    this.logger.log(`📅 用户 ${username} 延长 ${extraDays} 天, 新到期日: ${newExpiry.toISOString()}`);
    return { newExpiry: newExpiry.toISOString(), totalDaysLeft };
  }

  /** 管理员：设置用户订阅到期日（精确控制） */
  async setExpiryDate(username: string, expiryDate: string): Promise<{ newExpiry: string; totalDaysLeft: number }> {
    const { data: user } = await this.supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (!user) throw new Error('用户不存在');

    await this.supabase
      .from('users')
      .update({ subscription_end: expiryDate })
      .eq('id', (user as UserRow).id);

    const totalDaysLeft = this.getDaysLeft(expiryDate);
    return { newExpiry: expiryDate, totalDaysLeft };
  }

  // ========== 内部方法 ==========

  private generateToken(userId: string, username: string, expiresAt: string): string {
    return jwt.sign({ userId, username, expiresAt }, JWT_SECRET, { expiresIn: '30d' });
  }

  /** 取有效到期日：subscription_end > trial_end > trial_start+7天 */
  private getEffectiveExpiry(user: UserRow): string {
    if (user.subscription_end) return user.subscription_end;
    if (user.trial_end) return user.trial_end;
    // 兜底：从注册起 7 天
    const start = user.trial_start ? new Date(user.trial_start) : new Date(user.created_at);
    return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  private getDaysLeft(expiryDate: string): number {
    const diff = new Date(expiryDate).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}