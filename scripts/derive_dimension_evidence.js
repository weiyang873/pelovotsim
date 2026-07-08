"use strict";

const priors = require("../data/grid_priors_v4_cap_weights.json");
const tagMap = require("../data/tag_map_v2_1.json");
const { OUTPUT_EVIDENCE, DIMENSION_LABELS, writeJson } = require("./offline_report_utils");

function invertTagMap() {
  const reversed = new Map();
  for (const [tag, dimLabel] of Object.entries(tagMap.need_tag_to_dim || {})) {
    if (!reversed.has(dimLabel)) reversed.set(dimLabel, []);
    reversed.get(dimLabel).push(tag);
  }
  return reversed;
}

function main() {
  const tagsByDim = invertTagMap();
  const grids = (priors.grids || []).map((grid) => {
    const sortedDims = Object.entries(grid.radar_weight_prior || {})
      .map(([label, strength]) => ({
        label,
        dimKey: DIMENSION_LABELS[label],
        strength: Number(strength || 0)
      }))
      .filter((item) => item.dimKey)
      .sort((a, b) => b.strength - a.strength);

    const dimension_evidence = {};
    sortedDims.forEach((item) => {
      dimension_evidence[item.dimKey] = {
        mentioned: item.strength > 0.2,
        strength: Number(item.strength.toFixed(4))
      };
    });

    const tags = [];
    for (const item of sortedDims.slice(0, 4)) {
      const candidates = tagsByDim.get(item.label) || [];
      for (const tag of candidates) {
        if (!tags.includes(tag)) tags.push(tag);
        if (tags.length >= 5) break;
      }
      if (tags.length >= 5) break;
    }

    return {
      grid_id: grid.id,
      dimension_evidence,
      evi: 0.7,
      tags
    };
  });

  writeJson(OUTPUT_EVIDENCE, {
    version: "v1",
    generated_at: new Date().toISOString(),
    note: "strength 按 radar_weight_prior 线性归一化直接输出；tags 取高权重维度反查白名单 key。TODO(WY)",
    grids
  });
  console.log(`[evidence] wrote ${OUTPUT_EVIDENCE}`);
}

main();
