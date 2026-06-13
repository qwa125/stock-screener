/**
 * 股票分析控制器
 * 提供股票查询分析的HTTP接口
 */
import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  private readonly logger = new Logger(StockController.name);

  constructor(private readonly stockService: StockService) {}

  @Get('download')
  download(@Res() res: Response) {
    const filePath = '/tmp/stock-api-server.zip';
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'stock-api-server.zip');
    } else {
      res.status(404).json({ code: 404, msg: '文件不存在，请重新生成' });
    }
  }

  @Get('download-miniapp')
  downloadMiniapp(@Res() res: Response) {
    const filePath = '/tmp/stock-miniapp.zip';
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'stock-miniapp.zip');
    } else {
      res.status(404).json({ code: 404, msg: '小程序包不存在，请重新生成' });
    }
  }

  @Get('search')
  async search(@Query('q') query: string) {
    if (!query || query.trim().length < 1) {
      return { code: 200, msg: 'success', data: [] };
    }
    try {
      const results = await this.stockService.searchStock(query.trim());
      return { code: 200, msg: 'success', data: results };
    } catch (error: any) {
      this.logger.error(`搜索股票失败: ${error.message}`);
      return { code: 200, msg: 'success', data: [] };
    }
  }

  @Get('analyze')
  async analyze(@Query('q') query: string) {
    if (!query || query.trim().length === 0) {
      return {
        code: 400,
        msg: '请输入股票代码或名称',
        data: null,
      };
    }

    const q = query.trim();
    // 股票代码格式校验
    const pureCode = q.replace(/^(sh|sz|SH|SZ)/, '');
    if (/^\d{6}$/.test(pureCode)) {
      const prefix = pureCode.substring(0, 3);
      const validPrefixes = ['000','001','002','003','300','301','600','601','603','605','688','689','400','800','830','870','871','872','873','874','920',
        // ETF / LOF / 场内基金
        '159','161','501','502','506','510','511','512','513','515','516','517','518','520','560','561','562','563','588'];
      if (!validPrefixes.includes(prefix)) {
        return {
          code: 400,
          msg: `无效的股票代码: ${q}，A股代码格式不正确`,
          data: null,
        };
      }
    }

    try {
      const result = await this.stockService.analyzeStock(q);
      return {
        code: 200,
        msg: 'success',
        data: result,
      };
    } catch (error: any) {
      this.logger.error(`分析股票失败: ${error.message}`, error.stack);
      return {
        code: 500,
        msg: error.message || '股票分析失败，请检查输入的股票代码是否正确',
        data: null,
      };
    }
  }
}