# Superseded

This active change is superseded by `realign-default-harness-agent-capabilities`.

Reason: the implementation work contains useful harness hardening, but the active OpenSpec wording was too easy to over-apply as a global "gateway-only" rule. The corrected truth is:

- default path: strengthen Offisim's own `offisim-core` harness;
- provider SDK lanes: text/reasoning-only leaf adapters;
- non-default paths: complete employee agent profiles and main-harness driver/replacement are allowed only through explicit capability tiers and evidence gates.

Do not sync these delta specs into main specs as the current source of truth.
