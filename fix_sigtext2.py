#!/usr/bin/env python3
with open('/workspace/projects/server/public/index.html','r') as f:
    content=f.read()

idx = content.find('  // 最佳介入点信号文本')
end_idx = content.find('  // 主力散户买卖点', idx)

old_block = content[idx:end_idx]
print(f"Old block length: {len(old_block)}")
print(f"Found at offset: {idx}")

new_block = '''  // 最佳介入点信号文本(根据实际买卖点数据生成实用提示)
  var sigText=''
  if(buyPrice!=='-'&&sellPrice!=='-'){
    if(lastPrice<=buyPrice*1.01)sigText='📈 现价可买入，建议价格 '+buyPrice.toFixed(2)+'（买入信号@'+buyPoint+'）'
    else if(lastPrice>=sellPrice*0.99)sigText='📉 目前是卖出点，建议卖出价格 '+sellPrice.toFixed(2)+'（卖出信号@'+sellPoint+'）'
    else sigText='⏳ 最佳介入 '+buyPrice.toFixed(2)+'（@'+buyPoint+'）→ 止盈 '+sellPrice.toFixed(2)+'（@'+sellPoint+'）'
  }else if(buyPrice!=='-'){
    if(lastPrice<=buyPrice*1.02)sigText='📈 出现买入信号 @'+buyPoint+'，现价 '+lastPrice.toFixed(2)+' ≤ 建议价 '+buyPrice.toFixed(2)+'，可介入'
    else sigText='📈 出现买入信号 @'+buyPoint+'，建议价 '+buyPrice.toFixed(2)+'，现价偏高等待回落'
  }else if(sellPrice!=='-'){
    if(lastPrice>=sellPrice*0.98)sigText='📉 出现卖出信号 @'+sellPoint+'，现价 '+lastPrice.toFixed(2)+' ≥ 建议价 '+sellPrice.toFixed(2)+'，可卖出'
    else sigText='📉 出现卖出信号 @'+sellPoint+'，建议价 '+sellPrice.toFixed(2)+'，等待反弹'
  }else{sigText='⏳ 暂无明确买卖信号，观望为主'}
'''

content = content[:idx] + new_block + content[end_idx:]
with open('/workspace/projects/server/public/index.html','w') as f:
    f.write(content)
print('Replaced successfully!')