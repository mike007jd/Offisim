import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Contributing' };

export default function ContributingPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Contributing</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed max-w-lg">
        Offisim is open source. Whether you want to fix a bug, add a feature, or publish a package,
        here is how to get started.
      </p>

      {/* Getting the Source */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Getting the Source</h2>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm">
          <div className="text-[var(--text-secondary)]">git clone https://github.com/nicepkg/offisim.git</div>
          <div className="text-[var(--text-secondary)]">cd offisim</div>
          <div className="text-[var(--text-secondary)]">pnpm install</div>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          The repo is a pnpm monorepo. All dependencies are managed through the root{' '}
          <code className="bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-xs font-mono text-[var(--accent-indigo)]">
            pnpm-workspace.yaml
          </code>
          .
        </p>
      </section>

      {/* Project Structure */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Project Structure</h2>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm text-[var(--text-secondary)] overflow-x-auto">
          <pre>{`apps/
  web/          Vite + React SPA (browser runtime shell)
  desktop/      Tauri 2 desktop app (1.0 reference)
  market/       Next.js 15 marketplace website
  platform/     Hono API / registry services

packages/
  core/         Orchestration kernel, LLM gateway
  renderer/     Office scene logic, layout engine
  ui-office/    Desktop UI components
  ui-market/    Marketplace UI components
  asset-schema/ Manifest schema + validators
  install-core/ Install planner, compatibility checks
  db-local/     SQLite schema + migrations
  db-platform/  PostgreSQL schema + migrations`}</pre>
        </div>
      </section>

      {/* Development */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Development</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          The desktop app is the reference environment for 1.0. Use the Tauri dev command:
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm">
          <div className="text-[var(--text-muted)]"># Start the desktop app (recommended)</div>
          <div className="text-[var(--text-secondary)]">pnpm --filter @offisim/desktop dev</div>
        </div>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <p className="text-xs font-semibold text-[var(--warning)]">Important</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">
            Do <strong className="text-[var(--text-primary)]">not</strong> use{' '}
            <code className="bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-xs font-mono text-[var(--accent-indigo)]">
              vite dev
            </code>{' '}
            /{' '}
            <code className="bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-xs font-mono text-[var(--accent-indigo)]">
              pnpm dev
            </code>{' '}
            for apps/web directly. The Vite dev server causes excessive CPU and fan usage.
          </p>
        </div>
        <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">
          If you changed{' '}
          <code className="bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-xs font-mono text-[var(--accent-indigo)]">
            packages/ui-office
          </code>
          , build it first:
        </p>
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm text-[var(--text-secondary)]">
          pnpm --filter @offisim/ui-office build
        </div>
      </section>

      {/* Testing */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Testing</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Run the full test suite and type checker:
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm">
          <div className="text-[var(--text-muted)]"># Run all tests</div>
          <div className="text-[var(--text-secondary)]">pnpm test</div>
          <div className="mt-3 text-[var(--text-muted)]"># Type check all packages</div>
          <div className="text-[var(--text-secondary)]">pnpm typecheck</div>
          <div className="mt-3 text-[var(--text-muted)]"># Lint</div>
          <div className="text-[var(--text-secondary)]">pnpm lint</div>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Before submitting changes, verify that tests, typecheck, and lint pass for all affected
          packages.
        </p>
      </section>

      {/* Code Style */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Code Style</h2>
        <ul className="mt-4 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>Keep code readable, explicit, and easy for another developer (or agent) to continue.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>Reuse existing repo packages and primitives before adding new abstractions.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>Follow existing patterns in the codebase. When in doubt, look at neighboring files.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>Prefer explicit trade-offs over hidden cleverness.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-muted)]">&bull;</span>
            <span>
              If a generic web best practice conflicts with repo reality, repo reality wins.
            </span>
          </li>
        </ul>
      </section>

      {/* Submitting Changes */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Submitting Changes</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Pull requests are welcome. Before submitting:
        </p>
        <ol className="mt-4 space-y-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              1
            </span>
            <span>Ensure all tests pass for packages you changed.</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              2
            </span>
            <span>Run typecheck and lint with zero errors.</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              3
            </span>
            <span>
              If your change touches behavior defined by a contract (manifest, install flow, API),
              update the contract alongside the code.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              4
            </span>
            <span>Write a clear commit message describing why, not just what.</span>
          </li>
        </ol>
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
            href="/docs/creating-packages"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Creating Packages
          </Link>
        </p>
      </section>
    </>
  );
}
