import { Module } from '@nestjs/common';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { StockModule } from '@/modules/stock/stock.module';
import { SectorModule } from '@/modules/sector/sector.module';
import { GemScreenerModule } from '@/modules/gem-screener/gem-screener.module';
import { AccessControlModule } from '@/modules/access-control/access-control.module';

@Module({
  imports: [StockModule, SectorModule, GemScreenerModule, AccessControlModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
