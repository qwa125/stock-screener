with open('server/public/index.html', 'r') as f:
    content = f.read()

# Insert zhuliSanhu display after buy/sell section, before 挂单参考
old = "  html+='</div></div>'\n  // 挂单参考"

new = """  html+='</div></div>'
  // 主力散户
  if(zs&&(zs.main!=null||zs.sg||zs.signal)){
    var zsVal=zs.main||0, zsRetail=zs.retail||0, zsStatus=zs.status||(zsVal>zsRetail?'主力强势':'主力弱势')
    html+='<div style="margin-top:4px;padding:5px 0;border-top:1px dashed #e5e7eb;font-size:12px">'
    html+='<span style="color:#6b7280;font-size:10px">\U0001f4ca 主力散户动向</span>'
    html+='<div style="display:flex;justify-content:space-between;margin-top:2px">'
    html+='<span style="color:#1f2937">主力 <span style="font-weight:600;color:'+(zsVal>0?'#ef4444':'#22c55e')+'">'+(zsVal>0?'+':'')+zsVal.toFixed(1)+'</span></span>'
    html+='<span style="color:#1f2937">散户 <span style="font-weight:600;color:'+(zsRetail>0?'#22c55e':'#ef4444')+'">'+(zsRetail>0?'+':'')+zsRetail.toFixed(1)+'</span></span>'
    html+='<span style="font-weight:600;color:'+(zsVal>zsRetail?'#ef4444':'#22c55e')+'">'+zsStatus+'</span>'
    html+='</div></div>'
  }
  // 挂单参考"""

if old in content:
    content = content.replace(old, new, 1)
    with open('server/public/index.html', 'w') as f:
        f.write(content)
    print('Replaced successfully')
else:
    print('NOT FOUND')