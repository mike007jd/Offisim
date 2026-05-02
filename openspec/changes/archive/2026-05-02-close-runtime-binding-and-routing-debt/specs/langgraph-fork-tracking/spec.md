## ADDED Requirements

### Requirement: LangGraph fork tracking SHALL document local fork deltas

Offisim SHALL maintain `openspec/specs/langgraph-fork-tracking.md` as the durable tracking record for the local LangGraph checkpoint fork. The document MUST identify `apps/web/src/lib/tauri-checkpoint.ts` as the local Tauri async SQL adaptation of upstream SqliteSaver and SHALL list the key behavior deltas that Offisim owns locally.

#### Scenario: Local fork file is identified
- **WHEN** reading the LangGraph fork tracking document
- **THEN** it names `apps/web/src/lib/tauri-checkpoint.ts` as the local forked/adapted checkpoint implementation
- **AND** it states which upstream SqliteSaver version or package family was used as the comparison baseline

#### Scenario: Key delta list exists
- **WHEN** upstream checkpoint behavior changes
- **THEN** maintainers can compare it against a documented list of Offisim-owned local deltas
- **AND** the list includes Tauri SQL access, serial write behavior, multi-value write handling, and any local diagnostic logging

### Requirement: LangGraph patch relationship SHALL be traceable

The LangGraph fork tracking document SHALL explain how the local `tauri-checkpoint.ts` implementation relates to `pnpm patches/` entries for `@langchain__langgraph`. It MUST distinguish local fork behavior from package patch behavior so future upgrades do not conflate them.

#### Scenario: Patch relationship is clear
- **WHEN** maintainers inspect a future `@langchain/langgraph` upgrade
- **THEN** they can tell which behavior is owned by `tauri-checkpoint.ts`
- **AND** which behavior is owned by pnpm patches

### Requirement: LangGraph upstream comparison SHALL have a recurring checklist

Offisim SHALL keep a quarterly upstream comparison checklist in `openspec/specs/langgraph-fork-tracking.md`. The checklist MUST include how to diff upstream SqliteSaver against `tauri-checkpoint.ts`, how to inspect package patches, and how to update `openspec/protocols-ledger.md` when the fork status changes.

#### Scenario: Quarterly review is actionable
- **WHEN** a quarterly protocol review starts
- **THEN** the reviewer can follow the checklist without rediscovering the fork history
- **AND** the review result updates the tracking document or protocols ledger if upstream compatibility changed
