import { useState, useEffect, useCallback, useRef } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, ScrollView } from '@tarojs/components'
import { Input } from '@/components/ui/input'
import { Search, AArrowUp, AArrowDown, Minus, TriangleAlert, ChevronDown, ChevronUp } from 'lucide-react-taro'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Network } from '@/network'
import './index.css'

const ACTION_BG: Record<string, string> = {
  '重仓买入': '#dc2626', '买入': '#2563eb', '轻仓买入': '#ca8a04',
  '持有': '#6b7280', '减仓': '#f97316', '卖出': '#dc2626', '不要介入': '#6b7280',
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars

function getBJ(): Date { const n = new Date(); return new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 28800000) }
function isTH(): boolean {
  const b = getBJ()
  if (b.getDay() === 0 || b.getDay() === 6) return false
  const m = b.getHours() * 60 + b.getMinutes()
  return m >= 565 && m < 900
}
function isLunch(): boolean { const m = getBJ().getHours() * 60 + getBJ().getMinutes(); return m >= 690 && m < 780 }
function freezeMsg(): string {
  const b = getBJ(); const d = b.getDay(); const m = b.getHours() * 60 + b.getMinutes()
  if (d === 0 || d === 6) return '周末休市，数据已冻结'
  if (m >= 900) return d === 5 ? '周五收盘已冻结' : '收盘已冻结，明早9:25恢复'
  if (m < 565) return '盘前已冻结，9:25恢复'
  if (m >= 690 && m < 780) return '午休冻结，13:00恢复'
  return ''
}
async function fetchEMList(fs: string): Promise<any[]> {
  const all: any[] = []
  for (let pn = 1; pn <= 3; pn++) {
    try {
      const r = await fetch(`http://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=5000&po=1&np=1&fltt=2&invt=2&fs=${fs}&fields=f12,f14,f2,f3`)
      const j = await r.json(); (j?.data?.diff || []).forEach((x: any) => { if (x.f12) all.push({ c: String(x.f12), n: x.f14, p: x.f2 || 0, cp: x.f3 || 0 }) })
      if ((j?.data?.diff || []).length < 5000) break
    } catch (e) { break }
  }
  return all
}
async function fetchKlines(code: string, minL = 20): Promise<any[]> {
  for (const src of [
    `http://d.10jqka.com.cn/v2/line/hs_${code}/01/last.js`,
    `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code.startsWith('6') ? 'sh' : 'sz'}${code},day,,,100,qfq`,
    `http://push2.eastmoney.com/api/qt/stock/kline/get?secid=${(code.startsWith('6') || code.startsWith('68')) ? 1 : 0}.${code}&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101`,
  ]) {
    try {
      const ac = new AbortController(); const tid = setTimeout(() => ac.abort(), 5000)
      const r = await fetch(src, { signal: ac.signal }); clearTimeout(tid); const txt = await r.text()
      let kl: any[] = []
      if (src.includes('10jqka')) {
        const m = txt.match(/\{.*\}/)
        if (m) { const j = JSON.parse(m[0]); kl = (j?.data || '').split(';').filter(Boolean).map((s: string) => { const p = s.split(','); return { d: p[0], o: +p[1], c: +p[2], h: +p[3], l: +p[4], v: +p[5] } }) }
      } else if (src.includes('gtimg')) {
        const pk = (code.startsWith('6') ? 'sh' : 'sz') + code; const j = JSON.parse(txt)
        kl = (j?.data?.[pk]?.qfqday || []).map((k: any) => ({ d: k[0], o: +k[1], c: +k[2], h: +k[3], l: +k[4], v: +k[5] }))
      } else {
        const j = JSON.parse(txt)
        kl = (j?.data?.klines || []).map((k: string) => { const p = k.split(','); return { d: p[0], o: +p[1], c: +p[2], h: +p[3], l: +p[4], v: +p[5] } })
      }
      if (kl.length >= minL) return kl
    } catch (e) { }
  }
  return []
}

// ═══ Detail panel helper components ═══
function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex flex-row items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
      <Text className="block text-xs text-gray-500">{label}</Text>
      <Text className="block text-xs font-semibold text-gray-900">{value}</Text>
    </View>
  )
}
function MacdBar({ diff, dea }: { diff: number; dea: number }) {
  const maxV = Math.max(Math.abs(diff), Math.abs(dea), 0.01)
  const dPct = (diff / maxV) * 100, aPct = (dea / maxV) * 100
  return (
    <View className="relative h-6 bg-gray-100 rounded-full overflow-hidden" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
      <View className="absolute top-0 bottom-0 left-1/2 bg-gray-300" style={{ width: 1 }} />
      <View className="flex-1 h-full flex items-center justify-end pr-1"
        style={{ backgroundColor: diff >= 0 ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)' }}
      >
        {diff >= 0 && <View className="h-3 rounded-full bg-red-400" style={{ width: Math.abs(dPct) + '%' }} />}
      </View>
      <View className="flex-1 h-full flex items-center justify-start pl-1"
        style={{ backgroundColor: dea >= 0 ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)' }}
      >
        {dea >= 0 && <View className="h-3 rounded-full bg-blue-400" style={{ width: Math.abs(aPct) + '%' }} />}
      </View>
      {diff < 0 && <View className="absolute left-0 h-3 rounded-full bg-red-300" style={{ width: Math.abs(dPct) + '0%', left: '50%', transform: 'translateX(-50%)' }} />}
      {dea < 0 && <View className="absolute left-0 h-3 rounded-full bg-purple-300" style={{ width: Math.abs(aPct) + '0%', left: '50%', transform: 'translateX(-50%)' }} />}
    </View>
  )
}
function PositionBar({ position, zone }: { position: number; zone: string }) {
  const colors: Record<string, string> = { '低位区': '#22c55e', '中低位区': '#84cc16', '中位区': '#eab308', '中高位区': '#f97316', '高位区': '#ef4444' }
  const zc = colors[zone] || '#6b7280'
  return (
    <View className="p-3 bg-gray-50 rounded-xl">
      <View className="flex flex-row items-center justify-between mb-2">
        <Text className="block text-xs font-medium text-gray-600">价格位置</Text>
        <Text className="block text-xs font-semibold" style={{ color: zc }}>{zone} {position.toFixed(0)}%</Text>
      </View>
      <View className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
        <View className="h-full rounded-full transition-all duration-300" style={{ width: position + '%', backgroundColor: zc }} />
      </View>
    </View>
  )
}

export default function Index() {
  const [sc, setSc] = useState('')
  const [sr, setSr] = useState<any>(null)
  const [stocks, setStocks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [frozen, setFrozen] = useState(false)
  const [fmsg, setFmsg] = useState('')
  const [selectedStock, setSelectedStock] = useState<any>(null)
  const [detailData, setDetailData] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const frozenR = useRef(false)
  const intR = useRef<ReturnType<typeof setInterval> | null>(null)
  const detailCodesR = useRef<string[]>([])
  const [prices, setPrices] = useState<Record<string, { p: number; cp: number }>>({})

  // ═══ Load cached data from backend ═══
  const loadCachedData = useCallback(async () => {
    try {
      const res = await Network.request({ url: '/api/gem/scan-result' })
      const data = res.data?.data || []
      if (data.length > 0) {
        setStocks(data)
        detailCodesR.current = data.map((s: any) => s.c)
        setStatus('✅ 缓存数据 ' + data.length + ' 只')
      } else {
        setStatus('📭 暂无缓存')
      }
    } catch (e) {
      setStatus('📭 暂无缓存')
    }
  }, [])

  // ═══ Full scan: fetch → send to backend → read results ═══
  const scan = useCallback(async () => {
    if (frozenR.current) { setStatus('⏸️ 非交易时间，数据已冻结'); return }
    setLoading(true); setStatus('🔄 获取全市场列表...')
    try {
      const g = await fetchEMList('m:0+t:80')
      const m = await fetchEMList('m:0+t:6,m:1+t:1')
      const all = Array.from(new Map([...g, ...m].map(s => [s.c, s])).values())
      setStatus(`✅ ${all.length} 只，获取K线...`)

      // 前500主板+前500创业板，按涨跌幅排序取前1000
      all.sort((a, b) => (b.cp || 0) - (a.cp || 0))
      const top1000 = all.slice(0, 1000)

      // 批量获取K线
      const withKlines: any[] = []
      for (let i = 0; i < top1000.length; i += 30) {
        const rs = await Promise.all(top1000.slice(i, i + 30).map(async (s) => {
          try {
            const kl = await fetchKlines(s.c, 20)
            if (kl.length < 20) return null
            return { ...s, klines: kl }
          } catch (e) { return null }
        }))
        withKlines.push(...rs.filter(Boolean))
        setStatus(`🔄 K线 ${withKlines.length}/${top1000.length}`)
      }

      setStatus('🔄 发送到后端分析...')
      // 发送到后端缓存
      const sendRes = await Network.request({
        url: '/api/gem/cache-data',
        method: 'POST',
        data: { stocks: withKlines },
      })
      console.log('cache-data response:', sendRes.data)

      setStatus('🔄 读取分析结果...')
      // 读取结果
      const res = await Network.request({ url: '/api/gem/scan-result' })
      const data = res.data?.data || []
      setStocks(data)
      detailCodesR.current = data.map((s: any) => s.c)
      setStatus('✅ 扫描完成 ' + data.length + ' 只机会')
    } catch (e: any) { setStatus('❌ 失败: ' + (e.message || '未知错误')) }
    setLoading(false)
  }, [])

  // ═══ Fetch detail from backend ═══
  const fetchDetail = useCallback(async (code: string) => {
    setDetailLoading(true); setDetailData(null)
    try {
      const res = await Network.request({ url: '/api/gem/detail?code=' + code })
      setDetailData(res.data?.data || null)
    } catch (e) { setDetailData(null) }
    setDetailLoading(false)
  }, [])

  // ═══ 2-second price refresh for opportunity stocks ═══
  useEffect(() => {
    if (!isTH()) { setPrices({}); return }
    const tick = async () => {
      const codes = detailCodesR.current
      if (codes.length === 0) return
      try {
        const q = codes.slice(0, 50).map(c => (c.startsWith('6') ? 'sh' : 'sz') + c).join(',')
        const r = await fetch('http://qt.gtimg.cn/q=' + q)
        const buf = await r.arrayBuffer()
        const txt = new TextDecoder('gbk').decode(buf)
        const qm: Record<string, { p: number; cp: number }> = {}
        txt.split(';').forEach(line => {
          const t = line.trim(); if (!t || !t.includes('~')) return
          const p = t.split('~'); if (p.length < 40) return
          qm[p[2]] = { p: +p[3] || 0, cp: +p[32] || 0 }
        })
        if (Object.keys(qm).length > 0) setPrices(qm)
      } catch (e) { }
    }
    tick()
    const tt = setInterval(tick, 2000)
    return () => clearInterval(tt)
  }, [])

  // ═══ Scheduler ═══
  useEffect(() => {
    const check = () => {
      const inTH = isTH()
      setFrozen(!inTH); frozenR.current = !inTH
      setFmsg(freezeMsg())
    }
    check()
    const tt = setInterval(check, 30000)
    // Load cached data immediately
    loadCachedData()

    // Schedule scans: first at 9:25, then every 10 min
    const scheduleNext = () => {
      if (intR.current) clearInterval(intR.current)
      intR.current = setInterval(() => {
        if (isTH() && !isLunch()) {
          scan()
        }
      }, 600000) // 10 min
    }
    // First scan at 9:25 or on next scan window
    if (isTH() && !isLunch()) {
      setTimeout(() => scan(), 3000)
    }
    scheduleNext()
    return () => { clearInterval(tt); if (intR.current) clearInterval(intR.current) }
  }, [scan, loadCachedData])

  // ═══ Search via backend cache ═══
  const hSearch = useCallback(async () => {
    if (!sc.trim()) return; setSr(null)
    try {
      const res = await Network.request({ url: '/api/gem/search?q=' + encodeURIComponent(sc.trim()) })
      const data = res.data?.data || res.data
      if (!data || (Array.isArray(data) && data.length === 0)) {
        setSr({ error: '未找到' }); return
      }
      const items = Array.isArray(data) ? data : [data]
      setSr(items.length === 1 ? items[0] : items)
    } catch (e) { setSr({ error: '查询失败' }) }
  }, [sc])

  const showDetail = useCallback((stock: any) => {
    if (selectedStock?.c === stock.c) { setSelectedStock(null); setDetailData(null); return }
    setSelectedStock(stock)
    fetchDetail(stock.c)
  }, [selectedStock, fetchDetail])

  // ═══ Render: Action button with icon ═══
  const actionIcon = (a: string) => {
    if (['重仓买入', '买入'].includes(a)) return <AArrowUp color="#fff" size={16} />
    if (a === '轻仓买入') return <AArrowUp color="#fff" size={16} />
    if (a === '持有') return <Minus color="#fff" size={16} />
    if (['减仓', '卖出'].includes(a)) return <AArrowDown color="#fff" size={16} />
    return <TriangleAlert color="#fff" size={16} />
  }

  // ═══ JSX ═══
  return (
    <View className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <View className="sticky top-0 bg-white z-10 px-3 py-2 border-b border-gray-100">
        <View className="flex flex-row items-center justify-between">
          <Text className="block text-base font-bold">机会区</Text>
          <Text className="block text-xs text-gray-400">{status}</Text>
        </View>
        {fmsg ? (
          <View className="mt-1 px-2 py-1 bg-yellow-50 rounded-lg border border-yellow-200">
            <Text className="block text-xs text-yellow-700">{fmsg}</Text>
          </View>
        ) : null}
      </View>

      {/* Search bar */}
      <View className="px-3 py-2 bg-white border-b border-gray-100">
        <View style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }} className="bg-gray-50 rounded-lg px-3 py-2">
          <Search size={16} color="#999" />
          <View style={{ flex: 1 }}>
            <Input className="w-full text-xs bg-transparent" placeholder="代码/名称/拼音搜索"
              value={sc}
              onInput={e => setSc(e.detail.value)}
              onConfirm={() => hSearch()}
            />
          </View>
          <Button className="bg-blue-500 text-white text-xs px-3 py-1 rounded-md" onClick={() => hSearch()}>
            <Text className="block text-xs">搜索</Text>
          </Button>
        </View>
        {sr ? (
          Array.isArray(sr) ? (
            <View className="mt-1 bg-gray-50 rounded-lg p-2">
              {sr.map((item: any, i: number) => (
                <View key={i} className="flex flex-row items-center justify-between py-1 border-b border-gray-100 last:border-b-0"
                  onClick={() => { showDetail(item); setSr(null) }}
                >
                  <Text className="block text-xs text-gray-700">{item.n || item.c} {item.c}</Text>
                  <Text className="block text-xs font-bold" style={{ color: ACTION_BG[item.suggestion] || '#666' }}>
                    {item.suggestion || '-'}
                  </Text>
                </View>
              ))}
            </View>
          ) : sr.error ? (
            <Text className="block text-xs text-red-500 mt-1">{sr.error}</Text>
          ) : (
            <View className="mt-1 px-2 py-1 bg-gray-50 rounded-lg" onClick={() => { showDetail(sr); setSr(null) }}>
              <Text className="block text-xs">{sr.n || sr.c} ¥{sr.p?.toFixed(2)} {(sr.cp || 0) >= 0 ? '+' : ''}{sr.cp}% — {sr.suggestion || '-'}</Text>
            </View>
          )
        ) : null}
      </View>

      {/* Scan button */}
      <View className="px-3 py-1 flex flex-row gap-2">
        <Button className="bg-blue-500 text-white text-xs px-4 py-2 rounded-lg flex-1"
          onClick={() => { if (!frozenR.current) scan(); else Taro.showToast({ title: '非交易时间', icon: 'none' }) }}
          disabled={loading}
        >
          <Text className="block text-xs">{loading ? '扫描中...' : (frozen ? '📊 已冻结' : '🔄 立即扫描')}</Text>
        </Button>
      </View>

      {/* Stock list */}
      <ScrollView className="flex-1 px-3" scrollY>
        <View className="py-2">
          <View className="flex flex-row items-center px-2 py-1 mb-1">
            <View style={{ flex: 1.1 }}><Text className="block text-xs text-gray-400 font-medium">名称</Text></View>
            <View style={{ flex: 0.55 }} className="text-center"><Text className="block text-xs text-gray-400">操作</Text></View>
            <View style={{ flex: 0.8 }} className="text-center"><Text className="block text-xs text-gray-400">价格</Text></View>
            <View style={{ flex: 0.8 }} className="text-center"><Text className="block text-xs text-gray-400">涨幅</Text></View>
            <View style={{ flex: 0.9 }} className="text-right"><Text className="block text-xs text-gray-400">位置</Text></View>
          </View>

          {loading && stocks.length === 0 ? (
            <View className="flex flex-col gap-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="w-full h-12 rounded-xl" />)}</View>
          ) : stocks.length === 0 ? (
            <View className="flex items-center justify-center py-12">
              <Text className="block text-sm text-gray-400">{frozen ? fmsg : '点击上方按钮开始扫描'}</Text>
            </View>
          ) : (
            <View className="flex flex-col gap-2">
              {stocks.map((stock: any, idx: number) => {
                const curPrice = prices[stock.c]?.p || stock.curP || stock.p || 0
                const curCp = prices[stock.c]?.cp ?? stock.cp ?? 0
                const isOpen = selectedStock?.c === stock.c
                return (
                  <View key={stock.c}>
                    <Card className="overflow-hidden" onClick={() => showDetail(stock)}>
                      <CardContent className="p-2">
                        <View className="flex flex-row items-center">
                          <View style={{ flex: 1.1 }}>
                            <View className="flex flex-row items-center gap-1">
                              <Badge className={'px-1 py-0 flex-shrink-0 ' + (idx < 3 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200')}>
                                <Text className="block text-xs">#{idx + 1}</Text>
                              </Badge>
                              <View className="min-w-0 flex-1">
                                <Text className="block text-xs font-medium truncate">{stock.n}</Text>
                                <Text className="block text-xs text-gray-400">{stock.c}</Text>
                              </View>
                            </View>
                          </View>
                          <View style={{ flex: 0.55 }} className="text-center">
                            <Text className="block text-xs text-white font-bold px-1 py-1 rounded-sm"
                              style={{ backgroundColor: ACTION_BG[stock.suggestion] || '#999' }}
                            >
                              {stock.suggestion || '-'}
                            </Text>
                          </View>
                          <View style={{ flex: 0.8 }} className="text-center">
                            <Text className="block text-xs font-medium">{curPrice.toFixed(2)}</Text>
                          </View>
                          <View style={{ flex: 0.8 }} className="text-center">
                            <Text className="block text-xs font-bold" style={{ color: curCp >= 0 ? '#ef4444' : '#22c55e' }}>
                              {curCp >= 0 ? '+' : ''}{curCp.toFixed(2)}%
                            </Text>
                          </View>
                          <View style={{ flex: 0.9 }} className="text-right">
                            <Text className="block text-xs font-bold" style={{ color: (stock.pp ?? 50) < 25 ? '#22c55e' : (stock.pp ?? 50) < 45 ? '#84cc16' : (stock.pp ?? 50) < 55 ? '#eab308' : (stock.pp ?? 50) < 75 ? '#f97316' : '#ef4444' }}>
                              {isOpen ? <ChevronUp size={14} color="#666" /> : <ChevronDown size={14} color="#666" />}
                              {' '}位置{(stock.pp ?? 50).toFixed(0)}%
                            </Text>
                          </View>
                        </View>
                      </CardContent>
                    </Card>

                    {/* Detail panel */}
                    {isOpen && (
                      <View className="px-2 pb-2">
                        {/* ═══ 操作建议卡片 ═══ */}
                        <Card className="border border-blue-100">
                          <CardContent className="p-4">
                            <View className="flex flex-row items-center gap-2 mb-3">
                              <Text className="block text-base font-bold text-gray-900">操作建议</Text>
                              {stock.prediction && (
                                <View className="flex-1 text-right">
                                  <Text className="block text-xs text-gray-400">未来1-2日</Text>
                                </View>
                              )}
                            </View>
                            {/* 操作按钮 */}
                            <View className="rounded-xl py-3 px-4 mb-2"
                              style={{ backgroundColor: ACTION_BG[stock.suggestion] || '#2563eb' }}
                            >
                              <View className="flex flex-row items-center justify-between">
                                <View className="flex flex-row items-center gap-2">
                                  {actionIcon(stock.suggestion)}
                                  <Text className="block text-lg font-bold text-white">{stock.suggestion}</Text>
                                </View>
                                <Text className="block text-xs text-white" style={{ opacity: 0.8 }}>{stock.reason || ''}</Text>
                              </View>
                            </View>
                            {/* 预测 */}
                            {stock.prediction && (
                              <View className="bg-gray-50 rounded-xl p-3 flex flex-row items-center gap-2">
                                <Text className="block text-xs font-medium text-gray-600">未来1-2日</Text>
                                <Text className="block text-sm font-semibold text-gray-800">{stock.prediction}</Text>
                              </View>
                            )}
                          </CardContent>
                        </Card>

                        {/* ═══ 技术指标卡片 ═══ */}
                        <Card className="mt-2 border border-gray-100">
                          <CardContent className="p-4">
                            <Text className="block text-base font-bold text-gray-900 mb-3">技术指标</Text>

                            {/* MACD 差值图 */}
                            <View className="mb-3 p-3 bg-gray-50 rounded-xl">
                              <Text className="block text-xs font-medium text-gray-600 mb-2">MACD 差值状态</Text>
                              <MacdBar diff={stock.diff ?? 0} dea={stock.dea ?? 0} />
                            </View>

                            {/* 价格位置 */}
                            <PositionBar position={stock.pp ?? 50} zone={stock.positionZone || '中位区'} />

                            <Separator className="my-3" />

                            {/* 指标网格 */}
                            <View className="flex flex-row flex-wrap gap-2">
                              <View className="flex-1 min-w-[45%]"><InfoItem label="趋势强度" value={(stock.trendStrength ?? 0).toFixed(1)} /></View>
                              <View className="flex-1 min-w-[45%]"><InfoItem label="机构活跃度" value={(stock.jiGouHuoYueDu ?? 0).toFixed(1)} /></View>
                              <View className="flex-1 min-w-[45%]"><InfoItem label="生命线" value={(stock.lifeLine ?? 0).toFixed(2)} /></View>
                              <View className="flex-1 min-w-[45%]"><InfoItem label="压力位" value={(stock.pressure ?? 0).toFixed(2)} /></View>
                            </View>

                            {detailLoading && (
                              <View className="mt-3"><Skeleton className="w-full h-20 rounded-lg" /></View>
                            )}

                            {detailData && (
                              <>
                                {/* 评分系统 */}
                                {detailData.entryScore !== undefined && (
                                  <>
                                    <Separator className="my-3" />
                                    <Text className="block text-xs font-medium text-gray-600 mb-2">评分系统</Text>
                                    <View className="bg-gray-50 rounded-xl p-3">
                                      <View className="flex flex-row items-center justify-between mb-2">
                                        <Text className="block text-sm text-gray-700">入场评分</Text>
                                        <Text className="block text-lg font-bold"
                                          style={{ color: detailData.entryScore >= 80 ? '#22c55e' : detailData.entryScore >= 60 ? '#eab308' : '#ef4444' }}
                                        >
                                          {detailData.entryScore}/100
                                        </Text>
                                      </View>
                                      <Badge className="self-start"
                                        style={{ backgroundColor: detailData.entryScore >= 80 ? '#22c55e' : detailData.entryScore >= 60 ? '#eab308' : '#ef4444', color: '#fff' }}
                                      >
                                        <Text className="block text-xs">{detailData.entryLevel || '-'}</Text>
                                      </Badge>
                                      {detailData.reasoning && detailData.reasoning.length > 0 && (
                                        <View className="mt-2">
                                          {detailData.reasoning.map((r: string, i: number) => (
                                            <Text key={i} className="block text-xs text-gray-500 mt-1">• {r}</Text>
                                          ))}
                                        </View>
                                      )}
                                    </View>
                                    {/* 技术指标详情 */}
                                    <View className="flex flex-row flex-wrap gap-2 mt-2">
                                      {detailData.rsi && <View className="flex-1 min-w-[30%]"><InfoItem label="RSI" value={detailData.rsi.toFixed(1)} /></View>}
                                      {detailData.kdj_k && <View className="flex-1 min-w-[30%]"><InfoItem label="KDJ K" value={detailData.kdj_k.toFixed(1)} /></View>}
                                      {detailData.kdj_d && <View className="flex-1 min-w-[30%]"><InfoItem label="KDJ D" value={detailData.kdj_d.toFixed(1)} /></View>}
                                      {detailData.volumeRatio && <View className="flex-1 min-w-[30%]"><InfoItem label="量比" value={detailData.volumeRatio.toFixed(2)} /></View>}
                                    </View>
                                  </>
                                )}
                              </>
                            )}

                            {/* 信号标识 */}
                            <Separator className="my-3" />
                            <Text className="block text-xs font-medium text-gray-600 mb-2">信号组合</Text>
                            {stock.signalComb ? (
                              <View className="flex flex-row flex-wrap gap-1">
                                {stock.signalComb.split('+').map((s: string, i: number) => (
                                  <Badge key={i} className="bg-blue-50 text-blue-700 border-blue-200">
                                    <Text className="block text-xs">{s}</Text>
                                  </Badge>
                                ))}
                              </View>
                            ) : (
                              <Text className="block text-xs text-gray-400">暂无信号</Text>
                            )}

                            {/* 关键水平对比 */}
                            <Separator className="my-3" />
                            <Text className="block text-xs font-medium text-gray-600 mb-2">关键水平对比</Text>
                            <View className="flex flex-col gap-2">
                              <View className="flex flex-row items-center justify-between p-2 bg-gray-50 rounded-lg">
                                <View className="flex flex-row items-center gap-2">
                                  <View className="w-2 h-2 rounded-full bg-red-400" />
                                  <Text className="block text-xs text-gray-600">DIFF</Text>
                                </View>
                                <Text className="block text-xs font-mono font-medium">{(stock.diff ?? 0).toFixed(2)}</Text>
                              </View>
                              <View className="flex flex-row items-center justify-between p-2 bg-gray-50 rounded-lg">
                                <View className="flex flex-row items-center gap-2">
                                  <View className="w-2 h-2 rounded-full bg-orange-400" />
                                  <Text className="block text-xs text-gray-600">DEA</Text>
                                </View>
                                <Text className="block text-xs font-mono font-medium">{(stock.dea ?? 0).toFixed(2)}</Text>
                              </View>
                              <View className="flex flex-row items-center justify-between p-2 bg-gray-50 rounded-lg">
                                <View className="flex flex-row items-center gap-2">
                                  <View className="w-2 h-2 rounded-full bg-purple-400" />
                                  <Text className="block text-xs text-gray-600">压力位</Text>
                                </View>
                                <Text className="block text-xs font-mono font-medium">{(stock.pressure ?? 0).toFixed(2)}</Text>
                              </View>
                              <View className="flex flex-row items-center justify-between p-2 bg-gray-50 rounded-lg">
                                <View className="flex flex-row items-center gap-2">
                                  <View className="w-2 h-2 rounded-full bg-green-400" />
                                  <Text className="block text-xs text-gray-600">入场价</Text>
                                </View>
                                <Text className="block text-xs font-mono font-medium">{detailData?.bestEntryPrice ? detailData.bestEntryPrice.toFixed(2) : (stock.ma5 ?? 0).toFixed(2)}</Text>
                              </View>
                            </View>
                          </CardContent>
                        </Card>
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Footer */}
      <View className="bg-white px-3 py-2 border-t border-gray-100">
        <Text className="block text-xs text-gray-400">
          {loading ? '⏳ 扫描中...' : (frozen ? fmsg : stocks.length > 0 ? '✅ 机会区 | 10分钟自动刷新' : '⏸️ 等待扫描')}
        </Text>
      </View>
    </View>
  )
}