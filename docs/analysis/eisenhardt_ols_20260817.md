# Eisenhardt (1989) 复现 — 回归表（2026-08-17）

标准化系数（β），括号 p。行级数据、按团队组合聚类稳健 SE（新样本 231 为单轮，普通 SE）。
DV 说明：利润 = settlement.profit（万元）；亏损 = profit<0；log 收入 = log(revenueNet)。
自变量：D4 句数 = 能力卡复核成员发言数（速度的反向代理）；数字量 = 复核中每句引用的数字个数（实时信息使用）；多样性控制 = 行业 Blau、职能组 Blau、财务人数（benchmark 用原型 Blau）。

## Roleplay 线（讨论长度内生：编剧/演员决定何时收场）

| DV | 样本 | D4 句数 | 数字量 | 行业 Blau | 职能 Blau | 财务数 | R² |
|---|---|---|---|---|---|---|---|
| 利润 | 冻结 B 201 行（42 组合聚类） | −0.18 (.01) | +0.19 (.01) | −0.12 (.14) | +0.04 | +0.03 | .11 |
| 利润 | 设计队 231（单轮） | −0.14 (.03) | +0.19 (.00) | −0.03 | +0.04 | +0.02 | .06 |
| 亏损 | 冻结 B 201 | +0.14 (.04) | −0.23 (.00) | +0.19 (.00) | −0.04 | +0.06 | .13 |
| 亏损 | 设计队 231 | +0.17 (.01) | −0.30 (.00) | +0.03 | +0.01 | +0.02 | .13 |
| log 收入 | 冻结 B 201 | −0.10 (.25) | +0.12 (.12) | −0.05 | −0.10 | +0.07 | .05 |
| log 收入 | 设计队 231 | −0.22 (.00) | +0.21 (.00) | +0.02 | +0.03 | −0.08 | .10 |

信息使用 → D4 句数（同阶段）：冻结 B 42 组合 −0.39*（成本句占比 −0.47**）；设计队 231 −0.10/−0.18**；actor-engine 11 队 −0.66（方向）。

## Benchmark 线（讨论长度由调度器给：每段 7 轮 × 1–2 人；SD 仅 2.6–3.5）

控制原型 Blau，210 行（42 组合 × 5 轮，聚类 SE）：

| DV | 臂 | D4 句数 | 数字量 | 原型 Blau | R² |
|---|---|---|---|---|---|
| 利润 | simple | −0.28 (.00) | +0.31 (.00) | +0.10 | .14 |
| 利润 | layered | −0.21 (.00) | +0.19 (.03) | −0.06 | .08 |
| 亏损 | simple | +0.28 (.02) | −0.29 (.00) | +0.01 | .12 |
| 亏损 | layered | +0.20 (.01) | −0.16 (.00) | +0.03 | .06 |
| log 收入 | simple | −0.29 (.00) | +0.25 (.00) | +0.05 | .11 |
| log 收入 | layered | −0.17 (.02) | +0.02 | −0.09 | .03 |

**关键差异**：信息使用 → D4 句数在 benchmark 为 **+0.23 (.01) / +0.16 (.05)** —— 与 roleplay 线反号。
即 "information → good" 与 "short → good" 处处成立（任务层规律）；Eisenhardt 的核心连接 "informed teams are the fast ones" 只在讨论长度内生的机制里出现。

## 复现口径
- 复现：实时信息使用 → 决策更快且更好（限 R2 能力卡复核、长度内生机制）；速度（复核长度）本身与绩效正相关；R1（无实时数据的页面）速度与绩效无关。
- 未复现/未测：备选方案→更快（R1 备选多 → 亏损少但更慢）；顾问机制、决策整合、高速环境边界条件。
- 限制：相关设计；"实时信息" 为文本代理（每句数字量/成本词占比）；roleplay 主样本出自单编剧机制（逐人 actor 11 队方向一致）；单一任务。
- 数据位置：冻结 B `runs_v4flash_0731/team_r2_replay/team_r2_story3_B_rep1-5_20260816`（worktree）；设计队 = faultline2x2 146 + triad 35 + shared-card 31 + fn-diversity 19；benchmark `runs_v4flash_0731/team_pilot/benchmark_team_rep2-5_20260816` + `benchmark_team_rep1layered_20260817` + 08-14 simple 轮。

## Robustness to the ratio construction (2026-08-22, `paper/tab_robust_info_ratio.py` → `paper/data/tab_robust_info_ratio.csv`)

Concern: info per line has the DV (line count) in its denominator; total info has the opposite mechanical bias (more lines → more total, +0.25…+0.58 everywhere). Clean measures = info per line over a fixed early window (first 2/3/5 lines, first half), denominator independent of total length.

DV = D4 length, controls industry Blau + finance members, SE clustered by composition:
- Roleplay frozen / designed separately: e3 = −0.09 (p=.16 / p=.13) — direction holds, single-sample power does not.
- Roleplay pooled (n=432, + sample dummy): e2 −0.08 (p=.057), e3 −0.09 (p=.038), ehalf −0.09 (p=.027).
- Benchmark, same measures: e3 −0.02 (ns) simple / −0.09 (ns) layered; ehalf +0.14 (p=.048) simple / +0.01 layered — zero or positive.
- Profit half is stronger with early/total measures (e5 +0.20, p<.001 pooled; also holds per sample).

Reading for the paper: the counterintuitive slope survives denominator-free measurement but at β ≈ −0.09 and only pooled-significant; the cross-design contrast (negative in roleplay, zero/positive in benchmark) survives cleanly. Recommended wording: lead with the contrast and the profit half; report −0.13** (per-line) with the early-window robustness in the same table, not as an appendix afterthought.
