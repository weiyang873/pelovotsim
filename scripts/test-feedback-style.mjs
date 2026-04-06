import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { scoreVpText } = require("../server/llm/vpScorer");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const VP_TEXT = "为面临因老人孤独感导致退住风险增加和口碑下滑的高端私立养老院，提供能主动互动、吸引老人注意的机器人，以稳定入住率并减少人力安抚成本——而现有增加护工的方案成本高昂且难以规模化。";
const CELL_LABEL = "ToB·差异·老人";
const ARCHITECTURE_LABEL = "体验型";

function loadLocalEnvFile() {
  const envPath = path.resolve(SCRIPT_DIR, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function printSection(title, value) {
  console.log(`\n[${title}]`);
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function checkFeedback(feedback) {
  const text = String(feedback || "");
  const issues = [];
  const warnings = [];

  if (text.includes("C=") || text.includes("G=") || text.includes("E=")) {
    issues.push("包含评分字母或数值标记（C=/G=/E=）");
  }

  if (text.includes("已经写出") || text.includes("也已交代") || text.includes("对应关系")) {
    issues.push("包含禁用的打勾式表述");
  }

  if (!text.includes("你们")) {
    issues.push("没有使用“你们”称呼");
  }

  if (text.length < 100 || text.length > 300) {
    warnings.push(`长度为 ${text.length}，超出 100-300 的检查范围`);
  }

  return {
    status: issues.length === 0 ? "PASS" : "FAIL",
    issues,
    warnings
  };
}

async function main() {
  loadLocalEnvFile();

  const result = await scoreVpText(VP_TEXT, CELL_LABEL, ARCHITECTURE_LABEL);
  const feedback = String(result?.feedback || "");
  const checks = checkFeedback(feedback);

  printSection("scores", result?.scores || null);
  printSection("features", result?.features || null);
  printSection("feedback", feedback);

  console.log("\n[checks]");
  if (checks.status === "PASS") {
    console.log("PASS");
  } else {
    console.log("FAIL");
  }

  for (const issue of checks.issues) {
    console.log(`FAIL: ${issue}`);
  }
  for (const warning of checks.warnings) {
    console.log(`WARN: ${warning}`);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
