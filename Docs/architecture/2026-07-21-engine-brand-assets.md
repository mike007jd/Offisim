# Engine identity asset policy

Checked at: 2026-07-22 NZST.

Offisim uses compact Offisim-owned glyphs for Codex, Claude, API, and Offisim
engine lanes. The renderer contains no third-party image bytes for these marks.
Product names remain nominative labels for the external services and CLIs they
identify; the marks do not imply sponsorship or endorsement.

The previous Codex and Claude PNGs were copied from signed locally installed app
bundles. Their recorded hashes proved provenance but not redistribution rights,
so they were removed from the public repository and release bundle.

Current implementation:
`apps/desktop/renderer/src/design-system/grammar/EngineMark.tsx`.

Current policy references checked:

- OpenAI brand guidelines: <https://openai.com/brand/>
- Anthropic media assets entry point: <https://www.anthropic.com/news>

Engine labels remain the property of their respective owners. Offisim does not
ship vendor app-icon copies or depend on vendor installation/network access for
engine identity rendering.
