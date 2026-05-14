# 部署多 key pool 到 GCP

## 前置确认
- 本地已 `git push` 包含 docker-compose.yml 改动
- 当前没有学生在使用平台
- 准备好 8 个 DeepSeek API key 的明文值（不要贴到任何 chat 或 issue 里）

## 步骤

```bash
# 1. SSH 上 VM
gcloud compute ssh gpc-vm-new --zone=asia-southeast1-b

# 2. 拉代码（在项目目录）
cd <项目路径>
git pull

# 3. 编辑 .env，加 8 个 key
nano .env
```

在 .env 里追加（值用本地 .env 里的实际值替换）：

```
DEEPSEEK_API_KEY_1=sk-xxx1
DEEPSEEK_API_KEY_2=sk-xxx2
DEEPSEEK_API_KEY_3=sk-xxx3
DEEPSEEK_API_KEY_4=sk-xxx4
DEEPSEEK_API_KEY_5=sk-xxx5
DEEPSEEK_API_KEY_6=sk-xxx6
DEEPSEEK_API_KEY_7=sk-xxx7
DEEPSEEK_API_KEY_8=sk-xxx8

# 并发上限：8 个 key 单进程下建议 20-30
LLM_CONCURRENCY=20

# 重试次数：建议 2（默认 1 偏低）
LLM_MAX_RETRIES=2
```

旧的 `DEEPSEEK_API_KEY=...`（单数）保留或删除都可以——pool 会自动去重，不会重复计数。

```bash
# 4. 重启容器
docker compose down
docker compose up -d

# 5. 验证 pool size
docker compose logs --tail 100 | grep -i "rotation pool"
# 期望输出：Loaded 8 API key(s) into rotation pool
# 如果显示 1：说明新 env 没生效，检查 docker-compose.yml 的 environment: 段

# 6. 健康接口验证
curl https://app.praxisengine.xyz/api/health
# 期望看到 configured:true（或类似字段）

# 7. （可选）真实 LLM 调用验证
# 进访谈页跑一轮，看 LLM 回复是否正常返回
```

## 回滚

如果出问题，回到上一次能跑的版本：

```bash
# 本地
git revert HEAD
git push

# GCP 上
git pull && docker compose down && docker compose up -d
```

## 故障排查

| 现象 | 可能原因 | 排查 |
|------|---------|------|
| `Loaded 1 API key(s)` | 新 env 没传进容器 | `docker compose exec <service> env \| grep DEEPSEEK` 看容器内是否有 KEY_1..8 |
| `DEEPSEEK_API_KEY not set` | .env 完全没 key | 看 `.env` 文件是否在容器期望的位置 |
| 启动失败 | yaml 语法错 | `docker compose config` 在本地先验证 |
