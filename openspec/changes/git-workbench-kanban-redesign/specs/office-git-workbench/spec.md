# Office Git Workbench

## ADDED Requirements

### Requirement: Git Context Is Scoped

Office SHALL show branch, diff, checks, commit, and PR-ready information inside the Workspace Git tab or lightweight status bar only.

#### Scenario: Global Header

- **WHEN** the user is in Office
- **THEN** the global header does not show branch, Auto-sync, or checks controls

### Requirement: Local Git Operations Are Safe

The Git Workbench SHALL support status, branch read, diff preview, selected-file add, and local commit without push, force, amend, or hook bypass operations.

#### Scenario: User Commits Selected Files

- **WHEN** the user selects changed files and enters a commit message
- **THEN** Offisim stages only the selected files and creates a local commit
- **AND** it does not push or create remote state

#### Scenario: Workbench Refreshes

- **WHEN** the workbench refreshes changed files
- **THEN** no changed file is selected for commit by default
- **AND** the commit action says `Commit selected files`

#### Scenario: User Previews Untracked File

- **WHEN** the user selects an untracked changed file
- **THEN** Offisim shows a bounded text preview from the project workspace sandbox
- **AND** it does not require staging the file first

### Requirement: Checks Are Truthful

The Git Workbench SHALL show checks only when a real checks source exists; otherwise it SHALL show checks as unavailable.

#### Scenario: No Checks Source

- **WHEN** no CI/check source is connected
- **THEN** the UI says checks are unavailable instead of showing a passing count

### Requirement: PR-Ready Is A Safe Preparation State

The Git Workbench SHALL provide a compare/PR entry only when a non-main branch has an upstream GitHub remote.

#### Scenario: No Upstream

- **WHEN** the current branch has no upstream
- **THEN** the compare action is disabled and the UI explains that publishing is explicit
