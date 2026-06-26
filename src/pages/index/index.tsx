import { useState, useEffect, useCallback, useRef } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, ScrollView } from '@tarojs/components'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react-taro'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import './index.css'

const ACTION_BADGE_COLOR: Record<string, string> = {
  '重仓买入': '#dc2626', '买入🏆': '#16a34a', '买入': '#2563eb',
  '轻仓买入': '#ca8a04', '持有': '#6b7280',
}
const ACTION_ORDER = ['重仓买入', '买入🏆', '买入', '轻仓买入']
function getActionPriority(a: string): number { const i = ACTION_ORDER.indexOf(a); return i >= 0 ? i : 999 }
function getBJ(): Date { const n = new Date(); return new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 28800000) }
function isTH(): boolean { const b = getBJ(); if (b.getDay() === 0 || b.getDay() === 6) return false; const m = b.getHours() * 60 + b.getMinutes(); return m >= 540 && m < 900 }
function freezeMsg(): string {
  const b = getBJ(); const d = b.getDay(); const m = b.getHours() * 60 + b.getMinutes()
  if (d === 0 || d === 6) return '周末休市，已冻结至周一 9:00'
  if (m >= 900) return d === 5 ? '周五收盘，已冻结至下周一 9:00' : '收盘已冻结，明早 9:00 恢复'
  if (m < 540) return '盘前已冻结，9:00 恢复'; return ''
}
async function fetchKlines(code: string, minL = 20): Promise<any[]> {
  for (const src of [
    `http://d.10jqka.com.cn/v2/line/hs_${code}/01/last.js`,
    `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code.startsWith('6')?'sh':'sz'}${code},day,,,100,qfq`,
    `http://push2.eastmoney.com/api/qt/stock/kline/get?secid=${(code.startsWith('6')||code.startsWith('68'))?1:0}.${code}&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101`,
  ]) {
    try {
      const ac = new AbortController(); const tid = setTimeout(() => ac.abort(), 5000)
      const r = await fetch(src, { signal: ac.signal }); clearTimeout(tid); const txt = await r.text()
      let kl: any[] = []
      if (src.includes('10jqka')) {
        const m = txt.match(/\{.*\}/)
        if (m) { const j = JSON.parse(m[0]); kl = (j?.data||'').split(';').filter(Boolean).map((s: string) => { const p = s.split(','); return {d:p[0],o:+p[1],c:+p[2],h:+p[3],l:+p[4],v:+p[5]} }) }
      } else if (src.includes('gtimg')) {
        const pk = (code.startsWith('6')?'sh':'sz')+code; const j = JSON.parse(txt)
        kl = (j?.data?.[pk]?.qfqday || []).map((k: any) => ({d:k[0],o:+k[1],c:+k[2],h:+k[3],l:+k[4],v:+k[5]}))
      } else {
        const j = JSON.parse(txt)
        kl = (j?.data?.klines || []).map((k: string) => { const p = k.split(','); return {d:p[0],o:+p[1],c:+p[2],h:+p[3],l:+p[4],v:+p[5]} })
      }
      if (kl.length >= minL) return kl
    } catch(e) {}
  }
  return []
}
async function fetchEMList(fs: string): Promise<any[]> {
  const all: any[] = []
  for (let pn = 1; pn <= 3; pn++) {
    try {
      const r = await fetch(`http://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=5000&po=1&np=1&fltt=2&invt=2&fs=${fs}&fields=f12,f14,f2,f3`)
      const j = await r.json(); (j?.data?.diff || []).forEach((x: any) => { if (x.f12) all.push({c:String(x.f12),n:x.f14,p:x.f2||0,cp:x.f3||0}) })
      if ((j?.data?.diff || []).length < 5000) break
    } catch(e) { break }
  }
  return all
}
async function fetchQ(codes: string[]): Promise<Record<string, any>> {
  const qm: Record<string, any> = {}
  for (let i = 0; i < codes.length; i += 200) {
    const q = codes.slice(i, i+200).map(c => (c.startsWith('6')?'sh':'sz')+c).join(',')
    try {
      const r = await fetch('http://qt.gtimg.cn/q='+q); const buf = await r.arrayBuffer()
      new TextDecoder('gbk').decode(buf).split(';').forEach(line => {
        const t = line.trim(); if (!t || !t.includes('~')) return; const p = t.split('~'); if (p.length < 40) return
        qm[p[2]] = {p:+p[3]||0,cp:+p[32]||0}
      })
    } catch(e) {}
  }
  return qm
}

export default function Index() {
  const [sc, setSc] = useState('')
  const [sr, setSr] = useState<any>(null)
  const [stocks, setStocks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [frozen, setFrozen] = useState(false)
  const [fmsg, setFmsg] = useState('')
  const frozenR = useRef(false)
  const intR = useRef<number | null>(null)

  const scan = useCallback(async () => {
    if (frozenR.current) { setStatus('⏸️ 非交易时间，数据已冻结'); return }
    setLoading(true); setStatus('🔄 获取全市场股票列表...')
    try {
      const g = await fetchEMList('m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23')
      const m = await fetchEMList('m:1+t:1,m:1+t:2,m:0+t:6')
      const all = Array.from(new Map([...g, ...m].map(s => [s.c, s])).values())
      setStatus(`✅ ${all.length} 只，获取批量行情...`)
      const qm = await fetchQ(all.map(s => s.c))
      const wq = all.map(s => ({...s, ...(qm[s.c]||{})}))
      setStatus('🔄 K线分析中...')
      const res: any[] = []
      for (let i = 0; i < wq.length; i += 30) {
        const rs = await Promise.all(wq.slice(i, i+30).map(async (s) => {
          try {
            const kl = await fetchKlines(s.c, 20); if (kl.length < 20) return null
            const c = kl.map(x => x.c), v = kl.map(x => x.v), o = kl.map(x => x.o)
            const lc = c[c.length-1]
            const lo = Math.min(...c), hi = Math.max(...c)
            const pp = ((lc-lo)/(hi-lo||1))*100

            // 均线
            const ma5 = c.slice(-5).reduce((a,b)=>a+b,0)/5
            const ma10 = c.slice(-10).reduce((a,b)=>a+b,0)/10
            const ma20 = c.length >= 20 ? c.slice(-20).reduce((a,b)=>a+b,0)/20 : ma10

            // 趋势状态 0-3（与后端一致）
            const ma5Up = c[c.length-1] > c[c.length-6]
            const ma10_1dAgo = c.length > 11 ? c.slice(-11,-1).reduce((a,b)=>a+b,0)/10 : 0
            const ma10Up = ma10 >= ma10_1dAgo * 0.995
            let trend = 1
            if (ma5 > ma10 && ma5Up && ma10Up) trend = 3
            else if (ma5 > ma10 && ma10Up) trend = 2
            else if (ma5 > ma10 && ma5Up) trend = 2
            else if (ma5 < ma10 && ma10 < ma20) trend = 0
            else if (ma5 < ma10) trend = 0

            // DIFF/DEA（EMA12-EMA26）
            const ema12 = c.reduce((acc: number, val: number) => acc === 0 ? val : acc + (val - acc) * 2 / 13, 0)
            const ema26 = c.reduce((acc: number, val: number) => acc === 0 ? val : acc + (val - acc) * 2 / 27, 0)
            const diff = ema12 - ema26
            // DEA近似计算
            let deaAcc = 0
            for (let idx = 0; idx < c.length; idx++) {
              const e12 = c.slice(0, idx+1).reduce((acc: number, val: number) => acc === 0 ? val : acc + (val - acc) * 2 / 13, 0)
              const e26 = c.slice(0, idx+1).reduce((acc: number, val: number) => acc === 0 ? val : acc + (val - acc) * 2 / 27, 0)
              const curDiff = e12 - e26
              deaAcc = idx === 0 ? curDiff : deaAcc + (curDiff - deaAcc) * 2 / 9
            }
            const macdBullish = diff > deaAcc
            const macdGoldenCross = macdBullish && diff > 0

            // 成交量结构
            const avgVol5 = v.slice(-5).reduce((a,b)=>a+b,0)/5
            const avgVol20 = v.length >= 20 ? v.slice(-20).reduce((a,b)=>a+b,0)/20 : avgVol5
            const volRatio = avgVol5 / (avgVol20 || 1)
            const volActive = Math.min(Math.max(volRatio, 0) * 6, 20)

            // 买入信号
            const sb = c.slice(-3).every((p,j) => p > o[o.length - 3 + j])
            const jcFlag = kl.slice(-2).every((x,j) => {
              const pc = j===0 ? c[c.length-3] : c[c.length-2]
              return x.h > Math.max(x.o, pc) && x.c > x.o
            })
            const strict = sb && v[v.length-1] > v[v.length-2]
            const shortBuy = sb || strict || jcFlag
            const strictBuy = strict
            const hasBuySignal = shortBuy || strictBuy || macdBullish

            // MA10下跌趋势判断
            const ma10TurnUp = ma10_1dAgo > 0 && ma10 >= ma10_1dAgo * 0.995

            // 深度洗盘
            const deepWashout = ma5 < ma10 && ma10TurnUp && lc > ma5 && volActive > 7

            // ─── port getTradingSuggestion ───
            const volumeBullish = volRatio > 1.2
            const strongBuy = (macdGoldenCross && volumeBullish) || (shortBuy && volumeBullish)

            let sug = '观望'
            // 低位区 <25%
            if (pp < 25) {
              if (trend >= 1 && strongBuy) sug = '重仓买入'
              else if (trend >= 1 && hasBuySignal) sug = '买入'
              else if (trend >= 1) sug = '持有'
              else sug = '观望'
            }
            // 中低位区 25-45%
            else if (pp < 45) {
              if (trend >= 2 && strongBuy) sug = '买入'
              else if (trend >= 2 && hasBuySignal) sug = '轻仓买入'
              else if (trend >= 1 && strongBuy) sug = '买入'
              else if (trend >= 1 && hasBuySignal) sug = '轻仓买入'
              else if (trend >= 2) sug = '持有'
              else sug = '观望'
            }
            // 中位区 45-55%
            else if (pp < 55) {
              if (trend >= 2 && strongBuy) sug = '买入'
              else if (trend >= 2 && hasBuySignal) sug = '轻仓买入'
              else if (trend >= 2) sug = '持有'
              else if (trend === 1 && (strongBuy || hasBuySignal)) sug = '持有'
              else sug = '观望'
            }
            // 中高位区 55-75%
            else if (pp < 75) {
              if (trend >= 2 && strongBuy) sug = '轻仓买入'
              else if (trend >= 2) sug = '持有'
              else if (trend === 1 && strongBuy) sug = '持有'
              else sug = '观望'
            }
            // 高位区 >=75%
            else {
              if (trend >= 2 && strongBuy) sug = '轻仓买入'
              else if (trend >= 2) sug = '持有'
              else if (trend === 1 && strongBuy) sug = '持有'
              else sug = '观望'
            }

            // 深度洗盘反转：MA5<MA10+MA10转头+站上5日线+量能活跃 → 轻仓买入
            if ((sug === '观望' || sug === '持有') && deepWashout) {
              sug = '轻仓买入'
            }

            return {c:s.c, n:s.n, p:s.p||0, cp:s.cp||0, curP:qm[s.c]?.p||s.p||0, sug, pp, trend, ma5, ma10}
          } catch(e) { return null }
        }))
        res.push(...rs.filter(Boolean))
        if (i % 600 === 0) setStatus(`🔄 分析中: ${res.length}/${wq.length}`)
      }
      const valid = res.filter(x => x && x.sug !== '观望')
      valid.sort((a, b) => {
        const pa = getActionPriority(a.sug), pb = getActionPriority(b.sug)
        return pa !== pb ? pa - pb : Math.abs(b.pp - 50) - Math.abs(a.pp - 50)
      })
      setStocks(valid.slice(0, 20))
      setStatus('✅ Top 20 已更新')
    } catch(e: any) { setStatus('❌ 失败: ' + (e.message||'未知错误')) }
    setLoading(false)
  }, [])

  useEffect(() => {
    const check = () => { const f = !isTH(); setFrozen(f); frozenR.current = f; setFmsg(freezeMsg()) }
    check(); const tt = setInterval(check, 60000)
    if (isTH()) setTimeout(() => scan(), 3000)
    intR.current = window.setInterval(() => { if (isTH()) scan() }, 600000)
    return () => { clearInterval(tt); if (intR.current) clearInterval(intR.current) }
  }, [scan])

  const hSearch = useCallback(async () => {
    if (!sc.trim()) return; setSr(null)
    try {
      const q = await fetchQ([sc.trim()]); const r = q[sc.trim()]
      if (!r) { setSr({error:'未找到'}); return }
      setSr({c:sc.trim(), p:r.p, cp:r.cp})
    } catch(e) { setSr({error:'查询失败'}) }
  }, [sc])

  return (
    <View className="flex flex-col h-full bg-gray-50">
      <View className="sticky top-0 bg-white z-10 px-3 py-2 border-b border-gray-100">
        <View className="flex flex-row items-center justify-between">
          <Text className="block text-base font-bold">A股优选 Top20</Text>
          <Text className="block text-xs text-gray-400">{status}</Text>
        </View>
        {fmsg ? <View className="mt-1 px-2 py-1 bg-yellow-50 rounded-lg border border-yellow-200"><Text className="block text-xs text-yellow-700">{fmsg}</Text></View> : null}
      </View>

      <View className="px-3 py-2 bg-white border-b border-gray-100">
        <View style={{display:'flex',flexDirection:'row',alignItems:'center',gap:'8px'}} className="bg-gray-50 rounded-lg px-3 py-2">
          <Search size={16} color="#999" />
          <View style={{flex:1}}><Input className="w-full text-xs bg-transparent" placeholder="输入代码搜索" value={sc}
            onInput={e => setSc(e.detail.value)} onConfirm={() => hSearch()}
          /></View>
          <Button className="bg-blue-500 text-white text-xs px-3 py-1 rounded-md"
            onClick={() => hSearch()}
          >
            <Text className="block text-xs">搜索</Text>
          </Button>
        </View>
        {sr ? (sr.error ? <Text className="block text-xs text-red-500 mt-1">{sr.error}</Text>
          : <View className="mt-1 px-2 py-1 bg-gray-50 rounded-lg"><Text className="block text-xs">{sr.c} ¥{sr.p} {(sr.cp||0)>=0?'+':''}{sr.cp}%</Text></View>
        ) : null}
      </View>

      <View className="px-3 py-1 flex flex-row gap-2">
        <Button className="bg-blue-500 text-white text-xs px-4 py-2 rounded-lg flex-1"
          onClick={() => { if (!frozenR.current) scan(); else Taro.showToast({title:'非交易时间',icon:'none'}) }}
          disabled={loading}
        >
          <Text className="block text-xs">{loading ? '扫描中...' : (frozen ? '📊 已冻结' : '🔄 立即扫描')}</Text>
        </Button>
      </View>

      <ScrollView className="flex-1 px-3" scrollY>
        <View className="py-2">
          <View className="flex flex-row items-center px-2 py-1 mb-1">
            <View style={{flex:1.1}}><Text className="block text-xs text-gray-400 font-medium">名称</Text></View>
            <View style={{flex:0.55}} className="text-center"><Text className="block text-xs text-gray-400">操作</Text></View>
            <View style={{flex:0.8}} className="text-center"><Text className="block text-xs text-gray-400">价格</Text></View>
            <View style={{flex:0.8}} className="text-center"><Text className="block text-xs text-gray-400">涨幅</Text></View>
            <View style={{flex:0.9}} className="text-right"><Text className="block text-xs text-gray-400">位置</Text></View>
          </View>

          {loading && stocks.length === 0 ? (
            <View className="flex flex-col gap-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="w-full h-12 rounded-xl" />)}</View>
          ) : stocks.length === 0 ? (
            <View className="flex items-center justify-center py-12"><Text className="block text-sm text-gray-400">{frozen ? fmsg : '点击上方按钮开始扫描'}</Text></View>
          ) : (
            <View className="flex flex-col gap-2">
              {stocks.map((item, idx) => (
                <Card key={item.c} className="overflow-hidden">
                  <CardContent className="p-2">
                    <View className="flex flex-row items-center">
                      <View style={{flex:1.1}}>
                        <View className="flex flex-row items-center gap-1">
                          <Badge className={'px-1 py-0 flex-shrink-0 ' + (idx < 3 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200')}>
                            <Text className="block text-xs">#{idx+1}</Text>
                          </Badge>
                          <View className="min-w-0 flex-1">
                            <Text className="block text-xs font-medium truncate">{item.n}</Text>
                            <Text className="block text-xs text-gray-400">{item.c}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{flex:0.55}} className="text-center">
                        <Text className="block text-xs text-white font-bold px-1 py-1 rounded-sm" style={{backgroundColor:ACTION_BADGE_COLOR[item.sug]??'#999'}}>{item.sug||'-'}</Text>
                      </View>
                      <View style={{flex:0.8}} className="text-center"><Text className="block text-xs font-medium">{item.curP?.toFixed(2)}</Text></View>
                      <View style={{flex:0.8}} className="text-center">
                        <Text className="block text-xs font-bold" style={{color:(item.cp??0)>=0?'#ef4444':'#22c55e'}}>{(item.cp??0)>=0?'+':''}{item.cp?.toFixed(2)}%</Text>
                      </View>
                      <View style={{flex:0.9}} className="text-right">
                        <Text className="block text-xs font-bold" style={{color:(item.pp??0)<50?'#22c55e':(item.pp??0)<80?'#eab308':'#ef4444'}}>位置{(item.pp??0).toFixed(0)}%</Text>
                      </View>
                    </View>
                  </CardContent>
                </Card>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <View className="bg-white px-3 py-2 border-t border-gray-100">
        <Text className="block text-xs text-gray-400">
          {loading ? '⏳ 扫描中...' : (frozen ? fmsg : stocks.length > 0 ? '✅ Top20 | 10分钟自动刷新' : '⏸️ 等待扫描')}
        </Text>
      </View>
    </View>
  )
}
