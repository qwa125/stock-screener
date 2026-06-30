"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const supabase_client_1 = require("../../storage/database/supabase-client");
const JWT_SECRET = process.env.JWT_SECRET || 'stock-screener-secret-key-2025';
let AuthService = AuthService_1 = class AuthService {
    constructor() {
        this.logger = new common_1.Logger(AuthService_1.name);
        this._supabase = null;
    }
    get supabase() {
        if (!this._supabase) {
            try {
                this._supabase = (0, supabase_client_1.getSupabaseClient)();
            }
            catch (e) {
                this.logger.warn('Supabase 未配置，认证功能不可用');
                throw new Error('认证功能未启用（缺少 Supabase 配置）');
            }
        }
        return this._supabase;
    }
    async register(username, password) {
        const sb = this.supabase;
        const { data: existing } = await sb
            .from('users')
            .select('id')
            .eq('username', username)
            .single();
        if (existing) {
            throw new common_1.ConflictException('用户名已存在');
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
    async login(username, password) {
        const { data: user, error } = await this.supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();
        if (error || !user) {
            throw new common_1.UnauthorizedException('用户名或密码错误');
        }
        if (!user.is_active) {
            throw new common_1.UnauthorizedException('账号已禁用');
        }
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            throw new common_1.UnauthorizedException('用户名或密码错误');
        }
        const expiryDate = this.getEffectiveExpiry(user);
        const daysLeft = this.getDaysLeft(expiryDate);
        const token = this.generateToken(user.id, username, expiryDate);
        return {
            token,
            expiresAt: expiryDate,
            trialDaysLeft: daysLeft,
            username,
        };
    }
    verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        }
        catch {
            return null;
        }
    }
    async getUserStatus(userId) {
        const { data: user } = await this.supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();
        if (!user)
            return null;
        const u = user;
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
    async extendSubscription(username, extraDays) {
        const { data: user } = await this.supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();
        if (!user)
            throw new Error('用户不存在');
        const u = user;
        const currentExpiry = this.getEffectiveExpiry(u);
        const currentDate = new Date();
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
    async setExpiryDate(username, expiryDate) {
        const { data: user } = await this.supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();
        if (!user)
            throw new Error('用户不存在');
        await this.supabase
            .from('users')
            .update({ subscription_end: expiryDate })
            .eq('id', user.id);
        const totalDaysLeft = this.getDaysLeft(expiryDate);
        return { newExpiry: expiryDate, totalDaysLeft };
    }
    generateToken(userId, username, expiresAt) {
        return jwt.sign({ userId, username, expiresAt }, JWT_SECRET, { expiresIn: '30d' });
    }
    getEffectiveExpiry(user) {
        if (user.subscription_end)
            return user.subscription_end;
        if (user.trial_end)
            return user.trial_end;
        const start = user.trial_start ? new Date(user.trial_start) : new Date(user.created_at);
        return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    getDaysLeft(expiryDate) {
        const diff = new Date(expiryDate).getTime() - Date.now();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)()
], AuthService);
