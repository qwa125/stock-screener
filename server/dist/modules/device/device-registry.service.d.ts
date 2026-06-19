export declare class DeviceRegistryService {
    private readonly logger;
    private readonly supabase;
    private readonly envMaxUsers;
    private runtimeMaxSlots;
    private registry;
    constructor();
    private initializeRegistry;
    private get effectiveMax();
    private syncToSupabase;
    private upsertDevice;
    private deleteDeviceFromDB;
    touchDevice(deviceId: string, ua: string): Promise<{
        allowed: boolean;
        message?: string;
    }>;
    tryRegister(ip: string, ua: string): Promise<{
        allowed: boolean;
        message?: string;
    }>;
    private createFingerprint;
    get registeredCount(): number;
    get maxAllowed(): number;
    setMaxSlots(value: number): Promise<void>;
    private extractDisplayName;
    getDevices(): Array<{
        index: number;
        fingerprint: string;
        displayName: string;
        remark: string;
        firstSeen: number;
        lastSeen: number;
    }>;
    updateRemark(index: number, remark: string): Promise<boolean>;
    removeDevice(index: number): Promise<boolean>;
    clearDevices(): Promise<void>;
}
