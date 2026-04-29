# Desktop Runtime Guidance

- Privileged Tauri invokes must be grouped behind explicit capabilities. Project fs/shell commands use `offisim:fs-shell`, and local agent/LLM/provider/session/kanban bridge commands use `offisim:agent-bridges`.
- These capabilities are main-window-only. Do not grant them to child, preview, or remote windows without a separate security review.
- Keep plugin defaults in `src-tauri/capabilities/default.json`; put Offisim app command allowlists in `src-tauri/permissions/*.toml`.
