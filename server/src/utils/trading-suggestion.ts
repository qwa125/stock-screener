/**
 * 交易建议系统 - 7级买卖规则
 * 
 * 规则体系（由用户指定）：
 * 重仓买入 > 买入 > 轻仓买入 > 持有 > 减仓 > 卖出 > 不要介入
 * 
 * 核心逻辑：
 * 1. 后端分析所有信号（白消/白三角/白菱形/机构活跃度/均线等）
 * 2. 前端在后端判断为减仓/卖出/不要介入时直接使用后端结果
 * 3. 前端在后端判断为买入类时根据实际涨跌幅可升级操作
 */

export interface SuggestionInput {
  name?: string
  code?: string

  // ---- 白消相关 ----
  baiXiao: boolean
  baiXiaoDays: number
  baiBu: boolean
  baiBuDays?: number
  baiXiaoBuy1: boolean   // 白消启动
  baiXiaoBuy2: boolean   // 白消买点2
  qiangShiHuiCai: boolean // 强势回踩
  hengPanTuPo: boolean    // 横盘突破

  // ---- 白三角信号 ----
  shortBuy: boolean       // 短线买入
  strictBuy: boolean      // 严格买入
  zhenDangMaiDian: boolean   // 震荡买点
  zhongWeiZhuSheng: boolean   // 中位主升
  zhongGaoWeiZhuSheng: boolean // 中高位主升
  gaoFengXianZhuSheng: boolean // 高风险主升
  jiaCang: boolean        // 加仓

  // ---- 白消辅助信号 ----
  diBuBuy: boolean        // 主力建仓
  zhuLiShiPan: boolean    // 主力试盘
  qiWen: boolean          // 企稳（maps to gaoWeiHuiDiaoBuy）
  tiaoJianChengLi: boolean // 条件成立

  // ---- 卖出信号 ----
  zhuLiChuHuo: boolean    // 主力出货
  gaoKaiDiZouQingCang: boolean  // 高开低走清仓
  baoLiangFuGaiQingCang: boolean // 爆量覆盖清仓
  po5RiXian: boolean      // 破5日线
  qiangZhiFuGai: boolean  // 强制覆盖（紧急清仓）
  yinDiePoWei: boolean    // 阴跌破位

  // ---- 机构活跃度 ----
  jiGouActiveScore: number // 0-20

  // ---- 均线数据 ----
  ma5: number
  ma10: number
  currentPrice: number

  // ---- 补充计算字段（由调用方传入） ----
  ma5Up?: boolean         // MA5方向向上
  ma10Up?: boolean        // MA10方向向上
  pricePosition?: number  // 价格位置 0-100
  trendState?: number     // 趋势状态 0-3

  // ---- XMA边缘效应（因XMA未来函数，尾部N根K线可能偏移） ----
  /** XMA不完整导致的尾部不可靠K线数 */
  edgeIncomplete?: number
  /** 基于XMA完整区间的确认白消天数（不会因未来数据偏移） */
  confirmedBaiXiaoDays?: number
  /** 基于XMA完整区间的确认白布天数 */
  confirmedBaiBuDays?: number
}

export interface SuggestionResult {
  action: '重仓买入' | '买入' | '轻仓买入' | '持有' | '减仓' | '卖出' | '不要介入'
  reason: string
  score: number           // 0-100 综合评分
  entryTiming: number     // 0-100 入场时机评分
}

/**
 * 核心建议函数
 * 输入完整的股票分析数据，输出7级买卖建议
 */
export function getTradingSuggestion(input: SuggestionInput): SuggestionResult {
  const {
    baiXiao, baiXiaoDays, baiBu,
    baiXiaoBuy1, qiangShiHuiCai, hengPanTuPo,
    zhenDangMaiDian, zhongWeiZhuSheng, zhongGaoWeiZhuSheng, gaoFengXianZhuSheng,
    jiaCang, diBuBuy, zhuLiShiPan, qiWen, tiaoJianChengLi,
    zhuLiChuHuo, gaoKaiDiZouQingCang, baoLiangFuGaiQingCang,
    po5RiXian, qiangZhiFuGai, yinDiePoWei,
    jiGouActiveScore, ma5, ma10, currentPrice,
  } = input;

  // 计算MA5/MA10方向
  const ma5Up = input.ma5Up !== undefined ? input.ma5Up : true
  const ma10Up = input.ma10Up !== undefined ? input.ma10Up : true

  // ---- XMA边缘效应修正 ----
  // confirmedBaiXiaoDays 基于XMA完整数据，不会因未来数据偏移
  // 而 baiXiaoDays 可能因尾部XMA不完整而高估或虚增
  const confirmedDays = input.confirmedBaiXiaoDays !== undefined ? input.confirmedBaiXiaoDays : baiXiaoDays
  // 判断白消是否仅出现在XMA不完整的尾部（高概率消失的虚假信号）
  const edgeOnlyBaiXiao = baiXiao && confirmedDays === 0 && baiXiaoDays > 0
  // 判断白消天数是否被XMA尾部虚增
  const edgeInflated = confirmedDays > 0 && baiXiaoDays > confirmedDays
  // 使用保守的白消天数：确认天数作为真实下限，尾部不完整区间单独评估
  const conservativeDays = confirmedDays

  // ---- 白消天数分组辅助（使用保守确认天数） ----
  const baiXiaoEarly = baiXiao && conservativeDays >= 1 && conservativeDays <= 6
  const baiXiaoLate = baiXiao && conservativeDays >= 7

  // ---- 白三角买入信号组合 ----
  const hasBaiSanJiaoBuySignal = zhenDangMaiDian || zhongWeiZhuSheng || zhongGaoWeiZhuSheng || gaoFengXianZhuSheng || jiaCang

  // ---- 白布阶段判断（使用保守确认天数） ----
  const baiBuConfirmed = input.confirmedBaiBuDays !== undefined
    ? input.confirmedBaiBuDays > 0
    : baiBu

  // ---- 机构活跃度条件 ----
  const jiGouActive = jiGouActiveScore >= 12

  // ---- 均线条件 ----
  const ma5AboveMa10 = ma5 > ma10
  const ma5UpAndMa10Up = ma5Up && ma10Up  // 都往上
  const ma10UpOnly = ma10Up && !ma5Up     // MA10往上但MA5往下
  const ma10Down = !ma10Up                // MA10往下

  // ================================================================
  // 高位白消提前卖出（XMA漂移补偿）
  // 高位(价格位置≥60%)+白消+主力出货/强卖出→XMA漂移下当前白消2天后会变白布
  // 提前卖出比等白布出现早2天，避免错失利润
  // [!] 注意：高开低走/爆量覆盖/破5日线/阴跌破位/强制覆盖 只在白布状态出现
  //     白消阶段仅有 主力出货(zhuLiChuHuo) 是独立信号
  // ================================================================
  const isHighPosition = (input.pricePosition ?? 50) >= 60;
  if (baiXiao && isHighPosition) {
    const sellReasons: string[] = [];
    // 白消阶段只有主力出货是真正可用的信号
    if (zhuLiChuHuo) sellReasons.push('主力出货');
    if (sellReasons.length > 0) {
      return {
        action: '卖出',
        reason: '⚠️ 高位白消+' + sellReasons.join('+') + '，XMA漂移预期变白布，提前卖出',
        score: 15,
        entryTiming: 0,
      };
    }
    // 即使无具体卖出信号，高位白消晚期+MA10转头向下也可提前卖出
    if (baiXiaoLate && !ma10Up) {
      return {
        action: '卖出',
        reason: '⚠️ 高位白消晚期+10日线向下，XMA漂移预期变白布，提前卖出',
        score: 12,
        entryTiming: 0,
      };
    }
    // 高位白消 + 价跌破MA10（K线领先XMA约1-2天，XMA漂移会将当前白消变白布）
    const price = input.currentPrice ?? 0;
    if (baiXiao && price > 0 && price <= ma10) {
      return {
        action: '卖出',
        reason: '⚠️ 高位白消+价破MA10，XMA漂移预期变白布，提前卖出',
        score: 11,
        entryTiming: 0,
      };
    }
  }
  // 白消+MA5<MA10+价破MA10 → MA5死叉+破位，XMA漂移高概率
  if (baiXiao && ma5 < ma10 && (input.currentPrice ?? 0) <= ma10 && (input.currentPrice ?? 0) > 0) {
    return {
      action: '减仓',
      reason: '⚠️ 白消+MA5死叉+价破MA10，XMA漂移预期变白布，减仓',
      score: 8,
      entryTiming: 0,
    };
  }

  // ================================================================
  // 卖出信号（同前，无变化）
  if (gaoKaiDiZouQingCang || baoLiangFuGaiQingCang || po5RiXian || qiangZhiFuGai || yinDiePoWei) {
    return {
      action: '卖出',
      reason: getSellReason(gaoKaiDiZouQingCang, baoLiangFuGaiQingCang, po5RiXian, qiangZhiFuGai, yinDiePoWei) + 
        (edgeOnlyBaiXiao ? '（注意：XMA边缘效应，白消状态可能偏移）' : ''),
      score: 10,
      entryTiming: 0,
    }
  }

  // ================================================================
  // 第二条防线：不要介入（MA10往下）
  // ================================================================
  if (ma10Down) {
    return {
      action: '不要介入',
      reason: '10日线往下，趋势走弱不介入',
      score: 5,
      entryTiming: 0,
    }
  }

  // ================================================================
  // 减仓：白消阶段出现主力出货
  // ================================================================
  if (baiXiao && zhuLiChuHuo) {
    return {
      action: '减仓',
      reason: '白消阶段出现主力出货信号',
      score: 20,
      entryTiming: 10,
    }
  }

  // ================================================================
  // 持有：MA5和MA10都往上，或MA10往上但MA5往下
  // ================================================================
  if (ma5UpAndMa10Up || ma10UpOnly) {
    // 但如果有强烈买入信号，可能升级
    // 这里先返回持有，下面会覆盖
    // 继续检查是否能升级为买入类信号
  } else {
    // MA10往上但价格跌破MA5 → 仍持有
    // 这个分支由上面的 ma10UpOnly 覆盖
  }

  // ================================================================
  // 重仓买入（白消第1-6天，基于XMA确认天数）
  // ================================================================
  if (baiXiaoEarly) {
    // 条件A: 白消启动单独出现
    if (baiXiaoBuy1) {
      return buildResult('重仓买入', '白消第' + conservativeDays + '天，白消启动' + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 95, 85)
    }
    // 条件B: 强势回踩单独出现
    if (qiangShiHuiCai) {
      return buildResult('重仓买入', '白消第' + conservativeDays + '天，强势回踩' + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 93, 80)
    }
    // 条件C: 强势回踩 + 白三角买入信号 同一天
    if (qiangShiHuiCai && hasBaiSanJiaoBuySignal) {
      return buildResult('重仓买入', '白消第' + conservativeDays + '天，强势回踩+' + getBaiSanJiaoNames(input) + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 96, 88)
    }
    // 条件D: 白消启动 + 白三角买入信号
    if (baiXiaoBuy1 && hasBaiSanJiaoBuySignal) {
      return buildResult('重仓买入', '白消第' + conservativeDays + '天，启动+' + getBaiSanJiaoNames(input) + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 96, 88)
    }
    // 条件E: 中位主升/中高位主升/高风险主升/加仓 单独出现
    if (zhongWeiZhuSheng || zhongGaoWeiZhuSheng || gaoFengXianZhuSheng || jiaCang) {
      return buildResult('重仓买入', '白消第' + conservativeDays + '天，' + getBaiSanJiaoNames(input) + '信号', 92, 82)
    }
    // 条件F: 震荡买点单独出现
    if (zhenDangMaiDian) {
      return buildResult('重仓买入', '白消第' + conservativeDays + '天，震荡买点信号', 88, 78)
    }
    // 条件G: 机构活跃度≥12 + 首次突破5日均线 + MA5/MA10往上
    if (jiGouActive && ma5UpAndMa10Up && currentPrice >= ma5) {
      return buildResult('重仓买入', '白消第' + conservativeDays + '天，机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 87, 80)
    }
  }

  // ================================================================
  // 买入（白消第7天及之后，基于XMA确认天数）
  // ================================================================
  if (baiXiaoLate) {
    // 条件A: 横盘突破单独出现
    if (hengPanTuPo) {
      return buildResult('买入', '白消第' + conservativeDays + '天，横盘突破' + (edgeInflated ? '(尾部虚增' + baiXiaoDays + '天)' : ''), 82, 72)
    }
    // 条件B: 横盘突破 + 白三角买入信号
    if (hengPanTuPo && hasBaiSanJiaoBuySignal) {
      return buildResult('买入', '白消第' + conservativeDays + '天，横盘突破+' + getBaiSanJiaoNames(input), 86, 78)
    }
    // 条件C: 强势回踩 + 白三角买入信号
    if (qiangShiHuiCai && hasBaiSanJiaoBuySignal) {
      return buildResult('买入', '白消第' + conservativeDays + '天，强势回踩+' + getBaiSanJiaoNames(input), 84, 75)
    }
    // 条件D: 强势回踩单独出现
    if (qiangShiHuiCai) {
      return buildResult('买入', '白消第' + conservativeDays + '天，强势回踩', 80, 70)
    }
    // 条件E: 机构活跃度≥12 + 首次突破5日均线 + MA5/MA10往上
    if (jiGouActive && ma5UpAndMa10Up && currentPrice >= ma5) {
      return buildResult('买入', '白消第' + conservativeDays + '天，机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 80, 72)
    }
    // 条件F: 中位主升/中高位主升/高风险主升/加仓/震荡买点 单独出现
    if (hasBaiSanJiaoBuySignal) {
      return buildResult('买入', '白消第' + conservativeDays + '天，' + getBaiSanJiaoNames(input) + '信号', 78, 70)
    }
  }

  // ================================================================
  // 轻仓买入（白布阶段）
  // ================================================================
  if (baiBuConfirmed) {
    // 条件A: 白布阶段 + 机构活跃度≥12 + 突破5日线 + MA5/MA10往上
    if (jiGouActive && ma5UpAndMa10Up && currentPrice >= ma5) {
      return buildResult('轻仓买入', '白布阶段，机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 68, 60)
    }
    // 条件B: 白布阶段 + 主力建仓/企稳/主力试盘/成立/加仓
    if (diBuBuy || qiWen || zhuLiShiPan || tiaoJianChengLi || jiaCang) {
      const names: string[] = []
      if (diBuBuy) names.push('主力建仓')
      if (qiWen) names.push('企稳')
      if (zhuLiShiPan) names.push('主力试盘')
      if (tiaoJianChengLi) names.push('条件成立')
      if (jiaCang) names.push('加仓')
      return buildResult('轻仓买入', '白布阶段，' + names.join('+'), 65, 55)
    }
  }

  // ================================================================
  // 买入检测（非白消早期/晚期分类的剩余买入信号）
  //   当不在白消1-6天也不在白消7+天时，但有明显买入信号
  // ================================================================
  // 机构活跃度≥12 + 突破5日线 + MA5/MA10往上
  if (jiGouActive && ma5UpAndMa10Up && currentPrice >= ma5) {
    // 如果还有白三角买入信号，算重仓买入
    if (hasBaiSanJiaoBuySignal && baiXiao) {
      return buildResult('重仓买入', '机构活跃度' + jiGouActiveScore.toFixed(0) + '+' + getBaiSanJiaoNames(input), 90, 82)
    }
    if (baiXiaoLate) {
      return buildResult('买入', '白消第' + conservativeDays + '天，机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 80, 72)
    }
    if (baiXiao) {
      // 白消早期但没有明确信号组合
      return buildResult('买入', '白消第' + conservativeDays + '天，机构活跃度' + jiGouActiveScore.toFixed(0), 72, 65)
    }
    return buildResult('轻仓买入', '机构活跃度' + jiGouActiveScore.toFixed(0) + '+突破5日线', 65, 55)
  }

  // 白三角买入信号单独出现（不在白消/白布阶段）
  if (hasBaiSanJiaoBuySignal && ma5UpAndMa10Up) {
    return buildResult('买入', getBaiSanJiaoNames(input) + '+均线向上', 75, 65)
  }

  // ================================================================
  // 持有（兜底：只要MA10往上就持有）
  // ================================================================
  if (ma5UpAndMa10Up || ma10UpOnly) {
    return {
      action: '持有',
      reason: ma5UpAndMa10Up ? '5日线和10日线都往上，趋势健康' : '10日线往上，趋势未破坏',
      score: 45,
      entryTiming: 30,
    }
  }

  // ================================================================
  // 默认：不要介入（所有条件都不满足）
  // ================================================================
  return {
    action: '不要介入',
    reason: '均线走弱，无明确信号',
    score: 5,
    entryTiming: 0,
  }
}

// ================================================================
// 辅助函数
// ================================================================

function buildResult(action: SuggestionResult['action'], reason: string, score: number, entryTiming: number): SuggestionResult {
  return { action, reason, score, entryTiming }
}

function getSellReason(
  qingcang: boolean, baoliang: boolean, poxian: boolean, jinji: boolean, yinDie: boolean
): string {
  const reasons: string[] = []
  if (qingcang) reasons.push('清仓信号')
  if (baoliang) reasons.push('爆量覆盖')
  if (poxian) reasons.push('破5日线')
  if (jinji) reasons.push('紧急清仓')
  if (yinDie) reasons.push('阴跌破位')
  return '卖出信号：' + reasons.join('+')
}

function getBaiSanJiaoNames(input: SuggestionInput): string {
  const names: string[] = []
  if (input.zhenDangMaiDian) names.push('震荡买点')
  if (input.zhongWeiZhuSheng) names.push('中位主升')
  if (input.zhongGaoWeiZhuSheng) names.push('中高位主升')
  if (input.gaoFengXianZhuSheng) names.push('高风险主升')
  if (input.jiaCang) names.push('加仓')
  return names.join('/') || '买入信号'
}