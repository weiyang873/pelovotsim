export function buildVpRecapSentence(summary, fallbackText) {
  const src = summary && typeof summary === "object" ? summary : {};
  const strip = (value) => String(value || "").trim().replace(/[。．.！!？?；;，,、\s]+$/g, "").trim();
  const who = strip(src.who);
  const pain = strip(src.pain);
  const how = strip(src.how);
  const boundary = strip(src.boundary);

  if (who && pain && how) {
    let sentence = `为${who}，在${pain}的场景下，这款 AI 宠物机器人通过${how}创造更好的结果。`;
    if (boundary && boundary !== "未明确") {
      sentence += ` 适用边界：${boundary}。`;
    }
    return sentence;
  }

  const raw = String(fallbackText || "").trim();
  if (!raw) return "未生成最终价值主张。";
  return raw.replace(/\s+/g, " ").trim();
}
