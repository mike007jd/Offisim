# add-skills-self-authoring release verify record

Date: 2026-05-05

Release app under test:

- Path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Binary timestamp: `2026-05-05T19:59:26+1200`
- Binary sha256: `ea517781a7ca4e49a3b55331e88fffe292a67092a1a8d409d5d0e911397dd9c9`
- Launch evidence: Computer Use attached to `com.offisim.desktop`, pid `40738`, URL `tauri://localhost`.

Build gates:

- `pnpm --filter @offisim/ui-office build` passed.
- `pnpm --filter @offisim/desktop build` passed.

UI regression found and fixed:

- While running the first release app session, the right sidebar thread/project area consumed the available vertical space and pushed the Chat panel, interaction cards, and composer out of stable view.
- Fix: `packages/ui-office/src/components/layout/RightSidebar.tsx` now constrains the thread list to a scrollable `max-h-56` region so Chat stays visible.
- Rebuilt release app and reverified interaction cards and composer in the new app.

Invariant 1: tool reachability

- Prompted YOLO Master to create a skill that lists files in a directory.
- Release app surfaced a `skill_install_confirm` preview for `create_skill_from_scratch`.
- Reverify after layout fix: prompt created `release-verify-layout-list-files`; active interaction `ix-0ed7698e-97b7-47e4-9cd7-0571a836a760` had `action=create`, `sourceKind=self-authored`, and `skillName=release-verify-layout-list-files`.

Invariant 2: frontmatter whitelist

Verified release app frontmatter error cards and DB interaction history:

| reason | field | selected option | history id | created_at |
| --- | --- | --- | --- | --- |
| `missing-required` | `name` | `cancel` | `ixh-1d6f88d5-323c-404f-ad7a-c6df6adb4511` | `2026-05-05T07:49:21.468Z` |
| `forbidden-namespace` | `offisim.priority` | `cancel` | `ixh-814ac553-2beb-4831-a044-34d44abaf4c7` | `2026-05-05T07:50:26.376Z` |
| `unknown-field` | `unexpected_field` | `cancel` | `ixh-3f814ad7-9056-4837-8dde-f2c4e20621de` | `2026-05-05T07:51:48.114Z` |
| `invalid-yaml` |  | `cancel` | `ixh-2589ca0f-7ba6-4e63-8b40-88e4cce8ade6` | `2026-05-05T08:04:07.455Z` |

Note: one attempted invalid-yaml prompt was correctly rejected as `missing-required` because the rich text input normalized `---` into a non-frontmatter dash. It is recorded as a separate cancelled check and was not counted as invalid-yaml evidence.

Invariant 3: staging pipeline reuse

- Cancel path: first `release-verify-list-files` preview was cancelled; DB skill count for that slug stayed `0` after cancel.
- Confirm path before layout fix: `release-verify-list-files` was confirmed and written to vault:
  `companies/35eac1cb-2e35-4601-bd26-1fdc1ef3b017/employees/yolo-master/skills/release-verify-list-files/SKILL.md`.
- Confirm path after layout fix: `release-verify-layout-list-files` was confirmed via release app:
  - history id `ixh-367ffe61-1da6-42f8-9bfb-bd065a3114e4`
  - selected option `confirm`
  - vault path `companies/35eac1cb-2e35-4601-bd26-1fdc1ef3b017/employees/yolo-master/skills/release-verify-layout-list-files/SKILL.md`
  - created UTC `2026-05-05 08:06:46`

Invariant 4: preview bubble create variant

- Release app showed `Create new skill from YOLO Master`, `Create skill`, `From: YOLO Master`, `No tools declared`, attribution, slug, employee scope, SKILL.md preview, `Create skill`, and `Cancel`.
- After the layout fix, the create preview and composer were visible in the right sidebar at the same time, with no offscreen confirmation controls.

Residual scope:

- No self-authoring runtime/tool regression remains open in this change.
- The only related caveat was the right-sidebar focus/layout regression, which was fixed and reverified in release app.
