const personaDB = {
  "B2C|差异化|体验": {
    name: "新中产家庭用户",
    mustHave: ["emotion", "dialog", "touch"],
    dealBreaker: ["privacy"],
    answers: {
      must: "我希望它能像家庭成员一样互动，情绪反馈和连续对话是刚需。",
      budget: "我能接受高价，但需要看到每天都在用。",
      process: "主要看线上口碑和线下体验店演示。",
      subscription: "如果内容持续更新，我愿意按月订阅。",
      privacy: "家里有孩子时，对摄像头和隐私处理会非常敏感。"
    }
  },
  "B2C|差异化|混合": {
    name: "家庭效率型用户",
    mustHave: ["dialog", "safety", "privacy"],
    dealBreaker: ["must-safety"],
    answers: {
      must: "互动和实用都要有，至少要覆盖家庭看护。",
      budget: "中高价能接受，但不希望后续费用不透明。",
      process: "会比较参数，也会看朋友推荐。",
      subscription: "有明确价值才会续费，比如看护报告和家庭场景技能。",
      privacy: "必须有隐私保护和本地处理选项。"
    }
  },
  "B2C|差异化|功能": {
    name: "务实看护用户",
    mustHave: ["care", "must-safety", "privacy"],
    dealBreaker: ["video"],
    answers: {
      must: "核心是稳定看护和异常检测，娱乐不是重点。",
      budget: "希望一次性投入可控，别太花哨。",
      process: "先看功能覆盖，再看售后。",
      subscription: "只有在能显著降低管理成本时才订阅。",
      privacy: "若视频频繁上传云端，我会拒绝购买。"
    }
  },
  "B2C|成本领先|体验": {
    name: "价格敏感体验尝鲜者",
    mustHave: ["voice", "experience"],
    dealBreaker: ["premium"],
    answers: {
      must: "我想要有趣，但价格不能太高。",
      budget: "更偏一次性购买，订阅低门槛才考虑。",
      process: "主要电商比价。",
      subscription: "价格高就不续。",
      privacy: "中等敏感，有明显隐私开关即可。"
    }
  },
  "B2C|成本领先|混合": {
    name: "大众家庭用户",
    mustHave: ["voice", "safety", "must-basic"],
    dealBreaker: ["premium"],
    answers: {
      must: "基础交互+实用功能就够，不需要顶配。",
      budget: "总拥有成本低最重要。",
      process: "电商促销和大平台评价。",
      subscription: "订阅要便宜且可随时停。",
      privacy: "希望默认隐私保护，设置要简单。"
    }
  },
  "B2C|成本领先|功能": {
    name: "工具导向家庭用户",
    mustHave: ["must-safety", "must-basic"],
    dealBreaker: ["emotion"],
    answers: {
      must: "只要功能稳定，不在乎花哨互动。",
      budget: "预算明确，超出就放弃。",
      process: "先看参数和售后，再决定。",
      subscription: "能省钱省事才会订。",
      privacy: "中高敏感，尤其涉及家庭监控时。"
    }
  },
  "B2B|差异化|体验": {
    name: "高端服务场景采购经理",
    mustHave: ["experience", "dialog", "navigation"],
    dealBreaker: ["must-basic"],
    answers: {
      must: "门店体验要有记忆点，互动和稳定都要。",
      budget: "可接受溢价，但要证明客流提升。",
      process: "试点->评估->集团采购。",
      subscription: "愿意买服务包，但看ROI。",
      privacy: "商用场景也必须满足合规审计。"
    }
  },
  "B2B|差异化|混合": {
    name: "机构运营负责人",
    mustHave: ["navigation", "care", "privacy"],
    dealBreaker: ["premium"],
    answers: {
      must: "要在运营效率和体验之间平衡。",
      budget: "预算可谈，但采购会压总成本。",
      process: "招标流程和供应商评估严格。",
      subscription: "若包含数据看板和维护服务，订阅可接受。",
      privacy: "需要明确数据边界与责任。"
    }
  },
  "B2B|差异化|功能": {
    name: "养老/医疗机构数字化负责人",
    mustHave: ["must-safety", "care", "privacy"],
    dealBreaker: ["emotion"],
    answers: {
      must: "核心是安全、可靠、可追溯。",
      budget: "只要可以降低运营风险，预算可放宽。",
      process: "小规模验证通过后再扩张部署。",
      subscription: "对持续服务和报表能力有支付意愿。",
      privacy: "合规红线不能碰，必须端侧或可审计。"
    }
  },
  "B2B|成本领先|体验": {
    name: "活动执行供应商",
    mustHave: ["experience", "must-basic"],
    dealBreaker: ["premium"],
    answers: {
      must: "要有基本互动效果，性价比优先。",
      budget: "按项目预算走，超预算很难过。",
      process: "短周期采购，流程简化。",
      subscription: "项目制下订阅意愿低。",
      privacy: "低到中敏感。"
    }
  },
  "B2B|成本领先|混合": {
    name: "连锁门店运营",
    mustHave: ["navigation", "must-basic", "safety"],
    dealBreaker: ["premium"],
    answers: {
      must: "更关注稳定出勤和维护成本。",
      budget: "会要求可规模复制。",
      process: "先单店试点，再区域扩张。",
      subscription: "愿意为集中管理和运维买单。",
      privacy: "希望默认合规，减少门店负担。"
    }
  },
  "B2B|成本领先|功能": {
    name: "工业园区服务集成商",
    mustHave: ["navigation", "must-safety", "privacy"],
    dealBreaker: ["emotion"],
    answers: {
      must: "任务完成率和稳定性是第一位。",
      budget: "看总体部署成本和维护费用。",
      process: "标准采购流程，重视售后SLA。",
      subscription: "对运维与远程诊断服务有持续预算。",
      privacy: "需满足企业数据治理规范。"
    }
  }
};
