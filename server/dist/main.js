"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const express = __importStar(require("express"));
const path = __importStar(require("path"));
const http_status_interceptor_1 = require("./interceptors/http-status.interceptor");
function parsePort() {
    if (process.env.SERVER_PORT) {
        const port = parseInt(process.env.SERVER_PORT, 10);
        if (!Number.isNaN(port) && port > 0 && port < 65536) {
            return port;
        }
    }
    if (process.env.PORT) {
        const port = parseInt(process.env.PORT, 10);
        if (!Number.isNaN(port) && port > 0 && port < 65536) {
            return port;
        }
    }
    const args = process.argv.slice(2);
    const portIndex = args.indexOf('-p');
    if (portIndex !== -1 && args[portIndex + 1]) {
        const port = parseInt(args[portIndex + 1], 10);
        if (!Number.isNaN(port) && port > 0 && port < 65536) {
            return port;
        }
    }
    return 3000;
}
process.on('uncaughtException', (err) => {
    console.error(`[FATAL] uncaughtException: ${err.message}`, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error(`[FATAL] unhandledRejection:`, reason);
});
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({
        origin: true,
        credentials: true,
    });
    app.setGlobalPrefix('api');
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
    app.useGlobalInterceptors(new http_status_interceptor_1.HttpStatusInterceptor());
    app.enableShutdownHooks();
    const port = parsePort();
    try {
        await app.listen(port);
        console.log(`Server running on http://localhost:${port}`);
    }
    catch (err) {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ 端口 ${port} 被占用! 请运行 'npx kill-port ${port}' 然后重试。`);
            process.exit(1);
        }
        else {
            throw err;
        }
    }
    console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();
