"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const schedule_1 = require("@nestjs/schedule");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const stock_module_1 = require("./modules/stock/stock.module");
const sector_module_1 = require("./modules/sector/sector.module");
const gem_screener_module_1 = require("./modules/gem-screener/gem-screener.module");
const access_control_module_1 = require("./modules/access-control/access-control.module");
const device_module_1 = require("./modules/device/device.module");
const access_limit_guard_1 = require("./guards/access-limit.guard");
const auth_module_1 = require("./modules/auth/auth.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, stock_module_1.StockModule, sector_module_1.SectorModule, gem_screener_module_1.GemScreenerModule, access_control_module_1.AccessControlModule, device_module_1.DeviceModule, schedule_1.ScheduleModule.forRoot()],
        controllers: [app_controller_1.AppController],
        providers: [
            app_service_1.AppService,
            {
                provide: core_1.APP_GUARD,
                useClass: access_limit_guard_1.AccessLimitGuard,
            },
        ],
    })
], AppModule);
