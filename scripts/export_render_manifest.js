"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const ROUND2_FLOW_PATH = path.join(ROOT, "client", "src", "pages", "Round2Flow.jsx");
const MULTIPLAYER_FLOW_PATH = path.join(ROOT, "client", "src", "pages", "MultiplayerFlow.jsx");
const CAPABILITY_PATH = path.join(ROOT, "data", "capability_groups_v2.json");
const JINANG_PATH = path.join(ROOT, "game_config_v0.1", "jinang_cards_v2.json");
const OUT_PATH = path.join(ROOT, "client", "render_manifest.json");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function sourceDirty(filePath) {
  const relative = path.relative(ROOT, filePath);
  const result = spawnSync("git", ["status", "--porcelain=v1", "--", relative], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function findConstLiteral(sourceText, constName, openChar, closeChar) {
  const source = String(sourceText || "");
  const marker = `const ${constName}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`cannot find ${marker}`);
  const equalsIndex = source.indexOf("=", markerIndex);
  const start = source.indexOf(openChar, equalsIndex);
  if (start < 0) throw new Error(`cannot find literal start for ${marker}`);
  let depth = 0;
  let inString = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === inString) inString = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      inString = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated literal for ${marker}`);
}

function evalConst(sourceText, constName, openChar, closeChar) {
  const literal = findConstLiteral(sourceText, constName, openChar, closeChar);
  return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function invertObject(object) {
  return Object.fromEntries(Object.entries(object || {}).map(([key, value]) => [value, key]));
}

function formatSignedCurrency(value) {
  const num = Number(value || 0);
  return `${num > 0 ? "+" : ""}¥${num.toLocaleString()}`;
}

function collectNumbers(value, out = new Set()) {
  if (value == null) return out;
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(String(value));
    return out;
  }
  if (typeof value === "string") {
    for (const match of value.matchAll(/(?<![A-Za-z_0-9])[-+]?\d+(?:\.\d+)?%?(?![A-Za-z_0-9])/g)) {
      out.add(match[0].replace(/^[+]/, "").replace(/%$/, ""));
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNumbers(item, out));
    return out;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectNumbers(item, out));
  }
  return out;
}

function manifestVersion(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));
  delete clone.manifest_version;
  return sha256(JSON.stringify(clone));
}

function buildRound2Stage(round2Source, capabilities) {
  const dims = evalConst(round2Source, "DIMS", "[", "]");
  const cardCopy = evalConst(round2Source, "CARD_COPY", "{", "}");
  const frontToBack = evalConst(round2Source, "FRONT_TO_BACK_ID", "{", "}");
  const backToFront = invertObject(frontToBack);
  backToFront.home_iot = backToFront.home_iot || "api_iot";
  backToFront.kids_mode = backToFront.kids_mode || "child_safety";
  backToFront.remote_diagnostics = backToFront.remote_diagnostics || "remote_monitor";

  const copyByFrontId = new Map();
  for (const cards of Object.values(cardCopy || {})) {
    for (const card of cards || []) copyByFrontId.set(card.id, card);
  }

  const dimByFrontId = new Map(dims.map((dim) => [dim.id, dim]));
  const dimGroupToFrontId = {
    interaction_expression: "interaction",
    perception_understanding: "perception",
    mobility_navigation: "motion",
    safety_trust: "safety",
    expand_connect: "extend",
    ops_maintenance: "ops"
  };

  const dimensions = (capabilities.groups || []).map((group) => {
    const frontDim = dimByFrontId.get(dimGroupToFrontId[group.group_id]) || {};
    return {
      path: `dimensions.${group.group_id}`,
      group_id: group.group_id,
      label: frontDim.l || group.name,
      icon: frontDim.icon || "",
      description: frontDim.desc || "",
      visibility: "primary",
      fields: [
        { path: "dimension.label", form: "text", visibility: "primary" },
        { path: "dimension.description", form: "text", visibility: "primary" },
        { path: "dimension.selected_count", form: "dynamic_count", visibility: "primary" }
      ],
      cards: (group.capabilities || []).map((capability) => {
        const frontId = backToFront[capability.cap_id] || capability.cap_id;
        const copy = copyByFrontId.get(frontId) || {};
        const tiers = ["low", "mid", "high"].map((tier) => {
          const sourceTier = capability.tiers?.[tier] || {};
          const copyTier = copy.tiers?.[tier] || {};
          const unitCost = Number(sourceTier.dCOGS || 0);
          const rdInvestmentWan = Number(capability.nre || 0);
          return {
            tier,
            label: copyTier.l || tier,
            description: copyTier.d || "",
            unit_cost_exact: unitCost,
            unit_cost_text: `${formatSignedCurrency(unitCost)}/台`,
            rd_investment_wan: rdInvestmentWan,
            rd_investment_text: `${rdInvestmentWan}万`,
            visibility: "primary",
            fields: [
              { path: "tier.label", form: "enum:基础/标准/旗舰", visibility: "primary" },
              { path: "tier.description", form: "text", visibility: "primary" },
              { path: "tier.unit_cost_exact", form: "currency_per_unit", visibility: "primary" },
              { path: "tier.rd_investment_wan", form: "wan_number", visibility: "primary" },
              { path: "card.nre_desc", form: "text_with_numbers", visibility: "primary" }
            ]
          };
        });
        return {
          path: `cards.${capability.cap_id}`,
          cap_id: capability.cap_id,
          front_id: frontId,
          name: copy.n || capability.name,
          what: copy.what || String(capability.what || capability.description || ""),
          risk_note: copy.riskNote || String(capability.risk_note || capability.risk || ""),
          nre_desc: String(capability.nre_desc || copy.nreDesc || ""),
          tag: copy.tag || "",
          dependencies: (copy.deps || []).map((dep) => ({
            ...dep,
            visibility: "conditional_after_selection"
          })),
          conflicts: (copy.conflicts || []).map((target) => ({
            target,
            visibility: "conditional_after_selection"
          })),
          visibility: "primary",
          fields: [
            { path: "card.name", form: "text", visibility: "primary" },
            { path: "card.what", form: "text", visibility: "primary" },
            { path: "card.risk_note", form: "text", visibility: "primary" },
            { path: "card.tag", form: "badge", visibility: "primary", condition: "if present" },
            { path: "card.cap_id", form: "machine_id_for_output", visibility: "harness_schema" }
          ],
          tiers
        };
      })
    };
  });

  const stage = {
    source_component: "client/src/pages/Round2Flow.jsx",
    mode: "individual",
    fields: [
      { path: "dimension.label", form: "text", visibility: "primary" },
      { path: "dimension.description", form: "text", visibility: "primary" },
      { path: "card.name", form: "text", visibility: "primary" },
      { path: "card.what", form: "text", visibility: "primary" },
      { path: "card.risk_note", form: "text", visibility: "primary" },
      { path: "card.tag", form: "badge", visibility: "primary", condition: "if present" },
      { path: "tier.label", form: "enum:基础/标准/旗舰", visibility: "primary" },
      { path: "tier.description", form: "text", visibility: "primary" },
      { path: "tier.unit_cost_exact", form: "currency_per_unit", visibility: "primary" },
      { path: "tier.rd_investment_wan", form: "wan_number", visibility: "primary" },
      { path: "card.nre_desc", form: "text_with_numbers", visibility: "primary" },
      { path: "tier.dependencies", form: "text", visibility: "conditional_after_selection" },
      { path: "card.conflicts", form: "text", visibility: "conditional_after_selection" },
      { path: "card.cap_id", form: "machine_id_for_output", visibility: "harness_schema" }
    ],
    omitted_fields_observed_in_prior_manual_whitelist: [
      { path: "dimension.imp_label", reason: "current frontend branch does not render IMP labels in personal card selection" },
      { path: "card.covers", reason: "current frontend branch does not render covers in personal card selection" },
      { path: "tier.unit_cost_label", reason: "current frontend branch renders exact unit cost numbers instead of qualitative labels" },
      { path: "tier.rd_investment_label", reason: "current frontend branch renders exact rd investment numbers instead of qualitative labels" }
    ],
    dimensions
  };
  stage.allowed_numbers = Array.from(collectNumbers(stage)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return stage;
}

function buildManifest() {
  const round2Source = fs.readFileSync(ROUND2_FLOW_PATH, "utf8");
  const multiplayerSource = fs.readFileSync(MULTIPLAYER_FLOW_PATH, "utf8");
  const capabilities = loadJson(CAPABILITY_PATH);
  const jinang = fs.existsSync(JINANG_PATH) ? loadJson(JINANG_PATH) : {};
  const head = git(["rev-parse", "HEAD"]);
  const sourceFiles = [
    ROUND2_FLOW_PATH,
    MULTIPLAYER_FLOW_PATH,
    CAPABILITY_PATH,
    JINANG_PATH
  ].filter((filePath) => fs.existsSync(filePath)).map((filePath) => ({
    path: path.relative(ROOT, filePath),
    sha256: fileSha256(filePath),
    git_status_dirty: sourceDirty(filePath)
  }));

  const stages = {
    R1_grid_select: {
      source_component: "client/src/pages/MultiplayerFlow.jsx",
      mode: "individual",
      fields: [
        { path: "grid.customer_type", form: "enum:ToC/ToB", visibility: "primary" },
        { path: "grid.strategy", form: "enum:差异化/成本领先", visibility: "primary" },
        { path: "grid.age", form: "enum:儿童/成人/老人", visibility: "primary" },
        { path: "architecture.option", form: "enum:Experience/Hybrid/Function + 中文解释", visibility: "primary" },
        { path: "jinang.market.title", form: "text", visibility: "primary" },
        { path: "jinang.market.desc", form: "text_with_numbers", visibility: "primary" },
        { path: "jinang.tech.title", form: "text", visibility: "primary" },
        { path: "jinang.tech.desc", form: "text_with_numbers", visibility: "primary" }
      ],
      grid_options: {
        customer: ["ToC", "ToB"],
        strategy: ["差异化", "成本领先"],
        age: ["儿童", "成人", "老人"],
        count: 12
      },
      architecture_options: [
        { key: "Experience", label: "体验", symbol: "●" },
        { key: "Hybrid", label: "混合", symbol: "▲" },
        { key: "Function", label: "功能", symbol: "■" }
      ],
      data_sources: {
        jinang_config: path.relative(ROOT, JINANG_PATH),
        jinang_counts: {
          market: Array.isArray(jinang.market) ? jinang.market.length : 0,
          tech: Array.isArray(jinang.tech) ? jinang.tech.length : 0
        }
      },
      allowed_numbers: ["12", "3", "2"]
    },
    R2_interview_summary: {
      source_component: "client/src/pages/Round2Flow.jsx",
      mode: "individual",
      fields: [
        { path: "persona_report.summary", form: "text_with_numbers", visibility: "primary" },
        { path: "interview.messages", form: "text_with_numbers", visibility: "requires_scroll" }
      ],
      allowed_numbers: []
    },
    R2_card_select: buildRound2Stage(round2Source, capabilities),
    R2_pricing: {
      source_component: "client/src/pages/Round2Flow.jsx",
      mode: "team",
      fields: [
        { path: "pricing.price_min", form: "currency", visibility: "primary" },
        { path: "pricing.price_max", form: "currency", visibility: "primary" },
        { path: "pricing.price_step", form: "currency", visibility: "primary" },
        { path: "team.unit_cost", form: "currency", visibility: "primary", mode: "team" },
        { path: "team.fixed_cost", form: "currency", visibility: "primary", mode: "team" },
        { path: "team.channel_fee", form: "percentage", visibility: "primary", mode: "team" }
      ],
      individual_experiment_policy: "D5 persona prompt keeps only price range and step; team-only cost accounting fields are not injected in solo experiments.",
      price_defaults_for_experiment: { price_min: 1000, price_max: 6000, price_step: 100 },
      allowed_numbers: ["1000", "6000", "100"]
    }
  };

  const manifest = {
    manifest_version: "",
    generated_from: head,
    generated_from_worktree_dirty: sourceFiles.some((file) => file.git_status_dirty),
    generator: path.relative(ROOT, __filename),
    source_files: sourceFiles,
    stages,
    notes: [
      "This manifest is generated from current frontend source without adding or changing npm scripts.",
      "Manifest is the info-set allowlist for experiment prompts; engine internals not represented here remain non-visible.",
      "Current frontend branch renders exact unit cost and R&D investment numbers in individual card selection; older qualitative IMP/cost-label whitelist is therefore not assumed."
    ]
  };
  manifest.manifest_version = manifestVersion(manifest);
  return manifest;
}

function main() {
  const outPath = process.argv[2] ? path.resolve(process.argv[2]) : OUT_PATH;
  const manifest = buildManifest();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(ROOT, outPath),
    manifest_version: manifest.manifest_version,
    generated_from: manifest.generated_from,
    generated_from_worktree_dirty: manifest.generated_from_worktree_dirty
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildManifest
};
