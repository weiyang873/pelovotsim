function sanitizeFilenameSegment(value, fallback = "export") {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export function formatExportTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export function downloadTxtFile(baseName, lines) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const content = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `${sanitizeFilenameSegment(baseName)}-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
