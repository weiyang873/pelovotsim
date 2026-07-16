function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatWan(value, options = {}) {
  const n = toFiniteNumber(value);
  if (n == null) return options.fallback || "—";
  return `${n.toLocaleString("zh-CN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}万`;
}

export function formatYuan(value, options = {}) {
  const n = toFiniteNumber(value);
  if (n == null) return options.fallback || "—";
  return `¥${Math.round(n).toLocaleString("zh-CN")}`;
}

export function formatSignedYuan(value, options = {}) {
  const n = toFiniteNumber(value);
  if (n == null) return options.fallback || "—";
  if (Math.round(n) === 0) return formatYuan(0, options);
  return `${n > 0 ? "+" : "-"}${formatYuan(Math.abs(n), options)}`;
}

export function formatWanFromYuan(value, options = {}) {
  const n = toFiniteNumber(value);
  if (n == null) return options.fallback || "—";
  return formatWan(n / 10000, options);
}
