const base = process.env.BASE_URL || "http://127.0.0.1:8787";

async function req(path, payload, method = "POST") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) {
    throw new Error(`${path} failed: ${json.error || res.status}`);
  }
  return json;
}

async function main() {
  const decision_state = {
    customer_type: "ToC",
    strategy: "DIFF",
    age_group: "ADULT",
    arch_tag: "Experience",
    channels: [
      { name: "Direct", share: 0.5 },
      { name: "Ecommerce", share: 0.5 }
    ]
  };

  const created = await req("/api/round1/coach/session/create", {
    team_id: "smoke-team",
    team_name: "Smoke Team",
    decision_state,
    context_notes: "课堂 smoke test"
  });

  const s1 = await req("/api/round1/coach/session/send", {
    session_id: created.session_id,
    user_message: "我先选A方案，预算偏紧，优先降低首月流失。"
  });

  const s2 = await req("/api/round1/coach/session/send", {
    session_id: created.session_id,
    user_message: "CONTINUE_ITERATION"
  });

  const s3 = await req("/api/round1/coach/session/send", {
    session_id: created.session_id,
    user_message: "GENERATE"
  });

  const fetched = await fetch(`${base}/api/round1/coach/session/get?session_id=${encodeURIComponent(created.session_id)}`);
  const session = await fetched.json();
  if (!fetched.ok || session.ok === false) throw new Error("session/get failed");

  console.log(JSON.stringify({
    ok: true,
    session_id: created.session_id,
    first_mode: created.mode,
    second_mode: s1.mode,
    third_mode: s2.mode,
    generated_mode: s3.mode,
    message_count: session.session?.messages?.length || 0
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
