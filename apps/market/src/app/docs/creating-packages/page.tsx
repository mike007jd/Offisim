import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Creating Packages' };

export default function CreatingPackagesPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Creating Packages</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed max-w-lg">
        Packages are the distribution unit for Offisim assets. They are declarative, auditable, and
        installable from the marketplace.
      </p>

      {/* What is a Package */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">What is a Package?</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          A package consists of a <strong className="text-[var(--text-primary)]">manifest</strong>{' '}
          (JSON) and <strong className="text-[var(--text-primary)]">assets</strong> (configuration
          files, prompts, SOP definitions, etc.). Packages describe what they install &mdash; they
          never execute arbitrary code.
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          This makes every package auditable: you can inspect exactly what will change in your
          runtime before installation.
        </p>
      </section>

      {/* Package Types */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Package Types</h2>
        <div className="mt-4 space-y-3">
          <TypeRow
            name="employee"
            description="A complete AI agent definition — role, skills, SOPs, personality, and defaults."
          />
          <TypeRow
            name="skill"
            description="A reusable capability that employees can use — MCP tool wrappers, specialized prompts, domain knowledge."
          />
          <TypeRow
            name="sop"
            description="A workflow template (DAG) that defines how to approach a type of task."
          />
          <TypeRow
            name="company_template"
            description="A full company setup — pre-configured employees, settings, and office layout."
          />
          <TypeRow
            name="office_layout"
            description="A spatial arrangement of zones, furniture, and prefabs for the office view."
          />
          <TypeRow
            name="bundle"
            description="A collection of multiple packages that install together as a set."
          />
        </div>
      </section>

      {/* Manifest Structure */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Manifest Structure</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          Every package starts with a{' '}
          <code className="bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-xs font-mono text-[var(--accent-indigo)]">
            aics-manifest.json
          </code>{' '}
          file:
        </p>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 font-mono text-sm text-[var(--text-secondary)] overflow-x-auto">
          <pre>{`{
  "schema_version": "1.0",
  "kind": "employee",
  "name": "senior-developer",
  "display_name": "Senior Developer",
  "version": "1.0.0",
  "description": "A senior software engineer...",
  "author": "your-handle",
  "tags": ["developer", "code-review"],
  "assets": { ... }
}`}</pre>
        </div>
        <p className="mt-3 text-sm text-[var(--text-muted)] leading-relaxed">
          The full manifest schema is defined in{' '}
          <code className="bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-xs font-mono text-[var(--accent-indigo)]">
            packages/asset-schema
          </code>
          . All fields are validated at install time.
        </p>
      </section>

      {/* Development Workflow */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Development Workflow</h2>
        <ol className="mt-4 space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              1
            </span>
            <span>
              <strong className="text-[var(--text-primary)]">Create locally</strong> &mdash; Write
              your manifest and assets in a local directory. Use the employee editor or write JSON
              directly.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              2
            </span>
            <span>
              <strong className="text-[var(--text-primary)]">Test in runtime</strong> &mdash;
              Install the package into your local company and verify it works as expected.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              3
            </span>
            <span>
              <strong className="text-[var(--text-primary)]">Validate</strong> &mdash; Run the
              manifest validator to ensure your package meets all schema requirements.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-medium text-[var(--accent-indigo)]">
              4
            </span>
            <span>
              <strong className="text-[var(--text-primary)]">Publish</strong> &mdash; Upload to the
              marketplace via the creator dashboard. Your package goes through a review process
              before appearing publicly.
            </span>
          </li>
        </ol>
      </section>

      {/* Publishing */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Publishing to the Marketplace</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          To publish, you need a creator account on the marketplace. Sign up from the{' '}
          <Link
            href="/dashboard"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            creator dashboard
          </Link>
          , then use the publish form to upload your package.
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          See{' '}
          <Link
            href="/docs/contributing"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Contributing
          </Link>{' '}
          for details on getting marketplace access and the review process.
        </p>
      </section>

      {/* Package Rules */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <h2 className="font-display text-xl font-semibold">Package Rules</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          All packages must follow these non-negotiable rules for 1.0:
        </p>
        <ul className="mt-4 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          <li className="flex gap-2">
            <span className="text-[var(--accent-rose)] font-mono text-xs">&times;</span>
            <span>No install hooks or postinstall scripts</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent-rose)] font-mono text-xs">&times;</span>
            <span>No arbitrary shell execution</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent-rose)] font-mono text-xs">&times;</span>
            <span>No embedded secrets or API keys</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent-rose)] font-mono text-xs">&times;</span>
            <span>No hidden network bootstrap logic</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--success)] font-mono text-xs">&#10003;</span>
            <span>Declarative manifest + static assets only</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--success)] font-mono text-xs">&#10003;</span>
            <span>Fully auditable before installation</span>
          </li>
        </ul>
      </section>

      {/* Footer links */}
      <section className="mt-10 border-t border-[var(--border)] pt-8">
        <p className="text-sm text-[var(--text-muted)]">
          See also:{' '}
          <Link
            href="/docs/concepts"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Core Concepts
          </Link>
          {' \u00B7 '}
          <Link
            href="/docs/contributing"
            className="text-[var(--accent-indigo)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Contributing
          </Link>
        </p>
      </section>
    </>
  );
}

function TypeRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex gap-3 items-start">
      <code className="shrink-0 bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-xs font-mono text-[var(--accent-indigo)] mt-0.5">
        {name}
      </code>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{description}</p>
    </div>
  );
}
