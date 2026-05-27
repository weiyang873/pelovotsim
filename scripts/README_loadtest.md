# Spike Load Test

这个脚本专门测“上课铃一响，几十到一百个学生几秒内同时进来”的瞬时尖峰，不是慢慢爬升的压测。

脚本只访问非 LLM 路由：
- `GET /` 和页面引用的同源静态资源
- `POST /api/team/create`
- `POST /api/team/:id/join`
- `GET /api/team/:id`
- `GET /api/team/:id/status?lite=1`
- `GET /api/round2/state`
- `GET /multiplayer/round2`

它不会调用任何含 `chat` / `llm` / `coach` / `interview` 的接口，也不会碰 `/api/persona-generate`。

## 1. 安装 k6

```bash
brew install k6
```

## 2. 运行方式

```bash
# 在 GCP 上先重启 app（清掉 memoization 缓存，让压测从冷状态开始）
# gcloud compute ssh gpc-vm-new --zone=asia-southeast1-b -- "cd ~/pelovotsim && docker compose restart app"

# 等 15 秒让 app 启动完
sleep 15

# 本地跑 k6
k6 run scripts/loadtest_spike.js
```

可选环境变量：

```bash
BASE_URL=https://app.praxisengine.xyz k6 run scripts/loadtest_spike.js
RUN_ID=preclass_20260528 k6 run scripts/loadtest_spike.js
REQUEST_TIMEOUT=20s k6 run scripts/loadtest_spike.js
```

说明：
- 团队名固定以 `loadtest_` 开头，便于事后清理。
- 每个 VU 首轮会 `create + join` 自己的 1 人组，之后循环只刷新状态和访问 Round 2 页面，避免重复 join 同一团队导致假失败。

## 3. 运行时监控 GCP

在另一个终端执行：

```bash
gcloud compute ssh gpc-vm-new --zone=asia-southeast1-b
watch -n 2 'docker stats --no-stream && docker compose exec db psql -U emba_sim -d emba_sim -c "SELECT COUNT(*) FROM pg_stat_activity WHERE datname='\''emba_sim'\'' AND state != '\''idle'\'';"'
```

重点看：
- `app` 容器 CPU / memory
- `db` 容器 CPU
- `pg_stat_activity` 活跃连接数
- 压测总结里的 `p95 / p99 / error rate`

## 4. 跑完清理

```bash
docker cp scripts/cleanup_loadtest.sql pelovotsim-db-1:/tmp/
docker compose exec db psql -U emba_sim -d emba_sim -f /tmp/cleanup_loadtest.sql
```

## 5. 为什么一定要 spike，不要 slow ramp

这里要测的是“铃响后 60-100 人几秒内一起登录”的锁竞争和冷缓存首波并发，不是平滑扩容能力。

如果用 `60s -> 100 VU` 这种慢爬升：
- memoization 的首轮竞争会被摊平
- 数据库热点会被摊平
- 很可能测不出真实课堂里的 race / lock contention

所以脚本固定用 `5s -> 100 VU -> hold 30s -> cool down`，故意保留那一下最陡的冲击。
