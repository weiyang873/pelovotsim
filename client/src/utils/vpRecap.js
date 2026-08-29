const SEGMENTS = [
  ["who", "目标客户"],
  ["pain", "核心痛点"],
  ["how", "解决方式"],
  ["boundary", "适用边界"]
];

const EMPTY_VALUES = new Set(["", "未明确", "未填写", "无", "-", "—"]);

function strip(value) {
  return String(value || "").trim().replace(/[。．.！!？?；;，,、\s]+$/g, "").trim();
}

export function buildVpRecapSentence(summary, fallbackText) {
  const src = summary && typeof summary === "object" ? summary : {};

  const parts = [];
  for (const [key, label] of SEGMENTS) {
    const value = strip(src[key]);
    if (!value || EMPTY_VALUES.has(value)) continue;
    parts.push(`${label}：${value}`);
  }

  const hasCore = ["who", "pain", "how"].every((key) => {
    const value = strip(src[key]);
    return value && !EMPTY_VALUES.has(value);
  });
  if (hasCore) return parts.join("｜");

  const raw = String(fallbackText || "").trim();
  if (!raw) return "未生成最终价值主张。";
  return raw.replace(/\s+/g, " ").trim();
}
