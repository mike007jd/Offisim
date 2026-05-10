## ADDED Requirements

### Requirement: Task tool intent SHALL classify parity evidence families

Task intent detection SHALL classify the local-productivity evidence family required by a task before routing and completion verification. The classification SHALL cover pure text, file read, file write/edit/patch, grep/search, shell/process, git/worktree, MCP, artifact/deliverable, memory/todo/skill, browser/desktop boundary, SDK-native tool, gateway-bridged tool, and unknown/unsupported tool needs.

Routing and completion verification SHALL consume the same classification so a task cannot route as local-tool work but complete as pure text.

#### Scenario: Git task requires git evidence

- **WHEN** a user asks an employee to inspect a branch, produce a diff, commit, or manage a worktree
- **THEN** task intent records the `git/worktree` evidence family
- **AND** completion verification requires accepted git/worktree or explicitly equivalent evidence before completion

#### Scenario: Skill or memory task does not complete from final text

- **WHEN** a task asks the employee to install, create, edit, sync, remember, update todo, or mutate skill/memory/task state
- **THEN** task intent records the matching memory/todo/skill evidence family
- **AND** a final assistant message without accepted state evidence cannot complete the task

#### Scenario: Unsupported runtime family blocks early

- **WHEN** a selected runtime profile lacks the task's required evidence family
- **THEN** routing returns a typed profile-fit blocker before model execution or routes to an allowed fallback owner
- **AND** the fallback is recorded rather than silently changing runtime authority
