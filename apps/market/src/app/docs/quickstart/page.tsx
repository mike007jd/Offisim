import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Quickstart' };

export default function QuickstartPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Quickstart</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed max-w-lg">
        Get Offisim running and complete your first AI task in under five minutes.
      </p>

      {/* Prerequisites */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Prerequisites</h2>
        <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>
              <strong className="text-[var(--text-primary)]">Operating system:</strong> macOS,
              Windows, or Linux
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>
              <strong className="text-[var(--text-primary)]">API key</strong> for at least one LLM
              provider (OpenAI, Anthropic, Google, or a local Ollama instance)
            </span>
          </li>
        </ul>
      </section>

      {/* Step 1 */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">
          <span className="text-[var(--accent-indigo)] mr-2">1.</span>Download
        </h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Grab the latest release for your platform from{' '}
          <a
            href="https://github.com/nicepkg/offisim/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            GitHub Releases
          </a>
          . Installers are available for macOS (.dmg), Windows (.msi), and Linux (.AppImage / .deb).
        </p>
      </section>

      {/* Step 2 */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">
          <span className="text-[var(--accent-indigo)] mr-2">2.</span>First Launch
        </h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Open Offisim and create your first company. You will be asked for:
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-[var(--text-secondary)]">
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>
              <strong className="text-[var(--text-primary)]">Company name</strong> &mdash; the name
              of your AI workspace
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>
              <strong className="text-[var(--text-primary)]">Description</strong> &mdash; a short
              summary of what this company does
            </span>
          </li>
        </ul>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          The first-time wizard walks you through each step. You can always change these later in
          Settings.
        </p>
      </section>

      {/* Step 3 */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">
          <span className="text-[var(--accent-indigo)] mr-2">3.</span>Configure Models
        </h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Open <strong className="text-[var(--text-primary)]">Settings</strong> and add an API key
          for your preferred provider. Offisim supports multiple providers simultaneously &mdash;
          you can assign different models to different employees later.
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm text-[var(--text-secondary)]">
          Settings &rarr; Model Providers &rarr; Add Key
        </div>
        <p className="mt-3 text-sm text-[var(--text-muted)] leading-relaxed">
          See{' '}
          <Link
            href="/docs/models"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Model Configuration
          </Link>{' '}
          for details on provider setup and per-employee overrides.
        </p>
      </section>

      {/* Step 4 */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">
          <span className="text-[var(--accent-indigo)] mr-2">4.</span>Hire Your First Employee
        </h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Employees are AI agents with roles, skills, and SOPs. You can create one from a built-in
          template or install one from the marketplace.
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm text-[var(--text-secondary)]">
          Office &rarr; Hire Employee &rarr; Choose Template
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Each employee gets assigned to a zone (DEV, ART, PROD, etc.) and can be given specific
          model assignments, skills, and operating procedures.
        </p>
      </section>

      {/* Step 5 */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">
          <span className="text-[var(--accent-indigo)] mr-2">5.</span>Give Your First Task
        </h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Talk to the <strong className="text-[var(--text-primary)]">Boss</strong> in natural
          language. Describe what you want done. The Boss analyzes your request, creates a project,
          and delegates work to the Manager, who breaks it into steps and assigns employees.
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm text-[var(--text-secondary)]">
          Chat &rarr; &ldquo;Write a technical spec for our new authentication system&rdquo;
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Watch the office come alive as employees collaborate, produce artifacts, and report back.
        </p>
      </section>

      {/* Next Steps */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Next Steps</h2>
        <ul className="mt-4 space-y-2">
          <NextLink href="/docs/concepts" label="Core Concepts" description="Understand the runtime model" />
          <NextLink href="/docs/models" label="Model Configuration" description="Fine-tune provider and model assignments" />
          <NextLink href="/docs/creating-packages" label="Creating Packages" description="Build and publish your own assets" />
        </ul>
      </section>
    </>
  );
}

function NextLink({ href, label, description }: { href: string; label: string; description: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-baseline gap-2 text-sm group"
      >
        <span className="text-[var(--accent-indigo)] group-hover:text-[var(--accent-hover)] transition-colors font-medium">
          {label}
        </span>
        <span className="text-[var(--text-muted)]">&mdash; {description}</span>
      </Link>
    </li>
  );
}
