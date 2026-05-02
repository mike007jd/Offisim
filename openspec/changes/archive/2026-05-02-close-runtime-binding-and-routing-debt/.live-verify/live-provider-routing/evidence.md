# Live Provider Routing Evidence

Date: 2026-05-02

Release bundle:
- `pnpm --filter @offisim/desktop build` passed.
- `Offisim.app` mtime: `2026-05-02 15:42:31 +1200`.
- `Offisim_0.0.1_aarch64.dmg` mtime: `2026-05-02 15:42:51 +1200`.
- `codesign --verify --deep --strict --verbose=2 apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` passed.
- Release app launched with bundle id `com.offisim.desktop`; Computer Use attached to pid `7347`.

## Bound Project Tool Run

Company/project:
- Company: `Fresh Runtime Verify Company`
- Project: `Codex Fresh Bound Offisim`
- Workspace root: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- Thread: `thread-codex-fresh-runtime-1777626539`

Prompt:
`Use internal gateway/local tools to: 1) read README.md and capture the heading, 2) run pwd to get current directory, 3) write .live-verify/runtime-binding-live/fresh-boss-live-v3.txt with exactly 'fresh live verify ok v3'. Report all results.`

DB evidence:
- `task_runs.tr-9f5fe4e7-173a-4d97-8b34-69b9ce101180` completed.
- Output included README heading `# Offisim`, pwd `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`, and write status for `.live-verify/runtime-binding-live/fresh-boss-live-v3.txt`.
- `mcp_audit_log` for the same thread recorded successful `read_file {"path":"README.md"}`, `bash {"command":"pwd"}`, `bash {"command":"mkdir -p .live-verify/runtime-binding-live"}`, and `write_file {"path":".live-verify/runtime-binding-live/fresh-boss-live-v3.txt","content":"fresh live verify ok v3"}`.
- Local file check confirmed `.live-verify/runtime-binding-live/fresh-boss-live-v3.txt` contains exactly `fresh live verify ok v3`.

## Active Company / Roster Run

Company:
- Switched release app to `Live Verify - Contributor Avatars`.
- Project selector showed `All`, with no bound project for that company.
- Visible roster showed exactly 4 members: `Internal Analyst`, `Hermes Contractor`, `External Contractor`, `YOLO Master`.

Prompt:
`Live verify multi-company roster after fix. Name the exact current active company from system context and list every visible team member exactly. Also explicitly say whether Alex Chen, Maya Lin, or Marcus Johnson are part of the current company. Do not use file tools.`

DB/UI evidence:
- `task_runs.tr-a18beb66-007e-4038-8369-30fa74fcbdf9` completed.
- Output named `Live Verify - Contributor Avatars` as the current active company.
- Output listed only `Internal Analyst`, `Hermes Contractor`, `External Contractor`, and `YOLO Master`.
- Output explicitly said `Alex Chen`, `Maya Lin`, and `Marcus Johnson` are not part of the current company.
- Computer Use observed the same 4-member roster and the same final message in the release app.

Follow-up direct company-name probe:
- Prompt: `What is the exact current active company? Reply with only the company name.`
- Release app final output: `Live Verify - Contributor Avatars`.

## Unbound Project Rejection

Company/thread:
- Company: `Live Verify - Contributor Avatars`
- Project selector: `All`
- Thread: `thread-company-live-verify-close-frontend-ux-debt`

DB evidence:
- Earlier release run attempted `read_file {"path":"README.md"}` with no project workspace bound.
- `mcp_audit_log` recorded result: `Error reading file: No project workspace root is bound for file/shell tools.`
- This proves the runtime does not reuse a stale project root after switching to a company/project context without a bound workspace.

## Project B Root / Old Root Rejection

Setup:
- Created live verify project `Codex Live Project B Root` under `Live Verify - Contributor Avatars`.
- Workspace root: `/tmp/offisim-runtime-binding-project-b`.
- Root file: `/tmp/offisim-runtime-binding-project-b/README.md` with heading `# Offisim Project B Live Root`.

Prompt:
`Live verify project B root. Use internal gateway file tools, not memory. First read README.md. Then attempt to read /Users/haoshengli/Seafile/WebWorkSpace/Offisim/README.md by absolute path. Report the README heading from the successful read and the exact error or rejection for the absolute old-root path.`

DB evidence:
- `task_runs.tr-8a6734fa-fa41-4296-8226-fd0f346decc9` completed.
- Output reported current working directory `/private/tmp/offisim-runtime-binding-project-b`.
- Output reported heading `# Offisim Project B Live Root`.
- Output reported old-root absolute path rejection: `Error reading file: path is outside bound project workspaces: <out-of-bounds>`.
- `mcp_audit_log` recorded:
  - `bash {"command":"pwd"}` -> `/private/tmp/offisim-runtime-binding-project-b`
  - `read_file {"path":"README.md"}` -> `# Offisim Project B Live Root`
  - `read_file {"path":"/Users/haoshengli/Seafile/WebWorkSpace/Offisim/README.md"}` -> `Error reading file: path is outside bound project workspaces: <out-of-bounds>`

## Notes

- SDK-lane Offisim tool sidecars remain intentionally unverified: repo policy says SDK lanes are text/reasoning-only in Offisim 1.0 and cannot expose file/shell/memory/todo/skill tools.
- The release app showed an unrelated 2D/3D scene asset warning: `Could not load lebombo_1k.hdr: Load failed`. It did not block runtime routing, roster, or file/shell verification.
