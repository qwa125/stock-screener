/** 单根K线数据 */
export interface KLine {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

/** 股票基本信息 */
export interface StockInfo {
  code: string;
  name: string;
  market: number; // 1=上证, 0=深证
}

/** 位置区域枚举 */
export enum PositionZone {
  LOW = '低位区',
  MID = '中位区',
  HIGH_ALERT = '高位警戒区',
  HIGH_RISK = '高风险区',
  EXTREME_RISK = '极端风险区',
}

/** 趋势状态 */
export enum TrendState {
  DOWN = 0,     // 下降
  SIDEWAYS = 1, // 震荡
  UP_MILD = 2,  // 上升
  UP_STRONG = 3, // 主升浪
}

/** 公式计算结果 */
export interface FormulaResult {
  // === 白△结果 ===
  /** 股价位置值 */
  pricePosition: number;
  /** 位置区域 */
  positionZone: PositionZone;
  /** 趋势状态 */
  trendState: TrendState;
  /** 趋势强度 */
  trendStrength: number;
  /** 集中度替代（公式内部用于形态判断） */
  concentration: number;
  /** 集中度90标准展示（同花顺风格） */
  concentrationDisplay: number;
  /** 量能结构 */
  volumeStructure: number;
  /** 短线买入信号 */
  shortBuy: boolean;
  /** 短线卖出信号 */
  shortSell: boolean;
  /** 严格买入信号 */
  strictBuy: boolean;
  /** 强化卖出信号 */
  strongSell: boolean;
  /** 主力吸筹 */
  zhuLiXiChou: boolean;
  /** 主力出货 */
  zhuLiChuHuo: boolean;
  /** 洗盘信号 */
  xiPanSignal: boolean;
  /** 卖出后冷却 */
  coolingAfterSell: boolean;
  /** 冷却期趋势买点 */
  coolingTrendBuy: boolean;
  /** 震荡买点（震荡区间+短线买入组合） */
  zhenDangMaiDian: boolean;
  /** 中位主升（价格中位+严格买入+趋势向上） */
  zhongWeiZhuSheng: boolean;
  /** 中高位主升（价格中高位+强烈买入信号） */
  zhongGaoWeiZhuSheng: boolean;
  /** 高风险主升（高风险区域+主力行为） */
  gaoFengXianZhuSheng: boolean;
  /** 横盘突破（白消后期横盘后放量突破） */
  hengPanTuPo: boolean;
  /** 企稳（价格企稳止跌） */
  qiWen: boolean;
  /** 条件成立（综合条件满足） */
  tiaoJianChengLi: boolean;
  /** 空的（无信号/仅观望） */
  kong: boolean;
  /** 四大最佳买点详情 */
  bestBuyPoints: string[];
  /** 冲突信号 */
  conflict: string | null;

  // === 白◇结果 ===
  /** 白◇-严格买入信号 */
  buySignalDiamond: boolean;
  /** 白◇-洗盘后反转买点 */
  xiPanFanZhuanBuy: boolean;
  /** 白◇-主升中位出货 */
  zhuShengZhongWeiChuHuo: boolean;
  /** 白◇-真实出货 */
  zhenShiChuHuo: boolean;
  /** 白◇-洗盘确认 */
  xiPanQueRen: boolean;

  // === 白☆结果 ===
  /** DIFF值 */
  diff: number;
  /** DEA值 */
  dea: number;
  /** 生命线 */
  lifeLine: number;
  /** 压力位 */
  pressure: number;
  /** 是否白消状态（压力<=DIFF且非强制覆盖） */
  baiXiao: boolean;
  /** 白消天数 */
  baiXiaoDays: number;
  /** 白消纯天数（只看 压力<=DIFF，无视强制覆盖） */
  baiXiaoPureDays?: number;
  /** 是否白布状态（压力>DIFF或强制覆盖） */
  baiBu: boolean;
  /** 白布连续天数 */
  baiBuDays?: number;
  /** 白布/白消覆盖状态变化趋势：exiting(刚出白布), entering(刚进白布), stable(稳定) */
  baiCoverTrend?: 'exiting' | 'entering' | 'stable';
  /** 底部买点 */
  diBuBuy: boolean;
  /** 高位回调买点 */
  gaoWeiHuiDiaoBuy: boolean;
  /** 主力试盘 */
  zhuLiShiPan: boolean;
  /** 加仓信号 */
  jiaCang: boolean;
  /** 高开低走清仓 */
  gaoKaiDiZouQingCang: boolean;
  /** 爆量覆盖清仓 */
  baoLiangFuGaiQingCang: boolean;
  /** 破5日线 */
  po5RiXian: boolean;
  /** 阴跌破位 */
  yinDiePoWei: boolean;
  /** 白消买点1 */
  baiXiaoBuy1: boolean;
  /** 白消买点2 */
  baiXiaoBuy2: boolean;
  /** 强势回踩买点 */
  qiangShiHuiCai: boolean;
  /** 强制覆盖 */
  qiangZhiFuGai: boolean;
  /** 洗盘豁免 */
  xiPanHuoMian: boolean;
  /** 安全 */
  safe: boolean;

  // === ☆★结果 ===
  /** 机构活跃度值 */
  jiGouHuoYueDu: number;
  /** 是否突破生命线(1.56) */
  breakLifeLine: boolean;
  /** 是否突破强势线(3) */
  breakStrongLine: boolean;
  /** 是否突破大牛线(6) */
  breakBigBullLine: boolean;

  // === 扩展数据（数组） ===
  /** 机构活跃度完整数组（用于历史买点扫描） */
  jiGouHuoYueDuArray?: number[];
  /** 白布状态完整数组 */
  baiBuArray?: boolean[];
  /** 白消状态完整数组 */
  baiXiaoArray?: boolean[];
}

/** 回测统计结果 */
export interface BacktestStats {
  /** 形态名称 */
  patternName: string;
  /** 近一年出现次数 */
  totalOccurrences: number;
  /** N日后上涨概率 */
  upProbability: { days: number; probability: number; avgReturn: number }[];
  /** 盈亏比 */
  profitLossRatio: number;
  /** 最大回撤 */
  maxDrawdown: number;
}

/** 信号条目（中性描述，不包含买卖建议） */
export interface SignalEntry {
  name: string;
  type: 'positive' | 'negative' | 'neutral' | 'warning';
  description?: string;
}

/** 股票分析完整结果 */
export interface StockAnalysisResult {
  /** 股票信息 */
  stock: StockInfo;
  /** 最新价格 */
  currentPrice: number;
  /** 涨跌幅 */
  changePercent: number;
  /** 今日最高价 */
  high?: number;
  /** 今日最低价 */
  low?: number;
  /** K线数据条数 */
  klineCount: number;
  /** 公式结果 */
  formula: FormulaResult;
  /** 中性信号列表 */
  signals?: SignalEntry[];
  /** 历史回测统计 */
  backtestStats?: BacktestStats;
  /** 交易建议 */
  suggestion?: string;
}

/** 股票筛选条件 */
export interface ScreenerCriteria {
  /** 市盈率上限 */
  maxPe?: number;
  /** 市盈率下限 */
  minPe?: number;
  /** ROE下限 (%) */
  minRoe?: number;
  /** 营收增长率下限 (%) */
  minRevenueGrowth?: number;
  /** 市值范围 (亿) */
  minMarketCap?: number;
  maxMarketCap?: number;
  /** 排除ST */
  excludeST?: boolean;
  /** 板块代码 */
  sectorCode?: string;
}

/** 筛选结果条目 */
export interface ScreenerResultItem {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  pe?: number;
  roe?: number;
  marketCap?: number;
  revenueGrowth?: number;
}