/**
 * A股交易时间判断工具
 * 适用时段：周一到周五 9:15~11:30, 13:00~15:00
 * Render 服务器在 UTC 时区，通过 UTC 时间 +8 计算北京时间
 */

export function isMarketOpen(): boolean {
  const d = new Date();
  const bjH = (d.getUTCHours() + 8) % 24;  // 北京时间 小时
  const bjM = d.getUTCMinutes();            // 北京时间 分钟
  const t = bjH * 100 + bjM;
  // 9:15 ~ 11:30, 13:00 ~ 15:00
  return (t >= 915 && t <= 1130) || (t >= 1300 && t <= 1500);
}

export function isTradingDay(): boolean {
  const d = new Date();
  // UTC 周一=1 周日=0, 北京 = UTC±0
  const utcDay = d.getUTCDay();
  // 计算北京时间星期几 (UTC+8)
  const bjHour = (d.getUTCHours() + 8) % 24;
  let bjDay = utcDay;
  if (d.getUTCHours() + 8 >= 24) {
    bjDay = (utcDay + 1) % 7;
  }
  return bjDay >= 1 && bjDay <= 5;
}

export function isAfterMarketClose(): boolean {
  const d = new Date();
  const bjH = (d.getUTCHours() + 8) % 24;
  const bjM = d.getUTCMinutes();
  const t = bjH * 100 + bjM;
  return t >= 1500; // 15:00 后
}

/**
 * 返回当前北京时间字符串（用于日志等）
 */
export function beijingNow(): string {
  const d = new Date();
  const bjH = (d.getUTCHours() + 8) % 24;
  const bjM = d.getUTCMinutes();
  const bjS = d.getUTCSeconds();
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const da = d.getUTCDate();
  // 跨日处理
  const bjDate = d.getUTCHours() + 8 >= 24 
    ? `${y}-${String(mo).padStart(2,'0')}-${String(da+1).padStart(2,'0')}`
    : `${y}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`;
  return `${bjDate} ${String(bjH).padStart(2,'0')}:${String(bjM).padStart(2,'0')}:${String(bjS).padStart(2,'0')}`;
}