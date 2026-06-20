import { DeviceRegistryService } from './device-registry.service';
export declare class DeviceController {
    private readonly deviceRegistry;
    private readonly logger;
    constructor(deviceRegistry: DeviceRegistryService);
    register(deviceId: string, ua: string): Promise<{
        code: number;
        msg: string;
    }>;
}
