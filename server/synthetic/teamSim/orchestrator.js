"use strict";

const fs = require("node:fs");

let cachedRepoGitState = null;
function repoGitState() {
  if (cachedRepoGitState) return cachedRepoGitState;
  try {
    const { execSync } = require("node:child_process");
    const opts = { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] };
    const commit = execSync("git rev-parse HEAD", opts).toString().trim();
    const dirtyTracked = execSync("git status --porcelain -uno", opts).toString().trim().length > 0;
    cachedRepoGitState = { commit, dirty_tracked_files: dirtyTracked };
  } catch (error) {
    cachedRepoGitState = { commit: null, dirty_tracked_files: null };
  }
  return cachedRepoGitState;
}
const path = require("node:path");
const crypto = require("node:crypto");
const RD = require("../../llm/rdCalculator");
const TeamRoutes = require("../../routes/teamRoutes");
const vpWordScorer = require("../../llm/vpWordScorer");
const { chatCompletion } = require("../../llm/deepseekClient");
const { computeJinangWtpBonus, clamp01 } = require("../../multiplayer/jinangCoeff");
const { scaleStoredMoney } = require("../../multiplayer/moneyScale");
const { assignDimensions, mergeTeamSelections } = require("../../multiplayer/rdTeamAdapter");
const { PERSONAS } = require("../../../scripts/sim/persona_pool");
const { parseSubmission, parseJsonLoose, validateParsed, GRID_IDS } = require("./submitParser");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CONFIG_DIR = path.join(ROOT, "game_config_v0.1");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_ROOT = path.join(DATA_DIR, "synthetic", "team_sim");
const RANDOM42_POOL_PATH = path.join(DATA_DIR, "persona_pool_random42_interface_v1", "persona_pool_v2.json");
const LAYERED_NOMAP_GENERATION_SEED = 20260806;
const TEAM_ARMS = new Set(["legacy", "simple", "layered", "layered_nomap", "team_layered_nomap", "team_room_roleplay_ui", "team_room_pricing_action_actor_v1", "team_room_roleplay_stateful_v1", "team_room_roleplay_stateful_review_v1", "team_room_d4_human_pick_v1", "team_room_d4_stateful_pick_v1", "team_room_d4_stateful_d5_nosubmit_v1", "team_room_story_d4_v1", "team_room_story_d4d5_v1", "team_room_story_d4d5_narrator_d5_v1", "team_room_story_r1_d4d5_narrator_v1", "team_room_r1_private_trace_v1", "team_room_r1_story_process_v1", "team_room_r1_reading_story_v1", "team_room_r1_screenplay_v1", "team_room_r1_actor_isolated_v1"]);
let round2RoutesModule = null;
let round2RouteTestHelpers = null;

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

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({ synthetic: true, ...value })}\n`);
}

function getRound2Routes() {
  if (!round2RoutesModule) {
    round2RoutesModule = require("../../routes/round2Routes");
  }
  return round2RoutesModule;
}

function getRound2RouteTestHelpers() {
  if (!round2RouteTestHelpers) {
    const round2Routes = getRound2Routes();
    round2RouteTestHelpers = round2Routes.__test || {};
  }
  return round2RouteTestHelpers;
}

function toProductionCalcGridId(gridId, architecture) {
  const round2Routes = getRound2Routes();
  return typeof round2Routes.toCalcGridId === "function"
    ? round2Routes.toCalcGridId(gridId, architecture || "")
    : toGridPriorId(gridId);
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

function seededPick(items, seedText) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  const digest = crypto.createHash("sha256").update(String(seedText)).digest("hex");
  const index = parseInt(digest.slice(0, 8), 16) % list.length;
  return list[index];
}

function educationBand(education) {
  const value = String(education || "");
  if (/博士|MBA|海归硕士|海外硕士|985|211/u.test(value)) return "high";
  if (/本科|硕士/u.test(value)) return "medium";
  if (/高中|中专|大专/u.test(value)) return "low";
  return "medium";
}

function seedMemoryToText(seed) {
  const memory = seed && typeof seed === "object" ? seed : {};
  return [
    String(memory.backstory || "").trim(),
    `做决策的习惯：${String(memory.decision_habit || "").trim()}`,
    `讨论风格：${String(memory.discussion_style || "").trim()}`,
    `自信区：${String(memory.confidence_zone || "").trim()}`,
    `盲区：${String(memory.blind_zone || "").trim()}`,
    `压力下的反应：${String(memory.under_pressure || "").trim()}`,
    `口头禅/说话习惯：${String(memory.pet_phrases || "").trim()}`
  ].filter(Boolean).join("\n");
}

function buildLayeredSeedMemory(member) {
  const baseSeed = `${LAYERED_NOMAP_GENERATION_SEED}:team:L0:${member.profile_id}`;
  return {
    backstory: `${member.background || member.role || "有多年行业经验"}；现在以${member.role || "企业管理者"}身份来读 EMBA，希望把自己的经验迁移到 AI 宠物机器人这类新业务。`,
    decision_habit: `${member.decisionStyle || "先凭经验判断，再看数据验证。"}遇到不确定时，会先回到自己熟悉的行业和组织经验里找类比。`,
    discussion_style: `${member.expressionStyle || "讨论时会带着明显个人风格。"}课堂讨论中${seededPick(["会先抛观点再补理由", "会先听一轮再抓关键点回应", "会把问题拉回落地和资源约束", "会用自己熟悉的案例解释判断"], `${baseSeed}:discussion`)}。`,
    confidence_zone: `${member.industry || "自己熟悉的行业"}、渠道打法、组织资源和真实客户场景里的判断最有把握。`,
    blind_zone: `${member.blindSpots || "对陌生领域容易忽略或回避。"}在 AI 机器人、能力卡组合和用户研究细节上容易带入既有经验。`,
    under_pressure: seededPick([
      "时间紧时会先做一个能讲得通的选择，再把细节留到后面修。",
      "时间紧时会把问题简化成资源、客户和回款三件事。",
      "时间紧时会优先选择自己能解释清楚、能管得住风险的方案。",
      "时间紧时会抓一个最像既有业务的路径，避免过度发散。"
    ], `${baseSeed}:pressure`),
    pet_phrases: seededPick([
      "先把这个事落到具体人群上。",
      "不能光听着高级，要能卖得出去。",
      "这个逻辑要闭环。",
      "我先按自己的经验判断。"
    ], `${baseSeed}:phrase`)
  };
}

function buildLayeredClassroomProfile(member, seedMemory) {
  const baseSeed = `${LAYERED_NOMAP_GENERATION_SEED}:team:L1:${member.profile_id}`;
  const band = educationBand(member.surface?.edu || member.education);
  const abstractionAbility = band === "high" ? "high" : band === "low" ? "low" : "medium";
  const writingPrecision = band === "low" ? "low" : seededPick(["medium", "high"], `${baseSeed}:writing`);
  return {
    abstraction_ability: abstractionAbility,
    writing_precision: writingPrecision,
    coach_receptiveness: seededPick(["medium", "medium", "high", "low"], `${baseSeed}:coach`),
    effort_style: seededPick(["认真打磨", "先交差后面改", "先交差后面改", "依赖队友"], `${baseSeed}:effort`),
    team_role: seededPick(["主导", "质疑", "跟随", "调停"], `${baseSeed}:role`),
    why_here: `希望把${member.industry || "既有行业"}经验系统化，并借课堂判断 AI 宠物机器人是否能形成新增长点。`,
    knowledge_ceiling: seedMemory.blind_zone || "在陌生领域的市场定位与用户研究容易停留在直觉层面。",
    response_to_AI_coach: seededPick([
      "会先看建议是否实用，能落地就采纳，太虚就保留意见。",
      "会接受能帮他收敛目标用户和能力配置的反馈，但会抵触纯框架化表达。",
      "会把 AI Coach 当成提醒清单，最终仍按自己的行业经验拍板。",
      "会认真吸收结构化建议，但会要求它解释清楚为什么能赚钱。"
    ], `${baseSeed}:ai_coach`)
  };
}

function attachLayeredNoMap(member) {
  const seedMemory = buildLayeredSeedMemory(member);
  const classroomProfile = buildLayeredClassroomProfile(member, seedMemory);
  return {
    ...member,
    layered_nomap_generation: {
      seed: LAYERED_NOMAP_GENERATION_SEED,
      l0_seed: `${LAYERED_NOMAP_GENERATION_SEED}:team:L0:${member.profile_id}`,
      l1_seed: `${LAYERED_NOMAP_GENERATION_SEED}:team:L1:${member.profile_id}`,
      generation_method: "deterministic_seeded_L0_L1_from_frozen_random42_surface_and_archetype_fields",
      map_policy: "no cognitive map injected"
    },
    seedMemory,
    classroomProfile,
    layeredSystemPrompt: [
      seedMemoryToText(seedMemory),
      "",
      "## 课堂行为画像",
      JSON.stringify(classroomProfile, null, 2)
    ].join("\n")
  };
}

function attachBehavioralNarrative(member) {
  const narrative = member.narrative_profile || {};
  const structural = member.structural_profile || {};
  return {
    ...member,
    seedMemory: {
      backstory: narrative.life_sketch || `${structural.current_role || "企业管理者"}，正在读高管项目。`,
      decision_habit: narrative.decision_habit || "会按自己的经历形成判断。",
      discussion_style: narrative.speaking_texture || "说话有自己的生活质感。",
      confidence_zone: structural.industry ? `${structural.industry}里的真实经营场景。` : "自己亲手经历过的经营场景。",
      blind_zone: narrative.blind_spot || "陌生场景里容易被过去的经验牵着走。",
      under_pressure: narrative.uncertainty_style || "压力下会回到熟悉的判断方式。",
      pet_phrases: narrative.speaking_texture || ""
    },
    classroomProfile: {
      abstraction_ability: "narrative",
      writing_precision: "narrative",
      coach_receptiveness: "narrative",
      effort_style: narrative.classroom_state || "",
      team_role: "",
      why_here: structural.why_ceibs_qualified || "希望把真实经营经验放进课堂里重新校准。",
      knowledge_ceiling: narrative.blind_spot || "",
      response_to_AI_coach: narrative.updating_style || ""
    },
    layered_nomap_generation: {
      seed: member.persona_pool_record?.seed || "",
      generation_method: "behavioral_fingerprint_to_narrative_profile; no A-G prototype fields",
      map_policy: "no cognitive map injected"
    },
    layeredSystemPrompt: [
      "## 人物小传",
      narrative.life_sketch || "",
      "",
      "## 成功和失败留下的痕迹",
      narrative.success_episode ? `成功经历：${narrative.success_episode}` : "",
      narrative.failure_episode ? `失败经历：${narrative.failure_episode}` : "",
      narrative.money_pressure ? `当前压力：${narrative.money_pressure}` : "",
      narrative.face_pressure ? `面子压力：${narrative.face_pressure}` : "",
      "",
      "## 课堂状态",
      narrative.classroom_state || "",
      "",
      "## 决策和讨论方式",
      narrative.decision_habit ? `搜索/停手：${narrative.decision_habit}` : "",
      narrative.updating_style ? `听反对意见：${narrative.updating_style}` : "",
      narrative.uncertainty_style ? `不确定性处理：${narrative.uncertainty_style}` : "",
      narrative.time_horizon ? `时间权衡：${narrative.time_horizon}` : "",
      narrative.action_style ? `执行方式：${narrative.action_style}` : "",
      narrative.speaking_texture ? `说话质感：${narrative.speaking_texture}` : "",
      narrative.blind_spot ? `盲区：${narrative.blind_spot}` : "",
      "",
      "重要：你不是社会原型标签；你是这段经历长出来的具体人。"
    ].filter(Boolean).join("\n")
  };
}

function attachCareerGeneralProfile(member) {
  const record = member.persona_pool_record || {};
  const profile = record.general_profile || {};
  const current = record.current_position || {};
  const family = record.family_life || {};
  return {
    ...member,
    seedMemory: {
      backstory: record.career_narrative || "",
      decision_habit: profile.information_search_and_stopping || "",
      discussion_style: profile.communication_style || "",
      confidence_zone: profile.professional_identity || "",
      blind_zone: profile.blind_spots || "",
      under_pressure: profile.stress_pattern || "",
      pet_phrases: ""
    },
    classroomProfile: {
      abstraction_ability: "general_profile",
      writing_precision: "general_profile",
      coach_receptiveness: "general_profile",
      effort_style: "",
      team_role: "",
      why_here: record.why_executive_program_qualified || "",
      knowledge_ceiling: profile.blind_spots || "",
      response_to_AI_coach: profile.belief_updating || ""
    },
    layered_nomap_generation: {
      seed: record.seed || "",
      generation_method: "demographic_seed_to_coherent_career_history_then_general_profile",
      map_policy: "no cognitive map injected"
    },
    layeredSystemPrompt: [
      "## 职业主线",
      record.career_narrative || "",
      "",
      "## 当前岗位镜头",
      current.role ? `当前岗位：${current.role}` : "",
      current.industry ? `行业：${current.industry}` : "",
      current.primary_function ? `主要职能：${current.primary_function}` : "",
      current.company_context ? `公司处境：${current.company_context}` : "",
      current.management_scope ? `管理责任：${current.management_scope}` : "",
      current.customers_and_stakeholders ? `日常面对的人：${current.customers_and_stakeholders}` : "",
      current.operating_metrics ? `熟悉指标：${current.operating_metrics}` : "",
      "",
      "## 家庭与代际生活",
      family.household_snapshot ? `家庭结构：${family.household_snapshot}` : "",
      family.household_rhythm ? `家庭节奏：${family.household_rhythm}` : "",
      family.concrete_experiences ? `亲历过的事情：${family.concrete_experiences}` : "",
      family.family_experience_narrative || "",
      family.family_experience_narrative
        ? "这些只是你生活中真实发生过的事。看到相关人群时，它们可能被想起，也可能没有；不要机械地因为家里有某类人就选择某个市场。"
        : "",
      "",
      "## General profiling",
      profile.professional_identity ? `职业身份：${profile.professional_identity}` : "",
      profile.core_motives ? `长期驱动力：${profile.core_motives}` : "",
      profile.self_concept_and_status ? `自我理解和地位感：${profile.self_concept_and_status}` : "",
      profile.information_search_and_stopping ? `搜索和停手：${profile.information_search_and_stopping}` : "",
      profile.cognitive_effort ? `思考投入：${profile.cognitive_effort}` : "",
      profile.belief_updating ? `听异议和改判断：${profile.belief_updating}` : "",
      profile.risk_posture ? `风险取向：${profile.risk_posture}` : "",
      profile.ambiguity_response ? `面对信息不足：${profile.ambiguity_response}` : "",
      profile.goal_regulation ? `目标编码：${profile.goal_regulation}` : "",
      profile.time_orientation ? `时间权衡：${profile.time_orientation}` : "",
      profile.action_and_recovery ? `行动和恢复：${profile.action_and_recovery}` : "",
      profile.interpersonal_and_power_style ? `人际和权力风格：${profile.interpersonal_and_power_style}` : "",
      profile.communication_style ? `说话方式：${profile.communication_style}` : "",
      profile.stress_pattern ? `压力下：${profile.stress_pattern}` : "",
      profile.internal_contradictions ? `内在矛盾：${profile.internal_contradictions}` : "",
      profile.blind_spots ? `盲区：${profile.blind_spots}` : "",
      "",
      "重要：职业经历只是你理解世界的镜头。面对界面时按这个人的自然反应作答，不要复述人物档案，也不要把自己变成管理顾问。"
    ].filter(Boolean).join("\n")
  };
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

function loadRandom42ProfilePool(poolPath = RANDOM42_POOL_PATH) {
  const records = readJson(poolPath);
  if (!Array.isArray(records) || records.length < 1) {
    throw new Error(`random42 persona pool must be a non-empty array: ${path.relative(ROOT, poolPath)}`);
  }
  return records.map((record, index) => {
    if (isTaskBlindNarrativeRecord(record)) {
      const surface = record.surface || {};
      const facts = record.frozen_facts || {};
      // NO SILENT FALLBACKS: a task-blind persona missing any required attribute is a data
      // error to be fixed at the pool, never papered over with a default that flattens 42
      // people into one. Fail loudly with the persona id and field name.
      const requireFact = (key) => {
        const value = String(facts[key] ?? "").trim();
        if (!value) throw new Error(`task_blind persona ${record.persona_id || `#${index}`} missing frozen_facts.${key}; refusing fallback`);
        return value;
      };
      const fp = record.behavioral_fingerprint || {};
      for (const dim of ["maximizing_satisficing", "need_for_cognition", "actively_open_minded_thinking", "risk_propensity_business", "ambiguity_tolerance", "regulatory_focus_promotion", "consideration_future_consequences", "action_orientation"]) {
        if (!Number.isFinite(Number(fp[dim]))) throw new Error(`task_blind persona ${record.persona_id || `#${index}`} missing behavioral_fingerprint.${dim}; refusing fallback`);
      }
      if (!String(record.persona_id || "").trim()) throw new Error(`task_blind record #${index} missing persona_id`);
      if (!String(record.biography || "").trim()) throw new Error(`task_blind persona ${record.persona_id} missing biography`);
      const actionOrientation = Number(fp.action_orientation);
      const teamRole = actionOrientation >= 0.67
        ? "主导"
        : Number(fp.actively_open_minded_thinking) >= 0.6
          ? "质疑"
          : Number(fp.actively_open_minded_thinking) <= 0.4 && Number(fp.ambiguity_tolerance) >= 0.5
            ? "调停"
            : "跟随";
      const effortStyle = Number(fp.need_for_cognition) >= 0.55
        ? "认真打磨"
        : Number(fp.need_for_cognition) < 0.35
          ? "先交差后面改"
          : actionOrientation <= 0.4 ? "依赖队友" : "先交差后面改";
      return {
        profile_id: record.persona_id,
        archetype_id: "task_blind_narrative",
        label: "高管项目学员",
        desc: "由冻结事实卡和八维行为特征写成的任务盲人物小传",
        role: requireFact("career_context"),
        background: record.biography,
        industry: requireFact("product_and_technology_familiarity"),
        decisionStyle: requireFact("quality_convenience_tradeoffs"),
        riskPreference: requireFact("economic_resources_and_pressure"),
        expressionStyle: requireFact("communication_and_participation"),
        blindSpots: taskBlindInferBlindSpots(fp),
        classroomProfile: { team_role: teamRole, effort_style: effortStyle },
        pricingBias: `${taskBlindInferPricingDoctrine(fp, facts.career_context)}。价格参照：${requireFact("price_reference_history")}`,
        consumption_habits: requireFact("personal_consumption_habits"),
        speaking_tendency: actionOrientation >= 0.67 ? "high" : actionOrientation <= 0.33 ? "low" : "mid",
        surface: { ...surface, expression_style: requireFact("communication_and_participation") },
        behavioral_fingerprint: record.behavioral_fingerprint,
        task_blind_biography: record.biography,
        persona_pool_record: record
      };
    }
    if (isCareerGeneralProfileRecord(record)) {
      const demographic = record.demographic_realization || {};
      const demographicSeed = record.demographic_seed || {};
      const current = record.current_position || {};
      const profile = record.general_profile || {};
      const overseasText = demographic.overseas_detail || demographicSeed.overseas || "无";
      const member = {
        profile_id: record.persona_id || `CGP${String(index + 1).padStart(2, "0")}`,
        archetype_id: "career_general_profile",
        label: "高管项目学员",
        desc: "由连贯职业主线与 general profiling 生成；不使用 A-G prototype",
        role: current.role || "企业管理者",
        background: [profile.professional_identity, record.career_narrative].filter(Boolean).join("\n"),
        industry: current.industry || "",
        decisionStyle: [
          profile.information_search_and_stopping,
          profile.cognitive_effort,
          profile.belief_updating,
          profile.action_and_recovery
        ].filter(Boolean).join("\n"),
        riskPreference: [profile.risk_posture, profile.ambiguity_response].filter(Boolean).join("\n"),
        expressionStyle: profile.communication_style || "自然表达",
        blindSpots: profile.blind_spots || "",
        pricingBias: "",
        speaking_tendency: "mid",
        surface: {
          name: record.name || record.persona_id,
          gender: demographic.gender || demographicSeed.gender || "",
          age: Number(demographic.age || demographicSeed.age) || null,
          edu: demographic.highest_education || demographicSeed.education || "",
          overseas: {
            hasOverseas: overseasText !== "无",
            destination: overseasText === "无" ? "" : overseasText,
            duration: ""
          },
          mbti: "",
          expression_style: profile.communication_style || "自然表达"
        },
        career_general_profile: profile,
        current_position: current,
        career_history: record.career_history || [],
        family_life: record.family_life || null,
        behavioral_fingerprint: record.behavioral_fingerprint,
        behavioral_directives: record.behavioral_directives,
        persona_pool_record: record
      };
      return attachCareerGeneralProfile(member);
    }
    if (isBehavioralNarrativeRecord(record)) {
      const surface = record.surface || {};
      const structural = record.structural_profile || {};
      const narrative = record.narrative_profile || {};
      const speakingTendency = Number(record.behavioral_fingerprint?.action_orientation) >= 0.67
        ? "high"
        : Number(record.behavioral_fingerprint?.action_orientation) <= 0.33 ? "low" : "mid";
      const member = {
        profile_id: record.persona_id || `BN${String(index + 1).padStart(2, "0")}`,
        archetype_id: "behavioral_narrative",
        label: "高管项目学员",
        desc: "由 behavioral fingerprint 反推生成；不使用 A-G prototype",
        role: structural.current_role || "企业管理者",
        background: [
          structural.company_context,
          narrative.life_sketch,
          narrative.success_episode,
          narrative.failure_episode
        ].filter(Boolean).join("\n"),
        industry: structural.industry || "",
        decisionStyle: narrative.decision_habit || "",
        riskPreference: narrative.uncertainty_style || "",
        expressionStyle: surface.expression_style || narrative.speaking_texture || "自然表达",
        blindSpots: narrative.blind_spot || "",
        pricingBias: "",
        speaking_tendency: speakingTendency,
        surface,
        structural_profile: structural,
        narrative_profile: narrative,
        behavioral_fingerprint: record.behavioral_fingerprint,
        persona_pool_record: record
      };
      return attachBehavioralNarrative(member);
    }
    const base = PERSONAS[record.archetype] || {};
    const surface = record.surface || {};
    const speakingTendency = String(surface.mbti || "").startsWith("E")
      ? "high"
      : String(surface.mbti || "").startsWith("I") ? "low" : ["high", "mid", "low"][index % 3];
    const member = {
      profile_id: record.persona_id || `R${String(index + 1).padStart(2, "0")}`,
      archetype_id: record.archetype || base.id || "",
      label: record.archetype_label || base.label || record.archetype || "课堂参与者",
      desc: base.desc || record.archetype_label || "EMBA 课堂参与者",
      role: base.role || "小组成员",
      background: base.background || record.archetype_label || "",
      industry: base.industry || "",
      decisionStyle: base.decisionStyle || "",
      riskPreference: base.riskPreference || "",
      expressionStyle: surface.expression_style || base.expressionStyle || "自然表达",
      blindSpots: base.blindSpots || "",
      pricingBias: base.pricingBias || "",
      speaking_tendency: speakingTendency,
      surface,
      persona_pool_record: record
    };
    return attachLayeredNoMap(member);
  });
}

function sampleTeam(pool, seed, config) {
  const rng = makeRng(seed);
  const members = sampleWithoutReplacement(pool, requireConfigNumber(config, "team_size"), rng);
  const leaderIdx = Math.floor(rng() * members.length);
  return { members, leaderIdx, seed };
}

function forcedJinangStrategy() {
  const raw = String(process.env.TEAM_SIM_FORCE_JINANG_STRATEGY || "").trim().toUpperCase();
  return raw === "COST" || raw === "DIFF" ? raw : "";
}

function hideJinangFromSyntheticPrompts() {
  return /^(1|true|yes|on)$/i.test(String(process.env.TEAM_SIM_HIDE_JINANG || "").trim());
}

function r1StrategyModeRaw() {
  const raw = String(process.env.TEAM_SIM_R1_STRATEGY_MODE || "").trim().toLowerCase();
  return raw;
}

function r1NaturalStrategyPosthocMode() {
  const raw = r1StrategyModeRaw();
  return raw === "natural_posthoc" || raw === "natural" || raw === "1" || raw === "true";
}

function r1NaturalStrategyChatAskMode() {
  const raw = r1StrategyModeRaw();
  return raw === "natural_chat" || raw === "chat_ask" || raw === "chat" || raw === "screenplay_chat";
}

function r1NaturalStrategyMode() {
  return r1NaturalStrategyPosthocMode() || r1NaturalStrategyChatAskMode();
}

const TARGET_MARKET_OPTIONS = [
  { target_id: "ToC_CHILD", customer_type: "ToC", age: "CHILD", label: "ToC / 儿童" },
  { target_id: "ToB_CHILD", customer_type: "ToB", age: "CHILD", label: "ToB / 儿童" },
  { target_id: "ToC_ADULT", customer_type: "ToC", age: "ADULT", label: "ToC / 成人" },
  { target_id: "ToB_ADULT", customer_type: "ToB", age: "ADULT", label: "ToB / 成人" },
  { target_id: "ToC_ELDER", customer_type: "ToC", age: "ELDER", label: "ToC / 老人" },
  { target_id: "ToB_ELDER", customer_type: "ToB", age: "ELDER", label: "ToB / 老人" }
];

function formatTargetMarketList() {
  return TARGET_MARKET_OPTIONS.map((item) => `- ${item.target_id}: ${item.label}`).join("\n");
}

function getTargetMarket(targetId) {
  const normalized = String(targetId || "").trim();
  return TARGET_MARKET_OPTIONS.find((item) => item.target_id === normalized);
}

function normalizeCustomerType(value) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();
  if (upper === "TOB" || upper === "B2B" || raw.includes("企业") || raw.includes("机构")) return "ToB";
  if (upper === "TOC" || upper === "B2C" || raw.includes("消费者") || raw.includes("个人") || raw.includes("家庭")) return "ToC";
  throw new Error(`invalid target customer_type: ${value}`);
}

function normalizeAgeSegment(value) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();
  if (upper.includes("CHILD") || raw.includes("儿童") || raw.includes("孩子") || raw.includes("小孩")) return "CHILD";
  if (upper.includes("ELDER") || upper.includes("SENIOR") || raw.includes("老人") || raw.includes("养老") || raw.includes("老年")) return "ELDER";
  if (upper.includes("ADULT") || raw.includes("成人") || raw.includes("年轻") || raw.includes("白领") || raw.includes("职场")) return "ADULT";
  throw new Error(`invalid target age: ${value}`);
}

function normalizeTargetMarketId(source) {
  const raw = source && typeof source === "object" ? source : {};
  const direct = String(raw.target_market_id ?? raw.target_market ?? raw.market_target ?? raw.market_id ?? raw["目标市场"] ?? "").trim();
  const directTarget = getTargetMarket(direct);
  if (directTarget) return directTarget.target_id;
  const gridId = String(raw.grid_id ?? raw.market_grid ?? raw.grid ?? "").trim();
  if (GRID_IDS.includes(gridId)) {
    const grid = getGrid(gridId);
    return `${grid.customer_type}_${grid.age}`;
  }
  const customer = normalizeCustomerType(raw.customer_type ?? raw.customer ?? raw.market ?? raw["客群"]);
  const age = normalizeAgeSegment(raw.age ?? raw.age_segment ?? raw.segment ?? raw["年龄段"]);
  return `${customer}_${age}`;
}

function countStrategyTerms(text, terms) {
  const source = String(text || "");
  return terms.reduce((sum, term) => {
    const pattern = term instanceof RegExp ? term : new RegExp(escapeRegExp(term), "giu");
    const matches = source.match(pattern);
    return sum + (matches ? matches.length : 0);
  }, 0);
}

function indexCompetitiveStrategyText(text) {
  const source = String(text || "").trim();
  if (!source) throw new Error("competitive_strategy_text required");
  const costTerms = [
    "性价比", "更划算", "划算", "可负担", "便宜", "低价", "低成本", "降本", "省钱", "省成本",
    "规模", "走量", "普及", "大规模", "批量", "标准化", "易采用", "容易采用", "采购门槛", "低维护",
    "降低成本", "降低人力成本", "降低客户", "降低门槛", "落地成本", "维护成本", "运营成本",
    "减负", "替代人工", "人力不足", "ROI", "效率", "易落地", "快速落地",
    /价格\s*敏感/giu, /成本\s*领先/giu, /成\s*本.*压/u, /看得?到\s*ROI/giu
  ];
  const diffTerms = [
    "独特", "特别", "不一样", "差异化", "高端", "溢价", "专属", "个性化", "体验", "情绪价值",
    "品牌", "记忆点", "壁垒", "护城河", "更好", "精准", "定制", "稀缺", "场景价值", "功能赢得",
    /可以\s*定\s*更高价/giu
  ];
  const costScore = countStrategyTerms(source, costTerms);
  const diffScore = countStrategyTerms(source, diffTerms);
  let strategy = "";
  let reason = "ambiguous";
  if (costScore > diffScore) {
    strategy = "COST";
    reason = "cost_terms_gt_diff_terms";
  } else if (diffScore > costScore) {
    strategy = "DIFF";
    reason = "diff_terms_gt_cost_terms";
  } else if (costScore === 0 && diffScore === 0) {
    reason = "no_strategy_terms";
  } else {
    reason = "tie_needs_clarification";
  }
  return {
    strategy,
    cost_score: costScore,
    diff_score: diffScore,
    reason,
    text: source
  };
}

function strategyIndexNeedsClarification(strategyIndex) {
  return !strategyIndex || strategyIndex.strategy !== "COST" && strategyIndex.strategy !== "DIFF";
}

function normalizeExplicitCompetitiveStrategyChoice(value) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();
  if (
    upper === "A" ||
    upper.startsWith("A ") ||
    upper.startsWith("A：") ||
    upper.startsWith("A:") ||
    upper === "DIFF" ||
    upper === "DIFFERENTIATION" ||
    /更特别|更适合|更好体验|体验更好|功能更好|独特|差异化/u.test(raw)
  ) {
    return {
      strategy: "DIFF",
      strategy_choice: "A",
      strategy_choice_label: "more_special_fit_experience_or_function",
      strategy_choice_raw: raw
    };
  }
  if (
    upper === "B" ||
    upper.startsWith("B ") ||
    upper.startsWith("B：") ||
    upper.startsWith("B:") ||
    upper === "COST" ||
    /更划算|容易普及|更容易普及|容易被采购|更容易被采购|性价比|买得起|可负担/u.test(raw)
  ) {
    return {
      strategy: "COST",
      strategy_choice: "B",
      strategy_choice_label: "more_affordable_scalable_easy_to_adopt",
      strategy_choice_raw: raw
    };
  }
  throw new Error(`competitive_strategy_choice must be A/B or DIFF/COST, got: ${value}`);
}

async function clarifyCompetitiveStrategyChoice({ strategyText, contextText = "", temperature }) {
  const messages = [
    {
      role: "system",
      content: [
        "你是在模拟课堂 UI 里的一个很短追问。只根据对方刚才写下的“靠什么赢/竞争优势”原文判断。",
        "如果这句话更像“靠独特体验、独特功能、更适合某类用户、可以有差别化价值”取胜，选 DIFF。",
        "如果这句话更像“靠性价比、规模、低成本、买得起、易采购、易普及、效率或节省人力”取胜，选 COST。",
        "不要重新做商业分析，不要改变目标市场或架构。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "刚才这段自然选择里，竞争优势一栏不够明确，需要追问一次。",
        contextText ? `上下文：${clipText(contextText, 700)}` : "",
        `竞争优势原文：${strategyText}`,
        '请只输出：{"strategy":"DIFF|COST","clarification_line":"一句像真人回答追问的话","rationale":"为什么只按这句话会选这个"}'
      ].filter(Boolean).join("\n")
    }
  ];
  const result = await callJson(messages, { temperature: Math.min(0.2, temperature), maxTokens: 260 });
  const parsed = result.parsed && typeof result.parsed === "object" ? result.parsed : {};
  const strategy = String(parsed.strategy || parsed.choice || parsed["策略"] || "").trim().toUpperCase();
  if (strategy !== "DIFF" && strategy !== "COST") {
    throw new Error(`strategy clarification returned invalid strategy: ${strategy}`);
  }
  return {
    raw: result.raw,
    parsed: {
      strategy,
      clarification_line: String(parsed.clarification_line || parsed.line || parsed["追问回答"] || "").trim(),
      rationale: String(parsed.rationale || parsed.reason || parsed["理由"] || "").trim()
    }
  };
}

function strategyScore(card, strategy) {
  return Number(card?.affinity_weights?.strategy?.[strategy] ?? 0);
}

function strategyForcedCards(cards, count, seed, cardType, strategy) {
  const other = strategy === "COST" ? "DIFF" : "COST";
  const ranked = [...cards]
    .map((card) => ({
      card,
      edge: strategyScore(card, strategy) - strategyScore(card, other)
    }))
    .sort((left, right) => {
      if (right.edge !== left.edge) return right.edge - left.edge;
      return String(left.card.id || left.card.name).localeCompare(String(right.card.id || right.card.name));
    });
  const preferred = ranked.filter((item) => item.edge > 0).map((item) => item.card);
  const pool = preferred.length ? preferred : ranked.map((item) => item.card);
  const offset = Math.floor(makeRng(`jinang:${seed}:forced:${strategy}:${cardType}`)() * pool.length);
  return Array.from({ length: count }, (_, index) => pool[(offset + index) % pool.length]);
}

function drawJinangForMembers(members, seed, jinangConfig) {
  const forcedStrategy = forcedJinangStrategy();
  if (forcedStrategy) {
    const marketCards = strategyForcedCards(jinangConfig.market, members.length, seed, "market", forcedStrategy);
    const techCards = strategyForcedCards(jinangConfig.tech, members.length, seed, "tech", forcedStrategy);
    return members.map((member, index) => ({
      member_id: member.profile_id,
      market: marketCards[index],
      tech: techCards[index]
    }));
  }
  const rng = makeRng(`jinang:${seed}`);
  const marketCards = sampleWithoutReplacement(jinangConfig.market, members.length, rng);
  const techCards = sampleWithoutReplacement(jinangConfig.tech, members.length, rng);
  return members.map((member, index) => ({
    member_id: member.profile_id,
    market: marketCards[index],
    tech: techCards[index]
  }));
}

function splitExpressionStyle(style) {
  const text = String(style || "");
  const marker = "\n\n你的思维特征";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return { display: text, behavior: "" };
  return {
    display: text.slice(0, markerIndex).trim(),
    behavior: text.slice(markerIndex).trim()
  };
}

function isBehavioralNarrativeRecord(record) {
  return Boolean(record?.behavioral_fingerprint && record?.narrative_profile);
}

function isCareerGeneralProfileRecord(record) {
  return record?.schema === "career_general_profile_v2"
    && Array.isArray(record?.career_history)
    && Boolean(record?.general_profile);
}

function isTaskBlindNarrativeRecord(record) {
  return record?.schema === "task_blind_narrative_v1"
    && Boolean(String(record?.biography || "").trim())
    && Boolean(record?.surface);
}

function isBehavioralNarrativeMember(member) {
  return Boolean(member?.behavioral_fingerprint && member?.narrative_profile);
}

function isCareerGeneralProfileMember(member) {
  return Boolean(member?.career_general_profile && member?.current_position);
}

function taskBlindInferPricingDoctrine(fp, careerText) {
  const t = String(careerText || "");
  const promo = Number(fp.regulatory_focus_promotion);
  const risk = Number(fp.risk_propensity_business);
  const maxi = Number(fp.maximizing_satisficing);
  const nfc = Number(fp.need_for_cognition);
  for (const v of [promo, risk, maxi, nfc]) {
    if (!Number.isFinite(v)) throw new Error("taskBlindInferPricingDoctrine: missing fingerprint dim; refusing fallback");
  }
  if (/互联网|软件|平台|电商|App|SaaS|在线/iu.test(t)) return "习惯互联网低价获客的打法，容易低估硬件的定价空间";
  if (/消费品|零售|快消|民生|连锁|超市|餐饮|教育培训|培训/u.test(t) && promo < 0.6) return "怕定贵了普通客户不接受，倾向保守定价";
  if ((/高端|品牌|奢侈|进口|咨询|投行|资本/u.test(t) && promo >= 0.5) || (promo >= 0.7 && risk >= 0.6)) return "觉得好东西就该卖贵，价格本身就是定位";
  if (maxi >= 0.6 && nfc >= 0.55) return "算得很细，倾向反复比价找最优价格点";
  if (promo <= 0.4 || risk <= 0.35) return "定价宁低勿高，怕压货砸在手里";
  return "对定价没有成型的直觉，容易跟着身边的参照物走";
}

function taskBlindInferBlindSpots(fp) {
  const traits = [
    { dev: 0.5 - Number(fp.actively_open_minded_thinking), text: "听到反对意见时容易先守住自己原来的判断" },
    { dev: 0.5 - Number(fp.need_for_cognition), text: "不耐烦啃长材料，抽象细节容易跳过" },
    { dev: 0.5 - Number(fp.consideration_future_consequences), text: "容易盯着眼前效果，低估长期投入和维护" },
    { dev: 0.5 - Number(fp.maximizing_satisficing), text: "觉得差不多就行，容易漏掉更优的选项" },
    { dev: Number(fp.risk_propensity_business) - 0.5, text: "对下行风险容易估计不足" },
    { dev: Number(fp.action_orientation) - 0.5, text: "拍板快，容易略过复核环节" },
    { dev: 0.5 - Number(fp.ambiguity_tolerance), text: "信息不全时容易急着要一个确定说法" },
    { dev: Number(fp.regulatory_focus_promotion) - 0.5, text: "被机会点吸引时容易忽略执行成本" }
  ];
  for (const t of traits) {
    if (!Number.isFinite(t.dev)) throw new Error("taskBlindInferBlindSpots: missing fingerprint dim; refusing fallback");
  }
  traits.sort((a, b) => b.dev - a.dev);
  return `${traits[0].text}；${traits[1].text}。`;
}

function isTaskBlindNarrativeMember(member) {
  return Boolean(String(member?.task_blind_biography || "").trim());
}

function formatTaskBlindNarrativePersona(member, isLeader) {
  return [
    `姓名代号：${member.profile_id}`,
    "【人物小传】",
    member.task_blind_biography,
    isLeader ? "你是组长，负责推进讨论并代表全队提交。" : "你是普通队员。",
    "你现在就是小传中的这个人。像本人临场一样看界面、说话和行动，不要复述或分析小传，不要把自己变成顾问。",
    "人物小传可能没有覆盖眼前问题；遇到没有经历支撑的地方，就按这个人当下会有的直觉、犹豫或误解处理。"
  ].filter(Boolean).join("\n");
}

function behaviorValueLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (numeric <= 0.33) return "低";
  if (numeric >= 0.67) return "高";
  return "中";
}

function behaviorFingerprintForPrompt(fingerprint = {}) {
  const rows = [
    ["搜索/停手", fingerprint.maximizing_satisficing],
    ["思考投入", fingerprint.need_for_cognition],
    ["听反证/改想法", fingerprint.actively_open_minded_thinking],
    ["经营风险承受", fingerprint.risk_propensity_business],
    ["信息不全容忍", fingerprint.ambiguity_tolerance],
    ["进取-防守目标编码", fingerprint.regulatory_focus_promotion],
    ["短期-长期权衡", fingerprint.consideration_future_consequences],
    ["拍板后行动", fingerprint.action_orientation]
  ];
  return rows
    .map(([label, value]) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? `${label}：${behaviorValueLabel(numeric)} (${numeric.toFixed(2)})` : "";
    })
    .filter(Boolean)
    .join("；");
}

function formatSurface(member, options = {}) {
  const surface = member.surface || {};
  const gender = surface.gender === "female" ? "女" : surface.gender === "male" ? "男" : "未知";
  const overseas = surface.overseas?.hasOverseas
    ? `${surface.overseas.destination}，${surface.overseas.duration}`
    : "无";
  const expression = splitExpressionStyle(surface.expression_style || member.expressionStyle || "自然表达");
  if (isCareerGeneralProfileMember(member)) {
    const current = member.current_position || {};
    const profile = member.career_general_profile || {};
    const family = member.family_life || {};
    return [
      `姓名：${surface.name || member.profile_id}`,
      "身份来源：连贯职业主线 + general profiling；不是 A-G prototype。",
      `性别：${gender}`,
      surface.age ? `年龄：${surface.age}岁` : "",
      surface.edu ? `学历：${surface.edu}` : "",
      `海外经历：${overseas}`,
      current.role ? `当前身份：${current.role}` : "",
      current.industry ? `所在行业：${current.industry}` : "",
      current.primary_function ? `主要职能：${current.primary_function}` : "",
      current.company_context ? `公司处境：${current.company_context}` : "",
      current.management_scope ? `管理责任：${current.management_scope}` : "",
      family.household_snapshot ? `家庭情况：${family.household_snapshot}` : "",
      family.family_experience_narrative ? `家庭与代际经历：${family.family_experience_narrative}` : "",
      profile.professional_identity ? `职业视角：${profile.professional_identity}` : "",
      profile.communication_style ? `说话方式：${profile.communication_style}` : "",
      profile.blind_spots ? `盲区：${profile.blind_spots}` : ""
    ].filter(Boolean).join("\n");
  }
  if (isBehavioralNarrativeMember(member)) {
    const structural = member.structural_profile || {};
    const narrative = member.narrative_profile || {};
    return [
      `姓名：${surface.name || member.profile_id}`,
      "身份来源：behavioral narrative，高管项目学员；不是 A-G prototype。",
      `性别：${gender}`,
      surface.age ? `年龄：${surface.age}岁` : "",
      surface.edu ? `学历：${surface.edu}` : "",
      `海外经历：${overseas}`,
      structural.current_role ? `当前身份：${structural.current_role}` : "",
      structural.industry ? `所在行业：${structural.industry}` : "",
      structural.company_context ? `公司处境：${structural.company_context}` : "",
      structural.management_scope ? `管理责任：${structural.management_scope}` : "",
      narrative.life_sketch ? `人物小传：${narrative.life_sketch}` : "",
      narrative.classroom_state ? `今天课堂状态：${narrative.classroom_state}` : "",
      narrative.speaking_texture ? `说话质感：${narrative.speaking_texture}` : `表达风格：${expression.display || "自然表达"}`,
      narrative.blind_spot ? `盲区：${narrative.blind_spot}` : ""
    ].filter(Boolean).join("\n");
  }
  return [
    `姓名：${surface.name || member.profile_id}`,
    `原型：${member.label}（${member.desc}）`,
    `性别：${gender}`,
    surface.age ? `年龄：${surface.age}岁` : "",
    surface.edu ? `学历：${surface.edu}` : "",
    `海外经历：${overseas}`,
    surface.mbti ? `MBTI：${surface.mbti}` : "",
    `表达风格：${expression.display || "自然表达"}`,
    options.includeBehavior && expression.behavior ? expression.behavior : ""
  ].filter(Boolean).join("\n");
}

function isLayeredNoMapArm(arm) {
  return arm === "layered_nomap" || arm === "team_layered_nomap" || arm === "team_room_roleplay_ui" || isStatefulRoomRoleplayArm(arm);
}

function isRoomRoleplayArm(arm) {
  return arm === "team_room_roleplay_ui" || arm === "team_room_pricing_action_actor_v1" || isStatefulRoomRoleplayArm(arm);
}

function isPricingActionActorArm(arm) {
  return arm === "team_room_pricing_action_actor_v1";
}

function isStatefulRoomRoleplayArm(arm) {
  return arm === "team_room_roleplay_stateful_v1" || arm === "team_room_roleplay_stateful_review_v1" || arm === "team_room_d4_human_pick_v1" || arm === "team_room_d4_stateful_pick_v1" || arm === "team_room_d4_stateful_d5_nosubmit_v1" || arm === "team_room_story_d4_v1" || arm === "team_room_story_d4d5_v1" || arm === "team_room_story_d4d5_narrator_d5_v1" || arm === "team_room_story_r1_d4d5_narrator_v1" || arm === "team_room_r1_private_trace_v1" || arm === "team_room_r1_story_process_v1" || hasR1UiNarrativeArm(arm);
}

function hasD5CardReviewState(arm) {
  return arm === "team_room_roleplay_stateful_review_v1" || arm === "team_room_d4_human_pick_v1" || arm === "team_room_d4_stateful_pick_v1" || arm === "team_room_d4_stateful_d5_nosubmit_v1" || arm === "team_room_story_d4_v1" || arm === "team_room_story_d4d5_v1" || arm === "team_room_story_d4d5_narrator_d5_v1" || arm === "team_room_story_r1_d4d5_narrator_v1" || arm === "team_room_r1_private_trace_v1" || arm === "team_room_r1_story_process_v1" || hasR1UiNarrativeArm(arm);
}

function hasD4HumanPickArm(arm) {
  return arm === "team_room_d4_human_pick_v1" || hasD4StatefulPickArm(arm);
}

function hasD4StatefulPickArm(arm) {
  return arm === "team_room_d4_stateful_pick_v1" || arm === "team_room_d4_stateful_d5_nosubmit_v1" || arm === "team_room_story_d4_v1" || arm === "team_room_story_d4d5_v1" || arm === "team_room_story_d4d5_narrator_d5_v1" || arm === "team_room_story_r1_d4d5_narrator_v1" || arm === "team_room_r1_private_trace_v1" || arm === "team_room_r1_story_process_v1" || hasR1UiNarrativeArm(arm);
}

function hasD5D4ResidueArm(arm) {
  return arm === "team_room_d4_stateful_d5_nosubmit_v1" || arm === "team_room_story_d4_v1" || arm === "team_room_story_d4d5_v1" || arm === "team_room_story_d4d5_narrator_d5_v1" || arm === "team_room_story_r1_d4d5_narrator_v1" || arm === "team_room_r1_private_trace_v1" || arm === "team_room_r1_story_process_v1" || hasR1UiNarrativeArm(arm);
}

function usesD5TranscriptPriceParser(arm) {
  return arm === "team_room_d4_stateful_d5_nosubmit_v1";
}

function hasD4StoryPickArm(arm) {
  return arm === "team_room_story_d4_v1" || arm === "team_room_story_d4d5_v1" || arm === "team_room_story_d4d5_narrator_d5_v1" || arm === "team_room_story_r1_d4d5_narrator_v1" || arm === "team_room_r1_private_trace_v1" || arm === "team_room_r1_story_process_v1" || hasR1UiNarrativeArm(arm);
}

function hasD5ScreenplayArm(arm) {
  return arm === "team_room_story_d4d5_v1";
}

function hasD4ScreenplayArm(arm) {
  return arm === "team_room_story_d4d5_v1" || arm === "team_room_story_d4d5_narrator_d5_v1" || arm === "team_room_story_r1_d4d5_narrator_v1" || arm === "team_room_r1_private_trace_v1" || arm === "team_room_r1_story_process_v1" || hasR1UiNarrativeArm(arm);
}

function hasD5NarratorActorArm(arm) {
  return arm === "team_room_story_d4d5_narrator_d5_v1" || arm === "team_room_story_r1_d4d5_narrator_v1" || arm === "team_room_r1_private_trace_v1" || arm === "team_room_r1_story_process_v1" || hasR1UiNarrativeArm(arm);
}

function hasR1NarratorActorArm(arm) {
  return arm === "team_room_story_r1_d4d5_narrator_v1";
}

function hasR1PrivateTraceArm(arm) {
  return arm === "team_room_r1_private_trace_v1";
}

function hasR1StoryProcessArm(arm) {
  return arm === "team_room_r1_story_process_v1";
}

function hasR1ReadingStoryArm(arm) {
  return arm === "team_room_r1_reading_story_v1";
}

function hasR1ScreenplayArm(arm) {
  return arm === "team_room_r1_screenplay_v1";
}

function hasR1ActorIsolatedArm(arm) {
  return arm === "team_room_r1_actor_isolated_v1";
}

function hasR1UiNarrativeArm(arm) {
  return hasR1ReadingStoryArm(arm) || hasR1ScreenplayArm(arm) || hasR1ActorIsolatedArm(arm);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreBand(value, labels) {
  const v = Number(value);
  if (v < 0.33) return labels[0];
  if (v < 0.66) return labels[1];
  return labels[2];
}

function classroomBehaviorProfile(member, isLeader = false) {
  if (isCareerGeneralProfileMember(member)) {
    const profile = member.career_general_profile || {};
    const communication = String(profile.communication_style || "");
    const interpersonal = String(profile.interpersonal_and_power_style || "");
    const motives = String(profile.core_motives || "");
    const selfConcept = String(profile.self_concept_and_status || "");
    const updating = String(profile.belief_updating || "");
    const stress = String(profile.stress_pattern || "");
    const cognition = String(profile.cognitive_effort || "");
    const professional = String(profile.professional_identity || "");
    const talkativeness = /话少|简短|寡言/u.test(communication)
      ? 0.25
      : /话多|展开|滔滔不绝/u.test(communication) ? 0.75 : 0.5;
    const dominance = clamp(
      (isLeader ? 0.62 : 0.42)
        + (/强势|主导|控制|独断/u.test(interpersonal + stress) ? 0.18 : 0)
        - (/退让|回避冲突|附和/u.test(interpersonal) ? 0.15 : 0),
      0,
      1
    );
    const statusMotive = clamp(
      0.42
        + (/证明|认可|地位|声誉|影响力|权威/u.test(motives + selfConcept) ? 0.18 : 0)
        - (/不在意评价|不愿表现/u.test(motives + selfConcept) ? 0.18 : 0),
      0,
      1
    );
    const engagement = 0.58;
    const relevanceControl = /跑题|发散/u.test(communication) ? 0.34 : 0.62;
    const agreeability = clamp(
      0.48
        + (/主动邀请|听取异议|愿意调整|愿意推翻/u.test(updating) ? 0.18 : 0)
        - (/固执|保护自己的判断|很少主动找反证/u.test(updating) ? 0.18 : 0),
      0,
      1
    );
    const calculationImpulse = /数据|指标|成本|财务|工程|技术|供应链|机制|因果/u.test(
      `${cognition} ${professional} ${member.industry} ${member.role}`
    ) ? 0.68 : 0.42;
    const taskSkepticism = /反证|质疑|怀疑|核对/u.test(updating + cognition) ? 0.58 : 0.38;
    return {
      talkativeness,
      dominance,
      statusMotive,
      engagement,
      relevanceControl,
      agreeability,
      calculationImpulse,
      taskSkepticism,
      labels: {
        talkativeness: scoreBand(talkativeness, ["话少", "正常发言", "话多"]),
        relevance: scoreBand(relevanceControl, ["容易跑题或讲自己行业", "偶尔发散", "比较聚焦"]),
        status: scoreBand(statusMotive, ["不太在意表现", "正常参与", "想显得自己懂"]),
        engagement: scoreBand(engagement, ["有点敷衍", "正常完成任务", "认真投入"]),
        dominance: scoreBand(dominance, ["被点到才说", "看时机插话", "容易抢主导"]),
        agreeability: scoreBand(agreeability, ["爱质疑", "正常回应", "喜欢调停/附和"]),
        calculation: scoreBand(calculationImpulse, ["凭感觉", "会看数字", "忍不住算账"])
      }
    };
  }
  const rng = makeRng(`classroom_behavior:${member.profile_id}`);
  const mbti = String(member.surface?.mbti || "");
  const role = String(member.classroomProfile?.team_role || "");
  const effort = String(member.classroomProfile?.effort_style || "");
  const expression = String(member.surface?.expression_style || member.expressionStyle || "");
  const extrovert = mbti.startsWith("E") ? 0.18 : (mbti.startsWith("I") ? -0.16 : 0);
  const speaking = member.speaking_tendency === "high" ? 0.18 : (member.speaking_tendency === "low" ? -0.14 : 0);
  const roleDominance = role === "主导" ? 0.22 : (role === "跟随" ? -0.14 : 0);
  const talkativeness = clamp(0.42 + extrovert + speaking + roleDominance + (rng() - 0.5) * 0.38, 0, 1);
  const dominance = clamp(0.38 + roleDominance + (isLeader ? 0.18 : 0) + (rng() - 0.5) * 0.34, 0, 1);
  const statusMotive = clamp(0.32 + (/管理|老板|创始|投资|咨询|海归|海外|博士|MBA/u.test(expression + member.background) ? 0.2 : 0) + (rng() - 0.5) * 0.42, 0, 1);
  const engagement = clamp(0.46 + (effort === "认真打磨" ? 0.26 : 0) + (effort === "依赖队友" ? -0.22 : 0) + (effort === "先交差后面改" ? -0.1 : 0) + (rng() - 0.5) * 0.4, 0, 1);
  const relevanceControl = clamp(0.48 + (role === "质疑" ? 0.08 : 0) + (/跳跃|发散|故事|案例|直觉/u.test(expression) ? -0.16 : 0) + (rng() - 0.5) * 0.38, 0, 1);
  const agreeability = clamp(0.45 + (role === "调停" ? 0.24 : 0) + (role === "质疑" ? -0.2 : 0) + (rng() - 0.5) * 0.36, 0, 1);
  const calculationImpulse = clamp(0.38 + (/财务|金融|数据|工程|技术|基建|制造|供应链/u.test(`${member.industry} ${member.background} ${member.role}`) ? 0.22 : 0) + (rng() - 0.5) * 0.36, 0, 1);
  const taskSkepticism = clamp(0.32 + (effort === "依赖队友" ? 0.2 : 0) + (effort === "先交差后面改" ? 0.1 : 0) + (rng() - 0.5) * 0.4, 0, 1);
  return {
    talkativeness,
    dominance,
    statusMotive,
    engagement,
    relevanceControl,
    agreeability,
    calculationImpulse,
    taskSkepticism,
    labels: {
      talkativeness: scoreBand(talkativeness, ["话少", "正常发言", "话多"]),
      relevance: scoreBand(relevanceControl, ["容易跑题或讲自己行业", "偶尔发散", "比较聚焦"]),
      status: scoreBand(statusMotive, ["不太在意表现", "正常参与", "想显得自己懂"]),
      engagement: scoreBand(engagement, ["有点敷衍", "正常完成任务", "认真投入"]),
      dominance: scoreBand(dominance, ["被点到才说", "看时机插话", "容易抢主导"]),
      agreeability: scoreBand(agreeability, ["爱质疑", "正常回应", "喜欢调停/附和"]),
      calculation: scoreBand(calculationImpulse, ["凭感觉", "会看数字", "忍不住算账"])
    }
  };
}

function formatClassroomBehavior(member, isLeader, options = {}) {
  const behavior = classroomBehaviorProfile(member, isLeader);
  return [
    `发言量：${behavior.labels.talkativeness}`,
    `任务心态：${behavior.labels.engagement}`,
    `表现动机：${behavior.labels.status}`,
    `相关性控制：${behavior.labels.relevance}`,
    `小组位置：${behavior.labels.dominance}`,
    `互动倾向：${behavior.labels.agreeability}`,
    options.includeCalculation === false ? "" : `数字/成本倾向：${behavior.labels.calculation}`
  ].filter(Boolean).join("；");
}

function personaVoiceCue(member, isLeader = false) {
  const expression = splitExpressionStyle(member.surface?.expression_style || member.expressionStyle || "").display;
  const text = [
    member.archetype_id,
    member.label,
    member.role,
    member.industry,
    member.background,
    member.decisionStyle,
    expression
  ].filter(Boolean).join(" ");
  let voice;
  if (/体制|公文|国企|政府/u.test(text)) {
    voice = "说话偏稳、偏公文腔，会说统筹、抓手、落地、风险可控；常先确认边界和流程，不太会讲消费品热词。";
  } else if (/草根|制造业|老板|大白话|接地气/u.test(text)) {
    voice = "说话直接、接地气，爱用买卖、交付、售后和身边例子打比方；句子可以粗一点、短一点，不要像 PPT。";
  } else if (/二代|品牌|海外|家族|中英文|国外|ESG/u.test(text)) {
    voice = "说话会有品牌、长期主义、海外案例或一点中英文夹杂；可能有点飘，但会被现实落地问题拉回来。";
  } else if (/销售|铁军|成交|客户反应|感染力/u.test(text)) {
    voice = "说话像在现场劝客户，爱讲一个具体客户反应或成交画面；可以热一点、跳一点，但别变成咨询报告。";
  } else if (/PM|互联网|用户心智|MVP|PMF|北极星/u.test(text)) {
    voice = "说话会带产品经理词：MVP、闭环、用户心智、场景；容易抽象，偶尔自我修正说先别想大。";
  } else if (/技术|工程|AI|机器人|CTO|博士|算法/u.test(text)) {
    voice = "说话先看技术可行性、接口、部署、稳定性和维护；可以有工程师式犹豫，别把话说得太营销。";
  } else if (/职业经理|管理|运营|PPT|结构化|第一第二第三/u.test(text)) {
    voice = "说话结构化，容易第一第二第三，关心执行、风险、共识和可管理性；但台词仍要像人说话，不要写成正式汇报。";
  } else {
    voice = "说话要保留自己的行业词、犹豫和判断习惯，不要被整理成统一顾问腔。";
  }
  const behavior = classroomBehaviorProfile(member, isLeader);
  const lengthCue = behavior.talkativeness < 0.33
    ? "这个人话少，常常只说一两句或附和一下。"
    : behavior.talkativeness > 0.66
    ? "这个人话多，容易多讲几句自己的经历或类比。"
    : "这个人正常发言，不必每次都讲完整逻辑。";
  const effortCue = behavior.engagement < 0.33
    ? "任务心态有点敷衍，可以漏看、图省事、说“先这样”。"
    : behavior.statusMotive > 0.66
    ? "有表现欲，可能想显得自己懂，但仍要像课堂发言。"
    : "不需要每句话都显得很专业。";
  return [
    "【说话导演提示】",
    voice,
    lengthCue,
    effortCue,
    "允许自然使用这个人的口头习惯或行业黑话；不要因为怕重复而把语言磨平。",
    "禁用统一模板句：不要让所有人都说“理由很简单”“我倾向于”“这个场景足够特殊”。"
  ].join("\n");
}

function initBehavioralState(member, isLeader = false) {
  const behavior = classroomBehaviorProfile(member, isLeader);
  const rng = makeRng(`behavioral_state:${member.profile_id}`);
  // The keyword scan is a consumer of the OLD pools' authored pricing labels ("保守定价" etc.).
  // Task-blind members have no labels — their fact narratives are the wrong genre for this
  // scan (measured: 12:1 cost-word skew shifts the whole team price level toward the floor).
  // Their numeric heterogeneity comes solely from the zero-mean fingerprint term below.
  const isTaskBlindMember = member.archetype_id === "task_blind_narrative";
  const pricingText = isTaskBlindMember ? "" : `${member.pricingBias || ""} ${member.decisionStyle || ""} ${member.riskPreference || ""}`;
  const costLean = /成本|低价|走量|保守|谨慎|风险/u.test(pricingText) ? 0.16 : 0;
  const valueLean = /高端|溢价|差异|品牌|价值/u.test(pricingText) ? -0.12 : 0;
  // Symmetric numeric lean from the pool's 8-dim behavioral fingerprint (centered at 0.5):
  // counterweights the cost-prudent skew of fact-card language without authored labels.
  const fp = member.behavioral_fingerprint || {};
  const fpDim = (key) => {
    const value = Number(fp[key]);
    return Number.isFinite(value) ? value - 0.5 : 0;
  };
  const fingerprintLean = fpDim("consideration_future_consequences") * 0.12
    + fpDim("maximizing_satisficing") * 0.08
    - fpDim("risk_propensity_business") * 0.16
    - fpDim("regulatory_focus_promotion") * 0.12;
  return {
    attention_focus: "先看市场和用户是否说得通",
    confidence: clamp(0.48 + behavior.dominance * 0.2 + behavior.statusMotive * 0.08 - behavior.taskSkepticism * 0.12 + (rng() - 0.5) * 0.2, 0, 1),
    confusion: clamp(0.34 + (1 - behavior.relevanceControl) * 0.2 + behavior.taskSkepticism * 0.1 + (rng() - 0.5) * 0.2, 0, 1),
    fatigue: clamp(0.18 + (1 - behavior.engagement) * 0.22 + (rng() - 0.5) * 0.16, 0, 1),
    social_commitment: 0,
	    price_sensitivity: clamp(0.48 + costLean + valueLean + fingerprintLean + (1 - behavior.dominance) * 0.04 + (rng() - 0.5) * 0.3, 0, 1),
	    status_pressure: clamp(behavior.statusMotive + (isLeader ? 0.12 : 0), 0, 1),
	    last_public_position: "",
	    d4_group_state: {},
	    d4_recent_review: null,
	    d5_card_review: null,
	    activated_memory: []
	  };
	}

function ensureBehavioralState(member, isLeader = false) {
  if (!member.behavioral_state) {
    member.behavioral_state = initBehavioralState(member, isLeader);
  }
  return member.behavioral_state;
}

function clonePlain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeBehavioralStateForReplay(state, member, isLeader) {
  const base = state && typeof state === "object"
    ? clonePlain(state)
    : initBehavioralState(member, isLeader);
  if (!Array.isArray(base.activated_memory)) base.activated_memory = [];
  if (!base.d4_group_state || typeof base.d4_group_state !== "object") base.d4_group_state = {};
  if (!Object.prototype.hasOwnProperty.call(base, "d4_recent_review")) base.d4_recent_review = null;
  if (!Object.prototype.hasOwnProperty.call(base, "d5_card_review")) base.d5_card_review = null;
  return base;
}

function r1ActorPrivateStateByMember(r1ActorState, phase, memberId) {
  const phaseState = r1ActorState?.private_states?.[phase];
  if (!phaseState || typeof phaseState !== "object") return "";
  return String(phaseState[memberId] || "").trim();
}

function buildR1ActorCarryover(member, r1ActorState) {
  if (!r1ActorState || typeof r1ActorState !== "object") return null;
  const selectionState = r1ActorPrivateStateByMember(r1ActorState, "selection", member.profile_id);
  const vpState = r1ActorPrivateStateByMember(r1ActorState, "vp", member.profile_id);
  if (!selectionState && !vpState) return null;
  const parsed = r1ActorState.parsed_submission && typeof r1ActorState.parsed_submission === "object"
    ? r1ActorState.parsed_submission
    : null;
  return {
    source: "r1_actor_isolated_state",
    member_id: member.profile_id,
    selection_private_state: selectionState,
    vp_private_state: vpState,
    final_submission: parsed
      ? {
          grid_id: parsed.grid_id || "",
          architecture: parsed.architecture || "",
          vp_summary: clonePlain(parsed.vp_summary || {})
        }
      : null,
    event_cap: r1ActorState.event_cap ?? null,
    turn_count: Array.isArray(r1ActorState.turns) ? r1ActorState.turns.length : null,
    timeout_forced_submission: Boolean(r1ActorState.timeout_forced_submission)
  };
}

function restoreReplayBehavioralState({ members, leaderIdx, sourceMeta, r1ActorState = null }) {
  const initialByMember = new Map(ensureArray(sourceMeta?.behavioral_state_initial).map((item) => [
    item?.member_id,
    item?.state
  ]));
  let restoredBehavioralState = 0;
  let restoredR1ActorCarryover = 0;
  const memberSummaries = [];
  members.forEach((member, index) => {
    const initialState = initialByMember.get(member.profile_id);
    member.behavioral_state = normalizeBehavioralStateForReplay(initialState, member, index === leaderIdx);
    if (initialState) restoredBehavioralState += 1;
    const carryover = buildR1ActorCarryover(member, r1ActorState);
    if (carryover) {
      member.r1_actor_carryover = carryover;
      restoredR1ActorCarryover += 1;
    }
    memberSummaries.push({
      member_id: member.profile_id,
      is_leader: index === leaderIdx,
      behavioral_state_restored: Boolean(initialState),
      r1_actor_carryover_restored: Boolean(carryover)
    });
  });
  return {
    restored_behavioral_state_count: restoredBehavioralState,
    restored_r1_actor_carryover_count: restoredR1ActorCarryover,
    members: memberSummaries
  };
}

function snapshotBehavioralStateForRunMeta(members, leaderIdx) {
  return members.map((member, index) => ({
    member_id: member.profile_id,
    is_leader: index === leaderIdx,
    state: clonePlain(ensureBehavioralState(member, index === leaderIdx)),
    r1_actor_carryover_restored: Boolean(member.r1_actor_carryover)
  }));
}

function formatR1ActorCarryoverForPrompt(member, chars = 520) {
  const carryover = member.r1_actor_carryover;
  if (!carryover) return "";
  const final = carryover.final_submission || {};
  const vp = final.vp_summary || {};
  return [
    "【R1 延续记忆】",
    "这是你上一轮在市场/VP界面留下的个人连续性；其他人不知道你的私有状态。不要逐字念出来，也不要把它当价格锚点。",
    carryover.selection_private_state ? `市场选择页当时的私有状态：${clipText(carryover.selection_private_state, chars)}` : "",
    carryover.vp_private_state ? `VP页当时的私有状态：${clipText(carryover.vp_private_state, chars)}` : "",
    final.grid_id ? `团队最终提交：${final.grid_id}/${final.architecture || ""}；WHO=${vp.who || ""}；PAIN=${vp.pain || ""}；HOW=${vp.how || ""}` : ""
  ].filter(Boolean).join("\n");
}

function scoreStateBand(value, labels) {
  return scoreBand(value, labels);
}

function activatedMemoryLines(member, topic) {
  const topicText = String(topic || "");
  const memories = [];
  if (/定价|售价|price/u.test(topicText)) {
    memories.push(`定价惯性：${member.pricingBias || "会按自己熟悉的行业经验判断价格是否撑得住。"}`);
    if (/渠道|销售|经销|市场|保险|医疗|地产|汽车/u.test(`${member.industry} ${member.background}`)) {
      memories.push("会想起自己见过的渠道、采购或销售场景，容易把价格理解成成交阻力或价值锚点。");
    }
  } else if (/选卡|功能|能力|R2/u.test(topicText)) {
    memories.push(`能力判断惯性：${member.decisionStyle || "先凭直觉看哪些功能最像用户会用到。"}`);
    if (/技术|工程|制造|供应链|产品/u.test(`${member.industry} ${member.background} ${member.role}`)) {
      memories.push("会更容易注意功能落地、稳定性和维护成本，而不是只看卖点好不好听。");
    }
  } else if (/市场|定位|Round 1|VP/u.test(topicText)) {
    memories.push(`市场判断惯性：${member.blindSpots || member.decisionStyle || "会把陌生市场拉回自己熟悉的业务框架里理解。"}`);
  }
  if (member.seedMemory?.under_pressure) memories.push(`压力反应：${member.seedMemory.under_pressure}`);
  return memories.slice(0, 3);
}

function d4TopicGroupIds(topic, d4GroupState) {
  const topicText = String(topic || "");
  return Object.keys(d4GroupState || {}).filter((groupId) => topicText.includes(groupId));
}

function formatD4GroupStateForTopic(state, topic) {
  const groupState = state.d4_group_state || {};
  const groupIds = d4TopicGroupIds(topic, groupState);
  const active = groupIds.length
    ? groupIds.map((groupId) => ({ group_id: groupId, ...(groupState[groupId] || {}) }))
    : [];
  const recent = state.d4_recent_review || null;
  if (!active.length && !recent) return "";
  const activeLines = active.map((item) => [
    `${item.group_name || item.group_id}`,
    `注意宽度=${scoreStateBand(item.attention_breadth, ["只盯一两张", "能看主要卡", "会扫全局"])}`,
    `技术理解=${scoreStateBand(item.technical_comprehension, ["没太看懂", "大概知道", "比较懂"])}`,
    `卡片信心=${scoreStateBand(item.card_confidence, ["没底", "一般", "愿意坚持"])}`,
    `成本不适=${scoreStateBand(item.cost_discomfort, ["不太担心", "有点担心", "明显担心"])}`,
    `所有权=${scoreStateBand(item.ownership_commitment, ["不太护卡", "有点在意", "会护自己选的卡"])}`,
    `让步倾向=${scoreStateBand(item.social_yielding, ["不太让", "会听别人", "容易随大流"])}`,
    item.ignored_reason ? `忽略/犹豫=${item.ignored_reason}` : "",
    item.last_segment_position ? `上一轮立场=${item.last_segment_position}` : ""
  ].filter(Boolean).join("；"));
  const recentLine = recent
    ? `刚复核过 ${recent.group_name || recent.group_id}：自己卡保留 ${recent.own_retained}/${recent.own_total}，本格最终=${recent.final_cards.join("、") || "无"}；心态=${recent.effect_label}`
    : "";
  return [
    "【D4 私有状态】",
    "这是你自己对选卡界面的理解、犹豫和承诺，不要逐字念出来；让它影响你是否开口、坚持、沉默或让步。",
    ...activeLines,
    recentLine
  ].filter(Boolean).join("\n");
}

function formatD4PricingResidue(state) {
  const groups = Object.values(state.d4_group_state || {}).filter((item) => item && item.group_id);
  if (!groups.length && !state.d4_recent_review) return "";
  const byCost = groups.slice().sort((a, b) => Number(b.cost_discomfort || 0) - Number(a.cost_discomfort || 0))[0];
  const byOwnership = groups.slice().sort((a, b) => {
    const aScore = Number(a.card_confidence || 0) + Number(a.ownership_commitment || 0);
    const bScore = Number(b.card_confidence || 0) + Number(b.ownership_commitment || 0);
    return bScore - aScore;
  })[0];
  const byUncertainty = groups.slice().sort((a, b) => {
    const aScore = Number(a.technical_comprehension || 0) + Number(a.attention_breadth || 0);
    const bScore = Number(b.technical_comprehension || 0) + Number(b.attention_breadth || 0);
    return aScore - bScore;
  })[0];
  const recent = state.d4_recent_review || null;
  const lines = [];
  const used = new Set();
  function addLine(item, text) {
    if (!item || used.has(`${item.group_id}:${text}`)) return;
    used.add(`${item.group_id}:${text}`);
    lines.push(text);
  }
  if (recent) {
    addLine(recent, `刚才最后复核的是 ${recent.group_name || recent.group_id}：你自己原来选的卡保留 ${recent.own_retained}/${recent.own_total}，留下的感觉是“${recent.effect_label}”。`);
  }
  if (byCost && Number(byCost.cost_discomfort || 0) >= 0.5) {
    addLine(byCost, `${byCost.group_name || byCost.group_id} 让你有成本/复杂度压力：${scoreStateBand(byCost.cost_discomfort, ["还好", "有点担心", "明显担心"])}，定价时容易想“别卖得太虚”。`);
  }
  if (byOwnership && Number(byOwnership.ownership_commitment || 0) >= 0.34) {
    addLine(byOwnership, `${byOwnership.group_name || byOwnership.group_id} 里你有想护住的卡：${scoreStateBand(byOwnership.card_confidence, ["没底", "一般", "愿意坚持"])}，定价时可能会觉得不能把价值卖便宜。`);
  }
  if (byUncertainty && (Number(byUncertainty.technical_comprehension || 0) < 0.52 || Number(byUncertainty.attention_breadth || 0) < 0.52)) {
    addLine(byUncertainty, `${byUncertainty.group_name || byUncertainty.group_id} 你其实没完全看透：技术理解=${scoreStateBand(byUncertainty.technical_comprehension, ["没太看懂", "大概知道", "比较懂"])}，可能会少说或跟着别人走。`);
  }
  return [
    "【D4 选卡残留进入 D5】",
    "这是刚才选卡过程留在你心里的私有记忆；定价时可以把它自然说成犹豫、坚持、沉默或改口，不要逐字念状态名。",
    ...lines.slice(0, 4)
  ].filter(Boolean).join("\n");
}

function formatBehavioralState(member, topic, isLeader = false, arm = "legacy") {
  const state = ensureBehavioralState(member, isLeader);
  const memories = activatedMemoryLines(member, topic);
  const isPricing = /定价|售价|price/u.test(String(topic || ""));
  const review = isPricing && state.d5_card_review ? state.d5_card_review : null;
  const d4State = hasD5D4ResidueArm(arm) && isPricing
    ? formatD4PricingResidue(state)
    : /选卡|功能|能力|R2/u.test(String(topic || ""))
    ? formatD4GroupStateForTopic(state, topic)
    : "";
  state.activated_memory = memories;
  return [
    "【当前主观状态】",
    `注意力：${state.attention_focus}`,
    `信心：${scoreStateBand(state.confidence, ["没底", "一般", "有把握"])}`,
    `困惑：${scoreStateBand(state.confusion, ["清楚", "有点不确定", "没完全看懂"])}`,
    `疲劳/敷衍：${scoreStateBand(state.fatigue, ["还投入", "有点想快点过", "明显想省事"])}`,
    `公开承诺压力：${scoreStateBand(state.social_commitment, ["还没站队", "有点站队", "不太想改口"])}`,
    `价格敏感：${scoreStateBand(state.price_sensitivity, ["不怕高价", "会权衡", "担心卖贵"])}`,
    formatR1ActorCarryoverForPrompt(member),
    review ? [
      "【D5 前私有选卡复盘】",
      "这是你自己的心理状态，不要逐字念出来；只让它影响你此刻怎么说话、坚持或退让。",
      `你觉得产品价值：${review.value_feel}`,
      `你对成本/复杂度的感觉：${review.cost_feel}`,
      `你自己选的卡被保留：${review.own_cards_retained}/${review.own_cards_total}`,
      `定价冲动：${review.pricing_impulse_label}`,
      `容易开口的角度：${review.speaking_angle}`
    ].join("\n") : "",
    d4State,
    state.last_public_position ? `刚才公开立场：${state.last_public_position}` : "",
    memories.length ? `此刻被激活的经历/惯性：${memories.join("；")}` : ""
  ].filter(Boolean).join("\n");
}

function updateBehavioralStateAfterUtterance(member, { topic, beat, text, isLeader = false, nonverbal = false }) {
  const state = ensureBehavioralState(member, isLeader);
  const topicText = String(topic || "");
  const speech = String(text || "");
  state.fatigue = clamp(state.fatigue + 0.025 + (nonverbal ? 0.015 : 0), 0, 1);
  if (beat?.kind === "low_effort" || nonverbal) state.fatigue = clamp(state.fatigue + 0.06, 0, 1);
  if (beat?.kind === "status_story" || beat?.kind === "leader_wrap" || beat?.kind === "long_relevant") {
    state.confidence = clamp(state.confidence + 0.05, 0, 1);
    state.social_commitment = clamp(state.social_commitment + 0.08, 0, 1);
  }
  if (beat?.kind === "short_doubt" || /不确定|担心|怕|看不懂|纠结/u.test(speech)) {
    state.confusion = clamp(state.confusion + 0.06, 0, 1);
    state.confidence = clamp(state.confidence - 0.03, 0, 1);
  }
  if (/同意|就这样|先这样|我认|我倾向|我建议|我觉得/u.test(speech)) {
    state.social_commitment = clamp(state.social_commitment + 0.05, 0, 1);
  }
  if (/低价|便宜|抢量|走量|审批|预算|太贵|采购/u.test(speech)) {
    state.price_sensitivity = clamp(state.price_sensitivity + 0.07, 0, 1);
    state.last_public_position = "担心价格太高或希望更容易成交";
  }
  if (/高价|价值感|高端|守毛利|毛利|溢价|服务承诺|售后/u.test(speech)) {
    state.price_sensitivity = clamp(state.price_sensitivity - 0.06, 0, 1);
    state.last_public_position = "支持用价格撑住价值或服务承诺";
  }
  if (/定价|售价|price/u.test(topicText)) state.attention_focus = "价格会不会让用户或采购方接受";
  else if (/选卡|功能|能力|R2/u.test(topicText)) state.attention_focus = "能力卡是否真的贴合用户痛点";
  else if (/市场|定位|Round 1|VP/u.test(topicText)) state.attention_focus = "目标用户和痛点是否讲得通";
  return state;
}

function formatTaskBlindRoomProfile(member, isLeader) {
  const required = {
    "角色": member.role,
    "行业经验": member.industry,
    "决策风格": member.decisionStyle,
    "表达风格": member.expressionStyle,
    "盲区": member.blindSpots,
    "定价倾向": member.pricingBias,
    "发言倾向": member.speaking_tendency
  };
  for (const [label, value] of Object.entries(required)) {
    if (!String(value || "").trim()) throw new Error(`task_blind member ${member.profile_id} missing ${label}; refusing empty injection`);
  }
  return [
    `姓名代号：${member.profile_id}`,
    "【人物小传】",
    member.task_blind_biography,
    `角色：${member.role}`,
    `行业经验：${member.industry}`,
    `决策风格：${member.decisionStyle}`,
    `表达风格：${splitExpressionStyle(member.expressionStyle).display || member.expressionStyle}`,
    `盲区：${member.blindSpots}`,
    `定价倾向：${member.pricingBias}`,
    `发言倾向：${member.speaking_tendency}`,
    isLeader ? "你是组长，负责推进讨论、总结共识并代表全队提交。" : "你是普通队员。",
    "你现在就是小传中的这个人。像本人临场一样看界面、说话和行动，不要复述或分析小传，不要把自己变成顾问。",
    "你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的经验发言；不要输出隐藏模型分析。"
  ].filter(Boolean).join("\n");
}

function formatProfile(member, isLeader, arm = "legacy") {
  if (isTaskBlindNarrativeMember(member)) {
    if (isRoomRoleplayArm(arm)) return formatTaskBlindRoomProfile(member, isLeader);
    return formatTaskBlindNarrativePersona(member, isLeader);
  }
  if (arm === "simple") {
    return [
      `姓名代号：${member.profile_id}`,
      formatSurface(member),
      isLeader ? "你是组长，负责推进讨论、总结共识并代表全队提交。" : "你是普通队员。",
      "你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的直觉发言。",
      "不要把自己当研究助理，不要输出隐藏模型分析；发言像真实小组讨论，简短、自然、可以不完美。"
    ].join("\n");
  }
  if (isLayeredNoMapArm(arm)) {
    return [
      `姓名代号：${member.profile_id}`,
      formatSurface(member, { includeBehavior: true }),
      "",
      "【Layered persona system prompt（no-map）】",
      member.layeredSystemPrompt,
      "",
      `角色：${member.role}`,
      `行业经验：${member.industry}`,
      `背景：${member.background}`,
      `决策风格：${member.decisionStyle}`,
      `风险偏好：${member.riskPreference}`,
      `盲区：${member.blindSpots}`,
      `定价倾向：${member.pricingBias}`,
      `发言倾向：${member.speaking_tendency}`,
      isLeader ? "你是组长，负责推进讨论、总结共识并代表全队提交。" : "你是普通队员。",
      isRoomRoleplayArm(arm)
	        ? [
	            `【课堂行为倾向】${formatClassroomBehavior(member, isLeader)}`,
	            personaVoiceCue(member, isLeader),
	            isStatefulRoomRoleplayArm(arm)
	              ? "你的人设不是一段固定简介，而会随着讨论更新：你刚才说过的话、被别人接住或忽略、你现在注意到什么，都会影响下一轮反应。"
	              : "",
            "你现在就是上面这位 EMBA 课堂参与者。发言时必须用 TA 的第一人称口吻、表达节奏、词汇习惯和犹豫方式；不要统一成顾问报告腔，不要像研究助理，也不要替别人总结。",
            "你坐在真实课堂讨论室里，正和队友一起看同一个网页界面。发言要像真人临场讨论：可以犹豫、接话、改口、说半句。",
            "你不是为了把题答满；如果你的课堂状态偏话少、敷衍、跑题或没完全看懂界面，就照这个状态说很短，甚至只接一句。"
          ].filter(Boolean).join("\n")
        : "你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的经验发言；不要输出隐藏模型分析。",
      "不要引用认知地图；本 arm 不注入 map_xx 记忆。"
    ].filter(Boolean).join("\n");
  }
  return [
    `姓名代号：${member.profile_id}`,
    member.surface ? "" : `原型：${member.label}（${member.desc}）`,
    member.surface ? formatSurface(member, { includeBehavior: true }) : "",
    `角色：${member.role}`,
    `行业经验：${member.industry}`,
    `背景：${member.background}`,
    `决策风格：${member.decisionStyle}`,
    `表达风格：${splitExpressionStyle(member.expressionStyle).display || member.expressionStyle}`,
    `盲区：${member.blindSpots}`,
    `定价倾向：${member.pricingBias}`,
    `发言倾向：${member.speaking_tendency}`,
    isLeader ? "你是组长，负责推进讨论、总结共识并代表全队提交。" : "你是普通队员。",
    "你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的经验发言；不要输出隐藏模型分析。"
  ].filter(Boolean).join("\n");
}

function formatR1UiProfile(member, isLeader, arm = "legacy") {
  if (isTaskBlindNarrativeMember(member)) {
    return formatTaskBlindNarrativePersona(member, isLeader);
  }
  const surface = member.surface ? formatSurface(member, { includeBehavior: true }) : "";
  const profile = member.career_general_profile || {};
  const decisionProfile = isCareerGeneralProfileMember(member)
    ? [
        "【行为画像】",
        profile.information_search_and_stopping ? `搜索和停手：${profile.information_search_and_stopping}` : "",
        profile.cognitive_effort ? `思考投入：${profile.cognitive_effort}` : "",
        profile.belief_updating ? `听异议和改判断：${profile.belief_updating}` : "",
        profile.risk_posture ? `风险取向：${profile.risk_posture}` : "",
        profile.ambiguity_response ? `面对信息不足：${profile.ambiguity_response}` : "",
        profile.goal_regulation ? `目标编码：${profile.goal_regulation}` : "",
        profile.time_orientation ? `时间权衡：${profile.time_orientation}` : "",
        profile.action_and_recovery ? `行动和恢复：${profile.action_and_recovery}` : ""
      ].filter(Boolean).join("\n")
    : `决策风格：${member.decisionStyle}`;
  return [
    `姓名代号：${member.profile_id}`,
    surface || `原型：${member.label}（${member.desc}）`,
    `角色：${member.role}`,
    `行业经验：${member.industry}`,
    `背景：${member.background}`,
    decisionProfile,
    `表达风格：${splitExpressionStyle(member.expressionStyle).display || member.expressionStyle}`,
    `盲区：${member.blindSpots}`,
    `发言倾向：${member.speaking_tendency}`,
    isLeader ? "你是组长，负责推进讨论、总结共识并代表全队提交。" : "你是普通队员。",
    `【课堂行为倾向】${formatClassroomBehavior(member, isLeader, { includeCalculation: false })}`,
    personaVoiceCue(member, isLeader),
    isStatefulRoomRoleplayArm(arm)
      ? "你的人设不是一段固定简介，而会随着讨论更新：你刚才说过的话、被别人接住或忽略、你现在注意到什么，都会影响下一轮反应。"
      : "",
    "你现在就是上面这位 EMBA 课堂参与者。发言时必须用 TA 的第一人称口吻、表达节奏、词汇习惯和犹豫方式；不要统一成顾问报告腔，不要像研究助理，也不要替别人总结。",
    "你坐在真实课堂讨论室里，正和队友一起看同一个网页界面。发言要像真人临场讨论：可以犹豫、接话、改口、说半句。",
    "你不是为了把题答满；如果你的课堂状态偏话少、敷衍、跑题或没完全看懂界面，就照这个状态说很短，甚至只接一句。",
    "不要引用认知地图；本 arm 不注入 map_xx 记忆。"
  ].filter(Boolean).join("\n");
}

function formatJinang(draw) {
  return [
    `市场锦囊：${draw.market.name}。${draw.market.desc_for_player}`,
    `技术锦囊：${draw.tech.name}。${draw.tech.desc_for_player}`
  ].join("\n");
}

function armDefinitionNote(arm) {
  if (arm === "simple") {
    return "simple: random42 surface identity + MBTI/expression style only; no archetype business fields, L0/L1, or cognitive map.";
  }
				  if (isLayeredNoMapArm(arm)) {
				    if (hasR1ActorIsolatedArm(arm)) {
				      return "team_room_r1_actor_isolated_v1: R1 UI experiment with a public-environment narrator, one private protagonist state per member, and one isolated actor call at a time. Only spoken lines enter shared history; only explicit leader UI actions change deterministic page state; no moderator, omniscient screenplay writer, convergence classifier, or leader submitter creates the outcome.";
				    }
			    if (hasR1ScreenplayArm(arm)) {
			      return "team_room_r1_screenplay_v1: R1-only UI screenplay experiment. Members first make persona-native natural choices from the Round 1 personal UI only; the team then sees the same public group distribution, final-choice, and VP-writing UI surfaces and generates one classroom screenplay scene without iterative shared-transcript prompting or moderator convergence checks. No student-material summary is injected. The final R1 grid, architecture, and VP fields are deterministically validated from the screenplay final_submission.";
			    }
		    if (hasR1ReadingStoryArm(arm)) {
		      return "team_room_r1_reading_story_v1: same R2 mechanics as team_room_story_d4d5_narrator_d5_v1, but R1 first creates a persona-native price-free reading memory from the student materials, sanitizes any price hints, then writes a natural-language interface/process scene; a posthoc parser extracts grid_id, architecture, and VP fields for settlement.";
		    }
		    if (hasR1StoryProcessArm(arm)) {
		      return "team_room_r1_story_process_v1: same R2 mechanics as team_room_story_d4d5_narrator_d5_v1, but R1 independent proposals are written as persona-native natural-language interface/process scenes with no JSON visible to the decision agent; a posthoc parser extracts grid_id, architecture, and VP fields for settlement.";
		    }
	    if (hasR1PrivateTraceArm(arm)) {
	      return "team_room_r1_private_trace_v1: same R2 mechanics as team_room_story_d4d5_narrator_d5_v1, but each R1 independent proposal first records a private interface-reading trace (noticed options, persona anchor, jinang anchor, tradeoff, ignored/misread options, provisional choice) in the same JSON call before the formal R1 submission.";
	    }
	    if (hasR1NarratorActorArm(arm)) {
	      return "team_room_story_r1_d4d5_narrator_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; R1 first generates a narrator scene plus private protagonist state for each member, then members react from only their own state before the leader submits; D4 remains screenplay-indexed by legal card actions, and D5 uses narrator-private-state actor turns with final price indexed from legal UI slider actions.";
	    }
	    if (hasD5NarratorActorArm(arm)) {
	      return "team_room_story_d4d5_narrator_d5_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; D4 remains screenplay-indexed by legal card actions, while D5 first generates a narrator scene plus private protagonist state for each member, then each member acts from only their own state; final price is deterministically indexed from legal UI slider actions.";
	    }
	    if (hasD5ScreenplayArm(arm)) {
	      return "team_room_story_d4d5_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; D4 individual card picking uses private micro-scene/action_trace, D4 six function reviews are written as screenplay beats with UI card actions, and D5 pricing is written as a screenplay of persona-driven lines plus UI slider actions; final D4 cards and D5 price are deterministically indexed from legal UI actions.";
	    }
	    if (hasD4StoryPickArm(arm)) {
	      return "team_room_story_d4_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; D4 individual card picking is driven by a private micro-scene/action_trace (noticed/misread/skipped/selected cards) and the selected actions are deterministically converted into personal card submissions before team review.";
	    }
	    if (usesD5TranscriptPriceParser(arm)) {
	      return "team_room_d4_stateful_d5_nosubmit_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; D4 individual card picking records private stance/confidence, each function-dimension review updates per-member D4 state, D5 exposes that D4 state as private natural-language residue, and final price is deterministically parsed from the discussion transcript without an LLM leader submitter.";
	    }
	    if (hasD4StatefulPickArm(arm)) {
	      return "team_room_d4_stateful_pick_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; D4 individual card picking records private stance/confidence, then each function-dimension review updates per-member D4 state (attention_breadth, technical_comprehension, card_confidence, cost_discomfort, ownership_commitment, social_yielding) that feeds later D4 discussion and D5 private card-review pricing.";
	    }
    if (hasD4HumanPickArm(arm)) {
      return "team_room_d4_human_pick_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; D4 individual card picking is transcript-first and records private card stances (must/nice/impulse/unsure), ignored groups, doubts, and a deterministic conflict board before team review; D5 inherits private card-review state and direct slider discussion.";
    }
    if (hasD5CardReviewState(arm)) {
      return "team_room_roleplay_stateful_review_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; transcript-first room discussion with per-member behavioral_state; before D5, a deterministic private card-review state machine seeds value_feel, cost_feel, retained-own-card stake, and pricing_impulse, then D5 uses direct slider discussion with posthoc action/tier indexing.";
    }
    if (isStatefulRoomRoleplayArm(arm)) {
      return "team_room_roleplay_stateful_v1: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; transcript-first room discussion with per-member behavioral_state lines, triggered memories, path-dependent state updates, and direct D5 price discussion with posthoc action/tier indexing.";
    }
    if (isRoomRoleplayArm(arm)) {
      return "team_room_roleplay_ui: random42 surface + deterministic no-map L0/L1 persona; UI-visible information only; transcript-first room discussion, D5 pricing-action-persona stages, then parser extracts explicit submit actions.";
    }
    return "team_layered_nomap: random42 surface + archetype business fields + deterministic L0 seed_memory + deterministic L1 classroom_profile; cognitive maps are not injected.";
  }
  if (arm === "layered") {
    return "layered (deprecated partial): random42 surface + archetype business fields/pricingBias/speaking_tendency only; no deterministic L0/L1 classroom profile and no cognitive map.";
  }
  return "legacy: deterministic profile pool from scripts/sim/persona_pool.js manager archetypes.";
}

function formatTranscript(transcript) {
  if (!transcript.length) return "（暂无共享发言）";
  return transcript.map((item) => `${item.speaker}: ${item.text}`).join("\n");
}

function formatRecentTranscript(transcript, count = 8) {
  const recent = transcript.slice(-count);
  return formatTranscript(recent);
}

function formatR1ActorPublicTranscript(transcript, members, count = 8) {
  const nameById = new Map(members.map((member) => [member.profile_id, member.surface?.name || member.profile_id]));
  return transcript.slice(-count).map((item) => {
    const speaker = nameById.get(item.speaker) || (item.speaker === "screen" ? "屏幕" : (item.speaker === "narrator" ? "旁白" : item.speaker));
    return `${speaker}: ${item.text}`;
  }).join("\n") || "（暂无共享发言）";
}

function formatR1ActorPhaseTranscript(transcript, members, phase, chars = 12000) {
  const nameById = new Map(members.map((member) => [member.profile_id, member.surface?.name || member.profile_id]));
  const rendered = transcript
    .filter((item) => item.phase === phase)
    .map((item, index) => `${index + 1}. ${nameById.get(item.speaker) || item.speaker}: ${item.text}`)
    .join("\n");
  return clipText(rendered, chars) || "（本阶段还没有人公开说话）";
}

function clipText(value, chars = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if ([...text].length <= chars) return text;
  return `${[...text].slice(0, chars).join("").trim()}...`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roomSpeechLimits(beat) {
  const kind = beat?.kind || "";
  if (kind === "low_effort" || kind === "terse_agree" || kind === "short_doubt") return { sentences: 1, chars: 70 };
  if (kind === "short_view" || kind === "quick_calc" || kind === "leader_probe") return { sentences: 1, chars: 95 };
  if (kind === "bridge") return { sentences: 2, chars: 120 };
  if (kind === "status_story" || kind === "tangent" || kind === "leader_wrap") return { sentences: 2, chars: 155 };
  if (kind === "long_relevant") return { sentences: 2, chars: 175 };
  return { sentences: 2, chars: 160 };
}

function clampRoomSpeech(text, beat) {
  const { sentences, chars } = roomSpeechLimits(beat);
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return normalized;
  const sentenceParts = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/gu) || [normalized];
  let clipped = sentenceParts.slice(0, sentences).join("").trim();
  if ([...clipped].length > chars) {
    const clauses = clipped.match(/[^，,、]+[，,、]?/gu) || [clipped];
    let next = "";
    for (const clause of clauses) {
      if ([...(next + clause)].length > chars) break;
      next += clause;
    }
    clipped = next.trim() || [...clipped].slice(0, chars).join("").trim();
    clipped = clipped.replace(/[，,、：:；;]+$/u, "");
    if (!/[。！？!?]$/u.test(clipped)) clipped += "。";
  }
  return clipped;
}

function sanitizeRoomSpeech(raw, member, beat = null) {
  let text = String(raw || "").trim();
  const labels = [
    member.profile_id,
    member.surface?.name
  ].map((item) => String(item || "").trim()).filter(Boolean);
  if (!labels.length) return text;
  const labelPattern = labels.map(escapeRegExp).join("|");
  const prefixPattern = new RegExp(`^\\s*[（(]?(?:${labelPattern})[）)]?\\s*[:：,，、]\\s*`, "u");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text.replace(prefixPattern, "").trim();
    if (next === text) break;
    text = next;
  }
  return clampRoomSpeech(text, beat);
}

function formatGroup(group) {
  return [
    `${group.name} (${group.group_id})`,
    ...group.capabilities.map((cap) => {
      const tiers = Object.keys(cap.tiers).map((tier) => {
        const params = RD.getCapabilityParams(cap.cap_id, tier);
        return `${tier}: ${params.dCOGS}元增量/研发${params.nre_tier}万/${cap.tiers[tier].load}负载`;
      }).join("；");
      return `- ${cap.cap_id}｜${cap.name}｜覆盖=${cap.covers.join("、")}｜${cap.nre_desc || ""}｜档位=${tiers}`;
    })
  ].join("\n");
}

function allowedCardsForGroups(capabilityGroups, groupIds) {
  const allowed = new Set(groupIds || []);
  const rows = [];
  for (const group of capabilityGroups.groups || []) {
    if (allowed.size && !allowed.has(group.group_id)) continue;
    for (const cap of group.capabilities || []) {
      rows.push({
        group_id: group.group_id,
        cap_id: cap.cap_id,
        name: cap.name || cap.cap_id
      });
    }
  }
  return rows;
}

function formatAllowedCardsForPrompt(allowedCards) {
  const rows = Array.isArray(allowedCards) ? allowedCards : [];
  if (!rows.length) return "";
  return rows
    .map((row) => `- cap_id=${row.cap_id}（${row.name || row.cap_id}；group=${row.group_id}）`)
    .join("\n");
}

function submitConstraintText(decisionType, context = {}) {
  if (decisionType === "r1") {
    return [
      "【界面提交约束】",
      "grid_id 必须逐字使用下面 12 个之一，禁止把 Experience/Hybrid/Function 拼进 grid_id。",
      GRID_IDS.map((gridId) => `- ${gridId}: ${getGrid(gridId).label}`).join("\n"),
      "architecture 只能是 Experience / Hybrid / Function。"
    ].join("\n");
  }
  if (decisionType === "pricing_action") {
    return [
      "【界面提交约束】",
      "本阶段只提交定价动作，不提交具体价格。",
      "定价动作只能是：压低售价抢量 / 抬高售价守毛利。"
    ].join("\n");
  }
  if (decisionType === "pricing_tier") {
    return [
      "【界面提交约束】",
      "本阶段只提交相对档位，不提交具体价格。",
      "相对档位只能是：高 / 中 / 低。高/中/低只是滑块相对位置，不是固定数值段。"
    ].join("\n");
  }
  if (decisionType !== "cards") return "";
  const allowedText = formatAllowedCardsForPrompt(context.allowedCards);
  return [
    "【界面提交约束】",
    "本次只能从下面真实卡片里点选；cap_id 必须逐字一致，禁止自己编 ID。",
    allowedText,
    "tier 只能是 low / mid / high。",
    context.compatibilityFeedback ? `上一次界面错误提示：${context.compatibilityFeedback}` : ""
  ].filter(Boolean).join("\n");
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

function traceText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`private_trace.${field} required`);
  return text;
}

function traceTextList(value, field) {
  const items = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[、,，;\n]/u);
  const normalized = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!normalized.length) throw new Error(`private_trace.${field} required`);
  return normalized;
}

function normalizeTraceArchitecture(value) {
  const raw = String(value ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower === "experience" || raw.includes("体验")) return "Experience";
  if (lower === "hybrid" || raw.includes("混合")) return "Hybrid";
  if (lower === "function" || raw.includes("功能")) return "Function";
  throw new Error(`private_trace.provisional_choice invalid architecture: ${value}`);
}

function normalizeTraceConfidence(value) {
  const raw = String(value ?? "").trim();
  const numeric = Number(raw.replace("%", ""));
  if (Number.isFinite(numeric)) {
    return raw.includes("%") ? clamp(numeric / 100, 0, 1) : clamp(numeric, 0, 1);
  }
  if (/高|强|确定|很有把握/u.test(raw)) return 0.8;
  if (/中|一般|犹豫|还行/u.test(raw)) return 0.5;
  if (/低|弱|不确定|没底/u.test(raw)) return 0.25;
  return null;
}

function validateR1PrivateTraceBundle(parsed) {
  const root = parsed && typeof parsed === "object" ? parsed : {};
  const trace = root.private_trace || root.r1_private_trace || root.trace;
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    throw new Error("private_trace object required");
  }
  const provisional = trace.provisional_choice || {};
  const provisionalGrid = traceText(provisional.grid_id, "provisional_choice.grid_id");
  if (!GRID_IDS.includes(provisionalGrid)) {
    throw new Error(`private_trace.provisional_choice invalid grid_id: ${provisionalGrid}`);
  }
  const confidence = normalizeTraceConfidence(trace.confidence);
  const submission = root.r1_submission || root.submission || root.formal_submission || root.proposal;
  if (!submission || typeof submission !== "object" || Array.isArray(submission)) {
    throw new Error("r1_submission object required");
  }
  return {
    private_trace: {
      scene_state: traceText(trace.scene_state, "scene_state"),
      first_noticed: traceTextList(trace.first_noticed, "first_noticed"),
      personal_anchor: traceText(trace.personal_anchor, "personal_anchor"),
      jinang_anchor: traceText(trace.jinang_anchor, "jinang_anchor"),
      tradeoff_seen: traceText(trace.tradeoff_seen, "tradeoff_seen"),
      ignored_or_misread: traceText(trace.ignored_or_misread, "ignored_or_misread"),
      private_line: traceText(trace.private_line, "private_line"),
      provisional_choice: {
        grid_id: provisionalGrid,
        architecture: normalizeTraceArchitecture(provisional.architecture)
      },
      confidence,
      confidence_raw: String(trace.confidence ?? "").trim()
    },
    r1_submission: validateParsed("r1", submission, {})
  };
}

function r1TracePromptBody(draw, gridList) {
  return [
    formatJinang(draw),
    "",
    "你刚坐进课堂讨论室，先独自看 Round 1 界面。",
    "先写一个私有界面阅读独白：它不是最优解报告，而是这个人看到界面后的即时记录，可以有漏看、误读、被自己经历牵引、被锦囊牵引、犹豫和偏见。",
    "然后再给出正式 R1 草稿提交。正式提交必须和前面的 provisional_choice 可以不一致，但若改了，要在 rationale 里自然说明为什么改。",
    `界面上的 12 个合法市场格：\n${gridList}`,
    "合法 architecture 只能是 Experience / Hybrid / Function。",
    "",
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。schema：",
    '{"private_trace":{"scene_state":"刚看到界面时的状态","first_noticed":["先注意到的市场格或架构"],"personal_anchor":"自己的经历把判断拉向哪里","jinang_anchor":"锦囊把判断拉向哪里","tradeoff_seen":"ToB/ToC、DIFF/COST、Experience/Hybrid/Function 的犹豫或取舍","ignored_or_misread":"哪些选项没认真看、误解或直接跳过","private_line":"一句自我独白","provisional_choice":{"grid_id":"12格之一","architecture":"Experience|Hybrid|Function"},"confidence":0到1},"r1_submission":{"grid_id":"12格之一","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}}'
  ].join("\n");
}

const R1_PRICE_FREE_READING_EXCERPT = [
  "课前材料摘要（已去掉所有售价、金额、价位和定价参照）：",
  "",
  "这是一台 AI 宠物/陪伴机器人原型机。它原本沿 Emotional Robotics 路线设计，核心不是执行任务，而是靠外观、触觉、动作、眼神和长期陪伴触发情感依恋。它会移动、会主动靠近人、能识别人和一些状态，也能被抱起和触摸；但它不是语音助手，不擅长执行指令，也没有完整自然语言对话能力。",
  "",
  "中国市场很复杂：供应链强，竞品多，情感消费在增长，但陪伴机器人从好奇体验变成持续使用并不容易。学生要在有限时间里决定卖给谁、解决什么、保持纯陪伴还是叠加功能。",
  "",
  "三个年龄场景都可能成立，没有哪个年龄段天然压倒其他年龄段。老人场景常围绕孤独、独居安全、子女牵挂、养老机构护理压力；成人场景常围绕独居、情绪支持、养宠替代、服务空间差异化；儿童场景常围绕陪伴、教育、家长焦虑、安全和无屏互动。",
  "",
  "ToC 和 ToB 的思路不同。ToC 更像家庭或个人自己决策，情感触发和使用体验很重要。ToB 更像机构或企业决策，需要说明它在机构场景里解决了什么运营、服务或体验问题，采购流程也更复杂。",
  "",
  "三种架构是取舍，不是优劣排序。Experience 偏深情感连接，适合把陪伴体验做深；Function 偏实用问题解决，适合明确任务和场景覆盖；Hybrid 同时兼顾情感与功能，但也有两头都不极致、容易变成中庸方案的风险。",
  "",
  "材料反复强调：VP 要说清 WHO、PAIN、HOW，并且架构与 VP 要自洽。好的选择不是选最像标准答案的格子，而是让目标人群、痛点、解法和架构形成一条可信的故事线。"
].join("\n");

const PRICE_HINT_SENTENCE_PATTERN = /(?:¥|￥|\d+\s*(?:元|块|万元|万|亿|%|折)|售价|定价|价位|价格|价钱|付费|支付意愿|支付|订阅费|月费|买断|贵|便宜|高价|低价|预算|利润|毛利|回本|渠道费|金额)/u;

function sanitizePriceHints(text) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (!PRICE_HINT_SENTENCE_PATTERN.test(source)) return source;
  const parts = source
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = parts.filter((part) => !PRICE_HINT_SENTENCE_PATTERN.test(part));
  const sanitized = kept.join("\n").trim();
  if (sanitized) return sanitized;
  return "我只记得这是一台偏情感陪伴的机器人，不同年龄段和机构/个人场景都可能成立，最后要看自己最相信哪个具体使用场景。";
}

function r1ReadingMemoryPromptBody(draw) {
  return [
    formatJinang(draw),
    "",
    R1_PRICE_FREE_READING_EXCERPT,
    "",
    "你刚读完课前材料，准备进入 Round 1。",
    "请用第一人称写一段你这个人真实留下的阅读印象：你记住了什么、被哪类场景打动、哪里没看懂或没认真看、你的行业经验和锦囊把你往哪里拉。",
    "不要写 JSON，不要列表，不要标题，不要像读书笔记。可以片面、可以漏看、可以误读；要像真人课前读完材料后脑子里留下的东西。",
    "不要提任何商业数字或财务判断；这一轮只留下产品、用户和场景印象。",
    "写 80-180 字。"
  ].join("\n");
}

function r1ReadingStoryPromptBody(draw, gridList, readingMemory) {
  return [
    formatJinang(draw),
    "",
    "你刚坐进课堂讨论室，屏幕上是 Round 1 市场选择界面。你脑子里还留着课前阅读后的个人印象：",
    readingMemory,
    "",
    "现在不要复述材料，也不要做商业分析报告。让这段阅读印象变成你这个人的背景感觉，然后用自己的习惯扫这个网页、顺手形成一个草稿。",
    "用第一人称写，像这个人当场小声想、跟旁边人嘟囔、或者在草稿框里随手打字。叙事风格必须贴近你的人设：词汇、节奏、懂不懂、认真不认真、会不会跑题，都按你自己来。",
    "不要写 JSON，不要 Markdown，不要列表，不要标题。不要逐项分析 12 个格子，也不要把 ToB/ToC、DIFF/COST、三种架构都讲一遍。你可以漏看、误读、只被一两个词吸引。",
    "这一段只谈目标用户、使用情境、产品形态和架构取舍；不要用商业数字或财务判断推动结论。",
    "不要复读人设提示里的口头禅原句；如果会说类似的话，也要像临场自然说出来。",
    "最后自然地说清楚：你在界面上先点哪个市场格、哪个架构按钮；草稿大概卖给谁、痛点是什么、打算怎么做。可以用界面原文，也可以顺口带上括号里的 id，别写成结构化字段。",
    "你点的市场格必须和草稿里的对象一致：点成人就写成人，点老人就写老人，点儿童就写儿童；点 ToB 就写机构/企业买单，点 ToC 就写家庭/个人买单。",
    "不要说“核心就是几个维度”这种旁观者分析话；你是在看界面并做一次临场选择。",
    "",
    `界面上的市场格按钮：\n${gridList}`,
    "架构按钮：Experience（体验型）、Hybrid（混合型）、Function（功能型）。",
    "",
    "写 120-260 字左右，像一段真实过程，不要像咨询报告。"
  ].join("\n");
}

function buildR1PersonalUiPanel(gridList) {
  const hideJinang = hideJinangFromSyntheticPrompts();
  const naturalStrategy = r1NaturalStrategyMode();
  const chatAskStrategy = r1NaturalStrategyChatAskMode();
  if (!naturalStrategy) {
    return [
      "【Round 1 UI：个人选择页】",
      "标题：选择你的战略定位。",
      hideJinang
        ? "说明：根据你对市场的判断，在下方地图上点击你认为最有机会的目标市场。"
        : "说明：根据你的锦囊能力和对市场的判断，在下方地图上点击你认为最有机会的目标市场。",
      "提示：这是你的个人初选，之后小组会看到所有人的选择，再一起讨论收敛。",
      hideJinang ? "" : "页面显示你的两张锦囊卡：市场锦囊、技术锦囊。",
      "",
      "差异化：靠独特体验或功能赢得用户，可以定更高价格，但目标人群更窄。",
      "成本领先：靠性价比和规模赢得用户，价格敏感但人群基数更大。",
      "",
      `市场地图上的 12 个可点击格子：\n${gridList}`,
      "",
      "你希望这款 AI 宠物机器人在这个市场中主要靠什么打动用户？",
      "体验型 ●：用户买的是情感价值和陪伴体验，功能够用就行。",
      "混合型 ▲：体验和功能都是卖点，缺一不可。",
      "功能型 ■：用户买的是实用功能，情感体验是锦上添花。",
      "",
      "一句话价值主张草稿（选填）。",
      "提示：尝试回答：给谁（WHO）、解决什么问题（PAIN）、怎么解决（HOW）。",
      "输入框 placeholder：描述目标客户、核心痛点和解决方式……",
      "提交按钮：提交我的选择。"
    ].filter(Boolean).join("\n");
  }
  return [
    "【Round 1 UI：个人选择页】",
    "阶段：市场定位。",
    "标题：选择你的战略定位。",
    hideJinang
      ? "说明：根据你对市场的判断，在下方地图上点击你认为最有机会的目标市场。"
      : "说明：根据你的锦囊能力和对市场的判断，在下方地图上点击你认为最有机会的目标市场。",
    "提示：这是你的个人初选，之后小组会看到所有人的选择，再一起讨论收敛。",
    "",
    hideJinang ? "" : "页面显示你的两张锦囊卡：市场锦囊、技术锦囊。",
    "",
    "竞争优势输入框：你打算靠什么赢过其他方案？可以写更特别、更适合、更好体验，也可以写更划算、更容易普及、更容易被采购采用。",
    "",
    "目标市场地图：行是消费者 (ToC) / 企业 (ToB)，列是儿童 / 成人 / 老人。",
    `目标市场按钮：\n${formatTargetMarketList()}`,
    "",
    "产品定位方向区：你希望这款 AI 宠物机器人在这个市场中主要靠什么打动用户？",
    "体验型 ●：用户买的是情感价值和陪伴体验，功能够用就行。",
    "混合型 ▲：体验和功能都是卖点，缺一不可。",
    "功能型 ■：用户买的是实用功能，情感体验是锦上添花。",
    "",
    "一句话价值主张草稿（选填）：尝试回答：给谁（WHO）、解决什么问题（PAIN）、怎么解决（HOW）。",
    "输入框 placeholder：例：为某类用户在某个日常场景里提供陪伴或帮助，通过具体机制缓解一个明确问题……",
    "提交按钮：提交我的选择。"
  ].filter(Boolean).join("\n");
}

function r1UiPersonalDraftPromptBody(member, draw, gridList) {
  const hideJinang = hideJinangFromSyntheticPrompts();
  const naturalStrategy = r1NaturalStrategyMode();
  const chatAskStrategy = r1NaturalStrategyChatAskMode();
  return [
    hideJinang ? "" : formatJinang(draw),
    "",
    buildR1PersonalUiPanel(gridList),
    "",
    hideJinang
      ? "你现在只是在操作上面这个 Round 1 UI。只根据页面可见文字和个人经验临场判断，不补充 UI 外的研究背景。"
      : "你现在只是在操作上面这个 Round 1 UI。只根据页面可见文字、自己的两张锦囊和个人经验临场判断，不补充 UI 外的研究背景。",
    naturalStrategy
      ? "界面没有让你直接点“差异化/成本领先”按钮；你只是在竞争优势输入框里用自己的话写打算靠什么赢。"
      : "界面已经给出“选择什么战略取得竞争优势”的简短说明。你可以按页面短说明、自己的行业经验、课堂状态和当下理解去操作，也可以理解得不完全标准。",
    chatAskStrategy
      ? "界面旁边有一个 chat 追问：你刚才这句“靠什么赢”，如果最后必须落到一个策略按钮，更接近 A 还是 B？A=更特别、更适合、体验或功能更好；B=更划算、更容易普及、更容易被采购采用。"
      : "",
    chatAskStrategy
      ? "这不是让你背 MBA 术语；像真人被系统或同伴追问一样，用自己的话答一下更接近 A 还是 B。"
      : "",
    naturalStrategy
      ? "不要把竞争优势写成 MBA 词典；像真人看界面一样，直接被某些词、格子或自己的经验牵着走。"
      : (hideJinang
          ? "不要把“差异化/成本领先”扩展成 MBA 词典；像真人看界面一样，直接被某些词或格子牵着走。"
          : "不要把“差异化/成本领先”扩展成 MBA 词典；像真人看界面一样，直接被某些词、格子或锦囊牵着走。"),
    "先按“说话导演提示”写这个人的脑内话：词汇、句长、行业黑话、犹豫方式都要像 TA；不要把所有人都写成同一种理性分析口吻。",
    hideJinang
      ? "多数真人不会完整复盘 12 个格子和 3 个架构；只写这个人最先注意到的一两处，可以漏看、看错、嫌麻烦、图省事。"
      : "多数真人不会完整复盘两张锦囊、12 个格子和 3 个架构；只写这个人最先注意到的一两处，可以漏看、看错、嫌麻烦、图省事。",
    "不要写 JSON，不要 Markdown，不要列表，不要标题；可以有半句话、改口、土话、公文腔、PPT 腔、PM 黑话或工程师吐槽。",
    naturalStrategy
      ? (chatAskStrategy
          ? "最后用很自然的一句话带出你点了哪个目标市场 id、产品定位方向、竞争优势输入框大概写了什么、chat 追问你选 A 还是 B，以及草稿框里的 WHO/PAIN/HOW；如果说 id，必须照按钮原样，比如 ToC_CHILD。"
          : "最后用很自然的一句话带出你点了哪个目标市场 id、产品定位方向、竞争优势输入框大概写了什么，以及草稿框里的 WHO/PAIN/HOW；如果说 id，必须照按钮原样，比如 ToC_CHILD。")
      : "最后用很自然的一句话带出你点了哪个市场格 id、哪个产品定位方向，以及草稿框里大概写了什么 WHO/PAIN/HOW；如果说 id，必须与上方按钮逐字一致。",
    "长度按人设来：话少的人 60-120 字也可以，话多的人最多 240 字；不要为了显得完整而写成长篇报告。"
  ].filter(Boolean).join("\n");
}

function normalizeR1NaturalSubmission(raw, fallbackLine = "", options = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const targetId = normalizeTargetMarketId(source);
  const target = getTargetMarket(targetId);
  if (!target) throw new Error(`invalid target_market_id: ${targetId}`);
  const strategyText = String(
    source.competitive_strategy_text
      ?? source.competitive_advantage
      ?? source.advantage_text
      ?? source.strategy_text
      ?? source["竞争优势"]
      ?? source["靠什么赢"]
      ?? fallbackLine
      ?? ""
  ).trim();
  const chatAskStrategy = r1NaturalStrategyChatAskMode();
  const strategyChoiceLine = String(
    source.strategy_choice_line
      ?? source.strategy_reason
      ?? source["追问回答"]
      ?? source["策略追问回答"]
      ?? ""
  ).trim();
  const explicitChoice = chatAskStrategy
    ? normalizeExplicitCompetitiveStrategyChoice(
        source.strategy_choice
          ?? source.competitive_strategy_choice
          ?? source.strategy
          ?? source["策略选择"]
          ?? source["追问选择"]
          ?? strategyChoiceLine
      )
    : null;
  const strategyIndex = chatAskStrategy ? null : indexCompetitiveStrategyText(strategyText);
  const clarification = options.strategyClarification || null;
  const gridStrategy = explicitChoice ? explicitChoice.strategy : (clarification?.strategy || strategyIndex.strategy);
  if (gridStrategy !== "COST" && gridStrategy !== "DIFF") {
    throw new Error(`competitive_strategy_ambiguous: ${strategyIndex?.reason || "unknown"}`);
  }
  const gridId = `${target.customer_type}_${gridStrategy}_${target.age}`;
  const vp = source.vp_summary || source.vp || source.value_proposition || source["价值主张"] || {};
  const parsed = validateParsed("r1", {
    grid_id: gridId,
    architecture: source.architecture ?? source.product_architecture ?? source["架构"],
    vp_summary: {
      who: vp.who ?? vp.WHO ?? source.who ?? source.WHO ?? source["目标用户"],
      pain: vp.pain ?? vp.PAIN ?? source.pain ?? source.PAIN ?? source["痛点"],
      how: vp.how ?? vp.HOW ?? source.how ?? source.HOW ?? source["方案"]
    },
    rationale: source.rationale ?? source.reason ?? source["理由"] ?? fallbackLine
  }, {});
  return {
    ...parsed,
    ...(strategyIndex
      ? {
          posthoc_strategy_index: {
            ...strategyIndex,
            strategy: gridStrategy,
            original_strategy: strategyIndex.strategy || null,
            clarification_used: Boolean(clarification),
            clarification_line: clarification?.clarification_line || null,
            clarification_rationale: clarification?.rationale || null
          }
        }
      : {}),
    ...(clarification
      ? {
          strategy_clarification: {
            strategy: clarification.strategy,
            line: clarification.clarification_line,
            rationale: clarification.rationale,
            raw: clarification.raw || null
          }
        }
      : {}),
    ...(explicitChoice
      ? {
          strategy_choice: explicitChoice.strategy_choice,
          strategy_choice_label: explicitChoice.strategy_choice_label,
          strategy_choice_raw: explicitChoice.strategy_choice_raw,
          strategy_choice_line: strategyChoiceLine || explicitChoice.strategy_choice_raw,
          competitive_strategy_choice: explicitChoice.strategy
        }
      : {}),
    target_market_id: targetId,
    competitive_strategy_text: strategyText
  };
}

async function parseR1NaturalPosthocSubmission({ text, temperature }) {
  const chatAskStrategy = r1NaturalStrategyChatAskMode();
  const messages = [
    {
      role: "system",
      content: [
        chatAskStrategy
          ? "你是信息抽取器，只抽取文本中已经表达的 Round 1 操作和 chat 追问里的 A/B 选择；不能替用户判断。"
          : "你是信息抽取器，只抽取文本中已经表达的 Round 1 操作，不判断差异化/成本领先。",
        chatAskStrategy
          ? "strategy_choice 必须来自文本里明确说出的 A/B 或等价表述；不明确就留空让校验失败。只输出可 JSON.parse 的 JSON。"
          : "不要把竞争优势分类；只保留原文意思。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "从下面自然语言中抽取：",
        `target_market_id 必须是：${TARGET_MARKET_OPTIONS.map((item) => item.target_id).join(", ")}`,
        "architecture 必须是：Experience / Hybrid / Function",
        "competitive_strategy_text 是这个人用自己的话写的“靠什么赢/竞争优势”，不要改写成差异化或成本领先标签。",
        chatAskStrategy
          ? "strategy_choice 必须是 A 或 B：A=更特别/更适合/体验或功能更好；B=更划算/更容易普及/更容易被采购采用。只抽取文本里的显式回答。"
          : "",
        chatAskStrategy
          ? "strategy_choice_line 保留这个人回答 A/B 时的自然语言原文。"
          : "",
        "vp_summary 必须有 who/pain/how。",
        chatAskStrategy
          ? '输出 JSON schema：{"target_market_id":"ToC_CHILD|ToB_CHILD|ToC_ADULT|ToB_ADULT|ToC_ELDER|ToB_ELDER","architecture":"Experience|Hybrid|Function","competitive_strategy_text":"原文式竞争优势","strategy_choice":"A|B","strategy_choice_line":"原文回答","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}'
          : '输出 JSON schema：{"target_market_id":"ToC_CHILD|ToB_CHILD|ToC_ADULT|ToB_ADULT|ToC_ELDER|ToB_ELDER","architecture":"Experience|Hybrid|Function","competitive_strategy_text":"原文式竞争优势","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}',
        "",
        "自然语言：",
        text
      ].join("\n")
    }
  ];
  const result = await callJson(messages, { temperature: Math.min(0.2, temperature), maxTokens: 420 });
  let strategyClarification = null;
  if (!chatAskStrategy) {
    const extracted = result.parsed && typeof result.parsed === "object" ? result.parsed : {};
    const strategyText = String(
      extracted.competitive_strategy_text
        ?? extracted.competitive_advantage
        ?? extracted.advantage_text
        ?? extracted.strategy_text
        ?? extracted["竞争优势"]
        ?? extracted["靠什么赢"]
        ?? ""
    ).trim();
    const index = indexCompetitiveStrategyText(strategyText || text);
    if (strategyIndexNeedsClarification(index)) {
      const clarified = await clarifyCompetitiveStrategyChoice({
        strategyText: strategyText || text,
        contextText: text,
        temperature
      });
      strategyClarification = {
        ...clarified.parsed,
        raw: clarified.raw
      };
    }
  }
  return {
    raw: result.raw,
    parsed: normalizeR1NaturalSubmission(result.parsed, text, { strategyClarification }),
    extractor_raw: result.parsed,
    strategy_clarification_raw: strategyClarification?.raw || null
  };
}

function r1StoryProcessPromptBody(draw, gridList) {
  return [
    formatJinang(draw),
    "",
    "你刚坐进课堂讨论室，屏幕上是 Round 1 市场选择界面。你不是在答商业分析题，而是在用自己的习惯扫这个网页、顺手形成一个草稿。",
    "用第一人称写，像这个人当场小声想、跟旁边人嘟囔、或者在草稿框里随手打字。叙事风格必须贴近你的人设：词汇、节奏、懂不懂、认真不认真、会不会跑题，都按你自己来。",
    "不要写 JSON，不要 Markdown，不要列表，不要标题。不要逐项分析 12 个格子，也不要把 ToB/ToC、DIFF/COST、三种架构都讲一遍。你可以漏看、误读、只被一两个词吸引。",
    "不要复读人设提示里的口头禅原句；如果会说类似的话，也要像临场自然说出来。",
    "最后自然地说清楚：你在界面上先点哪个市场格、哪个架构按钮；草稿大概卖给谁、痛点是什么、打算怎么做。可以用界面原文，也可以顺口带上括号里的 id，别写成结构化字段。",
    "你点的市场格必须和草稿里的对象一致：点成人就写成人，点老人就写老人，点儿童就写儿童；点 ToB 就写机构/企业买单，点 ToC 就写家庭/个人买单。",
    "不要说“核心就是几个维度”这种旁观者分析话；你是在看界面并做一次临场选择。",
    "",
    `界面上的市场格按钮：\n${gridList}`,
    "架构按钮：Experience（体验型）、Hybrid（混合型）、Function（功能型）。",
    "",
    "写 120-260 字左右，像一段真实过程，不要像咨询报告。"
  ].join("\n");
}

async function independentProposal(member, draw, isLeader, temperature, arm = "legacy") {
  const gridList = GRID_IDS.map((gridId) => `- ${gridId}: ${getGrid(gridId).label}`).join("\n");
  if (hasR1ScreenplayArm(arm) || hasR1ActorIsolatedArm(arm)) {
    const messages = [
      {
        role: "system",
	        content: hideJinangFromSyntheticPrompts()
	          ? `${formatR1UiProfile(member, isLeader, arm)}\n\n这次个人 UI 不显示锦囊卡；只根据页面可见内容和自己的临场判断操作。`
	          : `${formatR1UiProfile(member, isLeader, arm)}\n\n以下锦囊是你的私有 UI 信息，只能影响你自己的判断，不要假装别人知道。`
      },
      {
        role: "user",
        content: r1UiPersonalDraftPromptBody(member, draw, gridList)
      }
    ];
    let lastMessages = messages;
    let lastRaw = "";
    let lastError = "";
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        lastRaw = await callText(lastMessages, { temperature, maxTokens: 650 });
        const parsed = r1NaturalStrategyMode()
          ? await parseR1NaturalPosthocSubmission({ text: lastRaw, temperature })
          : await parseSubmission({
              text: lastRaw,
              decisionType: "r1",
              context: {},
              temperature
            });
        return {
          prompt: messages,
          raw: lastRaw,
          parsed: parsed.parsed,
          posthoc_parse_raw: parsed.raw,
          natural_strategy_extractor_raw: parsed.extractor_raw || null,
          attempts: attempt + 1,
          ui_mode: "round1_personal_choice_page"
        };
      } catch (error) {
        lastError = error.message;
        lastMessages = [
          {
            role: "system",
	            content: `${formatR1UiProfile(member, isLeader, arm)}\n你仍然只是在操作 Round 1 UI，不要输出 JSON。`
          },
          {
            role: "user",
            content: [
              `刚才后台没能从你的自然话里抽出合法 UI 提交，原因：${lastError}`,
              r1NaturalStrategyMode()
                ? "请像真人被同伴追问一样，用自然话补一句：你到底在 UI 上点哪个目标市场、哪个产品定位方向，竞争优势输入框写什么，草稿框写给谁、痛点是什么、怎么做。"
                : "请像真人被同伴追问一样，用自然话补一句：你到底在 UI 上点哪个市场格、哪个产品定位方向，草稿框写给谁、痛点是什么、怎么做。",
              "这句必须明确说出三个东西：WHO=卖给谁/谁使用，PAIN=他有什么问题，HOW=你怎么解决；不能只说“先不填”或“后面再讨论”。",
              r1NaturalStrategyMode()
                ? `合法目标市场只能从这些按钮里选：${TARGET_MARKET_OPTIONS.map((item) => item.target_id).join(", ")}`
                : `合法市场格只能从这些按钮里选：${GRID_IDS.join(", ")}`,
              r1NaturalStrategyChatAskMode()
                ? "chat 追问也要明确回答：更接近 A 还是 B。A=更特别/更适合/体验或功能更好；B=更划算/更容易普及/更容易被采购采用。"
                : "",
              "产品定位方向按钮只能是 Experience（体验型）、Hybrid（混合型）、Function（功能型）。",
              "不要 JSON，不要列表。",
              "",
              "你刚才说：",
              lastRaw
            ].join("\n")
          }
        ];
      }
    }
    throw new Error(`independent_proposal_r1_ui_parse_failure: ${lastError}`);
  }
  if (hasR1ReadingStoryArm(arm)) {
    const readingMessages = [
      {
        role: "system",
        content: `${formatProfile(member, isLeader, arm)}\n\n你正在读课堂材料。阅读不是考试，你会按自己的背景、耐心和注意力留下偏差。`
      },
      {
        role: "user",
        content: r1ReadingMemoryPromptBody(draw)
      }
    ];
    const readingMemoryRaw = await callText(readingMessages, { temperature, maxTokens: 550 });
    const readingMemory = sanitizePriceHints(readingMemoryRaw);
    const messages = [
      {
        role: "system",
        content: `${formatProfile(member, isLeader, arm)}\n\n以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。`
      },
      {
        role: "user",
        content: r1ReadingStoryPromptBody(draw, gridList, readingMemory)
      }
    ];
    let lastMessages = messages;
    let lastRaw = "";
    let lastError = "";
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        lastRaw = await callText(lastMessages, { temperature, maxTokens: 850 });
        const parsed = await parseSubmission({
          text: lastRaw,
          decisionType: "r1",
          context: {},
          temperature
        });
        return {
          reading_prompt: readingMessages,
          reading_memory_raw: readingMemoryRaw,
          reading_memory: readingMemory,
          reading_memory_sanitized: readingMemory !== String(readingMemoryRaw || "").trim(),
          prompt: messages,
          raw: lastRaw,
          parsed: parsed.parsed,
          posthoc_parse_raw: parsed.raw,
          attempts: attempt + 1
        };
      } catch (error) {
        lastError = error.message;
        lastMessages = [
          {
            role: "system",
            content: `${formatProfile(member, isLeader, arm)}\n你仍然是在这个课堂现场里，不要输出 JSON。`
          },
          {
            role: "user",
            content: [
              "你课前读材料后留下的个人印象：",
              readingMemory,
              "",
              `刚才后台没能从你的自然话里抽出合法提交，原因：${lastError}`,
              r1NaturalStrategyMode()
                ? "请像真人被同伴追问一样，用自然话补一句：你到底点哪个目标市场按钮、哪个架构按钮、竞争优势输入框写了什么，草稿卖给谁、痛点是什么、怎么做。"
                : "请像真人被同伴追问一样，用自然话补一句：你到底在界面上点哪个市场格、哪个架构按钮，草稿卖给谁、痛点是什么、怎么做。",
              r1NaturalStrategyMode()
                ? `合法目标市场按钮只能从这些里选：${TARGET_MARKET_OPTIONS.map((item) => item.target_id).join(", ")}`
                : `合法市场格只能从这些按钮里选：${GRID_IDS.join(", ")}`,
              "架构按钮只能是 Experience、Hybrid、Function。",
              "不要 JSON，不要列表。",
              "",
              "你刚才说：",
              lastRaw
            ].join("\n")
          }
        ];
      }
    }
    throw new Error(`independent_proposal_reading_story_parse_failure: ${lastError}`);
  }
  if (hasR1StoryProcessArm(arm)) {
    const messages = [
      {
        role: "system",
        content: `${formatProfile(member, isLeader, arm)}\n\n以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。`
      },
      {
        role: "user",
        content: r1StoryProcessPromptBody(draw, gridList)
      }
    ];
    let lastMessages = messages;
    let lastRaw = "";
    let lastError = "";
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        lastRaw = await callText(lastMessages, { temperature, maxTokens: 850 });
        const parsed = await parseSubmission({
          text: lastRaw,
          decisionType: "r1",
          context: {},
          temperature
        });
        return {
          prompt: messages,
          raw: lastRaw,
          parsed: parsed.parsed,
          posthoc_parse_raw: parsed.raw,
          attempts: attempt + 1
        };
      } catch (error) {
        lastError = error.message;
        lastMessages = [
          { role: "system", content: `${formatProfile(member, isLeader, arm)}\n你仍然是在这个课堂现场里，不要输出 JSON。` },
          {
            role: "user",
            content: [
              `刚才后台没能从你的自然话里抽出合法提交，原因：${lastError}`,
              "请像真人被同伴追问一样，用自然话补一句：你到底在界面上点哪个市场格、哪个架构按钮，草稿卖给谁、痛点是什么、怎么做。",
              `合法市场格只能从这些按钮里选：${GRID_IDS.join(", ")}`,
              "架构按钮只能是 Experience、Hybrid、Function。",
              "不要 JSON，不要列表。",
              "",
              "你刚才说：",
              lastRaw
            ].join("\n")
          }
        ];
      }
    }
    throw new Error(`independent_proposal_story_process_parse_failure: ${lastError}`);
  }
  if (hasR1PrivateTraceArm(arm)) {
    const messages = [
      {
        role: "system",
        content: `${formatProfile(member, isLeader, arm)}\n\n以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。`
      },
      {
        role: "user",
        content: r1TracePromptBody(draw, gridList)
      }
    ];
    let lastMessages = messages;
    let lastRaw = "";
    let lastError = "";
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        lastRaw = await callText(lastMessages, { temperature, maxTokens: 1900 });
        const bundle = validateR1PrivateTraceBundle(parseJsonLoose(lastRaw));
        return {
          prompt: messages,
          raw: lastRaw,
          parsed: bundle.r1_submission,
          private_trace: bundle.private_trace,
          attempts: attempt + 1
        };
      } catch (error) {
        lastError = error.message;
        lastMessages = [
          { role: "system", content: `${formatProfile(member, isLeader, arm)}\n你必须修正为合法 R1 私有 trace + 正式提交 JSON，不要引入新枚举。` },
          {
            role: "user",
            content: [
              `上一次输出无法解析或字段不合法，原因：${lastError}`,
              `合法 grid_id 只能是：${GRID_IDS.join(", ")}`,
              "架构只能是 Experience, Hybrid, Function。",
              "请重新输出同一个 schema，必须包含 private_trace 和 r1_submission。",
              "",
              "上一次输出：",
              lastRaw
            ].join("\n")
          }
        ];
      }
    }
    throw new Error(`independent_proposal_private_trace_parse_failure: ${lastError}`);
  }
  const userContent = isRoomRoleplayArm(arm)
    ? [
        formatJinang(draw),
        "",
        "你刚坐进课堂讨论室，先独自看 Round 1 界面，像真人一样想一下会先点哪个市场格、选什么架构、怎么写 WHO/PAIN/HOW。",
        "不要像顾问报告；可以有一两句犹豫或直觉判断。",
        `界面上的 12 个合法市场格：\n${gridList}`,
        "",
        "最后单独写一行【我的草稿提交】，先用人话明确 grid_id、architecture、WHO、PAIN、HOW 和一句理由。",
        '再给出可索引 JSON：{"grid_id":"...","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。'
      ].join("\n")
    : `${formatJinang(draw)}\n\n你们要进入中国陪伴机器人市场。请先独立提出 Round 1 战略：12 格市场、架构标签、WHO/PAIN/HOW。\n合法 grid_id 只能从以下列表选择：\n${gridList}\n\n自然语言说明理由，最后输出 JSON：{"grid_id":"...","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。`;
  const messages = [
    {
      role: "system",
      content: `${formatProfile(member, isLeader, arm)}\n\n以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。`
    },
    {
      role: "user",
      content: userContent
    }
  ];
  let lastMessages = messages;
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(lastMessages, { temperature, maxTokens: 1500 });
      const parsed = await parseSubmission({
        text: lastRaw,
        decisionType: "r1",
        context: {},
        temperature
      });
      return { prompt: messages, raw: lastRaw, parsed: parsed.parsed, attempts: attempt + 1 };
    } catch (error) {
      lastError = error.message;
      lastMessages = [
        { role: "system", content: `${formatProfile(member, isLeader, arm)}\n你必须修正为合法提交，不要引入新枚举。` },
        {
          role: "user",
          content: `上一次独立提案无法解析，原因：${lastError}\n合法 grid_id 只能是：${GRID_IDS.join(", ")}\n架构只能是 Experience, Hybrid, Function。\n请重新提交 Round 1 独立提案，最后输出同样 JSON。\n\n上一次输出：\n${lastRaw}`
        }
      ];
    }
  }
  throw new Error(`independent_proposal_parse_failure: ${lastError}`);
}

function buildR1ActorIsolatedSelectionScreen({ members, leaderIdx, draws, proposals, uiState }) {
  const publicSelections = proposals.map((proposal, index) => {
    const parsed = proposal?.parsed || {};
    return [
      `成员${String.fromCharCode(65 + index)}（${members[index].surface?.name || "成员"}${index === leaderIdx ? " / 组长" : ""}）`,
      `目标市场：${parsed.grid_id ? formatGridUiLabel(parsed.grid_id) : "未提交"}`,
      `产品定位方向：${architectureSymbol(parsed.architecture)} ${architectureUiLabel(parsed.architecture)}`
    ].join("；");
  }).join("\n");
  return [
    "【当前页面：小组战略分布与最终选择】",
    "页面原文：所有人的选择已揭晓。观察你们的共识和分歧，讨论后在下方确定团队统一方向。",
    "所有成员的个人初选已公开显示在同一张市场地图上。",
    publicSelections,
    `分布洞察卡：${r1DivergenceInsightFromProposals(proposals)}`,
    "",
    "组长操作区页面原文：讨论完成后，在这里确认团队统一方向。这个选择将作为后续价值主张讨论的基础。",
    "组长负责点击，但这只是网页权限，不代表组长的意见比其他成员更权威。普通成员只能口头讨论，不能操作组长区域。课堂里没有主持人逐一点名，成员要说话只能自己接话或插话。",
    `市场格按钮：${GRID_IDS.join(" / ")}`,
    "产品定位按钮：Experience（体验型）/ Hybrid（混合型）/ Function（功能型）。",
    `组长操作区当前暂存市场格：${uiState.grid_id || "尚未选择"}`,
    `组长操作区当前暂存产品定位：${uiState.architecture || "尚未选择"}`,
    "未点击继续以前，暂存选项只是组长操作区当前显示的按钮状态，不代表团队已经同意，也不阻止任何成员提出不同意见。",
    uiState.grid_id && uiState.architecture ? "继续按钮当前可点击；只有组长点击继续后，这两个暂存选项才锁定并进入下一页。" : "继续按钮尚不可点击。"
  ].join("\n");
}

function buildR1ActorIsolatedVpScreen(uiState) {
  return [
    "【当前页面：撰写团队价值主张】",
    `页面顶部固定显示：市场格=${uiState.grid_id}；产品定位=${uiState.architecture}。`,
    "页面原文：请根据你选择的市场定位，写出一份清晰的价值主张。",
    "页面有 WHO、PAIN、HOW 三个输入框。组长可以输入、修改并点击提交；普通成员只能口头讨论。这只是网页权限，不代表其他成员要等组长邀请才说话。",
    "WHO：目标客户的身份与处境。",
    "PAIN：反复发生的真实问题及其原因。",
    "HOW：方案通过什么机制解决上述问题。",
    `WHO 当前内容：${uiState.vp_summary.who || "（空）"}`,
    `PAIN 当前内容：${uiState.vp_summary.pain || "（空）"}`,
    `HOW 当前内容：${uiState.vp_summary.how || "（空）"}`,
    Object.values(uiState.vp_summary).every(Boolean) ? "提交按钮当前可点击；是否提交仍由组长本人决定。" : "提交按钮尚不可点击。"
  ].join("\n");
}

function formatR1IsolatedActorPersona(member, isLeader) {
  const publicName = member.surface?.name || "成员";
  return formatR1UiProfile(member, isLeader, "team_room_r1_actor_isolated_v1")
    .replace(/^姓名代号：.*$/mu, `姓名：${publicName}`)
    .replace(/你是组长，负责推进讨论并代表全队提交。/gu, "你和其他四个人是平等的讨论参与者；只是网页当前把鼠标和键盘操作权交给了你。")
    .replace(/你是普通队员。/gu, "你和其他四个人是平等的讨论参与者；网页当前没有把鼠标和键盘操作权交给你，但你不需要等待任何人邀请才可以说话。");
}

async function createR1ActorPublicEnvironment({ phase, screenText, temperature, outputDir }) {
  void screenText;
  void temperature;
  const raw = phase === "selection"
    ? "投影屏显示小组战略分布页：五份个人初选已经公开，组长操作区的市场格、产品定位和继续按钮位于页面下方。讨论室里能听见空调送风和走廊远处的声音，桌上放着纸笔和水杯。"
    : "投影屏显示价值主张页面，WHO、PAIN、HOW 三个输入框和提交按钮排列在页面中。讨论室里的桌椅、纸笔和水杯仍在原处，走廊远处偶尔传来其他小组的声音。";
  if (outputDir) {
    appendJsonl(path.join(outputDir, "r1_actor_isolated_public_environment.jsonl"), {
      ts: new Date().toISOString(),
      phase,
      source: "deterministic_environment_only",
      raw
    });
  }
  return String(raw || "").trim();
}

async function createR1ActorPrivateState({ member, isLeader, ownProposal, screenText, heardTranscript, phase, temperature, outputDir }) {
  const messages = [
    {
      role: "system",
      content: [
        "你是贴着一个人物行动的第三人称旁白。你只知道下面这一个人的人生和他亲眼看到、亲耳听到的内容。",
        "不要替小组预告结局，不要判断商业上什么最好，也不要知道其他人的内心。",
        "只有人物小传里的经历属于这个人。别人公开讲过的经历只能写成‘他刚听某人说’，绝不能移植成这个人自己的父母、项目、客户或回忆。",
        "只写没说出口的内在状态，不替人物公开发言，不写引号台词，不写他已经开口补充了什么。",
        "写的是这个人此刻身体和心里发生的具体状态，不是心理测评或决策标签。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【这个人】",
        formatR1IsolatedActorPersona(member, isLeader),
        "",
        "【他自己的个人初选】",
        `${ownProposal.grid_id}/${ownProposal.architecture}；WHO=${ownProposal.vp_summary?.who || ""}；PAIN=${ownProposal.vp_summary?.pain || ""}；HOW=${ownProposal.vp_summary?.how || ""}`,
        "",
        "【他现在看到的页面】",
        screenText,
        "",
        "【到目前为止公开说出口的话】",
        heardTranscript || "（讨论刚开始，还没人说话）",
        "",
        phase === "selection"
          ? "写 80-180 字的私有主人公状态：他先看见什么、是否在意自己的初选被别人看见、想不想开口、想起了哪段真实经历、哪里没把握。不要替他决定团队最后选什么。"
          : "页面刚切到 WHO/PAIN/HOW。写 80-180 字的私有主人公状态：他如何理解刚才的选择、此刻想补哪句话、是否还挂念被放弃的东西。不要替他写团队最终答案。",
        "只写自然叙事正文，不要 JSON、标题、列表或分析。"
      ].join("\n")
    }
  ];
  const raw = await callText(messages, { temperature, maxTokens: 360 });
  if (outputDir) {
    appendJsonl(path.join(outputDir, "r1_actor_isolated_private_states.jsonl"), {
      ts: new Date().toISOString(),
      phase,
      member_id: member.profile_id,
      raw
    });
  }
  return String(raw || "").trim();
}

function validateR1ActorPublicRaw(raw, performanceMode = "speak", phase = "", uiState = null) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("empty public performance");
  const forcedSubmitMode = performanceMode === "timeout_forced_submit";
  if (/\bTBN\d+\b/u.test(text)) throw new Error("public performance exposed an internal persona id");
  const stageDirections = Array.from(text.matchAll(/（([^）]*)）|\(([^)]*)\)/gsu))
    .map((match) => String(match[1] || match[2] || ""))
    .join("\n");
  const privateMarkers = [
    /脑子里/u,
    /心里/u,
    /心头/u,
    /内心/u,
    /暗自/u,
    /没说出口/u,
    /浮现/u,
    /回忆起/u,
    /想起/u,
    /想到(?:的是|了)/u,
    /意识到/u,
    /盘算/u,
    /琢磨/u,
    /这个我认/u
  ];
  const leakedMarker = privateMarkers.find((pattern) => pattern.test(stageDirections));
  if (leakedMarker) throw new Error(`public performance exposed private narration: ${leakedMarker}`);
  const outsidePerformance = stripR1ParentheticalContent(text)
    .replace(/“[^”]*”/gsu, "")
    .replace(/"[^"]*"/gsu, "")
    .replace(/[\s，。！？、；：,.!?;:—-]/gu, "");
  if (outsidePerformance) throw new Error("public performance must contain only parenthesized visible action and quoted speech");
  const uiOperationPattern = /(?:鼠标|光标|指针).{0,160}(?:点击|点选|点下|点了|点一下|点了一下|单击|双击|选中|确认|按下|输入|敲|填|写|改|加|补|删|提交)|(?:按钮|格子|输入框|选项).{0,60}(?:点击|点选|点下|点了|点一下|点了一下|单击|双击|选中|确认|按下|输入|敲|填|写|改|加|补|删|提交)|(?:点击|点选|点下|点了|点一下|点了一下|单击|双击|选中|确认|按下|输入|敲|填|写|改|加|补|删|提交).{0,60}(?:按钮|格子|输入框|选项)/u;
  if (performanceMode !== "operate" && !forcedSubmitMode && uiOperationPattern.test(stageDirections)) {
    throw new Error("speech performance crossed into a UI operation");
  }
  if (!forcedSubmitMode && performanceMode === "operate" && phase === "selection") {
    const clickedControls = r1ActorClickedSelectionControls(text);
    const explicitContinue = r1ActorExplicitButtonClickEvidence(text, "继续");
    if (explicitContinue && (clickedControls.grids.length > 0 || clickedControls.architectures.length > 0)) {
      throw new Error("selection operation combined editing controls with clicking continue");
    }
  }
  if (!forcedSubmitMode && performanceMode === "operate" && phase === "vp") {
    const explicitSubmit = r1ActorExplicitButtonClickEvidence(text, "提交");
    const vp = uiState?.vp_summary || {};
    const missingFields = ["who", "pain", "how"].filter((key) => !String(vp[key] || "").trim());
    if (explicitSubmit && missingFields.length > 0) {
      throw new Error(`submit button unavailable while VP fields are empty: ${missingFields.join(",")}`);
    }
  }
  return text;
}

function stripR1ParentheticalContent(value) {
  const chars = Array.from(String(value || ""));
  let depth = 0;
  let output = "";
  for (const char of chars) {
    if (char === "（" || char === "(") {
      depth += 1;
      continue;
    }
    if (char === "）" || char === ")") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
    }
    if (depth === 0) output += char;
  }
  return output;
}

function projectR1ActorPublicRaw(raw, member, performanceMode = "speak") {
  const text = String(raw || "").trim();
  const publicName = member.surface?.name || "这名成员";
  const speeches = [];
  for (const match of text.matchAll(/“([^”]+)”|"([^"]+)"/gsu)) {
    const speech = String(match[1] || match[2] || "").trim();
    if (speech) speeches.push(`“${speech}”`);
  }
  const withoutSpeech = text
    .replace(/“[^”]*”/gsu, "。")
    .replace(/"[^"]*"/gsu, "。");
  const visiblePattern = /点击|点选|点了|点下|选中|选择了|按下|输入|敲进|敲了|填进|改成|修改|提交|继续按钮|点头|摇头|沉默|没说话|目光|抬头|低头|皱眉|笑了|喝了|杯子|杯沿|转笔|手指|伸手|转头|鼠标|键盘|光标|看着屏幕|看了屏幕/u;
  const privatePattern = /脑子里|心里|心头|内心|暗自|没说出口|浮现|回忆起|想起|想到(?:的是|了)|意识到|盘算|琢磨|这个我认/u;
  const uiOperationPattern = /点击|点选|点了|点下|选中|选择了|按下|输入|敲进|敲了|填进|改成|修改|提交|继续按钮|鼠标|键盘|光标/u;
  const actions = withoutSpeech
    .split(/[\n。！？]+/u)
    .map((part) => part.trim())
    .filter((part) => part
      && visiblePattern.test(part)
      && !privatePattern.test(part)
      && (performanceMode === "operate" || !uiOperationPattern.test(part)))
    .slice(0, 3)
    .map((part) => `（${part}。）`);
  const projected = [...actions, ...speeches].join("\n").trim();
  return projected || `（${publicName}没有说话。）`;
}

function r1ActorPublicParticipation(raw) {
  const text = String(raw || "");
  const spoken = Array.from(text.matchAll(/“([^”]*)”|"([^"]*)"/gsu))
    .map((match) => String(match[1] || match[2] || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!spoken) return "silent";
  const compact = spoken.replace(/[\s，。！？、；：,.!?;:]/gu, "");
  if (compact.length <= 16 || /^(嗯|行|可以|好|没意见|我同意|就这样|先这样|差不多|你们定|我都行)+$/u.test(compact)) {
    return "acknowledge";
  }
  return "substantive";
}

function parseR1ActorEntranceDecision(raw, isLeader, allowOperate = true) {
  const text = String(raw || "").trim();
  if (/【行动】(?:保持)?沉默\s*$/u.test(text)) return "silent";
  if (/【行动】(?:公开)?发言\s*$/u.test(text)) return "speak";
  if (isLeader && allowOperate && /【行动】(?:操作界面|操作)\s*$/u.test(text)) return "operate";
  throw new Error("entrance decision missing the final action marker");
}

async function callR1ActorEntranceDecision({ members, member, isLeader, ownProposal, privateState, screenText, transcript, phase, phaseTurnNumber, quietBeatStreak, triggerContext, allowOperate, temperature, outputDir, eventIndex }) {
  const publicName = member.surface?.name || "这名成员";
  const ownPublicHistory = clipText(transcript
    .filter((entry) => entry.speaker === member.profile_id && entry.phase === phase)
    .map((entry, index) => `${index + 1}. ${entry.text}`)
    .join("\n"), 6000) || "（你还没有公开说过话）";
  const privateContext = phaseTurnNumber <= 2
    ? [
        "下面仍是这个阶段开始时只属于你的主人公状态。它没有因为你上一次沉默而消失，但时间已经往前走了；不要机械重复其中的回忆或措辞。",
        privateState,
        "结合眼前页面和后来真正公开发生的内容，只判断这一秒会不会自然开口或操作。"
      ].join("\n")
    : "这个阶段开始时的第一阵冲动已经过去。你自己的个人初选仍显示在下方；不要重新调用同一段回忆或为了有话可说临时搜索新案例，只判断眼前这一秒。";
  const pageBoundary = phase === "selection"
    ? [
        "当前还在市场格与产品定位选择页。这一页只需要判断：当前暂存的市场格或产品定位要不要改。",
        "WHO/PAIN/HOW 的具体措辞、功能清单、交付节奏、验收指标、运维、渠道和实施细节属于后续页面；除非它们会直接使你要求改换市场格或产品定位，否则不要在这一页继续展开。",
        "如果你能接受当前暂存项，又没有尚未公开的新改选理由或疑问，这一页对你已经没有新话可说，最自然的是保持沉默。",
        isLeader
          ? "如果市场格和产品定位都已暂存，你此刻也不打算改选或继续说，只有你能点击继续进入下一页；这是一项网页操作，不是宣布所有人内心一致。"
          : "组长点击继续以前你仍可反对；但没有真实反对时，不要为了拖住页面而延伸实施细节。"
      ].join("\n")
	    : [
		        "当前在 WHO、PAIN、HOW 页面。只讨论和填写这三个框；市场格与产品定位已经由上一页锁定。",
		        "如果三个框已经准确承接了你在意的内容，又没有新的具体修改意见，就不必重复赞同或继续扩写。",
		        "如果你只是认可别人刚说的 VP 方向、没有要改某个框的一句具体文字，最自然是沉默。不要把 WHO/PAIN/HOW 扩成产品方案会。",
		        isLeader
		          ? "提交按钮只有在三个框都非空时可用；有空框就先填写或修改，三个框都能用且你没有新修改时，才可能点击提交。"
		          : "没有新的三框修改意见时，保持沉默即可。"
      ].join("\n");
  const messages = [
    {
      role: "system",
      content: [
	        formatR1IsolatedActorPersona(member, isLeader),
	        "你只为这一个演员做一次私下的临场动作判断，不写其他人的行为，不替小组规划讨论，也不知道最后结果。",
	        "这不是老师点名，也不是轮到你必须贡献内容；现在只是有人刚说了一句话、页面刚变了一下，或现场安静了几秒，镜头扫到你看你会不会自然接话。",
	        "只对这一件刚发生的公共事件反应一次。没有被触发就沉默，不要为了补全小组答案而开口。",
	        "只有眼前内容真正碰到这个人的经历、利益、困惑或他已经公开显示的个人选择时，才选择公开发言。当前暂存项与自己的判断冲突，也可能是自然开口的理由；不能为了完善答案、推进流程或显得参与而开口。",
	        isLeader && allowOperate
	          ? "操作网页和公开发言是两件事。组长可以一句话不说就实际改变暂存项、填写草稿或点击继续；也可以只说话而不碰网页。鼠标在手不是操作理由，重复点击当前已暂存的同一按钮不产生任何动作。"
	          : "这次镜头只判断沉默或公开发言，不发生网页操作。",
	        "组长只是唯一能碰网页的人，不是主持人、老师或更权威的决策者。普通成员不需要等组长点名、提问、停手或把页面填完才开口。",
	        "市场格和产品定位在点击继续前都只是网页里的暂存状态，不是已经形成的结论。任何人都不应仅因为组长点亮了一个按钮，就把继续比较理解成拆台或太迟。",
	        pageBoundary,
	        phase === "selection"
	          ? "如果你此刻想说的是按钮、报告、功能实现、交付、运维、指标或价值主张措辞，但不要求改变市场格或产品定位，这一页最自然是先不说，等进入后续页面。"
	          : "",
	        "一个具体疑问、半句话、没把握的反对、个人经历中的小片段都算真实发言动机；不要把‘还没形成完整方案’自动判成沉默。反过来，也不要为了参与而硬凑新案例。",
        "判断依据是人物与此刻现场，不是商业答案质量。输出是私下拍摄决定，不会进入共享 transcript。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【只给演员看的主人公状态】",
        privateContext,
        "",
        "【他自己的个人初选】",
        `${ownProposal.grid_id}/${ownProposal.architecture}；WHO=${ownProposal.vp_summary?.who || ""}；PAIN=${ownProposal.vp_summary?.pain || ""}；HOW=${ownProposal.vp_summary?.how || ""}`,
        "",
	        "【眼前页面】",
	        screenText,
	        "",
	        "【刚发生、需要你反应的一件事】",
	        triggerContext || "这是这一阶段开始时看到页面后的第一次自然反应机会。",
	        "",
	        "【本阶段公开发生过的全部发言，按时间】",
	        formatR1ActorPhaseTranscript(transcript, members, phase),
        "",
        "【你在本阶段已经公开说过的全部话】",
        ownPublicHistory,
        "这些话不能换种说法再说一遍；只有眼前出现了尚未表达的新反应，才值得再次开口。",
        "别人已经公开讲清楚的观点也属于现场记忆；即使你也赞同，只是换个人再说一遍也不算新的反应。",
        "",
	        `【当前公共停顿】此前连续 ${quietBeatStreak} 个镜头没有出现新的实质内容。`,
	        isLeader && allowOperate
	          ? "你是握鼠标的组长。只有此刻真要首次点选、改选、填写/修改文字、点击继续或点击提交，才选‘操作界面’；重新点击当前同一选项不算操作。不要为了操作硬编一句发言，选择沉默则什么按钮都不会被系统代点。"
	          : (isLeader ? "你虽然握着鼠标，但这次只是听到别人或刚看到页面后的自然反应镜头；要不要真正操作会在现场安静后再判断。" : "你是普通成员。公开发言才会生成台词；保持沉默可以包括点头、看屏幕或走神，但不会向别人传递私有理由。"),
	        "只用一句简短自然中文写这个人为什么在这一秒沉默、发言或操作，不写剧本、不展开经历、不分析团队终局。最后必须单独写且只选一个：",
	        "【行动】保持沉默",
	        "【行动】公开发言",
	        isLeader && allowOperate ? "【行动】操作界面" : ""
	      ].join("\n")
    }
  ];
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const attemptMessages = attempt === 1 ? messages : [
        ...messages,
        { role: "assistant", content: lastRaw },
        { role: "user", content: "刚才末尾动作标记缺失。不要重写理由，只根据刚才已经表达的临场倾向，单独补一行合法【行动】标记。" }
      ];
      lastRaw = await callText(attemptMessages, { temperature, maxTokens: 260 });
	      const decision = parseR1ActorEntranceDecision(lastRaw, isLeader, allowOperate);
	      if (outputDir) {
	        appendJsonl(path.join(outputDir, "r1_actor_isolated_entrance_decisions.jsonl"), {
	          ts: new Date().toISOString(), event: eventIndex, phase, member_id: member.profile_id,
	          member_name: publicName, is_leader: isLeader, phase_turn_number: phaseTurnNumber,
	          quiet_beat_streak: quietBeatStreak, trigger_context: triggerContext || "", allow_operate: Boolean(allowOperate),
	          attempt, status: "ok", decision, raw: lastRaw
	        });
	      }
      return { decision, raw: lastRaw };
    } catch (error) {
      lastError = error.message;
      if (outputDir) {
	        appendJsonl(path.join(outputDir, "r1_actor_isolated_entrance_decisions.jsonl"), {
	          ts: new Date().toISOString(), event: eventIndex, phase, member_id: member.profile_id,
	          member_name: publicName, is_leader: isLeader, phase_turn_number: phaseTurnNumber,
	          quiet_beat_streak: quietBeatStreak, trigger_context: triggerContext || "", allow_operate: Boolean(allowOperate),
	          attempt, status: "error", error: lastError, raw: lastRaw
	        });
      }
    }
  }
  throw new Error(`r1 actor entrance decision failed after 2 attempts: ${lastError}`);
}

async function callR1IsolatedActor({ members, member, isLeader, ownProposal, privateState, screenText, uiState, transcript, phase, phaseTurnNumber, triggerContext, performanceMode, temperature, outputDir, eventIndex , operateRetryNote = "" }) {
  const ownPublicHistory = clipText(transcript
    .filter((entry) => entry.speaker === member.profile_id && entry.phase === phase)
    .map((entry, index) => `${index + 1}. ${entry.text}`)
    .join("\n"), 6000) || "（你还没有公开说过话）";
	  const phaseInstruction = performanceMode === "operate"
	    ? (phase === "selection"
	        ? (uiState.grid_id && uiState.architecture
	            ? "你刚才已经私下决定这一秒操作界面。市场格和产品定位都已经暂存；这一镜只演你点击继续，或明确改成另一个不同的市场格/定位。重复点击当前相同的市场格或定位没有效果，不要演停在按钮上犹豫。"
	            : "你刚才已经私下决定这一秒操作界面。这一镜只演你首次点选或实际改选中的一个有效操作；不要改成继续讨论，也不要替操作补理由。重复点击当前相同的市场格或定位没有效果，不能拿它充当一次操作。")
	        : (Object.values(uiState.vp_summary || {}).every(Boolean)
	            ? "你刚才已经私下决定这一秒操作界面。WHO、PAIN、HOW 都已有文字；这一镜只演你点击提交，或明确改写某一个输入框的最终文字。不要演空泛犹豫。"
	            : "你刚才已经私下决定这一秒操作界面。这一镜只演你实际输入/覆盖 WHO、PAIN、HOW 中一个或多个字段；必须写出输入框最终文字，不要只写敲了一行字。"))
	    : (isLeader
	        ? "你刚才已经私下决定这一秒只公开发言。这一镜可以追问、回应或说自己的看法，但不能碰鼠标、键盘、按钮或输入框；要操作留到另一个真实时刻。"
	        : "你刚才已经私下决定这一秒公开发言。你可以插话、追问、坚持、改口或跑偏；你不能操作组长区域。只说此刻真会说的话。 ");
	  const selectionBoundary = phase === "selection" && performanceMode !== "operate"
	    ? [
	        "这一页只聊两件事：市场格选哪个、产品定位选 Experience/Hybrid/Function 哪个。",
	        "如果你要开口，台词里必须清楚落到：支持当前暂存、反对当前暂存、建议改成某个市场格/定位，或提出会影响这两个选择的疑问。",
	        "不要在这一页展开按钮、报告、功能实现、运维、渠道、交付或 WHO/PAIN/HOW 措辞；这些留到后续页面。"
	      ].join("\n")
	    : "";
	  const vpBoundary = phase === "vp" && performanceMode !== "operate"
	    ? [
	        "这一页只写 WHO、PAIN、HOW 三个框。",
	        "如果你开口，台词里要给出一个具体改法：WHO 应该怎样改、PAIN 应该怎样改、或 HOW 应该怎样改。",
	        "不要展开技术实现、市场渠道、投资人话术或完整产品方案；如果只是认可方向、提醒风险但不给字段改法，就沉默。"
	      ].join("\n")
	    : "";
  const privateContext = phaseTurnNumber === 1
    ? privateState
    : "阶段开始时的那次内在冲动已经过去，也可能已经体现在你先前的动作或发言里。不要重新调用同一段回忆、案例或担心；现在只从眼前页面、最近公开现场和你自己已经说过的话继续反应。";
  const messages = [
    {
      role: "system",
      content: [
        formatR1IsolatedActorPersona(member, isLeader),
        "",
        "你现在只扮演这一个人。你不知道别人心里在想什么，也不知道这场讨论最终会怎样。",
        "不要替其他成员写台词，不要当主持人，不要总结整场会议，不要追求一个漂亮完整的答案。",
        "别人讲过的家庭、客户和工作经历属于别人；你可以回应，但绝不能改写成自己的回忆。",
        "不要每次复述刚才所有观点，也不要重复自己已经讲过的完整理由。每次只推进眼前一个很小的反应。",
        "你已经听过下方本阶段的完整公开记录。别人讲清楚过的观点不能换成你的口吻再讲一遍；赞同但没有新增内容时可以不说。",
        "镜头落到你身上不等于老师点名。先判断这个人此刻是否真的会开口；没有新的、非重复的东西时，最真实的演法通常是点头、沉默、看屏幕、走神或让别人继续，不能为了生成内容临时搜索一个新案例。",
        "不要套用‘这个我认，但我再补一个’的接话模板。听到一个意见不等于必须赞同，也不等于必须追加细节。",
        "你的内心已写在私有主人公状态里，其他人听不见。输出时绝不能写‘我心里想’、回忆浮现、脑子里转、觉得但没说等内心旁白。",
        "只写讨论室里别人能直接看到的动作，以及你真正说出口的原话。公共场合只称呼姓名，不说 TBNxx 之类内部 id。",
        "使用剧本台词格式：可见动作只能写在全角括号（ ）里，真正说出口的话只能写在中文引号“ ”里。括号外和引号外不得有任何叙述。",
        "你只回应此刻真实听到的话和眼前页面。人物可以前后矛盾，也可以没有贡献。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【只给你看的主人公状态】",
        privateContext,
        "",
        "【你自己的个人初选】",
        `${ownProposal.grid_id}/${ownProposal.architecture}；WHO=${ownProposal.vp_summary?.who || ""}；PAIN=${ownProposal.vp_summary?.pain || ""}；HOW=${ownProposal.vp_summary?.how || ""}`,
        "",
	        "【眼前页面】",
	        screenText,
	        "",
	        "【刚发生、你正在回应的一件事】",
	        triggerContext || "这一阶段刚开始，你正在根据眼前页面自然开口或操作。",
	        "",
	        "【本阶段公开发生过的全部发言，按时间】",
	        formatR1ActorPhaseTranscript(transcript, members, phase),
        "",
        "【你自己先前公开说过的话】",
        ownPublicHistory,
        "",
	        phaseInstruction,
	        operateRetryNote ? `【上一镜作废，重演同一刻】${operateRetryNote}` : "",
	        selectionBoundary,
	        vpBoundary,
	        performanceMode === "operate"
	          ? "写这一刻公开发生的一个界面操作。用括号内的可见动作明确写出点了哪个合法按钮，或在哪个输入框写入/改成了什么原文；如果是 WHO/PAIN/HOW 操作，必须逐字写出输入框里的最终文字，不要只写‘敲了一行字’或‘删掉重打’；这一镜不要加台词。"
          : "写这一刻公开发生的一小段自然剧本文字：一个括号内的可见动作，加 1-3 句中文引号内的短口语。这个人本来很话多时可以稍长，但不要写完整分析文章。",
        "合法形态示意只有格式意义：（低头转了转笔。）\n“这块我没想明白，你们先说。” 不要照抄这句话。",
        "不要解释他为什么这么说，不要写没说出口的部分。",
        "如果发生界面操作，必须在自然叙述里明确写出点了什么、输入了什么；没有操作就不要补操作。",
        "不要 JSON、标题、列表、actor 标签、后台字段或研究说明。"
      ].join("\n")
    }
  ];
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const attemptMessages = attempt === 1 ? messages : [
      ...messages,
      { role: "assistant", content: lastRaw },
      {
        role: "user",
        content: `刚才的版本不能成为公开 transcript：${lastError}。只重演同一刻，把内心、解释和内部代号留在私下；公开输出只能是别人看得到的动作和带引号的真实台词。`
      }
    ];
    try {
      lastRaw = await callText(attemptMessages, { temperature, maxTokens: 320 });
      const raw = validateR1ActorPublicRaw(lastRaw, performanceMode, phase, uiState);
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_actor_calls.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, member_id: member.profile_id,
          is_leader: isLeader, phase_turn_number: phaseTurnNumber, performance_mode: performanceMode, attempt, status: "ok", raw
        });
      }
      return raw;
    } catch (error) {
      lastError = error.message;
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_actor_calls.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, member_id: member.profile_id,
          is_leader: isLeader, phase_turn_number: phaseTurnNumber, performance_mode: performanceMode, attempt, status: "rejected", error: lastError, raw: lastRaw
        });
      }
    }
  }
  const raw = projectR1ActorPublicRaw(lastRaw, member, performanceMode);
  validateR1ActorPublicRaw(raw, performanceMode, phase, uiState);
  if (outputDir) {
    appendJsonl(path.join(outputDir, "r1_actor_isolated_actor_calls.jsonl"), {
      ts: new Date().toISOString(), event: eventIndex, phase, member_id: member.profile_id,
      is_leader: isLeader, phase_turn_number: phaseTurnNumber, performance_mode: performanceMode, attempt: 3, status: "public_projection_salvage",
      error: lastError, source_raw: lastRaw, raw
    });
  }
  return raw;
}

function r1ActorExplicitButtonClickEvidence(raw, buttonLabel) {
  const click = "(?:点击|点选|点下|点了下去|点了下|点了一下|点一下|点了|按下|按了下去|按了一下|按一下|按了|单击)";
  const label = `[“\"']?${buttonLabel}(?:按钮)?[”\"']?`;
  const patterns = [
    new RegExp(`${click}(?:了)?(?:屏幕|页面|界面)?(?:[上下][方面边]|[左右][上下]角|底部|顶部|旁边|中间|上|下)?(?:的)?(?:那个|那颗|那枚)?${label}`, "u"),
    new RegExp(`点(?:了)?(?:一?下)?${label}`, "u"),
    new RegExp(`(?:在|把|将)(?:那个)?${label}(?:上)?${click}(?:了)?`, "u"),
    new RegExp(`${label}(?:被)?${click}(?:了)?`, "u")
  ];
  for (const pattern of patterns) {
    const match = String(raw || "").match(pattern);
    if (match) {
      const clickOffset = match[0].search(new RegExp(click, "u"));
      const clickIndex = clickOffset >= 0 ? match.index + clickOffset : match.index;
      if (!r1ActorClickEvidenceNegated(raw, clickIndex)) return match[0];
    }
  }
  const text = String(raw || "");
  const labelPattern = new RegExp(label, "gu");
  for (const match of text.matchAll(labelPattern)) {
    const window = text.slice(match.index, match.index + 100);
    const clickMatch = window.match(new RegExp(click, "u"));
    if (!clickMatch) continue;
    const beforeClick = window.slice(0, clickMatch.index);
    if (/(?:移开|离开|挪开|滑开|没有点|没点|未点|没按|未按)/u.test(beforeClick)) continue;
    if (r1ActorClickEvidenceNegated(window, clickMatch.index)) continue;
    return window.slice(0, clickMatch.index + clickMatch[0].length);
  }
  return "";
}

function r1ActorClickEvidenceNegated(raw, clickIndex) {
  const text = String(raw || "");
  const index = Math.max(0, Number(clickIndex) || 0);
  const around = text.slice(Math.max(0, index - 28), Math.min(text.length, index + 28));
  return /(?:没有|没|未|并没有|并未|还没|还没有|不曾).{0,6}(?:点击|点选|点下|点了下去|点了下|点了一下|点一下|点了|点|按下|按了下去|按了一下|按一下|按了|按|单击)/u.test(around)
    || /(?:悬着|停住|停了|停在|犹豫).{0,18}(?:没有|没|未|并没有|并未|还没|还没有).{0,6}(?:点击|点选|点下|点了下去|点了下|点了一下|点一下|点了|点|按下|按了下去|按了一下|按一下|按了|按|单击)/u.test(around);
}

function r1ActorClickedControlEvidence(raw, label) {
  const text = String(raw || "");
  const escapedLabel = escapeRegExp(label);
  const quotedLabel = `[“\"']?${escapedLabel}[”\"']?`;
  const control = `${quotedLabel}(?:的)?(?:按钮|格子|选项)?`;
  const click = "(?:点击|点选|点下|点了下去|点了下|点了一下|点一下|点了两下|点两下|点了|按下|按了下去|按了一下|按一下|按了|单击|双击|选中|选择了)";
  const pause = "(?:，|,|\\s)*(?:停[^，。；！？\\n]{0,8}|顿[^，。；！？\\n]{0,6}|犹豫[^，。；！？\\n]{0,6})?(?:，|,|\\s)*";
  const patterns = [
    new RegExp(`${click}(?:了)?(?:屏幕|页面|界面)?(?:上|下)?(?:的)?(?:那个)?${control}`, "gu"),
    new RegExp(`(?:最后|最终|直接|重新|又)?(?:在|把|将)?(?:鼠标|光标)?(?:移到|挪到|放到|移回|挪回|放回|回到)?(?:了)?(?:那个)?${control}(?:上)?${pause}${click}(?:了)?`, "gu"),
    new RegExp(`从[^，。；！？\\n]{0,20}?(?:移|挪|滑)(?:到|回)(?:了)?(?:那个)?${control}(?:上)?${pause}${click}(?:了)?`, "gu")
  ];
  const matches = [];
  const directAfterCue = new RegExp(`(?:最后|最终|末了|后来|然后|直接|重新|又).{0,12}${click}(?:了)?(?:屏幕|页面|界面)?(?:上|下)?(?:的)?(?:那个)?${control}`, "gu");
  const moveThenClickOnly = new RegExp(`(?:移到|挪到|放到)(?:了)?(?:那个)?[“"']?[^，。,；;]*[”"']?(?:按钮|格子|选项)?(?:上)?(?:，|,|\\s)*${click}(?:了)?$`, "u");
  for (const match of text.matchAll(directAfterCue)) {
    const clickOffset = match[0].search(new RegExp(click, "u"));
    const clickIndex = clickOffset >= 0 ? match.index + clickOffset : match.index;
    if (!r1ActorClickEvidenceNegated(text, clickIndex)) {
      matches.push({ evidence: match[0], index: match.index, priority: 2 });
    }
  }
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (/(?:停在|停了一下|停住|悬停|移到|挪到|放到).{0,40}(?:上|旁边|附近).{0,12}(?:没有点|没点|未点|没有按|没按|未按|又移到|再移到|最后点|最终点)/u.test(match[0])) {
        continue;
      }
      if (moveThenClickOnly.test(match[0])
        && !/^(?:最后|最终|末了|后来|然后|直接|重新|又)/u.test(match[0])) {
        continue;
      }
      const clickOffset = match[0].search(new RegExp(click, "u"));
      const clickIndex = clickOffset >= 0 ? match.index + clickOffset : match.index;
      if (!r1ActorClickEvidenceNegated(text, clickIndex)) {
        matches.push({ evidence: match[0], index: match.index, priority: 1 });
      }
    }
  }
  return matches.sort((a, b) => (b.priority || 0) - (a.priority || 0) || b.index - a.index)[0] || null;
}

function r1ActorGenericControlSpokenLabel(raw, kind) {
  // A click phrased against a control context ("产品定位按钮…点了一下", "（按钮上，点了下去。）",
  // "点了产品定位按钮") followed shortly by a quoted utterance that consists solely of one legal
  // label ⇒ that label was selected. Handles the actor style where the button click is a stage
  // direction and the chosen value is spoken as a separate quoted line.
  const text = String(raw || "");
  const click = "(?:点击|点选|点下|点了下去|点了下|点了一下|点一下|点了|按下|按了下去|按了一下|按一下|按了|单击)";
  const pause = "(?:，|,|\\s)*(?:停[^，。；！？\\n]{0,8}|顿[^，。；！？\\n]{0,6}|犹豫[^，。；！？\\n]{0,6})?(?:，|,|\\s)*";
  const specificControl = kind === "grid" ? "(?:市场格)" : "(?:产品定位|定位)";
  const genericControl = "(?:按钮|鼠标|光标)";
  const labels = kind === "grid"
    ? GRID_IDS.map((key) => ({ key, tokens: [key] }))
    : [
        { key: "Experience", tokens: ["Experience", "体验型", "体验"] },
        { key: "Hybrid", tokens: ["Hybrid", "混合型", "混合"] },
        { key: "Function", tokens: ["Function", "功能型", "功能"] }
      ];
  const contextPatterns = [
    new RegExp(`${specificControl}[^。；！？\\n“”]{0,10}${pause}${click}`, "gu"),
    new RegExp(`${genericControl}[^。；！？\\n“”]{0,8}${pause}${click}`, "gu"),
    new RegExp(`${click}(?:了)?[^。；！？\\n“”]{0,6}${specificControl}(?:的)?(?:按钮|选项)?`, "gu")
  ];
  const matchLabel = (spoken) => {
    const bare = String(spoken || "").replace(/[（）()【】\[\]\s，。,.!！?？:：;；]/gu, "");
    if (!bare) return null;
    for (const item of labels) {
      let residual = bare;
      for (const token of [...item.tokens].sort((a, b) => b.length - a.length)) {
        residual = residual.split(token).join("");
      }
      if (!residual) return item.key;
    }
    return null;
  };
  const results = [];
  for (const pattern of contextPatterns) {
    for (const match of text.matchAll(pattern)) {
      const clickOffset = match[0].search(new RegExp(click, "u"));
      const clickIndex = clickOffset >= 0 ? match.index + clickOffset : match.index;
      if (r1ActorClickEvidenceNegated(text, clickIndex)) continue;
      const windowStart = match.index + match[0].length;
      const window = text.slice(windowStart, Math.min(text.length, windowStart + 90));
      let found = null;
      for (const quoted of window.matchAll(/[“"]([^”"]{1,40})[”"]/gu)) {
        const key = matchLabel(quoted[1]);
        if (key) {
          found = { key, evidence: match[0] + window.slice(0, quoted.index + quoted[0].length), index: match.index };
          break;
        }
      }
      if (found && !results.some((item) => item.key === found.key && item.index === found.index)) {
        results.push(found);
      }
    }
  }
  return results;
}

function r1ActorClickedSelectionControls(raw) {
  const directGrids = GRID_IDS
    .map((key) => ({ key, ...(r1ActorClickedControlEvidence(raw, key) || {}) }))
    .filter((item) => item.evidence);
  const directArchitectures = [
    { key: "Experience", labels: ["Experience", "体验型", "体验"] },
    { key: "Hybrid", labels: ["Hybrid", "混合型", "混合"] },
    { key: "Function", labels: ["Function", "功能型", "功能"] }
  ].map((item) => {
    const evidence = item.labels
      .map((label) => r1ActorClickedControlEvidence(raw, label))
      .filter(Boolean)
      .sort((a, b) => b.index - a.index)[0];
    return { key: item.key, ...(evidence || {}) };
  }).filter((item) => item.evidence);
  const mergeGeneric = (direct, generic) => {
    const merged = direct.slice();
    for (const item of generic) {
      if (!merged.some((existing) => existing.key === item.key)) merged.push(item);
    }
    return merged.sort((a, b) => a.index - b.index);
  };
  return {
    grids: mergeGeneric(directGrids, r1ActorGenericControlSpokenLabel(raw, "grid")),
    architectures: mergeGeneric(directArchitectures, r1ActorGenericControlSpokenLabel(raw, "architecture"))
  };
}

function r1ActorControlEvidenceIncludesLabel(evidence, label) {
  if (!evidence || !label) return false;
  return new RegExp(`[“"']?${escapeRegExp(label)}[”"']?(?:按钮|格子|选项)?`, "u").test(String(evidence));
}

function r1ActorArchitectureLabels(architecture) {
  if (architecture === "Experience") return ["Experience", "体验型", "体验"];
  if (architecture === "Hybrid") return ["Hybrid", "混合型", "混合"];
  if (architecture === "Function") return ["Function", "功能型", "功能"];
  return [];
}

function normalizeR1ActorUiEvent(parsed, { phase, isLeader, raw, uiState }) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const allowed = phase === "selection"
    ? new Set(["none", "edit_selection", "continue_to_vp"])
    : new Set(["none", "edit_vp", "submit_r1"]);
  let action = String(source.action || "none").trim();
  if (!allowed.has(action)) throw new Error(`invalid actor-isolated action: ${action}`);
  let evidenceQuote = String(source.evidence_quote || "").trim();
  const explicitContinue = phase === "selection" ? r1ActorExplicitButtonClickEvidence(raw, "继续") : "";
  const explicitSubmit = phase === "vp" ? r1ActorExplicitButtonClickEvidence(raw, "提交") : "";
  if (explicitContinue) {
    action = "continue_to_vp";
    evidenceQuote = explicitContinue;
  } else if (explicitSubmit) {
    action = "submit_r1";
    evidenceQuote = explicitSubmit;
  } else if (action === "continue_to_vp" || action === "submit_r1") {
    action = "none";
    evidenceQuote = "";
  }
  if (action !== "none" && (!isLeader || !evidenceQuote || !raw.includes(evidenceQuote))) {
    throw new Error("actor-isolated action requires a verbatim leader evidence quote");
  }
  let gridId = String(source.grid_id || "").trim();
  let architecture = String(source.architecture || "").trim();
  const clickedControls = phase === "selection" ? r1ActorClickedSelectionControls(raw) : { grids: [], architectures: [] };
  const finalClickedGrid = clickedControls.grids[clickedControls.grids.length - 1];
  const finalClickedArchitecture = clickedControls.architectures[clickedControls.architectures.length - 1];
  const sourceGridHasEvidence = phase === "selection" && GRID_IDS.includes(gridId) && r1ActorControlEvidenceIncludesLabel(evidenceQuote, gridId);
  const sourceArchitectureHasEvidence = phase === "selection"
    && ["Experience", "Hybrid", "Function"].includes(architecture)
    && r1ActorArchitectureLabels(architecture).some((label) => r1ActorControlEvidenceIncludesLabel(evidenceQuote, label));
  // A field value the leader never wrote in this take is a UI-state echo or hallucination from
  // the extractor; it must not ride into uiState on the back of another evidenced action.
  const rawText = String(raw || "");
  const rawMentionsGrid = gridId && rawText.includes(gridId);
  const rawMentionsArchitecture = architecture
    && r1ActorArchitectureLabels(architecture).some((label) => rawText.includes(label));
  if (finalClickedGrid && !sourceGridHasEvidence) gridId = finalClickedGrid.key;
  else if (!sourceGridHasEvidence && !finalClickedGrid && !rawMentionsGrid) gridId = "";
  if (finalClickedArchitecture && !sourceArchitectureHasEvidence) architecture = finalClickedArchitecture.key;
  else if (!sourceArchitectureHasEvidence && !finalClickedArchitecture && !rawMentionsArchitecture) architecture = "";
  if (!explicitContinue && phase === "selection" && (clickedControls.grids.length > 0 || clickedControls.architectures.length > 0)) {
    action = "edit_selection";
    const finalClick = [finalClickedGrid, finalClickedArchitecture]
      .filter(Boolean)
      .sort((a, b) => b.index - a.index)[0];
    evidenceQuote = finalClick?.evidence || evidenceQuote;
  } else if (!explicitContinue && phase === "selection" && action === "edit_selection" && (sourceGridHasEvidence || sourceArchitectureHasEvidence)) {
    action = "edit_selection";
  } else if (!explicitContinue && phase === "selection" && action === "edit_selection") {
    action = "none";
    evidenceQuote = "";
  }
  if (gridId && !GRID_IDS.includes(gridId)) throw new Error(`invalid grid_id: ${gridId}`);
  if (architecture && !["Experience", "Hybrid", "Function"].includes(architecture)) {
    throw new Error(`invalid architecture: ${architecture}`);
  }
	  const vp = source.vp_summary && typeof source.vp_summary === "object" ? source.vp_summary : {};
	  const currentUiState = uiState && typeof uiState === "object" ? uiState : {};
  const selectionChanged = (gridId && gridId !== currentUiState.grid_id)
    || (architecture && architecture !== currentUiState.architecture);
  if (action === "edit_selection" && !selectionChanged) {
    action = "none";
    evidenceQuote = "";
  }
  if (action === "none") {
    gridId = "";
    architecture = "";
  }
	  return {
	    action: phase === "vp" && action === "edit_vp" && !["who", "pain", "how"].some((key) => String(vp[key] || "").trim())
	      ? "none"
	      : action,
	    evidence_quote: evidenceQuote,
	    grid_id: gridId,
	    architecture,
    vp_summary: {
      who: String(vp.who || "").trim(),
      pain: String(vp.pain || "").trim(),
      how: String(vp.how || "").trim()
    }
  };
}

async function extractR1ActorUiEvent({ raw, phase, isLeader, uiState, temperature, outputDir, eventIndex, memberId }) {
  if (!isLeader) {
    return { action: "none", evidence_quote: "", grid_id: "", architecture: "", vp_summary: { who: "", pain: "", how: "" } };
  }
  const messages = [
    {
      role: "system",
      content: [
        "你是课堂网页的事后操作记录器，只索引文本中已经明确发生的组长界面动作。",
        "不能根据观点、倾向、建议、共识或商业合理性推断点击。没有明确操作就记 none。",
        "evidence_quote 必须逐字复制原文中直接证明动作发生的短句。只输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `当前阶段：${phase}`,
        `当前 UI 状态：${JSON.stringify(uiState)}`,
        "",
        "组长这一刻的原文：",
        raw,
        "",
        phase === "selection"
          ? [
              "只允许 action=none|edit_selection|continue_to_vp。",
              "仅明确写出点击/选择某个市场格或定位按钮才是 edit_selection；仅明确写出点击继续/进入下一页才是 continue_to_vp。",
              "grid_id 必须来自合法 id；architecture 必须是 Experience/Hybrid/Function。"
            ].join("\n")
          : [
              "只允许 action=none|edit_vp|submit_r1。",
              "仅明确写出在输入框输入/修改文字才是 edit_vp；仅明确写出点击提交才是 submit_r1。",
              "只抽取原文实际写入或提交的 WHO/PAIN/HOW；没写的字段留空。"
            ].join("\n"),
        'schema：{"action":"none|edit_selection|continue_to_vp|edit_vp|submit_r1","evidence_quote":"原文逐字短句","grid_id":"","architecture":"","vp_summary":{"who":"","pain":"","how":""}}'
      ].join("\n")
    }
  ];
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature: Math.min(0.1, temperature), maxTokens: 550 });
      const event = normalizeR1ActorUiEvent(parseJsonLoose(lastRaw), { phase, isLeader, raw, uiState });
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_extractors.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, member_id: memberId, attempt, status: "ok", actor_raw: raw, raw: lastRaw, parsed: event
        });
      }
      return event;
    } catch (error) {
      lastError = error.message;
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_extractors.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, member_id: memberId, attempt, status: "error", error: lastError, actor_raw: raw, raw: lastRaw
        });
      }
    }
  }
  return { action: "none", evidence_quote: "", grid_id: "", architecture: "", vp_summary: { who: "", pain: "", how: "" }, extraction_error: lastError };
}

function r1ActorIsolatedSpeakerQueue(members, seed, phase, cycle) {
  const rng = makeRng(`r1_actor_isolated_queue:${seed}:${phase}:${cycle}`);
  const queue = members.map((_, index) => index);
  for (let index = queue.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [queue[index], queue[swap]] = [queue[swap], queue[index]];
  }
  return queue;
}

function r1ActorEventQueue(members, seed, phase, token, excludeIndex = null) {
  return r1ActorIsolatedSpeakerQueue(members, seed, phase, token)
    .filter((index) => index !== excludeIndex);
}

function r1ActorUiStateLine(phase, uiState) {
  if (phase === "selection") {
    return `当前暂存：市场格=${uiState.grid_id || "未选"}；产品定位=${uiState.architecture || "未选"}`;
  }
  const vp = uiState.vp_summary || {};
  return `当前暂存：WHO=${vp.who || "空"}；PAIN=${vp.pain || "空"}；HOW=${vp.how || "空"}`;
}

function r1ActorTriggerContext({ mode, phase, trigger, members, uiState }) {
  const nameById = new Map(members.map((member) => [member.profile_id, member.surface?.name || member.profile_id]));
  if (mode === "phase_open") {
    return phase === "selection"
      ? "这一页刚打开，屏幕同时显示五个人的个人初选和组长操作区。每个人都能直接看到彼此分歧。"
      : "页面刚切到 WHO/PAIN/HOW。上一页选定的方向显示在页面顶部，三个输入框还是当前状态。";
  }
  if (mode === "system_selected_speaker") {
    return [
      "这一页刚打开后，其他非组长都没有自然接出实质内容，屏幕上的分歧还停在那里。",
      r1ActorUiStateLine(phase, uiState),
      "镜头这次停在你这里。你不用主持全组，也不用给漂亮总结，只按你这个人此刻最自然的方式先说一句。"
    ].join("\n");
  }
  if (mode === "leader_operation") {
    const selectionReady = phase === "selection" && uiState.grid_id && uiState.architecture;
    const vpReady = phase === "vp" && Object.values(uiState.vp_summary || {}).every(Boolean);
    return [
      "刚才这件事之后，其他人没有再自然接话，现场安静了几秒。",
      r1ActorUiStateLine(phase, uiState),
      phase === "selection"
        ? (selectionReady
            ? "市场格和产品定位都已经有暂存。除非你真的要改成另一个市场格或定位，此刻更像真实界面的下一步是点击继续；重复点击当前同一个暂存选项不会产生动作。"
            : "如果你是组长，此刻可以真实地用鼠标点一个还没点过的暂存选项，或改掉暂存选项。")
        : (vpReady
            ? "WHO、PAIN、HOW 三个框都已经非空。除非你真的要改某个框的文字，此刻更像真实界面的下一步是点击提交。"
            : "如果你是组长，此刻可以真实地填写/修改 WHO、PAIN、HOW；必须把输入框里的最终文字写出来。")
    ].join("\n");
  }
  if (mode === "response" && trigger) {
    const speaker = nameById.get(trigger.speaker) || trigger.speaker || "某人";
    const actionText = trigger.ui_action && trigger.ui_action.action && trigger.ui_action.action !== "none"
      ? `\n这句话或动作也改变了页面：${JSON.stringify(trigger.ui_action)}`
      : "";
    return [
      `刚才 ${speaker} 在公开讨论中发生了这一小段：`,
      clipText(trigger.text, 900),
      actionText,
      r1ActorUiStateLine(phase, uiState),
      "只判断你这个人听到/看到这件事后会不会自然接一句；如果没有被触动，不要另起一个新话题。"
    ].join("\n");
  }
  return r1ActorUiStateLine(phase, uiState);
}

function applyR1ActorUiEvent({ event, phase, uiState }) {
  if (phase === "selection") {
    if (event.grid_id) uiState.grid_id = event.grid_id;
    if (event.architecture) uiState.architecture = event.architecture;
    if (event.action === "continue_to_vp" && uiState.grid_id && uiState.architecture) return "vp";
    return "selection";
  }
  for (const key of ["who", "pain", "how"]) {
    if (event.vp_summary[key]) uiState.vp_summary[key] = event.vp_summary[key];
  }
  if (event.action === "submit_r1" && Object.values(uiState.vp_summary).every(Boolean)) return "submitted";
  return "vp";
}

function formatR1ActorTimeoutProposalLines(members, proposals) {
  return members.map((member, index) => {
    const parsed = proposals[index]?.parsed || {};
    const vp = parsed.vp_summary || {};
    return [
      `- ${member.surface?.name || member.profile_id}`,
      `${parsed.grid_id || ""}/${parsed.architecture || ""}`,
      `WHO=${vp.who || ""}`,
      `PAIN=${vp.pain || ""}`,
      `HOW=${vp.how || ""}`
    ].join("；");
  }).join("\n");
}

function pickR1ActorTimeoutEvidenceQuote(source, raw) {
  const candidates = []
    .concat(Array.isArray(source.evidence_quotes) ? source.evidence_quotes : [])
    .concat(source.evidence_quote || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const rawText = String(raw || "");
  const exact = candidates.find((candidate) => rawText.includes(candidate));
  if (exact) return exact;
  const normalize = (value) => String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/[“”"'‘’（）()\[\]【】\s，。！？、；：,.!?;:]/gu, "");
  const normalizedRaw = normalize(rawText);
  const normalized = candidates.find((candidate) => {
    const normalizedCandidate = normalize(candidate);
    return normalizedCandidate && normalizedRaw.includes(normalizedCandidate);
  });
  if (normalized) return normalized;
  const submitClick = r1ActorExplicitButtonClickEvidence(rawText, "提交");
  if (submitClick) return submitClick;
  const finalSpeech = rawText.match(/“[^”]*(?:就按这个交|按这个交|这样交|交吧|提交)[^”]*”|"[^"]*(?:就按这个交|按这个交|这样交|交吧|提交)[^"]*"/u);
  return finalSpeech?.[0] || "";
}

function normalizeR1ActorTimeoutSubmission(source, { raw }) {
  const evidenceQuote = pickR1ActorTimeoutEvidenceQuote(source, raw);
  if (!evidenceQuote) throw new Error("timeout submission requires evidence_quote from leader raw");
  const vp = source.vp_summary && typeof source.vp_summary === "object" ? source.vp_summary : {};
  const parsed = validateParsed("r1", {
    grid_id: source.grid_id,
    architecture: source.architecture,
    vp_summary: {
      who: vp.who,
      pain: vp.pain,
      how: vp.how
    },
    rationale: source.rationale || `时间到后，组长通过公开剧本操作提交：${evidenceQuote}`
  }, {});
  return { parsed, evidence_quote: evidenceQuote };
}

async function extractR1ActorTimeoutSubmission({ raw, phase, uiState, members, proposals, temperature, outputDir, eventIndex, leaderId }) {
  const messages = [
    {
      role: "system",
      content: [
        "你是课堂网页的事后记录器，只从组长这段公开剧本里抽取最终 Round 1 提交。",
        "不能根据商业合理性、多数意见或你的判断补内容。只有原文明确点选、明确填写、或明确说按当前 UI 提交，才可以记录。",
        "当前 UI 状态只是屏幕可见内容；只有原文明确说“按当前/就这个/不改并提交”时，才可沿用当前 UI 已经非空的值。",
        "evidence_quote 必须逐字复制原文中直接证明最终提交动作的短句。只输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `触发阶段：${phase}`,
        `当前 UI 状态：${JSON.stringify(uiState)}`,
        "",
        "【屏幕上可见的五个人个人初选】",
        formatR1ActorTimeoutProposalLines(members, proposals),
        "",
        "【组长时间到后的公开剧本原文】",
        raw,
        "",
        `合法 grid_id 只能是：${GRID_IDS.join(", ")}`,
        "architecture 只能是 Experience / Hybrid / Function。",
        "WHO、PAIN、HOW 必须是最终提交框里的文字；如果原文没有写出且也没有明确沿用当前 UI，不要自行补。",
        "{\"grid_id\":\"\",\"architecture\":\"\",\"vp_summary\":{\"who\":\"\",\"pain\":\"\",\"how\":\"\"},\"rationale\":\"\",\"evidence_quote\":\"原文逐字短句\"}"
      ].join("\n")
    }
  ];
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptMessages = attempt === 1 ? messages : [
      ...messages,
      { role: "assistant", content: lastRaw },
      { role: "user", content: `刚才无法作为最终提交记录：${lastError}。重新只抽取原文里明确发生的提交；缺字段就让它失败，不要补。` }
    ];
    try {
      lastRaw = await callText(attemptMessages, { temperature: Math.min(0.1, temperature), maxTokens: 620 });
      const normalized = normalizeR1ActorTimeoutSubmission(parseJsonLoose(lastRaw), { raw });
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_timeout_extractors.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, leader_id: leaderId,
          attempt, status: "ok", actor_raw: raw, raw: lastRaw, parsed: normalized.parsed,
          evidence_quote: normalized.evidence_quote
        });
      }
      return { ...normalized, extractor_raw: lastRaw, extractor_attempt: attempt };
    } catch (error) {
      lastError = error.message;
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_timeout_extractors.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, leader_id: leaderId,
          attempt, status: "error", error: lastError, actor_raw: raw, raw: lastRaw
        });
      }
    }
  }
  throw new Error(`r1 actor timeout submission extractor failed after 2 attempts: ${lastError}`);
}

async function callR1ActorTimeoutForcedSubmission({ members, leaderIdx, proposals, privateState, screenText, uiState, transcript, phase, temperature, outputDir, eventIndex, entranceCheckIndex, eventCap }) {
  const leader = members[leaderIdx];
  const leaderProposal = proposals[leaderIdx]?.parsed || {};
  const vp = leaderProposal.vp_summary || {};
  const messages = [
    {
      role: "system",
      content: [
        formatR1IsolatedActorPersona(leader, true),
        "",
        "你只扮演握鼠标的组长。课堂时间快到，大家的目光自然落回屏幕和你手边的鼠标。",
        "你根据刚才公开讨论的情况临场提交 Round 1：可以坚持自己的判断，也可以顺着别人说过的话调整；不要把它演成投票统计。",
        "继续保持剧本形式：可见动作写在全角括号（ ）里，说出口的话写在中文引号“ ”里。括号外和引号外不得有叙述。",
        "不要写 JSON、字段名说明、研究解释、内心独白或其他人的台词。",
        phase === "selection"
          ? "如果还在市场格/定位页，你可以先明确点选或沿用当前市场格和定位，点击继续，然后在 WHO/PAIN/HOW 三个输入框写入最终文字，最后点击提交。每个最终输入框文字都要在可见动作里逐字出现。"
          : "如果已经在 WHO/PAIN/HOW 页，你可以改写任一输入框或沿用当前文字，但最后必须在公开动作里点击提交。每个被改写的最终输入框文字都要逐字出现。",
        "可以用一两句很短的口语收口，但最后提交必须是可见网页操作，不是系统默认填值。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【只给你看的主人公状态】",
        privateState || "（此前没有额外私有状态，只按你的人物设定和现场反应。）",
        "",
        "【你自己的个人初选】",
        `${leaderProposal.grid_id || ""}/${leaderProposal.architecture || ""}；WHO=${vp.who || ""}；PAIN=${vp.pain || ""}；HOW=${vp.how || ""}`,
        "",
        "【屏幕上可见的五个人个人初选】",
        formatR1ActorTimeoutProposalLines(members, proposals),
        "",
        "【眼前页面】",
        screenText,
        "",
        "【当前 UI 暂存】",
        JSON.stringify(uiState),
        "",
        "【已经公开发生过的内容】",
        formatR1ActorPublicTranscript(transcript, members, 14),
        "",
        "镜头里不需要写分析过程；只让你的最后动作像是根据刚才讨论的情况临场提交。",
        "",
        `【收口提示】已经到第 ${eventIndex} 个公开事件、第 ${entranceCheckIndex} 次入场判断，event_cap=${eventCap}。现场像课堂时间快结束那样自然收住，大家等你把屏幕上的版本交出去。你作为组长，现在像真人在界面上那样当场提交一个 Round 1 决策。`,
        "输出一段公开剧本。不要解释为什么，不要分析任务，不要生成 JSON。"
      ].join("\n")
    }
  ];
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const attemptMessages = attempt === 1 ? messages : [
      ...messages,
      { role: "assistant", content: lastRaw },
      {
        role: "user",
        content: [
          `刚才不能成为有效的时间到提交：${lastError}。`,
          "重演同一个收口瞬间：必须用公开剧本写出组长可见操作，并让 extractor 能从原文直接抽出 grid_id、architecture、WHO、PAIN、HOW 和点击提交证据。",
          "不要把缺失内容交给系统默认填。"
        ].join("\n")
      }
    ];
    try {
      lastRaw = await callText(attemptMessages, { temperature, maxTokens: 1150 });
      const raw = validateR1ActorPublicRaw(lastRaw, "timeout_forced_submit", phase, uiState);
      const extracted = await extractR1ActorTimeoutSubmission({
        raw,
        phase,
        uiState,
        members,
        proposals,
        temperature,
        outputDir,
        eventIndex,
        leaderId: leader.profile_id
      });
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_timeout_submissions.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, leader_id: leader.profile_id,
          attempt, status: "ok", raw, parsed: extracted.parsed,
          evidence_quote: extracted.evidence_quote,
          extractor_raw: extracted.extractor_raw
        });
      }
      return { raw, attempt, ...extracted };
    } catch (error) {
      lastError = error.message;
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_timeout_submissions.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, leader_id: leader.profile_id,
          attempt, status: "error", error: lastError, raw: lastRaw
        });
      }
    }
  }
  throw new Error(`r1_actor_isolated_timeout_forced_public_submission_failed_after_3_attempts: ${lastError}`);
}

function assertR1WritingAssistKeepsChoice(draft, assisted) {
  if (assisted.grid_id !== draft.grid_id) {
    throw new Error(`writing assist changed grid_id: ${draft.grid_id} -> ${assisted.grid_id}`);
  }
  if (assisted.architecture !== draft.architecture) {
    throw new Error(`writing assist changed architecture: ${draft.architecture} -> ${assisted.architecture}`);
  }
}

async function runR1ActorIsolatedWritingAssist({ members, leaderIdx, transcript, draftParsed, temperature, arm, outputDir, seed }) {
  const leader = members[leaderIdx];
  const transcriptText = formatR1ActorPublicTranscript(transcript, members, 80);
  const messages = [
    {
      role: "system",
      content: [
        "你是课堂界面的 AI 写作辅助，只把组长已经填进 Round 1 页面的 WHO/PAIN/HOW 草稿整理成更清楚的提交文本。",
        "你不是战略决策者：禁止改变 grid_id 或 architecture，禁止新增 transcript 与草稿没有支持的客户、痛点、功能、渠道、付费方或场景。",
        "禁止使用价格、金额、成本、利润、WTP、SAM、GM、隐藏模型指标或财务测算。",
        "保留团队原意，可以让 WHO/PAIN/HOW 更具体、更顺、更像课堂界面可提交的话。",
        "只输出可 JSON.parse 的 JSON。"
      ].filter(Boolean).join("\n")
    },
    {
      role: "user",
      content: [
        r1NoFinanceInstruction(arm, "Round 1 AI 写作辅助"),
        "【固定选择，不可更改】",
        `grid_id=${draftParsed.grid_id}`,
        `architecture=${draftParsed.architecture}`,
        "",
        "【组长输入框初稿】",
        `WHO=${draftParsed.vp_summary.who}`,
        `PAIN=${draftParsed.vp_summary.pain}`,
        `HOW=${draftParsed.vp_summary.how}`,
        "",
        "【公开讨论记录】",
        clipText(transcriptText, 14000),
        "",
        `组长：${leader.surface?.name || leader.profile_id}`,
        "",
        "请输出整理后的最终提交。schema：",
        '{"grid_id":"...","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}'
      ].filter(Boolean).join("\n")
    }
  ];
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature: Math.min(0.25, temperature), maxTokens: 900 });
      const parsed = validateParsed("r1", parseJsonLoose(lastRaw), {});
      assertR1WritingAssistKeepsChoice(draftParsed, parsed);
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_writing_assist.jsonl"), {
          ts: new Date().toISOString(),
          seed,
          attempt,
          status: "ok",
          leader_id: leader.profile_id,
          draft: draftParsed,
          raw: lastRaw,
          parsed
        });
      }
      return {
        status: "ok",
        attempts: attempt,
        raw: lastRaw,
        parsed
      };
    } catch (error) {
      lastError = error.message;
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_writing_assist.jsonl"), {
          ts: new Date().toISOString(),
          seed,
          attempt,
          status: "error",
          leader_id: leader.profile_id,
          draft: draftParsed,
          raw: lastRaw,
          error: lastError
        });
      }
      messages.push({ role: "assistant", content: lastRaw || "{}" });
      messages.push({
        role: "user",
        content: [
          `上一次不可用：${lastError}`,
          "请重新输出严格 JSON；grid_id 与 architecture 必须保持固定选择完全一致，只润色 WHO/PAIN/HOW。"
        ].join("\n")
      });
    }
  }
  if (outputDir) {
    appendJsonl(path.join(outputDir, "r1_actor_isolated_writing_assist.jsonl"), {
      ts: new Date().toISOString(),
      seed,
      attempt: 4,
      status: "failed_fallback_to_draft",
      leader_id: leader.profile_id,
      draft: draftParsed,
      error: lastError
    });
  }
  return {
    status: "failed_fallback_to_draft",
    attempts: 3,
    raw: lastRaw,
    parsed: draftParsed,
    error: lastError
  };
}

function r1ActorPhaseOpenQueue({ members, leaderIdx, seed, phase }) {
  const queue = r1ActorEventQueue(members, seed, phase, `${phase}:phase_open`, null);
  return phase === "selection"
    ? queue.filter((index) => index !== leaderIdx)
    : queue;
}

function r1ActorNonLeaderIndices(members, leaderIdx) {
  return members
    .map((_, index) => index)
    .filter((index) => index !== leaderIdx);
}

function r1ActorHasNonLeaderSubstantiveTurn(turns, phase) {
  return turns.some((turn) => turn.phase === phase && !turn.is_leader && turn.participation === "substantive");
}

function r1ActorFallbackCandidateLines({ members, leaderIdx, proposals, phaseStates, phase, turns }) {
  return r1ActorNonLeaderIndices(members, leaderIdx).map((index) => {
    const member = members[index];
    const proposal = proposals[index]?.parsed || {};
    const spokenCount = turns.filter((turn) => turn.phase === phase && turn.actor === member.profile_id).length;
    return [
      `member_id=${member.profile_id}`,
      `姓名=${member.surface?.name || ""}`,
      `个人初选=${proposal.grid_id || ""}/${proposal.architecture || ""}`,
      `本阶段已公开发言次数=${spokenCount}`,
      `私有状态=${clipText(phaseStates[phase]?.[member.profile_id] || "", 700)}`
    ].join("；");
  }).join("\n");
}

function deterministicR1ActorFallbackSpeaker({ members, leaderIdx, seed, phase, eventIndex }) {
  const queue = r1ActorEventQueue(members, seed, phase, `${phase}:fallback:${eventIndex}`, leaderIdx);
  return queue[0];
}

async function chooseR1ActorFallbackSpeaker({ members, leaderIdx, proposals, phaseStates, transcript, phase, uiState, turns, temperature, seed, outputDir, eventIndex }) {
  const candidates = r1ActorNonLeaderIndices(members, leaderIdx);
  if (!candidates.length) return null;
  const messages = [
    {
      role: "system",
      content: [
        "你是后台选角记录器，只判断这一秒最可能打破沉默的非组长是谁。",
        "不要写台词，不要替小组决定结论，不要选择组长。",
        "优先选择：个人初选和屏幕暂存/多数分布冲突、私有状态里有犹豫或真实经验被触发、或者最可能用自己的口吻说出一个具体疑问的人。",
        "只输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `当前阶段：${phase}`,
        `当前 UI 状态：${JSON.stringify(uiState)}`,
        "",
        "【公开 transcript】",
        formatR1ActorPhaseTranscript(transcript, members, phase),
        "",
        "【候选非组长】",
        r1ActorFallbackCandidateLines({ members, leaderIdx, proposals, phaseStates, phase, turns }),
        "",
        `合法 member_id：${candidates.map((index) => members[index].profile_id).join(", ")}`,
        'schema：{"member_id":"...","reason":"..."}'
      ].join("\n")
    }
  ];
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature: Math.min(0.1, temperature), maxTokens: 260 });
      const parsed = parseJsonLoose(lastRaw);
      const memberId = String(parsed.member_id || "").trim();
      const index = members.findIndex((member, memberIndex) => memberIndex !== leaderIdx && member.profile_id === memberId);
      if (index < 0) throw new Error(`invalid fallback speaker: ${memberId}`);
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_speaker_fallbacks.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, attempt, status: "ok",
          member_id: memberId, reason: String(parsed.reason || "").trim(), raw: lastRaw
        });
      }
      return index;
    } catch (error) {
      lastError = error.message;
      if (outputDir) {
        appendJsonl(path.join(outputDir, "r1_actor_isolated_speaker_fallbacks.jsonl"), {
          ts: new Date().toISOString(), event: eventIndex, phase, attempt, status: "error", error: lastError, raw: lastRaw
        });
      }
    }
  }
  const fallbackIndex = deterministicR1ActorFallbackSpeaker({ members, leaderIdx, seed, phase, eventIndex });
  if (outputDir) {
    appendJsonl(path.join(outputDir, "r1_actor_isolated_speaker_fallbacks.jsonl"), {
      ts: new Date().toISOString(), event: eventIndex, phase, attempt: 3, status: "deterministic_fallback",
      error: lastError, member_id: members[fallbackIndex]?.profile_id || ""
    });
  }
  return fallbackIndex;
}

async function runR1ActorIsolatedDiscussion({ members, leaderIdx, draws, proposals, temperature, seed, arm, outputDir, maxEvents = 100 }) {
  const leader = members[leaderIdx];
  const uiState = { grid_id: "", architecture: "", vp_summary: { who: "", pain: "", how: "" } };
  const transcript = [{
    speaker: "screen",
    phase: "selection",
    text: "五个人的个人初选同时出现在小组战略分布页上。教室里没有主持人替他们总结，只有屏幕、桌椅和他们已经公开说出口的话。"
  }];
  const turns = [];
  const phaseStates = {};
  const actorTurnsByPhase = {};
  // This is an API runaway guard, not a convergence rule; if reached, the leader must submit through a final public scene.
  const eventCap = Math.max(1, Math.floor(Number(maxEvents) || 100));
  const entranceCheckCap = Math.max(eventCap * Math.max(3, members.length + 1), members.length * 4);
  const deadlineLeaderEventAt = Math.max(1, eventCap - Math.max(2, Math.ceil(members.length / 2)));
  const leaderOperationModes = new Set(["leader_operation", "deadline_leader_operation"]);
  let phase = "selection";
  let eventIndex = 0;
  let entranceCheckIndex = 0;
  let quietBeatStreak = 0;
  let triggerSerial = 0;
  let currentTrigger = { mode: "phase_open", trigger: null, token: "selection:open" };
  let queue = [];
  const deadlinePromptedByPhase = {};

	  const setResponseQueue = (mode, trigger, excludeIndex = null) => {
	    triggerSerial += 1;
	    currentTrigger = { mode, trigger, token: `${phase}:${mode}:${triggerSerial}` };
	    queue = mode === "phase_open"
      ? r1ActorPhaseOpenQueue({ members, leaderIdx, seed, phase })
      : leaderOperationModes.has(mode)
	      ? [leaderIdx]
	      : r1ActorEventQueue(members, seed, phase, currentTrigger.token, excludeIndex);
	    quietBeatStreak = 0;
	  };

  while (phase !== "submitted" && eventIndex < eventCap && entranceCheckIndex < entranceCheckCap) {
    const screenText = phase === "selection"
      ? buildR1ActorIsolatedSelectionScreen({ members, leaderIdx, draws, proposals, uiState })
      : buildR1ActorIsolatedVpScreen(uiState);
    if (!phaseStates[phase]) {
      const publicEnvironment = await createR1ActorPublicEnvironment({ phase, screenText, temperature, outputDir });
      transcript.push({ speaker: "narrator", phase, text: publicEnvironment });
      phaseStates[phase] = {};
      const privateStates = await Promise.all(members.map((member, index) => {
        return createR1ActorPrivateState({
          member,
          isLeader: index === leaderIdx,
          ownProposal: proposals[index].parsed,
          screenText,
          heardTranscript: formatR1ActorPublicTranscript(transcript, members, 8),
          phase,
          temperature,
          outputDir
        });
      }));
      members.forEach((member, index) => {
        phaseStates[phase][member.profile_id] = privateStates[index];
      });
      actorTurnsByPhase[phase] = {};
      setResponseQueue("phase_open", null, null);
    }
    if (!deadlinePromptedByPhase[phase] && eventIndex >= deadlineLeaderEventAt && phase !== "submitted") {
      const deadlineEntry = {
        speaker: "screen",
        phase,
        text: phase === "selection"
          ? "课堂时间快到这一页的收口点了。页面不会替小组选择，但组长现在需要把还要改的最后改掉，或用当前暂存项进入下一页。"
          : "课堂时间快到提交前的收口点了。页面不会替小组改写，但组长现在需要把 WHO、PAIN、HOW 的最后版本填好，或提交当前版本。"
      };
      transcript.push(deadlineEntry);
      deadlinePromptedByPhase[phase] = true;
      setResponseQueue("deadline_leader_operation", deadlineEntry, null);
    }
    if (!queue.length) {
      if (phase === "selection" && currentTrigger.mode === "phase_open" && !r1ActorHasNonLeaderSubstantiveTurn(turns, phase)) {
        const fallbackIndex = await chooseR1ActorFallbackSpeaker({
          members,
          leaderIdx,
          proposals,
          phaseStates,
          transcript,
          phase,
          uiState,
          turns,
          temperature,
          seed,
          outputDir,
          eventIndex: entranceCheckIndex + 1
        });
        if (fallbackIndex != null) {
          triggerSerial += 1;
          currentTrigger = { mode: "system_selected_speaker", trigger: null, token: `${phase}:system_selected_speaker:${triggerSerial}` };
          queue = [fallbackIndex];
          quietBeatStreak = 0;
          continue;
        }
      }
      transcript.push({
        speaker: "narrator",
        phase,
        text: "几秒钟没人接着往下说。屏幕上的按钮和输入框还停在原处，鼠标仍在组长手边。"
      });
      setResponseQueue("leader_operation", null, null);
    }
    const memberIndex = queue.shift();
    const member = members[memberIndex];
    const allowOperate = memberIndex === leaderIdx && leaderOperationModes.has(currentTrigger.mode);
    entranceCheckIndex += 1;
    actorTurnsByPhase[phase][member.profile_id] = (actorTurnsByPhase[phase][member.profile_id] || 0) + 1;
    const phaseTurnNumber = actorTurnsByPhase[phase][member.profile_id];
    const forcedSystemSpeaker = currentTrigger.mode === "system_selected_speaker";
    const entrance = forcedSystemSpeaker
      ? {
          decision: "speak",
          raw: "【后台选角】此前非组长均未自然给出实质发言；系统选择此成员作为最合理的打破沉默者。"
        }
      : await callR1ActorEntranceDecision({
          members,
          member,
          isLeader: memberIndex === leaderIdx,
          ownProposal: proposals[memberIndex].parsed,
          privateState: phaseStates[phase][member.profile_id],
          screenText,
          transcript,
          phase,
          phaseTurnNumber,
          quietBeatStreak,
          triggerContext: r1ActorTriggerContext({
            mode: currentTrigger.mode,
            phase,
            trigger: currentTrigger.trigger,
            members,
            uiState
          }),
          allowOperate,
          temperature,
          outputDir,
          eventIndex: entranceCheckIndex
        });
    if (forcedSystemSpeaker && outputDir) {
      appendJsonl(path.join(outputDir, "r1_actor_isolated_entrance_decisions.jsonl"), {
        ts: new Date().toISOString(), event: entranceCheckIndex, phase, member_id: member.profile_id,
        member_name: member.surface?.name || "这名成员", is_leader: memberIndex === leaderIdx, phase_turn_number: phaseTurnNumber,
        quiet_beat_streak: quietBeatStreak, trigger_context: r1ActorTriggerContext({
          mode: currentTrigger.mode,
          phase,
          trigger: currentTrigger.trigger,
          members,
          uiState
        }),
        allow_operate: false, attempt: 0, status: "forced_by_system_fallback", decision: entrance.decision, raw: entrance.raw
      });
    }
    if (entrance.decision === "silent") {
      quietBeatStreak += 1;
      if (allowOperate) {
        const idleEntry = {
          speaker: "narrator",
          phase,
          text: "组长看着页面停了一下，没有说话，也没有碰鼠标。"
        };
        transcript.push(idleEntry);
        setResponseQueue("response", idleEntry, leaderIdx);
      }
      continue;
    }
    eventIndex += 1;
    const actorCallArgs = {
      members,
      member,
      isLeader: memberIndex === leaderIdx,
      ownProposal: proposals[memberIndex].parsed,
      privateState: phaseStates[phase][member.profile_id],
      screenText,
      uiState,
      transcript,
      phase,
      phaseTurnNumber,
      triggerContext: r1ActorTriggerContext({
        mode: currentTrigger.mode,
        phase,
        trigger: currentTrigger.trigger,
        members,
        uiState
      }),
      performanceMode: entrance.decision,
      temperature,
      outputDir,
      eventIndex
    };
    let raw = entrance.decision === "silent"
      ? `（${member.surface?.name || "这名成员"}没有开口。）`
      : await callR1IsolatedActor(actorCallArgs);
    let event = entrance.decision !== "operate"
      ? { action: "none", evidence_quote: "", grid_id: "", architecture: "", vp_summary: { who: "", pain: "", how: "" } }
      : await extractR1ActorUiEvent({
          raw,
          phase,
          isLeader: memberIndex === leaderIdx,
          uiState,
          temperature,
          outputDir,
          eventIndex,
          memberId: member.profile_id
        });
    if (entrance.decision === "operate" && event.action === "none") {
      // Re-shoot the same moment once: the actor already privately decided to operate, but the
      // take contained no indexable UI action. Never invents a decision.
      const retryRaw = await callR1IsolatedActor({
        ...actorCallArgs,
        operateRetryNote: "你刚才那一镜没有落下任何可索引的真实界面动作：没有点中任何合法按钮，也没有逐字写出某个输入框的最终文字。重演这一刻，在括号动作里把操作写实——点击时逐字写出按钮标签（例如 点击市场格“ToB_DIFF_ELDER”、点击产品定位“Hybrid”、点击“继续”按钮、点击“提交”按钮），输入时逐字写出该输入框的完整最终文字。仍然只演这一个操作。"
      });
      const retryEvent = await extractR1ActorUiEvent({
        raw: retryRaw,
        phase,
        isLeader: memberIndex === leaderIdx,
        uiState,
        temperature,
        outputDir,
        eventIndex,
        memberId: member.profile_id
      });
      if (retryEvent.action !== "none") {
        raw = retryRaw;
        event = retryEvent;
      }
    }
    const participation = r1ActorPublicParticipation(raw);
    const previousPhase = phase;
    const transcriptEntry = { speaker: member.profile_id, phase: previousPhase, text: raw || "（没有说话）", participation, ui_action: event.action === "none" ? null : event };
    transcript.push(transcriptEntry);
    phase = applyR1ActorUiEvent({ event, phase, uiState });
    quietBeatStreak = participation === "substantive" || event.action !== "none" ? 0 : quietBeatStreak + 1;
    turns.push({
      event: eventIndex,
      phase: previousPhase,
      actor: member.profile_id,
      is_leader: memberIndex === leaderIdx,
      phase_turn_number: phaseTurnNumber,
      trigger_mode: currentTrigger.mode,
      trigger_token: currentTrigger.token,
      allow_operate: allowOperate,
      entrance_decision: entrance.decision,
      entrance_private_raw: entrance.raw,
      participation,
      raw,
      indexed_ui_event: event,
      ui_state_after: JSON.parse(JSON.stringify(uiState))
    });
    if (outputDir) {
      writeJson(path.join(outputDir, "r1_actor_isolated_checkpoint.json"), {
        seed,
        arm,
        leader_id: leader.profile_id,
        phase,
        event_index: eventIndex,
        entrance_check_index: entranceCheckIndex,
        event_cap: eventCap,
        entrance_check_cap: entranceCheckCap,
        deadline_leader_event_at: deadlineLeaderEventAt,
        private_states: phaseStates,
        turns,
        ui_state: uiState,
        trigger: currentTrigger,
        queue
      });
    }
	    if (phase !== previousPhase && phase === "vp") {
	      transcript.push({ speaker: "screen", phase, text: `组长点击继续。页面锁定 ${uiState.grid_id} / ${uiState.architecture}，切换到 WHO、PAIN、HOW。` });
	      queue = [];
	      currentTrigger = { mode: "phase_open", trigger: null, token: `${phase}:open` };
		    } else if (phase !== previousPhase && phase === "submitted") {
		      queue = [];
		    } else if (event.action !== "none") {
		      setResponseQueue("response", transcriptEntry, memberIndex);
    } else if (currentTrigger.mode === "system_selected_speaker" && participation === "substantive") {
      setResponseQueue("response", transcriptEntry, memberIndex);
    } else if (currentTrigger.mode === "phase_open") {
      queue = queue.slice();
    } else if (currentTrigger.mode === "leader_operation" && participation === "substantive") {
      setResponseQueue("response", transcriptEntry, memberIndex);
    } else if (allowOperate && entrance.decision === "operate") {
      queue = [];
	    } else {
	      queue = queue.slice();
	    }
  }
  let timeoutForcedSubmission = null;
  if (phase !== "submitted") {
    const timeoutPhase = phase;
    const timeoutScreenText = timeoutPhase === "selection"
      ? buildR1ActorIsolatedSelectionScreen({ members, leaderIdx, draws, proposals, uiState })
      : buildR1ActorIsolatedVpScreen(uiState);
    const timeoutCue = timeoutPhase === "selection"
      ? "这一页的课堂时间到了。页面没有替小组点任何按钮；组长必须现在在界面上完成最后选择、进入下一页并提交 Round 1。"
      : "Round 1 的课堂时间到了。页面没有替小组填任何文字；组长必须现在在界面上确认或改写 WHO、PAIN、HOW 并点击提交。";
    transcript.push({ speaker: "screen", phase: timeoutPhase, text: timeoutCue });
    eventIndex += 1;
    timeoutForcedSubmission = await callR1ActorTimeoutForcedSubmission({
      members,
      leaderIdx,
      proposals,
      privateState: phaseStates[timeoutPhase]?.[leader.profile_id] || "",
      screenText: timeoutScreenText,
      uiState,
      transcript,
      phase: timeoutPhase,
      temperature,
      outputDir,
      eventIndex,
      entranceCheckIndex,
      eventCap
    });
    const timeoutParsed = timeoutForcedSubmission.parsed;
    uiState.grid_id = timeoutParsed.grid_id;
    uiState.architecture = timeoutParsed.architecture;
    uiState.vp_summary = { ...timeoutParsed.vp_summary };
    actorTurnsByPhase[timeoutPhase] = actorTurnsByPhase[timeoutPhase] || {};
    actorTurnsByPhase[timeoutPhase][leader.profile_id] = (actorTurnsByPhase[timeoutPhase][leader.profile_id] || 0) + 1;
    const timeoutEvent = {
      action: "timeout_forced_submit_r1",
      evidence_quote: timeoutForcedSubmission.evidence_quote,
      grid_id: timeoutParsed.grid_id,
      architecture: timeoutParsed.architecture,
      vp_summary: timeoutParsed.vp_summary
    };
    const timeoutTranscriptEntry = {
      speaker: leader.profile_id,
      phase: timeoutPhase,
      text: timeoutForcedSubmission.raw,
      participation: r1ActorPublicParticipation(timeoutForcedSubmission.raw),
      ui_action: timeoutEvent
    };
    transcript.push(timeoutTranscriptEntry);
    turns.push({
      event: eventIndex,
      phase: timeoutPhase,
      actor: leader.profile_id,
      is_leader: true,
      phase_turn_number: actorTurnsByPhase[timeoutPhase][leader.profile_id],
      trigger_mode: "timeout_forced_submission",
      trigger_token: `${timeoutPhase}:timeout_forced_submission:${eventIndex}`,
      allow_operate: true,
      entrance_decision: "operate",
      entrance_private_raw: "【收口提示】时间到，组长必须通过公开界面动作提交；系统不默认填值。",
      participation: timeoutTranscriptEntry.participation,
      raw: timeoutForcedSubmission.raw,
      indexed_ui_event: timeoutEvent,
      ui_state_after: JSON.parse(JSON.stringify(uiState))
    });
    phase = "submitted";
    queue = [];
    if (outputDir) {
      writeJson(path.join(outputDir, "r1_actor_isolated_checkpoint.json"), {
        seed,
        arm,
        leader_id: leader.profile_id,
        phase,
        event_index: eventIndex,
        entrance_check_index: entranceCheckIndex,
        event_cap: eventCap,
        entrance_check_cap: entranceCheckCap,
        deadline_leader_event_at: deadlineLeaderEventAt,
        timeout_forced_submission: timeoutForcedSubmission,
        private_states: phaseStates,
        turns,
        ui_state: uiState,
        trigger: { mode: "timeout_forced_submission", trigger: timeoutTranscriptEntry, token: `${timeoutPhase}:timeout_forced_submission:${eventIndex}` },
        queue
      });
    }
  }
  const draftParsed = validateParsed("r1", {
    grid_id: uiState.grid_id,
    architecture: uiState.architecture,
    vp_summary: uiState.vp_summary,
    rationale: timeoutForcedSubmission
      ? `组长在第 ${eventIndex} 个公开事件中通过时间到后的公开剧本完成提交；证据：${timeoutForcedSubmission.evidence_quote}`
      : `组长在第 ${eventIndex} 个公开事件中点击提交；市场、定位和 VP 均来自已记录的组长界面动作。`
  }, {});
  const writingAssist = await runR1ActorIsolatedWritingAssist({
    members,
    leaderIdx,
    transcript,
    draftParsed,
    temperature,
    arm,
    outputDir,
    seed
  });
  const parsed = writingAssist.parsed;
  const finalText = `【最终提交】grid_id=${parsed.grid_id}; architecture=${parsed.architecture}; WHO=${parsed.vp_summary.who}; PAIN=${parsed.vp_summary.pain}; HOW=${parsed.vp_summary.how}; rationale=${parsed.rationale}`;
  transcript.push({
    speaker: "screen",
    phase: "vp",
    text: "AI 写作辅助根据组长输入框草稿整理出可提交定稿，组长确认使用该定稿。",
    ui_action: { type: "ai_writing_assist_round1", status: writingAssist.status, draft: draftParsed, assisted: parsed }
  });
  transcript.push({ speaker: "screen", phase: "vp", text: "组长点击提交，Round 1 页面接受了当前输入。", ui_action: { type: "submit_round1", ...parsed } });
  if (outputDir) {
    writeJson(path.join(outputDir, "r1_actor_isolated_state.json"), {
      seed,
      arm,
      leader_id: leader.profile_id,
      private_states: phaseStates,
      event_cap: eventCap,
      entrance_check_cap: entranceCheckCap,
      deadline_leader_event_at: deadlineLeaderEventAt,
      turns,
      final_ui_state: uiState,
      draft_submission: draftParsed,
      writing_assist: writingAssist,
      timeout_forced_submission: timeoutForcedSubmission,
      parsed_submission: parsed
    });
  }
  return {
    transcript,
    turns,
    termination: timeoutForcedSubmission
      ? "actor_isolated_timeout_forced_public_submission_plus_ai_writing_assist"
      : "actor_isolated_explicit_leader_submit_plus_ai_writing_assist",
    event_cap: eventCap,
    entrance_check_cap: entranceCheckCap,
    deadline_leader_event_at: deadlineLeaderEventAt,
    narration: { mode: "deterministic_public_environment_plus_private_per_actor_states", private_states: phaseStates },
    leader_submit: {
      text: finalText,
      parsed,
      draft_parsed: draftParsed,
      parse_raw: timeoutForcedSubmission?.extractor_raw || writingAssist.raw || uiState,
      attempts: writingAssist.attempts,
      parse_method: timeoutForcedSubmission
        ? (writingAssist.status === "ok"
            ? "actor_isolated_timeout_public_submission_plus_ai_writing_assist"
            : "actor_isolated_timeout_public_submission_ai_writing_assist_failed_fallback_to_draft")
        : (writingAssist.status === "ok"
            ? "actor_isolated_explicit_ui_actions_plus_ai_writing_assist"
            : "actor_isolated_explicit_ui_actions_ai_writing_assist_failed_fallback_to_draft"),
      writing_assist: writingAssist,
      timeout_forced_submission: timeoutForcedSubmission
    }
  };
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

async function getWillingness(member, isLeader, transcript, topic, temperature, arm = "legacy") {
  const messages = [
    { role: "system", content: formatProfile(member, isLeader, arm) },
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

function roomBeatInstruction(beat) {
  if (!beat) return "";
  const shared = "这一轮像讨论室里的台词，不是课堂作业答案；不要把逻辑讲满，不要替全队写结论。";
  const instructions = {
    short_view: "只说一个短观点或直觉，1句，最多补半句理由。",
    terse_agree: "只附和或轻微补一句，像“我同意这个方向，但别太重”。不要展开。",
    short_doubt: "只提出一个担心或反问，不给完整方案。",
    bridge: "帮两边调停，给一个折中说法，1-2句。",
    low_effort: "你这轮有点觉得差不多就行，或觉得这个环节意义不大。最多一句，别认真展开。",
    status_story: "你有点想显得自己见过类似场面，带一个自己的行业/海外/项目经验，最多2句，最后贴回当前任务。",
    tangent: "你会稍微跑题，讲一个和自己行业或个人经验相关的担心；最后用半句拉回当前议题。",
    quick_calc: "你忍不住口头粗算一下，但只能说一个粗略判断，不要列公式，不要逐项精算。",
    long_relevant: "你这轮确实有话要说，可以讲2句，但要像临场说话，别写成报告。",
    leader_probe: "你作为组长点一下分歧或追问一句，让别人继续，但不要直接总结。",
    leader_wrap: "你作为组长打断发散并收口，推动进入下一步；1-2句内。"
  };
  return [
    `【这一轮场景节拍】${beat.label}。${instructions[beat.kind] || instructions.short_view}`,
    shared,
    beat.note || ""
  ].filter(Boolean).join("\n");
}

function roomBeatMaxTokens(beat) {
  if (!beat) return 500;
  if (beat.kind === "low_effort" || beat.kind === "terse_agree" || beat.kind === "short_doubt") return 70;
  if (beat.kind === "short_view" || beat.kind === "bridge" || beat.kind === "quick_calc" || beat.kind === "leader_probe") return 105;
  if (beat.kind === "status_story" || beat.kind === "tangent" || beat.kind === "leader_wrap") return 145;
  return 180;
}

function roomBeatLabel(kind) {
  const labels = {
    short_view: "短观点",
    terse_agree: "附和一句",
    short_doubt: "短质疑",
    bridge: "调停折中",
    low_effort: "敷衍一下",
    status_story: "想表现/讲经验",
    tangent: "轻微跑题",
    quick_calc: "口头粗算",
    long_relevant: "认真讲一段",
    leader_probe: "组长追问",
    leader_wrap: "组长收口"
  };
  return labels[kind] || kind;
}

function r1NoFinanceInstruction(arm, topic = "") {
  if (arm !== "team_room_r1_reading_story_v1" || !/Round 1|市场定位|最终战略/u.test(String(topic || ""))) return "";
  return "本轮只围绕目标用户、使用场景、痛点、产品形态和架构取舍发言；不要用“谁掏钱、省钱、预算、利润、价格战、回本、成本压不住”这类财务话术推动结论。";
}

async function speak(member, isLeader, draw, privateProposal, transcript, topic, temperature, arm = "legacy", beat = null) {
  const topicText = String(topic || "");
  const noSubmitDirectPricing = usesD5TranscriptPriceParser(arm) && /D5 直接定价|产品售价滑块/u.test(topicText);
  const stateContext = isStatefulRoomRoleplayArm(arm)
    ? `\n\n${formatBehavioralState(member, topic, isLeader, arm)}`
    : "";
  const roomInstruction = isRoomRoleplayArm(arm)
    ? [
	        beat ? roomBeatInstruction(beat) : "请像讨论室里的真人接话 1-3 句：可以短、可以不完整、可以回应某个队友、可以犹豫或改口。",
		        "不要写报告，不要编号，不要输出 JSON；不要用自己的姓名/编号开头，系统已经会标注说话人。",
		        r1NoFinanceInstruction(arm, topic),
			        /定价|售价|price/i.test(topicText)
			          ? [
		              noSubmitDirectPricing
		                ? "定价时像在拖界面滑块：可以先凭感觉和顾虑说话；如果你在明确建议或收口，请直接说滑块停在哪个具体价格。"
		                : "定价时像在拖界面滑块：除非这一轮节拍要求粗算，否则少讲数字；不要重新推公式、不要逐项精算。",
		              hasD5CardReviewState(arm) ? "先受你自己的选卡复盘影响：可以从“这套功能值不值”“是不是堆多了”“用户会不会买账”说起；不要因为别人先说了一个价就立刻完全改口。" : "",
		              noSubmitDirectPricing ? "这一页没有单独的最终提交器；最后价格只按讨论里自然说出的明确滑块数来记录。这个数不需要是整百或整千。" : "",
		              /第一步|第二步|动作|档位/.test(topicText) ? "这一段还没到报最终价格，不要报具体售价，也不要复述成本金额。" : "",
		              /第三步|最终/.test(topicText) ? "这一段可以提出一个价格，但只说一个数和人话理由，不要做成本拆账。" : ""
		            ].filter(Boolean).join("\n")
          : ""
      ].filter(Boolean).join("\n")
    : "请自然发言 2-4 句。只能说你愿意公开说出口的内容。若你改变立场，点名触发你的具体发言。";
  const messages = [
    {
      role: "system",
      content: `${formatProfile(member, isLeader, arm)}\n\n私有 context：\n${formatJinang(draw)}\n你的会前提案：${privateProposal.parsed.grid_id}/${privateProposal.parsed.architecture}，${privateProposal.parsed.rationale}${stateContext}`
    },
    {
      role: "user",
      content: `共享 transcript：\n${formatTranscript(transcript)}\n\n当前议题：${topic}\n${roomInstruction}`
    }
  ];
  const raw = await callText(messages, { temperature, maxTokens: isRoomRoleplayArm(arm) ? roomBeatMaxTokens(beat) : 500 });
  return isRoomRoleplayArm(arm) ? sanitizeRoomSpeech(raw, member, beat) : raw.trim();
}

function weightedSampleIndices(items, count, rng) {
  const pool = items.map((item) => ({ ...item }));
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = pool.reduce((sum, item) => sum + Math.max(0.05, Number(item.weight) || 0), 0);
    let cursor = rng() * total;
    let chosen = 0;
    for (let i = 0; i < pool.length; i += 1) {
      cursor -= Math.max(0.05, Number(pool[i].weight) || 0);
      if (cursor <= 0) {
        chosen = i;
        break;
      }
    }
    picked.push(pool.splice(chosen, 1)[0].index);
  }
  return picked;
}

function chooseRoomBeatKind(behavior, isLeader, topic, turn, rng, state = null) {
  const isPricing = /定价|售价|price/i.test(String(topic));
  const fatigue = Number(state?.fatigue || 0);
  const confidence = Number(state?.confidence || 0.5);
  const confusion = Number(state?.confusion || 0);
  const commitment = Number(state?.social_commitment || 0);
  const review = isPricing ? state?.d5_card_review : null;
  if (isLeader && turn > 1 && rng() < 0.34 + behavior.dominance * 0.18 + commitment * 0.22) return "leader_wrap";
  if (isLeader && rng() < 0.2 + behavior.dominance * 0.14) return "leader_probe";
  const lowEffortP = 0.08 + (1 - behavior.engagement) * 0.2 + behavior.taskSkepticism * 0.1 + fatigue * 0.22;
  const r = rng();
  if (r < lowEffortP) return "low_effort";
  if (review) {
    const stake = Number(review.personal_stake || 0);
    const polar = Math.abs(Number(review.pricing_position || 0.5) - 0.5);
    if (r < lowEffortP + 0.12 + Number(review.cost_concern || 0) * 0.06) return "short_doubt";
    if (r < lowEffortP + 0.24 + stake * 0.12 + polar * 0.12) return "short_view";
    if (r < lowEffortP + 0.32 + behavior.statusMotive * 0.12 + Number(review.value_confidence || 0) * 0.08) return "status_story";
  }
  if (r < lowEffortP + 0.1 + Math.max(0, 0.45 - behavior.relevanceControl) * 0.24 + confusion * 0.08) return "tangent";
  if (r < lowEffortP + 0.2 + behavior.statusMotive * 0.16 + confidence * 0.06) return "status_story";
  if (isPricing && r < lowEffortP + 0.27 + behavior.calculationImpulse * 0.08) return "quick_calc";
  if (r < lowEffortP + 0.42 + behavior.agreeability * 0.16) return "bridge";
  if (r < lowEffortP + 0.56 + confusion * 0.1) return "short_doubt";
  if (behavior.talkativeness > 0.68 || behavior.dominance > 0.7) return "long_relevant";
  if (behavior.agreeability > 0.62) return "terse_agree";
  return "short_view";
}

function nonverbalRoomText(member, behavior, rng) {
  if (behavior.taskSkepticism > 0.62 && rng() < 0.45) return "低头看了看界面，没接话。";
  if (behavior.engagement < 0.35 && rng() < 0.5) return "嗯了一声，像是觉得先这样也行。";
  if (behavior.agreeability > 0.58) return "点了点头，没有展开。";
  return "看了一眼其他人，暂时没说。";
}

function pickRoomSceneBeats({ members, leaderIdx, topic, turn, rng, arm = "legacy" }) {
  const behaviors = members.map((member, index) => classroomBehaviorProfile(member, index === leaderIdx));
  const states = members.map((member, index) => isStatefulRoomRoleplayArm(arm) ? ensureBehavioralState(member, index === leaderIdx) : null);
  const isPricing = /定价|售价|price/i.test(String(topic || ""));
  const weights = members.map((member, index) => {
    const b = behaviors[index];
    const state = states[index];
    const recentLeaderBoost = index === leaderIdx && turn > 1 ? 0.7 : 0;
    const stateBoost = state
      ? Number(state.confidence || 0) * 0.35 + Number(state.social_commitment || 0) * 0.25 - Number(state.fatigue || 0) * 0.55 - Number(state.confusion || 0) * 0.2
      : 0;
    const review = isPricing ? state?.d5_card_review : null;
    const reviewBoost = review
      ? Number(review.personal_stake || 0) * 0.34 + Math.abs(Number(review.pricing_position || 0.5) - 0.5) * 0.26
      : 0;
    return {
      index,
      weight: 0.12 + b.talkativeness * 1.25 + b.dominance * 0.65 + b.statusMotive * 0.28 + recentLeaderBoost - b.taskSkepticism * 0.42 + stateBoost + reviewBoost
    };
  });
  const desiredSpeakers = 1 + (rng() < 0.18 ? 1 : 0) + (turn > 2 && rng() < 0.05 ? 1 : 0);
  const speakerIndices = weightedSampleIndices(weights, Math.min(2, desiredSpeakers), rng);
  if (turn >= 2 && !speakerIndices.includes(leaderIdx) && rng() < 0.44) {
    if (speakerIndices.length >= 2) speakerIndices[speakerIndices.length - 1] = leaderIdx;
    else speakerIndices.push(leaderIdx);
  }
  const beats = speakerIndices.map((index) => {
    const behavior = behaviors[index];
    const state = states[index];
    const kind = chooseRoomBeatKind(behavior, index === leaderIdx, topic, turn, rng, state);
    return {
      index,
      kind,
      label: roomBeatLabel(kind),
      generated: true,
      note: behavior.labels
        ? [
            `你的课堂状态：${behavior.labels.engagement}，${behavior.labels.status}，${behavior.labels.relevance}。`,
            state ? `当前状态：${scoreStateBand(state.confidence, ["没底", "一般", "有把握"])}，${scoreStateBand(state.fatigue, ["还投入", "有点想快点过", "明显想省事"])}。` : ""
          ].filter(Boolean).join("")
        : ""
    };
  });
  const remaining = members.map((_, index) => index).filter((index) => !speakerIndices.includes(index));
  const nonverbal = [];
  if (remaining.length && rng() < 0.58) {
    const index = remaining[Math.floor(rng() * remaining.length)];
    nonverbal.push({
      index,
      kind: "nonverbal",
      label: "非语言反应",
      generated: false,
      text: nonverbalRoomText(members[index], behaviors[index], rng)
    });
  }
  return { beats, nonverbal, silent: remaining.filter((index) => !nonverbal.some((item) => item.index === index)) };
}

async function moderatorCheck(transcript, topic, temperature, arm = "legacy") {
  const requireTranscriptPrice = usesD5TranscriptPriceParser(arm) && /D5 直接定价|产品售价滑块/u.test(String(topic || ""));
  const messages = [
    { role: "system", content: "你是团队模拟 moderator。只判断讨论是否已足够收敛，不给建议、不暗示正确答案。" },
    {
      role: "user",
      content: requireTranscriptPrice
        ? `当前议题：${topic}\n共享 transcript：\n${formatTranscript(transcript)}\n\n是否已经由成员在讨论中自然说出一个明确的最终滑块价格，并且小组可以停止？只输出 JSON：{"converged":true|false,"reason":"..."}。`
        : `当前议题：${topic}\n共享 transcript：\n${formatTranscript(transcript)}\n\n是否已经足够收敛，可以让组长提交？只输出 JSON：{"converged":true|false,"reason":"..."}。`
    }
  ];
  const result = await callJson(messages, { temperature: 0.2, maxTokens: 180 });
  return {
    converged: result.parsed.converged === true,
    reason: String(result.parsed.reason ?? "").trim(),
    raw: result.raw
  };
}


async function runActorStageDiscussion({ members, leaderIdx, draws, proposals, initialTranscript, topic, maxTurns, config, temperature, seed, arm = "legacy" }) {
  // Fusion trial: PA's stage skeleton with actor-isolated stagecraft — members enter by their
  // own entrance decision instead of scheduled rotation; silence is a legal round outcome.
  const transcript = initialTranscript.slice();
  const turns = [];
  const rng = makeRng(`actor_stage:${seed}:${topic}`);
  const maxRounds = Math.max(2, Math.min(3, maxTurns));
  let totalSpeaks = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    const order = members.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let spokeThisRound = 0;
    for (const idx of order) {
      const member = members[idx];
      const recent = transcript.slice(-4).map((e) => `${e.speaker === "moderator" || e.speaker === "screen" ? "屏幕" : e.speaker}: ${String(e.text).slice(0, 120)}`).join("\n");
      let decision = "silent";
      try {
        const raw = await callText([
          { role: "system", content: `${formatProfile(member, idx === leaderIdx, arm)}\n你在小组定价讨论现场。只判断此刻这个人会不会自然开口，不写台词。` },
          { role: "user", content: `当前环节：${topic}\n最近现场：\n${recent || "（刚开始，还没人说话）"}\n\n此刻你会开口吗？只输出 JSON：{"speak": true|false}` }
        ], { temperature: 0.3, maxTokens: 30 });
        const parsed = parseJsonLoose(raw);
        decision = parsed && parsed.speak === true ? "speak" : "silent";
      } catch (error) {
        decision = "silent";
      }
      if (decision !== "speak") continue;
      const behavior = classroomBehaviorProfile(member, idx === leaderIdx);
      const beatKind = chooseRoomBeatKind(behavior, idx === leaderIdx, topic, round, rng, null);
      const beat = {
        index: idx,
        kind: beatKind,
        label: roomBeatLabel(beatKind),
        generated: true,
        note: behavior.labels ? `你的课堂状态：${behavior.labels.engagement}，${behavior.labels.status}，${behavior.labels.relevance}。` : ""
      };
      const utterance = await speak(member, idx === leaderIdx, draws[idx], proposals[idx], transcript, topic, temperature, arm, beat);
      transcript.push({ speaker: member.profile_id, text: utterance });
      turns.push({ round, member_id: member.profile_id, entrance: "self", text: utterance });
      spokeThisRound += 1;
      totalSpeaks += 1;
    }
    if (spokeThisRound === 0 && totalSpeaks > 0) break;
    if (spokeThisRound === 0 && round >= 2) break;
  }
  return { transcript, turns, termination: "leader_decision" };
}

async function runDiscussion({ members, leaderIdx, draws, proposals, initialTranscript, topic, maxTurns, config, temperature, seed, arm = "legacy" }) {
  const transcript = initialTranscript.slice();
  const rng = makeRng(`discussion:${seed}:${topic}`);
  const turns = [];
  let termination = "leader_decision";
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (isRoomRoleplayArm(arm)) {
      const scene = pickRoomSceneBeats({ members, leaderIdx, topic, turn, rng, arm });
      const turnLog = {
        turn,
        scene_beats: scene.beats.concat(scene.nonverbal).map((item) => ({
          member_id: members[item.index].profile_id,
          kind: item.kind,
          label: item.label,
          generated: item.generated
        })),
        silent: scene.silent.map((index) => members[index].profile_id),
        speakers: []
      };
      for (const item of scene.nonverbal) {
        const entry = { speaker: members[item.index].profile_id, text: item.text, beat: item.kind };
        transcript.push(entry);
        turnLog.speakers.push(entry);
        if (isStatefulRoomRoleplayArm(arm)) {
          updateBehavioralStateAfterUtterance(members[item.index], {
            topic,
            beat: item,
            text: item.text,
            isLeader: item.index === leaderIdx,
            nonverbal: true
          });
        }
      }
      for (const beat of scene.beats) {
        const i = beat.index;
        const text = await speak(members[i], i === leaderIdx, draws[i], proposals[i], transcript, topic, temperature, arm, beat);
        const entry = { speaker: members[i].profile_id, text, beat: beat.kind };
        transcript.push(entry);
        turnLog.speakers.push(entry);
        if (isStatefulRoomRoleplayArm(arm)) {
          updateBehavioralStateAfterUtterance(members[i], {
            topic,
            beat,
            text,
            isLeader: i === leaderIdx,
            nonverbal: false
          });
        }
      }
      const check = await moderatorCheck(transcript, topic, temperature, arm);
      turnLog.moderator = check;
      if (isStatefulRoomRoleplayArm(arm)) {
        turnLog.state_after = members.map((member, index) => ({
          member_id: member.profile_id,
          is_leader: index === leaderIdx,
          state: {
            ...member.behavioral_state,
            activated_memory: Array.isArray(member.behavioral_state?.activated_memory)
              ? member.behavioral_state.activated_memory.slice()
              : []
          }
        }));
      }
      turns.push(turnLog);
      if (check.converged) {
        termination = "converged";
        break;
      }
      continue;
    }
    const willingness = [];
    for (let i = 0; i < members.length; i += 1) {
      const item = await getWillingness(members[i], i === leaderIdx, transcript, topic, temperature, arm);
      const boosted = i === leaderIdx ? item.value * Number(config.leader_willingness_boost) : item.value;
      willingness.push({ index: i, value: item.value, weight: boosted, defaulted: item.defaulted });
    }
    const speakers = pickSpeakers(willingness, config, rng);
    const turnLog = { turn, willingness, speakers: [] };
    for (const speaker of speakers) {
      const i = speaker.index;
      const text = await speak(members[i], i === leaderIdx, draws[i], proposals[i], transcript, topic, temperature, arm);
      const entry = { speaker: members[i].profile_id, text };
      transcript.push(entry);
      turnLog.speakers.push(entry);
    }
    const check = await moderatorCheck(transcript, topic, temperature, arm);
    turnLog.moderator = check;
    turns.push(turnLog);
    if (check.converged) {
      termination = "converged";
      break;
    }
  }
  return { transcript, turns, termination };
}

function buildR1ChoiceScreenPanel(options = {}) {
  return [
    "【Round 1 市场选择界面】",
    "屏幕上需要选择一个市场格、一个产品架构，并填写 WHO / PAIN / HOW。",
    "合法市场格：",
    GRID_IDS.map((gridId) => `- ${gridId}: ${getGrid(gridId).label}`).join("\n"),
    "合法架构：Experience / Hybrid / Function。",
    options.screenplay
      ? "每个人只能看见界面、自己的锦囊、自己的草稿和当场对话；不要使用隐藏模型指标。"
      : "每个人只能看见界面、自己的锦囊、自己的草稿和共享讨论；不要使用隐藏模型指标。"
  ].join("\n");
}

function formatR1NarratorActorSheet(members, leaderIdx, draws, proposals, arm) {
  return members.map((member, index) => {
    const proposal = proposals[index]?.parsed || {};
    return [
      `【成员 ${member.profile_id}${index === leaderIdx ? " / 组长" : ""}】`,
      formatProfile(member, index === leaderIdx, arm),
      `私有锦囊：${formatJinang(draws[index])}`,
      `自己的 R1 草稿：${proposal.grid_id || ""}/${proposal.architecture || ""}；WHO=${proposal.vp_summary?.who || ""}；PAIN=${proposal.vp_summary?.pain || ""}；HOW=${proposal.vp_summary?.how || ""}。`,
      `课堂状态：${formatClassroomBehavior(member, index === leaderIdx)}`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function normalizeR1NarratorStateItem(item, members, fallbackMember = null) {
  const source = item && typeof item === "object" ? item : { protagonist_state: item };
  const actor = normalizeScreenplayActor(
    source.actor ?? source.speaker ?? source.member_id ?? source.profile_id ?? source["角色"],
    members
  ) || fallbackMember?.profile_id || "";
  if (!actor) return null;
  const parts = [
    source.protagonist_state ?? source.state ?? source.inner_state ?? source["主人公状态"],
    source.what_catches_eye ?? source.attention ?? source["注意到"],
    source.social_pressure ?? source.pressure ?? source["社交压力"],
    source.r1_impulse ?? source.strategy_impulse ?? source.impulse ?? source["战略冲动"],
    source.speech_impulse ?? source["发言冲动"]
  ].map((part) => String(part || "").trim()).filter(Boolean);
  return {
    actor,
    protagonist_state: parts.join("；") || "读完 R1 界面和自己的草稿后，有一个直觉，但还没想好要不要坚持。",
    raw: source
  };
}

function validateR1NarratorScene(parsed, { members, leaderIdx }) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const publicScene = String(
    source.public_scene ?? source.scene ?? source.narration ?? source["公开旁白"] ?? source["场景旁白"] ?? ""
  ).trim();
  if (!publicScene) throw new Error("r1_narrator_missing_public_scene");

  const rawStates = ensureArray(
    source.actor_states ?? source.private_states ?? source.states ?? source["角色状态"] ?? source["私有状态"]
  );
  const stateByActor = new Map();
  for (const rawState of rawStates) {
    const normalized = normalizeR1NarratorStateItem(rawState, members);
    if (normalized) stateByActor.set(normalized.actor, normalized);
  }
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    if (!stateByActor.has(member.profile_id)) {
      const state = ensureBehavioralState(member, index === leaderIdx);
      stateByActor.set(member.profile_id, {
        actor: member.profile_id,
        protagonist_state: [
          `他/她看着 R1 市场格和自己的草稿，注意点落在${state.attention_focus || "市场是否能讲通"}。`,
          `信心 ${Number(state.confidence || 0).toFixed(2)}，疲劳 ${Number(state.fatigue || 0).toFixed(2)}。`
        ].join(""),
        raw: null
      });
    }
  }

  const seen = new Set();
  const rawOrder = ensureArray(source.turn_order ?? source.order ?? source["出场顺序"]);
  const turnOrder = rawOrder
    .map((actor) => normalizeScreenplayActor(actor, members))
    .filter((actor) => {
      if (!actor || seen.has(actor)) return false;
      seen.add(actor);
      return true;
    });
  const leaderId = members[leaderIdx].profile_id;
  if (!turnOrder.includes(leaderId)) turnOrder.push(leaderId);
  const fallbackOrder = members.map((member) => member.profile_id);
  return {
    public_scene: publicScene,
    actor_states: fallbackOrder.map((actor) => stateByActor.get(actor)),
    turn_order: turnOrder.length ? turnOrder : fallbackOrder
  };
}

function validateR1ActorBeat(parsed, { member }) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const line = String(source.line ?? source.text ?? source.reply ?? source.content ?? source["台词"] ?? "").trim();
  const stageDirection = String(source.stage_direction ?? source.stage ?? source.emotion ?? source.action ?? source["舞台动作"] ?? "").trim();
  const silent = Boolean(source.silent) || (!line && !stageDirection);
  return {
    actor: member.profile_id,
    stage_direction: stageDirection,
    line,
    silent
  };
}

function r1ActorEntryText(beat) {
  const stage = beat.stage_direction ? `（${beat.stage_direction}）` : "";
  const line = beat.line || "";
  return `${stage}${line}`.trim() || "（没有说话）";
}

function architectureSymbol(architecture) {
  if (architecture === "Hybrid") return "▲";
  if (architecture === "Function") return "■";
  return "●";
}

function architectureUiLabel(architecture) {
  if (architecture === "Hybrid") return "混合";
  if (architecture === "Function") return "功能";
  return "体验";
}

function formatGridUiLabel(gridId) {
  const grid = getGrid(gridId);
  const customer = grid.customer_type === "ToB" ? "企业 (ToB)" : "消费者 (ToC)";
  const strategy = grid.strategy === "DIFF" ? "差异化" : "成本领先";
  const age = grid.age === "CHILD" ? "儿童" : (grid.age === "ADULT" ? "成人" : "老人");
  return `${customer} · ${strategy} · ${age}`;
}

function formatTargetMarketUiLabel(targetIdOrGridId) {
  const raw = String(targetIdOrGridId || "").trim();
  const target = getTargetMarket(raw);
  if (target) {
    const customer = target.customer_type === "ToB" ? "企业 (ToB)" : "消费者 (ToC)";
    const age = target.age === "CHILD" ? "儿童" : (target.age === "ADULT" ? "成人" : "老人");
    return `${customer} · ${age}`;
  }
  if (GRID_IDS.includes(raw)) {
    const grid = getGrid(raw);
    return formatTargetMarketUiLabel(`${grid.customer_type}_${grid.age}`);
  }
  return raw;
}

function formatR1PublicSelection(member, index, proposal, draw, isLeader = false) {
  const parsed = proposal?.parsed || {};
  if (r1NaturalStrategyMode()) {
    return [
      `成员${String.fromCharCode(65 + index)}（${member.surface?.name || member.profile_id} / ${member.profile_id}${isLeader ? " / 组长" : ""}）`,
      `目标市场：${parsed.target_market_id ? `${formatTargetMarketUiLabel(parsed.target_market_id)} (${parsed.target_market_id})` : "未提交"}`,
      `竞争优势：${clipText(parsed.competitive_strategy_text || parsed.posthoc_strategy_index?.text || "", 120) || "未填写"}`,
      r1NaturalStrategyChatAskMode()
        ? `chat追问：${parsed.strategy_choice || "未答"}${parsed.competitive_strategy_choice ? ` (${parsed.competitive_strategy_choice})` : ""}`
        : "",
      `产品定位方向：${architectureSymbol(parsed.architecture)} ${architectureUiLabel(parsed.architecture)} (${parsed.architecture || "未提交"})`,
      hideJinangFromSyntheticPrompts() ? "" : `锦囊卡：${draw?.market?.name || ""}；${draw?.tech?.name || ""}`
    ].filter(Boolean).join("；");
  }
  return [
    `成员${String.fromCharCode(65 + index)}（${member.surface?.name || member.profile_id} / ${member.profile_id}${isLeader ? " / 组长" : ""}）`,
    `目标市场：${parsed.grid_id ? `${formatGridUiLabel(parsed.grid_id)} (${parsed.grid_id})` : "未提交"}`,
    `产品定位方向：${architectureSymbol(parsed.architecture)} ${architectureUiLabel(parsed.architecture)} (${parsed.architecture || "未提交"})`,
    hideJinangFromSyntheticPrompts() ? "" : `锦囊卡：${draw?.market?.name || ""}；${draw?.tech?.name || ""}`
  ].filter(Boolean).join("；");
}

function r1DivergenceInsightFromProposals(proposals) {
  const naturalStrategy = r1NaturalStrategyMode();
  const chatAskStrategy = r1NaturalStrategyChatAskMode();
  const parsed = ensureArray(proposals).map((proposal) => {
    if (naturalStrategy) {
      const target = getTargetMarket(proposal?.parsed?.target_market_id) || getTargetMarket(normalizeTargetMarketId(proposal?.parsed || {}));
      return {
        customer: target?.customer_type,
        age: target?.age,
        strategy: chatAskStrategy ? proposal?.parsed?.competitive_strategy_choice : null
      };
    }
    const [customer, strategy, age] = String(proposal?.parsed?.grid_id || "").split("_");
    return { customer, strategy, age };
  }).filter((item) => item.customer && item.age && (naturalStrategy ? (!chatAskStrategy || item.strategy) : item.strategy));
  if (!parsed.length) return "暂无可用分布数据。";
  const countBy = (key, values) => {
    const map = Object.fromEntries(values.map((value) => [value, 0]));
    parsed.forEach((item) => {
      map[item[key]] = (map[item[key]] || 0) + 1;
    });
    return map;
  };
  const splitScore = (map) => {
    const values = Object.values(map);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!total) return 0;
    return total - Math.max(...values);
  };
  const axes = [
    { axis: "客群", score: splitScore(countBy("customer", ["ToC", "ToB"])), map: countBy("customer", ["ToC", "ToB"]), labels: { ToC: "ToC", ToB: "ToB" } },
    naturalStrategy && !chatAskStrategy ? null : { axis: "竞争策略", score: splitScore(countBy("strategy", ["DIFF", "COST"])), map: countBy("strategy", ["DIFF", "COST"]), labels: { DIFF: "A类赢法", COST: "B类赢法" } },
    { axis: "年龄段", score: splitScore(countBy("age", ["CHILD", "ADULT", "ELDER"])), map: countBy("age", ["CHILD", "ADULT", "ELDER"]), labels: { CHILD: "儿童", ADULT: "成人", ELDER: "老人" } }
  ].filter(Boolean).sort((a, b) => b.score - a.score);
  const top = axes[0];
  if (!top || top.score <= 0) return "当前分布共识较高，未出现明显分歧。";
  const sortedBuckets = Object.entries(top.map).sort((a, b) => b[1] - a[1]);
  const a = sortedBuckets[0];
  const b = sortedBuckets[1];
  const left = top.labels[a[0]] || a[0];
  const right = top.labels[b[0]] || b[0];
  return `主要分歧：${left}（${a[1]}人） vs ${right}（${b[1]}人）`;
}

function buildR1TeamUiPanel({ members, leaderIdx, draws, proposals }) {
  const hideJinang = hideJinangFromSyntheticPrompts();
  const naturalStrategy = r1NaturalStrategyMode();
  const chatAskStrategy = r1NaturalStrategyChatAskMode();
  const publicSelections = proposals.map((proposal, index) => {
    return formatR1PublicSelection(members[index], index, proposal, draws[index], index === leaderIdx);
  }).join("\n");
  const divergenceInsight = r1DivergenceInsightFromProposals(proposals);
  return [
    "【Round 1 UI：小组战略分布页】",
    "标题：小组战略分布。",
    "说明：所有人的选择已揭晓。观察你们的共识和分歧，讨论后在下方确定团队统一方向。",
    "页面显示同一张市场地图；每个成员的个人初选以符号标在格子里。",
    "图例：● 体验　▲ 混合　■ 功能。",
    hideJinang
      ? "成员图例区显示：成员名、目标市场、产品定位方向。"
      : "成员图例区显示：成员名、目标市场、产品定位方向、两张锦囊卡。",
    "",
    "UI 上公开可见的个人初选：",
    publicSelections,
    "",
    `分布洞察卡：${divergenceInsight}`,
    "",
    "【Round 1 UI：确定小组最终选择】",
    "标题：确定小组最终选择。",
    "说明：讨论完成后，在这里确认团队统一方向。这个选择将作为后续价值主张讨论的基础。",
    naturalStrategy
      ? "竞争优势输入框：你们打算靠什么赢过其他方案？可以写更特别、更适合、更好体验，也可以写更划算、更容易普及、更容易被采购采用。"
      : "竞争优势选择区：你选择什么战略取得竞争优势？",
    chatAskStrategy
      ? "策略确认 chat 小窗：系统追问“你们刚写的竞争优势，如果必须落到一个策略按钮，更接近 A 还是 B？A=更特别、更适合、体验或功能更好；B=更划算、更容易普及、更容易被采购采用。”"
      : "",
    chatAskStrategy
      ? "chat 小窗只要求团队自己选 A/B；不要把这一步写成后台事后判断。"
      : "",
    naturalStrategy ? "" : "差异化：靠独特体验或功能赢得用户，可以定更高价格，但目标人群更窄。",
    naturalStrategy ? "" : "成本领先：靠性价比和规模赢得用户，价格敏感但人群基数更大。",
    naturalStrategy
      ? `团队目标市场：同一张目标市场地图，组长点击一个最终目标市场按钮。\n${formatTargetMarketList()}`
      : "团队目标市场：同一张市场地图，组长点击一个最终格子。",
    "团队产品定位方向按钮：体验型 ● / 混合型 ▲ / 功能型 ■。",
    "继续按钮：请先确定团队的目标市场和产品定位。",
    "",
    "【Round 1 UI：撰写你的价值主张】",
    "说明：请根据你选择的市场定位，写出一份清晰的价值主张。",
    "页面显示当前团队选择：目标市场、产品定位。",
    "如果不是组长，页面提示：组长正在操作，你可以口头讨论。",
    "撰写指南：一份好的价值主张回答三个问题：你要服务谁、这个人有什么问题、你打算怎么解决。",
    "WHO — 目标客户：身份 + 处境，和所选格子一致；可以是常见人群，不必非要特殊小众。placeholder：描述你的目标客户：他/她是谁、什么处境、什么生活状态……",
    "PAIN — 核心痛点：触发情境 + 现实原因；可以是普通反复出现的问题，不必包装成独特痛点。placeholder：描述客户最费神的问题：什么时候发生、为什么现有方案解决不了……",
    "HOW — 解决方式：机制 + 因果链；写法要和团队选中的目标市场一致。placeholder：描述你的方案怎么解决上述痛点：通过什么、在什么场景、达到什么效果……",
    "替代方案对比：选填。",
    "边界条件：选填。",
    "提交按钮：提交初稿，获取反馈；接受反馈，提交定稿。"
  ].filter(Boolean).join("\n");
}

function formatR1ScreenplayActorSheet(members, leaderIdx, draws, proposals, arm) {
  return members.map((member, index) => {
    const proposal = proposals[index] || {};
    const parsed = proposal.parsed || {};
    if (hasR1ScreenplayArm(arm)) {
      const state = ensureBehavioralState(member, index === leaderIdx);
      return [
        `【演员 ${member.profile_id}${index === leaderIdx ? " / 组长" : ""}】`,
        formatR1UiProfile(member, index === leaderIdx, arm),
        hideJinangFromSyntheticPrompts() ? "" : `自己的两张锦囊：${formatJinang(draws[index])}`,
        r1NaturalStrategyMode()
          ? `UI 上公开可见的个人初选：目标市场=${parsed.target_market_id ? `${formatTargetMarketUiLabel(parsed.target_market_id)} (${parsed.target_market_id})` : "未提交"}；竞争优势=${clipText(parsed.competitive_strategy_text || parsed.posthoc_strategy_index?.text || "", 180) || "未填写"}${r1NaturalStrategyChatAskMode() ? `；chat追问=${parsed.strategy_choice || "未答"}${parsed.competitive_strategy_choice ? ` (${parsed.competitive_strategy_choice})` : ""}` : ""}；${architectureSymbol(parsed.architecture)} ${architectureUiLabel(parsed.architecture)} (${parsed.architecture || "未提交"})`
          : `UI 上公开可见的个人初选：${parsed.grid_id ? `${formatGridUiLabel(parsed.grid_id)} (${parsed.grid_id})` : "未提交"}；${architectureSymbol(parsed.architecture)} ${architectureUiLabel(parsed.architecture)} (${parsed.architecture || "未提交"})`,
        proposal.raw ? `个人选择页当场写下的 VP 草稿和操作过程（只作为这个演员自己的连续性，不是全员公共文本）：${clipText(proposal.raw, 420)}` : "",
        `课堂状态：${formatClassroomBehavior(member, index === leaderIdx, { includeCalculation: false })}`,
        `当前主观状态：注意点=${state.attention_focus || "目标用户和痛点是否讲得通"}；信心=${Number(state.confidence || 0).toFixed(2)}；困惑=${Number(state.confusion || 0).toFixed(2)}；疲劳=${Number(state.fatigue || 0).toFixed(2)}。`
      ].filter(Boolean).join("\n");
    }
    const state = ensureBehavioralState(member, index === leaderIdx);
    return [
      `【演员 ${member.profile_id}${index === leaderIdx ? " / 组长" : ""}】`,
      formatProfile(member, index === leaderIdx, arm),
      `私有锦囊：${formatJinang(draws[index])}`,
      proposal.reading_memory ? `课前阅读留下的个人印象：${clipText(proposal.reading_memory, 360)}` : "",
      proposal.raw ? `刚才独自看界面的自然草稿：${clipText(proposal.raw, 520)}` : "",
      `后台从个人草稿抽取的临时选择（只给编剧作连续性素材，不是标准答案）：${parsed.grid_id || ""}/${parsed.architecture || ""}；WHO=${parsed.vp_summary?.who || ""}；PAIN=${parsed.vp_summary?.pain || ""}；HOW=${parsed.vp_summary?.how || ""}；理由=${parsed.rationale || ""}`,
      `课堂状态：${formatClassroomBehavior(member, index === leaderIdx)}`,
      `当前主观状态：注意点=${state.attention_focus || "目标用户和痛点是否讲得通"}；信心=${Number(state.confidence || 0).toFixed(2)}；困惑=${Number(state.confusion || 0).toFixed(2)}；疲劳=${Number(state.fatigue || 0).toFixed(2)}。`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function normalizeR1ScreenplaySubmission(raw, fallbackLine = "") {
  const source = raw && typeof raw === "object" ? raw : {};
  const vp = source.vp_summary || source.vp || source.value_proposition || source["价值主张"] || {};
  return {
    grid_id: source.grid_id ?? source.market_grid ?? source.grid ?? source["市场格"],
    architecture: source.architecture ?? source.product_architecture ?? source["架构"],
    vp_summary: {
      who: vp.who ?? vp.WHO ?? source.who ?? source.WHO ?? source["目标用户"],
      pain: vp.pain ?? vp.PAIN ?? source.pain ?? source.PAIN ?? source["痛点"],
      how: vp.how ?? vp.HOW ?? source.how ?? source.HOW ?? source["方案"]
    },
    rationale: source.rationale ?? source.reason ?? source["理由"] ?? fallbackLine
  };
}

function assertR1ScreenplayStrategyTextMatchesGrid(parsedSubmission, finalLine = "") {
  const grid = getGrid(parsedSubmission.grid_id);
  const text = [finalLine, parsedSubmission.rationale || ""].join("\n");
  const mentionsDiff = /差异化/u.test(text);
  const mentionsCost = /成本领先/u.test(text);
  if (grid.strategy === "DIFF" && mentionsCost && !mentionsDiff) {
    throw new Error(`r1_screenplay_strategy_text_mismatch: ${parsedSubmission.grid_id} is DIFF but final text says 成本领先`);
  }
  if (grid.strategy === "COST" && mentionsDiff && !mentionsCost) {
    throw new Error(`r1_screenplay_strategy_text_mismatch: ${parsedSubmission.grid_id} is COST but final text says 差异化`);
  }
}

function validateR1Screenplay(parsed, { members, strategyClarification = null } = {}) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const rawBeats = ensureArray(source.beats || source.scene_beats || source.screenplay || source["剧本"] || source["台词"]);
  if (rawBeats.length < 3) throw new Error("r1_screenplay_beats_must_include_at_least_3");
  const beats = [];
  for (const rawBeat of rawBeats) {
    const item = rawBeat && typeof rawBeat === "object" ? rawBeat : { line: rawBeat };
    const actor = normalizeScreenplayActor(item.actor ?? item.speaker ?? item.member_id ?? item["角色"], members);
    if (!actor) throw new Error(`invalid r1 screenplay actor: ${item.actor ?? item.speaker ?? item.member_id ?? ""}`);
    const line = String(item.line ?? item.text ?? item["台词"] ?? "").trim();
    const stageDirection = String(item.stage_direction ?? item.stage ?? item.action ?? item["舞台动作"] ?? "").trim();
    const uiAction = item.ui_action ?? item.uiAction ?? item["界面动作"] ?? null;
    beats.push({
      actor,
      stage_direction: stageDirection,
      line,
      ui_action: uiAction && typeof uiAction === "object" ? uiAction : null
    });
  }
  const finalRaw = source.final_submission || source.final_submit || source.submission || source["最终提交"];
  if (!finalRaw || typeof finalRaw !== "object" || Array.isArray(finalRaw)) {
    throw new Error("r1_screenplay_final_submission_required");
  }
  const finalActor = normalizeScreenplayActor(
    finalRaw.actor ?? finalRaw.speaker ?? finalRaw.member_id ?? finalRaw.profile_id ?? finalRaw["角色"],
    members
  );
  if (!finalActor) throw new Error("r1_screenplay_final_submission_actor_required");
  const line = String(finalRaw.line ?? finalRaw.text ?? finalRaw["台词"] ?? "").trim();
  const stageDirection = String(finalRaw.stage_direction ?? finalRaw.stage ?? finalRaw.action ?? finalRaw["舞台动作"] ?? "").trim();
  const submission = finalRaw.r1_submission || finalRaw.parsed_submission || finalRaw.submission || finalRaw;
  const parsedSubmission = r1NaturalStrategyMode()
    ? normalizeR1NaturalSubmission(submission, line, { strategyClarification })
    : validateParsed("r1", normalizeR1ScreenplaySubmission(submission, line), {});
  if (!r1NaturalStrategyMode()) assertR1ScreenplayStrategyTextMatchesGrid(parsedSubmission, line);
  return {
    scene_state: String(source.scene_state ?? source.public_scene ?? source.scene ?? source["场景"] ?? "").trim(),
    beats,
    final_submission: {
      actor: finalActor,
      stage_direction: stageDirection,
      line,
      raw: finalRaw,
      parsed: parsedSubmission
    }
  };
}

function r1ScreenplayFinalText(screenplay) {
  const final = screenplay.final_submission;
  const parsed = final.parsed;
  const stage = final.stage_direction ? `（${final.stage_direction}）` : "";
  const line = final.line || "";
  const strategyIndex = parsed.posthoc_strategy_index
    ? `; target_market_id=${parsed.target_market_id}; competitive_strategy_text=${parsed.competitive_strategy_text}; posthoc_strategy=${parsed.posthoc_strategy_index.strategy}; strategy_index_reason=${parsed.posthoc_strategy_index.reason}; cost_score=${parsed.posthoc_strategy_index.cost_score}; diff_score=${parsed.posthoc_strategy_index.diff_score}`
    : "";
  const strategyChoice = parsed.competitive_strategy_choice
    ? `; target_market_id=${parsed.target_market_id}; competitive_strategy_text=${parsed.competitive_strategy_text}; strategy_choice=${parsed.strategy_choice}; competitive_strategy_choice=${parsed.competitive_strategy_choice}; strategy_choice_line=${parsed.strategy_choice_line || ""}`
    : "";
  const submit = `【最终提交】grid_id=${parsed.grid_id}; architecture=${parsed.architecture}; WHO=${parsed.vp_summary.who}; PAIN=${parsed.vp_summary.pain}; HOW=${parsed.vp_summary.how}; rationale=${parsed.rationale}${strategyIndex}${strategyChoice}`;
  return `${final.actor}: ${stage}${line}\n${submit}`.trim();
}

function r1ScreenplayTranscript(screenplay) {
  const transcript = [{ speaker: "screen", text: "【Round 1 市场选择页】小组围着同一台电脑讨论市场格、架构和 WHO/PAIN/HOW。" }];
  if (screenplay.scene_state) transcript.push({ speaker: "narrator", text: screenplay.scene_state });
  for (const beat of screenplay.beats) {
    const stage = beat.stage_direction ? `（${beat.stage_direction}）` : "";
    const line = beat.line || "";
    const action = beat.ui_action ? `（界面动作：${JSON.stringify(beat.ui_action)}）` : "";
    transcript.push({
      speaker: beat.actor,
      text: `${stage}${line}${action}`.trim() || "（没有说话）",
      ui_action: beat.ui_action
    });
  }
  transcript.push({
    speaker: screenplay.final_submission.actor,
    text: r1ScreenplayFinalText(screenplay),
    ui_action: { type: "submit_round1", ...screenplay.final_submission.parsed }
  });
  return transcript;
}

async function runR1ScreenplayDiscussion({
  members,
  leaderIdx,
  draws,
  proposals,
  temperature,
  seed,
  arm,
  outputDir
}) {
	  const screenText = hasR1ScreenplayArm(arm)
			    ? buildR1TeamUiPanel({ members, leaderIdx, draws, proposals })
		    : buildR1ChoiceScreenPanel({ screenplay: true });
		  const actorSheet = formatR1ScreenplayActorSheet(members, leaderIdx, draws, proposals, arm);
	  const naturalStrategy = r1NaturalStrategyMode();
  const chatAskStrategy = r1NaturalStrategyChatAskMode();
	  const hideJinang = hideJinangFromSyntheticPrompts();
  const legalActorIds = members.map((member) => member.profile_id).join(", ");
		  const baseMessages = [
	    {
	      role: "system",
	      content: [
	        "你是一个场记式编剧。你的任务不是给商业建议，而是按 Round 1 UI 写出真实 EMBA 课堂小组讨论的一幕。",
		        hideJinang
		          ? "每个角色只能按自己的人设、UI 上看到的个人初选、课堂状态和理解偏差说话或行动。"
		          : "每个角色只能按自己的人设、UI 上看到的个人初选、自己的锦囊、课堂状态和理解偏差说话或行动。",
	        "不要使用当前 UI 之外的信息；本幕只承接个人 UI 选择页和当前小组 UI。",
        "台词第一优先级是人物声音：每个演员都必须按自己的“说话导演提示”说话，允许公文腔、土话、PM 黑话、工程师吐槽、销售画面感或中英文夹杂。",
        "不要把上一轮发言当成公共记事本逐条复述，不要写 moderator，不要写优化报告，不要把所有人都写得同样聪明或同样积极。",
        "可以有人沉默、跑题、插话、没听懂、想显得厉害、怕麻烦、被别人一句话带走，最后自然收束到一次界面提交；不要把这些差异改写成工整总结。",
        "只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【演员表】",
        actorSheet,
        "",
        "【当前 UI 屏幕】",
        screenText,
        "",
	        "【编剧任务】",
	        "写 Round 1 从“小组战略分布”到“确定小组最终选择”再到“撰写价值主张”的这一幕。",
	        "角色只能围绕 UI 上可见的目标市场、产品定位方向、WHO/PAIN/HOW 输入框讨论；不要引入当前页面之外的信息或研究背景。",
		        naturalStrategy
		          ? (chatAskStrategy
		              ? "界面没有让团队直接点“差异化/成本领先”按钮；团队先在竞争优势输入框里用自己的话写打算靠什么赢，然后 chat 小窗追问全组更接近 A 还是 B。A=更特别、更适合、体验或功能更好；B=更划算、更容易普及、更容易被采购采用。不要替全组扩展成 MBA 词典。"
		              : "界面没有让团队直接点“差异化/成本领先”按钮；团队只在竞争优势输入框里用自己的话写打算靠什么赢。不要替全组扩展成 MBA 词典。")
		          : "界面已经给出“选择什么战略取得竞争优势”的简短说明。角色如果提到“差异化/成本领先”，只能来自 UI 短说明、自己的个人草稿、锦囊和现场理解；不要替全组扩展成 MBA 词典。",
        "这不是会议纪要，也不是商业分析报告；像写剧本一样写台词和动作。不要把“每个人先依次陈述一遍”写成固定格式，不是每个人都必须发言。",
        "不要让角色朗读合法选项清单，不要让角色像主持人一样总结全部维度。角色可以只抓住自己在意的一两个词。",
        "每句 line 都要像真人现场说出来的短台词，不要写成段落分析；同一个演员可以只说半句、接别人一句、或者用自己的行业词把按钮翻译错。",
		        naturalStrategy
		          ? (chatAskStrategy
		              ? "不要事后替他们贴标签；必须让剧中角色自己对 chat 追问说出更接近 A 还是 B，允许他们争一下、改口或用自己的话解释。"
		              : "不要因为某种措辞听起来顺，就替他们贴上固定战略标签；让角色按自然语言竞争优势争论和填写。")
		          : "不要因为某种措辞听起来顺，就自动替换成固定按钮；让角色按自己在个人草稿里已经形成的理解争论和点击。",
		        naturalStrategy
		          ? (chatAskStrategy
		              ? "final_submission 表示最后有人在界面上提交；target_market_id 必须是合法目标市场按钮，strategy_choice 必须是 A 或 B，architecture 必须是 Experience / Hybrid / Function，competitive_strategy_text 与 WHO/PAIN/HOW 不能为空。"
		              : "final_submission 表示最后有人在界面上提交；target_market_id 必须是合法目标市场按钮，architecture 必须是 Experience / Hybrid / Function，competitive_strategy_text 与 WHO/PAIN/HOW 不能为空。")
		          : "final_submission 表示最后有人在界面上提交；grid_id 必须是合法按钮 id，architecture 必须是 Experience / Hybrid / Function，WHO/PAIN/HOW 不能为空。",
	        naturalStrategy ? "" : "final_submission 的台词和 rationale 必须和 grid_id 的策略一致：*_DIFF_* 就说差异化，*_COST_* 就说成本领先；不要嘴上说成本领先却提交 DIFF id，也不要嘴上说差异化却提交 COST id。",
		        `actor 字段只能填写演员表里的真实成员 id：${legalActorIds}。不要发明 Rxx、成员A 或姓名代号。`,
		        "不要输出 Markdown，不要输出额外说明。schema：",
			        naturalStrategy
			          ? (chatAskStrategy
			              ? '{"scene_state":"一句场景状态","beats":[{"actor":"上面列出的真实成员 id","stage_direction":"动作/神情","line":"台词，可为空","ui_action":null}],"final_submission":{"actor":"上面列出的真实成员 id","stage_direction":"动作/神情","line":"最终提交前说的话","target_market_id":"ToC_CHILD|ToB_CHILD|ToC_ADULT|ToB_ADULT|ToC_ELDER|ToB_ELDER","strategy_choice":"A|B","strategy_choice_line":"团队对 chat 追问的原文回答","architecture":"Experience|Hybrid|Function","competitive_strategy_text":"团队竞争优势输入框里的自然语言","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}}'
			              : '{"scene_state":"一句场景状态","beats":[{"actor":"上面列出的真实成员 id","stage_direction":"动作/神情","line":"台词，可为空","ui_action":null}],"final_submission":{"actor":"上面列出的真实成员 id","stage_direction":"动作/神情","line":"最终提交前说的话","target_market_id":"ToC_CHILD|ToB_CHILD|ToC_ADULT|ToB_ADULT|ToC_ELDER|ToB_ELDER","architecture":"Experience|Hybrid|Function","competitive_strategy_text":"团队竞争优势输入框里的自然语言","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}}')
			          : '{"scene_state":"一句场景状态","beats":[{"actor":"上面列出的真实成员 id","stage_direction":"动作/神情","line":"台词，可为空","ui_action":null}],"final_submission":{"actor":"上面列出的真实成员 id","stage_direction":"动作/神情","line":"最终提交前说的话","grid_id":"12格之一","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}}'
		      ].filter(Boolean).join("\n")
		    }
		  ];
  if (outputDir) {
    writeJson(path.join(outputDir, "r1_screenplay_prompt.json"), {
      seed,
      arm,
      messages: baseMessages
    });
  }
  let messages = baseMessages;
  let lastRaw = "";
  let lastError = "";
  const attemptsPath = outputDir ? path.join(outputDir, "r1_screenplay_attempts.jsonl") : null;
	  for (let attempt = 0; attempt <= 2; attempt += 1) {
	    try {
	      lastRaw = await callText(messages, { temperature, maxTokens: 4200 });
	      const parsedRaw = parseJsonLoose(lastRaw);
	      let strategyClarification = null;
	      let screenplay;
	      try {
	        screenplay = validateR1Screenplay(parsedRaw, { members });
	      } catch (error) {
	        if (naturalStrategy && !chatAskStrategy && /competitive_strategy_ambiguous/u.test(error.message)) {
	          const finalRaw = parsedRaw?.final_submission || parsedRaw?.final_submit || parsedRaw?.submission || parsedRaw?.["最终提交"] || {};
	          const submission = finalRaw.r1_submission || finalRaw.parsed_submission || finalRaw.submission || finalRaw;
	          const strategyText = String(
	            submission?.competitive_strategy_text
	              ?? submission?.competitive_advantage
	              ?? submission?.advantage_text
	              ?? submission?.strategy_text
	              ?? submission?.["竞争优势"]
	              ?? submission?.["靠什么赢"]
	              ?? finalRaw?.line
	              ?? finalRaw?.text
	              ?? ""
	          ).trim();
	          const clarified = await clarifyCompetitiveStrategyChoice({
	            strategyText,
	            contextText: [
	              `最终台词：${String(finalRaw?.line ?? finalRaw?.text ?? finalRaw?.["台词"] ?? "").trim()}`,
	              `竞争优势：${strategyText}`,
	              `WHO：${String(submission?.vp_summary?.who ?? submission?.who ?? "").trim()}`,
	              `PAIN：${String(submission?.vp_summary?.pain ?? submission?.pain ?? "").trim()}`,
	              `HOW：${String(submission?.vp_summary?.how ?? submission?.how ?? "").trim()}`,
	              `理由：${String(submission?.rationale ?? submission?.reason ?? "").trim()}`
	            ].filter((line) => !/：$/u.test(line)).join("\n"),
	            temperature
	          });
	          strategyClarification = {
	            ...clarified.parsed,
	            raw: clarified.raw
	          };
	          screenplay = validateR1Screenplay(parsedRaw, { members, strategyClarification });
	        } else {
	          throw error;
	        }
	      }
	      if (attemptsPath) {
	        appendJsonl(attemptsPath, {
	          ts: new Date().toISOString(),
	          attempt: attempt + 1,
	          status: "ok",
	          raw: lastRaw,
	          strategy_clarification: strategyClarification,
	          screenplay
	        });
	      }
      if (outputDir) {
        writeJson(path.join(outputDir, "r1_screenplay.json"), {
          seed,
          arm,
          screenplay
        });
      }
      const transcript = r1ScreenplayTranscript(screenplay);
      const leaderSubmit = {
        text: r1ScreenplayFinalText(screenplay),
        parsed: screenplay.final_submission.parsed,
        parse_raw: screenplay.final_submission.raw,
        attempts: attempt + 1,
        parse_method: "deterministic_r1_screenplay_final_submission"
      };
      return {
        transcript,
        turns: [{ turn: 1, screenplay }],
        termination: "r1_screenplay_final_submission",
        narration: {
          scene_state: screenplay.scene_state,
          mode: "single_pass_screenplay_without_shared_transcript"
        },
        leader_submit: leaderSubmit
      };
    } catch (error) {
      lastError = error.message;
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          attempt: attempt + 1,
          status: "error",
          error: lastError,
          raw: lastRaw
        });
      }
	      messages = [
	        baseMessages[0],
	        {
	          role: "user",
	          content: [
		            "上一版 R1 剧本没有被界面接受。",
		            `界面/解析提示：${lastError}`,
		            "请重写完整剧本，仍然按演员人设写，不要改成商业报告。",
		            `actor 字段只能填写这些真实成员 id：${legalActorIds}。`,
		            naturalStrategy
		              ? `合法 target_market_id 只能是：${TARGET_MARKET_OPTIONS.map((item) => item.target_id).join(", ")}`
		              : `合法 grid_id 只能是：${GRID_IDS.join(", ")}`,
		            "architecture 只能是 Experience / Hybrid / Function。",
		            chatAskStrategy
		              ? "strategy_choice 必须是 A 或 B。A=更特别/更适合/体验或功能更好；B=更划算/更容易普及/更容易被采购采用。"
		              : "",
		            naturalStrategy
		              ? (chatAskStrategy
		                  ? "final_submission 必须完整包含 target_market_id、strategy_choice、strategy_choice_line、architecture、competitive_strategy_text、vp_summary.who、vp_summary.pain、vp_summary.how、rationale。"
		                  : "final_submission 必须完整包含 target_market_id、architecture、competitive_strategy_text、vp_summary.who、vp_summary.pain、vp_summary.how、rationale。")
		              : "final_submission 必须完整包含 grid_id、architecture、vp_summary.who、vp_summary.pain、vp_summary.how、rationale。",
	            "只输出 JSON。",
            "",
            "上一版 raw：",
            lastRaw
          ].join("\n")
        }
      ];
    }
  }
  throw new Error(`r1_screenplay_parse_failure: ${lastError}`);
}

async function callR1NarratorActorBeat({
  member,
  isLeader,
  arm,
  screenText,
  publicScene,
  privateState,
  ownProposal,
  heardTranscript,
  temperature,
  outputDir,
  phase
}) {
  const baseMessages = [
    {
      role: "system",
      content: [
        "你只扮演下面这一个人，不要替别人总结，不要当主持人。",
        "你要先读自己的主人公状态，再像真实课堂小组成员一样做一个很短的反应：可以说一句、犹豫、沉默、跑偏、坚持自己草稿或被别人动摇。",
        "不要输出商业报告，不要输出 JSON 以外内容。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【你的人设】",
        formatProfile(member, isLeader, arm),
        "",
        "【公开场景】",
        publicScene,
        "",
        "【只给你看的主人公状态】",
        formatD5ActorStateForPrompt(privateState),
        "",
        "【你的 R1 草稿】",
        `${ownProposal?.grid_id || ""}/${ownProposal?.architecture || ""}；WHO=${ownProposal?.vp_summary?.who || ""}；PAIN=${ownProposal?.vp_summary?.pain || ""}；HOW=${ownProposal?.vp_summary?.how || ""}；理由=${ownProposal?.rationale || ""}`,
        "",
        "【当前屏幕】",
        screenText,
        "",
        "【你刚听到的内容】",
        heardTranscript || "（还没人说话）",
        "",
        "【你的这一拍】",
        phase === "wrap"
          ? "讨论有点散了；如果你是组长，可以短短收一下当前共识或分歧，但不要直接写最终提交。"
          : "轮到你看一眼屏幕和别人刚说的话，可以短句、沉默、坚持、让步或跑偏；不是每个人都必须讲完整逻辑。",
        "schema：",
        '{"stage_direction":"动作/神情","line":"台词，可为空","silent":false}'
      ].join("\n")
    }
  ];
  let messages = baseMessages;
  let lastRaw = "";
  let lastError = "";
  const attemptsPath = outputDir ? path.join(outputDir, "r1_narrator_actor_attempts.jsonl") : null;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature, maxTokens: 700 });
      const beat = validateR1ActorBeat(parseJsonLoose(lastRaw), { member });
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          phase,
          member_id: member.profile_id,
          attempt: attempt + 1,
          status: "ok",
          raw: lastRaw,
          beat
        });
      }
      return beat;
    } catch (error) {
      lastError = error.message;
      const salvaged = {
        actor: member.profile_id,
        stage_direction: "",
        line: sanitizeRoomSpeech(lastRaw, member, null) || String(lastRaw || "").trim(),
        silent: false,
        salvage: true
      };
      if (salvaged.line) {
        if (attemptsPath) {
          appendJsonl(attemptsPath, {
            ts: new Date().toISOString(),
            phase,
            member_id: member.profile_id,
            attempt: attempt + 1,
            status: "salvaged",
            error: lastError,
            raw: lastRaw,
            beat: salvaged
          });
        }
        return salvaged;
      }
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          phase,
          member_id: member.profile_id,
          attempt: attempt + 1,
          status: "error",
          error: lastError,
          raw: lastRaw
        });
      }
      messages = [
        baseMessages[0],
        {
          role: "user",
          content: [
            "上一拍没有被解析。",
            `解析提示：${lastError}`,
            "请仍然只扮演自己，重写这一拍，只输出 JSON。",
            "",
            "上一版 raw：",
            lastRaw
          ].join("\n")
        }
      ];
    }
  }
  throw new Error(`r1_narrator_actor_beat_failure:${member.profile_id}:${lastError}`);
}

async function runR1NarratorActorDiscussion({
  members,
  leaderIdx,
  draws,
  proposals,
  initialTranscript,
  topic,
  maxTurns,
  config,
  temperature,
  seed,
  arm,
  outputDir
}) {
  const transcript = initialTranscript.slice();
  const screenText = buildR1ChoiceScreenPanel();
  const actorSheet = formatR1NarratorActorSheet(members, leaderIdx, draws, proposals, arm);
  const narratorMessages = [
    {
      role: "system",
      content: [
        "你是讨论室旁白，不是商业顾问。你的任务是写出 Round 1 刚开始时的场景气氛和每个成员的私有主人公状态。",
        "状态必须由人设、自己的草稿、锦囊、课堂心态、疲劳、面子和对屏幕的理解生成；不要直接替他们决定最终市场。",
        "不要输出正确答案、优化建议或主持人总结。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【成员素材】",
        actorSheet,
        "",
        "【当前屏幕】",
        screenText,
        "",
        "【旁白任务】",
        "写 R1 市场选择页刚打开时的公开场景，以及每个成员只给自己看的主人公状态。",
        "actor_states 每个成员一条；状态可以包含注意到什么、想表现/想躲开、哪里没看懂、想坚持哪个市场/架构，但不要编造隐藏指标。",
        "turn_order 可以是不完整自然顺序；不是每个人都必须积极发言，但组长应在某个时点试图收口。",
        "schema：",
        '{"public_scene":"公开旁白","actor_states":[{"actor":"Rxx","protagonist_state":"私有主人公状态","what_catches_eye":"...","social_pressure":"...","r1_impulse":"..."}],"turn_order":["Rxx"]}'
      ].join("\n")
    }
  ];
  if (outputDir) {
    writeJson(path.join(outputDir, "r1_narrator_prompt.json"), {
      seed,
      arm,
      messages: narratorMessages
    });
  }

  let narration = null;
  let lastRaw = "";
  let lastError = "";
  const narrationAttemptsPath = outputDir ? path.join(outputDir, "r1_narrator_attempts.jsonl") : null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(narratorMessages, { temperature, maxTokens: 2600 });
      narration = validateR1NarratorScene(parseJsonLoose(lastRaw), { members, leaderIdx });
      if (narrationAttemptsPath) {
        appendJsonl(narrationAttemptsPath, {
          ts: new Date().toISOString(),
          attempt: attempt + 1,
          status: "ok",
          raw: lastRaw,
          narration
        });
      }
      break;
    } catch (error) {
      lastError = error.message;
      if (narrationAttemptsPath) {
        appendJsonl(narrationAttemptsPath, {
          ts: new Date().toISOString(),
          attempt: attempt + 1,
          status: "error",
          error: lastError,
          raw: lastRaw
        });
      }
    }
  }
  if (!narration) throw new Error(`r1_narrator_scene_failure:${lastError}`);
  if (outputDir) {
    writeJson(path.join(outputDir, "r1_narrator_scene.json"), {
      seed,
      arm,
      narration
    });
  }

  transcript.push({ speaker: "narrator", text: narration.public_scene });
  const stateByActor = new Map(narration.actor_states.map((state) => [state.actor, state]));
  const memberById = new Map(members.map((member, index) => [member.profile_id, { member, index }]));
  const turns = [];
  const rng = makeRng(`r1_narrator_discussion:${seed}:${topic}`);
  let termination = "leader_decision";

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const scene = turn === 1
      ? {
          beats: narration.turn_order
            .map((actor) => memberById.get(actor))
            .filter(Boolean)
            .map((slot) => ({
              index: slot.index,
              kind: slot.index === leaderIdx ? "leader_probe" : "short_view",
              label: slot.index === leaderIdx ? "组长追问" : "短观点",
              generated: true
            })),
          nonverbal: [],
          silent: []
        }
      : pickRoomSceneBeats({ members, leaderIdx, topic, turn, rng, arm });
    if (turn === maxTurns && !scene.beats.some((beat) => beat.index === leaderIdx)) {
      scene.beats.push({
        index: leaderIdx,
        kind: "leader_wrap",
        label: "组长收口",
        generated: true
      });
    }
    const turnLog = {
      turn,
      scene_beats: scene.beats.concat(scene.nonverbal || []).map((item) => ({
        member_id: members[item.index].profile_id,
        kind: item.kind,
        label: item.label,
        generated: item.generated
      })),
      silent: (scene.silent || []).map((index) => members[index].profile_id),
      speakers: []
    };
    for (const item of scene.nonverbal || []) {
      const entry = { speaker: members[item.index].profile_id, text: item.text, beat: item.kind };
      transcript.push(entry);
      turnLog.speakers.push(entry);
      updateBehavioralStateAfterUtterance(members[item.index], {
        topic,
        beat: item,
        text: item.text,
        isLeader: item.index === leaderIdx,
        nonverbal: true
      });
    }
    for (const item of scene.beats) {
      const member = members[item.index];
      const beat = await callR1NarratorActorBeat({
        member,
        isLeader: item.index === leaderIdx,
        arm,
        screenText,
        publicScene: narration.public_scene,
        privateState: stateByActor.get(member.profile_id),
        ownProposal: proposals[item.index]?.parsed,
        heardTranscript: formatTranscript(transcript),
        temperature,
        outputDir,
        phase: item.kind === "leader_wrap" ? "wrap" : "turn"
      });
      const entry = { speaker: member.profile_id, text: r1ActorEntryText(beat), beat: item.kind };
      transcript.push(entry);
      turnLog.speakers.push(entry);
      updateBehavioralStateAfterUtterance(member, {
        topic,
        beat: item,
        text: entry.text,
        isLeader: item.index === leaderIdx,
        nonverbal: false
      });
    }
    const check = await moderatorCheck(transcript, topic, temperature, arm);
    turnLog.moderator = check;
    turnLog.state_after = members.map((member, index) => ({
      member_id: member.profile_id,
      is_leader: index === leaderIdx,
      state: {
        ...member.behavioral_state,
        activated_memory: Array.isArray(member.behavioral_state?.activated_memory)
          ? member.behavioral_state.activated_memory.slice()
          : []
      }
    }));
    turns.push(turnLog);
    if (check.converged) {
      termination = "r1_narrator_actor_converged";
      break;
    }
  }
  return { transcript, turns, termination, narration };
}

async function leaderSubmit({ members, leaderIdx, transcript, topic, decisionType, context, temperature, arm = "legacy" }) {
  const leader = members[leaderIdx];
  const r1WritingAssist = decisionType === "r1"
    ? (isRoomRoleplayArm(arm)
        ? "\n\n像课堂界面里组长准备点提交一样，把大家说过的话整理成能交的 WHO/PAIN/HOW；不要新增 transcript 没有支持的市场或用户。最终提交必须显式写出 WHO、PAIN、HOW 三项，每项至少一句。"
        : "\n\n提交前可以把全队共识整理成更清楚的 WHO/PAIN/HOW，像使用课堂界面的 AI 写作辅助一样润色表达；但不能新增 transcript 没有支持的市场、用户或隐藏模型指标。")
    : "";
  const submitInstruction = isRoomRoleplayArm(arm)
    ? [
	        `当前要提交：${topic}`,
	        "请像组长在界面前准备点提交一样收口，最多两句口语化说明，然后单独写一行【最终提交】给出明确选择。",
	        decisionType === "r1" ? "Round 1 最终提交必须包含：grid_id、architecture、WHO、PAIN、HOW；WHO/PAIN/HOW 三项都要写，不能省略。" : "",
	        decisionType === "r1" ? r1NoFinanceInstruction(arm, topic) : "",
	        decisionType === "r1" && hasR1ReadingStoryArm(arm) ? "如果 transcript 里有人提到财务或价格类说法，最终提交里不要把它当作主要理由；只整理用户、场景、痛点、产品形态和架构取舍。" : "",
	        decisionType === "cards" && hasD4HumanPickArm(arm) ? "选卡提交要基于刚才那一格的真实取舍；不要把团队合并草案原样全交，不要为了显得完整而保留每张看起来有用的卡。" : "",
        decisionType === "pricing_action" ? "最后只提交定价动作：压低售价抢量 或 抬高售价守毛利；不要提交具体价格、成本金额或公式。" : "",
        decisionType === "pricing_tier" ? "最后只提交相对档位：高 / 中 / 低；不要提交具体价格、成本金额或公式。" : "",
        decisionType === "price" ? "定价提交只需要给出最后滑块价格和一句人话理由，不要展开新的公式计算或成本拆账。" : "",
        "不要用自己的姓名/编号开头。只能基于共享 transcript 已经说出口的内容，不要引用私人 context。",
        r1WritingAssist
      ].filter(Boolean).join("\n")
    : `当前要提交：${topic}\n请基于共享 transcript 已经说出口的论据代表全队提交。不要引用私人 context。自然语言总结，必须给出明确最终选择。${r1WritingAssist}`;
  const constraints = submitConstraintText(decisionType, context);
  const messages = [
    { role: "system", content: formatProfile(leader, true, arm) },
    {
      role: "user",
      content: [
        `共享 transcript：\n${formatTranscript(transcript)}`,
        constraints,
        submitInstruction
      ].filter(Boolean).join("\n\n")
    }
  ];
  const submitMaxTokens = isRoomRoleplayArm(arm)
    ? (decisionType === "cards" ? 650 : (decisionType === "r1" ? 780 : 340))
    : 1000;
  let lastText = await callText(messages, { temperature, maxTokens: submitMaxTokens });
  let lastError = "";
  const retries = Number(context.submitParseRetries);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const parsed = await parseSubmission({ text: lastText, decisionType, context, temperature });
      return { text: lastText, parsed: parsed.parsed, parse_raw: parsed.raw, attempts: attempt + 1 };
    } catch (error) {
      lastError = error.message;
      if (attempt >= retries) break;
      const repairInstruction = decisionType === "r1"
        ? [
            "请只输出一个可 JSON.parse 的 JSON，不要自然语言。",
            `合法 grid_id 只能是：${GRID_IDS.join(", ")}`,
            "architecture 只能是 Experience / Hybrid / Function。",
            'JSON schema 必须完整：{"grid_id":"...","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。',
            "WHO、PAIN、HOW、rationale 都不能为空；只根据上一次提交和共享 transcript 修正，不引入新市场。"
          ].join("\n")
        : "请只修正最终提交，不引入新论据。";
      const repairMessages = [
        { role: "system", content: formatProfile(leader, true, arm) },
        {
          role: "user",
          content: [
            `你的上一次提交无法解析，原因：${lastError}`,
            constraints,
            repairInstruction,
            "上一次提交：",
            lastText
          ].filter(Boolean).join("\n")
        }
      ];
      lastText = await callText(repairMessages, {
        temperature,
        maxTokens: isRoomRoleplayArm(arm)
          ? (decisionType === "r1" ? 780 : Math.min(520, submitMaxTokens))
          : 900
      });
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

function productionMarketJinangSummary(jinangSettlement) {
  const market = jinangSettlement?.market || {};
  return {
    topMatchStrength: Number(market.match_strength || 0),
    totalBonus: Number(market.bonus || 0)
  };
}

function buildRound1Outcome(r1Parsed, vpScores, jinangSettlement, round1Model) {
  if (typeof TeamRoutes.buildRound1Outcome !== "function") {
    throw new Error("production TeamRoutes.buildRound1Outcome is unavailable");
  }
  const production = TeamRoutes.buildRound1Outcome(
    r1Parsed.grid_id,
    r1Parsed.architecture,
    vpScores,
    productionMarketJinangSummary(jinangSettlement)
  );
  const wtpRefRaw = Math.round(Number(production.WTPref || 0));
  const wtpAdjCompressedRaw = Math.round(Number(production.WTPadj || 0));
  const rhoC = Number(production.rho_C);
  if (!Number.isFinite(rhoC)) throw new Error("production round1 rho_C must be finite");
  const gmCap = Number(round1Model.GM_cap);
  const gmMultiplier = Number(round1Model.target_gm_suggest_multiplier);
  if (!Number.isFinite(gmCap)) throw new Error("round1Model.GM_cap must be finite");
  if (!Number.isFinite(gmMultiplier)) throw new Error("round1Model.target_gm_suggest_multiplier must be finite");
  const targetGm = Math.min(
    gmCap,
    Number((rhoC * gmMultiplier).toFixed(4))
  );
  return {
    ...production,
    grid_label: getGrid(r1Parsed.grid_id).label,
    architecture: r1Parsed.architecture,
    WTPref: wtpRefRaw,
    WTPadj: wtpAdjCompressedRaw,
    WTPref_scaled: scaleStoredMoney(wtpRefRaw, { positiveOnly: true }),
    WTPadj_scaled: scaleStoredMoney(wtpAdjCompressedRaw, { positiveOnly: true }),
    jinang_settlement: jinangSettlement,
    target_gm: targetGm,
    target_gm_rule: "simulation-shape-only: min(GM_cap, production rho_C * target_gm_suggest_multiplier)",
    production_source: "server/routes/teamRoutes.js::buildRound1Outcome"
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

function firstFinite(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function findGridEntry(collection, gridId, label) {
  const grids = collection?.grids;
  if (!Array.isArray(grids)) throw new Error(`${label}.grids must be an array`);
  const entry = grids.find((item) => item.grid_id === gridId);
  if (!entry) throw new Error(`${label} missing grid_id: ${gridId}`);
  return entry;
}

function pickMatchedPersona(personas, seed, gridPriorId) {
  if (!Array.isArray(personas) || personas.length < 1) {
    throw new Error(`persona_briefs_v1 missing personas for grid_id: ${gridPriorId}`);
  }
  const rng = makeRng(`r2-matched-persona:${seed}:${gridPriorId}`);
  return personas[Math.floor(rng() * personas.length)];
}

function formatMatchedPersonaNarrative(persona) {
  const source = persona.source_persona || {};
  const brief = persona.brief || {};
  const name = brief.name || source.name || persona.persona_id;
  const age = brief.age || source.age;
  const identity = brief.identity || source.title || source.occupation || "目标客户";
  const residence = brief.residence || source.living_situation || source.org_type || "";
  const economic = brief.economic || source.budget || "";
  return [
    `${name}${age ? `，${age}岁` : ""}，${identity}。${residence}`,
    economic ? `预算/经济约束：${economic}` : "",
    brief.tech_acceptance ? `技术接受度：${brief.tech_acceptance}` : ""
  ].filter(Boolean).join("\n");
}

function formatPersonaRoutine(persona) {
  const source = persona.source_persona || {};
  const items = [];
  if (source.daily_routine) items.push(source.daily_routine);
  if (Array.isArray(source.pressures) && source.pressures.length) {
    items.push(`主要压力：${source.pressures.slice(0, 3).join("；")}`);
  }
  if (source.trigger) items.push(`触发事件：${source.trigger}`);
  return items.join("\n");
}

function buildDimensionEvidenceFromGrid(gridEvidence) {
  const evidence = gridEvidence.dimension_evidence || {};
  return {
    perception: { strength: firstFinite(evidence.perception?.strength) },
    motion: { strength: firstFinite(evidence.motion?.strength) },
    interaction: { strength: firstFinite(evidence.interaction?.strength) },
    safety: { strength: firstFinite(evidence.safety?.strength) },
    extend: { strength: firstFinite(evidence.extend?.strength) },
    ops: { strength: firstFinite(evidence.ops?.strength) }
  };
}

function buildR1MatchedPrototype({ r1Frozen, materials, seed }) {
  const grid = getGrid(r1Frozen.grid_id);
  const gridPriorId = toGridPriorId(r1Frozen.grid_id);
  const briefsGrid = findGridEntry(materials.personaBriefs, gridPriorId, "persona_briefs_v1");
  const reportsGrid = findGridEntry(materials.personaReports, gridPriorId, "persona_reports_v1.3");
  const evidenceGrid = findGridEntry(materials.gridEvidence, gridPriorId, "grid_dimension_evidence_v2");
  const persona = pickMatchedPersona(briefsGrid.personas, seed, gridPriorId);
  const report = (reportsGrid.reports || []).find((item) => item.persona_id === persona.persona_id) || null;
  if (!report) throw new Error(`persona_reports_v1.3 missing ${gridPriorId}/${persona.persona_id}`);
  const gridKeywordsFull = uniqueStrings(report.grid_keywords_full);
  const coveredKeywords = uniqueStrings(report.covered_keywords);
  if (!gridKeywordsFull.length) throw new Error(`persona_reports_v1.3 ${gridPriorId}/${persona.persona_id} missing grid_keywords_full`);
  const coverageRatio = coveredKeywords.length / gridKeywordsFull.length;
  const source = persona.source_persona || {};
  const brief = persona.brief || {};
  const label = `${grid.label} · ${brief.name || source.name || persona.persona_id}`;
  const painPoints = Array.isArray(source.pains) && source.pains.length
    ? source.pains
    : Array.isArray(report?.grid_keywords_full) ? report.grid_keywords_full.slice(0, 6) : [];

  return {
    id: `${gridPriorId}__${persona.persona_id}`,
    label,
    r1_matched: true,
    r1_grid_id: r1Frozen.grid_id,
    grid_prior_id: gridPriorId,
    customer_type: grid.customer_type,
    strategy: grid.strategy,
    age: grid.age,
    persona_id: persona.persona_id,
    dimension_evidence: buildDimensionEvidenceFromGrid(evidenceGrid),
    tags: Array.isArray(evidenceGrid.tags) ? evidenceGrid.tags.slice(0, 6) : [],
    evidence_row: evidenceGrid,
    reports_viewed: [persona.persona_id],
    coverage_ratio: coverageRatio,
    covered_keywords: coveredKeywords,
    uncovered_keywords: gridKeywordsFull.filter((keyword) => !coveredKeywords.includes(keyword)),
    narrative_seed: {
      summary_title: label,
      person: formatMatchedPersonaNarrative(persona),
      routine: formatPersonaRoutine(persona),
      scenes: [
        ...(Array.isArray(source.pressures) ? source.pressures : []),
        source.trigger || ""
      ].filter(Boolean).slice(0, 6),
      pain_points: painPoints.slice(0, 6),
      habits: [
        source.tech_comfort ? `技术态度：${source.tech_comfort}` : "",
        source.interview_style ? `表达/访谈风格：${source.interview_style}` : ""
      ].filter(Boolean),
      emotions: Array.isArray(source.contradictions) ? source.contradictions.slice(0, 4) : [],
      report_excerpt: report?.report_text ? String(report.report_text).slice(0, 900) : "",
      source_files: {
        persona_briefs: "game_config_v0.1/persona_briefs_v1.json",
        persona_reports: "game_config_v0.1/persona_reports_v1.3.json",
        grid_evidence: "game_config_v0.1/grid_dimension_evidence_v2.json"
      }
    }
  };
}

async function chooseLegacyPrototype({ members, leaderIdx, draws, proposals, r1Frozen, config, materials, temperature, seed, arm }) {
  const archetypes = materials.archetypes.archetypes;
  const prototypeTranscript = [
    {
      speaker: "moderator",
      text: `我们队 Round 1 的正式结论如下：\n${JSON.stringify(r1Frozen, null, 2)}\n\n请选择一个 R2 客户原型。\n\n${archetypes.map(summarizePrototype).join("\n\n")}`
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
    seed: `${seed}:prototype`,
    arm
  });
  const prototypeSubmit = await leaderSubmit({
    members,
    leaderIdx,
    transcript: prototypeDiscussion.transcript,
    topic: "提交 R2 客户原型",
    decisionType: "prototype",
    context: { submitParseRetries: requireConfigNumber(config, "submit_parse_retries") },
    temperature,
    arm
  });
  const chosenPrototype = archetypes.find((item) => item.id === prototypeSubmit.parsed.prototype);
  if (!chosenPrototype) throw new Error(`prototype not found: ${prototypeSubmit.parsed.prototype}`);
  return { chosenPrototype, prototypeSubmit, prototypeDiscussion };
}

async function chooseR1MatchedPrototype({ members, leaderIdx, draws, proposals, r1Frozen, config, materials, temperature, seed, arm }) {
  const chosenPrototype = buildR1MatchedPrototype({ r1Frozen, materials, seed });
  const prototypeTranscript = [
    {
      speaker: "moderator",
      text: isRoomRoleplayArm(arm)
        ? `界面已经进入与你们 Round 1 市场匹配的客户调研页：${r1Frozen.grid_label || r1Frozen.grid_id}。这页不能切换 ToB/ToC、年龄段或策略口径。\n\n屏幕上的客户画像：\n\n${summarizePrototype(chosenPrototype)}\n\n请像小组读调研材料一样，说说你们看到的痛点和后面选卡该注意什么。`
        : `我们队 Round 1 的市场已经冻结为 ${r1Frozen.grid_label || r1Frozen.grid_id}。R2 客户画像必须继承这个市场，不允许切换 ToB/ToC、年龄段或策略口径。\n\n已匹配的 R2 客户画像如下：\n\n${summarizePrototype(chosenPrototype)}\n\n请讨论这个客户在界面里的需求证据，以及它对后续六个功能区选卡和定价的影响。`
    }
  ];
  const prototypeDiscussion = await runDiscussion({
    members,
    leaderIdx,
    draws,
    proposals,
    initialTranscript: prototypeTranscript,
    topic: `R2 客户画像理解：${chosenPrototype.label}`,
    maxTurns: requireConfigNumber(config, "max_turns_r2_per_segment"),
    config,
    temperature,
    seed: `${seed}:prototype`,
    arm
  });
  const prototypeSubmit = {
    parsed: {
      prototype: chosenPrototype.id,
      label: chosenPrototype.label,
      persona_id: chosenPrototype.persona_id,
      r1_grid_id: chosenPrototype.r1_grid_id,
      grid_prior_id: chosenPrototype.grid_prior_id,
      r1_matched: true,
      rationale: `deterministically matched to frozen Round 1 market ${chosenPrototype.r1_grid_id}; no cross-market prototype choice was allowed`
    },
    raw: null,
    attempts: 0
  };
  return { chosenPrototype, prototypeSubmit, prototypeDiscussion };
}

function normalizeConfiguredEvi(value, fallback = 0.7) {
  if (value == null || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function prototypeSignals(archetype, r1Frozen = {}) {
  if (archetype?.r1_matched) {
    const helpers = getRound2RouteTestHelpers();
    if (!helpers.buildStaticSummaryModeRadarResult || !helpers.mapEvidenceToResult || !helpers.computeDynamicSummaryEvi || !archetype.evidence_row) {
      throw new Error("matched R2 prototype requires round2 static summary evidence adapter");
    }
    const dynamicEvi = helpers.computeDynamicSummaryEvi(archetype.coverage_ratio);
    if (!Number.isFinite(dynamicEvi)) {
      throw new Error(`matched R2 prototype dynamic evi invalid: ${archetype.id}`);
    }
    const result = helpers.buildStaticSummaryModeRadarResult({
      gridId: archetype.grid_prior_id,
      architecture: r1Frozen.architecture || "",
      evidenceRow: archetype.evidence_row,
      mapEvidenceToResultFn: helpers.mapEvidenceToResult,
      eviOverride: dynamicEvi
    });
    return {
      radar: result.radar,
      tags: result.tags,
      evi: result.evi,
      source: "round2Routes.buildStaticSummaryModeRadarResult",
      reports_viewed: archetype.reports_viewed,
      coverage_ratio: archetype.coverage_ratio,
      covered_keywords: archetype.covered_keywords,
      uncovered_keywords: archetype.uncovered_keywords,
      confidence: result.confidence,
      scoreSource: result.scoreSource
    };
  }
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
    evi: normalizeConfiguredEvi(archetype.evi),
    source: "prototypeSignals.legacy"
  };
}

function groupsById(capabilityGroups) {
  return new Map(capabilityGroups.groups.map((group) => [group.group_id, group]));
}

function capGroupsById(capabilityGroups) {
  if (!Array.isArray(capabilityGroups.groups)) {
    throw new Error("capability_groups_v2.groups must be an array");
  }
  const map = new Map();
  for (const group of capabilityGroups.groups) {
    if (!Array.isArray(group.capabilities)) {
      throw new Error(`capability group ${group.group_id} capabilities must be an array`);
    }
    for (const cap of group.capabilities) {
      map.set(cap.cap_id, group.group_id);
    }
  }
  return map;
}

function readSelectionConstraints(compatibilityRules) {
  const perGroupMin = Number(compatibilityRules?.selection_constraints?.per_group_min);
  const totalMin = Number(compatibilityRules?.selection_constraints?.total_min);
  if (!Number.isFinite(perGroupMin) || perGroupMin < 1) {
    throw new Error("compatibility_rules_v2.selection_constraints.per_group_min must be >= 1");
  }
  if (!Number.isFinite(totalMin) || totalMin < 1) {
    throw new Error("compatibility_rules_v2.selection_constraints.total_min must be >= 1");
  }
  return { per_group_min: perGroupMin, total_min: totalMin };
}

function selectionRulesText(selectionConstraints) {
  return `每个功能区至少选 ${selectionConstraints.per_group_min} 张卡；全队最终累计总数至少 ${selectionConstraints.total_min} 张；无硬性总数上限。`;
}

function formatWan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("zh-CN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}万`;
}

function formatYuan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `¥${Math.round(n).toLocaleString("zh-CN")}`;
}

function formatSignedCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const prefix = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${prefix}${formatYuan(Math.abs(n))}`;
}

function formatSignedPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}

function calcGmPct(dCOGS, price, channelFee, baseCost = 0) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return NaN;
  return ((p * (1 - Number(channelFee || 0)) - Number(baseCost || 0) - Number(dCOGS || 0)) / p) * 100;
}

function capMetaById(capId) {
  for (const group of RD.CAP_GROUPS.groups || []) {
    for (const cap of group.capabilities || []) {
      if (cap.cap_id === capId) {
        return { group_id: group.group_id, group_name: group.name, cap_name: cap.name || capId };
      }
    }
  }
  return { group_id: "", group_name: "未分组", cap_name: capId };
}

function getProductionPricingContext(r1Frozen, materials) {
  const helper = getRound2RouteTestHelpers().buildRound2PricingContextForTeam;
  if (typeof helper === "function") {
    return helper({
      final_grid_id: r1Frozen.grid_id,
      final_architecture: r1Frozen.architecture
    });
  }
  return {
    ...(materials.round2Params.pricing_ui || {}),
    COGSbase: Number(RD.GLOBAL_PARAMS.V || 0),
    fixed_base: Number(RD.GLOBAL_PARAMS.F || 0),
    fixed_base_wan: Number((Number(RD.GLOBAL_PARAMS.F || 0) / 10000).toFixed(1))
  };
}

function getProductionChannelFee(gridId) {
  const helper = getRound2RouteTestHelpers().getRound2ChannelFeeByGrid;
  if (typeof helper === "function") return Number(helper(gridId));
  return String(gridId || "").startsWith("ToB") ? 0.15 : 0.25;
}

function selectedCardsCostSummary(cards, r1Frozen, pricingContext) {
  let dCOGS = 0;
  let nreWan = 0;
  const selected = [];
  const byGroup = new Map();
  for (const card of cards || []) {
    const params = RD.getCapabilityParams(card.cap_id, card.tier) || {};
    const meta = capMetaById(card.cap_id);
    const unitCost = Number(params.dCOGS || 0);
    const nre = Number(params.nre_tier || params.nre || 0);
    dCOGS += unitCost;
    nreWan += nre;
    selected.push(`${card.cap_id}｜${meta.cap_name}｜${card.tier}（${formatSignedCurrency(unitCost)}/台，研发${formatWan(nre)}）`);
    const current = byGroup.get(meta.group_id) || { name: meta.group_name, dCOGS: 0, nreWan: 0 };
    current.dCOGS += unitCost;
    current.nreWan += nre;
    byGroup.set(meta.group_id, current);
  }
  const baseUnitCost = Number(pricingContext.COGSbase || RD.GLOBAL_PARAMS.V || 0);
  const fixedBaseWan = Number(pricingContext.fixed_base_wan ?? (Number(RD.GLOBAL_PARAMS.F || 0) / 10000));
  const channelFee = getProductionChannelFee(r1Frozen.grid_id);
  return {
    selected,
    group_breakdown: Array.from(byGroup.values()).map((item) =>
      `${item.name}: ${formatSignedCurrency(item.dCOGS)}/台 / NRE ${formatWan(item.nreWan)}`
    ),
    card_count: selected.length,
    dCOGS: Math.round(dCOGS),
    nre_wan: Number(nreWan.toFixed(2)),
    base_unit_cost: Math.round(baseUnitCost),
    unit_cost_total: Math.round(baseUnitCost + dCOGS),
    fixed_base_wan: Number(fixedBaseWan.toFixed(2)),
    fixed_base: Number(pricingContext.fixed_base ?? RD.GLOBAL_PARAMS.F ?? fixedBaseWan * 10000),
    fixed_total: Number(pricingContext.fixed_base ?? RD.GLOBAL_PARAMS.F ?? fixedBaseWan * 10000) + (nreWan * 10000),
    fixed_total_wan: Number((fixedBaseWan + nreWan).toFixed(2)),
    channel_fee: channelFee,
    channel_fee_pct: Math.round(channelFee * 100)
  };
}

function round1UiMoneyView(r1Frozen) {
  const helper = getRound2RouteTestHelpers().buildStudentRound1MoneyView;
  if (typeof helper === "function") {
    return helper({
      round1Sam: r1Frozen.SAM_billion,
      round1WtpAdj: r1Frozen.WTPadj
    });
  }
  return {
    round1_sam: r1Frozen.SAM_billion_scaled || null,
    round1_wtp_adj: r1Frozen.WTPadj_scaled || null
  };
}

function r1WtpBreakdown(r1Frozen) {
  const finalPct = Math.round((Number(r1Frozen.wtp_multiplier || 1) - 1) * 100);
  const jinangDeltaPct = Math.round(Number(r1Frozen.jinang_wtp_bonus || r1Frozen.jinang_fit?.market?.bonus || 0) * 100);
  return {
    final_pct: finalPct,
    base_pct: finalPct - jinangDeltaPct,
    jinang_delta_pct: jinangDeltaPct
  };
}

function buildR2PricingInterfacePanel(r1Frozen, selectedCards, pricingContext, options = {}) {
  const summary = selectedCardsCostSummary(selectedCards, r1Frozen, pricingContext);
  const defaultPrice = Number(pricingContext.default_price || pricingContext.price_min || 0);
  const previewUnitMargin = Math.round(defaultPrice * (1 - summary.channel_fee) - summary.unit_cost_total);
  const previewBreakevenQ = previewUnitMargin > 0 ? Math.ceil(summary.fixed_total / previewUnitMargin) : null;
  const currentGm = calcGmPct(summary.dCOGS, defaultPrice, summary.channel_fee, summary.base_unit_cost);
  const moneyView = round1UiMoneyView(r1Frozen);
  const samText = Number.isFinite(Number(moneyView.round1_sam))
    ? `${Math.round(Number(moneyView.round1_sam)).toLocaleString("zh-CN")} 亿`
    : "待揭示";
  const wtpText = Number.isFinite(Number(moneyView.round1_wtp_adj))
    ? formatYuan(moneyView.round1_wtp_adj)
    : "待揭示";
  const wtpBreakdown = r1WtpBreakdown(r1Frozen);
  const roomRoleplay = options.roomRoleplay === true;
  return [
    "【界面：研发与定价决策 / 定价发布】",
    `预期毛利率：${Number.isFinite(currentGm) ? `${currentGm.toFixed(0)}%` : "待计算"}；提交按钮要求毛利率 ≥ 20%。`,
    `已选能力卡：${summary.selected.join("、") || "无"}`,
    `已选 ${summary.card_count} 张；dCOGS 合计 ${formatSignedCurrency(summary.dCOGS)}/台；NRE 合计 ${formatWan(summary.nre_wan)}；单台总变动成本 ${formatYuan(summary.unit_cost_total)}（基础 ${formatYuan(summary.base_unit_cost)} + dCOGS）。`,
    summary.group_breakdown.length ? `分功能区成本：${summary.group_breakdown.join("；")}` : "",
    `Round 1 锚定市场：${r1Frozen.grid_label || r1Frozen.grid_id}；SAM ${samText} / WTPadj ${wtpText}。`,
    `价值主张对支付意愿的影响：${formatSignedPercent(wtpBreakdown.final_pct)}（仅看 VP 本身 ${formatSignedPercent(wtpBreakdown.base_pct)}，市场锦囊额外影响 ${formatSignedPercent(wtpBreakdown.jinang_delta_pct)}）。`,
	    "【定价须知】",
	    roomRoleplay
	      ? `渠道抽成：约 ${summary.channel_fee_pct}%。`
	      : `渠道成本：你们定的售价不等于到手收入。当前渠道抽成约 ${summary.channel_fee_pct}%。`,
    roomRoleplay ? "" : "量价权衡：价格越高，每台赚得越多，但愿意买的用户越少；价格越低，用户越多，但可能卖一台亏一台。",
    roomRoleplay ? "" : "产品力影响：产品能力组合越精准匹配目标场景，用户对价格的敏感度越低——好产品可以卖更贵。",
    "【产品售价控件】",
    `当前显示 ${formatYuan(defaultPrice)}；滑块最低 ${formatYuan(pricingContext.price_min)}（低价走量），最高 ${formatYuan(pricingContext.price_max)}（高端定位）。`,
    roomRoleplay
      ? `当前显示价格下：渠道抽成后每台到手 ${formatYuan(defaultPrice * (1 - summary.channel_fee))}；单台毛利 ${formatSignedCurrency(previewUnitMargin)}。`
      : `按当前显示价格估算：渠道抽成后每台到手 ${formatYuan(defaultPrice * (1 - summary.channel_fee))}；总固定成本 ${formatWan(summary.fixed_total_wan)}；盈亏平衡销量 ${previewBreakevenQ ? `${previewBreakevenQ.toLocaleString("zh-CN")} 台` : "无法回本"}；单台毛利 ${formatSignedCurrency(previewUnitMargin)}。`
  ].filter(Boolean).join("\n");
}

function buildR2PricingActionPersonaPanel(r1Frozen, selectedCards, pricingContext) {
  const summary = selectedCardsCostSummary(selectedCards, r1Frozen, pricingContext);
  return [
    "【界面：产品售价】",
    `已冻结市场：${r1Frozen.grid_label || r1Frozen.grid_id || ""}；架构：${r1Frozen.architecture || ""}`,
    `WHO：${r1Frozen.vp_summary?.who || ""}`,
    `PAIN：${r1Frozen.vp_summary?.pain || ""}`,
    `HOW：${r1Frozen.vp_summary?.how || ""}`,
    `已选能力卡：${summary.selected.join("、") || "无"}`,
    `成本区可见：基础成本 ${formatYuan(summary.base_unit_cost)}，能力增量成本 ${formatYuan(summary.dCOGS)}，研发投入 ${formatWan(summary.nre_wan)}。这些只是界面信息，不要求逐项复述。`,
    `界面显示的价格滑块范围：${formatYuan(pricingContext.price_min)} 到 ${formatYuan(pricingContext.price_max)}；步长不作为决策提示。`,
    "请只按这个界面能看到的信息、前面团队已确定的市场和选卡来定价；不要使用界面外的隐藏公式，也不要把讨论变成财务报告。"
  ].join("\n");
}

function cardKey(card) {
  return `${card.cap_id}@${card.tier}`;
}

function tierStrength(tier) {
  if (tier === "high") return 1;
  if (tier === "mid") return 0.58;
  return 0.24;
}

function valueFeelLabel(score) {
  if (score < 0.36) return "不太确定这套卡能撑起明显价值";
  if (score < 0.64) return "觉得有些功能有价值，但还要看用户买不买账";
  return "觉得这套功能组合有辨识度，能支撑更强价值感";
}

function costFeelLabel(score) {
  if (score < 0.36) return "成本和复杂度看起来还可控";
  if (score < 0.64) return "成本有压力，但不至于完全不能卖";
  return "感觉功能堆得有点重，担心卖贵或后续不好交代";
}

function pricingImpulseLabel(position) {
  if (position < 0.36) return "偏低：更想让用户先买起来";
  if (position < 0.64) return "偏中间：想稳一点，不想把话说死";
  return "偏高：觉得不能把产品价值卖便宜了";
}

function pricingImpulse(position) {
  if (position < 0.36) return "low";
  if (position < 0.64) return "mid";
  return "high";
}

function d5SpeakingAngle({ valueConfidence, costConcern, ownRetainedRatio, pricingPosition }) {
  if (ownRetainedRatio < 0.45) return "你自己原来支持的卡有些没保住，可能会先质疑这套方案值不值";
  if (costConcern > valueConfidence + 0.16) return "你更容易先说成本、用户嫌贵或采购阻力";
  if (valueConfidence > costConcern + 0.16) return "你更容易先替核心功能和差异化价值撑价";
  if (pricingPosition < 0.42) return "你更容易把话题拉向成交、试水和别吓跑用户";
  if (pricingPosition > 0.58) return "你更容易提醒大家价格太低会显得产品没底气";
  return "你更容易说一个模糊折中判断，边听边改";
}

function seedD5CardReviewState({ members, leaderIdx, selectedCards, individualSelections, r1Frozen, priceConfig, seed }) {
  const rng = makeRng(`d5_card_review:${seed}`);
  const summary = selectedCardsCostSummary(selectedCards, r1Frozen, priceConfig);
  const finalCaps = new Set((selectedCards || []).map((card) => card.cap_id));
  const finalKeys = new Set((selectedCards || []).map(cardKey));
  const avgTierStrength = selectedCards.length
    ? selectedCards.reduce((sum, card) => sum + tierStrength(card.tier), 0) / selectedCards.length
    : 0.5;
  const costLoad = clamp((Number(summary.dCOGS || 0) - 650) / 1450, 0, 1);
  const nreLoad = clamp(Number(summary.nre_wan || 0) / 520, 0, 1);
  const manyCardsLoad = selectedCards.length > 12 ? clamp((selectedCards.length - 12) / 6, 0, 1) : 0;
  const diffStrategy = String(r1Frozen.grid_id || "").includes("DIFF");
  const toB = String(r1Frozen.grid_id || "").startsWith("ToB");
  const selectionsByMember = new Map((individualSelections || []).map((item) => [item.member_id, item]));

  return members.map((member, index) => {
    const isLeader = index === leaderIdx;
    const behavior = classroomBehaviorProfile(member, isLeader);
	    const state = ensureBehavioralState(member, isLeader);
	    const ownSelection = selectionsByMember.get(member.profile_id);
	    const ownCards = ownSelection?.parsed?.cards || [];
	    const ownRetainedCards = ownCards.filter((card) => finalCaps.has(card.cap_id));
	    const ownExactRetainedCards = ownCards.filter((card) => finalKeys.has(cardKey(card)));
	    const ownRetainedRatio = ownCards.length ? ownRetainedCards.length / ownCards.length : 0.5;
	    const d4States = Object.values(state.d4_group_state || {});
	    const d4Confidence = meanOrNull(d4States.map((item) => Number(item.card_confidence)).filter(Number.isFinite)) ?? 0.5;
	    const d4CostConcern = meanOrNull(d4States.map((item) => Number(item.cost_discomfort)).filter(Number.isFinite)) ?? 0.5;
	    const d4Ownership = meanOrNull(d4States.map((item) => Number(item.ownership_commitment)).filter(Number.isFinite)) ?? 0;
	    const pricingText = `${member.pricingBias || ""} ${member.decisionStyle || ""} ${member.riskPreference || ""}`;
	    const lowerLean = /低价|走量|成本|保守|谨慎|预算|风险|别太贵/u.test(pricingText) ? 0.08 : 0;
	    const higherLean = /高端|溢价|品牌|价值|毛利|守毛利|差异/u.test(pricingText) ? 0.08 : 0;
	    const jitter = () => (rng() - 0.5) * 0.14;
    const valueConfidence = clamp(
      0.33 +
        avgTierStrength * 0.22 +
        ownRetainedRatio * 0.22 +
        (diffStrategy ? 0.08 : -0.02) +
        (toB ? 0.03 : 0) +
	        behavior.statusMotive * 0.08 +
	        behavior.engagement * 0.08 -
	        Number(state.confusion || 0) * 0.1 +
	        (d4Confidence - 0.5) * 0.12 +
	        d4Ownership * 0.06 +
	        higherLean +
	        jitter(),
      0,
      1
    );
    const costConcern = clamp(
      0.24 +
        costLoad * 0.3 +
        nreLoad * 0.17 +
        manyCardsLoad * 0.12 +
	        Number(state.price_sensitivity || 0.5) * 0.24 +
	        behavior.calculationImpulse * 0.08 +
	        (d4CostConcern - 0.5) * 0.18 +
	        lowerLean +
	        jitter(),
      0,
      1
    );
    const personalStake = clamp(
      0.22 +
        ownRetainedRatio * 0.22 +
        ownCards.length * 0.035 +
	        behavior.dominance * 0.12 +
	        behavior.statusMotive * 0.1 +
	        d4Ownership * 0.1 +
	        (isLeader ? 0.08 : 0) -
	        behavior.agreeability * 0.05,
      0,
      1
    );
    const pricingPosition = clamp(
      0.5 +
        (valueConfidence - costConcern) * 0.46 -
        (Number(state.price_sensitivity || 0.5) - 0.5) * 0.22 +
	        higherLean -
	        lowerLean +
	        (d4Confidence - d4CostConcern) * 0.08 +
	        (diffStrategy ? 0.03 : -0.02) +
	        jitter(),
      0,
      1
    );
    const review = {
      member_id: member.profile_id,
      value_confidence: Number(valueConfidence.toFixed(3)),
      cost_concern: Number(costConcern.toFixed(3)),
      personal_stake: Number(personalStake.toFixed(3)),
      pricing_position: Number(pricingPosition.toFixed(3)),
      pricing_impulse: pricingImpulse(pricingPosition),
      pricing_impulse_label: pricingImpulseLabel(pricingPosition),
      value_feel: valueFeelLabel(valueConfidence),
      cost_feel: costFeelLabel(costConcern),
      speaking_angle: d5SpeakingAngle({ valueConfidence, costConcern, ownRetainedRatio, pricingPosition }),
      own_cards_total: ownCards.length,
      own_cards_retained: ownRetainedCards.length,
      own_cards_exact_retained: ownExactRetainedCards.length,
      own_cards: ownCards.map(cardKey),
	      own_retained_cards: ownRetainedCards.map(cardKey),
	      d4_state_summary: {
	        card_confidence_mean: Number(d4Confidence.toFixed(3)),
	        cost_discomfort_mean: Number(d4CostConcern.toFixed(3)),
	        ownership_commitment_mean: Number(d4Ownership.toFixed(3))
	      },
	      team_card_count: selectedCards.length,
      team_dCOGS: summary.dCOGS,
      team_nre_wan: summary.nre_wan
    };
    state.d5_card_review = review;
    state.attention_focus = "刚复盘完选卡，在想这套功能到底撑不撑得起售价";
    state.confidence = clamp(state.confidence + (valueConfidence - 0.5) * 0.12, 0, 1);
    state.confusion = clamp(state.confusion + Math.max(0, costConcern - valueConfidence) * 0.08, 0, 1);
    state.price_sensitivity = clamp(state.price_sensitivity + (costConcern - 0.5) * 0.18 - (valueConfidence - 0.5) * 0.08, 0, 1);
    state.social_commitment = clamp(state.social_commitment + personalStake * 0.04, 0, 1);
    return review;
  });
}

function pricingActionText(action) {
  if (action === "lower_price_for_volume") return "压低售价抢量";
  if (action === "higher_price_for_margin") return "抬高售价守毛利";
  return String(action || "");
}

function pricingTierText(tier) {
  if (tier === "low") return "低";
  if (tier === "mid") return "中";
  if (tier === "high") return "高";
  return String(tier || "");
}

async function runPricingActionPersonaD5({
  members,
  leaderIdx,
  draws,
  proposals,
  r1Frozen,
  chosenPrototype,
  selectedCards,
  priceConfig,
  config,
  temperature,
  seed,
  arm
}) {
  const discussFn = isPricingActionActorArm(arm) ? runActorStageDiscussion : runDiscussion;
  const stageVoice = isPricingActionActorArm(arm) ? "screen" : "moderator";
  const maxTurns = requireConfigNumber(config, "max_turns_r2_per_segment");
  const submitParseRetries = requireConfigNumber(config, "submit_parse_retries");
  const basePanel = [
    buildR2PricingContextPanel(r1Frozen, chosenPrototype),
    "",
    buildR2PricingActionPersonaPanel(r1Frozen, selectedCards, priceConfig)
  ].join("\n");

  const actionInitialTranscript = [{
    speaker: stageVoice,
    text: [
      basePanel,
      "",
      "【D5 第一步：定价动作】",
      "现在小组站在产品售价滑块前，先讨论定价动作，不提交具体价格。",
      "A：压低售价抢量。意思是用相对更低的售价换更多用户愿意买，不追求单台高毛利。",
      "B：抬高售价守毛利。意思是接受销量可能少一些，用相对更高售价覆盖能力成本和渠道抽成，保护单台毛利。",
      "每个人用自己的说话方式参与；如果心里摇摆，也说出此刻更偏哪边。",
      "这一段不报具体价格，不复述成本金额，不算公式。",
      "不要输出 JSON，不要 Markdown 表格。"
    ].join("\n")
  }];
  const actionDiscussion = await discussFn({
    members,
    leaderIdx,
    draws,
    proposals,
    initialTranscript: actionInitialTranscript,
    topic: "D5 第一步：定价动作",
    maxTurns,
    config,
    temperature,
    seed: `${seed}:price:action`,
    arm
  });
  const actionSubmit = await leaderSubmit({
    members,
    leaderIdx,
    transcript: actionDiscussion.transcript,
    topic: "提交 D5 定价动作",
    decisionType: "pricing_action",
    context: { submitParseRetries },
    temperature,
    arm
  });
  const actionTranscript = actionDiscussion.transcript.concat([{
    speaker: members[leaderIdx].profile_id,
    text: `【组长提交｜定价动作】${actionSubmit.text}`
  }]);

  const tierInitialTranscript = actionTranscript.concat([{
    speaker: stageVoice,
    text: [
      `【已冻结定价动作】${pricingActionText(actionSubmit.parsed.pricing_action)}`,
      "",
      "【D5 第二步：相对档位】",
      "承接刚才的动作，现在讨论价格放在相对高档、中档、还是低档。",
      "如果动作偏压低售价抢量，低档或中档更符合这个动作；如果动作偏抬高售价守毛利，中档或高档更符合这个动作。",
      "高/中/低只是滑块相对位置，不给固定数值段，也不代表建议价或锚点。",
      "这一段仍然不要提交具体价格，也不要复述成本金额。"
    ].join("\n")
  }]);
  const tierDiscussion = await discussFn({
    members,
    leaderIdx,
    draws,
    proposals,
    initialTranscript: tierInitialTranscript,
    topic: "D5 第二步：相对档位",
    maxTurns,
    config,
    temperature,
    seed: `${seed}:price:tier`,
    arm
  });
  const tierSubmit = await leaderSubmit({
    members,
    leaderIdx,
    transcript: tierDiscussion.transcript,
    topic: "提交 D5 相对档位",
    decisionType: "pricing_tier",
    context: { submitParseRetries },
    temperature,
    arm
  });
  const tierTranscript = tierDiscussion.transcript.concat([{
    speaker: members[leaderIdx].profile_id,
    text: `【组长提交｜相对档位】${tierSubmit.text}`
  }]);

  const finalInitialTranscript = tierTranscript.concat([{
    speaker: stageVoice,
    text: [
      `【已冻结定价动作】${pricingActionText(actionSubmit.parsed.pricing_action)}`,
      `【已冻结相对档位】${pricingTierText(tierSubmit.parsed.tier)}`,
      "",
      "【D5 第三步：最终价格】",
      `现在请在界面滑块 ${formatYuan(priceConfig.price_min)} 到 ${formatYuan(priceConfig.price_max)} 里讨论并提交一个最终价格。`,
      "不要使用固定步长，也不要把上下限或中点当默认答案。",
      "像真实小组一样落到一个数字：可以有人凭感觉、有人担心贵、有人觉得差不多；最后由组长提交最终价格。",
      "最终讨论只需要一个价格和人话理由，不要展开成本拆账。",
      "不要输出 JSON，不要 Markdown 表格。"
    ].join("\n")
  }]);
  const priceDiscussion = await discussFn({
    members,
    leaderIdx,
    draws,
    proposals,
    initialTranscript: finalInitialTranscript,
    topic: "D5 第三步：最终价格",
    maxTurns,
    config,
    temperature,
    seed: `${seed}:price:final`,
    arm
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
      priceStep: Number(priceConfig.price_step),
      pricingAction: actionSubmit.parsed.pricing_action,
      pricingTier: tierSubmit.parsed.tier,
      submitParseRetries
    },
    temperature,
    arm
  });
  const finalTranscript = priceDiscussion.transcript.concat([{
    speaker: members[leaderIdx].profile_id,
    text: `【组长提交｜最终价格】${priceSubmit.text}`
  }]);

  return {
    priceSubmit,
    checkpoints: [
      {
        decision_point: "price_action",
        termination: actionDiscussion.termination,
        turns: actionDiscussion.turns.length,
        frozen: actionSubmit.parsed,
        submit_attempts: actionSubmit.attempts
      },
      {
        decision_point: "price_tier",
        termination: tierDiscussion.termination,
        turns: tierDiscussion.turns.length,
        pricing_action: actionSubmit.parsed.pricing_action,
        frozen: tierSubmit.parsed,
        submit_attempts: tierSubmit.attempts
      },
      {
        decision_point: "price",
        termination: priceDiscussion.termination,
        turns: priceDiscussion.turns.length,
        pricing_action: actionSubmit.parsed.pricing_action,
        pricing_tier: tierSubmit.parsed.tier,
        frozen: priceSubmit.parsed,
        submit_attempts: priceSubmit.attempts
      }
    ],
    transcripts: [
      { decision_point: "price_action", transcript: actionTranscript, turns: actionDiscussion.turns },
      { decision_point: "price_tier", transcript: tierTranscript, turns: tierDiscussion.turns },
      { decision_point: "price", transcript: finalTranscript, turns: priceDiscussion.turns }
    ]
  };
}

function pricePosition(price, priceConfig) {
  const min = Number(priceConfig.price_min);
  const max = Number(priceConfig.price_max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5;
  return clamp((Number(price) - min) / (max - min), 0, 1);
}

function posthocPricingTier(price, priceConfig) {
  const pos = pricePosition(price, priceConfig);
  if (pos < 0.34) return "low";
  if (pos < 0.67) return "mid";
  return "high";
}

function posthocPricingAction(transcriptText, price, priceConfig) {
  const text = String(transcriptText || "");
  const lowerSignals = (text.match(/低价|便宜|抢量|走量|预算|审批|价格敏感|别太贵|买得起|划算/gu) || []).length;
  const higherSignals = (text.match(/高价|价值感|高端|守毛利|毛利|溢价|服务承诺|售后|品牌|别太低/gu) || []).length;
  if (lowerSignals > higherSignals) return "lower_price_for_volume";
  if (higherSignals > lowerSignals) return "higher_price_for_margin";
  return pricePosition(price, priceConfig) >= 0.5 ? "higher_price_for_margin" : "lower_price_for_volume";
}

const CN_PRICE_DIGITS = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

function normalizePriceDigits(text) {
  return String(text || "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function cnPriceDigit(char) {
  return CN_PRICE_DIGITS[char] || null;
}

function parseChinesePricePhrase(raw, afterText = "") {
  const approximateTail = `${raw}${afterText.slice(0, 3)}`;
  if (/出头|多一点|多块|多元/u.test(approximateTail)) return null;
  let text = String(raw || "").replace(/[人民币元块钱\s]/gu, "").replace(/仟/gu, "千");
  if (!/^[二两三四五六]千/u.test(text)) return null;
  let total = cnPriceDigit(text[0]) * 1000;
  let rest = text.slice(2);
  if (!rest) return total;
  if (rest.startsWith("零")) rest = rest.slice(1);
  if (!rest) return total;

  let hadHundred = false;
  const hundredIndex = rest.indexOf("百");
  if (hundredIndex >= 0) {
    if (hundredIndex === 0) return null;
    const hundred = cnPriceDigit(rest[hundredIndex - 1]);
    if (!hundred) return null;
    total += hundred * 100;
    rest = rest.slice(hundredIndex + 1);
    hadHundred = true;
  } else if (rest.length === 1) {
    const hundred = cnPriceDigit(rest[0]);
    return hundred ? total + hundred * 100 : null;
  }

  if (rest.startsWith("零")) rest = rest.slice(1);
  if (!rest) return total;
  const tenIndex = rest.indexOf("十");
  if (tenIndex >= 0) {
    const ten = tenIndex === 0 ? 1 : cnPriceDigit(rest[tenIndex - 1]);
    if (!ten) return null;
    total += ten * 10;
    const onesText = rest.slice(tenIndex + 1);
    if (onesText) {
      const ones = cnPriceDigit(onesText[0]);
      if (!ones) return null;
      total += ones;
    }
    return total;
  }
  if (rest.length === 1) {
    const digit = cnPriceDigit(rest[0]);
    if (!digit) return null;
    return total + (hadHundred ? digit * 10 : digit);
  }
  return null;
}

function priceCandidateContext(text, start, end) {
  return normalizePriceDigits(text).slice(Math.max(0, start - 28), Math.min(text.length, end + 28));
}

function isRangePriceContext(text, start, end, context) {
  const around = text.slice(Math.max(0, start - 16), Math.min(text.length, end + 16));
  if (/区间|范围|最低|最高|上限|下限|从|介于/u.test(context)) return true;
  return /(?:[2-6](?:,\d{3}|\d{3})|[二两三四五六][千仟])\s*[到至~—-]\s*(?:[2-6](?:,\d{3}|\d{3})|[二两三四五六][千仟])/u.test(around);
}

function priceIntentScore(context) {
  let score = 0;
  if (/最终|定价|售价|价格|价位|滑块|停|拖|拉|报|提交|按|就|这个数|这个位置|收口/u.test(context)) score += 2;
  if (/区间|范围|最低|最高|上限|下限|从|介于/u.test(context)) score -= 5;
  return score;
}

function collectTranscriptPriceCandidates(entry, messageIndex, priceConfig, options = {}) {
  const speaker = String(entry.speaker || "");
  const text = normalizePriceDigits(entry.text || "");
  const min = Number(priceConfig.price_min);
  const max = Number(priceConfig.price_max);
  const includeOutOfRange = Boolean(options.includeOutOfRange);
  const candidates = [];
  function addCandidate(raw, price, start, end, type) {
    if (!Number.isFinite(price)) return;
    const outOfRange = price < min || price > max;
    if (outOfRange && !includeOutOfRange) return;
    if (/万/u.test(text.slice(end, end + 2))) return;
    const context = priceCandidateContext(text, start, end);
    if (isRangePriceContext(text, start, end, context)) return;
    const score = priceIntentScore(context);
    if (score < 0) return;
    candidates.push({
      price: Math.round(price),
      raw,
      type,
      speaker,
      text,
      context,
      messageIndex,
      start,
      end,
      score,
      out_of_range: outOfRange
    });
  }

  const numericPattern = includeOutOfRange
    ? /(?:[¥￥]\s*)?([1-9](?:,\d{3}|\d{3,4}))(?!\d)(?:\.\d+)?\s*(?:元|块|人民币)?/gu
    : /(?:[¥￥]\s*)?([2-6](?:,\d{3}|\d{3}))(?:\.\d+)?\s*(?:元|块|人民币)?/gu;
  let match = null;
  while ((match = numericPattern.exec(text))) {
    const raw = match[0];
    const price = Number(match[1].replace(/,/gu, ""));
    addCandidate(raw, price, match.index, match.index + raw.length, "arabic");
  }

  const chinesePattern = includeOutOfRange
    ? /[一二两三四五六七八九][千仟](?:[零一二两三四五六七八九百十]{0,5})(?:元|块|钱)?/gu
    : /[二两三四五六][千仟](?:[零一二两三四五六七八九百十]{0,5})(?:元|块|钱)?/gu;
  while ((match = chinesePattern.exec(text))) {
    const raw = match[0];
    const afterText = text.slice(match.index + raw.length, match.index + raw.length + 4);
    const price = parseChinesePricePhrase(raw, afterText);
    addCandidate(raw, price, match.index, match.index + raw.length, "chinese");
  }
  return candidates;
}

function parseD5PriceFromTranscript(transcript, priceConfig) {
  const candidates = [];
  for (let index = 0; index < transcript.length; index += 1) {
    const entry = transcript[index];
    if (!entry || entry.speaker === "moderator") continue;
    candidates.push(...collectTranscriptPriceCandidates(entry, index, priceConfig));
  }
  if (!candidates.length) {
    throw new Error("price_parse_failed: no explicit legal participant price in D5 transcript");
  }
  candidates.sort((a, b) => {
    if (a.messageIndex !== b.messageIndex) return a.messageIndex - b.messageIndex;
    if (a.end !== b.end) return a.end - b.end;
    return a.score - b.score;
  });
  const chosen = candidates[candidates.length - 1];
  return {
    price: chosen.price,
    source_speaker: chosen.speaker,
    source_raw: chosen.raw,
    source_text: chosen.text,
    source_context: chosen.context,
    candidate_count: candidates.length,
    parser: "deterministic_last_participant_price"
  };
}

function buildR2StoryPricingScreenPanel(r1Frozen, selectedCards, pricingContext) {
  const summary = selectedCardsCostSummary(selectedCards, r1Frozen, pricingContext);
  return [
    "【界面：产品售价页】",
    `已冻结市场：${r1Frozen.grid_label || r1Frozen.grid_id || ""}；架构：${r1Frozen.architecture || ""}`,
    `WHO：${r1Frozen.vp_summary?.who || ""}`,
    `PAIN：${r1Frozen.vp_summary?.pain || ""}`,
    `HOW：${r1Frozen.vp_summary?.how || ""}`,
    `已选能力卡：${summary.selected.join("、") || "无"}`,
    `成本区可见：基础成本 ${formatYuan(summary.base_unit_cost)}，能力增量成本 ${formatYuan(summary.dCOGS)}，研发投入 ${formatWan(summary.nre_wan)}。`,
    "右侧有产品售价滑块，边界在界面上可见；角色不需要把边界念出来。"
  ].join("\n");
}

function formatD5ScreenplayActorSheet(members, leaderIdx) {
  return members.map((member, index) => {
    const state = ensureBehavioralState(member, index === leaderIdx);
    const review = state.d5_card_review || {};
    return [
      `【演员 ${member.profile_id}${index === leaderIdx ? " / 组长" : ""}】`,
      formatProfile(member, index === leaderIdx, "team_room_story_d4d5_v1"),
      formatR1ActorCarryoverForPrompt(member),
      review.value_feel ? `D5 私有复盘：${review.value_feel}；${review.cost_feel}；${review.speaking_angle}` : "",
      review.own_cards ? `自己原先点过的卡：${review.own_cards.join("、") || "无"}；最终保留：${(review.own_retained_cards || []).join("、") || "无"}` : "",
      `当前状态：注意点=${state.attention_focus || ""}；信心=${Number(state.confidence || 0).toFixed(2)}；疲劳=${Number(state.fatigue || 0).toFixed(2)}；价格敏感=${Number(state.price_sensitivity || 0).toFixed(2)}。`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function normalizeScreenplayActionType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (/confirm|submit|final|确定|确认|停|提交|就这个/u.test(text)) return "confirm_price";
  if (/drag|slider|move|try|拖|拉|滑|试|放到/u.test(text)) return "drag_slider";
  return text;
}

function screenplayPriceFromAction(action, line) {
  const raw = action && typeof action === "object"
    ? (action.price ?? action.value ?? action.amount ?? action.to ?? action.target_price ?? action.final_price ?? action["价格"])
    : null;
  const direct = Number(String(raw ?? "").replace(/[¥￥,\s元块钱]/gu, ""));
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const text = normalizePriceDigits(`${line || ""} ${JSON.stringify(action || {})}`);
  const numeric = text.match(/(?:[¥￥]\s*)?([1-9]\d{2,4})(?:\.\d+)?\s*(?:元|块|人民币)?/u);
  if (numeric) return Math.round(Number(numeric[1]));
  const chinese = text.match(/[一二两三四五六七八九][千仟](?:[零一二两三四五六七八九百十]{0,5})(?:元|块|钱)?/u);
  if (chinese) {
    const parsed = parseChinesePricePhrase(chinese[0], "");
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function normalizeScreenplayActor(actor, members) {
  const aliases = new Map();
  for (const member of members) {
    const name = member.surface?.name || "";
    aliases.set(member.profile_id, member.profile_id);
    aliases.set(`@${member.profile_id}`, member.profile_id);
    const tbnMatch = String(member.profile_id || "").match(/^TBN0*(\d+)$/u);
    if (tbnMatch) {
      aliases.set(`R${tbnMatch[1]}`, member.profile_id);
      aliases.set(`R${tbnMatch[1].padStart(2, "0")}`, member.profile_id);
    }
    if (name) {
      aliases.set(name, member.profile_id);
      aliases.set(`${member.profile_id} ${name}`, member.profile_id);
      aliases.set(`${member.profile_id}（${name}）`, member.profile_id);
    }
  }
  const raw = String(actor || "").trim();
  return aliases.get(raw) || aliases.get(raw.replace(/^演员[:：\s]*/u, "")) || "";
}

function validateD5Screenplay(parsed, { members, priceConfig }) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const rawBeats = ensureArray(source.beats || source.scene_beats || source["剧本"] || source["台词"]);
  if (rawBeats.length < 3) throw new Error("screenplay beats must include at least 3 beats");
  const min = Number(priceConfig.price_min);
  const max = Number(priceConfig.price_max);
  const beats = [];
  const priceActions = [];
  const invalidPrices = [];

  for (const rawBeat of rawBeats) {
    const item = rawBeat && typeof rawBeat === "object" ? rawBeat : { line: rawBeat };
    const actor = normalizeScreenplayActor(item.actor ?? item.speaker ?? item.member_id ?? item["角色"], members);
    if (!actor) throw new Error(`invalid screenplay actor: ${item.actor ?? item.speaker ?? item.member_id ?? ""}`);
    const line = String(item.line ?? item.text ?? item["台词"] ?? "").trim();
    const stageDirection = String(item.stage_direction ?? item.stage ?? item.action ?? item["舞台动作"] ?? "").trim();
    const rawAction = item.ui_action ?? item.uiAction ?? item["界面动作"] ?? null;
    let uiAction = null;
    if (rawAction && typeof rawAction === "object") {
      const type = normalizeScreenplayActionType(rawAction.type ?? rawAction.action ?? rawAction["类型"]);
      if (type === "drag_slider" || type === "confirm_price") {
        const price = screenplayPriceFromAction(rawAction, line);
        if (!Number.isFinite(price)) throw new Error(`screenplay ${type} missing price`);
        const rejected = price < min || price > max;
        uiAction = { type, price, rejected };
        if (rejected) invalidPrices.push({ actor, type, price });
        else priceActions.push({ actor, type, price, line, stage_direction: stageDirection });
      }
    }
    beats.push({
      actor,
      stage_direction: stageDirection,
      line,
      ui_action: uiAction
    });
  }
  if (!priceActions.length) {
    if (invalidPrices.length) {
      throw new Error(`screenplay_price_out_of_range: ${invalidPrices.map((item) => `${item.actor}/${item.type}/${item.price}`).join(", ")}`);
    }
    throw new Error("screenplay must include at least one legal drag_slider or confirm_price action");
  }
  const confirmed = priceActions.filter((item) => item.type === "confirm_price");
  const finalAction = (confirmed.length ? confirmed : priceActions).at(-1);
  return {
    scene_state: String(source.scene_state ?? source.scene ?? source["场景"] ?? "").trim(),
    beats,
    price_actions: priceActions,
    final_action: finalAction,
    price: finalAction.price
  };
}

function d5ScreenplayTranscript(openingText, screenplay) {
  const transcript = [{ speaker: "screen", text: openingText }];
  for (const beat of screenplay.beats) {
    const stage = beat.stage_direction ? `（${beat.stage_direction}）` : "";
    const line = beat.line || "";
    const action = beat.ui_action
      ? `（界面动作：${beat.ui_action.rejected ? "价格超出范围，滑块没有停住" : (beat.ui_action.type === "confirm_price" ? "停住/确认价格" : "拖动价格滑块")} ${formatYuan(beat.ui_action.price)}）`
      : "";
    transcript.push({
      speaker: beat.actor,
      text: `${stage}${line}${action}`.trim() || "（没有说话）",
      ui_action: beat.ui_action
    });
  }
  return transcript;
}

async function runD5ScreenplayPricing({
  members,
  leaderIdx,
  draws,
  proposals,
  r1Frozen,
  chosenPrototype,
  selectedCards,
  priceConfig,
  temperature,
  seed,
  arm,
  outputDir
}) {
  const screenText = [
    buildR2PricingContextPanel(r1Frozen, chosenPrototype),
    "",
    buildR2StoryPricingScreenPanel(r1Frozen, selectedCards, priceConfig)
  ].join("\n");
  const actorSheet = formatD5ScreenplayActorSheet(members, leaderIdx);
  const baseMessages = [
    {
      role: "system",
      content: [
        "你是一个场记式编剧。你的任务不是给商业建议，而是按演员人设续写真实 EMBA 讨论室里的一幕。",
        "每个角色只能按自己的人设、疲劳、面子、理解偏差和刚才选卡残留行动；可以沉默、敷衍、跑题、误会、临时改口。",
        "不要写 moderator，不要写讲解，不要写优化分析。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【演员表】",
        actorSheet,
        "",
        "【当前屏幕】",
        screenText,
        "",
        "【编剧任务】",
        "继续写 D5 产品售价这一幕。角色们围着同一台电脑看价格页，像真人一样说话和动手。",
        "滑块边界在界面上可见，但不要让角色在台词里复述上下限；也不要把中点、上下限当默认答案。",
        "至少 4 个 beat，最多 9 个 beat；不是每个人都必须说话。可以有空台词或只做动作。",
        "如果某人动手拖价格，写 ui_action={\"type\":\"drag_slider\",\"price\":数字}；如果最终停住/确认，写 ui_action={\"type\":\"confirm_price\",\"price\":数字}。",
        "不要输出 Markdown，不要输出额外说明。schema：",
        '{"scene_state":"一句场景状态","beats":[{"actor":"Rxx","stage_direction":"动作/神情","line":"台词，可为空","ui_action":{"type":"drag_slider|confirm_price","price":数字}|null}]}'
      ].join("\n")
    }
  ];
  if (outputDir) {
    writeJson(path.join(outputDir, "d5_screenplay_prompt.json"), {
      seed,
      arm,
      messages: baseMessages
    });
  }
  let messages = baseMessages;
  let lastRaw = "";
  let lastError = "";
  const attemptsPath = outputDir ? path.join(outputDir, "d5_screenplay_attempts.jsonl") : null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature, maxTokens: 3200 });
      const screenplay = validateD5Screenplay(parseJsonLoose(lastRaw), { members, priceConfig });
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          attempt: attempt + 1,
          status: "ok",
          raw: lastRaw,
          screenplay
        });
      }
      const openingText = "【产品售价页】屏幕显示已冻结市场、WHO/PAIN/HOW、已选能力卡、成本区和价格滑块。小组开始定最终售价。";
      const finalTranscript = d5ScreenplayTranscript(openingText, screenplay);
      const transcriptText = formatTranscript(finalTranscript);
      const pricingAction = posthocPricingAction(transcriptText, screenplay.price, priceConfig);
      const pricingTier = posthocPricingTier(screenplay.price, priceConfig);
      const priceSubmit = {
        text: `${screenplay.final_action.actor}: ${screenplay.final_action.line || ""}`,
        parsed: {
          price: screenplay.price,
          rationale: `deterministically indexed from ${screenplay.final_action.actor}/${screenplay.final_action.type}`
        },
        parse_raw: screenplay,
        attempts: 0,
        parse_method: "deterministic_screenplay_ui_action"
      };
      return {
        priceSubmit,
        checkpoints: [
          {
            decision_point: "price_action_posthoc",
            termination: "posthoc_index",
            turns: 0,
            frozen: {
              pricing_action: pricingAction,
              rationale: "deterministic posthoc index from D5 screenplay text and final price position; not shown to decision agents"
            },
            index_method: "deterministic_posthoc_screenplay_price"
          },
          {
            decision_point: "price_tier_posthoc",
            termination: "posthoc_index",
            turns: 0,
            pricing_action: pricingAction,
            frozen: {
              tier: pricingTier,
              rationale: "deterministic posthoc index from final price relative to UI slider range; not shown to decision agents"
            },
            index_method: "deterministic_posthoc_price_position"
          },
          {
            decision_point: "price",
            termination: "screenplay_confirmed",
            turns: 1,
            pricing_action_posthoc: pricingAction,
            pricing_tier_posthoc: pricingTier,
            frozen: priceSubmit.parsed,
            submit_attempts: 0,
            price_parse: screenplay,
            submission_mode: "deterministic_screenplay_ui_action"
          }
        ],
        transcripts: [
          { decision_point: "price", transcript: finalTranscript, turns: [{ turn: 1, screenplay }] }
        ]
      };
    } catch (error) {
      lastError = error.message;
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          attempt: attempt + 1,
          status: "error",
          error: lastError,
          raw: lastRaw
        });
      }
      messages = [
        baseMessages[0],
        {
          role: "user",
          content: [
            "上一版 D5 剧本没有被界面接受。",
            `界面/解析提示：${lastError}`,
            /screenplay_price_out_of_range/u.test(lastError)
              ? `【界面提示】价格超出滑块范围，滑块没有停住。此时界面弹出可拖动范围：${formatYuan(priceConfig.price_min)} 到 ${formatYuan(priceConfig.price_max)}。`
              : "",
            "请从这个界面提示后继续写一版完整 D5 剧本，仍然按演员人设，不要写商业分析。",
            "必须包含至少一个合法 drag_slider 或 confirm_price；只输出 JSON。",
            "",
            "上一版 raw：",
            lastRaw
          ].filter(Boolean).join("\n")
        }
      ];
    }
  }
  throw new Error(`d5_screenplay_parse_failure: ${lastError}`);
}

function formatD5NarratorActorSheet(members, leaderIdx, arm) {
  return members.map((member, index) => {
    const state = ensureBehavioralState(member, index === leaderIdx);
    const review = state.d5_card_review || {};
    return [
      `【成员 ${member.profile_id}${index === leaderIdx ? " / 组长" : ""}】`,
      formatProfile(member, index === leaderIdx, arm),
      isTaskBlindNarrativeMember(member)
        ? `个人消费与取舍（本人真实经历，定性）：${member.decisionStyle}；${member.consumption_habits}`
        : "",
      formatR1ActorCarryoverForPrompt(member),
      `课堂行为：${formatClassroomBehavior(member, index === leaderIdx)}`,
      review.value_feel ? `刚才选卡后的私有复盘：${review.value_feel}；${review.cost_feel}；${review.speaking_angle}` : "",
      review.own_cards ? `自己原先点过的卡：${review.own_cards.join("、") || "无"}；最终保留：${(review.own_retained_cards || []).join("、") || "无"}` : "",
      `当前状态：注意点=${state.attention_focus || ""}；信心=${Number(state.confidence || 0).toFixed(2)}；疲劳=${Number(state.fatigue || 0).toFixed(2)}；价格敏感=${Number(state.price_sensitivity || 0).toFixed(2)}；面子压力=${Number(state.status_pressure || 0).toFixed(2)}。`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function normalizeD5NarratorStateItem(item, members, fallbackMember = null) {
  const source = item && typeof item === "object" ? item : { protagonist_state: item };
  const actor = normalizeScreenplayActor(
    source.actor ?? source.speaker ?? source.member_id ?? source.profile_id ?? source["角色"],
    members
  ) || fallbackMember?.profile_id || "";
  if (!actor) return null;
  const parts = [
    source.protagonist_state ?? source.state ?? source.inner_state ?? source["主人公状态"],
    source.what_catches_eye ?? source.attention ?? source["注意到"],
    source.social_pressure ?? source.pressure ?? source["社交压力"],
    source.pricing_impulse ?? source.impulse ?? source["定价冲动"],
    source.speech_impulse ?? source["发言冲动"]
  ].map((part) => String(part || "").trim()).filter(Boolean);
  return {
    actor,
    protagonist_state: parts.join("；") || "读完屏幕后有自己的直觉和顾虑，但还没整理成完整观点。",
    raw: source
  };
}

function validateD5NarratorScene(parsed, { members, leaderIdx }) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const publicScene = String(
    source.public_scene ?? source.scene ?? source.narration ?? source["公开旁白"] ?? source["场景旁白"] ?? ""
  ).trim();
  if (!publicScene) throw new Error("d5_narrator_missing_public_scene");

  const rawStates = ensureArray(
    source.actor_states ?? source.private_states ?? source.states ?? source["角色状态"] ?? source["私有状态"]
  );
  const stateByActor = new Map();
  for (const rawState of rawStates) {
    const normalized = normalizeD5NarratorStateItem(rawState, members);
    if (normalized) stateByActor.set(normalized.actor, normalized);
  }
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    if (!stateByActor.has(member.profile_id)) {
      const state = ensureBehavioralState(member, index === leaderIdx);
      stateByActor.set(member.profile_id, {
        actor: member.profile_id,
        protagonist_state: [
          `他/她看着定价页，注意点先落在${state.attention_focus || "市场和功能是否说得通"}。`,
          `信心 ${Number(state.confidence || 0).toFixed(2)}，疲劳 ${Number(state.fatigue || 0).toFixed(2)}，价格敏感 ${Number(state.price_sensitivity || 0).toFixed(2)}。`
        ].join(""),
        raw: null
      });
    }
  }

  const seen = new Set();
  const rawOrder = ensureArray(source.turn_order ?? source.order ?? source["出场顺序"]);
  const turnOrder = rawOrder
    .map((actor) => normalizeScreenplayActor(actor, members))
    .filter((actor) => {
      if (!actor || seen.has(actor)) return false;
      seen.add(actor);
      return true;
    });
  const fallbackOrder = members.map((member) => member.profile_id);
  return {
    public_scene: publicScene,
    actor_states: fallbackOrder.map((actor) => stateByActor.get(actor)),
    turn_order: turnOrder.length ? turnOrder : fallbackOrder
  };
}

function formatD5ActorStateForPrompt(state) {
  if (!state) return "你只有一个模糊直觉，还没想好要不要发言。";
  return String(state.protagonist_state || "").trim() || "你只有一个模糊直觉，还没想好要不要发言。";
}

function validateD5ActorBeat(parsed, { member, priceConfig }) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const line = String(source.line ?? source.text ?? source.reply ?? source.content ?? source["台词"] ?? "").trim();
  const stageDirection = String(source.stage_direction ?? source.stage ?? source.emotion ?? source.action ?? source["舞台动作"] ?? "").trim();
  const silent = Boolean(source.silent) || (!line && !stageDirection);
  let rawAction = source.ui_action ?? source.uiAction ?? source["界面动作"] ?? null;
  if (!rawAction && line) {
    const inlineAction = line.match(/ui_action\s*[:：]\s*(\{[^}]+\})/u);
    if (inlineAction) {
      try {
        rawAction = parseJsonLoose(inlineAction[1]);
      } catch (error) {
        rawAction = null;
      }
    }
  }
  if (typeof rawAction === "string") {
    const trimmedAction = rawAction.trim();
    if (/^[{[]/u.test(trimmedAction)) {
      try {
        rawAction = parseJsonLoose(trimmedAction);
      } catch (error) {
        rawAction = { type: trimmedAction };
      }
    } else {
      rawAction = {
        type: trimmedAction,
        price: source.price ?? source.value ?? source.amount ?? source.to ?? source.target_price ?? source.final_price
      };
    }
  }
  const min = Number(priceConfig.price_min);
  const max = Number(priceConfig.price_max);
  let uiAction = null;
  if (rawAction && typeof rawAction === "object") {
    const type = normalizeScreenplayActionType(rawAction.type ?? rawAction.action ?? rawAction["类型"]);
    if (type === "drag_slider" || type === "confirm_price") {
      const explicitPrice = rawAction.price ?? rawAction.value ?? rawAction.amount ?? rawAction.to ?? rawAction.target_price ?? rawAction.final_price ?? rawAction["价格"];
      const canReadLinePrice = explicitPrice !== undefined && explicitPrice !== null && explicitPrice !== ""
        ? true
        : /(?:定在|先定|就定|拖到|拉到|放到|停在|确认|提交|最终|倾向于?定|倾向于?先定|停住)/u.test(line);
      const price = canReadLinePrice ? screenplayPriceFromAction(rawAction, line) : null;
      if (!Number.isFinite(price)) throw new Error(`d5_actor_${type}_missing_price`);
      uiAction = {
        type,
        price,
        rejected: price < min || price > max
      };
    }
  }
  return {
    actor: member.profile_id,
    stage_direction: stageDirection,
    line,
    silent,
    ui_action: uiAction
  };
}

function salvageD5ActorBeatFromRaw(raw, { member, priceConfig, phase }) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const candidates = collectTranscriptPriceCandidates({
    speaker: member.profile_id,
    text
  }, 0, priceConfig, { includeOutOfRange: true });
  const hasUiIntent = /滑块|拖|拉|停|定价|售价|价格|确认|提交|报|这个数|这个位置|收口/u.test(text);
  const chosen = hasUiIntent && candidates.length ? candidates[candidates.length - 1] : null;
  return {
    actor: member.profile_id,
    stage_direction: "",
    line: text,
    silent: false,
    ui_action: chosen
      ? {
          type: phase === "finalize" ? "confirm_price" : "drag_slider",
          price: chosen.price,
          rejected: Boolean(chosen.out_of_range),
          salvaged: true
        }
      : null,
    salvage: true
  };
}

function d5NarratorActorTranscript(openingText, narration, beats) {
  const transcript = [
    { speaker: "screen", text: openingText },
    { speaker: "narrator", text: narration.public_scene }
  ];
  for (const beat of beats) {
    const stage = beat.stage_direction ? `（${beat.stage_direction}）` : "";
    const line = beat.line || "";
    const action = beat.ui_action
      ? `（界面动作：${beat.ui_action.rejected ? "价格超出范围，滑块没有停住" : (beat.ui_action.type === "confirm_price" ? "停住/确认价格" : "拖动价格滑块")} ${formatYuan(beat.ui_action.price)}）`
      : "";
    transcript.push({
      speaker: beat.actor,
      text: `${stage}${line}${action}`.trim() || "（没有说话）",
      ui_action: beat.ui_action
    });
  }
  return transcript;
}

async function callD5NarratorActorBeat({
  member,
  isLeader,
  arm,
  screenText,
  publicScene,
  privateState,
  heardTranscript,
  priceConfig,
  temperature,
  outputDir,
  phase
}) {
  const baseMessages = [
    {
      role: "system",
      content: [
        "你只扮演下面这一个人，不要替别人总结，不要当主持人。",
        "你要先读自己的主人公状态，再像真实课堂小组成员一样做一个很短的反应：可以说一句、犹豫、沉默、跑偏、动手拖一下价格滑块。",
        "如果你动价格滑块，必须写 ui_action；如果只是说话或沉默，ui_action 写 null。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【你的人设】",
        formatProfile(member, isLeader, arm),
        "",
        "【公开场景】",
        publicScene,
        "",
        "【只给你看的主人公状态】",
        formatD5ActorStateForPrompt(privateState),
        "",
        "【当前屏幕】",
        screenText,
        "",
        "【你刚听到的内容】",
        heardTranscript || "（还没人说话）",
        "",
        "【你的这一拍】",
        phase === "boundary_fix"
          ? `刚才有人把价格拖到滑块外，界面没有停住。界面现在提示可拖范围是 ${formatYuan(priceConfig.price_min)} 到 ${formatYuan(priceConfig.price_max)}；按你这个人的状态，往合法范围里挪一点并确认，不要贴边界，也不要把边界当答案。`
          : "",
        phase === "must_confirm"
          ? `讨论时间到了，界面必须停住一个具体价格才能进入下一步。界面可拖范围是 ${formatYuan(priceConfig.price_min)} 到 ${formatYuan(priceConfig.price_max)}；按你这个人的状态，把滑块停在一个合法位置并确认，不要贴边界，也不要把边界当答案。`
          : "",
        phase === "finalize"
          ? "界面还等着有人把价格停住。按你这个人的状态，给出一个自然的最终滑块动作；不要贴边界，不要故意取整，除非这个人本来就会这么做。"
          : ((phase === "boundary_fix" || phase === "must_confirm") ? "" : "轮到你看一眼屏幕，可以短句、沉默或动手拖一下；不是每个人都必须报价。"),
        "schema：",
        '{"stage_direction":"动作/神情","line":"台词，可为空","silent":false,"ui_action":{"type":"drag_slider|confirm_price","price":数字}|null}'
      ].join("\n")
    }
  ];
  let messages = baseMessages;
  let lastRaw = "";
  let lastError = "";
  const attemptsPath = outputDir ? path.join(outputDir, "d5_narrator_actor_attempts.jsonl") : null;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature, maxTokens: 1200 });
      const beat = validateD5ActorBeat(parseJsonLoose(lastRaw), { member, priceConfig });
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          phase,
          member_id: member.profile_id,
          attempt: attempt + 1,
          status: "ok",
          raw: lastRaw,
          beat
        });
      }
      return beat;
    } catch (error) {
      lastError = error.message;
      const salvaged = salvageD5ActorBeatFromRaw(lastRaw, { member, priceConfig, phase });
      if (salvaged) {
        if (attemptsPath) {
          appendJsonl(attemptsPath, {
            ts: new Date().toISOString(),
            phase,
            member_id: member.profile_id,
            attempt: attempt + 1,
            status: "salvaged",
            error: lastError,
            raw: lastRaw,
            beat: salvaged
          });
        }
        return salvaged;
      }
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          phase,
          member_id: member.profile_id,
          attempt: attempt + 1,
          status: "error",
          error: lastError,
          raw: lastRaw
        });
      }
      messages = [
        baseMessages[0],
        {
          role: "user",
          content: [
            "上一拍没有被界面解析。",
            `解析提示：${lastError}`,
            "请仍然只扮演自己，重写这一拍，只输出 JSON。",
            "",
            "上一版 raw：",
            lastRaw
          ].join("\n")
        }
      ];
    }
  }
  throw new Error(`d5_narrator_actor_beat_failure:${member.profile_id}:${lastError}`);
}

async function runD5NarratorActorPricing({
  members,
  leaderIdx,
  draws,
  proposals,
  r1Frozen,
  chosenPrototype,
  selectedCards,
  priceConfig,
  temperature,
  seed,
  arm,
  outputDir
}) {
  const screenText = [
    buildR2PricingContextPanel(r1Frozen, chosenPrototype),
    "",
    buildR2StoryPricingScreenPanel(r1Frozen, selectedCards, priceConfig)
  ].join("\n");
  const actorSheet = formatD5NarratorActorSheet(members, leaderIdx, arm);
  const narratorMessages = [
    {
      role: "system",
      content: [
        "你是讨论室旁白，不是商业顾问。你的任务是先写出这一刻的场景气氛和每个成员的私有主人公状态。",
        "状态必须由人设、刚才选卡残留、课堂心态、疲劳、面子和对屏幕的理解生成；不要直接替他们决定最终价格。",
        "不要输出上下限、中点、利润优化建议或主持人总结。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【成员素材】",
        actorSheet,
        "",
        "【当前屏幕】",
        screenText,
        "",
        "【旁白任务】",
        "写 D5 定价页刚打开时的公开场景，以及每个成员只给自己看的主人公状态。",
        "actor_states 每个成员一条；状态可以包含注意到什么、想表现/想躲开、哪里没看懂、想压价/撑价的冲动，但不要给具体数字。",
        "每个成员的 pricing_impulse 必须从他素材里【个人消费与取舍】的真实经历中长出来：不同经历的人自然会有不同方向的冲动（有人觉得好东西就该体现价值，有人先想别人掏不掏得起，有人纠结），不要让全组同调，也不要替任何人虚构经历。",
        "turn_order 可以是不完整自然顺序；不是每个人都必须积极发言。",
        "schema：",
        '{"public_scene":"公开旁白","actor_states":[{"actor":"Rxx","protagonist_state":"私有主人公状态","what_catches_eye":"...","social_pressure":"...","pricing_impulse":"..."}],"turn_order":["Rxx"]}'
      ].join("\n")
    }
  ];
  if (outputDir) {
    writeJson(path.join(outputDir, "d5_narrator_prompt.json"), {
      seed,
      arm,
      messages: narratorMessages
    });
  }

  let narration = null;
  let lastRaw = "";
  let lastError = "";
  const narrationAttemptsPath = outputDir ? path.join(outputDir, "d5_narrator_attempts.jsonl") : null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(narratorMessages, { temperature, maxTokens: 2600 });
      narration = validateD5NarratorScene(parseJsonLoose(lastRaw), { members, leaderIdx });
      if (narrationAttemptsPath) {
        appendJsonl(narrationAttemptsPath, {
          ts: new Date().toISOString(),
          attempt: attempt + 1,
          status: "ok",
          raw: lastRaw,
          narration
        });
      }
      break;
    } catch (error) {
      lastError = error.message;
      if (narrationAttemptsPath) {
        appendJsonl(narrationAttemptsPath, {
          ts: new Date().toISOString(),
          attempt: attempt + 1,
          status: "error",
          error: lastError,
          raw: lastRaw
        });
      }
    }
  }
  if (!narration) throw new Error(`d5_narrator_scene_failure:${lastError}`);
  if (outputDir) {
    writeJson(path.join(outputDir, "d5_narrator_scene.json"), {
      seed,
      arm,
      narration
    });
  }

  const stateByActor = new Map(narration.actor_states.map((state) => [state.actor, state]));
  const beats = [];
  const priceActions = [];
  const rejectedPriceActions = [];
  const memberById = new Map(members.map((member, index) => [member.profile_id, { member, index }]));
  const openingText = "【产品售价页】屏幕显示已冻结市场、WHO/PAIN/HOW、已选能力卡、成本区和价格滑块。小组开始定最终售价。";
  for (const actor of narration.turn_order) {
    const slot = memberById.get(actor);
    if (!slot) continue;
    const heardTranscript = formatTranscript(d5NarratorActorTranscript(openingText, narration, beats).slice(1));
    const beat = await callD5NarratorActorBeat({
      member: slot.member,
      isLeader: slot.index === leaderIdx,
      arm,
      screenText,
      publicScene: narration.public_scene,
      privateState: stateByActor.get(actor),
      heardTranscript,
      priceConfig,
      temperature,
      outputDir,
      phase: "turn"
    });
    beats.push(beat);
    if (beat.ui_action) {
      const actionRecord = {
        actor: beat.actor,
        type: beat.ui_action.type,
        price: beat.ui_action.price,
        line: beat.line,
        stage_direction: beat.stage_direction
      };
      if (beat.ui_action.rejected) rejectedPriceActions.push(actionRecord);
      else priceActions.push(actionRecord);
    }
  }

  if (!priceActions.some((action) => action.type === "confirm_price")) {
    const leader = members[leaderIdx];
    const heardTranscript = formatTranscript(d5NarratorActorTranscript(openingText, narration, beats).slice(1));
    const beat = await callD5NarratorActorBeat({
      member: leader,
      isLeader: true,
      arm,
      screenText,
      publicScene: narration.public_scene,
      privateState: stateByActor.get(leader.profile_id),
      heardTranscript,
      priceConfig,
      temperature,
      outputDir,
      phase: "finalize"
    });
    beats.push(beat);
    if (beat.ui_action) {
      const actionRecord = {
        actor: beat.actor,
        type: beat.ui_action.type,
        price: beat.ui_action.price,
        line: beat.line,
        stage_direction: beat.stage_direction
      };
      if (beat.ui_action.rejected) rejectedPriceActions.push(actionRecord);
      else priceActions.push(actionRecord);
    }
  }

  if (!priceActions.length && rejectedPriceActions.length) {
    const leader = members[leaderIdx];
    const heardTranscript = formatTranscript(d5NarratorActorTranscript(openingText, narration, beats).slice(1));
    const beat = await callD5NarratorActorBeat({
      member: leader,
      isLeader: true,
      arm,
      screenText,
      publicScene: narration.public_scene,
      privateState: stateByActor.get(leader.profile_id),
      heardTranscript,
      priceConfig,
      temperature,
      outputDir,
      phase: "boundary_fix"
    });
    beats.push(beat);
    if (beat.ui_action) {
      const actionRecord = {
        actor: beat.actor,
        type: beat.ui_action.type,
        price: beat.ui_action.price,
        line: beat.line,
        stage_direction: beat.stage_direction
      };
      if (beat.ui_action.rejected) rejectedPriceActions.push(actionRecord);
      else priceActions.push(actionRecord);
    }
  }

  if (!priceActions.length) {
    const leader = members[leaderIdx];
    const heardTranscript = formatTranscript(d5NarratorActorTranscript(openingText, narration, beats).slice(1));
    const beat = await callD5NarratorActorBeat({
      member: leader,
      isLeader: true,
      arm,
      screenText,
      publicScene: narration.public_scene,
      privateState: stateByActor.get(leader.profile_id),
      heardTranscript,
      priceConfig,
      temperature,
      outputDir,
      phase: "must_confirm"
    });
    beats.push(beat);
    if (beat.ui_action) {
      const actionRecord = {
        actor: beat.actor,
        type: beat.ui_action.type,
        price: beat.ui_action.price,
        line: beat.line,
        stage_direction: beat.stage_direction
      };
      if (beat.ui_action.rejected) rejectedPriceActions.push(actionRecord);
      else priceActions.push(actionRecord);
    }
  }

  if (!priceActions.length && rejectedPriceActions.length) {
    const leader = members[leaderIdx];
    const heardTranscript = formatTranscript(d5NarratorActorTranscript(openingText, narration, beats).slice(1));
    const beat = await callD5NarratorActorBeat({
      member: leader,
      isLeader: true,
      arm,
      screenText,
      publicScene: narration.public_scene,
      privateState: stateByActor.get(leader.profile_id),
      heardTranscript,
      priceConfig,
      temperature,
      outputDir,
      phase: "boundary_fix"
    });
    beats.push(beat);
    if (beat.ui_action) {
      const actionRecord = {
        actor: beat.actor,
        type: beat.ui_action.type,
        price: beat.ui_action.price,
        line: beat.line,
        stage_direction: beat.stage_direction
      };
      if (beat.ui_action.rejected) rejectedPriceActions.push(actionRecord);
      else priceActions.push(actionRecord);
    }
  }

  if (!priceActions.length) {
    throw new Error("d5_narrator_actor_no_legal_price_action");
  }
  const confirmed = priceActions.filter((item) => item.type === "confirm_price");
  const finalAction = (confirmed.length ? confirmed : priceActions).at(-1);
  const finalTranscript = d5NarratorActorTranscript(openingText, narration, beats);
  const transcriptText = formatTranscript(finalTranscript);
  const pricingAction = posthocPricingAction(transcriptText, finalAction.price, priceConfig);
  const pricingTier = posthocPricingTier(finalAction.price, priceConfig);
  const priceSubmit = {
    text: `${finalAction.actor}: ${finalAction.line || ""}`,
    parsed: {
      price: finalAction.price,
      rationale: `deterministically indexed from ${finalAction.actor}/${finalAction.type}`
    },
    parse_raw: {
      narration,
      beats,
      price_actions: priceActions,
      final_action: finalAction
    },
    attempts: 0,
    parse_method: "deterministic_narrator_actor_ui_action"
  };
  return {
    priceSubmit,
    checkpoints: [
      {
        decision_point: "price_action_posthoc",
        termination: "posthoc_index",
        turns: 0,
        frozen: {
          pricing_action: pricingAction,
          rationale: "deterministic posthoc index from D5 narrator-actor transcript and final price position; not shown to decision agents"
        },
        index_method: "deterministic_posthoc_narrator_actor_price"
      },
      {
        decision_point: "price_tier_posthoc",
        termination: "posthoc_index",
        turns: 0,
        pricing_action: pricingAction,
        frozen: {
          tier: pricingTier,
          rationale: "deterministic posthoc index from final price relative to UI slider range; not shown to decision agents"
        },
        index_method: "deterministic_posthoc_price_position"
      },
      {
        decision_point: "price",
        termination: "narrator_actor_confirmed",
        turns: beats.length,
        pricing_action_posthoc: pricingAction,
        pricing_tier_posthoc: pricingTier,
        frozen: priceSubmit.parsed,
        submit_attempts: 0,
        price_parse: priceSubmit.parse_raw,
        submission_mode: "deterministic_narrator_actor_ui_action"
      }
    ],
    transcripts: [
      { decision_point: "price", transcript: finalTranscript, turns: beats.map((beat, index) => ({ turn: index + 1, beat })) }
    ]
  };
}

async function runStatefulDirectPriceD5({
  members,
  leaderIdx,
  draws,
  proposals,
  r1Frozen,
  chosenPrototype,
  selectedCards,
  priceConfig,
  config,
  temperature,
  seed,
  arm
}) {
  const submitParseRetries = requireConfigNumber(config, "submit_parse_retries");
  const noSubmitPrice = usesD5TranscriptPriceParser(arm);
  const priceTranscript = [{
    speaker: "moderator",
    text: [
      buildR2PricingContextPanel(r1Frozen, chosenPrototype),
      "",
      buildR2PricingActionPersonaPanel(r1Frozen, selectedCards, priceConfig),
		      "",
		      "【D5：产品售价滑块】",
		      `现在小组直接看价格滑块：${formatYuan(priceConfig.price_min)} 到 ${formatYuan(priceConfig.price_max)}。`,
		      hasD5CardReviewState(arm) ? "进入这一页前，每个人已经各自在心里复盘了一下刚才保留下来的能力卡：哪些功能撑得住价值，哪些地方让人担心成本或用户买不买账。" : "",
		      noSubmitPrice ? "这一版没有单独的组长提交器；最终价格只从讨论里最后一个明确的滑块价格记录。" : "",
		      noSubmitPrice ? "如果已经收敛，组长或成员像真人拖滑块一样自然说“那就停在 X 元”，X 可以不是整百或整千，但必须是具体合法价格。" : "",
		      "不要先讨论“战略动作”或“高/中/低档位”这种分类题；就像真人在界面前一样，围绕到底拖到哪个价格说几句。",
	      noSubmitPrice
	        ? "有人可以凭感觉，有人可以担心贵，有人可以觉得价格太低没底气；最后在讨论里自然收口到一个滑块价格，不要另写【最终提交】。"
	        : "有人可以凭感觉，有人可以担心贵，有人可以觉得价格太低没底气；最后由组长提交一个最终价格。",
	      "不要使用固定步长，也不要把上下限或中点当默认答案；不要输出 JSON，不要 Markdown 表格。"
	    ].join("\n")
	  }];
  const discussion = await runDiscussion({
    members,
    leaderIdx,
    draws,
    proposals,
    initialTranscript: priceTranscript,
    topic: "D5 直接定价：产品售价滑块",
    maxTurns: requireConfigNumber(config, "max_turns_r2_per_segment"),
    config,
    temperature,
	    seed: `${seed}:price:stateful_direct`,
	    arm
	  });
	  const priceParse = noSubmitPrice ? parseD5PriceFromTranscript(discussion.transcript, priceConfig) : null;
	  const priceSubmit = noSubmitPrice
	    ? {
	        text: priceParse.source_text,
	        parsed: {
	          price: priceParse.price,
	          rationale: `deterministically parsed from ${priceParse.source_speaker}: ${priceParse.source_context}`
	        },
	        parse_raw: priceParse,
	        attempts: 0,
	        parse_method: priceParse.parser
	      }
	    : await leaderSubmit({
	        members,
	        leaderIdx,
	        transcript: discussion.transcript,
	        topic: "提交最终定价",
	        decisionType: "price",
	        context: {
	          priceMin: Number(priceConfig.price_min),
	          priceMax: Number(priceConfig.price_max),
	          priceStep: Number(priceConfig.price_step),
	          submitParseRetries
	        },
	        temperature,
	        arm
	      });
	  const finalTranscript = noSubmitPrice
	    ? discussion.transcript
	    : discussion.transcript.concat([{
	        speaker: members[leaderIdx].profile_id,
	        text: `【组长提交｜最终价格】${priceSubmit.text}`
	      }]);
	  const transcriptText = formatTranscript(finalTranscript);
	  const pricingAction = posthocPricingAction(transcriptText, priceSubmit.parsed.price, priceConfig);
	  const pricingTier = posthocPricingTier(priceSubmit.parsed.price, priceConfig);
  return {
    priceSubmit,
    checkpoints: [
      {
        decision_point: "price_action_posthoc",
        termination: "posthoc_index",
        turns: 0,
        frozen: {
          pricing_action: pricingAction,
          rationale: "deterministic posthoc index from D5 transcript keywords and final price position; not shown to decision agents"
        },
        index_method: "deterministic_posthoc_transcript_price"
      },
      {
        decision_point: "price_tier_posthoc",
        termination: "posthoc_index",
        turns: 0,
        pricing_action: pricingAction,
        frozen: {
          tier: pricingTier,
          rationale: "deterministic posthoc index from final price relative to UI slider range; not shown to decision agents"
        },
        index_method: "deterministic_posthoc_price_position"
      },
      {
        decision_point: "price",
        termination: discussion.termination,
	        turns: discussion.turns.length,
	        pricing_action_posthoc: pricingAction,
	        pricing_tier_posthoc: pricingTier,
	        frozen: priceSubmit.parsed,
	        submit_attempts: priceSubmit.attempts,
	        price_parse: priceParse,
	        submission_mode: noSubmitPrice ? "deterministic_transcript_price_no_llm_submitter" : "llm_leader_submit"
	      }
	    ],
    transcripts: [
      { decision_point: "price", transcript: finalTranscript, turns: discussion.turns }
    ]
  };
}

function selectedCardsNreWan(cards) {
  return cards.reduce((sum, card) => {
    return sum + Number(RD.getCapabilityParams(card.cap_id, card.tier).nre_tier || 0);
  }, 0);
}

function overTwelveSelectionHint(cards) {
  if (cards.length <= 12) return null;
  return `当前共选 ${cards.length} 张卡，研发投入 ${formatWan(selectedCardsNreWan(cards))}。`;
}

function groupName(groupMap, groupId) {
  const group = groupMap.get(groupId);
  return group ? `${group.name} (${group.group_id})` : groupId;
}

function formatGroupNames(groupIds, groupMap) {
  return (groupIds || []).map((groupId) => groupName(groupMap, groupId)).join("、");
}

function buildAssignmentsForMembers(members) {
  const raw = assignDimensions(members.length);
  return members.map((member, index) => ({
    member_id: member.profile_id,
    member_name: member.surface?.name || member.profile_id,
    groups: raw[index] || []
  }));
}

function prototypePainText(chosenPrototype) {
  const seed = chosenPrototype?.narrative_seed || {};
  return (Array.isArray(seed.pain_points) ? seed.pain_points : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("；");
}

function prototypeSceneText(chosenPrototype) {
  const seed = chosenPrototype?.narrative_seed || {};
  return (Array.isArray(seed.scenes) ? seed.scenes : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("；");
}

function buildR2ContextPanel(r1Frozen, chosenPrototype, options = {}) {
  const seed = chosenPrototype?.narrative_seed || {};
  const lines = [
    "【战略背景】",
    `R1 冻结市场：${r1Frozen.grid_label || r1Frozen.grid_id}（${r1Frozen.grid_id}），产品定位：${r1Frozen.architecture}`,
    `R1 WHO：${r1Frozen.vp_summary?.who || ""}`,
    `R1 PAIN：${r1Frozen.vp_summary?.pain || ""}`,
    `R1 HOW：${r1Frozen.vp_summary?.how || ""}`,
    "【客户调研 / 痛点提醒】",
    `客户画像：${chosenPrototype.label}`,
    seed.person ? `人物/机构：${seed.person}` : "",
    seed.routine ? `情境：${seed.routine}` : "",
    prototypeSceneText(chosenPrototype) ? `关键场景：${prototypeSceneText(chosenPrototype)}` : "",
    prototypePainText(chosenPrototype) ? `主要痛点：${prototypePainText(chosenPrototype)}` : "",
    Array.isArray(chosenPrototype.tags) && chosenPrototype.tags.length ? `需求标签：${chosenPrototype.tags.join("、")}` : "",
    options.includeReportExcerpt && seed.report_excerpt ? `调研报告摘录：${seed.report_excerpt}` : "",
    "讨论和选卡必须围绕以上冻结市场、客户画像和痛点，不要切换 ToB/ToC、年龄段或策略口径。"
  ];
  return lines.filter(Boolean).join("\n");
}

function buildR2PricingContextPanel(r1Frozen, chosenPrototype) {
  const lines = [
    "【定价】",
    `R1 冻结市场：${r1Frozen.grid_label || r1Frozen.grid_id}（${r1Frozen.grid_id}），产品定位：${r1Frozen.architecture}`,
    `客户画像：${chosenPrototype.label}`,
    Array.isArray(chosenPrototype.tags) && chosenPrototype.tags.length ? `需求标签：${chosenPrototype.tags.join("、")}` : "",
    "定价只需要基于已冻结市场和已选功能做最终提交，不要切换 ToB/ToC、年龄段或策略口径。"
  ];
  return lines.filter(Boolean).join("\n");
}

function cardsToText(cards) {
  const list = (cards || []).map((card) => `${card.cap_id}@${card.tier}`);
  return list.length ? list.join("、") : "（暂无）";
}

function cardsForGroups(cards, groupSet, capGroupById) {
  return (cards || []).filter((card) => groupSet.has(capGroupById.get(card.cap_id)));
}

function replaceCardsForGroups(cards, replacement, groupSet, capGroupById) {
  return [
    ...(cards || []).filter((card) => !groupSet.has(capGroupById.get(card.cap_id))),
    ...(replacement || []).map((card) => ({ cap_id: card.cap_id, tier: card.tier }))
  ];
}

function formatMemberSelectionSummary(individualSelections, groupMap, filterGroups = null) {
  const groupFilter = filterGroups ? new Set(filterGroups) : null;
  return (individualSelections || []).map((item) => {
    const groups = groupFilter
      ? item.groups.filter((groupId) => groupFilter.has(groupId))
      : item.groups;
    const groupSet = new Set(groups);
    const cards = groupFilter
      ? item.parsed.cards.filter((card) => groupSet.has(item.group_by_card[card.cap_id]))
      : item.parsed.cards;
    if (!groups.length && !cards.length) return "";
    return [
      `${item.member_id}（负责：${formatGroupNames(groups, groupMap) || "无"}）`,
      `个人选卡：${cardsToText(cards)}`,
      item.parsed.rationale ? `备注：${item.parsed.rationale}` : ""
    ].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

function mergeSelectionsWithSelectedBy(individualSelections) {
  const selectedBy = new Map();
  for (const item of individualSelections || []) {
    for (const card of item.parsed?.cards || []) {
      if (!selectedBy.has(card.cap_id)) selectedBy.set(card.cap_id, []);
      selectedBy.get(card.cap_id).push(item.member_id);
    }
  }
  const merged = mergeTeamSelections((individualSelections || []).map((item) => item.parsed?.cards || []));
  return {
    ...merged,
    selections: merged.selections.map((card) => ({
      ...card,
      selected_by: selectedBy.get(card.cap_id) || []
    }))
  };
}

function normalizeCardStance(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "nice";
  if (["must", "must_have", "must-have", "必须", "必选", "强烈保留", "核心"].includes(raw) || /必须|必选|核心|不能少/u.test(raw)) return "must";
  if (["nice", "nice_to_have", "nice-to-have", "可选", "加分", "有用"].includes(raw) || /可选|加分|有用|锦上添花/u.test(raw)) return "nice";
  if (["impulse", "gut", "直觉", "冲动", "顺手"].includes(raw) || /直觉|冲动|顺手|感觉/u.test(raw)) return "impulse";
  if (["unsure", "uncertain", "doubt", "犹豫", "不确定", "看不懂"].includes(raw) || /犹豫|不确定|看不懂|没把握/u.test(raw)) return "unsure";
  return "nice";
}

function normalizeCardConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(clamp(numeric, 0, 1).toFixed(3));
}

function normalizeTextArray(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[；;\n]/u);
  return values
    .map((item) => String(item || "").trim())
	    .filter(Boolean)
	    .slice(0, 8);
}

function normalizeStoryActionKind(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["select", "pick", "choose", "点", "选", "保留"].includes(raw) || /点|选|保留|要/u.test(raw)) return "select";
  if (["skip", "ignore", "pass", "跳过", "不点", "忽略"].includes(raw) || /跳过|不点|忽略|没看/u.test(raw)) return "skip";
  if (["hesitate", "unsure", "doubt", "犹豫", "不确定"].includes(raw) || /犹豫|不确定|没把握/u.test(raw)) return "hesitate";
  return "hesitate";
}

function d4StoryLens(member, isLeader, assignment) {
  const behavior = classroomBehaviorProfile(member, isLeader);
  const rng = makeRng(`d4_story_lens:${member.profile_id}:${assignment.groups.join(",")}`);
  const technicalIndustry = /技术|工程|制造|供应链|产品|AI|SaaS|硬件/u.test(`${member.industry} ${member.background} ${member.role}`);
  const attentionBudget = behavior.engagement < 0.38 || behavior.taskSkepticism > 0.6
    ? "窄：只认真看少数直观卡，抽象后台卡可能扫过去"
    : behavior.relevanceControl > 0.62 || technicalIndustry
      ? "宽：会看完大部分卡，但仍会按自己行业经验过滤"
      : "中：先看名字像用户痛点的卡，后面几张容易粗略扫";
  const comprehension = technicalIndustry
    ? "对技术/后台卡相对不陌生，但可能高估自己懂"
    : behavior.calculationImpulse > 0.58
      ? "会看成本和负载，但技术含义不一定都懂"
      : "对抽象基础设施卡容易低估或误解";
  const salience = seededPick([
    "更容易被能直接讲给客户听的卡吸引",
    "更容易被成本低、看起来不出错的卡吸引",
    "更容易被情感陪伴、互动感、外显体验吸引",
    "更容易被安全、可靠、少惹麻烦的卡吸引",
    "更容易被自己行业里熟悉的系统/运维/渠道逻辑吸引"
  ], `${member.profile_id}:${assignment.groups.join(",")}:d4_story_salience`);
  const flaw = seededPick([
    "至少有一张看起来合理的底座卡你会低估、误读或暂时跳过",
    "至少有一张你会因为名字直观而顺手点，但信心不一定高",
    "至少有一张你会因为成本/研发投入而降档或犹豫",
    "至少有一张你觉得客户未必感知得到，所以不想强推"
  ], `${member.profile_id}:${assignment.groups.join(",")}:d4_story_flaw:${Math.floor(rng() * 1000)}`);
  return [
    `注意力预算：${attentionBudget}`,
    `理解方式：${comprehension}`,
    `显著性偏好：${salience}`,
    `本轮不完美要求：${flaw}`,
    isLeader ? "组长身份会让你更想给出能收口的选择，但不代表你看懂所有卡。" : "你不是组长，不需要替全队补齐完整产品方案。"
  ].join("\n");
}

function normalizeStoryCapId(rawCapId, capGroup) {
  const raw = String(rawCapId ?? "").trim();
  const suffix = raw.split(":").pop().trim();
  return capGroup.has(raw) ? raw : suffix;
}

function validateD4StoryTrace(parsed, context) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const rawActions = ensureArray(source.action_trace || source.actions || source.trace || source["行动轨迹"]);
  if (!rawActions.length) throw new Error("action_trace required");
  const allowedGroups = new Set(context.allowedGroups || []);
  const allowedCaps = new Set((context.allowedCards || []).map((card) => card.cap_id));
  const capGroup = capGroupsById(context.capabilityGroups);
  const actions = [];
  const selectedByCap = new Map();

  for (const rawAction of rawActions) {
    const item = rawAction && typeof rawAction === "object" ? rawAction : { action: rawAction };
    const action = normalizeStoryActionKind(item.action ?? item.kind ?? item.type ?? item["动作"]);
    const capId = normalizeStoryCapId(item.cap_id ?? item.id ?? item.card ?? item["卡"], capGroup);
    if (!capId || !allowedCaps.has(capId)) throw new Error(`invalid story cap_id: ${capId || "(empty)"}`);
    const groupId = capGroup.get(capId);
    if (!allowedGroups.has(groupId)) throw new Error(`story cap_id not in assigned dimensions: ${capId}`);
    const rawTier = String(item.tier ?? item.level ?? item["档位"] ?? "").trim().toLowerCase();
    const tier = action === "select" ? rawTier : (["low", "mid", "high"].includes(rawTier) ? rawTier : null);
    if (action === "select") {
      if (!["low", "mid", "high"].includes(tier)) throw new Error(`selected story action missing valid tier for ${capId}`);
      RD.getCapabilityParams(capId, tier);
    }
    const normalized = {
      action,
      cap_id: capId,
      group_id: groupId,
      tier,
      stance: normalizeCardStance(item.stance ?? item.attitude ?? item.priority ?? item["立场"] ?? (action === "select" ? "nice" : "unsure")),
      confidence: normalizeCardConfidence(item.confidence ?? item.certainty ?? item["信心"]) ?? (action === "select" ? 0.5 : 0.25),
      reason: String(item.reason ?? item.rationale ?? item["理由"] ?? "").trim()
    };
    actions.push(normalized);
    if (action === "select") selectedByCap.set(capId, normalized);
  }

  const cards = Array.from(selectedByCap.values()).map((item) => ({
    cap_id: item.cap_id,
    tier: item.tier,
    stance: item.stance,
    confidence: item.confidence,
    reason: item.reason || "来自个人剧情行动轨迹"
  }));
  if (!cards.length) throw new Error("story trace must select at least one card");
  const story = {
    scene_state: String(source.scene_state ?? source.state ?? source["场景状态"] ?? "").trim(),
    attention_path: String(source.attention_path ?? source["注意路径"] ?? "").trim(),
    misread_or_skip: String(source.misread_or_skip ?? source.misread ?? source["误读或跳过"] ?? "").trim(),
    inner_line: String(source.inner_line ?? source["内心独白"] ?? "").trim(),
    public_stance: String(source.public_stance ?? source["公开立场"] ?? "").trim(),
    action_trace: actions
  };
  return {
    story,
    parsed: {
      cards,
      ignored_groups: normalizeTextArray(source.ignored_groups ?? source.ignoredGroups ?? source["忽略的维度"]),
      doubts: normalizeTextArray(source.doubts ?? source.concerns ?? source["犹豫"]),
      rationale: String(source.rationale ?? source.public_stance ?? source.inner_line ?? "根据个人剧情行动轨迹点卡").trim()
    }
  };
}

function parseD4StoryTrace(raw, context) {
  return {
    ...validateD4StoryTrace(parseJsonLoose(raw), context),
    parse_method: "story_action_trace_json"
  };
}

function coerceCardArrayFromParsed(parsed) {
  if (Array.isArray(parsed)) return parsed;
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const nested = source.final_submission || source.submit || source.submission || source["我的个人选卡提交"] || source["最终提交"];
  const candidates = [
    source.cards,
    source.selected_cards,
    source.capabilities,
    source.selection,
    source.card_selection,
    source.cardSelection,
    source.card_choices,
    source.choices,
    source.my_cards,
    source.myCards,
    source["能力卡"],
    source["选卡"],
    source["我的选卡"],
    nested && typeof nested === "object" ? nested.cards : null,
    nested && typeof nested === "object" ? nested.selected_cards : null,
    nested && typeof nested === "object" ? nested["选卡"] : null
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function capabilityNameMap(capabilityGroups) {
  const map = new Map();
  for (const group of capabilityGroups.groups || []) {
    for (const cap of group.capabilities || []) {
      map.set(cap.cap_id, cap.name || cap.cap_id);
    }
  }
  return map;
}

function buildResponsibleMembersByGroup(assignments) {
  const map = new Map();
  for (const assignment of assignments || []) {
    for (const groupId of assignment.groups || []) {
      if (!map.has(groupId)) map.set(groupId, []);
      map.get(groupId).push(assignment.member_id);
    }
  }
  return map;
}

function meanOrNull(values) {
  const valid = values.filter((value) => Number.isFinite(Number(value)));
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + Number(value), 0) / valid.length).toFixed(3));
}

function countBy(values) {
  const counts = {};
  for (const value of values || []) {
    const key = String(value || "").trim();
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function d4BoardBucket({ supporters, notSelectedBy, stance_counts: stanceCounts, confidence_mean: confidenceMean, responsible_members: responsibleMembers }) {
  const unsureCount = Number(stanceCounts.unsure || 0) + Number(stanceCounts.impulse || 0);
  if (supporters.length === 1 && responsibleMembers.length > 1) return "lone_advocate";
  if (notSelectedBy.length > 0) return "contested";
  if (unsureCount > 0 || (confidenceMean != null && confidenceMean < 0.55)) return "soft_or_unsure";
  if (responsibleMembers.length > 1 && notSelectedBy.length === 0) return "consensus_keep";
  return "single_owner";
}

function buildD4ConflictBoard({ individualSelections, assignments, materials }) {
  const groupMap = groupsById(materials.capabilityGroups);
  const capGroupById = capGroupsById(materials.capabilityGroups);
  const capNameById = capabilityNameMap(materials.capabilityGroups);
  const responsibleByGroup = buildResponsibleMembersByGroup(assignments);
  const byGroup = new Map();

  for (const item of individualSelections || []) {
    for (const card of item.parsed?.cards || []) {
      const groupId = capGroupById.get(card.cap_id);
      if (!groupId) continue;
      if (!byGroup.has(groupId)) byGroup.set(groupId, new Map());
      const groupCards = byGroup.get(groupId);
      if (!groupCards.has(card.cap_id)) {
        groupCards.set(card.cap_id, {
          cap_id: card.cap_id,
          name: capNameById.get(card.cap_id) || card.cap_id,
          group_id: groupId,
          selected_by: []
        });
      }
      groupCards.get(card.cap_id).selected_by.push({
        member_id: item.member_id,
        tier: card.tier,
        stance: normalizeCardStance(card.stance),
        confidence: normalizeCardConfidence(card.confidence),
        reason: String(card.reason || "").trim()
      });
    }
  }

  const groups = (materials.capabilityGroups.groups || []).map((group) => {
    const responsibleMembers = responsibleByGroup.get(group.group_id) || [];
    const candidates = Array.from((byGroup.get(group.group_id) || new Map()).values()).map((candidate) => {
      const selectedIds = candidate.selected_by.map((item) => item.member_id);
      const notSelectedBy = responsibleMembers.filter((memberId) => !selectedIds.includes(memberId));
      const stanceCounts = countBy(candidate.selected_by.map((item) => item.stance));
      const confidenceMean = meanOrNull(candidate.selected_by.map((item) => item.confidence));
      const tierCounts = countBy(candidate.selected_by.map((item) => item.tier));
      const row = {
        ...candidate,
        responsible_members: responsibleMembers,
        not_selected_by: notSelectedBy,
        stance_counts: stanceCounts,
        confidence_mean: confidenceMean,
        tier_counts: tierCounts
      };
      return {
        ...row,
        board_bucket: d4BoardBucket({
          supporters: row.selected_by,
          notSelectedBy,
          stance_counts: stanceCounts,
          confidence_mean: confidenceMean,
          responsible_members: responsibleMembers
        })
      };
    }).sort((a, b) => a.cap_id.localeCompare(b.cap_id));
    const notes = (individualSelections || [])
      .filter((item) => (item.groups || []).includes(group.group_id))
      .map((item) => ({
        member_id: item.member_id,
        ignored_groups: item.parsed?.ignored_groups || [],
        doubts: item.parsed?.doubts || []
      }))
      .filter((item) => item.ignored_groups.length || item.doubts.length);
    return {
      group_id: group.group_id,
      name: groupMap.get(group.group_id)?.name || group.group_id,
      responsible_members: responsibleMembers,
      candidates,
      notes
    };
  });

  return {
    generated_at: new Date().toISOString(),
    method: "deterministic aggregation of individual D4 card stances; no LLM calls",
    stance_legend: {
      must: "member says they would defend this card",
      nice: "useful but cuttable",
      impulse: "gut/shortcut pick",
      unsure: "low-confidence or not fully understood"
    },
    groups
  };
}

function formatD4ConflictBoardForPrompt(board, filterGroups = null) {
  if (!board) return "";
  const groupFilter = filterGroups ? new Set(filterGroups) : null;
  const groups = (board.groups || []).filter((group) => !groupFilter || groupFilter.has(group.group_id));
  return groups.map((group) => {
    const lines = [
      `${group.name} (${group.group_id})；负责成员：${group.responsible_members.join("、") || "无"}`
    ];
    if (!group.candidates.length) {
      lines.push("- 没有人在个人界面主动点这个功能区的卡；如果最终必须保留，需要说清楚为什么。");
    } else {
      for (const candidate of group.candidates) {
        const supporters = candidate.selected_by.map((item) => {
          const conf = item.confidence == null ? "?" : item.confidence;
          return `${item.member_id}/${item.tier}/${item.stance}/conf=${conf}`;
        }).join("、");
        const reasons = candidate.selected_by.map((item) => item.reason).filter(Boolean).slice(0, 2).join("；");
        lines.push([
          `- ${candidate.cap_id}｜${candidate.name}`,
          `bucket=${candidate.board_bucket}`,
          `支持=${supporters || "无"}`,
          candidate.not_selected_by.length ? `未点=${candidate.not_selected_by.join("、")}` : "",
          reasons ? `原话理由=${reasons}` : ""
        ].filter(Boolean).join("；"));
      }
    }
    const doubts = (group.notes || []).flatMap((item) => item.doubts.map((text) => `${item.member_id}: ${text}`));
    if (doubts.length) lines.push(`成员犹豫：${doubts.slice(0, 4).join("；")}`);
    return lines.join("\n");
  }).join("\n\n");
}

function d4TierWeight(tier) {
  if (tier === "high") return 1;
  if (tier === "mid") return 0.62;
  return 0.28;
}

function d4CardCost(card) {
  try {
    return Number(RD.getCapabilityParams(card.cap_id, card.tier)?.dCOGS || 0);
  } catch (_) {
    return 0;
  }
}

function cardsForGroup(cards, groupId, capGroupById) {
  return (cards || []).filter((card) => capGroupById.get(card.cap_id) === groupId);
}

function cardKeys(cards) {
  return (cards || []).map(cardKey);
}

function memberSelectionById(individualSelections) {
  return new Map((individualSelections || []).map((item) => [item.member_id, item]));
}

function d4IgnoredReason({ ownCards, notes, behavior, groupName }) {
  const doubts = (notes?.doubts || []).filter(Boolean);
  if (doubts.length) return doubts[0];
  if (ownCards.length === 0) {
    if (behavior.taskSkepticism > 0.58) return `这格没太认真展开，觉得${groupName}先让别人定也行`;
    if (behavior.calculationImpulse < 0.34) return `这格技术/成本看不太清，先少点`;
    return `这格没有明显想坚持的卡`;
  }
  if (ownCards.some((card) => normalizeCardStance(card.stance) === "unsure")) return "自己也有不确定的卡，未必会强推";
  return "";
}

function seedD4CardState({ members, leaderIdx, assignments, individualSelections, d4ConflictBoard, materials, seed }) {
  const groupMap = groupsById(materials.capabilityGroups);
  const capGroupById = capGroupsById(materials.capabilityGroups);
  const selectionByMember = memberSelectionById(individualSelections);
  const assignmentByMember = new Map((assignments || []).map((item) => [item.member_id, item]));
  const boardGroupById = new Map((d4ConflictBoard?.groups || []).map((item) => [item.group_id, item]));
  const events = [];

  members.forEach((member, index) => {
    const isLeader = index === leaderIdx;
    const behavior = classroomBehaviorProfile(member, isLeader);
    const state = ensureBehavioralState(member, isLeader);
    if (!state.d4_group_state) state.d4_group_state = {};
    const selection = selectionByMember.get(member.profile_id);
    const assignment = assignmentByMember.get(member.profile_id) || { groups: [] };
    const rng = makeRng(`d4_state_seed:${seed}:${member.profile_id}`);

    for (const groupId of assignment.groups || []) {
      const group = groupMap.get(groupId);
      const groupName = group?.name || groupId;
      const ownCards = cardsForGroup(selection?.parsed?.cards || [], groupId, capGroupById);
      const allCardsInGroup = group?.capabilities || [];
      const avgConfidence = meanOrNull(ownCards.map((card) => card.confidence)) ?? 0.42;
      const mustCount = ownCards.filter((card) => normalizeCardStance(card.stance) === "must").length;
      const unsureCount = ownCards.filter((card) => ["unsure", "impulse"].includes(normalizeCardStance(card.stance))).length;
      const costLoad = clamp(ownCards.reduce((sum, card) => sum + Math.max(0, d4CardCost(card)), 0) / 720, 0, 1);
      const tierLoad = ownCards.length ? ownCards.reduce((sum, card) => sum + d4TierWeight(card.tier), 0) / ownCards.length : 0.35;
      const pickedShare = allCardsInGroup.length ? ownCards.length / allCardsInGroup.length : 0.2;
      const technicalIndustry = /技术|工程|制造|供应链|产品|AI|SaaS|硬件/u.test(`${member.industry} ${member.background} ${member.role}`);
      const boardGroup = boardGroupById.get(groupId);
      const notes = (boardGroup?.notes || []).find((item) => item.member_id === member.profile_id) || null;
      const jitter = () => (rng() - 0.5) * 0.16;
      const technicalComprehension = clamp(
        0.32 + behavior.calculationImpulse * 0.24 + (technicalIndustry ? 0.12 : 0) + avgConfidence * 0.16 - unsureCount * 0.05 + jitter(),
        0,
        1
      );
      const attentionBreadth = clamp(
        0.28 + behavior.engagement * 0.24 + behavior.relevanceControl * 0.16 + pickedShare * 0.25 - behavior.taskSkepticism * 0.14 + jitter(),
        0,
        1
      );
      const cardConfidence = clamp(
        avgConfidence + mustCount * 0.08 - unsureCount * 0.06 + behavior.dominance * 0.08 + jitter(),
        0,
        1
      );
      const costDiscomfort = clamp(
        0.22 + costLoad * 0.28 + tierLoad * 0.1 + Number(state.price_sensitivity || 0.5) * 0.22 + behavior.calculationImpulse * 0.06 + pickedShare * 0.12 + jitter(),
        0,
        1
      );
      const ownershipCommitment = clamp(
        0.18 + ownCards.length * 0.055 + mustCount * 0.16 + cardConfidence * 0.2 + behavior.dominance * 0.11 + behavior.statusMotive * 0.08 - behavior.agreeability * 0.05 + jitter(),
        0,
        1
      );
      const socialYielding = clamp(
        0.24 + behavior.agreeability * 0.28 + (1 - behavior.dominance) * 0.22 + behavior.taskSkepticism * 0.08 - cardConfidence * 0.16 - mustCount * 0.05 + jitter(),
        0,
        1
      );
      const groupState = {
        group_id: groupId,
        group_name: groupName,
        attention_breadth: Number(attentionBreadth.toFixed(3)),
        technical_comprehension: Number(technicalComprehension.toFixed(3)),
        card_confidence: Number(cardConfidence.toFixed(3)),
        cost_discomfort: Number(costDiscomfort.toFixed(3)),
        ownership_commitment: Number(ownershipCommitment.toFixed(3)),
        social_yielding: Number(socialYielding.toFixed(3)),
        own_cards: cardKeys(ownCards),
        ignored_reason: d4IgnoredReason({ ownCards, notes, behavior, groupName }),
        last_segment_position: ""
      };
      state.d4_group_state[groupId] = groupState;
      events.push({
        member_id: member.profile_id,
        is_leader: isLeader,
        group_id: groupId,
        state: groupState
      });
    }
  });
  return events;
}

function snapshotD4CardState(members, leaderIdx) {
  return members.map((member, index) => {
    const state = ensureBehavioralState(member, index === leaderIdx);
    return {
      member_id: member.profile_id,
      is_leader: index === leaderIdx,
      d4_group_state: state.d4_group_state || {},
      d4_recent_review: state.d4_recent_review || null,
      behavioral_state: {
        attention_focus: state.attention_focus,
        confidence: state.confidence,
        confusion: state.confusion,
        fatigue: state.fatigue,
        social_commitment: state.social_commitment,
        price_sensitivity: state.price_sensitivity,
        last_public_position: state.last_public_position
      }
    };
  });
}

function d4SegmentEffectLabel({ ownTotal, ownRetained, finalCount, costTotal }) {
  if (ownTotal === 0) return finalCount ? "这格主要是别人定的，自己跟着看" : "这格几乎没参与";
  const ratio = ownRetained / ownTotal;
  if (ratio >= 0.75 && costTotal < 420) return "自己的想法被接住，而且成本看着还行";
  if (ratio >= 0.75) return "自己的想法被接住，但开始担心功能变重";
  if (ratio > 0) return "自己有些卡留下，有些被砍，后面会更摇摆";
  return "自己这格基本没被接住，后面可能少坚持或换角度";
}

function updateD4CardStateAfterSegment({ members, leaderIdx, segment, selectedCards, individualSelections, materials }) {
  const groupMap = groupsById(materials.capabilityGroups);
  const capGroupById = capGroupsById(materials.capabilityGroups);
  const selectionByMember = memberSelectionById(individualSelections);
  const updates = [];

  members.forEach((member, index) => {
    const isLeader = index === leaderIdx;
    const state = ensureBehavioralState(member, isLeader);
    if (!state.d4_group_state) state.d4_group_state = {};
    const selection = selectionByMember.get(member.profile_id);
    const behavior = classroomBehaviorProfile(member, isLeader);
    const finalCaps = new Set((selectedCards || []).map((card) => card.cap_id));
    const finalKeys = new Set((selectedCards || []).map(cardKey));

    for (const groupId of segment || []) {
      const groupName = groupMap.get(groupId)?.name || groupId;
      const ownCards = cardsForGroup(selection?.parsed?.cards || [], groupId, capGroupById);
      const finalCards = cardsForGroup(selectedCards, groupId, capGroupById);
      const ownRetained = ownCards.filter((card) => finalCaps.has(card.cap_id)).length;
      const ownExactRetained = ownCards.filter((card) => finalKeys.has(cardKey(card))).length;
      const ownTotal = ownCards.length;
      const retainedRatio = ownTotal ? ownRetained / ownTotal : 0;
      const exactRatio = ownTotal ? ownExactRetained / ownTotal : 0;
      const costTotal = finalCards.reduce((sum, card) => sum + Math.max(0, d4CardCost(card)), 0);
      const finalTierLoad = finalCards.length
        ? finalCards.reduce((sum, card) => sum + d4TierWeight(card.tier), 0) / finalCards.length
        : 0;
      const previous = state.d4_group_state[groupId] || {
        group_id: groupId,
        group_name: groupName,
        attention_breadth: 0.45,
        technical_comprehension: 0.45,
        card_confidence: 0.45,
        cost_discomfort: 0.45,
        ownership_commitment: 0.3,
        social_yielding: 0.5,
        own_cards: cardKeys(ownCards),
        ignored_reason: "",
        last_segment_position: ""
      };
      const effectLabel = d4SegmentEffectLabel({ ownTotal, ownRetained, finalCount: finalCards.length, costTotal });
      const costPressure = clamp(costTotal / 780 + Math.max(0, finalCards.length - 2) * 0.08 + finalTierLoad * 0.12, 0, 1);
      const newState = {
        ...previous,
        group_id: groupId,
        group_name: groupName,
        own_cards: cardKeys(ownCards),
        final_cards: cardKeys(finalCards),
        own_retained: ownRetained,
        own_exact_retained: ownExactRetained,
        own_total: ownTotal,
        attention_breadth: Number(clamp(Number(previous.attention_breadth || 0.45) + 0.05 + behavior.engagement * 0.025 - behavior.taskSkepticism * 0.035, 0, 1).toFixed(3)),
        technical_comprehension: Number(clamp(Number(previous.technical_comprehension || 0.45) + 0.035 + behavior.calculationImpulse * 0.025 - Math.max(0, costPressure - 0.65) * 0.05, 0, 1).toFixed(3)),
        card_confidence: Number(clamp(Number(previous.card_confidence || 0.45) + (retainedRatio - 0.5) * 0.18 + (exactRatio - retainedRatio) * 0.06, 0, 1).toFixed(3)),
        cost_discomfort: Number(clamp(Number(previous.cost_discomfort || 0.45) + costPressure * 0.16 + Math.max(0, finalCards.length - 2) * 0.035 - retainedRatio * 0.025, 0, 1).toFixed(3)),
        ownership_commitment: Number(clamp(Number(previous.ownership_commitment || 0.3) + (retainedRatio - 0.45) * 0.18 + ownTotal * 0.015 - behavior.agreeability * 0.025, 0, 1).toFixed(3)),
        social_yielding: Number(clamp(Number(previous.social_yielding || 0.5) + (0.55 - retainedRatio) * 0.14 + behavior.agreeability * 0.025 - behavior.dominance * 0.025, 0, 1).toFixed(3)),
        last_segment_position: effectLabel
      };
      state.d4_group_state[groupId] = newState;
      state.d4_recent_review = {
        group_id: groupId,
        group_name: groupName,
        own_total: ownTotal,
        own_retained: ownRetained,
        own_exact_retained: ownExactRetained,
        final_cards: cardKeys(finalCards),
        effect_label: effectLabel
      };
      state.attention_focus = `刚复核完${groupName}，在想后面的能力卡要不要继续加重`;
      state.confidence = clamp(Number(state.confidence || 0.5) + (retainedRatio - 0.5) * 0.05, 0, 1);
      state.confusion = clamp(Number(state.confusion || 0.3) + Math.max(0, costPressure - 0.7) * 0.05 - retainedRatio * 0.015, 0, 1);
      state.price_sensitivity = clamp(Number(state.price_sensitivity || 0.5) + costPressure * 0.045 + Math.max(0, finalCards.length - 2) * 0.01, 0, 1);
      updates.push({
        member_id: member.profile_id,
        is_leader: isLeader,
        group_id: groupId,
        own_total: ownTotal,
        own_retained: ownRetained,
        own_exact_retained: ownExactRetained,
        final_cards: cardKeys(finalCards),
        cost_total: Math.round(costTotal),
        effect_label: effectLabel,
        state: newState
      });
    }
  });
  return updates;
}

function validateIndividualCards(parsed, context) {
  const cards = coerceCardArrayFromParsed(parsed);
  if (!cards.length) throw new Error("cards required");
  const allowedGroups = new Set(context.allowedGroups || []);
  const capGroup = capGroupsById(context.capabilityGroups);
  const normalized = cards.map((card) => {
    const rawCapId = String(card?.cap_id ?? card?.id ?? "").trim();
    const suffixCapId = rawCapId.split(":").pop().trim();
    const capId = capGroup.has(rawCapId) ? rawCapId : suffixCapId;
    const tier = String(card?.tier ?? "").trim().toLowerCase();
    if (!capId) throw new Error("card.cap_id required");
    if (!["low", "mid", "high"].includes(tier)) throw new Error(`invalid tier for ${capId}: ${tier}`);
    RD.getCapabilityParams(capId, tier);
    const groupId = capGroup.get(capId);
    if (!allowedGroups.has(groupId)) throw new Error(`cap_id not in member assigned dimensions: ${capId}`);
    const normalized = { cap_id: capId, tier };
    if (context.includeHumanPickMetadata) {
      normalized.stance = normalizeCardStance(card?.stance ?? card?.priority ?? card?.attitude ?? card?.["立场"]);
      normalized.confidence = normalizeCardConfidence(card?.confidence ?? card?.certainty ?? card?.["信心"]);
      normalized.reason = String(card?.reason ?? card?.rationale ?? card?.["理由"] ?? "").trim();
    }
    return normalized;
  });
  const rationale = String(parsed.rationale ?? parsed.reason ?? parsed.cost_stance?.text ?? "个人选卡提交").trim();
  const result = {
    cards: normalized,
    rationale: rationale || "个人选卡提交"
  };
  if (context.includeHumanPickMetadata) {
    result.ignored_groups = normalizeTextArray(parsed.ignored_groups ?? parsed.ignoredGroups ?? parsed["忽略的维度"]);
    result.doubts = normalizeTextArray(parsed.doubts ?? parsed.concerns ?? parsed["犹豫"]);
  }
  return result;
}

function parseIndividualCardsDecision(raw, context) {
  return {
    parsed: validateIndividualCards(parseJsonLoose(raw), context),
    parse_raw: null,
    parse_method: "direct_json"
  };
}

async function individualCardStorySelection({ member, isLeader, draw, proposal, assignment, r1Frozen, chosenPrototype, materials, temperature, arm, outputDir = null }) {
  const groupMap = groupsById(materials.capabilityGroups);
  const allowedCards = allowedCardsForGroups(materials.capabilityGroups, assignment.groups);
  const groupText = assignment.groups.map((groupId) => {
    const group = groupMap.get(groupId);
    if (!group) throw new Error(`unknown assigned capability group: ${groupId}`);
    return formatGroup(group);
  }).join("\n\n");
  const context = {
    allowedGroups: assignment.groups,
    allowedCards,
    capabilityGroups: materials.capabilityGroups,
    includeHumanPickMetadata: true,
    submitParseRetries: 2
  };
  const baseMessages = [
    {
      role: "system",
      content: `${formatProfile(member, isLeader, arm)}\n\n${formatR1ActorCarryoverForPrompt(member)}\n\n你现在不是在做产品经理最优解，而是在演这个人如何读一个真实网页界面。允许漏看、误读、顺手点、嫌麻烦、被卡片名字吸引。`
    },
    {
      role: "user",
      content: [
        formatJinang(draw),
        "",
        buildR2ContextPanel(r1Frozen, chosenPrototype, { includeReportExcerpt: true }),
        "",
        "【界面：个人选卡前的短剧本】",
        `你负责的维度：${formatGroupNames(assignment.groups, groupMap)}。`,
        d4StoryLens(member, isLeader, assignment),
        "",
        "你先写一段短剧式私有行动轨迹：你怎么扫界面、先注意到什么、误解或跳过什么、最后手上具体点了哪些卡。",
        "重要：这不是事后解释最优方案；你后面的个人选卡只会从 action_trace 里 action=select 的项确定。不要为了显得完整而补齐产品底座。",
        "action_trace 至少 3 条，必须混合 select / skip / hesitate；至少 1 条 select。select 必须给 tier。",
        "",
        "【你的 Round 1 会前提案】",
        `${proposal.parsed.grid_id}/${proposal.parsed.architecture}：${proposal.parsed.rationale}`,
        "【你负责维度的能力卡】",
        groupText,
        "【合法 cap_id 清单】",
        formatAllowedCardsForPrompt(allowedCards),
        "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。schema：",
        '{"scene_state":"你此刻的状态","attention_path":"你如何扫界面","misread_or_skip":"你误解/跳过了什么","inner_line":"一句内心独白","action_trace":[{"action":"select|skip|hesitate","cap_id":"真实cap_id","tier":"low|mid|high|null","stance":"must|nice|impulse|unsure","confidence":0到1,"reason":"一句自然话"}],"public_stance":"你可能会在小组里怎么说","ignored_groups":[],"doubts":[],"rationale":"一句话总结这次手上动作"}'
      ].join("\n")
    }
  ];
  let messages = baseMessages;
  let lastRaw = "";
  let lastError = "";
  const attemptLogPath = outputDir ? path.join(outputDir, "r2_individual_card_attempts.jsonl") : null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature, maxTokens: 2400 });
      const parsed = parseD4StoryTrace(lastRaw, context);
      const groupByCard = {};
      const capGroup = capGroupsById(materials.capabilityGroups);
      parsed.parsed.cards.forEach((card) => {
        groupByCard[card.cap_id] = capGroup.get(card.cap_id);
      });
      if (attemptLogPath) {
        appendJsonl(attemptLogPath, {
          ts: new Date().toISOString(),
          member_id: member.profile_id,
          groups: assignment.groups,
          attempt: attempt + 1,
          status: "ok",
          mode: "story_action_trace",
          raw: lastRaw,
          story: parsed.story,
          parsed: parsed.parsed
        });
      }
      return {
        member_id: member.profile_id,
        member_name: member.surface?.name || member.profile_id,
        groups: assignment.groups,
        prompt: baseMessages,
        raw: lastRaw,
        story_trace: parsed.story,
        parsed: parsed.parsed,
        parse_raw: parsed.story,
        parse_method: parsed.parse_method,
        attempts: attempt + 1,
        group_by_card: groupByCard
      };
    } catch (error) {
      lastError = error.message;
      if (attemptLogPath) {
        appendJsonl(attemptLogPath, {
          ts: new Date().toISOString(),
          member_id: member.profile_id,
          groups: assignment.groups,
          attempt: attempt + 1,
          status: "error",
          mode: "story_action_trace",
          error: lastError,
          raw: lastRaw
        });
      }
      messages = [
        { role: "system", content: `${formatProfile(member, isLeader, arm)}\n你必须修正为合法短剧本 action_trace。不要引入新 cap_id 或 tier。` },
        {
          role: "user",
          content: [
            `上一次短剧本无法解析，原因：${lastError}`,
            `你负责的维度只能是：${assignment.groups.join(", ")}`,
            "合法 cap_id 只能从下面清单逐字选择，不能创造新 ID：",
            formatAllowedCardsForPrompt(allowedCards),
            "action_trace 至少 3 条，必须混合 select / skip / hesitate；至少 1 条 select。select 的 tier 只能是 low/mid/high。",
            "请只输出 JSON，不要 Markdown，不要额外文字。schema：",
            '{"scene_state":"","attention_path":"","misread_or_skip":"","inner_line":"","action_trace":[{"action":"select|skip|hesitate","cap_id":"真实cap_id","tier":"low|mid|high|null","stance":"must|nice|impulse|unsure","confidence":0到1,"reason":"一句自然话"}],"public_stance":"","ignored_groups":[],"doubts":[],"rationale":""}',
            "",
            "上一次输出：",
            lastRaw
          ].join("\n")
        }
      ];
    }
  }
  throw new Error(`individual_card_story_parse_failure: ${lastError}`);
}

async function individualCardSelection({ member, isLeader, draw, proposal, assignment, r1Frozen, chosenPrototype, materials, temperature, arm, outputDir = null }) {
  if (hasD4StoryPickArm(arm)) {
    return individualCardStorySelection({ member, isLeader, draw, proposal, assignment, r1Frozen, chosenPrototype, materials, temperature, arm, outputDir });
  }
  const groupMap = groupsById(materials.capabilityGroups);
  const allowedCards = allowedCardsForGroups(materials.capabilityGroups, assignment.groups);
  const humanPick = hasD4HumanPickArm(arm);
  const groupText = assignment.groups.map((groupId) => {
    const group = groupMap.get(groupId);
    if (!group) throw new Error(`unknown assigned capability group: ${groupId}`);
    return formatGroup(group);
  }).join("\n\n");
  const selectionConstraints = { per_group_min: 1, total_min: 1 };
  const context = {
    allowedGroups: assignment.groups,
    allowedCards,
    capabilityGroups: materials.capabilityGroups,
    selectionConstraints,
    includeHumanPickMetadata: humanPick,
    submitParseRetries: 2
  };
  const baseMessages = [
    {
      role: "system",
      content: `${formatProfile(member, isLeader, arm)}\n\n${formatR1ActorCarryoverForPrompt(member)}\n\n以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。`
    },
    {
      role: "user",
      content: [
        formatJinang(draw),
        "",
        buildR2ContextPanel(r1Frozen, chosenPrototype, { includeReportExcerpt: true }),
        "",
        "【界面：个人选卡】",
        `你负责的维度：${formatGroupNames(assignment.groups, groupMap)}。`,
        humanPick
          ? [
              "像真人单独坐在个人选卡界面前一样点卡：只点你此刻真的看懂、觉得和用户痛点有关系、或你想坚持的卡。",
              "你不需要替全队把所有维度补齐；不确定、看不懂、觉得像锦上添花的卡可以不点，也可以点但标成 unsure/impulse。",
              "每张卡都标一个私有立场：must=我会坚持；nice=有用但可砍；impulse=凭感觉顺手点；unsure=我没太把握。",
              "每张卡再标 confidence 0-1。confidence 不是正确率，是你自己此刻有多愿意为这张卡辩护。"
            ].join("\n")
          : "根据调研结果和你的判断，把你认为产品应该具备的能力都选上，再选择合适的档次。",
        "至少选择 1 张；具体张数、卡片和 low/mid/high 档位由你决定。",
        "界面会显示单位成本、研发投入和团队投入说明，便于你在能力与成本之间取舍。",
        "【你的 Round 1 会前提案】",
        `${proposal.parsed.grid_id}/${proposal.parsed.architecture}：${proposal.parsed.rationale}`,
        "【你负责维度的能力卡】",
        groupText,
        "【合法 cap_id 清单】",
        formatAllowedCardsForPrompt(allowedCards),
        humanPick
          ? [
              "最后单独写一行【我的个人选卡提交】，并给出可索引 JSON：",
              '{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high","stance":"must|nice|impulse|unsure","confidence":0到1,"reason":"一句自然话"}],"ignored_groups":["你负责但基本没看懂或没感觉的维度"],"doubts":["还在犹豫的点"],"rationale":"一句自然话说明你的取舍"}'
            ].join("\n")
          : "",
        isRoomRoleplayArm(arm)
          ? (humanPick ? "" : [
              "请像真人在个人选卡界面前一样，先用几句话说你为什么点这些卡、哪些卡你有点犹豫。",
              "最后单独写一行【我的个人选卡提交】，并给出可索引 JSON：",
              '{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high"}],"rationale":"一句自然话说明你的取舍"}'
            ].join("\n"))
          : '请只输出可 JSON.parse 的 JSON：{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high"}],"rationale":"一句自然话说明你的取舍"}'
      ].join("\n")
    }
  ];

  let messages = baseMessages;
  let lastRaw = "";
  let lastError = "";
  const attemptLogPath = outputDir ? path.join(outputDir, "r2_individual_card_attempts.jsonl") : null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature, maxTokens: humanPick ? 2200 : 1800 });
      const parsed = parseIndividualCardsDecision(lastRaw, context);
      if (attemptLogPath) {
        appendJsonl(attemptLogPath, {
          ts: new Date().toISOString(),
          member_id: member.profile_id,
          groups: assignment.groups,
          attempt: attempt + 1,
          status: "ok",
          raw: lastRaw,
          parsed: parsed.parsed
        });
      }
      const groupByCard = {};
      const capGroup = capGroupsById(materials.capabilityGroups);
      parsed.parsed.cards.forEach((card) => {
        groupByCard[card.cap_id] = capGroup.get(card.cap_id);
      });
      return {
        member_id: member.profile_id,
        member_name: member.surface?.name || member.profile_id,
        groups: assignment.groups,
        prompt: baseMessages,
        raw: lastRaw,
        parsed: parsed.parsed,
        parse_raw: parsed.parse_raw,
        parse_method: parsed.parse_method,
        attempts: attempt + 1,
        group_by_card: groupByCard
      };
    } catch (error) {
      lastError = error.message;
      if (attemptLogPath) {
        appendJsonl(attemptLogPath, {
          ts: new Date().toISOString(),
          member_id: member.profile_id,
          groups: assignment.groups,
          attempt: attempt + 1,
          status: "error",
          error: lastError,
          raw: lastRaw
        });
      }
      messages = [
        { role: "system", content: `${formatProfile(member, isLeader, arm)}\n你必须修正为合法个人选卡提交，不要引入新 cap_id 或 tier。` },
        {
          role: "user",
          content: [
            `上一次个人选卡无法解析，原因：${lastError}`,
            `你负责的维度只能是：${assignment.groups.join(", ")}`,
            "合法 cap_id 只能从下面清单逐字选择，不能创造新 ID：",
            formatAllowedCardsForPrompt(allowedCards),
            "至少选择 1 张；tier 只能是 low/mid/high。",
            humanPick
              ? '请重新输出 JSON，不要 Markdown，不要额外文字。schema：{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high","stance":"must|nice|impulse|unsure","confidence":0到1,"reason":"一句自然话"}],"ignored_groups":[],"doubts":[],"rationale":"一句自然话说明你的取舍"}'
              : "请重新输出同样 JSON，不要 Markdown，不要额外文字。",
            "",
            "上一次输出：",
            lastRaw
          ].join("\n")
        }
      ];
    }
  }
  throw new Error(`individual_card_selection_parse_failure: ${member.profile_id}: ${lastError}`);
}

function normalizeD4ScreenplayActionType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (/unselect|remove|delete|drop|cut|取消|砍|删|去掉|拿掉|不要|放弃/u.test(text)) return "unselect_card";
  if (/change|tier|downgrade|upgrade|adjust|改档|调档|降档|升档|换档|调整/u.test(text)) return "change_tier";
  if (/select|add|choose|click|keep|retain|move|drag|confirm|card_action|点|选|加|保留|留下|勾|拖|放|固定|确认/u.test(text)) return "select_card";
  return text;
}

function normalizeD4ScreenplayTier(value, line, fallback = null) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["low", "mid", "high"].includes(text)) return text;
  const combined = `${text} ${String(line || "").trim().toLowerCase()}`;
  if (/high|高档|高配|顶配|拉高/u.test(combined)) return "high";
  if (/mid|中档|中配|中等|适中/u.test(combined)) return "mid";
  if (/low|低档|低配|基础|便宜|保守/u.test(combined)) return "low";
  return ["low", "mid", "high"].includes(fallback) ? fallback : null;
}

function d4CardAliases(card) {
  const aliases = new Set([card.cap_id]);
  const name = String(card.name || "").trim();
  if (name) {
    aliases.add(name);
    const stripped = name.replace(/[（(][^）)]*[）)]/gu, "").trim();
    if (stripped) aliases.add(stripped);
    for (const piece of name.split(/[／/、,，]/u)) {
      const cleaned = piece.replace(/[（(][^）)]*[）)]/gu, "").trim();
      if (cleaned.length >= 2) aliases.add(cleaned);
    }
  }
  return Array.from(aliases).filter(Boolean);
}

function d4ScreenplayCapId(rawAction, line, allowedCards, capGroup) {
  const raw = rawAction && typeof rawAction === "object"
    ? (rawAction.cap_id ?? rawAction.id ?? rawAction.card ?? rawAction["卡"] ?? rawAction["能力卡"])
    : "";
  const direct = normalizeStoryCapId(raw, capGroup);
  const allowedIds = allowedCards.map((card) => card.cap_id);
  if (allowedIds.includes(direct)) return direct;
  const text = `${line || ""} ${JSON.stringify(rawAction || {})}`;
  const byCapId = allowedIds
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((capId) => text.includes(capId));
  if (byCapId) return byCapId;
  const byAlias = allowedCards
    .flatMap((card) => d4CardAliases(card).map((alias) => ({ alias, cap_id: card.cap_id })))
    .sort((a, b) => b.alias.length - a.alias.length)
    .find((item) => item.alias.length >= 2 && text.includes(item.alias));
  return byAlias?.cap_id || "";
}

function normalizeD4ScreenplayRawAction(rawAction, item) {
  if (rawAction && typeof rawAction === "object") return rawAction;
  if (typeof rawAction === "string") {
    const trimmed = rawAction.trim();
    if (!trimmed) return null;
    if (/^[{[]/u.test(trimmed)) {
      try {
        return parseJsonLoose(trimmed);
      } catch (error) {
        return { type: trimmed };
      }
    }
    return {
      type: trimmed,
      cap_id: item.cap_id ?? item.card_id ?? item.card ?? item["卡"] ?? item["能力卡"],
      tier: item.tier ?? item.level ?? item["档位"]
    };
  }
  return null;
}

function inferD4ScreenplayAction({ rawAction, item, line, stageDirection, allowedCards, capGroup, current }) {
  const action = normalizeD4ScreenplayRawAction(rawAction, item || {});
  const text = `${line || ""} ${stageDirection || ""} ${JSON.stringify(action || {})}`;
  let type = action
    ? normalizeD4ScreenplayActionType([
        action.type ?? action["类型"] ?? "",
        action.action ?? ""
      ].join(" "))
    : "";
  const hasNaturalUiIntent = /点|选|加|拖|放|勾|固定|保留|留下|取消|砍|删|拿掉|不要|改档|调档|降档|升档|换档|调整|确认|就这样|先这样|不用动|不改/u.test(text);
  if (!type && hasNaturalUiIntent) type = normalizeD4ScreenplayActionType(text);
  if (!["select_card", "unselect_card", "change_tier"].includes(type)) return null;

  let capId = d4ScreenplayCapId(action, text, allowedCards || [], capGroup);
  if (!capId) {
    if (action) throw new Error("d4_screenplay invalid cap_id: (empty)");
    return null;
  }

  const previousTier = current.get(capId)?.tier || null;
  let tier = normalizeD4ScreenplayTier(action?.tier ?? action?.level ?? action?.["档位"], line, previousTier);
  if (type !== "unselect_card" && !tier) {
    // A structured action missing its tier is a schema violation worth a rewrite; a merely
    // spoken intent with no stated tier is not an indexable click — never invent a tier.
    if (action) throw new Error(`d4_screenplay ${type} missing valid tier for ${capId}`);
    return null;
  }
  return {
    type,
    cap_id: capId,
    tier: tier || previousTier || null,
    salvaged: !action || !rawAction || typeof rawAction === "string"
  };
}

function parseD4ScreenplayJson(raw) {
  try {
    return parseJsonLoose(raw);
  } catch (firstError) {
    const text = String(raw || "").replace(/```json|```/gu, "").trim();
    const left = text.indexOf("{");
    const right = text.lastIndexOf("}");
    const clipped = left >= 0 && right > left ? text.slice(left, right + 1) : text;
    const repaired = clipped
      .replace(/("ui_action"\s*:\s*null)\s*[}]\s*[}]\s*,\s*[{]/gu, "$1},{")
      .replace(/("ui_action"\s*:\s*[{][^{}]*[}])\s*[}]\s*[}]\s*,\s*[{]/gu, "$1},{");
    try {
      return JSON.parse(repaired);
    } catch (_) {
      throw firstError;
    }
  }
}

function validateD4Screenplay(parsed, context) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const rawBeats = ensureArray(source.beats || source.scene_beats || source["剧本"] || source["台词"]);
  if (rawBeats.length < 3) throw new Error("d4_screenplay beats must include at least 3 beats");
  const segmentSet = new Set(context.segment || []);
  const capGroup = capGroupsById(context.capabilityGroups);
  const allowedCaps = new Set((context.allowedCards || []).map((card) => card.cap_id));
  const allowedOrder = new Map((context.allowedCards || []).map((card, index) => [card.cap_id, index]));
  const current = new Map(cardsForGroups(context.initialCards || [], segmentSet, capGroup).map((card) => [card.cap_id, { cap_id: card.cap_id, tier: card.tier }]));
  const beats = [];
  const uiActions = [];

  for (const rawBeat of rawBeats) {
    const item = rawBeat && typeof rawBeat === "object" ? rawBeat : { line: rawBeat };
    const actor = normalizeScreenplayActor(item.actor ?? item.speaker ?? item.member_id ?? item["角色"], context.members);
    if (!actor) throw new Error(`invalid d4 screenplay actor: ${item.actor ?? item.speaker ?? item.member_id ?? ""}`);
    const line = String(item.line ?? item.text ?? item["台词"] ?? "").trim();
    const stageDirection = String(item.stage_direction ?? item.stage ?? item.action ?? item["舞台动作"] ?? "").trim();
    const rawAction = item.ui_action ?? item.uiAction ?? item["界面动作"] ?? null;
    let uiAction = null;
    const inferredAction = inferD4ScreenplayAction({
      rawAction,
      item,
      line,
      stageDirection,
      allowedCards: context.allowedCards || [],
      capGroup,
      current
    });
    if (inferredAction) {
      const { type, cap_id: capId, tier, salvaged } = inferredAction;
      if (!capId || !allowedCaps.has(capId)) throw new Error(`d4_screenplay invalid cap_id: ${capId || "(empty)"}`);
      const groupId = capGroup.get(capId);
      if (!segmentSet.has(groupId)) throw new Error(`d4_screenplay cap_id not in current segment: ${capId}`);
      const previousTier = current.get(capId)?.tier || null;
      if (type !== "unselect_card" && !tier) throw new Error(`d4_screenplay ${type} missing valid tier for ${capId}`);
      if (type !== "unselect_card") {
        RD.getCapabilityParams(capId, tier);
        current.set(capId, { cap_id: capId, tier });
      } else {
        current.delete(capId);
      }
      uiAction = { type, cap_id: capId, tier: tier || previousTier || null, salvaged };
      uiActions.push({ ...uiAction, actor, line, stage_direction: stageDirection });
    }
    beats.push({
      actor,
      stage_direction: stageDirection,
      line,
      ui_action: uiAction
    });
  }
  if (!uiActions.length) {
    const firstCurrent = Array.from(current.values()).find((card) => allowedCaps.has(card.cap_id));
    if (!firstCurrent) throw new Error("d4_screenplay must include at least one UI card action");
    const keepBeat = beats.find((beat) => beat.actor) || {
      actor: context.members[0]?.profile_id || "",
      stage_direction: "",
      line: "当前功能区保持现有选卡。",
      ui_action: null
    };
    const keepAction = {
      type: "select_card",
      cap_id: firstCurrent.cap_id,
      tier: firstCurrent.tier,
      salvaged: true,
      no_op_keep_current: true
    };
    keepBeat.ui_action = keepBeat.ui_action || keepAction;
    uiActions.push({
      ...keepAction,
      actor: keepBeat.actor,
      line: keepBeat.line,
      stage_direction: keepBeat.stage_direction
    });
  }
  const finalCards = Array.from(current.values()).sort((a, b) => {
    const ai = allowedOrder.has(a.cap_id) ? allowedOrder.get(a.cap_id) : 999;
    const bi = allowedOrder.has(b.cap_id) ? allowedOrder.get(b.cap_id) : 999;
    return ai - bi || a.cap_id.localeCompare(b.cap_id);
  });
  const perGroupMin = Number(context.selectionConstraints?.per_group_min || 1);
  for (const groupId of segmentSet) {
    if (cardsForGroup(finalCards, groupId, capGroup).length < perGroupMin) {
      throw new Error(`d4_screenplay_group_min: ${groupId} needs at least ${perGroupMin} card`);
    }
  }
  return {
    scene_state: String(source.scene_state ?? source.scene ?? source["场景"] ?? "").trim(),
    beats,
    ui_actions: uiActions,
    final_action: uiActions.at(-1),
    final_cards: finalCards,
    parse_method: "deterministic_d4_screenplay_ui_actions"
  };
}

function d4ScreenplayActionText(action) {
  if (!action) return "";
  if (action.type === "unselect_card") return `取消 ${action.cap_id}`;
  if (action.type === "change_tier") return `改档 ${action.cap_id}@${action.tier}`;
  return `选中 ${action.cap_id}@${action.tier}`;
}

function d4ScreenplayTranscript(openingText, screenplay) {
  const transcript = [{ speaker: "screen", text: openingText }];
  for (const beat of screenplay.beats) {
    const stage = beat.stage_direction ? `（${beat.stage_direction}）` : "";
    const line = beat.line || "";
    const action = beat.ui_action ? `（界面动作：${d4ScreenplayActionText(beat.ui_action)}）` : "";
    transcript.push({
      speaker: beat.actor,
      text: `${stage}${line}${action}`.trim() || "（没有说话）",
      ui_action: beat.ui_action
    });
  }
  return transcript;
}

function formatD4ScreenplayActorSheet(members, leaderIdx, segment, groupMap) {
  return members.map((member, index) => {
    const state = ensureBehavioralState(member, index === leaderIdx);
    const groupLines = (segment || []).map((groupId) => {
      const groupState = state.d4_group_state?.[groupId];
      if (!groupState) return "";
      return `${groupName(groupMap, groupId)}：自己原先点=${(groupState.own_cards || []).join("、") || "无"}；当前位置=${groupState.last_segment_position || "还没表态"}；成本不适=${Number(groupState.cost_discomfort || 0).toFixed(2)}；坚持度=${Number(groupState.ownership_commitment || 0).toFixed(2)}`;
    }).filter(Boolean);
    return [
      `【演员 ${member.profile_id}${index === leaderIdx ? " / 组长" : ""}】`,
      formatProfile(member, index === leaderIdx, "team_room_story_d4d5_v1"),
      formatR1ActorCarryoverForPrompt(member),
      groupLines.length ? `D4 当前格私有状态：${groupLines.join("；")}` : "",
      `当前状态：注意点=${state.attention_focus || ""}；信心=${Number(state.confidence || 0).toFixed(2)}；疲劳=${Number(state.fatigue || 0).toFixed(2)}。`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function buildD4ScreenplayScreen({
  r1Frozen,
  chosenPrototype,
  selectedCards,
  individualSelections,
  d4ConflictBoard,
  materials,
  segment,
  selectionRules,
  compatibilityFeedback
}) {
  const groupMap = groupsById(materials.capabilityGroups);
  const capGroupById = capGroupsById(materials.capabilityGroups);
  const segmentSet = new Set(segment);
  const groupText = segment.map((groupId) => {
    const group = groupMap.get(groupId);
    if (!group) throw new Error(`unknown capability group in config: ${groupId}`);
    return formatGroup(group);
  }).join("\n\n");
  return [
    buildR2ContextPanel(r1Frozen, chosenPrototype),
    "",
    "【界面：D4 能力卡复核页】",
    `团队合并草案：${cardsToText(selectedCards)}。`,
    `当前功能区合并草案：${cardsToText(cardsForGroups(selectedCards, segmentSet, capGroupById))}。`,
    "【当前功能区的个人意见】",
    formatMemberSelectionSummary(individualSelections, groupMap, segment) || "（无）",
    "",
    "【D4 冲突板】",
    formatD4ConflictBoardForPrompt(d4ConflictBoard, segment),
    compatibilityFeedback ? `\n【界面提示】上一版动作没有被界面接受：${compatibilityFeedback}。只改当前功能区，不要改前序已冻结功能区。` : "",
    "",
    `当前只复核这些功能区：${formatGroupNames(segment, groupMap)}。${selectionRules}`,
    "可以保留、取消、补选或改档；最终当前功能区停留在界面上的卡会替换该功能区草案。",
    "",
    groupText
  ].filter(Boolean).join("\n");
}

async function runD4ScreenplaySegment({
  members,
  leaderIdx,
  r1Frozen,
  chosenPrototype,
  selectedCards,
  individualSelections,
  d4ConflictBoard,
  materials,
  segment,
  segmentIndex,
  segmentPoint,
  selectionRules,
  selectionConstraints,
  compatibilityFeedback,
  temperature,
  seed,
  arm,
  outputDir,
  repairRound
}) {
  const groupMap = groupsById(materials.capabilityGroups);
  const allowedCards = allowedCardsForGroups(materials.capabilityGroups, segment);
  const screenText = buildD4ScreenplayScreen({
    r1Frozen,
    chosenPrototype,
    selectedCards,
    individualSelections,
    d4ConflictBoard,
    materials,
    segment,
    selectionRules,
    compatibilityFeedback
  });
  const actorSheet = formatD4ScreenplayActorSheet(members, leaderIdx, segment, groupMap);
  const legalActorIds = members.map((member) => member.profile_id).join(", ");
  const baseMessages = [
    {
      role: "system",
      content: [
        "你是一个场记式编剧。你的任务不是给商业建议，而是按演员人设续写真实 EMBA 讨论室里的一幕。",
        "每个角色只能按自己的人设、疲劳、面子、理解偏差和刚才个人选卡残留行动；可以沉默、敷衍、跑题、误会、临时改口。",
        "不要写 moderator，不要写讲解，不要写优化分析。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【演员表】",
        actorSheet,
        "",
        "【当前屏幕】",
        screenText,
        "",
        "【合法 cap_id 清单】",
        formatAllowedCardsForPrompt(allowedCards),
        "",
        "【编剧任务】",
        `继续写 D4 第 ${segmentIndex + 1} 格能力卡复核这一幕。角色们围着同一台电脑看当前功能区能力卡，像真人一样说话和动手。`,
        `actor 字段只能填写演员表里的真实成员 id：${legalActorIds}。不要发明 Rxx、成员A 或姓名代号。`,
        "至少 4 个 beat，最多 10 个 beat；不是每个人都必须说话，可以有人只做动作或没展开。",
        "如果有人在界面点卡，写 ui_action={\"type\":\"select_card\",\"cap_id\":\"真实cap_id\",\"tier\":\"low|mid|high\"}。",
        "如果有人取消某张卡，写 ui_action={\"type\":\"unselect_card\",\"cap_id\":\"真实cap_id\"}。",
        "如果有人改档，写 ui_action={\"type\":\"change_tier\",\"cap_id\":\"真实cap_id\",\"tier\":\"low|mid|high\"}。",
        "最终当前功能区必须至少有一张卡停留选中；不要另写 final_cards，最终卡只由 UI 动作后界面状态决定。",
        "不要输出 Markdown，不要输出额外说明。schema：",
        '{"scene_state":"一句场景状态","beats":[{"actor":"上面演员表里的真实成员 id","stage_direction":"动作/神情","line":"台词，可为空","ui_action":{"type":"select_card|unselect_card|change_tier","cap_id":"真实cap_id","tier":"low|mid|high"}|null}]}'
      ].join("\n")
    }
  ];
  if (outputDir) {
    appendJsonl(path.join(outputDir, "r2_d4_screenplay_prompts.jsonl"), {
      ts: new Date().toISOString(),
      segment_point: segmentPoint,
      segment,
      repair_round: repairRound,
      seed,
      arm,
      messages: baseMessages
    });
  }
  let messages = baseMessages;
  let lastRaw = "";
  let lastError = "";
  const attemptsPath = outputDir ? path.join(outputDir, "r2_d4_screenplay_attempts.jsonl") : null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await callText(messages, { temperature, maxTokens: 3600 });
      const screenplay = validateD4Screenplay(parseD4ScreenplayJson(lastRaw), {
        members,
        allowedCards,
        capabilityGroups: materials.capabilityGroups,
        initialCards: selectedCards,
        segment,
        selectionConstraints
      });
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          segment_point: segmentPoint,
          segment,
          repair_round: repairRound,
          attempt: attempt + 1,
          status: "ok",
          raw: lastRaw,
          screenplay
        });
      }
      const openingText = `【D4 能力卡复核页】屏幕显示当前功能区 ${formatGroupNames(segment, groupMap)}、团队草案、个人意见、冲突板和能力卡列表。小组开始点选/取消/改档。`;
      const transcript = d4ScreenplayTranscript(openingText, screenplay);
      const finalAction = screenplay.final_action || {};
      return {
        cardsSubmit: {
          text: `${finalAction.actor || ""}: ${finalAction.line || ""}`.trim(),
          parsed: {
            cards: screenplay.final_cards,
            rationale: `deterministically indexed from D4 screenplay UI actions; last action=${finalAction.actor || "unknown"}/${finalAction.type || "unknown"}`
          },
          parse_raw: screenplay,
          attempts: attempt + 1,
          parse_method: screenplay.parse_method
        },
        transcript,
        turns: [{ turn: repairRound + 1, screenplay }],
        screenplay
      };
    } catch (error) {
      lastError = error.message;
      if (attemptsPath) {
        appendJsonl(attemptsPath, {
          ts: new Date().toISOString(),
          segment_point: segmentPoint,
          segment,
          repair_round: repairRound,
          attempt: attempt + 1,
          status: "error",
          error: lastError,
          raw: lastRaw
        });
      }
      messages = [
        baseMessages[0],
        {
          role: "user",
          content: [
            "上一版 D4 剧本没有被界面接受。",
            `界面/解析提示：${lastError}`,
            "请从这个界面提示后继续写一版完整 D4 剧本，仍然按演员人设，不要写商业分析。",
            "必须包含至少一个合法 UI card action，最终当前功能区至少保留一张卡；只输出 JSON。",
            `actor 字段只能填写这些真实成员 id：${legalActorIds}。`,
            "合法 cap_id 只能从下面清单逐字选择，不能创造新 ID：",
            formatAllowedCardsForPrompt(allowedCards),
            "",
            "上一版 raw：",
            lastRaw
          ].join("\n")
        }
      ];
    }
  }
  throw new Error(`d4_screenplay_parse_failure: ${segmentPoint}: ${lastError}`);
}

function futureSegmentGroups(segments, segmentIndex) {
  return new Set(segments.slice(segmentIndex + 1).flat());
}

function expandCardSegmentsToSingletons(segments) {
  const seen = new Set();
  const groups = [];
  for (const segment of segments) {
    for (const groupId of segment) {
      if (seen.has(groupId)) continue;
      seen.add(groupId);
      groups.push([groupId]);
    }
  }
  return groups;
}

function actionableCompatibilityViolations(validation, capGroupById, futureGroups) {
  if (!validation || !Array.isArray(validation.violations)) {
    throw new Error("validateSelections result must include violations array");
  }
  const violations = validation.violations;
  return violations.filter((item) => {
    if (["group_min", "total_min"].includes(item.type)) return false;
    const sourceCap = capFromViolationEndpoint(item.source);
    const targetCap = capFromViolationEndpoint(item.target);
    const sourceInFuture = sourceCap && futureGroups.has(capGroupById.get(sourceCap));
    const targetInFuture = targetCap && futureGroups.has(capGroupById.get(targetCap));
    if (item.type === "requires" && (sourceInFuture || targetInFuture)) return false;
    if (item.type === "excludes" && (sourceInFuture || targetInFuture)) return false;
    return true;
  });
}

function capFromViolationEndpoint(value) {
  return String(value || "").split("@")[0].trim();
}

function compatibilityFeedbackText(violations, capGroupById, currentGroups) {
  const current = new Set(currentGroups || []);
  return (violations || []).map((item) => {
    const sourceCap = capFromViolationEndpoint(item.source);
    const targetCap = capFromViolationEndpoint(item.target);
    const sourceInCurrent = current.has(capGroupById.get(sourceCap));
    const targetInCurrent = current.has(capGroupById.get(targetCap));
    if (item.type === "excludes") {
      if (sourceInCurrent && !targetInCurrent) return `${item.message}；${sourceCap} 属于当前段，界面会拒绝它，请换掉 ${sourceCap}`;
      if (targetInCurrent && !sourceInCurrent) return `${item.message}；${targetCap} 属于当前段，界面会拒绝它，请换掉 ${targetCap}`;
      return `${item.message}；二者不能同时保留，当前段必须删掉其中一张`;
    }
    if (item.type === "requires") {
      return `${item.message}；当前段若不能补足依赖，就必须换掉 ${sourceCap}`;
    }
    return item.message || `${item.type || "compat"} violation`;
  }).join("；");
}

function hardCompatibilityViolations(validation) {
  return (validation?.violations || []).filter((item) => !["group_min", "total_min"].includes(item.type));
}

function removeCurrentSegmentViolators(cards, violations, segmentSet, capGroupById) {
  const remove = new Set();
  for (const item of violations || []) {
    const sourceCap = capFromViolationEndpoint(item.source);
    const targetCap = capFromViolationEndpoint(item.target);
    if (sourceCap && segmentSet.has(capGroupById.get(sourceCap))) remove.add(sourceCap);
    if (targetCap && segmentSet.has(capGroupById.get(targetCap))) remove.add(targetCap);
  }
  if (!remove.size) return cards;
  return cards.filter((card) => !remove.has(card.cap_id));
}

function groupHasCard(cards, groupId, capGroupById) {
  return (cards || []).some((card) => capGroupById.get(card.cap_id) === groupId);
}

function findUiGuardReplacement({ cards, groupId, materials }) {
  const group = (materials.capabilityGroups.groups || []).find((item) => item.group_id === groupId);
  if (!group) return null;
  for (const cap of group.capabilities || []) {
    for (const tier of ["low", "mid", "high"]) {
      try {
        const candidate = [...cards, { cap_id: cap.cap_id, tier }];
        const validation = RD.validateSelections(candidate);
        if (hardCompatibilityViolations(validation).length === 0) {
          return { cap_id: cap.cap_id, tier };
        }
      } catch (_) {
        // Try the next real UI option.
      }
    }
  }
  return null;
}

function applyDeterministicUiCardGuard({ selectedCards, submittedCards, segmentSet, capGroupById, futureGroups, materials }) {
  let cards = replaceCardsForGroups(selectedCards, submittedCards, segmentSet, capGroupById);
  const guardLog = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const validation = RD.validateSelections(cards);
    const actionable = actionableCompatibilityViolations(validation, capGroupById, futureGroups);
    if (actionable.length === 0) {
      return { ok: true, cards, validation, guard_log: guardLog };
    }
    const before = JSON.stringify(cards);
    cards = removeCurrentSegmentViolators(cards, actionable, segmentSet, capGroupById);
    if (JSON.stringify(cards) !== before) {
      guardLog.push({
        action: "remove_current_segment_conflict_cards",
        violations: actionable.map((item) => item.message)
      });
    }
    for (const groupId of segmentSet) {
      if (groupHasCard(cards, groupId, capGroupById)) continue;
      const replacement = findUiGuardReplacement({ cards, groupId, materials });
      if (replacement) {
        cards.push(replacement);
        guardLog.push({
          action: "add_first_compatible_real_card",
          group_id: groupId,
          card: replacement
        });
      }
    }
    if (JSON.stringify(cards) === before) break;
  }
  const validation = RD.validateSelections(cards);
  return {
    ok: actionableCompatibilityViolations(validation, capGroupById, futureGroups).length === 0,
    cards,
    validation,
    guard_log: guardLog
  };
}

async function runR2Decision({ members, leaderIdx, draws, proposals, r1Frozen, config, materials, outputDir, seed, arm = "legacy" }) {
  const temperature = requireConfigNumber(config, "temperature");
  const useMatchedPrototype = arm !== "legacy";
  const prototypeChoice = useMatchedPrototype
    ? await chooseR1MatchedPrototype({ members, leaderIdx, draws, proposals, r1Frozen, config, materials, temperature, seed, arm })
    : await chooseLegacyPrototype({ members, leaderIdx, draws, proposals, r1Frozen, config, materials, temperature, seed, arm });
  const { chosenPrototype, prototypeSubmit, prototypeDiscussion } = prototypeChoice;
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

  const groupMap = groupsById(materials.capabilityGroups);
  const capGroupById = capGroupsById(materials.capabilityGroups);
  const selectionConstraints = readSelectionConstraints(materials.compatibilityRules);
  const selectionRules = selectionRulesText(selectionConstraints);
  const assignments = buildAssignmentsForMembers(members);
  const individualSelections = [];
  for (let i = 0; i < members.length; i += 1) {
    individualSelections.push(await individualCardSelection({
      member: members[i],
      isLeader: i === leaderIdx,
      draw: draws[i],
      proposal: proposals[i],
      assignment: assignments[i],
      r1Frozen,
      chosenPrototype,
      materials,
      temperature,
      arm,
      outputDir
    }));
  }
  const teamMerged = mergeSelectionsWithSelectedBy(individualSelections);
  let selectedCards = teamMerged.selections.map((card) => ({ cap_id: card.cap_id, tier: card.tier }));
  const mergedCompatibility = RD.validateSelections(selectedCards);
	  const d4ConflictBoard = hasD4HumanPickArm(arm)
	    ? buildD4ConflictBoard({ individualSelections, assignments, materials })
	    : null;
	  const d4StateEvents = [];
	  if (hasD4StatefulPickArm(arm)) {
	    const d4StateSeed = seedD4CardState({ members, leaderIdx, assignments, individualSelections, d4ConflictBoard, materials, seed });
	    d4StateEvents.push({
	      decision_point: "d4_state_seed",
	      updates: d4StateSeed,
	      state_after: snapshotD4CardState(members, leaderIdx)
	    });
	  }
	  checkpoints.push({
	    decision_point: "individual_cards",
	    assignments,
	    member_submissions: individualSelections.map((item) => ({
      member_id: item.member_id,
      groups: item.groups,
      cards: item.parsed.cards,
      rationale: item.parsed.rationale,
      ignored_groups: item.parsed.ignored_groups || [],
	      doubts: item.parsed.doubts || [],
	      attempts: item.attempts,
	      parse_method: item.parse_method,
	      story_trace: item.story_trace || null
	    }))
	  });
  checkpoints.push({
    decision_point: "team_merge",
    merged_cards: teamMerged.selections,
    validTotal: teamMerged.validTotal,
    mergeViolations: teamMerged.violations,
    compatibility: mergedCompatibility,
    d4_conflict_board: d4ConflictBoard
  });
  r2Transcript.push({
    decision_point: "individual_cards",
    transcript: [{
      speaker: "moderator",
      text: [
        "所有成员已完成个人选卡，系统进入团队合并。",
        buildR2ContextPanel(r1Frozen, chosenPrototype),
        "",
        "【个人选卡汇总】",
        formatMemberSelectionSummary(individualSelections, groupMap)
      ].join("\n")
    }],
    turns: []
  });
  writeJson(path.join(outputDir, "r2_individual_cards.json"), {
    assignments,
    submissions: individualSelections,
    merged: teamMerged,
    compatibility: mergedCompatibility,
    d4_conflict_board: d4ConflictBoard
  });
	  if (d4ConflictBoard) {
	    writeJson(path.join(outputDir, "r2_d4_conflict_board.json"), {
	      board: d4ConflictBoard
	    });
	  }
	  if (hasD4StatefulPickArm(arm)) {
	    checkpoints.push({
	      decision_point: "d4_state_seed",
	      termination: "deterministic_state_machine",
	      turns: 0,
	      updates: d4StateEvents[0]?.updates || [],
	      state_after: d4StateEvents[0]?.state_after || []
	    });
	    writeJson(path.join(outputDir, "r2_d4_state.json"), {
	      events: d4StateEvents,
	      state: snapshotD4CardState(members, leaderIdx)
	    });
	  }
	  writeJson(path.join(outputDir, "r2_checkpoints.json"), { checkpoints });

  const segments = expandCardSegmentsToSingletons(requireConfigArray(config, "r2_card_segments"));
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const segmentPoint = segment.length === 1 ? `cards_${segment[0]}` : `cards_segment_${segmentIndex + 1}`;
    const segmentSet = new Set(segment);
    const futureGroups = futureSegmentGroups(segments, segmentIndex);
    const allowedCards = allowedCardsForGroups(materials.capabilityGroups, segment);
    const groupText = segment.map((groupId) => {
      const group = groupMap.get(groupId);
      if (!group) throw new Error(`unknown capability group in config: ${groupId}`);
      return formatGroup(group);
    }).join("\n\n");
    const transcript = [
      {
        speaker: "moderator",
        text: [
          buildR2ContextPanel(r1Frozen, chosenPrototype),
          "",
          `【团队合并草案】所有成员个人选卡已合并。当前团队草案：${cardsToText(selectedCards)}。`,
          `当前功能区合并草案：${cardsToText(cardsForGroups(selectedCards, segmentSet, capGroupById))}。`,
          "【当前功能区的个人意见】",
          formatMemberSelectionSummary(individualSelections, groupMap, segment) || "（无）",
          hasD4HumanPickArm(arm)
            ? [
                "",
                "【D4 冲突板】",
                formatD4ConflictBoardForPrompt(d4ConflictBoard, segment),
                "",
                "请先把合并草案当作待复核草稿，不要自动保留所有看起来有用的卡；本段至少要真实讨论保留、砍掉或降档中的一种取舍。",
                "如果某张卡只有一个人强推、多人没点、或 confidence 低，可以砍；如果是 must 且贴合痛点，也可以保留。"
              ].join("\n")
            : "",
          "",
          `当前只复核这些功能区：${formatGroupNames(segment, groupMap)}。${selectionRules}`,
          "可以保留个人合并草案，也可以基于讨论砍卡、补卡或调整档位；本段提交会替换该功能区的团队草案。",
          "",
          groupText
        ].join("\n")
      }
    ];
	    const existingSelectionHint = overTwelveSelectionHint(selectedCards);
	    if (existingSelectionHint) {
	      transcript.push({ speaker: "moderator", text: existingSelectionHint });
	    }
	    if (hasD4ScreenplayArm(arm)) {
	      let cardsSubmit = null;
	      let validation = null;
	      let segmentTranscript = [];
	      let segmentTurns = [];
	      let compatibilityFeedback = "";
	      let uiGuard = null;
	      let d4StateUpdate = null;
	      let termination = "screenplay_confirmed";
	      for (let repairRound = 0; repairRound <= 3; repairRound += 1) {
	        const d4Screenplay = await runD4ScreenplaySegment({
	          members,
	          leaderIdx,
	          r1Frozen,
	          chosenPrototype,
	          selectedCards,
	          individualSelections,
	          d4ConflictBoard,
	          materials,
	          segment,
	          segmentIndex,
	          segmentPoint,
	          selectionRules,
	          selectionConstraints,
	          compatibilityFeedback,
	          temperature,
	          seed: `${seed}:cards:${segmentIndex}:screenplay:${repairRound}`,
	          arm,
	          outputDir,
	          repairRound
	        });
	        cardsSubmit = d4Screenplay.cardsSubmit;
	        segmentTranscript = segmentTranscript.concat(d4Screenplay.transcript);
	        segmentTurns = segmentTurns.concat(d4Screenplay.turns);
	        const candidateCards = replaceCardsForGroups(selectedCards, cardsSubmit.parsed.cards, segmentSet, capGroupById);
	        validation = RD.validateSelections(candidateCards);
	        const actionable = actionableCompatibilityViolations(validation, capGroupById, futureGroups);
	        if (actionable.length === 0) {
	          selectedCards = candidateCards;
	          const acceptedSelectionHint = overTwelveSelectionHint(selectedCards);
	          if (acceptedSelectionHint) {
	            segmentTranscript = segmentTranscript.concat([{ speaker: "moderator", text: acceptedSelectionHint }]);
	          }
	          break;
	        }
	        if (repairRound >= 3) {
	          uiGuard = applyDeterministicUiCardGuard({
	            selectedCards,
	            submittedCards: cardsSubmit.parsed.cards,
	            segmentSet,
	            capGroupById,
	            futureGroups,
	            materials
	          });
	          if (uiGuard.ok) {
	            selectedCards = uiGuard.cards;
	            validation = uiGuard.validation;
	            termination = "screenplay_ui_guard";
	            break;
	          }
	          throw new Error(`compat_violation: ${actionable.map((item) => item.message).join("; ")}`);
	        }
	        compatibilityFeedback = compatibilityFeedbackText(actionable, capGroupById, segment);
	        segmentTranscript = segmentTranscript.concat([{
	          speaker: "screen",
	          text: `兼容性校验未通过：${compatibilityFeedback}。界面提示小组只重议当前功能段，不能改变已冻结的前序段。`
	        }]);
	      }
	      if (hasD4StatefulPickArm(arm)) {
	        d4StateUpdate = updateD4CardStateAfterSegment({ members, leaderIdx, segment, selectedCards, individualSelections, materials });
	        d4StateEvents.push({
	          decision_point: segmentPoint,
	          updates: d4StateUpdate,
	          state_after: snapshotD4CardState(members, leaderIdx)
	        });
	        writeJson(path.join(outputDir, "r2_d4_state.json"), {
	          events: d4StateEvents,
	          state: snapshotD4CardState(members, leaderIdx)
	        });
	      }
	      checkpoints.push({
	        decision_point: segmentPoint,
	        termination,
	        turns: segmentTurns.length,
	        frozen: {
	          cards: cardsForGroups(selectedCards, segmentSet, capGroupById),
	          rationale: cardsSubmit?.parsed?.rationale || "deterministically indexed from D4 screenplay UI actions"
	        },
	        cumulative_cards: selectedCards.slice(),
	        compatibility: validation,
	        ui_guard: uiGuard,
	        d4_state_update: d4StateUpdate,
	        submit_attempts: cardsSubmit?.attempts || 0,
	        submission_mode: "deterministic_d4_screenplay_ui_actions"
	      });
	      r2Transcript.push({ decision_point: segmentPoint, transcript: segmentTranscript, turns: segmentTurns });
	      writeJson(path.join(outputDir, "r2_checkpoints.json"), { checkpoints });
	      continue;
	    }
	    let discussion = await runDiscussion({
	      members,
	      leaderIdx,
	      draws,
      proposals,
      initialTranscript: transcript,
      topic: `R2 选卡段 ${segmentIndex + 1}: ${segment.join(", ")}`,
      maxTurns: requireConfigNumber(config, "max_turns_r2_per_segment"),
      config,
      temperature,
      seed: `${seed}:cards:${segmentIndex}`,
      arm
    });
    let cardsSubmit = null;
    let validation = null;
    let segmentTranscript = discussion.transcript;
	    let segmentTurns = discussion.turns.slice();
	    let compatibilityFeedback = "";
	    let uiGuard = null;
	    let d4StateUpdate = null;
	    for (let repairRound = 0; repairRound <= 3; repairRound += 1) {
      cardsSubmit = await leaderSubmit({
        members,
        leaderIdx,
        transcript: segmentTranscript,
        topic: `提交当前功能段最终选卡：${segment.join(", ")}；本次提交会替换该功能段草案；${selectionRules}`,
        decisionType: "cards",
        context: {
          allowedGroups: segment,
          allowedCards,
          capabilityGroups: materials.capabilityGroups,
          selectionConstraints,
          compatibilityFeedback,
          submitParseRetries: requireConfigNumber(config, "submit_parse_retries")
        },
        temperature,
        arm
      });
      const candidateCards = replaceCardsForGroups(selectedCards, cardsSubmit.parsed.cards, segmentSet, capGroupById);
      validation = RD.validateSelections(candidateCards);
      const actionable = actionableCompatibilityViolations(validation, capGroupById, futureGroups);
      if (actionable.length === 0) {
        selectedCards = candidateCards;
        const acceptedSelectionHint = overTwelveSelectionHint(selectedCards);
        if (acceptedSelectionHint) {
          segmentTranscript = segmentTranscript.concat([{ speaker: "moderator", text: acceptedSelectionHint }]);
        }
        break;
      }
      if (repairRound >= 3) {
        uiGuard = applyDeterministicUiCardGuard({
          selectedCards,
          submittedCards: cardsSubmit.parsed.cards,
          segmentSet,
          capGroupById,
          futureGroups,
          materials
        });
        if (uiGuard.ok) {
          selectedCards = uiGuard.cards;
          validation = uiGuard.validation;
          break;
        }
        throw new Error(`compat_violation: ${actionable.map((item) => item.message).join("; ")}`);
      }
      compatibilityFeedback = compatibilityFeedbackText(actionable, capGroupById, segment);
      segmentTranscript = segmentTranscript.concat([{
        speaker: "moderator",
        text: `兼容性校验未通过：${compatibilityFeedback}。请只重议当前功能段，修正卡或档位，不能改变已冻结的前序段。`
      }]);
      const rediscussion = await runDiscussion({
        members,
        leaderIdx,
        draws,
        proposals,
        initialTranscript: segmentTranscript,
        topic: `R2 选卡段 ${segmentIndex + 1} 兼容性重议: ${segment.join(", ")}`,
        maxTurns: 3,
        config,
        temperature,
        seed: `${seed}:cards:${segmentIndex}:repair:${repairRound}`,
        arm
      });
	      segmentTranscript = rediscussion.transcript;
	      segmentTurns = segmentTurns.concat(rediscussion.turns);
	    }
	    if (hasD4StatefulPickArm(arm)) {
	      d4StateUpdate = updateD4CardStateAfterSegment({ members, leaderIdx, segment, selectedCards, individualSelections, materials });
	      d4StateEvents.push({
	        decision_point: segmentPoint,
	        updates: d4StateUpdate,
	        state_after: snapshotD4CardState(members, leaderIdx)
	      });
	      writeJson(path.join(outputDir, "r2_d4_state.json"), {
	        events: d4StateEvents,
	        state: snapshotD4CardState(members, leaderIdx)
	      });
	    }
	    checkpoints.push({
	      decision_point: segmentPoint,
	      termination: discussion.termination,
	      turns: segmentTurns.length,
	      frozen: cardsSubmit.parsed,
	      cumulative_cards: selectedCards.slice(),
	      compatibility: validation,
	      ui_guard: uiGuard,
	      d4_state_update: d4StateUpdate
	    });
    r2Transcript.push({ decision_point: segmentPoint, transcript: segmentTranscript, turns: segmentTurns });
    writeJson(path.join(outputDir, "r2_checkpoints.json"), { checkpoints });
  }

  const finalCardsValidation = RD.validateSelections(selectedCards);
  if (finalCardsValidation.hardViolationCount > 0) {
    throw new Error(`compat_violation: ${finalCardsValidation.violations.map((item) => item.message).join("; ")}`);
  }

  const priceConfig = getProductionPricingContext(r1Frozen, materials);
  let d5PrivateCardReviews = null;
  if (hasD5CardReviewState(arm)) {
    d5PrivateCardReviews = seedD5CardReviewState({
      members,
      leaderIdx,
      selectedCards,
      individualSelections,
      r1Frozen,
      priceConfig,
      seed
    });
    checkpoints.push({
      decision_point: "d5_private_card_review_state",
      termination: "private_state_machine",
      turns: 0,
      reviews: d5PrivateCardReviews
    });
    writeJson(path.join(outputDir, "d5_private_card_reviews.json"), {
      reviews: d5PrivateCardReviews
    });
    writeJson(path.join(outputDir, "r2_checkpoints.json"), { checkpoints });
  }
  let priceSubmit = null;
  if (hasD5NarratorActorArm(arm)) {
    const d5 = await runD5NarratorActorPricing({
      members,
      leaderIdx,
      draws,
      proposals,
      r1Frozen,
      chosenPrototype,
      selectedCards,
      priceConfig,
      temperature,
      seed,
      arm,
      outputDir
    });
    priceSubmit = d5.priceSubmit;
    checkpoints.push(...d5.checkpoints);
    r2Transcript.push(...d5.transcripts);
  } else if (hasD5ScreenplayArm(arm)) {
    const d5 = await runD5ScreenplayPricing({
      members,
      leaderIdx,
      draws,
      proposals,
      r1Frozen,
      chosenPrototype,
      selectedCards,
      priceConfig,
      temperature,
      seed,
      arm,
      outputDir
    });
    priceSubmit = d5.priceSubmit;
    checkpoints.push(...d5.checkpoints);
    r2Transcript.push(...d5.transcripts);
  } else if (isStatefulRoomRoleplayArm(arm)) {
    const d5 = await runStatefulDirectPriceD5({
      members,
      leaderIdx,
      draws,
      proposals,
      r1Frozen,
      chosenPrototype,
      selectedCards,
      priceConfig,
      config,
      temperature,
      seed,
      arm
    });
    priceSubmit = d5.priceSubmit;
    checkpoints.push(...d5.checkpoints);
    r2Transcript.push(...d5.transcripts);
  } else if (isRoomRoleplayArm(arm)) {
    const d5 = await runPricingActionPersonaD5({
      members,
      leaderIdx,
      draws,
      proposals,
      r1Frozen,
      chosenPrototype,
      selectedCards,
      priceConfig,
      config,
      temperature,
      seed,
      arm
    });
    priceSubmit = d5.priceSubmit;
    checkpoints.push(...d5.checkpoints);
    r2Transcript.push(...d5.transcripts);
  } else {
    const priceTranscript = [
      {
        speaker: "moderator",
        text: [
          buildR2PricingContextPanel(r1Frozen, chosenPrototype),
          "",
          buildR2PricingInterfacePanel(r1Frozen, selectedCards, priceConfig, { roomRoleplay: false }),
          "",
          "请像真实小组在这个界面前一样讨论最终售价：可以有人担心贵、销量下滑、渠道抽成或卖一台亏钱，但最后要收敛到一个可提交价格。"
        ].join("\n")
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
      seed: `${seed}:price`,
      arm
    });
    priceSubmit = await leaderSubmit({
      members,
      leaderIdx,
      transcript: priceDiscussion.transcript,
      topic: "提交最终定价",
      decisionType: "price",
      context: {
        priceMin: Number(priceConfig.price_min),
        priceMax: Number(priceConfig.price_max),
        priceStep: Number(priceConfig.price_step),
        submitParseRetries: requireConfigNumber(config, "submit_parse_retries")
      },
      temperature,
      arm
    });
    checkpoints.push({
      decision_point: "price",
      termination: priceDiscussion.termination,
      turns: priceDiscussion.turns.length,
      frozen: priceSubmit.parsed
    });
    r2Transcript.push({ decision_point: "price", transcript: priceDiscussion.transcript, turns: priceDiscussion.turns });
  }
  writeJson(path.join(outputDir, "r2_checkpoints.json"), { checkpoints });
  writeJson(path.join(outputDir, "r2_transcript.json"), { transcript: r2Transcript });

  const signals = prototypeSignals(chosenPrototype, r1Frozen);
  const calcGridId = toProductionCalcGridId(r1Frozen.grid_id, r1Frozen.architecture);
  const round2Wtp = RD.computeWTPParams(calcGridId, {
    round1GridId: r1Frozen.grid_id,
    round1Context: { gridId: r1Frozen.grid_id }
  });
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
    Pmax: Math.round(Number(round2Wtp.WTPref || r1Frozen.WTPref_scaled || r1Frozen.WTPadj_scaled || 0)),
    WTPref_override: Number(r1Frozen.WTPref_scaled),
    WTP: Math.round(Number(round2Wtp.WTPmedian || round2Wtp.WTPref || r1Frozen.WTPref_scaled || r1Frozen.WTPadj_scaled || 0)),
    e: 1.2,
    COGSbase: Number(RD.GLOBAL_PARAMS.V),
    wtp_multiplier: Number(r1Frozen.wtp_multiplier),
    source: "production-parity: server/routes/round2Routes.js::buildComputedTeamSnapshot"
  };
  const r2Settlement = await RD.calculate(rdInput);
  return {
    prototype: prototypeSubmit.parsed,
    assignments,
    individual_cards: individualSelections,
	    team_merged_cards: teamMerged,
	    d4_conflict_board: d4ConflictBoard,
	    d4_state_events: d4StateEvents,
	    cards: selectedCards,
	    price: priceSubmit.parsed.price,
	    d5_private_card_reviews: d5PrivateCardReviews,
	    signals,
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
    compatibilityRules: readJson(path.join(DATA_DIR, "compatibility_rules_v2.json")),
    archetypes: readJson(path.join(CONFIG_DIR, "persona_archetypes_v1.json")),
    personaBriefs: readJson(path.join(CONFIG_DIR, "persona_briefs_v1.json")),
    personaReports: readJson(path.join(CONFIG_DIR, "persona_reports_v1.3.json")),
    gridEvidence: readJson(path.join(CONFIG_DIR, "grid_dimension_evidence_v2.json"))
  };
}

function resolveRootPath(inputPath) {
  if (!inputPath) return null;
  return path.isAbsolute(inputPath) ? inputPath : path.join(ROOT, inputPath);
}

function summarizeReplayIndividualCards(items) {
  return (items || []).map((item) => ({
    member_id: item.member_id,
    groups: item.groups,
    cards: item.parsed.cards,
    rationale: item.parsed.rationale
  }));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildSampledTeamFromSource({ sourceMeta, config, outputDir, poolPath }) {
  const seed = sourceMeta.seed;
  if (seed === undefined || seed === null || String(seed).trim() === "") {
    throw new Error("source run_meta.json missing seed; cannot reconstruct members/draws for R2 replay");
  }
  const profilePool = poolPath ? loadRandom42ProfilePool(poolPath) : buildProfilePool(seed, outputDir);
  const sampled = sampleTeam(profilePool, seed, config);
  const expectedProfiles = Array.isArray(sourceMeta.profile_ids) ? sourceMeta.profile_ids : [];
  const actualProfiles = sampled.members.map((member) => member.profile_id);
  if (expectedProfiles.length && JSON.stringify(expectedProfiles) !== JSON.stringify(actualProfiles)) {
    throw new Error(`reconstructed profile_ids differ from source: expected=${expectedProfiles.join(",")} actual=${actualProfiles.join(",")}`);
  }
  const expectedLeader = String(sourceMeta.leader_id || "");
  const actualLeader = sampled.members[sampled.leaderIdx]?.profile_id || "";
  if (expectedLeader && expectedLeader !== actualLeader) {
    throw new Error(`reconstructed leader differs from source: expected=${expectedLeader} actual=${actualLeader}`);
  }
  return sampled;
}

async function runR2FromExistingR1({ sourceDir, batch, arm = null, poolPath = null, outputRoot = OUTPUT_ROOT, configOverrides = {}, useCurrentConfig = false }) {
  const resolvedSourceDir = resolveRootPath(sourceDir);
  if (!resolvedSourceDir || !fs.existsSync(resolvedSourceDir)) {
    throw new Error(`missing sourceDir: ${sourceDir}`);
  }
  const materials = loadMaterials();
  const sourceMeta = readJson(path.join(resolvedSourceDir, "run_meta.json"));
  const sourceTranscript = readJson(path.join(resolvedSourceDir, "r1_transcript.json"));
  const r1Frozen = readJson(path.join(resolvedSourceDir, "r1_frozen.json"));
  const sourceSettlementPath = path.join(resolvedSourceDir, "settlement.json");
  const sourceSettlement = fs.existsSync(sourceSettlementPath) ? readJson(sourceSettlementPath) : {};
  const sourceR1ActorStatePath = path.join(resolvedSourceDir, "r1_actor_isolated_state.json");
  const sourceR1ActorState = fs.existsSync(sourceR1ActorStatePath) ? readJson(sourceR1ActorStatePath) : null;
  if (hasR1ActorIsolatedArm(sourceMeta.arm) && !sourceR1ActorState) {
    throw new Error(`source R1 actor state missing: ${sourceR1ActorStatePath}`);
  }
  const effectiveArm = arm || sourceMeta.arm || "legacy";
  if (!TEAM_ARMS.has(effectiveArm)) throw new Error(`unknown team arm: ${effectiveArm}`);
  const sourceConfig = sourceMeta.config_snapshot && typeof sourceMeta.config_snapshot === "object" && !useCurrentConfig
    ? sourceMeta.config_snapshot
    : {};
  const config = { ...materials.config, ...sourceConfig, ...configOverrides };
  const sourcePoolPath = poolPath || (sourceMeta.profile_pool_source && !String(sourceMeta.profile_pool_source).includes("scripts/sim/persona_pool.js")
    ? resolveRootPath(sourceMeta.profile_pool_source)
    : null);
  if (sourcePoolPath && !fs.existsSync(sourcePoolPath)) {
    throw new Error(`missing source profile pool: ${sourcePoolPath}`);
  }
  const replayBatch = batch || `r2_replay_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/u, "Z")}`;
  const sourceTeamId = sourceMeta.team_id || path.basename(resolvedSourceDir);
  const outputDir = path.join(outputRoot, replayBatch, `${sourceTeamId}__r2_replay`);
  fs.mkdirSync(outputDir, { recursive: true });
  const sampled = buildSampledTeamFromSource({
    sourceMeta,
    config,
    outputDir,
    poolPath: sourcePoolPath
  });
  const replayStateRestore = restoreReplayBehavioralState({
    members: sampled.members,
    leaderIdx: sampled.leaderIdx,
    sourceMeta,
    r1ActorState: sourceR1ActorState
  });
  if (sourceR1ActorState) {
    writeJson(path.join(outputDir, "r1_actor_isolated_state.json"), {
      ...sourceR1ActorState,
      replay_from: path.relative(ROOT, sourceR1ActorStatePath)
    });
    writeJson(path.join(outputDir, "r1_actor_carryover.json"), {
      replay_from: path.relative(ROOT, resolvedSourceDir),
      source_file: path.relative(ROOT, sourceR1ActorStatePath),
      restore: replayStateRestore,
      final_submission: sourceR1ActorState.parsed_submission || null
    });
  }
  const draws = drawJinangForMembers(sampled.members, sourceMeta.seed, materials.jinang);
  const proposals = Array.isArray(sourceTranscript.proposals) ? sourceTranscript.proposals : [];
  if (proposals.length !== sampled.members.length) {
    throw new Error(`source r1_transcript proposals count ${proposals.length} does not match team size ${sampled.members.length}`);
  }
  for (const proposal of proposals) {
    if (!proposal?.parsed?.grid_id || !proposal?.parsed?.architecture) {
      throw new Error("source r1_transcript proposal missing parsed grid_id/architecture");
    }
  }

  writeJson(path.join(outputDir, "run_meta.json"), {
    ...sourceMeta,
    batch: replayBatch,
    arm: effectiveArm,
	    team_id: `${sourceTeamId}__r2_replay`,
	    replay_from: path.relative(ROOT, resolvedSourceDir),
	    replay_scope: "R2 only; R1 frozen strategy, member proposals, sampled members, leader, jinang draws, behavioral_state_initial, and R1 actor private carryover are restored from source",
	    profile_pool_source: sourcePoolPath ? path.relative(ROOT, sourcePoolPath) : sourceMeta.profile_pool_source,
	    config_snapshot: config,
	    source_config_snapshot_used: !useCurrentConfig,
    r1_actor_state_carryover: {
      restored: Boolean(sourceR1ActorState),
      source_file: sourceR1ActorState ? path.relative(ROOT, sourceR1ActorStatePath) : null,
      ...replayStateRestore
    },
    behavioral_state_replay_runtime_initial: snapshotBehavioralStateForRunMeta(sampled.members, sampled.leaderIdx),
	    implementation_notes: [
	      ...ensureArray(sourceMeta.implementation_notes),
	      "This run reuses existing r1_frozen.json and r1_transcript.json; no Round 1 LLM calls are made.",
      sourceR1ActorState
        ? "R1 actor private state is copied into replay output and injected into R2 member prompts as per-member carryover."
        : "No R1 actor private state file was present in the source; R2 restored behavioral_state_initial only."
	    ]
	  });
  writeJson(path.join(outputDir, "r1_frozen.json"), r1Frozen);
  writeJson(path.join(outputDir, "r1_transcript.json"), {
    ...sourceTranscript,
    replay_from: path.relative(ROOT, resolvedSourceDir)
  });

  const r2 = await runR2Decision({
    members: sampled.members,
    leaderIdx: sampled.leaderIdx,
    draws,
    proposals,
    r1Frozen,
    config,
    materials,
    outputDir,
    seed: sourceMeta.seed,
    arm: effectiveArm
  });
  writeJson(path.join(outputDir, "settlement.json"), {
    r1: sourceSettlement.r1 || null,
    r1_frozen: r1Frozen,
    r2: r2.settlement,
	    r2_price: r2.price,
	    r2_cards: r2.cards,
		    d5_private_card_reviews: r2.d5_private_card_reviews || null,
		    d4_conflict_board: r2.d4_conflict_board || null,
		    d4_state_events: r2.d4_state_events || null,
		    r2_assignments: r2.assignments,
    r2_individual_cards: summarizeReplayIndividualCards(r2.individual_cards),
    r2_team_merged_cards: r2.team_merged_cards,
    r2_prototype: r2.prototype,
    r2_signal: r2.signals,
    r2_rd_input: r2.rd_input,
    profit: r2.settlement.profit,
    profitable: Number(r2.settlement.profit) >= 0,
    replay_from: path.relative(ROOT, resolvedSourceDir)
  });
  return {
    synthetic: true,
    replay: true,
    arm: effectiveArm,
    source_dir: resolvedSourceDir,
    team_id: `${sourceTeamId}__r2_replay`,
    output_dir: outputDir,
    leader_id: sampled.members[sampled.leaderIdx].profile_id,
    profile_ids: sampled.members.map((member) => member.profile_id),
    r1: r1Frozen,
    r2_profit: r2.settlement.profit,
    r2_price: r2.price,
    r2_card_count: r2.cards.length
  };
}

async function runTeam({ seed, batch, arm = "legacy", publicArm = null, poolPath = null, outputRoot = OUTPUT_ROOT, configOverrides = {}, r1Only = false, presetMeta = null }) {
  if (!TEAM_ARMS.has(arm)) throw new Error(`unknown team arm: ${arm}`);
  const materials = loadMaterials();
  const config = { ...materials.config, ...configOverrides };
  const visibleArm = publicArm || arm;
  const teamId = arm === "legacy" ? `SYN-${batch}-${seed}` : `SYN-${batch}-${arm}-${seed}`;
  const outputDir = path.join(outputRoot, batch, teamId);
  fs.mkdirSync(outputDir, { recursive: true });
  const profilePool = poolPath ? loadRandom42ProfilePool(poolPath) : buildProfilePool(seed, outputDir);
  const sampled = sampleTeam(profilePool, seed, config);
  if (isStatefulRoomRoleplayArm(arm)) {
    sampled.members.forEach((member, index) => {
      member.behavioral_state = initBehavioralState(member, index === sampled.leaderIdx);
    });
  }
  const draws = drawJinangForMembers(sampled.members, seed, materials.jinang);
  const leader = sampled.members[sampled.leaderIdx];
  const dimensionMap = materials.capabilityGroups.groups.map((group) => ({ group_id: group.group_id, name: group.name }));
  const meta = {
    batch,
    arm,
    public_arm: visibleArm,
    runtime_arm: visibleArm === arm ? null : arm,
    team_id: teamId,
    seed,
    preset: presetMeta
      ? {
          name: presetMeta.name,
          lifecycle: presetMeta.lifecycle,
          forked_from: presetMeta.forked_from,
          description: presetMeta.description,
          evidence: presetMeta.evidence,
          runtime_arm_aliases: presetMeta.runtime_arm_aliases
        }
      : null,
    code_git: repoGitState(),
    profile_pool_source: poolPath ? path.relative(ROOT, poolPath) : "scripts/sim/persona_pool.js via buildProfilePool",
    profile_ids: sampled.members.map((member) => member.profile_id),
    leader_id: leader.profile_id,
    r1_only: Boolean(r1Only),
    behavioral_state_initial: isStatefulRoomRoleplayArm(arm)
      ? sampled.members.map((member, index) => ({
          member_id: member.profile_id,
          is_leader: index === sampled.leaderIdx,
          state: member.behavioral_state
        }))
      : null,
    seed_reproducibility_note: "seed 仅保证 profile 抽样、组长指定、发言调度可复现；LLM 决策输出不保证跨次复现。",
    model_config: materials.llmModels,
    model_override: String(process.env.LLM_MODEL_OVERRIDE ?? ""),
    jinang_draw_mode: forcedJinangStrategy()
      ? `diagnostic_forced_${forcedJinangStrategy()}_strategy_cards_with_replacement_when_needed`
      : "seeded_random_without_replacement",
    jinang_prompt_visibility: hideJinangFromSyntheticPrompts()
      ? "hidden_from_synthetic_prompts"
      : "visible_in_synthetic_prompts",
    r1_strategy_mode: r1NaturalStrategyChatAskMode()
      ? "natural_language_then_screenplay_chat_ask_explicit_ab"
      : (r1NaturalStrategyPosthocMode()
          ? "natural_language_then_deterministic_posthoc_index"
          : "explicit_diff_cost_grid_button"),
    arm_definition: armDefinitionNote(arm),
    layered_nomap_generation: isLayeredNoMapArm(arm)
      ? {
          seed: LAYERED_NOMAP_GENERATION_SEED,
          l0_l1_source: "deterministic builder in server/synthetic/teamSim/orchestrator.js",
          map_policy: "no cognitive map injected",
          classroom_profile_fields: [
            "abstraction_ability",
            "writing_precision",
            "coach_receptiveness",
            "effort_style",
            "team_role",
            "why_here",
            "knowledge_ceiling",
            "response_to_AI_coach"
          ]
        }
      : null,
    config_snapshot: config,
    r1_actor_event_cap: hasR1ActorIsolatedArm(arm)
      ? (Number.isFinite(Number(config.max_r1_actor_events))
          ? Math.max(1, Math.floor(Number(config.max_r1_actor_events)))
          : Math.max(24, Math.floor(requireConfigNumber(config, "max_turns_r1_discussion") * 2)))
      : null,
    selection_constraints: readSelectionConstraints(materials.compatibilityRules),
    selection_total_max_source: "配置无 total_max 或等价字段；真实前端无显式选卡总数硬上限，仅显示超过 12 张的研发投入提示。",
    dimension_key_mapping: dimensionMap,
    implementation_notes: [
      poolPath
        ? "profile_pool is loaded from frozen random42 persona_pool_v2.json; simple/layered arms share sampled members, leader, and jinang draws for a given seed."
        : "profile_pool is built deterministically from scripts/sim/persona_pool.js manager archetypes, with synthetic speaking_tendency attached; no production route or DB is used.",
      armDefinitionNote(arm),
      hasR1ScreenplayArm(arm)
        ? "R1 discussion is generated as a single screenplay scene without iterative shared-transcript prompting; existing vpWordScorer is still used for VP scoring after deterministic final_submission validation."
        : "R1 discussion uses the shared transcript protocol and existing vpWordScorer for VP scoring; vpCoach is not used as a live moderator API because its exported chat loop is session/UI-shaped.",
      r1Only
        ? ""
        : "R2 mirrors the multiplayer UI order: dimension assignment -> member individual card selection -> team merge -> team review/discussion -> pricing. Individual submissions are written to r2_individual_cards.json.",
      r1Only
        ? "This run stops after Round 1 settlement; no R2 LLM calls or profit calculation are made."
        : "",
		      isStatefulRoomRoleplayArm(arm) && !hasR1ScreenplayArm(arm)
		        ? "team_room_roleplay_stateful_v1 uses transcript-first prompts with per-member behavioral_state lines: attention_focus, confidence, confusion, fatigue, social_commitment, price_sensitivity, and triggered memories are updated after each utterance."
		        : "",
		      !r1Only && hasD5CardReviewState(arm)
		        ? "team_room_roleplay_stateful_review_v1 adds a private deterministic D5 card-review state before pricing: each member gets value_feel, cost_feel, retained-own-card stake, and pricing_impulse from selected cards/persona state; this state is logged but not inserted as a public transcript or individual price quote."
		        : "",
				      !r1Only && hasD4StatefulPickArm(arm)
				        ? "team_room_d4_stateful_pick_v1 extends D4 human-pick with deterministic per-member D4 state updates after every function segment; D5 card-review reads that state."
				        : "",
					      !r1Only && hasD4StoryPickArm(arm)
					        ? "team_room_story_d4_v1 changes D4 individual selection: each member first generates a private micro-scene/action_trace of noticing, misreading, skipping, hesitating, and selecting cards; only action=select entries become the personal card submission."
					        : "",
				      hasR1PrivateTraceArm(arm)
				        ? "team_room_r1_private_trace_v1 changes R1 individual proposal logging only: each member's independent R1 JSON includes a private interface-reading trace plus the formal R1 submission in the same call; R2 mechanics remain aligned with team_room_story_d4d5_narrator_d5_v1."
				        : "",
					      hasR1StoryProcessArm(arm)
					        ? "team_room_r1_story_process_v1 changes R1 individual proposal only: each member writes a persona-native natural-language interface/process scene with no JSON visible to the decision agent; a posthoc parser extracts the legal R1 submission. R2 mechanics remain aligned with team_room_story_d4d5_narrator_d5_v1."
					        : "",
						      hasR1ScreenplayArm(arm)
						        ? "team_room_r1_screenplay_v1 changes R1 end-to-end: each member first makes a persona-native natural choice from the Round 1 personal UI only, then the team discussion is generated as one classroom screenplay using the public group distribution, final-choice, and VP-writing UI surfaces; final_submission is deterministically validated as the R1 submit action."
						        : "",
						      hasR1ReadingStoryArm(arm)
						        ? "team_room_r1_reading_story_v1 changes R1 individual proposal only: each member first writes a persona-native price-free reading memory from a sanitized student-material summary; deterministic sanitization removes any generated price/amount/financial hint before the R1 interface story; a posthoc parser extracts the legal R1 submission. R2 mechanics remain aligned with team_room_story_d4d5_narrator_d5_v1."
						        : "",
						      !r1Only && hasD5ScreenplayArm(arm)
						        ? "team_room_story_d4d5_v1 changes D4 and D5: D4 six function reviews are screenplay prompts with UI card actions, final cards are deterministically indexed from select/unselect/change_tier actions, and D5 price is deterministically indexed from the last legal confirm_price/drag_slider action."
						        : "",
					      !r1Only && hasD5NarratorActorArm(arm)
					        ? hasR1NarratorActorArm(arm)
					          ? "team_room_story_r1_d4d5_narrator_v1 adds R1 narrator-private-state actor turns before leader submit; D4 stays screenplay-indexed; D5 first generates public room narration plus private protagonist state for each member, then calls each member as an actor who only sees their own state; final price is deterministically indexed from legal confirm_price/drag_slider actions."
					          : "team_room_story_d4d5_narrator_d5_v1 keeps D4 screenplay-indexed; D5 first generates public room narration plus private protagonist state for each member, then calls each member as an actor who only sees their own state; final price is deterministically indexed from legal confirm_price/drag_slider actions."
					        : "",
				    !r1Only && usesD5TranscriptPriceParser(arm)
				        ? "team_room_d4_stateful_d5_nosubmit_v1 changes D5: D4 state enters pricing as private natural-language residue, and final price is parsed deterministically from the shared D5 transcript instead of using an LLM leader submitter."
				        : "",
				      !r1Only && hasD4HumanPickArm(arm) && !hasD4StatefulPickArm(arm)
				        ? "team_room_d4_human_pick_v1 changes D4 only: individual card picks carry private stance/confidence metadata and team review receives a deterministic conflict board by function dimension, so the union merge is treated as a draft rather than a default answer."
				        : "",
		      !r1Only && isStatefulRoomRoleplayArm(arm)
		        ? "D5 pricing is direct slider discussion only; pricing_action and pricing_tier are deterministic posthoc indexes from the final transcript/price and are not shown to decision agents."
        : "",
      !r1Only && isRoomRoleplayArm(arm) && !isStatefulRoomRoleplayArm(arm)
        ? "team_room_roleplay_ui uses transcript-first prompts: members speak as if seated in a classroom discussion room, and final structured fields are extracted from explicit submit actions after the fact. D5 is split into pricing-action-persona group stages: pricing action -> relative tier -> final price."
        : "",
      !r1Only && isStatefulRoomRoleplayArm(arm)
        ? "R2 card discussions include frozen R1 positioning plus customer research/pain reminders; D5 direct pricing uses a lighter UI-visible pricing panel: frozen market/VP, selected cards, base cost, dCOGS, NRE, and slider bounds, without injecting current GM gate or breakeven arithmetic into the discussion prompt."
        : "",
      !r1Only && isRoomRoleplayArm(arm) && !isStatefulRoomRoleplayArm(arm)
        ? "R2 card discussions include frozen R1 positioning plus customer research/pain reminders; D5 pricing-action-persona uses a lighter UI-visible pricing panel: frozen market/VP, selected cards, base cost, dCOGS, NRE, and slider bounds, without injecting current GM gate or breakeven arithmetic into the discussion prompt."
        : "",
      !r1Only && !isRoomRoleplayArm(arm)
        ? "R2 card discussions include frozen R1 positioning plus customer research/pain reminders; R2 pricing discussion uses the production UI pricing surface: current GM gate, selected card cost, NRE, fixed cost, channel fee, Round 1 SAM/WTPadj, VP WTP effect, price/volume tradeoff, slider bounds/endpoint labels, breakeven quantity, and unit margin."
        : "",
      r1Only
        ? ""
        : arm === "legacy"
        ? "R2 customer summaries use frozen game_config_v0.1/persona_archetypes_v1.json elder_care/adult_companion narrative seeds."
        : "R2 customer persona is deterministically matched to the frozen R1 grid using persona_briefs_v1.json, persona_reports_v1.3.json, and grid_dimension_evidence_v2.json; cross-market prototype switching is disabled."
    ].filter(Boolean),
    file_sha256: {
      team_sim_config: sha256(fs.readFileSync(path.join(CONFIG_DIR, "team_sim_config.json"), "utf8")),
      capability_groups_v2: sha256(fs.readFileSync(path.join(DATA_DIR, "capability_groups_v2.json"), "utf8")),
      compatibility_rules_v2: sha256(fs.readFileSync(path.join(DATA_DIR, "compatibility_rules_v2.json"), "utf8")),
      llm_models: sha256(fs.readFileSync(path.join(CONFIG_DIR, "llm_models.json"), "utf8")),
      persona_archetypes_v1: sha256(fs.readFileSync(path.join(CONFIG_DIR, "persona_archetypes_v1.json"), "utf8")),
      persona_briefs_v1: sha256(fs.readFileSync(path.join(CONFIG_DIR, "persona_briefs_v1.json"), "utf8")),
      persona_reports_v1_3: sha256(fs.readFileSync(path.join(CONFIG_DIR, "persona_reports_v1.3.json"), "utf8")),
      grid_dimension_evidence_v2: sha256(fs.readFileSync(path.join(CONFIG_DIR, "grid_dimension_evidence_v2.json"), "utf8"))
    }
  };
  writeJson(path.join(outputDir, "run_meta.json"), meta);

  const temperature = requireConfigNumber(config, "temperature");
  const proposals = [];
  for (let i = 0; i < sampled.members.length; i += 1) {
    proposals.push(await independentProposal(sampled.members[i], draws[i], i === sampled.leaderIdx, temperature, arm));
  }
  const r1Initial = [{
    speaker: "moderator",
    text: isRoomRoleplayArm(arm)
      ? [
          "你们已经坐在课堂讨论室里，屏幕上是 Round 1 市场选择界面。每个人刚刚都填过自己的草稿，现在请像真实小组一样把想法说出来、互相追问，最后收敛成一个提交。",
          strategicDistribution(proposals)
        ].join("\n\n")
      : strategicDistribution(proposals)
  }];
  let r1Discussion;
  let r1Submit;
  if (hasR1ActorIsolatedArm(arm)) {
    const r1ActorEventCap = Number.isFinite(Number(config.max_r1_actor_events))
      ? Math.max(1, Math.floor(Number(config.max_r1_actor_events)))
      : Math.max(24, Math.floor(requireConfigNumber(config, "max_turns_r1_discussion") * 2));
    r1Discussion = await runR1ActorIsolatedDiscussion({
      members: sampled.members,
      leaderIdx: sampled.leaderIdx,
      draws,
      proposals,
      temperature,
      seed: `${seed}:r1`,
      arm,
      outputDir,
      maxEvents: r1ActorEventCap
    });
    r1Submit = r1Discussion.leader_submit;
  } else if (hasR1ScreenplayArm(arm)) {
    r1Discussion = await runR1ScreenplayDiscussion({
      members: sampled.members,
      leaderIdx: sampled.leaderIdx,
      draws,
      proposals,
      temperature,
      seed: `${seed}:r1`,
      arm,
      outputDir
    });
    r1Submit = r1Discussion.leader_submit;
  } else {
    r1Discussion = hasR1NarratorActorArm(arm)
      ? await runR1NarratorActorDiscussion({
        members: sampled.members,
        leaderIdx: sampled.leaderIdx,
        draws,
        proposals,
        initialTranscript: r1Initial,
        topic: "Round 1 市场定位、架构、VP 共识",
        maxTurns: requireConfigNumber(config, "max_turns_r1_discussion"),
        config,
        temperature,
        seed: `${seed}:r1`,
        arm,
        outputDir
      })
      : await runDiscussion({
        members: sampled.members,
        leaderIdx: sampled.leaderIdx,
        draws,
        proposals,
        initialTranscript: r1Initial,
        topic: "Round 1 市场定位、架构、VP 共识",
        maxTurns: requireConfigNumber(config, "max_turns_r1_discussion"),
        config,
        temperature,
        seed: `${seed}:r1`,
        arm
      });
    r1Submit = await leaderSubmit({
      members: sampled.members,
      leaderIdx: sampled.leaderIdx,
      transcript: r1Discussion.transcript,
      topic: "提交 Round 1 最终战略",
      decisionType: "r1",
      context: { submitParseRetries: requireConfigNumber(config, "submit_parse_retries") },
      temperature,
      arm
    });
  }
  const vpScores = await scoreVp(r1Submit.parsed);
  const grid = getGrid(r1Submit.parsed.grid_id);
  const jinangSettlement = settleTeamJinang(draws, grid, r1Submit.parsed.architecture);
  const r1Settlement = buildRound1Outcome(r1Submit.parsed, vpScores, jinangSettlement, materials.round1Model);
  const r1Frozen = {
	    grid_id: r1Submit.parsed.grid_id,
	    grid_label: grid.label,
		    target_market_id: r1Submit.parsed.target_market_id || null,
		    competitive_strategy_text: r1Submit.parsed.competitive_strategy_text || null,
		    competitive_strategy_choice: r1Submit.parsed.competitive_strategy_choice || null,
		    strategy_choice: r1Submit.parsed.strategy_choice || null,
		    strategy_choice_line: r1Submit.parsed.strategy_choice_line || null,
		    posthoc_strategy_index: r1Submit.parsed.posthoc_strategy_index || null,
	    architecture: r1Submit.parsed.architecture,
    vp_summary: r1Submit.parsed.vp_summary,
    target_gm: r1Settlement.target_gm,
    jinang_fit: jinangSettlement,
    SAM_billion: r1Settlement.SAM_billion,
    SAM_billion_scaled: scaleStoredMoney(r1Settlement.SAM_billion, { positiveOnly: true }),
    WTPadj: r1Settlement.WTPadj,
    WTPref_scaled: r1Settlement.WTPref_scaled,
    WTPadj_scaled: r1Settlement.WTPadj_scaled,
    jinang_wtp_bonus: r1Settlement.jinang_wtp_bonus,
    wtp_multiplier: r1Settlement.wtp_multiplier,
    VPscore: r1Settlement.VPscore,
    production_source: r1Settlement.production_source
  };
  writeJson(path.join(outputDir, "r1_transcript.json"), {
    proposals,
    transcript: r1Discussion.transcript,
    turns: r1Discussion.turns,
    termination: r1Discussion.termination,
    narration: r1Discussion.narration || null,
    leader_submit: r1Submit
  });
  if (hasR1PrivateTraceArm(arm)) {
    writeJson(path.join(outputDir, "r1_private_trace.json"), {
      traces: proposals.map((proposal, index) => ({
        member_id: sampled.members[index].profile_id,
        member_name: sampled.members[index].surface?.name || sampled.members[index].profile_id,
        archetype: sampled.members[index].label,
        is_leader: index === sampled.leaderIdx,
        attempts: proposal.attempts,
        private_trace: proposal.private_trace,
        r1_submission: proposal.parsed
      }))
    });
  }
	  if (hasR1StoryProcessArm(arm)) {
	    writeJson(path.join(outputDir, "r1_story_process.json"), {
	      stories: proposals.map((proposal, index) => ({
	        member_id: sampled.members[index].profile_id,
	        member_name: sampled.members[index].surface?.name || sampled.members[index].profile_id,
        archetype: sampled.members[index].label,
        is_leader: index === sampled.leaderIdx,
        attempts: proposal.attempts,
        raw_story: proposal.raw,
        posthoc_parse_raw: proposal.posthoc_parse_raw,
	        r1_submission: proposal.parsed
	      }))
	    });
	  }
		  if (hasR1ReadingStoryArm(arm)) {
		    writeJson(path.join(outputDir, "r1_reading_story_process.json"), {
		      stories: proposals.map((proposal, index) => ({
	        member_id: sampled.members[index].profile_id,
	        member_name: sampled.members[index].surface?.name || sampled.members[index].profile_id,
	        archetype: sampled.members[index].label,
	        is_leader: index === sampled.leaderIdx,
	        reading_memory_raw: proposal.reading_memory_raw,
	        reading_memory: proposal.reading_memory,
	        reading_memory_sanitized: proposal.reading_memory_sanitized,
	        attempts: proposal.attempts,
	        raw_story: proposal.raw,
	        posthoc_parse_raw: proposal.posthoc_parse_raw,
	        r1_submission: proposal.parsed
		      }))
		    });
		  }
		  if (hasR1ScreenplayArm(arm) || hasR1ActorIsolatedArm(arm)) {
		    writeJson(path.join(outputDir, "r1_ui_screen_process.json"), {
		      stories: proposals.map((proposal, index) => ({
		        member_id: sampled.members[index].profile_id,
		        member_name: sampled.members[index].surface?.name || sampled.members[index].profile_id,
		        archetype: sampled.members[index].label,
		        is_leader: index === sampled.leaderIdx,
		        attempts: proposal.attempts,
		        ui_mode: proposal.ui_mode,
		        raw_ui_story: proposal.raw,
		        posthoc_parse_raw: proposal.posthoc_parse_raw,
		        r1_submission: proposal.parsed
		      }))
		    });
		  }
		  writeJson(path.join(outputDir, "r1_frozen.json"), r1Frozen);

  if (r1Only) {
    writeJson(path.join(outputDir, "settlement.json"), {
      r1: r1Settlement,
      r1_frozen: r1Frozen,
      r1_only: true,
      r2: null,
      r2_price: null,
      r2_cards: null,
      profit: null,
      profitable: null
    });
	    return {
	      synthetic: true,
	      arm,
      public_arm: visibleArm,
	      team_id: teamId,
      output_dir: outputDir,
      leader_id: leader.profile_id,
      profile_ids: sampled.members.map((member) => member.profile_id),
      r1: r1Frozen,
      r1_only: true,
      r2_profit: null,
      r2_price: null,
      r2_card_count: null
    };
  }

  const r2 = await runR2Decision({
    members: sampled.members,
    leaderIdx: sampled.leaderIdx,
    draws,
    proposals,
    r1Frozen,
    config,
    materials,
    outputDir,
    seed,
    arm
  });
  writeJson(path.join(outputDir, "settlement.json"), {
    r1: r1Settlement,
    r1_frozen: r1Frozen,
	    r2: r2.settlement,
	    r2_price: r2.price,
	    r2_cards: r2.cards,
		    d5_private_card_reviews: r2.d5_private_card_reviews || null,
		    d4_conflict_board: r2.d4_conflict_board || null,
		    d4_state_events: r2.d4_state_events || null,
		    r2_assignments: r2.assignments,
    r2_individual_cards: r2.individual_cards.map((item) => ({
      member_id: item.member_id,
      groups: item.groups,
      cards: item.parsed.cards,
      rationale: item.parsed.rationale
    })),
    r2_team_merged_cards: r2.team_merged_cards,
    r2_prototype: r2.prototype,
    r2_signal: r2.signals,
    r2_rd_input: r2.rd_input,
    profit: r2.settlement.profit,
    profitable: Number(r2.settlement.profit) >= 0
  });
  return {
    synthetic: true,
    arm,
    public_arm: visibleArm,
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
  runR2FromExistingR1,
  loadMaterials,
  buildProfilePool,
  sampleTeam
};
