"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Engine = require("../../../engine");
const RD = require("../../llm/rdCalculator");
const vpWordScorer = require("../../llm/vpWordScorer");
const { chatCompletion } = require("../../llm/deepseekClient");
const { computeJinangWtpBonus, clamp01 } = require("../../multiplayer/jinangCoeff");
const { PERSONAS } = require("../../../scripts/sim/persona_pool");
const { parseSubmission, parseJsonLoose, GRID_IDS } = require("./submitParser");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CONFIG_DIR = path.join(ROOT, "game_config_v0.1");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_ROOT = path.join(DATA_DIR, "synthetic", "team_sim");

const GRID_OPTIONS = [
  { grid_id: "ToC_DIFF_CHILD", customer_type: "ToC", strategy: "DIFF", age: "CHILD", label: "ToC / 儿童 / 差异化" },
  { grid_id: "ToC_COST_CHILD", customer_type: "ToC", strategy: "COST", age: "CHILD", label: "ToC / 儿童 / 成本" },
  { grid_id: "ToB_DIFF_CHILD", customer_type: "ToB", strategy: "DIFF", age: "CHILD", label: "ToB / 儿童 / 差异化" },
  { grid_id: "ToB_COST_CHILD", customer_type: "ToB", strategy: "COST", age: "CHILD", label: "ToB / 儿童 / 成本" },
  { grid_id: "ToC_DIFF_ADULT", customer_type: "ToC", strategy: "DIFF", age: "ADULT", label: "ToC / 成人 / 差异化" },
  { grid_id: "ToC_COST_ADULT", customer_type: "ToC", strategy: "COST", age: "ADULT", label: "ToC / 成人 / 成本" },
  { grid_id: "ToB_DIFF_ADULT", customer_type: "ToB", strategy: "DIFF", age: "ADULT", label: "ToB / 成人 / 差异化" },
  { grid_id: "ToB_COST_ADULT", customer_type: "ToB", strategy: "COST", age: "ADULT", label: "ToB / 成人 / 成本" },
  { grid_id: "ToC_DIFF_ELDER", customer_type: "ToC", strategy: "DIFF", age: "ELDER", label: "ToC / 老人 / 差异化" },
  { grid_id: "ToC_COST_ELDER", customer_type: "ToC", strategy: "COST", age: "ELDER", label: "ToC / 老人 / 成本" },
  { grid_id: "ToB_DIFF_ELDER", customer_type: "ToB", strategy: "DIFF", age: "ELDER", label: "ToB / 老人 / 差异化" },
  { grid_id: "ToB_COST_ELDER", customer_type: "ToB", strategy: "COST", age: "ELDER", label: "ToB / 老人 / 成本" }
];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ synthetic: true, ...value }, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function makeRng(seedInput) {
  let state = crypto.createHash("sha256").update(String(seedInput)).digest().readUInt32LE(0);
  return function rng() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function requireConfigNumber(config, key) {
  const value = Number(config[key]);
  if (!Number.isFinite(value)) throw new Error(`team_sim_config.${key} must be finite`);
  return value;
}

function requireConfigArray(config, key) {
  const value = config[key];
  if (!Array.isArray(value)) throw new Error(`team_sim_config.${key} must be an array`);
  return value;
}

function getGrid(gridId) {
  const grid = GRID_OPTIONS.find((item) => item.grid_id === String(gridId).trim());
  if (!grid) throw new Error(`unknown grid_id: ${gridId}`);
  return grid;
}

function toGridPriorId(gridId) {
  const grid = getGrid(gridId);
  const channel = grid.customer_type === "ToB" ? "B2B" : "B2C";
  const strategy = grid.strategy === "DIFF" ? "Differentiation" : "Cost";
  const age = grid.age.charAt(0) + grid.age.slice(1).toLowerCase();
  return `${channel}_${strategy}_${age}`;
}

function toVpScorerGridId(gridId) {
  const grid = getGrid(gridId);
  const strategy = grid.strategy === "DIFF" ? "Differentiation" : "Cost";
  const age = grid.age.charAt(0) + grid.age.slice(1).toLowerCase();
  return `${grid.customer_type}_${strategy}_${age}`;
}

function mean(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sampleWithoutReplacement(items, count, rng) {
  if (count > items.length) throw new Error(`cannot sample ${count} from ${items.length}`);
  const copy = items.slice();
  const picked = [];
  while (picked.length < count) {
    const index = Math.floor(rng() * copy.length);
    picked.push(copy.splice(index, 1)[0]);
  }
  return picked;
}

function buildProfilePool(seed, outputDir) {
  const tendencies = ["high", "mid", "low"];
  const ids = Object.keys(PERSONAS).sort();
  const pool = [];
  for (const id of ids) {
    const base = PERSONAS[id];
    for (let i = 0; i < 5; i += 1) {
      pool.push({
        profile_id: `${id}-${String(i + 1).padStart(2, "0")}`,
        archetype_id: id,
        label: base.label,
        desc: base.desc,
        role: base.role,
        background: base.background,
        industry: base.industry,
        decisionStyle: base.decisionStyle,
        riskPreference: base.riskPreference,
        expressionStyle: base.expressionStyle,
        blindSpots: base.blindSpots,
        pricingBias: base.pricingBias,
        speaking_tendency: tendencies[(ids.indexOf(id) + i) % tendencies.length]
      });
    }
  }
  const filePath = path.join(outputDir, `profile_pool_${seed}.json`);
  writeJson(filePath, { seed, profiles: pool });
  return pool;
}

function sampleTeam(pool, seed, config) {
  const rng = makeRng(seed);
  const members = sampleWithoutReplacement(pool, requireConfigNumber(config, "team_size"), rng);
  const leaderIdx = Math.floor(rng() * members.length);
  return { members, leaderIdx, seed };
}

function drawJinangForMembers(members, seed, jinangConfig) {
  const rng = makeRng(`jinang:${seed}`);
  const marketCards = sampleWithoutReplacement(jinangConfig.market, members.length, rng);
  const techCards = sampleWithoutReplacement(jinangConfig.tech, members.length, rng);
  return members.map((member, index) => ({
    member_id: member.profile_id,
    market: marketCards[index],
    tech: techCards[index]
  }));
}

function formatProfile(member, isLeader) {
  return [
    `姓名代号：${member.profile_id}`,
    `原型：${member.label}（${member.desc}）`,
    `角色：${member.role}`,
    `行业经验：${member.industry}`,
    `背景：${member.background}`,
    `决策风格：${member.decisionStyle}`,
    `表达风格：${member.expressionStyle}`,
    `盲区：${member.blindSpots}`,
    `定价倾向：${member.pricingBias}`,
    `发言倾向：${member.speaking_tendency}`,
    isLeader ? "你是组长，负责推进讨论、总结共识并代表全队提交。" : "你是普通队员。"
  ].join("\n");
}

function formatJinang(draw) {
  return [
    `市场锦囊：${draw.market.name}。${draw.market.desc_for_player}`,
    `技术锦囊：${draw.tech.name}。${draw.tech.desc_for_player}`
  ].join("\n");
}

function formatTranscript(transcript) {
  if (!transcript.length) return "（暂无共享发言）";
  return transcript.map((item) => `${item.speaker}: ${item.text}`).join("\n");
}

function formatGroup(group) {
  return [
    `${group.name} (${group.group_id})`,
    ...group.capabilities.map((cap) => {
      const tiers = Object.keys(cap.tiers).map((tier) => `${tier}: ${cap.tiers[tier].dCOGS}元增量/${cap.tiers[tier].load}负载`).join("；");
      return `- ${cap.cap_id}｜${cap.name}｜覆盖=${cap.covers.join("、")}｜档位=${tiers}`;
    })
  ].join("\n");
}

async function callText(messages, options) {
  return chatCompletion(messages, {
    role: "chat_service",
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    timeoutMs: 90000,
    maxRetries: 2,
    disableThinking: true
  });
}

async function callJson(messages, options) {
  const raw = await callText(messages, options);
  return { raw, parsed: parseJsonLoose(raw) };
}

async function independentProposal(member, draw, isLeader, temperature) {
  const messages = [
    {
      role: "system",
      content: `${formatProfile(member, isLeader)}\n\n以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。`
    },
    {
      role: "user",
      content: `${formatJinang(draw)}\n\n你们要进入中国陪伴机器人市场。请先独立提出 Round 1 战略：12 格市场、架构标签、WHO/PAIN/HOW。自然语言说明理由，最后输出 JSON：{"grid_id":"...","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。`
    }
  ];
  const result = await callJson(messages, { temperature, maxTokens: 1500 });
  const parsed = await parseSubmission({
    text: JSON.stringify(result.parsed),
    decisionType: "r1",
    context: {},
    temperature
  });
  return { prompt: messages, raw: result.raw, parsed: parsed.parsed };
}

function strategicDistribution(proposals) {
  const counts = new Map();
  for (const proposal of proposals) {
    const key = `${proposal.parsed.grid_id}/${proposal.parsed.architecture}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = Array.from(counts.entries()).map(([key, count]) => `${key}: ${count}人`);
  return `【战略分布】${lines.join("；")}。这些只是选择结果，不含私人理由。`;
}

async function getWillingness(member, isLeader, transcript, topic, temperature) {
  const messages = [
    { role: "system", content: formatProfile(member, isLeader) },
    {
      role: "user",
      content: `当前议题：${topic}\n共享 transcript：\n${formatTranscript(transcript)}\n\n你现在有多想发言？0-10整数。只输出 JSON：{"willingness":数字}。`
    }
  ];
  try {
    const result = await callJson(messages, { temperature, maxTokens: 80 });
    const value = Math.max(0, Math.min(10, Math.round(Number(result.parsed.willingness))));
    if (Number.isFinite(value)) return { value, raw: result.raw, defaulted: false };
  } catch (error) {
    return { value: 5, raw: String(error.message), defaulted: true };
  }
  return { value: 5, raw: "non-finite willingness", defaulted: true };
}

function pickSpeakers(willingness, config, rng) {
  const min = Number(config.speakers_per_turn.min);
  const max = Number(config.speakers_per_turn.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("speakers_per_turn min/max required");
  const count = min + Math.floor(rng() * (max - min + 1));
  const pool = willingness.map((item) => ({ ...item }));
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = pool.reduce((sum, item) => sum + Math.max(0.1, item.weight), 0);
    let cursor = rng() * total;
    let chosen = 0;
    for (let i = 0; i < pool.length; i += 1) {
      cursor -= Math.max(0.1, pool[i].weight);
      if (cursor <= 0) {
        chosen = i;
        break;
      }
    }
    picked.push(pool.splice(chosen, 1)[0]);
  }
  return picked;
}

async function speak(member, isLeader, draw, privateProposal, transcript, topic, temperature) {
  const messages = [
    {
      role: "system",
      content: `${formatProfile(member, isLeader)}\n\n私有 context：\n${formatJinang(draw)}\n你的会前提案：${privateProposal.parsed.grid_id}/${privateProposal.parsed.architecture}，${privateProposal.parsed.rationale}`
    },
    {
      role: "user",
      content: `共享 transcript：\n${formatTranscript(transcript)}\n\n当前议题：${topic}\n请自然发言 2-4 句。只能说你愿意公开说出口的内容。若你改变立场，点名触发你的具体发言。`
    }
  ];
  const raw = await callText(messages, { temperature, maxTokens: 500 });
  return raw.trim();
}

async function moderatorCheck(transcript, topic, temperature) {
  const messages = [
    { role: "system", content: "你是团队模拟 moderator。只判断讨论是否已足够收敛，不给建议、不暗示正确答案。" },
    {
      role: "user",
      content: `当前议题：${topic}\n共享 transcript：\n${formatTranscript(transcript)}\n\n是否已经足够收敛，可以让组长提交？只输出 JSON：{"converged":true|false,"reason":"..."}。`
    }
  ];
  const result = await callJson(messages, { temperature: 0.2, maxTokens: 180 });
  return {
    converged: result.parsed.converged === true,
    reason: String(result.parsed.reason ?? "").trim(),
    raw: result.raw
  };
}

async function runDiscussion({ members, leaderIdx, draws, proposals, initialTranscript, topic, maxTurns, config, temperature, seed }) {
  const transcript = initialTranscript.slice();
  const rng = makeRng(`discussion:${seed}:${topic}`);
  const turns = [];
  let termination = "leader_decision";
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const willingness = [];
    for (let i = 0; i < members.length; i += 1) {
      const item = await getWillingness(members[i], i === leaderIdx, transcript, topic, temperature);
      const boosted = i === leaderIdx ? item.value * Number(config.leader_willingness_boost) : item.value;
      willingness.push({ index: i, value: item.value, weight: boosted, defaulted: item.defaulted });
    }
    const speakers = pickSpeakers(willingness, config, rng);
    const turnLog = { turn, willingness, speakers: [] };
    for (const speaker of speakers) {
      const i = speaker.index;
      const text = await speak(members[i], i === leaderIdx, draws[i], proposals[i], transcript, topic, temperature);
      const entry = { speaker: members[i].profile_id, text };
      transcript.push(entry);
      turnLog.speakers.push(entry);
    }
    const check = await moderatorCheck(transcript, topic, temperature);
    turnLog.moderator = check;
    turns.push(turnLog);
    if (check.converged) {
      termination = "converged";
      break;
    }
  }
  return { transcript, turns, termination };
}

async function leaderSubmit({ members, leaderIdx, transcript, topic, decisionType, context, temperature }) {
  const leader = members[leaderIdx];
  const messages = [
    { role: "system", content: formatProfile(leader, true) },
    {
      role: "user",
      content: `共享 transcript：\n${formatTranscript(transcript)}\n\n当前要提交：${topic}\n请基于共享 transcript 已经说出口的论据代表全队提交。不要引用私人 context。自然语言总结，必须给出明确最终选择。`
    }
  ];
  let lastText = await callText(messages, { temperature, maxTokens: 1000 });
  let lastError = "";
  const retries = Number(context.submitParseRetries);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const parsed = await parseSubmission({ text: lastText, decisionType, context, temperature });
      return { text: lastText, parsed: parsed.parsed, parse_raw: parsed.raw, attempts: attempt + 1 };
    } catch (error) {
      lastError = error.message;
      if (attempt >= retries) break;
      const repairMessages = [
        { role: "system", content: formatProfile(leader, true) },
        {
          role: "user",
          content: `你的上一次提交无法解析，原因：${lastError}\n请只修正最终提交，不引入新论据。\n上一次提交：\n${lastText}`
        }
      ];
      lastText = await callText(repairMessages, { temperature, maxTokens: 900 });
    }
  }
  throw new Error(`parse_failure: ${lastError}`);
}

function scoreMarketJinang(card, grid) {
  const weights = card.affinity_weights;
  return clamp01(mean([
    Number(weights.customer_type?.[grid.customer_type]),
    Number(weights.strategy?.[grid.strategy]),
    Number(weights.age?.[grid.age])
  ]));
}

function selectedR2Groups(architecture) {
  if (architecture === "Experience") return ["interaction_expression", "perception_understanding", "expand_connect"];
  if (architecture === "Function") return ["mobility_navigation", "safety_trust", "ops_maintenance"];
  return ["interaction_expression", "perception_understanding", "mobility_navigation", "safety_trust", "expand_connect", "ops_maintenance"];
}

function scoreTechJinang(card, grid, architecture) {
  const weights = card.affinity_weights;
  const groups = selectedR2Groups(architecture);
  const groupWeights = groups.map((group) => Number(weights.r2_groups?.[group])).filter((value) => Number.isFinite(value));
  return clamp01(mean([
    Number(weights.architecture?.[architecture]),
    Number(weights.strategy?.[grid.strategy]),
    groupWeights.length ? Math.max(...groupWeights) : NaN
  ]));
}

function settleTeamJinang(draws, grid, architecture) {
  const marketStrengths = draws.map((draw) => scoreMarketJinang(draw.market, grid));
  const techStrengths = draws.map((draw) => scoreTechJinang(draw.tech, grid, architecture));
  const marketStrength = mean(marketStrengths);
  const techStrength = mean(techStrengths);
  const marketMatched = marketStrength >= 0.5;
  const techMatched = techStrength >= 0.5;
  return {
    market: {
      match_strength: Number(marketStrength.toFixed(4)),
      matched: marketMatched,
      bonus: marketMatched ? computeJinangWtpBonus(marketStrength) : 0,
      member_strengths: marketStrengths.map((value) => Number(value.toFixed(4)))
    },
    tech: {
      match_strength: Number(techStrength.toFixed(4)),
      matched: techMatched,
      member_strengths: techStrengths.map((value) => Number(value.toFixed(4)))
    }
  };
}

function computeVpCompositeScore(C, G, E) {
  const c = Math.max(1, Math.min(5, Number(C)));
  const g = Math.max(1, Math.min(5, Number(G)));
  const e = Math.max(1, Math.min(5, Number(E)));
  return Math.min(5, Math.round(Math.sqrt(c * ((g + e) / 2)) * 10) / 10);
}

function buildRound1Outcome(r1Parsed, vpScores, jinangSettlement, round1Model) {
  const baseNoJinang = Engine.computeRound1V2(r1Parsed.grid_id, r1Parsed.architecture, vpScores, 0);
  const C = Number(vpScores.C);
  const G = Number(vpScores.G);
  const E = Number(vpScores.E);
  const vpEffectOnly = Number((Number(baseNoJinang.lambda_G) * Number(baseNoJinang.lambda_E) * Number(baseNoJinang.rho_C)).toFixed(4));
  const wtpMultiplier = Number((vpEffectOnly * (1 + Number(jinangSettlement.market.bonus))).toFixed(4));
  const compressedMult = RD.compressWtpMult(wtpMultiplier);
  const wtpRefRaw = Math.round(Number(baseNoJinang.WTPref));
  const wtpAdjCompressedRaw = Math.round(wtpRefRaw * compressedMult);
  const targetGm = Math.min(
    Number(round1Model.GM_cap),
    Number((Number(baseNoJinang.rho_C) * Number(round1Model.target_gm_suggest_multiplier)).toFixed(4))
  );
  return {
    ...baseNoJinang,
    grid_label: getGrid(r1Parsed.grid_id).label,
    C,
    G,
    E_raw: E,
    Eadj: E,
    VPscore: computeVpCompositeScore(C, G, E),
    WTPref: wtpRefRaw,
    WTPadj: wtpAdjCompressedRaw,
    WTPref_scaled: Math.round(wtpRefRaw * RD.PRICE_SCALE),
    WTPadj_scaled: Math.round(wtpAdjCompressedRaw * RD.PRICE_SCALE),
    wtp_vp_effect: vpEffectOnly,
    jinang_wtp_bonus: Number(jinangSettlement.market.bonus),
    wtp_multiplier: wtpMultiplier,
    wtp_mult_compressed: compressedMult,
    jinang_match_strength: jinangSettlement.market.matched ? jinangSettlement.market.match_strength : 0,
    jinang_settlement: jinangSettlement,
    target_gm: targetGm,
    target_gm_rule: "min(GM_cap, rho_C * target_gm_suggest_multiplier)"
  };
}

async function scoreVp(r1Parsed) {
  const fields = {
    who_raw: r1Parsed.vp_summary.who,
    pain_raw: r1Parsed.vp_summary.pain,
    how_raw: r1Parsed.vp_summary.how,
    boundary_raw: ""
  };
  const result = await vpWordScorer.scoreVpByWord(fields, toVpScorerGridId(r1Parsed.grid_id), r1Parsed.architecture);
  const scores = result.scores;
  if (!scores || !Number.isFinite(Number(scores.C)) || !Number.isFinite(Number(scores.G)) || !Number.isFinite(Number(scores.E))) {
    throw new Error("vpWordScorer returned invalid scores");
  }
  return {
    C: Number(scores.C),
    G: Number(scores.G),
    E: Number(scores.E),
    VPscore: Number(scores.VPscore),
    raw: result
  };
}

function summarizePrototype(archetype) {
  const seed = archetype.narrative_seed;
  return [
    `${archetype.id}: ${archetype.label}`,
    seed.person,
    seed.routine,
    `关键痛点：${seed.pain_points.join("；")}`,
    `标签：${archetype.tags.join("、")}`
  ].join("\n");
}

function prototypeSignals(archetype) {
  const evidence = archetype.dimension_evidence;
  return {
    radar: {
      perception: Number(evidence.perception.strength) * 10,
      mobility: Number(evidence.motion.strength) * 10,
      interaction: Number(evidence.interaction.strength) * 10,
      safety_privacy: Number(evidence.safety.strength) * 10,
      integration: Number(evidence.extend.strength) * 10,
      operations: Number(evidence.ops.strength) * 10
    },
    tags: archetype.tags,
    evi: Number(archetype.evi)
  };
}

function groupsById(capabilityGroups) {
  return new Map(capabilityGroups.groups.map((group) => [group.group_id, group]));
}

async function runR2Decision({ members, leaderIdx, draws, proposals, r1Frozen, config, materials, outputDir, seed }) {
  const temperature = requireConfigNumber(config, "temperature");
  const archetypes = materials.archetypes.archetypes;
  const prototypeTranscript = [
    {
      speaker: "moderator",
      text: `我们队 Round 1 正式结论：${r1Frozen.grid_label} / ${r1Frozen.architecture} / WHO=${r1Frozen.vp_summary.who}。请选择一个 R2 客户原型。\n\n${archetypes.map(summarizePrototype).join("\n\n")}`
    }
  ];
  const prototypeDiscussion = await runDiscussion({
    members,
    leaderIdx,
    draws,
    proposals,
    initialTranscript: prototypeTranscript,
    topic: "R2 客户原型选择：老人照护向或成人陪伴向",
    maxTurns: requireConfigNumber(config, "max_turns_r2_per_segment"),
    config,
    temperature,
    seed: `${seed}:prototype`
  });
  const submitContext = {
    submitParseRetries: requireConfigNumber(config, "submit_parse_retries")
  };
  const prototypeSubmit = await leaderSubmit({
    members,
    leaderIdx,
    transcript: prototypeDiscussion.transcript,
    topic: "提交 R2 客户原型",
    decisionType: "prototype",
    context: submitContext,
    temperature
  });
  const chosenPrototype = archetypes.find((item) => item.id === prototypeSubmit.parsed.prototype);
  if (!chosenPrototype) throw new Error(`prototype not found: ${prototypeSubmit.parsed.prototype}`);
  const checkpoints = [
    {
      decision_point: "prototype",
      termination: prototypeDiscussion.termination,
      turns: prototypeDiscussion.turns.length,
      frozen: prototypeSubmit.parsed
    }
  ];
  const r2Transcript = [{ decision_point: "prototype", transcript: prototypeDiscussion.transcript, turns: prototypeDiscussion.turns }];
  writeJson(path.join(outputDir, "r2_checkpoints.json"), { checkpoints });

  const selectedCards = [];
  const groupMap = groupsById(materials.capabilityGroups);
  const segments = requireConfigArray(config, "r2_card_segments");
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const groupText = segment.map((groupId) => {
      const group = groupMap.get(groupId);
      if (!group) throw new Error(`unknown capability group in config: ${groupId}`);
      return formatGroup(group);
    }).join("\n\n");
    const transcript = [
      {
        speaker: "moderator",
        text: `客户原型已冻结：${chosenPrototype.label}。当前只讨论这些功能区：${segment.join(", ")}。每个功能区恰好选 1 张卡。\n已选卡：${selectedCards.map((card) => `${card.cap_id}@${card.tier}`).join("、")}\n\n${groupText}`
      }
    ];
    const discussion = await runDiscussion({
      members,
      leaderIdx,
      draws,
      proposals,
      initialTranscript: transcript,
      topic: `R2 选卡段 ${segmentIndex + 1}: ${segment.join(", ")}`,
      maxTurns: requireConfigNumber(config, "max_turns_r2_per_segment"),
      config,
      temperature,
      seed: `${seed}:cards:${segmentIndex}`
    });
    const cardsSubmit = await leaderSubmit({
      members,
      leaderIdx,
      transcript: discussion.transcript,
      topic: `提交当前功能段选卡：${segment.join(", ")}；每个功能区恰好 1 张`,
      decisionType: "cards",
      context: {
        allowedGroups: segment,
        capabilityGroups: materials.capabilityGroups,
        submitParseRetries: requireConfigNumber(config, "submit_parse_retries")
      },
      temperature
    });
    selectedCards.push(...cardsSubmit.parsed.cards);
    const validation = RD.validateSelections(selectedCards);
    if (validation.hardViolationCount > 0 && segmentIndex === segments.length - 1) {
      throw new Error(`compat_violation: ${validation.violations.map((item) => item.message).join("; ")}`);
    }
    checkpoints.push({
      decision_point: `cards_segment_${segmentIndex + 1}`,
      termination: discussion.termination,
      turns: discussion.turns.length,
      frozen: cardsSubmit.parsed,
      cumulative_cards: selectedCards.slice(),
      compatibility: validation
    });
    r2Transcript.push({ decision_point: `cards_segment_${segmentIndex + 1}`, transcript: discussion.transcript, turns: discussion.turns });
    writeJson(path.join(outputDir, "r2_checkpoints.json"), { checkpoints });
  }

  const priceConfig = materials.round2Params.pricing_ui;
  const priceTranscript = [
    {
      speaker: "moderator",
      text: `客户原型：${chosenPrototype.label}。已选卡：${selectedCards.map((card) => `${card.cap_id}@${card.tier}`).join("、")}。Round 1 target_gm=${r1Frozen.target_gm}。请讨论最终定价，合法区间 ${priceConfig.price_min}-${priceConfig.price_max}。`
    }
  ];
  const priceDiscussion = await runDiscussion({
    members,
    leaderIdx,
    draws,
    proposals,
    initialTranscript: priceTranscript,
    topic: "R2 定价",
    maxTurns: requireConfigNumber(config, "max_turns_r2_per_segment"),
    config,
    temperature,
    seed: `${seed}:price`
  });
  const priceSubmit = await leaderSubmit({
    members,
    leaderIdx,
    transcript: priceDiscussion.transcript,
    topic: "提交最终定价",
    decisionType: "price",
    context: {
      priceMin: Number(priceConfig.price_min),
      priceMax: Number(priceConfig.price_max),
      submitParseRetries: requireConfigNumber(config, "submit_parse_retries")
    },
    temperature
  });
  checkpoints.push({
    decision_point: "price",
    termination: priceDiscussion.termination,
    turns: priceDiscussion.turns.length,
    frozen: priceSubmit.parsed
  });
  r2Transcript.push({ decision_point: "price", transcript: priceDiscussion.transcript, turns: priceDiscussion.turns });
  writeJson(path.join(outputDir, "r2_checkpoints.json"), { checkpoints });
  writeJson(path.join(outputDir, "r2_transcript.json"), { transcript: r2Transcript });

  const signals = prototypeSignals(chosenPrototype);
  const calcGridId = toGridPriorId(r1Frozen.grid_id);
  const rdInput = {
    gridId: calcGridId,
    engineGridId: r1Frozen.grid_id,
    round1GridId: r1Frozen.grid_id,
    round1Context: { gridId: r1Frozen.grid_id },
    selections: selectedCards,
    radar: signals.radar,
    tags: signals.tags,
    evi: signals.evi,
    P: priceSubmit.parsed.price,
    Pmax: Number(r1Frozen.WTPadj_scaled),
    WTPref_override: Number(r1Frozen.WTPref_scaled),
    WTP: Number(r1Frozen.WTPadj_scaled),
    e: 1.2,
    COGSbase: Number(RD.GLOBAL_PARAMS.V),
    wtp_multiplier: Number(r1Frozen.wtp_multiplier),
    source: "server/synthetic/teamSim/orchestrator.js"
  };
  const r2Settlement = await RD.calculate(rdInput);
  return {
    prototype: prototypeSubmit.parsed,
    cards: selectedCards,
    price: priceSubmit.parsed.price,
    rd_input: rdInput,
    settlement: r2Settlement,
    checkpoints,
    transcript: r2Transcript
  };
}

function loadMaterials() {
  return {
    config: readJson(path.join(CONFIG_DIR, "team_sim_config.json")),
    llmModels: readJson(path.join(CONFIG_DIR, "llm_models.json")),
    jinang: readJson(path.join(CONFIG_DIR, "jinang_cards_v2.json")),
    round1Model: readJson(path.join(CONFIG_DIR, "round1_gm_model.json")),
    round2Params: readJson(path.join(CONFIG_DIR, "round2_engine_params.json")),
    capabilityGroups: readJson(path.join(DATA_DIR, "capability_groups_v2.json")),
    archetypes: readJson(path.join(CONFIG_DIR, "persona_archetypes_v1.json"))
  };
}

async function runTeam({ seed, batch }) {
  const materials = loadMaterials();
  const config = materials.config;
  const teamId = `SYN-${batch}-${seed}`;
  const outputDir = path.join(OUTPUT_ROOT, batch, teamId);
  fs.mkdirSync(outputDir, { recursive: true });
  const profilePool = buildProfilePool(seed, outputDir);
  const sampled = sampleTeam(profilePool, seed, config);
  const draws = drawJinangForMembers(sampled.members, seed, materials.jinang);
  const leader = sampled.members[sampled.leaderIdx];
  const dimensionMap = materials.capabilityGroups.groups.map((group) => ({ group_id: group.group_id, name: group.name }));
  const meta = {
    batch,
    team_id: teamId,
    seed,
    profile_ids: sampled.members.map((member) => member.profile_id),
    leader_id: leader.profile_id,
    model_config: materials.llmModels,
    model_override: String(process.env.LLM_MODEL_OVERRIDE ?? ""),
    config_snapshot: config,
    dimension_key_mapping: dimensionMap,
    implementation_notes: [
      "profile_pool is built deterministically from scripts/sim/persona_pool.js manager archetypes, with synthetic speaking_tendency attached; no production route or DB is used.",
      "R1 discussion uses the shared transcript protocol and existing vpWordScorer for VP scoring; vpCoach is not used as a live moderator API because its exported chat loop is session/UI-shaped.",
      "R2 customer summaries use frozen game_config_v0.1/persona_archetypes_v1.json elder_care/adult_companion narrative seeds."
    ],
    file_sha256: {
      team_sim_config: sha256(fs.readFileSync(path.join(CONFIG_DIR, "team_sim_config.json"), "utf8")),
      capability_groups_v2: sha256(fs.readFileSync(path.join(DATA_DIR, "capability_groups_v2.json"), "utf8")),
      llm_models: sha256(fs.readFileSync(path.join(CONFIG_DIR, "llm_models.json"), "utf8"))
    }
  };
  writeJson(path.join(outputDir, "run_meta.json"), meta);

  const temperature = requireConfigNumber(config, "temperature");
  const proposals = [];
  for (let i = 0; i < sampled.members.length; i += 1) {
    proposals.push(await independentProposal(sampled.members[i], draws[i], i === sampled.leaderIdx, temperature));
  }
  const r1Initial = [{ speaker: "moderator", text: strategicDistribution(proposals) }];
  const r1Discussion = await runDiscussion({
    members: sampled.members,
    leaderIdx: sampled.leaderIdx,
    draws,
    proposals,
    initialTranscript: r1Initial,
    topic: "Round 1 市场定位、架构、VP 共识",
    maxTurns: requireConfigNumber(config, "max_turns_r1_discussion"),
    config,
    temperature,
    seed: `${seed}:r1`
  });
  const r1Submit = await leaderSubmit({
    members: sampled.members,
    leaderIdx: sampled.leaderIdx,
    transcript: r1Discussion.transcript,
    topic: "提交 Round 1 最终战略",
    decisionType: "r1",
    context: { submitParseRetries: requireConfigNumber(config, "submit_parse_retries") },
    temperature
  });
  const vpScores = await scoreVp(r1Submit.parsed);
  const grid = getGrid(r1Submit.parsed.grid_id);
  const jinangSettlement = settleTeamJinang(draws, grid, r1Submit.parsed.architecture);
  const r1Settlement = buildRound1Outcome(r1Submit.parsed, vpScores, jinangSettlement, materials.round1Model);
  const r1Frozen = {
    grid_id: r1Submit.parsed.grid_id,
    grid_label: grid.label,
    architecture: r1Submit.parsed.architecture,
    vp_summary: r1Submit.parsed.vp_summary,
    target_gm: r1Settlement.target_gm,
    jinang_fit: jinangSettlement,
    WTPref_scaled: r1Settlement.WTPref_scaled,
    WTPadj_scaled: r1Settlement.WTPadj_scaled,
    wtp_multiplier: r1Settlement.wtp_multiplier,
    VPscore: r1Settlement.VPscore
  };
  writeJson(path.join(outputDir, "r1_transcript.json"), {
    proposals,
    transcript: r1Discussion.transcript,
    turns: r1Discussion.turns,
    termination: r1Discussion.termination,
    leader_submit: r1Submit
  });
  writeJson(path.join(outputDir, "r1_frozen.json"), r1Frozen);

  const r2 = await runR2Decision({
    members: sampled.members,
    leaderIdx: sampled.leaderIdx,
    draws,
    proposals,
    r1Frozen,
    config,
    materials,
    outputDir,
    seed
  });
  writeJson(path.join(outputDir, "settlement.json"), {
    r1: r1Settlement,
    r1_frozen: r1Frozen,
    r2: r2.settlement,
    r2_price: r2.price,
    r2_cards: r2.cards,
    r2_prototype: r2.prototype,
    profit: r2.settlement.profit,
    profitable: Number(r2.settlement.profit) >= 0
  });
  return {
    synthetic: true,
    team_id: teamId,
    output_dir: outputDir,
    leader_id: leader.profile_id,
    profile_ids: sampled.members.map((member) => member.profile_id),
    r1: r1Frozen,
    r2_profit: r2.settlement.profit,
    r2_price: r2.price,
    r2_card_count: r2.cards.length
  };
}

module.exports = {
  runTeam,
  loadMaterials,
  buildProfilePool,
  sampleTeam
};
