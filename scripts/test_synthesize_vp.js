const { synthesizeVP } = require("../server/llm/vpCoach");

const session = {
  teamId: "test-synthesize-debug",
  strategy: {
    cell_label: "ToB·成本·老人",
    market: "ToB",
    segment: "Elder",
    architecture: "Hybrid",
    architecture_label: "混合型",
    grid_id: "ToB_Cost_Elder",
    jinang: {
      market: ["内容种草与达人合作", "机构客户需求挖掘"],
      tech: ["云服务与内容运营", "生物信号感知"]
    }
  },
  messages: [
    {
      role: "assistant",
      content: "你们选的方向是ToB·成本·老人，产品定位混合型——既要有功能价值，也要有情感体验。\n\n在开始之前，先看个例子。扫地机器人的价值主张不是\"它能自动扫地\"——那是功能描述。好的价值主张是这样的：\n\n\"为每天要维持家里整洁但没时间打扫的双职工家庭，提供一台能自主清扫的家用机器人，让他们不在家时地板也能保持干净——而不用请保洁或挤周末时间自己扫。\"\n\n这句话做到了三件事：说清了客户是谁和他们的处境；说清了痛点卡在哪；说清了产品带来什么变化、为什么现有方案做不到。\n\n我注意到你们团队具备市场能力：内容种草与达人合作、机构客户需求挖掘，技术能力：云服务与内容运营、生物信号感知的能力，后面可以想想怎么把这些优势用进去。\n\n提醒一下：你们选的是 ToB 市场，所以买单的客户是企业或机构，不是终端消费者个人。写价值主张时要围绕机构的需求和痛点来写。\n\n请团队讨论 2-3 分钟，写第一版——LOVOT 为什么样的企业客户、在什么场景下、解决了什么问题、为什么现有方案做不到。写好发给我。"
    },
    { role: "user", content: "不知道，你给个提示" },
    {
      role: "assistant",
      content: "你们选的是ToB·成本·老人市场，客户是服务老年人的机构，比如养老院、护理院、康复中心。\n\n这些机构普遍面临护工短缺、人力成本高的问题。你们团队有机构客户需求挖掘和生物信号感知的能力，可以想想如何用LOVOT来缓解这些压力。\n\n请先试着描述一下你们想服务的具体是哪一类机构？比如，是床位紧张的大型连锁养老院，还是人手不足的社区护理站？"
    },
    { role: "user", content: "人手不足的社区护理站" },
    {
      role: "assistant",
      content: "这个客户描述还不够具体。ToB市场的客户需要包含至少三个要素：机构类型、具体处境、决策者或规模。\n\n你提到了\"社区护理站\"（机构类型）和\"人手不足\"（处境），还缺一个要素，比如规模（例如20-50个床位）或决策者（例如站长）。\n\n请补充一下，是哪种规模、由谁决策的社区护理站？"
    },
    { role: "user", content: "决策者是站长" },
    {
      role: "assistant",
      content: "好的，现在客户是\"人手不足的社区护理站，决策者是站长\"。\n\n接下来，请描述一个具体的场景：在什么情况下，站长会最头疼\"人手不足\"这个问题？比如，是夜间巡房忙不过来，还是老人情绪安抚占用太多时间？"
    },
    { role: "user", content: "老人越来越多" },
    {
      role: "assistant",
      content: "\"老人越来越多\"这个描述还不够具体。请描述一个具体的场景：在什么情况下，站长会因为\"老人越来越多\"而最头疼人手不足的问题？\n\n例如，是午休时老人集体需要陪伴导致护工分身乏术，还是夜间突发状况增多让值班人员压力巨大？"
    },
    { role: "user", content: "老人集体需要陪伴导致护工分身乏术" },
    {
      role: "assistant",
      content: "很好，场景具体了：人手不足的社区护理站，在老人集体需要陪伴时，护工分身乏术。\n\n现在，请描述LOVOT如何解决这个问题？它创造了什么价值？比如，是分担了陪伴任务让护工能处理其他工作，还是提升了老人的情绪状态？"
    },
    {
      role: "assistant",
      content: "我帮你整理了一版，填在下方文本框里了。\n\n目前你的价值主张只提到了\"老人集体需要陪伴导致护工分身乏术\"这个场景，但客户类型（WHO）和具体的痛点、解决方案都还是\"待补充\"，完全没覆盖。\n\n你需要明确客户是谁，比如\"为养老院的管理者\"。然后说清具体问题，例如\"解决护工人手不足时，无法及时发现老人突发健康风险的问题\"。接着给出你的方案，比如\"提供一套集成了生物信号感知设备的智能监护系统\"。你们团队的生物信号感知能力正好可以用在这里，实时监测老人的关键生理指标。最后，别忘了对比现有方案（比如比单纯增加人力成本更低、响应更快），并说明边界条件（例如在设备离线或网络故障时可能失效）。\n\n补完这些再点\"提交VP\"。"
    },
    { role: "user", content: "比如提供能监测老人情绪状态并自动触发陪伴内容的智能系统；" },
    {
      role: "assistant",
      content: "你提到了一个具体的解法：用能监测老人情绪并自动触发陪伴的智能系统。\n\n现在，请把这个解法放进完整的价值主张里。说清楚：为什么样的社区护理站（规模/决策者）、在老人集体需要陪伴的场景下，这个系统创造了什么价值（比如减少了护工被占用的时间）？以及，为什么现有方案（比如增加护工或使用普通玩具）做不到？\n\n你们团队的内容运营能力，正好可以用来设计和推送适合老人的陪伴内容。"
    }
  ],
  pmfScore: {}
};

(async () => {
  try {
    const result = await synthesizeVP(session);
    const vpText = String(result?.vpText || "");
    console.log("=== synthesizeVP result ===");
    console.log("vpText:", JSON.stringify(vpText));
    console.log("vpText length:", vpText.length);
    console.log("raw:", JSON.stringify(String(result?.raw || "")));
    console.log("feedback:", String(result?.feedback || "").slice(0, 200));
    console.log("cached:", Boolean(result?.cached));

    if (!vpText.trim()) {
      console.error("BUG CONFIRMED: vpText is empty");
      process.exit(1);
    } else {
      console.log("vpText is non-empty");
      process.exit(0);
    }
  } catch (e) {
    console.error("Error:", e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
