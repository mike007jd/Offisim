# Offisim Git Workbench + Kanban Redesign

## Why

The previous Kanban discoverability depended on existing cards and made the board feel missing in empty-project states. The Git concept also risked putting branch, checks, and sync indicators into the global header where they looked like decorative product chrome instead of real developer context.

## What Changes

- Make Kanban a persistent Office top chip with a real expanded board panel over the center scene.
- Align Kanban collapsed and expanded states to the local visual references:
  `/Users/haoshengli/Downloads/kanban收起.png` and
  `/Users/haoshengli/Downloads/kanban展开.png`.
- Keep Tasks focused on execution activity and expose only a Board open/close entry there.
- Add a Workspace Git tab for branch, status, file selection, diff preview, local commit, checks availability, and PR readiness.
- Keep all Git operations local and allowlisted. The workbench never pushes, force-updates, amends, bypasses hooks, or silently creates remote state.

## Non-Goals

- No full GitHub client, issue manager, review UI, or CI API integration.
- No fake checks. If a real checks source is unavailable, the UI says unavailable.
- No global header branch/checks/sync chips.
