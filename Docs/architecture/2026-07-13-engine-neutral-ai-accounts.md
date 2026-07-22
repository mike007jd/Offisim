# Engine-neutral AI Accounts and Native Session Boundaries

Checked at: 2026-07-22 NZST
Status: source implemented (Pi API plus Codex and Claude Code orchestration adapters). As of **2026-07-22**, `v1.1.2` is the latest stable published release. Its exact notarized and installed-distribution evidence covers the post-`v1.1.1` installed-app Codex launch correction. Historical evidence remains bound to its original commit/hash, and post-tag worktree changes require new release `.app` evidence.

## Current implementation truth

Offisim routes production work through `DesktopAgentRuntimeGateway`. The gateway
registers coexisting `api`, `codex`, and `claude` adapters, with one lane owning each run. `api` executes through
Pi-managed providers. `codex` is an external CLI orchestration adapter: it
detects the user's Codex installation/login/version, starts `codex app-server
--stdio`, binds the task workspace, and projects process events. `claude` follows
the same orchestration boundary: it detects the user-installed Claude Code CLI,
starts `claude -p --output-format stream-json`, binds the backend-authorized
workspace, and projects reasoning, tool, file-operation, terminal, token, and
duration events. UI wording, docs, or a settings card alone cannot be used as
evidence that an engine exists.

## Product decision

Offisim is an engine-neutral desktop AI workbench. `DesktopAgentRuntime` is the
single production engine gateway. Pi API execution and external CLI orchestration
coexist behind it; one run uses one engine lane and cannot mix Pi, Codex, Claude,
or another adapter.

`RuntimeEngineAdapter` is the production gateway SPI. `AgentRuntimeDriver` is a
separate neutral conformance SPI; passing its harness alone does not place an
engine in live chat. A concrete engine may enter production only through an
explicit `RuntimeEngineAdapter` and after passing runtime plus release
conformance.

## Account and billing contract

Each adapter publishes a capability manifest. Controls for steer, resume,
permission modes, approvals, user input, and process events are rendered only
when the selected engine declares support.

The same manifest declares Browser and Computer interaction routes. A route has
an explicit source (`engine-native`, `offisim-local`, or `mcp`), availability,
and reason. Product surfaces do not derive capabilities from the `codex`,
`claude`, or `api` label. Computer routing prefers an explicitly available
engine-native route and otherwise the declared Offisim local route. Settings
shows that effective route and the unavailable alternatives as runtime truth;
it does not expose a preference control until runtime dispatch can actually
honour that choice.

Offisim Browser is an Offisim-owned native child WebView for every engine lane.
Its renderer canvas is exactly the dedicated host grid track below app-owned
chrome; no component measures or subtracts chrome height. Rust converts that
viewport rect to the native parent-window coordinate system. On macOS the
conversion reads `NSWindow.contentLayoutRect`, so decorated and full-size
content windows use their actual unobscured content inset rather than a fixed
title-bar constant. The child yields focus while the user edits the Offisim
address bar, and native
Browser/Terminal/Computer views replace the Game View canvas rather than layer
over it. Codex app-server currently does not expose a stable negotiated native
Computer route to this adapter. Claude Computer Use requires an interactive CLI
session and therefore is not exposed by the current non-interactive `claude -p`
adapter. Both may still use the separately declared Offisim local Computer route.

The local Computer driver is connected once per Mac. Employee-level MCP grants
remain the runtime authorization gate, but are modeled as access policy and
exceptions; they are not the ownership or availability of the machine driver.

| Account | Execution | Primary usage display |
|---|---|---|
| Pi API engine | User-configured provider/model executed through the Pi host | input/output/cache/reasoning tokens plus actual or clearly estimated cost |
| Codex CLI orchestration | User-installed Codex CLI/app-server session | task token counts and duration, labelled “订阅内 · 无 API 成本” |
| Claude Code orchestration | User-installed Claude Code CLI session | task token counts and duration, labelled “订阅内 · 无 API 成本” |

External CLI subscription cost is never inferred from local token counts.
Offisim does not rebuild provider usage windows, remaining/reset/credits, model
catalog validation, or account-health accounting for orchestration engines.

API runs retain provider/model provenance and API cost metadata. Orchestration
runs retain engine identity, opaque native session reference, reported token
counts, duration, and a no-API-cost marker. The model actually reported by the
CLI may be diagnostic metadata, but it is not an Offisim selection contract.

## Model catalog contract

Pi's `~/.pi/agent/models.json` is the dynamic truth for API providers and models.
User-configured entries are valid without an Offisim closed-world allowlist.
Exact ids remain the execution value; source URL and checked-at metadata are
required for Offisim-owned official catalog entries but optional for user-owned
configuration. External CLI orchestration engines own their model choice and do
not expose an Offisim model selector.

## Credentials and native state

Native engines retain raw credentials and Agent Home data. Codex authentication
is performed by `codex login`, and Claude Code authentication by `claude auth
login`; Offisim neither accepts nor persists those credentials. Offisim consumes
safe status/protocols and stores only opaque references plus the projection
required by its product shell.

The product has four independent layers:

1. Project: a catalog entry backed by a folder.
2. Offisim Conversation: product messages, event projections, title, and native
   session mapping.
3. Native Agent Home / Session / Memory: engine-owned sessions, compaction, and
   global memory.
4. Effective task workspace: the canonical folder authorized for one task.

Deleting or moving a Project folder cannot delete, migrate, or project-scope
native session or global-memory data.

## Workspace trust

Alternative task folders cannot become trust roots from a renderer raw path.
The Tauri backend canonicalizes and validates a candidate, then issues a
company/conversation/turn-scoped effective-workspace binding. The engine host
and `project_*` file tools resolve the same binding; expiry, wrong scope, and
path escape are rejected. The Projects catalog is not silently rewritten.

## Release rule

An engine is supported only after real task execution, its declared stream/tool/
interaction/Stop/recovery capabilities, credential isolation, applicable
provenance/metrics contracts, and the exact current-worktree release `.app` have
all been verified. Unsupported controls must remain absent. Dev UI or localhost
evidence is insufficient.

Historical (predating published `v1.1.2`) API-engine release proof: exact
worktree binary SHA-256
`b62ae06de3280d332b7f5ccc0a180e59fe901b5cfaf85352b1a6ea299693f206`,
verified on 2026-07-15 AEST from a fresh current-baseline database through real file tools,
Ask approval, Stop, restart recovery, and live Usage/Cost rendering.

The earlier 2026-07-16 bundled Codex lane proof is superseded by the lane
correction in `Docs/roadmap/2026-07-16-engine-lane-correction.md`; it must not be
reused as evidence for the orchestration adapter. Historical corrected Codex
lane verification (2026-07-17 T16): commit `a88a7bd7` (merged main baseline
`d33f5e6c`), exact arm64 release `.app`
(`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`),
final executable SHA-256
`04806f6c9003f764a74c8a3d0cf66b43662ee0e01228f6dda2c9f29cd687504f`, including a
real Codex task with subscription token/duration projection. Evidence:
`Docs/evidence/2026-07-17-t16-final-release/README.md`.

Historical Claude Code adapter verification (2026-07-17 NZST T07): exact
worktree `.app` with final app binary SHA-256
`677e7cc685fa3e37b6cc3a3d6190b4882ad210ea1fb7469dc2c2d936754e17cb`. The matched
window, ready status, real CLI task, Bash tool event, token/duration projection,
subscription no-API-cost label, and live Stop transition are recorded in
`Docs/evidence/2026-07-17-claude-orchestration/README.md`.
T16 later reconfirmed Claude on the same exact arm64 release `.app` batch above.

The corrected AI Accounts implementation restores Pi-owned provider editing in
the API-engine section and keeps external CLI status in the orchestration-engine
section. Provider templates, custom endpoints, exact model ids, and API keys are
written through the Pi host to `~/.pi/agent/models.json`; renderer/runtime status
receives only safe summaries and SHA-256-derived account identity. Any configured
Pi provider/model is eligible without an Offisim allowlist. User-authored models
may omit source provenance; supplied official provenance remains HTTPS + RFC3339
checked at renderer, Rust ingress, and SQLite boundaries. The old OpenRouter-only
configuration command has been removed. Historical corrected AI Accounts /
Settings verification used the same 2026-07-17 T16 exact arm64 release `.app`
(commit/hash above), covering Pi API configuration plus Codex and Claude Ready
status, token/cost accounting separation, and window identity. Evidence:
`Docs/evidence/2026-07-17-t16-final-release/README.md`.

Published `v1.1.2` includes the post-`v1.1.1` installed-app Codex launch
correction. Exact notarized, installed-distribution, and live-streak evidence is
recorded in `Docs/roadmap/2026-07-21-prelaunch-release-readiness/plan.md`; the
historical `v1.1.1` hashes above remain historical only.

## Current references checked

- OpenRouter API overview: https://openrouter.ai/docs/api/reference/overview
- OpenRouter generation metadata:
  https://openrouter.ai/docs/api/api-reference/generations/get-generation
- OpenRouter Usage accounting:
  https://openrouter.ai/docs/cookbook/administration/usage-accounting
- OpenAI Codex authentication: https://developers.openai.com/codex/auth
- OpenAI Codex app-server protocol: https://developers.openai.com/codex/app-server
- OpenAI Codex source: https://github.com/openai/codex
- Anthropic Claude Code CLI reference: https://code.claude.com/docs/en/cli-usage
- Anthropic Claude Code authentication: https://code.claude.com/docs/en/authentication
- Anthropic Claude Code hooks: https://code.claude.com/docs/en/hooks
- Anthropic Claude Code sandboxing: https://code.claude.com/docs/en/sandboxing
- Cursor Team Admin API: https://docs.cursor.com/en/account/teams/admin-api
