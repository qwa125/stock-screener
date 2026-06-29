import { OnModuleInit } from '@nestjs/common';
import type { DeviceRegistryEntry } from './device-registry.types';
export declare class DeviceRegistryService implements OnModuleInit {
    private readonly logger;
    private registry;
    private maxSlots;
    private registryLoaded;
    private pgSql;
    private readonly filePath;
    private readonly settingsPath;
    onModuleInit(): Promise<void>;
    private loadSettingsFromFile;
    private initPostgres;
    private createPGTables;
    private saveToFile;
    private loadFromFile;
    private loadSettingsFromDB;
    private saveSettingsToDB;
    private ensureLoaded;
    private loadRegistryFromPG;
    touchDevice(deviceId: string, ua: string, isAdmin?: boolean): Promise<{
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
}
