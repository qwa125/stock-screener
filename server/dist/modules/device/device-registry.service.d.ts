import { OnModuleInit } from '@nestjs/common';
import type { DeviceRegistryEntry } from './device-registry.types';
export declare class DeviceRegistryService implements OnModuleInit {
    private readonly logger;
    private registry;
    private maxSlots;
    private registryLoaded;
    private supabase;
    private readonly filePath;
    private readonly settingsPath;
    onModuleInit(): Promise<void>;
    private initSupabase;
    private createTablesIfNeeded;
    private warmUpSchema;
    private saveToFile;
    private loadFromFile;
    private loadSettingsFromDB;
    private saveSettingsToDB;
    private writeSettingsFileFallback;
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
    registeredCount(): Promise<number>;
    get maxAllowed(): number;
    getEffectiveMaxSlots(): Promise<number>;
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
