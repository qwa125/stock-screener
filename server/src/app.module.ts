import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { StockModule } from '@/modules/stock/stock.module';
import { SectorModule } from '@/modules/sector/sector.module';
import { GemScreenerModule } from '@/modules/gem-screener/gem-screener.module';
import { AccessControlModule } from '@/modules/access-control/access-control.module';
import { DeviceModule } from '@/modules/device/device.module';
import { AccessLimitGuard } from '@/guards/access-limit.guard';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [AuthModule, StockModule, SectorModule, GemScreenerModule, AccessControlModule, DeviceModule, ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AccessLimitGuard,
    },
  ],
})
export class AppModule {}
