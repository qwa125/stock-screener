import { AuthService } from './auth.service';
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    register(body: {
        username: string;
        password: string;
    }): Promise<{
        code: number;
        msg: string;
        data: {
            token: string;
            expiresAt: string;
            trialDaysLeft: number;
        };
    } | {
        code: number;
        msg: any;
        data?: undefined;
    }>;
    login(body: {
        username: string;
        password: string;
    }): Promise<{
        code: number;
        msg: string;
        data: {
            token: string;
            expiresAt: string;
            trialDaysLeft: number;
            username: string;
        };
    } | {
        code: number;
        msg: any;
        data?: undefined;
    }>;
    me(auth: string): Promise<{
        code: number;
        msg: string;
        data: {
            isExpired: boolean;
            daysLeft: number;
        };
    } | {
        code: number;
        msg: string;
        data: {
            username: string;
            isExpired: boolean;
            expiresAt: string;
            daysLeft: number;
            isActive: boolean;
        };
    }>;
    extend(body: {
        username: string;
        days: number;
    }): Promise<{
        code: number;
        msg: string;
        data: {
            newExpiry: string;
            totalDaysLeft: number;
        };
    } | {
        code: number;
        msg: any;
        data?: undefined;
    }>;
    setExpiry(body: {
        username: string;
        expiryDate: string;
    }): Promise<{
        code: number;
        msg: string;
        data: {
            newExpiry: string;
            totalDaysLeft: number;
        };
    } | {
        code: number;
        msg: any;
        data?: undefined;
    }>;
}
