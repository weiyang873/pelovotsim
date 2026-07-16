"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS_PATH = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.2.json");
const V1_PATH = path.join(ROOT, "game_config_v0.1", "grid_dimension_evidence_v1.json");
const OUTPUT_PATH = path.join(ROOT, "game_config_v0.1", "grid_dimension_evidence_v2.json");
const SYNONYMS_PATH = path.join(ROOT, "game_config_v0.1", "report_tag_synonyms_v1.json");
const PRIORS_PATH = path.join(ROOT, "data", "grid_priors_v4_cap_weights.json");
const TAG_MAP_PATH = path.join(ROOT, "data", "tag_map_v2_1.json");
const CAPABILITIES_PATH = path.join(ROOT, "data", "capability_groups_v2.json");
const REVIEW_PATH = path.join(ROOT, "docs", "grid_dimension_evidence_v1_v2_review.md");
const CHANGES_REVIEW_PATH = path.join(ROOT, "docs", "grid_dimension_evidence_v2_wy_changes.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function countOccurrences(text, phrase) {
  if (!phrase) return 0;
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(phrase, offset);
    if (index < 0) break;
    count += 1;
    offset = index + phrase.length;
  }
  return count;
}

function buildCoverableTags(capabilityGroups) {
  const tags = new Set();
  for (const group of capabilityGroups.groups || []) {
    for (const capability of group.capabilities || []) {
      for (const tag of capability.covers || []) tags.add(tag);
    }
  }
  return tags;
}

function validateSynonymMappings(synonyms) {
  const owners = new Map();
  for (const [tag, terms] of Object.entries(synonyms.tag_synonyms || {})) {
    for (const term of terms || []) {
      if (!owners.has(term)) owners.set(term, []);
      owners.get(term).push(tag);
    }
  }
  const exceptions = synonyms.multi_mapping_exceptions || {};
  const undeclared = [];
  for (const [term, tags] of owners) {
    if (tags.length < 2) continue;
    const allowed = Array.isArray(exceptions[term]?.tags) ? exceptions[term].tags.slice().sort() : [];
    if (JSON.stringify(tags.slice().sort()) !== JSON.stringify(allowed) || !String(exceptions[term]?.reason || "").trim()) {
      undeclared.push({ term, tags });
    }
  }
  if (undeclared.length) {
    throw new Error(`undeclared synonym multi-mapping: ${JSON.stringify(undeclared)}`);
  }
  return { duplicate_terms: Array.from(owners.values()).filter((tags) => tags.length > 1).length };
}

function scoreTagEvidence(reportText, tag, aliases) {
  const terms = Array.from(new Set([tag, ...(aliases || [])])).filter(Boolean);
  const hits = terms.map((term) => ({
    term,
    count: countOccurrences(reportText, term)
  })).filter((item) => item.count > 0);
  return {
    tag,
    score: hits.reduce((sum, item) => sum + item.count, 0),
    evidence_terms: hits.map((item) => item.term),
    evidence_counts: Object.fromEntries(hits.map((item) => [item.term, item.count]))
  };
}

function selectTagsForGrid(grid, reportGrid, synonyms, validTags, coverableTags) {
  const reportText = (reportGrid.reports || []).map((report) => String(report.report_text || "")).join("\n");
  const excludedTags = new Set(synonyms.grid_tag_exclusions?.[grid.id] || []);
  const targetTagCount = Number(synonyms.grid_tag_count_overrides?.[grid.id] || 6);
  const coreSet = new Set((grid.recommended_core_tags || []).filter((tag) => validTags.has(tag) && coverableTags.has(tag)));
  const niceSet = new Set((grid.recommended_nice_tags || []).filter((tag) => validTags.has(tag) && coverableTags.has(tag)));
  const scored = Object.entries(synonyms.tag_synonyms || {}).map(([tag, aliases]) => {
    const evidence = scoreTagEvidence(reportText, tag, aliases);
    return {
      ...evidence,
      is_core: coreSet.has(tag),
      is_nice: niceSet.has(tag)
    };
  }).filter((item) => validTags.has(item.tag) && coverableTags.has(item.tag) && !excludedTags.has(item.tag) && item.score > 0);

  const sortCandidates = (items) => items.slice().sort((a, b) =>
    b.score - a.score || Number(b.is_nice) - Number(a.is_nice) || a.tag.localeCompare(b.tag, "zh-CN")
  );
  const coreCandidates = sortCandidates(scored.filter((item) => item.is_core));
  const selected = coreCandidates.slice(0, targetTagCount);
  const selectedTags = new Set(selected.map((item) => item.tag));
  const remaining = sortCandidates(scored.filter((item) => !selectedTags.has(item.tag)));
  for (const item of remaining) {
    if (selected.length >= targetTagCount) break;
    selected.push(item);
    selectedTags.add(item.tag);
  }
  const coreCount = selected.filter((item) => item.is_core).length;
  const contentGaps = [];
  if (selected.length < targetTagCount) {
    contentGaps.push(`报告文本仅支持 ${selected.length}/${targetTagCount} 个有效且可覆盖标签，未回填无证据映射`);
  }
  if (coreCount * 2 < selected.length) {
    contentGaps.push(`报告文本支持的 prior core 仅 ${coreCount}/${selected.length}，低于一半`);
  }

  return {
    tags: selected.map((item) => item.tag),
    tag_evidence: selected.map((item) => ({
      tag: item.tag,
      source: item.is_core ? "grid_prior_core" : item.is_nice ? "grid_prior_nice" : "report_text",
      score: item.score,
      matched_terms: item.evidence_terms,
      matched_term_counts: item.evidence_counts
    })),
    core_tag_count: coreCount,
    target_tag_count: targetTagCount,
    approved_tag_count_override: Object.prototype.hasOwnProperty.call(synonyms.grid_tag_count_overrides || {}, grid.id),
    excluded_tags: Array.from(excludedTags),
    content_gaps: contentGaps
  };
}

function writeReview(v1, v2, validationSummary) {
  const oldByGrid = new Map((v1.grids || []).map((row) => [row.grid_id, row]));
  const lines = [
    "# Grid Dimension Evidence v1 / v2 Review",
    "",
    `- status: ${v2.status}`,
    `- method: ${v2.generation_method}`,
    `- persona reports: ${v2.source_reports.file}`,
    `- persona reports sha256: \`${v2.source_reports.sha256}\``,
    `- invalid: ${validationSummary.invalid}`,
    `- uncoverable: ${validationSummary.uncoverable}`,
    `- grids: ${validationSummary.grids}`,
    `- content gaps: ${validationSummary.content_gaps}`,
    "",
    "Production final remains on v1 until WY approves this table.",
    "",
    "| Grid | v1 tags | v2 tags | Core ratio | Review note | Report evidence |",
    "|---|---|---|---:|---|---|"
  ];
  for (const row of v2.grids || []) {
    const old = oldByGrid.get(row.grid_id) || {};
    const evidence = (row.tag_evidence || []).map((item) => `${item.tag}←${item.matched_terms.slice(0, 3).join("/")}`).join("；");
    const notes = [
      row.approved_tag_count_override ? `WY批准 ${row.target_tag_count} tags` : "",
      ...(row.content_gaps || [])
    ].filter(Boolean).join("；") || "-";
    lines.push(`| ${row.grid_id} | ${(old.tags || []).join("、")} | ${row.tags.join("、")} | ${row.core_tag_count}/${row.tags.length} | ${notes} | ${evidence} |`);
  }
  fs.mkdirSync(path.dirname(REVIEW_PATH), { recursive: true });
  fs.writeFileSync(REVIEW_PATH, `${lines.join("\n")}\n`, "utf8");
}

function writeChangesReview(previousV2, nextV2) {
  const previousByGrid = new Map((previousV2?.grids || []).map((row) => [row.grid_id, row]));
  const changed = (nextV2.grids || []).filter((row) => {
    const previous = previousByGrid.get(row.grid_id);
    return JSON.stringify(previous?.tags || []) !== JSON.stringify(row.tags || []);
  });
  const lines = [
    "# WY Conditional Review Changes",
    "",
    `- changed grids: ${changed.length}`,
    `- synonym version: ${nextV2.source_synonyms.version}`,
    "",
    "| Grid | Before WY ruling | After WY ruling | Core ratio | Note |",
    "|---|---|---|---:|---|"
  ];
  for (const row of changed) {
    const previous = previousByGrid.get(row.grid_id) || {};
    const note = [
      row.approved_tag_count_override ? `WY批准 ${row.target_tag_count} tags` : "",
      row.excluded_tags?.length ? `排除：${row.excluded_tags.join("、")}` : "",
      ...(row.content_gaps || [])
    ].filter(Boolean).join("；") || "词表去重后重排";
    lines.push(`| ${row.grid_id} | ${(previous.tags || []).join("、")} | ${row.tags.join("、")} | ${row.core_tag_count}/${row.tags.length} | ${note} |`);
  }
  fs.writeFileSync(CHANGES_REVIEW_PATH, `${lines.join("\n")}\n`, "utf8");
}

function validateGenerated(output, tagMap, coverableTags, expectedGridIds) {
  const validTags = new Set(Object.keys(tagMap.need_tag_to_dim || {}));
  const invalid = [];
  const uncoverable = [];
  const seen = new Set();
  for (const row of output.grids || []) {
    seen.add(row.grid_id);
    for (const tag of row.tags || []) {
      if (!validTags.has(tag)) invalid.push(`${row.grid_id}:${tag}`);
      if (!coverableTags.has(tag)) uncoverable.push(`${row.grid_id}:${tag}`);
    }
    if ((row.tags || []).length < 1 || (row.tags || []).length > 8) {
      throw new Error(`${row.grid_id}: tag count must be within 1-8`);
    }
    if ((row.tags || []).length !== Number(row.target_tag_count || 6) && !(row.content_gaps || []).length) {
      throw new Error(`${row.grid_id}: tag count below target must be recorded as a content gap`);
    }
  }
  const missing = expectedGridIds.filter((gridId) => !seen.has(gridId));
  if (invalid.length || uncoverable.length || missing.length || seen.size !== expectedGridIds.length) {
    throw new Error(JSON.stringify({ invalid, uncoverable, missing, grids: seen.size }));
  }
  return {
    invalid: invalid.length,
    uncoverable: uncoverable.length,
    missing: missing.length,
    grids: seen.size,
    content_gaps: (output.grids || []).filter((row) => (row.content_gaps || []).length > 0).length
  };
}

function main() {
  const reports = readJson(REPORTS_PATH);
  const v1 = readJson(V1_PATH);
  const synonyms = readJson(SYNONYMS_PATH);
  const synonymValidation = validateSynonymMappings(synonyms);
  const priors = readJson(PRIORS_PATH);
  const tagMap = readJson(TAG_MAP_PATH);
  const capabilityGroups = readJson(CAPABILITIES_PATH);
  const validTags = new Set(Object.keys(tagMap.need_tag_to_dim || {}));
  const coverableTags = buildCoverableTags(capabilityGroups);
  const reportByGrid = new Map((reports.grids || []).map((grid) => [grid.grid_id, grid]));

  const previousV2 = fs.existsSync(OUTPUT_PATH) ? readJson(OUTPUT_PATH) : null;
  const grids = (priors.grids || []).map((grid) => {
    const reportGrid = reportByGrid.get(grid.id);
    if (!reportGrid) throw new Error(`persona reports missing grid ${grid.id}`);
    const selected = selectTagsForGrid(grid, reportGrid, synonyms, validTags, coverableTags);
    const previous = (v1.grids || []).find((row) => row.grid_id === grid.id);
    if (!previous?.dimension_evidence) throw new Error(`v1 dimension evidence missing grid ${grid.id}`);
    return {
      grid_id: grid.id,
      dimension_evidence: previous.dimension_evidence,
      evi: null,
      tags: selected.tags,
      core_tag_count: selected.core_tag_count,
      target_tag_count: selected.target_tag_count,
      approved_tag_count_override: selected.approved_tag_count_override,
      excluded_tags: selected.excluded_tags,
      content_gaps: selected.content_gaps,
      tag_evidence: selected.tag_evidence
    };
  });

  const output = {
    version: "v2",
    status: "pending_wy_quick_review",
    generated_at: new Date().toISOString(),
    generation_method: "deterministic_report_keyword_mapping_v1",
    source_reports: {
      file: path.relative(ROOT, REPORTS_PATH),
      version: reports.version || "",
      sha256: sha256File(REPORTS_PATH)
    },
    source_tag_map: {
      file: path.relative(ROOT, TAG_MAP_PATH),
      schema_version: tagMap.schema_version || "",
      sha256: sha256File(TAG_MAP_PATH)
    },
    source_capabilities: {
      file: path.relative(ROOT, CAPABILITIES_PATH),
      schema_version: capabilityGroups.schema_version || "",
      sha256: sha256File(CAPABILITIES_PATH)
    },
    source_synonyms: {
      file: path.relative(ROOT, SYNONYMS_PATH),
      version: synonyms.version || "",
      sha256: sha256File(SYNONYMS_PATH)
    },
    synonym_validation: synonymValidation,
    grids
  };
  const validationSummary = validateGenerated(output, tagMap, coverableTags, (priors.grids || []).map((grid) => grid.id));
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  writeReview(v1, output, validationSummary);
  writeChangesReview(previousV2, output);
  console.log(JSON.stringify({ output: OUTPUT_PATH, review: REVIEW_PATH, changes_review: CHANGES_REVIEW_PATH, ...validationSummary }, null, 2));
}

main();
