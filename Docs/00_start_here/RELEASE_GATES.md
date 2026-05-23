# Release Gates

Offisim release evidence must name the exact gate that proved the changed behavior. Do not use dev webviews, localhost browser screenshots, or broad ad-hoc test suites as release evidence.

## Security

- Run `pnpm security:harness` for P0/P1 security changes.
- This aggregates platform release integrity, platform auth boundaries, platform body limits, A2A URL policy, chat attachment path policy, doc-engine CSV formula neutralization, git-source byte caps, provider-list refresh URL policy, registry artifact trusted-origin downloads, registry-client response limits, SOP sync URL policy, web fetch URL/body limits, and web search redirect/body controls.
- If a finding touches a specific source symbol, run GitNexus impact on that symbol before editing and record the blast radius.

## Deterministic Runtime

- Run the smallest relevant deterministic harness for graph/runtime/permission/planner/LLM replay changes.
- Use `pnpm harness:deterministic` when the change crosses multiple runtime invariants.

## Platform

- Run `pnpm platform:security-harness` for marketplace ownership, manifest, artifact, and publish integrity changes.
- Run `pnpm platform:auth-harness` for platform auth, local route, scope, and runtime-token changes.
- Run `pnpm platform:migration:drift` when platform DB schema or migration requirements change.

## Install Materialization

- Run `pnpm install:materialization-harness` for install transaction, idempotency, rollback, concurrency, and git-sourced skill materialization changes.

## Desktop Release

- Build changed UI packages first, then run `pnpm --filter @offisim/desktop build`.
- Launch the exact current worktree app path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
- Record app path, binary hash, timestamp, environment, provider profile, command evidence, and Computer Use release-app evidence.
