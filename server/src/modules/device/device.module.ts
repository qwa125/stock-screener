import { Global, Module } from '@nestjs/common';
import { DeviceRegistryService } from './device-registry.service';

@Global()
@Module({
  providers: [DeviceRegistryService],
  exports: [DeviceRegistryService],
})
export class DeviceModule {}