## ADDED Requirements

### Requirement: Attachment access SHALL be an explicit parity evidence family

Attachment intake, persistence, parsing, `read_attachment`, scope enforcement, GC, and checkpoint round-trip SHALL be explicit evidence families for default harness and full-agent parity. A runtime profile SHALL NOT read attachments unless it declares and proves attachment authority.

SDK-backed model transport smoke SHALL NOT grant attachment authority. Full-agent or gateway-bridged attachment access SHALL prove company/thread scope, byte caps, parser fallback, evicted/missing ref handling, and activity evidence.

#### Scenario: Attachment task cannot complete from final text

- **WHEN** a user asks an employee to inspect or transform an attached file
- **THEN** task intent requires attachment evidence
- **AND** completion verification blocks final text that lacks accepted `read_attachment` or equivalent profile evidence

#### Scenario: Full-agent attachment authority is gated

- **WHEN** a SDK-native full-agent profile claims it can read attachments
- **THEN** release evidence proves attachment scope enforcement, byte caps, parser behavior, and denied cross-thread/cross-company reads
- **AND** the profile remains unavailable for attachment tasks until that evidence exists

#### Scenario: Attachment lifecycle evidence is preserved

- **WHEN** a parity benchmark uses an uploaded file
- **THEN** evidence records staging, persistence, read, checkpoint propagation, and any GC/eviction behavior
- **AND** no raw bytes are stored inside LangGraph checkpoint rows or generic runtime state
