const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function extractIsSubmittedR2(relativePath) {
  const absolutePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const match = source.match(/function isSubmittedR2\(team\) \{\n([\s\S]*?)\n\}/);
  assert.ok(match, `isSubmittedR2 not found in ${relativePath}`);
  const body = match[1].trim();
  return {
    body,
    predicate: new Function("team", `${body}`)
  };
}

const classroom = extractIsSubmittedR2("client/src/components/ClassroomDebrief.jsx");
const teacherTabs = extractIsSubmittedR2("client/src/components/TeacherDebriefTabs.jsx");

test("ClassroomDebrief and TeacherDebriefTabs use the same R2 submitted predicate", () => {
  assert.equal(classroom.body, teacherTabs.body);
});

test("isSubmittedR2 rejects null and zero prices while keeping valid numeric strings", () => {
  const cases = [
    [{ r2: { price: 3600, profit: -437796 } }, true],
    [{ r2: { price: null, profit: null } }, false],
    [{ r2: { price: 0, profit: 0 } }, false],
    [{ r2: {} }, false],
    [{ r2: null }, false],
    [undefined, false],
    [{ r2: { price: "3600", profit: "-100" } }, true]
  ];

  [classroom.predicate, teacherTabs.predicate].forEach((predicate) => {
    cases.forEach(([input, expected]) => {
      assert.equal(predicate(input), expected);
    });
  });
});
