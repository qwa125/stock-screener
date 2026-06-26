import { useState, useEffect, useCallback, useRef } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, ScrollView } from '@tarojs/components'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Network } from '@/network'

const BUY_COLORS: Record<string, string> = { '重仓买入': '#dc2626', '买入': '#2563eb' }

function getBJ(): Date {
  const n = new Date()
  return new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 28800000)
}

function isTradingDay(): boolean {
  const b = getBJ()
  return b.getUTCDay() >= 1 && b.getUTCDay() <= 5
}

function bjMinutes(): number {
  const b = getBJ()
  return b.getUTCHours() * 60 + b.getUTCMinutes()
}

/** 是否在交易时间段(9:25-11:30 / 13:00-15:00) */
function isInScanWindow(): boolean {
  if (!isTradingDay()) return false
  const m = bjMinutes()
  return (m >= 565 && m < 690) || (m >= 780 && m < 900)
}

function isLunch(): boolean {
  return bjMinutes() >= 690 && bjMinutes() < 780
}

function nextScanMinutes(): number {
  const m = bjMinutes()
  if (!isTradingDay() || m >= 900) return -1
  if (m < 565) return 565
  if (isLunch()) return 780
  // 下一个10分钟整点
  return Math.ceil((m + 1) / 10) * 10
}

function freezeText(): string {
  const b = getBJ()
  const d = b.getUTCDay()
  const m = bjMinutes()
  if (d === 0 || d === 6) return '周末休市，下周一 9:25 开盘'
  if (m >= 900) return d === 5 ? '周五收盘，下周一 9:25 恢复' : '今日收盘，明早 9:25 恢复'
  if (isLunch()) return '午间休市，13:00 恢复'
  if (m < 565) return '盘前等待，9:25 开盘'
  return ''
}

async function getRanking(board: 'gem' | 'main'): Promise<any[]> {
  const fs = board === 'gem' ? 'm:0+t:80' : 'm:0+t:6,m:1+t:1'
  const all: any[] = []
  for (let pn = 1; pn <= 2; pn++) {
    try {
      const r = await fetch(
        `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=500&po=1&np=1&fltt=2&invt=2&fs=${fs}&fields=f12,f14,f2,f3,f62,f184`
      )
      const j = await r.json()
      ;(j?.data?.diff || []).forEach((x: any) => {
        if (x.f12) all.push({
          code: String(x.f12),
          name: x.f14 || '',
          price: x.f2 ?? 0,
          changePercent: x.f3 ?? 0,
          inflow: x.f184 ?? x.f62 ?? 0,
        })
      })
      if ((j?.data?.diff || []).length < 500) break
    } catch { break }
  }
  return all
}

async function fetchKLine(code: string): Promise<any[]> {
  const MAX_RETRY = 2
  for (let retry = 0; retry < MAX_RETRY; retry++) {
    for (const src of [
      `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code.startsWith('6') ? 'sh' : 'sz'}${code},day,,,120,qfq`,
      `https://push2his.eastmoney.com/api/qt/stock/kline/get2?secid=${(code.startsWith('6') || code.startsWith('68')) ? '1.' : '0.'}${code}&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=120`,
    ]) {
      try {
        const ac = new AbortController()
        const tid = setTimeout(() => ac.abort(), 6000)
        const r = await fetch(src, { signal: ac.signal })
        clearTimeout(tid)
        const txt = await r.text()
        let kl: any[] = []
        if (src.includes('gtimg')) {
          const pk = (code.startsWith('6') ? 'sh' : 'sz') + code
          const j = JSON.parse(txt)
          kl = (j?.data?.[pk]?.day || j?.data?.[pk]?.qfqday || []).map((k: any) => {
            if (Array.isArray(k)) return { day: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4], volume: +k[5] }
            const p = String(k).split(' ')
            return { day: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5] }
          })
        } else {
          const j = JSON.parse(txt)
          kl = (j?.data?.klines || []).map((k: string) => {
            const p = k.split(',')
            return { day: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5] }
          })
        }
        if (kl.length >= 20) return kl
      } catch { /* try next source */ }
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  return []
}

/** 从腾讯行情获取实时价格 */
async function fetchPrices(codes: string[]): Promise<Record<string, { price: number; cp: number }>> {
  const result: Record<string, { price: number; cp: number }> = {}
  for (let i = 0; i < codes.length; i += 200) {
    const q = codes.slice(i, i + 200).map(c => (c.startsWith('6') ? 'sh' : 'sz') + c).join(',')
    try {
      const r = await fetch(`https://qt.gtimg.cn/q=${q}`)
      const buf = await r.arrayBuffer()
      new TextDecoder('gbk').decode(buf).split(';').forEach(line => {
        const t = line.trim()
        if (!t || !t.includes('~')) return
        const p = t.split('~')
        if (p.length < 40) return
        result[p[2]] = { price: +p[3] || 0, cp: +p[32] || 0 }
      })
    } catch { /* continue */ }
  }
  return result
}

export default function Index() {
  const [opportunities, setOpportunities] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [lastScanTime, setLastScanTime] = useState('')
  const [prices, setPrices] = useState<Record<string, { price: number; cp: number }>>({})
  const [frozen, setFrozen] = useState(false)
  const frozenR = useRef(false)
  const scanTimerR = useRef<any>(null)
  const priceTimerR = useRef<any>(null)
  const oppCodesR = useRef<string[]>([])

  /** 核心扫描：拉取数据 → 发送后端缓存 → 读取机会区 */
  const runScan = useCallback(async () => {
    if (frozenR.current) {
      setStatus('⏸️ 非交易时间，数据已冻结')
      return
    }
    setLoading(true)
    setStatus('🔄 拉取创业板排行榜 Top 500...')
    try {
      // 1. 拉取排行榜
      const [gemList, mainList] = await Promise.all([
        getRanking('gem'),
        getRanking('main'),
      ])
      const topGem = gemList.slice(0, 500)
      const topMain = mainList.slice(0, 500)
      const allStocks = [...topGem, ...topMain]
      setStatus(`✅ 共 ${allStocks.length} 只, 批量获取K线...`)

      // 2. 批量获取120日K线（每次30并发）
      const enriched: any[] = []
      const BATCH = 30
      for (let i = 0; i < allStocks.length; i += BATCH) {
        const batch = allStocks.slice(i, i + BATCH)
        const batchResults = await Promise.all(
          batch.map(async (s) => {
            try {
              const klines = await fetchKLine(s.code)
              if (klines.length < 20) return null
              return { ...s, klines }
            } catch { return null }
          })
        )
        enriched.push(...batchResults.filter(Boolean))
        if (i % 300 === 0) {
          setStatus(`🔄 K线获取中: ${enriched.length}/${allStocks.length}...`)
        }
      }
      setStatus(`📤 发送 ${enriched.length} 只到后端分析...`)

      // 3. 发送到后端缓存分析
      const cacheRes = await Network.request({
        url: '/api/gem/cache-data',
        method: 'POST',
        data: { stocks: enriched },
      })
      console.log('📦 cache-data response:', cacheRes.data)

      // 4. 获取机会区结果（仅重仓买入/买入）
      const scanRes = await Network.request({ url: '/api/gem/scan-result' })
      console.log('🎯 scan-result response:', scanRes.data)
      const scanData = scanRes?.data?.data || scanRes?.data
      const opps = scanData?.opportunities || []
      setOpportunities(opps)
      oppCodesR.current = opps.map((s: any) => s.code)

      // 5. 更新状态
      const now = new Date()
      setLastScanTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setStatus(`✅ 已更新: ${enriched.length}只分析完成, ${opps.length}只机会股`)

      // 6. 分析完成后立即拉一次价格
      if (opps.length > 0) {
        const pr = await fetchPrices(oppCodesR.current)
        if (Object.keys(pr).length > 0) setPrices(prev => ({ ...prev, ...pr }))
      }
    } catch (e: any) {
      setStatus(`❌ 扫描失败: ${(e.message || '未知错误')}`)
      console.error('扫描异常:', e)
    }
    setLoading(false)
  }, [])

  /** 2秒价格刷新 */
  const refreshPrices = useCallback(async () => {
    const codes = oppCodesR.current
    if (codes.length === 0) return
    try {
      const pr = await fetchPrices(codes)
      if (Object.keys(pr).length > 0) setPrices(prev => ({ ...prev, ...pr }))
    } catch { /* ignore */ }
  }, [])

  /** 加载后端缓存的冻结数据（页面打开时直接读缓存，不触发扫描） */
  const loadCachedData = useCallback(async () => {
    setStatus('📂 读取缓存数据...')
    try {
      const res = await Network.request({ url: '/api/gem/scan-result' })
      console.log('📂 缓存数据:', res.data)
      const scanData = res?.data?.data || res?.data
      const opps = scanData?.opportunities || []
      if (opps.length > 0) {
        setOpportunities(opps)
        oppCodesR.current = opps.map((s: any) => s.code)
        setStatus(`📂 缓存数据: ${opps.length}只机会股`)
        // 拉一次价格
        const pr = await fetchPrices(oppCodesR.current)
        if (Object.keys(pr).length > 0) setPrices(prev => ({ ...prev, ...pr }))
      } else {
        setStatus('📂 缓存为空，等待下次扫描')
      }
      // 显示上次扫描时间
      const scanTime = scanData?.timestamp
      if (scanTime) {
        const t = new Date(scanTime)
        setLastScanTime(t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      }
    } catch (e: any) {
      setStatus(`⚠️ 读取缓存失败: ${e.message}`)
      console.error('读取缓存失败:', e)
    }
  }, [])

  // ====== 页面加载时先读缓存 ======
  useEffect(() => {
    loadCachedData()
  }, [loadCachedData])

  // ====== 扫描调度器 ======
  useEffect(() => {
    const tick = () => {
      const inWindow = isInScanWindow()
      const frz = !inWindow
      setFrozen(frz)
      frozenR.current = frz
    }

    const scheduleNextScan = () => {
      const next = nextScanMinutes()
      if (next < 0) {
        scanTimerR.current = setTimeout(() => {
          scheduleNextScan()
        }, 60000)
        return
      }
      const nowMin = bjMinutes()
      const diffMs = (next - nowMin) * 60 * 1000
      const delay = Math.min(diffMs, 5 * 60 * 1000)
      scanTimerR.current = setTimeout(async () => {
        // 到达扫描窗口则执行扫描
        if (isInScanWindow() && !frozenR.current) {
          setStatus('🔄 定时扫描开始...')
          await runScan()
        }
        // 继续调度下一次
        scheduleNextScan()
      }, Math.max(delay, 1000))
    }

    // 首次启动：设置冻结状态 + 启动调度器
    tick()
    scheduleNextScan()

    // 定时检查冻结状态
    const stateTimer = setInterval(tick, 10000)

    return () => {
      if (scanTimerR.current) clearTimeout(scanTimerR.current)
      clearInterval(stateTimer)
    }
  }, [runScan])

  // ====== 2秒价格刷新 ======
  useEffect(() => {
    const startPriceRefresh = () => {
      if (priceTimerR.current) clearInterval(priceTimerR.current)
      priceTimerR.current = setInterval(async () => {
        if (isInScanWindow() && oppCodesR.current.length > 0) {
          await refreshPrices()
        }
      }, 2000)
    }
    startPriceRefresh()
    return () => {
      if (priceTimerR.current) clearInterval(priceTimerR.current)
    }
  }, [refreshPrices])

  // ====== 渲染 ======
  return (
    <View className="flex flex-col h-full bg-gray-50">
      {/* 顶部状态栏 */}
      <View className="sticky top-0 bg-white z-10 px-4 py-3 border-b border-gray-100">
        <View className="flex flex-row items-center justify-between mb-1">
          <Text className="block text-base font-bold text-gray-900">📊 机会区</Text>
          <Text className="block text-xs text-gray-400">{status}</Text>
        </View>
        <View className="flex flex-row items-center justify-between">
          {frozen ? (
            <Text className="block text-xs text-yellow-600">{freezeText()}</Text>
          ) : (
            <Text className="block text-xs text-green-600">交易中 · 每10分钟扫描</Text>
          )}
          {lastScanTime && (
            <Text className="block text-xs text-gray-400 ml-2">最近: {lastScanTime}</Text>
          )}
        </View>
      </View>

      {/* 操作按钮 */}
      <View className="px-4 py-2 bg-white border-b border-gray-100">
        <View style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
          <Button
            className="flex-1 bg-blue-600 text-white text-xs px-4 py-2 rounded-lg"
            onClick={() => { if (!frozenR.current) runScan(); else Taro.showToast({ title: '非交易时间', icon: 'none' }) }}
            disabled={loading}
          >
            <Text className="block text-xs text-center">{loading ? '扫描分析中...' : '🔄 立即扫描'}</Text>
          </Button>
        </View>
      </View>

      {/* 机会区列表 */}
      <ScrollView className="flex-1 px-4" scrollY>
        <View className="py-3">
          {loading && opportunities.length === 0 ? (
            // 加载骨架屏
            <View className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-24 mb-2" />
                    <Skeleton className="h-3 w-32" />
                  </CardContent>
                </Card>
              ))}
            </View>
          ) : opportunities.length === 0 ? (
            <View className="py-12 flex items-center justify-center">
              <Text className="block text-sm text-gray-400 text-center">
                {frozen
                  ? '非交易时间，数据已冻结'
                  : '暂无机会股，等待下次扫描...'}
              </Text>
            </View>
          ) : (
            <View className="space-y-2">
              {/* 表头 */}
              <View className="flex flex-row items-center px-3 py-2">
                <View style={{ flex: 1.2 }}><Text className="block text-xs text-gray-400 font-medium">名称</Text></View>
                <View style={{ flex: 0.7, textAlign: 'center' }}><Text className="block text-xs text-gray-400 text-center">信号</Text></View>
                <View style={{ flex: 0.7, textAlign: 'center' }}><Text className="block text-xs text-gray-400 text-center">最新价</Text></View>
                <View style={{ flex: 0.7, textAlign: 'center' }}><Text className="block text-xs text-gray-400 text-center">涨幅</Text></View>
                <View style={{ flex: 0.6, textAlign: 'right' }}><Text className="block text-xs text-gray-400 text-right">介入分</Text></View>
              </View>
              {opportunities.map((stock: any, idx: number) => {
                const realtime = prices[stock.code] || {}
                const price = realtime.price || stock.currentPrice || 0
                const cp = realtime.cp ?? stock.changePercent ?? 0
                const sig = stock.suggestion || ''
                const color = BUY_COLORS[sig] || '#6b7280'
                return (
                  <Card key={stock.code + idx}>
                    <CardContent className="px-3 py-2">
                      <View style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1.2 }}>
                          <Text className="block text-sm font-medium text-gray-900">{stock.name}</Text>
                          <Text className="block text-xs text-gray-400">{stock.code}</Text>
                        </View>
                        <View style={{ flex: 0.7, textAlign: 'center' }} className="flex items-center justify-center">
                          <View
                            className="px-1 py-0 rounded text-xs text-white font-medium text-center"
                            style={{ backgroundColor: color, whiteSpace: 'nowrap' }}
                          >
                            <Text className="block text-xs text-white font-medium">{sig}</Text>
                          </View>
                        </View>
                        <View style={{ flex: 0.7, textAlign: 'center' }}>
                          <Text className="block text-xs text-gray-800 text-center font-medium">
                            {price > 0 ? `¥${price.toFixed(2)}` : '--'}
                          </Text>
                        </View>
                        <View style={{ flex: 0.7, textAlign: 'center' }}>
                          <Text
                            className="block text-xs font-medium text-center"
                            style={{ color: cp >= 0 ? '#dc2626' : '#16a34a' }}
                          >
                            {cp > 0 ? '+' : ''}{cp.toFixed(2)}%
                          </Text>
                        </View>
                        <View style={{ flex: 0.6, textAlign: 'right' }}>
                          <Text className="block text-xs text-gray-500 text-right">{stock.entryTiming ?? '--'}</Text>
                        </View>
                      </View>
                    </CardContent>
                  </Card>
                )
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}