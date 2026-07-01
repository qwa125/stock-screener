import { DeviceRegistryService } from '@/modules/device/device-registry.service';
import { AccessControlService } from './access-control.service';
export declare class AccessControlController {
    private readonly service;
    private readonly deviceRegistry;
    constructor(service: AccessControlService, deviceRegistry: DeviceRegistryService);
    register(deviceId: string, adminToken?: string, ua?: string): Promise<{
        code: number;
        msg: string;
        data?: undefined;
    } | {
        code: number;
        msg: string;
        data: {
            registered: boolean;
            maxSlots: number;
            usedSlots: number;
        };
    }>;
    status(deviceId?: string): Promise<{
        code: number;
        msg: string;
        data: {
            maxSlots: number;
            usedSlots: number;
            allowed: boolean;
            registered: boolean;
        };
    }>;
    setSlotsPost(body: {
        maxSlots: number;
    }): Promise<{
        code: number;
        msg: string;
    }>;
    setSlotsGet(maxSlots: string): Promise<{
        code: number;
        msg: string;
    }>;
    private setSlots;
    reset(): Promise<{
        code: number;
        msg: string;
    }>;
    exportRegistry(): Promise<{
        code: number;
        data: {
            base64: string;
            usedSlots: number;
            maxSlots: number;
            hint: string;
        };
    }>;
    listDevices(): Promise<{
        code: number;
        data: {
            maxSlots: number;
            usedSlots: number;
            devices: {
                deviceId: string;
                registeredAt: string;
                lastSeen: string;
            }[];
        };
    }>;
}
