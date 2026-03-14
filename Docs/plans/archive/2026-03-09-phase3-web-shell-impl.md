# Phase 3: Web Shell — Implementation Plan

**Design doc**: `2026-03-09-phase3-web-shell-design.md`
**Estimated tasks**: 14
**Commit strategy**: one commit per task

---

## Task 1: Browser Compatibility Verification

**Goal**: Confirm packages/core runs in Vite browser build.

Steps:
1. Run `pnpm --filter @aics/web dev`
2. In `App.tsx`, import `{ buildAicsGraph, createMemoryRepositories, InMemoryEventBus }` from `@aics/core`
3. Call them in a `useEffect` and log results to console
4. Verify no Node.js module errors (better-sqlite3, fs, path, etc.)
5. If errors: add Vite `resolve.alias` or `optimizeDeps.exclude` to handle them

**Commit**: `chore(web): verify core browser compatibility`

If this fails, stop and reassess architecture.

---

## Task 2: Tailwind CSS 4 Setup

**Goal**: Working Tailwind in apps/web.

Steps:
1. `pnpm --filter @aics/web add tailwindcss @tailwindcss/vite`
2. Add `@tailwindcss/vite` plugin to `vite.config.ts`
3. Create `src/index.css` with `@import "tailwindcss"`
4. Import `index.css` in `main.tsx`
5. Add a test class to `App.tsx` (e.g., `<h1 className="text-2xl font-bold">`) and verify

**Commit**: `feat(web): set up Tailwind CSS 4`

---

## Task 3: shadcn/ui Foundation + Utility

**Goal**: cn() utility and base shadcn/ui components.

Steps:
1. `pnpm --filter @aics/web add clsx tailwind-merge class-variance-authority lucide-react`
2. Create `src/lib/utils.ts` with `cn()` function (clsx + tailwind-merge)
3. Create `src/components/ui/button.tsx` (shadcn Button)
4. Create `src/components/ui/input.tsx` (shadcn Input)
5. Create `src/components/ui/card.tsx` (shadcn Card)
6. Create `src/components/ui/scroll-area.tsx` (shadcn ScrollArea)
7. Create `src/components/ui/badge.tsx` (shadcn Badge)
8. Create `src/components/ui/dialog.tsx` (shadcn Dialog)
9. Create `src/components/ui/select.tsx` (shadcn Select)
10. Create `src/components/ui/textarea.tsx` (shadcn Textarea)
11. Verify components render correctly

Note: Copy shadcn/ui component source directly (they are source files, not library imports). Use Tailwind CSS 4 compatible variants.

**Commit**: `feat(web): add shadcn/ui foundation components`

---

## Task 4: App Layout Shell

**Goal**: Three-column layout with header and status bar.

Steps:
1. Create `src/components/layout/AppLayout.tsx`:
   - CSS Grid: header (top) + 3-column body + status bar (bottom)
   - Left sidebar: 240px, agent panel
   - Center: flex, chat panel
   - Right sidebar: 280px, event log
2. Create `src/components/layout/Header.tsx`:
   - "AI Company Simulator" title
   - Provider badge (placeholder)
   - Settings gear icon button
3. Create `src/components/layout/StatusBar.tsx`:
   - Model name, token count, latency (all placeholder initially)
4. Update `App.tsx` to use `AppLayout`

**Commit**: `feat(web): add app layout shell`

---

## Task 5: Settings Dialog + Provider Configuration

**Goal**: User can configure LLM provider, save to localStorage.

Steps:
1. Create `src/lib/provider-config.ts`:
   ```typescript
   interface ProviderConfig {
     provider: LlmProvider;
     apiKey: string;
     baseURL?: string;
     model: string;
     defaultHeaders?: Record<string, string>;
   }
   function loadProviderConfig(): ProviderConfig | null
   function saveProviderConfig(config: ProviderConfig): void
   ```
2. Create `src/components/settings/SettingsDialog.tsx`:
   - Provider select: Gemini / OpenRouter / Kimi / OpenAI / Anthropic / Custom
   - API key input (password field)
   - Model input (text, with suggestions per provider)
   - BaseURL input (auto-filled for known providers, editable for custom)
   - Save button → localStorage
3. Create `src/components/settings/provider-presets.ts`:
   ```typescript
   const PRESETS: Record<string, Partial<ProviderConfig>> = {
     gemini: { provider: 'openai-compat', baseURL: 'https://...', model: 'gemini-2.5-flash' },
     openrouter: { ... },
     kimi: { ... },
     openai: { provider: 'openai', model: 'gpt-4o-mini' },
     anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
   }
   ```
4. Wire settings button in Header to open dialog

**Commit**: `feat(web): add provider settings dialog with presets`

---

## Task 6: AicsRuntimeProvider + useAicsRuntime Hook

**Goal**: React Context that initializes and exposes the runtime.

Steps:
1. Create `src/runtime/aics-runtime-context.tsx`:
   ```typescript
   interface AicsRuntimeValue {
     eventBus: EventBus;
     isReady: boolean;
     isRunning: boolean;
     error: string | null;
     sendMessage: (text: string) => Promise<void>;
   }
   const AicsRuntimeContext = createContext<AicsRuntimeValue>(...)
   ```
2. Create `src/runtime/AicsRuntimeProvider.tsx`:
   - Reads ProviderConfig from localStorage
   - Creates: EventBus, gateway, ModelResolver, memory repos, graph
   - Seeds initial company + employees (hardcoded for Phase 3)
   - Exposes `sendMessage()` that:
     a. Creates OrchestrationService
     b. Runs orchestrate() with boss_chat
     c. Updates isRunning state
     d. Catches errors → error state
3. Create `src/runtime/use-aics-runtime.ts`:
   ```typescript
   export function useAicsRuntime(): AicsRuntimeValue
   ```
4. Wrap `<App>` in `<AicsRuntimeProvider>` in `main.tsx`

**Commit**: `feat(web): add AicsRuntimeProvider and useAicsRuntime hook`

---

## Task 7: EventBus React Hooks

**Goal**: Custom hooks that subscribe to EventBus patterns.

Steps:
1. Create `src/runtime/use-event-stream.ts`:
   ```typescript
   function useEventStream(pattern: string, maxEvents?: number): RuntimeEvent[]
   // subscribes on mount, unsubscribes on unmount
   // returns last N events matching pattern
   ```
2. Create `src/runtime/use-agent-states.ts`:
   ```typescript
   function useAgentStates(): Map<string, { name: string; role: string; state: string }>
   // subscribes to 'employee.state.*'
   // maintains current state per employee
   ```
3. Create `src/runtime/use-streaming-content.ts`:
   ```typescript
   function useStreamingContent(): { content: string; isStreaming: boolean }
   // subscribes to 'llm.stream.chunk'
   // resets on new run
   ```

**Commit**: `feat(web): add EventBus React hooks`

---

## Task 8: Chat Panel

**Goal**: Message list with input, shows conversation history.

Steps:
1. Create `src/components/chat/ChatPanel.tsx`:
   - ScrollArea with message list
   - ChatInput at bottom
   - Auto-scroll to latest message
2. Create `src/components/chat/MessageBubble.tsx`:
   - User messages: right-aligned, primary color
   - Assistant messages: left-aligned, surface color
   - Support markdown rendering (basic: bold, code blocks)
3. Create `src/components/chat/StreamingBubble.tsx`:
   - Uses `useStreamingContent()` hook
   - Shows blinking cursor while streaming
   - Converts to static MessageBubble when done
4. Create `src/components/chat/ChatInput.tsx`:
   - Textarea + Send button
   - Enter to send (Shift+Enter for newline)
   - Disabled while isRunning
   - Calls `sendMessage()` from runtime context

**Commit**: `feat(web): add chat panel with streaming support`

---

## Task 9: Agent Status Panel

**Goal**: Left sidebar showing agent list with live status.

Steps:
1. Create `src/components/agents/AgentPanel.tsx`:
   - Uses `useAgentStates()` hook
   - List of AgentCard components
2. Create `src/components/agents/AgentCard.tsx`:
   - Employee name + role
   - Status badge (color-coded):
     - idle: gray
     - assigned/thinking: blue
     - executing: green
     - meeting: purple
     - blocked/failed: red
     - waiting: yellow
   - Current task name (if any)

**Commit**: `feat(web): add agent status panel`

---

## Task 10: Event Log Panel

**Goal**: Right sidebar showing graph execution timeline.

Steps:
1. Create `src/components/events/EventLog.tsx`:
   - Uses `useEventStream('graph.node.*')` hook
   - Chronological list of EventItem components
   - Auto-scroll to latest
2. Create `src/components/events/EventItem.tsx`:
   - Timestamp (relative, e.g., "2s ago")
   - Node name (boss, manager, employee_1, etc.)
   - Status icon (entered: play, exited: check)
   - Duration (for exited events, if calculable)

**Commit**: `feat(web): add event log panel`

---

## Task 11: Status Bar Integration

**Goal**: Bottom bar showing runtime metadata.

Steps:
1. Update `StatusBar.tsx`:
   - Subscribe to `llm.call.completed` events
   - Show: provider name, model name, total tokens, last call latency
   - Show run status: idle / running / error
   - Reset counters on new run

**Commit**: `feat(web): integrate status bar with runtime events`

---

## Task 12: Error Handling UI

**Goal**: Graceful error display for all failure modes.

Steps:
1. Create `src/components/error/ErrorBanner.tsx`:
   - Dismissible error banner at top of chat panel
   - Shows error message from runtime context
   - "Retry" button
2. Handle error states in AicsRuntimeProvider:
   - Missing provider config → show settings dialog
   - LLM call failure → ErrorBanner with message
   - Graph error → ErrorBanner with node context
3. Create `src/components/error/EmptyState.tsx`:
   - Shown when no messages yet
   - "Configure your LLM provider to get started" if no config
   - "Send a message to your AI company" if configured

**Commit**: `feat(web): add error handling and empty states`

---

## Task 13: End-to-End Integration Test

**Goal**: Verify the full loop works with a real provider.

Steps:
1. Manual test checklist:
   - [ ] Start dev server: `pnpm --filter @aics/web dev`
   - [ ] Page loads without console errors
   - [ ] Settings dialog opens, configure Gemini (or available provider)
   - [ ] Type "Write a brief project plan for a TODO app"
   - [ ] Agent panel shows status changes
   - [ ] Chat panel shows streaming response
   - [ ] Event log shows node transitions
   - [ ] Status bar shows token usage
   - [ ] Can run a second message without refresh
   - [ ] Error: remove API key, try to send → error displayed
2. Fix any issues found
3. Update vite.config.ts with proxy if CORS blocks

**Commit**: `fix(web): integration fixes from end-to-end testing`

---

## Task 14: Build Verification + Cleanup

**Goal**: Production build succeeds, code is clean.

Steps:
1. `pnpm --filter @aics/web build` — must succeed
2. `pnpm --filter @aics/web typecheck` — must pass
3. `biome check apps/web/` — fix any lint issues
4. Remove any console.log debugging
5. Ensure all imports are clean (no unused)

**Commit**: `chore(web): build verification and cleanup`

---

## Starter Prompt (for parallel session)

```
You are continuing the AICS project. Phase 2.4 (production hardening) is complete
(tag: phase-2.4-production-hardening). Phase 3 implements the web shell.

Read these files first:
1. CLAUDE.md
2. docs/plans/2026-03-09-phase3-web-shell-design.md
3. docs/plans/2026-03-09-phase3-web-shell-impl.md
4. packages/core/src/index.ts (available exports)
5. apps/web/package.json (current state)
6. apps/web/src/App.tsx (current placeholder)

Key context:
- apps/web is Vite + React 19 SPA (NOT Next.js)
- packages/core has 112 tests, exports: buildAicsGraph, createRuntimeContext,
  createMemoryRepositories, InMemoryEventBus, createGateway, OrchestrationService, etc.
- EventBus pattern: prefix-matching, synchronous, events like employee.state.*,
  graph.node.entered/exited, llm.stream.chunk
- LlmProvider: 'anthropic' | 'openai' | 'openai-compat'
- User has Gemini, Kimi, OpenRouter API keys in .env.local

Execute tasks 1-14 in order. Task 1 is critical — if LangGraph doesn't run in
browser, stop and report. For shadcn/ui (Task 3), use Tailwind CSS 4 compatible
variants and copy component source files directly.

For the runtime provider (Task 6), seed a simple company with 1 manager
("Alice", role: "engineering_manager") and 2 employees ("Bob" role: "developer",
"Carol" role: "designer") using createMemoryRepositories().seed.

Test with Gemini (GEMINI_API_KEY from .env.local) as the default provider.

After each task, commit with the message format from the impl plan.
Report: test count, build status, any deviations.
```

---

## Notes

- If Task 1 reveals LangGraph can't run in browser, the fallback is: core runs in
  a Vite SSR middleware (server-side) and exposes a WebSocket/SSE endpoint to the
  browser. This is more complex but keeps core in Node.js where it's proven.
- shadcn/ui Tailwind CSS 4 migration may require adjustments — the ecosystem is
  still settling. If components don't work, fall back to plain Tailwind utilities.
- The event log and agent panel are progressive — if EventBus events aren't rich
  enough, the UI can show "no data" gracefully and improve as events mature.
