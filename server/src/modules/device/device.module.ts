import { Global, Module } from '@nestjs/common';
import { DeviceRegistryService } from './device-registry.service';
import { DeviceController } from './device.controller';

@Global()
@Module({
  controllers: [DeviceController],
  providers: [DeviceRegistryService],
  exports: [DeviceRegistryService],
})
export class DeviceModule {}