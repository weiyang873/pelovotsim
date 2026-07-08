# BigQuery `praxis_sync` 只读审计报告

- **审计日期**: 2026-07-06(全程只读,未写/删/改任何 BQ 对象;累计扫描量 < 40 MB)
- **数据集实际位置**: `quiet-bruin-168604.public`(asia-southeast1)。Datastream 流 `praxis-pg-sync`(RUNNING,append-only,数据新鲜度 900s)使用 source-hierarchy 模式,数据集名取自 PG schema `public`,即口头所称的 "praxis_sync"。
- **回填时间**: 2026-05-08 16:16 UTC(所有此前存量行的 `source_timestamp` 都是这一刻)。

---

## 1. 数据集结构

24 张表,合计约 82 MB / 8.7 万行(原始含多版本)。

| 表 | 原始行数 | 大小 | 主键(来自生产建表语句) | 业务时间戳 |
|---|---:|---:|---|---|
| teams | 2,929 | 17.0 MB | `id` | `created_at` |
| team_members | 4,738 | 2.0 MB | `id` | `joined_at`, `last_activity_at` |
| students | 274 | 0.05 MB | `student_id` | `created_at` |
| member_submissions | 293 | 0.1 MB | `id` | `submitted_at` |
| round1_team_drafts | 346 | 0.18 MB | `team_id` | `updated_at` |
| vp_iterations | 176 | 0.12 MB | `id` | `created_at` |
| vp_sessions | 646 | 4.7 MB | `session_id` | `created_at`, `updated_at` |
| round2_dimension_assignments | 2,220 | 29.9 MB | `team_id` | `updated_at` |
| round2_member_selections | 628 | 0.23 MB | `(team_id, member_id)` | `updated_at` |
| round2_interview_sessions | 1,977 | 7.9 MB | `session_id` | `created_at`, `updated_at` |
| round2_team_drafts | 387 | 0.35 MB | `team_id` | `updated_at` |
| round2_submissions | 37 | 0.05 MB | `(team_id, session_id)` | `submitted_at` |
| round2_results | 37 | 0.05 MB | `(team_id, session_id)` | `computed_at` |
| fg_team_radar | 37 | 0.01 MB | `(team_id, session_id)` | `updated_at` |
| jinang_settlements | 38,966 | 10.1 MB | `id` | **无时间戳列** |
| computation_log | 32,111 | 9.1 MB | `id` | `timestamp` |
| teacher_actions | 74 | 0.01 MB | `id` | `performed_at` |
| debrief_cache | 8 | 0.01 MB | `id` | `generated_at` |
| sim_teams / sim_students / sim_vp_iterations / sim_vp_chat_log / sim_interview_log / sim_jinang_effects | 12 / 72 / 60 / 36 / 700 / 174 | ~1 MB | `id`(自增),按 `run_id` 分组 | `created_at` |

### 去重口径(后续所有统计均按此)

每张表带 Datastream 元数据结构体 `datastream_metadata`(`uuid`, `source_timestamp`, `change_sequence_number`, `change_type`, `sort_keys`)。同一主键有 INSERT / UPDATE / DELETE 多版本(如 teams:162 个 INSERT、2,626 个 UPDATE、141 个 DELETE)。

```sql
-- 标准去重:每主键取最新"非 DELETE"版本
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY <pk>
    ORDER BY datastream_metadata.source_timestamp DESC,
             datastream_metadata.change_sequence_number DESC) rn
  FROM `quiet-bruin-168604.public.<table>`
  WHERE datastream_metadata.change_type != 'DELETE'
) WHERE rn = 1
```

**为什么要排除 DELETE 版本**:162 个 team 中 141 个已被生产库删除(管理端重置),DELETE 事件行的非主键列全为 NULL。若简单取"最新版本",4/16 和 5/15 两次真实课堂会整体消失。Append-only 反而保住了这些数据——**两次已删课堂的数据只存在于 BQ,生产库已无**。

---

## 2. 真人 / 测试分拣

### 三类划分(按队名 + 时间聚类 + 行为节奏)

| 类别 | 判定依据 | 队数 |
|---|---|---:|
| 真实课堂 | 队名 `第N组`/颜色组,整批同时创建,50+ 学生,活动持续 3h+ | 30(3 个课堂日) |
| 自动化/负载测试 | `loadtest_20260527235251_vu*`,2026-05-28 一批 100 队,单人队,无 computation_log | 100 |
| 试用/演示 | `试玩_*` 前缀,单人队,几分钟到 1 小时 | 28 |
| AI 模拟 | 独立 `sim_*` 表,`run_id=2026-04-06T07-13-49-794Z`,12 队 72 个 AI 学生 | 12(1 次 run) |
| 排练/碎片 | 05-14 `第1组`(2 人 24 分钟,课前排练);05-17 三个重建的 `第2组`/`2组` | ~5 |

未发现任何 Playwright / E2E 命名的队伍;自动化测试只有 5/28 的 k6 loadtest 一批(与仓库近期 commit "k6 spike load test" 吻合)。

### 候选真实课堂分拣表(请确认)

| # | 日期 | 队名模式 | 队数 | 学生数(roster) | 创建时间 | 活动节奏 | 生产库状态 | 判定 |
|---|---|---|---:|---:|---|---|---|---|
| S1 | **2026-04-16**(已知首课) | 第1组~第9组 | 9 | 53 | 00:17 统一预建 | 白天上课,15:45–17:53 结算 | 已删,仅存 BQ | **真实课堂** |
| S2 | **2026-05-15** | 第黄色/橙色/粉色/银色/深绿/深蓝/浅绿/红色/棕色/紫色组 | 10 | 53 | 12:51 统一创建 | ~3 小时,15:41–16:11 结算 | 已删,仅存 BQ | **疑似真实课堂,请确认** |
| S3 | **2026-05-17** | 第1组~第11组 | 11 | 58 | 08:43 统一创建 | 上午 ~3 小时,多数队 11:30 左右止 | 未删(当前库内数据) | **疑似真实课堂,请确认** |

其余活跃日均为噪声:4/26、5/7、5/14 为试玩/排练;4/17–5/10 的 computation_log 活动是对 4/16 课堂数据的教师端重算(r2_profit 等 stage,9–10 个老 team_id);5/19 之后至 6/23 每天 4 条 r1_* 事件,是单一队伍的监控/开发触碰,无研究价值。

---

## 3. 真人数据完整性(仅三次课堂)

完整决策链定义:R1 选格(`final_grid_id`)→ VP 迭代(≥2 次)→ 访谈(有完成的 session)→ 定价(`round2_submissions.price`)→ 利润结算(`round2_results.profit`)。

### 每队明细

| 课堂 | 队 | 成员 | R1 提交 | R1 选格 | VP 迭代 | 访谈 session(完成) | 学生发言轮次 | 平均消息长度(字) | 定价 | 利润(百万) | 链条 |
|---|---|---:|---:|:-:|---:|---|---:|---:|---:|---:|:-:|
| 04-16 | 第1组 | 6 | 6 | Y | 3 | 26 (12) | 72 | 29 | 12800 | -3.3 | ✅ |
| 04-16 | 第2组 | 6 | 6 | Y | 4 | 17 (12) | 90 | 85 | 12800 | -10.3 | ✅ |
| 04-16 | 第3组 | 6 | 6 | Y | 3 | 14 (12) | 88 | 39 | 9900 | -6.8 | ✅ |
| 04-16 | 第4组 | 6 | 6 | Y | 3 | 15 (12) | 105 | 39 | 9900 | -10.1 | ✅ |
| 04-16 | 第5组 | 6 | 6 | Y | 3 | 28 (12) | 89 | 25 | 12800 | 26.5 | ✅ |
| 04-16 | 第6组 | 6 | 6 | Y | 2 | 17 (13) | 95 | 40 | 15000 | 9.2 | ✅ |
| 04-16 | 第7组 | 6 | 6 | Y | 4 | 18 (12) | 108 | 28 | 18800 | -19.4 | ✅ |
| 04-16 | 第8组 | 6 | 6 | Y | 2 | 17 (12) | 98 | 55 | 17000 | 75.4 | ✅ |
| 04-16 | 第9组 | 5 | 5 | Y | 3 | 15 (10) | 80 | 111 | 12800 | 38.1 | ✅ |
| 05-15 | 黄色 | 4 | 4 | Y | 3 | 8 (8) | 66 | 19 | 19800 | -13.8 | ✅ |
| 05-15 | 橙色 | 6 | 6 | Y | 3 | 11 (10) | 84 | 34 | — | — | ⚠️ 缺定价 |
| 05-15 | 粉色 | 6 | 6 | Y | 3 | 12 (12) | 72 | 22 | 12800 | -6.2 | ✅ |
| 05-15 | 银色 | 6 | 6 | Y | 3 | 11 (10) | 70 | 24 | 12800 | -13.9 | ✅ |
| 05-15 | 深绿 | 6 | 6 | Y | 4 | 12 (12) | 63 | 15 | 20000 | -20.8 | ✅ |
| 05-15 | 深蓝 | 6 | 6 | Y | 3 | 12 (12) | 78 | 13 | 15200 | 47.7 | ✅ |
| 05-15 | 浅绿 | 3 | 3 | Y | 3 | 6 (6) | 34 | 23 | 8500 | -9.2 | ✅(仅3人) |
| 05-15 | 红色 | 5 | 4 | — | 0 | 0 | — | — | — | — | ❌ 断在 R1 |
| 05-15 | 棕色 | 6 | 6 | Y | 3 | 10 (10) | 67 | 23 | — | — | ⚠️ 缺定价 |
| 05-15 | 紫色 | 5 | 5 | Y | 3 | 10 (10) | 72 | 31 | — | — | ⚠️ 缺定价 |
| 05-17 | 第1组 | 6 | 6 | Y | 3 | 15 (9) | 72 | 21 | — | — | ⚠️ 缺定价 |
| 05-17 | 第2组×3 | 5 | 碎片 | — | ≤1 | 0 | — | — | — | — | ❌ 重建碎片 |
| 05-17 | 第3组 | 5 | 5 | Y | 3 | 11 (9) | 63 | 25 | — | — | ⚠️ 缺定价 |
| 05-17 | 第4组 | 6 | 6 | Y | 3 | 11 (9) | 78 | 42 | — | — | ⚠️ 缺定价 |
| 05-17 | 第5组 | 6 | 6 | Y | 3 | 11 (9) | 67 | 85 | — | — | ⚠️ 缺定价 |
| 05-17 | 第6组 | 5 | 5 | Y | 4 | 11 (10) | 65 | 69 | 16800 | 33.8 | ✅ |
| 05-17 | 第7组 | 6 | 6 | Y | 2 | 2 (1) | 6 | 33 | — | — | ❌ 访谈即弃 |
| 05-17 | 第8组 | 5 | 5 | Y | 3 | 17 (11) | 77 | 34 | — | — | ⚠️ 缺定价 |
| 05-17 | 第9组 | 4 | 4 | Y | 2 | 12 (9) | 73 | 93 | — | — | ⚠️ 缺定价 |
| 05-17 | 第10组 | 5 | 5 | Y | 3 | 3 (0) | 2 | 28 | — | — | ❌ 访谈即弃 |
| 05-17 | 第11组 | 5 | 5 | Y | 3 | 7 (3) | 27 | 24 | — | — | ⚠️ 低投入 |

注:VP 迭代由队长一人操作(`n_vp_confirmed=1`/队是产品设计,非缺陷);所有课堂队 VP 迭代均 ≥2 次,没有"一次不改"的队。定价与结算时间戳全部在当天课内,无跨日异常。

### 投入度分布(每成员访谈发言)

| 课堂 | 受访成员数 | 发言轮次四分位 [min, Q1, 中位, Q3, max] | 平均消息长度 | <5 轮的成员 |
|---|---:|---|---:|---:|
| 04-16 | 54 | [0, 13, 15, 19, 27] | 48.8 字 | 1 |
| 05-15 | 49 | [0, 10, 12, 15, 20] | 23.1 字 | 2 |
| 05-17 | 45 | [0, 8, 12, 17, 20] | 48.8 字 | 7 |

**明显敷衍/异常的队**:
- 05-17 **第10组**:全队访谈仅 2 轮发言、0 个完成 session——访谈即弃。
- 05-17 **第7组**:6 轮发言、1 个完成 session。
- 05-17 **第11组**:27 轮、仅 3 个完成 session,低投入。
- 05-15 **红色组**:R1 就断链(未选格、无 VP、无访谈)。
- 05-15 **深蓝/深绿**:访谈完成度高但消息极短(13–15 字/条),属"走完流程但敷衍作答"。

---

## 4. 研究可用性总结

### 规模盘点

- **真实课堂 session:3 次**(04-16 确认,05-15 / 05-17 待确认),共 30 个正规队、164 人次注册学生(53+53+58)。
- **完整决策链可用队:16**(04-16 ×9,05-15 ×6,05-17 ×1)。
- **按投入度分层**:
  - 高投入且链条完整:11 队(04-16 全部 9 队 + 05-17 第6组 + 05-15 粉色)
  - 完整但作答简短:5 队(05-15 黄/银/深绿/深蓝/浅绿)
  - 链条断在定价(前半程可用):9 队(05-15 橙/棕/紫 + 05-17 第1/3/4/5/8/9组)
  - 低投入或断链(建议剔除):5 队(05-15 红色,05-17 第7/10/11组、第2组碎片)

### 每队可提取变量(实际字段名)

| 环节 | 表.字段 |
|---|---|
| 队伍/成员画像 | `teams.team_name/team_size/status`;`team_members.member_name/member_index/is_leader/jinang_market_id/jinang_tech_id/current_step/interview_rounds`;`students.student_name/group_label` |
| R1 个人提案 | `member_submissions.grid_id/architecture/channel_pref/vp_draft/personal_gm_max/submitted_at` |
| R1 团队决策 | `round1_team_drafts.grid_id/architecture/vp_text`;`teams.final_grid_id/final_architecture/final_channel1/final_channel2/final_sam/final_wtp_ref/final_wtp_adj/final_rho_c/final_wtp_multiplier` |
| VP 迭代过程 | `vp_iterations.iteration/trigger/vp_before/vp_after/score_before/score_after/score_c/score_g/score_e/used_best_iteration`;`vp_sessions.messages`(完整对话 JSON)/`pmf_score`;`teams.final_vp_text/final_vp_c/final_vp_g/final_vp_e_raw` |
| 访谈过程 | `round2_interview_sessions.history_json`(逐条 {role,speaker,text})/`personas_json/result_json`(雷达+标签)/`round_no/is_complete`;`fg_team_radar.radar_json/tags_json/evi` |
| 卡片/维度分工 | `round2_dimension_assignments.assignments_json`;`round2_member_selections.selections_json` |
| 定价与配置 | `round2_submissions.price/cards_json/card_count/dcogs/risk_total/best_grid` |
| 结算结果 | `round2_results.units/profit/profit_per_unit/vscore/result_json` |
| 锦囊结算 | `jinang_settlements.jinang_id/jinang_type/matched/match_reason/effect_applied` |
| 过程审计 | `computation_log.stage/params/timestamp`(r1_sam / r1_vp_score / r1_wtp_adj / r2_card_selection / r2_coverage / r2_product_scores / r2_profit 等全链路计算留痕) |
| AI 模拟对照组 | `sim_teams`(每队 50+ 结果字段)、`sim_students`、`sim_vp_iterations`、`sim_interview_log`(700 条逐轮对话)——2026-04-06 一次 12 队 run,可作 AI 基线 |

### 数据缺陷清单

1. **回填截断历史**:Datastream 2026-05-08 才开始,04-16 课堂只有"截至 05-08 的最终状态"+ 业务时间戳,课中的逐次 UPDATE 过程史不存在;`datastream_metadata.source_timestamp` 对 05-08 前的数据一律失真,过程分析必须用业务时间戳列。
2. **删除依赖 BQ 恢复**:04-16、05-15 两次课堂在生产库已被整体删除,BQ 是唯一副本;任何统计必须用"最新非 DELETE 版本"口径,否则这两次课堂归零。
3. **05-17 课堂链条系统性断裂**:11 队中 10 队无 `round2_submissions`/`round2_results`(computation_log 当天也无 r2_profit stage)——课程在定价/结算前结束,非同步丢数。
4. **生产表未全部入流**:PG 里存在但 BQ 缺失的表:`round2_persona_reports`、`round2_persona_choices`(新合并流程的画像报告/选择)、`marketing_sessions`、`team_runs`、`iteration_events`、`llm_wizard_outputs`、`llm_call_metrics`、`llm_kv_cache`。若后续课堂用新流程,需更新 Datastream include 列表。
5. **`jinang_settlements` 无时间戳列**,且各课堂行数量级差异巨大(04-16 每队 ~27 行 vs 05-15/17 每队 ~1000 行),疑为结算逻辑版本变更,跨课堂比较该表需先核对逻辑版本。
6. **session 标识缺失**:`teams.session_id` 全部为 `'default'`,课堂归属只能靠 `created_at` 日期聚类推断。
7. **身份碎片**:05-17 `第2组` 被重建 3 次(+1 个 `2组`),数据散在 4 个 team_id;试玩队存在同名不同 id。
8. **时间戳小异常**:05-17 第1组/第8组 `last_activity_at` 延到 05-18/19(课后又登录);4/17–5/10 有教师端对 04-16 数据的重算事件(未覆盖原 `computed_at`);5/19–6/23 有单队监控性触碰,均应从行为分析中排除。
