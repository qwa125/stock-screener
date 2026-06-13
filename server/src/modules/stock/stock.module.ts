/**
 * 股票分析模块
 */
import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { DataFetcherService } from './data-fetcher.service';

@Module({
  controllers: [StockController],
  providers: [StockService, DataFetcherService],
  exports: [StockService, DataFetcherService],
})
export class StockModule {}