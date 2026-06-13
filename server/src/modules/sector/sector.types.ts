/** 单个板块的历史K线 */
export interface SectorKLine {
  date: string;
  close: number;
}

/** 龙头股/机会股信息 */
export interface LeadingStock {
  code: string;
  name: string;
  /** 现价 */
  price: number;
  /** 今日涨跌幅 % */
  changePercent: number;
  /** 在行业中的权重 % */
  weight: number;
  /** 累计涨幅(自金叉以来) % */
  priceIncrease?: number;
  /** 价格位置(0~100) */
  pricePosition?: number;
  /** 主力净流入(万元) */
  mainForceInflow?: number;
  /** 综合评分 */
  score?: number;
  /** 金叉持续天数 */
  baiXiaoDays?: number;
  /** DIFF值 */
  diff?: number;
  /** DEA值 */
  dea?: number;
  /** 是否金叉 */
  isGoldenCross?: boolean;
  /** 买点信号类型 */
  buySignal?: string;
}

/** 板块排名结果（含龙头股） */
export interface SectorRankItem {
  code: string;
  name: string;
  /** 当前价 */
  price: number;
  /** 涨跌幅 % */
  changePercent: number;
  /** 涨跌额 */
  changeAmount: number;
  /** 龙头股TOP4 */
  leadingStocks: LeadingStock[];
  /** 机会股票TOP4 */
  opportunityStocks: LeadingStock[];
}

/** 各周期排名结果 */
export interface SectorHotResponse {
  month1: SectorRankItem[];
  bestDay: SectorRankItem[];
  quarter1: SectorRankItem[];
  halfYear: SectorRankItem[];
  year1: SectorRankItem[];
  updateTime: string;
  /** 最后交易日15:00的时间戳(ms) */
  timestamp: number;
}