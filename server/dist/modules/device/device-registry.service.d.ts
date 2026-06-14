export declare class DeviceRegistryService {
    private readonly logger;
    private readonly REGISTRY_FILE;
    private readonly maxUsers;
    private registry;
    constructor();
    private loadRegistry;
    private saveRegistry;
    private createFingerprint;
    tryRegister(ip: string, ua: string): {
        allowed: boolean;
        message?: string;
    };
    get registeredCount(): number;
    get maxAllowed(): number;
}
