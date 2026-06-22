/**
 * 股票分析控制器
 * 提供股票查询分析的HTTP接口
 */
import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { StockService } from './stock.service';
import { SkipAccessLimit } from '@/guards/access-limit.guard';

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

  @SkipAccessLimit()
  @Get('sina-list')
  async sinaList(
    @Query('page') page: string = '1',
    @Query('num') num: string = '100',
    @Query('node') node: string = 'sh_a',
  ) {
    try {
      const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${num}&sort=symbol&asc=1&node=${node}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://finance.sina.com.cn/',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return { code: 500, msg: `新浪API返回HTTP ${res.status}`, data: [] };
      }
      const text = await res.text();
      // 兼容可能的GBK编码
      let data;
      try { data = JSON.parse(text); } catch (e) {
        try {
          const iconv = require('iconv-lite');
          const buf = Buffer.from(text, 'binary');
          data = JSON.parse(iconv.decode(buf, 'gbk'));
        } catch { return { code: 500, msg: '解析新浪数据失败', data: [] }; }
      }
      return { code: 200, msg: 'success', data: Array.isArray(data) ? data : [] };
    } catch (e: any) {
      this.logger.error(`获取新浪股票列表失败: ${e.message}`);
      return { code: 500, msg: e.message, data: [] };
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

  @SkipAccessLimit()
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