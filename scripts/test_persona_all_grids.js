"use strict";

const { generatePersona } = require("../server/llm/personaGenerator");

const GRIDS = [
  { gridLabel: "ToC·差异化·老人", market: "ToC", segment: "Elder", isToB: false, who_raw: "刚退休、社交圈变窄的老人" },
  { gridLabel: "ToC·成本·老人", market: "ToC", segment: "Elder", isToB: false, who_raw: "独居、经济条件一般的退休老人" },
  { gridLabel: "ToC·差异化·成人", market: "ToC", segment: "Adult", isToB: false, who_raw: "一线城市独居白领" },
  { gridLabel: "ToC·成本·成人", market: "ToC", segment: "Adult", isToB: false, who_raw: "经常加班的职场新人" },
  { gridLabel: "ToC·差异化·儿童", market: "ToC", segment: "Child", isToB: false, who_raw: "注重早教的中产家庭" },
  { gridLabel: "ToC·成本·儿童", market: "ToC", segment: "Child", isToB: false, who_raw: "双职工家庭，孩子上幼儿园" },
  { gridLabel: "ToB·差异化·老人", market: "ToB", segment: "Elder", isToB: true, who_raw: "高端养老院" },
  { gridLabel: "ToB·成本·老人", market: "ToB", segment: "Elder", isToB: true, who_raw: "人手不足的社区护理站" },
  { gridLabel: "ToB·差异化·成人", market: "ToB", segment: "Adult", isToB: true, who_raw: "注重员工体验的科技公司" },
  { gridLabel: "ToB·成本·成人", market: "ToB", segment: "Adult", isToB: true, who_raw: "降本增效的连锁酒店" },
  { gridLabel: "ToB·差异化·儿童", market: "ToB", segment: "Child", isToB: true, who_raw: "高端双语幼儿园" },
  { gridLabel: "ToB·成本·儿童", market: "ToB", segment: "Child", isToB: true, who_raw: "师幼比不足的民办幼儿园" }
];

const AGE_RULES = {
  Elder: { ToC: [55, 85], ToB: [30, 60] },
  Adult: { ToC: [20, 55], ToB: [25, 60] },
  Child: { ToC: [25, 50], ToB: [25, 60] }
};

const DECISION_MAKER_KEYWORDS = [
  "院长", "副院长", "站长", "校长", "园长", "主任", "负责人", "创始人", "合伙人",
  "总监", "经理", "总经理", "店长", "馆长", "主管", "采购", "行政", "运营", "CEO", "COO", "CFO"
];

const TOB_TERMINAL_USER_KEYWORDS = [
  "老人", "长者", "住户", "患者", "幼儿", "儿童", "孩子", "宝宝", "学生", "员工", "护工", "老师"
];

const TOC_INSTITUTIONAL_KEYWORDS = [
  "院长", "站长", "校长", "园长", "主任", "负责人", "采购", "总监", "总经理", "CEO", "COO", "CFO"
];

const CHILD_PARENT_KEYWORDS = [
  "家长", "妈妈", "母亲", "爸爸", "父亲", "宝妈", "宝爸", "儿子", "女儿", "孩子", "育儿", "幼儿园"
];

function compactText(value) {
  return String(value || "").trim();
}

function buildRoleText(persona) {
  return [
    compactText(persona.title),
    compactText(persona.occupation)
  ].filter(Boolean).join(" ");
}

function buildPersonaContext(persona) {
  return [
    buildRoleText(persona),
    compactText(persona.org_type),
    compactText(persona.org_scale),
    compactText(persona.living_situation),
    compactText(persona.family),
    compactText(persona.background),
    compactText(persona.daily_routine),
    compactText(persona.desc)
  ].filter(Boolean).join(" ");
}

function hasKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function validateRole(grid, persona) {
  const roleText = buildRoleText(persona);
  const contextText = buildPersonaContext(persona);
  const reasons = [];

  if (!roleText) {
    reasons.push("缺少 title/occupation");
  }

  if (grid.isToB) {
    if (!hasKeyword(roleText, DECISION_MAKER_KEYWORDS)) {
      reasons.push(`角色"${roleText || "空"}"不像机构决策者/采购负责人`);
    }
    if (hasKeyword(roleText, TOB_TERMINAL_USER_KEYWORDS)) {
      reasons.push(`角色"${roleText}"更像终端使用者而不是决策者`);
    }
    if (!compactText(persona.org_type) && !compactText(persona.org_scale)) {
      reasons.push("缺少机构类型/规模信息");
    }
    return reasons;
  }

  if (hasKeyword(roleText, TOC_INSTITUTIONAL_KEYWORDS)) {
    reasons.push(`角色"${roleText}"像机构负责人，不像 ToC 访谈对象`);
  }

  if (grid.segment === "Child" && !hasKeyword(contextText, CHILD_PARENT_KEYWORDS)) {
    reasons.push("儿童 ToC 格子缺少家长/孩子相关线索");
  }

  return reasons;
}

function validatePersona(grid, persona, previousPersonas) {
  const reasons = [];
  const [minAge, maxAge] = AGE_RULES[grid.segment][grid.market];
  const age = Number(persona.age);
  const name = compactText(persona.name);
  const ageOk = Number.isFinite(age) && age >= minAge && age <= maxAge;
  const nameOk = name.length >= 2;
  const nameUnique = !previousPersonas.some((item) => item.name === name);

  if (!nameOk) {
    reasons.push(`名字"${name || "空"}"无效`);
  }
  if (!nameUnique) {
    reasons.push(`名字"${name}"重复`);
  }
  if (!ageOk) {
    reasons.push(`年龄${persona.age}不在[${minAge},${maxAge}]`);
  }

  reasons.push(...validateRole(grid, persona));
  return reasons;
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("❌ 缺少环境变量 DEEPSEEK_API_KEY，无法调用 DeepSeek API。");
    process.exit(1);
  }

  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const grid of GRIDS) {
    const previousPersonas = [];
    for (let i = 0; i < 3; i += 1) {
      try {
        const strategy = {
          ...grid,
          architecture: "Hybrid",
          architectureLabel: "混合型",
          previousPersonas: [...previousPersonas],
          teamId: `test-${grid.gridLabel}-${i}`
        };
        const persona = await generatePersona(null, strategy);
        const reasons = validatePersona(grid, persona, previousPersonas);
        const roleLabel = compactText(persona.title || persona.occupation);

        if (reasons.length === 0) {
          pass += 1;
          console.log(`✅ ${grid.gridLabel} #${i + 1}: ${persona.name}, ${persona.age}岁, ${roleLabel}`);
        } else {
          fail += 1;
          console.log(`❌ ${grid.gridLabel} #${i + 1}: ${persona.name || "未命名"}, ${persona.age}岁, ${roleLabel || "无角色"} — ${reasons.join(", ")}`);
          failures.push({
            grid: grid.gridLabel,
            round: i + 1,
            persona,
            reasons
          });
        }

        previousPersonas.push({
          name: compactText(persona.name),
          title: roleLabel
        });
      } catch (error) {
        fail += 1;
        console.log(`❌ ${grid.gridLabel} #${i + 1}: 生成失败 — ${error.message}`);
        failures.push({
          grid: grid.gridLabel,
          round: i + 1,
          error: error.message
        });
      }
    }
    console.log("---");
  }

  console.log("");
  console.log("=== 总结 ===");
  console.log(`通过: ${pass}/${pass + fail}, 失败: ${fail}`);

  if (failures.length) {
    console.log("");
    console.log("失败详情:");
    failures.forEach((item) => {
      console.log(JSON.stringify(item, null, 2));
    });
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("❌ 脚本执行失败:", error);
  process.exit(1);
});
