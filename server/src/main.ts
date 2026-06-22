import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import * as express from 'express';
import * as path from 'path';
import { HttpStatusInterceptor } from '@/interceptors/http-status.interceptor';

function parsePort(): number {
  // 自定义 SERVER_PORT 环境变量优先（本地开发使用 3000）
  if (process.env.SERVER_PORT) {
    const port = parseInt(process.env.SERVER_PORT, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  // Render 云平台 PORT 环境变量
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  // 命令行参数 -p
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

// 全局未捕获异常处理，防止进程意外退出
process.on('uncaughtException', (err) => {
  console.error(`[FATAL] uncaughtException: ${err.message}`, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[FATAL] unhandledRejection:`, reason);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.setGlobalPrefix('api');
  // 托管 H5 前端页面
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // 全局拦截器：统一将 POST 请求的 201 状态码改为 200
  app.useGlobalInterceptors(new HttpStatusInterceptor());
  // 1. 开启优雅关闭 Hooks (关键!)
  app.enableShutdownHooks();

  // 2. 解析端口
  const port = parsePort();
  try {
    await app.listen(port);
    console.log(`Server running on http://localhost:${port}`);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ 端口 \({port} 被占用! 请运行 'npx kill-port \){port}' 然后重试。`);
      process.exit(1);
    } else {
      throw err;
    }
  }
  console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();
