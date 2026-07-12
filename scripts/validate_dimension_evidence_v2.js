"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const EVIDENCE_PATH = path.join(ROOT, "game_config_v0.1", "grid_dimension_evidence_v2.json");
const TAG_MAP_PATH = path.join(ROOT, "data", "tag_map_v2_1.json");
const CAPABILITIES_PATH = path.join(ROOT, "data", "capability_groups_v2.json");
const PRIORS_PATH = path.join(ROOT, "data", "grid_priors_v4_cap_weights.json");
const SYNONYMS_PATH = path.join(ROOT, "game_config_v0.1", "report_tag_synonyms_v1.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const evidence = readJson(EVIDENCE_PATH);
  const tagMap = readJson(TAG_MAP_PATH);
  const capabilities = readJson(CAPABILITIES_PATH);
  const priors = readJson(PRIORS_PATH);
  const synonyms = readJson(SYNONYMS_PATH);
  const validTags = new Set(Object.keys(tagMap.need_tag_to_dim || {}));
  const coverableTags = new Set((capabilities.groups || []).flatMap((group) =>
    (group.capabilities || []).flatMap((capability) => capability.covers || [])
  ));
  const expectedGridIds = new Set((priors.grids || []).map((grid) => grid.id));
  const seenGridIds = new Set();
  const invalid = [];
  const uncoverable = [];
  const errors = [];
  const synonymOwners = new Map();
  for (const [tag, terms] of Object.entries(synonyms.tag_synonyms || {})) {
    for (const term of terms || []) {
      if (!synonymOwners.has(term)) synonymOwners.set(term, []);
      synonymOwners.get(term).push(tag);
    }
  }
  for (const [term, tags] of synonymOwners) {
    if (tags.length < 2) continue;
    const exception = synonyms.multi_mapping_exceptions?.[term];
    const allowed = Array.isArray(exception?.tags) ? exception.tags.slice().sort() : [];
    if (JSON.stringify(tags.slice().sort()) !== JSON.stringify(allowed) || !String(exception?.reason || "").trim()) {
      errors.push(`undeclared synonym multi-mapping: ${term} -> ${tags.join(", ")}`);
    }
  }

  for (const row of evidence.grids || []) {
    seenGridIds.add(row.grid_id);
    if (!expectedGridIds.has(row.grid_id)) errors.push(`unexpected grid: ${row.grid_id}`);
    if (!Array.isArray(row.tags) || row.tags.length < 1 || row.tags.length > 8) {
      errors.push(`${row.grid_id}: tags must contain 1-8 entries`);
    }
    if (new Set(row.tags || []).size !== (row.tags || []).length) {
      errors.push(`${row.grid_id}: duplicate tags`);
    }
    const configuredTarget = Number(synonyms.grid_tag_count_overrides?.[row.grid_id] || 6);
    if (Number(row.target_tag_count) !== configuredTarget) {
      errors.push(`${row.grid_id}: target tag count does not match synonym config`);
    }
    if ((row.tags || []).length < configuredTarget && !(row.content_gaps || []).length) {
      errors.push(`${row.grid_id}: tag shortfall is not marked as content gap`);
    }
    if (Number(row.core_tag_count || 0) * 2 < (row.tags || []).length && !(row.content_gaps || []).length) {
      errors.push(`${row.grid_id}: core shortfall is not marked as content gap`);
    }
    if (!Array.isArray(row.tag_evidence) || row.tag_evidence.length !== row.tags.length) {
      errors.push(`${row.grid_id}: tag evidence count mismatch`);
    }
    for (const tag of row.tags || []) {
      if (!validTags.has(tag)) invalid.push(`${row.grid_id}:${tag}`);
      if (!coverableTags.has(tag)) uncoverable.push(`${row.grid_id}:${tag}`);
    }
    for (const item of row.tag_evidence || []) {
      if (!Array.isArray(item.matched_terms) || item.matched_terms.length === 0) {
        errors.push(`${row.grid_id}:${item.tag}: missing report-text evidence`);
      }
    }
  }
  for (const gridId of expectedGridIds) {
    if (!seenGridIds.has(gridId)) errors.push(`missing grid: ${gridId}`);
  }

  const summary = {
    grids: seenGridIds.size,
    invalid: invalid.length,
    uncoverable: uncoverable.length,
    content_gaps: (evidence.grids || []).filter((row) => (row.content_gaps || []).length > 0).length,
    declared_multi_mapping_exceptions: Object.keys(synonyms.multi_mapping_exceptions || {}).length,
    errors: errors.length,
    invalid_tags: invalid,
    uncoverable_tags: uncoverable,
    error_details: errors
  };
  console.log(JSON.stringify(summary, null, 2));
  if (invalid.length || uncoverable.length || errors.length || seenGridIds.size !== expectedGridIds.size) {
    process.exitCode = 1;
  }
}

main();
