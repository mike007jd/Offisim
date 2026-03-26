import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Model Configuration' };

export default function ModelsPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Model Configuration</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed max-w-lg">
        Offisim gives you full control over which LLM providers and models power your AI employees.
        Model choice belongs to your local runtime &mdash; not to packages or the marketplace.
      </p>

      {/* Supported Providers */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Supported Providers</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ProviderCard
            name="OpenAI"
            models="GPT-4o, GPT-4o-mini, o1, o3"
            note="Most widely supported; good default choice"
          />
          <ProviderCard
            name="Anthropic"
            models="Claude Opus, Sonnet, Haiku"
            note="Excellent for long-context and nuanced tasks"
          />
          <ProviderCard
            name="Google"
            models="Gemini 2.5 Pro, Flash"
            note="Strong multimodal capabilities"
          />
          <ProviderCard
            name="Ollama (Local)"
            models="Llama, Mistral, Qwen, etc."
            note="Fully offline; no API key needed"
          />
        </div>
      </section>

      {/* How Assignment Works */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">How Model Assignment Works</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Offisim uses a two-tier model assignment system:
        </p>
        <ol className="mt-4 space-y-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              1
            </span>
            <span>
              <strong className="text-[var(--text-primary)]">Default model</strong> &mdash;
              configured in Settings. Used for all employees that don&apos;t have a specific
              override.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              2
            </span>
            <span>
              <strong className="text-[var(--text-primary)]">Per-employee override</strong> &mdash;
              set in the Employee editor. Lets you assign a specific model to a specific role.
            </span>
          </li>
        </ol>
        <p className="mt-3 text-sm text-[var(--text-muted)] leading-relaxed">
          Packages may recommend model profiles (e.g. &ldquo;works best with a large-context
          model&rdquo;), but they never hard-bind to a specific provider or model.
        </p>
      </section>

      {/* Setting Up API Keys */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Setting Up API Keys</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Open the desktop app and navigate to Settings:
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm text-[var(--text-secondary)]">
          <div>Settings &rarr; Model Providers</div>
          <div className="mt-2 text-[var(--text-muted)]">
            Select provider &rarr; Paste API key &rarr; Save
          </div>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Keys are stored locally on your machine and never leave the runtime. They are not included
          in any marketplace packages or sync operations.
        </p>
      </section>

      {/* Per-Employee Override */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Per-Employee Model Override</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          To assign a specific model to an employee, open the Employee editor:
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm text-[var(--text-secondary)]">
          <div>Select Employee &rarr; Edit &rarr; Model Override</div>
          <div className="mt-2 text-[var(--text-muted)]">
            Choose provider &rarr; Select model &rarr; Save
          </div>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          This is useful for assigning a powerful model to complex roles (e.g. a senior developer
          using Claude Opus) while keeping simpler roles on faster, cheaper models (e.g. a
          note-taker using GPT-4o-mini).
        </p>
      </section>

      {/* Local Models with Ollama */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Local Models with Ollama</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Offisim supports fully local inference through Ollama. No data leaves your machine.
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm">
          <div className="text-[var(--text-muted)]"># Install Ollama</div>
          <div className="text-[var(--text-secondary)]">curl -fsSL https://ollama.com/install.sh | sh</div>
          <div className="mt-3 text-[var(--text-muted)]"># Pull a model</div>
          <div className="text-[var(--text-secondary)]">ollama pull llama3.1</div>
          <div className="mt-3 text-[var(--text-muted)]"># Ollama serves on localhost:11434 by default</div>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Once Ollama is running, select it as a provider in Settings. Offisim will auto-detect
          available models from your local Ollama instance.
        </p>
      </section>

      {/* Cost Considerations */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Cost Considerations</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Different roles have different complexity requirements. A practical strategy is to use
          tiered model assignment:
        </p>
        <ul className="mt-4 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>
              <strong className="text-[var(--text-primary)]">High complexity</strong> (Boss,
              senior developers) &rarr; top-tier models (GPT-4o, Claude Opus)
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>
              <strong className="text-[var(--text-primary)]">Medium complexity</strong> (Manager,
              PM, standard employees) &rarr; mid-tier models (Claude Sonnet, Gemini Flash)
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>
              <strong className="text-[var(--text-primary)]">Low complexity</strong> (note-taking,
              formatting, simple lookups) &rarr; fast/cheap models (GPT-4o-mini, Haiku) or local
              models
            </span>
          </li>
        </ul>
        <p className="mt-3 text-sm text-[var(--text-muted)] leading-relaxed">
          The dashboard shows per-task cost estimates to help you optimize model assignments over
          time.
        </p>
      </section>

      {/* Footer links */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <p className="text-sm text-[var(--text-muted)]">
          See also:{' '}
          <Link
            href="/docs/quickstart"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Quickstart
          </Link>
          {' \u00B7 '}
          <Link
            href="/docs/concepts"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Core Concepts
          </Link>
        </p>
      </section>
    </>
  );
}

function ProviderCard({ name, models, note }: { name: string; models: string; note: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{name}</h3>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{models}</p>
      <p className="mt-1.5 text-xs text-[var(--text-muted)]">{note}</p>
    </div>
  );
}
