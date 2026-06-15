import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { Network } from '@/network';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Info, AArrowUp, AArrowDown, TriangleAlert, Minus } from 'lucide-react-taro';
import { Separator } from '@/components/ui/separator';

// ===== 类型定义 =====
interface StockInfo {
  code: string;
  name: string;
  market: number;
}

interface FormulaResult {
  pricePosition: number;
  positionZone: string;
  trendState: number;
  trendStrength: number;
  concentration: number;
  volumeStructure: number;
  shortBuy: boolean;
  shortSell: boolean;
  strictBuy: boolean;
  strongSell: boolean;
  zhuLiXiChou: boolean;
  zhuLiChuHuo: boolean;
  xiPanSignal: boolean;
  bestBuyPoints: string[];
  baiXiao: boolean;
  baiBu: boolean;
  baiXiaoDays: number;
  baiXiaoPureDays: number;
  diff: number;
  dea: number;
  macdGoldenCross?: boolean;
  macdDeathCross?: boolean;
  lifeLine: number;
  pressure: number;
  diBuBuy: boolean;
  gaoWeiHuiDiaoBuy: boolean;
  zhuLiShiPan: boolean;
  jiaCang: boolean;
  gaoKaiDiZouQingCang: boolean;
  baoLiangFuGaiQingCang: boolean;
  po5RiXian: boolean;
  yinDiePoWei: boolean;
  baiXiaoBuy1: boolean;
  baiXiaoBuy2: boolean;
  qiangShiHuiCai: boolean;
  jiGouHuoYueDu: number;
  safe: boolean;
  conflict: string | null;
  concentrationDisplay: number;
  backtestStats?: BacktestStats;
  signals?: SignalEntry[];
}

interface BacktestStats {
  totalOccurrences: number;
  upCount: number;
  downCount: number;
  upProbability: number;
  avgReturn: number;
  maxReturn: number;
  minReturn: number;
  avgWinReturn: number;
  avgLossReturn: number;
  winLossRatio: number;
}

interface SignalEntry {
  name: string;
  type: 'positive' | 'negative' | 'neutral' | 'warning';
  description?: string;
}

interface StockResult {
  stock: StockInfo;
  currentPrice: number;
  changePercent: number;
  high?: number;
  low?: number;
  klineCount: number;
  isNewStock?: boolean;
  formula: FormulaResult;
  signals?: SignalEntry[];
  suggestion?: string;
  prediction?: string;
  reason?: string;
}

interface ApiResponse {
  code: number;
  msg: string;
  data: StockResult | null;
}

// ===== 辅助函数 =====

interface OpportunityStock {
  code: string;
  name?: string;
  mainForceInflow: number;
  baiXiaoDays: number;
  currentPrice: number;
  changePercent: number;
  pricePosition: number;
  priceIncrease: number;
  score: number;
  diff?: number;
  dea?: number;
  macd?: number;
  isGoldenCross?: boolean;
  amount?: number;
  buySignal?: string;
  suggestion?: string;
  entryTiming?: number;
  safetyScore?: number;
}
const trendText = (state: number): string => {
  switch (state) {
    case 3: return '主升浪';
    case 2: return '上升';
    case 1: return '震荡';
    default: return '下降';
  }
};

const trendColor = (state: number): string => {
  switch (state) {
    case 3: return '#ff4d4f';
    case 2: return '#ff7a45';
    case 1: return '#faad14';
    default: return '#52c41a';
  }
};

const zoneColor = (zone: string): string => {
  switch (zone) {
    case '低位区': return '#52c41a';
    case '中位区': return '#faad14';
    case '高位警戒区': return '#ff7a45';
    case '高风险区': return '#ff4d4f';
    case '极端风险区': return '#eb2f96';
    default: return '#999';
  }
};

const formatPercent = (v: number): string => {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
};

/** 中性信号名称映射 */
const signalDisplayMap: Record<string, string> = {
  shortBuy: '短线信号',
  shortSell: '短线风险',
  strictBuy: '强势信号',
  strongSell: '强力信号',
  zhuLiXiChou: '吸筹信号',
  zhuLiChuHuo: '出货信号',
  xiPanSignal: '洗盘信号',
  diBuBuy: '底部信号',
  gaoWeiHuiDiaoBuy: '企稳信号',
  zhuLiShiPan: '试盘信号',
  jiaCang: '仓位信号',
  gaoKaiDiZouQingCang: '高开低走',
  baoLiangFuGaiQingCang: '放量覆盖',
  po5RiXian: '5日线破位',
  yinDiePoWei: '阴跌破位',
  baiXiaoBuy1: '启动信号',
  baiXiaoBuy2: '横盘信号',
  qiangShiHuiCai: '回踩信号',
};

/** 信号类型映射 */
const signalTypeMap: Record<string, 'positive' | 'negative' | 'neutral'> = {
  shortBuy: 'positive',
  shortSell: 'negative',
  strictBuy: 'positive',
  strongSell: 'negative',
  zhuLiXiChou: 'positive',
  zhuLiChuHuo: 'negative',
  xiPanSignal: 'neutral',
  diBuBuy: 'positive',
  gaoWeiHuiDiaoBuy: 'positive',
  zhuLiShiPan: 'neutral',
  jiaCang: 'positive',
  gaoKaiDiZouQingCang: 'negative',
  baoLiangFuGaiQingCang: 'negative',
  po5RiXian: 'negative',
  yinDiePoWei: 'negative',
  baiXiaoBuy1: 'positive',
  baiXiaoBuy2: 'positive',
  qiangShiHuiCai: 'positive',
};

interface TradingSuggestion {
  /** 操作动作: 重仓买入, 买入, 轻仓买入, 持有, 减仓, 卖出, 清仓, 不要介入 */
  action: string;
  /** 动作对应的颜色 */
  color: string;
  /** 动作对应的图标色 */
  iconColor: string;
  /** 理由简述 */
  reason: string;
  /** 未来1-2日预测 */
  prediction: string;
  /** 预测文字颜色 */
  predictionColor: string;
  /** 是否为警告 */
  isWarning?: boolean;
  /** 详细说明列表 */
  details?: string[];
}

function getPositionLabel(position: number): string {
  if (position < 15) return '低位区';
  if (position < 35) return '中低位区';
  if (position < 55) return '中位区';
  if (position < 75) return '中高位区';
  return '高位区';
}

function getTradingSuggestion(f: FormulaResult): TradingSuggestion {
  const pos = f.pricePosition ?? 50;
  const trend = f.trendState ?? 1;
  const strength = f.trendStrength ?? 0;
  const zone = f.positionZone || getPositionLabel(pos);
  const diff = f.diff ?? 0;
  const dea = f.dea ?? 0;
  const macdBullish = diff > dea;
  const volumeBullish = (f.volumeStructure ?? 50) > 50;
  const safe = f.safe ?? false;
  const hasBuySignal = !!f.shortBuy || !!f.strictBuy || !!f.jiaCang || macdBullish;
  const hasSellSignal = !!f.shortSell || !!f.strongSell;
  const longDecline = pos < 20 && strength < -3;

  // 强买入信号（与机会区筛选条件对齐）：MACD金叉事件 + 放量 / 连阳 / 短买信号 + 量能
  const strongBuy = (!!f.macdGoldenCross && volumeBullish)
    || (f.baiXiaoDays ?? 0) >= 3
    || (!!f.shortBuy && volumeBullish);

  // 强卖出信号
  const strongSell = !!f.macdDeathCross || !!f.strongSell;

  // 1) 高位区 - 高风险，但有强买入信号时可持有
  if (zone.includes('高位')) {
    if (trend === 0) { // 下降
      if (hasSellSignal || strongSell) return { action: '清仓', color: 'bg-red-600', iconColor: '#dc2626', reason: '高位下降趋势，风险较大', prediction: '未来1-2日预计继续回落，建议卖出', predictionColor: '#dc2626' };
      if (strongBuy) return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '高位但有买入信号，暂持观察', prediction: '未来1-2日信号待验证，建议持有', predictionColor: '#eab308' };
      return { action: '卖出', color: 'bg-red-500', iconColor: '#ef4444', reason: '高位区域，注意风险', prediction: '未来1-2日预计偏弱，建议卖出', predictionColor: '#f59e0b' };
    }
    if (trend === 1) { // 横盘
      if (strongBuy) return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '高位横盘+买入信号，暂持观察', prediction: '未来1-2日有望突破，建议买入', predictionColor: '#16a34a' };
      if (hasSellSignal) return { action: '卖出', color: 'bg-red-500', iconColor: '#ef4444', reason: '高位横盘+卖出信号', prediction: '未来1-2日预计回落', predictionColor: '#dc2626' };
      return { action: '减仓', color: 'bg-orange-500', iconColor: '#f97316', reason: '高位横盘，控制仓位', prediction: '未来1-2日预计震荡调整，建议减仓', predictionColor: '#f59e0b' };
    }
    // 上升
    if (strongBuy) return { action: '轻仓买入', color: 'bg-green-500', iconColor: '#22c55e', reason: '高位上升+买入信号，强势延续', prediction: '未来1-2日有望上攻，建议买入', predictionColor: '#16a34a' };
    return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '高位但仍有上升动能', prediction: '未来1-2日继续持有', predictionColor: '#eab308' };
  }

  // 2) 中高位区 - 偏风险，但有强买入信号时以信号为准
  if (zone.includes('中高位')) {
    if (trend === 0) {
      if (strongBuy) return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中高位下降但有买入信号，暂持', prediction: '未来1-2日信号验证中，建议持有', predictionColor: '#eab308' };
      return { action: '减仓', color: 'bg-orange-500', iconColor: '#f97316', reason: '中高位+下降趋势', prediction: '未来1-2日预计偏弱，建议减仓', predictionColor: '#f59e0b' };
    }
    if (trend >= 2) {
      if (strongBuy) return { action: '轻仓买入', color: 'bg-green-500', iconColor: '#22c55e', reason: '中高位上升+买入信号，趋势偏强', prediction: '未来1-2日有望突破，建议买入', predictionColor: '#16a34a' };
      return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中高位偏强，暂持', prediction: '未来1-2日建议继续持有看突破', predictionColor: '#eab308' };
    }
    if (strongBuy) return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中高位横盘+买入信号，关注突破', prediction: '未来1-2日有望启动，建议买入', predictionColor: '#16a34a' };
    return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中高位横盘震荡', prediction: '未来1-2日方向不明，建议持有', predictionColor: '#6b7280' };
  }

  // 3) 中位区 - 中性，强信号可改变判断
  if (zone.includes('中位') && !zone.includes('低') && !zone.includes('高')) {
    if (trend >= 2) {
      if (strongBuy) return { action: '买入', color: 'bg-green-600', iconColor: '#16a34a', reason: '中位区上升+买入信号，看好', prediction: '未来1-2日有望延续上涨', predictionColor: '#16a34a' };
      if (hasBuySignal) return { action: '轻仓买入', color: 'bg-green-500', iconColor: '#22c55e', reason: '中位区+趋势偏多', prediction: '未来1-2日有望延续上涨，建议买入', predictionColor: '#16a34a' };
      return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中位区上升但无买入信号，暂持观察', prediction: '未来1-2日方向待确认，建议持有', predictionColor: '#eab308' };
    }
    if (trend === 0) {
      if (strongBuy) return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中位区下降但有买入信号，暂持', prediction: '未来1-2日信号验证中，建议持有', predictionColor: '#eab308' };
      return { action: '减仓', color: 'bg-orange-500', iconColor: '#f97316', reason: '中位区+下降趋势', prediction: '未来1-2日预计偏弱', predictionColor: '#f59e0b' };
    }
    if (strongBuy) return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中位区横盘+买入信号，关注', prediction: '未来1-2日有望启动，建议买入', predictionColor: '#16a34a' };
    return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中位区横盘，方向不明', prediction: '未来1-2日方向待定，建议持有', predictionColor: '#6b7280' };
  }

  // 4) 中低位区 - 偏机会
  if (zone.includes('中低位')) {
    if (trend >= 2 && hasBuySignal) return { action: '轻仓买入', color: 'bg-green-500', iconColor: '#22c55e', reason: '中低位+趋势转好', prediction: '未来1-2日有反弹预期，建议买入', predictionColor: '#16a34a' };
    if (trend === 0) return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中低位下降，等待企稳', prediction: '未来1-2日可能继续探底', predictionColor: '#f59e0b' };
    return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '中低位横盘，等待信号', prediction: '未来1-2日需等待放量确认，建议持有', predictionColor: '#3b82f6' };
  }

  // 5) 低位区 - 机会/风险并存
  // 跌了很久+横盘→不要介入
  if (longDecline && trend === 1 && !macdBullish && !volumeBullish) {
    return { action: '不要介入', color: 'bg-gray-500', iconColor: '#6b7280', reason: '长期下跌后横盘，无量能支撑', prediction: '未来1-2日无量能支撑，建议回避', predictionColor: '#6b7280' };
  }
  // 低位+横盘+MACD金叉+放量→可关注/未来买入
  if (trend === 1 && macdBullish && volumeBullish) {
    return { action: '买入', color: 'bg-green-600', iconColor: '#16a34a', reason: '低位横盘+MACD金叉+放量', prediction: '未来1-2日有望放量启动，建议买入', predictionColor: '#16a34a' };
  }
  // 低位+下降趋势
  if (trend === 0) {
    if (hasBuySignal) return { action: '轻仓买入', color: 'bg-green-500', iconColor: '#22c55e', reason: '低位+下降末端，有买入信号', prediction: '未来1-2日止跌反弹，建议买入', predictionColor: '#16a34a' };
    return { action: '观望', color: 'bg-gray-400', iconColor: '#9ca3af', reason: '低位下降趋势，尚未企稳', prediction: '未来1-2日预计继续探底，建议卖出', predictionColor: '#f59e0b' };
  }
  // 低位+上升趋势
  if (trend >= 2) {
    if (trend >= 3 && hasBuySignal) return { action: '重仓买入', color: 'bg-red-600', iconColor: '#dc2626', reason: '低位强上升+买入信号共振', prediction: '未来1-2日预计继续上攻', predictionColor: '#16a34a' };
    if (hasBuySignal) return { action: '买入', color: 'bg-green-600', iconColor: '#16a34a', reason: '低位上升趋势+买入信号', prediction: '未来1-2日延续反弹，建议买入', predictionColor: '#16a34a' };
    return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '低位上升但无买入信号，等待确认', prediction: '未来1-2日可能震荡，等待放量确认', predictionColor: '#eab308' };
  }
  // 低位横盘（默认）
  if (safe) return { action: '持有', color: 'bg-yellow-500', iconColor: '#eab308', reason: '低位横盘+安全信号', prediction: '未来1-2日方向待定，建议持有', predictionColor: '#3b82f6' };
  return { action: '观望', color: 'bg-gray-400', iconColor: '#9ca3af', reason: '低位横盘，方向不明', prediction: '未来1-2日方向未明，建议持有', predictionColor: '#6b7280' };
}

function getActiveSignals(f: FormulaResult, extraSignals?: SignalEntry[]): { key: string; name: string; type: string; description?: string }[] {
  const result: { key: string; name: string; type: string; description?: string }[] = [];

  // 从外层 signals 数组加入（新股预警等动态信号）
  if (extraSignals && Array.isArray(extraSignals)) {
    for (const s of extraSignals) {
      result.push({ key: s.name, name: s.name, type: s.type, description: s.description });
    }
  }

  const fields: Record<string, boolean | string[]> = {
    shortBuy: f.shortBuy,
    shortSell: f.shortSell,
    strictBuy: f.strictBuy,
    strongSell: f.strongSell,
    zhuLiXiChou: f.zhuLiXiChou,
    zhuLiChuHuo: f.zhuLiChuHuo,
    xiPanSignal: f.xiPanSignal,
    diBuBuy: f.diBuBuy,
    gaoWeiHuiDiaoBuy: f.gaoWeiHuiDiaoBuy,
    zhuLiShiPan: f.zhuLiShiPan,
    jiaCang: f.jiaCang,
    gaoKaiDiZouQingCang: f.gaoKaiDiZouQingCang,
    baoLiangFuGaiQingCang: f.baoLiangFuGaiQingCang,
    po5RiXian: f.po5RiXian,
    yinDiePoWei: f.yinDiePoWei,
    baiXiaoBuy1: f.baiXiaoBuy1,
    baiXiaoBuy2: f.baiXiaoBuy2,
    qiangShiHuiCai: f.qiangShiHuiCai,
  };
  for (const [key, val] of Object.entries(fields)) {
    if (val) {
      result.push({ key, name: signalDisplayMap[key] || key, type: signalTypeMap[key] || 'neutral' });
    }
  }
  return result;
}

const signalBadgeColor = (type: string): string => {
  switch (type) {
    case 'positive': return '#ff4d4f';
    case 'negative': return '#52c41a';
    case 'warning': return '#fa8c16';
    default: return '#faad14';
  }
};

/** 操作建议颜色映射 */
const ACTION_BADGE_COLOR: Record<string, string> = {
  '重仓买入': '#dc2626',
  '买入': '#16a34a',
  '轻仓买入': '#22c55e',
  '准备买入': '#22c55e',
  '持有': '#eab308',
  '观望': '#9ca3af',
  '减仓': '#f97316',
  '卖出': '#ef4444',
  '清仓': '#dc2626',
  '不要介入': '#6b7280',
};

/** 根据机会区股票数据生成操作建议（简化版，使用可用的数据字段） */
function getOpportunitySuggestion(stock: OpportunityStock): string {
  // 优先使用后端 computed suggestion
  if (stock.suggestion) return stock.suggestion;
  // 后端没有 suggestion 时，用 pricePosition + 信号字段计算简化建议
  const pos = stock.pricePosition ?? 50;
  const bxd = stock.baiXiaoDays ?? 0;
  const golden = stock.isGoldenCross ?? false;
  const hasBuySignal = !!(stock.buySignal || bxd >= 1 || golden);
  
  // 低位区
  if (pos < 25) {
    if (golden && hasBuySignal) return '买入';
    if (hasBuySignal) return '轻仓买入';
    return '观望';
  }
  // 中低位区
  if (pos < 45) {
    if (golden && hasBuySignal) return '轻仓买入';
    if (hasBuySignal) return '准备买入';
    return '持有';
  }
  // 中位区
  if (pos < 65) {
    if (hasBuySignal) return '轻仓买入';
    return '持有';
  }
  // 中高位区
  if (pos < 80) {
    if (hasBuySignal) return '持有';
    return '持有';
  }
  // 高位区
  if (hasBuySignal) return '持有';
  return '减仓';
}

/** 格式化主力资金：带 ± 符号和万/亿单位 */
const formatMainForce = (value: number | undefined | null): string => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '-';
  const v = Number(value);
  const abs = Math.abs(v);
  if (abs === 0) return '-';
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 100000000) {
    return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  }
  return `${sign}${(abs / 10000).toFixed(0)}万`;
};

/** 主力资金颜色 */
const mainForceColor = (value: number | undefined | null): string => {
  if (value === undefined || value === null) return '#999';
  return (value ?? 0) >= 0 ? '#ef4444' : '#22c55e';
};

// ===== 组件 =====
/** 信息行 */
const InfoItem = ({ label, value }: { label: string; value: string }) => (
  <View className="flex flex-row items-center justify-between py-2">
    <Text className="block text-xs text-gray-500">{label}</Text>
    <Text className="block text-xs font-medium text-gray-900">{value}</Text>
  </View>
);

/** MACD DIFF/DEA 可视化条 */
const MacdBar = ({ diff, dea }: { diff: number; dea: number }) => {
  const maxVal = Math.max(Math.abs(diff * 1.2), Math.abs(dea * 1.2), 1);
  const diffPct = (diff / maxVal) * 50;
  const deaPct = (dea / maxVal) * 50;
  return (
    <View className="pt-2">
      <View className="flex flex-row items-center gap-2 mb-1">
        <Text className="block text-xs w-8 text-gray-400 text-right">DIFF</Text>
        <View className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden relative">
          <View className="absolute inset-0 flex flex-row items-center">
            <View className="flex-1" />
            <View
              className="h-3 rounded-full"
              style={{
                width: `${Math.abs(diffPct)}%`,
                backgroundColor: diff >= 0 ? '#ff4d4f' : '#52c41a',
                marginLeft: diff >= 0 ? '0' : 'auto',
                marginRight: diff >= 0 ? 'auto' : '0',
              }}
            />
            <View className="flex-1" />
          </View>
        </View>
        <Text className="block text-xs w-16 text-gray-700 font-mono">{diff.toFixed(2)}</Text>
      </View>
      <View className="flex flex-row items-center gap-2">
        <Text className="block text-xs w-8 text-gray-400 text-right">DEA</Text>
        <View className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden relative">
          <View className="absolute inset-0 flex flex-row items-center">
            <View className="flex-1" />
            <View
              className="h-3 rounded-full"
              style={{
                width: `${Math.abs(deaPct)}%`,
                backgroundColor: dea >= 0 ? '#ff4d4f' : '#52c41a',
                marginLeft: dea >= 0 ? '0' : 'auto',
                marginRight: dea >= 0 ? 'auto' : '0',
              }}
            />
            <View className="flex-1" />
          </View>
        </View>
        <Text className="block text-xs w-16 text-gray-700 font-mono">{dea.toFixed(2)}</Text>
      </View>
      <View className="flex flex-row items-center gap-2 mt-1">
        <Text className="block text-xs w-8 text-gray-400 text-right">差值</Text>
        <Text
          className="block text-xs font-bold"
          style={{ color: diff >= dea ? '#ff4d4f' : '#52c41a' }}
        >
          {diff >= dea ? `DIFF在上方 +${(diff - dea).toFixed(2)}` : `DEA在上方 ${(diff - dea).toFixed(2)}`}
        </Text>
      </View>
    </View>
  );
};

/** 价格位置指示器 */
const PositionBar = ({ position, zone }: { position: number; zone: string }) => {
  const barColor = zoneColor(zone);
  return (
    <View className="pt-2">
      <View className="flex flex-row items-center justify-between mb-1">
        <Text className="block text-xs text-gray-400">价格位置</Text>
        <Text className="block text-xs font-medium" style={{ color: barColor }}>{zone}</Text>
      </View>
      <View className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{
            width: `${Math.min(position, 100)}%`,
            backgroundColor: barColor,
          }}
        />
      </View>
      <Text className="block text-xs text-gray-500 text-right mt-1">{position.toFixed(1)}%</Text>
    </View>
  );
};



/** 回测统计展示 */
const BacktestStatsCard = ({ stats }: { stats: BacktestStats }) => (
  <View className="p-3 bg-blue-50 rounded-xl">
    <View className="flex flex-row items-center gap-1 mb-2">
      <Info size={14} color="#1890ff" />
      <Text className="block text-xs font-bold text-blue-700">形态历史统计</Text>
    </View>
    <Text className="block text-xs text-blue-700 mb-2 leading-relaxed">
      历史上出现此形态{stats.totalOccurrences}次，{stats.upCount}日后上涨{stats.upCount}次，
      上涨概率{stats.upProbability}%，盈亏比{stats.winLossRatio.toFixed(2)}:1
    </Text>
    <View className="flex flex-row gap-3">
      <View className="flex-1 p-2 bg-white rounded-lg">
        <Text className="block text-xs text-gray-500 text-center">上涨概率</Text>
        <Text className="block text-sm font-bold text-red-500 text-center">{stats.upProbability.toFixed(0)}%</Text>
      </View>
      <View className="flex-1 p-2 bg-white rounded-lg">
        <Text className="block text-xs text-gray-500 text-center">平均收益</Text>
        <Text className="block text-sm font-bold text-center" style={{ color: stats.avgReturn >= 0 ? '#ff4d4f' : '#52c41a' }}>
          {stats.avgReturn >= 0 ? '+' : ''}{stats.avgReturn.toFixed(2)}%
        </Text>
      </View>
      <View className="flex-1 p-2 bg-white rounded-lg">
        <Text className="block text-xs text-gray-500 text-center">盈亏比</Text>
        <Text className="block text-sm font-bold text-blue-500 text-center">{stats.winLossRatio.toFixed(2)}</Text>
      </View>
    </View>
    <Text className="block text-xs text-blue-400 mt-2">* 仅为历史统计，不构成对未来走势的预测</Text>
  </View>
);

const IndexPage = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StockResult | null>(null);
  const [error, setError] = useState('');

  // 创业板机会区状态
  const [gemData, setGemData] = useState<OpportunityStock[] | null>(null);
  const [gemTimestamp, setGemTimestamp] = useState<number>(0);
  const [gemLoading, setGemLoading] = useState<boolean>(true);

  // 主板机会区状态
  const [mainData, setMainData] = useState<OpportunityStock[] | null>(null);
  const [mainTimestamp, setMainTimestamp] = useState<number>(0);
  const [mainLoading, setMainLoading] = useState<boolean>(true);

  // 热点板块机会区（板块数据）
  const [sectorData, setSectorData] = useState<any[] | null>(null);
  const [sectorTimestamp, setSectorTimestamp] = useState<number>(0);
  const [sectorLoading, setSectorLoading] = useState(true);

  // 获取创业板Top10（后端控制缓存，前端只需读取）
  const fetchGemTop = useCallback(async () => {
    try {
      setGemLoading(true);
      const res = await Network.request({ url: '/api/gem/top/gem' });
      const apiData = res.data as any;
      if (apiData?.data?.opportunities) {
        setGemData(apiData.data.opportunities);
        if (apiData.data.timestamp) setGemTimestamp(apiData.data.timestamp);
        else setGemTimestamp(Date.now());
      }
    } catch (e) {
      console.error('获取创业板机会区失败:', e);
    } finally {
      setGemLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGemTop();
    const timer = setInterval(fetchGemTop, 15000);
    return () => clearInterval(timer);
  }, [fetchGemTop]);

  // 获取主板Top10（后端控制缓存）
  const fetchMainTop = useCallback(async () => {
    try {
      setMainLoading(true);
      const res = await Network.request({ url: '/api/gem/top/main-board' });
      const apiData = res.data as any;
      if (apiData?.data?.opportunities) {
        setMainData(apiData.data.opportunities);
        if (apiData.data.timestamp) setMainTimestamp(apiData.data.timestamp);
        else setMainTimestamp(Date.now());
      }
    } catch (e) {
      console.error('获取主板机会区失败:', e);
    } finally {
      setMainLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMainTop();
    const timer = setInterval(fetchMainTop, 15000);
    return () => clearInterval(timer);
  }, [fetchMainTop]);

  // 获取板块机会股Top10（后端扫描板块+全分析排序）
  const fetchSectorHot = useCallback(async () => {
    try {
      const res = await Network.request({ url: '/api/gem/top/sector', method: 'GET' });
      console.log('[板块机会区] 响应:', res.data);
      const apiData = res.data as any;
      if (apiData?.data?.opportunities) {
        setSectorData(apiData.data.opportunities);
        if (apiData.data.timestamp) setSectorTimestamp(apiData.data.timestamp);
        else setSectorTimestamp(Date.now());
        setSectorLoading(false);
      } else {
        setSectorLoading(false);
      }
    } catch (e) {
      console.error('[板块机会区] 加载失败:', e);
      setSectorLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSectorHot();
    const timer = setInterval(fetchSectorHot, 30000);
    return () => clearInterval(timer);
  }, [fetchSectorHot]);

  // 搜索建议状态
  const [suggestions, setSuggestions] = useState<{ code: string; name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // 防抖拼音搜索
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await Network.request({
          url: '/api/stock/search',
          method: 'GET',
          data: { q },
        });
        const apiData = res.data as { code: number; data: { code: string; name: string }[] };
        if (apiData.code === 200 && apiData.data?.length > 0) {
          setSuggestions(apiData.data);
          setShowSuggestions(true);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const selectSuggestion = (code: string) => {
    setShowSuggestions(false);
    handleSearchByCode(code);
  };

  const handleInput = (e: any) => {
    const val = (e.detail?.value || '').replace(/\s/g, '');
    setQuery(val);
    setError('');
    setResult(null);
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) {
      setError('请输入股票代码或名称');
      return;
    }
    setError('');
    setLoading(true);
    setResult(null);

    try {
      const res = await Network.request({
        url: '/api/stock/analyze',
        method: 'GET',
        data: { q },
      });
      console.log('[股票查询] 响应结果:', res.data);

      const apiData = res.data as ApiResponse;
      if (apiData.code === 200 && apiData.data) {
        setResult(apiData.data);
      } else {
        setError(apiData.msg || '查询失败');
      }
    } catch (e: any) {
      console.error('[股票查询] 请求失败:', e);
      setError('网络请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchByCode = async (code: string, knownSuggestion?: string) => {
    setQuery(code);
    setError('');
    setLoading(true);
    setResult(null);

    try {
      const res = await Network.request({
        url: '/api/stock/analyze',
        method: 'GET',
        data: { q: code },
      });
      console.log('[快捷查询] 响应结果:', res.data);

      const apiData = res.data as ApiResponse;
      if (apiData.code === 200 && apiData.data) {
        // 保级策略：机会区已知建议可以更高级但不能更低级
        let finalData = apiData.data as any;
        if (knownSuggestion) {
          const serverAction = finalData.suggestion || '';
          const ACTION_LEVEL: Record<string, number> = {
            '重仓买入': 1, '买入': 2, '轻仓买入': 3, '准备买入': 4,
            '持有': 5, '观望': 6, '减仓': 7, '卖出': 8, '清仓': 9,
            '不要介入': 10,
          };
          const serverLevel = ACTION_LEVEL[serverAction] ?? 99;
          const knownLevel = ACTION_LEVEL[knownSuggestion] ?? 99;
          // 如果服务器算出的建议更低级（level更大），则保底使用机会区的建议
          if (serverLevel > knownLevel) {
            finalData = { ...finalData, suggestion: knownSuggestion };
          }
        }
        setResult(finalData);
      } else {
        setError(apiData.msg || '查询失败');
      }
    } catch (e: any) {
      console.error('[快捷查询] 请求失败:', e);
      setError('网络请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const f = result?.formula;

  return (
    <View className="h-full bg-gray-50">
      <ScrollView className="h-full bg-gray-50">
      <View className="p-4">
        {/* 标题 */}
        <View className="mb-6">
          <Text className="block text-2xl font-bold text-gray-900">
            股票技术分析
          </Text>
          <Text className="block text-sm text-gray-500 mt-1">
            输入股票代码或名称，查看技术指标与数据统计
          </Text>
        </View>

        {/* 搜索栏 */}
        <View className="mb-6">
          <View style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
            <View style={{ flex: 1, position: 'relative' }}>
              <View style={{ backgroundColor: '#f5f5f5', borderRadius: '10px', padding: '8px 12px' }}>
                <Input
                  placeholder="输入代码名称或拼音，如600519"
                  value={query}
                  onInput={handleInput}
                  onConfirm={handleSearch}
                  style={{ width: '100%', fontSize: '14px', backgroundColor: 'transparent' }}
                />
              </View>
              {/* 搜索建议下拉 */}
              {showSuggestions && suggestions.length > 0 && (
                <View
                  style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    backgroundColor: '#fff', borderRadius: '10px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    zIndex: 1000, maxHeight: '280px', overflow: 'scroll',
                    marginTop: '4px', borderWidth: '1px', borderColor: '#f0f0f0', borderStyle: 'solid',
                  }}
                >
                  {suggestions.map((item, idx) => (
                    <View
                      key={idx}
                      onClick={() => selectSuggestion(item.code)}
                      style={{
                        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderBottomWidth: idx < suggestions.length - 1 ? '1px' : '0',
                        borderBottomColor: '#f5f5f5', borderBottomStyle: 'solid',
                      }}
                    >
                      <Text className="block text-sm text-gray-900 font-medium">{item.name}</Text>
                      <Text className="block text-xs text-gray-400">{item.code}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <View style={{ flexShrink: 0 }}>
              <Button onClick={handleSearch} disabled={loading}>
                <Text className="block text-sm font-medium">
                  {loading ? '加载中...' : '查询'}
                </Text>
              </Button>
            </View>
          </View>
          {error && (
            <Text className="block text-xs text-red-500 mt-2">{error}</Text>
          )}
        </View>

        {/* 加载态 */}
        {loading && (
          <Card>
            <CardContent className="p-4">
              <View className="flex flex-col gap-3">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-12 w-40" />
              </View>
            </CardContent>
          </Card>
        )}

        {/* 结果展示 */}
        {result && f && (
          <View className="flex flex-col gap-4">
            {/* 股票信息卡片 */}
            <Card>
              <CardContent className="p-4">
                <View className="flex flex-row items-center justify-between mb-3">
                  <View>
                    <Text className="block text-lg font-bold text-gray-900">
                      {result.stock.name}
                    </Text>
                    <Text className="block text-sm text-gray-500">
                      {result.stock.code}
                    </Text>
                  </View>
                  <View className="text-right">
                    <Text className="block text-2xl font-bold text-gray-900">
                      {result.currentPrice.toFixed(2)}
                    </Text>
                    <Text
                      className="block text-sm font-medium"
                      style={{ color: result.changePercent >= 0 ? '#ff4d4f' : '#52c41a' }}
                    >
                      {formatPercent(result.changePercent)}
                    </Text>
                  </View>
                </View>

                <View className="flex flex-row gap-2 flex-wrap">
                  <Badge style={{ backgroundColor: zoneColor(f.positionZone), color: '#fff' }}>
                    <Text className="block text-xs">{f.positionZone}</Text>
                  </Badge>
                  <Badge style={{ backgroundColor: trendColor(f.trendState), color: '#fff' }}>
                    <Text className="block text-xs">{trendText(f.trendState)}</Text>
                  </Badge>
                  <Badge style={{ backgroundColor: f.baiXiao ? '#722ed1' : '#13c2c2', color: '#fff' }}>
                    <Text className="block text-xs">{f.baiXiao ? '白消信号' : '无白消'}</Text>
                  </Badge>
                  {f.safe && (
                    <Badge style={{ backgroundColor: '#faad14', color: '#fff' }}>
                      <Text className="block text-xs">安全线</Text>
                    </Badge>
                  )}
                </View>
              </CardContent>
            </Card>

            {/* 操作建议卡片 */}
            {(() => {
              // 优先使用服务端统一计算的建议（与机会区一致），兜底用前端算法
              const serverAction = result?.suggestion;
              const serverPrediction = result?.prediction;
              const serverReason = result?.reason;
              const clientSuggestion = getTradingSuggestion(f);
              const effectiveAction = serverAction || clientSuggestion.action;
              const suggestion = serverAction
                ? { ...clientSuggestion, action: effectiveAction, prediction: serverPrediction || clientSuggestion.prediction, reason: serverReason || clientSuggestion.reason }
                : { ...clientSuggestion, action: effectiveAction };

              const actionColors: Record<string, string> = {
                '重仓买入': 'bg-red-600', '买入': 'bg-green-600', '轻仓买入': 'bg-green-500',
                '持有': 'bg-blue-500', '减仓': 'bg-orange-500', '卖出': 'bg-red-500',
                '清仓': 'bg-red-700', '不要介入': 'bg-gray-500', '观望': 'bg-gray-400'
              };
              const actionIcons: Record<string, string> = {
                '重仓买入': 'buy', '买入': 'buy', '轻仓买入': 'buy',
                '持有': 'hold', '减仓': 'sell', '卖出': 'sell',
                '清仓': 'sell', '不要介入': 'stop'
              };
              const iconMap: Record<string, React.ReactNode> = {
                'buy': <AArrowUp color="#fff" size={20} />,
                'hold': <Minus color="#fff" size={20} />,
                'sell': <AArrowDown color="#fff" size={20} />,
                'stop': <TriangleAlert color="#fff" size={20} />
              };
              return (
                <Card className={suggestion.isWarning ? 'border-2 border-orange-300' : ''}>
                  <CardContent className="p-4">
                    <View style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                      <Text className="block text-base font-bold text-gray-900">操作建议</Text>
                      {suggestion.isWarning && <Badge style={{ backgroundColor: '#fa8c16', color: '#fff' }}><Text className="block text-xs">⚠️ 谨慎</Text></Badge>}
                    </View>

                    {/* 主操作按钮 */}
                    <View className="mb-3">
                      <View
                        className={'rounded-xl py-3 px-4 ' + (actionColors[suggestion.action] || 'bg-blue-500')}
                        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <View style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                          {iconMap[actionIcons[suggestion.action]] || iconMap['hold']}
                          <Text className="block text-lg font-bold text-white">{suggestion.action}</Text>
                        </View>
                        <Text className="block text-xs text-white text-opacity-80">{suggestion.reason}</Text>
                      </View>
                    </View>

                    {/* 未来1-2日预测 */}
                    {suggestion.prediction && (
                      <View
                        className="bg-gray-50 rounded-xl p-3"
                        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}
                      >
                        <Text className="block text-xs font-medium text-gray-600 whitespace-nowrap">未来1-2日</Text>
                        <Text className="block text-sm font-semibold text-gray-800">{suggestion.prediction}</Text>
                      </View>
                    )}

                    {/* 详情说明 */}
                    {suggestion.details && suggestion.details.length > 0 && (
                      <View className="mt-2">
                        {suggestion.details.map((d, i) => (
                          <View key={i} className="flex flex-row items-start gap-1 mt-1">
                            <Text className="block text-xs text-gray-400">•</Text>
                            <Text className="block text-xs text-gray-500">{d}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* 技术指标卡片 */}
            <Card>
              <CardContent className="p-4">
                <Text className="block text-base font-bold text-gray-900 mb-3">
                  技术指标
                </Text>

                {/* MACD 交叉图 */}
                <View className="mb-3 p-3 bg-gray-50 rounded-xl">
                  <Text className="block text-xs font-medium text-gray-600 mb-2">MACD 差值状态</Text>
                  <MacdBar diff={f.diff} dea={f.dea} />
                </View>

                {/* 价格位置 */}
                <PositionBar position={f.pricePosition} zone={f.positionZone} />

                <Separator className="my-3" />

                {/* 指标网格 */}
                <View className="grid grid-cols-2 gap-1">
                  <InfoItem label="趋势强度" value={`${f.trendStrength.toFixed(1)}`} />
                  <InfoItem label="机构活跃度" value={`${f.jiGouHuoYueDu.toFixed(1)}`} />
                  <InfoItem label="生命线" value={`${f.lifeLine.toFixed(2)}`} />
                  <InfoItem label="压力位" value={`${f.pressure.toFixed(2)}`} />
                </View>

                {/* 白消天数 */}
                {f.baiXiao && (
                  <View className="mt-3 pt-3 border-t border-gray-100">
                    <Text className="block text-xs text-gray-600">
                      DIFF 上穿 DEA 第 {f.baiXiaoPureDays || f.baiXiaoDays} 天
                    </Text>
                    <Text className="block text-xs text-gray-400 mt-1">
                      DIFF在DEA{f.diff >= f.dea ? '上方' : '下方'}，差{(f.diff - f.dea).toFixed(2)}
                    </Text>
                  </View>
                )}

                <Separator className="my-3" />

                {/* 关键信号标识（中性展示） */}
                <Text className="block text-xs font-medium text-gray-600 mb-2">触发信号</Text>
                <View className="flex flex-row flex-wrap gap-2">
                  {getActiveSignals(f, result?.signals).length > 0 ? (
                    getActiveSignals(f, result?.signals).map((item, idx) => (
                      <View key={idx} className="flex flex-col">
                        <Badge style={{ backgroundColor: signalBadgeColor(item.type), color: '#fff' }}>
                          <Text className="block text-xs">{item.name}</Text>
                        </Badge>
                        {item.description && (
                          <Text className="block text-xs text-gray-400 mt-1">{item.description}</Text>
                        )}
                      </View>
                    ))
                  ) : (
                    <Text className="block text-xs text-gray-400">暂无触发信号</Text>
                  )}
                </View>

                {/* 冲突信号 */}
                {f.conflict && (
                  <View className="mt-2 p-2 bg-yellow-50 rounded-lg">
                    <Text className="block text-xs text-yellow-700">{f.conflict}</Text>
                  </View>
                )}
              </CardContent>
            </Card>

            {/* 回测统计卡片 */}
            {f.backtestStats && (
              <Card>
                <CardContent className="p-4">
                  <BacktestStatsCard stats={f.backtestStats} />
                </CardContent>
              </Card>
            )}

            {/* DIFF vs 压力位对比 */}
            <Card>
              <CardContent className="p-4">
                <Text className="block text-xs font-medium text-gray-600 mb-2">关键水平对比</Text>
                <View className="flex flex-col gap-2">
                  <View className="flex flex-row items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <View className="flex flex-row items-center gap-2">
                      <View className="w-2 h-2 rounded-full bg-red-400" />
                      <Text className="block text-xs text-gray-600">DIFF</Text>
                    </View>
                    <Text className="block text-xs font-mono font-medium text-gray-900">{f.diff.toFixed(2)}</Text>
                  </View>
                  <View className="flex flex-row items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <View className="flex flex-row items-center gap-2">
                      <View className="w-2 h-2 rounded-full bg-orange-400" />
                      <Text className="block text-xs text-gray-600">DEA</Text>
                    </View>
                    <Text className="block text-xs font-mono font-medium text-gray-900">{f.dea.toFixed(2)}</Text>
                  </View>
                  <View className="flex flex-row items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <View className="flex flex-row items-center gap-2">
                      <View className="w-2 h-2 rounded-full bg-purple-400" />
                      <Text className="block text-xs text-gray-600">压力位</Text>
                    </View>
                    <Text className="block text-xs font-mono font-medium text-gray-900">{f.pressure.toFixed(2)}</Text>
                  </View>
                  <View className="flex flex-row items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <View className="flex flex-row items-center gap-2">
                      <View className="w-2 h-2 rounded-full bg-blue-400" />
                      <Text className="block text-xs text-gray-600">生命线</Text>
                    </View>
                    <Text className="block text-xs font-mono font-medium text-gray-900">{f.lifeLine.toFixed(2)}</Text>
                  </View>
                </View>
                {/* 关系描述（纯数据描述，非建议） */}
                <View className="mt-2 p-2 bg-gray-50 rounded-lg">
                  <Text className="block text-xs text-gray-500 leading-relaxed">
                    DIFF与DEA差值{(f.diff - f.dea).toFixed(2)}，
                    {f.diff > f.dea ? 'DIFF位于DEA上方' : 'DIFF位于DEA下方'}
                    {f.baiXiao ? '，DIFF上穿DEA形态持续中' : ''}
                    {f.diff > f.pressure ? '，DIFF高于压力位' : '，DIFF低于压力位'}
                    {f.diff > f.lifeLine ? '，DIFF高于生命线' : '，DIFF低于生命线'}
                  </Text>
                </View>
              </CardContent>
            </Card>
          </View>
        )}

        {/* 创业板机会区 */}
        <View className="mt-4">
          <View className="flex flex-row items-center gap-2 mb-2">
            <Text className="block text-sm font-semibold">📈 创业板机会区</Text>
            <View className="flex-1" />
            <Text className="block text-xs text-gray-400">
              {gemTimestamp ? (() => {
                const diff = Math.floor((Date.now() - gemTimestamp) / 60000);
                if (diff < 1) return '刚刚更新';
                return `${diff} 分钟前更新`;
              })() : '自动刷新中'}
            </Text>
          </View>
          {gemLoading && gemData === null ? (
            <View className="flex flex-col gap-2">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-3">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-3 w-48" />
                  </CardContent>
                </Card>
              ))}
            </View>
          ) : gemData && gemData.length > 0 ? (
            <View className="flex flex-col gap-2">
              <View className="flex flex-row items-center px-2 py-1 bg-gray-50 rounded-lg">
                <View style={{ flex: 1.1 }}>
                  <Text className="block text-xs text-gray-400">名称</Text>
                </View>
                <View style={{ flex: 0.55 }} className="text-center">
                  <Text className="block text-xs text-gray-400">操作</Text>
                </View>
                <View style={{ flex: 0.8 }} className="text-center">
                  <Text className="block text-xs text-gray-400">价格</Text>
                </View>
                <View style={{ flex: 0.8 }} className="text-center">
                  <Text className="block text-xs text-gray-400">涨幅</Text>
                </View>
                <View style={{ flex: 0.9 }} className="text-right">
                  <Text className="block text-xs text-gray-400">位置·资金</Text>
                </View>
              </View>
              {gemData.map((stock, idx) => {
                const action = stock.suggestion || getOpportunitySuggestion(stock);
                return (
                <Card key={stock.code}>
                  <CardContent className="p-3">
                    <View className="flex flex-row items-center" onClick={() => handleSearchByCode(stock.code, stock.suggestion)}>
                      <View style={{ flex: 1.1 }}>
                        <View className="flex flex-row items-center gap-1">
                          <Badge className="px-1 bg-purple-50 text-purple-700 border-purple-200 flex-shrink-0 py-0">
                            <Text className="block text-xs">#{idx + 1}</Text>
                          </Badge>
                          <View className="min-w-0 flex-1">
                            <Text className="block text-xs font-medium truncate">{stock.name || stock.code}</Text>
                            <Text className="block text-xs text-gray-400">{stock.code}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ flex: 0.55 }} className="text-center">
                        <Text className="block text-xs text-white font-bold px-1 py-1 rounded-sm" style={{ backgroundColor: ACTION_BADGE_COLOR[action] ?? '#999' }}>{action || '-'}</Text>
                      </View>
                      <View style={{ flex: 0.8 }} className="text-center">
                        <Text className="block text-xs font-medium">{stock.currentPrice?.toFixed(2)}</Text>
                        <Text className="block text-xs" style={{ color: (stock.changePercent ?? 0) >= 0 ? '#ef4444' : '#22c55e' }}>
                          {(stock.changePercent ?? 0) >= 0 ? '+' : ''}{stock.changePercent?.toFixed(2)}%
                        </Text>
                      </View>
                      <View style={{ flex: 0.8 }} className="text-center">
                        <Text className="block text-xs" style={{ color: (stock.priceIncrease ?? 0) <= 10 ? '#22c55e' : (stock.priceIncrease ?? 0) <= 20 ? '#eab308' : '#ef4444' }}>
                          {(stock.priceIncrease ?? 0) > 0 ? '+' : ''}{(stock.priceIncrease ?? 0).toFixed(1)}%
                        </Text>
                      </View>
                      <View style={{ flex: 0.9 }} className="text-right">
                        <Text className="block text-xs font-medium" style={{ color: (stock.pricePosition ?? 0) < 50 ? '#22c55e' : (stock.pricePosition ?? 0) < 80 ? '#eab308' : '#ef4444' }}>位置{(stock.pricePosition ?? 0).toFixed(0)}%</Text>
                        <Text className="block text-xs" style={{ color: mainForceColor(stock.mainForceInflow) }}>
                          {formatMainForce(stock.mainForceInflow)}
                        </Text>
                      </View>
                    </View>
                  </CardContent>
                </Card>
              );
            })}
            </View>
          ) : (
            <View className="p-4 bg-gray-50 rounded-xl">
              <Text className="block text-xs text-gray-400 text-center">暂无符合条件的信号</Text>
            </View>
          )}
        </View>

        {/* 主板机会区 */}
        <View className="mt-4">
          <View className="flex flex-row items-center gap-2 mb-2">
            <Text className="block text-sm font-semibold">📊 主板机会区</Text>
            <View className="flex-1" />
            <Text className="block text-xs text-gray-400">
              {mainTimestamp ? (() => {
                const diff = Math.floor((Date.now() - mainTimestamp) / 60000);
                if (diff < 1) return '刚刚更新';
                return `${diff} 分钟前更新`;
              })() : '自动刷新中'}
            </Text>
          </View>
          {mainLoading && mainData === null ? (
            <View className="flex flex-col gap-2">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-3">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-3 w-48" />
                  </CardContent>
                </Card>
              ))}
            </View>
          ) : mainData && mainData.length > 0 ? (
            <View className="flex flex-col gap-2">
              <View className="flex flex-row items-center px-2 py-1 bg-gray-50 rounded-lg">
                <View style={{ flex: 1.1 }}>
                  <Text className="block text-xs text-gray-400">名称</Text>
                </View>
                <View style={{ flex: 0.55 }} className="text-center">
                  <Text className="block text-xs text-gray-400">操作</Text>
                </View>
                <View style={{ flex: 0.8 }} className="text-center">
                  <Text className="block text-xs text-gray-400">价格</Text>
                </View>
                <View style={{ flex: 0.8 }} className="text-center">
                  <Text className="block text-xs text-gray-400">涨幅</Text>
                </View>
                <View style={{ flex: 0.9 }} className="text-right">
                  <Text className="block text-xs text-gray-400">位置·资金</Text>
                </View>
              </View>
              {mainData.map((item: any, idx: number) => {
                const action = item.suggestion || getOpportunitySuggestion(item);
                return (
                <Card key={`main-${item.code}-${idx}`}>
                  <CardContent className="p-3">
                    <View className="flex flex-row items-center" onClick={() => handleSearchByCode(item.code, item.suggestion)}>
                      <View style={{ flex: 1.1 }}>
                        <View className="flex flex-row items-center gap-1">
                          <Badge className="px-1 bg-blue-50 text-blue-700 border-blue-200 flex-shrink-0 py-0">
                            <Text className="block text-xs">#{idx + 1}</Text>
                          </Badge>
                          <View className="min-w-0 flex-1">
                            <Text className="block text-xs font-medium truncate">{item.name || item.code}</Text>
                            <Text className="block text-xs text-gray-400">{item.code}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ flex: 0.55 }} className="text-center">
                        <Text className="block text-xs text-white font-bold px-1 py-1 rounded-sm" style={{ backgroundColor: ACTION_BADGE_COLOR[action] ?? '#999' }}>{action || '-'}</Text>
                      </View>
                      <View style={{ flex: 0.8 }} className="text-center">
                        <Text className="block text-xs font-medium">{item.currentPrice?.toFixed(2)}</Text>
                        <Text className="block text-xs" style={{ color: (item.changePercent ?? 0) >= 0 ? '#ef4444' : '#22c55e' }}>
                          {(item.changePercent ?? 0) >= 0 ? '+' : ''}{item.changePercent?.toFixed(2)}%
                        </Text>
                      </View>
                      <View style={{ flex: 0.8 }} className="text-center">
                        <Text className="block text-xs" style={{ color: (item.priceIncrease ?? 0) <= 10 ? '#22c55e' : (item.priceIncrease ?? 0) <= 20 ? '#eab308' : '#ef4444' }}>
                          {(item.priceIncrease ?? 0) > 0 ? '+' : ''}{(item.priceIncrease ?? 0).toFixed(1)}%
                        </Text>
                      </View>
                      <View style={{ flex: 0.9 }} className="text-right">
                        <Text className="block text-xs font-medium" style={{ color: (item.pricePosition ?? 0) < 50 ? '#22c55e' : (item.pricePosition ?? 0) < 80 ? '#eab308' : '#ef4444' }}>位置{(item.pricePosition ?? 0).toFixed(0)}%</Text>
                        <Text className="block text-xs" style={{ color: mainForceColor(item.mainForceInflow) }}>
                          {formatMainForce(item.mainForceInflow)}
                        </Text>
                      </View>
                    </View>
                  </CardContent>
                </Card>
              );
            })}
            </View>
          ) : (
            <View className="p-4 bg-gray-50 rounded-xl">
              <Text className="block text-xs text-gray-400 text-center">暂无符合条件的信号</Text>
            </View>
          )}
        </View>

        {/* 热点板块机会区 */}
        <View className="mt-4">
          <View className="flex flex-row items-center gap-2 mb-2">
            <Text className="block text-sm font-semibold">🔥 热点板块机会区</Text>
            <View className="flex-1" />
            {sectorTimestamp > 0 && !sectorLoading && (() => {
              const diff = Math.floor((Date.now() - sectorTimestamp) / 60000);
              if (diff < 1) return <Text className="block text-xs text-green-500">刚刚更新</Text>;
              return <Text className="block text-xs text-green-500">{diff} 分钟前更新</Text>;
            })()}
            {sectorLoading && <Text className="block text-xs text-gray-400">加载中...</Text>}
          </View>

          {sectorLoading && sectorData === null ? (
            <View className="flex flex-col gap-2">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-3">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-3 w-48" />
                  </CardContent>
                </Card>
              ))}
            </View>
          ) : sectorData && sectorData.length > 0 ? (
            <View className="flex flex-col gap-2">
              {/* 热点标签 */}
              <View className="flex flex-row flex-wrap gap-1 mb-2">
                {[...new Set(sectorData.map((s: any) => s.sectorName).filter(Boolean))].slice(0, 10).map((sname: string, i: number) => (
                  <Badge key={i} className="px-2 py-1 bg-orange-50 text-orange-700 border-orange-200 text-xs rounded-full">
                    <Text className="block text-xs truncate max-w-20">{sname}</Text>
                  </Badge>
                ))}
              </View>
              <View className="flex flex-row items-center px-2 py-1 bg-gray-50 rounded-lg">
                <View style={{ flex: 1.1 }}>
                  <Text className="block text-xs text-gray-400">名称 · 板块</Text>
                </View>
                <View style={{ flex: 0.55 }} className="text-center">
                  <Text className="block text-xs text-gray-400">操作</Text>
                </View>
                <View style={{ flex: 0.8 }} className="text-center">
                  <Text className="block text-xs text-gray-400">价格</Text>
                </View>
                <View style={{ flex: 0.8 }} className="text-center">
                  <Text className="block text-xs text-gray-400">涨幅</Text>
                </View>
                <View style={{ flex: 0.9 }} className="text-right">
                  <Text className="block text-xs text-gray-400">位置·资金</Text>
                </View>
              </View>
              {sectorData.map((item: any, idx: number) => {
                const action = item.suggestion || getOpportunitySuggestion(item);
                const sectorName = item.sectorName || '';
                return (
                <Card key={`sector-${item.code}-${idx}`}>
                  <CardContent className="p-3">
                    <View className="flex flex-row items-center" onClick={() => handleSearchByCode(item.code, item.suggestion)}>
                      <View style={{ flex: 1.1 }}>
                        <View className="flex flex-row items-center gap-1">
                          <Badge className="px-1 bg-orange-50 text-orange-700 border-orange-200 flex-shrink-0 py-0">
                            <Text className="block text-xs">#{idx + 1}</Text>
                          </Badge>
                          <View className="min-w-0 flex-1">
                            <Text className="block text-xs font-medium truncate">{item.name}</Text>
                            <Text className="block text-xs text-gray-400">{sectorName || item.code}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ flex: 0.55 }} className="text-center">
                        <Text className="block text-xs text-white font-bold px-1 py-1 rounded-sm" style={{ backgroundColor: ACTION_BADGE_COLOR[action] ?? '#999' }}>{action || '-'}</Text>
                      </View>
                      <View style={{ flex: 0.8 }} className="text-center">
                        <Text className="block text-xs font-medium">{item.currentPrice?.toFixed(2)}</Text>
                        <Text className="block text-xs" style={{ color: (item.changePercent ?? 0) >= 0 ? '#ef4444' : '#22c55e' }}>
                          {(item.changePercent ?? 0) >= 0 ? '+' : ''}{item.changePercent?.toFixed(2)}%
                        </Text>
                      </View>
                      <View style={{ flex: 0.8 }} className="text-center">
                        <Text className="block text-xs" style={{ color: (item.priceIncrease ?? 0) <= 10 ? '#22c55e' : (item.priceIncrease ?? 0) <= 20 ? '#eab308' : '#ef4444' }}>
                          {(item.priceIncrease ?? 0) > 0 ? '+' : ''}{(item.priceIncrease ?? 0).toFixed(1)}%
                        </Text>
                      </View>
                      <View style={{ flex: 0.9 }} className="text-right">
                        <Text className="block text-xs font-medium" style={{ color: (item.pricePosition ?? 0) < 50 ? '#22c55e' : (item.pricePosition ?? 0) < 80 ? '#eab308' : '#ef4444' }}>位置{(item.pricePosition ?? 0).toFixed(0)}%</Text>
                        <Text className="block text-xs" style={{ color: mainForceColor(item.mainForceInflow) }}>
                          {formatMainForce(item.mainForceInflow)}
                        </Text>
                      </View>
                    </View>
                  </CardContent>
                </Card>
              );
            })}
            </View>
          ) : (
            <View className="p-4 bg-gray-50 rounded-xl">
              <Text className="block text-xs text-gray-400 text-center">暂无符合条件的信号</Text>
            </View>
          )}
        </View>
        {/* 底部信息 */}
          <View className="mt-6 pt-4 border-t border-gray-100">
            <Text className="block text-xs text-gray-400 text-center">
              北京时间 {(() => {
                const now = new Date();
                const cn = new Intl.DateTimeFormat('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                  year: 'numeric', month: '2-digit', day: '2-digit',
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                  hour12: false
                }).formatToParts(now);
                const map: Record<string, string> = {};
                cn.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
                return `${map.year}年${map.month}月${map.day}日 ${map.hour}:${map.minute}:${map.second}`;
              })()}
            </Text>
            <Text className="block text-xs text-gray-400 text-center mt-1">
              开发者：呱呱小白狗
            </Text>
            <Text className="block text-xs text-gray-300 text-center mt-1">
              所有数据仅供技术分析参考，不构成投资建议
            </Text>
          </View>
        </View>
    </ScrollView>
    </View>
  );
};

export default IndexPage;