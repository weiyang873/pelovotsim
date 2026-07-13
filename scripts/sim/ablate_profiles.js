"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const INPUT = path.join(ROOT, "scripts", "sim", "structured_profiles_v1.json");
const OUTPUT = path.join(ROOT, "scripts", "sim", "structured_profiles_v1_no_pricing.json");
const REPORT = path.join(ROOT, "scripts", "sim", "structured_profiles_v1_no_pricing_report.md");

const REMOVED_FIELDS = [
  "belief_policy",
  "aspirations.acceptable_margin",
  "aspirations.price_position",
  "objectives_rank"
];

const FORBIDDEN_KEYS = [
  "belief_policy",
  "wtp_anchor_style",
  "trust_in_reports",
  "confidence_calibration",
  "acceptable_margin",
  "price_position",
  "objectives_rank"
];

const REQUIRED_KEYS = [
  "member_key",
  "archetype",
  "attention",
  "aspirations.minimum_core_coverage",
  "aspirations.nre_tolerance",
  "search_policy",
  "risk_policy",
  "constraint_policy"
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasPath(obj, dotted) {
  return dotted.split(".").every((part) => {
    if (!obj || typeof obj !== "object" || !Object.prototype.hasOwnProperty.call(obj, part)) return false;
    obj = obj[part];
    return true;
  });
}

function ablateProfile(profile) {
  const out = clone(profile);
  delete out.belief_policy;
  delete out.objectives_rank;
  if (out.aspirations && typeof out.aspirations === "object") {
    delete out.aspirations.acceptable_margin;
    delete out.aspirations.price_position;
  }
  return out;
}

function main() {
  const profiles = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  if (!Array.isArray(profiles) || profiles.length !== 72) {
    throw new Error(`Expected 72 profiles in ${INPUT}`);
  }
  const ablated = profiles.map(ablateProfile);
  const serialized = JSON.stringify(ablated, null, 2);
  const forbiddenHits = Object.fromEntries(FORBIDDEN_KEYS.map((key) => [
    key,
    (serialized.match(new RegExp(key, "g")) || []).length
  ]));
  const missingRequired = [];
  for (const profile of ablated) {
    for (const key of REQUIRED_KEYS) {
      if (!hasPath(profile, key)) {
        missingRequired.push(`${profile.member_key || "unknown"}:${key}`);
      }
    }
  }
  fs.writeFileSync(OUTPUT, `${serialized}\n`);
  const lines = [
    "# Structured Profiles v1 No Pricing Ablation Report",
    "",
    `- input: ${path.relative(ROOT, INPUT)}`,
    `- output: ${path.relative(ROOT, OUTPUT)}`,
    `- profiles: ${ablated.length}/72`,
    `- removed fields: ${REMOVED_FIELDS.join(", ")}`,
    "",
    "## Forbidden Key Hits",
    "",
    "| key | hits |",
    "|---|---:|"
  ];
  for (const [key, hits] of Object.entries(forbiddenHits)) {
    lines.push(`| ${key} | ${hits} |`);
  }
  lines.push("", "## Required Field Check", "");
  lines.push(missingRequired.length === 0
    ? "- PASS: all required retained fields are present."
    : `- FAIL: missing ${missingRequired.length} required fields.`);
  if (missingRequired.length > 0) {
    lines.push("", ...missingRequired.map((item) => `- ${item}`));
  }
  fs.writeFileSync(REPORT, `${lines.join("\n")}\n`);
  if (Object.values(forbiddenHits).some((hits) => hits !== 0)) {
    throw new Error(`Forbidden key hits detected: ${JSON.stringify(forbiddenHits)}`);
  }
  if (missingRequired.length > 0) {
    throw new Error(`Missing required retained fields: ${missingRequired.slice(0, 5).join(", ")}`);
  }
  console.log(JSON.stringify({ output: OUTPUT, report: REPORT, profiles: ablated.length, forbiddenHits }, null, 2));
}

if (require.main === module) {
  main();
}
