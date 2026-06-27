import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import { Input } from '@/components/ui/input'
import { Search, ArrowLeft, Activity, ChevronRight, ChartBarIncreasing, Zap, CircleAlert } from 'lucide-react-taro'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Network } from '@/network'

type StockItem = {
  code: string;
  name: string;
  suggestion?: string;
  score?: number;
  price?: number;
  changePercent?: number;
  trade?: number;
  baiXiaoDays?: number;
  baiBuDays?: number;
  [key: string]: any;
}

type AutoCompleteItem = {
  code: string;
  name: string;
}

type IntradayAnalysis = {
  status: string;
  dataCount: number;
  currentPrice: number;
  currentTime: string;
  macd: {
    diff: number;
    dea: number;
    macd: number;
    status: string;
    goldenCrosses: number;
    deathCrosses: number;
    signals: { time: string; type: string; idx: number; price: number }[];
  };
  zhuliSanhu: {
    main: number;
    retail: number;
    status: string;
    buySignals: number;
    sellSignals: number;
  };
  suggestions: { time: string; type: string }[];
  summary: string;
}

function getSuggestionBadgeColor(s: string | undefined): string {
  if (!s) return 'bg-gray-100 text-gray-600';
  if (s.includes('重仓买入')) return 'bg-red-50 text-red-700 border-red-200';
  if (s.includes('买入')) return 'bg-orange-50 text-orange-700 border-orange-200';
  if (s.includes('轻仓买入')) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  if (s.includes('持有')) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (s.includes('减仓')) return 'bg-purple-50 text-purple-700 border-purple-200';
  if (s.includes('卖出')) return 'bg-green-50 text-green-700 border-green-200';
  if (s.includes('不要介入')) return 'bg-gray-50 text-gray-500 border-gray-200';
  return 'bg-gray-100 text-gray-600';
}

function formatPrice(v: number | undefined | null): string {
  if (v == null) return '--';
  return v.toFixed(2);
}

export default function Index() {
  const [query, setQuery] = useState('');
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [sr, setSr] = useState<StockItem | null>(null);
  const [srError, setSrError] = useState('');

  // 自动补全
  const [acItems, setAcItems] = useState<AutoCompleteItem[]>([]);
  const [acLoading, setAcLoading] = useState(false);
  const [showAc, setShowAc] = useState(false);
  const acTimer = useRef<any>(null);

  // 个股详情
  const [detailStock, setDetailStock] = useState<StockItem | null>(null);
  const [iaData, setIaData] = useState<IntradayAnalysis | null>(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaUpdating, setIaUpdating] = useState(false); // 自动刷新中

  const scanStopRef = useRef(false);
  const detailCodeRef = useRef<string | null>(null); // 用于自动刷新
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 自动刷新：进入详情后每2秒更新数据
  useEffect(() => {
    if (detailStock?.code) {
      const code = detailStock.code;
      detailCodeRef.current = code;
      // 启动2秒定时器
      autoRefreshRef.current = setInterval(async () => {
        if (detailCodeRef.current !== code) return; // 已切换
        try {
          // 实时股价
          const qRes = await Network.request({ url: `/api/stock/quote?code=${code}`, method: 'GET' });
          const qItem = qRes.data?.data || null;
          if (qItem && detailCodeRef.current === code) {
            setDetailStock(prev => prev ? {
              ...prev,
              price: qItem.trade ?? qItem.price,
              changePercent: qItem.changePercent,
              name: qItem.name || prev.name,
            } : null);
          }
          // 日内分析（静默刷新，不显示骨架）
          setIaUpdating(true);
          const iaRes = await Network.request({ url: `/api/gem/intraday-analysis?code=${code}`, method: 'GET' });
          if (detailCodeRef.current === code) {
            setIaData(iaRes.data?.data || null);
          }
        } catch (_) {}
        setIaUpdating(false);
      }, 2000);
      // 清理
      return () => {
        detailCodeRef.current = null;
        if (autoRefreshRef.current) {
          clearInterval(autoRefreshRef.current);
          autoRefreshRef.current = null;
        }
      };
    }
  }, [detailStock?.code]);

  // 获取股票列表
  const fetchStocks = useCallback(async () => {
    try {
      const res = await Network.request({ url: '/api/gem/stock-cache', method: 'GET' });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      if (list.length > 0) setStocks(list.slice(0, 50));
    } catch (_) {}
  }, []);

  useEffect(() => { fetchStocks(); }, [fetchStocks]);

  // 搜索自动补全
  const fetchAutocomplete = useCallback(async (q: string) => {
    if (!q || q.length < 1) { setAcItems([]); setShowAc(false); return; }
    setAcLoading(true);
    try {
      const res = await Network.request({ url: `/api/stock/search?q=${encodeURIComponent(q)}`, method: 'GET' });
      const arr: any[] = res.data?.data || [];
      setAcItems(arr.map((i: any) => ({ code: i.code, name: i.name })));
      setShowAc(arr.length > 0);
    } catch (_) { setAcItems([]); }
    setAcLoading(false);
  }, []);

  const onQueryInput = useCallback((e: any) => {
    const v = e.target?.value || '';
    setQuery(v);
    if (acTimer.current) clearTimeout(acTimer.current);
    acTimer.current = setTimeout(() => fetchAutocomplete(v), 200);
  }, [fetchAutocomplete]);

  // 选择自动补全项
  const selectAc = useCallback((item: AutoCompleteItem) => {
    setQuery(item.code);
    setShowAc(false);
    doSearch(item.code);
  }, []);

  // 搜索
  const doSearch = useCallback(async (code?: string) => {
    const c = (code || query).trim();
    if (!c) return;
    setShowAc(false);
    setSrError('');
    setSr(null);
    try {
      // 先获取搜索信息
      const searchRes = await Network.request({ url: `/api/stock/search?q=${encodeURIComponent(c)}`, method: 'GET' });
      const stocksArr: any[] = searchRes.data?.data || [];
      const matched = stocksArr.find((s: any) => s.code === c);
      const stockName = matched?.name || c;

      // 获取K线数据
      const klineRes = await Network.request({ url: `/api/stock/kline?code=${c}&type=daily`, method: 'GET' });
      let klines = klineRes.data?.data?.klines || klineRes.data?.klines || [];

      // 调用分析
      const body: any = { code: c, name: stockName, kline: klines };
      const analyzeRes = await Network.request({ url: '/api/gem/analyze', method: 'POST', data: body });
      const opps = analyzeRes.data?.data || [];
      const opp = Array.isArray(opps) ? opps[0] : opps;

      if (opp) {
        setSr(opp);
        // 自动进入详情
        setDetailStock(opp);
        fetchIntraday(c);
      } else {
        setSrError('未找到该股票的分析结果');
      }
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('404') || msg.includes('Not Found')) {
        setSrError('未找到该股票代码');
      } else {
        setSrError('查询失败，请重试');
      }
    }
  }, [query]);

  // 获取日内分析（初始加载用，会显示骨架）
  const fetchIntraday = useCallback(async (code: string) => {
    setIaLoading(true);
    setIaData(null);
    try {
      const res = await Network.request({ url: `/api/gem/intraday-analysis?code=${code}`, method: 'GET' });
      setIaData(res.data?.data || null);
    } catch (_) {
      setIaData(null);
    }
    setIaLoading(false);
  }, []);

  // 返回列表
  const backToList = useCallback(() => {
    setDetailStock(null);
    setIaData(null);
    setSr(null);
    setQuery('');
    setSrError('');
  }, []);

  // 点击个股卡片进入详情
  const clickStock = useCallback((stock: StockItem) => {
    setDetailStock(stock);
    setQuery(stock.code);
    fetchIntraday(stock.code);
  }, [fetchIntraday]);

  // 全市场扫描（只在列表页可用）
  const startScan = useCallback(async () => {
    if (detailStock || scanning) return;
    setScanning(true);
    scanStopRef.current = false;
    try {
      await Network.request({ url: '/api/gem/refresh-main-board', method: 'POST', data: { stocks: [] } });
    } catch (_) {}
    setScanning(false);
  }, [detailStock, scanning]);

  // 格式化时间
  const fmtTime = (t: string) => {
    if (!t) return '';
    if (t.length >= 16) return t.slice(5, 16);
    if (t.length === 10) return t.slice(5);
    return t;
  };

  return (
    <View className="flex flex-col h-screen bg-gray-50">
      {/* 搜索区域 */}
      <View className="px-4 pt-3 pb-2 bg-white border-b border-gray-100 relative z-20">
        <View className="flex flex-row items-center gap-2">
          {detailStock ? (
            <View className="flex-shrink-0" onClick={backToList}>
              <ArrowLeft size={22} color="#333" />
            </View>
          ) : null}
          <View className="flex-1 relative">
            <View className="relative">
              <View className="absolute left-3 top-1/2 -translate-y-1/2">
                <Search size={16} color="#999" />
              </View>
              <Input
                className="w-full pl-9 pr-3 h-9 text-sm bg-gray-50 rounded-lg border-0"
                placeholder={detailStock ? detailStock.code || detailStock.name : '输入股票代码或名称'}
                value={query}
                onInput={onQueryInput}
                onConfirm={() => doSearch()}
              />
            </View>
            {/* 自动补全下拉框 */}
            {showAc && acItems.length > 0 && (
              <View className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-100 max-h-60 overflow-y-auto">
                {acItems.map((item, idx) => (
                  <View
                    key={`${item.code}-${idx}`}
                    className="px-4 py-2 border-b border-gray-50 active:bg-gray-50 flex flex-row items-center justify-between"
                    onClick={() => selectAc(item)}
                  >
                    <Text className="block text-sm font-medium text-gray-800">{item.code}</Text>
                    <Text className="block text-xs text-gray-400">{item.name}</Text>
                  </View>
                ))}
              </View>
            )}
            {acLoading && (
              <View className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow p-3">
                <View className="flex flex-row items-center gap-2">
                  <View className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                  <Text className="block text-xs text-gray-400">搜索中...</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* 搜索错误 - 紧凑显示 */}
        {srError && !detailStock && (
          <View className="mt-2 px-3 py-2 bg-red-50 rounded-lg border border-red-100 flex flex-row items-center gap-2">
            <CircleAlert size={14} color="#ef4444" />
            <Text className="block text-xs text-red-600">{srError}</Text>
          </View>
        )}

        {/* 紧凑搜索结果（详情中不显示，已进入详情） */}
        {sr && !detailStock && (
          <View className="mt-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
            <View className="flex flex-row items-center justify-between" onClick={() => { if (sr) { setDetailStock(sr); fetchIntraday(sr.code); } }}>
              <View className="flex-1">
                <View className="flex flex-row items-center gap-2">
                  <Text className="block text-sm font-semibold text-gray-800">{sr.code}</Text>
                  <Text className="block text-xs text-gray-500">{sr.name}</Text>
                  <Badge className={getSuggestionBadgeColor(sr.suggestion)}>
                    <Text className="block text-xs">{sr.suggestion || '--'}</Text>
                  </Badge>
                </View>
                <View className="flex flex-row items-center gap-2 mt-1">
                  <Text className="block text-sm font-bold text-gray-900">¥{formatPrice(sr.price || sr.trade)}</Text>
                  <Text className={`block text-xs ${(sr.changePercent || 0) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {(sr.changePercent || 0) >= 0 ? '+' : ''}{sr.changePercent?.toFixed(2)}%
                  </Text>
                </View>
              </View>
              <ChevronRight size={16} color="#ccc" />
            </View>
          </View>
        )}

        {/* 扫描按钮（详情页中禁用） */}
        <View className="mt-2">
          <Button
            className={`w-full text-sm h-9 ${detailStock ? 'opacity-40' : ''}`}
            onClick={startScan}
            disabled={!!detailStock}
          >
            {scanning ? <Text className="block text-sm">扫描中...</Text> :
             detailStock ? <Text className="block text-sm">详情中不可扫描</Text> :
             <Text className="block text-sm">立即扫描</Text>}
          </Button>
        </View>
      </View>

      {/* 内容区域 */}
      {detailStock ? (
        /* ---- 个股详情 ---- */
        <ScrollView className="flex-1" scrollY>
          {/* 基本信息 */}
          <View className="px-4 pt-4 pb-2 bg-white border-b border-gray-100">
            <View className="flex flex-row items-center justify-between mb-2">
              <View>
                <Text className="block text-2xl font-bold text-gray-900">{detailStock.name || detailStock.code}</Text>
                <Text className="block text-sm text-gray-400">{detailStock.code}</Text>
              </View>
              <View className="items-end">
                <Text className="block text-2xl font-bold text-gray-900">¥{formatPrice(detailStock.price || detailStock.trade)}</Text>
                <Text className={`block text-sm font-medium ${(detailStock.changePercent || 0) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {(detailStock.changePercent || 0) >= 0 ? '+' : ''}{detailStock.changePercent?.toFixed(2)}%
                </Text>
              </View>
            </View>
            <View className="flex flex-row items-center gap-2">
              <Badge className={getSuggestionBadgeColor(detailStock.suggestion)}>
                <Text className="block text-sm">{detailStock.suggestion || '--'}</Text>
              </Badge>
              {detailStock.baiXiaoDays != null && (
                <Badge className="bg-purple-50 text-purple-700 border-purple-200">
                  <Text className="block text-xs">白消{detailStock.baiXiaoDays}天</Text>
                </Badge>
              )}
              {detailStock.baiBuDays != null && detailStock.baiBuDays > 0 && (
                <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200">
                  <Text className="block text-xs">白布{detailStock.baiBuDays}天</Text>
                </Badge>
              )}
            </View>
          </View>

          {iaData?.currentTime && (
            <View className="px-4 pt-1">
              <Text className="block text-xs text-gray-400">最新行情时间：{fmtTime(iaData.currentTime)}</Text>
            </View>
          )}

          {/* MACD状态 */}
          <View className="px-4 pt-3">
            <View className="flex flex-row items-center justify-between mb-2">
              <View className="flex flex-row items-center gap-1">
                <Activity size={16} color="#6366f1" />
                <Text className="block text-sm font-semibold text-gray-700">MACD(40,120,40) 分时分析</Text>
              </View>
              {iaUpdating && (
                <View className="flex flex-row items-center gap-1">
                  <View className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
                  <Text className="block text-xs text-green-500">实时</Text>
                </View>
              )}
            </View>
            {iaLoading ? (
              <Card>
                <CardContent className="p-4">
                  <Skeleton className="h-12 w-full" />
                </CardContent>
              </Card>
            ) : iaData ? (
              <Card>
                <CardContent className="p-4">
                  <View className="flex flex-row items-center justify-between mb-2">
                    <View className="flex flex-row items-center gap-2">
                      <Badge className={iaData.macd.status === '金叉区' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}>
                        <Text className="block text-xs">{iaData.macd.status}</Text>
                      </Badge>
                    </View>
                    <View className="flex flex-row items-center gap-3">
                      <View className="items-center">
                        <Text className="block text-xs text-gray-400">DIFF</Text>
                        <Text className="block text-sm font-medium text-gray-700">{iaData.macd.diff.toFixed(2)}</Text>
                      </View>
                      <View className="items-center">
                        <Text className="block text-xs text-gray-400">DEA</Text>
                        <Text className="block text-sm font-medium text-gray-700">{iaData.macd.dea.toFixed(2)}</Text>
                      </View>
                      <View className="items-center">
                        <Text className="block text-xs text-gray-400">MACD</Text>
                        <Text className={`block text-sm font-medium ${iaData.macd.macd >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {iaData.macd.macd.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {iaData.macd.signals.length > 0 && (
                    <View className="mt-2 pt-2 border-t border-gray-50">
                      <Text className="block text-xs text-gray-400 mb-1">
                        共 {iaData.macd.goldenCrosses} 次金叉 / {iaData.macd.deathCrosses} 次死叉
                      </Text>
                      <ScrollView className="max-h-28" scrollY>
                        {iaData.macd.signals.slice(-8).map((s, i) => (
                          <View key={i} className={`flex flex-row items-center justify-between py-1 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                            <View className="flex flex-row items-center gap-2">
                              <View className={`w-1 h-1 rounded-full ${s.type === '金叉' ? 'bg-red-500' : 'bg-green-500'}`} />
                              <Text className={`block text-xs font-medium ${s.type === '金叉' ? 'text-red-600' : 'text-green-600'}`}>
                                {s.type}
                              </Text>
                            </View>
                            <Text className="block text-xs text-gray-400">{fmtTime(s.time)}</Text>
                            <Text className="block text-xs text-gray-600">¥{s.price.toFixed(2)}</Text>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </View>

          {/* 主力/散户 */}
          <View className="px-4 pt-3">
            <View className="flex flex-row items-center gap-1 mb-2">
              <ChartBarIncreasing size={16} color="#f59e0b" />
              <Text className="block text-sm font-semibold text-gray-700">主力/散户指标</Text>
            </View>
            {iaLoading ? (
              <Card>
                <CardContent className="p-4">
                  <Skeleton className="h-12 w-full" />
                </CardContent>
              </Card>
            ) : iaData ? (
              <Card>
                <CardContent className="p-4">
                  <View className="flex flex-row items-center justify-between mb-2">
                    <View className="flex flex-row items-center gap-3">
                      <View className="items-center">
                        <Text className="block text-xs text-gray-400">主力</Text>
                        <Text className={`block text-sm font-bold ${iaData.zhuliSanhu.main > 50 ? 'text-red-500' : 'text-blue-500'}`}>
                          {iaData.zhuliSanhu.main?.toFixed(1) || '--'}
                        </Text>
                      </View>
                      <View className="items-center">
                        <Text className="block text-xs text-gray-400">散户</Text>
                        <Text className={`block text-sm font-bold ${iaData.zhuliSanhu.retail > 50 ? 'text-amber-500' : 'text-gray-500'}`}>
                          {iaData.zhuliSanhu.retail?.toFixed(1) || '--'}
                        </Text>
                      </View>
                    </View>
                    <Badge className={`${iaData.zhuliSanhu.status === '主力占优' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                      <Text className="block text-xs">{iaData.zhuliSanhu.status}</Text>
                    </Badge>
                  </View>
                  <View className="flex flex-row items-center gap-3">
                    {iaData.zhuliSanhu.buySignals > 0 && (
                      <Badge className="bg-red-50 text-red-700 border-red-200">
                        <Text className="block text-xs">买入信号 {iaData.zhuliSanhu.buySignals}次</Text>
                      </Badge>
                    )}
                    {iaData.zhuliSanhu.sellSignals > 0 && (
                      <Badge className="bg-green-50 text-green-700 border-green-200">
                        <Text className="block text-xs">卖出信号 {iaData.zhuliSanhu.sellSignals}次</Text>
                      </Badge>
                    )}
                    {iaData.zhuliSanhu.buySignals === 0 && iaData.zhuliSanhu.sellSignals === 0 && (
                      <Text className="block text-xs text-gray-400">近期无明确买卖信号</Text>
                    )}
                  </View>
                </CardContent>
              </Card>
            ) : null}
          </View>

          {/* 日内买卖建议 */}
          <View className="px-4 pt-3">
            <View className="flex flex-row items-center gap-1 mb-2">
              <Zap size={16} color="#8b5cf6" />
              <Text className="block text-sm font-semibold text-gray-700">日内介入参考</Text>
            </View>
            {iaLoading ? (
              <Card>
                <CardContent className="p-4">
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ) : iaData ? (
              <Card>
                <CardContent className="p-4">
                  {/* 买卖点列表 */}
                  {iaData.suggestions.length > 0 ? (
                    <View>
                      <Text className="block text-xs text-gray-400 mb-2">
                        共 {iaData.suggestions.length} 条建议（基于5分钟K线MACD+主力/散户）
                      </Text>
                      <ScrollView className="max-h-40" scrollY>
                        {iaData.suggestions.map((s, i) => (
                          <View key={i} className={`flex flex-row items-center justify-between py-1 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                            <View className="flex flex-row items-center gap-2">
                              <View className={`w-2 h-2 rounded-full ${s.type.includes('买入') ? 'bg-red-500' : 'bg-green-500'}`} />
                              <Text className={`block text-xs font-medium ${s.type.includes('买入') ? 'text-red-600' : 'text-green-600'}`}>
                                {s.type}
                              </Text>
                            </View>
                            <Text className="block text-xs text-gray-400">{fmtTime(s.time)}</Text>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  ) : (
                    <View className="py-3 items-center">
                      <Text className="block text-xs text-gray-400">{iaData.summary || '暂无明确的日内买卖信号'}</Text>
                    </View>
                  )}
                  {iaData.summary && (
                    <View className="mt-2 pt-2 border-t border-gray-50">
                      <Text className="block text-xs text-gray-500">{iaData.summary}</Text>
                    </View>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-4">
                  <Text className="block text-xs text-gray-400">数据获取中，请稍后...</Text>
                </CardContent>
              </Card>
            )}
          </View>

          <View className="h-20" />
        </ScrollView>
      ) : (
        /* ---- 个股列表 ---- */
        <ScrollView className="flex-1 px-4 pt-3" scrollY>
          {loading ? (
            <View className="space-y-3">
              {[1,2,3,4,5].map(i => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </View>
          ) : stocks.length > 0 ? (
            <View>
              <Text className="block text-xs text-gray-400 mb-2">机会区（最近更新）</Text>
              {stocks.map((stock, idx) => (
                <View key={`${stock.code}-${idx}`} className="mb-2" onClick={() => clickStock(stock)}>
                  <Card>
                    <CardContent className="p-3">
                      <View className="flex flex-row items-center justify-between">
                        <View className="flex-1">
                          <View className="flex flex-row items-center gap-2 mb-1">
                            <Text className="block text-sm font-semibold text-gray-800">{stock.code}</Text>
                            <Text className="block text-xs text-gray-400">{stock.name}</Text>
                          </View>
                          <View className="flex flex-row items-center gap-2">
                            <Text className="block text-sm font-bold text-gray-900">¥{formatPrice(stock.price || stock.trade)}</Text>
                            <Text className={`block text-xs ${(stock.changePercent || 0) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                              {(stock.changePercent || 0) >= 0 ? '+' : ''}{stock.changePercent?.toFixed(2)}%
                            </Text>
                          </View>
                        </View>
                        {/* 只显示评分，不显示买卖建议文字（避免与搜索结果不符） */}
                        <View className="flex flex-row items-center gap-2">
                          {stock.score != null && (
                            <View className="items-center">
                              <Text className={`block text-xs font-medium ${(stock.score || 0) >= 60 ? 'text-red-500' : (stock.score || 0) >= 30 ? 'text-yellow-500' : 'text-gray-400'}`}>
                                {stock.score}
                              </Text>
                              <Text className="block text-xs text-gray-300">评分</Text>
                            </View>
                          )}
                          <ChevronRight size={14} color="#ddd" />
                        </View>
                      </View>
                    </CardContent>
                  </Card>
                </View>
              ))}
            </View>
          ) : (
            <View className="items-center pt-20">
              <Text className="block text-sm text-gray-300">暂无数据，请点击立即扫描</Text>
            </View>
          )}
          <View className="h-10" />
        </ScrollView>
      )}
    </View>
  )
}