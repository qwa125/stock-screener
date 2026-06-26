/**
 * 交易建议共享算法 v2
 * 与前端 src/pages/index/index.tsx 的 getTradingSuggestion 保持完全一致
 *
 * 设计原则：
 * 1. 低位区：趋势刚拐头+强信号=重仓买入（用户核心需求）
 * 2. 信号等级：strongBuy > hasBuySignal > hasSellSignal > strongSell
 * 3. 趋势权重：ma5/ma10/ma20 三线关系
 * 4. 位置越低买入条件越宽松，位置越高买入条件越严格
 */

export interface SuggestionResult {
  action: string;
  color: string;
  reason: string;
  prediction: string;
}

function getPositionLabel(position: number): string {
  if (position < 25) return '低位区';
  if (position < 45) return '中低位区';
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
  baiBu?: boolean;
  baiXiao?: boolean;
  baiXiaoDays?: number;
  baiBuDays?: number;
  baiCoverTrend?: 'exiting' | 'entering' | 'stable';
  volumeStructure?: number;
}

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

  const strongBuy =
    (!!f.macdGoldenCross && volumeBullish) ||
    (f.baiXiaoDays ?? 0) >= 3 ||
    (!!f.shortBuy && volumeBullish);

  const strongSell = !!f.macdDeathCross || !!f.strongSell;
  const baiXiao = !!f.baiXiao;
  const baiBu = !!f.baiBu;
  const baiXiaoActive = baiXiao && (f.baiXiaoDays ?? 0) >= 1;
  // XMA平移补偿：检测最近3根K线的覆盖状态变化趋势
  const baiCoverTrend = f.baiCoverTrend ?? 'stable';
  const baiXiaoFresh = baiXiao && baiCoverTrend === 'exiting';   // 刚出白布(白消恢复期)
  const baiBuFresh = baiBu && baiCoverTrend === 'entering';      // 刚进白布(白布出现期)

  // ─── 1) 低位区 (<25%) ───
  // 用户核心需求：ma5刚拐头(trend>=1) + 强信号 = 重仓买入
  if (zone.includes('低位')) {
    if (longDecline && trend <= 1 && !macdBullish && !volumeBullish) {
      return {
        action: '不要介入',
        color: 'bg-gray-500',
        reason: '长期下跌+无量能支撑，回避',
        prediction: '未来1-2日无量能支撑，建议回避',
      };
    }
    if (trend >= 1 && strongBuy) {
      return {
        action: '重仓买入',
        color: 'bg-red-600',
        reason: '低位+趋势拐头+强信号共振',
        prediction: '未来1-2日有望放量启动，建议重仓买入',
      };
    }
    if (trend >= 1 && hasBuySignal) {
      return {
        action: '买入',
        color: 'bg-green-600',
        reason: '低位+趋势拐头+买入信号',
        prediction: '未来1-2日有望延续反弹，建议买入',
      };
    }
    if (trend >= 1) {
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '低位+趋势拐头，等待信号确认',
        prediction: '未来1-2日方向待确认，建议持有',
      };
    }
    // trend === 0 — 下降趋势不产生任何买入信号
    if (baiXiaoFresh) {
      return {
        action: '轻仓买入',
        color: 'bg-green-500',
        reason: '低位+刚出白布恢复期', 
        prediction: '未来1-2日刚出白布恢复期有望反弹，建议轻仓买入',
      };
    }
    if (baiXiaoActive) {
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '低位+白消恢复期，均线修复中',
        prediction: '未来1-2日白消恢复期有望企稳，建议持有',
      };
    }
    return {
      action: '不要介入',
      color: 'bg-gray-500',
      reason: '低位+下降趋势，均线空头压制',
      prediction: '未来1-2日预计继续探底，建议不要介入',
    };
  }

  // ─── 2) 中低位区 (25-45%) ───
  if (zone.includes('中低位')) {
    if (trend >= 2 && strongBuy) {
      return {
        action: '买入',
        color: 'bg-green-600',
        reason: '中低位+上升趋势+强信号',
        prediction: '未来1-2日有望延续上涨，建议买入',
      };
    }
    if (trend >= 2 && hasBuySignal) {
      return {
        action: '轻仓买入',
        color: 'bg-green-500',
        reason: '中低位+上升趋势+买入信号',
        prediction: '未来1-2日有望继续上行，建议买入',
      };
    }
    if (trend >= 1 && strongBuy) {
      return {
        action: '买入',
        color: 'bg-green-600',
        reason: '中低位+拐头+强信号',
        prediction: '未来1-2日有望启动，建议买入',
      };
    }
    if (trend >= 1 && hasBuySignal) {
      return {
        action: '轻仓买入',
        color: 'bg-green-500',
        reason: '中低位+拐头+买入信号',
        prediction: '未来1-2日有望回暖，建议买入',
      };
    }
    if (trend >= 2) {
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '中低位+上升趋势，等待信号',
        prediction: '未来1-2日方向待确认，建议持有',
      };
    }
    if (baiXiaoFresh) {
      return {
        action: '买入',
        color: 'bg-green-600',
        reason: '中低位+刚出白布恢复期，有望回暖',
        prediction: '未来1-2日刚出白布恢复期有望反弹，建议买入',
      };
    }
    if (baiXiaoActive) {
      return {
        action: '轻仓买入',
        color: 'bg-green-500',
        reason: '中低位+白消恢复期，有望回暖',
        prediction: '未来1-2日白消恢复期有望反弹，建议轻仓买入',
      };
    }
    if (baiBuFresh) {
      return {
        action: '减仓',
        color: 'bg-orange-500',
        reason: '中低位+白布出现，可能继续走弱',
        prediction: '未来1-2日白布覆盖可能出现调整，建议减仓',
      };
    }
    return {
      action: '减仓',
      color: 'bg-orange-500',
      reason: '中低位+下降趋势，注意风险',
      prediction: '未来1-2日预计偏弱，建议减仓',
    };
  }

  // ─── 3) 中位区 (45-55%) ───
  if (zone.includes('中位') && !zone.includes('低') && !zone.includes('高')) {
    if (trend >= 2 && strongBuy) {
      return {
        action: '买入',
        color: 'bg-green-600',
        reason: '中位区+上升+强信号共振',
        prediction: '未来1-2日有望延续上涨，建议买入',
      };
    }
    if (trend >= 2 && hasBuySignal) {
      return {
        action: '轻仓买入',
        color: 'bg-green-500',
        reason: '中位区+上升+买入信号',
        prediction: '未来1-2日有望上涨，建议买入',
      };
    }
    if (trend >= 2) {
      if (strongSell) {
        return {
          action: '卖出',
          color: 'bg-red-500',
          reason: '中位区上升+卖出信号，清仓',
          prediction: '未来1-2日预计回落，建议卖出',
        };
      }
      if (hasSellSignal) {
        return {
          action: '减仓',
          color: 'bg-orange-500',
          reason: '中位区上升+减仓信号，控制风险',
          prediction: '未来1-2日可能调整，建议减仓',
        };
      }
      if (baiBuFresh) {
        return {
          action: '减仓',
          color: 'bg-orange-500',
          reason: '中位区上升+白布出现，趋势可能反转',
          prediction: '未来1-2日白布覆盖可能出现调整，建议减仓',
        };
      }
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '中位区+上升趋势，暂持',
        prediction: '未来1-2日继续持有观察',
      };
    }
    if (trend === 1 && strongBuy) {
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '中位区+横盘+强信号，关注突破',
        prediction: '未来1-2日有望启动，建议介入',
      };
    }
    if (trend === 1) {
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '中位区横盘，方向不明',
        prediction: '未来1-2日方向待定，建议持有',
      };
    }
    // trend === 0
    if (strongBuy) {
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '中位区下降+强信号，暂持',
        prediction: '未来1-2日信号验证中，建议持有',
      };
    }
    if (baiXiaoActive) {
      return {
        action: '轻仓买入',
        color: 'bg-green-500',
        reason: '中位区下降+白消恢复期',
        prediction: '未来1-2日白消恢复期有望反弹，建议轻仓买入',
      };
    }
    return {
      action: '减仓',
      color: 'bg-orange-500',
      reason: '中位区+下降趋势，控制风险',
      prediction: '未来1-2日预计偏弱，建议减仓',
    };
  }

  // ─── 4) 中高位区 (55-75%) ───
  if (zone.includes('中高位')) {
    if (trend >= 2 && strongBuy) {
      return {
        action: '轻仓买入',
        color: 'bg-green-500',
        reason: '中高位+上升+强信号，注意风险',
        prediction: '未来1-2日有望突破，建议轻仓买入',
      };
    }
    if (trend >= 2) {
      if (strongSell) {
        return {
          action: '卖出',
          color: 'bg-red-500',
          reason: '中高位上升+卖出信号，清仓',
          prediction: '未来1-2日预计回落，建议卖出',
        };
      }
      if (hasSellSignal) {
        return {
          action: '减仓',
          color: 'bg-orange-500',
          reason: '中高位上升+减仓信号，注意风险',
          prediction: '未来1-2日可能调整，建议减仓',
        };
      }
      if (baiBuFresh) {
        return {
          action: '减仓',
          color: 'bg-orange-500',
          reason: '中高位上升+白布出现，趋势可能反转',
          prediction: '未来1-2日白布覆盖可能出现调整，建议减仓',
        };
      }
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '中高位+上升趋势，暂持',
        prediction: '未来1-2日建议继续持有看突破',
      };
    }
    if (trend === 1) {
      if (strongBuy) {
        return {
          action: '持有',
          color: 'bg-yellow-500',
          reason: '中高位+横盘+强信号，关注',
          prediction: '未来1-2日有望突破，建议介入',
        };
      }
      return {
        action: '减仓',
        color: 'bg-orange-500',
        reason: '中高位横盘，控制仓位',
        prediction: '未来1-2日预计震荡调整，建议减仓',
      };
    }
    // trend === 0
    if (strongSell) {
      return {
        action: '卖出',
        color: 'bg-red-500',
        reason: '中高位下降+卖出信号',
        prediction: '未来1-2日预计继续回落，建议卖出',
      };
    }
    if (baiXiaoActive) {
      return {
        action: '轻仓买入',
        color: 'bg-green-500',
        reason: '中高位下降+白消恢复期',
        prediction: '未来1-2日白消恢复期有望反弹，建议轻仓买入',
      };
    }
    return {
      action: '减仓',
      color: 'bg-orange-500',
      reason: '中高位+下降趋势',
      prediction: '未来1-2日预计偏弱，建议减仓',
    };
  }

  // ─── 5) 高位区 (>=75%) ───
  if (trend === 0) {
    if (strongSell) {
      return {
        action: '卖出',
        color: 'bg-red-600',
        reason: '高位下降+卖出信号，清仓离场',
        prediction: '未来1-2日预计继续回落，建议卖出',
      };
    }
    return {
      action: '卖出',
      color: 'bg-red-500',
      reason: '高位下降趋势，注意风险',
      prediction: '未来1-2日预计偏弱，建议卖出',
    };
  }
  if (trend === 1) {
    if (strongBuy) {
      return {
        action: '持有',
        color: 'bg-yellow-500',
        reason: '高位横盘+强信号，关注突破',
        prediction: '未来1-2日有望突破，建议介入',
      };
    }
    if (strongSell || baiBuFresh) {
      return {
        action: '卖出',
        color: 'bg-red-500',
        reason: strongSell ? '高位横盘+卖出信号' : '高位横盘+白布出现',
        prediction: '未来1-2日预计回落，建议卖出',
      };
    }
    return {
      action: '减仓',
      color: 'bg-orange-500',
      reason: '高位横盘，控制仓位',
      prediction: '未来1-2日预计震荡调整，建议减仓',
    };
  }
  // trend >= 2
  if (strongBuy) {
    return {
      action: '轻仓买入',
      color: 'bg-green-500',
      reason: '高位上升+强信号，强趋势延续',
      prediction: '未来1-2日有望继续上攻，建议轻仓买入',
    };
  }
  if (strongSell) {
    return {
      action: '卖出',
      color: 'bg-red-500',
      reason: '高位上升+卖出信号，清仓离场',
      prediction: '未来1-2日预计回落，建议卖出',
    };
  }
  if (hasSellSignal) {
    return {
      action: '减仓',
      color: 'bg-orange-500',
      reason: '高位上升+减仓信号，控制仓位',
      prediction: '未来1-2日可能调整，建议减仓',
    };
  }
  return {
    action: '持有',
    color: 'bg-yellow-500',
    reason: '高位但仍有上升动能，暂持',
    prediction: '未来1-2日继续持有观察',
  };
}