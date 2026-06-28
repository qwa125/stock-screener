import { StreamableFile } from '@nestjs/common';
import { AppService } from '@/app.service';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getHello(): {
        status: string;
        data: string;
    };
    getHelloAlias(): {
        status: string;
        data: string;
    };
    getHealth(): {
        status: string;
        data: string;
    };
    downloadDeploy(): StreamableFile;
}
