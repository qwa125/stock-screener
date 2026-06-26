const fs = require('fs');
let html = fs.readFileSync('/workspace/projects/server/public/index.html', 'utf8');

// 1. Add third fallback for price-only (no yc)
const oldEnd = "	    +'</div>'\n	  }\n\n	  // 详情说明";
const newEnd = 
  "	    +'</div>'" + '\n' +
  "	  }else if(rt.price){" + '\n' +
  '	    // ———— 最终降级：仅当前价格（无昨收） ————' + '\n' +
  '	    var cp=rt.price||s.price||0' + '\n' +
  "	    entryHtml+='<div style=\"margin:0 12px 8px;padding:10px 10px;background:#fff;border:1px solid #d1d5db;border-radius:8px;font-size:11px;line-height:1.6\">'" + '\n' +
  "	      +'<div style=\"font-weight:600;color:#6b7280;margin-bottom:6px\">📌 当前价格</div>'" + '\n' +
  "	      +'<div style=\"font-size:12px;color:#374151;margin-bottom:4px\">当前价: <span class=\\\"num-badge\\\">'+cp.toFixed(2)+'</span></div>'" + '\n' +
  "	      +'<div style=\"font-size:10px;color:#6b7280\">⏳ 实时数据加载中，将根据技术分析和昨收价自动评估当前位置</div>'" + '\n' +
  "	    +'</div>'" + '\n' +
  "	  }\n\n	  // 详情说明";

if (html.includes(oldEnd)) {
  html = html.replace(oldEnd, newEnd);
  console.log('✅ Fix 1 applied: added price-only fallback');
} else {
  console.log('❌ Fix 1 failed: pattern not found');
  // Try to find the actual pattern
  const idx = html.indexOf('// 详情说明');
  if (idx > 0) {
    console.log('  Found at index:', idx);
    console.log('  Context:', html.substring(idx-200, idx+50));
  }
}

fs.writeFileSync('/workspace/projects/server/public/index.html', html, 'utf8');
console.log('File saved');

// Verify
const lines = html.split('\n');
for (let i = 960; i <= 1000; i++) {
  if (lines[i]) console.log((i+1) + ': ' + lines[i]);
}