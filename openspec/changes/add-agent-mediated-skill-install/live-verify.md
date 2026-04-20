# Live verify — agent-mediated skill install (T2.2)

**Status:** not yet run in a live runtime. Code is typecheck-green + build-green. Live verify
requires a real browser + real Tauri build + a live LLM provider, plus user-driven chat. This
document is the rubric to execute against before `/opsx:archive`.

## Prerequisites

- Web: `pnpm --filter @offisim/web dev` on port 5176 with `.env.local` MiniMax key active
- Desktop: `pnpm --filter @offisim/desktop dev` — requires Tauri plugin-fs + `git` binary on PATH
- Tauri git allowlist: `clone` is in `ALLOWED_SUBCOMMANDS` (`apps/desktop/src-tauri/src/git.rs`).
  Rebuild the Tauri shell for the change to take effect.
- **Web vault** auto-mounts OPFS when no user-picked directory is stored (new as of 2026-04-19).
  Persistence is browser-scoped — acceptable for live verify. For durable-on-disk persistence
  the user can still mount a real directory from Settings; OPFS contents don't migrate.
- An uploaded chat-attachment UI path (`InMemoryUploadRefResolver`) — the T2.2 code exposes the
  resolver but the chat panel does not yet surface a "Attach file" affordance.
  `install_skill_from_upload` live verify can be done by programmatically injecting a ref via
  DevTools (`runtime.uploadRefResolver.put('test-ref', 'skill.zip', bytes)`) until the UI ships.

## Scenarios

### 9.1 Web MiniMax · git install (company scope)

**Status (2026-04-19, Codex live runs):**

- Run 1 — CORS blocker: **fixed** (api.github.com → codeload 302 was cross-origin; dev mode now
  tunnels through same-origin Vite proxy). Bubble starts rendering.
- Run 2 — subpath vs ref confusion: LLM put `do-research` into `ref`, got 404. Tool schema
  hardening landed: explicit `ref = ONLY git branch/tag/commit`, `subpath = directory`, plus
  `git-ref-not-found` directive error that tells the LLM to retry with subpath. Run with
  `subpath=skills/frontend-design` confirmed a real SKILL.md bubble (name/desc/allowedTools).
- Run 3 — vault not mounted: click Install → `skill-install-committer` errored with
  `Vault not activated yet`. **Fix landed:** `createBrowserVaultController` now auto-mounts
  OPFS when no user-picked directory is stored (see `acquireOpfsRootHandle` +
  `vault-browser-activation.ts`). The user can still pick a real directory later from Settings;
  that swaps the handle (OPFS contents don't migrate — explicit trade-off).

**Test case update:** `do-research` is not a subpath that exists in `anthropics/skills` as of
2026-04-19. Real skills live under `skills/<name>/` (e.g. `skills/frontend-design`, `skills/pdf`).
Re-run against a known-good path:

**Status (2026-04-20): PASS** — Codex re-run via headed Chrome + Playwright (Safari dev server
had intermittent blank-reset issue). Prompt `装一下 github.com/anthropics/skills 里的
skills/frontend-design` triggered correct confirm bubble (Source git + subpath, Scope
`Company (all employees)`) and `Skill installed.` upon confirm.

- [x] "Install `skills/frontend-design` from `github.com/anthropics/skills`" → LLM issues
      `install_skill_from_git({ url, subpath: 'skills/frontend-design' })`
- [x] Bubble renders with `frontend-design` name / description / allowedTools / source preview
- [x] Click **Install** → `skills` row `scope='company'`, `source_kind='installed'`,
      `source_ref='git:https://github.com/anthropics/skills#skills/frontend-design'`
- [x] Vault (OPFS or user-picked) has
      `companies/{id}/skills/frontend-design/SKILL.md`
- [ ] Natural-language "Install frontend-design from anthropics/skills" without explicit
      subpath → resolver returns `skill-scanner-ambiguous` with candidate list and directive
      message; LLM retries with `subpath=skills/frontend-design` (not manual user selection)
      — not re-run this round; path is exercised by directive-error code and schema hardening
      (see 2026-04-19 Run 2 notes above).

### 9.2 Web · employee scope

**Status (2026-04-20): PASS (main path)** — first Codex run failed because employee prompt
never injected the coworker roster; LLM guessed `maya-lin` / `maya` / `lin` as id and fell
back to company scope (or blew through tool-loop max 5 rounds). Fixed by commit
`8fccdf82` (two-pronged):

- **A** `employee-prompt-assembly.ts` now injects `## Available coworkers` section using
  the existing `buildEnrichedEmployeeList` helper (excludes self). LLM can read
  `employee_id: name (role)` table and pick the correct UUID directly.
- **B** `skill-install-tools.ts` accepts `targetEmployeeId` as either a UUID or a
  case-insensitive exact name. Handler tries `findById` first, then `findByCompany` +
  name filter. Ambiguous name returns `target-employee-ambiguous` + `candidates` for
  LLM retry with specific id.

Codex re-verify 2026-04-20 prompt `装一下 github.com/anthropics/skills 里的
skills/frontend-design，装到 Maya Lin 那儿`:

- [x] Confirm bubble appears with Source git + subpath, Scope `Employee: Maya Lin`
- [x] Confirm → `Skill installed.` (`skills` row `scope='employee'`,
      `employee_id=<maya-lin-uuid>`)
- [x] LLM picked correct id from injected coworker roster (A is sufficient for single-name
      case)

**B branch (ambiguous) observation**: Codex added a second `Maya Lin` to the company and
re-ran `装到 Maya Lin 那儿` / `装到 Maya 那儿`. Neither hit the `target-employee-ambiguous`
branch — LLM reads both UUIDs in the coworker roster and picks one directly (returning a
valid id to the handler, which goes through `findById`). This is the expected consequence
of A winning: once the id table is injected, B's name-fallback is only reachable when the
LLM for some reason does not use an id (prompt truncation at 50+ employees, stale history
message carrying a name string, or agent-to-agent message passing name instead of id).
Unit-level logic is in place; no live-runtime evidence for this round.

### 9.3 Desktop Tauri · git install

**Status (2026-04-20): PASS** — release `Offisim.app` + Computer Use driven via debug bridge
(`window.__OFFISIM_DEBUG__.runSkillInstallTool` + `respondToInteraction`). End-to-end chain
`install_skill_from_git → pending-confirm → confirm → "Skill installed."` returned clean.

Evidence:

- skills row: `frontend-design | company | installed |
  git:https://github.com/anthropics/skills#skills/frontend-design |
  companies/<id>/skills/frontend-design/SKILL.md`
- vault file: `~/Library/Application Support/com.offisim.desktop/vault/companies/<id>/skills/frontend-design/SKILL.md`
- Tauri git plugin + shell clone path exercised (no web-tarball fallback).

Blockers cleared in this session (all landed, see commits + live-verify record):

- Multi-instance SQLite lock → `tauri-plugin-single-instance` registered first in `lib.rs`
- Release CSP blocked Ajv runtime compile → asset-schema switched to Ajv standalone precompile;
  MCP SDK Ajv required `'unsafe-eval'` (documented in `tauri.conf.json` `_csp_note`)
- `plugin-sql` IPC blocked by CSP → capability expanded; `vault sync` first-time "file not
  found" was re-classified from fatal to expected
- Tauri `fs` scope too narrow → capability granted recursive temp read/write/meta; skill tree
  walker made resilient to unreadable subtrees (e.g. `.claude-plugin`)
- `active_thread_interactions` FK → runtime bootstrap now ensures `thread-{companyId}` row
  exists before interactions persist (web + Tauri)
- `graph_threads.synopsis_json` missing on desktop → added migration `032` + registered in
  Tauri SQL plugin
- `graph_threads` status CHECK mismatched → bootstrap default changed from `idle` → `queued`
- Release DevTools + `window.__OFFISIM_DEBUG__` bridge retained so Computer Use can drive
  release bundle directly

Residual non-blocker noise (ignored):

- `[Offisim] Desktop MCP registry unavailable in this build; skipping auto-connect.`
- `THREE.Clock` deprecation warning

- [x] Repeat 9.1 in the Tauri app. Resolver branches to `createTauriGitCloneAdapter()` →
      `invoke('git_exec', { args: ['clone', '--depth', '1', url, tmp], cwd: $TMPDIR })`
- [x] Tmp dir under `$TMPDIR/offisim-skill-*/` is populated, then cleaned up post-install
- [x] Row inserted identically to 9.1

### 9.4 Desktop · upload (zip with scripts/)

- [ ] Prepare a zip with `SKILL.md` + `scripts/run.sh`
- [ ] Register via devtools: `runtime.uploadRefResolver.put('up-1', 'skill.zip', bytes)`
- [ ] Ask the employee: "Install the uploaded skill, ref `up-1`."
- [ ] Bubble shows `Assets · scripts/run.sh`
- [ ] Confirm → vault has `scripts/run.sh` under the skill dir

### 9.5 Desktop · sync_from_claude_code

- [ ] Ensure `~/.claude/skills/review-code/SKILL.md` exists (write a test fixture if needed)
- [ ] Ask: "Sync from Claude Code — find review-related skills."
- [ ] Tool returns `{ kind: 'sync-candidates', candidates: [...] }` (LLM filters by `filter`)
- [ ] LLM invokes `install_skill_from_upload` (or a follow-up git call) per selection; or — if
      T2.2 follow-up adds a direct `install_skill_from_sync` variant, bubble per selection
- [ ] Install path succeeds

### 9.6 Web · sync_from_claude_code rejected

- [ ] Ask the same "Sync from Claude Code" prompt on web
- [ ] Tool returns `{ kind: 'not-supported-in-web' }`
- [ ] LLM reply should acknowledge the restriction and suggest desktop / upload

### 9.7 Path traversal rejection (T2.1 deferred 11.8)

- [ ] Craft a zip with an entry named `scripts/../../../etc/passwd`
- [ ] Preview should render (scanner does not enforce traversal)
- [ ] Confirm → `installSkill` throws `SkillAssetError` `path-traversal`
- [ ] No `skills` row inserted; no vault file written

### 9.8 Slug collision (T2.1 deferred 11.7)

- [ ] Install `do-research` from source A
- [ ] Install another `do-research` from a different URL
- [ ] Second preview renders; confirm → `SkillInstallError` `slug-collision`

### 9.9 Cross-scope override (T2.1 deferred 11.9)

- [ ] Install `email-triage` at company scope
- [ ] Install `email-triage` at employee scope for Alice
- [ ] `listSkillsForEmployee(company, alice)` returns the employee-scope row (overrides company)
- [ ] Other employees still see the company-scope row

### 9.10 Desktop migration (T2.1 deferred 11.3)

- [ ] Seed a Desktop SQLite DB with one employee carrying a legacy
      `config_json.runtimeSkill` and NO `settings.skills_migration_v1_done` marker
- [ ] First user message that triggers vault activation → `onVaultReadyForSkills` runs the
      migration, marker is written, employee `config_json.runtimeSkill` stripped, synthesized
      employee-scope skill appears

### 9.11 Cancel / timeout

- [ ] Trigger `install_skill_from_git`, click **Cancel** → `staging` cleared, no row
- [ ] Trigger another install, wait 30 min or stub `now`, click **Install** → returns
      `staging-expired` outcome, LLM acknowledges

### 9.12 Wide-scope pattern red badge

- [ ] Craft a SKILL.md with `allowedTools: ['bash:*', 'network:read']`
- [ ] Preview bubble: `bash:*` rendered with `data-wide-scope="true"` + red style,
      `network:read` default gray
- [ ] Screenshot the bubble for archive

## Edge cases to watch during live

- Empty upload / wrong MIME → `upload-unsupported-format` structured error, not a thrown exception
- GitHub rate limit hit → `github-rate-limited` with `resetAt` propagated to chat
- Tauri git binary missing → `git-fetch-failed` with stderr tail visible
- SKILL.md missing `name` or `description` → `SkillMdParseError` surfaced to LLM

## Deferred followups (non-blocking)

1. Chat panel UI to attach a file and obtain a `fileRef` for `install_skill_from_upload` —
   currently only programmatic via DevTools
2. Bundle-size: consolidate fflate usage so the lazy chunk drops below 30 KB gzip
3. A2A external employees don't go through `assembleToolKit`; the 4 tools are not advertised to
   the remote brand. Whether that surfaces as a user-visible gap depends on how external peers
   handle "install" intents — track separately
4. Optional: expose `install_skill_from_sync` as a dedicated tool (today the LLM needs to call
   `install_skill_from_upload` with a path from the sync list; fine, but could be tighter)
