# @offisim/platform

Hono API 服务端, Drizzle + PostgreSQL。

## Gotchas

- DB 连接错误返回 503, 非 500
- listing 必须用 `getVisibleListing()`/`requireVisibleListingById()` (强制 `status='listed'`), 不要直接 query
- `optionalAuth` email 冲突设 `authLinkConflict: true`, `requireAuth` 返回 `AUTH_LINK_CONFLICT` 401
- Reviews self-review 防护: creators JOIN 比较 user_id (403)
- Rate limiter 只信 `X-Forwarded-For` 最右第 N 个 IP (`TRUSTED_PROXY_DEPTH`), 不信 `X-Real-IP`
- creator 所有权走 `requireCreator` 中间件, 用 `getRequiredCreatorId(c)` / `findCreatorIdByUserId()`。`/me` 例外, 注册在 requireCreator 之前
- 没有后台队列: POST `/submit` 路由同步调 `processModerationJob()` 立即返 202
- SHA-256 哈希存 API token (不是明文); Better Auth 自动 upsert Offisim user
- fork 谱系用 `WITH RECURSIVE lineage_chain` CTE 上下追 10 层 (GET `/listings/:listingId/lineage`)

## Boot-time official seed

- `apps/platform/src/index.ts` 启动时 fire-and-forget 调 `seedOfficialResources(db, { baseUrl })`（失败只 warn，不阻断监听）
- **幂等钥匙 = `creators.handle = 'offisim'`**：命中则整批跳过 INSERT，但仍会把 6 条 seed listing 的 `.offisimpkg` 字节重新 build 进内存 `artifact-store`，这样 platform 每次重启后 Market 安装还能跑
- seed 会先 upsert 一条 `users` 行（email `official-seed@offisim.local`，auth_provider `system`），再建 creator + 6 条 listing + 6 条 version + 每条 ≥1 条 preview
- **artifact 服务路径**：`GET /v1/install/artifacts/:versionId` 直接回 `artifact-store` 里的 zip bytes，`artifact_url` 指向这个 URL（`${PLATFORM_PUBLIC_URL ?? http://localhost:${PORT}}/v1/install/artifacts/<versionId>`）。用户自己 publish 的 listing 走原来的 `artifact_url`（外部 URL），Market 发过来的 versionId 若不在 seed 集合里就 404
- **想强制 re-seed**：`psql -d offisim_platform -c "DELETE FROM creators WHERE handle='offisim';"` 级联清掉 6 条 listing / version / preview，重启 platform 即重新种。只删单条 listing 不会触发 re-seed（设计是整批一致性）
- `seedOfficialResources` 的 payload 定义在 `apps/platform/src/seed/payloads/`，其中 `employee` / `company-template` / `prefab` / `office-layout` 直接 import 仓库已有 source-of-truth（templates、builtin-catalog、default-zone-layouts），`skill` / `sop` 是手写 payload。`skill` 读 `skill-research-summary.md`，prod 模式需要把该文件拷到 `dist/seed/payloads/`（目前平台主要跑 tsx dev 模式，暂未配拷贝步骤）

## 测试

- `createMockDb([results])` 按 callIndex 消费。加 middleware 前置 DB 查询会导致 mock 错位, 需同步调整
