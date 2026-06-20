import type { DeviceRegistryEntry } from './device-registry.types';
export declare class DeviceRegistryService {
    private readonly logger;
    private registry;
    private maxSlots;
    private registryLoaded;
    private supabase;
    private readonly filePath;
    private initSupabase;
    private ensureTable;
    private saveToFile;
    private loadFromFile;
    private ensureLoaded;
    private loadRegistry;
    touchDevice(deviceId: string, ua: string): Promise<{
        allowed: boolean;
        message?: string;
    }>;
    tryRegister(ip: string, ua: string): Promise<{
        allowed: boolean;
        message?: string;
    }>;
    getDevices(): Promise<DeviceRegistryEntry[]>;
    get registeredCount(): number;
    get maxAllowed(): number;
    setMaxSlots(value: number): Promise<{
        success: boolean;
        maxSlots: number;
    }>;
    removeDevice(index: number): Promise<{
        success: boolean;
    }>;
    removeAllDevices(): Promise<{
        success: boolean;
    }>;
    updateRemark(index: number, remark: string): Promise<{
        success: boolean;
    }>;
    private getEffectiveMax;
    private getOrInitSupabase;
    private syncRegistryToSupabase;
}
