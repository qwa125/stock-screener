"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GemScreenerModule = void 0;
const common_1 = require("@nestjs/common");
const gem_screener_controller_1 = require("./gem-screener.controller");
const gem_screener_service_1 = require("./gem-screener.service");
const stock_module_1 = require("../stock/stock.module");
let GemScreenerModule = class GemScreenerModule {
};
exports.GemScreenerModule = GemScreenerModule;
exports.GemScreenerModule = GemScreenerModule = __decorate([
    (0, common_1.Module)({
        imports: [stock_module_1.StockModule],
        controllers: [gem_screener_controller_1.GemScreenerController],
        providers: [gem_screener_service_1.GemScreenerService],
        exports: [gem_screener_service_1.GemScreenerService],
    })
], GemScreenerModule);
