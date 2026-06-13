# @offisim/pi-ai

Vendored, trimmed fork of [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi)
(MIT — Copyright (c) 2025 Mario Zechner; see `LICENSE`).

- **Upstream pin:** `v0.79.2` / commit `f21f3c4bbdd3868ce2a7a68019d7920b838f663b`
- **Forked:** 2026-06-13 as part of the harness kernel replacement
  (`Docs/plans/2026-06-13-pi-kernel-replacement.md`).

## Why a vendored fork

Offisim runs inside a Tauri WebView (browser JS, no Node sidecar). The upstream
package registers nine provider families and pulls AWS/Smithy/Google/Mistral
SDKs that are Node-only and break the WebView bundle. Lazy `import()` does not
help — the bundler still has to resolve those Node modules. The upstream also
bakes a ~17k-line generated model catalog and reads API keys from `process.env`.

Upstream ships roughly one minor per week and treats `0.x` minors as breaking
(e.g. `0.78.0` made an explicit `apiKey` mandatory). A plain dependency is not
sustainable, so this fork is vendored and self-maintained; upstream security
fixes are cherry-picked by hand.

## What was kept

- Two provider lanes only: `anthropic-messages` (z.ai Coding Plan /
  Claude-compatible) and `openai-completions` (MiniMax / OpenAI-compatible).
- The unified stream protocol, partial-json tool-call assembly, thinking blocks,
  usage accounting, message transforms, and TypeBox tool validation.

## What was removed

- Providers: Bedrock (`@aws-sdk/*`, `@smithy/*`), Google / Google Vertex,
  Mistral, Azure OpenAI Responses, OpenAI Responses, OpenAI Codex Responses, and
  the lazy `register-builtins` side-effect chain.
- `models.generated.ts` (model catalog) and the `models.ts` registry — only the
  pure `calculateCost` / `clampThinkingLevel` helpers remain.
- Env API-key sourcing (`env-api-keys.ts`, `withEnvApiKey`), OAuth, image models,
  `session-resources`, the CLI, and the Node HTTP proxy helper.

## Credential seam (Offisim addition)

`StreamOptions.fetch?: typeof fetch` was added and threaded into both provider
SDK clients (`new Anthropic({ fetch })` / `new OpenAI({ fetch })`). Offisim
passes `createTauriLlmFetch(profile)`; the `apiKey` stays a placeholder while the
Rust `llm_fetch` command attaches the real credential header. The secret never
crosses the JS boundary. See `providers/anthropic.ts`, `providers/openai-completions.ts`,
`providers/simple-options.ts`, and `types.ts`.

## Updating from upstream

Re-pin a newer tag, re-copy the kept files, re-apply the four seam edits, and
re-run the trim (delete re-added providers, restore the trimmed `models.ts` /
`stream.ts` / `register-builtins.ts`). Keep this README's pin in sync.
