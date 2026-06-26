# Verification Architecture

Verification must be designed before broad implementation fan-out.

## Oracle order

Prefer, in order:

1. deterministic acceptance or contract tests;
2. integration/end-to-end tests against the real boundary;
3. build, type, lint, schema, migration, or static checks;
4. reproducible product demonstrations with recorded evidence;
5. structured fresh-context review;
6. maker self-review only as an initial screen, never the sole gate.

## Criterion matrix

For every acceptance criterion define:

- owner of the implementation;
- oracle or reviewer;
- exact evidence;
- pass rule;
- regression surface;
- target revision on which it must pass.

## Independent construction

Where practical, have a test/evaluation agent derive checks from the requirement and contract rather than from the implementation. This reduces shared blind spots.

## Adversarial stance

When verification relies on review rather than a deterministic oracle, a maker grading its own output praises it; the remedy is structural, not a sharper prompt.

- The checker is a **different agent from the maker**, carrying none of the maker's chain of self-persuasion. Where the harness allows, also swap the **model**, which avoids sharing the maker's blind spots.
- Instruct the checker to **assume the change is broken until evidence proves otherwise**: default to doubt, not trust.
- The checker's output is what fails and why; it does not restate why the code looks right. "Looks reasonable" is not a pass; maker self-review is an initial screen only (oracle order step 6), never the gate.

## Executed evidence

Reading a diff answers "does this look right," not "does it run right." Where the change has observable behavior, the checker must **execute** it, not only inspect the source.

- Run the tests, builds, and checks itself and read the real output — not the maker's report of them.
- For UI or interactive behavior, drive the running product (e.g. a browser-automation MCP) and judge the resulting state, not the source.
- A green claim with no executed evidence is `needs-fix`, not `pass`.

## Review lanes

Choose only relevant lanes, such as:

- business behavior;
- regressions and backward compatibility;
- architecture/interface consistency;
- UX states and accessibility;
- performance/resource behavior;
- security or privacy when genuinely relevant;
- maintainability and scope discipline;
- test quality and false-positive risk.

Reviewers must inspect the actual diff/commit and evidence. They return `pass`, `needs-fix`, or `blocked` with concrete file paths and reasons.

## Integration evidence

Task-local success is insufficient. Re-run the relevant matrix after each integration wave and run the full matrix at the final integrated revision and, when merged locally, at the actual default-branch revision.

## Failure handling

On failure:

1. preserve the exact evidence;
2. classify implementation defect, test defect, environment defect, contract mismatch, or product ambiguity;
3. send a bounded repair task to a fresh or appropriate agent;
4. avoid repeating the same approach without new evidence;
5. escalate only when the decision is truly human-owned.
