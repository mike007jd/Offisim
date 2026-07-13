# Engine-neutral AI Accounts and Native Session Boundaries

Checked at: 2026-07-13 22:45 AEST
Status: accepted target; implementation in progress

## Current implementation truth

Offisim currently assembles `DesktopPiAgentRuntime` behind the production
`DesktopAgentRuntime` renderer boundary. Codex and Claude are not shipped engine
adapters yet. UI wording, docs, or a settings card cannot be used as evidence
that an engine exists.

## Product decision

Offisim is an engine-neutral desktop AI workbench. `DesktopAgentRuntime` is the
single production engine gateway. Each task selects one complete, mutually
exclusive engine; a run cannot mix Pi, Codex, Claude, or another lane.

The existing `AgentRuntimeDriver` is a neutral conformance SPI that currently
runs parallel to live chat. It is not already the production gateway. A concrete
driver may enter live chat only through an explicit adapter into
`DesktopAgentRuntime` and after passing runtime plus release conformance.

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

## Current references checked

- OpenAI Codex plan behavior: https://help.openai.com/en/articles/11369540/
- OpenAI Codex rate card: https://help.openai.com/en/articles/20001106
- Anthropic Claude Code subscription behavior:
  https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-max-plan
- Cursor Team Admin API: https://docs.cursor.com/en/account/teams/admin-api
