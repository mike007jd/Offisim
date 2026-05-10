# Codex Native Event Bridge Probe - 2026-05-10

Change: `complete-claude-parity-full-agent-harness`

## 2026-05-11 Correction

This file is now historical sidecar bridge evidence only. It proves the bundled Codex sidecar can emit native tool, MCP, session, checkpoint/rollback, and budget events, but it no longer supports a production promotion claim for `codex-engine:sdk-native-full-power`.

The review-fix pass now requires every Codex full-agent request to carry the selected Offisim model. In the rebuilt release `.app`, the selected model is `MiniMax-M2.7`; Codex local auth rejects that model with a 400 unsupported-model error. The current production status is therefore `blocked`, not promoted. Current release evidence is recorded in `review-fix-evidence-2026-05-11.md`.

A later runtime-evidence guard fix also supersedes this probe's original `approvalPolicy: never` payload and raw MCP state wording. Current full-agent requests default to `approvalPolicy: on-request`; the Codex host rejects `sdk-native-full-agent + never`, runs lifecycle checkpoint/rollback only for explicit lifecycle probes against an ephemeral fork thread, and maps MCP `starting/error/unknown` host states to valid product states.

## Purpose

This probe verifies the bundled Codex full-agent event bridge used by Task 10.4: native Codex app-server events can be converted into Offisim runtime activity events, including MCP lifecycle, native tool success, sandbox denial classification, resume/fork, checkpoint/rollback, and timeout/budget classification.

Task 10.4 release `.app` product verification was originally recorded in `release-app-verify-2026-05-10.md`; that promotion conclusion is superseded by `review-fix-evidence-2026-05-11.md`. This file records bundled sidecar event payload evidence that the release UI does not persist to SQLite.

## Code Path

- Source sidecar: `scripts/tauri-codex-agent-host.mjs`
- Bundled release resource: `apps/desktop/src-tauri/resources/codex-agent-host.mjs`
- Renderer bridge: `apps/web/src/lib/tauri-engine-adapters.ts`
- Runtime event field: `_offisimRuntimeEvents`

The bridge keeps ordinary Codex provider transport text-only. Native tools are enabled only when the request carries the explicit full-agent runtime marker `runtimeProfileTier: "sdk-native-full-agent"`. `gateway-bridged-tools` and text-only requests with native events are rejected before the Codex host runs.

## Probe Command

Executed against the final release `.app` bundled resource after `pnpm --filter @offisim/desktop build`:

`node apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app/Contents/Resources/resources/codex-agent-host.mjs`

Payload:

- `runtimeProfileTier`: `sdk-native-full-agent`
- `approvalPolicy`: `never`
- `sandbox`: `workspace-write`
- Prompt 1: run `pwd` with the local shell and answer with the output.
- Prompt 2: run `mkdir -p /Users/haoshengli/.offisim-denied-probe && touch /Users/haoshengli/.offisim-denied-probe/file` and answer with the result.

## Observed Evidence

- Success result content: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- Success usage: input tokens `38063`, output tokens `29`
- Session event:
  - `kind`: `session_event`
  - `action`: `started`
  - `sessionId`: `019e11ae-eb3b-7323-b95b-c2372702381f`
  - `detail`: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- MCP lifecycle events:
  - `computer-use`, `cloudflare-api`, `codex_apps`, `xcodebuildmcp`, `gitnexus`, and `context7` emitted `connecting`.
  - `computer-use`, `gitnexus`, `codex_apps`, `cloudflare-api`, `xcodebuildmcp`, and `context7` emitted `connected`.
- Native tool events:
  - `tool_started`, `toolName`: `pwd`, `toolType`: `runtime-profile`, `evidenceClass`: `sdk-native`
  - `tool_completed`, same `toolCallId`, `status`: `completed`
- Denied result content:
  - `mkdir: /Users/haoshengli/.offisim-denied-probe: Operation not permitted`
- Denied usage: input tokens `38141`, output tokens `123`
- Denied session event:
  - `kind`: `session_event`
  - `action`: `started`
  - `sessionId`: `019e11af-34ab-7451-b732-aa0fb3f91a91`
  - `detail`: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- Denied native tool events:
  - `tool_started`, `toolName`: `mkdir`, `toolType`: `runtime-profile`, `evidenceClass`: `sdk-native`
  - `tool_completed`, same `toolCallId`, `status`: `denied`, `errorType`: `sandbox_denied`
- Duplicate-event guard:
  - Codex can emit both raw `function_call` and `commandExecution` events for the same shell command.
  - The bridge now suppresses duplicate `commandExecution` events when the raw event already owns that `toolCallId`.

## Final Release Bundle Probe

Final release bundle:

- Executable sha256: `c0cf914d152acb75bcd08922d037e64e849a0439fe534294260d3e53e4bfe368`
- Executable timestamp: `2026-05-11 00:28:05 +1200`
- Bundle sidecar: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app/Contents/Resources/resources/codex-agent-host.mjs`

Observed final bundle success payload:

- Content: `TEXT_OK /Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- Native tool event: `tool_started` / `tool_completed`, `toolName: pwd`, `toolType: runtime-profile`, `evidenceClass: sdk-native`, `status: completed`
- MCP lifecycle: `context7`, `codex_apps`, `cloudflare-api`, `computer-use`, `xcodebuildmcp`, and `gitnexus` emitted `connecting`; `computer-use`, `codex_apps`, `gitnexus`, `cloudflare-api`, `xcodebuildmcp`, and `context7` emitted `connected`
- Session/checkpoint lifecycle:
  - `session_event started`, session `019e11e1-550d-7923-9082-d42112c2d546`
  - `checkpoint_created`, checkpoint `019e11e1-550d-7923-9082-d42112c2d546:post-turn`
  - `session_event resumed`, same session
  - `session_event forked`, child `019e11e1-937f-7900-9bb0-844b241af638`
  - `rollback_started`
  - `rollback_completed`

Observed final bundle budget exhaustion payload:

- Request used `timeoutMs: 1`
- Result: `{"ok":false,"error":{"code":"timeout","message":"Codex app-server timed out after 1ms."}}`
- Renderer mapping: `apps/web/src/lib/tauri-engine-adapters.ts` maps `AgentHostError("timeout")` to `budget_exhausted` plus `partial_state` with `failureType: budget_exhausted`.

## Decision

This probe remains valid as native sidecar event-bridge evidence. It is not production promotion evidence. The current release `.app` blocks `codex-engine:sdk-native-full-power` because model pass-through exposes that the active selected model, `MiniMax-M2.7`, is not supported by the local Codex account. Promotion requires a Codex-supported selected model or a dedicated Codex model selector plus fresh release `.app` evidence.
