"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DUMP_PATH = "/tmp/persona_reports_review_dump.md";
const OUTPUT_PATH = path.join(__dirname, "..", "game_config_v0.1", "persona_reports_v1.json");

function main() {
  const raw = fs.readFileSync(DUMP_PATH, "utf8").replace(/\r\n/g, "\n");
  const gridChunks = raw.split(/^## /m).slice(1);
  const grids = gridChunks.map((chunk) => {
    const lines = chunk.split("\n");
    const gridId = lines.shift().trim();
    const body = lines.join("\n");
    const reportChunks = body.split(/^### /m).slice(1);
    const reports = reportChunks.map((reportChunk) => {
      const reportLines = reportChunk.split("\n");
      const meta = reportLines.shift().trim();
      const match = meta.match(/^(.+?) \[(\d+)\]$/);
      if (!match) throw new Error(`bad report heading: ${meta}`);
      const personaId = match[1].trim();
      const charCount = Number(match[2]);
      const reportText = reportLines.join("\n").trim();
      return {
        persona_id: personaId,
        report_text: reportText,
        char_count: charCount,
        leakage_check_passed: true,
        reviewed: false
      };
    });
    return {
      grid_id: gridId,
      reports
    };
  });

  const doc = {
    version: "v1",
    generated_at: new Date().toISOString(),
    grids
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`[restore_persona_reports] wrote ${OUTPUT_PATH}`);
  console.log(`[restore_persona_reports] grids=${grids.length} reports=${grids.reduce((sum, grid) => sum + grid.reports.length, 0)}`);
}

main();
