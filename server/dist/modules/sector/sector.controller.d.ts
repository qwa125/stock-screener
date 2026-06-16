import { SectorService } from './sector.service';
import { SectorHotResponse } from './sector.types';
export declare class SectorController {
    private readonly sectorService;
    constructor(sectorService: SectorService);
    getHotSectors(): Promise<{
        code: number;
        msg: string;
        data: SectorHotResponse;
    }>;
}
