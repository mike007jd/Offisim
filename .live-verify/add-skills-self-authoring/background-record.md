# Background verification — add-skills-self-authoring

Date: 2026-05-05

## Code evidence

- `create_skill_from_scratch` is present in `packages/core/src/agents/skill-install/tool-defs.ts` and routed by the skill install tool assembly.
- `packages/core/src/agents/skill-install-tools.ts` rejects invalid self-authored SKILL.md frontmatter before staging.
- `packages/core/src/skills/skill-md.ts` enforces the self-authored frontmatter whitelist.
- `packages/ui-office/src/components/chat/SkillInstallConfirmBubble.tsx` handles `action='create'` and frontmatter error state.
- `packages/core/harness/scenarios/skill-create-frontmatter-errors.json` pins all four rejection reason codes.

## Commands

- `pnpm --filter @offisim/ui-office typecheck` passed.
- `pnpm --filter @offisim/web typecheck` passed.
- `node scripts/harness-contract.mjs --force-build` passed: 54 scenarios, including `skill-create-frontmatter-errors`.
- `pnpm --filter @offisim/ui-office build` passed.
- `pnpm --filter @offisim/desktop build` passed.
- `openspec validate add-skills-self-authoring --strict` passed.
- `git diff --check` passed.

## Release build

- App path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- App timestamp: `2026-05-05T18:50:18+1200`
- Binary sha256: `dc1e7186a643838f6d8b68082024fc0efb78c5f5ec7ab5b32b0b296424fa5581`

## Remaining blocker

Release `.app` live verify still needs a foreground Computer Use window:

- LLM must reach `create_skill_from_scratch` in a release chat.
- Frontmatter rejection must be observed in release chat.
- Create / cancel two-phase commit and preview bubble rendering must be verified in release UI.
