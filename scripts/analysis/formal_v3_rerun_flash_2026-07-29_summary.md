# formal_v3_rerun_flash_2026-07-29 Summary

> 论文口径起算轮；N=3，描述性均值与 min–max 区间，不做显著性检验。

## Completion

- OK: 42/42
- Q: 21/21
- S: 21/21
- manifest_version: 651e10d45c15475bca62fcc4e868a75031645ef409e193f476e9f539d5500a96
- bandwidth: OFF
- IMP: absent from manifest

## 1. 盈利率与利润

| scope | condition | n | profitable | rate | profit mean [min, max] |
|---|---|---:|---:|---:|---:|
| 含全部 persona | Q | 21 | 11 | 52.4% | 7661042 [-4686200, 51926275] |
| 含全部 persona | S | 21 | 19 | 90.5% | 11020123 [-4143648, 55109296] |
| 除体制转型者 | Q | 18 | 8 | 44.4% | 5224742 [-4686200, 37595451] |
| 除体制转型者 | S | 18 | 16 | 88.9% | 7451416 [-4143648, 31831788] |
- Paired Q−S（全部，n=21）：profit -3359081 [-53720458, 39162218]；盈利率差 -38.1 pp；price -557 [-2000, 1300]。
- Paired Q−S（除体制，n=18）：profit -2226673 [-22262133, 35131032]；盈利率差 -44.4 pp；price -533 [-2000, 1300]。

## 2. 逐 persona 价格

| persona | Q prices | Q mean | S prices | S mean | Q mean < S mean |
|---|---|---:|---|---:|---|
| 草根老板 | 3000 / 1000 / 1500 | 1833 | 2900 / 2900 / 2900 | 2900 | yes |
| 二代接班人 | 2900 / 3000 / 3900 | 3267 | 4900 / 3800 / 3200 | 3967 | yes |
| 体制转型者 | 3800 / 2800 / 2800 | 3133 | 3800 / 2900 / 4800 | 3833 | yes |
| 职业经理人 | 2900 / 1000 / 2900 | 2267 | 1600 / 1800 / 2900 | 2100 | no |
| 销售铁军 | 1200 / 2900 / 3900 | 2667 | 2500 / 2900 / 2900 | 2767 | yes |
| 技术创业者 | 2000 / 1500 / 2400 | 1967 | 2200 / 2900 / 2800 | 2633 | yes |
| 互联网PM转型 | 1900 / 2800 / 1500 | 2067 | 2900 / 2900 / 2900 | 2900 | yes |

- 降价方向正式存活率：6/7 persona。

## 3. Q 问题稳定性

| persona | signature axis | recurrence | stages/reps hit |
|---|---|---:|---|
| 草根老板 | 试单/现金/回款 | 5/9 | r1-D4、r1-D5、r3-R1、r3-D4、r3-D5 |
| 二代接班人 | 品质/背书/长期 | 5/9 | r2-R1、r2-D5、r3-R1、r3-D4、r3-D5 |
| 体制转型者 | 政策/政府/集采 | 1/9 | r1-D5 |
| 职业经理人 | 流程/KPI/组织 | 0/9 | - |
| 销售铁军 | 成交/渠道/客户 | 5/9 | r2-R1、r2-D4、r2-D5、r3-R1、r3-D4 |
| 技术创业者 | 技术/架构/工程 | 3/9 | r2-R1、r3-R1、r3-D4 |
| 互联网PM转型 | 用户/数据/迭代 | 1/9 | r1-D4 |

## 4. IMP 移除后的 D3→D4 感知

| persona/cond/rep | D3 top radar | D4 selected in top dimension | tier distribution | 承前:D3 refs | D3 themes echoed in D4 reason |
|---|---|---|---|---:|---|
| 草根老板/Q/r1 | perception=10.0 | perception_understanding: 1张, mean tier 1.0 | L8/M1/H0 | 0 | - |
| 草根老板/Q/r2 | interaction=10.0 | interaction_expression: 5张, mean tier 1.2 | L9/M1/H0 | 0 | - |
| 草根老板/Q/r3 | interaction=10.0 | interaction_expression: 5张, mean tier 1.0 | L10/M0/H0 | 1 | - |
| 草根老板/S/r1 | interaction=10.0 | interaction_expression: 2张, mean tier 1.0 | L7/M0/H0 | 3 | - |
| 草根老板/S/r2 | interaction=10.0 | interaction_expression: 2张, mean tier 1.5 | L7/M1/H0 | 1 | - |
| 草根老板/S/r3 | interaction=10.0 | interaction_expression: 4张, mean tier 1.0 | L9/M0/H0 | 1 | - |
| 二代接班人/Q/r1 | interaction=10.0 | interaction_expression: 2张, mean tier 2.0 | L2/M7/H0 | 3 | - |
| 二代接班人/Q/r2 | interaction=10.0 | interaction_expression: 3张, mean tier 1.0 | L9/M0/H0 | 1 | - |
| 二代接班人/Q/r3 | interaction=10.0 | interaction_expression: 2张, mean tier 2.0 | L3/M5/H0 | 4 | - |
| 二代接班人/S/r1 | interaction=10.0 | interaction_expression: 3张, mean tier 2.0 | L1/M8/H0 | 1 | - |
| 二代接班人/S/r2 | interaction=10.0 | interaction_expression: 3张, mean tier 2.0 | L3/M7/H0 | 3 | - |
| 二代接班人/S/r3 | perception=10.0 | perception_understanding: 1张, mean tier 2.0 | L1/M9/H0 | 2 | 陪伴焦虑 |
| 体制转型者/Q/r1 | operations=10.0 | ops_maintenance: 2张, mean tier 1.5 | L2/M6/H0 | 2 | - |
| 体制转型者/Q/r2 | operations=10.0 | ops_maintenance: 2张, mean tier 2.0 | L2/M7/H1 | 2 | - |
| 体制转型者/Q/r3 | interaction=10.0 | interaction_expression: 3张, mean tier 2.0 | L4/M7/H0 | 3 | - |
| 体制转型者/S/r1 | safety_privacy=10.0 | safety_trust: 2张, mean tier 2.0 | L2/M6/H0 | 2 | - |
| 体制转型者/S/r2 | safety_privacy=10.0 | safety_trust: 2张, mean tier 1.5 | L2/M5/H0 | 3 | - |
| 体制转型者/S/r3 | operations=10.0 | ops_maintenance: 1张, mean tier 2.0 | L0/M6/H0 | 1 | - |
| 职业经理人/Q/r1 | interaction=10.0 | interaction_expression: 4张, mean tier 1.5 | L8/M2/H0 | 0 | - |
| 职业经理人/Q/r2 | interaction=10.0 | interaction_expression: 4张, mean tier 1.5 | L8/M0/H1 | 1 | - |
| 职业经理人/Q/r3 | interaction=10.0 | interaction_expression: 3张, mean tier 1.7 | L5/M4/H0 | 4 | - |
| 职业经理人/S/r1 | interaction=10.0 | interaction_expression: 3张, mean tier 1.7 | L6/M2/H0 | 2 | - |
| 职业经理人/S/r2 | interaction=10.0 | interaction_expression: 4张, mean tier 1.5 | L8/M0/H1 | 3 | - |
| 职业经理人/S/r3 | interaction=10.0 | interaction_expression: 3张, mean tier 2.0 | L2/M8/H0 | 3 | - |
| 销售铁军/Q/r1 | interaction=10.0 | interaction_expression: 2张, mean tier 1.0 | L9/M0/H0 | 4 | 情感补偿需求 |
| 销售铁军/Q/r2 | perception=10.0 | perception_understanding: 3张, mean tier 1.0 | L5/M5/H0 | 4 | - |
| 销售铁军/Q/r3 | interaction=10.0 | interaction_expression: 4张, mean tier 1.8 | L4/M7/H0 | 1 | - |
| 销售铁军/S/r1 | interaction=10.0 | interaction_expression: 3张, mean tier 2.0 | L1/M9/H0 | 2 | - |
| 销售铁军/S/r2 | interaction=10.0 | interaction_expression: 2张, mean tier 2.0 | L3/M7/H0 | 1 | - |
| 销售铁军/S/r3 | interaction=10.0 | interaction_expression: 3张, mean tier 2.0 | L2/M8/H0 | 4 | - |
| 技术创业者/Q/r1 | operations=10.0 | ops_maintenance: 1张, mean tier 1.0 | L5/M2/H0 | 2 | - |
| 技术创业者/Q/r2 | safety_privacy=10.0 | safety_trust: 1张, mean tier 1.0 | L8/M0/H0 | 2 | - |
| 技术创业者/Q/r3 | safety_privacy=10.0 | safety_trust: 1张, mean tier 2.0 | L4/M3/H0 | 5 | - |
| 技术创业者/S/r1 | safety_privacy=10.0 | safety_trust: 2张, mean tier 1.0 | L5/M2/H0 | 4 | - |
| 技术创业者/S/r2 | interaction=10.0 | interaction_expression: 1张, mean tier 2.0 | L6/M2/H0 | 4 | - |
| 技术创业者/S/r3 | perception=10.0 | perception_understanding: 1张, mean tier 1.0 | L6/M0/H0 | 5 | - |
| 互联网PM转型/Q/r1 | perception=10.0 | perception_understanding: 1张, mean tier 1.0 | L9/M1/H0 | 2 | - |
| 互联网PM转型/Q/r2 | operations=10.0 | ops_maintenance: 2张, mean tier 1.0 | L6/M2/H0 | 2 | - |
| 互联网PM转型/Q/r3 | operations=10.0 | ops_maintenance: 1张, mean tier 1.0 | L5/M1/H0 | 1 | - |
| 互联网PM转型/S/r1 | safety_privacy=10.0 | safety_trust: 2张, mean tier 1.5 | L4/M4/H0 | 2 | - |
| 互联网PM转型/S/r2 | interaction=10.0 | interaction_expression: 3张, mean tier 1.3 | L5/M3/H0 | 2 | - |
| 互联网PM转型/S/r3 | safety_privacy=10.0 | safety_trust: 2张, mean tier 1.5 | L6/M3/H0 | 2 | - |

> 新口径无 IMP 表；本节只描述 D3 radar、承前引用与 tier 对应，不与旧 infoset_v3 的 IMP 响应率混比。

## 5. 格子稳定性矩阵

| persona | Q1 | Q2 | Q3 | S1 | S2 | S3 |
|---|---|---|---|---|---|---|
| 草根老板 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Hybrid | ToC_DIFF_CHILD/Hybrid | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Hybrid | ToC_DIFF_CHILD/Experience |
| 二代接班人 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience |
| 体制转型者 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | ToC_DIFF_CHILD/Hybrid | ToB_DIFF_ELDER/Hybrid | ToC_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid |
| 职业经理人 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Hybrid | ToC_DIFF_CHILD/Experience | ToC_DIFF_ELDER/Experience | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience |
| 销售铁军 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience |
| 技术创业者 | ToB_DIFF_ELDER/Hybrid | ToC_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | ToC_DIFF_ELDER/Experience | ToC_DIFF_ELDER/Experience | ToC_DIFF_ELDER/Hybrid |
| 互联网PM转型 | ToC_DIFF_CHILD/Hybrid | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | ToC_DIFF_ELDER/Hybrid | ToC_DIFF_ELDER/Hybrid | ToC_DIFF_ELDER/Hybrid |

## 6. 每 persona 一条 Q 链一致性抽样

| persona | D4 question | cards/tier | D5 question | price/reason | short comment |
|---|---|---|---|---|---|
| 草根老板 | 这批机器人做出来，成本得多少钱一台？我账上现金够不够先做100台，还能保住工资和供应商的款？ | voice_basic@low, touch_hug@low, no_screen_costdown@mid, perception_base@low, basic_avoidance@low, child_safety@low, privacy_trust@low, cloud_update@low, self_diag@low | 这100台机器人，成本已经压到200块以内了，那定价定多少，既能卖得动、又能让账上现金转得开？ | 3000；成本200，定价3000，毛利2800，扣除达人佣金30%约900、包装物流50、预留返工退货200，单台净利还有1650。100台全部卖完能回款30万，净利16.5万，账上现金够保工资和供应商。万一卖不动，最多亏2万成本，不伤筋骨。定价太低（1000-2000）利润薄，扛不住… | 签名轴“试单/现金/回款”贯穿问题/理由；仅作原文一致性描述。 |
| 二代接班人 | 在儿童陪伴机器人这个品类里，我们家族企业最擅长的‘体验溢价’和‘设计信任’，到底能不能让家长愿意为‘像训小狗一样自然’的互动多付50%的钱，而不是转头去买一个更便宜但功能差不多的替代品？ | follow_mode@mid, basic_avoidance@mid, touch_hug@mid, visual_expression@mid, perception_base@low, privacy_trust@mid, child_safety@mid, cloud_update@mid, self_diag@low | 我们的目标用户——那些愿意为孩子花更多钱但时间碎片化的中产父母——在购买决策时，真正在意的到底是‘孩子能玩多久’（复购与粘性），还是‘买回来那一刻看起来值不值’（首单说服力）？ | 2900；首单说服力是打开市场的关键：家长在碎片化时间中决策，需要快速获得‘这钱花得值’的直观证据。2900元定价让产品处于中高端区间，配合OLED表情和运动互动，家长看到孩子与机器人互动时会产生情感共鸣，从而愿意为‘像训小狗一样自然’的体验多付溢价。同时，这个价格也预留了后续通过社群口… | 签名轴“品质/背书/长期”贯穿问题/理由；仅作原文一致性描述。 |
| 体制转型者 | 这些能力卡中，哪些是市级平台数据对接和验收标准的硬性门槛，哪些只是锦上添花的功能？ | cloud_update@mid, api_iot@mid, privacy_trust@mid, voice_basic@mid, perception_base@mid, self_diag@low, remote_monitor@mid, basic_avoidance@low | 陈主任能拍板的单笔采购预算上限是多少，以及这笔钱是从今年的运营经费里出，还是从‘智慧养老提升方案’的专项补贴里出？ | 3800；3800元定价处于区间中低位，既满足陈主任用运营经费快速采购的决策权限（通常单件设备审批上限在5000元内），又覆盖基础感知、语音交互、API/IoT对接等硬性门槛模块的成本（约3200-3500元），保留300-500元利润空间用于后续维护承诺。此价位低于专项补贴申报的典型设… | 签名轴“政策/政府/集采”贯穿问题/理由；仅作原文一致性描述。 |
| 职业经理人 | 这50单试用，我打算怎么找到第一批愿意掏钱的家长？是靠达人种草直接转化，还是先铺几家线下门店做体验？ | voice_basic@mid, visual_expression@mid, touch_hug@low, music_companion@low, perception_base@low, basic_avoidance@low, cloud_update@low, self_diag@low, privacy_trust@low, child_saf… | 这50单试用，第一批家长是靠什么渠道找到的——是达人种草直接下单，还是线下门店体验转化，还是其他方式？ | 2900；定价2900元，基于D4的硬件成本（BOM约600元）和研发摊销，结合map_jingli_09新品上市通过内容种草快速铺货的经验，以及map_jingli_21先做50单看回款的信条。该价格既能覆盖成本，又能在儿童体验型市场（家长决策快、客单价敏感度低）中通过达人种草直接转化… | 未检出预注册签名词贯穿，保留为弱一致或转轴样本。 |
| 销售铁军 | 这些能力卡的成本和研发投入，跟首期只聚焦北京朝阳区、定价必须高于成本30%以上、只做线上种草+社区团购转介绍的战略约束怎么对得上？哪个能力是用户愿意掏钱的核心卖点，哪个是锦上添花但会吃掉利润的冗余功能？ | emotion_recognition@low, perception_base@low, voice_basic@low, touch_hug@low, privacy_trust@low, child_safety@low, basic_avoidance@low, cloud_update@low, self_diag@low | 定价800元还是1000元以上，哪个更能让北京朝阳区的双职工父母觉得‘这是有温度的AI伙伴’而不是‘又一个玩具’，同时还能支撑30%毛利和内容种草预算？ | 1200；1200元定价基于三个逻辑：一是成本约600元（9张低配能力卡），50%毛利覆盖30%以上毛利要求，且预留充足预算做内容种草；二是北京朝阳区双职工家庭月收入中位数约2-3万，1200元相当于一次周末外出消费，决策门槛低；三是参考同类情感陪伴类产品（如Luka绘本机器人定价899… | 未检出预注册签名词贯穿，保留为弱一致或转轴样本。 |
| 技术创业者 | 在现有资金和团队规模下，我们能否在3个月内做出一个能跑通跌倒检测+心率预警核心功能的原型机，并让至少一家养老机构愿意签试用合同并付押金？ | voice_basic@low, perception_base@mid, follow_mode@low, basic_avoidance@mid, cloud_update@low, privacy_trust@low, remote_monitor@low | 如果首月押金+基础服务费定在2000元，养老机构愿意签试用合同的比例会超过50%吗？ | 2000；2000元定价低于机构一次性买断的雷达设备（通常8000+），也低于月均护工成本（约4000元/人），且押金可退还，降低了决策风险。参考map_jishu_13中定制开发后客户流失的教训，低门槛试用能更快验证产品价值，避免过度投入。若首月签约率低于50%，可进一步调至1500元… | 签名轴“技术/架构/工程”贯穿问题/理由；仅作原文一致性描述。 |
| 互联网PM转型 | 在硬件BOM成本必须控制在80元以内的硬约束下，哪些能力卡是必须优先配置的，哪些可以砍掉或推迟，才能保证核心价值（老人三步内独立开机、孩子自己完成认知训练、家长看到成长数据）在种子用户阶段跑通PMF？ | voice_basic@low, no_screen_costdown@mid, touch_hug@low, perception_base@low, basic_avoidance@low, cloud_update@low, privacy_trust@low, child_safety@low, edu_content@low, self_diag… | 在硬件BOM 80元的成本约束下，这个订阅制陪伴机器人的定价，到底是基于‘硬件微亏、靠订阅盈利’的互联网定价逻辑，还是基于‘硬件保本、订阅只是增值服务’的传统硬件定价逻辑？ | 1900；采用‘硬件微亏、靠订阅盈利’的互联网定价逻辑，硬件BOM 80元，量产成本约120元（含组装），首年订阅费1900元（约158元/月），硬件成本通过首年订阅覆盖，后续订阅纯利；此定价低于线下早教班年均5000+元，高于纯APP年费300元，匹配家长‘省心省力但别太贵’的心理账户… | 签名轴“用户/数据/迭代”贯穿问题/理由；仅作原文一致性描述。 |

## 7. 卡面精确数字使用分化

| persona | chains using exact visible number | chains doing explicit calculation | used values/examples |
|---|---:|---:|---|
| 草根老板 | 3/6 | 1/6 | 30:还有1650。100台全部卖完能回款30万，净利16.5万，账上现金够保工资；16.5:。100台全部卖完能回款30万，净利16.5万，账上现金够保工资和供应商。万一卖；75:去屏幕，用纯语音+灯光方案，每台省75元；45:运营成本。参考map_caogen_45（客户反复压价说明他其实想买）和ma |
| 二代接班人 | 3/6 | 1/6 | 45:高于市场同类产品均价（约2000元）45%，又低于4000元心理门槛，让家长；30:3800元处于目标用户（年收入30-60万的一线城市双职工家庭）可接受；60:先做体验试点而非全面铺开，参考60万元试点被砍到20万元仍先启动的经验 |
| 体制转型者 | 2/6 | 3/6 | 30:机BOM成本控制在600元左右，预留30%渠道利润空间，定价策略匹配政府分期；30:4确定的单机BOM成本600元、预留30%渠道利润空间，以及D3提出的分期付；30:BOM成本600元，预留30%渠道利润（约1140元），加上5%；60:2900元定价下，若首年订阅续费率超60%，单用户LTV可达5000元以上， |
| 职业经理人 | 1/6 | 4/6 | 84:端更新（low），总单位增量成本约¥84+¥54+¥60+¥54+¥39+¥；54:low），总单位增量成本约¥84+¥54+¥60+¥54+¥39+¥60+¥；60:，总单位增量成本约¥84+¥54+¥60+¥54+¥39+¥60+¥45+¥；54:增量成本约¥84+¥54+¥60+¥54+¥39+¥60+¥45+¥45=¥；39:约¥84+¥54+¥60+¥54+¥39+¥60+¥45+¥45=¥441/ |
| 销售铁军 | 4/6 | 5/6 | 30:期只聚焦北京朝阳区、定价必须高于成本30%以上、只做线上种草+社区团购转介绍；30:首期聚焦北京朝阳区，定价必须高于成本30%以上，只做线上种草+社区团购转介绍；30:力选最低配，控制单台BOM成本，留出30%毛利支撑内容种草和达人合作预算。；30:约600元以内，定价约800元，留出30%毛利支撑内容种草和达人合作预算。；30:定价1200元，高于成本30%以上（成本约600元，毛利50%） |
| 技术创业者 | 3/6 | 6/6 | 30:靠押金+服务费覆盖初期投入，避免自购30万设备试错。；30:雷达模组，放弃自研硬件，避免重蹈自费30万买硬件方向错误的覆辙。传感器成本控；30:定价需覆盖硬件成本+3倍，同时预留30%毛利应对客户压价；30:定为2400元（硬件成本8000元的30%），以低门槛试用换取快速签约，后续；30:快速验证核心价值；同时覆盖硬件成本的30%，避免亏损，后续通过订阅费或批量折 |
| 互联网PM转型 | 5/6 | 6/6 | 30:硬件BOM 80元，按传统制造毛利率30%算，硬件定价约114元，但订阅制需；114:按传统制造毛利率30%算，硬件定价约114元，但订阅制需覆盖服务器、内容分成和；30:月费99元年化1188元，结合月费涨30%流失30%的教训，定价需锚定年费1；30:年化1188元，结合月费涨30%流失30%的教训，定价需锚定年费1800-2；120:逻辑，硬件BOM 80元，量产成本约120元（含组装），首年订阅费1900元（ |

## 8. 局限

- N=3；同 persona 固定同一套历史锦囊；solo；单一 DeepSeek 基座。
- 新 UI/manifest 口径没有历史同口径对照；旧轮数字不混入正式表。
- 区间为观测 min–max，不是置信区间；不做显著性检验。
- 精确数字捕捉用确定性文本规则识别，可能漏掉未复述数字但在心算中使用的情况。
