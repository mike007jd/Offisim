# Engine-neutral AI Accounts and Native Session Boundaries

Checked at: 2026-07-16 21:12 NZST
Status: API, Codex, and Claude engines implemented and release-verified

## Current implementation truth

Offisim routes production work through `DesktopAgentRuntimeGateway`. The
gateway currently registers complete, mutually exclusive `api`, `codex`, and
`claude` adapters. UI wording, docs, or a settings card cannot be used as
evidence that an engine exists.

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

The current Codex-engine release proof is the exact worktree executable
SHA-256 `84335a48cc544dbefee570fa6f09226b0a5b75cdced82bc318506703c1b8e250`
with bundled official `codex-app-server` 0.144.4 SHA-256
`27d324bc906014c77e4e4286edae6b6d093ee60f49bdcf71495e0f57c31dc6fe`,
verified on 2026-07-16 NZST. Fresh-state verification covered native account
discovery, exact native model selection, Project-folder binding, Plan
`request_user_input`, Ask approve/reject, file/tool execution, Stop, same-window
continuation, restart recovery, provider-native Usage or explicit unavailable,
and secret-safe projection.

The current Claude-engine release proof is the exact worktree executable
SHA-256 `dd322ca3b5979febe4456f9c2e81f6365b645c78c6a65e74aa95c9acf196d668`
with bundled official Agent SDK host SHA-256
`15d559c2f91f04ee759e0c88bca08854d128f6b8c0472c6811e7bdd8b7c40a74`,
verified on 2026-07-16 NZST. Fresh-state verification covered native first-party
subscription discovery, five exact native model rows, multi-select
`AskUserQuestion`, Stop, same-session continuation, restart recovery, a real
Project-folder Write, explicit rejection of an out-of-workspace Write, and
provider-native Usage with honest unavailable fields. The host strips API/bearer
env inputs, stores only opaque session refs, keeps diagnostic run tokens separate
from subscription Usage, and never infers subscription Cost.

The integrated AI Accounts / Models release proof is the exact worktree
executable SHA-256
`29ff89a5dffcbf33934dd10c1d67b577ab6e26b4eb6e30d329053f041fe1955f`,
verified on 2026-07-16 NZST. A fresh-state release run configured an isolated
OpenRouter API key through the product UI, automatically selected the new API
account, and rendered five exact leaf models with official source and checkedAt.
API accounts expose Models / Usage / Cost; subscription accounts expose only
provider-native Models / Usage. An unavailable Codex account stayed neutral,
offered the native `codex login` instruction, and did not display inferred cost.
Claude later entered the same settings shell only after its independent T07
engine and release proof passed.

## Current references checked

- OpenRouter API overview: https://openrouter.ai/docs/api/reference/overview
- OpenRouter generation metadata:
  https://openrouter.ai/docs/api/api-reference/generations/get-generation
- OpenRouter Usage accounting:
  https://openrouter.ai/docs/cookbook/administration/usage-accounting
- OpenAI Codex plan behavior: https://help.openai.com/en/articles/11369540/
- OpenAI Codex rate card: https://help.openai.com/en/articles/20001106
- OpenAI Codex source and app-server protocol:
  https://github.com/openai/codex
- Anthropic Agent SDK TypeScript reference:
  https://code.claude.com/docs/en/agent-sdk/typescript
- Anthropic Agent SDK permissions and hooks:
  https://code.claude.com/docs/en/agent-sdk/permissions
  https://code.claude.com/docs/en/agent-sdk/hooks
- Anthropic Claude Code subscription behavior and limits:
  https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
  https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code
- Cursor Team Admin API: https://docs.cursor.com/en/account/teams/admin-api
