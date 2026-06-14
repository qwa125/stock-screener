import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeviceRegistryService } from '@/modules/device/device-registry.service';
export declare const SKIP_ACCESS_LIMIT = "skip_access_limit";
export declare const SkipAccessLimit: () => {
    (target: Function): void;
    (target: Object, propertyKey: string | symbol): void;
};
export declare class AccessLimitGuard implements CanActivate {
    private readonly deviceRegistry;
    private readonly reflector;
    constructor(deviceRegistry: DeviceRegistryService, reflector: Reflector);
    canActivate(context: ExecutionContext): boolean;
}
