# Engine brand asset provenance

Checked on 2026-07-21 NZST. These files are copied byte-for-byte from locally installed, vendor-signed desktop applications. Do not redraw, recolor, optimize, or replace them without revalidating the signed source and updating the hash assertions in `scripts/harness-chrome-stability.mts`.

## Codex

- Renderer asset: `apps/desktop/renderer/src/assets/brands/codex/icon-codex-light.png`
- Signed source: `/Applications/ChatGPT.app/Contents/Resources/icon-codex-light.png`
- Product reference: <https://openai.com/codex/get-started/>
- Bundle identifier: `com.openai.codex`
- Application version: `26.715.52143`
- Signing authority: `Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)`
- Team identifier: `2DC432GLL2`
- SHA-256: `de7d43f3386105ab20952958c2c25beb0d903e2aeb6e1aef57c49a648c0d1c07`

## Claude

- Renderer asset: `apps/desktop/renderer/src/assets/brands/claude/claude_app_icon.png`
- Signed source: `/Applications/Claude.app/Contents/Resources/ion-dist/images/claude_app_icon.png`
- Brand reference: <https://github.com/anthropics/skills/tree/main/skills/brand-guidelines>
- Bundle identifier: `com.anthropic.claudefordesktop`
- Application version: `1.22209.3`
- Signing authority: `Developer ID Application: Anthropic PBC (Q6L2SF6YDW)`
- Team identifier: `Q6L2SF6YDW`
- SHA-256: `c7b5642f810adfba78781592d9dec18d7eb376c7ebf403c4d882fb9d39f65408`

Verification used `codesign --verify --deep --strict`, `codesign -dv --verbose=4`, `PlistBuddy`, and `shasum -a 256`. Product names, trademarks, and artwork remain the property of their respective owners.
