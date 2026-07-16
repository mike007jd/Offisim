# Agent Harness Wave Status — 2026-06-29

Historical archive note (2026-07-01): this was a point-in-time implementation
status note, not a current architecture source of truth. See the
[current runtime architecture](../HARNESS_ARCHITECTURE.md).

Source package: `/Users/haoshengli/Downloads/offisim_agent_harness_wave_2026-06-29`.

Current implementation status:

- R1/RUNCTX: implemented in `agent_runs.project_id` and `runtime_context_json`; recovery preserves project/workspace/runtime protocol context and refuses unsafe auto-resume.
- R2/MCP audit: implemented with `approval_status = not_required | human_approved | human_denied`; read-only calls no longer become boss-approved audit rows.
- R3/R4/R6 MCP risk and source scoping: implemented as conservative grants; `collaboration_read` and plan-mode expose only read-class MCP meta tools and keep write tools filtered.
- R5 Task Board/worktree review: implemented child-run tree rows plus persisted `workspace.lease.snapshot` events; Review UI can inspect branch/cwd/changed paths/status and record merge/discard actions.
- R7 background/reconnect: implemented process-lifetime host stream buffering, terminal snapshots, and `agent_runtime_reattach`; renderer startup reconnects running Pi work runs by persisted `requestId` and replays buffered events.
- R8 Pi 0.80.x: rechecked against npm on 2026-06-29; latest remains `0.80.2`, while this wave stays pinned to `0.79.8` and does not upgrade runtime.

R7 status:

- Implemented and harness-covered subset: route/component subscription unmount does not cancel a live run; repeated Stop is idempotent; stale `needs_input` approvals persist through `active_interactions` hydration.
- Implemented host reconnect: `agent_runtime_execute` now records work-run events in a bounded cursor buffer keyed by request id; stale renderer channels are best-effort and no longer kill the host; `agent_runtime_stream_snapshot` reports running/terminal state; `agent_runtime_reattach` replays events after a cursor and subscribes the new renderer channel.
- Remaining boundary: this is renderer-reload reconnect within the same Tauri host process. Full app/host process death still uses interrupted-run recovery and Pi session resume; the PRD's optional later background service host remains future work.
