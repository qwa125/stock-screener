#!/bin/bash
# 预扫描脚本：在构建时运行，缓存A股板块扫描数据
# 用法: bash pre-scan.sh

set -e
echo "============================================"
echo "  🔍 预扫描：缓存A股板块扫描数据..."
echo "============================================"

# 1. 启动 NestJS 服务
cd /workspace/projects
echo "📡 启动服务..."
node server/dist/main.js &
SERVER_PID=$!

# 2. 等待服务就绪
echo "⏳ 等待服务启动..."
for i in $(seq 1 30); do
  sleep 2
  if curl -s --max-time 3 http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ 服务已就绪 (PID: $SERVER_PID)"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ 服务启动超时"
    kill $SERVER_PID 2>/dev/null
    exit 1
  fi
done

# 3. 触发板块扫描（调用两个接口，让服务开始扫描）
echo "📊 触发板块扫描（最多等待90秒）..."
START_TIME=$(date +%s)

# 调用 sector/hot 触发扫描
curl -s --max-time 90 http://localhost:3000/api/sector/hot > /dev/null 2>&1
# 也触发创业板扫描
curl -s --max-time 90 http://localhost:3000/api/gem/opportunities > /dev/null 2>&1

END_TIME=$(date +%s)
echo "✅ 扫描完成，耗时 $((END_TIME - START_TIME)) 秒"

# 4. 检查/tmp缓存目录，复制缓存文件
echo "💾 保存缓存文件..."
mkdir -p /workspace/projects/server/assets
if [ -f /tmp/sector-cache.json ]; then
  cp /tmp/sector-cache.json /workspace/projects/server/assets/sector-cache.json
  echo "✅ 板块缓存已保存 ($(wc -c < /tmp/sector-cache.json) bytes)"
else
  echo "⚠️ 注意: 板块缓存文件未找到，跳过"
fi

# 保存创业板缓存
if [ -f /tmp/gem-opportunities-cache.json ]; then
  cp /tmp/gem-opportunities-cache.json /workspace/projects/server/assets/gem-cache.json
  echo "✅ 创业板缓存已保存 ($(wc -c < /tmp/gem-opportunities-cache.json) bytes)"
else
  echo "⚠️ 注意: 创业板缓存文件未找到，跳过"
fi

# 保存主板缓存
if [ -f /tmp/main-board-opportunities-cache.json ]; then
  cp /tmp/main-board-opportunities-cache.json /workspace/projects/server/assets/main-board-cache.json
  echo "✅ 主板缓存已保存 ($(wc -c < /tmp/main-board-opportunities-cache.json) bytes)"
else
  echo "⚠️ 注意: 主板缓存文件未找到，跳过"
fi

# 保存股票分析缓存
if [ -f /tmp/stock-analysis-cache.json ]; then
  cp /tmp/stock-analysis-cache.json /workspace/projects/server/assets/stock-analysis-cache.json
  echo "✅ 股票分析缓存已保存 ($(wc -c < /tmp/stock-analysis-cache.json) bytes)"
else
  echo "⚠️ 注意: 股票分析缓存文件未找到，跳过"
fi

# 5. 停止服务
echo "🛑 停止服务..."
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
echo "✅ 预扫描完成"