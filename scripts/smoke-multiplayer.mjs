import { spawnSync } from "node:child_process";

const checks = [
  ["node", ["--check", "server.js"]],
  ["node", ["--check", "server/llm/interviewCoach.js"]],
  ["node", ["--check", "server/llm/llm_logger.js"]],
  ["node", ["--check", "server/llm/lovotImageGen.js"]],
  ["node", ["--check", "server/llm/personaGenerator.js"]],
  ["node", ["--check", "server/llm/requirementBuilder.js"]],
  ["node", ["--check", "server/llm/tagExtractor.js"]],
  ["node", ["--check", "server/llm/vpCoach.js"]],
  ["node", ["--check", "server/llm/vpScorer.js"]],
  ["node", ["--check", "server/routes/adminRoutes.js"]],
  ["node", ["--check", "server/routes/round2Routes.js"]],
  ["node", ["--check", "server/routes/teacherConsole.js"]],
  ["node", ["--check", "server/routes/teacherDebrief.js"]],
  ["node", ["--check", "server/routes/teamRoutes.js"]],
  ["node", ["--check", "server/multiplayer/round2State.js"]],
  ["node", ["--check", "scripts/ai_simulation_test.js"]],
  ["node", ["--check", "scripts/sim/api_client.js"]],
  ["node", ["--check", "scripts/sim/assertions.js"]],
  ["node", ["--check", "scripts/sim/deepseek_student.js"]],
  ["node", ["--check", "scripts/sim/logger.js"]],
  ["node", ["--check", "scripts/sim/report.js"]],
  ["node", ["--check", "scripts/sim/team_runner.js"]],
  ["node", ["--check", "scripts/test_full_12grid_sim.js"]],
  ["node", ["--check", "scripts/test_full_12grid_ui_sim.js"]],
  ["node", ["tests/round2_extract_interview_result.test.js"]],
  ["node", ["tests/teacher_debrief_csv.test.js"]]
];

let failed = false;

for (const [cmd, args] of checks) {
  const label = `${cmd} ${args.join(" ")}`;
  const out = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
  if (out.status !== 0) {
    failed = true;
    process.stderr.write(`[smoke] FAIL ${label}\n`);
    if (out.stdout) process.stderr.write(`${out.stdout}\n`);
    if (out.stderr) process.stderr.write(`${out.stderr}\n`);
  } else {
    process.stdout.write(`[smoke] OK   ${label}\n`);
  }
}

if (failed) {
  process.exit(1);
}
