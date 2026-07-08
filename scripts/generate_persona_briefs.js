"use strict";

const path = require("node:path");

process.loadEnvFile(path.join(__dirname, "..", ".env"));

const { generatePersona } = require("../server/llm/personaGenerator");
const {
  OUTPUT_BRIEFS,
  compactText,
  getGridRecords,
  buildPersonaId,
  readJsonIfExists,
  writeJson
} = require("./offline_report_utils");

function toBrief(persona) {
  return {
    name: compactText(persona.name),
    age: Number(persona.age),
    city: compactText(persona.city || persona.location || persona.city_tier || "待补充"),
    identity: compactText(persona.title || persona.occupation),
    family: compactText(persona.family || "待补充"),
    economic: compactText(persona.spending || persona.budget || "待补充"),
    residence: compactText(persona.living_situation || persona.org_type || "待补充"),
    tech_acceptance: compactText(persona.tech_comfort || "待补充")
  };
}

async function main() {
  const existing = readJsonIfExists(OUTPUT_BRIEFS, { grids: [] });
  const existingMap = new Map((existing.grids || []).map((item) => [item.grid_id, item]));
  const next = { version: "v1", generated_at: new Date().toISOString(), grids: [] };

  for (const grid of getGridRecords()) {
    const found = existingMap.get(grid.grid_id);
    if (found && Array.isArray(found.personas) && found.personas.length >= 3) {
      next.grids.push(found);
      console.log(`[briefs] skip existing ${grid.grid_id}`);
      continue;
    }

    const personas = [];
    const previousPersonas = [];
    for (let index = 1; index <= 3; index += 1) {
      const persona = await generatePersona(null, {
        teamId: `offline_${grid.grid_id}_${index}`,
        who_raw: grid.whoRaw,
        gridLabel: grid.gridLabel,
        architectureLabel: grid.architectureLabel,
        isToB: grid.market === "ToB",
        previousPersonas
      });
      const personaId = buildPersonaId(grid.grid_id, index);
      personas.push({
        persona_id: personaId,
        source_persona: persona,
        brief: toBrief(persona)
      });
      previousPersonas.push({
        name: compactText(persona.name),
        title: compactText(persona.title || persona.occupation)
      });
      console.log(`[briefs] ${grid.grid_id} -> ${personaId}`);
    }

    next.grids.push({
      grid_id: grid.grid_id,
      personas
    });
  }

  writeJson(OUTPUT_BRIEFS, next);
  console.log(`[briefs] wrote ${OUTPUT_BRIEFS}`);
}

main().catch((error) => {
  console.error("[briefs] failed:", error);
  process.exit(1);
});
