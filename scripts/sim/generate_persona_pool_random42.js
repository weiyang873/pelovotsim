"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_OUT_DIR = path.join(ROOT, "data", "persona_pool_random42_interface");
const SCRIPT_PATH = path.resolve(__filename);
const JINANG_PATH = path.join(ROOT, "game_config_v0.1", "jinang_cards_v2.json");

function loadPersonaPoolQuietly() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  if (!process.env.PERSONA_POOL_GENERATOR_VERBOSE_IMPORT) {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  }
  try {
    return require("./persona_pool");
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

const {
  PERSONAS,
  BACKUP_NAME_POOLS,
  sampleStudent
} = loadPersonaPoolQuietly();

function parseArgs(argv) {
  const args = {
    count: 42,
    outDir: DEFAULT_OUT_DIR,
    seed: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--seed") args.seed = String(argv[++index] || "").trim();
    else if (arg.startsWith("--seed=")) args.seed = arg.slice("--seed=".length).trim();
    else if (arg === "--count") args.count = Number(argv[++index]);
    else if (arg.startsWith("--count=")) args.count = Number(arg.slice("--count=".length));
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length).trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.seed) throw new Error("Missing required CLI argument: --seed <seed>");
  if (!Number.isInteger(args.count) || args.count < 1) throw new Error("--count must be a positive integer");
  return args;
}

function createSeededRandom(seedText) {
  let h = 2166136261;
  const text = String(seedText || "");
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return function random() {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededMathRandom(random, fn) {
  const original = Math.random;
  Math.random = random;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function sampleAge(persona, random) {
  const ageMatch = String(persona.age || "").match(/(\d+)\D+(\d+)/);
  const ageMin = ageMatch ? Number(ageMatch[1]) : 35;
  const ageMax = ageMatch ? Number(ageMatch[2]) : ageMin;
  return ageMin + Math.floor(random() * (ageMax - ageMin + 1));
}

function sampleGender(persona, random) {
  const maleWeight = Number(persona.genderDistribution?.male || 0.5);
  return random() < maleWeight ? "male" : "female";
}

function normalizeOverseas(overseas) {
  return {
    hasOverseas: Boolean(overseas?.hasOverseas),
    destination: overseas?.destination ? String(overseas.destination) : "",
    duration: overseas?.duration ? String(overseas.duration) : ""
  };
}

function fallbackName(record, usedNames, index) {
  const pools = BACKUP_NAME_POOLS[record.archetype] || {};
  const gender = record.surface.gender;
  const candidates = [
    ...(pools[gender] || []),
    ...(pools.male || [])
  ];
  let picked = candidates.find((name) => !usedNames.has(name));
  if (!picked) {
    const prefix = gender === "male" ? "陈" : "林";
    picked = `${prefix}${record.archetype}${String(index + 1).padStart(2, "0")}`;
    let suffix = 2;
    while (usedNames.has(picked)) {
      picked = `${prefix}${record.archetype}${String(index + 1).padStart(2, "0")}${suffix}`;
      suffix += 1;
    }
  }
  usedNames.add(picked);
  return picked;
}

function randomJinangDraw(jinangConfig, random) {
  const market = Array.isArray(jinangConfig.market) ? jinangConfig.market : [];
  const tech = Array.isArray(jinangConfig.tech) ? jinangConfig.tech : [];
  if (!market.length || !tech.length) throw new Error("jinang config must contain market and tech cards");
  return {
    market: market[Math.floor(random() * market.length)],
    tech: tech[Math.floor(random() * tech.length)],
    method: "seeded_random_pair_draw_from_jinang_cards_v2; same draw for Q/S pair"
  };
}

function countByArchetype(records) {
  return records.reduce((counts, record) => {
    counts[record.archetype] = Number(counts[record.archetype] || 0) + 1;
    return counts;
  }, {});
}

function containsNull(value) {
  if (value === null) return true;
  if (Array.isArray(value)) return value.some(containsNull);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsNull);
  }
  return false;
}

function generatePool({ seed, count }) {
  const random = createSeededRandom(seed);
  const archetypes = Object.keys(PERSONAS).sort();
  const jinangConfig = JSON.parse(fs.readFileSync(JINANG_PATH, "utf8"));
  const usedNames = new Set();
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const archetype = archetypes[Math.floor(random() * archetypes.length)];
    const persona = PERSONAS[archetype];
    const age = sampleAge(persona, random);
    const gender = sampleGender(persona, random);
    const student = withSeededMathRandom(random, () => sampleStudent(archetype, age, gender));
    const record = {
      persona_id: `R${String(index + 1).padStart(2, "0")}`,
      pair_index: index + 1,
      archetype,
      archetype_label: persona.label || archetype,
      seed: String(seed),
      surface: {
        name: "",
        gender: student.gender,
        age: student.age,
        edu: student.education,
        overseas: normalizeOverseas(student.overseas),
        mbti: student.mbti,
        expression_style: student.fullExpressionStyle || student.expressionStyle || ""
      },
      jinang_draw: randomJinangDraw(jinangConfig, random),
      synthetic: true
    };
    record.surface.name = fallbackName(record, usedNames, index);
    records.push(record);
  }
  return records;
}

function validatePool(records, expectedCount) {
  if (!Array.isArray(records) || records.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} persona records, got ${Array.isArray(records) ? records.length : "not-array"}`);
  }
  for (const record of records) {
    const required = [
      record.persona_id,
      record.archetype,
      record.surface?.name,
      record.surface?.gender,
      record.surface?.age,
      record.surface?.edu,
      record.surface?.overseas,
      record.surface?.mbti,
      record.surface?.expression_style,
      record.jinang_draw?.market?.id,
      record.jinang_draw?.tech?.id,
      record.synthetic
    ];
    if (required.some((value) => value === undefined || value === "")) {
      throw new Error(`Missing required field in ${record.persona_id}`);
    }
    if (containsNull(record)) throw new Error(`Null value found in ${record.persona_id}`);
  }
}

function getRepoGitHash() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function getGitObjectHash(filePath) {
  return execFileSync("git", ["hash-object", filePath], { cwd: ROOT, encoding: "utf8" }).trim();
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildManifest({ seed, count, records }) {
  return {
    seed: String(seed),
    generated_at: process.env.PERSONA_POOL_GENERATED_AT || new Date().toISOString(),
    script_path: "scripts/sim/generate_persona_pool_random42.js",
    script_git_hash: getGitObjectHash(SCRIPT_PATH),
    repo_git_hash: getRepoGitHash(),
    script_sha256: hashFile(SCRIPT_PATH),
    prng: {
      name: "fnv1a_seeded_mulberry32",
      seed_input: String(seed)
    },
    records_total: records.length,
    sampling_mode: "random42_unbalanced_archetype_iid",
    archetype_sampling: {
      method: "iid_uniform_with_replacement_over_7_archetypes",
      forced_balance: false,
      counts_by_archetype: countByArchetype(records)
    },
    persona_sampling: {
      method: "scripts/sim/persona_pool.js::sampleStudent under seeded Math.random",
      fields: ["archetype", "name", "gender", "age", "edu", "overseas", "mbti", "expression_style"]
    },
    jinang_sampling: {
      source: "game_config_v0.1/jinang_cards_v2.json",
      method: "seeded random market + tech draw per persona; Q/S share the same draw"
    },
    pairing: {
      conditions: ["Q", "S"],
      shared_persona_for_QS: true,
      shared_jinang_for_QS: true
    },
    validation: {
      expected_records_total: count,
      null_values_allowed: false
    },
    synthetic: true
  };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = generatePool({ seed: args.seed, count: args.count });
  validatePool(records, args.count);
  const manifest = buildManifest({ seed: args.seed, count: args.count, records });
  const poolPath = path.join(args.outDir, "persona_pool_v2.json");
  const manifestPath = path.join(args.outDir, "pool_manifest.json");
  writeJson(poolPath, records);
  writeJson(manifestPath, manifest);
  process.stdout.write(JSON.stringify({
    ok: true,
    seed: String(args.seed),
    pool_path: poolPath,
    manifest_path: manifestPath,
    records_total: records.length,
    counts_by_archetype: manifest.archetype_sampling.counts_by_archetype
  }, null, 2));
  process.stdout.write("\n");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exit(1);
  }
}
