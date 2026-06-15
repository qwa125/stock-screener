import { AuthService } from './auth.service';
import { DeviceRegistryService } from '@/modules/device/device-registry.service';
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
    getMaxSlots(): {
        maxSlots: number;
        registered: number;
    };
    setMaxSlots(body: {
        maxSlots: number;
    }): {
        ok: boolean;
        maxSlots: number;
    };
    getDevices(): {
        code: number;
        data: {
            devices: {
                displayName: string;
                firstSeenStr: string;
                lastSeenStr: string;
                index: number;
                fingerprint: string;
                firstSeen: number;
                lastSeen: number;
            }[];
            total: number;
        };
    };
    removeDevice(index: string): {
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: {
            registered: number;
        };
    };
    clearDevices(): {
        code: number;
        msg: string;
        data: {
            registered: number;
        };
    };
}
