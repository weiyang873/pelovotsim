"use strict";

const FORBIDDEN_PATTERNS = [
  { id: "target_gm", pattern: /target[_\s-]*gm|targetGm|目标毛利|毛利率底线|GM_cap|GM_FLOOR/i },
  { id: "wtp_scaled", pattern: /WTP(?:ref|adj)?_?scaled|WTPref|WTPadj|支付意愿.*\d|定价天花板/i },
  { id: "wtp_multiplier", pattern: /wtp[_\s-]*multiplier|multiplier|lambda_G|lambda_E|rho_C|rho折扣|客户定义清晰度/i },
  { id: "jinang_match_strength", pattern: /match[_\s-]*strength|契合度\s*\d|bonus|effect_at_full_match/i },
  { id: "card_cost_fields", pattern: /\bdCOGS\b|\brisk\b|\bsub_lift\b|\bload\b|\bnre\b|NRE|单位成本\s*[：:]\s*[+\-]?\d|研发投入\s*[：:]\s*\d/i },
  { id: "capacity_budget", pattern: /capacity_points|capacity_cap|budget_cap|budgetBenchmark|budget_pmax_ratio|预算惩罚|超预算惩罚|z_penalty|risk_add|penalty/i },
  { id: "machine_rules", pattern: /selection_constraints|hard_rules|then_requires|tier_in|min_tier|requires"\s*:|excludes"\s*:/i },
  { id: "internal_formula", pattern: /rho_C\s*\*|1\s*-\s*target|成本\s*÷|成本\s*\/|Pmax|COGSbase|WTPref_override/i }
];

const STAGE_ALLOWED_NUMBERS = {
  R1: new Set(["12", "3", "2"]),
  Coach: new Set([]),
  D3: new Set([]),
  D4: new Set(["1", "6"]),
  D5: new Set(["1000", "6000", "100"])
};

function stripSection(text, headingPattern) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (/^【/.test(line) && !headingPattern.test(line)) skipping = false;
    if (headingPattern.test(line)) {
      skipping = true;
      out.push(line.replace(/[0-9０-９]+/g, ""));
      continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

function stripWhitelistedSourceNumbers(promptText) {
  let text = String(promptText || "");
  text = stripSection(text, /【你的认知地图|【你的人生经验/);
  text = stripSection(text, /【累计决策栈|【你此前形成的目标-约束栈/);
  text = stripSection(text, /【D3 市场证据摘要|【D3 证据摘要/);
  text = stripSection(text, /【动态用户画像 summary|【动态用户画像|【用户画像 summary|【客户画像|【访谈素材/);
  text = stripSection(text, /【本轮随机锦囊|【随机锦囊/);
  return text;
}

function normalizeDigits(text) {
  return String(text || "").replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xFF10));
}

function findNumbers(text) {
  const normalized = normalizeDigits(text);
  const matches = [];
  const pattern = /(?<![A-Za-z_0-9])[-+]?\d+(?:\.\d+)?%?(?![A-Za-z_0-9])/g;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const raw = match[0];
    const before = normalized.slice(Math.max(0, match.index - 24), match.index);
    const after = normalized.slice(match.index + raw.length, match.index + raw.length + 24);
    matches.push({ raw, index: match.index, context: `${before}${raw}${after}`.trim() });
  }
  return matches;
}

function isAllowedNumber(raw, stage) {
  const value = String(raw || "").replace(/^[+\-]/, "").replace(/%$/, "");
  const allowed = STAGE_ALLOWED_NUMBERS[stage] || new Set();
  if (allowed.has(value)) return true;
  if (/^0+$/.test(value)) return true;
  return false;
}

function assertInfoSet(promptText, stage = "UNKNOWN") {
  const stripped = stripWhitelistedSourceNumbers(promptText);
  const forbiddenHits = FORBIDDEN_PATTERNS
    .filter((item) => item.pattern.test(stripped))
    .map((item) => item.id);
  if (forbiddenHits.length) {
    throw new Error(`info-set forbidden pattern in ${stage}: ${forbiddenHits.join(", ")}`);
  }

  const illegalNumbers = findNumbers(stripped)
    .filter((item) => !isAllowedNumber(item.raw, stage));
  if (illegalNumbers.length) {
    throw new Error(`info-set illegal numbers in ${stage}: ${illegalNumbers.slice(0, 8).map((item) => `${item.raw} [${item.context}]`).join("; ")}`);
  }
  return true;
}

module.exports = {
  FORBIDDEN_PATTERNS,
  STAGE_ALLOWED_NUMBERS,
  stripWhitelistedSourceNumbers,
  findNumbers,
  assertInfoSet
};
