"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

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
  EDUCATION_DISTRIBUTION,
  sampleStudent
} = loadPersonaPoolQuietly();

const OUT_DIR = path.resolve(__dirname, "../../data/persona_pool_v2");
const POOL_PATH = path.join(OUT_DIR, "persona_pool_v2.json");
const MANIFEST_PATH = path.join(OUT_DIR, "pool_manifest.json");
const SCRIPT_PATH = path.resolve(__filename);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--seed") {
      args.seed = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--seed=")) {
      args.seed = arg.slice("--seed=".length);
    }
  }
  return args;
}

function createSeededRandom(seedText) {
  let h = 2166136261;
  const text = String(seedText || "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
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

function chooseFallbackNames(records) {
  const used = new Set();
  return records.map((record, index) => {
    const pools = BACKUP_NAME_POOLS[record.archetype] || {};
    const gender = record.surface.gender;
    const candidates = [
      ...(pools[gender] || []),
      ...(pools.male || [])
    ];
    let picked = candidates.find((name) => !used.has(name));
    if (!picked) {
      const prefix = gender === "male" ? "陈" : "林";
      picked = `${prefix}${record.archetype}${String(index + 1).padStart(2, "0")}`;
      let suffix = 2;
      while (used.has(picked)) {
        picked = `${prefix}${record.archetype}${String(index + 1).padStart(2, "0")}${suffix}`;
        suffix += 1;
      }
    }
    used.add(picked);
    return picked;
  });
}

function generatePool(seed) {
  const random = createSeededRandom(seed);
  const records = [];

  Object.keys(PERSONAS).sort().forEach((archetype) => {
    const persona = PERSONAS[archetype];
    for (let index = 1; index <= 6; index += 1) {
      const age = sampleAge(persona, random);
      const gender = sampleGender(persona, random);
      const student = withSeededMathRandom(random, () => sampleStudent(archetype, age, gender));
      records.push({
        persona_id: `${archetype}-${String(index).padStart(2, "0")}`,
        archetype,
        surface: {
          name: "",
          gender: student.gender,
          age: student.age,
          edu: student.education,
          overseas: normalizeOverseas(student.overseas),
          mbti: student.mbti,
          expression_style: student.fullExpressionStyle || student.expressionStyle || ""
        },
        synthetic: true
      });
    }
  });

  const names = chooseFallbackNames(records);
  records.forEach((record, index) => {
    record.surface.name = names[index];
  });

  return records;
}

function countByArchetype(records) {
  return records.reduce((counts, record) => {
    counts[record.archetype] = (counts[record.archetype] || 0) + 1;
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

function validatePool(records) {
  const expectedArchetypes = Object.keys(PERSONAS).sort();
  if (records.length !== expectedArchetypes.length * 6) {
    throw new Error(`Expected 42 persona records, got ${records.length}`);
  }
  const counts = countByArchetype(records);
  expectedArchetypes.forEach((archetype) => {
    if (counts[archetype] !== 6) {
      throw new Error(`Expected 6 records for archetype ${archetype}, got ${counts[archetype] || 0}`);
    }
  });
  records.forEach((record) => {
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
      record.synthetic
    ];
    if (required.some((value) => value === undefined || value === "")) {
      throw new Error(`Missing required field in ${record.persona_id}`);
    }
    if (containsNull(record)) {
      throw new Error(`Null value found in ${record.persona_id}`);
    }
  });
}

function readExistingGeneratedAt(seed) {
  if (!fs.existsSync(MANIFEST_PATH)) return "";
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    if (String(manifest.seed) === String(seed) && manifest.generated_at) {
      return manifest.generated_at;
    }
  } catch (_) {
    return "";
  }
  return "";
}

function getRepoGitHash() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8"
  }).trim();
}

function getGitObjectHash(filePath) {
  return execFileSync("git", ["hash-object", filePath], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8"
  }).trim();
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildManifest(seed, records) {
  const generatedAt = process.env.PERSONA_POOL_GENERATED_AT
    || readExistingGeneratedAt(seed)
    || new Date().toISOString();

  return {
    seed: String(seed),
    generated_at: generatedAt,
    script_path: "scripts/sim/generate_persona_pool_v2.js",
    script_git_hash: getGitObjectHash(SCRIPT_PATH),
    repo_git_hash: getRepoGitHash(),
    script_sha256: hashFile(SCRIPT_PATH),
    prng: {
      name: "fnv1a_seeded_mulberry32",
      seed_input: String(seed)
    },
    records_total: records.length,
    counts_by_archetype: countByArchetype(records),
    source_definitions: {
      archetypes: "scripts/sim/persona_pool.js::PERSONAS",
      names: "scripts/sim/persona_pool.js::BACKUP_NAME_POOLS",
      education_distribution: "scripts/sim/persona_pool.js::EDUCATION_DISTRIBUTION",
      sampling_logic: "scripts/sim/persona_pool.js::sampleStudent with seeded Math.random"
    },
    sampled_surface_fields: [
      "name",
      "gender",
      "age",
      "edu",
      "overseas",
      "mbti",
      "expression_style"
    ],
    kernel_parameter_distribution: {
      per_persona_kernel_enabled: false,
      satisfice_window: {
        status: "cancelled",
        values: []
      },
      arm_level_quantity_policy: {
        value: "min6",
        source: "CODEX_FULL_RERUN_V4FLASH.md regime.quantity_policy"
      }
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
  if (!args.seed) {
    throw new Error("Missing required CLI argument: --seed <seed>");
  }

  const records = generatePool(args.seed);
  validatePool(records);
  const manifest = buildManifest(args.seed, records);

  writeJson(POOL_PATH, records);
  writeJson(MANIFEST_PATH, manifest);

  process.stdout.write(JSON.stringify({
    ok: true,
    seed: String(args.seed),
    pool_path: POOL_PATH,
    manifest_path: MANIFEST_PATH,
    records_total: records.length,
    counts_by_archetype: manifest.counts_by_archetype
  }, null, 2));
  process.stdout.write("\n");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  }
}
