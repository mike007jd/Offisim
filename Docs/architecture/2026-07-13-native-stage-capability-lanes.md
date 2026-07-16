# Native Stage capability lanes

Status: frozen for GitHub issue #48 on 2026-07-13 (AEST).

## Product boundary

Offisim has two distinct Stage lanes:

- AI engine activity remains a read-only projection: browser screenshots/pages use `preview` targets and tool output uses `logs` targets.
- User-operated tools are native sessions: `browser-session` and `terminal-session` targets. They are always labelled `You · Manual`, never `Assistant`.

Neither native session is a second agent runtime. A manual PTY starts in the selected project's canonical workspace but retains the signed-in user's normal machine permissions; this is not an OS filesystem jail.

## Immutable scope

Every session is created with `{ companyId, projectId, threadId? }`. Rust verifies the project belongs to the company and, when present, the thread belongs to the project. The scope cannot change. Every subsequent command rechecks it against the registry.

The renderer may detach while switching tabs. A central Stage reconciler owns native lifecycle:

- inactive browser tab: hide the child WebView;
- active/split browser tab: show and update native bounds;
- renderer remount: list/snapshot and reattach;
- explicit tab close or scope reset: close the matching native session;
- app exit: sweep PTY children and child WebViews.

Renderer ownership is generation-based and serialized per session. A stale mount or cleanup may
not hide, close, or rebind a newer session generation. Scope reconciliation fails closed: list,
close, or visibility IPC failures retain the scope and retry with bounded exponential backoff;
only a fully successful reconciliation may forget it.

## PTY contract

The PTY uses `portable-pty 0.9.0`; ANSI rendering uses `@xterm/xterm 6.0.0` with `@xterm/addon-fit 0.11.0`.

Six commands are exposed only to the main renderer WebView:

1. `terminal_session_create`
2. `terminal_session_write`
3. `terminal_session_resize`
4. `terminal_session_snapshot`
5. `terminal_session_list_scoped`
6. `terminal_session_close`

Rust selects the user's shell, canonicalizes the project workspace, sets `TERM=xterm-256color`, and runs reader/wait work on dedicated threads. Output is raw base64 bytes. A bounded byte ring has monotonic byte cursors; snapshots return `startCursor`, `endCursor`, chunks, a gap/truncation flag, and terminal state. Raw input/output is never persisted.

The manual PTY cannot be used by an AI engine. Agent execution continues through
the selected engine's gated tool path.

## Browser contract

The browser is a Tauri child WebView created with the project's pinned Tauri 2.10.x `unstable` child API. macOS back/forward and availability state use the native `WKWebView` back-forward list through Tauri `with_webview`; the Tauri minor and `objc2-web-kit` bindings stay pinned together.

Ten commands are exposed only to the main renderer WebView:

1. `browser_session_create`
2. `browser_session_navigate`
3. `browser_session_back`
4. `browser_session_forward`
5. `browser_session_reload`
6. `browser_session_set_bounds`
7. `browser_session_set_visible`
8. `browser_session_snapshot`
9. `browser_session_list_scoped`
10. `browser_session_close`

Only `http` and `https` navigation is accepted. `file`, `javascript`, `data`, Tauri IPC/custom schemes, popups, and downloads are denied. Remote child labels are `browser-*`.

Capabilities match `webviews: ["main", "main-live"]`, not the containing window. Therefore a `browser-*` child receives no core, Pi, filesystem, shell, GitHub, or plugin IPC capability. This is locked by negative tests.

## Audit contract

Manual controls append metadata-only records to the native Stage audit log. Records contain session id, immutable scope, action, actor `boss`, origin `manual` or `page`, timestamp, and byte counts where relevant. Browser records retain only scheme and host; query and fragment are discarded. Terminal keystrokes and output are never recorded.

Agent browser/tool activity keeps its neutral runtime event path and Assistant label.

## Required gates

- Rust PTY: scope forgery, shell spawn/input/resize/exit, split UTF-8, burst ring gap, reconnect, idempotent close, process-group reap, app-exit sweep.
- Rust browser: scheme allowlist, scope mismatch, native history, redirect/title/loading, popup/download denial, idempotent close, and capability denial for `browser-*`.
- Renderer: stable target ids, manual vs agent target separation, xterm byte replay, browser event ordering, bounds/visibility reconciliation, scope reset cleanup, split view.
- Full `pnpm validate`, Cargo tests, release desktop build, and current-worktree release `.app` interaction through Computer Use.
