import type { Metadata } from 'next';
import {
  ArrowRight,
  Building2,
  Check,
  CircleDot,
  Download,
  ExternalLink,
  Github,
  Layers,
  Monitor,
  Package,
  Server,
  Shield,
  ShoppingBag,
  BookOpen,
  X,
} from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Offisim — The Spatial Interface for AI',
  description:
    'Offisim gives AI agents a body, a desk, a team, and a building. A local-first, open-source spatial runtime where agent workflows become visible, tangible, and human-understandable.',
  openGraph: {
    title: 'Offisim — The Spatial Interface for AI',
    description:
      'AI agents are invisible. Offisim gives them a body, a desk, a team, and a building.',
  },
};

/* ====================================================================== */
/*  Landing Page                                                          */
/* ====================================================================== */

export default function Home() {
  return (
    <div>
      {/* ── Section 1: Hero ── */}
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 sm:pt-28">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-indigo)]">
          The Spatial Interface for AI
        </p>

        <h1 className="font-display mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          What if you could{' '}
          <span className="bg-gradient-to-r from-[var(--accent-indigo)] to-[#a78bfa] bg-clip-text text-transparent">
            see AI work?
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--text-secondary)]">
          AI agents are invisible — hidden behind terminals and chat windows. Offisim gives them a
          body, a desk, a team, and a building. Watch your AI company run in real time.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#download"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-indigo)] px-6 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Download size={16} />
            Download Offisim
          </a>
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-bright)] hover:text-[var(--text-primary)] transition-colors"
          >
            Watch Demo ▶
          </a>
        </div>

        {/* Scene preview placeholder */}
        <div className="mt-14 flex aspect-[16/9] items-center justify-center rounded-xl border border-[var(--border)] bg-gradient-to-br from-[var(--bg-secondary)] via-[var(--bg-tertiary)] to-[var(--bg-secondary)]">
          <div className="text-center">
            <Building2 size={48} className="mx-auto text-[var(--text-muted)] opacity-40" />
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              3D Office Scene Preview
            </p>
          </div>
        </div>
      </section>

      {/* ── Section 2: Manifesto ── */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="font-display text-center text-3xl font-bold tracking-tight sm:text-4xl">
            AI is powerful. But it&rsquo;s invisible.
          </h2>

          <div className="mt-14 grid gap-6 sm:grid-cols-2">
            {/* Left: Today */}
            <div className="card p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent-rose)]">
                Today&rsquo;s AI Agents
              </p>
              <ul className="mt-5 space-y-3">
                {MANIFESTO_LEFT.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm text-[var(--text-secondary)]"
                  >
                    <X size={14} className="mt-0.5 shrink-0 text-[var(--accent-rose)]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: Offisim */}
            <div className="card border-[var(--accent-indigo)]/30 p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--success)]">
                Offisim
              </p>
              <ul className="mt-5 space-y-3">
                {MANIFESTO_RIGHT.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm text-[var(--text-secondary)]"
                  >
                    <Check size={14} className="mt-0.5 shrink-0 text-[var(--success)]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <blockquote className="mx-auto mt-14 max-w-2xl text-center">
            <p className="text-base leading-relaxed text-[var(--text-secondary)] italic">
              &ldquo;We believe the future of AI isn&rsquo;t just smarter models — it&rsquo;s a
              spatial world where humans and AI share the same space.&rdquo;
            </p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              A prototype of Web 3.0. Running on your machine today.
            </p>
          </blockquote>
        </div>
      </section>

      {/* ── Section 3: User Story Flow ── */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="font-display text-center text-3xl font-bold tracking-tight sm:text-4xl">
            From idea to deliverable in one conversation
          </h2>

          <div className="mt-16 space-y-12">
            {FLOW_STEPS.map((step) => (
              <div key={step.number} className="flex gap-6">
                {/* Number circle */}
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: step.color }}
                >
                  {step.number}
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-lg font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{step.description}</p>
                  {/* Screenshot placeholder */}
                  <div className="mt-4 flex h-40 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
                    <p className="text-xs text-[var(--text-muted)]">{step.placeholder}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 4: Architecture Stack ── */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Not another wrapper
          </p>
          <h2 className="font-display mt-2 text-center text-3xl font-bold tracking-tight sm:text-4xl">
            A spatial runtime.
          </h2>
          <p className="mt-3 text-center text-sm text-[var(--text-secondary)]">
            Four layers. One unified experience.
          </p>

          {/* Stacked layers */}
          <div className="mt-12 overflow-hidden rounded-xl border border-[var(--border)]">
            {ARCH_LAYERS.map((layer) => (
              <div
                key={layer.name}
                className={`flex items-center gap-4 border-b border-[var(--border)] p-5 last:border-b-0 ${layer.bg}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  {layer.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      {layer.name}
                    </h3>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {layer.tech}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{layer.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Trust badges */}
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            {TRUST_BADGES.map((badge) => (
              <span
                key={badge.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
              >
                {badge.icon}
                {badge.label}
              </span>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-1 text-sm text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
            >
              See the full architecture <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section 5: Download ── */}
      <section id="download" className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-24 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to build your AI company?
          </h2>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            Download. Launch. Hire your first AI employee in 30 seconds.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {PLATFORMS.map((p) => (
              <a
                key={p.label}
                href={p.href}
                className="card flex flex-col items-center gap-2 p-6 hover:border-[var(--accent-indigo)]/40 transition-colors"
              >
                <span className="text-2xl">{p.emoji}</span>
                <span className="text-sm font-semibold text-[var(--text-primary)]">{p.label}</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">{p.ext}</span>
              </a>
            ))}
          </div>

          <div className="mx-auto mt-10 max-w-md">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-5 py-3">
              <code className="font-mono text-xs text-[var(--text-secondary)]">
                git clone offisim/offisim && pnpm install && pnpm tauri build
              </code>
            </div>
            <a
              href="https://github.com/offisim/offisim"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              View on GitHub <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </section>

      {/* ── Section 6: Ecosystem ── */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid gap-4 sm:grid-cols-3">
            <EcosystemCard
              icon={<ShoppingBag size={20} className="text-[var(--accent-indigo)]" />}
              title="Marketplace"
              description="Employees, skills, SOPs, templates. Install with one click."
              href="/browse"
              label="Browse assets"
            />
            <EcosystemCard
              icon={<BookOpen size={20} className="text-[var(--accent-indigo)]" />}
              title="Documentation"
              description="Quickstart guide, concepts, model setup, publishing packages."
              href="/docs"
              label="Read the docs"
            />
            <EcosystemCard
              icon={<Github size={20} className="text-[var(--accent-indigo)]" />}
              title="Open Source"
              description="MIT licensed. Star, fork, contribute."
              href="https://github.com/offisim/offisim"
              label="View on GitHub"
              external
            />
          </div>
        </div>
      </section>

      {/* ── Section 7: Vision Close ── */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-24 text-center">
          <h2 className="font-display mx-auto max-w-2xl text-2xl font-bold leading-snug tracking-tight sm:text-3xl">
            Today, it&rsquo;s an AI office on your desktop.
            <br />
            Tomorrow, it&rsquo;s how humans and AI share a world.
          </h2>

          <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
            Offisim is an open-source experiment in spatial AI — where agent workflows become
            visible, tangible, and human-understandable. We&rsquo;re building the first prototype of
            what work looks like in Web 3.0.
          </p>

          <a
            href="#download"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[var(--accent-indigo)] px-8 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Download size={16} />
            Download Offisim
          </a>

          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Free. Open source. Yours forever.
          </p>
        </div>
      </section>
    </div>
  );
}

/* ====================================================================== */
/*  Data                                                                  */
/* ====================================================================== */

const MANIFESTO_LEFT = [
  'Hidden in terminals and chat windows',
  'One human talks to one model',
  'No spatial awareness or physical presence',
  'No team dynamics, hierarchy, or meetings',
  'You read the output and hope it worked',
];

const MANIFESTO_RIGHT = [
  'Visible in a 3D office you can watch',
  'Agents form teams and hold meetings',
  'Departments, zones, desks — spatial organization',
  'Hierarchical org: Boss, Manager, PM, Employee',
  'Watch your AI company run in real time',
];

const FLOW_STEPS = [
  {
    number: 1,
    color: '#6366f1',
    title: 'You tell the Boss',
    description: 'Natural language input. Describe what you need — a project, a task, a goal.',
    placeholder: 'Screenshot: Chat input with Boss agent',
  },
  {
    number: 2,
    color: '#8b5cf6',
    title: 'PM breaks it into a plan',
    description:
      'The PM decomposes your request into steps, assigns priorities, and creates a DAG execution plan.',
    placeholder: 'Screenshot: Project plan with task breakdown',
  },
  {
    number: 3,
    color: '#22c55e',
    title: 'Employees go to work — visually',
    description:
      'Watch agents walk to their desks, open tools, collaborate in meetings, and execute tasks in parallel.',
    placeholder: 'Screenshot: 3D office with employees working',
  },
  {
    number: 4,
    color: '#eab308',
    title: 'You review the output',
    description:
      'Deliverables land on your desk. Review documents, code, reports — everything the team produced.',
    placeholder: 'Screenshot: Output review panel',
  },
];

const ARCH_LAYERS = [
  {
    name: 'Spatial Layer',
    tech: 'Three.js + R3F + SVG',
    desc: '3D office, zones, desks, puppet animations, camera controls',
    bg: 'bg-[var(--accent-indigo)]/5',
    icon: <Layers size={18} className="text-[var(--accent-indigo)]" />,
  },
  {
    name: 'Agent Layer',
    tech: 'LangGraph',
    desc: 'Boss \u2192 Manager \u2192 PM \u2192 HR \u2192 Employee orchestration',
    bg: 'bg-purple-500/5',
    icon: <CircleDot size={18} className="text-purple-400" />,
  },
  {
    name: 'Runtime Layer',
    tech: 'Tauri + SQLite + MCP',
    desc: 'Local data, EventBus, MCP tool execution, file system access',
    bg: 'bg-emerald-500/5',
    icon: <Server size={18} className="text-emerald-400" />,
  },
  {
    name: 'Model Layer',
    tech: 'LLM Gateway',
    desc: 'OpenAI, Anthropic, Google, Ollama — your choice, your keys',
    bg: 'bg-yellow-500/5',
    icon: <Monitor size={18} className="text-yellow-400" />,
  },
];

const TRUST_BADGES = [
  { label: '100% Local-first', icon: <Shield size={12} /> },
  { label: 'Open Source', icon: <Github size={12} /> },
  { label: 'Desktop App (Tauri)', icon: <Monitor size={12} /> },
  { label: 'Installable Packages', icon: <Package size={12} /> },
];

const PLATFORMS = [
  { label: 'macOS', ext: '.dmg', emoji: '\uD83D\uDDA5\uFE0F', href: '#' },
  { label: 'Windows', ext: '.msi', emoji: '\uD83E\uDE9F', href: '#' },
  { label: 'Linux', ext: '.AppImage', emoji: '\uD83D\uDC27', href: '#' },
];

/* ====================================================================== */
/*  Sub-components                                                        */
/* ====================================================================== */

function EcosystemCard({
  icon,
  title,
  description,
  href,
  label,
  external,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  label: string;
  external?: boolean;
}) {
  const Tag = external ? 'a' : Link;
  const extraProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {};

  return (
    <Tag
      href={href}
      {...(extraProps as Record<string, string>)}
      className="card flex flex-col p-6 hover:border-[var(--accent-indigo)]/40 transition-colors"
    >
      <div className="mb-3">{icon}</div>
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--accent-indigo)]">
        {label} <ArrowRight size={12} />
      </span>
    </Tag>
  );
}
