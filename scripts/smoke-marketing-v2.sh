#!/usr/bin/env bash
# 2分钟验收脚本：Round2 Marketing V2（标签+embedding+雷达图）
# 用法：
#   chmod +x scripts/smoke-marketing-v2.sh
#   scripts/smoke-marketing-v2.sh
#
# 前置：
# 1) 已安装依赖: npm install @xenova/transformers
# 2) server.js 可启动
#
# 说明：
# - 这个脚本会在本机直接调用 API，不依赖浏览器
# - 重点验证：route 可用、访谈可跑、end-interview 返回 tags+scores+dimensions

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="${TMP_DIR:-/tmp/emba_marketing_smoke}"
mkdir -p "$TMP_DIR"

echo "== [0] 环境信息 =="
echo "ROOT_DIR=$ROOT_DIR"
echo "BASE_URL=$BASE_URL"
echo

echo "== [1] 健康检查 =="
curl -sS "$BASE_URL/api/health" > "$TMP_DIR/health.json"
cat "$TMP_DIR/health.json" | sed 's/.*/  &/'
echo

echo "== [2] 构造 start payload =="
cat > "$TMP_DIR/start_payload.json" <<'JSON'
{
  "teamKey": "smoke_team_v2",
  "strategy": {
    "market": "B2C",
    "competitive": "DIFF",
    "segment": "ADULT",
    "architecture": "Experience",
    "targetGm": 55.3
  },
  "vpCanvas": {
    "customerJobs": "下班后希望快速从紧绷状态切换到可放松状态",
    "pains": "回家后孤独焦虑，容易刷手机到很晚，第二天更疲惫",
    "gains": "能被及时回应，形成稳定的睡前放松习惯",
    "products": "具身陪伴机器人",
    "painRelievers": "通过贴近、眼神和声音互动降低情绪波动",
    "gainCreators": "把短互动做成每天可重复的微习惯"
  }
}
JSON
cat "$TMP_DIR/start_payload.json" | sed 's/.*/  &/'
echo

echo "== [3] 调用 /api/marketing/start =="
curl -sS -X POST "$BASE_URL/api/marketing/start" \
  -H "Content-Type: application/json" \
  --data @"$TMP_DIR/start_payload.json" > "$TMP_DIR/start_resp.json"

SESSION_ID="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$TMP_DIR/start_resp.json','utf8'));if(!j.ok||!j.sessionId){process.exit(2)};process.stdout.write(j.sessionId)")"
echo "  sessionId=$SESSION_ID"
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$TMP_DIR/start_resp.json','utf8'));console.log('  ok=',j.ok);console.log('  persona_preview=',String(j.persona||'').slice(0,120).replace(/\\n/g,' '));"
echo

echo "== [4] 连续发起3轮访谈 =="
for q in \
  "你通常在什么时刻最需要被陪伴？" \
  "你会担心这类机器人带来哪些麻烦？" \
  "如果它真的有帮助，你最先期待看到什么变化？"
do
  cat > "$TMP_DIR/interview_payload.json" <<JSON
{"sessionId":"$SESSION_ID","message":"$q"}
JSON
  curl -sS -X POST "$BASE_URL/api/marketing/interview" \
    -H "Content-Type: application/json" \
    --data @"$TMP_DIR/interview_payload.json" > "$TMP_DIR/interview_resp.json"
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$TMP_DIR/interview_resp.json','utf8'));if(!j.ok){process.exit(2)};console.log('  turn=',j.turnCount,' canEnd=',j.canEnd,' hint=',j.hint||'');console.log('  reply=',String(j.reply||'').slice(0,100).replace(/\\n/g,' '));"
done
echo

echo "== [5] 调用 /api/marketing/end-interview（核心） =="
cat > "$TMP_DIR/end_payload.json" <<JSON
{"sessionId":"$SESSION_ID"}
JSON
curl -sS -X POST "$BASE_URL/api/marketing/end-interview" \
  -H "Content-Type: application/json" \
  --data @"$TMP_DIR/end_payload.json" > "$TMP_DIR/end_resp.json"

echo "  原始响应已保存: $TMP_DIR/end_resp.json"

echo "== [6] 断言关键字段 =="
node <<'NODE'
const fs = require('fs');
const p = process.env.END_JSON || '/tmp/emba_marketing_smoke/end_resp.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

function fail(msg){ console.error('  ❌', msg); process.exit(2); }
function ok(msg){ console.log('  ✅', msg); }

if (!j.ok) fail('ok != true');
ok('ok=true');

if (!Array.isArray(j.tags)) fail('tags 不是数组');
if (j.tags.length < 8 || j.tags.length > 12) fail(`tags 数量不在 8-12，实际=${j.tags.length}`);
ok(`tags 数量=${j.tags.length}`);

if (!j.scores || typeof j.scores !== 'object') fail('scores 缺失或非对象');
const keys = Object.keys(j.scores);
if (keys.length !== 6) fail(`scores 维度数不是6，实际=${keys.length}`);
for (const k of keys) {
  const v = Number(j.scores[k]);
  if (!Number.isFinite(v) || v < 0 || v > 3) fail(`scores.${k} 不在 0..3，实际=${j.scores[k]}`);
}
ok('scores 六维且均在0..3');

if (!Array.isArray(j.dimensions) || j.dimensions.length !== 6) fail('dimensions 不是6项');
if (!j.dimensions.every(d => d && d.key && d.label_cn)) fail('dimensions 缺 key/label_cn');
ok('dimensions 含 key + label_cn');

if (!j.anchorVersion) fail('anchorVersion 缺失');
ok(`anchorVersion=${j.anchorVersion}`);

console.log('\n  tags=', j.tags.join('、'));
console.log('  scores=', JSON.stringify(j.scores));
NODE
echo

echo "== [7] 调用 /api/marketing/export/:sessionId =="
curl -sS "$BASE_URL/api/marketing/export/$SESSION_ID" > "$TMP_DIR/export.txt"
echo "  导出前10行："
head -n 10 "$TMP_DIR/export.txt" | sed 's/.*/  &/'
echo

echo "== [8] 结果 =="
echo "  ✅ API链路通过：start -> interview -> end-interview -> export"
echo "  ✅ 可继续在浏览器验证雷达图渲染（round2.html）"
echo
echo "完成。临时文件目录: $TMP_DIR"
