export declare class HealthController {
    health(): Promise<{
        code: number;
        msg: string;
        data: {
            status: string;
            timestamp: number;
        };
    }>;
}
