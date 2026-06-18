#!/bin/bash
set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH}"
if [ -f "./.cozeproj/scripts/init_env.sh" ]; then
    echo "⚙️ Initializing environment..."
    # 使用 bash 执行，确保即使没有 x 权限也能跑
    bash ./.cozeproj/scripts/init_env.sh
else
    echo "⚠️ Warning: init_env.sh not found, skipping environment init."
fi
echo "Installing dependencies..."
# 安装所有依赖（包含 Taro 核心和 React）
pnpm install

echo "Building the Taro project (H5 frontend)..."
pnpm run build:web

echo "Building NestJS server..."
pnpm run build:server

echo "Copying frontend to serving directory..."
mkdir -p server/public
cp -r dist/* server/public/ 2>/dev/null || cp -r dist/h5/* server/public/ 2>/dev/null || true
rm -f build.log

echo "Build completed successfully!"
