import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { Network } from '@/network';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Info } from 'lucide-react-taro';
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
  entryScore?: number;
  entryLevel?: string;
  supportLevel?: number;
  resistanceLevel?: number;
  bestEntryPrice?: number;
  reasoning?: string[];
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
  type: 'positive' | 'negative' | 'neutral';
}

interface StockResult {
  stock: StockInfo;
  currentPrice: number;
  changePercent: number;
  high?: number;
  low?: number;
  klineCount: number;
  formula: FormulaResult;
}

// ===== 板块热点类型 =====
interface LeadingStock {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  weight: number;
  baiXiao?: boolean;
}

interface SectorRankItem {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  changeAmount: number;
  leadingStocks: LeadingStock[];
  opportunityStocks: LeadingStock[];
}

interface SectorHotData {
  month1: SectorRankItem[];
  quarter1: SectorRankItem[];
  halfYear: SectorRankItem[];
  year1: SectorRankItem[];
  updateTime: string;
}

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
}

const TAB_LIST = ['近1月', '近1季', '近半年', '近1年'];

// ===== 辅助函数 =====
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

function getActiveSignals(f: FormulaResult): { key: string; name: string; type: string }[] {
  const result: { key: string; name: string; type: string }[] = [];
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
    default: return '#faad14';
  }
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

  // 板块热点状态
  const [sectorData, setSectorData] = useState<SectorHotData | null>(null);
  const [sectorLoading, setSectorLoading] = useState(true);
  const [sectorTab, setSectorTab] = useState(0);
  const [sectorAutoScroll, setSectorAutoScroll] = useState(true);
  const sectorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 创业板机会区状态
  const [oppData, setOppData] = useState<OpportunityStock[] | null>(null);
  const [oppTimestamp, setOppTimestamp] = useState<number>(0);

  // 设备访问控制
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [denyReason, setDenyReason] = useState('');

  // 注册设备指纹（单次、3秒超时，失败则禁止访问）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 生成设备ID
      let deviceId = '';
      try { deviceId = localStorage.getItem('_device_id') || ''; } catch {}
      if (!deviceId) {
        deviceId = 'd_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        try { localStorage.setItem('_device_id', deviceId); } catch {}
      }

      try {
        // 用 AbortController 加 3s 超时，URL 使用 window.location.origin 避免域名问题
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const base = typeof window !== 'undefined' ? window.location.origin : '';
        const res = await fetch(`${base}/api/access/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const apiData = await res.json();
        console.log('[设备注册] 响应:', apiData);

        if (!cancelled) {
          if (apiData?.code === 200 && apiData?.data) {
            if (!apiData.data.allowed) {
              setAccessDenied(true);
              setDenyReason(apiData.data.message || '访问名额已满');
            }
          } else {
            // 接口返回异常
            setAccessDenied(true);
            setDenyReason('服务暂不可用');
          }
        }
      } catch (e) {
        console.error('[设备注册] 失败:', e);
        if (!cancelled) {
          setAccessDenied(true);
          setDenyReason('无法连接到服务器');
        }
      } finally {
        if (!cancelled) setAccessChecking(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);


  // 页面加载时获取板块热点数据
  useEffect(() => {
    (async () => {
      try {
        const res = await Network.request({ url: '/api/sector/hot', method: 'GET' });
        console.log('[板块热点] 响应:', res.data);
        const apiData = res.data as { code: number; data: SectorHotData };
        if (apiData.code === 200 && apiData.data) {
          setSectorData(apiData.data);
        }
      } catch (e) {
        console.error('[板块热点] 加载失败:', e);
      } finally {
        setSectorLoading(false);
      }
    })();
  }, []);

  // 获取创业板机会区数据（首次 + 每 15s 轮询）
  const fetchOpportunities = useCallback(async () => {
    try {
      const res = await Network.request({ url: '/api/gem/scan-result' });
      const d = (res.data as any);
      if (d.code === 200 && d.data?.opportunities) {
        setOppData(d.data.opportunities);
        setOppTimestamp(d.data.timestamp ?? 0);
      }
    } catch (e) {
      console.error('获取机会区失败:', e);
    }
  }, []);

  useEffect(() => {
    fetchOpportunities();
    const timer = setInterval(fetchOpportunities, 15000);
    return () => clearInterval(timer);
  }, [fetchOpportunities]);

  // 板块热点自动滚动
  useEffect(() => {
    if (sectorData && sectorAutoScroll) {
      const timer = setInterval(() => {
        setSectorTab(prev => (prev + 1) % 4);
      }, 5000);
      sectorTimerRef.current = timer;
      return () => {
        clearInterval(timer);
        sectorTimerRef.current = null;
      };
    }
  }, [sectorData, sectorAutoScroll]);

  // 点击板块时停止自动滚动
  const handleSectorClick = useCallback((tabIndex: number) => {
    setSectorAutoScroll(false);
    setSectorTab(tabIndex);
    if (sectorTimerRef.current) {
      clearInterval(sectorTimerRef.current);
      sectorTimerRef.current = null;
    }
  }, []);

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
          url: '/api/gem/search',
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
        url: '/api/gem/detail',
        method: 'GET',
        data: { code: q },
      });
      console.log('[股票查询] 响应结果:', res.data);

      const apiData = res.data as any;
      if (apiData.code === 200 && apiData.data?.stock) {
        const { stock, technical } = apiData.data;
        const r: StockResult = {
          stock: { name: stock.name ?? "", code: stock.code ?? q, market: 0 },
          currentPrice: stock.currentPrice ?? stock.price ?? 0,
          changePercent: stock.changePercent ?? stock.priceIncrease ?? 0,
          klineCount: 120,
          formula: {
            diff: technical?.macd?.diff ?? stock.diff ?? 0,
            dea: technical?.macd?.dea ?? stock.dea ?? 0,
            pricePosition: stock.pricePosition ?? 0,
            positionZone: stock.positionZone ?? '',
            lifeLine: stock.lifeLine ?? 0,
            pressure: stock.pressure ?? 0,
            baiXiao: stock.baiXiao ?? '',
            baiXiaoDays: stock.baiXiaoDays ?? 0,
            trendStrength: stock.trendStrength ?? 3,
            jiGouHuoYueDu: stock.jiGouHuoYueDu ?? 0,
            conflict: stock.conflict ?? '',
            signalComb: stock.signalComb ?? '',
            suggestion: stock.suggestion ?? '',
            prediction: stock.prediction ?? '',
            entryScore: technical?.entryScore ?? 0,
            entryLevel: technical?.entryLevel ?? '',
            backtestStats: null,
            safe: stock.safe ?? false,
            supportLevel: technical?.supportLevel ?? 0,
            resistanceLevel: technical?.resistanceLevel ?? 0,
            bestEntryPrice: technical?.bestEntryPrice ?? 0,
            reasoning: technical?.reasoning ?? [],
          } as any,
        };
        setResult(r);
      } else {
        setError(apiData.msg || '未找到该股票数据');
      }
    } catch (e: any) {
      console.error('[股票查询] 请求失败:', e);
      setError('网络请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchByCode = async (code: string) => {
    // 点击任何股票时停止板块自动滚动
    setSectorAutoScroll(false);
    if (sectorTimerRef.current) {
      clearInterval(sectorTimerRef.current);
      sectorTimerRef.current = null;
    }
    setQuery(code);
    setError('');
    setLoading(true);
    setResult(null);

    try {
      const res = await Network.request({
        url: '/api/gem/detail',
        method: 'GET',
        data: { code },
      });
      console.log('[快捷查询] 响应结果:', res.data);

      const apiData = res.data as any;
      if (apiData.code === 200 && apiData.data?.stock) {
        const { stock, technical } = apiData.data;
        const r: StockResult = {
          stock: { name: stock.name ?? '', code: stock.code ?? code, market: 0 },
          currentPrice: stock.currentPrice ?? stock.price ?? 0,
          changePercent: stock.changePercent ?? stock.priceIncrease ?? 0,
          klineCount: 120,
          formula: {
            diff: technical?.macd?.diff ?? stock.diff ?? 0,
            dea: technical?.macd?.dea ?? stock.dea ?? 0,
            pricePosition: stock.pricePosition ?? 0,
            positionZone: stock.positionZone ?? '',
            lifeLine: stock.lifeLine ?? 0,
            pressure: stock.pressure ?? 0,
            baiXiao: stock.baiXiao ?? '',
            baiXiaoDays: stock.baiXiaoDays ?? 0,
            trendStrength: stock.trendStrength ?? 3,
            jiGouHuoYueDu: stock.jiGouHuoYueDu ?? 0,
            conflict: stock.conflict ?? '',
            signalComb: stock.signalComb ?? '',
            suggestion: stock.suggestion ?? '',
            prediction: stock.prediction ?? '',
            entryScore: technical?.entryScore ?? 0,
            entryLevel: technical?.entryLevel ?? '',
            backtestStats: null,
            safe: stock.safe ?? false,
            supportLevel: technical?.supportLevel ?? 0,
            resistanceLevel: technical?.resistanceLevel ?? 0,
            bestEntryPrice: technical?.bestEntryPrice ?? 0,
            reasoning: technical?.reasoning ?? [],
          } as any,
        };
        setResult(r);
        // 用分析结果更新板块数据中的涨跌幅，确保显示一致
        const freshChangePercent = r.changePercent;
        if (freshChangePercent !== undefined && freshChangePercent !== null) {
          setSectorData(prev => {
            if (!prev) return prev;
            const updated = { ...prev };
            const stockCode = code;
            for (const key of ['month1', 'quarter1', 'halfYear', 'year1'] as const) {
              const sectors = updated[key];
              if (!sectors) continue;
              updated[key] = sectors.map(sector => {
                const newLeading = sector.leadingStocks.map(s =>
                  s.code === stockCode ? { ...s, changePercent: freshChangePercent } : s
                );
                const newOpportunity = sector.opportunityStocks.map(s =>
                  s.code === stockCode ? { ...s, changePercent: freshChangePercent } : s
                );
                return { ...sector, leadingStocks: newLeading, opportunityStocks: newOpportunity };
              });
            }
            return updated;
          });
        }
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
  const currentSectors: SectorRankItem[] = sectorData
    ? [sectorData.month1, sectorData.quarter1, sectorData.halfYear, sectorData.year1][sectorTab]
    : [];

  return (
    <View className="h-full bg-gray-50">
      {accessDenied ? (
        <View className="flex flex-col items-center justify-center h-full px-8" style={{ paddingTop: '40vh' }}>
          <Info size={56} color="#ff4d4f" />
          <Text className="block text-lg font-bold text-gray-800 mt-4 text-center">访问受限</Text>
          <Text className="block text-sm text-gray-500 mt-2 text-center leading-relaxed">
            {denyReason || '该页面已达到最大设备访问数量'}
          </Text>
          <Text className="block text-xs text-gray-400 mt-4 text-center">
            如需增加访问名额，请联系开发者
          </Text>
        </View>
      ) : accessChecking ? (
        <View className="flex flex-col items-center justify-center h-full" style={{ paddingTop: '45vh' }}>
          <Skeleton className="h-4 w-32 mb-2" />
          <Skeleton className="h-3 w-48" />
        </View>
      ) : (
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
                  {getActiveSignals(f).length > 0 ? (
                    getActiveSignals(f).map((item, idx) => (
                      <Badge key={idx} style={{ backgroundColor: signalBadgeColor(item.type), color: '#fff' }}>
                        <Text className="block text-xs">{item.name}</Text>
                      </Badge>
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
            <Text className="block text-sm font-semibold">创业板机会区</Text>
            <Text className="block text-xs text-gray-400">
              {oppTimestamp ? (() => {
                const diff = Math.floor((Date.now() - oppTimestamp) / 60000);
                if (diff < 1) return '刚刚更新';
                return `${diff} 分钟前更新`;
              })() : '自动刷新中'}
            </Text>
          </View>
          {oppData === null ? (
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
          ) : oppData.length > 0 ? (
            <View className="flex flex-col gap-2">
              {oppData.map((stock, idx) => (
                <Card key={stock.code}>
                  <CardContent className="p-3">
                    <View className="flex flex-row items-center gap-2" onClick={() => handleSearchByCode(stock.code)}>
                      <Badge className="px-1 bg-purple-50 text-purple-700 border-purple-200 flex-shrink-0">
                        <Text className="block text-xs">#{idx + 1}</Text>
                      </Badge>
                      <View className="flex-1 min-w-0">
                        <Text className="block text-xs font-medium truncate">{stock.name}</Text>
                        <Text className="block text-xs text-gray-400">{stock.code}</Text>
                      </View>
                      <View className="flex-shrink-0 text-right">
                        <Text className="block text-xs font-medium">{stock.currentPrice?.toFixed(2)}</Text>
                        <Text className="block text-xs" style={{ color: stock.changePercent >= 0 ? '#ef4444' : '#22c55e' }}>
                          {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent?.toFixed(2)}%
                        </Text>
                      </View>
                      <View className="flex-shrink-0 text-right ml-1">
                        <Text className="block text-xs" style={{ color: stock.priceIncrease <= 10 ? '#22c55e' : '#eab308' }}>
                          +{stock.priceIncrease?.toFixed(1)}%
                        </Text>
                      </View>
                      <View className="flex-shrink-0 text-right ml-2">
                        <Text className="block text-xs text-green-600 font-medium">位置{stock.pricePosition?.toFixed(0)}%</Text>
                        <Text className="block text-xs text-gray-400">{stock.mainForceInflow >= 100000000 ? `${(stock.mainForceInflow / 100000000).toFixed(2)}亿` : `${(stock.mainForceInflow / 10000).toFixed(0)}万`}</Text>
                      </View>
                    </View>
                  </CardContent>
                </Card>
              ))}
            </View>
          ) : (
            <View className="p-4 bg-gray-50 rounded-xl">
              <Text className="block text-xs text-gray-400 text-center">
                暂无符合条件的信号
              </Text>
            </View>
          )}
        </View>

        {/* 板块热点 */}
        <View className="mt-6">
          {/* 板块热点标题 */}
          <View className="flex flex-row items-center justify-between mb-3">
            <Text className="block text-base font-bold text-gray-900">
              板块热点
            </Text>
            <Badge style={{ backgroundColor: '#f5f5f5', color: '#999', borderWidth: '1px', borderColor: '#e5e5e5', borderStyle: 'solid' }}>
              <Text className="block text-xs">数据工具</Text>
            </Badge>
          </View>

          {/* 板块热点 Tab */}
          <View className="flex flex-row gap-2 mb-3">
            {TAB_LIST.map((tab, idx) => (
              <View
                key={tab}
                onClick={() => handleSectorClick(idx)}
                className="px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: sectorTab === idx ? '#1890ff' : '#f5f5f5',
                }}
              >
                <Text
                  className="block text-xs font-medium"
                  style={{ color: sectorTab === idx ? '#fff' : '#666' }}
                >
                  {tab}
                </Text>
              </View>
            ))}
          </View>

          {/* 板块数据展示 */}
          {sectorLoading ? (
            <View className="flex flex-col gap-2">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-3">
                    <Skeleton className="h-5 w-24 mb-2" />
                    <Skeleton className="h-3 w-full" />
                  </CardContent>
                </Card>
              ))}
            </View>
          ) : currentSectors.length > 0 ? (
            <View style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {currentSectors.slice(0, 5).map((sector, idx) => (
                <Card key={idx}>
                  <CardContent className="p-3">
                    <View className="flex flex-row items-center justify-between mb-2">
                      <Text className="block text-sm font-bold text-gray-900">{sector.name}</Text>
                      <Text
                        className="block text-xs font-medium"
                        style={{ color: sector.changePercent >= 0 ? '#ff4d4f' : '#52c41a' }}
                      >
                        {formatPercent(sector.changePercent)}
                      </Text>
                    </View>
                    {/* 龙头股 */}
                    <Text className="block text-xs text-gray-400 mb-1">权重股 TOP5</Text>
                    <View className="flex flex-row flex-wrap gap-1 mb-2">
                      {(sector.leadingStocks || []).slice(0, 3).map((ls, li) => (
                        <Badge
                          key={li}
                          onClick={() => handleSearchByCode(ls.code)}
                          style={{
                            backgroundColor: ls.changePercent >= 0 ? '#fff1f0' : '#f6ffed',
                            color: ls.changePercent >= 0 ? '#ff4d4f' : '#52c41a',
                            borderWidth: '1px',
                            borderColor: ls.changePercent >= 0 ? '#ffccc7' : '#b7eb8f',
                            borderStyle: 'solid',
                            cursor: 'pointer',
                          }}
                        >
                          <Text className="block text-xs">
                            {ls.name} {formatPercent(ls.changePercent)}
                          </Text>
                        </Badge>
                      ))}
                    </View>
                    {/* 机会股票 */}
                    {(sector.opportunityStocks || []).length > 0 && (
                      <View className="pt-2 border-t border-gray-50">
                        <Text className="block text-xs text-gray-400 mb-1">DIFF上穿DEA形态</Text>
                        <View className="flex flex-row flex-wrap gap-1">
                          {(sector.opportunityStocks || []).slice(0, 3).map((os, oi) => (
                            <Badge
                              key={oi}
                              onClick={() => handleSearchByCode(os.code)}
                              style={{
                                backgroundColor: '#f9f0ff',
                                color: '#722ed1',
                                borderWidth: '1px',
                                borderColor: '#d3adf7',
                                borderStyle: 'solid',
                                cursor: 'pointer',
                              }}
                            >
                              <Text className="block text-xs">
                                {os.name} {os.baiXiao ? '形态中' : ''}
                              </Text>
                            </Badge>
                          ))}
                        </View>
                      </View>
                    )}
                  </CardContent>
                </Card>
              ))}
            </View>
          ) : (
            <View className="p-4 bg-gray-50 rounded-xl">
              <Text className="block text-sm text-gray-400 text-center">
                板块数据加载中，请稍候...
              </Text>
            </View>
          )}

          {/* 数据更新时间 */}
          {sectorData && (
            <Text className="block text-xs text-gray-400 text-right mt-1">
              更新于 {sectorData.updateTime}
            </Text>
          )}

          {/* 底部信息 */}
          <View className="mt-6 pt-4 border-t border-gray-100">
            <Text className="block text-xs text-gray-400 text-center">
              开发者：呱呱小白狗
            </Text>
            <Text className="block text-xs text-gray-300 text-center mt-1">
              所有数据仅供技术分析参考，不构成投资建议
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
      )}
    </View>
  );
};

export default IndexPage;