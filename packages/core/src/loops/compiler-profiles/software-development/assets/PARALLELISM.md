# Useful Parallelism

Concurrency is a **declared budget**, fixed by the loop's consumption tier, not an open default. Within the chosen tier's caps the bias is to spend concurrency to reduce elapsed development time and improve confidence; the constraint is independence **and** the tier ceiling. The aggressive bias (spend freely, token cost secondary) is unlocked only when the requirement's stakes justify it or the user opts in.

## Consumption tiers

The skill proposes one tier from the rough requirement; the user can override it in one line. Each tier sets concrete caps and a rough cost envelope (estimates, not promises):

| Tier | Concurrency | Review depth | Variants | Rough envelope |
|------|-------------|--------------|----------|----------------|
| **light** | sequential or ≤2 concurrent writers | single reviewer | none | ~2–5 agents, 1–2 waves, low spend |
| **standard** (default) | concurrency by dependency wave (~3–5 writers) | maker/checker on key gates | only where genuinely uncertain | ~6–15 agents, 2–4 waves, medium spend |
| **aggressive** | high concurrency, nested where supported | multiple independent reviewers | competing implementations encouraged | 15+ agents, 3+ waves, high spend |

Recommend by signal: clear boundary + localized change + low risk → **light**; typical multi-file feature with moderate uncertainty → **standard**; wide blast radius, high ambiguity, competing approaches worth comparing, or user says cost is secondary → **aggressive**.

Whatever the tier, also record hard caps in the loop's Budget: max total agents, max recursion depth, max fix-waves per gate (default 3), and any wall-clock or token ceiling. Reaching a cap is the **budget-exhausted** exit, not a reason to keep spawning.

## Parallelism hierarchy

1. **Read-only discovery:** fan out freely within the tier's concurrency cap; collisions are negligible, so this is the one place to spend the cap first.
2. **Competing plans/hypotheses:** useful when uncertainty is high.
3. **Independent implementation shards:** use native worktree isolation for concurrent writers.
4. **Independent tests and evaluators:** often safe to run in parallel with implementation once contracts are frozen.
5. **Fresh review lanes:** run after a coherent diff or integrated wave exists.
6. **Full-system verification:** mostly serial at a known integrated revision, with parallel analysis of failures.

## Good reasons to spawn another agent

- a distinct module or ownership boundary;
- a different root-cause hypothesis;
- an alternative implementation worth comparing;
- a test or oracle that should be authored independently;
- a fresh business, regression, UX, performance, security-relevant, or maintainability review;
- investigation that would pollute the lead context;
- a downstream task that is now dependency-ready.

## Bad reasons

- duplicating the same writer on the same files without an explicit variant comparison;
- assigning generic titles with no distinct deliverable;
- keeping agents alive after their result has been consumed;
- splitting a tightly coupled five-line change across several worktrees;
- running reviewers before there is a stable object to review.

## Ownership

Every writer receives:

- an explicit file/module/interface boundary;
- frozen contracts;
- dependencies;
- required evidence;
- integration notes;
- a directive to return and stop.

If two tasks must modify the same unstable shared file, either sequence them, extract/freeze the shared contract first, or appoint one owner for that file during the wave.

## Spare capacity

When ready implementation work is limited, use extra capacity for:

- additional acceptance and regression tests;
- adversarial edge cases;
- performance baselines;
- reproducibility checks;
- official documentation research;
- visual/UX review;
- dependency or integration reconnaissance;
- evaluation of rejected variants.

The objective is maximum verified progress per wall-clock interval **within the declared budget**, not maximum visible agent count.
