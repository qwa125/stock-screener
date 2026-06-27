"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTradingSuggestion = getTradingSuggestion;
function getTradingSuggestion(input) {
    const { baiXiao, baiXiaoDays, baiBu, baiXiaoBuy1, qiangShiHuiCai, hengPanTuPo, zhenDangMaiDian, zhongWeiZhuSheng, zhongGaoWeiZhuSheng, gaoFengXianZhuSheng, jiaCang, diBuBuy, zhuLiShiPan, qiWen, tiaoJianChengLi, zhuLiChuHuo, gaoKaiDiZouQingCang, baoLiangFuGaiQingCang, po5RiXian, qiangZhiFuGai, yinDiePoWei, jiGouActiveScore, ma5, ma10, currentPrice, } = input;
    const ma5Up = input.ma5Up !== undefined ? input.ma5Up : true;
    const ma10Up = input.ma10Up !== undefined ? input.ma10Up : true;
    const confirmedDays = input.confirmedBaiXiaoDays !== undefined ? input.confirmedBaiXiaoDays : baiXiaoDays;
    const edgeOnlyBaiXiao = baiXiao && confirmedDays === 0 && baiXiaoDays > 0;
    const edgeInflated = confirmedDays > 0 && baiXiaoDays > confirmedDays;
    const conservativeDays = confirmedDays;
    const baiXiaoEarly = baiXiao && conservativeDays >= 1 && conservativeDays <= 6;
    const baiXiaoLate = baiXiao && conservativeDays >= 7;
    const hasBaiSanJiaoBuySignal = zhenDangMaiDian || zhongWeiZhuSheng || zhongGaoWeiZhuSheng || gaoFengXianZhuSheng || jiaCang;
    const baiBuConfirmed = input.confirmedBaiBuDays !== undefined
        ? input.confirmedBaiBuDays > 0
        : baiBu;
    const jiGouActive = jiGouActiveScore >= 12;
    const ma5AboveMa10 = ma5 > ma10;
    const ma5UpAndMa10Up = ma5Up && ma10Up;
    const ma10UpOnly = ma10Up && !ma5Up;
    const ma10Down = !ma10Up;
    const isHighPosition = (input.pricePosition ?? 50) >= 60;
    if (baiXiao && isHighPosition) {
        const sellReasons = [];
        if (gaoKaiDiZouQingCang)
            sellReasons.push('高开低走');
        if (baoLiangFuGaiQingCang)
            sellReasons.push('爆量覆盖');
        if (zhuLiChuHuo)
            sellReasons.push('主力出货');
        if (po5RiXian)
            sellReasons.push('破5日线');
        if (yinDiePoWei)
            sellReasons.push('阴跌破位');
        if (qiangZhiFuGai)
            sellReasons.push('强制覆盖');
        if (sellReasons.length > 0) {
            return {
                action: '卖出',
                reason: '⚠️ 高位白消+' + sellReasons.join('+') + '，XMA漂移预期变白布，提前卖出',
                score: 15,
                entryTiming: 0,
            };
        }
        if (baiXiaoLate && !ma10Up) {
            return {
                action: '卖出',
                reason: '⚠️ 高位白消晚期+10日线向下，XMA漂移预期变白布，提前卖出',
                score: 12,
                entryTiming: 0,
            };
        }
    }
    if (gaoKaiDiZouQingCang || baoLiangFuGaiQingCang || po5RiXian || qiangZhiFuGai || yinDiePoWei) {
        return {
            action: '卖出',
            reason: getSellReason(gaoKaiDiZouQingCang, baoLiangFuGaiQingCang, po5RiXian, qiangZhiFuGai, yinDiePoWei) +
                (edgeOnlyBaiXiao ? '（注意：XMA边缘效应，白消状态可能偏移）' : ''),
            score: 10,
            entryTiming: 0,
        };
    }
    if (ma10Down) {
        return {
            action: '不要介入',
            reason: '10日线往下，趋势走弱不介入',
            score: 5,
            entryTiming: 0,
        };
    }
    if (baiXiao && zhuLiChuHuo) {
        return {
            action: '减仓',
            reason: '白消阶段出现主力出货信号',
            score: 20,
            entryTiming: 10,
        };
    }
    if (ma5UpAndMa10Up || ma10UpOnly) {
    }
    else {
    }
    if (baiXiaoEarly) {
        if (baiXiaoBuy1) {
            return buildResult('重仓买入', '白消第' + conservativeDays + '天，白消启动' + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 95, 85);
        }
        if (qiangShiHuiCai) {
            return buildResult('重仓买入', '白消第' + conservativeDays + '天，强势回踩' + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 93, 80);
        }
        if (qiangShiHuiCai && hasBaiSanJiaoBuySignal) {
            return buildResult('重仓买入', '白消第' + conservativeDays + '天，强势回踩+' + getBaiSanJiaoNames(input) + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 96, 88);
        }
        if (baiXiaoBuy1 && hasBaiSanJiaoBuySignal) {
            return buildResult('重仓买入', '白消第' + conservativeDays + '天，启动+' + getBaiSanJiaoNames(input) + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 96, 88);
        }
        if (zhongWeiZhuSheng || zhongGaoWeiZhuSheng || gaoFengXianZhuSheng || jiaCang) {
            return buildResult('重仓买入', '白消第' + conservativeDays + '天，' + getBaiSanJiaoNames(input) + '信号', 92, 82);
        }
        if (zhenDangMaiDian) {
            return buildResult('重仓买入', '白消第' + conservativeDays + '天，震荡买点信号', 88, 78);
        }
        if (jiGouActive && ma5UpAndMa10Up && currentPrice >= ma5) {
            return buildResult('重仓买入', '白消第' + conservativeDays + '天，机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 87, 80);
        }
    }
    if (baiXiaoLate) {
        if (hengPanTuPo) {
            return buildResult('买入', '白消第' + conservativeDays + '天，横盘突破' + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 82, 72);
        }
        if (hengPanTuPo && hasBaiSanJiaoBuySignal) {
            return buildResult('买入', '白消第' + conservativeDays + '天，横盘突破+' + getBaiSanJiaoNames(input), 86, 78);
        }
        if (qiangShiHuiCai && hasBaiSanJiaoBuySignal) {
            return buildResult('买入', '白消第' + conservativeDays + '天，强势回踩+' + getBaiSanJiaoNames(input), 84, 75);
        }
        if (qiangShiHuiCai) {
            return buildResult('买入', '白消第' + conservativeDays + '天，强势回踩', 80, 70);
        }
        if (jiGouActive && ma5UpAndMa10Up && currentPrice >= ma5) {
            return buildResult('买入', '白消第' + conservativeDays + '天，机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 80, 72);
        }
        if (hasBaiSanJiaoBuySignal) {
            return buildResult('买入', '白消第' + conservativeDays + '天，' + getBaiSanJiaoNames(input) + '信号', 78, 70);
        }
    }
    if (baiBuConfirmed) {
        if (jiGouActive && ma5UpAndMa10Up && currentPrice >= ma5) {
            return buildResult('轻仓买入', '白布阶段，机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 68, 60);
        }
        if (diBuBuy || qiWen || zhuLiShiPan || tiaoJianChengLi || jiaCang) {
            const names = [];
            if (diBuBuy)
                names.push('主力建仓');
            if (qiWen)
                names.push('企稳');
            if (zhuLiShiPan)
                names.push('主力试盘');
            if (tiaoJianChengLi)
                names.push('条件成立');
            if (jiaCang)
                names.push('加仓');
            return buildResult('轻仓买入', '白布阶段，' + names.join('+'), 65, 55);
        }
    }
    if (jiGouActive && ma5UpAndMa10Up && currentPrice >= ma5) {
        if (hasBaiSanJiaoBuySignal && baiXiao) {
            return buildResult('重仓买入', '机构活跃度' + jiGouActiveScore.toFixed(0) + '+' + getBaiSanJiaoNames(input), 90, 82);
        }
        if (baiXiaoLate) {
            return buildResult('买入', '白消第' + conservativeDays + '天，机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 80, 72);
        }
        if (baiXiao) {
            return buildResult('买入', '白消第' + conservativeDays + '天，机构活跃度' + jiGouActiveScore.toFixed(0), 72, 65);
        }
        return buildResult('轻仓买入', '机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 65, 55);
    }
    if (hasBaiSanJiaoBuySignal && ma5UpAndMa10Up) {
        return buildResult('买入', getBaiSanJiaoNames(input) + '+均线向上', 75, 65);
    }
    if (ma5UpAndMa10Up || ma10UpOnly) {
        return {
            action: '持有',
            reason: ma5UpAndMa10Up ? '5日线和10日线都往上，趋势健康' : '10日线往上，趋势未破坏',
            score: 45,
            entryTiming: 30,
        };
    }
    return {
        action: '不要介入',
        reason: '均线走弱，无明确信号',
        score: 5,
        entryTiming: 0,
    };
}
function buildResult(action, reason, score, entryTiming) {
    return { action, reason, score, entryTiming };
}
function getSellReason(qingcang, baoliang, poxian, jinji, yinDie) {
    const reasons = [];
    if (qingcang)
        reasons.push('清仓信号');
    if (baoliang)
        reasons.push('爆量覆盖');
    if (poxian)
        reasons.push('破5日线');
    if (jinji)
        reasons.push('紧急清仓');
    if (yinDie)
        reasons.push('阴跌破位');
    return '卖出信号：' + reasons.join('+');
}
function getBaiSanJiaoNames(input) {
    const names = [];
    if (input.zhenDangMaiDian)
        names.push('震荡买点');
    if (input.zhongWeiZhuSheng)
        names.push('中位主升');
    if (input.zhongGaoWeiZhuSheng)
        names.push('中高位主升');
    if (input.gaoFengXianZhuSheng)
        names.push('高风险主升');
    if (input.jiaCang)
        names.push('加仓');
    return names.join('/') || '买入信号';
}
