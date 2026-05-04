# bucket-9 batch-1 — release app live verify report

## Executive Verdict

**Verdict**: REQUESTED LIVE VERIFY PASS / READY TO ARCHIVE

**Latest verify**: 2026-05-04 22:53 NZST, release `.app`, commit `2cf38037`

Bucket 9 batch 1 的 Market 展示类目标已经在 release `.app` 里跑通：6 张 official cards、真实 16:9 cover、cover overlay、详情 carousel、changelog、requirements、lineage、creator、published date、Manage Published unauth、Manage Published authenticated draft rows/status 都有 live 证据。

先前额外测出的真实产品问题已经复测关闭：catalog reseed 后 listing id 漂移不再让已安装 listing 显示为可安装，已安装状态能通过自然路径识别。

已补齐本地测试账号链路：创建本地 platform verify creator、API token、5 条 draft rows，并把 token 写入 Tauri WebKit localStorage。release `.app` 通过真实 `/v1/publish/drafts` 渲染了 `draft` / `validated` / `submitted` / `approved` / `rejected` 五个状态。

Archive blocker re-verify 已按不绕过路径完成：未修改 `origin_listing_id`，未修改 `installed_packages` 行，重启 release `.app` 后进入 Market，`Sample Marketing Strategist` 卡片自然显示 `Installed` 角标；进入详情页后 CTA 为 disabled `Installed`，没有触发 `UNIQUE constraint failed`。

## Runtime Evidence

- Git HEAD: `2cf38037`
- Release app path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Running process: exact worktree release app, Computer Use attached to `com.offisim.desktop`
- Main verified routes:
  - `tauri://localhost/market/explore`
  - `tauri://localhost/market/explore/0289b20b-87f3-4e0c-b232-6599c27b65f0`
  - `tauri://localhost/market/manage/published`
  - `tauri://localhost/market/explore/0289b20b-87f3-4e0c-b232-6599c27b65f0` after release restart, without DB edits
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
| Installed badge overlay on real cover | PASS | Computer Use release `.app` re-verify, 2026-05-04 22:53 NZST | Natural path shows `Installed` without manual DB provenance edits. |
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

## Resolved Archive Blocker

**Status: resolved and re-verified in release `.app`.**

The previously observed installed-state mismatch after catalog reseed/listing id rotation no longer reproduces.

Original failing path:

1. Local DB already has `offisim.sample-marketing-strategist` version `1.0.0` installed.
2. Existing installed rows pointed to old listing id `a15282fd-5a70-49b7-99a8-9f6f504d0db4`.
3. New catalog listing id is `0289b20b-87f3-4e0c-b232-6599c27b65f0`.
4. UI treated the new listing as not installed and showed `Install`.
5. Clicking through install failed with `UNIQUE constraint failed: installed_packages.company_id, installed_packages.package_id, installed_packages.version`.

Product impact before fix: a user could see an already-installed official package as installable, then hit a hard error.

Re-verify path after fix:

1. Did not edit `origin_listing_id`.
2. Did not edit `installed_packages`.
3. Restarted release `.app` via `pnpm run release:run`, which now starts platform `4100` and web `5176` before opening the app.
4. Opened Market in the release app using Computer Use.
5. `Sample Marketing Strategist` card displayed the `Installed` badge naturally.
6. Opened `Sample Marketing Strategist` detail.
7. Detail CTA was disabled `Installed`, not clickable `Install`.
8. No `UNIQUE constraint failed` surfaced.

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

Bucket 9 batch 1 is ready to archive.

Recommended status:

> Bucket 9 batch 1 requested live verify passed in release `.app`; the installed provenance/idempotent install archive blocker has been re-verified closed without manual DB edits.

## Remaining To Close

None for this archive gate.

## PM Readout

Claude 的 data unblock 确实把前 6 个“未证明”补上了；我又补了 no-token unauth 和 authenticated draft rows/status。现在 batch 1 请求的 live verify 已完整覆盖。原先唯一不能 archive 的原因已经复测关闭：同包同版本已安装时，listing id 漂移不会再让 UI 和 install flow 分叉；卡片和详情都自然显示 Installed。
