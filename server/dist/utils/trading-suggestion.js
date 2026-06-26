"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTradingSuggestion = getTradingSuggestion;
function getPositionLabel(position) {
    if (position < 25)
        return '低位区';
    if (position < 45)
        return '中低位区';
    if (position < 55)
        return '中位区';
    if (position < 75)
        return '中高位区';
    return '高位区';
}
function getTradingSuggestion(f) {
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
    const strongBuy = (!!f.macdGoldenCross && volumeBullish) ||
        (f.baiXiaoDays ?? 0) >= 3 ||
        (!!f.shortBuy && volumeBullish);
    const strongSell = !!f.macdDeathCross || !!f.strongSell;
    const baiXiao = !!f.baiXiao;
    const baiBu = !!f.baiBu;
    const baiXiaoActive = baiXiao && (f.baiXiaoDays ?? 0) >= 1;
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
        if (baiXiaoActive) {
            return {
                action: '轻仓买入',
                color: 'bg-green-500',
                reason: '中低位+白消恢复期，有望回暖',
                prediction: '未来1-2日白消恢复期有望反弹，建议轻仓买入',
            };
        }
        return {
            action: '持有',
            color: 'bg-yellow-500',
            reason: '中低位+横盘，等待方向',
            prediction: '未来1-2日可能震荡，建议持有',
        };
    }
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
            if (baiBu) {
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
            if (baiBu) {
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
        if (strongSell || baiBu) {
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
