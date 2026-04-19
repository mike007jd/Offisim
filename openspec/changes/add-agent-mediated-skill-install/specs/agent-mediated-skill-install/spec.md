## ADDED Requirements

### Requirement: Employee tool kit exposes four skill-install tools to every employee

All employee agents — internal and external (`is_external === 1`) alike — SHALL be registered with four skill-install tools on every runtime turn: `install_skill_from_git`, `install_skill_from_upload`, `sync_from_claude_code`, `sync_from_codex`. Tool registration MUST NOT depend on employee role, department, or workstation. Each tool SHALL declare a JSON schema with at least a `scope: 'company' | 'employee'` parameter (default `'company'`) and an optional `targetEmployeeId: string` parameter. `install_skill_from_git` SHALL also require `url: string` and accept an optional `ref: string` (branch / tag / commit). `install_skill_from_upload` SHALL require `fileRef: string` (a handle to a user-uploaded zip / tarball / SKILL.md in the chat context). `sync_from_claude_code` and `sync_from_codex` SHALL accept an optional `filter: string` (natural-language hint forwarded back to the LLM — the tool itself enumerates all matching local skills and returns them for LLM-side selection).

#### Scenario: Tools are injected for every employee

- **WHEN** `employee-node` builds the tool list for an internal employee, an external employee (Hermes / OpenClaw / Codex brand), or any role / department
- **THEN** all four skill-install tool names SHALL be present in the tool schema passed to the LLM for that turn

#### Scenario: Tool schema carries scope + target parameters

- **WHEN** the LLM retrieves the schema for `install_skill_from_git`
- **THEN** the schema SHALL declare `scope` as `'company' | 'employee'` defaulting to `'company'`, `targetEmployeeId` as optional, `url` as required, and `ref` as optional

#### Scenario: External employees receive the same tools

- **WHEN** an A2A external employee turn fetches its tool kit
- **THEN** the four skill-install tools SHALL be present regardless of `brand_key` or `is_external` flag

### Requirement: Scope resolution is LLM-driven via tool parameters

`scope` and `targetEmployeeId` SHALL be resolved by the LLM from the user's natural-language request and passed as tool arguments; no separate UI scope selector SHALL exist. A tool call with `scope: 'employee'` MUST carry a non-empty `targetEmployeeId` that resolves to an employee in the same company as the calling agent; otherwise the tool handler SHALL return a structured error `{ kind: 'missing-target-employee' }` to the LLM without initiating any interaction or IO. A tool call with `scope: 'company'` MUST NOT carry `targetEmployeeId`; if both are provided, the handler SHALL return `{ kind: 'scope-target-conflict' }`. The handler SHALL NOT guess missing fields; it returns errors so the LLM can either ask the user or retry with corrected parameters.

#### Scenario: Employee scope without target is rejected

- **WHEN** the LLM invokes `install_skill_from_git({ scope: 'employee', url: '...' })` without `targetEmployeeId`
- **THEN** the tool handler SHALL return `{ kind: 'missing-target-employee' }` as the tool result
- **AND** no interaction SHALL be created and no filesystem IO SHALL occur

#### Scenario: Company scope with target is rejected

- **WHEN** the LLM invokes `install_skill_from_git({ scope: 'company', targetEmployeeId: 'e7', url: '...' })`
- **THEN** the tool handler SHALL return `{ kind: 'scope-target-conflict' }`

#### Scenario: Cross-company target is rejected

- **WHEN** the LLM passes a `targetEmployeeId` that does not resolve to an employee in the calling agent's company
- **THEN** the handler SHALL return `{ kind: 'target-employee-not-found' }`

### Requirement: Install tools emit a confirmation interaction, never auto-apply

Each of the four skill-install tools, after successfully fetching source content and validating the candidate SKILL.md, SHALL emit an `InteractionRequest` of kind `'skill_install_confirm'` and SHALL return the `interactionId` to the LLM instead of writing to the vault or `skills` table. The interaction SHALL carry `SkillInstallConfirmInteractionContext` containing the parsed SKILL.md (name, description, allowedTools, body), the staged asset tree preview (relative paths under `scripts/` / `references/` / `assets/`), the source descriptor (`sourceKind: 'git' | 'upload' | 'claude-code' | 'codex'` + origin URL / path / filter), the resolved `scope` and `employeeId` (nullable), and the `stagingRef` needed to commit the install on confirm. Actual vault writes and `skills` row insert SHALL happen ONLY in the confirm handler triggered by an `InteractionResponse` whose `selectedOptionId === 'confirm'`. A `selectedOptionId === 'cancel'` or interaction timeout SHALL free any staged temporary files and produce no DB state change.

#### Scenario: Tool returns an interactionId pending confirm

- **WHEN** `install_skill_from_git({ scope: 'company', url: 'https://github.com/foo/bar' })` successfully fetches a valid SKILL.md
- **THEN** the tool SHALL create an `InteractionRequest` with `kind: 'skill_install_confirm'` and return `{ status: 'pending-confirm', interactionId: '<id>' }` to the LLM
- **AND** no row SHALL have been inserted into `skills` and no file SHALL have been written under `companies/.../skills/`

#### Scenario: Confirm writes vault and DB atomically

- **WHEN** the user responds `selectedOptionId: 'confirm'` to a `skill_install_confirm` interaction carrying staging for skill slug `do-research`
- **THEN** `SkillLoader.installSkill({ scope: 'company', companyId, source, files })` SHALL execute, writing SKILL.md (and any staged assets) under the resolved vault path before inserting the `skills` row
- **AND** the interaction SHALL be resolved with a success event surfaced back to the chat thread

#### Scenario: Cancel discards staging

- **WHEN** the user responds `selectedOptionId: 'cancel'` or the interaction expires without a response
- **THEN** any temporary staging directory (tmp git clone, extracted upload) SHALL be removed
- **AND** no `skills` row SHALL be written
- **AND** a cancellation event SHALL be emitted to the thread so the LLM can acknowledge it

### Requirement: Confirmation interaction surfaces security-relevant metadata

`SkillInstallConfirmBubble` (the chat UI component that renders `kind: 'skill_install_confirm'`) SHALL display the following before the Confirm / Cancel actions: (1) skill name and description parsed from SKILL.md; (2) full `allowedTools` list with any entry matching `bash*`, `network*`, `fs*`, or `exec*` patterns marked with a distinct danger visual treatment; (3) source origin (git URL + ref, or upload filename, or `~/.claude/skills/<subpath>`, or `~/.codex/skills/<subpath>`); (4) a collapsed Markdown preview of the SKILL.md body (expandable); (5) the staged asset relative-path list under `scripts/` / `references/` / `assets/`; (6) the resolved scope (`Company` vs `Employee: <name>`). No scripts SHALL be executed for preview — assets are shown by relative path only.

#### Scenario: Wide-scope tool patterns are flagged

- **WHEN** the staged SKILL.md carries `allowedTools: ['bash:*', 'read-only-fetch']`
- **THEN** the bubble SHALL render `bash:*` with a danger style that is visually distinct from `read-only-fetch`

#### Scenario: Source origin is always shown

- **WHEN** the bubble renders a confirm for a git install
- **THEN** it SHALL display the full git URL and the ref used (defaulting to the remote default branch if unspecified)
- **WHEN** the bubble renders a confirm for an upload install
- **THEN** it SHALL display the original filename and size

#### Scenario: Scripts preview is path-only

- **WHEN** the staging contains `scripts/run.sh`
- **THEN** the bubble SHALL list `scripts/run.sh` as a string with a file icon
- **AND** the shell body SHALL NOT be displayed, executed, or fetched until the user explicitly expands the file preview (which reads the staged file as text — not as script execution)

### Requirement: Git source resolver splits by runtime to keep web bundle lean

The Git source resolver SHALL branch at runtime detection: on Desktop (Tauri), it SHALL clone the given URL (HTTPS or SSH) into a temp directory via the Tauri shell allowlist and then hand the temp path to `skill-scanner`; on Web, it SHALL accept only `github.com` URLs and fetch the tarball via `https://api.github.com/repos/{owner}/{repo}/tarball/{ref}` (defaulting to the repository's default branch when `ref` is unspecified), decompressing in memory with `fflate`. The Web branch MUST NOT import any git library; adding git as a runtime dependency to the web bundle is forbidden. Any non-GitHub URL on Web SHALL return the structured error `{ kind: 'git-web-non-github', url }` to the LLM. When dev-mode CORS prevents the browser from following `api.github.com`'s redirect to `codeload.github.com`, the Web runtime SHALL route the tarball request through the same-origin dev proxy — this is a delivery-path detail, not a protocol one.

#### Scenario: Desktop accepts any git URL

- **WHEN** the Desktop runtime receives `install_skill_from_git({ url: 'git@gitlab.example.com:team/skills.git' })`
- **THEN** the Git resolver SHALL invoke the Tauri shell `git` command to clone the repo into a temp directory
- **AND** the scanner SHALL process the checkout

#### Scenario: Web rejects non-GitHub URLs

- **WHEN** the Web runtime receives `install_skill_from_git({ url: 'https://gitlab.com/team/skills.git' })`
- **THEN** the resolver SHALL return `{ kind: 'git-web-non-github', url: 'https://gitlab.com/team/skills.git' }`
- **AND** no network request SHALL be issued

#### Scenario: Web GitHub fetch uses tarball API

- **WHEN** the Web runtime receives `install_skill_from_git({ url: 'https://github.com/foo/bar', ref: 'v1.2.0' })`
- **THEN** the resolver SHALL issue a GET to `https://api.github.com/repos/foo/bar/tarball/v1.2.0`
- **AND** the response SHALL be extracted in memory via `fflate` to feed the scanner

#### Scenario: Subpath narrows multi-skill monorepos

- **WHEN** the resolver (git or upload) receives a tree with multiple `SKILL.md` files under first-level subdirectories (e.g. `anthropics/skills` with `do-research/SKILL.md`, `canva/SKILL.md`, ...) and `subpath` is provided
- **THEN** the resolver SHALL narrow the tree to the named subdirectory before invoking `skill-scanner`
- **AND** the scanner SHALL resolve exactly one SKILL.md from the narrowed tree
- **AND** the staged `source_ref` SHALL encode the subpath (e.g. `git:https://github.com/anthropics/skills#do-research`)

#### Scenario: Subpath missing in monorepo surfaces candidates

- **WHEN** the resolver receives a multi-skill tree and no `subpath` is provided
- **THEN** the resolver SHALL return `{ kind: 'skill-scanner-ambiguous', candidates: [{ path: 'do-research/' }, ...] }` with every first-level directory containing a SKILL.md listed as a candidate
- **AND** the LLM SHALL use that list to retry with an explicit `subpath` (no auto-pick)

#### Scenario: Invalid subpath returns structured error

- **WHEN** `install_skill_from_git({ url, subpath: 'missing-dir' })` is invoked and `missing-dir` does not exist in the fetched tree
- **THEN** the resolver SHALL return `{ kind: 'git-subpath-not-found', candidates: [...first-level dirs...] }`
- **AND** the same contract SHALL hold for `install_skill_from_upload` with `{ kind: 'upload-subpath-not-found' }`

### Requirement: Upload source resolver handles zip, tarball, and single SKILL.md on both runtimes

The Upload resolver SHALL accept three payload shapes on both Desktop and Web: (1) a zip archive containing one `SKILL.md` at root or at a single top-level subdirectory; (2) a tarball (`.tar.gz` / `.tgz`) with the same layout; (3) a single standalone `SKILL.md` file. Archives SHALL be decompressed via `fflate` into an in-memory structure that `skill-scanner` can traverse. Archives containing more than one candidate `SKILL.md` SHALL cause the resolver to return `{ kind: 'upload-multiple-skills', candidates: string[] }` so the LLM can ask the user which one to install. An archive with zero `SKILL.md` at root or first-level subdirectory SHALL return `{ kind: 'upload-no-skill-md' }`.

#### Scenario: Zip with single skill at root

- **WHEN** the user uploads `skill.zip` containing `SKILL.md` at the archive root plus a `scripts/` subdirectory
- **THEN** the resolver SHALL extract, hand the virtual tree to `skill-scanner`, and produce one staged candidate

#### Scenario: Tarball with subdirectory layout

- **WHEN** the user uploads `pkg.tar.gz` containing a single top-level directory `my-skill/` with `SKILL.md` inside
- **THEN** the resolver SHALL treat `my-skill/` as the skill root and include sibling `scripts/` / `references/` / `assets/` from within that directory

#### Scenario: Standalone SKILL.md

- **WHEN** the user uploads a bare `SKILL.md` file
- **THEN** the resolver SHALL stage a virtual root with just the SKILL.md (no asset tree)

#### Scenario: Ambiguous archive

- **WHEN** the uploaded archive contains `a/SKILL.md` AND `b/SKILL.md`
- **THEN** the resolver SHALL return `{ kind: 'upload-multiple-skills', candidates: ['a/', 'b/'] }`

### Requirement: Claude Code and Codex sync resolvers are Desktop-only

`sync_from_claude_code` SHALL scan `~/.claude/skills/` (global) and the per-project `.claude/skills/` directory (resolved against the current repo root when available). `sync_from_codex` SHALL scan `~/.codex/skills/`. Both SHALL return a `{ kind: 'not-supported-in-web' }` structured error from the tool handler when invoked under the Web runtime (detected via the absence of the Tauri bridge). Both SHALL use `skill-scanner` on each detected candidate subdirectory and emit one `skill_install_confirm` interaction **per skill the LLM selects from the returned list** — the resolver itself returns all discoveries in one call, letting the LLM filter by `filter` prose and decide which skill(s) to install; the LLM SHALL NOT batch-confirm without user approval.

#### Scenario: Desktop enumerates Claude Code skills

- **WHEN** the Desktop runtime invokes `sync_from_claude_code({ filter: 'code review' })`
- **THEN** the resolver SHALL scan `~/.claude/skills/` and `.claude/skills/`, return an array of `{ slug, name, description, path }` for every discovered skill
- **AND** the tool result SHALL include all discoveries (filtering is the LLM's responsibility based on the `filter` prose)

#### Scenario: Web returns not-supported

- **WHEN** the Web runtime invokes `sync_from_claude_code`
- **THEN** the handler SHALL return `{ kind: 'not-supported-in-web' }` without filesystem access

#### Scenario: Per-skill confirm on sync

- **WHEN** the LLM selects two skills from a `sync_from_claude_code` result and calls `install_skill_from_upload` (or a sync-specific confirm path) for each
- **THEN** each skill SHALL produce its own `skill_install_confirm` interaction — no batching, no implicit multi-install

### Requirement: Unified `SkillLoader.installSkill` is the sole mutation entry point

`SkillLoader.installSkill({ scope, companyId, employeeId?, source, files })` SHALL be the only function that writes skill data to the vault and inserts into the `skills` table. It SHALL accept `scope: 'company' | 'employee'`, `companyId: string`, `employeeId?: string` (required when scope is `'employee'`, forbidden when scope is `'company'`), `source: { kind: 'git' | 'upload' | 'claude-code' | 'codex' | 'marketplace', ref: string }`, and `files: { skillMd: string; assets?: Array<{ relPath: string; content: Uint8Array | string }> }`. It SHALL enforce: (a) the tier-3 path-traversal and subtree whitelist rules from `skills-foundation` on every `assets[].relPath` BEFORE any IO; (b) slug uniqueness per scope using the existing partial UNIQUE indexes; (c) write-through order of vault bytes before DB row (SKILL.md → asset files → `skills` insert) so partial failures leave no phantom rows. `installCompanyScopeSkill(...)` SHALL remain as a thin wrapper that calls `installSkill({ scope: 'company', source: { kind: 'marketplace', ref: listingId }, ... })` — its public signature and semantics SHALL NOT change.

#### Scenario: Employee scope writes to employee vault path

- **WHEN** `installSkill({ scope: 'employee', companyId: 'c1', employeeId: 'e7', source: { kind: 'git', ref: 'https://github.com/foo/bar@main' }, files: { skillMd: '...', assets: [{ relPath: 'scripts/go.sh', content: '...' }] } })` succeeds
- **THEN** SKILL.md SHALL be written to `companies/c1/employees/<alice-slug>/skills/<skill-slug>/SKILL.md`
- **AND** `scripts/go.sh` SHALL be written under the same skill directory
- **AND** a `skills` row SHALL be inserted with `scope='employee'`, `employee_id='e7'`, `source_kind='installed'`, `source_ref='<source descriptor>'`

#### Scenario: Path traversal is rejected before any IO

- **WHEN** `files.assets = [{ relPath: 'scripts/../../../etc/passwd', ... }]` is passed
- **THEN** `installSkill` SHALL throw with an error kind `path-traversal` matching `skills-foundation` tier-3 contract
- **AND** no file SHALL be written and no `skills` row SHALL be inserted

#### Scenario: Absolute asset path is rejected

- **WHEN** `files.assets = [{ relPath: '/absolute/payload', ... }]` is passed
- **THEN** `installSkill` SHALL throw with error kind `absolute-path-forbidden`

#### Scenario: Subtree whitelist is enforced for assets

- **WHEN** `files.assets = [{ relPath: 'arbitrary/file.txt', ... }]` (not under `scripts/` / `references/` / `assets/`)
- **THEN** `installSkill` SHALL throw with error kind `subtree-forbidden`

#### Scenario: Slug collision respects scope

- **WHEN** a company-scope row with slug `do-research` already exists from Marketplace (`source_kind='installed'`) and the user attempts to agent-install another skill resolving to the same slug from git
- **THEN** `installSkill` SHALL throw a collision error preserving the existing row
- **WHEN** the same slug exists as company scope but the user agent-installs with `scope: 'employee'`
- **THEN** the employee-scope row SHALL be written (per `skills-foundation` partial UNIQUE rule), and at prompt assembly the employee row SHALL override the company row

#### Scenario: Write-through order prevents phantom DB rows

- **WHEN** an IO failure occurs while writing `scripts/go.sh` after `SKILL.md` has been written
- **THEN** `installSkill` SHALL reject with the underlying IO error
- **AND** no `skills` row SHALL exist for that attempted install
- **AND** the partially-written directory SHALL be cleaned up before the error is re-thrown

### Requirement: New `skill_install_confirm` interaction kind is typed and round-trips

`InteractionKind` in `@offisim/shared-types` SHALL include `'skill_install_confirm'`. A new `SkillInstallConfirmInteractionContext` SHALL be added to the `InteractionContext` union with fields: `type: 'skill_install_confirm'`, `stagingRef: string` (opaque handle resolving server-side to the staged skill payload), `skillName: string`, `skillDescription: string`, `allowedTools: readonly string[]`, `sourceKind: 'git' | 'upload' | 'claude-code' | 'codex'`, `sourceRef: string`, `resolvedScope: 'company' | 'employee'`, `resolvedEmployeeId: string | null`, `assetPaths: readonly string[]`. `InteractionRequest.options` for this kind SHALL carry at minimum `{ id: 'confirm', label: 'Install' }` and `{ id: 'cancel', label: 'Cancel' }`. No existing `InteractionKind` member SHALL be renamed or removed. Chat UI routing MUST dispatch `skill_install_confirm` to `SkillInstallConfirmBubble`; unknown kinds already fall through to a generic bubble, and this change SHALL NOT alter that fallback.

#### Scenario: Type surface

- **WHEN** any downstream package imports `InteractionKind` from `@offisim/shared-types`
- **THEN** the union SHALL include `'skill_install_confirm'` alongside `'permission_request'`, `'plan_review'`, `'agent_question'`

#### Scenario: Context discrimination

- **WHEN** an `InteractionRequest` has `kind: 'skill_install_confirm'` and `context.type === 'skill_install_confirm'`
- **THEN** TypeScript narrowing SHALL surface the `stagingRef`, `allowedTools`, `sourceKind`, `resolvedScope`, `resolvedEmployeeId`, and `assetPaths` fields

#### Scenario: Options default pair

- **WHEN** the tool handler constructs the interaction request
- **THEN** `options` SHALL contain at minimum `[{ id: 'confirm', label: 'Install' }, { id: 'cancel', label: 'Cancel' }]` in that order
