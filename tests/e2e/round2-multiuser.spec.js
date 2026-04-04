const { test, expect } = require("@playwright/test");
const { ROUND2_INTERVIEW_SCRIPT } = require("./helpers/flowHelpers");

const TEAM_SIZE = 6;
const ROUND1_GRID_ID = "ToB_Differentiation_Elder";
const ROUND1_ARCHITECTURE = "Experience";
const ROUND1_SCORES = {
  coverage: 4.3,
  generalizability: 4.0,
  effectiveness: 4.4
};
const ROUND1_VP_RESULT = {
  who: "高端养老机构院长与采购负责人，直接使用者是需要陪伴和安全提醒的高龄老人。",
  pain: "机构很难持续感知老人情绪波动和异常风险，护工负担重且夜间响应不足。",
  how: "LOVOT 通过自然陪伴、状态感知和异常提醒，帮助机构在不显著增加人力的前提下提升老人安全感与满意度。",
  boundary: "聚焦养老机构陪伴与提醒场景，不承担医疗诊断职责。"
};

async function expectOk(response, label) {
  expect(response.status(), `${label} HTTP status`).toBe(200);
  const data = await response.json();
  expect(data?.ok, `${label} ok`).toBeTruthy();
  return data;
}

async function apiPost(request, path, payload, label) {
  const response = await request.post(path, {
    data: payload
  });
  return expectOk(response, label);
}

async function apiGet(request, path, label) {
  const response = await request.get(path);
  return expectOk(response, label);
}

async function bootstrapRound2Team(request) {
  const teamName = `pw-r2-six-${Date.now()}`;
  const createData = await apiPost(request, "/api/team/create", {
    teamName,
    teamSize: TEAM_SIZE
  }, "create team");

  const teamId = String(createData?.team?.id || "").trim();
  const members = Array.isArray(createData?.team?.members) ? createData.team.members : [];
  expect(teamId).not.toBe("");
  expect(members).toHaveLength(TEAM_SIZE);

  for (let index = 0; index < members.length; index += 1) {
    const memberId = String(members[index]?.id || "").trim();
    expect(memberId, `member ${index + 1} id`).not.toBe("");
    await apiPost(
      request,
      `/api/team/${encodeURIComponent(teamId)}/phase1/${encodeURIComponent(memberId)}/submit`,
      {
        grid_id: ROUND1_GRID_ID,
        architecture: ROUND1_ARCHITECTURE,
        who: `${ROUND1_VP_RESULT.who}（成员${index + 1}）`,
        pain: ROUND1_VP_RESULT.pain,
        how: ROUND1_VP_RESULT.how
      },
      `round1 submit member ${index + 1}`
    );
  }

  const leaderMemberId = String(members[0]?.id || "").trim();
  await apiPost(
    request,
    `/api/team/${encodeURIComponent(teamId)}/phase3/finalize`,
    {
      member_id: leaderMemberId,
      grid_id: ROUND1_GRID_ID,
      architecture: ROUND1_ARCHITECTURE,
      scores: ROUND1_SCORES,
      vp_result: ROUND1_VP_RESULT
    },
    "round1 finalize"
  );

  await apiPost(
    request,
    `/api/team/${encodeURIComponent(teamId)}/freeze`,
    {
      member_id: leaderMemberId
    },
    "round1 freeze"
  );

  const assignments = await apiPost(request, "/api/round2/assign-dimensions", {
    teamId,
    memberCount: TEAM_SIZE
  }, "round2 assign dimensions");
  expect(Array.isArray(assignments.assignments)).toBeTruthy();
  expect(assignments.assignments).toHaveLength(TEAM_SIZE);
  assignments.assignments.forEach((item, index) => {
    expect(Array.isArray(item?.dims), `member ${index + 1} dims`).toBeTruthy();
    expect(item.dims.length, `member ${index + 1} dims length`).toBeGreaterThanOrEqual(2);
  });

  const recap = await apiGet(
    request,
    `/api/round2/recap?teamId=${encodeURIComponent(teamId)}`,
    "round2 recap"
  );

  return {
    teamId,
    leaderMemberId,
    members: members.map((member, index) => ({
      id: String(member.id || "").trim(),
      name: String(member.member_name || member.name || `成员${index + 1}`).trim(),
      index: index + 1
    })),
    recap
  };
}

async function openRound2Page(browser, teamId, memberId) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`/multiplayer/round2?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(memberId)}&session_id=default`);
  await expect(page.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "进入第二轮 →" }).click();
  await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 60000 });
  return { context, page };
}

async function waitForInterviewReady(page) {
  await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 60000 });
  await expect(page.locator("[data-testid='r2-interview-input']")).toBeEditable({ timeout: 90000 });
}

async function completeSingleInterview(page) {
  await waitForInterviewReady(page);
  const personaMessages = page.locator("[data-testid='r2-interview-persona-msg']");
  const userMessages = page.locator("[data-testid='r2-interview-user-msg']");

  for (const prompt of ROUND2_INTERVIEW_SCRIPT) {
    const beforePersonaCount = await personaMessages.count();
    const beforeUserCount = await userMessages.count();
    await page.locator("[data-testid='r2-interview-input']").fill(prompt);
    await page.locator("[data-testid='r2-interview-send-btn']").click();
    await expect(userMessages).toHaveCount(beforeUserCount + 1, { timeout: 10000 });
    await expect(personaMessages).toHaveCount(beforePersonaCount + 1, { timeout: 90000 });
  }

  const endButton = page.getByRole("button", { name: /结束本次访谈/ });
  await expect(endButton).toBeVisible({ timeout: 10000 });
  await endButton.click();
  await expect
    .poll(async () => {
      if (await page.locator("[data-testid='r2-card-selection-container']").count()) return "cards";
      if (await page.getByRole("button", { name: /开始下一次访谈|进入个人选卡|再访谈一位|访谈要求已满足，进入个人选卡/ }).count()) return "next";
      return "pending";
    }, { timeout: 90000, intervals: [1000, 2000, 3000] })
    .not.toBe("pending");
}

async function completeTwoInterviewsAndEnterCards(page) {
  await completeSingleInterview(page);
  const nextInterviewButton = page.getByRole("button", { name: /开始下一次访谈/ });
  await expect(nextInterviewButton).toBeVisible({ timeout: 30000 });
  await nextInterviewButton.click();

  await completeSingleInterview(page);
  const enterCardsButton = page.getByRole("button", { name: /进入个人选卡|访谈要求已满足，进入个人选卡/ });
  await expect(enterCardsButton.or(page.locator("[data-testid='r2-card-selection-container']"))).toBeVisible({ timeout: 30000 });
  if (await page.locator("[data-testid='r2-card-selection-container']").count()) {
    return;
  }
  await enterCardsButton.click();
  await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
}

async function selectCardsAndSubmit(page, request, { teamId, memberId, expectWaiting }) {
  const groups = page.locator("[data-testid^='r2-dim-']");
  const groupCount = await groups.count();
  expect(groupCount).toBeGreaterThan(0);

  for (let index = 0; index < groupCount; index += 1) {
    const checkbox = groups.nth(index).locator("input[type='checkbox']").first();
    await expect(checkbox).toBeVisible({ timeout: 10000 });
    await checkbox.click();
  }

  const selectedCount = await page.locator("[data-testid='r2-budget-display'] strong").innerText();
  expect(Number(selectedCount)).toBeGreaterThan(0);

  await page.getByRole("button", { name: /提交个人选卡/ }).click();
  if (expectWaiting) {
    await expect
      .poll(async () => {
        const state = await getRound2State(request, teamId, memberId);
        return {
          teamStatus: state.team_status,
          cardStatus: state.member_state?.card_status
        };
      }, { timeout: 30000, intervals: [1000, 2000, 3000] })
      .toEqual({
        teamStatus: "R2_INDIVIDUAL_CARDS",
        cardStatus: "submitted"
      });
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='r2-merge-container']")).toHaveCount(0);
  } else {
    await expect
      .poll(async () => {
        const state = await getRound2State(request, teamId, memberId);
        return {
          teamStatus: state.team_status,
          cardStatus: state.member_state?.card_status
        };
      }, { timeout: 30000, intervals: [1000, 2000, 3000] })
      .toEqual({
        teamStatus: "R2_TEAM_MERGE",
        cardStatus: "submitted"
      });
    await expect(page.locator("[data-testid='r2-merge-container']")).toBeVisible({ timeout: 30000 });
  }
}

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((node, nextValue) => {
    node.value = String(nextValue);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function getRound2State(request, teamId, memberId = "") {
  const query = new URLSearchParams({
    teamId: String(teamId || "").trim()
  });
  if (memberId) query.set("memberId", String(memberId || "").trim());
  return apiGet(request, `/api/round2/state?${query.toString()}`, `round2 state ${memberId || "team"}`);
}

test.describe.serial("Round 2 multiuser E2E", () => {
  test("6-person team stays in sync across interview, cards, merge and results", async ({ browser, request }) => {
    test.setTimeout(30 * 60 * 1000);

    const setup = await bootstrapRound2Team(request);
    const priceTarget = Math.max(
      5000,
      Math.min(
        20000,
        Math.round(Number(setup.recap?.Pmax || setup.recap?.P || 12000) * 0.7 / 100) * 100
      )
    );

    const sessions = [];
    try {
      for (const member of setup.members) {
        const browserSession = await openRound2Page(browser, setup.teamId, member.id);
        sessions.push({
          ...browserSession,
          member
        });
      }

      await expect
        .poll(async () => {
          const state = await getRound2State(request, setup.teamId, setup.members[0].id);
          return state.team_status;
        }, { timeout: 90000, intervals: [1000, 2000, 3000] })
        .toBe("R2_INTERVIEWING");

      await Promise.all(sessions.slice(0, 3).map((session) => completeTwoInterviewsAndEnterCards(session.page)));

      const midState = await getRound2State(request, setup.teamId, setup.members[0].id);
      expect(midState.team_status).toBe("R2_INTERVIEWING");

      for (const session of sessions.slice(3)) {
        await expect(session.page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 10000 });
        await expect(session.page.locator("[data-testid='r2-card-selection-container']")).toHaveCount(0);
      }

      await Promise.all(sessions.slice(3).map((session) => completeTwoInterviewsAndEnterCards(session.page)));

      for (const session of sessions) {
        await expect(session.page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
      }

      await Promise.all(
        sessions.slice(0, 5).map((session) => selectCardsAndSubmit(session.page, request, {
          teamId: setup.teamId,
          memberId: session.member.id,
          expectWaiting: true
        }))
      );

      const fiveOfSixState = await getRound2State(request, setup.teamId, setup.members[0].id);
      expect(fiveOfSixState.team_status).toBe("R2_INDIVIDUAL_CARDS");

      await selectCardsAndSubmit(sessions[5].page, request, {
        teamId: setup.teamId,
        memberId: sessions[5].member.id,
        expectWaiting: false
      });

      await expect
        .poll(async () => {
          const state = await getRound2State(request, setup.teamId, setup.members[0].id);
          return state.team_status;
        }, { timeout: 30000, intervals: [1000, 2000, 3000] })
        .toBe("R2_TEAM_MERGE");

      await Promise.all(sessions.map((session) => expect(session.page.locator("[data-testid='r2-merge-container']")).toBeVisible({ timeout: 30000 })));

      const mergeData = await apiGet(
        request,
        `/api/round2/team-merge?teamId=${encodeURIComponent(setup.teamId)}&memberId=${encodeURIComponent(setup.leaderMemberId)}`,
        "round2 team merge"
      );
      expect(Array.isArray(mergeData?.mergedInterview?.tags)).toBeTruthy();
      expect(mergeData.mergedInterview.tags.length).toBeGreaterThan(0);

      const leaderSession = sessions.find((session) => session.member.id === setup.leaderMemberId);
      expect(leaderSession).toBeTruthy();

      await leaderSession.page.getByRole("button", { name: /进入集体讨论/ }).click();
      await expect(leaderSession.page.locator("[data-testid='r2-price-input']")).toBeVisible({ timeout: 30000 });
      await setRangeValue(leaderSession.page, "[data-testid='r2-price-input']", priceTarget);
      await leaderSession.page.getByRole("button", { name: /确认产品方案与定价，查看结果/ }).click();
      await expect(leaderSession.page.locator("[data-testid='r2-final-submit']")).toBeVisible({ timeout: 30000 });
      await leaderSession.page.locator("[data-testid='r2-final-submit']").click();

      await expect(leaderSession.page.locator("[data-testid='r2-results-container']")).toBeVisible({ timeout: 90000 });
      const leaderProfitText = await leaderSession.page.locator("[data-testid='r2-profit-value']").innerText();
      const profitNumber = Number(String(leaderProfitText || "").replace(/[^\d.-]/g, ""));
      expect(Number.isNaN(profitNumber)).toBeFalsy();
      expect(profitNumber).not.toBe(0);

      await Promise.all(sessions.slice(1).map((session) => expect(session.page.locator("[data-testid='r2-results-container']")).toBeVisible({ timeout: 90000 })));

      await expect
        .poll(async () => {
          const state = await getRound2State(request, setup.teamId, setup.members[0].id);
          return state.team_status;
        }, { timeout: 30000, intervals: [1000, 2000, 3000] })
        .toBe("R2_SUBMITTED");

      const teamResult = await apiGet(
        request,
        `/api/round2/team-result?teamId=${encodeURIComponent(setup.teamId)}&session_id=default`,
        "round2 team result"
      );
      const resultProfit = Number(teamResult?.result?.profit);
      expect(Number.isNaN(resultProfit)).toBeFalsy();
      expect(resultProfit).not.toBe(0);
    } finally {
      await Promise.all(sessions.map(async (session) => {
        await session.context.close();
      }));
    }
  });
});
