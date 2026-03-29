const test = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/routes/round2Routes");

test("buildAssignments only assigns dimensions and does not pre-generate persona pools", async () => {
  const team = {
    id: "team_r2_assign_fast_path",
    team_size: 6,
    final_grid_id: "ToC_Differentiation_Adult",
    members: [
      { id: "m1", member_name: "成员1", member_index: 1 },
      { id: "m2", member_name: "成员2", member_index: 2 },
      { id: "m3", member_name: "成员3", member_index: 3 },
      { id: "m4", member_name: "成员4", member_index: 4 },
      { id: "m5", member_name: "成员5", member_index: 5 },
      { id: "m6", member_name: "成员6", member_index: 6 }
    ]
  };

  const assignments = await __test.buildAssignments(team, 6);

  assert.equal(assignments.length, 6);
  assignments.forEach((item) => {
    assert.ok(Array.isArray(item.dims));
    assert.ok(item.dims.length > 0);
    assert.deepEqual(item.personaPool, []);
    assert.equal(item.personaVersion, 4);
  });
});
