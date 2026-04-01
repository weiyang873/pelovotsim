#!/bin/bash
# run-e2e.sh — 一键跑 E2E 全流程测试
# 用法:
#   bash run-e2e.sh              # 打线上（默认）
#   bash run-e2e.sh local        # 打本地 localhost:3000
#   bash run-e2e.sh r1           # 只跑 Round 1
#   bash run-e2e.sh r2           # 只跑 Round 2
#   bash run-e2e.sh headed       # 有头模式（看浏览器）
#   bash run-e2e.sh r1 headed    # Round 1 + 有头模式（可组合）

set -euo pipefail

# ── 颜色 ──
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── 解析参数 ──
TARGET="live"
SCOPE=""
HEADED=""

for arg in "$@"; do
  case "$arg" in
    local)  TARGET="local" ;;
    r1)     SCOPE="round1-full-flow" ;;
    r2)     SCOPE="round2-full-flow" ;;
    full)   SCOPE="full-simulation" ;;
    stable) SCOPE="stability-repeat" ;;
    headed) HEADED="--headed" ;;
    *)      echo -e "${RED}未知参数: $arg${NC}"; exit 1 ;;
  esac
done

if [ "$TARGET" = "local" ]; then
  export TEST_URL="http://localhost:3000"
  echo -e "${YELLOW}🎯 目标: localhost:3000${NC}"
else
  export TEST_URL="https://app.praxisengine.xyz"
  echo -e "${YELLOW}🎯 目标: app.praxisengine.xyz (线上)${NC}"
fi

# ── 清理上次残留 ──
echo -e "${YELLOW}🧹 清理旧报告...${NC}"
rm -rf playwright-report test-results

# ── 检查 Playwright 是否安装 ──
if ! npx playwright --version &>/dev/null; then
  echo -e "${YELLOW}📦 安装 Playwright...${NC}"
  npm install -D @playwright/test
  npx playwright install chromium
fi

# ── 构建 Playwright 命令 ──
CMD="npx playwright test --workers=1 $HEADED"
if [ -n "$SCOPE" ]; then
  CMD="$CMD $SCOPE"
fi

# ── 运行 ──
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
echo -e "${YELLOW}🚀 开始测试 [$TIMESTAMP]${NC}"
echo -e "${YELLOW}   命令: $CMD${NC}"
echo ""

if $CMD; then
  echo ""
  echo -e "${GREEN}✅ 全部通过！${NC}"
  EXIT_CODE=0
else
  echo ""
  echo -e "${RED}❌ 有测试失败${NC}"
  EXIT_CODE=1
fi

# ── 报告 ──
echo ""
echo -e "${YELLOW}📊 报告:${NC}"
echo "   HTML 报告: npx playwright show-report"
if [ -d "tests/e2e/reports" ]; then
  LATEST=$(ls -t tests/e2e/reports/*.json 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    echo "   JSON 诊断: $LATEST"
  fi
fi

# ── 失败时自动打开报告 ──
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo -e "${YELLOW}自动打开 HTML 报告...${NC}"
  npx playwright show-report &
fi

exit $EXIT_CODE
