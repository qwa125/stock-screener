"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const express = require("express");
const path = require("path");
const https = require("https");
const http_status_interceptor_1 = require("./interceptors/http-status.interceptor");
function parsePort() {
    if (process.env.SERVER_PORT) {
        const port = parseInt(process.env.SERVER_PORT, 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
            return port;
        }
    }
    if (process.env.PORT) {
        const port = parseInt(process.env.PORT, 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
            return port;
        }
    }
    const args = process.argv.slice(2);
    const portIndex = args.indexOf('-p');
    if (portIndex !== -1 && args[portIndex + 1]) {
        const port = parseInt(args[portIndex + 1], 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
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
    app.use('/api/stock/sina-list', (req, res) => {
        const page = req.query.page || '1';
        const num = req.query.num || '100';
        const node = req.query.node || 'sh_a';
        const sinaUrl = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${num}&sort=symbol&asc=1&node=${node}`;
        https.get(sinaUrl, { timeout: 15000 }, (sinaRes) => {
            let body = '';
            sinaRes.on('data', (chunk) => (body += chunk));
            sinaRes.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    res.json({ code: 200, data, msg: 'ok' });
                }
                catch {
                    res.status(502).json({ code: 502, data: null, msg: '解析新浪API返回数据失败' });
                }
            });
        }).on('error', (err) => {
            res.status(502).json({ code: 502, data: null, msg: '请求新浪API失败: ' + err.message });
        });
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
            console.error(`❌ 端口 \({port} 被占用! 请运行 'npx kill-port \){port}' 然后重试。`);
            process.exit(1);
        }
        else {
            throw err;
        }
    }
    console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();
