const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOG_ROOT = path.join(ROOT, "data", "persona_sim_logs");
const RD_PATH = path.join(ROOT, "server", "llm", "rdCalculator.js");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] != null ? cells[index] : "";
    });
    return row;
  });
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function findLatestRunDir() {
  const names = fs.readdirSync(LOG_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("batch_"))
    .sort()
    .reverse();

  for (const name of names) {
    const dir = path.join(LOG_ROOT, name);
    if (fs.existsSync(path.join(dir, "teams_summary.csv")) && fs.existsSync(path.join(dir, "report.json"))) {
      return dir;
    }
  }

  throw new Error("No persona sim run directory found");
}
function findStep(entries, stepName) {
  return entries.find((item) => item && item.step === stepName) || null;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  if (Math.abs(num) >= 1000) return Math.round(num).toString();
  return num.toFixed(2).replace(/\.00$/, "");
}

function formatPct(value) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "";
  return `${value.toFixed(2)}%`;
}

function pad(str, width) {
  const text = String(str == null ? "" : str);
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    jsonPath: ""
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("--json=")) {
      options.json = true;
      options.jsonPath = arg.slice("--json=".length).trim();
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDir = findLatestRunDir();
  const report = readJson(path.join(runDir, "report.json"));
  const teamRows = parseCsv(path.join(runDir, "teams_summary.csv"));
  const rd = require(RD_PATH);

  const teamMetaByIndex = new Map();
  for (const team of report.teams || []) {
    teamMetaByIndex.set(Number(team.teamIndex), team);
  }

  const results = [];

  for (const row of teamRows) {
    const teamIndex = Number(row.team_index);
    const teamMeta = teamMetaByIndex.get(teamIndex);
    if (!teamMeta) {
      throw new Error(`Missing report entry for team_index=${teamIndex}`);
    }

    const teamId = teamMeta.teamId || (teamMeta.meta && teamMeta.meta.createdTeamId);
    if (!teamId) {
      throw new Error(`Missing teamId for team_index=${teamIndex}`);
    }

    const byTeamPath = path.join(runDir, "by_team", `${teamId}.json`);
    const entries = readJson(byTeamPath);
    const previewStep = findStep(entries, "R2.7_calculate_preview");
    const resultStep = findStep(entries, "R2.7_get_team_result");

    if (!previewStep || !previewStep.requestBody) {
      throw new Error(`Missing R2.7_calculate_preview payload for team_index=${teamIndex}`);
    }

    const payload = JSON.parse(JSON.stringify(previewStep.requestBody));
    const gridId = String(payload.gridId || row.grid || "");
    const wtpMult = Number(payload.wtp_multiplier != null ? payload.wtp_multiplier : (row.r1_wtp_multiplier || 1));
    const originalWtpParams = rd.computeWTPParams(gridId);
    const baselinePayload = { ...payload };
    delete baselinePayload.wtp_multiplier;

    const baseline = await rd.calculate(baselinePayload);
    const adjusted = await rd.calculate({
      ...payload,
      wtp_multiplier: wtpMult
    });
    const compressedWtpMult = Number(adjusted.compressedWtpMult || rd.compressWtpMult(wtpMult));
    const adjustedWtpRef = Number(adjusted.WTPref_adjusted || 0);
    const compressedWtpRef = adjustedWtpRef;

    const originalProfit = Number(row.r2_profit || baseline.profit || 0);
    const newProfit = Number(adjusted.profit || 0);
    const compressedProfit = newProfit;
    const delta = newProfit - originalProfit;
    const deltaPct = originalProfit !== 0 ? (delta / Math.abs(originalProfit)) * 100 : null;

    results.push({
      teamIndex,
      grid: row.grid || gridId,
      calcGridId: gridId,
      wtpMult,
      compressedWtpMult,
      originalWtpRef: Number(originalWtpParams.WTPref || 0),
      adjustedWtpRef,
      compressedWtpRef,
      originalProfit,
      newProfit,
      compressedProfit,
      delta,
      deltaPct,
      selections: payload.selections || [],
      tags: payload.tags || (resultStep && resultStep.responseBody && resultStep.responseBody.radar && resultStep.responseBody.radar.tags) || [],
      radarScores: payload.radar || (resultStep && resultStep.responseBody && resultStep.responseBody.radar && resultStep.responseBody.radar.radar) || {},
      evi: payload.evi
    });
  }

  const jsonPayload = {
    runDir,
    generatedAt: new Date().toISOString(),
    results
  };

  if (options.json) {
    const outputPath = options.jsonPath
      ? path.resolve(options.jsonPath)
      : path.join(runDir, "vp_wtp_impact.json");
    fs.writeFileSync(outputPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");
    console.log(`JSON written: ${outputPath}`);
    console.log("");
  }

  console.log(`Latest run: ${runDir}`);
  console.log("");
  console.log("Compressed comparison:");
  console.log([
    pad("队号", 4),
    pad("grid", 28),
    pad("raw_mult", 10),
    pad("compressed_mult", 16),
    pad("旧引擎利润", 12),
    pad("新引擎利润", 12),
    pad("压缩方案利润", 18)
  ].join(" | "));
  console.log("-".repeat(114));

  for (const item of results) {
    console.log([
      pad(item.teamIndex, 4),
      pad(item.grid, 28),
      pad(formatNumber(item.wtpMult), 10),
      pad(formatNumber(item.compressedWtpMult), 16),
      pad(formatNumber(item.originalProfit), 12),
      pad(formatNumber(item.newProfit), 12),
      pad(formatNumber(item.compressedProfit), 18)
    ].join(" | "));
  }

  console.log("");
  console.log([
    pad("队号", 4),
    pad("grid", 28),
    pad("wtp_mult", 10),
    pad("原WTPref", 10),
    pad("压缩后WTPref", 12),
    pad("旧利润", 12),
    pad("新利润", 12),
    pad("差额", 12),
    pad("变化%", 10)
  ].join(" | "));
  console.log("-".repeat(124));

  for (const item of results) {
    console.log([
      pad(item.teamIndex, 4),
      pad(item.grid, 28),
      pad(formatNumber(item.wtpMult), 10),
      pad(formatNumber(item.originalWtpRef), 10),
      pad(formatNumber(item.adjustedWtpRef), 12),
      pad(formatNumber(item.originalProfit), 12),
      pad(formatNumber(item.newProfit), 12),
      pad(formatNumber(item.delta), 12),
      pad(formatPct(item.deltaPct), 10)
    ].join(" | "));
  }

  console.log("");
  console.log("Raw inputs used per team:");
  for (const item of results) {
    console.log(`\n[Team ${item.teamIndex}] ${item.grid}`);
    console.log(`  calcGridId: ${item.calcGridId}`);
    console.log(`  selections: ${JSON.stringify(item.selections)}`);
    console.log(`  tags: ${JSON.stringify(item.tags)}`);
    console.log(`  radarScores: ${JSON.stringify(item.radarScores)}`);
    console.log(`  evi: ${item.evi}`);
    console.log(`  compressedWtpMult: ${item.compressedWtpMult}`);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
