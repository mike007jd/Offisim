## Context

The archived `2026-04-26-consolidate-post-overhaul-runtime-followups` change completed implementation and spec sync, but the archive command reported `45/63` tasks complete. This follow-up owns the remaining live evidence rather than reopening the broad implementation change.

Already verified during closeout:

- Web `hi` round-trip produced one Boss bubble with reasoning and final content in the same assistant message.
- Web direct-target matrix produced employee-scoped create-skill previews for Alex Chen, Maya Lin, and Sophie Park without falling back to Alex.
- Web self-authoring rejection paths rendered frontmatter error cards with Retry for `offisim.*`, unknown field, and missing `description`.

## Goals / Non-Goals

**Goals:**

- Close every remaining residual gate with real browser or release desktop evidence.
- Keep evidence tied to exact commands, UI paths, and observable results.
- Add minimal debug-only hooks only where negative paths cannot be triggered naturally.
- Preserve the archived implementation behavior unless a real live regression is found.

**Non-Goals:**

- Do not redesign the runtime overhaul.
- Do not add new product-facing capabilities.
- Do not mark desktop release behavior complete from web-only evidence.
- Do not keep fault-injection hooks enabled in production paths.

## Decisions

- Use release `.app` for desktop gates because repo policy treats dev webview evidence as insufficient for desktop validation.
- Use web `127.0.0.1:5176` only for web gates and secondary self-authoring evidence.
- Prefer real model/tool execution for target routing and skill flows; use programmatic injection only for impossible negative paths like missing direct target or non-allowlisted CSP.
- Keep follow-up tasks grouped by residual risk so another agent can apply them in order without re-reading the archived implementation diff first.

## Risks / Trade-offs

- Long-running live model calls can be flaky or slow -> capture exact transcript snippets and retry once before classifying as blocker.
- Desktop release can pass allowed paths while negative CSP injection remains hard -> add a small controlled non-allowlisted request path if no natural UI action exists.
- SOP dispatcher original fixture may be missing -> create a reproducible synthetic 8+ step DAG and document that the original fixture is unavailable.
- Skill self-authoring desktop path may not invoke `create_skill_from_scratch` with the current provider -> either tune the prompt/tool exposure or classify provider/tool routing as the live blocker.
