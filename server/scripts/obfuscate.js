/**
 * 公式代码混淆脚本
 * 对核心公式引擎和规则文件进行混淆保护
 * 仅在构建后执行，不影响开发调试
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 核心公式文件列表（按保护优先级排序）
const CORE_FILES = [
  'modules/stock/formula-engine.js',
  'modules/stock/bai-san-jiao.js',
  'modules/stock/bai-ling-xing.js',
  'modules/stock/bai-xing.js',
  'modules/stock/xing-xing.js',
  'modules/stock/rule-engine.js',
  'modules/stock/data-fetcher.service.js',
  'modules/stock/stock.service.js',
];

const distDir = path.resolve(__dirname, '../dist');

// 混淆配置 - 平衡保护强度与性能
const OBFUSCATOR_OPTIONS = {
  compact: true,                    // 压缩代码
  controlFlowFlattening: true,       // 控制流扁平化（增加逆向难度）
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,          // 不注入死代码（避免体积膨胀过大）
  debugProtection: false,            // 不阻止调试（生产环境可改为true）
  disableConsoleOutput: false,       // 保留console.log（调试需要）
  identifierNamesGenerator: 'hexadecimal',  // 变量名改为十六进制
  renameGlobals: false,              // 不改全局变量名（避免破坏框架）
  rotateStringArray: true,
  selfDefending: false,              // 不自防卫（避免潜在兼容问题）
  shuffleStringArray: true,
  splitStrings: false,               // 不分字符串（保持可读性同时降低性能影响）
  stringArray: true,
  stringArrayThreshold: 0.5,
  target: 'node',                    // Node.js 环境
  transformObjectKeys: false,
  unicodeEscapeSequence: false,      // 不转义Unicode（保持中文字符可读）
};

let successCount = 0;
let failCount = 0;

CORE_FILES.forEach(relativePath => {
  const filePath = path.join(distDir, relativePath);
  
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  文件不存在，跳过: ${relativePath}`);
    failCount++;
    return;
  }
  
  try {
    const originalCode = fs.readFileSync(filePath, 'utf-8');
    
    // 跳过过小的文件（可能是空壳文件）
    if (originalCode.length < 100) {
      console.warn(`⚠️  文件过小，跳过: ${relativePath} (${originalCode.length} bytes)`);
      failCount++;
      return;
    }
    
    const result = JavaScriptObfuscator.obfuscate(originalCode, OBFUSCATOR_OPTIONS);
    fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf-8');
    
    const originalSize = (originalCode.length / 1024).toFixed(1);
    const obfuscatedSize = (result.getObfuscatedCode().length / 1024).toFixed(1);
    console.log(`✅ 已混淆: ${relativePath} (${originalSize}KB → ${obfuscatedSize}KB)`);
    successCount++;
  } catch (err) {
    console.error(`❌ 混淆失败: ${relativePath} - ${err.message}`);
    failCount++;
  }
});

console.log(`\n📊 混淆完成: ${successCount} 个成功, ${failCount} 个失败`);

// 删除所有 .d.ts 类型声明文件（暴露接口和类型信息）
console.log('\n🗑️  正在删除类型声明文件 (.d.ts)...');
let dtsCount = 0;
function deleteDts(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      deleteDts(fullPath);
    } else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.ts.map')) {
      fs.unlinkSync(fullPath);
      dtsCount++;
    }
  }
}
deleteDts(distDir);
console.log(`🗑️  已删除 ${dtsCount} 个类型声明文件`);