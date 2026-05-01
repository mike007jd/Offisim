## ADDED Requirements

### Requirement: `sync_from_claude_code` SHALL be reachable from Web boss with a clear runtime guard

The `sync_from_claude_code` tool registered in `packages/core/src/agents/skill-install-tools.ts` SHALL be exposed to the Web boss tool surface. When the Web boss invokes the tool, the source resolver SHALL throw a typed `'desktop-only-tool'` error category that the boss SHALL surface as a user-facing message of the form `"This skill source requires the desktop app."` (no silent miss, no untyped exception bubbling to the chat error toast).

The Web boss tool prompt SHALL include `sync_from_claude_code` in the available tool list so the LLM can choose it; the runtime gate (not the prompt-time gate) is the single source of truth for desktop-only behavior.

#### Scenario: Web boss invokes sync_from_claude_code and receives desktop-only message
- **WHEN** a Web (browser) Offisim runtime is active AND the user asks the boss to sync skills from Claude Code
- **THEN** the boss MAY pick `sync_from_claude_code`; the tool resolver throws `desktop-only-tool` with message `'sync_from_claude_code requires the desktop runtime.'`
- **AND** the chat surfaces `"This skill source requires the desktop app."` to the user (typed boss reply, not an untyped error toast)

#### Scenario: Desktop boss invokes sync_from_claude_code and proceeds normally
- **WHEN** a Tauri desktop runtime is active AND the user asks the boss to sync skills from Claude Code
- **THEN** the tool resolver does NOT throw `desktop-only-tool` and proceeds with the normal skill staging + commit flow

#### Scenario: Web boss prompt includes sync_from_claude_code in tool list
- **WHEN** the Web boss system prompt is assembled
- **THEN** the available-tools section includes `sync_from_claude_code` (gating happens at runtime, not at prompt time)
