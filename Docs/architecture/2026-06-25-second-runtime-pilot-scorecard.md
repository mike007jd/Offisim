# Second Runtime Pilot — candidate scorecard & go/no-go (M7 / RT2-001..006)

Checked at: 2026-06-25 NZST (candidate SDK capabilities re-verified this date via
current vendor docs + 2026 comparisons — not memory)
Status: accepted — **NO-GO to ship a second runtime now; SPI is proven
second-runtime-ready; a real second-SDK pilot is a future epic gated below**
Slice: M7 (spike). Docs-only — no code change. Per PRD §26 + §27.

## Why this is a spike, not an adoption
PRD §26 is explicit: *"不在本 PRD 中预先承诺 Claude/OpenAI/ADK 中任何一个为第二默认
运行时"* and §26.1: a second SDK is a complete Runtime Driver, must pass the
Runtime Conformance Suite, must not degrade Pi, and Offisim core must not import a
vendor's Agent types. So M7 = score the candidates, confirm the SPI is ready, and
gate the actual pilot — it does not adopt one.

## RT2-002/003 already de-risked by M1
The Runtime Driver SPI (RD-001) was deliberately built Pi-first but vendor-neutral,
and it is **already proven to work for a non-Pi runtime**:
- **RD-005 `DeterministicTestDriver`** is a complete non-Pi `AgentRuntimeDriver` —
  the second-runtime *driver prototype* RT2-002 asks for, in reference form.
- **RD-006 conformance harness** runs **RC1–RC12** (PRD §27) against it — `12/12`
  in `pnpm validate`. So the conformance suite RT2-003 asks for exists and passes
  for a driver that is not Pi.
This means the SPI contract, the neutral event envelope, and the conformance gate
are not Pi-shaped; a second real SDK plugs into the same surface. The remaining
RT2 work (RT2-004 mission parity, RT2-005 runtime-specific UX, RT2-006 separate
release evidence) all require a *real* second-SDK driver, which is the future epic.

## RT2-001 — candidate scorecard (§26.3 weighted criteria, checked 2026-06-25)

Scale: ●●● strong fit · ●● partial · ● weak. Weight from PRD §26.3.

| Criterion (weight) | Claude Agent SDK | OpenAI Agents SDK | Google ADK |
|---|---|---|---|
| Local-first / offline (high) | ●●● CLI/OS-native coding agent | ● cloud/hosted-tool leaning | ●● local `adk web` + runner |
| Custom cwd & sandbox (high) | ●●● deep OS/workspace access | ●● tool-level, less cwd-native | ●● configurable, enterprise |
| **Session resume (high)** | **●●● session id resume + fork** | **● ephemeral by default → needs external memory** | **●●● real SessionService state** |
| Tool event fidelity (high) | ●●● tool lifecycle + hooks | ●● tracing-oriented | ●●● Events stream + inspector |
| HITL pause/resume (high) | ●●● permissions + hooks | ●● HITL supported | ●● supported |
| Custom tools (high) | ●●● functions + MCP | ●●● functions + MCP + hosted | ●●● functions + tools |
| Subagents/handoffs (med) | ●●● supervisor/subagent | ●● handoffs / agents-as-tools | ●●● supervisor + workflows |
| Provider independence (med) | ● Anthropic-leaning | ● OpenAI-leaning | ●●● multi-provider swap |
| Packaging / desktop dist (high) | ●● SDK/CLI bundleable | ●● SDK | ● heavier enterprise stack |
| Bundle/security footprint (high) | ●● moderate | ●● moderate | ● larger surface |

**Read of the table** against what Offisim's Mission Control Plane actually needs
(local-first execution + **session resume**, because M4 Durable Recovery resumes a
runtime session from a safe boundary): **Claude Agent SDK and Google ADK lead** —
both have real session resume + strong tool-event fidelity + local execution.
**OpenAI Agents SDK is the weakest fit** for Offisim specifically: its ephemeral-
by-default state conflicts with the durable Mission/resume model (it would force an
external memory layer Offisim doesn't want to own — the exact "don't re-implement
the runtime's durability" boundary from §3/§22).

## Go / No-Go

- **NO-GO** to adopt or ship any second runtime in this PRD (per §26). Pi remains
  the only shipped runtime (release gate §32.1).
- **GO** to keep the SPI second-runtime-ready (already true — RD-005/006). No further
  abstraction work is needed before a pilot; the contract is proven.
- **When a pilot IS scheduled** (its own epic, like the Pi 0.80 upgrade was): the two
  lead candidates are **Claude Agent SDK** and **Google ADK** (session resume +
  local-first + event fidelity). Re-verify their state at that time (SDKs move fast).

## RT2 epic entry criteria (PRD §26.1 + §27 — for the future pilot, not now)
1. Re-score the candidates against current docs (this scorecard is a 2026-06-25 snapshot).
2. Build the chosen SDK as a complete `AgentRuntimeDriver` (RD-001 SPI) — NOT a Pi provider lane.
3. Pass **RC1–RC12** (the existing RD-006 harness, pointed at the new driver).
4. Mission end-to-end parity (a mission completes through the second driver, §31 RT2-004).
5. Runtime-specific UX only via capability flags; Offisim core imports **no** vendor Agent types.
6. Must NOT degrade Pi, must NOT fake an unsupported capability, must produce **separate**
   release `.app` evidence.
7. Product decides whether to ship — value must exceed the maintenance + supply-chain cost.

## Consequences
- M7 closes as a spike: the framework + scorecard + the (already-passing) SPI conformance
  are the deliverable; no second runtime ships.
- The neutral SPI (RD-001), DeterministicTestDriver (RD-005), and conformance (RD-006) are
  the durable assets a future pilot builds on.
- Per §26 / App-A D-012, A2A interop is likewise deferred until the Mission contract is stable.
