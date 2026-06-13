import { Controller, Get, StreamableFile, Header } from '@nestjs/common';
import { createReadStream } from 'fs';
import { join } from 'path';
import { AppService } from '@/app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/')
  getHello(): { status: string; data: string } {
    return {
      status: 'success',
      data: this.appService.getHello()
    };
  }

  @Get('hello')
  getHelloAlias(): { status: string; data: string } {
    return this.getHello();
  }

  @Get('health')
  getHealth(): { status: string; data: string } {
    return {
      status: 'success',
      data: new Date().toISOString(),
    };
  }

  @Get('download-deploy')
  @Header('Content-Type', 'application/zip')
  @Header('Content-Disposition', 'attachment; filename="deploy-package.zip"')
  downloadDeploy(): StreamableFile {
    const file = createReadStream(join(process.cwd(), 'public', 'deploy-package.zip'));
    return new StreamableFile(file);
  }
}