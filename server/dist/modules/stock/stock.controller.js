"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var StockController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockController = void 0;
const common_1 = require("@nestjs/common");
const fs = require("fs");
const stock_service_1 = require("./stock.service");
let StockController = StockController_1 = class StockController {
    constructor(stockService) {
        this.stockService = stockService;
        this.logger = new common_1.Logger(StockController_1.name);
    }
    download(res) {
        const filePath = '/tmp/stock-api-server.zip';
        if (fs.existsSync(filePath)) {
            res.download(filePath, 'stock-api-server.zip');
        }
        else {
            res.status(404).json({ code: 404, msg: '文件不存在，请重新生成' });
        }
    }
    downloadMiniapp(res) {
        const filePath = '/tmp/stock-miniapp.zip';
        if (fs.existsSync(filePath)) {
            res.download(filePath, 'stock-miniapp.zip');
        }
        else {
            res.status(404).json({ code: 404, msg: '小程序包不存在，请重新生成' });
        }
    }
    async sinaList(page = '1', num = '100', node = 'sh_a') {
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
            let data;
            try {
                data = JSON.parse(text);
            }
            catch (e) {
                try {
                    const iconv = require('iconv-lite');
                    const buf = Buffer.from(text, 'binary');
                    data = JSON.parse(iconv.decode(buf, 'gbk'));
                }
                catch {
                    return { code: 500, msg: '解析新浪数据失败', data: [] };
                }
            }
            return { code: 200, msg: 'success', data: Array.isArray(data) ? data : [] };
        }
        catch (e) {
            this.logger.error(`获取新浪股票列表失败: ${e.message}`);
            return { code: 500, msg: e.message, data: [] };
        }
    }
    async search(query) {
        if (!query || query.trim().length < 1) {
            return { code: 200, msg: 'success', data: [] };
        }
        try {
            const results = await this.stockService.searchStock(query.trim());
            return { code: 200, msg: 'success', data: results };
        }
        catch (error) {
            this.logger.error(`搜索股票失败: ${error.message}`);
            return { code: 200, msg: 'success', data: [] };
        }
    }
    async analyze(query) {
        if (!query || query.trim().length === 0) {
            return {
                code: 400,
                msg: '请输入股票代码或名称',
                data: null,
            };
        }
        const q = query.trim();
        const pureCode = q.replace(/^(sh|sz|SH|SZ)/, '');
        if (/^\d{6}$/.test(pureCode)) {
            const prefix = pureCode.substring(0, 3);
            const validPrefixes = ['000', '001', '002', '003', '300', '301', '600', '601', '603', '605', '688', '689', '400', '800', '830', '870', '871', '872', '873', '874', '920',
                '159', '161', '501', '502', '506', '510', '511', '512', '513', '515', '516', '517', '518', '520', '560', '561', '562', '563', '588'];
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
        }
        catch (error) {
            this.logger.error(`分析股票失败: ${error.message}`, error.stack);
            return {
                code: 500,
                msg: error.message || '股票分析失败，请检查输入的股票代码是否正确',
                data: null,
            };
        }
    }
};
exports.StockController = StockController;
__decorate([
    (0, common_1.Get)('download'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StockController.prototype, "download", null);
__decorate([
    (0, common_1.Get)('download-miniapp'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StockController.prototype, "downloadMiniapp", null);
__decorate([
    (0, common_1.Get)('sina-list'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('num')),
    __param(2, (0, common_1.Query)('node')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], StockController.prototype, "sinaList", null);
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StockController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('analyze'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StockController.prototype, "analyze", null);
exports.StockController = StockController = StockController_1 = __decorate([
    (0, common_1.Controller)('stock'),
    __metadata("design:paramtypes", [stock_service_1.StockService])
], StockController);
