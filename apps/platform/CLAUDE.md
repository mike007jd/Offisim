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

## 测试

- `createMockDb([results])` 按 callIndex 消费。加 middleware 前置 DB 查询会导致 mock 错位, 需同步调整
