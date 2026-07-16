# Engine-neutral AI Accounts and Native Session Boundaries

Checked at: 2026-07-17 NZST
Status: API engine and Codex orchestration adapter implemented; the corrected Codex lane still requires the later unified release-app live-verification batch; Claude is pending

## Current implementation truth

Offisim routes production work through `DesktopAgentRuntimeGateway`. The gateway
registers coexisting `api` and `codex` adapters, with one lane owning each run. `api` executes through
Pi-managed providers. `codex` is an external CLI orchestration adapter: it
detects the user's Codex installation/login/version, starts `codex app-server
--stdio`, binds the task workspace, and projects process events. Claude is not a
shipped engine adapter yet. UI wording, docs, or a settings card cannot be used
as evidence that an engine exists.

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

| Account | Execution | Primary usage display |
|---|---|---|
| Pi API engine | User-configured provider/model executed through the Pi host | input/output/cache/reasoning tokens plus actual or clearly estimated cost |
| Codex CLI orchestration | User-installed Codex CLI/app-server session | task token counts and duration, labelled “订阅内 · 无 API 成本” |
| Future external CLI | Engine-owned CLI/session through its own adapter | task process metrics only; no Offisim subscription accounting |

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
is performed by `codex login`; Offisim neither accepts nor persists those
credentials. Offisim consumes
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

An engine is supported only after real task execution, stream/tool/approval/stop
and recovery behavior, credential isolation, applicable provenance/metrics contracts,
and the exact current-worktree release `.app` have all been verified. Dev UI or
localhost evidence is insufficient.

The current API-engine release proof is the exact worktree binary SHA-256
`b62ae06de3280d332b7f5ccc0a180e59fe901b5cfaf85352b1a6ea299693f206`,
verified on 2026-07-15 AEST from a fresh current-baseline database through real file tools,
Ask approval, Stop, restart recovery, and live Usage/Cost rendering.

The earlier 2026-07-16 bundled Codex lane proof is superseded by the lane
correction in `Docs/roadmap/2026-07-16-engine-lane-correction.md`; it must not be
reused as evidence for the orchestration adapter. The corrected adapter requires
the later unified release-app live-verification batch before it can be reported
as release verified.

The corrected AI Accounts implementation restores Pi-owned provider editing in
the API-engine section and keeps external CLI status in the orchestration-engine
section. Provider templates, custom endpoints, exact model ids, and API keys are
written through the Pi host to `~/.pi/agent/models.json`; renderer/runtime status
receives only safe summaries and SHA-256-derived account identity. Any configured
Pi provider/model is eligible without an Offisim allowlist. User-authored models
may omit source provenance; supplied official provenance remains HTTPS + RFC3339
checked at renderer, Rust ingress, and SQLite boundaries. The old OpenRouter-only
configuration command has been removed. This corrected settings implementation
still requires the later unified release-app live-verification batch and is not
reported as release verified here.

## Current references checked

- OpenRouter API overview: https://openrouter.ai/docs/api/reference/overview
- OpenRouter generation metadata:
  https://openrouter.ai/docs/api/api-reference/generations/get-generation
- OpenRouter Usage accounting:
  https://openrouter.ai/docs/cookbook/administration/usage-accounting
- OpenAI Codex authentication: https://developers.openai.com/codex/auth
- OpenAI Codex app-server protocol: https://developers.openai.com/codex/app-server
- OpenAI Codex source: https://github.com/openai/codex
- Anthropic Claude Code subscription behavior:
  https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-max-plan
- Cursor Team Admin API: https://docs.cursor.com/en/account/teams/admin-api
