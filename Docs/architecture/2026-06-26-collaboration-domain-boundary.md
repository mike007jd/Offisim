# Connect collaboration domain boundary

Checked at: 2026-06-26 NZST
Status: accepted (PR-02 data domain, PR-03 runtime, PR-04/05 surface)
Scope: a new company-scoped Collaboration aggregate and a host-enforced no-tools
collaboration runtime. Does **not** change Office project chat (`chat_threads`),
the Pi work runtime, Missions, or runs.

## Decision

Connect (company daily chat — direct, group, contacts) is a separate
company-scoped data domain with its own tables, not a flag or mode on Office's
project-scoped `chat_threads`. Connect AI replies run on a dedicated
host-enforced Pi "collaboration" capability (`agent_runtime_collaborate`) that
has zero tools, no project cwd bind, and writes no `agent_runs` row.

## Context

Office and Connect look similar (both are chat) but are semantically different.
Office is real AI work execution against a project folder: it binds a cwd, runs
tools, edits files, and produces runs and deliverables. Connect is people and
employees talking to each other around the company: no project, no file mutation,
no run history. Folding Connect onto `chat_threads` with a discriminator would
have:

- leaked project-shaped fields (`project_id`, run linkage, workspace cwd) into
  conversations that must never touch a project;
- risked a Connect thread reopening as, or sharing state with, an Office project
  thread;
- forced the work runtime (tools, cwd, runs) to be the path for plain chat, where
  a misconfigured tool grant could let a "conversation" mutate a workspace.

The boundary is therefore drawn in both the data layer and the runtime layer.

- **Data:** `collaboration_threads` / `collaboration_thread_members` /
  `collaboration_messages` / `collaboration_read_state` (migration 0004, v4) plus a
  `collaboration_turns` reply ledger (migration 0006, v6). All company-scoped, no
  `project_id`, never an `agent_runs` / Mission row, never crossing into the
  `chatThreads` repository.
- **Runtime:** `agent_runtime_collaborate` is a distinct Tauri/host capability,
  separate from the work execute path. It is tool-free and project-unbound by
  construction at the host, so the restriction cannot be lost by a renderer or
  config mistake. A direct / mentions / roundtable turn controller schedules which
  employees speak; the `collaboration_turns` ledger records each reply's lifecycle
  (streaming / error / usage) for recovery, separate from the visible message.

## Consequences

- Connect chat can never silently become work execution: no tools, no cwd, no run.
- Office's project chat contract is untouched; the two surfaces stay isolated.
- A new no-tools runtime path exists and must be kept tool-free and
  project-unbound — it must not be repurposed as a back door work runtime.
- Two additive migrations (0004, 0006) land in the local DB; both are DDL-only.
- Honesty constraint carried forward: Connect's Calendar stays honest-empty
  (`meeting_sessions` is inert, no live writer); collaboration data does not imply
  scheduled or hosted execution.
