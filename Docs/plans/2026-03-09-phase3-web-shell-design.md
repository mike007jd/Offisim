# Phase 3: Web Shell — Minimum Viable Runtime UI

**Date**: 2026-03-09
**Scope**: apps/web + minimal ui-core integration
**Depends on**: Phase 2.4 (core runtime, multi-provider LLM, EventBus)

---

## 1. Goal

End-to-end loop in the browser:

```
User types message → boss_chat graph executes → streaming results → agent status visible
```

This is the first time the user can **see** the multi-agent runtime in action through a real UI, not just test assertions.

---

## 2. Architecture Decisions

### 2.1 Core-in-Browser

packages/core runs **directly in the browser main thread**.

- **MemorySaver** for checkpoints (SqliteSaver is Node-only)
- **createMemoryRepositories()** for data persistence
- **InMemoryEventBus** for event dispatch
- **createGateway()** for LLM calls

Why not a backend server?
- PROJECT_CONSTITUTION: "local-first, user's company runtime is not SaaS"
- Desktop (1.0 target) runs everything locally
- A separate backend adds complexity with no benefit at this stage

**Risk**: LangGraph browser compatibility. @langchain/langgraph is TypeScript-first but may import Node.js modules. Task 1 verifies this.

**Risk**: better-sqlite3 must NOT be bundled. Vite config must externalize it or tree-shake it out (we only use MemorySaver in browser, never SqliteSaver).

### 2.2 LLM Calls from Browser

Three strategies, layered:

| Environment | Strategy |
|---|---|
| Dev (Vite) | Vite dev server proxy → forwards to provider API |
| Desktop (Tauri) | Tauri HTTP plugin → native fetch, no CORS |
| Web hosted | Backend proxy (out of Phase 3 scope) |

**Vite proxy config** routes `/api/llm-proxy/*` to the configured provider baseURL. The OpenAiAdapter receives `baseURL: '/api/llm-proxy'` in dev mode, and the real provider URL in desktop mode.

This avoids CORS issues entirely in development without touching the core adapter code.

### 2.3 State Architecture

```
┌─────────────────────────────────────────────────┐
│  LangGraph Graph State  (source of truth)       │
│  - messages, taskRuns, handoffs, etc.            │
└─────────┬───────────────────────────────────────┘
          │ emits
┌─────────▼───────────────────────────────────────┐
│  InMemoryEventBus  (notification layer)         │
│  - employee.state.*, task.state.*               │
│  - graph.node.entered/exited                    │
│  - llm.stream.chunk, llm.call.completed         │
└─────────┬───────────────────────────────────────┘
          │ subscribed by
┌─────────▼───────────────────────────────────────┐
│  React Hooks  (UI state, local to components)   │
│  - useEventStream('graph.node.*')               │
│  - useAgentStates()                             │
│  - useChatMessages()                            │
└─────────────────────────────────────────────────┘
```

Rules (from ENGINEERING_RULES):
- **NO global state library** (no Redux, no Zustand)
- **NO mirroring graph state** into a separate store
- React Context for dependency injection (runtime, EventBus)
- Custom hooks subscribe to EventBus and derive local state

### 2.4 UI Stack

Per ENGINEERING_RULES:
- **Tailwind CSS** — utility-first styling
- **shadcn/ui** — component primitives (Button, Input, Card, ScrollArea, etc.)
- **CSS transitions** for DOM motion (no Framer Motion)
- Install shadcn/ui components directly in apps/web/src/components/ui/

---

## 3. Layout

```
┌─────────────────────────────────────────────────┐
│ Header — "AI Company Simulator" / provider info │
├──────────┬──────────────────────┬───────────────┤
│          │                      │               │
│  Agent   │    Chat Panel        │  Event Log    │
│  Panel   │                      │               │
│          │  ┌────────────────┐  │  Timeline of  │
│  List of │  │ Message bubble │  │  graph.node   │
│  agents  │  │ Message bubble │  │  events with  │
│  with    │  │ ...streaming   │  │  timestamps   │
│  status  │  └────────────────┘  │               │
│  badges  │                      │               │
│          │  ┌────────────────┐  │               │
│          │  │ Input + Send   │  │               │
│          │  └────────────────┘  │               │
├──────────┴──────────────────────┴───────────────┤
│ Status Bar — model / latency / token count      │
└─────────────────────────────────────────────────┘
```

Three-column layout: sidebar (240px) + main (flex) + event log (280px).
Collapsible sidebars for narrow viewports.

---

## 4. Component Tree

```
<AicsRuntimeProvider>          ← React Context: runtime, eventBus, sendMessage()
  <AppLayout>
    <Header />                 ← company name, provider badge, settings trigger
    <AgentPanel />             ← subscribes to employee.state.* events
      <AgentCard />            ← name, role, status badge, current task
    <ChatPanel />              ← main interaction surface
      <MessageList />          ← scrollable message history
        <MessageBubble />      ← user or assistant message
        <StreamingBubble />    ← live streaming content
      <ChatInput />            ← textarea + send button
    <EventLog />               ← subscribes to graph.node.* events
      <EventItem />            ← timestamp + node name + status
    <StatusBar />              ← model info, token usage, latency
    <SettingsDialog />         ← provider/key/model configuration (persisted to localStorage)
  </AppLayout>
</AicsRuntimeProvider>
```

---

## 5. Key Hooks

### useAicsRuntime()
```typescript
interface AicsRuntimeHook {
  isRunning: boolean;
  sendMessage: (text: string) => Promise<void>;
  cancelRun: () => void;  // future: interrupt graph
}
```

Initializes on mount:
1. Reads provider config from localStorage
2. Creates gateway via `createGateway()`
3. Creates MemorySaver, memory repos, EventBus
4. Creates RuntimeContext
5. Builds graph via `buildAicsGraph()`

### useEventStream(pattern: string)
```typescript
function useEventStream(pattern: string): RuntimeEvent[] {
  // subscribes to EventBus with pattern
  // returns accumulated events (capped at N)
}
```

### useAgentStates()
```typescript
function useAgentStates(): Map<EmployeeId, EmployeeState> {
  // subscribes to 'employee.state.*'
  // returns current state map
}
```

### useStreamingContent()
```typescript
function useStreamingContent(): { content: string; isStreaming: boolean } {
  // subscribes to 'llm.stream.chunk'
  // accumulates content during active stream
}
```

---

## 6. Runtime Initialization Flow

```
1. User opens app → SettingsDialog if no saved config
2. User configures provider/key/model → saved to localStorage
3. AicsRuntimeProvider reads config → creates gateway + runtime
4. User types message → sendMessage()
5. sendMessage():
   a. Creates OrchestrationService
   b. Calls orchestrate({ entryMode: 'boss_chat', messages: [...] })
   c. OrchestrationService streams graph execution
   d. EventBus fires events → hooks update UI
   e. Final state → message appended to chat
```

---

## 7. Provider Configuration

Stored in localStorage as JSON:

```typescript
interface ProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  baseURL?: string;
  model: string;
  defaultHeaders?: Record<string, string>;
}
```

Settings dialog offers presets:
- Gemini (apiKey + model selector)
- OpenRouter (apiKey + model selector)
- Kimi (apiKey, auto-sets baseURL + headers)
- OpenAI (apiKey + model selector)
- Anthropic (apiKey + model selector)
- Custom OpenAI-compatible (apiKey + baseURL + model)

---

## 8. Vite Proxy Configuration

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api/llm-proxy': {
        target: 'https://placeholder', // overridden by configure()
        changeOrigin: true,
        configure: (proxy, options) => {
          // Read target from env or runtime config
          // Rewrite path to strip /api/llm-proxy prefix
        },
      },
    },
  },
});
```

Alternative (simpler for Phase 3): environment variable sets the proxy target at dev server start time. One provider per dev session.

**Simplest approach for Phase 3**: Don't proxy. Use providers that support CORS from browsers (OpenAI, Gemini). If CORS blocks, add proxy incrementally.

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LangGraph doesn't run in browser | Blocks everything | Task 1: verify immediately. Fallback: thin wrapper that makes RPC calls to a local Node process |
| better-sqlite3 bundled by Vite | Build fails | Vite resolve.alias or external config to exclude |
| CORS blocks LLM calls | No live demo | Vite proxy fallback; test with CORS-friendly providers first |
| Bundle too large | Slow load | Code-split LangGraph + OpenAI SDK behind dynamic import |
| EventBus floods React re-renders | UI jank | Debounce/batch event subscriptions in hooks |

---

## 10. What Phase 3 Does NOT Include

- PixiJS office scene (Phase 4: renderer)
- Install/marketplace features
- Full ui-office chrome (progressive)
- Persistence beyond MemorySaver (desktop Phase 5)
- Authentication or multi-user
- Mobile-responsive layout (desktop-first)

---

## 11. Success Criteria

| # | Criterion |
|---|---|
| S1 | `pnpm dev` starts Vite dev server, page loads without errors |
| S2 | User can configure a provider (Gemini/OpenRouter) via settings dialog |
| S3 | User types a message, boss_chat graph runs, response streams into chat |
| S4 | Agent panel shows employee status changes during graph execution |
| S5 | Event log shows graph node enter/exit events with timestamps |
| S6 | Status bar shows model name, token usage after completion |
| S7 | Error states display gracefully (LLM failure, missing config) |
| S8 | Page survives graph re-run without refresh |

---

## 12. Dependency Changes

### apps/web/package.json additions:
```json
{
  "dependencies": {
    "tailwindcss": "^4.0",
    "@tailwindcss/vite": "^4.0",
    "clsx": "^2.1",
    "tailwind-merge": "^3.0",
    "class-variance-authority": "^0.7",
    "lucide-react": "^0.400"
  }
}
```

Note: shadcn/ui components are copied into `apps/web/src/components/ui/` — they are not a dependency but source files (per shadcn/ui design).

### Vite plugins:
```json
{
  "@tailwindcss/vite": "^4.0"
}
```
