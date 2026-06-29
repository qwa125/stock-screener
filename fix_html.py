#!/usr/bin/env python3
import sys

with open('server/public/index.html','r',encoding='utf-8') as f:
    content=f.read()

# Fix A
old_a = '  // 统一日内介入参考主框\n  entryHtml=\'<div style="margin:0 12px 8px;padding:10px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:11px;line-height:1.6">\'\n    +\'<div style="font-weight:600;color:#166534;margin-bottom:6px">🕐 日内介入参考</div>\'\n    +\'<div id="intradayMacd" style="padding:8px;background:#f8fafc;border-radius:6px;font-size:12px;text-align:center;color:#6b7280">⏳ 日内数据加载中...</div>\''

new_a = (
    '  // 非交易时段：用缓存数据直接渲染价格条，不依赖异步 refreshDetailPrice\n'
    '  var _pl=s.intradayLow||0,_ph=s.intradayHigh||0,_pp=s.currentPrice||0\n'
    '  var initMacdHtml=_pl>0&&_ph>0&&_pl<_ph&&_pp>0\n'
    '    ? \'<div style="padding:4px 0;font-size:10px;text-align:left">\'\n'
    '        +\'<div style="display:flex;align-items:center;gap:4px">\'\n'
    '          +\'<span style="color:#22c55e;min-width:36px;text-align:right;font-size:10px">\'+_pl.toFixed(2)+\'</span>\'\n'
    '          +\'<div style="flex:1;height:4px;background:#e5e7eb;border-radius:2px;position:relative;overflow:visible">\'\n'
    '            +\'<div style="position:absolute;left:\'+(((_pp-_pl)/(_ph-_pl)*100).toFixed(1))+\';top:-3px;width:10px;height:10px;background:#3b82f6;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>\'\n'
    '          +\'</div>\'\n'
    '          +\'<span style="color:#ef4444;min-width:36px;font-size:10px">\'+_ph.toFixed(2)+\'</span>\'\n'
    '        +\'</div>\'\n'
    '        +\'<div style="color:#6b7280;text-align:center;font-size:9px;margin-top:1px">当前 \'+_pp.toFixed(2)+\'  — 实时数据加载完成后更新</div>\'\n'
    '      +\'</div>\'\n'
    '    : \'⏳ 日内数据加载中...\'\n'
    '  // 统一日内介入参考主框\n'
    '  entryHtml=\'<div style="margin:0 12px 8px;padding:10px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:11px;line-height:1.6">\'\n'
    '    +\'<div style="font-weight:600;color:#166534;margin-bottom:6px">🕐 日内介入参考</div>\'\n'
    '    +\'<div id="intradayMacd" style="padding:4px 8px;background:#f8fafc;border-radius:6px;font-size:12px;text-align:center;color:#6b7280">\'+initMacdHtml+\'</div>\''
)

if old_a in content:
    content = content.replace(old_a, new_a, 1)
    print("Fix A applied successfully")
else:
    print("Fix A FAILED!")
    idx = content.find('统一日内介入参考主框')
    if idx >= 0:
        s = content[idx:idx+250]
        print("Found:", repr(s))

# Fix B
old_b = '        +\'<span style="font-size:15px;font-weight:700;color:#16a34a">\'+(ta.bestEntryPrice!==undefined?ta.bestEntryPrice.toFixed(2):\'-\')+\'</span>\'\n        +\'<span style="font-size:10px;color:#6b7280">⬇ 支撑 \'+(ta.supportLevel!==undefined?ta.supportLevel.toFixed(2):\'-\')+\' | ⬆ 压力 \'+(ta.resistanceLevel!==undefined?ta.resistanceLevel.toFixed(2):\'-\')+\'</span>\''

new_b = '        +\'<span style="font-size:15px;font-weight:700;color:#16a34a">\'+(ta.bestEntryPrice!==undefined?ta.bestEntryPrice.toFixed(2):(s.currentPrice?s.currentPrice.toFixed(2):\'-\'))+\'</span>\'\n        +\'<span style="font-size:10px;color:#6b7280">⬇ 支撑 \'+(ta.supportLevel!==undefined?ta.supportLevel.toFixed(2):(s.intradayLow?parseFloat(s.intradayLow).toFixed(2):\'-\'))+\' | ⬆ 压力 \'+(ta.resistanceLevel!==undefined?ta.resistanceLevel.toFixed(2):(s.intradayHigh?parseFloat(s.intradayHigh).toFixed(2):\'-\'))+\'</span>\''

if old_b in content:
    content = content.replace(old_b, new_b, 1)
    print("Fix B applied successfully")
else:
    print("Fix B FAILED!")
    import re
    for m in re.finditer(r'bestEntryPrice', content):
        s = max(0, m.start()-30)
        e = min(len(content), m.end()+100)
        print("Found:", repr(content[s:e]))

with open('server/public/index.html','w',encoding='utf-8') as f:
    f.write(content)
print("Done")