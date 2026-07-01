import { OnApplicationBootstrap } from '@nestjs/common';
export declare class AccessControlService implements OnApplicationBootstrap {
    private readonly logger;
    private readonly REGISTRY_FILE;
    private registry;
    constructor();
    onApplicationBootstrap(): Promise<void>;
    private saveRegistry;
    exportRegistryAsBase64(): string;
    getMaxSlots(): number;
    getUsedSlots(): number;
    setMaxSlots(n: number): Promise<void>;
    isDeviceRegistered(deviceId: string): boolean;
    hasAvailableSlot(): boolean;
    registerDevice(deviceId: string, fingerprint: Record<string, any>, isAdmin?: boolean): Promise<{
        success: boolean;
        reason?: string;
        isAdmin?: boolean;
    }>;
    resetRegistry(): Promise<void>;
    getStatus(deviceId?: string): {
        allowed: boolean;
        usedSlots: number;
        maxSlots: number;
        registered: boolean;
    };
}
