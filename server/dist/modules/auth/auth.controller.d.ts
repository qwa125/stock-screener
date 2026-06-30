import { DeviceRegistryService } from '@/modules/device/device-registry.service';
import { AuthService } from './auth.service';
export declare class AuthController {
    private readonly auth;
    private readonly deviceRegistry;
    constructor(auth: AuthService, deviceRegistry: DeviceRegistryService);
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
    getMaxSlots(): Promise<{
        maxSlots: number;
        registered: number;
    }>;
    setMaxSlots(body: {
        maxSlots: number;
    }): Promise<{
        ok: boolean;
        maxSlots: number;
    }>;
    getDevices(): Promise<{
        code: number;
        data: {
            devices: {
                firstSeenStr: string;
                lastSeenStr: string;
                fingerprint: string;
                ua: string;
                displayName?: string;
                firstSeen: number;
                lastSeen: number;
                remark?: string;
                isAdmin?: boolean;
            }[];
            total: number;
        };
    }>;
    removeDevice(index: string): Promise<{
        code: number;
        msg: string;
        data?: {
            registered: number;
        };
    }>;
    updateRemark(index: string, body: {
        remark: string;
    }): Promise<{
        code: number;
        msg: string;
    }>;
    clearDevices(): Promise<{
        code: number;
        msg: string;
        data: {
            registered: number;
        };
    }>;
}
