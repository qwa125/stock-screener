import { Module } from '@nestjs/common';
import { GemScreenerController } from './gem-screener.controller';
import { GemScreenerService } from './gem-screener.service';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [StockModule],
  controllers: [GemScreenerController],
  providers: [GemScreenerService],
  exports: [GemScreenerService],
})
export class GemScreenerModule {}