#!/usr/bin/env python3
with open('/workspace/projects/server/public/index.html','r') as f:
    content=f.read()

old = (
    '  // 最佳介入点信号文本(根据实际买卖点数据生成实用提示)\n'
    '  var sigText=\'\'\n'
    '  if(buyPrice!==\'-\'&&sellPrice!==\'-\'){\n'
    '    if(lastPrice<=buyPrice*1.01)sigText=\'\uD83D\uDCC8 现价可买入，建议价格 \'+buyPrice.toFixed(2)\n'
    '    else if(lastPrice>=sellPrice*0.99)sigText=\'\uD83D\uDCC9 目前是卖出点，建议卖出价格 \'+sellPrice.toFixed(2)\n'
    '    else sigText=\'\u23F3 目前不是最佳介入点，最佳介入价格 \'+buyPrice.toFixed(2)+\'，建议卖出价格 \'+sellPrice.toFixed(2)\n'
    '  }else if(buyPrice!==\'-\'){\n'
    '    if(lastPrice<=buyPrice*1.02)sigText=\'\uD83D\uDCC8 现价能买入，建议价格 \'+buyPrice.toFixed(2)\n'
    '    else sigText=\'\u23F3 目前不是最佳介入点，最佳介入价格 \'+buyPrice.toFixed(2)\n'
    '  }else if(sellPrice!==\'-\'){\n'
    '    if(lastPrice>=sellPrice*0.98)sigText=\'\uD83D\uDCC9 目前是卖出点，建议卖出价格 \'+sellPrice.toFixed(2)\n'
    '    else sigText=\'\u23F3 目前不是最佳卖出点，建议卖出价格 \'+sellPrice.toFixed(2)\n'
    '  }else{sigText=\'\u23F3 暂无明确买卖信号，观望为主\'}'
)

new = (
    '  // 最佳介入点信号文本(根据实际买卖点数据生成实用提示)\n'
    '  var sigText=\'\'\n'
    '  if(buyPrice!==\'-\'&&sellPrice!==\'-\'){\n'
    '    if(lastPrice<=buyPrice*1.01)sigText=\'\uD83D\uDCC8 现价可买入，建议价格 \'+buyPrice.toFixed(2)+\'（买入信号@\'+buyPoint+\'）\'\n'
    '    else if(lastPrice>=sellPrice*0.99)sigText=\'\uD83D\uDCC9 目前是卖出点，建议卖出价格 \'+sellPrice.toFixed(2)+\'（卖出信号@\'+sellPoint+\'）\'\n'
    '    else sigText=\'\u23F3 最佳介入 \'+buyPrice.toFixed(2)+\'（@\'+buyPoint+\'）\u2192 止盈 \'+sellPrice.toFixed(2)+\'（@\'+sellPoint+\'）\'\n'
    '  }else if(buyPrice!==\'-\'){\n'
    '    if(lastPrice<=buyPrice*1.02)sigText=\'\uD83D\uDCC8 出现买入信号 @\'+buyPoint+\'，现价 \'+lastPrice.toFixed(2)+\' \u2264 建议价 \'+buyPrice.toFixed(2)+\'，可介入\'\n'
    '    else sigText=\'\uD83D\uDCC8 出现买入信号 @\'+buyPoint+\'，建议价 \'+buyPrice.toFixed(2)+\'，现价偏高等待回落\'\n'
    '  }else if(sellPrice!==\'-\'){\n'
    '    if(lastPrice>=sellPrice*0.98)sigText=\'\uD83D\uDCC9 出现卖出信号 @\'+sellPoint+\'，现价 \'+lastPrice.toFixed(2)+\' \u2265 建议价 \'+sellPrice.toFixed(2)+\'，可卖出\'\n'
    '    else sigText=\'\uD83D\uDCC9 出现卖出信号 @\'+sellPoint+\'，建议价 \'+sellPrice.toFixed(2)+\'，等待反弹\'\n'
    '  }else{sigText=\'\u23F3 暂无明确买卖信号，观望为主\'}'
)

count = content.count(old)
print(f'old string found: {count} time(s)')
if count > 0:
    content = content.replace(old, new)
    with open('/workspace/projects/server/public/index.html','w') as f:
        f.write(content)
    print('Replaced successfully')
else:
    print('Not found')
    idx = content.find('最佳介入点信号文本')
    print(f'offset={idx}')
    print(repr(content[idx:idx+450]))