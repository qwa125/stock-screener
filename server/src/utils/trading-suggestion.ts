/**
 * 交易建议共享算法
 * 与前端 src/pages/index/index.tsx 的 getTradingSuggestion 保持完全一致
 */

export interface SuggestionResult {
  action: string;
  color: string;
  reason: string;
  prediction: string;
}

/** 与前端 getPositionLabel 保持一致 */
function getPositionLabel(position: number): string {
  if (position < 15) return '低位区';
  if (position < 35) return '中低位区';
  if (position < 55) return '中位区';
  if (position < 75) return '中高位区';
  return '高位区';
}

export interface SuggestionInput {
  pricePosition: number;
  trendState: number;
  trendStrength?: number;
  diff: number;
  dea: number;
  shortBuy?: boolean;
  strictBuy?: boolean;
  jiaCang?: boolean;
  shortSell?: boolean;
  strongSell?: boolean;
  safe?: boolean;
  macdGoldenCross?: boolean;
  macdDeathCross?: boolean;
  baiXiaoDays?: number;
  volumeStructure?: number;
}

/**
 * 与前端 getTradingSuggestion 完全一致的交易建议算法
 */
export function getTradingSuggestion(f: SuggestionInput): SuggestionResult {
  const pos = f.pricePosition ?? 50;
  const trend = f.trendState ?? 1;
  const zone = getPositionLabel(pos);
  const diff = f.diff ?? 0;
  const dea = f.dea ?? 0;
  const macdBullish = diff > dea;
  const volumeBullish = (f.volumeStructure ?? 50) > 50;
  const safe = f.safe ?? false;
  const hasBuySignal = !!(f.shortBuy || f.strictBuy || f.jiaCang || macdBullish);
  const hasSellSignal = !!(f.shortSell || f.strongSell);
  const longDecline = pos < 20 && (f.trendStrength ?? 0) < -3;

  const strongBuy = (!!f.macdGoldenCross && volumeBullish)
    || (f.baiXiaoDays ?? 0) >= 3
    || (!!f.shortBuy && volumeBullish);

  const strongSell = !!f.macdDeathCross || !!f.strongSell;

  // 1) 高位区
  if (zone.includes('高位')) {
    if (trend === 0) {
      if (hasSellSignal || strongSell) return { action: '清仓', color: 'bg-red-600', reason: '高位下降趋势，风险较大', prediction: '未来1-2日预计继续回落，建议卖出' };
      if (strongBuy) return { action: '持有', color: 'bg-yellow-500', reason: '高位但有买入信号，暂持观察', prediction: '未来1-2日信号待验证，建议持有' };
      return { action: '卖出', color: 'bg-red-500', reason: '高位区域，注意风险', prediction: '未来1-2日预计偏弱，建议卖出' };
    }
    if (trend === 1) {
      if (strongBuy) return { action: '持有', color: 'bg-yellow-500', reason: '高位横盘+买入信号，暂持观察', prediction: '未来1-2日有望突破，建议买入' };
      if (hasSellSignal) return { action: '卖出', color: 'bg-red-500', reason: '高位横盘+卖出信号', prediction: '未来1-2日预计回落' };
      return { action: '减仓', color: 'bg-orange-500', reason: '高位横盘，控制仓位', prediction: '未来1-2日预计震荡调整，建议减仓' };
    }
    if (strongBuy) return { action: '轻仓买入', color: 'bg-green-500', reason: '高位上升+买入信号，强势延续', prediction: '未来1-2日有望上攻，建议买入' };
    return { action: '持有', color: 'bg-yellow-500', reason: '高位但仍有上升动能', prediction: '未来1-2日继续持有' };
  }

  // 2) 中高位区
  if (zone.includes('中高位')) {
    if (trend === 0) {
      if (strongBuy) return { action: '持有', color: 'bg-yellow-500', reason: '中高位下降但有买入信号，暂持', prediction: '未来1-2日信号验证中，建议持有' };
      return { action: '减仓', color: 'bg-orange-500', reason: '中高位+下降趋势', prediction: '未来1-2日预计偏弱，建议减仓' };
    }
    if (trend >= 2) {
      if (strongBuy) return { action: '轻仓买入', color: 'bg-green-500', reason: '中高位上升+买入信号，趋势偏强', prediction: '未来1-2日有望突破，建议买入' };
      return { action: '持有', color: 'bg-yellow-500', reason: '中高位偏强，暂持', prediction: '未来1-2日建议继续持有看突破' };
    }
    if (strongBuy) return { action: '持有', color: 'bg-yellow-500', reason: '中高位横盘+买入信号，关注突破', prediction: '未来1-2日有望启动，建议买入' };
    return { action: '持有', color: 'bg-yellow-500', reason: '中高位横盘震荡', prediction: '未来1-2日方向不明，建议持有' };
  }

  // 3) 中位区（纯中位，不含中低/中高）
  if (zone.includes('中位') && !zone.includes('低') && !zone.includes('高')) {
    if (trend >= 2) {
      if (strongBuy) return { action: '买入', color: 'bg-green-600', reason: '中位区上升+买入信号，看好', prediction: '未来1-2日有望延续上涨' };
      if (hasBuySignal) return { action: '轻仓买入', color: 'bg-green-500', reason: '中位区+趋势偏多', prediction: '未来1-2日有望延续上涨，建议买入' };
      return { action: '持有', color: 'bg-yellow-500', reason: '中位区上升但无买入信号，暂持观察', prediction: '未来1-2日方向待确认，建议持有' };
    }
    if (trend === 0) {
      if (strongBuy) return { action: '持有', color: 'bg-yellow-500', reason: '中位区下降但有买入信号，暂持', prediction: '未来1-2日信号验证中，建议持有' };
      return { action: '减仓', color: 'bg-orange-500', reason: '中位区+下降趋势', prediction: '未来1-2日预计偏弱' };
    }
    if (strongBuy) return { action: '持有', color: 'bg-yellow-500', reason: '中位区横盘+买入信号，关注', prediction: '未来1-2日有望启动，建议买入' };
    return { action: '持有', color: 'bg-yellow-500', reason: '中位区横盘，方向不明', prediction: '未来1-2日方向待定，建议持有' };
  }

  // 4) 中低位区
  if (zone.includes('中低位')) {
    if (trend >= 2 && hasBuySignal) return { action: '轻仓买入', color: 'bg-green-500', reason: '中低位+趋势转好', prediction: '未来1-2日有反弹预期，建议买入' };
    if (trend === 0) return { action: '持有', color: 'bg-yellow-500', reason: '中低位下降，等待企稳', prediction: '未来1-2日可能继续探底' };
    return { action: '持有', color: 'bg-yellow-500', reason: '中低位横盘，等待信号', prediction: '未来1-2日需等待放量确认，建议持有' };
  }

  // 5) 低位区
  if (longDecline && trend === 1 && !macdBullish && !volumeBullish) {
    return { action: '不要介入', color: 'bg-gray-500', reason: '长期下跌后横盘，无量能支撑', prediction: '未来1-2日无量能支撑，建议回避' };
  }
  if (trend === 1 && macdBullish && volumeBullish) {
    return { action: '买入', color: 'bg-green-600', reason: '低位横盘+MACD金叉+放量', prediction: '未来1-2日有望放量启动，建议买入' };
  }
  if (trend === 0) {
    if (hasBuySignal) return { action: '轻仓买入', color: 'bg-green-500', reason: '低位+下降末端，有买入信号', prediction: '未来1-2日止跌反弹，建议买入' };
    return { action: '观望', color: 'bg-gray-400', reason: '低位下降趋势，尚未企稳', prediction: '未来1-2日预计继续探底，建议卖出' };
  }
  if (trend >= 2) {
    if (trend >= 3 && hasBuySignal) return { action: '重仓买入', color: 'bg-red-600', reason: '低位强上升+买入信号共振', prediction: '未来1-2日预计继续上攻' };
    if (hasBuySignal) return { action: '买入', color: 'bg-green-600', reason: '低位上升趋势+买入信号', prediction: '未来1-2日延续反弹，建议买入' };
    return { action: '持有', color: 'bg-yellow-500', reason: '低位上升但无买入信号，等待确认', prediction: '未来1-2日可能震荡，等待放量确认' };
  }
  if (safe) return { action: '持有', color: 'bg-yellow-500', reason: '低位横盘+安全信号', prediction: '未来1-2日方向待定，建议持有' };
  return { action: '观望', color: 'bg-gray-400', reason: '低位横盘，方向不明', prediction: '未来1-2日方向未明，建议持有' };
}