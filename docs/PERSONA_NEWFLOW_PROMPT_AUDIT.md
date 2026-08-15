# Persona 注入侦察:新流程模拟三个决策点的实际 Prompt(只读)

> 对象:即将用于 sim_layered_newflow 的执行路径 = `scripts/sim/team_runner.js` + `scripts/sim/persona_student.js` **当前工作区状态**。
> 取样:`data/llm_logs/llm_2026-07-10.jsonl` 中最后一个跑次(`sim_replay_april_2026-07-10T16-17-07-732Z`,16:17 UTC 启动)的真实 LLM 调用。该跑次启动时间**晚于** persona_student.js(15:43 UTC)和 team_runner.js(16:13 UTC)的最后一次修改,且三个决策点的 prompt 已逐行与当前代码核对一致——即下面贴的就是当前工作区代码的真实产物,不是旧代码残留。
> 4 月对照取自 `llm_2026-04-05.jsonl`(旧流程当天的真实调用)。未改任何文件。生成日期:2026-07-11。

术语:**L0** = seed memory(`generateSeedMemory` 产物,行为底稿);**L1** = classroom profile(`generateClassroomProfile` 产物,课堂行为画像);**L2** = `buildBaseSystemPrompt`(仅在无 L0 时兜底,本跑次未出现);**异质性字段** = persona_pool.js 的原型字段(pricingBias/vpQuirks 等);**任务指令** = 写死在 persona_student.js 方法里的文本;**业务数据** = 运行时注入的成本/卡表/访谈内容。

---

## 1a. 决策点 A:VP 撰写(新三屏流程的直接填写)

调用:`persona_student.generateVPDraft`(persona_student.js:692),由 team_runner.js:886 触发。注意:**只有执笔人(全队学历分 WRITING_POWER 最高者)执行这一步**,其余成员不写。样本:2026-07-10T16:41:56Z,职业经理人(张天宇)。

### SYSTEM PROMPT(原文)

```
张天宇在大型消费品和金融企业历任经理、总监、事业部总经理，凭借体系化管理和数据驱动的决策风格一路晋升，期间在INSEAD完成MBA，强化了结构化思维和全球化视野。他管过数百人团队，擅长从制度流程入手推动业绩增长，但主要依赖内部汇报数据和二手研究，对一线实操细节逐渐疏远。
做决策的习惯：他决策时先要求看数据报表和模型推演，遇到不确定性会召集团队做场景分析和风险收益测算，确认风险可控后才拍板；几乎不凭直觉做决定，如果数据不足会暂缓或缩小项目范围。
讨论风格：讨论时他习惯先静听，等别人把观点都抛出来，再用“第一、第二、第三”的结构化方式总结并推进；一旦有人抛出模糊概念或缺少数据支撑的说法，他会立刻追问“有具体数字吗”或“案例是什么”，这时最来劲。
自信区：他对消费品渠道管理、地产项目投资回报测算、金融产品的业务模型优化最有信心，遇到这类议题几乎不用犹豫就能给出框架和结论。
盲区：他不太了解真实一线用户的消费场景细节和情绪动机，过度依赖后台数据，可能忽略调研样本偏差；也知道自己不接地气，但会用“数据说话”来回避深入一线。
压力下的反应：时间紧或数据不完整时，他会快速简化问题，套用过往成功案例的模型和经验框架来缩小选项，不会摆烂，但会要求团队加班补充关键数据再做最后决策。
口头禅/说话习惯：“我们看一下数据怎么说”、“第一，第二，第三……所以我的结论是”

## 课堂行为画像
{
  "abstraction_ability": "high",
  "writing_precision": "high",
  "coach_receptiveness": "low",
  "effort_style": "认真打磨",
  "team_role": "主导",
  "why_here": "突破数据依赖带来的战略盲区，获取不确定环境下的决策灵活性",
  "knowledge_ceiling": "用户研究：他习惯用二手数据和模型替代对一线用户真实场景与情绪动机的洞察，低估调研样本偏差的影响",
  "response_to_AI_coach": "会要求AI提供数据或案例支撑其建议，否则将质疑其有效性，并用结构化框架重新组织反馈内容"
}
```

### USER PROMPT(原文)

```
你们小组刚完成了战略定位的选择。你选了：ToC × 成本 × 儿童（ToC_Cost_Child），架构：Hybrid。

你刚看完 LOVOT 的产品介绍视频：一个有温度、会撒娇、能认人、能主动靠近人的陪伴机器人，日本研发，现在要进中国市场。

现在进入小组讨论环节。界面上有一个空白文本框，让每个人先写下自己对这个方向的初步想法，作为讨论的起点。AI 策略顾问会在你们写完后加入讨论，帮你们完善。

这是课堂上的第一反应，不是写方案书。
- 只写你最先想到的那个方向
- 可以模糊、可以不完整
- 不要编数据
- 不要写系统架构
- 不要把产品改成别的东西，你写的必须还是 LOVOT 这个陪伴机器人

把你的想法直接打进去，1-4 句话。
```

### 模型输出(原文)

```
LOVOT主打“情感陪伴”，成本领先要落地，核心得看两个变量：一是硬件能否通过规模化供应链压到3000元以下，二是服务收入能否覆盖后续情感交互模型的持续投入。建议先聚焦一线城市年轻独居或双职工家庭，这类人群对“省心陪伴”的付费意愿最高，也最可能接受订阅制服务费。但马上要补的数据是：日本现有用户中，月订阅续费率是多少？国内竞品如小布、天猫精灵的陪伴粘性数据如何？
```

### 分层解剖(A)

| 段落 | 来源层 |
|---|---|
| system 第 1 段(张天宇在大型消费品和金融企业……)+「做决策的习惯/讨论风格/自信区/盲区/压力下的反应/口头禅」六行 | **L0 seed memory**(`seedMemoryToText`,persona_student.js:149;内容由 L0 prompt 用 persona_pool 的 background/industry/decisionStyle/riskPreference/fullExpressionStyle/blindSpots 等字段蒸馏生成) |
| system「## 课堂行为画像」+ JSON 全文 | **L1 classroom profile**(原样 JSON.stringify 注入,buildLayeredSystemPrompt,persona_student.js:412) |
| system 末尾无「输出约束」块 | 该成员学历为 MBA 级,`getVPLengthConstraint` 返回空——**学历(persona_pool 抽样字段)间接决定此块有无** |
| user 第 1 行「你选了:ToC × 成本 × 儿童…架构:Hybrid」 | **业务数据**(团队多数投票出的格子,来自算法/投票,非本人 persona) |
| user 其余全部(产品介绍、空白文本框、五条写法要求、1-4 句话) | **任务指令**(persona_student.js:703-716 写死) |

**注意**:此决策点 user prompt 里没有任何 persona 异质性字段(vpQuirks 不在此处,只在 generatePhase1Choice 用);persona 的全部影响都通过 system prompt 的 L0+L1 进入。

---

## 1b. 决策点 B:读报告后的选卡决策

调用:`persona_student.generateCardSelection`(persona_student.js:1110),由 team_runner.js:1302 触发,每个有维度分配的成员各调一次。样本:2026-07-10T16:43:50Z,体制转型者(王建梅)。
说明:所谓"报告",实际注入的是三行结构化摘要(标签 + EVI + 维度雷达,`buildInterviewSummary`,team_runner.js:735),**不是**访谈报告全文。

### SYSTEM PROMPT(原文)

```
王建梅在央企和国企系统内工作了十几年，积累了丰富的人脉资源和项目管理经验。离开体制后，她先后在民企担任高管，并尝试自主创业，业务聚焦于基建、能源、环保、医疗和教育等政策敏感领域。
做决策的习惯：她做决策时首先会查阅相关政策和法规，确认合规性后再分析数据，很少凭直觉行事。遇到不确定性，她会主动向体制内的老同事或行业协会咨询，倾向于等待更明确的政策信号再行动。
讨论风格：在小组讨论中她通常先倾听，等大家把话说完后再发言，观点往往基于具体案例或过往项目经验。当讨论偏离政策红线或流程细节时，她会突然变得活跃，反复提醒大家注意合规和风险。
自信区：她对政策解读、项目申报、政府关系维护以及传统基建项目的全流程管理最有信心，几乎不会在这些环节犹豫。
盲区：她对互联网产品思维、用户端数据分析以及新兴技术（如AI、区块链）的实际应用缺乏了解，但会以“这些还要再看政策”来回避深入讨论。
压力下的反应：时间紧或不确定时，她会简化问题，套用过去成功的项目模板，或者直接引用相似案例的政策依据来推动决策。如果压力过大且缺乏明确政策支持，她会选择暂缓行动，并建议群体“再多走一步评估”。
口头禅/说话习惯：“这个我们再看看政策怎么说”、“建议先形成一个共识，再逐步落实。”

## 课堂行为画像
{
  "hard_labels": {
    "abstraction_ability": "low",
    "writing_precision": "medium",
    "coach_receptiveness": "low",
    "effort_style": "认真打磨",
    "team_role": "调停"
  },
  "key_judgments": {
    "why_here": "寻求从政策套利转向市场化竞争力的转型路径，但在体制外缺乏安全感，期望通过EMBA获取可复用的商业框架和合规指南。",
    "knowledge_ceiling": "卡在用户研究和产品战略：习惯自上而下的政策导向，无法理解自下而上的用户需求驱动，对数据驱动的决策和新兴技术应用存在认知盲区。",
    "response_to_AI_coach": "表面礼貌认同，但内心警惕，会要求AI提供政策合规性依据；若缺乏明确政策背书，则倾向于提出“再走一步评估”，拖延执行。"
  }
}


输出约束：
- 每个字段 2-3 句话
- 可以有基本框架但不需要很精细
- 不需要引用数据或案例
```

### USER PROMPT(原文,含完整卡表)

```
## 当前任务
你正在为 LOVOT 机器人选择研发能力卡。
## 你的访谈发现
访谈标签：情感陪伴 | 场景感知 | 情绪识别 | 语音交互 | 儿童安全 | 表情显示
证据强度 EVI：0.85
维度雷达：perception:6.7, motion:5.3, interaction:6.7, safety:6, extend:4.4, ops:6.1
## 你负责的维度
- 感知与理解（perception）
- 交互与表达（interaction）
## 预算约束
- 总 dCOGS 预算上限约 ¥703
- 每张卡有 dCOGS（增加硬件成本）和 NRE（研发固定成本）
## 可选卡列表
[
  {
    "cap_id": "voice_basic",
    "name": "语音基础",
    "dimension": "交互与表达",
    "dimensionId": "interaction_expression",
    "covers": [
      "语音交互",
      "情感陪伴"
    ],
    "tiers": {
      "low": {
        "dCOGS": 45,
        "risk": 0.05,
        "nre": 29.4
      },
      "mid": {
        "dCOGS": 84,
        "risk": 0.08,
        "nre": 29.4
      },
      "high": {
        "dCOGS": 126,
        "risk": 0.1,
        "nre": 29.4
      }
    }
  },
  {
    "cap_id": "persona_dialog",
    "name": "多轮对话个性化",
    "dimension": "交互与表达",
    "dimensionId": "interaction_expression",
    "covers": [
      "情感陪伴",
      "语音交互",
      "个性化推荐",
      "多轮对话"
    ],
    "tiers": {
      "low": {
        "dCOGS": 120,
        "risk": 0.14,
        "nre": 63.3
      },
      "mid": {
        "dCOGS": 195,
        "risk": 0.18,
        "nre": 63.3
      },
      "high": {
        "dCOGS": 285,
        "risk": 0.22,
        "nre": 63.3
      }
    }
  },
  {
    "cap_id": "touch_hug",
    "name": "触摸/拥抱交互增强",
    "dimension": "交互与表达",
    "dimensionId": "interaction_expression",
    "covers": [
      "情感陪伴"
    ],
    "tiers": {
      "low": {
        "dCOGS": 54,
        "risk": 0.07,
        "nre": 29.7
      },
      "mid": {
        "dCOGS": 105,
        "risk": 0.1,
        "nre": 29.7
      },
      "high": {
        "dCOGS": 156,
        "risk": 0.12,
        "nre": 29.7
      }
    }
  },
  {
    "cap_id": "music_companion",
    "name": "音乐播放与陪伴",
    "dimension": "交互与表达",
    "dimensionId": "interaction_expression",
    "covers": [
      "音乐播放",
      "情感陪伴"
    ],
    "tiers": {
      "low": {
        "dCOGS": 30,
        "risk": 0.05,
        "nre": 19.2
      },
      "mid": {
        "dCOGS": 60,
        "risk": 0.07,
        "nre": 19.2
      },
      "high": {
        "dCOGS": 96,
        "risk": 0.09,
        "nre": 19.2
      }
    }
  },
  {
    "cap_id": "visual_expression",
    "name": "视觉表达（OLED/灯效）",
    "dimension": "交互与表达",
    "dimensionId": "interaction_expression",
    "covers": [
      "情感陪伴",
      "表情显示"
    ],
    "tiers": {
      "low": {
        "dCOGS": 90,
        "risk": 0.06,
        "nre": 57.3
      },
      "mid": {
        "dCOGS": 180,
        "risk": 0.1,
        "nre": 57.3
      },
      "high": {
        "dCOGS": 255,
        "risk": 0.14,
        "nre": 57.3
      }
    }
  },
  {
    "cap_id": "expressive_style_pack",
    "name": "表达风格包（角色/语气/动作脚本）",
    "dimension": "交互与表达",
    "dimensionId": "interaction_expression",
    "covers": [
      "情感陪伴",
      "多轮对话"
    ],
    "tiers": {
      "low": {
        "dCOGS": 36,
        "risk": 0.04,
        "nre": 45.3
      },
      "mid": {
        "dCOGS": 75,
        "risk": 0.06,
        "nre": 45.3
      },
      "high": {
        "dCOGS": 120,
        "risk": 0.08,
        "nre": 45.3
      }
    }
  },
  {
    "cap_id": "no_screen_costdown",
    "name": "无屏降本（删OLED）",
    "dimension": "交互与表达",
    "dimensionId": "interaction_expression",
    "covers": [],
    "tiers": {
      "low": {
        "dCOGS": -75,
        "risk": 0.1,
        "nre": 18.3
      },
      "mid": {
        "dCOGS": -135,
        "risk": 0.14,
        "nre": 18.3
      },
      "high": {
        "dCOGS": -180,
        "risk": 0.18,
        "nre": 18.3
      }
    }
  },
  {
    "cap_id": "perception_base",
    "name": "基础感知（摄像头/语音融合）",
    "dimension": "感知与理解",
    "dimensionId": "perception_understanding",
    "covers": [
      "拍照功能",
      "场景感知"
    ],
    "tiers": {
      "low": {
        "dCOGS": 60,
        "risk": 0.06,
        "nre": 22.8
      },
      "mid": {
        "dCOGS": 114,
        "risk": 0.09,
        "nre": 22.8
      },
      "high": {
        "dCOGS": 165,
        "risk": 0.12,
        "nre": 22.8
      }
    }
  },
  {
    "cap_id": "emotion_recognition",
    "name": "情绪识别与表情捕捉",
    "dimension": "感知与理解",
    "dimensionId": "perception_understanding",
    "covers": [
      "情绪识别",
      "情感陪伴",
      "拍照功能"
    ],
    "tiers": {
      "low": {
        "dCOGS": 105,
        "risk": 0.12,
        "nre": 55.8
      },
      "mid": {
        "dCOGS": 180,
        "risk": 0.16,
        "nre": 55.8
      },
      "high": {
        "dCOGS": 264,
        "risk": 0.2,
        "nre": 55.8
      }
    }
  },
  {
    "cap_id": "adaptive_learning",
    "name": "自适应学习（习惯/偏好）",
    "dimension": "感知与理解",
    "dimensionId": "perception_understanding",
    "covers": [
      "个性化推荐",
      "情感陪伴",
      "记忆回溯"
    ],
    "tiers": {
      "low": {
        "dCOGS": 105,
        "risk": 0.14,
        "nre": 59.1
      },
      "mid": {
        "dCOGS": 186,
        "risk": 0.2,
        "nre": 59.1
      },
      "high": {
        "dCOGS": 270,
        "risk": 0.24,
        "nre": 59.1
      }
    }
  },
  {
    "cap_id": "memory_album",
    "name": "社交记忆（关系与偏好）",
    "dimension": "感知与理解",
    "dimensionId": "perception_understanding",
    "covers": [
      "拍照功能",
      "情感陪伴",
      "记忆回溯"
    ],
    "tiers": {
      "low": {
        "dCOGS": 75,
        "risk": 0.07,
        "nre": 31.5
      },
      "mid": {
        "dCOGS": 135,
        "risk": 0.09,
        "nre": 31.5
      },
      "high": {
        "dCOGS": 204,
        "risk": 0.12,
        "nre": 31.5
      }
    }
  },
  {
    "cap_id": "basic_avoidance",
    "name": "基础避障",
    "dimension": "运动与导航",
    "dimensionId": "mobility_navigation",
    "covers": [
      "碰撞保护",
      "自主移动"
    ],
    "tiers": {
      "low": {
        "dCOGS": 45,
        "risk": 0.08,
        "nre": 16.5
      },
      "mid": {
        "dCOGS": 90,
        "risk": 0.1,
        "nre": 16.5
      },
      "high": {
        "dCOGS": 135,
        "risk": 0.12,
        "nre": 16.5
      }
    }
  },
  {
    "cap_id": "follow_mode",
    "name": "跟随/伴行模式",
    "dimension": "运动与导航",
    "dimensionId": "mobility_navigation",
    "covers": [
      "跟随陪伴",
      "自主移动"
    ],
    "tiers": {
      "low": {
        "dCOGS": 96,
        "risk": 0.1,
        "nre": 36.6
      },
      "mid": {
        "dCOGS": 165,
        "risk": 0.12,
        "nre": 36.6
      },
      "high": {
        "dCOGS": 240,
        "risk": 0.15,
        "nre": 36.6
      }
    }
  },
  {
    "cap_id": "lidar_nav",
    "name": "室内导航与避障（LiDAR）",
    "dimension": "运动与导航",
    "dimensionId": "mobility_navigation",
    "covers": [
      "室内导航",
      "自主移动"
    ],
    "tiers": {
      "low": {
        "dCOGS": 150,
        "risk": 0.16,
        "nre": 55.2
      },
      "mid": {
        "dCOGS": 255,
        "risk": 0.2,
        "nre": 55.2
      },
      "high": {
        "dCOGS": 360,
        "risk": 0.22,
        "nre": 55.2
      }
    }
  },
  {
    "cap_id": "privacy_trust",
    "name": "隐私模式与信任保障",
    "dimension": "安全与信任",
    "dimensionId": "safety_trust",
    "covers": [
      "安全与信任",
      "隐私保护"
    ],
    "tiers": {
      "low": {
        "dCOGS": 54,
        "risk": 0.06,
        "nre": 32.1
      },
      "mid": {
        "dCOGS": 105,
        "risk": 0.08,
        "nre": 32.1
      },
      "high": {
        "dCOGS": 156,
        "risk": 0.1,
        "nre": 32.1
      }
    }
  },
  {
    "cap_id": "child_safety",
    "name": "儿童安全",
    "dimension": "安全与信任",
    "dimensionId": "safety_trust",
    "covers": [
      "儿童安全"
    ],
    "tiers": {
      "low": {
        "dCOGS": 75,
        "risk": 0.08,
        "nre": 33.9
      },
      "mid": {
        "dCOGS": 135,
        "risk": 0.1,
        "nre": 33.9
      },
      "high": {
        "dCOGS": 195,
        "risk": 0.12,
        "nre": 33.9
      }
    }
  },
  {
    "cap_id": "family_guardian",
    "name": "家庭监护（告警/权限/记录）",
    "dimension": "安全与信任",
    "dimensionId": "safety_trust",
    "covers": [
      "隐私保护",
      "儿童安全",
      "远程控制"
    ],
    "tiers": {
      "low": {
        "dCOGS": 126,
        "risk": 0.14,
        "nre": 60.3
      },
      "mid": {
        "dCOGS": 225,
        "risk": 0.24,
        "nre": 60.3
      },
      "high": {
        "dCOGS": 315,
        "risk": 0.3,
        "nre": 60.3
      }
    }
  },
  {
    "cap_id": "cloud_update",
    "name": "云端智更新（灰度/回滚/遥测）",
    "dimension": "可扩展与连接",
    "dimensionId": "expand_connect",
    "covers": [
      "OTA更新"
    ],
    "tiers": {
      "low": {
        "dCOGS": 45,
        "risk": 0.08,
        "nre": 28.2
      },
      "mid": {
        "dCOGS": 90,
        "risk": 0.1,
        "nre": 28.2
      },
      "high": {
        "dCOGS": 144,
        "risk": 0.12,
        "nre": 28.2
      }
    }
  },
  {
    "cap_id": "api_iot",
    "name": "API / IoT 联动",
    "dimension": "可扩展与连接",
    "dimensionId": "expand_connect",
    "covers": [
      "智能家居",
      "家庭版"
    ],
    "tiers": {
      "low": {
        "dCOGS": 75,
        "risk": 0.08,
        "nre": 34.2
      },
      "mid": {
        "dCOGS": 135,
        "risk": 0.1,
        "nre": 34.2
      },
      "high": {
        "dCOGS": 204,
        "risk": 0.12,
        "nre": 34.2
      }
    }
  },
  {
    "cap_id": "edu_content",
    "name": "教育内容",
    "dimension": "可扩展与连接",
    "dimensionId": "expand_connect",
    "covers": [
      "教育内容",
      "家庭版"
    ],
    "tiers": {
      "low": {
        "dCOGS": 60,
        "risk": 0.07,
        "nre": 30.6
      },
      "mid": {
        "dCOGS": 114,
        "risk": 0.09,
        "nre": 30.6
      },
      "high": {
        "dCOGS": 174,
        "risk": 0.12,
        "nre": 30.6
      }
    }
  },
  {
    "cap_id": "self_diag",
    "name": "自诊断",
    "dimension": "可运营与可维护",
    "dimensionId": "ops_maintenance",
    "covers": [
      "OTA更新"
    ],
    "tiers": {
      "low": {
        "dCOGS": 39,
        "risk": 0.06,
        "nre": 12.6
      },
      "mid": {
        "dCOGS": 78,
        "risk": 0.07,
        "nre": 12.6
      },
      "high": {
        "dCOGS": 120,
        "risk": 0.08,
        "nre": 12.6
      }
    }
  },
  {
    "cap_id": "remote_monitor",
    "name": "远程监控",
    "dimension": "可运营与可维护",
    "dimensionId": "ops_maintenance",
    "covers": [
      "OTA更新",
      "远程控制"
    ],
    "tiers": {
      "low": {
        "dCOGS": 60,
        "risk": 0.06,
        "nre": 23.4
      },
      "mid": {
        "dCOGS": 114,
        "risk": 0.07,
        "nre": 23.4
      },
      "high": {
        "dCOGS": 174,
        "risk": 0.08,
        "nre": 23.4
      }
    }
  },
  {
    "cap_id": "predictive_maint",
    "name": "预测性维护",
    "dimension": "可运营与可维护",
    "dimensionId": "ops_maintenance",
    "covers": [
      "OTA更新"
    ],
    "tiers": {
      "low": {
        "dCOGS": 105,
        "risk": 0.1,
        "nre": 51.6
      },
      "mid": {
        "dCOGS": 195,
        "risk": 0.14,
        "nre": 51.6
      },
      "high": {
        "dCOGS": 285,
        "risk": 0.18,
        "nre": 51.6
      }
    }
  }
]
请选择 6-10 张卡，只输出可 JSON.parse 的 JSON：
{
  "selections": [
    { "cap_id": "xxx", "tier": "mid", "reason": "一句话理由" }
  ]
}
选卡原则：
- 优先选跟访谈发现相关的卡
- 你负责的维度必须选卡
- 必须满足卡之间的依赖关系，不能选出有硬性 requires/excludes 冲突的组合
- 不要超预算
- tier 选择反映你的风险偏好
```

### 模型输出(原文)

```
{
  "selections": [
    {
      "cap_id": "voice_basic",
      "tier": "low",
      "reason": "情感陪伴和语音交互是核心需求，低风险低投入确保基础功能合规落地。"
    },
    {
      "cap_id": "touch_hug",
      "tier": "low",
      "reason": "增强情感陪伴的触摸交互，低风险且成本可控，符合儿童安全场景。"
    },
    {
      "cap_id": "visual_expression",
      "tier": "low",
      "reason": "表情显示覆盖情感陪伴需求，低风险起步，后续可升级。"
    },
    {
      "cap_id": "expressive_style_pack",
      "tier": "low",
      "reason": "低风险低成本丰富情感表达，强化交互体验。"
    },
    {
      "cap_id": "perception_base",
      "tier": "low",
      "reason": "感知维度必选，基础场景感知支撑交互，低风险稳妥。"
    },
    {
      "cap_id": "emotion_recognition",
      "tier": "low",
      "reason": "情绪识别是访谈核心，低风险起步确保合规，不超预算。"
    },
    {
      "cap_id": "memory_album",
      "tier": "low",
      "reason": "社交记忆增强情感陪伴，低风险低投入，满足记忆回溯需求。"
    },
    {
      "cap_id": "privacy_trust",
      "tier": "low",
      "reason": "隐私保护是合规底线，低风险小成本保障信任。"
    },
    {
      "cap_id": "child_safety",
      "tier": "low",
      "reason": "儿童安全是必须的合规项，低风险投入确保政策红线不碰。"
    }
  ]
}
```

### 分层解剖(B)

| 段落 | 来源层 |
|---|---|
| system 第 1 段 + 六行行为底稿 | **L0 seed memory** |
| system「## 课堂行为画像」JSON(此样本是 hard_labels/key_judgments 嵌套结构——L1 由 LLM 生成,结构随机漂移,代码原样注入不校验) | **L1 classroom profile** |
| system 末尾「输出约束:每个字段 2-3 句话……」 | **学历派生**(`getVPLengthConstraint("本科…")`;注意这是**为写 VP 设计的约束**,被无差别拼进选卡任务的 system prompt——见"变形"节) |
| user「## 你的访谈发现」:访谈标签/证据强度 EVI:0.85/维度雷达 perception:6.7… | **业务数据**(该成员自己访谈的产出;EVI 与雷达是 endInterview 返回给玩家 UI 的数值) |
| user「## 你负责的维度」 | **业务数据**(维度分配来自 assign-dimensions,算法/服务端) |
| user「## 预算约束 ¥703」 | **业务数据(引擎派生)**:team_runner.js:1280 `budgetCap = round(Pmax×0.2)`——见泄漏检查 |
| user「## 可选卡列表」JSON 全文 | **业务数据**(getRDCards 扁平化,含每卡 dCOGS/risk/NRE 三档) |
| user 选卡要求 + 六条选卡原则(其中「tier 选择反映你的风险偏好」是唯一显式点到 persona 的话——但风险偏好本身只存在于 system prompt 的 L0 里) | **任务指令** |

---

## 1c. 决策点 C:定价(1 号成员)

调用:`persona_student.generatePriceChoice`(persona_student.js:976),由 team_runner.js:1392 触发。**定价人硬编码为 members[0](1 号成员)**,且是 `createStudentActor` 新建的 actor。样本:2026-07-10T16:43:52Z,草根老板。

### SYSTEM PROMPT(原文)

```
做决策的习惯：
讨论风格：
自信区：
盲区：
压力下的反应：
口头禅/说话习惯：


输出约束（重要）：
- 每个字段用 1-2 句话说，总共不超过 80 字
- 不要用商业术语，用日常用语
- 你可以写"老人""小孩""白领"这种大类，不需要精确细分
- 不需要分析替代方案或边界条件
```

### USER PROMPT(原文)

```
## 当前场景
你需要为 LOVOT 定价。
你的定价倾向：敢定高价，好东西就该卖贵

已知信息：
成本侧：
- 你的产品单台可变成本约 ¥1968（基础硬件 ¥600 + 能力卡增量 dCOGS ¥1368）
- 前期投入约 541 万元（基础固定投入 Fbase 150 万元 + 研发 NRE 391 万元）
- 渠道抽成：25%（例如定价 ¥4000，实际到手 ¥3000）

需求侧：客户谈到的消费能力/价格态度线索
- 陈晓雯：哎，说到这个我还真有点担心。我跟我老公都是早出晚归的，白天孩子在幼儿园。买个东西要是三天两头出问题，那可真是添堵。最好就是那种插上电就能用的，别太复杂。
- 陈晓雯：这个我还真没想过具体多少钱，但要是能像换手机那样，坏了直接换个新的，那当然最好。不过价格别太贵啊，毕竟就是个陪孩子的机器人，总不能比买个iPad还贵吧？
- 王敏：（笑）说实话，要求它完全搞懂因果关系可能太难了，毕竟我自己有时候都搞不懂。但至少能帮我发现一些规律吧。比如我女儿每次从幼儿园回来特别安静的时候，第二天就不太愿意去上学——这种模式如果能提醒我，我就知道要提前跟她聊聊，或者跟老师沟通一下。不…
- 林芳：对，能提醒一下肯定好，就像倒车雷达那种感觉。至于玩具...说实话，我更希望它能绕过去。因为要我清路实在太不现实了，孩子刚收拾好，转眼又扔一地。要是每次都要我清路，那我买它干嘛呀，反而添麻烦了。
- 林芳：我们家还真有个小台阶，客厅到走廊那里有个门槛。我老公之前买过一个扫地机器人，就经常卡在那儿。所以我觉得它得能识别这种高低差吧，别老卡住。至于地毯...我们家有块厚地毯，我觉得它走起来别东倒西歪的就行，要不然看着也不放心。

定价区间：¥1000 - ¥6000
滑块步长：¥100
这个区间是课堂 UI 的硬边界，不是建议。低于最低值或高于最高值都会提交失败。
不要输出低于区间或高于区间的价格，也不要把区间端点当作建议价。

请输出 JSON，不要输出多余文字：
{"price": 4000, "reason": "一句话说明你的定价依据"}
```

### 模型输出(原文)

```
{"price": 6000, "reason": "好东西就该卖贵，客户愿意为省心买单，高价也能覆盖渠道抽成和研发成本。"}
```

### 分层解剖(C)

| 段落 | 来源层 |
|---|---|
| system 前六行(做决策的习惯:/讨论风格:/……全部为空) | **L0 seed memory 的空壳**。定价 actor 是 team_runner.js:1375 现场 new 的 PersonaStudent,**没跑过 generateSeedMemory**,构造函数里 `seedMemoryToText({})` 产出六个空标签。**L0 实际内容 = 零,L1 完全缺失** |
| system「输出约束(重要):每个字段用 1-2 句话……」 | **学历派生**(草根老板抽到大专;同样是写 VP 的约束被拼进定价任务) |
| user「你的定价倾向:敢定高价,好东西就该卖贵」 | **persona_pool 异质性字段 `pricingBias`**(全流程唯一显式进入定价 prompt 的 persona 字段) |
| user 成本侧三行(可变成本 ¥1968 = 基础 ¥600 + dCOGS ¥1368;前期投入 541 万 = Fbase 150 万 + NRE 391 万;渠道抽成 25%) | **业务数据**(summarizeSelectionCosts 按团队合并选卡实算,team_runner.js:90;渠道费率由格子 ToB/ToC 决定) |
| user 需求侧五条客户原话(陈晓雯/王敏/林芳…) | **业务数据**(buildPricingDemandSummary,team_runner.js:156:从本队访谈记录里按 18 个价格类关键词过滤受访者原话,截 120 字,至多 6 条) |
| user「定价区间 ¥1000-¥6000 / 滑块步长 ¥100 / 这是 UI 硬边界不是建议 / 不要把端点当建议价」 | **任务指令 + 配置数据**(round2_engine_params.json 的 pricing_ui 固定值,与 WTP 无关) |
| user「请输出 JSON …{"price":…,"reason":…}」 | **任务指令**(输出不合法滑块值时最多重试 3 次,persona_student.js:1051) |

---

## 2. 与 4 月旧流程对照

4 月样本取自 `llm_2026-04-05.jsonl`(4 月 12 格跑当天的真实调用)。

### 2a. VP 撰写对照

4 月 USER PROMPT 原文:

```
你们小组刚完成了战略定位的选择。你选了：ToB × 差异化 × 老人（ToB_Differentiation_Elder），架构：Experience。

你刚看完 LOVOT 的产品介绍视频：一个有温度、会撒娇、能认人、能主动靠近人的陪伴机器人，日本研发，现在要进中国市场。

现在进入小组讨论环节。界面上有一个空白文本框，让每个人先写下自己对这个方向的初步想法，作为讨论的起点。AI 策略顾问会在你们写完后加入讨论，帮你们完善。

这是课堂上的第一反应，不是写方案书。
- 只写你最先想到的那个方向
- 可以模糊、可以不完整
- 不要编数据
- 不要写系统架构
- 不要把产品改成别的东西，你写的必须还是 LOVOT 这个陪伴机器人

把你的想法直接打进去，1-4 句话。
```

4 月 SYSTEM PROMPT 原文(职业经理人,当日样本):

```
海外MBA毕业后进入大型企业管培体系，凭借体系化思考和团队管理能力在消费品、金融等板块轮岗晋升。从带十几人团队到负责数百人事业部，熟悉大型组织运作规则和跨部门协作流程。
做决策的习惯：必须先看到数据框架和模型推演才会进入决策流程，遇到不确定性会要求团队补充对标案例或历史数据。如果数据不足但时间紧迫，会采用‘可控风险框架’划定容忍区间再拍板。
讨论风格：通常在前三个发言者内就会提出讨论框架（比如‘我们可以从三个维度看这个问题’），听到逻辑跳跃或缺乏数据支撑的论点时会直接打断追问。看到有人用新颖模型分析老问题时会突然来劲。
自信区：对组织架构设计、跨部门资源调配、市场进入策略的ROI测算等涉及系统优化的问题判断极快，这类问题常直接说‘这个我们按XX模型走就行’。
盲区：容易忽略一线执行中的非标准化障碍（例如渠道商的实际库存管理习惯），有时会把第三方咨询报告的数据直接当作决策依据。意识到自己不懂具体技术细节时会用‘先抓主要矛盾’转移话题。
压力下的反应：会迅速简化问题到2-3个核心变量，套用过往成功案例的框架快速输出方案。如果时间实在不够，会要求团队‘先按70分版本执行，迭代数据出来再优化’。
口头禅/说话习惯：开会常说‘我们拆解一下这个问题’，汇报时喜欢用‘从数据层面来看’作为观点开头。

## 课堂行为画像
{
  "abstraction_ability": "high",
  "writing_precision": "high",
  "coach_receptiveness": "medium",
  "effort_style": "认真打磨",
  "team_role": "主导",
  "why_here": "突破大型组织体系化思维惯性，寻找第二曲线创新方法论与可复制的非标问题解决框架。",
  "knowledge_ceiling": "用户研究——容易将用户行为数据化、模型化，但难以捕捉非理性、情境化、未被表达的深层需求。",
  "response_to_AI_coach": "会要求AI解释其建议背后的逻辑框架与数据来源，若符合其系统思维则积极采纳，若为黑箱或缺乏对标案例则持怀疑态度。"
}
```

**结论:VP 撰写这个决策点,4 月与新版逐字相同**(system 都是 L0+L1+学历约束;user 模板一字未动,仅格子名不同)。无少/无多/无变形。

### 2b. 选卡对照

4 月 SYSTEM 原文:

```
从工厂车间或档口白手起家，吃到了中国制造和外贸的时代红利，企业年营收几千万到几个亿
做决策的习惯：快速拍板、凭直觉和经验、不喜欢过度分析
讨论风格：直接、接地气、用大白话说复杂的事、喜欢打比方

你的思维特征（MBTI: ESTP）：
你在小组讨论中倾向主动发言、提出观点，不怕表达不同意见。
你关注具体的事实和细节，喜欢用实际案例说话，不太信空洞的理论。
你做决策偏逻辑分析，写 VP 时注重因果关系和数据支撑，访谈时关注功能和效率。
你喜欢保持开放、多探索可能性，讨论时可能提出意外角度，但有时拖延决策。
自信区：制造业、外贸、建材、农产品加工里的判断最有把握。
盲区：VP 写得接地气但缺结构，容易从自身经验出发而非用户视角
压力下的反应：时间紧时会回到自己最熟悉的经验套路。
口头禅/说话习惯：先把关键点讲清楚。

## 课堂行为画像
{
  "abstraction_ability": "low",
  "writing_precision": "medium",
  "coach_receptiveness": "medium",
  "effort_style": "先交差后面改",
  "team_role": "主导",
  "why_here": "寻找企业突破增长瓶颈或转型的实战路径，而非学习理论框架",
  "knowledge_ceiling": "用户研究（因习惯从自身经验出发，缺乏系统理解用户需求的视角和方法）",
  "response_to_AI_coach": "会快速抓住AI建议中的几个关键点，结合自身经验判断是否“有用”，若感觉不接地气或与直觉不符会直接质疑或忽略"
}


输出约束（非常重要）：
- 用一句大白话说你想做什么生意，不要分段
- WHO/PAIN/HOW 每个字段不超过 20 个字
- 不要用任何商业术语或框架
- 写出来应该像跟朋友聊天，不像写报告
- 示例风格："就是给养老院卖个能陪老人说话的机器人"
```

4 月 USER 开头(结构与新版逐字一致,仅数值不同):

```
## 当前任务
你正在为 LOVOT 机器人选择研发能力卡。
## 你的访谈发现
访谈标签：场景感知 | 自主移动 | 个性化推荐 | 家庭版 | 自动充电 | 语音交互
证据强度 EVI：0.85
维度雷达：perception:6.7, motion:6.7, interaction:6, safety:5.7, extend:5.6, ops:6.3
## 你负责的维度
- 运动与导航（motion）
- 感知与理解（perception）
## 预算约束
- 总 dCOGS 预算上限约 ¥2840
- 每张卡有 dCOGS（增加硬件成本）和 NRE（研发固定成本）
## 可选卡列表
[
  {
    "cap_id": "voice_basic",
    "name": "语音基础",
    "dimension": "交互与表达",
    "dimensionId": "interaction_expression",
    "covers": [
      "语音交互",
      "情感陪伴"
    ],
    "tiers": {
      "low": {
        "dCOGS": 150,
        "risk": 0.05,
        "nre": 98
      },
      "mid": {
        "dCOGS": 280,
        "risk": 0.08,
        "nre": 98
      },
      "high": {
        "dCOGS": 420,

…（其后为完整卡表 JSON，结构与新版逐字一致，仅 dCOGS/NRE 数值为旧水位，略）
```

| 维度 | 4 月 | 新版 | 判定 |
|---|---|---|---|
| prompt 模板(任务指令/分节/选卡原则) | 同 | 同 | **不变** |
| 访谈发现注入(标签+EVI+雷达) | 有,同格式 | 有,同格式 | **不变**(4 月就已注入 EVI/雷达) |
| 预算上限 | ¥2840(=0.2×当时 Pmax) | ¥703(=0.2×新 Pmax) | **数值缩放**(引擎价格水位整体重标定,见 commit「scale round2 price waterline / cost reference anchor」) |
| 卡表数值 | voice_basic low dCOGS 150 / nre 98 | 同卡 45 / 29.4 | **数值缩放**(约 ÷3.3,卡结构不变) |
| 本样本 L0 | 注意:4 月这份样本的 L0 是**无 API key 时的代码兜底拼接**(直接搬 persona_pool 原文 + MBTI 四句),不是 LLM 生成的底稿 | LLM 生成的底稿 | 同一代码路径,差异来自当次是否走了 LLM,非流程变更 |

### 2c. 定价对照(变化最大的决策点)

4 月 SYSTEM + USER 原文:

```
做决策的习惯：
讨论风格：
自信区：
盲区：
压力下的反应：
口头禅/说话习惯：
```

```
## 当前场景
你需要为 LOVOT 定价。
你的定价倾向：倾向低估定价重要性，产品好自然有人买

已知信息：
- 硬件成本：¥2000
- 渠道抽成：15%（定价 ¥10000，实际到手 ¥8500）
- 定价越高单台赚越多但愿意买的人越少，定价越低买的人越多但可能亏本

定价区间：¥10948 - ¥26274

直接输出一个价格数字（整数），不要解释。
```

4 月输出:`15000`

**新版比 4 月【少了什么】**
1. 少了 WTP 派生的定价区间:4 月的「定价区间 ¥10948 - ¥26274」= pricingBase×0.5 ~ ×1.2,而 pricingBase 直接来自引擎 Pmax/WTP(¥10948×2 = ¥26274÷1.2 = 21895)——**旧版把 WTP 锚点变相塞给了学生**。新版换成 round2_engine_params.json 里写死的 UI 滑块 ¥1000-¥6000,与需求参数完全脱钩。
2. 少了需求曲线提示:「定价越高单台赚越多但愿意买的人越少,定价越低买的人越多但可能亏本」这句机制说明被删了。

**新版比 4 月【多了什么】**
1. 多了需求侧证据:从本队访谈记录里筛出的客户价格态度原话(至多 6 条、每条 ≤120 字)——4 月定价时学生完全看不到访谈内容。
2. 多了成本结构分解:4 月只有一行「硬件成本 ¥2000」;新版给出 基础硬件 + 选卡 dCOGS 增量 + Fbase + NRE 的完整拆解(按团队实际选卡实算)。
3. 多了滑块约束语义:步长 ¥100、「硬边界不是建议」「别把端点当建议价」,并有最多 3 轮的合法性重试(非法输出会被追加纠错消息重问)。
4. 多了结构化输出:从裸数字改为 `{"price", "reason"}` JSON,定价理由第一次被留存。

**【变形了什么】**
1. 输出协议变形:裸整数 → JSON;解析从正则 `\d{4,6}` 变为 JSON 解析 + 滑块合法性校验 + 重试环。
2. 渠道抽成示例价变形:¥10000 → ¥4000(适配新价格水位)。
3. **没修的旧病(两版同在)**:定价 actor 是现场新建的,L0 六个字段全空、L1 缺失——4 月 system 是 40 字空壳,新版是空壳 + 学历约束。persona 对定价的实际输入只剩 user prompt 里那一行 `pricingBias`(以及空壳里附带的学历长度约束——一个为写 VP 设计的约束被拼进了定价任务)。

---

## 3. 泄漏检查清单

扫描范围:最终跑次(16:17-16:59 UTC)全部 `persona_student.*` 调用的 messages 全文,token 级检索。

| 检查项 | 结果 | 说明 |
|---|---|---|
| WTPref 数值 | **未发现** | `WTPref`/`wtp_ref`/`WTPadj` 零命中；定价提示只携带 UI 最低/最高提交边界，不携带步长、默认值或 WTP 信息 |
| dimension_evidence | **未发现** | 该字段只存在于服务端访谈提取管线(round2Routes.js:656,grid_dimension_evidence_v1.json),未进任何 persona prompt |
| 维度权重 | **未发现** | 「权重」一词零命中,引擎权重参数未注入 |
| 建议价 | **未发现数值型建议价** | 「建议价」字样命中 14 次,**全部**是定价 prompt 里的否定指令「不要把区间端点当作建议价」;无任何建议价数值注入 |
| covered/uncovered_keywords | **未发现** | vpWordScorer 内部字段,零命中 |

**五项检查全部通过,无红项。** 两条黄色备注(不在清单五项内,但属同类风险,如实报告):

- 🟡 **选卡预算上限 = 0.2×Pmax**(team_runner.js:1280):¥703 这个数是引擎需求参数 Pmax(=3515)的确定性函数,理论上可反推 Pmax=5×预算。它不是 WTPref,但属于"需求侧引擎参数以派生值形式进入 prompt"的同族问题;4 月同样存在(当时 ¥2840)。
- 🟡 **EVI 数值与六维雷达分数注入选卡 prompt**:这两个是 endInterview 返回给玩家 UI 的可见数据(访谈结果页),不算引擎内参泄漏;但雷达分数是引擎打的分而非学生自己的判断,注入后学生 LLM 会直接按分数высок的维度选卡。4 月起就是这个形态,非新版引入。

**对照结论**:4 月旧流程唯一的真泄漏(WTP 派生定价区间)在新版已被消除;新版没有引入清单内的任何新泄漏。
