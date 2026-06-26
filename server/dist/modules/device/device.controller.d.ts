import { DeviceRegistryService } from './device-registry.service';
export declare class DeviceController {
    private readonly deviceRegistry;
    private readonly logger;
    constructor(deviceRegistry: DeviceRegistryService);
    register(deviceId: string, ua: string, adminToken?: string): Promise<{
        code: number;
        msg: string;
    }>;
    getSettings(): Promise<{
        code: number;
        data: {
            maxSlots: number;
        };
    }>;
    setSlots(body: {
        maxSlots: number;
    }): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: {
            success: boolean;
            maxSlots: number;
        };
    }>;
    verifyToken(adminToken?: string): Promise<{
        code: number;
        msg: string;
        valid: boolean;
    }>;
    listDevices(): Promise<{
        code: number;
        data: {
            maxSlots: number;
            usedSlots: number;
            devices: {
                index: number;
                fingerprint: string;
                displayName: string | undefined;
                firstSeen: string;
                lastSeen: string;
            }[];
        };
    }>;
    removeDevice(body: {
        index: number;
    }): Promise<{
        code: number;
        msg: string;
    }>;
    resetDevices(): Promise<{
        code: number;
        msg: string;
    }>;
}
