import type { Metadata } from 'next';
import {
  Building2,
  Brain,
  HardDrive,
  Plug,
  ArrowRight,
  Download,
  Sparkles,
  X,
  Check,
} from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How Offisim Works',
  description:
    'Architecture deep dive into Offisim — the spatial AI runtime where agents have bodies, desks, teams, and a building. Four-layer stack from 3D office to LLM gateway.',
};

/* ------------------------------------------------------------------ */
/* Concept mapping data                                                */
/* ------------------------------------------------------------------ */

const CONCEPT_MAP: { ai: string; offisim: string; emoji: string }[] = [
  { ai: 'LLM Agent', offisim: 'Employee at a desk', emoji: '\u{1F464}' },
  { ai: 'Orchestrator / Router', offisim: 'Boss giving orders', emoji: '\u{1F454}' },
  { ai: 'Task decomposition', offisim: 'PM creating a project plan', emoji: '\u{1F4CB}' },
  { ai: 'Agent capabilities / tools', offisim: 'Skills on a resume', emoji: '\u{1F6E0}\uFE0F' },
  { ai: 'Workflow / pipeline', offisim: 'SOP (Standard Operating Procedure)', emoji: '\u{1F4DD}' },
  {
    ai: 'Multi-agent coordination',
    offisim: 'Team meeting in the conference room',
    emoji: '\u{1F91D}',
  },
  {
    ai: 'Agent state / context',
    offisim: 'Department zone (DEV / ART / PROD)',
    emoji: '\u{1F3E2}',
  },
  {
    ai: 'Model selection',
    offisim: "Employee's education / training",
    emoji: '\u{1F393}',
  },
  { ai: 'Installable plugins', offisim: 'Hiring from the marketplace', emoji: '\u{1F4E6}' },
];

/* ------------------------------------------------------------------ */
/* Architecture layers data                                            */
/* ------------------------------------------------------------------ */

interface ArchLayer {
  icon: React.ReactNode;
  title: string;
  tag: string;
  what: string;
  systems: string[];
  why: string;
}

const LAYERS: ArchLayer[] = [
  {
    icon: <Building2 size={20} />,
    title: 'Spatial Layer',
    tag: 'Three.js + R3F + SVG',
    what: 'Renders a full 3D office with zones, desks, employee puppets, meeting rooms, and a lobby. Employees walk, sit, collaborate, and idle — all driven by runtime state. A 2D SVG top-down view is also available for lightweight monitoring.',
    systems: [
      'SceneOrchestrator \u2192 EntityManager \u2192 VisualFeedback pipeline',
      'Zone-based layout: DEV / ART / PROD / REST / MTG / LIB',
      '14 animation states per employee puppet',
      'Studio 3D editor for custom office layouts',
    ],
    why: 'Agents are no longer abstract. When your Developer is stuck, you see them at their desk. Spatial feedback transforms monitoring from reading logs to observing behavior.',
  },
  {
    icon: <Brain size={20} />,
    title: 'Agent Orchestration',
    tag: 'LangGraph',
    what: 'Runs the entire org chart as an execution graph. Boss analyzes intent and routes work. Manager selects teams and creates projects. PM decomposes into phased plans with dependency DAGs. Employees execute in parallel. HR handles hiring. An Error agent handles failures and recovery.',
    systems: [
      'Boss \u2192 Manager \u2192 PM \u2192 Employee hierarchy',
      'DAG-aware step dispatch with parallel execution',
      'Phase completion triggers and automatic handoffs',
      'Meeting nodes for sync, reviews, and blockers',
    ],
    why: 'Not flat task routing \u2014 a hierarchical organization with real management layers. Decomposition, delegation, and coordination happen the way they do in an actual company.',
  },
  {
    icon: <HardDrive size={20} />,
    title: 'Local Runtime',
    tag: 'Tauri + SQLite + MCP',
    what: 'Everything runs on the user\u2019s machine. SQLite stores all state \u2014 projects, employees, execution history, knowledge. EventBus drives real-time UI updates. MCP (Model Context Protocol) connects to local tools and file systems.',
    systems: [
      'EventBus: synchronous, prefix-matching pub/sub',
      'Repository pattern: memory (test) + Drizzle (prod)',
      'Project system: DAG dispatch, auto-resume on restart',
      'NotificationBridge: 7 event mappings to user alerts',
    ],
    why: 'Your data never leaves your machine. No cloud dependency for execution. Full offline capability once models are local.',
  },
  {
    icon: <Plug size={20} />,
    title: 'Model Freedom',
    tag: 'LLM Gateway',
    what: 'Abstracts all LLM providers behind a unified gateway. Each employee can use a different model. OpenAI, Anthropic, Google, Ollama \u2014 mix and match based on task complexity and budget.',
    systems: [
      'Per-employee model assignment',
      'Provider-agnostic message format',
      'Automatic message pruning (MAX=50 context window)',
      'Streaming support across all providers',
    ],
    why: 'Your senior architect on Claude Opus. Your intern on local Llama. Model choice is a staffing decision, not a platform lock-in.',
  },
];

/* ------------------------------------------------------------------ */
/* End-to-end flow data                                                */
/* ------------------------------------------------------------------ */

interface FlowPhase {
  step: number;
  title: string;
  description: string;
  spatial: string;
}

const FLOW_PHASES: FlowPhase[] = [
  {
    step: 1,
    title: 'Intent Recognition',
    description: 'Boss agent parses your natural language input, identifies the domain, and determines which department should handle it.',
    spatial: 'Boss avatar lights up',
  },
  {
    step: 2,
    title: 'Delegation & Planning',
    description: 'Manager routes to the right team. PM creates a project with phased tasks, dependencies, and assignments.',
    spatial: 'Meeting room lights up',
  },
  {
    step: 3,
    title: 'Parallel Execution',
    description: 'DAG-aware dispatch sends ready tasks to employees. Each uses their assigned LLM. Blocked tasks wait for dependencies.',
    spatial: 'Employees at desks, focus glow',
  },
  {
    step: 4,
    title: 'Coordination & Handoffs',
    description: 'Phase completion triggers the next phase. Agents sync on blockers, share context, and hand off deliverables.',
    spatial: 'Agents walk between desks',
  },
  {
    step: 5,
    title: 'Deliverable Assembly',
    description: 'Doc engine assembles outputs into final formats \u2014 code, documents, presentations, spreadsheets.',
    spatial: 'Project kanban shows all green',
  },
  {
    step: 6,
    title: 'Review & Iterate',
    description: 'User reviews the output. Feedback loops back through the org chart for revisions.',
    spatial: 'Boss walks to your desk with results',
  },
];

/* ------------------------------------------------------------------ */
/* Comparison data                                                     */
/* ------------------------------------------------------------------ */

interface ComparisonRow {
  others: string;
  offisim: string;
}

const COMPARISONS: ComparisonRow[] = [
  { others: 'Terminals and logs', offisim: '3D office \u2014 watch them work' },
  { others: 'One agent per human', offisim: 'Full org chart \u2014 scaling means hiring' },
  { others: 'Cloud-first', offisim: 'Local-first \u2014 SQLite on your machine' },
  { others: 'Locked to one model', offisim: 'Per-employee model choice' },
];

/* ================================================================== */
/* Page Component                                                      */
/* ================================================================== */

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-5xl px-6">
      {/* ── HW-1: Hero ── */}
      <section className="pb-16 pt-20 sm:pt-28">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--accent-indigo)]">
          How Offisim Works
        </p>
        <h1 className="font-display mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
          A spatial runtime where AI agents become&nbsp;colleagues.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-[var(--text-secondary)]">
          Other frameworks give agents tools. Offisim gives agents bodies, desks, teams, and
          a&nbsp;building.
        </p>
      </section>

      {/* ── HW-2: Concept Mapping Table ── */}
      <section className="border-t border-[var(--border)] py-14">
        <h2 className="font-display text-lg font-semibold">From abstract to tangible</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Every AI concept maps to something you already understand.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="pb-3 pr-4 text-left text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
                  AI Concept
                </th>
                <th className="pb-3 pl-4 text-left text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
                  Offisim Metaphor
                </th>
              </tr>
            </thead>
            <tbody>
              {CONCEPT_MAP.map((row) => (
                <tr key={row.ai} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-3 pr-4 text-[var(--text-secondary)]">{row.ai}</td>
                  <td className="py-3 pl-4 text-[var(--text-primary)]">
                    <span className="mr-2">{row.emoji}</span>
                    {row.offisim}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-sm italic text-[var(--text-muted)]">
          &ldquo;The best interface is one you already understand.&rdquo;
        </p>
      </section>

      {/* ── HW-3: Four Layer Architecture ── */}
      <section className="border-t border-[var(--border)] py-14">
        <h2 className="font-display text-lg font-semibold">The Offisim Stack</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Four layers, from pixels to providers.
        </p>

        <div className="mt-8 space-y-4">
          {LAYERS.map((layer, i) => (
            <div key={layer.title} className="card p-5 sm:p-6">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent-indigo)]">
                  {layer.icon}
                </div>
                <div className="flex items-baseline gap-3">
                  <h3 className="font-display text-base font-semibold">
                    <span className="mr-1.5 font-mono text-xs text-[var(--text-muted)]">
                      L{i + 1}
                    </span>
                    {layer.title}
                  </h3>
                  <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                    {layer.tag}
                  </span>
                </div>
              </div>

              {/* What it does */}
              <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
                {layer.what}
              </p>

              {/* Key systems */}
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
                  Key Systems
                </p>
                <ul className="mt-2 space-y-1.5">
                  {layer.systems.map((sys) => (
                    <li
                      key={sys}
                      className="flex items-start gap-2 text-sm text-[var(--text-secondary)]"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--accent-indigo)]" />
                      {sys}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Why it matters */}
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <p className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
                  Why It Matters
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]">
                  {layer.why}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Orchestration flow code block */}
        <div className="mt-8">
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
            Execution Flow
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
{`User: "Build a landing page"
  \u2514\u2500 Boss: analyzes intent \u2192 routes to Dev department
    \u2514\u2500 Manager: selects team, creates project
      \u2514\u2500 PM: decomposes \u2192 4 phases, 12 tasks, dependency DAG
        \u2514\u2500 Employees: execute in parallel (DAG-aware)
          \u2514\u2500 Meetings: sync on blockers, handoffs, reviews
            \u2514\u2500 Deliverables: code, docs, designs \u2192 user review`}
          </pre>
        </div>
      </section>

      {/* ── HW-4: End-to-End Flow ── */}
      <section className="border-t border-[var(--border)] py-14">
        <h2 className="font-display text-lg font-semibold">Life of a request</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          From natural language to delivered output. Every step visible.
        </p>

        <div className="mt-8 space-y-6">
          {FLOW_PHASES.map((phase) => (
            <div key={phase.step} className="flex gap-4 sm:gap-6">
              {/* Step number */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-bright)] font-mono text-xs font-bold text-[var(--accent-indigo)]">
                {phase.step}
              </div>

              <div className="min-w-0 flex-1 pb-6 border-b border-[var(--border)] last:border-0">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{phase.title}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{phase.description}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--accent-indigo)]">
                  <Sparkles size={11} />
                  {phase.spatial}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-[var(--accent-indigo)]/20 bg-[var(--accent-muted)] px-4 py-3">
          <p className="text-sm text-[var(--text-primary)]">
            Every execution phase has a spatial counterpart.{' '}
            <span className="text-[var(--accent-hover)]">
              This is the core thesis &mdash; work should be visible.
            </span>
          </p>
        </div>
      </section>

      {/* ── HW-5: Why Offisim ── */}
      <section className="border-t border-[var(--border)] py-14">
        <h2 className="font-display text-lg font-semibold">Why Offisim</h2>

        <div className="mt-8 space-y-3">
          {COMPARISONS.map((row) => (
            <div
              key={row.others}
              className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--border)] text-sm"
            >
              <div className="flex items-center gap-2 px-4 py-3 text-[var(--text-muted)]">
                <X size={14} className="shrink-0 text-[var(--accent-rose)]" />
                {row.others}
              </div>
              <div className="flex items-center gap-2 border-l border-[var(--border)] px-4 py-3 text-[var(--text-primary)]">
                <Check size={14} className="shrink-0 text-[var(--accent-indigo)]" />
                {row.offisim}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-[var(--border)] py-20 text-center">
        <h2 className="font-display text-2xl font-bold">Ready to try it?</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Download the desktop app or browse available assets.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-[var(--accent-indigo)] px-6 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Download size={15} />
            Download
          </a>
          <Link
            href="/search"
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-6 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)] transition-colors"
          >
            Browse Marketplace
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </div>
  );
}
