# AI Generated Persona Maps v1 — Stopped Failure Report

- Run: `ai_generated_persona_maps_v1_2026-07-14`
- Status: **FAIL (automatic stop; no map set released)**
- Blocker: 职业经理人
- Successful initial five-persona batch output: yes, after 3 API/schema attempts.
- Local maps passing before stop: 1/5; blocked: 1; not evaluated: 3/5.
- Blind-spot embedding validation: not reached.
- D1-D4 downstream validation: not run.

## Per-persona stop state

| Persona | State | Local regenerations | Numeric repairs | Game hits in latest candidate | Domain violations in latest candidate |
|---|---|---:|---:|---|---|
| 体制转型者 | PASSED_LOCAL_BEFORE_STOP | 4 | 0 | 0 | 0 |
| 职业经理人 | BLOCKED | 5 | 0 | 成本 | 零售快消=11>4 |
| 销售铁军 | NOT_EVALUATED | 0 | 0 | 0 | 0 |
| 技术创业者 | NOT_EVALUATED | 0 | 0 | 成本 | 0 |
| 互联网PM转型 | NOT_EVALUATED | 0 | 0 | 0 | 0 |

## Stop reason

The latest 职业经理人 candidate still hit game terms: 成本.
Its sector violations were: 零售快消 11/20.

> 在最小输入和无人工逐条修订条件下，当前生成流程未能让五张地图全部越过机械质量门槛；按规格停机，不能据此运行或解释下游 persona 分化。

