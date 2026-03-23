// test-marketing-2min.js
// 运行方式：node test-marketing-2min.js
// 目标：2分钟内完成 Marketing 链路验收

const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = "http://127.0.0.1:8787";
const MAX_TOTAL_MS = 120000;

const TAG_CACHE_PATH = path.join(__dirname, "data", "tag_cache.json");
const SCORE_CACHE_PATH = path.join(__dirname, "data", "score_cache.json");

const TEST_STRATEGY = {
  market: "ToC",
  competitive: "差异化",
  segment: "老人",
  architecture: "体验",
  targetGm: 52.7
};

const TEST_VP_CANVAS = {
  customerJobs: "独居初老女性希望在家感受到陪伴和关怀，不想打扰忙碌的子女",
  pains: "一个人在家感到孤独，子女不在身边时遇到突发情况很害怕，不会用复杂的科技产品",
  gains: "感受到被理解和陪伴，家人放心，简单易用不需要学习",
  products: "陪伴型机器人，具备情感感知和自主移动能力",
  painRelievers: "主动靠近用户给予情感回应，紧急情况自动通知家人，操作极简",
  gainCreators: "记住用户的喜好和习惯，像老朋友一样陪伴，让家人随时了解状态"
};

const TEST_QUESTIONS = [
  "您平时一个人在家，会感到孤独吗？",
  "如果有一个机器人陪伴您，您最希望它能做什么？",
  "您需要它帮您监测健康状况吗，比如心率、血压这些？",
  "您希望它能在家里自己走动吗？",
  "您对它连接手机或者智能家居有兴趣吗？",
  "您女儿会希望通过它了解您的状态吗？"
];

function now() {
  return Date.now();
}

function readCacheCount(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const obj = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Object.keys(obj || {}).length;
  } catch (_) {
    return 0;
  }
}

async function request(pathname, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${pathname}`, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...options
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`API错误 ${pathname}: ${data.error || "unknown"}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateTags(tags) {
  assert(Array.isArray(tags), "tags 不是数组");
  assert(tags.length >= 8 && tags.length <= 12, `tags 数量异常: ${tags.length}`);
  tags.forEach((t, idx) => {
    assert(t && typeof t === "object", `tag[${idx}] 不是对象`);
    assert(typeof t.tag === "string" && t.tag.trim().length > 0, `tag[${idx}].tag 非法`);
    assert(["positive", "negative"].includes(t.polarity), `tag[${idx}].polarity 非法: ${t.polarity}`);
  });
}

function validateScores(scores, dimensions) {
  assert(scores && typeof scores === "object", "scores 非法");
  assert(Array.isArray(dimensions) && dimensions.length === 6, `dimensions 数量异常: ${dimensions?.length}`);
  dimensions.forEach((d) => {
    assert(typeof d.key === "string", "dimension.key 缺失");
    const v = Number(scores[d.key]);
    assert(Number.isFinite(v), `scores[${d.key}] 不是数字`);
    assert(v >= 0 && v <= 3, `scores[${d.key}] 超范围: ${v}`);
  });
}

function scoresEqual(a, b) {
  const keys = Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})])).sort();
  return keys.every((k) => Number(a[k]) === Number(b[k]));
}

async function main() {
  const startedAt = now();
  console.log("Marketing 2分钟验收脚本");
  console.log(`服务器: ${BASE_URL}`);

  const tagCacheBefore = readCacheCount(TAG_CACHE_PATH);
  const scoreCacheBefore = readCacheCount(SCORE_CACHE_PATH);

  console.log("\n[1/5] 创建 session + Persona");
  const startData = await request("/api/marketing/start", {
    method: "POST",
    body: JSON.stringify({
      teamKey: `test-team-${Date.now()}`,
      strategy: TEST_STRATEGY,
      vpCanvas: TEST_VP_CANVAS
    })
  });
  const sessionId = startData.sessionId;
  assert(typeof sessionId === "string" && sessionId.length > 10, "sessionId 非法");
  console.log(`  ✓ sessionId: ${sessionId}`);

  console.log("\n[2/5] 进行固定6轮访谈");
  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    await request("/api/marketing/interview", {
      method: "POST",
      body: JSON.stringify({ sessionId, message: TEST_QUESTIONS[i] })
    });
    console.log(`  ✓ round ${i + 1}/6`);
    assert(now() - startedAt < MAX_TOTAL_MS, "超时：超过2分钟");
  }

  console.log("\n[3/5] 第一次 end-interview");
  const t1 = now();
  const first = await request("/api/marketing/end-interview", {
    method: "POST",
    body: JSON.stringify({ sessionId })
  }, 45000);
  const dur1 = now() - t1;
  validateTags(first.tags);
  validateScores(first.scores, first.dimensions);
  console.log(`  ✓ tags: ${first.tags.length}`);
  console.log(`  ✓ 6维分数范围通过`);
  console.log(`  ✓ 耗时: ${dur1}ms`);

  const tagCacheAfter1 = readCacheCount(TAG_CACHE_PATH);
  const scoreCacheAfter1 = readCacheCount(SCORE_CACHE_PATH);

  console.log("\n[4/5] 第二次 end-interview（同session，验证稳定性/缓存）");
  const t2 = now();
  const second = await request("/api/marketing/end-interview", {
    method: "POST",
    body: JSON.stringify({ sessionId })
  }, 45000);
  const dur2 = now() - t2;
  validateTags(second.tags);
  validateScores(second.scores, second.dimensions);

  const stable = scoresEqual(first.scores, second.scores);
  assert(stable, "稳定性失败：两次分数不一致");
  console.log(`  ✓ 两次分数一致`);
  console.log(`  ✓ 第二次耗时: ${dur2}ms`);

  const tagCacheAfter2 = readCacheCount(TAG_CACHE_PATH);
  const scoreCacheAfter2 = readCacheCount(SCORE_CACHE_PATH);

  // 缓存判据：第二次不应新增缓存项；并且通常更快
  const noNewTagOnSecond = tagCacheAfter2 === tagCacheAfter1;
  const noNewScoreOnSecond = scoreCacheAfter2 === scoreCacheAfter1;

  console.log("\n[5/5] 缓存检查");
  console.log(`  tag_cache: ${tagCacheBefore} -> ${tagCacheAfter1} -> ${tagCacheAfter2}`);
  console.log(`  score_cache: ${scoreCacheBefore} -> ${scoreCacheAfter1} -> ${scoreCacheAfter2}`);
  console.log(`  second<=first: ${dur2 <= dur1 ? "YES" : "NO"} (${dur2}ms vs ${dur1}ms)`);

  assert(noNewTagOnSecond, "缓存失败：第二次 tag_cache 仍新增");
  assert(noNewScoreOnSecond, "缓存失败：第二次 score_cache 仍新增");

  const total = now() - startedAt;
  assert(total < MAX_TOTAL_MS, `总耗时超时: ${total}ms`);

  console.log("\n==================== 结果 ====================");
  console.log("✅ 标签提取正常（8-12个，含极性）");
  console.log("✅ 雷达图6维度分数正常（0-3）");
  console.log("✅ 稳定性通过（同样数据两次分数一致）");
  console.log("✅ 缓存生效（第二次未新增缓存项）");
  console.log(`✅ 总耗时: ${total}ms (< ${MAX_TOTAL_MS}ms)`);
}

main().catch((e) => {
  console.error("\n❌ 验收失败:", e.message);
  process.exit(1);
});
