## Why

`consolidate-post-overhaul-runtime-followups` landed the runtime fixes and was archived with explicit warnings: 18 live/desktop/negative-path gates remain unverified. Those residual gates need a dedicated validation change so archive history stays honest without mixing implementation work with long-running live QA.

## What Changes

- Verify the remaining web, desktop release, SOP dispatcher, CSP negative-path, and skill self-authoring residual gates from the archived change.
- Add only the smallest temporary or dev-only fault-injection hooks needed to prove negative paths, and remove or gate them before completion.
- Update evidence in this change's tasks as each live path is proven.
- Fix real regressions only if live verification reproduces a product-impacting issue.

## Capabilities

### New Capabilities

- `runtime-live-verification-gates`: Defines the evidence contract for closing residual runtime live verification gates after a broad runtime overhaul.

### Modified Capabilities

- None.

## Impact

- Affected surfaces: web runtime at `127.0.0.1:5176`, release desktop `.app`, Tauri platform bridge at `localhost:4100`, SOP dispatcher routing, chat streaming, skill self-authoring, and CSP network failure handling.
- No schema migration or product behavior change is expected unless verification uncovers a real regression.
