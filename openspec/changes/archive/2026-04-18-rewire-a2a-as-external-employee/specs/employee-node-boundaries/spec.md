## ADDED Requirements

### Requirement: employee-node routes by is_external flag, delegating external branch to sibling module

After this change, `packages/core/src/agents/employee-node.ts` SHALL branch on `employee.is_external` immediately after preflight load of the employee record: when `is_external === true`, the node SHALL delegate the remainder of dispatch to a single-responsibility sibling module `packages/core/src/agents/employee-a2a-executor.ts` (or equivalently-scoped module) that owns the A2A transport call, output extraction, event emission, and deliverable creation. When `is_external === false`, the node SHALL proceed down the pre-existing LLM adapter pipeline (prompt-assembly → turn-runner → tool-loop) unchanged.

The branch body SHALL NOT be inlined in `employee-node.ts`. The barrel SHALL remain within its `employee-node-boundaries` 200 NBNC limit.

#### Scenario: Barrel size gate holds after external branch added
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/employee-node.ts` is run after this change
- **THEN** the non-blank, non-comment line count is at most 200

#### Scenario: External branch body is not inlined
- **WHEN** grepping `packages/core/src/agents/employee-node.ts` for `A2AClient` / `sendAndWait` / `extractDepartmentOutput` / A2A task polling logic
- **THEN** zero matches exist on the call/logic (only possibly a type-only import forwarded to the sibling module)

#### Scenario: External branch module exists and is invoked
- **WHEN** `packages/core/src/agents/employee-a2a-executor.ts` exists and `employee-node.ts` imports it
- **THEN** the imported function is called from `employee-node.ts` inside the `is_external === true` branch

#### Scenario: Internal path byte-identical events
- **WHEN** running `employee-node` against an internal employee assignment before vs after this change
- **THEN** the emitted event sequence (`graph.node.entered` / `employee.state.changed` / `task.state.changed` / `task.subtask.progress` / LLM calls / deliverable creation) is identical in order and payload shape
