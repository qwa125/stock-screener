/**
 * 市场时间工具
 * A股交易时间：
 *   集合竞价：9:15 - 9:25
 *   连续竞价：9:30 - 11:30, 13:00 - 15:00
 *   收盘：15:00
 * 周末/节假日：不交易
 * 交易日：周一 ~ 周五
 */

/** 获取当前时间（东八区） */
function now(): Date {
  // 使用东八区时间判断，确保 Render（UTC）也能正确识别 A 股交易时段
  const cst = new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' });
  return new Date(cst);
}

/** 是否是交易日（周一至周五） */
export function isTradingDay(): boolean {
  const day = now().getDay();
  return day >= 1 && day <= 5;
}

/** 午休（11:30 - 13:00） */
export function isLunchBreak(): boolean {
  if (!isTradingDay()) return false;
  const h = now().getHours();
  const m = now().getMinutes();
  const t = h * 100 + m;
  return t >= 1130 && t < 1300;
}

/** 盘中（9:15 - 15:00，含集合竞价和连续竞价时段，不含午休11:30-13:00） */
export function isMarketOpen(): boolean {
  if (!isTradingDay() || isLunchBreak()) return false;
  const h = now().getHours();
  const m = now().getMinutes();
  const t = h * 100 + m;
  return t >= 915 && t < 1500;
}

/**
 * 盘后（15:00 之后，包括周末）
 * 注意：当天收盘后也算盘后，不再刷新数据
 */
export function isAfterMarketClose(): boolean {
  if (!isTradingDay()) return true; // 周末算盘后
  const h = now().getHours();
  const m = now().getMinutes();
  const t = h * 100 + m;
  return t >= 1500;
}

/** 获取盘后缓存 TTL（冻结缓存，一年不过期 = 不刷新） */
export function getAfterMarketTTL(): number {
  return 365 * 24 * 60 * 60 * 1000; // 1年
}

/** 盘中的正常缓存 TTL */
export function getMarketOpenTTL(): number {
  return 5 * 60 * 1000; // 5分钟
}

/**
 * 根据市场时间获取缓存 TTL
 * 盘中：5分钟
 * 盘后/周末：1年（冻结）
 */
export function getCacheTTL(staleTTL = 5 * 60 * 1000): { ttl: number; staleTTL: number; canRefresh: boolean } {
  if (isMarketOpen()) {
    return { ttl: getMarketOpenTTL(), staleTTL, canRefresh: true };
  }
  return { ttl: getAfterMarketTTL(), staleTTL: getAfterMarketTTL(), canRefresh: false };
}

/** 获取下一个交易日的开盘时间戳（周一 9:15） */
export function getNextOpenTime(): number {
  const d = now();
  let daysToAdd = 0;
  const day = d.getDay();
  if (day === 0) daysToAdd = 1;       // 周日 → 周一
  else if (day === 6) daysToAdd = 2;  // 周六 → 周一
  else {
    const h = d.getHours();
    const m = d.getMinutes();
    const t = h * 100 + m;
    if (t >= 1500) {
      // 当天已收盘，算下一个交易日
      daysToAdd = day === 5 ? 3 : 1;  // 周五→周一，其他→次日
    }
    // 盘中的数据正常刷新，不需要跳
  }
  d.setDate(d.getDate() + daysToAdd);
  d.setHours(9, 15, 0, 0);
  return d.getTime();
}