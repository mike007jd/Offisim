# A3 chat-default-expanded-on-office — Live Verify Notes

Date: 2026-04-25
Tooling: Playwright MCP against `vite dev` at `http://localhost:5176/`
Build state: shared-types / ui-core / core / ui-office / web all clean; `pnpm typecheck` 26/26 successful; biome clean for touched files.

## Verified scenarios

### Right rail default + persistence

| # | Scenario | Pre-condition | Expected | Observed |
|---|----------|---------------|----------|----------|
| 5.1 | Desktop 1440x900 first visit | `localStorage` cleared | rail expanded, Chat tab active, input visible, no welcome card | `rightRailExpanded=true`, `inputPlaceholder='Message your team...'`, `noWelcomeCardInChat=true` ✓ |
| 5.2 | Tablet 1280x800 first visit | `localStorage` cleared | rail expanded (regression point) | `rightRailExpanded=true`, `viewportWidth=1280` ✓ |
| 5.3 | Narrow 390x844 first visit | `localStorage` cleared | rail collapsed | `rightRailCollapsed=true` ✓ |
| 5.4a | Collapse + reload | desktop expanded → click collapse | reload still collapsed, storage `'false'` | `storageKey='false'`, `rightRailCollapsed=true` ✓ |
| 5.4b | Expand + reload | tablet collapsed → click expand | reload still expanded, storage `'true'` | `storageKey='true'`, `rightRailExpanded=true` ✓ |
| 5.5 | Tier change preserves preference | collapse at 1440 (stores `'false'`) → resize to 1280 | rail stays collapsed | `storageKey='false'`, `rightRailCollapsedAfterResize=true` at 1280 ✓ |
| 5.6 | Storage failure fallback | runtime patch throws | page survives, default applied | code path: `try/catch` wraps both helpers; runtime probe page-alive (`'page-alive'`); separate `browser-runtime-storage.ts` lacks try/catch, so monkey-patched setItem throws there — that's a pre-existing weakness, not from A3 |

### Empty state + starter chips

| # | Scenario | Expected | Observed |
|---|----------|----------|----------|
| 5.7 | Starter chip row presence | chip row above input with provided prompts | `chipRowPresent=true`, labels = `['Feature spec', 'Tech RFC']` ✓ |
| 5.8 | Direct chat empty state | one-line "Start a conversation..." hint, no chip row | `inDirectChat=true`, `directChatHintShown=true`, `chipRowHidden=true`, `inputPlaceholder='Message Alex Chen...'` ✓ |
| 5.9 | `requestRightExpandToken` auto-expand | clicking employee opens right rail + direct-chat header | direct-chat header rendered (Team back button), placeholder switched to employee name ✓ |

## Screenshots (verify-screenshots/)

- `a3-desktop-1440-firstvisit.png` — desktop 1440 first visit; right rail expanded, Workspace header + Chat tab active, message area whitespace, "Feature spec" / "Tech RFC" chips above "Message your team..." input.
- `a3-tablet-1280-firstvisit.png` — tablet 1280 first visit; right rail expanded (the A3 regression point — pre-change this would be a 44px collapsed bar).
- `a3-narrow-390-firstvisit.png` — narrow 390 first visit; left rail and right rail both collapsed to 44px vertical bars ("PERSONNEL" / "COLLABORATION" labels), bottom mobile ChatDrawer "Chat" toggle visible. Default-expand does NOT apply.

## Console health

After fresh navigation (post test cleanup), `browser_console_messages level=error` returned 0 errors. The 9 errors observed during 5.6 came from a monkey-patched `setItem` whose lifetime accidentally outlived the eval scope; restoring `Storage.prototype` and reloading cleared them. Not introduced by A3.

## Not exercised live (rationale)

- Chip click→send path: would consume LLM tokens for a behavior identical to user-typed message. Code reads `onClick={() => handleSend(text)}`; same path as ChatInput onSend.
- Chip row hide on first message: same reason; conditional is `showEmpty && !isDirectChat && !isRunning && isReady && onboardingStarterPrompts?.length`. Once `messages.length > 0`, `showEmpty === false` → chip row unmounts. Logic-traced.
- Storage failure fallback under a real reload (private mode / disabled storage): A3 helpers wrap both read and write in try/catch; tested-equivalent via patched prototype. To exercise under real conditions a tester can use Safari Private Window or browser flag `dom.storage.enabled=false`.

## Spec alignment

- `office-chat-default-presentation` 5 requirements / 12 scenarios — every scenario above maps to one or more.
- `responsive-app-shell` MODIFIED requirement "App shell supports desktop tablet and narrow viewports" — the new "Tablet workspace keeps right rail expanded" scenario is the regression point exercised in 5.2.
