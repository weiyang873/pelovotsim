"use strict";

const { vpResultToApiScores } = require("../server/routes/teamRoutes");
const { parseScoresFromText } = require("../server/llm/vpCoach");

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function sameScores(actual, expected) {
  return actual
    && expected
    && Number(actual.coverage) === Number(expected.coverage)
    && Number(actual.generalizability) === Number(expected.generalizability)
    && Number(actual.effectiveness) === Number(expected.effectiveness);
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (err) {
    console.error(`FAIL ${name}: ${err.message}`);
    return false;
  }
}

function main() {
  const cases = [];

  for (let i = 0; i < 5; i += 1) {
    cases.push(runCase(`正文分数写库后读回保持一致 #${i + 1}`, () => {
      const replyText = [
        "你在“目标客户与场景痛点”上做得很好。",
        "“可泛化度”也很出色。",
        "目前最大短板在“价值创造说服力”。",
        "",
        "C/G/E 评分",
        "",
        "* C 任务普遍性: 4.5/5.0",
        "* G 可泛化度: 4.5/5.0",
        "* E 价值创造说服力: 1.0/5.0"
      ].join("\n");

      const visibleScores = parseScoresFromText(replyText);
      check(!!visibleScores, "正文没有解析出完整分数");

      const persisted = {
        scores: {
          C: { score: visibleScores.coverage, feedback: "" },
          G: { score: visibleScores.generalizability, feedback: "" },
          E: { score: visibleScores.effectiveness, feedback: "" }
        }
      };
      const fromDb = vpResultToApiScores(persisted);
      check(sameScores(fromDb, visibleScores), `数据库读回分数不一致: ${JSON.stringify(fromDb)} vs ${JSON.stringify(visibleScores)}`);
      check(fromDb.effectiveness === 1.0, `E 被错误放大成 ${fromDb.effectiveness}`);
    }));
  }

  cases.push(runCase("保留 legacy 小数兼容", () => {
    const fromDb = vpResultToApiScores({
      scores: {
        C: { score: 0.7, feedback: "" },
        G: { score: 0.5, feedback: "" },
        E: { score: 0.2, feedback: "" }
      }
    });
    check(fromDb.coverage === 3.5, `legacy C 兼容异常: ${fromDb.coverage}`);
    check(fromDb.generalizability === 2.5, `legacy G 兼容异常: ${fromDb.generalizability}`);
    check(fromDb.effectiveness === 1.0, `legacy E 兼容异常: ${fromDb.effectiveness}`);
  }));

  const ok = cases.every(Boolean);
  if (!ok) {
    console.error("❌");
    process.exit(1);
  }
  console.log("✅");
}

main();
