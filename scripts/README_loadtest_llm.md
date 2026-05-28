# LLM 路径 Spike Load Test

这套脚本专门测多人课堂下的 **LLM 路径**，目标是把真实 DeepSeek 成本降为 0，同时观察：

- `LLM_CONCURRENCY` 进程内闸门有没有被打满
- mock 延迟固定在 1.5s 左右时，应用额外排队了多久
- Round 1 进入 Round 2 的链路，外加 Round 2 访谈链路，会不会把 DB 写入一并拖慢

## 0. 这次压测实际覆盖哪些学生路径

`scripts/loadtest_llm_spike.js` 会先让每个 VU 走一遍最小可用真实链路：

1. `POST /api/team/create`
2. `POST /api/team/:id/join`
3. `POST /api/team/:id/phase1/:memberId/submit`
4. `POST /api/team/:id/phase3/chat`
5. `POST /api/team/:id/phase3/synthesize-vp`
6. `POST /api/team/:id/phase3/finalize`
7. `POST /api/team/:id/freeze`

然后循环打 Round 2 访谈链路：

1. `POST /api/round2/interview/start`
2. `POST /api/round2/interview/reply` × 5
3. `POST /api/round2/interview/end`
4. 如果后端返回 `needsRescore/retry`，补打一发 `POST /api/round2/interview/rescore`

说明：

- 文档里的伪代码写了 3 轮访谈，但当前后端 `MIN_TURNS_TO_END=5`，所以脚本固定打 5 轮，否则 `/api/round2/interview/end` 会稳定 400。
- 当前后端每个成员最多完成 3 次访谈。脚本会在 3 次后自动重建新团队，避免卡死在 `sessionId=""`。

## 1. 在 GCP 上启动 mock 模式

```bash
gcloud compute ssh gpc-vm-new --zone=asia-southeast1-b
cd ~/pelovotsim

docker compose down
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d

sleep 10
curl http://127.0.0.1:8088/stats
```

如果返回 JSON，说明 mock 已启动。

说明：

- `docker-compose.loadtest.yml` 只在显式 `-f docker-compose.loadtest.yml` 时生效，正常 `docker compose up` 不会带上 mock。
- mock 端口绑定为 `127.0.0.1:8088`，方便主机本地 `curl`，但不会直接暴露到公网。

## 2. 验证 app 已被重定向到 mock

在 GCP 上再开一个终端：

```bash
docker compose logs mock-deepseek --tail 20
```

然后从任意前端入口或手工请求触发一次 LLM 接口。只要日志里出现类似下面的行，就说明应用已经不再打真实 DeepSeek：

```text
2026-05-28T... vp_coach latency=1532ms in-flight=0
2026-05-28T... persona_generate latency=1418ms in-flight=3
```

如果 mock 日志一直没有新请求，优先检查：

- `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml config`
- `app` 容器里的 `DEEPSEEK_BASE_URL` 是否被覆盖成 `http://mock-deepseek:8088`
- 是否仍带着旧容器配置运行

## 3. 在 Mac 上跑 k6

先安装：

```bash
brew install k6
```

运行：

```bash
cd ~/Dropbox/Github_indiswyang/try/emba-ai-sim-v01
k6 run scripts/loadtest_llm_spike.js
```

常用环境变量：

```bash
BASE_URL=https://app.praxisengine.xyz k6 run scripts/loadtest_llm_spike.js
RUN_ID=llm_baseline_20260528 k6 run scripts/loadtest_llm_spike.js
REQUEST_TIMEOUT=30s k6 run scripts/loadtest_llm_spike.js
MOCK_LATENCY_MS_MEAN=1500 k6 run scripts/loadtest_llm_spike.js
```

说明：

- 所有团队名和成员名都带 `loadtest_llm_` 前缀，便于 SQL 清理。
- `MOCK_LATENCY_MS_MEAN` 默认是 `1500`，k6 会用它计算“应用额外等待时间代理值”：
  `queue_wait_proxy = app_request_duration - 1500ms`

## 4. 在 GCP 另一终端监控

```bash
watch -n 2 '
  echo "=== Mock stats ==="
  curl -s http://127.0.0.1:8088/stats
  echo
  echo "=== Container stats ==="
  docker stats --no-stream
  echo
  echo "=== DB activity ==="
  docker compose exec -T db psql -U emba_sim -d emba_sim -c "SELECT state, COUNT(*) FROM pg_stat_activity WHERE datname='\''emba_sim'\'' GROUP BY state;"
'
```

重点看三件事：

- mock 的 `inflight / max_inflight / by_caller_type`
- `app`、`db` 容器 CPU / memory
- `pg_stat_activity` 是否在 LLM 压力下同时抬高

## 5. 跑完清理 + 切回正常配置

先把清理 SQL 拷进 DB 容器并执行：

```bash
docker cp scripts/cleanup_loadtest.sql pelovotsim-db-1:/tmp/cleanup_loadtest.sql
docker compose exec db psql -U emba_sim -d emba_sim -f /tmp/cleanup_loadtest.sql
```

然后关闭 loadtest 模式，切回正常：

```bash
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml down
docker compose up -d

sleep 10
docker compose logs app --tail 20
```

这里要确认两件事：

- 正常服务已经重新启动
- `DEEPSEEK_BASE_URL` 不再指向 `mock-deepseek`

## 6. 结果怎么读

看 k6 输出时，优先盯下面几项：

- `http_req_duration` / `llm_path_latency`
- `llm_queue_wait_ms`
- `error rate`
- `Slowest Routes Top 5`
- mock `/stats` 里的 `max_inflight`

经验判断：

| 现象 | 推断 |
|------|------|
| `p95` 接近 1500-2000ms | 应用基本没排队，闸门还没明显饱和 |
| `p95` 明显高于 1500ms，比如 5000-8000ms | `LLM_CONCURRENCY` 闸门前排队明显 |
| `llm_queue_wait_ms p95` 很高 | 真瓶颈更像应用内排队，不是 mock 本身 |
| mock `max_inflight` 远低于 100，但 app 延迟已经很高 | 说明请求大量堵在应用进程内，还没真正打到 mock |
| 错误率 > 5% | 很可能是排队过长、上游超时或重试后仍失败 |
| DB CPU 也明显升高 | 除了 LLM 闸门，DB 写入链路也在放大延迟 |

## 7. cleanup 审计结论

现有 `scripts/cleanup_loadtest.sql` 已覆盖这次 LLM 压测会留下的核心数据：

- `round2_interview_sessions`
- `vp_sessions`
- `vp_iterations`
- `computation_log`
- `llm_call_metrics`
- `llm_wizard_outputs`
- `member_submissions`
- `teams / team_members`

这次无需额外改 SQL 结构，只要继续保证团队名前缀是 `loadtest_%` 即可。
