# ARM_DEFINITIONS_REPORT

Repo root: `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01`

## Scope

本报告只做开跑前定义核对，不选择最终设计。四个目标 arm 来自 `CODEX_FULL_RERUN_V4FLASH.md`：`simple`、`layered`、`d4d5_chat`、`d4d5_chat_satisfice`。

## Arm 定义出处与字段消费

| arm | 既有定义/实现出处 | 当前实现定义 | 实际消费 persona 字段 |
|---|---|---|---|
| `simple` | `/scripts/sim/run_merged_v1_sim.js:840` 默认 `arm = "simple"`；`/scripts/sim/run_merged_v1_sim.js:851-854` 只有 `layered` 才构造 personaContext；`/scripts/sim/run_merged_v1_sim.js:423-430` 无 context 时只用通用任务 prompt；`/scripts/sim/run_merged_v1_sim.js:1469-1471` benchmark v2 只跑 `simple` 与 `layered` | 旧 benchmark 中的 simple 是“无 personaContext 的通用认真 EMBA 学生”，不是 formal_v3 arm | 当前旧实现不消费 persona pool 字段；只消费 grid、architecture、customer reports、cards、pricing UI |
| `layered` | spec: `/docs/CODEX_PERSONA_SIM_TEST.md:38-44`、`:383-433`、`:500-620`；实现: `/scripts/sim/run_merged_v1_sim.js:454-480`、`/scripts/sim/persona_student.js:61-92`、`:415-426`、`:428-599` | 先从 `persona_pool.js` 抽样得到 student，再生成 L0 seed memory 与 L1 classroom profile，拼成 layered system prompt | 消费 surface/染色层：archetype/persona id、name、gender、age、education、overseas、MBTI、expression style、role/background/industry、decisionStyle、riskPreference、blindSpots；还使用 L0/L1 生成产物。现有 run_merged layered 只把该 systemPrompt 注入 R2 选卡定价，R1/VP draft 仍是通用 prompt |
| `d4d5_chat` | `/scripts/analysis/formal_v3_chat_format_paired.js:1238-1273` `runChatRow`；`/scripts/analysis/formal_v3_chat_format_paired.js:349-368` D4 去 JSON 契约改自然语言；`/scripts/analysis/formal_v3_chat_format_paired.js:852-870` D5 改自然语言；`/scripts/analysis/formal_v3_chat_format_paired.js:2028-2050` mode dispatch | 在 frozen formal source row 上只重跑 D4/D5：D4 自然语言选卡，D5 自然语言定价，再用 `FullGame.calculateR2` 重算 | 消费 source row 的 `persona_id/persona_label/condition/rep` 用于 chain key 和输出；核心 prompt 来自 `sourceRow.r2.d4.prompt` / `sourceRow.r2.d5.prompt`，这些 prompt 已嵌入原 persona 认知地图与链栈。当前不读取 `persona_pool_v2.surface`、`phi` 或 `kernel` |
| `d4d5_chat_satisfice` | `/scripts/analysis/formal_v3_chat_format_paired.js:1715-1834` `runDimensionSatisficeChatRow`；prompt pieces: `/scripts/analysis/formal_v3_chat_format_paired.js:708-849`；quantity policy: `/scripts/analysis/formal_v3_chat_format_paired.js:23`、`:426-450` | 六功能区 D4 + Satisfice：concerns -> six dimension chat decisions -> optional global repair -> evaluate -> alternatives -> final chat D4；D5 也是 chat | 同 `d4d5_chat`：消费 frozen source row prompt，不读取 persona pool v2。额外消费 arm/runner 级 `QUANTITY_POLICY`，并把 `quantity_policy` 写入 row；不读取 per-persona `kernel.satisfice_window` |

## simple 最小定义草案

当前没有 formal_v3 版本的 `simple` arm。若 PI 需要把 `simple` 纳入新的 `42 personas x Q/S` 骨架，建议最小定义为：复用完整链 runner；persona 只以单段扁平身份进入 prompt，不生成 L0/L1，不注入 MBTI 解释或课堂画像，不改 D4/D5 输出格式，不加 satisfice；该单段可包含 `persona_id`、`archetype`、`surface.name`、`surface.age`、`surface.edu`、`surface.expression_style`，但不消费 `kernel`。

该草案只为填补 formal arm 定义空缺，需 PI 确认后才能实现。

## d4d5_chat_satisfice 的窗口参数确认

当前实现中窗口/数量口径是 arm 侧固定值，不是 persona 侧字段。

- `/scripts/analysis/formal_v3_chat_format_paired.js:23`：`QUANTITY_POLICY` 由 `FORMAL_CHAT_QUANTITY_POLICY` 环境变量读取，默认 `min6`。
- `/scripts/analysis/formal_v3_chat_format_paired.js:426-450`：仅定义两个策略分支：`unlimited` 与默认/min6。
- `/scripts/analysis/formal_v3_chat_format_paired.js:1725-1726`：`format_arm` 和 `row.quantity_policy` 使用同一个全局 `QUANTITY_POLICY`。
- `/scripts/analysis/formal_v3_chat_format_paired.js:1731-1744`、`:1775`、`:1784`、`:1793`：各 satisfice/chat prompt 都传入同一个 `QUANTITY_POLICY`。
- `/scripts/analysis/formal_v3_chat_format_paired.js:1810-1812`：落盘的 `d4_dimension_satisfice_chat.quantity_policy` 仍是全局 `QUANTITY_POLICY`。

未发现任何 `sourceRow.kernel.satisfice_window`、`persona.kernel.satisfice_window` 或 `satisfice_window` 字段消费。

## 与当前 formal_v3 runner 不一致之处

1. 新 spec 目标骨架是 `42 unique personas x 2 conditions x 1 rep = 84 chains/arm`；当前 formal runner 是固定 `7 persona_id x Q/S x 3 reps = 42 source rows`，见 `/scripts/analysis/formal_v3_chat_format_paired.js:24-26`、`:195-205`。
2. 新 spec 要四个 arm 复用同一 `persona_pool_v2.json`；当前 formal chat runner 不加载 persona pool，只加载 frozen `SOURCE_JSONL` 行，见 `/scripts/analysis/formal_v3_chat_format_paired.js:195-205`。
3. 当前 `d4d5_chat` / `d4d5_chat_satisfice` 不是完整链重跑，只是拷贝 source row 后替换 D4/D5 并重算 R2，见 `/scripts/analysis/formal_v3_chat_format_paired.js:1242-1273`、`:1719-1834`。
4. 当前 formal runner `--limit` 校验为 `1..42`，见 `/scripts/analysis/formal_v3_chat_format_paired.js:115`；新 spec 每 arm 需要 84 chains。
5. `simple` 只有旧 `run_merged_v1_sim.js` benchmark 语义；没有 formal_v3 arm 实现。旧 simple 不消费 persona 字段，与新 spec 的“同一 persona 池、各 arm 按定义消费不同层字段”原则未对齐。
6. `layered` 的既有实现属于 grid/repeat benchmark：`12 grids x repeats`，且使用 `Math.random()` 抽 age/gender/MBTI，见 `/scripts/sim/run_merged_v1_sim.js:442-460`、`:1352-1377`。这与新 spec 要求的 frozen seedable `persona_pool_v2`、Q/S 配对设计不一致。
7. 旧 `layered` 在 `run_merged_v1_sim.js` 中只影响 R2 选卡定价 prompt，见 `/scripts/sim/run_merged_v1_sim.js:623-655`、`:937-947`；新 spec 若要求“完整链 runner”下 persona 贯穿全链，需要额外裁决注入点。
8. 当前 formal source persona 来自 A-G archetype + cognitive map，不含 `surface.name/gender/age/edu/mbti`；`full_game_all_personas.js` 只构造 `id/label/desc/profile/core_blind_spot/map_items`，见 `/scripts/analysis/full_game_all_personas.js:260-290`。
9. 新 pool spec 提到 `kernel.satisfice_window`；当前 satisfice 实现只用 arm/runner 级 `QUANTITY_POLICY`，没有 per-persona kernel 消费。
10. 现有 mode 名称与新 arm_id 不完全同名：`d4d5_chat` 约等于 current `mode=chat` / `format_arm="chat_D4_D5_only"`；`d4d5_chat_satisfice` 更接近 current `mode=dimension_satisfice_chat` / `format_arm="six_dimension_satisfice_chat_D4_chat_D5_${QUANTITY_POLICY}"`。

## 未消费字段清单（相对 persona_pool_v2 草案）

- `surface.name`：仅 layered 既有实现消费；formal d4d5 arms 当前不消费。
- `surface.gender`：仅 layered 既有实现消费。
- `surface.age`：仅 layered 既有实现消费。
- `surface.edu` / `education`：layered 消费，并可能触发 VP 长度约束；formal d4d5 arms 当前不消费。
- `surface.mbti`：layered 消费；formal d4d5 arms 当前不消费。
- `surface.expression_style`：layered 消费；simple 草案可消费；formal d4d5 arms 当前不消费。
- `kernel.satisfice_window`：当前无任何 arm 消费；若继续沿用当前 satisfice runner，只能作为记录性字段。
- `phi`：当前给定 pool spec 未定义 `phi` 字段；现有四个 arm 当前也没有可核对的 `phi` 消费点。
