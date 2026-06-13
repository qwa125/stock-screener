import { Module } from '@nestjs/common';
import { SectorController } from './sector.controller';
import { SectorService } from './sector.service';
import { StockModule } from '../stock/stock.module';
import { GemScreenerModule } from '../gem-screener/gem-screener.module';

@Module({
  imports: [StockModule, GemScreenerModule],
  controllers: [SectorController],
  providers: [SectorService],
  exports: [SectorService],
})
export class SectorModule {}