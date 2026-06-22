import { AccessControlService } from './access-control.service';
import { DeviceRegistryService } from '@/modules/device/device-registry.service';
export declare class AccessControlController {
    private readonly service;
    private readonly deviceRegistry;
    constructor(service: AccessControlService, deviceRegistry: DeviceRegistryService);
    register(body: {
        deviceId: string;
        fingerprint: Record<string, any>;
    }): Promise<{
        code: number;
        msg: string;
        data: {
            allowed: boolean;
            usedSlots: number;
            maxSlots: number;
            registered: boolean;
        };
    }>;
    status(deviceId?: string): Promise<{
        code: number;
        msg: string;
        data: {
            usedSlots: number;
            allowed: boolean;
            maxSlots: number;
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
    listDeviceRegistry(): Promise<{
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
