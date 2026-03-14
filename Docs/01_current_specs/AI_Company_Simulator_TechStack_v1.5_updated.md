AI Company Simulator — Tech Stack v1.5

Production-oriented architecture for the open-source runtime, marketplace website, and asset distribution system

| **Version**           | 1.5                                            |
|:----------------------|:-----------------------------------------------|
| **Date**              | 2026-03-06                                     |
| **Companion Doc**     | AI Company Simulator — PRD v1.6                |
| **Primary Language**  | TypeScript-first + thin Rust shell for desktop |
| **Desktop Framework** | Tauri 2.x                                      |
| **Agent Runtime**     | LangGraph.js                                   |

| 本次修订重点 / 修正架构中心：以 runtime / registry / install protocol 三层为核心，不再把市场误写成运行时主体。 / 将本地存储按环境拆分：Desktop 与 Web 分别采用不同 persistence path，但共享 repository 抽象。 / 补齐 runtime persistence、package manifest、public/private API 边界、worker/job 层。 / 明确多 Agent 协作是产品核心；模型/provider/agent runtime 由用户本地运行时解析，市场资产只提供员工层的可选推荐信息。 / 统一关键决策：Auth.js、Next.js 15.2 App Router、public-read/private-write market API、client/server PDF 分工、1.0 无任意安装脚本。 |
|----|

**Contents**

1.  **1. Architecture Overview**

- System layers

- Monorepo

- Resolved decisions

- Environment matrix

2.  **2. Rendering & UI**

- PixiJS

- UI package split

- Office vs market boundaries

3.  **3. Agent Orchestration**

- LangGraph topology

- Durable execution

- Runtime event model

4.  **4. LLM Gateway**

- Provider adapters

- Queueing

- Streaming

5.  **5. MCP Adapter & Permission Model**

- Seat-based permissions

- Editor MCP

- Secrets boundary

6.  **6. Storage & Persistence**

- Desktop/Web split

- Runtime schema

- Package state

7.  **7. Desktop App**

- Tauri responsibilities

- Deep link install

- Capabilities & secrets

8.  **8. Platform Services**

- API

- Auth

- Search

- Workers

- Storage

9.  **9. Market Website**

- Next.js routes

- Rendering modes

- UI sharing

10. **10. Asset Distribution Protocol**

- Manifest

- Install flow

- Integrity & provenance

11. **11. Document Engine**

- DOCX/PPTX/PDF decisions

12. **12. Tooling, Testing & Release**

- Testing matrix

- Dependency baseline

- Ops rules

# **1. Architecture Overview**

| The system is split into three product surfaces: an open-source local runtime, an operated marketplace website, and an asset distribution protocol that links the two. This revision turns the install pipeline into a first-class subsystem instead of leaving it implicit inside “fork”. |
|----|

## **1.1 System Layers**

| **Layer** | **Responsibility** | **Primary Technology** |
|:---|:---|:---|
| Rendering | 2D office scene, procedural art, bubbles, drag & drop, scene performance | PixiJS 8 + React 19 |
| UI Core | Shared design primitives and read-only components | React 19 + Tailwind CSS 4 + shadcn/ui |
| UI Office | Editors, runtime panels, dashboard, installation dialogs | React 19 + Zustand + TanStack Query |
| UI Market | Marketplace website components adapted to App Router | Next.js 15.2 App Router |
| Agent Runtime | Manager/PM routing, DAG execution, meetings, interrupts | LangGraph.js |
| LLM Gateway | Provider abstraction, rate limiting, streaming, failover | OpenAI-compatible adapter + provider SDKs |
| MCP Adapter | External tool access, seat-based permissions, editor MCP servers | Model Context Protocol SDK |
| Storage & Persistence | Local company state, runtime checkpoints, installed asset state | SQLite (Desktop/Web variants) + Drizzle |
| Platform Services | Registry, search, accounts, notifications, moderation, optional commerce | Hono + PostgreSQL + Workers |
| Distribution Protocol | Manifest parsing, compatibility checks, install/uninstall/upgrade | Package Manager + Registry Client |

## **1.2 Monorepo Structure**

| **Package / App** | **Purpose** |
|:---|:---|
| packages/core | LangGraph orchestration, runtime domain logic, event bus, task execution. |
| packages/ui-core | Cross-surface design system and display-only UI primitives. |
| packages/ui-office | Office-specific interactive components, dialogs, editors, dashboard widgets. |
| packages/ui-market | Next.js-safe marketplace components; no Pixi or office-only hooks. |
| packages/renderer | PixiJS office scene, procedural art, bubble system, drag & drop. |
| packages/storage | Repository interfaces, Drizzle schema, migrations, environment adapters. |
| packages/runtime-persistence | Checkpoint, queue, meeting, task-run, tool-call persistence helpers. |
| packages/asset-schema | Manifest JSON schema, validation, compatibility rules, provenance types. |
| packages/package-manager | Install / upgrade / uninstall / rollback orchestration. |
| packages/registry-client | Typed client for the marketplace registry API. |
| packages/mcp-servers | Office Editor MCP + Employee Editor MCP implementations. |
| packages/doc-engine | DOCX / PPTX / PDF / HTML / CSV export abstraction. |
| apps/web | Hosted web runtime (browser, local-first, no mandatory server state). |
| apps/desktop | Tauri shell around the office runtime. |
| apps/market | Public marketplace website with SEO and creator pages. |
| apps/platform | Registry API, auth, moderation, notifications, optional billing. |
| apps/worker | Async jobs: review, indexing, notification fan-out, integrity checks, optional billing events. |

## **1.3 Resolved Decisions**

| **Topic** | **Decision** |
|:---|:---|
| Auth | Use Auth.js across marketplace and platform auth flows. |
| Local storage | Desktop: SQLite via Tauri SQL plugin / sqlx path; Web: SQLite WASM + OPFS. |
| Market read routes | Public read, authenticated write. Search/detail/creator pages are not JWT-gated. |
| UI sharing | Split packages/ui into ui-core, ui-office, ui-market instead of one universal package. |
| PDF generation | pdf-lib for client-side document generation; Puppeteer only for optional server-rendered snapshots/marketing renders. |
| Package hosting | Registry stores metadata and source URLs; package payloads may live on npm, GitHub Releases, R2/S3, or other compatible sources. |
| Model ownership | Marketplace assets may recommend employee model profiles, but final provider/model/runtime selection stays in local runtime config. |
| Install hooks | 1.0 packages are declarative only; no arbitrary postinstall scripts or hidden install actions. |

## **1.4 Environment Matrix**

Desktop is the 1.0 reference environment. Hosted Web and Docker Self-host share browser constraints unless a capability is explicitly moved server-side by the deployer.

| **Capability** | **Hosted Web** | **Desktop** | **Docker Self-host** |
|:---|:---|:---|:---|
| Browser-local persistence | SQLite WASM + OPFS | N/A | SQLite WASM + OPFS |
| Native SQLite | N/A | Tauri SQL / sqlx | N/A |
| Local file system automation | Limited file picker only | Yes | No browser-side; server-side only if configured |
| Deep-link install | Limited | Yes | Limited |
| localhost MCP | No | Yes | Configurable on deploy host |
| Ollama / local models | No | Yes | Configurable on deploy host |
| Editor MCP servers | No | Yes | Configurable on deploy host |
| Secrets vault | Soft protection only | Strong protection | Deployment-dependent |

# **2. Rendering & UI**

## **2.1 PixiJS for the Office Runtime**

PixiJS remains the correct choice for the office runtime because the scene has many moving entities, layered feedback, and drag-heavy interactions. React continues to own all chrome outside the main canvas.

- PixiJS scene containers map directly to office concepts: floor, departments, furniture, employees, bubbles, overlays.

- Procedural art stays data-driven so templates and themes can be assetized without shipping large sprite sheets.

- The office canvas is not reused on the market site; marketplace pages stay HTML-first for SEO and performance.

## **2.2 UI Package Split**

| **UI package** | **Scope** | **Allowed dependencies** |
|:---|:---|:---|
| ui-core | Shared typography, cards, badges, tables, forms, display components | React, Tailwind, shadcn/ui |
| ui-office | Boss chat, editors, property panels, install dialogs, dashboard widgets | ui-core + Zustand + TanStack Query + office hooks |
| ui-market | Listing cards, creator profile sections, pricing blocks, review UI | ui-core + Next.js App Router-safe client boundaries |

This split avoids dragging browser-only office logic into Next.js App Router surfaces, where Server and Client Components have different constraints.

*Implementation note: App Router pages are server-rendered by default; interactive pieces must live behind explicit Client Component boundaries.*

# **3. Agent Orchestration**

| LangGraph is retained, but the previous schema was missing the persistence substrate needed for durable execution. 1.0 requires runtime persistence as a formal part of the architecture, not an implementation detail. |
|----|

## **3.1 Graph Topology**

| **Graph** | **Nodes** | **Responsibility** |
|:---|:---|:---|
| ManagerGraph | IntentClassifier → HRRouter / PMRouter / DirectRouter / Clarify | Top-level routing for all boss input. |
| PMGraph | Decompose → Assign → Monitor → Collect → SaveSOP | Task DAG planning and execution monitoring. |
| MeetingGraph | Open → TurnLoop → BossInterrupt → Summarize → Minutes | Multi-agent meeting orchestration with human interrupts. |

LangGraph stays as the orchestration kernel because multi-agent coordination—not a specific coding harness—is the product core. Supervisor routing, handoffs, meeting loops, interrupts, and resume semantics map cleanly onto graphs and subgraphs.

## **3.2 Runtime Persistence Schema**

| **Table / Stream** | **Purpose** |
|:---|:---|
| graph_threads | One logical execution thread per user-initiated task or meeting. |
| graph_checkpoints | Durable state checkpoints for resume/replay. |
| task_runs | Task-level execution status, owner, timestamps, result pointers. |
| tool_calls | Auditable MCP/tool invocations, arguments summary, result summary, failure metadata. |
| queue_events | Queued / resumed / reprioritized / cancelled transitions. |
| meeting_sessions | Structured meeting context, participants, agenda, minutes pointer. |
| output_artifacts | Generated deliverables and previews with provenance to runs and source inputs. |

- Any feature that claims interrupt/resume must map back to stored checkpoints and resume points.

- Local replay/debugging should reconstruct why an employee was queued, retried, reassigned, or failed.

- SOP generation must preserve provenance to the run that produced it.

# **4. LLM Gateway**

## **4.1 Provider Abstraction**

- All employee model preferences and profile hints route through a gateway that normalizes provider auth, model names, cost accounting, and streaming APIs.

- The gateway remains provider-agnostic: OpenAI-compatible endpoints, Anthropic, Gemini, OpenRouter, LiteLLM, and desktop-local providers such as Ollama are mapped behind policy objects.

- Routing policy is attached to local runtime config, not hard-coded inside employees or marketplace packages.

- Optional coding runtimes such as Codex, Claude Code, or OpenCode are user-selected local execution options for certain employees, not a first-class marketplace dependency.

## **4.2 Queue, Streaming & Failover**

| **Concern** | **Implementation** |
|:---|:---|
| Rate limits | Per-provider token bucket plus adaptive concurrency from observed headers and failures. |
| Priority | Meetings \> foreground task runs \> background maintenance tasks. |
| Backpressure | Queue depth emits runtime events consumed by bubble UI and dashboard. |
| Streaming | Token stream fans out to LangGraph state and rendering layer simultaneously. |
| Failover | Retry with exponential backoff; optional secondary provider policy if configured. |

# **5. MCP Adapter & Permission Model**

| The permission model stays one of the strongest parts of the product. The revision formalizes that marketplace assets may declare required capabilities, but only the local runtime may bind real credentials. |
|----|

## **5.1 Seat-based Permission Flow**

- Rack stores a connector endpoint plus auth metadata location.

- Workstation slot exposes only selected tools from a rack.

- Employee receives tools only while seated at a workstation with active slots.

- Unseat / move operations revoke tools immediately.

## **5.2 Editor MCP Servers**

Office Editor MCP and Employee Editor MCP are desktop-first features. They may run in self-hosted environments if the deployer explicitly enables sidecar services, but they are not assumed to be available in hosted web.

## **5.3 Secrets Boundary**

| **Rule** | **Implication** |
|:---|:---|
| Packages cannot ship live secrets. | Imported assets may only declare connectors and scopes; users must rebind credentials locally. |
| Desktop secrets use a secure store. | Tauri capability restrictions and a secure secret vault protect local credentials. |
| Web secrets are weaker by nature. | Hosted web should avoid implying the same security posture as desktop for BYOK. |

# **6. Storage & Persistence**

## **6.1 Environment-specific Local Storage**

| **Environment** | **Database path** | **Notes** |
|:---|:---|:---|
| Desktop | SQLite via Tauri SQL plugin (sqlx-backed) | Single-user local database file; native performance; pairs with secure secret storage. |
| Hosted Web | SQLite WASM + OPFS | Browser-local persistence; no server required for company state. |
| Docker Self-host (web UI) | SQLite WASM + OPFS in browser by default | Self-hosting the app does not automatically centralize company data unless a later sync mode is introduced. |

*OPFS-backed browser persistence should be documented with clear caveats around browser support, storage clearing behavior, and private/incognito contexts.*

## **6.2 Local Schema Groups**

| **Schema group** | **Representative tables** |
|:---|:---|
| Domain data | companies, employees, departments, workstations, racks, sops, skill_cards |
| Runtime state | graph_threads, graph_checkpoints, task_runs, queue_events, meeting_sessions, output_artifacts |
| Installed asset state | installed_assets, installed_asset_versions, package_bindings, local_modifications |
| Local UX / events | notifications, recent_imports, download_history, dashboard_snapshots |

## **6.3 Installed Asset Model**

| **Table** | **Purpose** |
|:---|:---|
| installed_assets | One row per asset installed into a company; points to source package and local instance ids. |
| installed_asset_versions | Tracks current installed version, upgrade history, rollback points. |
| package_bindings | Connector and environment-specific bindings performed after install. |
| local_modifications | User changes since install, enabling “modified from upstream” warnings. |

# **7. Desktop App**

## **7.1 Tauri Responsibilities**

| **Responsibility** | **Why it lives in desktop** |
|:---|:---|
| File import/export | Reliable local package import, export, backup, and download handling. |
| Deep-link install | Open marketplace install links directly in the local runtime. |
| Native SQLite access | Stable local persistence path with native performance. |
| Secure secrets vault | Store BYOK credentials and connector secrets more safely than browser storage. |
| Updater / app metadata | Desktop release management and OS integration. |

## **7.2 Capability & Security Model**

- Use Tauri capabilities/permissions to scope IPC access by window and feature area.

- Treat deep-link URLs as untrusted input; resolve against allowlisted domains, parse, validate manifest endpoints, and re-check integrity before install.

- Keep the Rust layer intentionally thin: OS integration, secure storage, updater, native DB path, and protocol handling only.

# **8. Platform Services**

| The operated platform is a control plane, not the place where user companies are supposed to run. It stores metadata, accounts, listings, provenance, notifications, and optional commerce state. |
|----|

## **8.1 Core Components**

| **Component** | **Decision** |
|:---|:---|
| API framework | Hono |
| Primary DB | PostgreSQL 16 + Drizzle ORM |
| Auth | Auth.js |
| Search | PostgreSQL full-text + pg_trgm for 1.0 |
| Object storage | R2 / S3-compatible storage for screenshots, badges, optional hosted package assets |
| Realtime | SSE or WebSocket for notifications and publish/install status |
| Async jobs | Dedicated worker app backed by PostgreSQL job tables / queue |

## **8.2 Public vs Private API Boundary**

| **Route group** | **Auth** | **Purpose** |
|:---|:---|:---|
| /market/search, /market/items/:id, /creator/:id | Public | Marketplace discovery and SEO-readable data. |
| /market/install-token, /market/publish, /market/rate | Authenticated | Install authorization, publishing, review submission. |
| /library/me, /wallet, /transactions, /notifications | Authenticated | Account-bound private surfaces. |
| /webhooks/\* | Signed server-to-server | Payment or notification integrations. |

## **8.3 Worker Jobs**

- Publish validation: manifest lint, integrity check, secret scan, screenshot requirements.

- Search/index maintenance and trending score recomputation.

- Notification fan-out for installs, reviews, publish approvals, and asset updates.

- Optional later: billing webhooks, payout events, fraud/risk checks.

# **9. Market Website**

## **9.1 Next.js Surface**

The market site stays a distinct Next.js 15.2 App Router application optimized for public discovery, SEO, and shareable detail pages.

| **Route** | **Rendering mode** | **Notes** |
|:---|:---|:---|
| / | SSG | Homepage and featured assets. |
| /search | SSR | Search results with filters and sort. |
| /employee/:id, /skill/:id, /sop/:id, /template/:id | SSR + cache/ISR strategy | Public detail pages with compatibility, provenance, reviews, install CTA. |
| /creator/:id | SSR | Creator reputation and published assets. |
| /dashboard | Client-authenticated area | Personal library, publish flow, notifications. |

- Only reuse ui-core and ui-market on the market site; do not import office editor stateful components into App Router surfaces.

- Server Components should own fetch-heavy listing pages; interactive panels, filters, and dashboard widgets can be client components.

- Keep React/Next security patching discipline high for the market site because it runs server-rendered components.

# **10. Asset Distribution Protocol**

| This is the subsystem that was previously under-specified. 1.0 requires a concrete install contract, even if the platform chooses not to host most package binaries. |
|----|

## **10.1 Supported Package Sources**

| **Source type** | **Best for** | **Platform responsibility** |
|:---|:---|:---|
| Registry metadata + external URL | Most assets | Store listing, manifest metadata, integrity, compatibility, source link. |
| npm package | Code-like skills or helper packages | Resolve package coordinates and compatibility metadata. |
| ZIP bundle (manifest + payload) | Employees, SOPs, company templates, office layouts | Validate and import bundle contents. |
| R2 / S3 / GitHub Releases asset | Free-phase hosted download artifacts | Optional hosting or pointer only; not mandatory for every asset. |

## **10.2 Install Flow**

| **Step** | **Description** |
|:---|:---|
| Resolve | Fetch listing metadata and manifest from registry or direct source. |
| Validate | Check signature/hash, engine_range, schema_version, dependencies, and required capabilities. |
| Fetch | Download package payload from source URL. |
| Unpack | Materialize files into a staging area; never install directly into live state. |
| Bind | Prompt the user to map required connectors/tools and, for employee assets, optional model profiles in the local environment. |
| Commit | Create installed instance records and switch the asset into active use. |
| Rollback | If any step fails after staging, restore previous version and leave a readable failure report. |

## **10.3 Integrity, Provenance & Signatures**

- Every package install records source URL, publisher identity, package hash, install timestamp, and resulting local instance ids.

- Forks carry fork_origin metadata so creators, users, and future royalty logic can trace lineage.

- Unsigned assets may still be installable in free/open phases, but the UX must clearly distinguish verified and unverified publishers.

# **11. Document Engine**

| **Format** | **Primary library** | **Decision note** |
|:---|:---|:---|
| DOCX | docx (npm) | Structured reports, proposals, minutes, and downloadable written artifacts. |
| PPTX | pptxgenjs | Pitch Hall deck generation. |
| PDF | pdf-lib | Default client-side PDF generation path for runtime outputs. |
| Server-side PDF snapshot | Puppeteer (optional) | Only for site-side previews, OG-like exports, or server-rendered marketing documents. |
| CSV / XLSX | SheetJS | Tabular exports and analytics. |
| HTML / SVG / PNG | Direct generation + Pixi extract + sharp (where server-side is needed) | Web and visual output surfaces. |

# **12. Tooling, Testing & Release**

## **12.1 Engineering Tooling**

| **Area**        | **Baseline**          |
|:----------------|:----------------------|
| Package manager | pnpm workspace        |
| Web build       | Vite 7 for apps/web   |
| Desktop build   | Tauri CLI 2.x         |
| Market build    | Next.js 15.2 App Router |
| Testing         | Vitest + Playwright   |
| Lint / format   | Biome                 |
| Versioning      | Changesets            |
| CI/CD           | GitHub Actions        |

## **12.2 Testing Matrix**

- Runtime unit tests: orchestration, repository adapters, package parsing, compatibility rules.

- Desktop integration tests: deep-link install, file import/export, secret unlock, local DB migrations.

- Marketplace E2E: public search/detail pages, creator dashboards, publish flow, notification delivery.

- Cross-environment install tests: same package installed on Hosted Web, Desktop, and Self-hosted Web with expected capability prompts.

## **12.3 Dependency Baseline**

| **Layer** | **Baseline dependencies** |
|:---|:---|
| Rendering | pixi.js 8, @pixi/react, pixi-viewport, gsap |
| UI | react 19, tailwindcss 4, shadcn/ui, zustand 5, @tanstack/react-query 5 |
| Agent runtime | @langchain/langgraph, @langchain/core, provider SDKs |
| MCP | @modelcontextprotocol/sdk |
| Local storage | drizzle-orm, drizzle-kit, SQLite adapters by environment |
| Desktop | @tauri-apps/api + official plugins (sql, deep-link, updater, stronghold as needed) |
| Platform | hono, postgres/pg, drizzle-orm, auth.js |
| Docs / exports | docx, pptxgenjs, pdf-lib, xlsx |

## **12.4 External Baseline References Used in This Revision**

| **Topic** | **Reference baseline used for validation** |
|:---|:---|
| Tauri architecture, SQL, deep-link, security | Official Tauri v2 docs |
| Next.js App Router server/client boundaries | Official Next.js docs |
| Auth.js | Official Auth.js docs |
| LangGraph durable execution + LangChain multi-agent patterns | Official LangGraph / LangChain docs |
| SQLite WASM persistence / OPFS | Official SQLite WASM docs |
| PDF generation split | Official pdf-lib / Puppeteer docs |
