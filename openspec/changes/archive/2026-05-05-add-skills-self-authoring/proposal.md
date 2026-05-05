# Change: Add Skills Self-Authoring (T2.4 Live Verify)

## Why

T2.4 was the last unfinished item of the Skills foundation roadmap
(T2.1 `skills-foundation`, T2.2 `agent-mediated-skill-install`, T2.3
`skill-fork-and-edit`, T2.4 self-authoring). The capability spec
`skill-self-authoring` is already published in `openspec/specs/`
with 4 invariants (LLM tool registration, frontmatter strict whitelist,
T2.2 staging pipeline reuse, preview bubble `'create'` action variant)
— archived from the omnibus change `consolidate-post-overhaul-runtime-followups`
which landed code (`installSkill` self-authored source flag,
`create_skill_from_scratch` employee tool, `SkillInstallConfirmBubble`
create branch) but did not run release `.app` live verify on T2.4
sub-tasks 6.9 / 6.11.

`MEMORY.md` Active Backlog #3 carries the candidate forward as
"代码大概率已落,只欠 live verify". Per CLAUDE.md product closure bar,
"绿 typecheck / build / harness contract 只代表代码能编... 功能完成必须有
live runtime 证据". This change closes that gap.

If live verify exposes any actual functional regression — boss-layer
LLM routing not stably hitting the `create_skill_from_scratch` tool
(known concern from the 2026-04-26 archive's followup task list), or
the `SkillInstallConfirmBubble` create variant rendering wrong, or
frontmatter whitelist not actually rejecting `offisim.*` keys at runtime
— the fix is in scope of this same change, not a follow-up.

## What Changes

Verification scope (no spec ADDED requirements unless verification
exposes a contract gap that the existing 4 invariants do not cover):

- Live verify on release `.app` against the existing
  `skill-self-authoring` capability invariants:
  1. Employee LLM in chat MAY invoke `create_skill_from_scratch` and
     reach the staging pipeline + preview bubble.
  2. Frontmatter whitelist actually rejects each of: missing-required,
     forbidden-namespace (`offisim.*`), unknown-field, invalid-yaml.
  3. Self-authored skill goes through the same T2.2 two-phase staging
     pipeline (no direct `installSkill` shortcut).
  4. Preview bubble exposes the `'create'` action variant (not just
     `'install'` / `'fork'` / `'edit'`).

- Boss-layer LLM routing stability for self-authoring intent — known
  concern that "Web `sync_from_claude_code` 未稳定命中 tool" carried
  over from the same 2026-04-26 omnibus archive. If team-chat /
  direct-chat boss is asked to "create a skill that does X" but does
  not pick up `create_skill_from_scratch`, that is a routing gap to
  fix here.

- Spec ADDED Requirement: a release-app live-verification gate
  invariant that pins the four invariants above to the **release
  session lane** (not just unit-level reachability), so future
  regressions on the verify path are also contract regressions.

## Impact

- Affected capabilities: `skill-self-authoring` MODIFIED (new live-verify
  gate Requirement). Other Skills capabilities (T2.1-T2.3) untouched.
- Affected code: TBD at apply time. Most likely zero code if the four
  invariants pass; otherwise narrow fixes in
  `packages/core/src/skills/`, `packages/core/src/agents/employee-node/*`
  (tool kit assembly), and / or `packages/ui-office/src/components/chat/SkillInstallConfirmBubble.tsx`.
- Migration: none.
- Live verify required on release `.app`.

## Out of Scope

- Skill marketplace publish flow for self-authored skills (separate
  product decision; current archive intent is staging → vault, not
  staging → publish).
- LLM prompt-engineering improvements to make Boss more eager to
  pick `create_skill_from_scratch`. If live verify shows boss layer
  cannot route to the tool, the fix is wiring (tool kit availability
  / prompt template), not prompt-engineering for higher recall.
- Changing the four existing `skill-self-authoring` invariants. They
  read correctly; this change only adds a verification gate around
  them.
