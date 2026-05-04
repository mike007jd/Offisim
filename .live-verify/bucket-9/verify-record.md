# bucket-9 batch-1 — release app live verify report

## Executive Verdict

**Verdict**: REQUESTED LIVE VERIFY PASS / ARCHIVE BLOCKED BY NEW INSTALL BUG

**Latest verify**: 2026-05-04, release `.app`, commit `28819d62`

Bucket 9 batch 1 的 Market 展示类目标已经在 release `.app` 里跑通：6 张 official cards、真实 16:9 cover、cover overlay、详情 carousel、changelog、requirements、lineage、creator、published date、Manage Published unauth、Manage Published authenticated draft rows/status 都有 live 证据。

本轮额外测出了一个真实产品问题：catalog reseed 后 listing id 变了，已安装状态只按旧 `origin_listing_id` 识别，导致同一个 `package_id/version` 已存在时，卡片和详情仍可能显示 `Install`；用户点安装后会撞本地唯一约束并报错。这个不是 batch 1 UI 展示代码本身坏了，但会影响“已安装 Market listing”的真实用户体验。

已补齐本地测试账号链路：创建本地 platform verify creator、API token、5 条 draft rows，并把 token 写入 Tauri WebKit localStorage。release `.app` 通过真实 `/v1/publish/drafts` 渲染了 `draft` / `validated` / `submitted` / `approved` / `rejected` 五个状态。

## Runtime Evidence

- Git HEAD: `28819d62`
- Release app path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Running process: exact worktree release app, Computer Use attached to `com.offisim.desktop`
- Main verified routes:
  - `tauri://localhost/market/explore`
  - `tauri://localhost/market/explore/0289b20b-87f3-4e0c-b232-6599c27b65f0`
  - `tauri://localhost/market/manage/published`
- Registry API:
  - `/v1/market/search` returned 6 official listings with `preview.kind: image`
  - `/v1/market/listings/0289b20b-87f3-4e0c-b232-6599c27b65f0` returned 3 image previews, changelog, requirements, lineage, creator, and published date
  - `/v1/publish/drafts` without token returned `401 Authentication required`
  - `/v1/publish/drafts` with local verify token returned 5 draft rows: `draft`, `validated`, `submitted`, `approved`, `rejected`

## Screenshot Evidence

- `01-market-cards.png` — original card grid, 6 official cards, no-cover fallback stable.
- `02-market-detail-installed.png` — original installed detail state.
- `03-manage-published-empty-authenticated.png` — earlier authenticated empty Published state.
- `04-rich-cards-cover-overlay.png` — after `28819d62`, all 6 cards show real image covers and kind chips.
- `05-rich-detail-carousel-sections.png` — detail page renders carousel and rich sections.
- `06-carousel-next.png` — carousel next changed image to `Pipeline view`.
- `07-carousel-dot-third.png` — carousel dot navigation changed image to `Q3 launch brief`.
- `08-install-duplicate-provenance-error.png` — real install attempt after reseed fails with duplicate installed package constraint.
- `09-installed-badge-on-real-cover-after-provenance-fix.png` — after local provenance correction, real-cover card shows `Installed` overlay.
- `10-manage-published-unauth.png` — Manage → Published no-token state renders `Sign in to view your drafts`.
- `11-manage-published-draft-rows-statuses.png` — Manage → Published authenticated state renders 5 rows with all status chips.

## Requested Scope Mapping

| Requested check | Result | Evidence | Product read |
| --- | --- | --- | --- |
| 6 official cards render | PASS | `04-rich-cards-cover-overlay.png` | All six official listings visible. |
| 16:9 cover hero with real cover | PASS | `04-rich-cards-cover-overlay.png`, API audit | All six listings now return image previews and render cover hero. |
| No-cover fallback does not break | PASS | `01-market-cards.png` | Original no-cover path was stable. |
| Kind chip overlay on cover | PASS | `04-rich-cards-cover-overlay.png` | Kind chips render inside cover area. |
| Installed badge overlay on real cover | PASS visually, but natural state has a bug | `09-installed-badge-on-real-cover-after-provenance-fix.png`, `08-install-duplicate-provenance-error.png` | Overlay works when provenance matches. Reseeded listing id can make an already-installed package look installable. |
| Detail opens | PASS | `05-rich-detail-carousel-sections.png` | Official listing detail opens in release app. |
| Carousel prev/next + dots | PASS | `05`, `06`, `07` screenshots | 3 image previews render; next and dot navigation both change image. |
| Changelog section | PASS | `05-rich-detail-carousel-sections.png`, accessibility tree | Changelog text renders. |
| Requirements section | PASS | `05-rich-detail-carousel-sections.png`, accessibility tree | `boss-route`, `pm-planner`, `memory-write`, plus `gpt-4o-mini` and `claude-haiku-4-5` render. |
| Lineage section | PASS | `05-rich-detail-carousel-sections.png`, accessibility tree | `origin_package_id` and `derivative_of` render. |
| Creator display name / handle / verification | PASS | `05-rich-detail-carousel-sections.png` | `Offisim @offisim` and verification dot render. |
| Published date row | PASS | `05-rich-detail-carousel-sections.png`, accessibility tree | `published_at` row renders. |
| Manage Published unauth copy | PASS | `10-manage-published-unauth.png` | No-token session shows `Sign in to view your drafts`. |
| Manage Published real draft rows/status | PASS | `11-manage-published-draft-rows-statuses.png`, API audit | Local verify creator/token returned and rendered `draft`, `validated`, `submitted`, `approved`, `rejected`. |

## Live Catalog Data Audit

`GET /v1/market/search` now returns:

| Title | Kind | Preview | Listing id |
| --- | --- | --- | --- |
| Sample Marketing Strategist | employee | image | `0289b20b-87f3-4e0c-b232-6599c27b65f0` |
| Research Summary | skill | image | `28794f55-c162-4957-b714-46d7b0a61550` |
| Research Pipeline | sop | image | `f6772fd3-3bba-4905-b6bf-c5b37ac614ee` |
| Agency Lite Company Template | company_template | image | `a52a0b27-90fa-4b50-b00c-fbf4efda9eb1` |
| Starter Office Layout | office_layout | image | `5ae05ae0-b64d-41b8-a8f6-b90b4d9b9072` |
| Desk Essentials Prefab Pack | prefab | image | `e8a32d5b-35a3-45e4-936b-fcd30d39236b` |

`Sample Marketing Strategist` detail returned:

| Field | Live value | Result |
| --- | --- | --- |
| `previews[]` | `Sample marketing strategist avatar`, `Pipeline view`, `Q3 launch brief` | PASS |
| `version.changelog` | `1.0.0 — Initial release...` | PASS |
| `required_capabilities` | `boss-route`, `pm-planner`, `memory-write` | PASS |
| `recommended_models` | `gpt-4o-mini`, `claude-haiku-4-5` | PASS |
| `lineage.origin_package_id` | `offisim.template-ai-startup-product-manager` | PASS |
| `lineage.derivative_of` | `offisim.template-ai-startup` | PASS |
| `published_at` | `2026-05-04T21:02:07.102Z` | PASS |

## New Finding

**Severity: real product bug, should fix before closing bucket 9 archive.**

Installed-state matching is too brittle after catalog reseed/listing id rotation.

Observed path:

1. Local DB already has `offisim.sample-marketing-strategist` version `1.0.0` installed.
2. Existing installed rows pointed to old listing id `a15282fd-5a70-49b7-99a8-9f6f504d0db4`.
3. New catalog listing id is `0289b20b-87f3-4e0c-b232-6599c27b65f0`.
4. UI treated the new listing as not installed and showed `Install`.
5. Clicking through install failed with `UNIQUE constraint failed: installed_packages.company_id, installed_packages.package_id, installed_packages.version`.

Product impact: a user can see an already-installed official package as installable, then hit a hard error. Recommended fix is to reconcile installed state by stable package identity/version, not only by listing id provenance, and make install idempotent for already-installed `package_id/version`.

For visual proof only, I corrected the current local company's `origin_listing_id` to the new listing id and relaunched release `.app`; the real-cover card then rendered `Installed` overlay correctly. That proves the overlay UI works, but it also proves the natural install/provenance path needs repair.

## Published Rows Verify Setup

To complete the authenticated Published state, I created local-only platform verify data:

- Better Auth user / Offisim user: `bucket9-live-verify@offisim.local`
- Creator handle: `bucket9-live-verify`
- API token: stored only in local DB/WebKit storage; raw token is intentionally not written in this report.
- Draft rows:
  - `Bucket 9 Draft Row` — `skill` — `Draft`
  - `Bucket 9 Validated Row` — `employee` — `Validated`
  - `Bucket 9 Submitted Row` — `sop` — `Submitted`
  - `Bucket 9 Approved Row` — `company_template` — `Approved`
  - `Bucket 9 Rejected Row` — `prefab` — `Rejected`

This is real platform data and release `.app` rendering, not a mocked UI path.

## Gate Recommendation

Do not archive bucket 9 as fully closed yet, but the reason is no longer missing live verify coverage.

Recommended status:

> Bucket 9 batch 1 requested live verify passed in release `.app`; archive closure is blocked by the newly found installed provenance/idempotent install bug.

## Remaining To Close

1. Fix installed-state reconciliation/idempotent install for reseeded listing ids.
2. Verify the fixed natural path without manually editing local provenance.

## PM Readout

Claude 的 data unblock 确实把前 6 个“未证明”补上了；我又补了 no-token unauth 和 authenticated draft rows/status。现在 batch 1 请求的 live verify 已完整覆盖。唯一不能直接 archive 的原因，是彻测时发现了更真实的安装态一致性问题：同包同版本已经安装时，listing id 漂移会让 UI 和 install flow 分叉。这个应该进 batch 2 或作为 archive 前必修项处理。
