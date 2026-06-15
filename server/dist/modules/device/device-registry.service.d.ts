export declare class DeviceRegistryService {
    private readonly logger;
    private readonly REGISTRY_FILE;
    private readonly envMaxUsers;
    private runtimeMaxSlots;
    private registry;
    constructor();
    private loadRegistry;
    private get effectiveMax();
    private saveRegistry;
    private createFingerprint;
    private reloadRuntimeSlots;
    tryRegister(ip: string, ua: string): {
        allowed: boolean;
        message?: string;
    };
    get registeredCount(): number;
    get maxAllowed(): number;
    setMaxSlots(value: number): void;
}
