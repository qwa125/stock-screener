with open('/workspace/projects/server/public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

old = '\t  html+=\'<div style="display:flex;justify-content:space-between;border-top:1px dashed #e5e7eb;padding-top:6px;margin-top:4px">\'\n\t  html+=\'<div style="display:flex;flex-direction:column;align-items:flex-start"><span style="color:#ef4444;font-weight:600;font-size:11px">\u2b06 \u4e70\u5165\u70b9 \'+(buyPrice!==\'-\'?buyPoint:\'\u6682\u65e0\u4fe1\u53f7\')+\'</span><span style="color:#dc2626;font-weight:700;font-size:14px">\'+(buyPrice!==\'-\'?Number(buyPrice).toFixed(2):\'\')+\'</span></div>\'\n\t  html+=\'<div style="display:flex;flex-direction:column;align-items:flex-end"><span style="color:#22c55e;font-weight:600;font-size:11px">\u2b07 \u5356\u51fa\u70b9 \'+(sellPrice!==\'-\'?sellPoint:\'\u6682\u65e0\u4fe1\u53f7\')+\'</span><span style="color:#16a34a;font-weight:700;font-size:14px">\'+(sellPrice!==\'-\'?Number(sellPrice).toFixed(2):\'\')+\'</span></div>\'\n\t  html+=\'</div></div>\''

new = '\t  // \u2014\u2014\u2014 \u5168\u90e8\u4fe1\u53f7\u5217\u8868 \u2014\u2014\u2014\n\t  var buyList=sugs.filter(function(s){return s.type===\'\u4e70\u5165\u70b9\'||s.type===\'\u4e70\u5165\'})\n\t  var sellList=sugs.filter(function(s){return s.type===\'\u5356\u51fa\u70b9\'||s.type===\'\u5356\u51fa\'})\n\t  html+=\'<div style="border-top:1px dashed #e5e7eb;padding-top:6px;margin-top:4px">\'\n\t  if(buyList.length>0){\n\t    html+=\'<div style="margin-bottom:2px"><span style="color:#ef4444;font-weight:600;font-size:11px">\u2b06 \u4e70\u5165\u70b9(\'+buyList.length+\'\u4e2a)</span></div>\'\n\t    for(var bi=0;bi<buyList.length;bi++){\n\t      var b=buyList[bi]\n\t      html+=\'<div style="display:flex;justify-content:space-between;padding:1px 0;font-size:12px;line-height:1.6">\'\n\t      html+=\'<span style="color:#6b7280">\'+b.time+\'</span>\'\n\t      html+=\'<span style="color:#dc2626;font-weight:400">\'+b.price.toFixed(2)+\'</span>\'\n\t      html+=\'</div>\'\n\t    }\n\t  }else{\n\t    html+=\'<div style="margin-bottom:2px"><span style="color:#ef4444;font-weight:600;font-size:11px">\u2b06 \u4e70\u5165\u70b9</span> <span style="color:#9ca3af;font-size:11px">\u6682\u65e0\u4fe1\u53f7</span></div>\'\n\t  }\n\t  if(sellList.length>0){\n\t    html+=\'<div style="margin-top:4px;margin-bottom:2px"><span style="color:#22c55e;font-weight:600;font-size:11px">\u2b07 \u5356\u51fa\u70b9(\'+sellList.length+\'\u4e2a)</span></div>\'\n\t    for(var si=0;si<sellList.length;si++){\n\t      var s=sellList[si]\n\t      html+=\'<div style="display:flex;justify-content:space-between;padding:1px 0;font-size:12px;line-height:1.6">\'\n\t      html+=\'<span style="color:#6b7280">\'+s.time+\'</span>\'\n\t      html+=\'<span style="color:#16a34a;font-weight:400">\'+s.price.toFixed(2)+\'</span>\'\n\t      html+=\'</div>\'\n\t    }\n\t  }else{\n\t    html+=\'<div style="margin-top:4px;margin-bottom:2px"><span style="color:#22c55e;font-weight:600;font-size:11px">\u2b07 \u5356\u51fa\u70b9</span> <span style="color:#9ca3af;font-size:11px">\u6682\u65e0\u4fe1\u53f7</span></div>\'\n\t  }\n\t  html+=\'</div></div>\''

count = content.count(old)
print(f'Old string found: {count}')
if count > 0:
    content = content.replace(old, new)
    with open('/workspace/projects/server/public/index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Replaced successfully')
else:
    # Try to find it differently
    import re
    # Look for the key line fragment
    idx = content.find('买入点 '+(buyPrice')
    if idx >= 0:
        print(f'Found at {idx}')
        print(repr(content[idx:idx+50]))
    else:
        # Try the emoji characters
        for emoji in ['⬆ 买入点', '⬇ 卖出点']:
            pos = content.find(emoji)
            if pos >= 0:
                print(f'Found "{emoji}" at {pos}')
                print(repr(content[pos-10:pos+80]))