# Engine-neutral AI Accounts and Native Session Boundaries

Checked at: 2026-07-15 00:15 AEST
Status: API engine implemented and release-verified; Codex and Claude engines pending

## Current implementation truth

Offisim now routes production work through `DesktopAgentRuntimeGateway`. The
gateway currently registers one complete `api` adapter; its internal
`DesktopPiAgentRuntime` host is an implementation detail, not a product engine
or provider lane. Codex and Claude are not shipped engine adapters yet. UI
wording, docs, or a settings card cannot be used as evidence that an engine
exists.

## Product decision

Offisim is an engine-neutral desktop AI workbench. `DesktopAgentRuntime` is the
single production engine gateway. Each task selects one complete, mutually
exclusive engine; a run cannot mix Pi, Codex, Claude, or another lane.

`RuntimeEngineAdapter` is the production gateway SPI. `AgentRuntimeDriver` is a
separate neutral conformance SPI; passing its harness alone does not place an
engine in live chat. A concrete engine may enter production only through an
explicit `RuntimeEngineAdapter` and after passing runtime plus release
conformance.

## Account and billing contract

Runtime capabilities (sessions, resume, tools, approval, workspace) and account
capabilities (execute, models, usage, cost) are separate contracts.

| Account | Execution | Primary usage display |
|---|---|---|
| API | Complete API engine adapter | input/output/cache/reasoning tokens plus actual or clearly estimated cost |
| Codex subscription | Native Codex app-server/session | provider-native Usage, remaining/reset/credits when supplied |
| Claude subscription | Native Claude Code session | provider-native plan Usage when supplied; otherwise neutral unavailable |
| Other subscription | Only an official, verifiable execution or Usage interface | provider-native Usage only |

Subscription cost is never inferred from local token counts. Third-party Claude
harness extra usage is not Claude plan Usage. Cursor Team Admin usage does not
prove an individual Cursor subscription interface.

Each root run and AI title job records provenance: runtime id, account id,
billing mode, exact model id, usage source/window/capturedAt, and
actual-vs-estimate. Subscription account windows and API per-run aggregation are
not mixed.

## Model catalog contract

Every selectable model retains an exact leaf model/artifact id, official or
native source, checkedAt, account ownership, capabilities, and availability.
Family names are grouping labels, not callable ids. Normal selectors lead with
friendly names; exact ids remain accessible as secondary detail and are the only
values sent to the runtime.

## Credentials and native state

Native engines retain raw credentials and Agent Home data. Offisim consumes
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
and recovery behavior, credential isolation, model provenance, Usage contract,
and the exact current-worktree release `.app` have all been verified. Dev UI or
localhost evidence is insufficient.

The current API-engine release proof is the exact worktree binary SHA-256
`b62ae06de3280d332b7f5ccc0a180e59fe901b5cfaf85352b1a6ea299693f206`,
verified on 2026-07-15 AEST from fresh schema v12 through real file tools,
Ask approval, Stop, restart recovery, and live Usage/Cost rendering.

## Current references checked

- OpenRouter API overview: https://openrouter.ai/docs/api/reference/overview
- OpenRouter generation metadata:
  https://openrouter.ai/docs/api/api-reference/generations/get-generation
- OpenRouter Usage accounting:
  https://openrouter.ai/docs/cookbook/administration/usage-accounting
- OpenAI Codex plan behavior: https://help.openai.com/en/articles/11369540/
- OpenAI Codex rate card: https://help.openai.com/en/articles/20001106
- Anthropic Claude Code subscription behavior:
  https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-max-plan
- Cursor Team Admin API: https://docs.cursor.com/en/account/teams/admin-api
