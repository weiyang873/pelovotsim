const BASE = "/api";

async function asJson(res) {
  const data = await res.json();
  if (data.ok === false && data.error) throw new Error(data.error);
  return data;
}

export async function getRdCards(options = {}) {
  const res = await fetch(`${BASE}/rd/cards`, options);
  return asJson(res);
}

export async function validateRd(payload) {
  const res = await fetch(`${BASE}/rd/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function calculateRd(payload) {
  const res = await fetch(`${BASE}/rd/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function previewRdPrice(payload) {
  const res = await fetch(`${BASE}/rd/preview-price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}
